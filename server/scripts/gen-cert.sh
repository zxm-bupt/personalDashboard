#!/usr/bin/env bash
# 为同步服务生成 HTTPS 证书：一个自建 CA + 一张由它签发、绑定公网 IP 的服务器证书。
#
#   ./gen-cert.sh <公网IP> [输出目录，默认 ./certs]
#
# 每台 Mac 在同步设置里粘贴 ca.crt 的内容，应用只信任这一张 CA。
# 输出目录里已有 CA 时会沿用它，只重新签发服务器证书：IP 变了或证书快过期时重新运行即可，
# Mac 端不用改任何配置。只有删除 ca.key 后重新运行，才会生成新的 CA（所有 Mac 都要重新粘贴）。
#
# 不依赖系统的 openssl.cnf：各发行版默认配置不同，比如 `openssl req -x509` 默认会给证书加上
# CA:TRUE，而 rustls 拒绝把 CA 证书当服务器证书使用。所以这里用自己写的配置文件。
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "用法：$0 <公网IP> [输出目录]" >&2
  exit 1
fi

IP="$1"
OUT="${2:-./certs}"

if [[ ! "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ && "$IP" != *:* ]]; then
  echo "“$IP”不像是 IP 地址。这个脚本为 IP 签发证书；有域名的话应该用 Let's Encrypt。" >&2
  exit 1
fi

command -v openssl >/dev/null || { echo "需要 openssl" >&2; exit 1; }

mkdir -p "$OUT"
umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat >"$WORK/ca.cnf" <<'EOF'
[req]
prompt = no
distinguished_name = dn
x509_extensions = ca_ext
[dn]
CN = Personal Workbench Sync CA
[ca_ext]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF

cat >"$WORK/server.cnf" <<EOF
[req]
prompt = no
distinguished_name = dn
[dn]
CN = ${IP}
[server_ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = IP:${IP}
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF

if [[ -f "$OUT/ca.key" && -f "$OUT/ca.crt" ]]; then
  echo "沿用已有的 CA：$OUT/ca.crt（Mac 端不需要重新配置）"
else
  echo "生成新的 CA……"
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
    -keyout "$OUT/ca.key" -out "$OUT/ca.crt" -days 3650 -config "$WORK/ca.cnf" 2>/dev/null
fi

echo "为 ${IP} 签发服务器证书……"
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout "$OUT/server.key" -out "$WORK/server.csr" -config "$WORK/server.cnf" 2>/dev/null
openssl x509 -req -in "$WORK/server.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" \
  -set_serial "0x$(openssl rand -hex 16)" -days 1825 \
  -extfile "$WORK/server.cnf" -extensions server_ext -out "$OUT/server.crt" 2>/dev/null

# 服务端发送完整证书链
cat "$OUT/server.crt" "$OUT/ca.crt" >"$OUT/fullchain.crt"
chmod 600 "$OUT/ca.key" "$OUT/server.key"
chmod 644 "$OUT/ca.crt" "$OUT/server.crt" "$OUT/fullchain.crt"

openssl verify -CAfile "$OUT/ca.crt" "$OUT/server.crt" >/dev/null

echo
echo "完成。文件在 $OUT："
echo "  ca.crt         粘贴到每台 Mac 的同步设置里"
echo "  ca.key         CA 私钥，只用来签发服务器证书，不要外传"
echo "  fullchain.crt  服务器证书链（SYNC_TLS_CERT）"
echo "  server.key     服务器私钥（SYNC_TLS_KEY）"
echo
echo "CA 指纹（在 Mac 上核对，确认粘贴的是同一张证书）："
openssl x509 -in "$OUT/ca.crt" -noout -fingerprint -sha256 | sed 's/^.*Fingerprint=/  /'

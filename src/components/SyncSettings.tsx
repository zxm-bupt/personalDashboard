import { useState } from 'react'
import type { SyncController } from '../hooks/useSync'
import { formatDateTime } from '../utils'

interface SyncSettingsProps {
  sync: SyncController
  onClose: () => void
}

interface Notice {
  tone: 'ok' | 'warn' | 'error'
  text: string
}

/** 本机和服务器的时间相差超过这个值就提醒：冲突时按修改时间判断谁更新。 */
const CLOCK_SKEW_WARNING_MS = 2 * 60 * 1000

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function SyncSettings({ sync, onClose }: SyncSettingsProps) {
  const config = sync.config
  const [serverUrl, setServerUrl] = useState(config?.serverUrl ?? '')
  const [token, setToken] = useState('')
  const [caPem, setCaPem] = useState('')
  const [busy, setBusy] = useState(false)
  const [notices, setNotices] = useState<Notice[]>([])

  const configured = Boolean(config?.configured)

  const checkConnection = async (): Promise<Notice[]> => {
    const { skewMs } = await sync.testConnection()
    const result: Notice[] = [{ tone: 'ok', text: '连接成功：证书和令牌都正确' }]
    if (Math.abs(skewMs) > CLOCK_SKEW_WARNING_MS) {
      result.push({
        tone: 'warn',
        text:
          `这台 Mac 的时间和服务器相差约 ${Math.round(Math.abs(skewMs) / 60000)} 分钟。` +
          '两台设备改了同一条记录时按修改时间判断谁更新，请在系统设置里开启“自动设置日期与时间”。',
      })
    }
    return result
  }

  const runAction = async (action: () => Promise<Notice[]>) => {
    setBusy(true)
    setNotices([])
    try {
      setNotices(await action())
    } catch (error) {
      setNotices([{ tone: 'error', text: describeError(error) }])
    } finally {
      setBusy(false)
    }
  }

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void runAction(async () => {
      await sync.saveConfig({
        serverUrl,
        token: token.trim() || null,
        caPem: caPem.trim() || null,
      })
      setToken('')
      setCaPem('')
      const result = await checkConnection()
      await sync.syncNow()
      return result
    })
  }

  const handleClear = () => {
    if (!window.confirm('停用同步后，这台 Mac 不再和服务器同步，本机数据保留。确定停用吗？')) return
    void runAction(async () => {
      await sync.clearConfig()
      setServerUrl('')
      return [{ tone: 'ok', text: '已停用同步，令牌已从钥匙串删除' }]
    })
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="同步设置">
        <div className="modal-header">
          <div>
            <p className="eyebrow">多设备同步</p>
            <h2>同步设置</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <form className="form" onSubmit={handleSave}>
          <p className="muted sync-intro">
            服务器、令牌和 CA 证书都来自服务器上 install.sh 的输出。数据只通过 HTTPS 传输，
            并且这台 Mac 只信任你粘贴的这张 CA 证书。
          </p>

          <label className="field">
            <span>服务器地址</span>
            <input
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              placeholder="https://1.2.3.4:8443"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="field">
            <span>令牌</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={config?.hasToken ? '已保存在钥匙串中，留空则不修改' : 'install.sh 输出的令牌'}
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span>CA 证书</span>
            <textarea
              className="sync-ca-input"
              value={caPem}
              onChange={(event) => setCaPem(event.target.value)}
              placeholder={
                config?.hasCa
                  ? '已保存，留空则不修改'
                  : '-----BEGIN CERTIFICATE-----\n……\n-----END CERTIFICATE-----'
              }
              rows={5}
              spellCheck={false}
            />
          </label>

          {config?.caFingerprint && (
            <div className="sync-fingerprint">
              <span>已保存的 CA 指纹，和服务器上 install.sh 输出的核对：</span>
              <code>{config.caFingerprint}</code>
            </div>
          )}

          {configured && (
            <p className="muted sync-status-line">
              {sync.phase === 'syncing'
                ? '正在同步……'
                : sync.lastSyncAt
                  ? `上次同步：${formatDateTime(sync.lastSyncAt)}`
                  : '还没有同步过'}
              {sync.message && ` · ${sync.message}`}
            </p>
          )}

          {notices.map((notice) => (
            <p key={notice.text} className={`sync-notice sync-notice-${notice.tone}`}>
              {notice.text}
            </p>
          ))}

          <div className="modal-actions">
            {configured && (
              <button type="button" className="button ghost danger-text" onClick={handleClear} disabled={busy}>
                停用同步
              </button>
            )}
            {configured && (
              <button
                type="button"
                className="button ghost"
                disabled={busy}
                onClick={() =>
                  void runAction(async () => {
                    await sync.syncNow()
                    return []
                  })
                }
              >
                立即同步
              </button>
            )}
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? '处理中…' : '保存并测试连接'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

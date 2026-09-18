{ pkgs ? import <nixpkgs> { } }:

let
  buildInputs = with pkgs; [
    # Web
    nodejs_22
    pnpm

    # Rust / Tauri
    rustc
    cargo
    rustfmt
    clippy

    # Tauri Linux native dependencies
    pkg-config
    fontconfig
    adwaita-icon-theme
    gtk3
    webkitgtk_4_1
    libsoup_3
    librsvg
    gdk-pixbuf
    glib
    cairo
    pango
    atk
    harfbuzz
    openssl
    xdotool
    libayatana-appindicator

    # Build tools
    gcc
    gnumake
    cmake
    sqlite
    curl
    wget
    jq
    file
  ];

  pkgConfigPath = pkgs.lib.makeSearchPathOutput "dev" "lib/pkgconfig" buildInputs;
  libraryPath = pkgs.lib.makeLibraryPath buildInputs;

  cursorThemePath = "${pkgs.adwaita-icon-theme}/share/icons";

  fontsConf = pkgs.makeFontsConf {
    fontDirectories = [
      "${pkgs.noto-fonts-cjk-sans}/share/fonts"
      "${pkgs.noto-fonts-color-emoji}/share/fonts"
      "${pkgs.noto-fonts}/share/fonts"
      "${pkgs.dejavu_fonts}/share/fonts"
    ];
  };
in
pkgs.mkShell {
  inherit buildInputs;

  shellHook = ''
    export PKG_CONFIG_PATH="${pkgConfigPath}:$PKG_CONFIG_PATH"
    export LD_LIBRARY_PATH="${libraryPath}:$LD_LIBRARY_PATH"
    export FONTCONFIG_FILE="${fontsConf}"
    export XCURSOR_THEME=Adwaita
    export XCURSOR_SIZE=24
    export XCURSOR_PATH="${cursorThemePath}:$XCURSOR_PATH"

    # WSLg 下优先使用 X11，并关闭 WebKit 合成器，避免渲染异常
    if [ -n "$WSL_DISTRO_NAME" ]; then
      export GDK_BACKEND=x11
      export WEBKIT_DISABLE_COMPOSITING_MODE=1
      export WEBKIT_DISABLE_DMABUF_RENDERER=1
    fi

    echo "Personal Workbench development shell"
    echo "Node: $(node --version)"
    echo "pnpm: $(pnpm --version)"
    echo "Rust: $(rustc --version)"
    echo "Run web:  pnpm dev:host"
    echo "Run Tauri: pnpm tauri dev"
  '';
}

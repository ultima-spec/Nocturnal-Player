/**
 * Build Script for Nocturnal player Linux Installer (dist/Nocturnal-Player-Linux-Installer.zip)
 *
 * Creates a self-contained Linux installer package containing:
 *   - install-nocturnal-player.sh (executable Linux installer script that automatically
 *     detects x86_64 or arm64, downloads the native Linux Electron runtime & Linux ffmpeg binary,
 *     installs to ~/.local/opt/nocturnal-player, creates ~/.local/bin/nocturnal-player,
 *     registers a desktop entry in ~/.local/share/applications/nocturnal-player.desktop + Desktop shortcut,
 *     and launches the app)
 *   - app/ (the complete Nocturnal player source code & assets)
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST_DIR = path.join(ROOT, 'dist');
const LINUX_STAGE_DIR = path.join(DIST_DIR, 'Nocturnal-Player-Linux-Installer');
const LINUX_ZIP_PATH = path.join(DIST_DIR, 'Nocturnal-Player-Linux-Installer.zip');

function log(msg) {
  console.log(`[LinuxBuild] ${msg}`);
}

function copyRecursiveSync(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function generateLinuxInstallerScript() {
  // IMPORTANT: Use LF (\n) line endings only so Linux bash/sh executes it cleanly!
  const lines = [
    '#!/usr/bin/env bash',
    'set -e',
    '',
    'clear || true',
    'echo "============================================================"',
    'echo "  [::] NOCTURNAL PLAYER — LINUX INSTALLER (x64 & ARM64)"',
    'echo "============================================================"',
    'echo ""',
    '',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'PAYLOAD_APP_DIR="$SCRIPT_DIR/app"',
    'if [ ! -d "$PAYLOAD_APP_DIR" ]; then',
    '  echo "Error: Could not find app/ payload directory next to this installer."',
    '  exit 1',
    'fi',
    '',
    'INSTALL_DIR="$HOME/.local/opt/nocturnal-player"',
    'BIN_DIR="$HOME/.local/bin"',
    'APPS_DIR="$HOME/.local/share/applications"',
    '',
    '# Detect Linux CPU architecture (x86_64 vs aarch64/arm64)',
    'ARCH="$(uname -m)"',
    'if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then',
    '  ELECTRON_ARCH="arm64"',
    '  FFMPEG_ARCH="arm64"',
    '  echo "[1/5] Detected ARM64 Linux ($ARCH)"',
    'else',
    '  ELECTRON_ARCH="x64"',
    '  FFMPEG_ARCH="x64"',
    '  echo "[1/5] Detected x86_64 Linux ($ARCH)"',
    'fi',
    '',
    'ELECTRON_VERSION="v33.4.0"',
    'ELECTRON_ZIP_URL="https://github.com/electron/electron/releases/download/${ELECTRON_VERSION}/electron-${ELECTRON_VERSION}-linux-${ELECTRON_ARCH}.zip"',
    'FFMPEG_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0.1/linux-${FFMPEG_ARCH}"',
    '',
    'WORK_DIR="$(mktemp -d)"',
    'cleanup() {',
    '  rm -rf "$WORK_DIR"',
    '}',
    'trap cleanup EXIT',
    '',
    'echo "[2/5] Downloading native Linux Electron runtime (${ELECTRON_VERSION} linux-${ELECTRON_ARCH})..."',
    'if command -v curl >/dev/null 2>&1; then',
    '  curl -L --progress-bar "$ELECTRON_ZIP_URL" -o "$WORK_DIR/electron.zip"',
    'elif command -v wget >/dev/null 2>&1; then',
    '  wget -q --show-progress "$ELECTRON_ZIP_URL" -O "$WORK_DIR/electron.zip"',
    'else',
    '  echo "Error: Neither curl nor wget is installed. Please install curl or wget and try again."',
    '  exit 1',
    'fi',
    '',
    'echo "[3/5] Extracting application bundle to $INSTALL_DIR..."',
    'pkill -f "nocturnal-player" 2>/dev/null || true',
    'rm -rf "$INSTALL_DIR"',
    'mkdir -p "$INSTALL_DIR"',
    'unzip -q "$WORK_DIR/electron.zip" -d "$INSTALL_DIR"',
    '',
    '# Rename electron binary -> nocturnal-player',
    'if [ -f "$INSTALL_DIR/electron" ]; then',
    '  mv "$INSTALL_DIR/electron" "$INSTALL_DIR/nocturnal-player"',
    '  chmod +x "$INSTALL_DIR/nocturnal-player"',
    'fi',
    '',
    '# Configure chrome-sandbox or wrapper flags so it runs out of the box on Ubuntu 24.04+ / Arch / Fedora / Hyprland',
    'rm -rf "$INSTALL_DIR/resources/default_app.asar"',
    'RESOURCES_APP="$INSTALL_DIR/resources/app"',
    'mkdir -p "$RESOURCES_APP"',
    'cp -R "$PAYLOAD_APP_DIR/"* "$RESOURCES_APP/"',
    '',
    '# Download native Linux ffmpeg binary for YT Music audio conversion',
    'echo "[4/5] Installing Linux ffmpeg binary for YT Music conversion..."',
    'FFMPEG_DIR="$RESOURCES_APP/node_modules/ffmpeg-static"',
    'mkdir -p "$FFMPEG_DIR"',
    'if command -v curl >/dev/null 2>&1; then',
    '  curl -L -s --fail "$FFMPEG_URL" -o "$FFMPEG_DIR/ffmpeg" || true',
    'elif command -v wget >/dev/null 2>&1; then',
    '  wget -q "$FFMPEG_URL" -O "$FFMPEG_DIR/ffmpeg" || true',
    'fi',
    'if [ -f "$FFMPEG_DIR/ffmpeg" ]; then',
    '  chmod +x "$FFMPEG_DIR/ffmpeg"',
    '  cat > "$FFMPEG_DIR/index.js" << \'EOF\'',
    'const path = require("path");',
    'module.exports = path.join(__dirname, "ffmpeg");',
    'EOF',
    '  cat > "$FFMPEG_DIR/package.json" << \'EOF\'',
    '{"name":"ffmpeg-static","version":"5.2.0","main":"index.js"}',
    'EOF',
    'fi',
    '',
    'echo "[5/5] Creating launcher command & desktop shortcuts..."',
    'mkdir -p "$BIN_DIR" "$APPS_DIR"',
    '',
    'cat > "$BIN_DIR/nocturnal-player" << EOF',
    '#!/usr/bin/env bash',
    'exec "$INSTALL_DIR/nocturnal-player" --no-sandbox "\\$@"',
    'EOF',
    'chmod +x "$BIN_DIR/nocturnal-player"',
    '',
    '# Create Uninstall script inside $INSTALL_DIR',
    'cat > "$INSTALL_DIR/uninstall.sh" << EOF',
    '#!/usr/bin/env bash',
    'rm -f "$BIN_DIR/nocturnal-player"',
    'rm -f "$APPS_DIR/nocturnal-player.desktop"',
    'rm -f "$HOME/Desktop/Nocturnal player.desktop"',
    'rm -rf "$INSTALL_DIR"',
    'echo "Nocturnal player has been uninstalled."',
    'EOF',
    'chmod +x "$INSTALL_DIR/uninstall.sh"',
    '',
    'ICON_PATH="$RESOURCES_APP/assets/180px-soundtrack_(nocturnal_style).png"',
    'DESKTOP_FILE="$APPS_DIR/nocturnal-player.desktop"',
    'cat > "$DESKTOP_FILE" << EOF',
    '[Desktop Entry]',
    'Type=Application',
    'Name=Nocturnal player',
    'Comment=Nocturnal player — standalone desktop music player',
    'Exec="$BIN_DIR/nocturnal-player"',
    'Path=$INSTALL_DIR',
    'Icon=$ICON_PATH',
    'Terminal=false',
    'Categories=AudioVideo;Audio;Player;',
    'EOF',
    'chmod +x "$DESKTOP_FILE"',
    '',
    'if [ -d "$HOME/Desktop" ]; then',
    '  cp "$DESKTOP_FILE" "$HOME/Desktop/Nocturnal player.desktop" 2>/dev/null || true',
    '  chmod +x "$HOME/Desktop/Nocturnal player.desktop" 2>/dev/null || true',
    'fi',
    '',
    'echo ""',
    'echo "============================================================"',
    'echo "  SUCCESS! Installed to: $INSTALL_DIR"',
    'echo "  Command: ~/.local/bin/nocturnal-player"',
    'echo "  Launching Nocturnal player..."',
    'echo "============================================================"',
    'nohup "$BIN_DIR/nocturnal-player" >/dev/null 2>&1 &',
    'exit 0',
    ''
  ];
  return lines.join('\n');
}

function generateLinuxReadme() {
  return [
    '============================================================',
    '  [::] NOCTURNAL PLAYER — LINUX INSTALLER INSTRUCTIONS',
    '============================================================',
    '',
    'HOW TO INSTALL ON LINUX (Arch / Hyprland / Ubuntu / Fedora / Debian — x64 & ARM64):',
    '',
    '1. Extract "Nocturnal-Player-Linux-Installer.zip".',
    '2. Open a terminal in the extracted folder and run:',
    '',
    '   ./install-nocturnal-player.sh',
    '',
    '   (Or double-click "install-nocturnal-player.sh" and choose "Run in Terminal".)',
    '',
    '3. The installer will automatically:',
    '   - Detect whether your Linux system is x86_64 or ARM64',
    '   - Install Nocturnal player into ~/.local/opt/nocturnal-player',
    '   - Create ~/.local/bin/nocturnal-player and an application launcher entry',
    '   - Launch Nocturnal player automatically!',
    '',
    'To uninstall anytime, run:',
    '   ~/.local/opt/nocturnal-player/uninstall.sh',
    ''
  ].join('\n');
}

function createPosixZip(sourceDir, outZipPath, rootFolderName) {
  const zlib = require('zlib');

  const files = [];
  function walk(currDir, relBase) {
    for (const entry of fs.readdirSync(currDir)) {
      const full = path.join(currDir, entry);
      const rel = relBase ? `${relBase}/${entry}` : entry;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, rel);
      } else {
        files.push({ full, rel: `${rootFolderName}/${rel}` });
      }
    }
  }
  walk(sourceDir, '');

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const item of files) {
    const rawData = fs.readFileSync(item.full);
    const crc = crc32(rawData);
    const deflated = zlib.deflateRawSync(rawData, { level: 9 });
    const useDeflate = deflated.length < rawData.length;
    const compData = useDeflate ? deflated : rawData;
    const method = useDeflate ? 8 : 0;

    const nameBuf = Buffer.from(item.rel, 'utf-8');
    const isExecutable = item.rel.endsWith('.command') || item.rel.endsWith('.sh');
    const unixMode = isExecutable ? 0o100755 : 0o100644;
    const externalAttr = (unixMode << 16) >>> 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x5421, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compData.length, 18);
    lh.writeUInt32LE(rawData.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);

    localParts.push(lh, nameBuf, compData);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x031e, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x5421, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compData.length, 20);
    ch.writeUInt32LE(rawData.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(externalAttr, 38);
    ch.writeUInt32LE(offset, 42);

    centralParts.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + compData.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outZipPath, Buffer.concat([...localParts, centralBuf, eocd]));
}

function main() {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  if (fs.existsSync(LINUX_STAGE_DIR)) {
    fs.rmSync(LINUX_STAGE_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(LINUX_ZIP_PATH)) {
    fs.rmSync(LINUX_ZIP_PATH, { force: true });
  }

  const payloadAppDir = path.join(LINUX_STAGE_DIR, 'app');
  fs.mkdirSync(payloadAppDir, { recursive: true });

  const appFiles = [
    'package.json',
    'main.js',
    'preload.js',
    'renderer.js',
    'index.html',
    'styles.css',
    'discord-rpc.js'
  ];

  log('Copying Nocturnal player source files & assets into Linux installer bundle...');
  for (const file of appFiles) {
    fs.copyFileSync(path.join(ROOT, file), path.join(payloadAppDir, file));
  }
  copyRecursiveSync(path.join(ROOT, 'assets'), path.join(payloadAppDir, 'assets'));

  const shScriptPath = path.join(LINUX_STAGE_DIR, 'install-nocturnal-player.sh');
  fs.writeFileSync(shScriptPath, generateLinuxInstallerScript(), { encoding: 'utf-8' });

  const readmePath = path.join(LINUX_STAGE_DIR, 'README - HOW TO INSTALL ON LINUX.txt');
  fs.writeFileSync(readmePath, generateLinuxReadme(), { encoding: 'utf-8' });

  log('Creating Nocturnal-Player-Linux-Installer.zip with POSIX executable permissions (0755) on .sh script...');
  createPosixZip(LINUX_STAGE_DIR, LINUX_ZIP_PATH, 'Nocturnal-Player-Linux-Installer');

  const sizeMb = (fs.statSync(LINUX_ZIP_PATH).size / (1024 * 1024)).toFixed(2);
  log(`SUCCESS! Built Linux installer: ${LINUX_ZIP_PATH} (${sizeMb} MB)`);
}

main();

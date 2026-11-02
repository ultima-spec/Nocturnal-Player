/**
 * Build Script for Nocturnal player macOS Installer (dist/Nocturnal-Player-Mac-Installer.zip)
 *
 * Creates a small, self-contained macOS installer package containing:
 *   - Install Nocturnal player.command (double-clickable macOS installer that automatically
 *     detects Apple Silicon arm64 or Intel x64, downloads the native macOS Electron runtime &
 *     macOS ffmpeg binary, builds "/Applications/Nocturnal player.app" with custom icon,
 *     removes Gatekeeper quarantine flags, and launches the app)
 *   - app/ (the complete Nocturnal player source code & assets)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const DIST_DIR = path.join(ROOT, 'dist');
const MAC_STAGE_DIR = path.join(DIST_DIR, 'Nocturnal-Player-Mac-Installer');
const MAC_ZIP_PATH = path.join(DIST_DIR, 'Nocturnal-Player-Mac-Installer.zip');

function log(msg) {
  console.log(`[MacBuild] ${msg}`);
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

function generateMacCommandScript() {
  // IMPORTANT: Use LF (\n) line endings only so macOS bash/zsh executes it cleanly!
  const lines = [
    '#!/bin/bash',
    'set -e',
    '',
    'clear',
    'echo "============================================================"',
    'echo "  [::] NOCTURNAL PLAYER — macOS INSTALLER (ARM64 & INTEL)"',
    'echo "============================================================"',
    'echo ""',
    '',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'PAYLOAD_APP_DIR="$SCRIPT_DIR/app"',
    'if [ ! -d "$PAYLOAD_APP_DIR" ]; then',
    '  echo "Error: Could not find app/ payload directory next to this installer."',
    '  read -n 1 -s -r -p "Press any key to exit..."',
    '  exit 1',
    'fi',
    '',
    '# Determine target Applications folder (/Applications if writable, otherwise ~/Applications)',
    'TARGET_APPS_DIR="/Applications"',
    'if [ ! -w "/Applications" ]; then',
    '  TARGET_APPS_DIR="$HOME/Applications"',
    '  mkdir -p "$TARGET_APPS_DIR"',
    'fi',
    'APP_BUNDLE="$TARGET_APPS_DIR/Nocturnal player.app"',
    '',
    '# Detect macOS CPU architecture (Apple Silicon arm64 vs Intel x64)',
    'ARCH="$(uname -m)"',
    'if [ "$ARCH" = "arm64" ]; then',
    '  ELECTRON_ARCH="arm64"',
    '  FFMPEG_ARCH="arm64"',
    '  echo "[1/5] Detected Apple Silicon Mac (arm64)"',
    'else',
    '  ELECTRON_ARCH="x64"',
    '  FFMPEG_ARCH="x64"',
    '  echo "[1/5] Detected Intel Mac (x64)"',
    'fi',
    '',
    'ELECTRON_VERSION="v33.4.0"',
    'ELECTRON_ZIP_URL="https://github.com/electron/electron/releases/download/${ELECTRON_VERSION}/electron-${ELECTRON_VERSION}-darwin-${ELECTRON_ARCH}.zip"',
    'FFMPEG_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/b5.0.1/darwin-${FFMPEG_ARCH}"',
    '',
    'WORK_DIR="$(mktemp -d)"',
    'cleanup() {',
    '  rm -rf "$WORK_DIR"',
    '}',
    'trap cleanup EXIT',
    '',
    'echo "[2/5] Downloading native macOS Electron runtime (${ELECTRON_VERSION} darwin-${ELECTRON_ARCH})..."',
    'curl -L --progress-bar "$ELECTRON_ZIP_URL" -o "$WORK_DIR/electron.zip"',
    '',
    'echo "[3/5] Extracting application bundle..."',
    'unzip -q "$WORK_DIR/electron.zip" -d "$WORK_DIR/extracted"',
    '',
    '# Close running Nocturnal player if open',
    'pkill -f "Nocturnal player" 2>/dev/null || true',
    'rm -rf "$APP_BUNDLE"',
    'mv "$WORK_DIR/extracted/Electron.app" "$APP_BUNDLE"',
    '',
    '# Copy Nocturnal player app source & assets into Contents/Resources/app',
    'RESOURCES_APP="$APP_BUNDLE/Contents/Resources/app"',
    'rm -rf "$APP_BUNDLE/Contents/Resources/default_app.asar"',
    'mkdir -p "$RESOURCES_APP"',
    'cp -R "$PAYLOAD_APP_DIR/"* "$RESOURCES_APP/"',
    '',
    '# Download native macOS ffmpeg binary for YT Music audio conversion',
    'echo "[4/5] Installing macOS ffmpeg binary for YT Music conversion..."',
    'FFMPEG_DIR="$RESOURCES_APP/node_modules/ffmpeg-static"',
    'mkdir -p "$FFMPEG_DIR"',
    'if curl -L -s --fail "$FFMPEG_URL" -o "$FFMPEG_DIR/ffmpeg"; then',
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
    '# Build macOS .icns icon from assets/180px-soundtrack_(nocturnal_style).png using built-in sips & iconutil',
    'ICON_SRC="$RESOURCES_APP/assets/180px-soundtrack_(nocturnal_style).png"',
    'if [ -f "$ICON_SRC" ] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then',
    '  ICONSET="$WORK_DIR/Nocturnal.iconset"',
    '  mkdir -p "$ICONSET"',
    '  sips -z 16 16     "$ICON_SRC" --out "$ICONSET/icon_16x16.png" >/dev/null 2>&1 || true',
    '  sips -z 32 32     "$ICON_SRC" --out "$ICONSET/icon_16x16@2x.png" >/dev/null 2>&1 || true',
    '  sips -z 32 32     "$ICON_SRC" --out "$ICONSET/icon_32x32.png" >/dev/null 2>&1 || true',
    '  sips -z 64 64     "$ICON_SRC" --out "$ICONSET/icon_32x32@2x.png" >/dev/null 2>&1 || true',
    '  sips -z 128 128   "$ICON_SRC" --out "$ICONSET/icon_128x128.png" >/dev/null 2>&1 || true',
    '  sips -z 256 256   "$ICON_SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null 2>&1 || true',
    '  sips -z 256 256   "$ICON_SRC" --out "$ICONSET/icon_256x256.png" >/dev/null 2>&1 || true',
    '  sips -z 512 512   "$ICON_SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null 2>&1 || true',
    '  iconutil -c icns "$ICONSET" -o "$APP_BUNDLE/Contents/Resources/electron.icns" >/dev/null 2>&1 || true',
    'fi',
    '',
    '# Update Info.plist display name to Nocturnal player',
    'PLIST="$APP_BUNDLE/Contents/Info.plist"',
    'if [ -f "$PLIST" ]; then',
    '  /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Nocturnal player" "$PLIST" 2>/dev/null || true',
    '  /usr/libexec/PlistBuddy -c "Set :CFBundleName Nocturnal player" "$PLIST" 2>/dev/null || true',
    '  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.nocturnal.player" "$PLIST" 2>/dev/null || true',
    'fi',
    '',
    '# Clear macOS Gatekeeper quarantine attributes so the app opens without any warning',
    'echo "[5/5] Finalizing permissions & Desktop shortcut..."',
    'xattr -cr "$APP_BUNDLE" 2>/dev/null || true',
    'ln -sf "$APP_BUNDLE" "$HOME/Desktop/Nocturnal player.app" 2>/dev/null || true',
    '',
    'echo ""',
    'echo "============================================================"',
    'echo "  SUCCESS! Installed to: $APP_BUNDLE"',
    'echo "  Launching Nocturnal player..."',
    'echo "============================================================"',
    'open "$APP_BUNDLE"',
    'exit 0',
    ''
  ];
  return lines.join('\n');
}

function generateMacReadme() {
  return [
    '============================================================',
    '  [::] NOCTURNAL PLAYER — macOS INSTALLER INSTRUCTIONS',
    '============================================================',
    '',
    'HOW TO INSTALL ON MAC (Apple Silicon M1/M2/M3/M4 or Intel):',
    '',
    '1. Unzip "Nocturnal-Player-Mac-Installer.zip".',
    '2. Right-click (or Control+Click) on "Install Nocturnal player.command"',
    '   and click "Open" (then click "Open" in the prompt).',
    '',
    '   (Alternatively, open Terminal, drag "Install Nocturnal player.command"',
    '   into the Terminal window, and press Enter.)',
    '',
    '3. The installer will automatically:',
    '   - Detect whether your Mac is Apple Silicon (arm64) or Intel (x64)',
    '   - Build "Nocturnal player.app" inside /Applications',
    '   - Place a shortcut on your Desktop',
    '   - Launch Nocturnal player automatically!',
    ''
  ].join('\n');
}

function main() {
  fs.mkdirSync(DIST_DIR, { recursive: true });
  if (fs.existsSync(MAC_STAGE_DIR)) {
    fs.rmSync(MAC_STAGE_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(MAC_ZIP_PATH)) {
    fs.rmSync(MAC_ZIP_PATH, { force: true });
  }

  const payloadAppDir = path.join(MAC_STAGE_DIR, 'app');
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

  log('Copying Nocturnal player source files & assets into macOS installer bundle...');
  for (const file of appFiles) {
    fs.copyFileSync(path.join(ROOT, file), path.join(payloadAppDir, file));
  }
  copyRecursiveSync(path.join(ROOT, 'assets'), path.join(payloadAppDir, 'assets'));

  const commandScriptPath = path.join(MAC_STAGE_DIR, 'Install Nocturnal player.command');
  fs.writeFileSync(commandScriptPath, generateMacCommandScript(), { encoding: 'utf-8' });

  const readmePath = path.join(MAC_STAGE_DIR, 'README - HOW TO INSTALL ON MAC.txt');
  fs.writeFileSync(readmePath, generateMacReadme(), { encoding: 'utf-8' });

  log('Creating Nocturnal-Player-Mac-Installer.zip with POSIX executable permissions (0755) on .command script...');

  // Use a small inline Node script or Python/tar/ZipArchive that sets Unix external attributes (0o100755 << 16)
  // so macOS preserves the +x executable bit when unzipping!
  createPosixZip(MAC_STAGE_DIR, MAC_ZIP_PATH);

  const sizeMb = (fs.statSync(MAC_ZIP_PATH).size / (1024 * 1024)).toFixed(2);
  log(`SUCCESS! Built macOS installer: ${MAC_ZIP_PATH} (${sizeMb} MB)`);
}

/**
 * Pure Node.js ZIP writer (STORE / DEFLATE via zlib) that explicitly sets
 * Unix file permissions (0o755 for .command scripts, 0o644 for normal files)
 * in the Central Directory external file attributes so macOS Finder's Archive Utility
 * marks "Install Nocturnal player.command" as double-clickable executable out of the box!
 */
function createPosixZip(sourceDir, outZipPath) {
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
        files.push({ full, rel: `Nocturnal-Player-Mac-Installer/${rel}` });
      }
    }
  }
  walk(sourceDir, '');

  // Pre-build CRC32 table
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

    // Local file header (30 bytes + name)
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // signature
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0x0800, 6); // UTF-8 flag
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); // mod time
    lh.writeUInt16LE(0x5421, 12); // mod date
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compData.length, 18);
    lh.writeUInt32LE(rawData.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28); // extra len

    localParts.push(lh, nameBuf, compData);

    // Central directory header (46 bytes + name)
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); // signature
    ch.writeUInt16LE(0x031e, 4); // version made by: Unix (3) + 3.0
    ch.writeUInt16LE(20, 6); // version needed
    ch.writeUInt16LE(0x0800, 8); // UTF-8 flag
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x5421, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(compData.length, 20);
    ch.writeUInt32LE(rawData.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30); // extra len
    ch.writeUInt16LE(0, 32); // comment len
    ch.writeUInt16LE(0, 34); // disk num
    ch.writeUInt16LE(0, 36); // internal attr
    ch.writeUInt32LE(externalAttr, 38); // Unix permissions in upper 16 bits!
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

main();

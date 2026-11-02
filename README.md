# Nocturnal Player

**Nocturnal Player** is a standalone desktop music player built with Electron featuring an ULTRAKILL Nocturnal-inspired dark aesthetic, a Hyprland-style tiling & floating window manager, multi-mode audio visualizers (including a stereo XY Oscilloscope Music vectorscope), YouTube Music import with synced timed lyrics, and live Discord Rich Presence (it's very buggy please just turn it off at this point).

## Features
- **Up to 6 Playlists**: Manage up to 6 independent playlists with custom names, custom per-track or fallback playlist cover art, and persistent state.
- **Audio & YouTube Music Import**:
  - Import entire folders of local audio (`MP3`, `WAV`, `OGG`, `OPUS`, `M4A`, `WEBM`).
  - Import individual tracks or full playlists directly from **YouTube Music** URLs or search queries.
- **Multi-Mode Audio Visualizers**:
  - **Wave** (Time-domain waveform)
  - **Bar** (Logarithmic frequency spectrum with peak hold)
  - **Circle** (Radial spectrum + bass pulse ring)
  - **XY Scope** (True stereo Left/Right channel Lissajous vectorscope for oscilloscope music)
  - Run any combination simultaneously in **Split** or **Overlay** view, adjust **Amplitude Sensitivity** (`5%`–`175%`), resize vertically, float as an independent window, or fullscreen on its own.
- **Hyprland-Style Tiling & Floating Window Manager**:
  - Drag splitters, swap tiled containers, float any panel (`Alt+LMB` to move, `Alt+RMB` or 8-direction edges to resize), hide/restore individual panels, and save up to **6 Workspace Layouts (`L1`–`L6`)** including outer window dimensions.
- **Shuffle Queue Reordering & Loop Modes**:
  - Visual tracklist reordering when `Shuffle: ON` is active, plus drag-and-drop (`::`) and `▲`/`▼` buttons to reorder tracks inside the shuffled queue or standard tracklist.
  - Loop modes: `Loop: OFF`, `Loop: ALL`, and `Loop: 1`.
- **Synced Timed Lyrics**:
  - Auto-loads local `.lrc` / `.vtt` files, fetches synced lyrics from LRCLIB, or lets you load `.lrc` files manually with click-to-seek.
- **Discord Rich Presence**:
  - Live Discord status updates with automatic cover art upload and an On/Off toggle in Settings.

## Installers (Releases)
- **Windows (`Nocturnal-Player-Setup.exe`)**: Single-file Windows setup executable that installs `Nocturnal player`, creates Desktop & Start Menu shortcuts, and registers an uninstaller.
- **macOS (`Nocturnal-Player-Mac-Installer.zip`)**: Supports both Apple Silicon (`arm64`) and Intel (`x64`) Macs via `Install Nocturnal player.command`.

## Running from Source
```bash
npm install
npm start
```

## Building the Installers
```bash
npm run build-installer
```

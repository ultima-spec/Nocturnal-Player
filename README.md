# Nocturnal Player
<img width="1917" height="998" alt="image" src="https://github.com/user-attachments/assets/be9170e0-8622-482f-888b-ec44be9afc80" />

**Nocturnal Player** is a standalone desktop music player built with Electron featuring an ULTRAKILL Nocturnal-inspired theme, a Hyprland-style tiling & floating window manager, multi-mode audio visualizers (including a stereo XY Oscilloscope Music vectorscope), YouTube Music import with synced timed lyrics, and live Discord Rich Presence (it's very buggy please just turn it off at this point).

## Features
- **Up to 6 Playlists**: Manage up to 6 independent playlists with custom names, custom per-track or fallback playlist cover art, and persistent state.
- **Audio & YouTube Music Import**:
  - Import entire folders of local audio (`MP3`, `WAV`, `OGG`, `OPUS`, `M4A`, `WEBM`).
  - Import individual tracks or full playlists directly from **YouTube Music** URLs or search queries.
- **Multi-Mode Audio Visualizers**:
  - **Wave** (Time-domain waveform)
    
    <img width="308" height="173" alt="image" src="https://github.com/user-attachments/assets/a3466dae-a76d-4954-952f-c032c814e0f6" />

  - **Bar** (Logarithmic frequency spectrum with peak hold)
    
    <img width="302" height="170" alt="image" src="https://github.com/user-attachments/assets/d308bc41-99da-4b03-8b62-c3da66fc416a" />

  - **Circle** (Radial spectrum + bass pulse ring)
    
    <img width="301" height="171" alt="image" src="https://github.com/user-attachments/assets/dc469e8b-b4c4-449c-b1ed-1db06d9d6498" />

  - **XY Scope** (True stereo Left/Right channel Lissajous vectorscope for oscilloscope music)
    
    <img width="306" height="175" alt="image" src="https://github.com/user-attachments/assets/9507ad01-1627-4a04-bfbc-a29052b85810" />

  - **Tux** (He groovin)
    
    <img width="250" height="177" alt="Screenshot 2026-11-02 203340" src="https://github.com/user-attachments/assets/f1abf974-bef1-45dd-88e7-517494c0321f" />


  - Run any combination simultaneously in **Split** or **Overlay** view (please don't turn everything on in overlay view), adjust **Amplitude Sensitivity** (`5%`–`175%`), resize vertically, float as an independent window, or fullscreen on its own.
    <img width="1917" height="932" alt="image" src="https://github.com/user-attachments/assets/ae2e5681-fd2a-41a0-b2aa-fcfe0c18ebec" />

    <img width="1917" height="933" alt="image" src="https://github.com/user-attachments/assets/b764fd2b-56f0-4605-98e4-d67a9b5fcf01" />
- **Hyprland-Style Tiling & Floating Window Manager**:
  - Drag splitters, swap tiled containers, float any panel (`Alt+LMB` to move, `Alt+RMB` or 8-direction edges to resize), hide/restore individual panels, and save up to **6 Workspace Layouts (`L1`–`L6`)** including outer window dimensions.
    
- **Shuffle Queue Reordering & Loop Modes**:
  - Visual tracklist reordering when `Shuffle: ON` is active, plus drag-and-drop (`::`) and `▲`/`▼` buttons to reorder tracks inside the shuffled queue or standard tracklist.
  - Loop modes: `Loop: OFF`, `Loop: ALL`, and `Loop: 1`.
    
- **Synced Timed Lyrics**:
  - Auto-loads local `.lrc` / `.vtt` files, fetches synced lyrics from LRCLIB, or lets you load `.lrc` files manually with click-to-seek in English, Simplified Chinese, Traditional Chinese, Korean and Japanese.

    <img width="457" height="471" alt="image" src="https://github.com/user-attachments/assets/b916c5b0-c740-4d38-a562-2d502719b1c4" />

    <img width="457" height="465" alt="image" src="https://github.com/user-attachments/assets/f57a2775-1f76-49af-a603-a844e539134e" />


- **Discord Rich Presence**:
  - Live Discord status updates with automatic cover art upload and an On/Off toggle in Settings.
    
- **Ignore the mystery button**:
  - Ignore the mystery button.

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


## Credit where Credit is due
Thank you to to ULTRAWIKI (https://ultrakill.wiki.gg/) for the container sprites, the default music icon, and the settings icon and to the spriter's resource for the background image (the scrolling one) and to Hakita and New Blood Interactive (https://newblood.games/) for making ULTRAKILL

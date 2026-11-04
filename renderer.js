// Nocturnal player — Renderer Logic
// Supports:
// - Up to 6 Playlists
// - Folder Import, Audio File Import (OGG / WAV / MP3), and YT Music Import
// - Timed Lyrics Section (auto-synced LRC/VTT + LRCLIB lookup + manual .LRC import + click-to-seek)
// - Japanese font support via zpix.ttf + VCR OSD Mono
// - Multi-Visualizer: Wave, Bar, and Circle visualizers (enable any combination simultaneously in Split or Overlay mode)
// - Hyprland-style Window Manager: Move/Swap tiled containers, drag splitters, or float & resize containers in 8 directions (plus Alt+LMB move / Alt+RMB resize)
// - Default Nocturnal cover art (180px-soundtrack_(nocturnal_style).png) + custom cover upload
// - Shuffle mode + Loop mode (Off / Loop All / Loop 1)
// - Discord Rich Presence live activity updates
// - Desktop & Start Menu shortcut creation

const MAX_PLAYLISTS = 6;
const MAX_LAYOUTS = 6;
const DEFAULT_COVER_URL = 'assets/180px-soundtrack_(nocturnal_style).png';
const ALLOWED_AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.opus', '.m4a', '.webm'];
const ALLOWED_IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
const ALL_PANE_IDS = ['pane-sidebar', 'pane-player', 'pane-tracklist', 'pane-lyrics'];
const PANE_DISPLAY_NAMES = {
  'pane-sidebar': 'Playlists & Import',
  'pane-player': 'Now Playing',
  'pane-tracklist': 'Tracklist',
  'pane-lyrics': 'Timed Lyrics',
  visualizer: 'Visualizer'
};

function getDefaultLayout() {
  return {
    slotOrder: ['pane-sidebar', 'pane-player', 'pane-tracklist', 'pane-lyrics'],
    leftColWidth: 255,
    topRowHeight: 222,
    bottomLeftRatio: 0.56,
    fullscreenPane: null,
    floating: {}, // paneId -> { x, y, w, h, z }
    hiddenPanes: {}, // paneId -> boolean
    windowBounds: null // null | { width, height }
  };
}

function getDefaultVisualizers() {
  return {
    wave: true,
    bar: false,
    circle: false,
    xy: false,
    tux: false,
    layout: 'split', // 'split' | 'overlay'
    height: 52,
    sensitivity: 0.7, // 0.05 .. 1.75
    floating: null, // null | { x, y, w, h }
    fullscreen: false,
    hidden: false
  };
}

function sanitizeVisualizers(raw) {
  const def = getDefaultVisualizers();
  if (!raw || typeof raw !== 'object') return def;
  const vis = {
    wave: Boolean(raw.wave),
    bar: Boolean(raw.bar),
    circle: Boolean(raw.circle),
    xy: Boolean(raw.xy),
    tux: Boolean(raw.tux),
    layout: raw.layout === 'overlay' ? 'overlay' : 'split',
    height: typeof raw.height === 'number' ? Math.max(34, Math.min(800, Math.round(raw.height))) : def.height,
    sensitivity:
      typeof raw.sensitivity === 'number'
        ? Math.max(0.05, Math.min(1.75, Number(raw.sensitivity.toFixed(2))))
        : def.sensitivity,
    floating:
      raw.floating && typeof raw.floating === 'object'
        ? {
            x: Number(raw.floating.x) || 20,
            y: Number(raw.floating.y) || 20,
            w: Math.max(180, Number(raw.floating.w) || 320),
            h: Math.max(90, Number(raw.floating.h) || 160)
          }
        : null,
    fullscreen: Boolean(raw.fullscreen),
    hidden: Boolean(raw.hidden)
  };
  if (!vis.wave && !vis.bar && !vis.circle && !vis.xy && !vis.tux) {
    vis.wave = true;
  }
  return vis;
}

function sanitizeLayout(raw) {
  const def = getDefaultLayout();
  if (!raw || typeof raw !== 'object') return def;
  const validOrder =
    Array.isArray(raw.slotOrder) &&
    raw.slotOrder.length === 4 &&
    ALL_PANE_IDS.every((id) => raw.slotOrder.includes(id));

  const hiddenPanes = {};
  if (raw.hiddenPanes && typeof raw.hiddenPanes === 'object') {
    ALL_PANE_IDS.forEach((id) => {
      if (raw.hiddenPanes[id]) hiddenPanes[id] = true;
    });
  }

  let windowBounds = null;
  if (
    raw.windowBounds &&
    typeof raw.windowBounds === 'object' &&
    typeof raw.windowBounds.width === 'number' &&
    typeof raw.windowBounds.height === 'number'
  ) {
    windowBounds = {
      width: Math.max(880, Math.round(raw.windowBounds.width)),
      height: Math.max(600, Math.round(raw.windowBounds.height))
    };
  }

  return {
    slotOrder: validOrder ? [...raw.slotOrder] : def.slotOrder,
    leftColWidth:
      typeof raw.leftColWidth === 'number'
        ? Math.max(145, Math.min(3000, Math.round(raw.leftColWidth)))
        : def.leftColWidth,
    topRowHeight:
      typeof raw.topRowHeight === 'number'
        ? Math.max(130, Math.min(3000, Math.round(raw.topRowHeight)))
        : def.topRowHeight,
    bottomLeftRatio:
      typeof raw.bottomLeftRatio === 'number'
        ? Math.max(0.1, Math.min(0.9, raw.bottomLeftRatio))
        : def.bottomLeftRatio,
    fullscreenPane:
      typeof raw.fullscreenPane === 'string' && ALL_PANE_IDS.includes(raw.fullscreenPane)
        ? raw.fullscreenPane
        : null,
    floating:
      raw.floating && typeof raw.floating === 'object'
        ? JSON.parse(JSON.stringify(raw.floating))
        : {},
    hiddenPanes,
    windowBounds
  };
}

const state = {
  playlists: Array.from({ length: MAX_PLAYLISTS }, (_, idx) => ({
    id: idx,
    name: `Playlist ${idx + 1}`,
    coverUrl: null,
    tracks: []
  })),
  activePlaylistIndex: 0,
  playingPlaylistIndex: 0,
  currentTrackIndex: -1,
  shuffle: false,
  loopMode: 'off', // 'off' | 'all' | 'one'
  visualizers: getDefaultVisualizers(),
  layout: getDefaultLayout(),
  activeLayoutSlot: 0,
  savedLayouts: Array.from({ length: MAX_LAYOUTS }, () => null),
  discordEnabled: true,
  unstyledMode: false,
  shuffleOrder: [],
  shuffleCursor: -1,
  theme: {
    active: 'default',
    custom: null
  },
  plugins: {
    enabled: {
      'matrix-rain': true,
      'rainbow-spectrum': true,
      'bass-booster': true,
      'track-toast': true
    }
  }
};

// DOM Elements
const discordStatusBadge = document.getElementById('discord-status-badge');
const btnOpenSettings = document.getElementById('btn-open-settings');
const settingsDialog = document.getElementById('settings-dialog');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnOpenExtensions = document.getElementById('btn-open-extensions');
const extensionsModal = document.getElementById('extensions-modal');
const btnCloseExtensions = document.getElementById('btn-close-extensions');
const tabBtnThemes = document.getElementById('tab-btn-themes');
const tabBtnPlugins = document.getElementById('tab-btn-plugins');
const tabThemes = document.getElementById('tab-themes');
const tabPlugins = document.getElementById('tab-plugins');
const themePresetSelect = document.getElementById('theme-preset-select');
const themeContainerStyleSelect = document.getElementById('theme-container-style-select');
const sliderContainerOpacity = document.getElementById('slider-container-opacity');
const valContainerOpacity = document.getElementById('val-container-opacity');
const btnUploadContainerFrame = document.getElementById('btn-upload-container-frame');
const containerFrameFileInput = document.getElementById('container-frame-file-input');
const themeBgStyleSelect = document.getElementById('theme-bg-style-select');
const sliderBgOpacity = document.getElementById('slider-bg-opacity');
const valBgOpacity = document.getElementById('val-bg-opacity');
const themeBgSpeedSelect = document.getElementById('theme-bg-speed-select');
const btnUploadBgImage = document.getElementById('btn-upload-bg-image');
const bgImageFileInput = document.getElementById('bg-image-file-input');
const pickerBgDeep = document.getElementById('picker-bg-deep');
const pickerBgSurface = document.getElementById('picker-bg-surface');
const pickerTextPrimary = document.getElementById('picker-text-primary');
const pickerAccent = document.getElementById('picker-accent');
const pickerWaveform = document.getElementById('picker-waveform');
const pickerGlow = document.getElementById('picker-glow');
const btnSaveCustomTheme = document.getElementById('btn-save-custom-theme');
const btnExportTheme = document.getElementById('btn-export-theme');
const btnImportTheme = document.getElementById('btn-import-theme');
const themeFileInput = document.getElementById('theme-file-input');
const btnOpenThemesFolder = document.getElementById('btn-open-themes-folder');
const btnResetTheme = document.getElementById('btn-reset-theme');
const pluginsListContainer = document.getElementById('plugins-list-container');
const btnOpenPluginsFolder = document.getElementById('btn-open-plugins-folder');
const btnReloadPlugins = document.getElementById('btn-reload-plugins');
const toastContainer = document.getElementById('nocturnal-toast-container');
const pluginVisToggles = document.getElementById('plugin-vis-toggles');
const pluginPlaybackButtons = document.getElementById('plugin-playback-buttons');
const btnToggleDiscordRpc = document.getElementById('btn-toggle-discord-rpc');
const btnToggleUnstyled = document.getElementById('btn-toggle-unstyled');
const btnMysteryJumpscare = document.getElementById('btn-mystery-jumpscare');
const foxyJumpscareOverlay = document.getElementById('foxy-jumpscare-overlay');
const foxyJumpscareImg = document.getElementById('foxy-jumpscare-img');
const jumpscareAudio = document.getElementById('jumpscare-audio');
const playlistSlotsEl = document.getElementById('playlist-slots');
const btnRenamePlaylist = document.getElementById('btn-rename-playlist');
const btnClearPlaylist = document.getElementById('btn-clear-playlist');
const btnImportFolder = document.getElementById('btn-import-folder');
const btnImportYtm = document.getElementById('btn-import-ytm');
const btnAddFiles = document.getElementById('btn-add-files');
const btnSetPlaylistCover = document.getElementById('btn-set-playlist-cover');
const btnCreateShortcuts = document.getElementById('btn-create-shortcuts');

const btnSaveLayout = document.getElementById('btn-save-layout');
const btnHyprShowAll = document.getElementById('btn-hypr-show-all');
const btnHyprTileAll = document.getElementById('btn-hypr-tile-all');
const btnHyprFloatAll = document.getElementById('btn-hypr-float-all');
const btnHyprReset = document.getElementById('btn-hypr-reset');
const btnAppFullscreen = document.getElementById('btn-app-fullscreen');
const hyprWorkspace = document.getElementById('hypr-workspace');
const tileColLeft = document.getElementById('tile-col-left');
const tileColRight = document.getElementById('tile-col-right');
const tileRowTop = document.getElementById('tile-row-top');
const tileRowBottom = document.getElementById('tile-row-bottom');
const tileSlot0 = document.getElementById('tile-slot-0');
const tileSlot1 = document.getElementById('tile-slot-1');
const tileSlot2 = document.getElementById('tile-slot-2');
const tileSlot3 = document.getElementById('tile-slot-3');
const gutterCol = document.getElementById('gutter-col');
const gutterRowRight = document.getElementById('gutter-row-right');
const gutterBottomSplit = document.getElementById('gutter-bottom-split');

const fallbackFolderInput = document.getElementById('fallback-folder-input');
const fallbackFilesInput = document.getElementById('fallback-files-input');
const fallbackCoverInput = document.getElementById('fallback-cover-input');
const fallbackLrcInput = document.getElementById('fallback-lrc-input');

const coverArtBox = document.getElementById('cover-art-box');
const coverArtImg = document.getElementById('cover-art-img');
const btnSetTrackCover = document.getElementById('btn-set-track-cover');
const btnClearTrackCover = document.getElementById('btn-clear-track-cover');

const nowPlayingPlaylistEl = document.getElementById('now-playing-playlist');
const nowPlayingTitleEl = document.getElementById('now-playing-title');
const nowPlayingFormatEl = document.getElementById('now-playing-format');

const btnVisWave = document.getElementById('btn-vis-wave');
const btnVisBar = document.getElementById('btn-vis-bar');
const btnVisCircle = document.getElementById('btn-vis-circle');
const btnVisXy = document.getElementById('btn-vis-xy');
const btnVisTux = document.getElementById('btn-vis-tux');
const btnVisLayout = document.getElementById('btn-vis-layout');
const visSensitivityBar = document.getElementById('vis-sensitivity-bar');
const visSensitivityVal = document.getElementById('vis-sensitivity-val');
const btnVisFloat = document.getElementById('btn-vis-float');
const btnVisFullscreen = document.getElementById('btn-vis-fullscreen');
const btnVisHide = document.getElementById('btn-vis-hide');
const visualizerContainer = document.getElementById('visualizer-container');
const visualizerHeader = document.getElementById('visualizer-header');
const visualizerCanvasWrap = document.getElementById('visualizer-canvas-wrap');
const visualizerResizeBar = document.getElementById('visualizer-resize-bar');
const waveCanvas = document.getElementById('wave-canvas');
const canvasCtx = waveCanvas.getContext('2d');

const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const seekBar = document.getElementById('seek-bar');
const volumeBar = document.getElementById('volume-bar');

const btnPrev = document.getElementById('btn-prev');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnStop = document.getElementById('btn-stop');
const btnNext = document.getElementById('btn-next');
const btnShuffle = document.getElementById('btn-shuffle');
const btnLoop = document.getElementById('btn-loop');

const activePlaylistHeading = document.getElementById('active-playlist-heading');
const statusMessageEl = document.getElementById('status-message');
const tracklistBody = document.getElementById('tracklist-body');

const lyricsSyncBadge = document.getElementById('lyrics-sync-badge');
const btnFetchLyrics = document.getElementById('btn-fetch-lyrics');
const btnLoadLrc = document.getElementById('btn-load-lrc');
const btnClearLyrics = document.getElementById('btn-clear-lyrics');
const lyricsContainer = document.getElementById('lyrics-container');

const renameDialog = document.getElementById('rename-dialog');
const renameForm = document.getElementById('rename-form');
const renameInput = document.getElementById('rename-input');
const renameCancel = document.getElementById('rename-cancel');

const ytmDialog = document.getElementById('ytm-dialog');
const ytmForm = document.getElementById('ytm-form');
const ytmUrlInput = document.getElementById('ytm-url-input');
const ytmFormatSelect = document.getElementById('ytm-format-select');
const ytmCoverCheckbox = document.getElementById('ytm-cover-checkbox');
const ytmProgressBox = document.getElementById('ytm-progress-box');
const ytmProgressText = document.getElementById('ytm-progress-text');
const ytmCancel = document.getElementById('ytm-cancel');
const ytmSubmit = document.getElementById('ytm-submit');

const audioEl = document.getElementById('audio-element');

// Web Audio API Visualizer state
let audioCtx = null;
let analyser = null;
let analyserLeft = null;
let analyserRight = null;
let channelSplitter = null;
let sourceNode = null;
let timeDataArray = null;
let freqDataArray = null;
let leftFloatArray = null;
let rightFloatArray = null;
let animationId = null;
const barPeaks = new Float32Array(64);

// Active lyric tracking
let activeLyricLineIndex = -1;
let renderedLyricsTrackRef = null;

// Pending cover art target for browser fallback file input
let pendingCoverTarget = null;

// Floating z-index counter
let topFloatingZ = 30;

// Prevent Alt key from triggering any browser menu bar behavior + support Alt+F / F11 / Escape fullscreen shortcuts
window.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') {
    e.preventDefault();
    return;
  }
  if (e.altKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    const activeWin = document.querySelector('.hypr-window.active-window') || document.getElementById('pane-player');
    if (activeWin && activeWin.dataset.paneId) {
      togglePaneFullscreen(activeWin.dataset.paneId);
    }
    return;
  }
  if (e.key === 'Escape') {
    if (foxyJumpscareOverlay && !foxyJumpscareOverlay.hidden) {
      e.preventDefault();
      hideFoxyJumpscare();
      return;
    }
    if (state.visualizers.fullscreen) {
      e.preventDefault();
      toggleVisualizerFullscreen();
      return;
    }
    if (state.layout.fullscreenPane) {
      e.preventDefault();
      togglePaneFullscreen(state.layout.fullscreenPane);
      return;
    }
  }
  if (e.key === 'F11') {
    e.preventDefault();
    if (window.musicAPI && window.musicAPI.toggleAppFullscreen) {
      window.musicAPI.toggleAppFullscreen();
    }
  }
});

// Prevent default context menu when using Alt+RMB to resize windows
window.addEventListener('contextmenu', (e) => {
  if (e.altKey) {
    e.preventDefault();
  }
});

function setStatus(msg) {
  statusMessageEl.textContent = msg;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function getActivePlaylist() {
  return state.playlists[state.activePlaylistIndex];
}

function getPlayingPlaylist() {
  return state.playlists[state.playingPlaylistIndex];
}

function getCurrentTrack() {
  const pl = getPlayingPlaylist();
  if (!pl || state.currentTrackIndex < 0 || state.currentTrackIndex >= pl.tracks.length) {
    return null;
  }
  return pl.tracks[state.currentTrackIndex];
}

// Discord Rich Presence updater
function updateDiscordToggleUI() {
  if (btnToggleDiscordRpc) {
    btnToggleDiscordRpc.setAttribute('aria-pressed', String(state.discordEnabled));
    btnToggleDiscordRpc.textContent = `Discord RPC: ${state.discordEnabled ? 'ON' : 'OFF'}`;
  }
  if (!state.discordEnabled && discordStatusBadge) {
    discordStatusBadge.textContent = 'DISCORD RPC: DISABLED';
    discordStatusBadge.classList.remove('connected');
  }
}

function updateUnstyledModeUI() {
  document.body.classList.toggle('unstyled-mode', Boolean(state.unstyledMode));
  if (btnToggleUnstyled) {
    btnToggleUnstyled.setAttribute('aria-pressed', String(state.unstyledMode));
    btnToggleUnstyled.textContent = `Unstyled Mode: ${state.unstyledMode ? 'ON' : 'OFF'}`;
  }
}

let jumpscareTimer = null;

function hideFoxyJumpscare() {
  if (jumpscareTimer) {
    clearTimeout(jumpscareTimer);
    jumpscareTimer = null;
  }
  if (foxyJumpscareOverlay) {
    foxyJumpscareOverlay.hidden = true;
  }
  if (jumpscareAudio) {
    jumpscareAudio.pause();
    jumpscareAudio.currentTime = 0;
  }
}

function triggerFoxyJumpscare() {
  if (settingsDialog && settingsDialog.open) {
    settingsDialog.close();
  }
  if (!foxyJumpscareOverlay) return;

  if (foxyJumpscareImg) {
    foxyJumpscareImg.src = '';
    foxyJumpscareImg.src = `assets/foxy_jumpscare.gif?t=${Date.now()}`;
  }

  foxyJumpscareOverlay.hidden = false;

  if (jumpscareAudio) {
    jumpscareAudio.currentTime = 0;
    jumpscareAudio.volume = 1.0;
    jumpscareAudio.play().catch(() => {});
  }

  if (jumpscareTimer) clearTimeout(jumpscareTimer);
  jumpscareTimer = setTimeout(() => {
    hideFoxyJumpscare();
  }, 1250);
}

function syncDiscordPresence() {
  if (!state.discordEnabled) return;
  if (!window.musicAPI || !window.musicAPI.updateDiscordPresence) return;

  const track = getCurrentTrack();
  const pl = getPlayingPlaylist();
  if (!track || !pl) {
    const activePl = getActivePlaylist();
    window.musicAPI.updateDiscordPresence({
      details: 'Nocturnal player',
      state: 'Idle',
      playing: false,
      coverUrl: resolveCoverArtForTrack(activePl, null)
    });
    return;
  }

  const isPlaying = !audioEl.paused;
  const modeTag =
    state.loopMode === 'one'
      ? 'Loop 1'
      : state.loopMode === 'all'
      ? 'Loop All'
      : state.shuffle
      ? 'Shuffle'
      : 'Standard';

  window.musicAPI.updateDiscordPresence({
    details: `${isPlaying ? '▶' : '⏸'} ${track.name}`,
    state: `${pl.name} • [${track.format}] • ${modeTag}`,
    playing: isPlaying,
    currentTime: audioEl.currentTime || 0,
    duration: audioEl.duration || 0,
    coverUrl: resolveCoverArtForTrack(pl, track)
  });
}

if (window.musicAPI && window.musicAPI.onDiscordStatus) {
  window.musicAPI.onDiscordStatus((status) => {
    if (!state.discordEnabled) {
      discordStatusBadge.textContent = 'DISCORD RPC: DISABLED';
      discordStatusBadge.classList.remove('connected');
      return;
    }
    if (status && status.connected) {
      discordStatusBadge.textContent = 'DISCORD RPC: CONNECTED';
      discordStatusBadge.classList.add('connected');
    } else {
      discordStatusBadge.textContent = `DISCORD RPC: ${
        status && status.statusText ? status.statusText.toUpperCase() : 'STANDBY'
      }`;
      discordStatusBadge.classList.remove('connected');
    }
  });
}

if (discordStatusBadge) {
  discordStatusBadge.style.cursor = 'pointer';
  discordStatusBadge.addEventListener('click', () => {
    if (!state.discordEnabled) {
      setStatus('Enable Discord RPC first to reconnect.');
      return;
    }
    if (window.musicAPI && window.musicAPI.reconnectDiscord) {
      setStatus('Reconnecting to Discord Rich Presence...');
      window.musicAPI.reconnectDiscord();
    }
  });
}

if (btnOpenSettings && settingsDialog) {
  btnOpenSettings.addEventListener('click', () => {
    settingsDialog.showModal();
  });
}

if (btnCloseSettings && settingsDialog) {
  btnCloseSettings.addEventListener('click', () => {
    settingsDialog.close();
  });
}

if (settingsDialog) {
  settingsDialog.addEventListener('click', (e) => {
    if (e.target === settingsDialog) {
      settingsDialog.close();
    }
  });
}

if (btnToggleDiscordRpc) {
  btnToggleDiscordRpc.addEventListener('click', async () => {
    state.discordEnabled = !state.discordEnabled;
    updateDiscordToggleUI();
    if (window.musicAPI && typeof window.musicAPI.setDiscordEnabled === 'function') {
      await window.musicAPI.setDiscordEnabled(state.discordEnabled);
    }
    if (state.discordEnabled) {
      syncDiscordPresence();
      setStatus('Discord Rich Presence enabled.');
    } else {
      setStatus('Discord Rich Presence disabled.');
    }
    saveAppState();
  });
}

if (btnToggleUnstyled) {
  btnToggleUnstyled.addEventListener('click', () => {
    state.unstyledMode = !state.unstyledMode;
    updateUnstyledModeUI();
    renderVisualizerFrame();
    setStatus(
      state.unstyledMode
        ? 'Unstyled Mode enabled — displaying raw unstyled HTML look.'
        : 'Restored Nocturnal visual theme.'
    );
    saveAppState();
  });
}

if (btnMysteryJumpscare) {
  btnMysteryJumpscare.addEventListener('click', () => {
    triggerFoxyJumpscare();
  });
}

if (foxyJumpscareOverlay) {
  foxyJumpscareOverlay.addEventListener('click', () => {
    hideFoxyJumpscare();
  });
}

// Track whether the user switched to a specific layout slot to edit it
let userSelectedSlotToEdit = false;

function captureCurrentLayoutSnapshot() {
  state.layout.windowBounds = {
    width: Math.max(880, window.outerWidth || 1120),
    height: Math.max(600, window.outerHeight || 720)
  };
  return {
    layout: sanitizeLayout(state.layout),
    visualizers: sanitizeVisualizers(state.visualizers)
  };
}

// Persistence via Electron main process or localStorage fallback
async function saveAppState() {
  // Only auto-overwrite the active slot if the user explicitly switched to that slot or if it has no snapshot yet
  if (
    state.activeLayoutSlot >= 0 &&
    state.activeLayoutSlot < MAX_LAYOUTS &&
    (userSelectedSlotToEdit || !state.savedLayouts[state.activeLayoutSlot])
  ) {
    state.savedLayouts[state.activeLayoutSlot] = captureCurrentLayoutSnapshot();
  }

  const serializable = {
    activePlaylistIndex: state.activePlaylistIndex,
    shuffle: state.shuffle,
    loopMode: state.loopMode,
    discordEnabled: state.discordEnabled,
    unstyledMode: state.unstyledMode,
    visualizers: state.visualizers,
    layout: state.layout,
    activeLayoutSlot: state.activeLayoutSlot,
    savedLayouts: state.savedLayouts,
    theme: state.theme,
    plugins: state.plugins,
    playlists: state.playlists.map((pl) => ({
      id: pl.id,
      name: pl.name,
      coverUrl: pl.coverUrl && !pl.coverUrl.startsWith('blob:') ? pl.coverUrl : null,
      shuffleOrder: Array.isArray(pl.shuffleOrder) ? pl.shuffleOrder : null,
      tracks: pl.tracks
        .filter((t) => t.url && !t.url.startsWith('blob:'))
        .map((t) => ({
          name: t.name,
          fileName: t.fileName,
          format: t.format,
          path: t.path || null,
          url: t.url,
          coverUrl: t.coverUrl && !t.coverUrl.startsWith('blob:') ? t.coverUrl : null,
          lyrics: t.lyrics || null
        }))
    }))
  };

  if (window.musicAPI && window.musicAPI.saveState) {
    await window.musicAPI.saveState(serializable);
  } else {
    try {
      localStorage.setItem('simple_music_player_state', JSON.stringify(serializable));
    } catch (_) {
      // Ignore storage quota issues
    }
  }
}

async function loadAppState() {
  let saved = null;
  if (window.musicAPI && window.musicAPI.loadState) {
    saved = await window.musicAPI.loadState();
  } else {
    try {
      const raw = localStorage.getItem('simple_music_player_state');
      if (raw) saved = JSON.parse(raw);
    } catch (_) {
      saved = null;
    }
  }

  if (saved && Array.isArray(saved.playlists)) {
    for (let i = 0; i < MAX_PLAYLISTS; i++) {
      const src = saved.playlists[i];
      if (src) {
        const tracks = Array.isArray(src.tracks) ? src.tracks : [];
        state.playlists[i] = {
          id: i,
          name: typeof src.name === 'string' && src.name.trim() ? src.name.trim() : `Playlist ${i + 1}`,
          coverUrl: src.coverUrl || null,
          tracks,
          shuffleOrder: isValidPermutation(src.shuffleOrder, tracks.length) ? src.shuffleOrder : []
        };
      }
    }
    if (
      typeof saved.activePlaylistIndex === 'number' &&
      saved.activePlaylistIndex >= 0 &&
      saved.activePlaylistIndex < MAX_PLAYLISTS
    ) {
      state.activePlaylistIndex = saved.activePlaylistIndex;
      state.playingPlaylistIndex = saved.activePlaylistIndex;
    }
    if (typeof saved.shuffle === 'boolean') {
      state.shuffle = saved.shuffle;
      updateShuffleButton();
    }
    if (['off', 'all', 'one'].includes(saved.loopMode)) {
      state.loopMode = saved.loopMode;
      updateLoopButton();
    }
    if (typeof saved.discordEnabled === 'boolean') {
      state.discordEnabled = saved.discordEnabled;
    }
    if (typeof saved.unstyledMode === 'boolean') {
      state.unstyledMode = saved.unstyledMode;
    }
    updateDiscordToggleUI();
    updateUnstyledModeUI();
    if (window.musicAPI && typeof window.musicAPI.setDiscordEnabled === 'function') {
      window.musicAPI.setDiscordEnabled(state.discordEnabled);
    }
    if (saved.visualizers && typeof saved.visualizers === 'object') {
      state.visualizers = sanitizeVisualizers(saved.visualizers);
      updateVisualizerButtons();
    }
    if (saved.layout && typeof saved.layout === 'object') {
      state.layout = sanitizeLayout(saved.layout);
    }
    if (
      typeof saved.activeLayoutSlot === 'number' &&
      saved.activeLayoutSlot >= 0 &&
      saved.activeLayoutSlot < MAX_LAYOUTS
    ) {
      state.activeLayoutSlot = saved.activeLayoutSlot;
    }
    if (Array.isArray(saved.savedLayouts)) {
      for (let i = 0; i < MAX_LAYOUTS; i++) {
        const slot = saved.savedLayouts[i];
        if (slot && typeof slot === 'object') {
          state.savedLayouts[i] = {
            layout: sanitizeLayout(slot.layout),
            visualizers: sanitizeVisualizers(slot.visualizers)
          };
        }
      }
    }
    if (!state.savedLayouts[state.activeLayoutSlot]) {
      state.savedLayouts[state.activeLayoutSlot] = captureCurrentLayoutSnapshot();
    }
    if (saved.theme) {
      state.theme = saved.theme;
    }
    if (saved.plugins) {
      state.plugins = saved.plugins;
    }
  }
}

// Shuffle & Loop management
function isValidPermutation(order, length) {
  if (!Array.isArray(order) || order.length !== length) return false;
  const seen = new Set(order);
  if (seen.size !== length) return false;
  for (let i = 0; i < length; i++) {
    if (!seen.has(i)) return false;
  }
  return true;
}

function ensurePlaylistShuffleOrder(pl, forceReshuffle = false, keepCurrentIndex = -1) {
  if (!pl) return [];
  const len = pl.tracks.length;
  if (len === 0) {
    pl.shuffleOrder = [];
    return pl.shuffleOrder;
  }

  if (!forceReshuffle && isValidPermutation(pl.shuffleOrder, len)) {
    return pl.shuffleOrder;
  }

  const indices = Array.from({ length: len }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  // If there are at least 2 tracks and Fisher-Yates happened to produce identity [0,1,2...], rotate/swap once so shuffle is visually distinct
  if (len > 1 && indices.every((val, idx) => val === idx)) {
    [indices[0], indices[1]] = [indices[1], indices[0]];
  }

  if (keepCurrentIndex >= 0 && indices.includes(keepCurrentIndex)) {
    const pos = indices.indexOf(keepCurrentIndex);
    [indices[0], indices[pos]] = [indices[pos], indices[0]];
  }

  pl.shuffleOrder = indices;
  return pl.shuffleOrder;
}

function rebuildShuffleOrder(playlistLength, keepCurrentIndex = -1) {
  const pl = getPlayingPlaylist();
  if (pl) {
    const order = ensurePlaylistShuffleOrder(pl, true, keepCurrentIndex);
    state.shuffleOrder = order;
    state.shuffleCursor = keepCurrentIndex >= 0 ? Math.max(0, order.indexOf(keepCurrentIndex)) : 0;
  }
}

function updateShuffleButton() {
  btnShuffle.setAttribute('aria-pressed', String(state.shuffle));
  btnShuffle.textContent = `Shuffle: ${state.shuffle ? 'ON' : 'OFF'}`;
}

function updateLoopButton() {
  const isLoopActive = state.loopMode !== 'off';
  btnLoop.setAttribute('aria-pressed', String(isLoopActive));
  if (state.loopMode === 'one') {
    btnLoop.textContent = 'Loop: 1';
  } else if (state.loopMode === 'all') {
    btnLoop.textContent = 'Loop: ALL';
  } else {
    btnLoop.textContent = 'Loop: OFF';
  }
}

// ==========================================================================
// MULTI-VISUALIZER ENGINE: WAVE + BAR + CIRCLE (SIMULTANEOUS SPLIT OR OVERLAY)
// ==========================================================================

function updateVisualizerButtons() {
  btnVisWave.setAttribute('aria-pressed', String(state.visualizers.wave));
  btnVisBar.setAttribute('aria-pressed', String(state.visualizers.bar));
  btnVisCircle.setAttribute('aria-pressed', String(state.visualizers.circle));
  if (btnVisXy) {
    btnVisXy.setAttribute('aria-pressed', String(Boolean(state.visualizers.xy)));
  }
  if (btnVisTux) {
    btnVisTux.setAttribute('aria-pressed', String(Boolean(state.visualizers.tux)));
  }
  btnVisLayout.textContent = `VIEW: ${state.visualizers.layout.toUpperCase()}`;
  const sens = typeof state.visualizers.sensitivity === 'number' ? state.visualizers.sensitivity : 0.7;
  if (visSensitivityBar) {
    visSensitivityBar.value = String(sens);
  }
  if (visSensitivityVal) {
    visSensitivityVal.textContent = `${Math.round(sens * 100)}%`;
  }
  if (btnVisFloat) {
    btnVisFloat.textContent = state.visualizers.floating ? 'DOCK' : 'FLOAT';
  }
  if (btnVisFullscreen) {
    btnVisFullscreen.textContent = state.visualizers.fullscreen ? 'EXIT FULL' : 'FULL';
  }
}

function applyVisualizerContainerState() {
  if (!visualizerContainer) return;

  const playerVisPanel = document.querySelector('.player-visualizer-panel');
  const transportPanel = document.querySelector('.transport-panel');
  const isHidden = Boolean(state.visualizers.hidden);

  if (isHidden && state.visualizers.fullscreen) {
    state.visualizers.fullscreen = false;
  }

  visualizerContainer.classList.toggle('is-hidden', isHidden);
  visualizerContainer.classList.toggle(
    'is-vis-fullscreen',
    !isHidden && Boolean(state.visualizers.fullscreen)
  );
  visualizerContainer.classList.toggle(
    'is-vis-floating',
    !isHidden && !state.visualizers.fullscreen && Boolean(state.visualizers.floating)
  );

  if (state.visualizers.fullscreen && !isHidden) {
    visualizerContainer.style.left = '';
    visualizerContainer.style.top = '';
    visualizerContainer.style.width = '';
    visualizerContainer.style.height = '';
    if (visualizerContainer.parentElement !== hyprWorkspace) {
      hyprWorkspace.appendChild(visualizerContainer);
    }
  } else if (state.visualizers.floating && !isHidden) {
    const f = state.visualizers.floating;
    visualizerContainer.style.left = `${f.x}px`;
    visualizerContainer.style.top = `${f.y}px`;
    visualizerContainer.style.width = `${f.w}px`;
    visualizerContainer.style.height = `${f.h}px`;
    if (visualizerContainer.parentElement !== hyprWorkspace) {
      hyprWorkspace.appendChild(visualizerContainer);
    }
  } else {
    visualizerContainer.style.left = '';
    visualizerContainer.style.top = '';
    visualizerContainer.style.width = '';
    visualizerContainer.style.height = '';
    visualizerCanvasWrap.style.height = `${Math.max(34, state.visualizers.height || 52)}px`;
    if (playerVisPanel && visualizerContainer.parentElement !== playerVisPanel) {
      playerVisPanel.insertBefore(visualizerContainer, transportPanel);
    }
  }

  updateVisualizerButtons();
  updateTopBarPanelAndLayoutButtons();
  if (!isHidden) {
    syncCanvasDimensions();
  }
}

function toggleVisualizerHidden() {
  state.visualizers.hidden = !state.visualizers.hidden;
  if (state.visualizers.hidden) {
    state.visualizers.fullscreen = false;
  }
  applyVisualizerContainerState();
  setStatus(
    state.visualizers.hidden
      ? 'Hidden Visualizer (click "Visualizer" under PANELS in the top bar to show again).'
      : 'Restored Visualizer.'
  );
  saveAppState();
}

function toggleVisualizerFullscreen() {
  if (state.visualizers.hidden) {
    state.visualizers.hidden = false;
  }
  state.visualizers.fullscreen = !state.visualizers.fullscreen;
  applyVisualizerContainerState();
  setStatus(
    state.visualizers.fullscreen
      ? 'Fullscreened Visualizer (press Esc, double-click canvas, or click EXIT FULL to restore).'
      : 'Restored Visualizer size.'
  );
}

function toggleVisualizerFloating() {
  if (state.visualizers.hidden) {
    state.visualizers.hidden = false;
  }
  if (state.visualizers.fullscreen) {
    state.visualizers.fullscreen = false;
  }
  if (state.visualizers.floating) {
    state.visualizers.floating = null;
    setStatus('Docked Visualizer back into Now Playing panel.');
  } else {
    const wsRect = hyprWorkspace.getBoundingClientRect();
    const rect = visualizerContainer.getBoundingClientRect();
    state.visualizers.floating = {
      x: Math.max(20, Math.min(wsRect.width - 340, Math.round(rect.left - wsRect.left + 16))),
      y: Math.max(20, Math.min(wsRect.height - 200, Math.round(rect.top - wsRect.top + 16))),
      w: Math.max(320, Math.round(rect.width)),
      h: Math.max(150, Math.round(rect.height + 60))
    };
    setStatus('Floated Visualizer — drag header to move, drag edges/corners to resize.');
  }
  applyVisualizerContainerState();
  saveAppState();
}

function toggleVisualizerType(type) {
  state.visualizers[type] = !state.visualizers[type];
  // Ensure at least one visualizer stays enabled
  if (
    !state.visualizers.wave &&
    !state.visualizers.bar &&
    !state.visualizers.circle &&
    !state.visualizers.xy &&
    !state.visualizers.tux
  ) {
    state.visualizers[type] = true;
    setStatus('At least one visualizer must remain enabled.');
    return;
  }
  updateVisualizerButtons();
  renderVisualizerFrame();
  saveAppState();
}

btnVisWave.addEventListener('click', () => toggleVisualizerType('wave'));
btnVisBar.addEventListener('click', () => toggleVisualizerType('bar'));
btnVisCircle.addEventListener('click', () => toggleVisualizerType('circle'));
if (btnVisXy) {
  btnVisXy.addEventListener('click', () => toggleVisualizerType('xy'));
}
if (btnVisTux) {
  btnVisTux.addEventListener('click', () => toggleVisualizerType('tux'));
}

btnVisLayout.addEventListener('click', () => {
  state.visualizers.layout = state.visualizers.layout === 'split' ? 'overlay' : 'split';
  updateVisualizerButtons();
  renderVisualizerFrame();
  saveAppState();
});

if (btnVisFullscreen) {
  btnVisFullscreen.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleVisualizerFullscreen();
  });
}

if (btnVisFloat) {
  btnVisFloat.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleVisualizerFloating();
  });
}

if (btnVisHide) {
  btnVisHide.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleVisualizerHidden();
  });
}

if (visSensitivityBar) {
  visSensitivityBar.addEventListener('mousedown', (e) => e.stopPropagation());
  visSensitivityBar.addEventListener('dblclick', (e) => e.stopPropagation());
  visSensitivityBar.addEventListener('input', () => {
    const val = Math.max(0.05, Math.min(1.75, parseFloat(visSensitivityBar.value) || 0.7));
    state.visualizers.sensitivity = val;
    if (visSensitivityVal) {
      visSensitivityVal.textContent = `${Math.round(val * 100)}%`;
    }
    renderVisualizerFrame();
  });
  visSensitivityBar.addEventListener('change', () => {
    saveAppState();
  });
}

waveCanvas.addEventListener('dblclick', () => {
  toggleVisualizerFullscreen();
});

// Docked vertical resize bar on the visualizer
if (visualizerResizeBar) {
  visualizerResizeBar.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = state.visualizers.height || 52;

    const onMove = (ev) => {
      state.visualizers.height = Math.max(34, Math.min(450, startH + (ev.clientY - startY)));
      visualizerCanvasWrap.style.height = `${state.visualizers.height}px`;
      syncCanvasDimensions();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveAppState();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

// Drag & 8-direction resize support when Visualizer is floating on its own
if (visualizerContainer && visualizerHeader) {
  const dirs = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
  dirs.forEach((dir) => {
    const h = document.createElement('div');
    h.className = `hypr-resize-handle hypr-resize-${dir}`;
    visualizerContainer.appendChild(h);

    h.addEventListener('mousedown', (e) => {
      if (!state.visualizers.floating) return;
      e.preventDefault();
      e.stopPropagation();
      const cfg = state.visualizers.floating;
      const orig = { x: cfg.x, y: cfg.y, w: cfg.w, h: cfg.h };
      const startX = e.clientX;
      const startY = e.clientY;

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (dir.includes('e')) cfg.w = Math.max(200, orig.w + dx);
        if (dir.includes('s')) cfg.h = Math.max(95, orig.h + dy);
        if (dir.includes('w')) {
          const nw = Math.max(200, orig.w - dx);
          cfg.x = orig.x + (orig.w - nw);
          cfg.w = nw;
        }
        if (dir.includes('n')) {
          const nh = Math.max(95, orig.h - dy);
          cfg.y = orig.y + (orig.h - nh);
          cfg.h = nh;
        }
        applyVisualizerContainerState();
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        saveAppState();
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });

  visualizerHeader.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, label, .vis-sensitivity-control')) return;
    toggleVisualizerFullscreen();
  });

  visualizerHeader.addEventListener('mousedown', (e) => {
    if (!state.visualizers.floating || state.visualizers.fullscreen) return;
    if (e.button !== 0 || e.target.closest('button, input, label, .vis-sensitivity-control')) return;
    e.preventDefault();
    e.stopPropagation();
    const cfg = state.visualizers.floating;
    const origX = cfg.x;
    const origY = cfg.y;
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev) => {
      const wsRect = hyprWorkspace.getBoundingClientRect();
      cfg.x = Math.max(0, Math.min(wsRect.width - 80, origX + (ev.clientX - startX)));
      cfg.y = Math.max(0, Math.min(wsRect.height - 40, origY + (ev.clientY - startY)));
      applyVisualizerContainerState();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveAppState();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}

function ensureAudioAnalyser() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();

  try {
    bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = 'lowshelf';
    bassFilter.frequency.value = 85;
    bassFilter.gain.value = isBassBoosted ? 9.0 : 0.0;
  } catch (_) {
    bassFilter = null;
  }

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;

  analyserLeft = audioCtx.createAnalyser();
  analyserLeft.fftSize = 2048;
  analyserLeft.smoothingTimeConstant = 0;

  analyserRight = audioCtx.createAnalyser();
  analyserRight.fftSize = 2048;
  analyserRight.smoothingTimeConstant = 0;

  channelSplitter = audioCtx.createChannelSplitter(2);

  sourceNode = audioCtx.createMediaElementSource(audioEl);
  if (bassFilter) {
    sourceNode.connect(bassFilter);
    bassFilter.connect(analyser);
    bassFilter.connect(channelSplitter);
  } else {
    sourceNode.connect(analyser);
    sourceNode.connect(channelSplitter);
  }
  analyser.connect(audioCtx.destination);

  channelSplitter.connect(analyserLeft, 0);
  channelSplitter.connect(analyserRight, 1);

  timeDataArray = new Uint8Array(analyser.fftSize);
  freqDataArray = new Uint8Array(analyser.frequencyBinCount);
  leftFloatArray = new Float32Array(analyserLeft.fftSize);
  rightFloatArray = new Float32Array(analyserRight.fftSize);
  startVisualizerLoop();
}

function syncCanvasDimensions() {
  const rect = visualizerCanvasWrap.getBoundingClientRect();
  const targetW = Math.max(120, Math.floor(rect.width));
  const targetH = Math.max(32, Math.floor(rect.height));
  if (waveCanvas.width !== targetW || waveCanvas.height !== targetH) {
    waveCanvas.width = targetW;
    waveCanvas.height = targetH;
    renderVisualizerFrame();
  }
}

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => syncCanvasDimensions());
  ro.observe(visualizerCanvasWrap);
}

const activeThemeColors = {
  waveformColor: '#ffffff',
  waveformGlow: 'rgba(255, 255, 255, 0.6)',
  accent: '#ffffff'
};

function drawWaveInViewport(vx, vy, vw, vh, isPaused) {
  canvasCtx.save();
  canvasCtx.beginPath();
  canvasCtx.rect(vx, vy, vw, vh);
  canvasCtx.clip();

  const cy = vy + vh / 2;
  const sens = typeof state.visualizers.sensitivity === 'number' ? state.visualizers.sensitivity : 0.7;

  // Reference center axis
  canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  canvasCtx.lineWidth = 1;
  canvasCtx.beginPath();
  canvasCtx.moveTo(vx, cy);
  canvasCtx.lineTo(vx + vw, cy);
  canvasCtx.stroke();

  if (isPaused || !timeDataArray) {
    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.48)';
    canvasCtx.lineWidth = 1.5;
    canvasCtx.beginPath();
    canvasCtx.moveTo(vx, cy);
    canvasCtx.lineTo(vx + vw, cy);
    canvasCtx.stroke();
    canvasCtx.restore();
    return;
  }

  canvasCtx.lineWidth = 2;
  canvasCtx.strokeStyle = activeThemeColors.waveformColor || '#ffffff';
  canvasCtx.shadowColor = activeThemeColors.waveformGlow || 'rgba(255, 255, 255, 0.6)';
  canvasCtx.shadowBlur = 4;
  canvasCtx.beginPath();

  const bufferLength = timeDataArray.length;
  const sliceWidth = vw / bufferLength;
  let x = vx;

  for (let i = 0; i < bufferLength; i++) {
    const dev = ((timeDataArray[i] - 128) / 128.0) * sens;
    const y = cy + dev * (vh * 0.46);
    if (i === 0) {
      canvasCtx.moveTo(x, y);
    } else {
      canvasCtx.lineTo(x, y);
    }
    x += sliceWidth;
  }

  canvasCtx.lineTo(vx + vw, cy);
  canvasCtx.stroke();
  canvasCtx.restore();
}

function drawBarInViewport(vx, vy, vw, vh, isPaused) {
  canvasCtx.save();
  canvasCtx.beginPath();
  canvasCtx.rect(vx, vy, vw, vh);
  canvasCtx.clip();

  const sens = typeof state.visualizers.sensitivity === 'number' ? state.visualizers.sensitivity : 0.7;
  const barCount = Math.min(48, Math.max(16, Math.floor(vw / 7)));
  const gap = 2;
  const totalGap = gap * (barCount - 1);
  const barWidth = Math.max(2, (vw - 8 - totalGap) / barCount);
  const startX = vx + 4;
  const bottomY = vy + vh - 4;
  const maxBarH = Math.max(10, vh - 12);

  for (let i = 0; i < barCount; i++) {
    let norm = 0;
    if (!isPaused && freqDataArray) {
      // Sample logarithmic/perceptual frequency range
      const binIndex = Math.min(
        freqDataArray.length - 1,
        Math.floor(Math.pow(i / barCount, 1.45) * (freqDataArray.length * 0.65))
      );
      norm = Math.min(1, (freqDataArray[binIndex] / 255.0) * sens);
    }

    const barH = Math.max(2, norm * maxBarH);
    if (barH > barPeaks[i]) {
      barPeaks[i] = barH;
    } else {
      barPeaks[i] = Math.max(2, barPeaks[i] - 0.85);
    }

    const bx = startX + i * (barWidth + gap);
    const by = bottomY - barH;

    // Bar body
    canvasCtx.fillStyle = isPaused ? 'rgba(255, 255, 255, 0.22)' : (activeThemeColors.accent || '#ffffff');
    canvasCtx.fillRect(bx, by, barWidth, barH);

    // Peak hold cap
    if (!isPaused) {
      const peakY = Math.max(vy + 2, bottomY - barPeaks[i] - 2);
      canvasCtx.fillStyle = '#ffffff';
      canvasCtx.fillRect(bx, peakY, barWidth, 2);
    }
  }

  canvasCtx.restore();
}

function drawCircleInViewport(vx, vy, vw, vh, isPaused) {
  canvasCtx.save();
  canvasCtx.beginPath();
  canvasCtx.rect(vx, vy, vw, vh);
  canvasCtx.clip();

  const sens = typeof state.visualizers.sensitivity === 'number' ? state.visualizers.sensitivity : 0.7;
  const cx = vx + vw / 2;
  const cy = vy + vh / 2;
  const maxRadius = Math.max(16, Math.min(vw, vh) * 0.44);
  const baseRadius = maxRadius * 0.46;
  const rayCount = 48;

  // Compute bass pulse from low frequency bins
  let bassAvg = 0;
  if (!isPaused && freqDataArray) {
    let sum = 0;
    for (let i = 0; i < 8; i++) sum += freqDataArray[i];
    bassAvg = (sum / (8 * 255)) * sens;
  }

  const dynamicBase = baseRadius * (1 + bassAvg * 0.16);

  // Inner core ring
  canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  canvasCtx.lineWidth = 1.5;
  canvasCtx.beginPath();
  canvasCtx.arc(cx, cy, dynamicBase * 0.65, 0, Math.PI * 2);
  canvasCtx.stroke();

  // Radial spectrum rays around circle
  canvasCtx.strokeStyle = activeThemeColors.waveformColor || '#ffffff';
  canvasCtx.shadowColor = activeThemeColors.waveformGlow || 'rgba(255, 255, 255, 0.6)';
  canvasCtx.shadowBlur = 4;
  canvasCtx.lineWidth = 2;
  for (let i = 0; i < rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2 - Math.PI / 2;
    let mag = 0.04;
    if (!isPaused && freqDataArray) {
      const mirrorIdx = i < rayCount / 2 ? i : rayCount - 1 - i;
      const binIdx = Math.min(
        freqDataArray.length - 1,
        Math.floor((mirrorIdx / (rayCount / 2)) * (freqDataArray.length * 0.45))
      );
      mag = Math.max(0.04, Math.min(1, (freqDataArray[binIdx] / 255.0) * sens));
    }

    const r1 = dynamicBase;
    const r2 = dynamicBase + mag * (maxRadius - dynamicBase);

    const x1 = cx + Math.cos(angle) * r1;
    const y1 = cy + Math.sin(angle) * r1;
    const x2 = cx + Math.cos(angle) * r2;
    const y2 = cy + Math.sin(angle) * r2;

    canvasCtx.beginPath();
    canvasCtx.moveTo(x1, y1);
    canvasCtx.lineTo(x2, y2);
    canvasCtx.stroke();
  }

  // Outer continuous ring connecting time-domain wave around the circle
  canvasCtx.strokeStyle = isPaused ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.9)';
  canvasCtx.lineWidth = 1.5;
  canvasCtx.beginPath();
  for (let i = 0; i <= rayCount; i++) {
    const angle = (i / rayCount) * Math.PI * 2 - Math.PI / 2;
    let waveOffset = 0;
    if (!isPaused && timeDataArray) {
      const tIdx = Math.floor(((i % rayCount) / rayCount) * timeDataArray.length);
      waveOffset = ((timeDataArray[tIdx] - 128) / 128) * (baseRadius * 0.25 * sens);
    }
    const r = dynamicBase + waveOffset;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) canvasCtx.moveTo(px, py);
    else canvasCtx.lineTo(px, py);
  }
  canvasCtx.closePath();
  canvasCtx.stroke();

  canvasCtx.restore();
}

function drawXyScopeInViewport(vx, vy, vw, vh, isPaused) {
  canvasCtx.save();
  canvasCtx.beginPath();
  canvasCtx.rect(vx, vy, vw, vh);
  canvasCtx.clip();

  const sens = typeof state.visualizers.sensitivity === 'number' ? state.visualizers.sensitivity : 0.7;
  const cx = vx + vw / 2;
  const cy = vy + vh / 2;
  const radius = Math.max(14, Math.min(vw, vh) * 0.45);

  // Subtle CRT oscilloscope graticule (border box + center crosshairs + ticks)
  canvasCtx.strokeStyle = 'rgba(0, 255, 110, 0.14)';
  canvasCtx.lineWidth = 1;
  canvasCtx.strokeRect(cx - radius, cy - radius, radius * 2, radius * 2);

  canvasCtx.beginPath();
  canvasCtx.moveTo(cx - radius, cy);
  canvasCtx.lineTo(cx + radius, cy);
  canvasCtx.moveTo(cx, cy - radius);
  canvasCtx.lineTo(cx, cy + radius);
  canvasCtx.stroke();

  if (isPaused || !leftFloatArray || !rightFloatArray) {
    // Idle phosphor center beam dot
    canvasCtx.save();
    canvasCtx.shadowColor = '#00ff66';
    canvasCtx.shadowBlur = 10;
    canvasCtx.fillStyle = '#88ffbb';
    canvasCtx.beginPath();
    canvasCtx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    canvasCtx.fill();
    canvasCtx.restore();
    canvasCtx.restore();
    return;
  }

  const len = leftFloatArray.length;
  // Detect whether left and right channels are virtually identical (mono track); if so, apply a quarter-wave phase offset so mono audio still forms a 2D Lissajous figure
  let diffSum = 0;
  for (let i = 0; i < len; i += 8) {
    diffSum += Math.abs(leftFloatArray[i] - rightFloatArray[i]);
  }
  const isMono = diffSum / (len / 8) < 0.002;
  const phaseShift = isMono ? 18 : 0;

  canvasCtx.lineJoin = 'round';
  canvasCtx.lineCap = 'round';

  // Outer phosphor bloom pass
  canvasCtx.save();
  canvasCtx.shadowColor = '#00ff66';
  canvasCtx.shadowBlur = 12;
  canvasCtx.strokeStyle = 'rgba(0, 255, 102, 0.75)';
  canvasCtx.lineWidth = 2.2;
  canvasCtx.beginPath();

  for (let i = 0; i < len; i++) {
    const lSample = Math.max(-1.25, Math.min(1.25, leftFloatArray[i] * sens));
    const rIdx = (i + phaseShift) % len;
    const rSample = Math.max(-1.25, Math.min(1.25, rightFloatArray[rIdx] * sens));

    const px = cx + lSample * radius;
    const py = cy - rSample * radius;

    if (i === 0) {
      canvasCtx.moveTo(px, py);
    } else {
      canvasCtx.lineTo(px, py);
    }
  }
  canvasCtx.stroke();
  canvasCtx.restore();

  // Inner bright core beam pass
  canvasCtx.strokeStyle = 'rgba(215, 255, 230, 0.95)';
  canvasCtx.lineWidth = 1.0;
  canvasCtx.beginPath();
  for (let i = 0; i < len; i++) {
    const lSample = Math.max(-1.25, Math.min(1.25, leftFloatArray[i] * sens));
    const rIdx = (i + phaseShift) % len;
    const rSample = Math.max(-1.25, Math.min(1.25, rightFloatArray[rIdx] * sens));

    const px = cx + lSample * radius;
    const py = cy - rSample * radius;

    if (i === 0) {
      canvasCtx.moveTo(px, py);
    } else {
      canvasCtx.lineTo(px, py);
    }
  }
  canvasCtx.stroke();

  canvasCtx.restore();
}

const TUX_TOTAL_FRAMES = 141;
const TUX_COLS = 12;
const TUX_FRAME_W = 160;
const TUX_FRAME_H = 155;

let tuxProcessedCanvas = null;
let tuxSpriteReady = false;
let tuxFrameCursor = 0;
let tuxLastTickMs = performance.now();
let tuxPrevBassEnergy = 0;
let tuxLastBeatMs = 0;
let tuxEstimatedBpm = 120;
const tuxBeatIntervals = [];

const tuxRawSheetImg = new Image();
tuxRawSheetImg.onload = () => {
  try {
    const offscreen = document.createElement('canvas');
    offscreen.width = tuxRawSheetImg.width;
    offscreen.height = tuxRawSheetImg.height;
    const octx = offscreen.getContext('2d');
    octx.drawImage(tuxRawSheetImg, 0, 0);

    // Key out the off-white background (approx #fcfefc) while keeping the penguin's white belly/eyes intact via border flood fill per cell
    const imgData = octx.getImageData(0, 0, offscreen.width, offscreen.height);
    const data = imgData.data;
    const sheetW = offscreen.width;

    for (let f = 0; f < TUX_TOTAL_FRAMES; f++) {
      const col = f % TUX_COLS;
      const row = Math.floor(f / TUX_COLS);
      const x0 = col * TUX_FRAME_W;
      const y0 = row * TUX_FRAME_H;

      const visited = new Uint8Array(TUX_FRAME_W * TUX_FRAME_H);
      const queue = new Int32Array(TUX_FRAME_W * TUX_FRAME_H);
      let qHead = 0;
      let qTail = 0;

      const tryEnqueue = (lx, ly) => {
        if (lx < 0 || lx >= TUX_FRAME_W || ly < 0 || ly >= TUX_FRAME_H) return;
        const lIdx = ly * TUX_FRAME_W + lx;
        if (visited[lIdx]) return;
        const pIdx = ((y0 + ly) * sheetW + (x0 + lx)) * 4;
        const r = data[pIdx];
        const g = data[pIdx + 1];
        const b = data[pIdx + 2];
        // Off-white background pixels surrounding the penguin
        if (r > 235 && g > 235 && b > 235) {
          visited[lIdx] = 1;
          data[pIdx + 3] = 0;
          queue[qTail++] = lIdx;
        }
      };

      for (let x = 0; x < TUX_FRAME_W; x++) {
        tryEnqueue(x, 0);
        tryEnqueue(x, TUX_FRAME_H - 1);
      }
      for (let y = 0; y < TUX_FRAME_H; y++) {
        tryEnqueue(0, y);
        tryEnqueue(TUX_FRAME_W - 1, y);
      }

      while (qHead < qTail) {
        const curr = queue[qHead++];
        const cx = curr % TUX_FRAME_W;
        const cy = (curr / TUX_FRAME_W) | 0;
        tryEnqueue(cx - 1, cy);
        tryEnqueue(cx + 1, cy);
        tryEnqueue(cx, cy - 1);
        tryEnqueue(cx, cy + 1);
      }
    }

    octx.putImageData(imgData, 0, 0);
    tuxProcessedCanvas = offscreen;
    tuxSpriteReady = true;
  } catch (_) {
    tuxProcessedCanvas = tuxRawSheetImg;
    tuxSpriteReady = true;
  }
};
tuxRawSheetImg.src = 'assets/tux_spritesheet.png';

function drawTuxInViewport(vx, vy, vw, vh, isPaused) {
  canvasCtx.save();
  canvasCtx.beginPath();
  canvasCtx.rect(vx, vy, vw, vh);
  canvasCtx.clip();

  const nowMs = performance.now();
  const dtSec = Math.min(0.1, Math.max(0.001, (nowMs - tuxLastTickMs) / 1000));
  tuxLastTickMs = nowMs;

  const sens = typeof state.visualizers.sensitivity === 'number' ? state.visualizers.sensitivity : 0.7;

  let bassEnergy = 0;
  let midEnergy = 0;
  if (!isPaused && freqDataArray) {
    let bSum = 0;
    for (let i = 0; i < 10; i++) bSum += freqDataArray[i];
    bassEnergy = (bSum / (10 * 255)) * sens;

    let mSum = 0;
    for (let i = 10; i < 48; i++) mSum += freqDataArray[i];
    midEnergy = (mSum / (38 * 255)) * sens;

    // Real-time beat onset detection for tempo (BPM) estimation
    const flux = bassEnergy - tuxPrevBassEnergy;
    tuxPrevBassEnergy = bassEnergy * 0.65 + tuxPrevBassEnergy * 0.35;

    const minBeatGapMs = 240; // up to 250 BPM
    const maxBeatGapMs = 1500; // down to 40 BPM
    if (flux > 0.085 && bassEnergy > 0.22 && nowMs - tuxLastBeatMs > minBeatGapMs) {
      const interval = nowMs - tuxLastBeatMs;
      tuxLastBeatMs = nowMs;
      if (interval < maxBeatGapMs) {
        tuxBeatIntervals.push(interval);
        if (tuxBeatIntervals.length > 8) tuxBeatIntervals.shift();
        const avgInterval =
          tuxBeatIntervals.reduce((a, b) => a + b, 0) / tuxBeatIntervals.length;
        const rawBpm = 60000 / avgInterval;
        tuxEstimatedBpm = Math.max(55, Math.min(220, tuxEstimatedBpm * 0.6 + rawBpm * 0.4));
      }
    } else if (nowMs - tuxLastBeatMs > 2200) {
      // Gradually relax tempo when song has a quiet ambient section
      tuxEstimatedBpm = Math.max(60, tuxEstimatedBpm * 0.992 + 95 * 0.008);
    }

    // Advance GIF frame cursor proportional to detected tempo + current groove intensity
    const tempoRatio = tuxEstimatedBpm / 115; // 1.0x at 115 BPM
    const energyBoost = 0.55 + Math.min(1.65, (bassEnergy * 0.8 + midEnergy * 0.5));
    const speedMultiplier = Math.max(0.3, Math.min(3.4, tempoRatio * energyBoost));
    const baseFps = 20;
    tuxFrameCursor = (tuxFrameCursor + dtSec * baseFps * speedMultiplier) % TUX_TOTAL_FRAMES;
  }

  if (tuxSpriteReady && tuxProcessedCanvas) {
    const frameIdx = isPaused ? 0 : Math.floor(tuxFrameCursor) % TUX_TOTAL_FRAMES;
    const col = frameIdx % TUX_COLS;
    const row = Math.floor(frameIdx / TUX_COLS);
    const sx = col * TUX_FRAME_W;
    const sy = row * TUX_FRAME_H;

    // Fit cleanly inside the viewport while preserving the Club Penguin aspect ratio
    const pad = Math.min(8, vh * 0.04);
    const availW = Math.max(24, vw - pad * 2);
    const availH = Math.max(24, vh - pad * 2);
    const scale = Math.min(availW / TUX_FRAME_W, availH / TUX_FRAME_H);
    const drawW = TUX_FRAME_W * scale;
    const drawH = TUX_FRAME_H * scale;
    const dx = vx + (vw - drawW) / 2;
    const dy = vy + (vh - drawH) / 2;

    canvasCtx.imageSmoothingEnabled = false;
    canvasCtx.drawImage(
      tuxProcessedCanvas,
      sx,
      sy,
      TUX_FRAME_W,
      TUX_FRAME_H,
      dx,
      dy,
      drawW,
      drawH
    );
  }

  canvasCtx.restore();
}

function renderVisualizerFrame() {
  const width = waveCanvas.width;
  const height = waveCanvas.height;
  const isPaused = !analyser || audioEl.paused;

  if (!isPaused && analyser) {
    analyser.getByteTimeDomainData(timeDataArray);
    analyser.getByteFrequencyData(freqDataArray);
    if (state.visualizers.xy && analyserLeft && analyserRight && leftFloatArray && rightFloatArray) {
      analyserLeft.getFloatTimeDomainData(leftFloatArray);
      analyserRight.getFloatTimeDomainData(rightFloatArray);
    }
  }

  canvasCtx.fillStyle = '#050508';
  canvasCtx.fillRect(0, 0, width, height);

  const activeModes = [];
  if (state.visualizers.wave) activeModes.push('wave');
  if (state.visualizers.bar) activeModes.push('bar');
  if (state.visualizers.circle) activeModes.push('circle');
  if (state.visualizers.xy) activeModes.push('xy');
  if (state.visualizers.tux) activeModes.push('tux');
  for (const cid in customVisualizers) {
    if (state.visualizers[cid]) activeModes.push(cid);
  }
  if (activeModes.length === 0) activeModes.push('wave');

  const renderModeAt = (mode, vx, vy, vw, vh) => {
    if (mode === 'wave') drawWaveInViewport(vx, vy, vw, vh, isPaused);
    else if (mode === 'bar') drawBarInViewport(vx, vy, vw, vh, isPaused);
    else if (mode === 'circle') drawCircleInViewport(vx, vy, vw, vh, isPaused);
    else if (mode === 'xy') drawXyScopeInViewport(vx, vy, vw, vh, isPaused);
    else if (mode === 'tux') drawTuxInViewport(vx, vy, vw, vh, isPaused);
    else if (customVisualizers[mode]) {
      customVisualizers[mode].render(canvasCtx, vx, vy, vw, vh, isPaused, {
        timeData: timeDataArray,
        freqData: freqDataArray,
        sensitivity: state.visualizers.sensitivity,
        width: vw,
        height: vh
      });
    }
  };

  if (state.visualizers.layout === 'overlay' || activeModes.length === 1) {
    activeModes.forEach((mode) => renderModeAt(mode, 0, 0, width, height));
  } else {
    // Split side-by-side viewports
    const paneW = width / activeModes.length;
    activeModes.forEach((mode, idx) => {
      const vx = Math.floor(idx * paneW);
      const vw = Math.floor(paneW);
      renderModeAt(mode, vx, 0, vw, height);

      // Divider line & subtle label
      if (idx > 0) {
        canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
        canvasCtx.lineWidth = 1;
        canvasCtx.beginPath();
        canvasCtx.moveTo(vx, 0);
        canvasCtx.lineTo(vx, height);
        canvasCtx.stroke();
      }

      canvasCtx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      canvasCtx.font = '10px "VCR OSD Mono", monospace';
      canvasCtx.fillText(mode.toUpperCase(), vx + 6, 12);
    });
  }
}

function startVisualizerLoop() {
  if (animationId) cancelAnimationFrame(animationId);

  function loop() {
    animationId = requestAnimationFrame(loop);
    renderVisualizerFrame();
  }

  loop();
}

// ==========================================================================
// HYPRLAND WINDOW MANAGER (TILING + FLOATING + RESIZING + SWAPPING + 6 LAYOUTS + HIDE PANELS)
// ==========================================================================

let isSwappingTiles = false;

function updateTopBarPanelAndLayoutButtons() {
  const hiddenPanes = (state.layout && state.layout.hiddenPanes) || {};

  document.querySelectorAll('[data-panel-toggle]').forEach((btn) => {
    const target = btn.dataset.panelToggle;
    if (target === 'visualizer') {
      const visible = !state.visualizers.hidden;
      btn.setAttribute('aria-pressed', String(visible));
    } else {
      const visible = !hiddenPanes[target];
      btn.setAttribute('aria-pressed', String(visible));
    }
  });

  document.querySelectorAll('[data-layout-slot]').forEach((btn) => {
    const slotIdx = Number(btn.dataset.layoutSlot);
    const isActive = slotIdx === state.activeLayoutSlot;
    const isSaved = Boolean(state.savedLayouts[slotIdx]);
    btn.setAttribute('aria-pressed', String(isActive));
    btn.textContent = `L${slotIdx + 1}${isSaved ? '*' : ''}`;
  });
}

function applyHyprlandLayout() {
  const slots = [tileSlot0, tileSlot1, tileSlot2, tileSlot3];
  if (!state.layout.hiddenPanes) state.layout.hiddenPanes = {};

  // Apply split dimensions
  tileColLeft.style.width = `${Math.max(145, state.layout.leftColWidth)}px`;
  tileRowTop.style.height = `${Math.max(130, state.layout.topRowHeight)}px`;

  const ratio = Math.min(0.9, Math.max(0.1, state.layout.bottomLeftRatio || 0.56));

  // Place each pane either in its tile slot or as a floating window in #hypr-workspace
  state.layout.slotOrder.forEach((paneId, slotIdx) => {
    const paneEl = document.getElementById(paneId);
    const slotEl = slots[slotIdx];
    if (!paneEl || !slotEl) return;

    const floatBtn = paneEl.querySelector('[data-toggle-float]');
    const fullBtn = paneEl.querySelector('[data-toggle-fullscreen]');
    const floatCfg = state.layout.floating && state.layout.floating[paneId];
    const isHidden = Boolean(state.layout.hiddenPanes[paneId]);
    if (isHidden && state.layout.fullscreenPane === paneId) {
      state.layout.fullscreenPane = null;
    }
    const isFull = !isHidden && state.layout.fullscreenPane === paneId;

    paneEl.classList.toggle('is-hidden', isHidden);
    paneEl.classList.toggle('is-fullscreen', isFull);
    if (fullBtn) {
      fullBtn.textContent = isFull ? 'EXIT FULL' : 'FULL';
    }

    if (isFull) {
      paneEl.classList.remove('is-floating');
      if (paneEl.parentElement !== hyprWorkspace) {
        hyprWorkspace.appendChild(paneEl);
      }
    } else if (floatCfg) {
      paneEl.classList.add('is-floating');
      paneEl.style.left = `${floatCfg.x}px`;
      paneEl.style.top = `${floatCfg.y}px`;
      paneEl.style.width = `${floatCfg.w}px`;
      paneEl.style.height = `${floatCfg.h}px`;
      paneEl.style.zIndex = String(floatCfg.z || 30);

      if (paneEl.parentElement !== hyprWorkspace) {
        hyprWorkspace.appendChild(paneEl);
      }
      if (floatBtn) floatBtn.textContent = 'TILE';
    } else {
      paneEl.classList.remove('is-floating');
      paneEl.style.left = '';
      paneEl.style.top = '';
      paneEl.style.width = '';
      paneEl.style.height = '';
      paneEl.style.zIndex = '';

      if (paneEl.parentElement !== slotEl) {
        slotEl.appendChild(paneEl);
      }
      if (floatBtn) floatBtn.textContent = 'FLOAT';
    }
  });

  // Determine which tile slots currently hold a visible tiled window
  const slotHasVisibleTile = state.layout.slotOrder.map((paneId) => {
    if (isSwappingTiles) return true;
    const isHidden = Boolean(state.layout.hiddenPanes && state.layout.hiddenPanes[paneId]);
    const isFloating = Boolean(state.layout.floating && state.layout.floating[paneId]);
    const isFull = state.layout.fullscreenPane === paneId;
    return !isHidden && !isFloating && !isFull;
  });

  const [hasSlot0, hasSlot1, hasSlot2, hasSlot3] = slotHasVisibleTile;
  const hasLeftCol = hasSlot0;
  const hasTopRow = hasSlot1;
  const hasBottomRow = hasSlot2 || hasSlot3;
  const hasRightCol = hasTopRow || hasBottomRow;

  tileColLeft.classList.toggle('is-hidden', !hasLeftCol);
  tileColLeft.classList.toggle('col-expanded', hasLeftCol && !hasRightCol);

  if (tileColRight) {
    tileColRight.classList.toggle('is-hidden', !hasRightCol);
  }
  gutterCol.classList.toggle('is-hidden', !(hasLeftCol && hasRightCol));

  tileRowTop.classList.toggle('is-hidden', !hasTopRow);
  tileRowTop.classList.toggle('row-expanded', hasTopRow && !hasBottomRow);

  if (tileRowBottom) {
    tileRowBottom.classList.toggle('is-hidden', !hasBottomRow);
  }
  gutterRowRight.classList.toggle('is-hidden', !(hasTopRow && hasBottomRow));

  tileSlot2.classList.toggle('is-hidden', !hasSlot2);
  tileSlot3.classList.toggle('is-hidden', !hasSlot3);
  gutterBottomSplit.classList.toggle('is-hidden', !(hasSlot2 && hasSlot3));

  if (hasSlot2 && hasSlot3) {
    tileSlot2.style.flex = `${ratio}`;
    tileSlot3.style.flex = `${1 - ratio}`;
  } else if (hasSlot2) {
    tileSlot2.style.flex = '1';
  } else if (hasSlot3) {
    tileSlot3.style.flex = '1';
  }

  slots.forEach((slotEl, idx) => {
    const hasVisibleChild = Array.from(slotEl.children).some(
      (child) => !child.classList.contains('is-hidden')
    );
    slotEl.classList.toggle('slot-empty', !hasVisibleChild && slotHasVisibleTile[idx]);
  });

  updateTopBarPanelAndLayoutButtons();
  syncCanvasDimensions();
}

function togglePaneHidden(paneId) {
  if (!state.layout.hiddenPanes) state.layout.hiddenPanes = {};
  const currentlyHidden = Boolean(state.layout.hiddenPanes[paneId]);
  if (currentlyHidden) {
    delete state.layout.hiddenPanes[paneId];
    setStatus(`Restored panel "${PANE_DISPLAY_NAMES[paneId] || paneId}".`);
  } else {
    state.layout.hiddenPanes[paneId] = true;
    if (state.layout.fullscreenPane === paneId) {
      state.layout.fullscreenPane = null;
    }
    setStatus(
      `Hidden panel "${PANE_DISPLAY_NAMES[paneId] || paneId}" (restore anytime from PANELS in the top bar).`
    );
  }
  applyHyprlandLayout();
  saveAppState();
}

function showAllPanels() {
  state.layout.hiddenPanes = {};
  state.visualizers.hidden = false;
  applyVisualizerContainerState();
  applyHyprlandLayout();
  setStatus('Restored all hidden panels.');
  saveAppState();
}

function saveCurrentToLayoutSlot(slotIdx = state.activeLayoutSlot, announce = true) {
  if (slotIdx < 0 || slotIdx >= MAX_LAYOUTS) return;
  state.activeLayoutSlot = slotIdx;
  userSelectedSlotToEdit = true;
  state.savedLayouts[slotIdx] = captureCurrentLayoutSnapshot();
  updateTopBarPanelAndLayoutButtons();
  saveAppState();
  if (announce) {
    setStatus(
      `Saved current window sizes, splitters & visible panels to Layout ${slotIdx + 1} (L${slotIdx + 1}*).`
    );
  }
}

function switchLayoutSlot(slotIdx, overwriteWithCurrent = false) {
  if (slotIdx < 0 || slotIdx >= MAX_LAYOUTS) return;

  if (overwriteWithCurrent) {
    saveCurrentToLayoutSlot(slotIdx, true);
    return;
  }

  const targetPreset = state.savedLayouts[slotIdx];

  // If the target slot already has a saved layout, and the user was editing a slot they explicitly selected, save that slot before switching
  if (
    targetPreset &&
    userSelectedSlotToEdit &&
    state.activeLayoutSlot >= 0 &&
    state.activeLayoutSlot < MAX_LAYOUTS
  ) {
    state.savedLayouts[state.activeLayoutSlot] = captureCurrentLayoutSnapshot();
  }

  state.activeLayoutSlot = slotIdx;
  userSelectedSlotToEdit = true;

  if (targetPreset && typeof targetPreset === 'object') {
    state.layout = sanitizeLayout(targetPreset.layout);
    state.visualizers = sanitizeVisualizers(targetPreset.visualizers);
    if (
      state.layout.windowBounds &&
      window.musicAPI &&
      typeof window.musicAPI.setWindowBounds === 'function'
    ) {
      window.musicAPI.setWindowBounds(state.layout.windowBounds);
    }
    applyVisualizerContainerState();
    applyHyprlandLayout();
    setStatus(`Loaded saved Layout ${slotIdx + 1} (L${slotIdx + 1}*).`);
  } else {
    // Target slot was empty: save current workspace (including any recent window resizing) into this new slot without overwriting the previous slot
    state.savedLayouts[slotIdx] = captureCurrentLayoutSnapshot();
    updateTopBarPanelAndLayoutButtons();
    setStatus(
      `Saved current workspace & window sizes into new Layout ${slotIdx + 1} (L${slotIdx + 1}*).`
    );
  }

  saveAppState();
}

function togglePaneFullscreen(paneId) {
  if (state.layout.hiddenPanes && state.layout.hiddenPanes[paneId]) {
    delete state.layout.hiddenPanes[paneId];
  }
  if (state.layout.fullscreenPane === paneId) {
    state.layout.fullscreenPane = null;
    setStatus(`Exited fullscreen for "${paneId.replace('pane-', '').toUpperCase()}".`);
  } else {
    state.layout.fullscreenPane = paneId;
    setStatus(`Fullscreened window "${paneId.replace('pane-', '').toUpperCase()}" (press Esc, Alt+F, or EXIT FULL to restore).`);
  }
  applyHyprlandLayout();
}

function togglePaneFloating(paneId) {
  const paneEl = document.getElementById(paneId);
  if (!paneEl) return;

  if (state.layout.hiddenPanes && state.layout.hiddenPanes[paneId]) {
    delete state.layout.hiddenPanes[paneId];
  }

  if (state.layout.fullscreenPane === paneId) {
    state.layout.fullscreenPane = null;
  }

  if (!state.layout.floating) state.layout.floating = {};

  if (state.layout.floating[paneId]) {
    delete state.layout.floating[paneId];
    setStatus(`Tiled window "${paneId.replace('pane-', '').toUpperCase()}".`);
  } else {
    const wsRect = hyprWorkspace.getBoundingClientRect();
    const rect = paneEl.getBoundingClientRect();
    topFloatingZ += 1;
    state.layout.floating[paneId] = {
      x: Math.max(12, Math.min(wsRect.width - 260, Math.round(rect.left - wsRect.left + 16))),
      y: Math.max(12, Math.min(wsRect.height - 180, Math.round(rect.top - wsRect.top + 16))),
      w: Math.max(240, Math.min(wsRect.width - 24, Math.round(rect.width))),
      h: Math.max(170, Math.min(wsRect.height - 24, Math.round(rect.height))),
      z: topFloatingZ
    };
    setStatus(`Floated window "${paneId.replace('pane-', '').toUpperCase()}" (drag edges/corners or Alt+RMB to resize).`);
  }

  applyHyprlandLayout();
  saveAppState();
}

function initHyprlandWM() {
  const directions = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];

  ALL_PANE_IDS.forEach((paneId) => {
    const paneEl = document.getElementById(paneId);
    if (!paneEl) return;

    // Add 8-direction resize handles for floating mode
    directions.forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = `hypr-resize-handle hypr-resize-${dir}`;
      handle.dataset.resizeDir = dir;
      paneEl.appendChild(handle);

      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        startFloatingResize(paneId, dir, e.clientX, e.clientY);
      });
    });

    // Bring window to focus on click
    paneEl.addEventListener('mousedown', () => {
      document.querySelectorAll('.hypr-window').forEach((w) => w.classList.remove('active-window'));
      paneEl.classList.add('active-window');
      if (state.layout.floating && state.layout.floating[paneId]) {
        topFloatingZ += 1;
        state.layout.floating[paneId].z = topFloatingZ;
        paneEl.style.zIndex = String(topFloatingZ);
      }
    });

    // Float/Tile, Fullscreen, and Hide buttons
    const floatBtn = paneEl.querySelector('[data-toggle-float]');
    if (floatBtn) {
      floatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePaneFloating(paneId);
      });
    }

    const fullBtn = paneEl.querySelector('[data-toggle-fullscreen]');
    if (fullBtn) {
      fullBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePaneFullscreen(paneId);
      });
    }

    const hideBtn = paneEl.querySelector('[data-toggle-hide]');
    if (hideBtn) {
      hideBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePaneHidden(paneId);
      });
    }

    // Drag via Titlebar OR double-click Titlebar to toggle fullscreen
    const titlebar = paneEl.querySelector('[data-drag-handle]');
    if (titlebar) {
      titlebar.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        togglePaneFullscreen(paneId);
      });
      titlebar.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        if (state.layout.fullscreenPane === paneId) return;
        e.preventDefault();
        startWindowMoveOrSwap(paneId, e.clientX, e.clientY);
      });
    }

    // Hyprland keybind style: Alt + LMB to Move/Swap, Alt + RMB to Resize
    paneEl.addEventListener('mousedown', (e) => {
      if (!e.altKey) return;
      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        startWindowMoveOrSwap(paneId, e.clientX, e.clientY);
      } else if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        if (state.layout.floating && state.layout.floating[paneId]) {
          startFloatingResize(paneId, 'se', e.clientX, e.clientY);
        } else {
          startTiledAltResize(paneId, e.clientX, e.clientY);
        }
      }
    });
  });

  // Top Bar Panel Visibility Toggle Buttons
  document.querySelectorAll('[data-panel-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.panelToggle;
      if (target === 'visualizer') {
        toggleVisualizerHidden();
      } else if (ALL_PANE_IDS.includes(target)) {
        togglePaneHidden(target);
      }
    });
  });

  // Top Bar 6 Saved Layout Slot Buttons (L1..L6) + Save Layout Button
  document.querySelectorAll('[data-layout-slot]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const slotIdx = Number(btn.dataset.layoutSlot);
      switchLayoutSlot(slotIdx, Boolean(e.shiftKey));
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const slotIdx = Number(btn.dataset.layoutSlot);
      saveCurrentToLayoutSlot(slotIdx, true);
    });
  });

  if (btnSaveLayout) {
    btnSaveLayout.addEventListener('click', () => {
      saveCurrentToLayoutSlot(state.activeLayoutSlot, true);
    });
  }

  if (btnHyprShowAll) {
    btnHyprShowAll.addEventListener('click', () => {
      showAllPanels();
    });
  }

  // Gutter Splitters for Tiled Mode
  gutterCol.addEventListener('mousedown', (e) => {
    e.preventDefault();
    gutterCol.classList.add('dragging');
    const startX = e.clientX;
    const startW = state.layout.leftColWidth;

    const onMove = (ev) => {
      const wsW = hyprWorkspace.clientWidth;
      state.layout.leftColWidth = Math.max(145, Math.min(wsW - 180, startW + (ev.clientX - startX)));
      applyHyprlandLayout();
    };
    const onUp = () => {
      gutterCol.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveAppState();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  gutterRowRight.addEventListener('mousedown', (e) => {
    e.preventDefault();
    gutterRowRight.classList.add('dragging');
    const startY = e.clientY;
    const startH = state.layout.topRowHeight;

    const onMove = (ev) => {
      const wsH = hyprWorkspace.clientHeight;
      state.layout.topRowHeight = Math.max(130, Math.min(wsH - 120, startH + (ev.clientY - startY)));
      applyHyprlandLayout();
    };
    const onUp = () => {
      gutterRowRight.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveAppState();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  gutterBottomSplit.addEventListener('mousedown', (e) => {
    e.preventDefault();
    gutterBottomSplit.classList.add('dragging');
    const rowBottom = document.getElementById('tile-row-bottom');

    const onMove = (ev) => {
      const rect = rowBottom.getBoundingClientRect();
      if (rect.width > 100) {
        const relX = ev.clientX - rect.left;
        state.layout.bottomLeftRatio = Math.max(0.12, Math.min(0.88, relX / rect.width));
        applyHyprlandLayout();
      }
    };
    const onUp = () => {
      gutterBottomSplit.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveAppState();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // Top Bar Workspace Controls
  btnHyprTileAll.addEventListener('click', () => {
    state.layout.fullscreenPane = null;
    state.layout.floating = {};
    applyHyprlandLayout();
    setStatus('Tiled all container windows.');
    saveAppState();
  });

  if (btnAppFullscreen) {
    btnAppFullscreen.addEventListener('click', async () => {
      if (window.musicAPI && window.musicAPI.toggleAppFullscreen) {
        const res = await window.musicAPI.toggleAppFullscreen();
        btnAppFullscreen.textContent = res && res.isFullScreen ? 'Exit App Fullscreen' : 'App Fullscreen';
      } else if (document.documentElement.requestFullscreen) {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
      }
    });
  }

  btnHyprFloatAll.addEventListener('click', () => {
    const wsRect = hyprWorkspace.getBoundingClientRect();
    const w = Math.max(260, Math.floor((wsRect.width - 36) / 2));
    const h = Math.max(180, Math.floor((wsRect.height - 36) / 2));
    const coords = [
      { x: 10, y: 10, w: Math.min(300, w), h: wsRect.height - 20 },
      { x: Math.min(320, w + 16), y: 10, w: Math.max(320, wsRect.width - Math.min(320, w + 16) - 12), h },
      { x: Math.min(320, w + 16), y: h + 18, w: Math.floor((wsRect.width - Math.min(320, w + 16) - 20) / 2), h: wsRect.height - h - 28 },
      { x: Math.min(320, w + 16) + Math.floor((wsRect.width - Math.min(320, w + 16) - 20) / 2) + 8, y: h + 18, w: Math.floor((wsRect.width - Math.min(320, w + 16) - 20) / 2), h: wsRect.height - h - 28 }
    ];
    state.layout.floating = {};
    state.layout.slotOrder.forEach((paneId, idx) => {
      topFloatingZ += 1;
      state.layout.floating[paneId] = { ...coords[idx], z: topFloatingZ };
    });
    applyHyprlandLayout();
    setStatus('Floated all windows — drag titlebars to move, drag edges/corners to resize.');
    saveAppState();
  });

  btnHyprReset.addEventListener('click', () => {
    state.layout = getDefaultLayout();
    state.visualizers = {
      ...state.visualizers,
      height: 52,
      floating: null,
      fullscreen: false,
      hidden: false
    };
    applyVisualizerContainerState();
    applyHyprlandLayout();
    setStatus(`Reset Layout ${state.activeLayoutSlot + 1} (L${state.activeLayoutSlot + 1}) and unhid all panels.`);
    saveAppState();
  });
}

function startWindowMoveOrSwap(paneId, startX, startY) {
  const isFloating = Boolean(state.layout.floating && state.layout.floating[paneId]);

  if (isFloating) {
    const cfg = state.layout.floating[paneId];
    const origX = cfg.x;
    const origY = cfg.y;

    const onMove = (ev) => {
      const wsRect = hyprWorkspace.getBoundingClientRect();
      cfg.x = Math.max(0, Math.min(wsRect.width - 80, origX + (ev.clientX - startX)));
      cfg.y = Math.max(0, Math.min(wsRect.height - 40, origY + (ev.clientY - startY)));
      applyHyprlandLayout();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveAppState();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return;
  }

  // Tiled mode: drag onto another tile slot to swap positions
  const slots = [tileSlot0, tileSlot1, tileSlot2, tileSlot3];
  const sourceSlotIdx = state.layout.slotOrder.indexOf(paneId);
  let hoveredSlotIdx = -1;
  isSwappingTiles = true;
  applyHyprlandLayout();

  const onMove = (ev) => {
    hoveredSlotIdx = -1;
    slots.forEach((slotEl, idx) => {
      const r = slotEl.getBoundingClientRect();
      const inside =
        ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (inside && idx !== sourceSlotIdx) {
        hoveredSlotIdx = idx;
        slotEl.classList.add('drop-target');
      } else {
        slotEl.classList.remove('drop-target');
      }
    });
  };

  const onUp = () => {
    isSwappingTiles = false;
    slots.forEach((s) => s.classList.remove('drop-target'));
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);

    if (hoveredSlotIdx >= 0 && hoveredSlotIdx !== sourceSlotIdx) {
      const order = [...state.layout.slotOrder];
      [order[sourceSlotIdx], order[hoveredSlotIdx]] = [order[hoveredSlotIdx], order[sourceSlotIdx]];
      state.layout.slotOrder = order;
      applyHyprlandLayout();
      setStatus('Swapped tiled container positions.');
      saveAppState();
    } else {
      applyHyprlandLayout();
    }
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function startFloatingResize(paneId, dir, startX, startY) {
  const cfg = state.layout.floating && state.layout.floating[paneId];

  // If the window is tiled (not floating), allow dragging its edges/corners to resize the tiled splits!
  if (!cfg) {
    startTiledEdgeResize(paneId, dir, startX, startY);
    return;
  }

  const orig = { x: cfg.x, y: cfg.y, w: cfg.w, h: cfg.h };
  const minW = 210;
  const minH = 140;

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    if (dir.includes('e')) cfg.w = Math.max(minW, orig.w + dx);
    if (dir.includes('s')) cfg.h = Math.max(minH, orig.h + dy);
    if (dir.includes('w')) {
      const newW = Math.max(minW, orig.w - dx);
      cfg.x = orig.x + (orig.w - newW);
      cfg.w = newW;
    }
    if (dir.includes('n')) {
      const newH = Math.max(minH, orig.h - dy);
      cfg.y = orig.y + (orig.h - newH);
      cfg.h = newH;
    }

    applyHyprlandLayout();
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    saveAppState();
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function startTiledEdgeResize(paneId, dir, startX, startY) {
  const slotIdx = state.layout.slotOrder.indexOf(paneId);
  if (slotIdx < 0) return;

  const startLeftW = state.layout.leftColWidth;
  const startTopH = state.layout.topRowHeight;
  const startRatio = state.layout.bottomLeftRatio || 0.56;
  const rowBottom = document.getElementById('tile-row-bottom');
  const bottomW = rowBottom ? Math.max(200, rowBottom.clientWidth) : 600;

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const wsW = hyprWorkspace.clientWidth;
    const wsH = hyprWorkspace.clientHeight;

    if (slotIdx === 0) {
      if (dir.includes('e')) {
        state.layout.leftColWidth = Math.max(145, Math.min(wsW - 180, startLeftW + dx));
      }
    } else if (slotIdx === 1) {
      if (dir.includes('w')) {
        state.layout.leftColWidth = Math.max(145, Math.min(wsW - 180, startLeftW + dx));
      }
      if (dir.includes('s')) {
        state.layout.topRowHeight = Math.max(130, Math.min(wsH - 120, startTopH + dy));
      }
    } else if (slotIdx === 2) {
      if (dir.includes('w')) {
        state.layout.leftColWidth = Math.max(145, Math.min(wsW - 180, startLeftW + dx));
      }
      if (dir.includes('n')) {
        state.layout.topRowHeight = Math.max(130, Math.min(wsH - 120, startTopH + dy));
      }
      if (dir.includes('e')) {
        state.layout.bottomLeftRatio = Math.max(0.12, Math.min(0.88, startRatio + dx / bottomW));
      }
    } else if (slotIdx === 3) {
      if (dir.includes('n')) {
        state.layout.topRowHeight = Math.max(130, Math.min(wsH - 120, startTopH + dy));
      }
      if (dir.includes('w')) {
        state.layout.bottomLeftRatio = Math.max(0.12, Math.min(0.88, startRatio + dx / bottomW));
      }
    }

    applyHyprlandLayout();
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    saveAppState();
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function startTiledAltResize(paneId, startX, startY) {
  const slotIdx = state.layout.slotOrder.indexOf(paneId);
  const startLeftW = state.layout.leftColWidth;
  const startTopH = state.layout.topRowHeight;
  const startRatio = state.layout.bottomLeftRatio || 0.56;
  const rowBottom = document.getElementById('tile-row-bottom');
  const bottomW = rowBottom ? Math.max(200, rowBottom.clientWidth) : 600;

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const wsW = hyprWorkspace.clientWidth;
    const wsH = hyprWorkspace.clientHeight;

    if (slotIdx === 0) {
      state.layout.leftColWidth = Math.max(145, Math.min(wsW - 180, startLeftW + dx));
    } else if (slotIdx === 1) {
      state.layout.leftColWidth = Math.max(145, Math.min(wsW - 180, startLeftW - dx));
      state.layout.topRowHeight = Math.max(130, Math.min(wsH - 120, startTopH + dy));
    } else if (slotIdx === 2) {
      state.layout.bottomLeftRatio = Math.max(0.12, Math.min(0.88, startRatio + dx / bottomW));
      state.layout.topRowHeight = Math.max(130, Math.min(wsH - 120, startTopH - dy));
    } else if (slotIdx === 3) {
      state.layout.bottomLeftRatio = Math.max(0.12, Math.min(0.88, startRatio - dx / bottomW));
      state.layout.topRowHeight = Math.max(130, Math.min(wsH - 120, startTopH - dy));
    }
    applyHyprlandLayout();
  };

  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    saveAppState();
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// ==========================================================================
// TIMED LYRICS ENGINE
// ==========================================================================

function parseLrcInBrowser(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { synced: false, lines: [] };
  }
  const lines = rawText.split(/\r?\n/);
  const timed = [];
  const plain = [];
  const lrcRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^\[(ar|ti|al|by|offset|re|ve|length):/i.test(line)) continue;
    const matches = [...line.matchAll(lrcRegex)];
    if (matches.length > 0) {
      const text = line.replace(lrcRegex, '').trim();
      for (const m of matches) {
        const timeSec =
          parseInt(m[1], 10) * 60 +
          parseInt(m[2], 10) +
          (m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0);
        if (text) timed.push({ time: timeSec, text });
      }
    } else {
      plain.push({ time: null, text: line });
    }
  }

  if (timed.length > 0) {
    timed.sort((a, b) => a.time - b.time);
    return { synced: true, lines: timed };
  }
  return { synced: false, lines: plain };
}

function isInstrumentalTrack(name) {
  if (!name || typeof name !== 'string') return false;
  return /\b(instrumental|inst\b|karaoke|backing track|off vocal|no vocals?)\b/i.test(name);
}

function isAutoCaptionLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const soundCueRegex =
    /^(\[|\()?(music|applause|cheering|laughter|silence|sound|instrumental|intro|outro|interlude|solo|singing|guitar|piano|beat|drop|snicker|sigh|screaming|cheers|screams|__|\?\?\?|>>|-)+(\]|\))?$/i;
  let cues = 0;
  for (const item of lines) {
    const txt = (item.text || '').trim();
    if (soundCueRegex.test(txt) || txt === '>>' || txt === '-') {
      cues++;
    }
  }
  return cues >= 2 || cues / lines.length >= 0.2;
}

function renderLyricsPanel(forceRebuild = false) {
  const track = getCurrentTrack();

  if (!track) {
    renderedLyricsTrackRef = null;
    activeLyricLineIndex = -1;
    lyricsSyncBadge.textContent = 'IDLE';
    lyricsContainer.innerHTML =
      '<div class="lyrics-placeholder">Play a YT Music song or local track to display timed lyrics here.</div>';
    return;
  }

  // Purge any leftover video caption dumps (e.g. [Music]) from saved track state
  if (track.lyrics && Array.isArray(track.lyrics.lines) && isAutoCaptionLines(track.lyrics.lines)) {
    track.lyrics = null;
  }

  // Auto-detect and normalize instrumental tracks
  if (track.isInstrumental || isInstrumentalTrack(track.name) || (track.lyrics && track.lyrics.instrumental)) {
    track.isInstrumental = true;
    track.lyrics = { instrumental: true, synced: false, lines: [] };
  }

  if (!forceRebuild && renderedLyricsTrackRef === track) {
    syncActiveLyricLine(audioEl.currentTime);
    return;
  }

  renderedLyricsTrackRef = track;
  activeLyricLineIndex = -1;
  lyricsContainer.innerHTML = '';

  const lyricsData = track.lyrics;
  if (!lyricsData || !Array.isArray(lyricsData.lines) || lyricsData.lines.length === 0) {
    if (track.isInstrumental) {
      lyricsSyncBadge.textContent = 'INSTRUMENTAL';
      const placeholder = document.createElement('div');
      placeholder.className = 'lyrics-placeholder';
      placeholder.textContent = 'Instrumental track — No lyrics.';
      lyricsContainer.appendChild(placeholder);
    } else {
      lyricsSyncBadge.textContent = 'NO LYRICS';
      const placeholder = document.createElement('div');
      placeholder.className = 'lyrics-placeholder';
      placeholder.textContent = `No timed lyrics loaded for "${track.name}". Click "Fetch Lyrics" or "Load .LRC".`;
      lyricsContainer.appendChild(placeholder);
    }
    return;
  }

  lyricsSyncBadge.textContent = lyricsData.synced ? 'TIMED (SYNCED)' : 'UNSYNCED';

  lyricsData.lines.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'lyric-line' + (lyricsData.synced && Number.isFinite(item.time) ? ' clickable' : '');
    row.dataset.index = String(idx);

    if (lyricsData.synced && Number.isFinite(item.time)) {
      const timeSpan = document.createElement('span');
      timeSpan.className = 'lyric-time';
      timeSpan.textContent = `[${formatTime(item.time)}]`;
      row.appendChild(timeSpan);

      row.title = `Jump to ${formatTime(item.time)}`;
      row.addEventListener('click', () => {
        audioEl.currentTime = item.time;
        if (audioEl.paused) {
          audioEl.play();
          btnPlayPause.textContent = 'Pause';
        }
        syncActiveLyricLine(item.time);
      });
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'lyric-text';
    textSpan.textContent = item.text;
    row.appendChild(textSpan);

    lyricsContainer.appendChild(row);
  });

  syncActiveLyricLine(audioEl.currentTime);
}

function syncActiveLyricLine(currentTimeSec) {
  const track = getCurrentTrack();
  if (!track || !track.lyrics || !track.lyrics.synced || !Array.isArray(track.lyrics.lines)) {
    return;
  }

  const lines = track.lyrics.lines;
  let newIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (Number.isFinite(lines[i].time) && lines[i].time <= currentTimeSec + 0.12) {
      newIdx = i;
    } else {
      break;
    }
  }

  if (newIdx === activeLyricLineIndex) return;
  activeLyricLineIndex = newIdx;

  const rowEls = lyricsContainer.querySelectorAll('.lyric-line');
  rowEls.forEach((el, idx) => {
    if (idx === activeLyricLineIndex) {
      el.classList.add('active');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      el.classList.remove('active');
    }
  });
}

async function fetchLyricsForCurrentTrack(manualTrigger = false) {
  const track = getCurrentTrack();
  if (!track) {
    if (manualTrigger) setStatus('Play a track first to fetch its lyrics.');
    return;
  }

  if (track.isInstrumental || isInstrumentalTrack(track.name)) {
    track.isInstrumental = true;
    track.lyrics = { instrumental: true, synced: false, lines: [] };
    renderLyricsPanel(true);
    await saveAppState();
    if (manualTrigger) {
      setStatus(`"${track.name}" is an instrumental track (no lyrics).`);
    }
    return;
  }

  if (!window.musicAPI || !window.musicAPI.fetchLyrics) {
    if (manualTrigger) setStatus('Use "Load .LRC" when running in a browser.');
    return;
  }

  lyricsSyncBadge.textContent = 'SEARCHING...';
  if (manualTrigger) {
    setStatus(`Searching YouTube Music lyrics for "${track.name}"...`);
  }

  try {
    const result = await window.musicAPI.fetchLyrics({
      trackName: track.name,
      filePath: track.path || '',
      videoId: track.videoId || '',
      duration: Number.isFinite(audioEl.duration) ? audioEl.duration : 0,
      manual: manualTrigger
    });

    if (result && result.instrumental) {
      track.isInstrumental = true;
      track.lyrics = { instrumental: true, synced: false, lines: [] };
      renderLyricsPanel(true);
      await saveAppState();
      if (manualTrigger) {
        setStatus(`"${track.name}" is an instrumental track.`);
      }
      return;
    }

    if (result && Array.isArray(result.lines) && result.lines.length > 0 && !isAutoCaptionLines(result.lines)) {
      track.lyrics = result;
      renderLyricsPanel(true);
      await saveAppState();
      const sourceLabel = result.source === 'ytm' ? 'YouTube Music' : result.synced ? 'synced timed' : 'online';
      setStatus(`Loaded lyrics from ${sourceLabel} for "${track.name}".`);
    } else {
      track.lyrics = null;
      renderLyricsPanel(true);
      if (manualTrigger) {
        setStatus(`No lyrics found on YouTube Music or online for "${track.name}". You can load a .LRC file manually.`);
      }
    }
  } catch (err) {
    renderLyricsPanel(true);
    if (manualTrigger) {
      setStatus(`Lyrics lookup error: ${err.message || err}`);
    }
  }
}

// ==========================================================================
// RENDERING UI
// ==========================================================================

function renderPlaylistSlots() {
  playlistSlotsEl.innerHTML = '';
  state.playlists.forEach((pl, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'playlist-slot-btn' + (idx === state.activePlaylistIndex ? ' active' : '');

    const nameSpan = document.createElement('span');
    const isPlayingHere = idx === state.playingPlaylistIndex && state.currentTrackIndex >= 0 && !audioEl.paused;
    nameSpan.textContent = (isPlayingHere ? '▶ ' : '') + pl.name;

    const countSpan = document.createElement('span');
    countSpan.className = 'playlist-slot-count';
    countSpan.textContent = `${pl.tracks.length}`;

    btn.appendChild(nameSpan);
    btn.appendChild(countSpan);

    btn.addEventListener('click', () => {
      state.activePlaylistIndex = idx;
      renderAll();
      saveAppState();
    });

    playlistSlotsEl.appendChild(btn);
  });
}

function resolveCoverArtForTrack(playlist, track) {
  if (track && track.coverUrl) return track.coverUrl;
  if (playlist && playlist.coverUrl) return playlist.coverUrl;
  return DEFAULT_COVER_URL;
}

function renderNowPlaying() {
  const pl = getPlayingPlaylist();
  const track = getCurrentTrack();

  if (!track) {
    const activePl = getActivePlaylist();
    nowPlayingPlaylistEl.textContent = activePl.name;
    nowPlayingTitleEl.textContent = 'No track playing';
    nowPlayingFormatEl.textContent = 'Supported formats: OGG / WAV / MP3 / YT Music';
    coverArtImg.src = resolveCoverArtForTrack(activePl, null);
    return;
  }

  let displayTrackNum = state.currentTrackIndex + 1;
  if (state.shuffle) {
    const order = ensurePlaylistShuffleOrder(pl, false, state.currentTrackIndex);
    const pos = order.indexOf(state.currentTrackIndex);
    if (pos >= 0) displayTrackNum = pos + 1;
  }

  nowPlayingPlaylistEl.textContent = `${pl.name} • Track ${displayTrackNum} of ${pl.tracks.length}${state.shuffle ? ' (Shuffled)' : ''}`;
  nowPlayingTitleEl.textContent = track.name;
  nowPlayingFormatEl.textContent = `Format: ${track.format} (${track.fileName})`;
  coverArtImg.src = resolveCoverArtForTrack(pl, track);
}

let draggedTrackDisplayPos = null;

function moveTrackInCurrentOrder(playlistIdx, fromDisplayPos, toDisplayPos) {
  const pl = state.playlists[playlistIdx];
  if (!pl || pl.tracks.length < 2) return;
  if (
    fromDisplayPos === toDisplayPos ||
    fromDisplayPos < 0 ||
    toDisplayPos < 0 ||
    fromDisplayPos >= pl.tracks.length ||
    toDisplayPos >= pl.tracks.length
  ) {
    return;
  }

  if (state.shuffle) {
    const order = ensurePlaylistShuffleOrder(
      pl,
      false,
      playlistIdx === state.playingPlaylistIndex ? state.currentTrackIndex : -1
    );
    const [movedTrackIdx] = order.splice(fromDisplayPos, 1);
    order.splice(toDisplayPos, 0, movedTrackIdx);
    pl.shuffleOrder = order;

    if (playlistIdx === state.playingPlaylistIndex) {
      state.shuffleOrder = order.slice();
      const curPos = state.shuffleOrder.indexOf(state.currentTrackIndex);
      if (curPos !== -1) state.shuffleCursor = curPos;
    }

    const movedTrack = pl.tracks[movedTrackIdx];
    setStatus(
      `Moved "${movedTrack ? movedTrack.name : 'track'}" to shuffled position #${toDisplayPos + 1}.`
    );
  } else {
    const playingTrackRef =
      playlistIdx === state.playingPlaylistIndex && state.currentTrackIndex >= 0
        ? pl.tracks[state.currentTrackIndex]
        : null;

    const [movedTrack] = pl.tracks.splice(fromDisplayPos, 1);
    pl.tracks.splice(toDisplayPos, 0, movedTrack);
    pl.shuffleOrder = [];

    if (playingTrackRef) {
      state.currentTrackIndex = pl.tracks.indexOf(playingTrackRef);
    }

    setStatus(`Moved "${movedTrack ? movedTrack.name : 'track'}" to position #${toDisplayPos + 1}.`);
  }

  renderAll();
  saveAppState();
}

function renderTracklist() {
  const activePl = getActivePlaylist();
  activePlaylistHeading.textContent = `${activePl.name} Tracks (${activePl.tracks.length})${
    state.shuffle ? ' [SHUFFLED ORDER]' : ''
  }`;

  tracklistBody.innerHTML = '';

  if (activePl.tracks.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent =
      'No tracks in this playlist. Click "Import Folder", "Import from YT Music...", or "Add Audio Files..." to add music.';
    tr.appendChild(td);
    tracklistBody.appendChild(tr);
    return;
  }

  // Determine display order: shuffled order when Shuffle is ON, natural order when Shuffle is OFF
  const displayIndices = state.shuffle
    ? ensurePlaylistShuffleOrder(
        activePl,
        false,
        state.activePlaylistIndex === state.playingPlaylistIndex ? state.currentTrackIndex : -1
      )
    : Array.from({ length: activePl.tracks.length }, (_, i) => i);

  displayIndices.forEach((realIdx, displayPos) => {
    const track = activePl.tracks[realIdx];
    if (!track) return;

    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.dataset.displayPos = String(displayPos);
    const isCurrentTrack =
      state.activePlaylistIndex === state.playingPlaylistIndex && realIdx === state.currentTrackIndex;
    if (isCurrentTrack) {
      tr.className = 'playing-row';
    }

    tr.addEventListener('dragstart', (e) => {
      draggedTrackDisplayPos = displayPos;
      tr.classList.add('dragging-row');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(displayPos));
      }
    });

    tr.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedTrackDisplayPos === null || draggedTrackDisplayPos === displayPos) return;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      tr.classList.add('drag-over-row');
    });

    tr.addEventListener('dragleave', () => {
      tr.classList.remove('drag-over-row');
    });

    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      tr.classList.remove('drag-over-row');
      if (draggedTrackDisplayPos !== null && draggedTrackDisplayPos !== displayPos) {
        moveTrackInCurrentOrder(state.activePlaylistIndex, draggedTrackDisplayPos, displayPos);
      }
      draggedTrackDisplayPos = null;
    });

    tr.addEventListener('dragend', () => {
      draggedTrackDisplayPos = null;
      tracklistBody.querySelectorAll('tr').forEach((row) => {
        row.classList.remove('dragging-row', 'drag-over-row');
      });
    });

    // # column (shows position in current playback order + drag grip)
    const tdIndex = document.createElement('td');
    const gripSpan = document.createElement('span');
    gripSpan.className = 'track-drag-grip';
    gripSpan.textContent = '::';
    gripSpan.title = 'Drag row up or down to reorder';
    tdIndex.appendChild(gripSpan);

    const numSpan = document.createElement('span');
    numSpan.textContent = isCurrentTrack && !audioEl.paused ? '▶' : String(displayPos + 1);
    tdIndex.appendChild(numSpan);

    if (state.shuffle) {
      tdIndex.title = `Shuffled position #${displayPos + 1} (Original track #${realIdx + 1}) — drag to reorder`;
    } else {
      tdIndex.title = `Track #${displayPos + 1} — drag to reorder`;
    }
    tr.appendChild(tdIndex);

    // Cover thumb column
    const tdCover = document.createElement('td');
    const img = document.createElement('img');
    img.className = 'track-thumb';
    img.src = resolveCoverArtForTrack(activePl, track);
    img.alt = '';
    tdCover.appendChild(img);
    tr.appendChild(tdCover);

    // Title column
    const tdTitle = document.createElement('td');
    tdTitle.textContent = track.name;
    tr.appendChild(tdTitle);

    // Format column
    const tdFormat = document.createElement('td');
    tdFormat.textContent = track.format;
    tr.appendChild(tdFormat);

    // Actions column
    const tdActions = document.createElement('td');
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'row-actions';

    const btnMoveUp = document.createElement('button');
    btnMoveUp.type = 'button';
    btnMoveUp.className = 'nocturnal-box-fill';
    btnMoveUp.textContent = '▲';
    btnMoveUp.title = 'Move track up';
    btnMoveUp.disabled = displayPos === 0;
    btnMoveUp.addEventListener('click', (e) => {
      e.stopPropagation();
      moveTrackInCurrentOrder(state.activePlaylistIndex, displayPos, displayPos - 1);
    });

    const btnMoveDown = document.createElement('button');
    btnMoveDown.type = 'button';
    btnMoveDown.className = 'nocturnal-box-fill';
    btnMoveDown.textContent = '▼';
    btnMoveDown.title = 'Move track down';
    btnMoveDown.disabled = displayPos === displayIndices.length - 1;
    btnMoveDown.addEventListener('click', (e) => {
      e.stopPropagation();
      moveTrackInCurrentOrder(state.activePlaylistIndex, displayPos, displayPos + 1);
    });

    const btnCover = document.createElement('button');
    btnCover.type = 'button';
    btnCover.className = 'nocturnal-box-fill';
    btnCover.textContent = 'Set Cover';
    btnCover.title = 'Upload custom cover art for this track';
    btnCover.addEventListener('click', (e) => {
      e.stopPropagation();
      promptCoverArtForTrack(state.activePlaylistIndex, realIdx);
    });

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'nocturnal-box-outline';
    btnRemove.textContent = 'Remove';
    btnRemove.title = 'Remove track from playlist';
    btnRemove.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTrackFromPlaylist(state.activePlaylistIndex, realIdx);
    });

    actionsDiv.appendChild(btnMoveUp);
    actionsDiv.appendChild(btnMoveDown);
    actionsDiv.appendChild(btnCover);
    actionsDiv.appendChild(btnRemove);
    tdActions.appendChild(actionsDiv);
    tr.appendChild(tdActions);

    tr.addEventListener('click', () => {
      playTrack(state.activePlaylistIndex, realIdx);
    });

    tracklistBody.appendChild(tr);
  });
}

function renderAll() {
  renderPlaylistSlots();
  renderNowPlaying();
  renderTracklist();
  renderLyricsPanel(false);
  updateMiniPlayerUI();
  syncMediaSession(getCurrentTrack());
}

// ==========================================================================
// PLAYBACK LOGIC
// ==========================================================================

function playTrack(playlistIdx, trackIdx) {
  const pl = state.playlists[playlistIdx];
  if (!pl || trackIdx < 0 || trackIdx >= pl.tracks.length) return;

  state.playingPlaylistIndex = playlistIdx;
  state.currentTrackIndex = trackIdx;

  if (state.shuffle) {
    const order = ensurePlaylistShuffleOrder(pl, false, trackIdx);
    state.shuffleOrder = order;
    const pos = order.indexOf(trackIdx);
    state.shuffleCursor = pos >= 0 ? pos : 0;
  }

  const track = pl.tracks[trackIdx];
  ensureAudioAnalyser();

  audioEl.src = track.url;
  audioEl.play().then(() => {
    btnPlayPause.textContent = 'Pause';
    renderAll();
    syncDiscordPresence();
    if (window.NocturnalAPI) {
      window.NocturnalAPI.emit('trackChange', { track, playlistName: pl.name });
      window.NocturnalAPI.emit('play', track);
    }
  }).catch((err) => {
    setStatus(`Playback error: ${err.message}`);
  });
}

function togglePlayPause() {
  if (!getCurrentTrack()) {
    const activePl = getActivePlaylist();
    if (activePl.tracks.length > 0) {
      if (state.shuffle) {
        const order = ensurePlaylistShuffleOrder(activePl, false);
        state.shuffleOrder = order.slice();
        state.shuffleCursor = 0;
        playTrack(state.activePlaylistIndex, state.shuffleOrder[0]);
      } else {
        playTrack(state.activePlaylistIndex, 0);
      }
    } else {
      setStatus('No tracks in current playlist to play.');
    }
    return;
  }

  ensureAudioAnalyser();
  if (audioEl.paused) {
    audioEl.play();
    btnPlayPause.textContent = 'Pause';
    if (window.NocturnalAPI) window.NocturnalAPI.emit('play', getCurrentTrack());
  } else {
    audioEl.pause();
    btnPlayPause.textContent = 'Play';
    if (window.NocturnalAPI) window.NocturnalAPI.emit('pause', getCurrentTrack());
  }
  renderAll();
  syncDiscordPresence();
}

function stopPlayback() {
  audioEl.pause();
  audioEl.currentTime = 0;
  btnPlayPause.textContent = 'Play';
  if (window.NocturnalAPI) window.NocturnalAPI.emit('stop', null);
  renderVisualizerFrame();
  renderAll();
  syncDiscordPresence();
}

function playNextTrack(isAutoEnded = false) {
  const pl = getPlayingPlaylist();
  if (!pl || pl.tracks.length === 0) return;

  if (isAutoEnded && state.loopMode === 'one') {
    audioEl.currentTime = 0;
    audioEl.play();
    syncDiscordPresence();
    return;
  }

  if (state.shuffle) {
    const order = ensurePlaylistShuffleOrder(pl, false, state.currentTrackIndex);
    state.shuffleOrder = order.slice();
    const currentPos = state.shuffleOrder.indexOf(state.currentTrackIndex);
    if (currentPos !== -1) state.shuffleCursor = currentPos;

    const isAtEnd = state.shuffleCursor + 1 >= state.shuffleOrder.length;
    if (isAutoEnded && isAtEnd && state.loopMode === 'off') {
      stopPlayback();
      return;
    }
    state.shuffleCursor = (state.shuffleCursor + 1) % state.shuffleOrder.length;
    const nextIdx = state.shuffleOrder[state.shuffleCursor];
    playTrack(state.playingPlaylistIndex, nextIdx);
  } else {
    const isAtEnd = state.currentTrackIndex + 1 >= pl.tracks.length;
    if (isAutoEnded && isAtEnd && state.loopMode === 'off') {
      stopPlayback();
      return;
    }
    const nextIdx = (state.currentTrackIndex + 1) % pl.tracks.length;
    playTrack(state.playingPlaylistIndex, nextIdx);
  }
}

function playPrevTrack() {
  const pl = getPlayingPlaylist();
  if (!pl || pl.tracks.length === 0) return;

  if (audioEl.currentTime > 3) {
    audioEl.currentTime = 0;
    syncDiscordPresence();
    return;
  }

  if (state.shuffle) {
    const order = ensurePlaylistShuffleOrder(pl, false, state.currentTrackIndex);
    state.shuffleOrder = order.slice();
    const currentPos = state.shuffleOrder.indexOf(state.currentTrackIndex);
    if (currentPos !== -1) state.shuffleCursor = currentPos;

    state.shuffleCursor =
      (state.shuffleCursor - 1 + state.shuffleOrder.length) % state.shuffleOrder.length;
    const prevIdx = state.shuffleOrder[state.shuffleCursor];
    playTrack(state.playingPlaylistIndex, prevIdx);
  } else {
    const prevIdx = (state.currentTrackIndex - 1 + pl.tracks.length) % pl.tracks.length;
    playTrack(state.playingPlaylistIndex, prevIdx);
  }
}

function removeTrackFromPlaylist(playlistIdx, trackIdx) {
  const pl = state.playlists[playlistIdx];
  if (!pl) return;

  pl.tracks.splice(trackIdx, 1);

  if (Array.isArray(pl.shuffleOrder)) {
    pl.shuffleOrder = pl.shuffleOrder
      .filter((idx) => idx !== trackIdx)
      .map((idx) => (idx > trackIdx ? idx - 1 : idx));
  }

  if (playlistIdx === state.playingPlaylistIndex) {
    if (pl.tracks.length === 0) {
      stopPlayback();
      audioEl.removeAttribute('src');
      state.currentTrackIndex = -1;
      state.shuffleOrder = [];
      state.shuffleCursor = 0;
    } else if (trackIdx < state.currentTrackIndex) {
      state.currentTrackIndex -= 1;
    } else if (trackIdx === state.currentTrackIndex) {
      state.currentTrackIndex = Math.min(state.currentTrackIndex, pl.tracks.length - 1);
      playTrack(playlistIdx, state.currentTrackIndex);
    }
    if (state.shuffle && pl.tracks.length > 0) {
      const order = ensurePlaylistShuffleOrder(pl, false, state.currentTrackIndex);
      state.shuffleOrder = order.slice();
      const pos = state.shuffleOrder.indexOf(state.currentTrackIndex);
      state.shuffleCursor = pos !== -1 ? pos : 0;
    }
  }

  renderAll();
  saveAppState();
}

// ==========================================================================
// COVER ART, LYRICS, FOLDER & YT MUSIC IMPORTING
// ==========================================================================

async function promptCoverArtForTrack(playlistIdx, trackIdx) {
  const pl = state.playlists[playlistIdx];
  if (!pl || !pl.tracks[trackIdx]) return;

  if (window.musicAPI && window.musicAPI.selectCoverArt) {
    const coverUrl = await window.musicAPI.selectCoverArt();
    if (coverUrl) {
      pl.tracks[trackIdx].coverUrl = coverUrl;
      setStatus(`Updated cover art for "${pl.tracks[trackIdx].name}".`);
      renderAll();
      syncDiscordPresence();
      saveAppState();
    }
  } else {
    pendingCoverTarget = { type: 'track', playlistIdx, trackIdx };
    fallbackCoverInput.value = '';
    fallbackCoverInput.click();
  }
}

async function promptCoverArtForPlaylist(playlistIdx) {
  const pl = state.playlists[playlistIdx];
  if (!pl) return;

  if (window.musicAPI && window.musicAPI.selectCoverArt) {
    const coverUrl = await window.musicAPI.selectCoverArt();
    if (coverUrl) {
      pl.coverUrl = coverUrl;
      setStatus(`Set fallback cover art for "${pl.name}".`);
      renderAll();
      saveAppState();
    }
  } else {
    pendingCoverTarget = { type: 'playlist', playlistIdx };
    fallbackCoverInput.value = '';
    fallbackCoverInput.click();
  }
}

async function handleFolderImport() {
  const activePl = getActivePlaylist();

  if (window.musicAPI && window.musicAPI.selectFolder) {
    const result = await window.musicAPI.selectFolder();
    if (!result) return;

    if (result.tracks.length === 0) {
      setStatus(`No MP3, WAV, or OGG files found in "${result.folderName}".`);
      return;
    }

    activePl.tracks = result.tracks;
    if (result.folderCoverUrl && !activePl.coverUrl) {
      activePl.coverUrl = result.folderCoverUrl;
    }
    if (activePl.name === `Playlist ${state.activePlaylistIndex + 1}` && result.folderName) {
      activePl.name = result.folderName.slice(0, 32);
    }

    if (state.playingPlaylistIndex === state.activePlaylistIndex) {
      state.currentTrackIndex = -1;
      if (state.shuffle) rebuildShuffleOrder(activePl.tracks.length);
    }

    setStatus(`Imported ${result.tracks.length} track(s) from "${result.folderName}".`);
    renderAll();
    saveAppState();
  } else {
    fallbackFolderInput.value = '';
    fallbackFolderInput.click();
  }
}

async function handleAddAudioFiles() {
  const activePl = getActivePlaylist();

  if (window.musicAPI && window.musicAPI.selectAudioFiles) {
    const tracks = await window.musicAPI.selectAudioFiles();
    if (!tracks || tracks.length === 0) return;

    activePl.tracks.push(...tracks);
    if (state.playingPlaylistIndex === state.activePlaylistIndex && state.shuffle) {
      rebuildShuffleOrder(activePl.tracks.length, state.currentTrackIndex);
    }

    setStatus(`Added ${tracks.length} audio file(s) to "${activePl.name}".`);
    renderAll();
    saveAppState();
  } else {
    fallbackFilesInput.value = '';
    fallbackFilesInput.click();
  }
}

// Lyrics Buttons
btnFetchLyrics.addEventListener('click', () => {
  fetchLyricsForCurrentTrack(true);
});

btnLoadLrc.addEventListener('click', async () => {
  const track = getCurrentTrack();
  if (!track) {
    setStatus('Play or select a track first before loading a .LRC file.');
    return;
  }

  if (window.musicAPI && window.musicAPI.selectLrcFile) {
    const parsed = await window.musicAPI.selectLrcFile();
    if (parsed && Array.isArray(parsed.lines) && parsed.lines.length > 0) {
      track.lyrics = parsed;
      renderLyricsPanel(true);
      await saveAppState();
      setStatus(`Loaded ${parsed.synced ? 'timed' : 'plain'} lyrics for "${track.name}".`);
    }
  } else {
    fallbackLrcInput.value = '';
    fallbackLrcInput.click();
  }
});

fallbackLrcInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  const track = getCurrentTrack();
  if (!file || !track) return;
  const text = await file.text();
  track.lyrics = parseLrcInBrowser(text);
  renderLyricsPanel(true);
  setStatus(`Loaded lyrics from "${file.name}".`);
});

if (btnClearLyrics) {
  btnClearLyrics.addEventListener('click', async () => {
    const track = getCurrentTrack();
    if (!track) {
      setStatus('Play or select a track first.');
      return;
    }
    track.lyrics = null;
    if (window.musicAPI && window.musicAPI.deleteLocalLyrics && track.path) {
      try {
        await window.musicAPI.deleteLocalLyrics(track.path);
      } catch (_) {}
    }
    renderLyricsPanel(true);
    await saveAppState();
    setStatus(`Cleared lyrics for "${track.name}".`);
  });
}

// Desktop & Start Menu Shortcuts Button
btnCreateShortcuts.addEventListener('click', async () => {
  if (!window.musicAPI || !window.musicAPI.createShortcuts) {
    setStatus('Shortcut installer is only available in the desktop app.');
    return;
  }
  try {
    btnCreateShortcuts.disabled = true;
    setStatus('Creating Desktop and Start Menu shortcuts for Nocturnal player...');
    await window.musicAPI.createShortcuts();
    setStatus('Created "Nocturnal player" shortcuts on Desktop and Start Menu!');
  } catch (err) {
    setStatus(`Shortcut error: ${err.message || err}`);
  } finally {
    btnCreateShortcuts.disabled = false;
  }
});

// YouTube Music Importing
btnImportYtm.addEventListener('click', () => {
  if (!window.musicAPI || !window.musicAPI.importFromYTMusic) {
    setStatus('YT Music import requires running the Electron desktop app (npm start).');
    return;
  }
  ytmUrlInput.value = '';
  ytmProgressBox.hidden = true;
  ytmProgressText.textContent = '';
  ytmSubmit.disabled = false;
  ytmCancel.disabled = false;
  ytmDialog.showModal();
  ytmUrlInput.focus();
});

ytmCancel.addEventListener('click', () => {
  ytmDialog.close();
});

ytmForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = ytmUrlInput.value.trim();
  if (!query) return;

  const format = ytmFormatSelect.value;
  const useThumbnail = ytmCoverCheckbox.checked;

  ytmSubmit.disabled = true;
  ytmCancel.disabled = true;
  ytmProgressBox.hidden = false;
  ytmProgressText.textContent = 'Starting YT Music import & timed lyrics lookup...';

  const unsubscribe = window.musicAPI.onYTMusicProgress((msg) => {
    ytmProgressText.textContent = msg;
    setStatus(msg);
  });

  try {
    const result = await window.musicAPI.importFromYTMusic({
      query,
      format,
      useThumbnail
    });

    if (result && Array.isArray(result.tracks) && result.tracks.length > 0) {
      const activePl = getActivePlaylist();
      activePl.tracks.push(...result.tracks);
      if (state.playingPlaylistIndex === state.activePlaylistIndex && state.shuffle) {
        rebuildShuffleOrder(activePl.tracks.length, state.currentTrackIndex);
      }
      setStatus(`Imported ${result.tracks.length} track(s) from YT Music into "${activePl.name}".`);
      renderAll();
      await saveAppState();
      ytmDialog.close();
    } else {
      ytmProgressText.textContent = 'No tracks were found for that YT Music link/query.';
    }
  } catch (err) {
    ytmProgressText.textContent = `Error: ${err.message || err}`;
    setStatus(`YT Music import failed: ${err.message || err}`);
  } finally {
    unsubscribe();
    ytmSubmit.disabled = false;
    ytmCancel.disabled = false;
  }
});

// Browser Fallback File Input Listeners
fallbackFolderInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  const imageMap = new Map();
  let folderCoverUrl = null;
  let folderName = '';

  files.forEach((file) => {
    const extIdx = file.name.lastIndexOf('.');
    const ext = extIdx >= 0 ? file.name.slice(extIdx).toLowerCase() : '';
    const base = extIdx >= 0 ? file.name.slice(0, extIdx) : file.name;
    const lowerBase = base.toLowerCase();

    if (!folderName && file.webkitRelativePath) {
      folderName = file.webkitRelativePath.split('/')[0];
    }

    if (ALLOWED_IMAGE_EXTS.includes(ext)) {
      const url = URL.createObjectURL(file);
      imageMap.set(lowerBase, url);
      if (
        !folderCoverUrl &&
        ['cover', 'folder', 'album', 'front', 'art', 'artwork'].includes(lowerBase)
      ) {
        folderCoverUrl = url;
      }
    }
  });

  if (!folderCoverUrl && imageMap.size === 1) {
    folderCoverUrl = Array.from(imageMap.values())[0];
  }

  const audioTracks = [];
  files.forEach((file) => {
    const extIdx = file.name.lastIndexOf('.');
    const ext = extIdx >= 0 ? file.name.slice(extIdx).toLowerCase() : '';
    if (ALLOWED_AUDIO_EXTS.includes(ext)) {
      const base = file.name.slice(0, extIdx);
      audioTracks.push({
        name: base,
        fileName: file.name,
        format: ext.slice(1).toUpperCase(),
        url: URL.createObjectURL(file),
        coverUrl: imageMap.get(base.toLowerCase()) || null,
        lyrics: null
      });
    }
  });

  audioTracks.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));

  const activePl = getActivePlaylist();
  if (audioTracks.length === 0) {
    setStatus('No MP3, WAV, or OGG files found in the selected folder.');
    return;
  }

  activePl.tracks = audioTracks;
  if (folderCoverUrl && !activePl.coverUrl) {
    activePl.coverUrl = folderCoverUrl;
  }
  if (activePl.name === `Playlist ${state.activePlaylistIndex + 1}` && folderName) {
    activePl.name = folderName.slice(0, 32);
  }
  setStatus(`Imported ${audioTracks.length} track(s) from folder.`);
  renderAll();
});

fallbackFilesInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;

  const activePl = getActivePlaylist();
  let added = 0;

  files.forEach((file) => {
    const extIdx = file.name.lastIndexOf('.');
    const ext = extIdx >= 0 ? file.name.slice(extIdx).toLowerCase() : '';
    if (ALLOWED_AUDIO_EXTS.includes(ext)) {
      const base = file.name.slice(0, extIdx);
      activePl.tracks.push({
        name: base,
        fileName: file.name,
        format: ext.slice(1).toUpperCase(),
        url: URL.createObjectURL(file),
        coverUrl: null,
        lyrics: null
      });
      added++;
    }
  });

  setStatus(`Added ${added} audio file(s).`);
  renderAll();
});

fallbackCoverInput.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file || !pendingCoverTarget) return;

  const url = URL.createObjectURL(file);
  if (pendingCoverTarget.type === 'track') {
    const pl = state.playlists[pendingCoverTarget.playlistIdx];
    if (pl && pl.tracks[pendingCoverTarget.trackIdx]) {
      pl.tracks[pendingCoverTarget.trackIdx].coverUrl = url;
      setStatus(`Updated cover art for "${pl.tracks[pendingCoverTarget.trackIdx].name}".`);
    }
  } else if (pendingCoverTarget.type === 'playlist') {
    const pl = state.playlists[pendingCoverTarget.playlistIdx];
    if (pl) {
      pl.coverUrl = url;
      setStatus(`Set fallback cover art for "${pl.name}".`);
    }
  }
  pendingCoverTarget = null;
  renderAll();
});

// Event Listeners
btnImportFolder.addEventListener('click', handleFolderImport);
btnAddFiles.addEventListener('click', handleAddAudioFiles);
btnSetPlaylistCover.addEventListener('click', () => {
  promptCoverArtForPlaylist(state.activePlaylistIndex);
});

coverArtBox.addEventListener('click', () => {
  const current = getCurrentTrack();
  if (current) {
    promptCoverArtForTrack(state.playingPlaylistIndex, state.currentTrackIndex);
  } else {
    promptCoverArtForPlaylist(state.activePlaylistIndex);
  }
});

btnSetTrackCover.addEventListener('click', () => {
  const current = getCurrentTrack();
  if (current) {
    promptCoverArtForTrack(state.playingPlaylistIndex, state.currentTrackIndex);
  } else {
    promptCoverArtForPlaylist(state.activePlaylistIndex);
  }
});

btnClearTrackCover.addEventListener('click', () => {
  const current = getCurrentTrack();
  if (current && current.coverUrl) {
    current.coverUrl = null;
    setStatus(`Reset cover art for "${current.name}" to Nocturnal default.`);
  } else {
    const activePl = getActivePlaylist();
    activePl.coverUrl = null;
    setStatus(`Reset cover art for "${activePl.name}" to Nocturnal default.`);
  }
  renderAll();
  syncDiscordPresence();
  saveAppState();
});

btnRenamePlaylist.addEventListener('click', () => {
  const activePl = getActivePlaylist();
  renameInput.value = activePl.name;
  renameDialog.showModal();
  renameInput.focus();
  renameInput.select();
});

renameCancel.addEventListener('click', () => {
  renameDialog.close();
});

renameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const newName = renameInput.value.trim();
  if (newName) {
    getActivePlaylist().name = newName;
    renderAll();
    saveAppState();
  }
  renameDialog.close();
});

btnClearPlaylist.addEventListener('click', () => {
  const activePl = getActivePlaylist();
  activePl.tracks = [];
  activePl.coverUrl = null;
  if (state.playingPlaylistIndex === state.activePlaylistIndex) {
    stopPlayback();
    audioEl.removeAttribute('src');
    state.currentTrackIndex = -1;
  }
  setStatus(`Cleared "${activePl.name}".`);
  renderAll();
  saveAppState();
});

btnPlayPause.addEventListener('click', togglePlayPause);
btnStop.addEventListener('click', stopPlayback);
btnNext.addEventListener('click', () => playNextTrack(false));
btnPrev.addEventListener('click', playPrevTrack);

btnShuffle.addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  updateShuffleButton();

  if (state.shuffle) {
    // Generate a fresh shuffle order for all playlists that have tracks
    state.playlists.forEach((pl, idx) => {
      if (pl.tracks.length > 0) {
        const keepIdx = idx === state.playingPlaylistIndex ? state.currentTrackIndex : -1;
        ensurePlaylistShuffleOrder(pl, true, keepIdx);
      }
    });
    const playingPl = getPlayingPlaylist();
    if (playingPl && playingPl.tracks.length > 0) {
      state.shuffleOrder = playingPl.shuffleOrder;
      state.shuffleCursor = Math.max(0, state.shuffleOrder.indexOf(state.currentTrackIndex));
    }
  }

  renderAll();
  setStatus(
    state.shuffle
      ? 'Shuffle enabled — tracklist reordered to show shuffled queue.'
      : 'Shuffle disabled — tracklist restored to original order.'
  );
  syncDiscordPresence();
  saveAppState();
});

btnLoop.addEventListener('click', () => {
  if (state.loopMode === 'off') {
    state.loopMode = 'all';
  } else if (state.loopMode === 'all') {
    state.loopMode = 'one';
  } else {
    state.loopMode = 'off';
  }
  updateLoopButton();
  const label =
    state.loopMode === 'one' ? 'Loop 1 (Single Track)' : state.loopMode === 'all' ? 'Loop All (Playlist)' : 'Off';
  setStatus(`Loop mode: ${label}.`);
  syncDiscordPresence();
  saveAppState();
});

// Audio Element Events
audioEl.addEventListener('loadedmetadata', () => {
  totalTimeEl.textContent = formatTime(audioEl.duration);
  syncDiscordPresence();
});

audioEl.addEventListener('timeupdate', () => {
  currentTimeEl.textContent = formatTime(audioEl.currentTime);
  if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
    const pct = (audioEl.currentTime / audioEl.duration) * 100;
    seekBar.value = String(pct);
    if (miniProgressFill) miniProgressFill.style.width = `${pct}%`;
  }
  syncActiveLyricLine(audioEl.currentTime);
});

audioEl.addEventListener('ended', () => {
  playNextTrack(true);
});

seekBar.addEventListener('input', () => {
  if (Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
    audioEl.currentTime = (Number(seekBar.value) / 100) * audioEl.duration;
    syncActiveLyricLine(audioEl.currentTime);
    syncDiscordPresence();
  }
});

volumeBar.addEventListener('input', () => {
  audioEl.volume = Number(volumeBar.value);
});

// ==========================================================================
// THEMES & PLUGINS STUDIO (NIGHTLY EXTENSIONS ENGINE)
// ==========================================================================

const THEME_PRESETS = {
  default: {
    key: 'default',
    name: 'Default Nocturnal',
    containerStyle: 'classic',
    containerOpacity: '0.78',
    bgStyle: 'circuit',
    bgOpacity: '0.6',
    bgSpeed: 'normal',
    bgDeep: '#000000',
    bgSurface: '#121217',
    bgElevated: '#1a1a22',
    textPrimary: '#f2f2f7',
    textSecondary: '#b0b0be',
    accent: '#ffffff',
    borderSubtle: 'rgba(255, 255, 255, 0.22)',
    waveformColor: '#ffffff',
    waveformGlow: 'rgba(255, 255, 255, 0.6)',
    circuitFilter: 'none',
    circuitOpacity: '0.6'
  },
  amber: {
    key: 'amber',
    name: 'Amber CRT Terminal',
    containerStyle: 'rounded',
    containerOpacity: '0.85',
    bgStyle: 'scanlines',
    bgOpacity: '0.65',
    bgSpeed: 'normal',
    bgDeep: '#0e0902',
    bgSurface: '#191105',
    bgElevated: '#241a08',
    textPrimary: '#ffb833',
    textSecondary: '#d49522',
    accent: '#ffaa00',
    borderSubtle: 'rgba(255, 184, 51, 0.35)',
    waveformColor: '#ff9900',
    waveformGlow: 'rgba(255, 153, 0, 0.7)',
    circuitFilter: 'sepia(1) saturate(3) hue-rotate(5deg)',
    circuitOpacity: '0.5'
  },
  matrix: {
    key: 'matrix',
    name: 'Matrix Green',
    containerStyle: 'pixel',
    containerOpacity: '0.92',
    bgStyle: 'circuit',
    bgOpacity: '0.55',
    bgSpeed: 'fast',
    bgDeep: '#020a04',
    bgSurface: '#07160a',
    bgElevated: '#0d2612',
    textPrimary: '#33ff66',
    textSecondary: '#22cc44',
    accent: '#00ff55',
    borderSubtle: 'rgba(51, 255, 102, 0.35)',
    waveformColor: '#00ff44',
    waveformGlow: 'rgba(0, 255, 68, 0.7)',
    circuitFilter: 'hue-rotate(85deg) saturate(3)',
    circuitOpacity: '0.55'
  },
  neon: {
    key: 'neon',
    name: 'Cyber Neon / Synthwave',
    containerStyle: 'neon',
    containerOpacity: '0.88',
    bgStyle: 'cyber-grid',
    bgOpacity: '0.7',
    bgSpeed: 'normal',
    bgDeep: '#0a0314',
    bgSurface: '#140826',
    bgElevated: '#200c3b',
    textPrimary: '#00f0ff',
    textSecondary: '#ff007f',
    accent: '#00f0ff',
    borderSubtle: 'rgba(0, 240, 255, 0.4)',
    waveformColor: '#ff007f',
    waveformGlow: 'rgba(255, 0, 127, 0.8)',
    circuitFilter: 'hue-rotate(240deg) saturate(2.5)',
    circuitOpacity: '0.6'
  },
  blood: {
    key: 'blood',
    name: 'Blood Moon / Crimson',
    containerStyle: 'beveled',
    containerOpacity: '0.88',
    bgStyle: 'circuit',
    bgOpacity: '0.65',
    bgSpeed: 'slow',
    bgDeep: '#0d0204',
    bgSurface: '#1c0609',
    bgElevated: '#2b090f',
    textPrimary: '#ff4455',
    textSecondary: '#cc2233',
    accent: '#ff2233',
    borderSubtle: 'rgba(255, 51, 68, 0.4)',
    waveformColor: '#ff2233',
    waveformGlow: 'rgba(255, 34, 51, 0.8)',
    circuitFilter: 'hue-rotate(300deg) saturate(3)',
    circuitOpacity: '0.65'
  },
  amethyst: {
    key: 'amethyst',
    name: 'Amethyst Purple',
    containerStyle: 'beveled',
    containerOpacity: '0.85',
    bgStyle: 'starfield',
    bgOpacity: '0.6',
    bgSpeed: 'slow',
    bgDeep: '#090312',
    bgSurface: '#150926',
    bgElevated: '#220e3d',
    textPrimary: '#c084fc',
    textSecondary: '#a855f7',
    accent: '#d8b4fe',
    borderSubtle: 'rgba(192, 132, 252, 0.35)',
    waveformColor: '#a855f7',
    waveformGlow: 'rgba(168, 85, 247, 0.8)',
    circuitFilter: 'hue-rotate(210deg) saturate(2.2)',
    circuitOpacity: '0.55'
  }
};

function syncColorPickersWithTheme(themeObj) {
  if (!themeObj) return;
  if (pickerBgDeep && themeObj.bgDeep) pickerBgDeep.value = themeObj.bgDeep;
  if (pickerBgSurface && themeObj.bgSurface) pickerBgSurface.value = themeObj.bgSurface;
  if (pickerTextPrimary && themeObj.textPrimary) pickerTextPrimary.value = themeObj.textPrimary;
  if (pickerAccent && themeObj.accent) pickerAccent.value = themeObj.accent;
  if (pickerWaveform && themeObj.waveformColor) pickerWaveform.value = themeObj.waveformColor;
  if (pickerGlow && themeObj.waveformColor) pickerGlow.value = themeObj.waveformColor;
}

function ensureCustomThemeObject() {
  if (!state.theme) state.theme = { active: 'custom', custom: {} };
  if (!state.theme.custom) {
    const base = THEME_PRESETS[state.theme.active] || THEME_PRESETS.default;
    state.theme.custom = { ...base, key: 'custom', name: 'Custom Theme' };
  }
}

function applyTheme(keyOrData, save = true) {
  let themeObj = null;
  let key = 'custom';
  if (typeof keyOrData === 'string') {
    key = keyOrData;
    themeObj = THEME_PRESETS[key] || THEME_PRESETS.default;
  } else if (keyOrData && typeof keyOrData === 'object') {
    themeObj = keyOrData;
    key = themeObj.key || 'custom';
  } else {
    themeObj = THEME_PRESETS.default;
    key = 'default';
  }

  const root = document.documentElement;

  // 1. Container & Frame Style
  document.body.classList.remove(
    'container-style-classic',
    'container-style-beveled',
    'container-style-pixel',
    'container-style-rounded',
    'container-style-neon',
    'container-style-custom'
  );
  const containerStyle = themeObj.containerStyle || 'classic';
  document.body.classList.add(`container-style-${containerStyle}`);
  if (themeContainerStyleSelect) themeContainerStyleSelect.value = containerStyle;

  const containerOpacity = typeof themeObj.containerOpacity !== 'undefined' ? String(themeObj.containerOpacity) : '0.78';
  root.style.setProperty('--container-bg', `rgba(8, 8, 12, ${containerOpacity})`);
  if (sliderContainerOpacity) sliderContainerOpacity.value = containerOpacity;
  if (valContainerOpacity) valContainerOpacity.textContent = `${Math.round(parseFloat(containerOpacity) * 100)}%`;

  if (themeObj.containerCustomImage) {
    root.style.setProperty('--container-custom-border-image', `url("${themeObj.containerCustomImage}")`);
  } else {
    root.style.removeProperty('--container-custom-border-image');
  }
  if (btnUploadContainerFrame) {
    btnUploadContainerFrame.style.display = containerStyle === 'custom' ? 'block' : 'none';
  }

  // 2. Background Texture & Animation
  document.body.classList.remove(
    'bg-style-circuit',
    'bg-style-cyber-grid',
    'bg-style-scanlines',
    'bg-style-starfield',
    'bg-style-none',
    'bg-style-custom'
  );
  const bgStyle = themeObj.bgStyle || 'circuit';
  document.body.classList.add(`bg-style-${bgStyle}`);
  if (themeBgStyleSelect) themeBgStyleSelect.value = bgStyle;

  const bgOpacity = typeof themeObj.circuitOpacity !== 'undefined' ? String(themeObj.circuitOpacity) : (themeObj.bgOpacity ? String(themeObj.bgOpacity) : '0.6');
  root.style.setProperty('--circuit-opacity', bgOpacity);
  if (sliderBgOpacity) sliderBgOpacity.value = bgOpacity;
  if (valBgOpacity) valBgOpacity.textContent = `${Math.round(parseFloat(bgOpacity) * 100)}%`;

  const bgSpeed = themeObj.bgSpeed || 'normal';
  if (themeBgSpeedSelect) themeBgSpeedSelect.value = bgSpeed;
  let animDuration = '38s';
  if (bgSpeed === 'slow') animDuration = '65s';
  else if (bgSpeed === 'fast') animDuration = '18s';
  else if (bgSpeed === 'static') animDuration = '0s';
  root.style.setProperty('--bg-scroll-duration', animDuration);
  root.style.setProperty('--bg-animation', bgSpeed === 'static' ? 'none' : `nocturnalCircuitScrollDown ${animDuration} linear infinite`);

  if (themeObj.bgCustomImage) {
    root.style.setProperty('--bg-custom-image', `url("${themeObj.bgCustomImage}")`);
  } else {
    root.style.removeProperty('--bg-custom-image');
  }
  if (btnUploadBgImage) {
    btnUploadBgImage.style.display = bgStyle === 'custom' ? 'block' : 'none';
  }

  // 3. Colors
  if (themeObj.bgDeep) root.style.setProperty('--bg-deep', themeObj.bgDeep);
  if (themeObj.bgSurface) root.style.setProperty('--bg-surface', themeObj.bgSurface);
  if (themeObj.bgElevated) root.style.setProperty('--bg-elevated', themeObj.bgElevated);
  if (themeObj.textPrimary) root.style.setProperty('--text-primary', themeObj.textPrimary);
  if (themeObj.textSecondary) root.style.setProperty('--text-secondary', themeObj.textSecondary);
  if (themeObj.accent) {
    root.style.setProperty('--accent-white', themeObj.accent);
    root.style.setProperty('--border-subtle', themeObj.borderSubtle || (themeObj.accent + '44'));
  }
  if (themeObj.waveformColor) root.style.setProperty('--waveform-color', themeObj.waveformColor);
  if (themeObj.waveformGlow) root.style.setProperty('--waveform-glow', themeObj.waveformGlow);
  if (themeObj.circuitFilter) root.style.setProperty('--circuit-filter', themeObj.circuitFilter);

  activeThemeColors.waveformColor = themeObj.waveformColor || '#ffffff';
  activeThemeColors.waveformGlow = themeObj.waveformGlow || 'rgba(255, 255, 255, 0.6)';
  activeThemeColors.accent = themeObj.accent || '#ffffff';

  state.theme = {
    active: key,
    custom: key === 'custom' ? themeObj : (state.theme && state.theme.custom) || null
  };

  if (themePresetSelect) themePresetSelect.value = key;
  syncColorPickersWithTheme(themeObj);
  renderVisualizerFrame();
  if (save) saveAppState();
}

function showNocturnalToast(title, message, durationMs = 3500) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'nocturnal-toast nocturnal-box-outline';
  toast.innerHTML = `
    <div class="toast-icon">⚡</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-msg">${escapeHtml(message)}</div>
    </div>
  `;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 320);
  }, durationMs);
}

const pluginEventHandlers = {};
const customVisualizers = {};
let bassFilter = null;
let isBassBoosted = false;

function ensureVisualizerToggleButton(id, name) {
  let btn = document.getElementById(`btn-vis-${id}`);
  if (!btn && pluginVisToggles) {
    btn = document.createElement('button');
    btn.id = `btn-vis-${id}`;
    btn.type = 'button';
    btn.className = 'vis-toggle-btn nocturnal-box-fill';
    btn.textContent = name;
    btn.title = `Toggle ${name} Visualizer`;
    btn.setAttribute('aria-pressed', String(Boolean(state.visualizers[id])));
    btn.addEventListener('click', () => {
      state.visualizers[id] = !state.visualizers[id];
      btn.setAttribute('aria-pressed', String(state.visualizers[id]));
      renderVisualizerFrame();
      saveAppState();
    });
    pluginVisToggles.appendChild(btn);
  }
  if (btn) {
    btn.setAttribute('aria-pressed', String(Boolean(state.visualizers[id])));
  }
}

function ensurePlaybackButton(id, label, onClick) {
  let btn = document.getElementById(`btn-plugin-play-${id}`);
  if (!btn && pluginPlaybackButtons) {
    btn = document.createElement('button');
    btn.id = `btn-plugin-play-${id}`;
    btn.type = 'button';
    btn.className = 'nocturnal-box-fill plugin-playback-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    pluginPlaybackButtons.appendChild(btn);
  }
}

window.NocturnalAPI = {
  version: '1.2.0-nightly',
  on(event, fn) {
    if (!pluginEventHandlers[event]) pluginEventHandlers[event] = [];
    pluginEventHandlers[event].push(fn);
    return () => {
      pluginEventHandlers[event] = pluginEventHandlers[event].filter(h => h !== fn);
    };
  },
  emit(event, data) {
    const handlers = pluginEventHandlers[event];
    if (handlers) {
      for (const h of handlers) {
        try { h(data); } catch (e) { console.error(`[Plugin Event ${event}]`, e); }
      }
    }
  },
  visualizer: {
    register({ id, name, render }) {
      if (!id || typeof render !== 'function') return;
      customVisualizers[id] = { id, name: name || id.toUpperCase(), render };
      ensureVisualizerToggleButton(id, name || id.toUpperCase());
    },
    unregister(id) {
      delete customVisualizers[id];
      const btn = document.getElementById(`btn-vis-${id}`);
      if (btn) btn.remove();
    }
  },
  audio: {
    get context() { return audioCtx; },
    get analyser() { return analyser; },
    get element() { return audioEl; },
    setBassBoost(enabled) {
      isBassBoosted = Boolean(enabled);
      if (bassFilter) {
        bassFilter.gain.value = isBassBoosted ? 9.0 : 0.0;
      }
    },
    isBassBoosted() { return isBassBoosted; }
  },
  ui: {
    showToast(title, message, durationMs = 3500) {
      showNocturnalToast(title, message, durationMs);
    },
    addPlaybackButton(id, label, onClick) {
      ensurePlaybackButton(id, label, onClick);
    },
    removePlaybackButton(id) {
      const el = document.getElementById(`btn-plugin-play-${id}`);
      if (el) el.remove();
    }
  },
  storage: {
    get(key, def) {
      try {
        const val = localStorage.getItem(`nocturnal_plugin_${key}`);
        return val ? JSON.parse(val) : def;
      } catch (_) { return def; }
    },
    set(key, val) {
      try {
        localStorage.setItem(`nocturnal_plugin_${key}`, JSON.stringify(val));
      } catch (_) {}
    }
  }
};

// 1. Matrix Rain Visualizer Plugin
const MatrixRainPlugin = {
  manifest: {
    id: 'matrix-rain',
    name: 'Matrix Rain Visualizer',
    version: '1.0.0',
    tag: 'BUILT-IN',
    author: 'Nocturnal Team',
    description: 'Dynamic audio-reactive falling katakana & digital rain that pulses with bass beats and flashes with frequency peaks.'
  },
  drops: [],
  init(api) {
    const chars = '0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ';
    const self = this;
    api.visualizer.register({
      id: 'matrix',
      name: 'MATRIX',
      render: (ctx, vx, vy, vw, vh, isPaused, data) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(vx, vy, vw, vh);
        ctx.clip();

        let bass = 0;
        let high = 0;
        if (!isPaused && data.freqData) {
          let bSum = 0;
          for (let i = 0; i < 8; i++) bSum += data.freqData[i];
          bass = (bSum / (8 * 255)) * (data.sensitivity || 0.7);

          let hSum = 0;
          for (let i = 24; i < 48; i++) hSum += data.freqData[i];
          high = (hSum / (24 * 255)) * (data.sensitivity || 0.7);
        }

        const fontSize = Math.max(10, Math.min(14, Math.floor(vw / 36)));
        const cols = Math.floor(vw / fontSize);
        while (self.drops.length < cols) {
          self.drops.push(Math.random() * -30);
        }

        ctx.fillStyle = 'rgba(2, 6, 3, 0.28)';
        ctx.fillRect(vx, vy, vw, vh);

        ctx.font = `${fontSize}px "NocturnalJP", monospace`;
        const speed = isPaused ? 0.3 : (0.55 + bass * 1.8);

        for (let i = 0; i < cols; i++) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          const x = vx + i * fontSize;
          const y = vy + self.drops[i] * fontSize;

          if (y > vy && y < vy + vh) {
            ctx.fillStyle = (high > 0.35 && Math.random() < 0.2) ? '#ffffff' : (bass > 0.4 ? '#88ffaa' : '#33ff77');
            ctx.shadowColor = '#00ff55';
            ctx.shadowBlur = bass > 0.3 ? 8 : 4;
            ctx.fillText(char, x, y);

            const prevChar = chars[Math.floor(Math.random() * chars.length)];
            ctx.fillStyle = '#00aa33';
            ctx.shadowBlur = 0;
            ctx.fillText(prevChar, x, y - fontSize);
          }

          if (y > vy + vh && Math.random() > 0.96) {
            self.drops[i] = 0;
          }
          self.drops[i] += speed * (0.8 + (i % 5) * 0.1);
        }

        ctx.restore();
      }
    });
  },
  destroy(api) {
    api.visualizer.unregister('matrix');
  }
};

// 2. Rainbow Spectrum Equalizer Plugin
const RainbowSpectrumPlugin = {
  manifest: {
    id: 'rainbow-spectrum',
    name: 'Rainbow Spectrum Equalizer',
    version: '1.0.0',
    tag: 'BUILT-IN',
    author: 'Nocturnal Team',
    description: 'High-res retro 48-band chromatic rainbow equalizer with peak hold caps and smooth dynamic decay.'
  },
  peaks: new Float32Array(64),
  init(api) {
    const self = this;
    api.visualizer.register({
      id: 'rainbow',
      name: 'RAINBOW',
      render: (ctx, vx, vy, vw, vh, isPaused, data) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(vx, vy, vw, vh);
        ctx.clip();

        const barCount = Math.min(48, Math.max(16, Math.floor(vw / 8)));
        const gap = 2;
        const totalGap = gap * (barCount - 1);
        const barWidth = Math.max(2, (vw - 8 - totalGap) / barCount);
        const startX = vx + 4;
        const bottomY = vy + vh - 4;
        const maxH = Math.max(10, vh - 12);
        const sens = data.sensitivity || 0.7;

        for (let i = 0; i < barCount; i++) {
          let norm = 0;
          if (!isPaused && data.freqData) {
            const bin = Math.min(data.freqData.length - 1, Math.floor(Math.pow(i / barCount, 1.4) * (data.freqData.length * 0.7)));
            norm = Math.min(1, (data.freqData[bin] / 255.0) * sens);
          }

          const h = Math.max(2, norm * maxH);
          if (h > self.peaks[i]) {
            self.peaks[i] = h;
          } else {
            self.peaks[i] = Math.max(2, self.peaks[i] - 0.9);
          }

          const bx = startX + i * (barWidth + gap);
          const by = bottomY - h;
          const hue = Math.floor((i / barCount) * 310);

          ctx.fillStyle = isPaused ? `hsla(${hue}, 80%, 50%, 0.3)` : `hsl(${hue}, 95%, 55%)`;
          ctx.fillRect(bx, by, barWidth, h);

          if (!isPaused) {
            const py = Math.max(vy + 2, bottomY - self.peaks[i] - 2);
            ctx.fillStyle = `hsl(${hue}, 100%, 85%)`;
            ctx.fillRect(bx, py, barWidth, 2);
          }
        }

        ctx.restore();
      }
    });
  },
  destroy(api) {
    api.visualizer.unregister('rainbow');
  }
};

// 3. Bass Booster Audio FX Plugin
const BassBoosterPlugin = {
  manifest: {
    id: 'bass-booster',
    name: 'Bass Booster Audio FX',
    version: '1.0.0',
    tag: 'BUILT-IN',
    author: 'Nocturnal Team',
    description: 'Hardware-calibrated low-shelf equalizer filter (+9dB @ 85Hz) to inject deep, punchy sub-bass with zero clipping.'
  },
  enabled: false,
  init(api) {
    const self = this;
    api.ui.addPlaybackButton('bass-boost', 'BASS: OFF', () => {
      self.enabled = !self.enabled;
      api.audio.setBassBoost(self.enabled);
      const btn = document.getElementById('btn-plugin-play-bass-boost');
      if (btn) {
        btn.textContent = self.enabled ? 'BASS: ON' : 'BASS: OFF';
        btn.setAttribute('aria-pressed', String(self.enabled));
        if (self.enabled) btn.classList.add('enabled');
        else btn.classList.remove('enabled');
      }
      api.ui.showToast(
        'BASS BOOSTER',
        self.enabled ? 'Low-end sub-bass punch ACTIVE (+9dB @ 85Hz)' : 'Sub-bass filter set to PASSTHROUGH (0dB)',
        2800
      );
    });
  },
  destroy(api) {
    api.audio.setBassBoost(false);
    api.ui.removePlaybackButton('bass-boost');
  }
};

// 4. Now Playing Toast Notifications Plugin
const TrackToastPlugin = {
  manifest: {
    id: 'track-toast',
    name: 'Now Playing Notifications',
    version: '1.0.0',
    tag: 'BUILT-IN',
    author: 'Nocturnal Team',
    description: 'Pops up retro cyberpunk toast notification cards in the bottom-right corner whenever tracks start playing.'
  },
  unsub: null,
  init(api) {
    this.unsub = api.on('trackChange', (data) => {
      if (data && data.track) {
        api.ui.showToast(
          'NOW PLAYING',
          `${data.track.name} [${data.track.format || 'AUDIO'}] • ${data.playlistName || 'Playlist'}`,
          3500
        );
      }
    });
  },
  destroy() {
    if (this.unsub) this.unsub();
  }
};

const BUILTIN_PLUGINS = [
  MatrixRainPlugin,
  RainbowSpectrumPlugin,
  BassBoosterPlugin,
  TrackToastPlugin
];
let externalPlugins = [];

async function initPluginSystem() {
  if (!state.plugins) state.plugins = { enabled: {} };
  if (!state.plugins.enabled) state.plugins.enabled = {};

  for (const p of BUILTIN_PLUGINS) {
    if (typeof state.plugins.enabled[p.manifest.id] !== 'boolean') {
      state.plugins.enabled[p.manifest.id] = true;
    }
  }

  for (const p of BUILTIN_PLUGINS) {
    const isEnabled = state.plugins.enabled[p.manifest.id];
    if (isEnabled && typeof p.init === 'function') {
      try { p.init(window.NocturnalAPI); } catch (e) { console.error('Plugin init error:', e); }
    }
  }

  if (window.musicAPI && window.musicAPI.loadCustomPlugins) {
    try {
      const customs = await window.musicAPI.loadCustomPlugins();
      externalPlugins = [];
      for (const item of customs) {
        const id = item.id;
        const manifest = item.manifest || { id, name: id, version: '1.0.0', description: 'User installed plugin' };
        if (typeof state.plugins.enabled[id] !== 'boolean') {
          state.plugins.enabled[id] = true;
        }

        const pluginWrapper = {
          manifest,
          folder: item.folder,
          instance: null,
          init: function(api) {
            try {
              const fn = new Function('api', 'module', 'exports', item.code + '\nreturn module.exports;');
              const mod = { exports: {} };
              const res = fn(api, mod, mod.exports) || mod.exports;
              this.instance = res;
              if (res && typeof res.onLoad === 'function') res.onLoad(api);
            } catch (err) {
              console.error(`Failed to run plugin ${id}:`, err);
            }
          },
          destroy: function(api) {
            if (this.instance && typeof this.instance.onUnload === 'function') {
              try { this.instance.onUnload(api); } catch (_) {}
            }
          }
        };

        externalPlugins.push(pluginWrapper);

        if (state.plugins.enabled[id]) {
          pluginWrapper.init(window.NocturnalAPI);
        }
      }
    } catch (e) {
      console.error('Failed loading external plugins:', e);
    }
  }
}

function renderPluginsList() {
  if (!pluginsListContainer) return;
  pluginsListContainer.innerHTML = '';

  const allPlugins = [...BUILTIN_PLUGINS, ...externalPlugins];
  allPlugins.forEach((p) => {
    const m = p.manifest;
    const isEnabled = Boolean(state.plugins.enabled[m.id]);
    const card = document.createElement('div');
    card.className = 'plugin-card nocturnal-box-outline';
    card.innerHTML = `
      <div class="plugin-info">
        <div class="plugin-header-line">
          <span class="plugin-name">${escapeHtml(m.name)}</span>
          <span class="plugin-version">v${escapeHtml(m.version || '1.0')}</span>
          <span class="plugin-tag">${escapeHtml(m.tag || 'COMMUNITY')}</span>
        </div>
        <div class="plugin-desc">${escapeHtml(m.description || '')}</div>
        <div class="plugin-author">By ${escapeHtml(m.author || 'Unknown')}</div>
      </div>
      <button type="button" class="plugin-toggle-btn nocturnal-box-fill ${isEnabled ? 'enabled' : ''}">
        ${isEnabled ? 'ENABLED' : 'DISABLED'}
      </button>
    `;

    const toggleBtn = card.querySelector('.plugin-toggle-btn');
    toggleBtn.addEventListener('click', () => {
      const next = !state.plugins.enabled[m.id];
      state.plugins.enabled[m.id] = next;
      if (next) {
        if (typeof p.init === 'function') p.init(window.NocturnalAPI);
      } else {
        if (typeof p.destroy === 'function') p.destroy(window.NocturnalAPI);
      }
      saveAppState();
      renderPluginsList();
      showNocturnalToast(m.name, next ? 'Plugin ENABLED' : 'Plugin DISABLED', 2000);
    });

    pluginsListContainer.appendChild(card);
  });
}

function initExtensionsModal() {
  const btn = document.getElementById('btn-open-extensions') || btnOpenExtensions;
  const modal = document.getElementById('extensions-modal') || extensionsModal;
  const closeBtn = document.getElementById('btn-close-extensions') || btnCloseExtensions;

  if (btn && modal) {
    btn.onclick = (e) => {
      e.preventDefault();
      try {
        if (typeof modal.showModal === 'function') {
          modal.showModal();
        } else {
          modal.setAttribute('open', '');
        }
      } catch (err) {
        console.error('Failed to open extensions modal:', err);
      }
      renderPluginsList();
    };
  }

  if (closeBtn && modal) {
    closeBtn.onclick = (e) => {
      e.preventDefault();
      try {
        if (typeof modal.close === 'function') {
          modal.close();
        } else {
          modal.removeAttribute('open');
        }
      } catch (err) {
        modal.removeAttribute('open');
      }
    };
  }

  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) {
        try {
          modal.close();
        } catch (_) {
          modal.removeAttribute('open');
        }
      }
    };
  }

  if (tabBtnThemes && tabBtnPlugins && tabThemes && tabPlugins) {
    tabBtnThemes.addEventListener('click', () => {
      tabBtnThemes.classList.add('active');
      tabBtnPlugins.classList.remove('active');
      tabThemes.style.display = 'flex';
      tabPlugins.style.display = 'none';
    });
    tabBtnPlugins.addEventListener('click', () => {
      tabBtnPlugins.classList.add('active');
      tabBtnThemes.classList.remove('active');
      tabThemes.style.display = 'none';
      tabPlugins.style.display = 'flex';
      renderPluginsList();
    });
  }

  if (themePresetSelect) {
    themePresetSelect.addEventListener('change', () => {
      const selected = themePresetSelect.value;
      if (selected === 'custom') {
        applyTheme('custom');
      } else {
        applyTheme(selected);
      }
    });
  }

  // 1. Container Style & Frame Controls
  if (themeContainerStyleSelect) {
    themeContainerStyleSelect.addEventListener('change', () => {
      const val = themeContainerStyleSelect.value;
      if (btnUploadContainerFrame) {
        btnUploadContainerFrame.style.display = val === 'custom' ? 'block' : 'none';
      }
      ensureCustomThemeObject();
      state.theme.custom.containerStyle = val;
      state.theme.active = 'custom';
      if (themePresetSelect) themePresetSelect.value = 'custom';
      applyTheme(state.theme.custom);
    });
  }

  if (sliderContainerOpacity) {
    sliderContainerOpacity.addEventListener('input', () => {
      const val = sliderContainerOpacity.value;
      if (valContainerOpacity) valContainerOpacity.textContent = `${Math.round(parseFloat(val) * 100)}%`;
      document.documentElement.style.setProperty('--container-bg', `rgba(8, 8, 12, ${val})`);
      ensureCustomThemeObject();
      state.theme.custom.containerOpacity = val;
      state.theme.active = 'custom';
      if (themePresetSelect) themePresetSelect.value = 'custom';
    });
    sliderContainerOpacity.addEventListener('change', () => saveAppState());
  }

  if (btnUploadContainerFrame && containerFrameFileInput) {
    btnUploadContainerFrame.addEventListener('click', () => containerFrameFileInput.click());
    containerFrameFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        ensureCustomThemeObject();
        state.theme.custom.containerCustomImage = event.target.result;
        state.theme.custom.containerStyle = 'custom';
        state.theme.active = 'custom';
        if (themeContainerStyleSelect) themeContainerStyleSelect.value = 'custom';
        if (themePresetSelect) themePresetSelect.value = 'custom';
        applyTheme(state.theme.custom);
        showNocturnalToast('FRAME UPLOADED', 'Custom container frame image applied.', 2500);
      };
      reader.readAsDataURL(file);
      containerFrameFileInput.value = '';
    });
  }

  // 2. Background Texture & Animation Controls
  if (themeBgStyleSelect) {
    themeBgStyleSelect.addEventListener('change', () => {
      const val = themeBgStyleSelect.value;
      if (btnUploadBgImage) {
        btnUploadBgImage.style.display = val === 'custom' ? 'block' : 'none';
      }
      ensureCustomThemeObject();
      state.theme.custom.bgStyle = val;
      state.theme.active = 'custom';
      if (themePresetSelect) themePresetSelect.value = 'custom';
      applyTheme(state.theme.custom);
    });
  }

  if (sliderBgOpacity) {
    sliderBgOpacity.addEventListener('input', () => {
      const val = sliderBgOpacity.value;
      if (valBgOpacity) valBgOpacity.textContent = `${Math.round(parseFloat(val) * 100)}%`;
      document.documentElement.style.setProperty('--circuit-opacity', val);
      ensureCustomThemeObject();
      state.theme.custom.circuitOpacity = val;
      state.theme.custom.bgOpacity = val;
      state.theme.active = 'custom';
      if (themePresetSelect) themePresetSelect.value = 'custom';
    });
    sliderBgOpacity.addEventListener('change', () => saveAppState());
  }

  if (themeBgSpeedSelect) {
    themeBgSpeedSelect.addEventListener('change', () => {
      const val = themeBgSpeedSelect.value;
      ensureCustomThemeObject();
      state.theme.custom.bgSpeed = val;
      state.theme.active = 'custom';
      if (themePresetSelect) themePresetSelect.value = 'custom';
      applyTheme(state.theme.custom);
    });
  }

  if (btnUploadBgImage && bgImageFileInput) {
    btnUploadBgImage.addEventListener('click', () => bgImageFileInput.click());
    bgImageFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        ensureCustomThemeObject();
        state.theme.custom.bgCustomImage = event.target.result;
        state.theme.custom.bgStyle = 'custom';
        state.theme.active = 'custom';
        if (themeBgStyleSelect) themeBgStyleSelect.value = 'custom';
        if (themePresetSelect) themePresetSelect.value = 'custom';
        applyTheme(state.theme.custom);
        showNocturnalToast('BACKGROUND UPLOADED', 'Custom wallpaper image applied.', 2500);
      };
      reader.readAsDataURL(file);
      bgImageFileInput.value = '';
    });
  }

  const bindColorPicker = (picker, prop, objKey) => {
    if (!picker) return;
    picker.addEventListener('input', () => {
      const val = picker.value;
      document.documentElement.style.setProperty(prop, val);
      if (themePresetSelect) themePresetSelect.value = 'custom';
      if (!state.theme) state.theme = { active: 'custom', custom: {} };
      if (!state.theme.custom) state.theme.custom = { ...THEME_PRESETS.default };
      state.theme.active = 'custom';
      state.theme.custom[objKey] = val;
      if (objKey === 'waveformColor') activeThemeColors.waveformColor = val;
      if (objKey === 'accent') {
        activeThemeColors.accent = val;
        document.documentElement.style.setProperty('--border-subtle', val + '44');
      }
      renderVisualizerFrame();
    });
    picker.addEventListener('change', () => {
      saveAppState();
    });
  };

  bindColorPicker(pickerBgDeep, '--bg-deep', 'bgDeep');
  bindColorPicker(pickerBgSurface, '--bg-surface', 'bgSurface');
  bindColorPicker(pickerTextPrimary, '--text-primary', 'textPrimary');
  bindColorPicker(pickerAccent, '--accent-white', 'accent');
  bindColorPicker(pickerWaveform, '--waveform-color', 'waveformColor');
  bindColorPicker(pickerGlow, '--waveform-glow', 'waveformGlow');

  if (btnSaveCustomTheme) {
    btnSaveCustomTheme.addEventListener('click', () => {
      saveAppState();
      showNocturnalToast('THEME SAVED', 'Custom theme colors successfully saved.', 2500);
    });
  }

  if (btnExportTheme) {
    btnExportTheme.addEventListener('click', () => {
      const themeData = state.theme && state.theme.custom ? state.theme.custom : (THEME_PRESETS[state.theme?.active] || THEME_PRESETS.default);
      const json = JSON.stringify(themeData, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nocturnal-theme-${state.theme?.active || 'custom'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showNocturnalToast('THEME EXPORTED', `Saved ${a.download}`, 2500);
    });
  }

  if (btnImportTheme && themeFileInput) {
    btnImportTheme.addEventListener('click', () => {
      themeFileInput.click();
    });
    themeFileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          applyTheme(parsed);
          showNocturnalToast('THEME IMPORTED', `Successfully loaded theme "${parsed.name || file.name}".`, 3000);
        } catch (err) {
          alert('Failed to parse theme JSON file: ' + err.message);
        }
      };
      reader.readAsText(file);
      themeFileInput.value = '';
    });
  }

  if (btnOpenThemesFolder) {
    btnOpenThemesFolder.addEventListener('click', () => {
      if (window.musicAPI && window.musicAPI.openThemesFolder) {
        window.musicAPI.openThemesFolder();
      }
    });
  }

  if (btnResetTheme) {
    btnResetTheme.addEventListener('click', () => {
      applyTheme('default');
      showNocturnalToast('THEME RESET', 'Restored Default Nocturnal monochrome theme.', 2500);
    });
  }

  if (btnOpenPluginsFolder) {
    btnOpenPluginsFolder.addEventListener('click', () => {
      if (window.musicAPI && window.musicAPI.openPluginsFolder) {
        window.musicAPI.openPluginsFolder();
      }
    });
  }

  if (btnReloadPlugins) {
    btnReloadPlugins.addEventListener('click', async () => {
      await initPluginSystem();
      renderPluginsList();
      showNocturnalToast('PLUGINS RELOADED', 'Plugins scanned and initialized.', 2500);
    });
  }
}

// ==========================================================================
// MOBILE NAVIGATION & MEDIA SESSION (CONCEPT A: TABS + PERSISTENT MINI PLAYER)
// ==========================================================================

const mobileNavBar = document.getElementById('mobile-nav-bar');
const mobileMiniPlayer = document.getElementById('mobile-mini-player');
const miniProgressFill = document.getElementById('mini-progress-fill');
const miniCoverArt = document.getElementById('mini-cover-art');
const miniTitle = document.getElementById('mini-title');
const miniSub = document.getElementById('mini-sub');
const miniBtnPrev = document.getElementById('mini-btn-prev');
const miniBtnPlay = document.getElementById('mini-btn-play');
const miniBtnNext = document.getElementById('mini-btn-next');

let currentMobileTab = 'pane-player';

function setMobileTab(paneId) {
  currentMobileTab = paneId;
  const panes = ['pane-player', 'pane-tracklist', 'pane-lyrics', 'pane-sidebar'];
  panes.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      if (id === paneId) {
        el.classList.add('mobile-active-tab');
      } else {
        el.classList.remove('mobile-active-tab');
      }
    }
  });

  const btns = document.querySelectorAll('.mobile-nav-btn');
  btns.forEach((btn) => {
    if (btn.getAttribute('data-mobile-tab') === paneId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  syncMiniPlayerVisibility();
}

function syncMiniPlayerVisibility() {
  if (!mobileMiniPlayer) return;
  const isMobile = window.innerWidth <= 768;
  const track = getCurrentTrack();
  if (isMobile && currentMobileTab !== 'pane-player' && track) {
    mobileMiniPlayer.style.display = 'flex';
  } else {
    mobileMiniPlayer.style.display = 'none';
  }
}

function updateMiniPlayerUI() {
  if (!mobileMiniPlayer) return;
  const track = getCurrentTrack();
  if (track) {
    if (miniTitle) miniTitle.textContent = track.displayName || track.name;
    const pl = getPlayingPlaylist();
    if (miniSub) miniSub.textContent = pl ? pl.name : 'NOCTURNAL';
    if (miniCoverArt) miniCoverArt.src = track.coverUrl || 'assets/default_cover.png';
  } else {
    if (miniTitle) miniTitle.textContent = 'No track playing';
    if (miniSub) miniSub.textContent = 'NOCTURNAL PLAYER';
    if (miniCoverArt) miniCoverArt.src = 'assets/default_cover.png';
  }
  if (miniBtnPlay) {
    miniBtnPlay.textContent = audioEl.paused ? '▶' : '⏸';
  }
  syncMiniPlayerVisibility();
}

function syncMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  if (!track) {
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    } catch (_) {}
    return;
  }
  const pl = getPlayingPlaylist();
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.displayName || track.name,
      artist: track.artist || 'Nocturnal',
      album: pl ? pl.name : 'Nocturnal Player',
      artwork: [
        { src: track.coverUrl || 'assets/default_cover.png', sizes: '512x512', type: 'image/png' }
      ]
    });
    navigator.mediaSession.playbackState = audioEl.paused ? 'paused' : 'playing';
  } catch (e) {
    console.warn('Failed to update MediaSession metadata:', e);
  }
}

function initMobileNavigation() {
  // Mobile Nav Buttons
  const navBtns = document.querySelectorAll('.mobile-nav-btn');
  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-mobile-tab');
      if (target) {
        setMobileTab(target);
      }
    });
  });

  // Tapping Mini Player opens the Player tab
  if (mobileMiniPlayer) {
    mobileMiniPlayer.addEventListener('click', (e) => {
      if (e.target.closest('.mini-btns')) return;
      setMobileTab('pane-player');
    });
  }

  // Mini Player Controls
  if (miniBtnPlay) {
    miniBtnPlay.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
      updateMiniPlayerUI();
    });
  }
  if (miniBtnPrev) {
    miniBtnPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      playPrevTrack();
    });
  }
  if (miniBtnNext) {
    miniBtnNext.addEventListener('click', (e) => {
      e.stopPropagation();
      playNextTrack();
    });
  }

  // Hook navigator.mediaSession action handlers
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        togglePlayPause();
        updateMiniPlayerUI();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        togglePlayPause();
        updateMiniPlayerUI();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPrevTrack();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNextTrack();
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime && Number.isFinite(audioEl.duration)) {
          audioEl.currentTime = details.seekTime;
          syncActiveLyricLine(audioEl.currentTime);
        }
      });
    } catch (e) {
      console.warn('Failed to attach MediaSession action handlers:', e);
    }
  }

  // Window resize listener to sync layout mode
  window.addEventListener('resize', () => {
    if (window.innerWidth <= 768) {
      setMobileTab(currentMobileTab);
    } else {
      // Restore desktop layout: remove mobile active classes
      const panes = ['pane-player', 'pane-tracklist', 'pane-lyrics', 'pane-sidebar'];
      panes.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('mobile-active-tab');
      });
      if (mobileMiniPlayer) mobileMiniPlayer.style.display = 'none';
    }
  });

  // Default mobile tab is Player
  if (window.innerWidth <= 768) {
    setMobileTab('pane-player');
  }
}

// Initialize
(async function init() {
  let isNightly = false;
  if (window.musicAPI && window.musicAPI.isNightly) {
    try {
      isNightly = await window.musicAPI.isNightly();
    } catch (_) {}
  }
  if (!isNightly) {
    isNightly = document.title.includes('Nightly') ||
                location.href.toLowerCase().includes('nightly') ||
                (window.location.search && window.location.search.includes('nightly'));
  }

  const brandEl = document.querySelector('.hypr-brand');
  const btnExt = document.getElementById('btn-open-extensions') || btnOpenExtensions;
  const extModal = document.getElementById('extensions-modal') || extensionsModal;

  if (isNightly) {
    if (brandEl) {
      brandEl.textContent = 'NOCTURNAL PLAYER NIGHTLY';
    }
    if (btnExt) {
      btnExt.style.display = 'inline-block';
    }
    initExtensionsModal();
  } else {
    // Standard / Stable release: Completely remove themes and plugins experimental studio
    if (btnExt) {
      btnExt.remove();
    }
    if (extModal) {
      extModal.remove();
    }
  }

  audioEl.volume = Number(volumeBar.value);
  initHyprlandWM();
  initMobileNavigation();

  await loadAppState();

  if (isNightly) {
    if (state.theme && state.theme.active) {
      applyTheme(state.theme.active === 'custom' && state.theme.custom ? state.theme.custom : state.theme.active, false);
    } else {
      applyTheme('default', false);
    }
    await initPluginSystem();
  } else {
    // Standard release remains purely on default Nocturnal classic theme
    applyTheme('default', false);
  }

  updateVisualizerButtons();
  applyVisualizerContainerState();
  applyHyprlandLayout();
  renderVisualizerFrame();
  renderAll();
  syncDiscordPresence();
})();

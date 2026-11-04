const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execFile } = require('child_process');
const { pathToFileURL } = require('url');
const { DiscordRPCClient } = require('./discord-rpc');

app.setName('Nocturnal player');

let ffmpegStaticPath = null;
try {
  const rawFfmpeg = require('ffmpeg-static');
  if (rawFfmpeg) {
    ffmpegStaticPath = rawFfmpeg.replace('app.asar', 'app.asar.unpacked');
  }
} catch (_) {
  ffmpegStaticPath = null;
}

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.opus', '.m4a', '.webm']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp']);
const LYRIC_EXTENSIONS = new Set(['.lrc', '.vtt', '.txt']);

let mainWindow = null;
const discordRpc = new DiscordRPCClient();

discordRpc.onStatusChange = (status) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('discord:status', status);
  }
};

function getStateFilePath() {
  return path.join(app.getPath('userData'), 'playlists-state.json');
}

function createWindow() {
  // Completely disable native application menu so pressing Alt never shows the top menu bar
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    title: 'Nocturnal player',
    backgroundColor: '#09090c',
    icon: path.join(__dirname, 'assets', 'nocturnal.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenu(null);
  win.setMenuBarVisibility(false);

  win.loadFile('index.html');
  mainWindow = win;
}

const SOUND_CUE_REGEX =
  /^(\[|\()?(music|applause|cheering|laughter|silence|sound|instrumental|intro|outro|interlude|solo|singing|guitar|piano|beat|drop|snicker|sigh|screaming|cheers|screams|__|\?\?\?|>>|-)+(\]|\))?$/i;

function isSoundCueOnly(text) {
  if (!text) return true;
  const cleaned = text.trim();
  if (cleaned === '>>' || cleaned === '-' || cleaned === '---') return true;
  return SOUND_CUE_REGEX.test(cleaned);
}

function isAutoCaptionText(text) {
  if (!text || typeof text !== 'string') return false;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  let cueCount = 0;
  for (const l of lines) {
    if (isSoundCueOnly(l)) cueCount++;
  }
  return cueCount >= 2 || cueCount / lines.length >= 0.2;
}

function isInstrumentalTrack(name) {
  if (!name || typeof name !== 'string') return false;
  return /\b(instrumental|inst\b|karaoke|backing track|off vocal|no vocals?)\b/i.test(name);
}

function normalizeTitle(str) {
  return String(str || '')
    .toLowerCase()
    .replace(
      /\b(instrumental|inst|official|remastered|remaster|video|audio|version|edit|extended|mix|deluxe|bonus|track|hd|4k|\d{4})\b/gi,
      ''
    )
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrictTitleMatch(query, candidate) {
  const q = normalizeTitle(query);
  const c = normalizeTitle(candidate);
  if (!q || !c) return false;
  return q === c;
}

// Parse .lrc or .vtt or plain text into { synced: boolean, lines: [{ time: number | null, text: string }] }
function parseLyricsContent(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { synced: false, lines: [] };
  }

  // Reject entire text if it is an auto-caption dump
  if (isAutoCaptionText(rawText)) {
    return { synced: false, lines: [], isCaption: true };
  }

  const lines = rawText.split(/\r?\n/);
  const timedEntries = [];
  const plainEntries = [];

  // LRC timestamp regex: [mm:ss.xx] or [mm:ss:xx] or [mm:ss]
  const lrcRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  // VTT timestamp regex: 00:01:23.456 --> 00:01:26.000 or 01:23.456 --> 01:26.000
  const vttRegex = /^(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})\s*-->/;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // Skip LRC metadata tags like [ar:...], [ti:...], [by:...], WEBVTT headers
    if (/^\[(ar|ti|al|by|offset|re|ve|length):/i.test(rawLine)) continue;
    if (/^(WEBVTT|Kind:|Language:|NOTE\b)/i.test(rawLine)) continue;

    // Check VTT cue timing line
    const vttMatch = rawLine.match(vttRegex);
    if (vttMatch) {
      const hrs = vttMatch[1] ? parseInt(vttMatch[1], 10) : 0;
      const mins = parseInt(vttMatch[2], 10);
      const secs = parseInt(vttMatch[3], 10);
      const ms = parseInt(vttMatch[4].padEnd(3, '0'), 10);
      const timeSec = hrs * 3600 + mins * 60 + secs + ms / 1000;

      // Gather following non-empty text lines until next blank or timestamp
      const cueTextParts = [];
      while (i + 1 < lines.length && lines[i + 1].trim() && !vttRegex.test(lines[i + 1].trim())) {
        i++;
        const cleaned = lines[i]
          .trim()
          .replace(/<[^>]+>/g, '') // Strip VTT inline tags like <00:00:01.000><c>
          .trim();
        if (cleaned && !isSoundCueOnly(cleaned)) cueTextParts.push(cleaned);
      }
      const text = cueTextParts.join(' ');
      if (text && !isSoundCueOnly(text) && (timedEntries.length === 0 || timedEntries[timedEntries.length - 1].text !== text)) {
        timedEntries.push({ time: timeSec, text });
      }
      continue;
    }

    // Check LRC timestamps
    const matches = [...rawLine.matchAll(lrcRegex)];
    if (matches.length > 0) {
      const lyricText = rawLine.replace(lrcRegex, '').trim();
      if (!isSoundCueOnly(lyricText)) {
        for (const m of matches) {
          const mins = parseInt(m[1], 10);
          const secs = parseInt(m[2], 10);
          const frac = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0;
          const timeSec = mins * 60 + secs + frac;
          if (lyricText) {
            timedEntries.push({ time: timeSec, text: lyricText });
          }
        }
      }
    } else if (!/^\d+$/.test(rawLine)) {
      if (!isSoundCueOnly(rawLine)) {
        plainEntries.push({ time: null, text: rawLine });
      }
    }
  }

  if (timedEntries.length > 0) {
    timedEntries.sort((a, b) => a.time - b.time);
    return { synced: true, lines: timedEntries };
  }

  return { synced: false, lines: plainEntries };
}

function findLocalLyricsForTrack(folderPath, trackBaseName, allowCaptions = false) {
  if (isInstrumentalTrack(trackBaseName)) {
    return { instrumental: true, synced: false, lines: [] };
  }

  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const lowerBase = trackBaseName.toLowerCase();

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!LYRIC_EXTENSIONS.has(ext)) continue;

      const nameNoExt = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
      // Exact match (Song.lrc or Song.txt)
      if (nameNoExt === lowerBase) {
        const raw = fs.readFileSync(path.join(folderPath, entry.name), 'utf-8');
        if (isAutoCaptionText(raw)) {
          continue; // Skip video auto-captions
        }
        const parsed = parseLyricsContent(raw);
        if (parsed.lines.length > 0 && !parsed.isCaption) {
          return parsed;
        }
      }
    }

    if (allowCaptions) {
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!LYRIC_EXTENSIONS.has(ext)) continue;

        const nameNoExt = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
        // Language-tagged subtitle (Song.en.lrc, Song.en-US.vtt)
        if (nameNoExt.startsWith(lowerBase + '.')) {
          const raw = fs.readFileSync(path.join(folderPath, entry.name), 'utf-8');
          if (isAutoCaptionText(raw)) {
            continue;
          }
          const parsed = parseLyricsContent(raw);
          if (parsed.lines.length > 0 && !parsed.isCaption) {
            return parsed;
          }
        }
      }
    }
  } catch (_) {
    // Ignore read errors
  }
  return null;
}

function cleanTrackQuery(rawTitle) {
  return String(rawTitle || '')
    .replace(/^\d+\s*[-._)]\s*/, '') // Strip leading track index like "01 - "
    .replace(/\[[^\]]*(official|video|audio|lyrics|visualizer|hd|4k|hq)[^\]]*\]/gi, '')
    .replace(/\([^)]*(official|video|audio|lyrics|visualizer|hd|4k|hq)[^)]*\)/gi, '')
    .replace(/\b(feat\.?|ft\.?)\b/gi, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fetchJsonHttps(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'NocturnalPlayer/1.0 (https://github.com/nocturnal-player)'
          }
        },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        }
      )
      .on('error', reject);
  });
}

async function fetchLyricsFromLrclib(trackName, durationSec = 0) {
  if (isInstrumentalTrack(trackName)) {
    return { instrumental: true, rawLrc: '', parsed: { instrumental: true, synced: false, lines: [] } };
  }

  const cleaned = cleanTrackQuery(trackName);
  if (!cleaned) return null;

  const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(cleaned)}`;
  const results = await fetchJsonHttps(searchUrl);
  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  // Filter ONLY results where trackName strictly matches the queried track name
  const matchingResults = results.filter((r) => r && isStrictTitleMatch(cleaned, r.trackName));
  if (matchingResults.length === 0) {
    return null;
  }

  // If LRCLIB marks the matching track as instrumental, honor it!
  const instrumentalMatch = matchingResults.find((r) => r.instrumental === true);
  if (instrumentalMatch && !matchingResults.some((r) => r.syncedLyrics)) {
    return { instrumental: true, rawLrc: '', parsed: { instrumental: true, synced: false, lines: [] } };
  }

  // Duration verification:
  let candidates = matchingResults;
  if (durationSec > 0) {
    const durationMatching = matchingResults.filter(
      (r) => r && typeof r.duration === 'number' && Math.abs(r.duration - durationSec) <= 4
    );
    if (durationMatching.length > 0) {
      candidates = durationMatching;
    } else {
      // None of the matching songs match the track's duration within 4 seconds!
      return null;
    }
  } else {
    // If durationSec is not provided, do NOT guess for short/generic titles without an artist
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length < 3 && !trackName.includes(' - ')) {
      return null;
    }
  }

  // Prefer results that have syncedLyrics and closest duration if durationSec is known
  const withSynced = candidates.filter(
    (r) => r && !r.instrumental && typeof r.syncedLyrics === 'string' && r.syncedLyrics.trim()
  );

  if (withSynced.length > 0) {
    if (durationSec > 0) {
      withSynced.sort(
        (a, b) => Math.abs((a.duration || 0) - durationSec) - Math.abs((b.duration || 0) - durationSec)
      );
    }
    for (const item of withSynced) {
      const parsed = parseLyricsContent(item.syncedLyrics);
      if (parsed && parsed.lines.length > 0 && !parsed.isCaption) {
        return {
          rawLrc: item.syncedLyrics,
          parsed
        };
      }
    }
  }

  const withPlain = candidates.find(
    (r) => r && !r.instrumental && typeof r.plainLyrics === 'string' && r.plainLyrics.trim()
  );
  if (withPlain) {
    const parsed = parseLyricsContent(withPlain.plainLyrics);
    if (parsed && parsed.lines.length > 0 && !parsed.isCaption) {
      return {
        rawLrc: withPlain.plainLyrics,
        parsed
      };
    }
  }

  return null;
}

function postJsonHttps(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(data);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Origin: 'https://music.youtube.com',
          Referer: 'https://music.youtube.com/'
        }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchLyricsFromYTM(trackNameOrQuery, knownVideoId = null) {
  if (isInstrumentalTrack(trackNameOrQuery)) {
    return { instrumental: true, rawLrc: '', parsed: { instrumental: true, synced: false, lines: [] }, source: 'ytm' };
  }

  const context = {
    client: {
      clientName: 'WEB_REMIX',
      clientVersion: '1.20240101.01.00',
      hl: 'en'
    }
  };

  let videoId = knownVideoId;

  if (!videoId && trackNameOrQuery) {
    const raw = String(trackNameOrQuery).trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) {
      videoId = raw;
    } else {
      const urlMatch = raw.match(/(?:v=|\/v\/|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
      if (urlMatch) {
        videoId = urlMatch[1];
      }
    }
  }

  // If still no videoId, search YouTube Music and verify that the title strictly matches
  if (!videoId && trackNameOrQuery) {
    const cleanedQuery = cleanTrackQuery(trackNameOrQuery);
    const words = (cleanedQuery || trackNameOrQuery).split(/\s+/).filter(Boolean);
    // Do not blind search YouTube Music for 1-word or 2-word titles without an artist
    if (words.length >= 3 || String(trackNameOrQuery).includes(' - ')) {
      try {
        const searchRes = await postJsonHttps('https://music.youtube.com/youtubei/v1/search', {
          context,
          query: cleanedQuery || trackNameOrQuery
        });
        const card =
          searchRes?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
            ?.musicCardShelfRenderer;
        if (card) {
          const cardTitle = card.title?.runs?.[0]?.text;
          const cardVideoId = card.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId;
          if (cardTitle && cardVideoId && isStrictTitleMatch(cleanedQuery || trackNameOrQuery, cardTitle)) {
            videoId = cardVideoId;
          }
        }
      } catch (_) {
        // Search failed
      }
    }
  }

  if (!videoId) return null;

  try {
    const nextRes = await postJsonHttps('https://music.youtube.com/youtubei/v1/next', {
      context,
      videoId
    });

    const nextStr = JSON.stringify(nextRes);
    const mplyMatch = nextStr.match(/"browseId":"(MPLY[a-zA-Z0-9_-]+)"/);
    if (!mplyMatch) {
      return null;
    }

    const browseRes = await postJsonHttps('https://music.youtube.com/youtubei/v1/browse', {
      context,
      browseId: mplyMatch[1]
    });

    const desc =
      browseRes?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer?.description?.runs;
    if (desc && Array.isArray(desc)) {
      const rawText = desc.map((r) => r.text).join('').trim();
      if (rawText && !isAutoCaptionText(rawText)) {
        const parsed = parseLyricsContent(rawText);
        if (parsed && parsed.lines.length > 0 && !parsed.isCaption) {
          return {
            rawLrc: rawText,
            parsed,
            videoId,
            source: 'ytm'
          };
        }
      }
    }
  } catch (_) {
    // Network or parse error
  }

  return null;
}

function scanFolderForMedia(folderPath, includeThumbnails = true) {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const audioFiles = [];
  const imageFiles = new Map(); // lowercase basename without ext -> full path
  let folderFallbackCover = null;

  if (includeThumbnails) {
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const baseName = path.basename(entry.name, path.extname(entry.name));
      const lowerBase = baseName.toLowerCase();
      const fullPath = path.join(folderPath, entry.name);

      if (IMAGE_EXTENSIONS.has(ext)) {
        imageFiles.set(lowerBase, fullPath);
        if (
          !folderFallbackCover &&
          ['cover', 'folder', 'album', 'front', 'art', 'artwork'].includes(lowerBase)
        ) {
          folderFallbackCover = fullPath;
        }
      }
    }

    if (!folderFallbackCover && imageFiles.size === 1 && entries.length <= 2) {
      folderFallbackCover = Array.from(imageFiles.values())[0];
    }
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (AUDIO_EXTENSIONS.has(ext)) {
      const fullPath = path.join(folderPath, entry.name);
      const baseName = path.basename(entry.name, path.extname(entry.name));
      const matchedTrackImage = includeThumbnails
        ? imageFiles.get(baseName.toLowerCase()) || null
        : null;
      const isInst = isInstrumentalTrack(baseName);
      let localLyrics = null;
      if (isInst) {
        localLyrics = { instrumental: true, synced: false, lines: [] };
      } else {
        localLyrics = findLocalLyricsForTrack(folderPath, baseName);
      }

      let videoId = null;
      const infoPath = path.join(folderPath, `${baseName}.info.json`);
      if (fs.existsSync(infoPath)) {
        try {
          const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
          if (info && info.id) videoId = String(info.id);
        } catch (_) {}
      }

      audioFiles.push({
        name: baseName,
        fileName: entry.name,
        format: ext.slice(1).toUpperCase(),
        path: fullPath,
        url: pathToFileURL(fullPath).href,
        coverUrl: matchedTrackImage ? pathToFileURL(matchedTrackImage).href : null,
        lyrics: localLyrics || null,
        videoId: videoId || null,
        isInstrumental: isInst
      });
    }
  }

  audioFiles.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));

  return {
    folderName: path.basename(folderPath),
    folderPath,
    folderCoverUrl: folderFallbackCover ? pathToFileURL(folderFallbackCover).href : null,
    tracks: audioFiles
  };
}

function downloadFileWithRedirects(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = (currentUrl) => {
      https
        .get(currentUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            request(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} downloading ${currentUrl}`));
            return;
          }
          const fileStream = fs.createWriteStream(destPath);
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close(() => resolve(destPath));
          });
          fileStream.on('error', reject);
        })
        .on('error', reject);
    };
    request(url);
  });
}

async function ensureYtDlpBinary(sendProgress) {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const binName = isWin ? 'yt-dlp.exe' : isMac ? 'yt-dlp_macos' : 'yt-dlp';
  const downloadUrl = isWin
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : isMac
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

  const localBin = path.join(__dirname, 'bin', binName);
  if (fs.existsSync(localBin)) {
    return localBin;
  }

  const userBinDir = path.join(app.getPath('userData'), 'bin');
  const userBin = path.join(userBinDir, binName);
  if (fs.existsSync(userBin)) {
    return userBin;
  }

  fs.mkdirSync(userBinDir, { recursive: true });
  sendProgress('Downloading yt-dlp binary for YT Music import (first-time setup)...');
  await downloadFileWithRedirects(downloadUrl, userBin);
  if (!isWin) {
    try {
      fs.chmodSync(userBin, 0o755);
    } catch (_) {}
  }
  return userBin;
}

app.whenReady().then(() => {
  // Initialize cover art HTTPS cache and connect Discord Rich Presence in background
  discordRpc.initCacheFile(app.getPath('userData'));
  discordRpc.connect();

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Playlist Folder (MP3, WAV, OGG)',
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return scanFolderForMedia(result.filePaths[0], true);
  });

  ipcMain.handle('dialog:selectAudioFiles', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Audio Files (MP3, WAV, OGG)',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio Files (MP3, WAV, OGG)', extensions: ['mp3', 'wav', 'ogg'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths.map((fullPath) => {
      const ext = path.extname(fullPath).toLowerCase();
      const baseName = path.basename(fullPath, path.extname(fullPath));
      const localLyrics = findLocalLyricsForTrack(path.dirname(fullPath), baseName);
      return {
        name: baseName,
        fileName: path.basename(fullPath),
        format: ext.slice(1).toUpperCase(),
        path: fullPath,
        url: pathToFileURL(fullPath).href,
        coverUrl: null,
        lyrics: localLyrics || null
      };
    });
  });

  ipcMain.handle('dialog:selectCoverArt', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Cover Art Image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return pathToFileURL(result.filePaths[0]).href;
  });

  ipcMain.handle('dialog:selectLrcFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Timed Lyrics (.lrc, .vtt, .txt)',
      properties: ['openFile'],
      filters: [
        { name: 'Lyrics Files (.lrc, .vtt, .txt)', extensions: ['lrc', 'vtt', 'txt'] }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    return parseLyricsContent(raw);
  });

  ipcMain.handle('lyrics:fetch', async (_event, payload) => {
    const trackName = payload && payload.trackName ? String(payload.trackName) : '';
    const filePath = payload && payload.filePath ? String(payload.filePath) : '';
    const videoId = payload && payload.videoId ? String(payload.videoId) : '';
    const duration = payload && payload.duration ? Number(payload.duration) : 0;
    const isManual = Boolean(payload && payload.manual);

    if (isInstrumentalTrack(trackName)) {
      return { instrumental: true, synced: false, lines: [] };
    }

    // If this is an automatic background fetch (not manual button click) and local clean lyrics exist, use them
    if (!isManual && filePath && fs.existsSync(filePath)) {
      const dir = path.dirname(filePath);
      const baseName = path.basename(filePath, path.extname(filePath));
      const local = findLocalLyricsForTrack(dir, baseName, false);
      if (local && (local.instrumental || (local.lines && local.lines.length > 0))) {
        return local;
      }
    }

    // 1. Attempt to fetch actual song lyrics from YouTube Music (prefer YTM lyrics over captions!)
    try {
      const ytm = await fetchLyricsFromYTM(trackName, videoId);
      if (ytm && ytm.instrumental) {
        return { instrumental: true, synced: false, lines: [] };
      }
      if (ytm && ytm.parsed && ytm.parsed.lines.length > 0 && !ytm.parsed.isCaption) {
        if (filePath && fs.existsSync(filePath)) {
          try {
            const lrcPath = path.join(
              path.dirname(filePath),
              path.basename(filePath, path.extname(filePath)) + '.lrc'
            );
            fs.writeFileSync(lrcPath, ytm.rawLrc, 'utf-8');
          } catch (_) {}
        }
        return {
          ...ytm.parsed,
          source: 'ytm'
        };
      }
    } catch (_) {}

    // 2. Fallback: If YouTube Music has no lyrics tab, check LRCLIB for actual song lyrics
    try {
      const fetched = await fetchLyricsFromLrclib(trackName, duration);
      if (fetched && fetched.instrumental) {
        return { instrumental: true, synced: false, lines: [] };
      }
      if (fetched && fetched.parsed && fetched.parsed.lines.length > 0 && !fetched.parsed.isCaption) {
        if (filePath && fs.existsSync(filePath)) {
          try {
            const lrcPath = path.join(
              path.dirname(filePath),
              path.basename(filePath, path.extname(filePath)) + '.lrc'
            );
            fs.writeFileSync(lrcPath, fetched.rawLrc, 'utf-8');
          } catch (_) {}
        }
        return {
          ...fetched.parsed,
          source: 'lrclib'
        };
      }
    } catch (_) {}

    // Do NOT return captions!
    return null;
  });

  ipcMain.handle('lyrics:delete', async (_event, filePath) => {
    if (filePath && typeof filePath === 'string' && fs.existsSync(filePath)) {
      try {
        const dir = path.dirname(filePath);
        const baseName = path.basename(filePath, path.extname(filePath));
        const entries = fs.readdirSync(dir);
        for (const f of entries) {
          const ext = path.extname(f).toLowerCase();
          if (['.lrc', '.vtt', '.txt'].includes(ext)) {
            const nameNoExt = path.basename(f, ext);
            if (
              nameNoExt.toLowerCase() === baseName.toLowerCase() ||
              nameNoExt.toLowerCase().startsWith(baseName.toLowerCase() + '.')
            ) {
              try {
                fs.unlinkSync(path.join(dir, f));
              } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }
    return { ok: true };
  });

  ipcMain.handle('discord:update', async (_event, activityData) => {
    discordRpc.setActivity(activityData || {});
    return { connected: discordRpc.ready };
  });

  ipcMain.handle('discord:reconnect', async (_event, customClientId) => {
    if (customClientId && typeof customClientId === 'string' && customClientId.trim()) {
      discordRpc.clientId = customClientId.trim();
    }
    discordRpc.manualReconnect();
    return { connected: discordRpc.ready };
  });

  ipcMain.handle('discord:setEnabled', async (_event, enabled) => {
    discordRpc.setEnabled(Boolean(enabled));
    return { enabled: discordRpc.enabled, connected: discordRpc.ready };
  });

  ipcMain.handle('window:toggleFullscreen', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const nextState = !mainWindow.isFullScreen();
      mainWindow.setFullScreen(nextState);
      return { isFullScreen: nextState };
    }
    return { isFullScreen: false };
  });

  ipcMain.handle('window:getBounds', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return mainWindow.getBounds();
    }
    return null;
  });

  ipcMain.handle('window:setBounds', async (_event, bounds) => {
    if (mainWindow && !mainWindow.isDestroyed() && bounds && typeof bounds === 'object') {
      if (mainWindow.isFullScreen() || mainWindow.isMaximized()) {
        return mainWindow.getBounds();
      }
      const current = mainWindow.getBounds();
      const next = {
        x: typeof bounds.x === 'number' ? Math.round(bounds.x) : current.x,
        y: typeof bounds.y === 'number' ? Math.round(bounds.y) : current.y,
        width: typeof bounds.width === 'number' ? Math.max(880, Math.round(bounds.width)) : current.width,
        height: typeof bounds.height === 'number' ? Math.max(600, Math.round(bounds.height)) : current.height
      };
      mainWindow.setBounds(next);
      return next;
    }
    return null;
  });

  ipcMain.handle('installer:createShortcuts', async () => {
    const isPackaged = app.isPackaged;
    const electronExe = process.execPath;
    const appDir = isPackaged ? path.dirname(process.execPath) : __dirname;

    if (process.platform === 'darwin') {
      // On macOS, create a Desktop alias/symlink to Nocturnal player.app (or launcher script)
      const os = require('os');
      const desktopDir = path.join(os.homedir(), 'Desktop');
      const appBundlePath = isPackaged
        ? path.resolve(process.execPath, '..', '..', '..')
        : '/Applications/Nocturnal player.app';
      const shortcutTarget = fs.existsSync(appBundlePath) ? appBundlePath : appDir;
      const destLink = path.join(desktopDir, 'Nocturnal player');
      try {
        if (fs.existsSync(destLink)) fs.unlinkSync(destLink);
        fs.symlinkSync(shortcutTarget, destLink);
      } catch (_) {}
      return { ok: true };
    }

    if (process.platform === 'linux') {
      const os = require('os');
      const homeDir = os.homedir();
      const desktopDir = path.join(homeDir, 'Desktop');
      const appsDir = path.join(homeDir, '.local', 'share', 'applications');
      const pngIcon = path.join(__dirname, 'assets', '180px-soundtrack_(nocturnal_style).png').replace('app.asar', 'app.asar.unpacked');
      const execCmd = isPackaged ? `"${electronExe}"` : `"${electronExe}" "${appDir}"`;
      const desktopEntry = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Nocturnal player',
        'Comment=Nocturnal player — standalone desktop music player',
        `Exec=${execCmd}`,
        `Path=${appDir}`,
        `Icon=${pngIcon}`,
        'Terminal=false',
        'Categories=AudioVideo;Audio;Player;'
      ].join('\n');

      try {
        fs.mkdirSync(appsDir, { recursive: true });
        const appEntryPath = path.join(appsDir, 'nocturnal-player.desktop');
        fs.writeFileSync(appEntryPath, desktopEntry, { mode: 0o755 });
        if (fs.existsSync(desktopDir)) {
          const deskEntryPath = path.join(desktopDir, 'Nocturnal player.desktop');
          fs.writeFileSync(deskEntryPath, desktopEntry, { mode: 0o755 });
        }
      } catch (_) {}
      return { ok: true };
    }

    const argsStr = isPackaged ? '' : `"${appDir.replace(/'/g, "''")}"`;
    const unpackedIcon = path.join(__dirname, 'assets', 'nocturnal.ico').replace('app.asar', 'app.asar.unpacked');
    const iconPath = fs.existsSync(unpackedIcon) ? unpackedIcon : electronExe;

    const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath('Desktop')
$StartMenuPath = [Environment]::GetFolderPath('Programs')

foreach ($TargetDir in @($DesktopPath, $StartMenuPath)) {
  $ShortcutFile = Join-Path $TargetDir 'Nocturnal player.lnk'
  $Shortcut = $WshShell.CreateShortcut($ShortcutFile)
  $Shortcut.TargetPath = '${electronExe.replace(/'/g, "''")}'
  $Shortcut.Arguments = '${argsStr}'
  $Shortcut.WorkingDirectory = '${appDir.replace(/'/g, "''")}'
  $Shortcut.IconLocation = '${iconPath.replace(/'/g, "''")}'
  $Shortcut.Description = 'Nocturnal player'
  $Shortcut.Save()
}
`;

    await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    return { ok: true };
  });

  ipcMain.handle('ytm:import', async (event, payload) => {
    const rawQuery = (payload && payload.query ? String(payload.query) : '').trim();
    const format = (payload && payload.format ? String(payload.format) : 'mp3').toLowerCase();
    const useThumbnail = Boolean(payload && payload.useThumbnail);

    if (!rawQuery) {
      throw new Error('Please provide a YT Music URL or search query.');
    }

    const sendProgress = (msg) => {
      event.sender.send('ytm:progress', msg);
    };

    const ytDlpExe = await ensureYtDlpBinary(sendProgress);
    const downloadsRoot = app.isPackaged
      ? path.join(app.getPath('userData'), 'downloads')
      : path.join(__dirname, 'downloads');
    const jobDir = path.join(downloadsRoot, `ytm-${Date.now()}`);
    fs.mkdirSync(jobDir, { recursive: true });

    const isUrl = /^https?:\/\//i.test(rawQuery);
    const targetSpec = isUrl ? rawQuery : `ytsearch1:${rawQuery}`;

    // Map 'ogg' to 'vorbis' for yt-dlp --audio-format
    const ytDlpAudioFormat = format === 'ogg' ? 'vorbis' : format === 'wav' ? 'wav' : 'mp3';

    const args = [
      '--no-mtime',
      '--yes-playlist',
      '--ignore-errors',
      '--write-info-json',
      '--output',
      path.join(jobDir, '%(playlist_index&{}-|)s%(title).90s.%(ext)s')
    ];

    if (ffmpegStaticPath && fs.existsSync(ffmpegStaticPath)) {
      args.push('--ffmpeg-location', ffmpegStaticPath);
      args.push('--extract-audio', '--audio-format', ytDlpAudioFormat, '--audio-quality', '0');
      if (useThumbnail) {
        args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
      }
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      // Check common macOS & Linux ffmpeg locations if bundled ffmpeg isn't present
      const sysFfmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/bin/ffmpeg'].find(
        (p) => fs.existsSync(p)
      );
      if (sysFfmpeg) {
        args.push('--ffmpeg-location', sysFfmpeg);
        args.push('--extract-audio', '--audio-format', ytDlpAudioFormat, '--audio-quality', '0');
        if (useThumbnail) {
          args.push('--write-thumbnail', '--convert-thumbnails', 'jpg');
        }
      } else {
        args.push('-f', 'bestaudio');
        if (useThumbnail) {
          args.push('--write-thumbnail');
        }
      }
    } else {
      args.push('-f', 'bestaudio');
      if (useThumbnail) {
        args.push('--write-thumbnail');
      }
    }

    args.push(targetSpec);

    sendProgress(`Fetching from YT Music: ${rawQuery}`);

    await new Promise((resolve, reject) => {
      const proc = spawn(ytDlpExe, args, { windowsHide: true });

      proc.stdout.on('data', (chunk) => {
        const lines = chunk
          .toString()
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length > 0) {
          sendProgress(lines[lines.length - 1]);
        }
      });

      proc.stderr.on('data', (chunk) => {
        const lines = chunk
          .toString()
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length > 0) {
          sendProgress(lines[lines.length - 1]);
        }
      });

      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        const scanned = scanFolderForMedia(jobDir, useThumbnail);
        if (scanned.tracks.length > 0) {
          resolve();
        } else {
          reject(new Error(`YT Music import exited with code ${code} and found no audio tracks.`));
        }
      });
    });

    // Scan downloaded tracks and prefer actual lyrics from YouTube Music over captions
    const scanned = scanFolderForMedia(jobDir, useThumbnail);
    for (const track of scanned.tracks) {
      if (track.isInstrumental || isInstrumentalTrack(track.name)) {
        track.isInstrumental = true;
        track.lyrics = { instrumental: true, synced: false, lines: [] };
        continue;
      }

      // 1. Prefer actual song lyrics from YouTube Music official lyrics tab
      try {
        sendProgress(`Fetching YouTube Music lyrics for "${track.name}"...`);
        const ytmLyrics = await fetchLyricsFromYTM(track.name, track.videoId);
        if (ytmLyrics && ytmLyrics.instrumental) {
          track.isInstrumental = true;
          track.lyrics = { instrumental: true, synced: false, lines: [] };
          continue;
        }
        if (ytmLyrics && ytmLyrics.parsed && ytmLyrics.parsed.lines.length > 0 && !ytmLyrics.parsed.isCaption) {
          track.lyrics = {
            ...ytmLyrics.parsed,
            source: 'ytm'
          };
          const lrcPath = path.join(jobDir, `${track.name}.lrc`);
          fs.writeFileSync(lrcPath, ytmLyrics.rawLrc, 'utf-8');
          continue;
        }
      } catch (_) {}

      // 2. Fallback: If YTM has no lyrics tab, check LRCLIB for actual song lyrics
      try {
        sendProgress(`Checking LRCLIB for "${track.name}"...`);
        const lrclib = await fetchLyricsFromLrclib(track.name);
        if (lrclib && lrclib.instrumental) {
          track.isInstrumental = true;
          track.lyrics = { instrumental: true, synced: false, lines: [] };
          continue;
        }
        if (lrclib && lrclib.parsed && lrclib.parsed.lines.length > 0 && !lrclib.parsed.isCaption) {
          track.lyrics = {
            ...lrclib.parsed,
            source: 'lrclib'
          };
          const lrcPath = path.join(jobDir, `${track.name}.lrc`);
          fs.writeFileSync(lrcPath, lrclib.rawLrc, 'utf-8');
        }
      } catch (_) {}
    }

    return scanned;
  });

  ipcMain.handle('state:load', async () => {
    try {
      const file = getStateFilePath();
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('Failed to load state:', err);
    }
    return null;
  });

  ipcMain.handle('state:save', async (_event, stateData) => {
    try {
      const file = getStateFilePath();
      fs.writeFileSync(file, JSON.stringify(stateData, null, 2), 'utf-8');
      return true;
    } catch (err) {
      console.error('Failed to save state:', err);
      return false;
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  discordRpc.destroy();
  if (process.platform !== 'darwin') app.quit();
});

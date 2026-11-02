// Lightweight, rate-limit-safe Discord Rich Presence IPC client with automatic cover art hosting
const net = require('net');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { fileURLToPath } = require('url');

// Valid public Discord Application ID registered for YouTube Music / Desktop Player (@th-ch/pear-desktop)
const DEFAULT_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1177081335727267940';

class DiscordRPCClient {
  constructor(clientId = DEFAULT_CLIENT_ID) {
    this.clientId = clientId || DEFAULT_CLIENT_ID;
    this.enabled = true;
    this.socket = null;
    this.connected = false;
    this.ready = false;
    this.connecting = false;
    this.haltedByError = false;
    this.lastActivity = null;
    this.reconnectTimer = null;
    this.throttleTimer = null;
    this.lastSentAt = 0;
    this.onStatusChange = null;
    this.coverCache = new Map(); // sha1 -> httpsUrl
    this.pendingUploads = new Map(); // sha1 -> Promise<string|null>
    this.cacheFilePath = null;
  }

  initCacheFile(userDataDir) {
    try {
      this.cacheFilePath = path.join(userDataDir, 'discord-cover-cache.json');
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.cacheFilePath, 'utf-8'));
        if (raw && typeof raw === 'object') {
          for (const [k, v] of Object.entries(raw)) {
            if (typeof v === 'string' && v.startsWith('https://')) {
              this.coverCache.set(k, v);
            }
          }
        }
      }
    } catch (_) {
      // Ignore cache load error
    }
  }

  saveCacheFile() {
    if (!this.cacheFilePath) return;
    try {
      const obj = Object.fromEntries(this.coverCache.entries());
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (_) {
      // Ignore cache save error
    }
  }

  resolveLocalFilePath(coverRef) {
    if (!coverRef || typeof coverRef !== 'string') {
      return path.join(__dirname, 'assets', '180px-soundtrack_(nocturnal_style).png');
    }
    if (coverRef.startsWith('file://')) {
      try {
        return fileURLToPath(coverRef);
      } catch (_) {
        return null;
      }
    }
    if (path.isAbsolute(coverRef)) {
      return coverRef;
    }
    return path.join(__dirname, coverRef);
  }

  uploadBufferToCatbox(fileBuf, ext = '.png') {
    return new Promise((resolve) => {
      const boundary = '----NocturnalBoundary' + crypto.randomBytes(8).toString('hex');
      const mime =
        ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
          ? 'image/gif'
          : 'image/png';

      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="cover${ext}"\r\n` +
            `Content-Type: ${mime}\r\n\r\n`
        ),
        fileBuf,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);

      const req = https.request(
        'https://catbox.moe/user/api.php',
        {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
            'User-Agent': 'NocturnalPlayer/1.0'
          },
          timeout: 10000
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            const trimmed = data.trim();
            if (res.statusCode === 200 && /^https:\/\/files\.catbox\.moe\//i.test(trimmed)) {
              resolve(trimmed);
            } else {
              resolve(null);
            }
          });
        }
      );

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(body);
      req.end();
    });
  }

  uploadBufferToLitterbox(fileBuf, ext = '.png') {
    return new Promise((resolve) => {
      const boundary = '----NocturnalBoundary' + crypto.randomBytes(8).toString('hex');
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="time"\r\n\r\n72h\r\n` +
            `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="cover${ext}"\r\n` +
            `Content-Type: image/png\r\n\r\n`
        ),
        fileBuf,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);

      const req = https.request(
        'https://litterbox.catbox.moe/resources/internals/api.php',
        {
          method: 'POST',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
            'User-Agent': 'NocturnalPlayer/1.0'
          },
          timeout: 10000
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            const trimmed = data.trim();
            if (res.statusCode === 200 && /^https:\/\//i.test(trimmed)) {
              resolve(trimmed);
            } else {
              resolve(null);
            }
          });
        }
      );

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
      req.write(body);
      req.end();
    });
  }

  async resolveCoverHttpsUrl(coverRef) {
    if (coverRef && typeof coverRef === 'string' && /^https?:\/\//i.test(coverRef)) {
      return coverRef;
    }

    const localPath = this.resolveLocalFilePath(coverRef);
    if (!localPath || !fs.existsSync(localPath)) {
      return null;
    }

    try {
      const fileBuf = fs.readFileSync(localPath);
      const sha1 = crypto.createHash('sha1').update(fileBuf).digest('hex');

      if (this.coverCache.has(sha1)) {
        return this.coverCache.get(sha1);
      }

      if (this.pendingUploads.has(sha1)) {
        return await this.pendingUploads.get(sha1);
      }

      const ext = path.extname(localPath).toLowerCase() || '.png';
      const uploadPromise = (async () => {
        let url = await this.uploadBufferToCatbox(fileBuf, ext);
        if (!url) {
          url = await this.uploadBufferToLitterbox(fileBuf, ext);
        }
        if (url) {
          this.coverCache.set(sha1, url);
          this.saveCacheFile();
        }
        this.pendingUploads.delete(sha1);
        return url;
      })();

      this.pendingUploads.set(sha1, uploadPromise);
      return await uploadPromise;
    } catch (_) {
      return null;
    }
  }

  getPipePath(index) {
    if (process.platform === 'win32') {
      return `\\\\?\\pipe\\discord-ipc-${index}`;
    }
    const prefix =
      process.env.XDG_RUNTIME_DIR ||
      process.env.TMPDIR ||
      process.env.TMP ||
      process.env.TEMP ||
      '/tmp';
    return `${prefix.replace(/\/$/, '')}/discord-ipc-${index}`;
  }

  encodeFrame(op, data) {
    const payload = Buffer.from(JSON.stringify(data), 'utf8');
    const frame = Buffer.alloc(8 + payload.length);
    frame.writeInt32LE(op, 0);
    frame.writeInt32LE(payload.length, 4);
    payload.copy(frame, 8);
    return frame;
  }

  notifyStatus(statusText) {
    if (typeof this.onStatusChange === 'function') {
      this.onStatusChange({
        connected: this.ready,
        statusText,
        clientId: this.clientId
      });
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      if (this.socket && this.ready) {
        try {
          this.socket.write(
            this.encodeFrame(1, {
              cmd: 'SET_ACTIVITY',
              args: { pid: process.pid, activity: null },
              nonce: crypto.randomUUID()
            })
          );
        } catch (_) {}
      }
      this.destroy();
      this.notifyStatus('OFF');
    } else {
      this.manualReconnect();
    }
  }

  manualReconnect() {
    if (!this.enabled) return;
    this.haltedByError = false;
    this.destroy();
    this.notifyStatus('CONNECTING...');
    this.connect();
  }

  async connect() {
    if (!this.enabled || this.connected || this.connecting || this.haltedByError) return;
    this.connecting = true;

    for (let i = 0; i < 10; i++) {
      const pipePath = this.getPipePath(i);
      const sock = await new Promise((resolve) => {
        const client = net.createConnection(pipePath, () => resolve(client));
        client.once('error', () => {
          client.destroy();
          resolve(null);
        });
      });

      if (sock) {
        this.socket = sock;
        this.connected = true;
        this.connecting = false;
        this.setupSocketListeners(sock);
        sock.write(this.encodeFrame(0, { v: 1, client_id: this.clientId }));
        return;
      }
    }

    this.connecting = false;
    this.ready = false;
    this.notifyStatus('DISCORD CLOSED (CLICK TO RETRY)');
  }

  setupSocketListeners(sock) {
    let recvBuffer = Buffer.alloc(0);

    sock.on('data', (chunk) => {
      recvBuffer = Buffer.concat([recvBuffer, chunk]);

      while (recvBuffer.length >= 8) {
        const op = recvBuffer.readInt32LE(0);
        const len = recvBuffer.readInt32LE(4);
        if (recvBuffer.length < 8 + len) break;

        const bodyStr = recvBuffer.subarray(8, 8 + len).toString('utf8');
        recvBuffer = recvBuffer.subarray(8 + len);

        try {
          const msg = JSON.parse(bodyStr);

          if (op === 1 && msg.evt === 'READY') {
            this.ready = true;
            this.haltedByError = false;
            this.notifyStatus('CONNECTED');
            if (this.lastActivity) {
              this.sendActivityPayload(this.lastActivity);
            }
          } else if (op === 2) {
            this.ready = false;
            this.connected = false;
            this.haltedByError = true;
            this.notifyStatus('API COOLDOWN (CLICK TO RETRY)');
            sock.destroy();
          } else if (op === 3) {
            sock.write(this.encodeFrame(4, msg));
          }
        } catch (_) {
          // Ignore malformed JSON
        }
      }
    });

    sock.on('close', () => {
      this.connected = false;
      this.ready = false;
      this.socket = null;
      if (!this.haltedByError) {
        this.notifyStatus('STANDBY (CLICK TO RETRY)');
      }
    });

    sock.on('error', () => {
      this.connected = false;
      this.ready = false;
      this.socket = null;
    });
  }

  setActivity(activityData) {
    this.lastActivity = activityData;

    if (!this.ready) return;

    const now = Date.now();
    const elapsed = now - this.lastSentAt;
    if (elapsed >= 5000) {
      this.lastSentAt = now;
      this.sendActivityPayload(activityData);
    } else if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        this.lastSentAt = Date.now();
        if (this.ready && this.lastActivity) {
          this.sendActivityPayload(this.lastActivity);
        }
      }, 5000 - elapsed);
    }
  }

  sanitizeField(text, fallback) {
    const str = String(text || fallback || 'Nocturnal player').trim();
    return (str.length < 2 ? str + '  ' : str).slice(0, 128);
  }

  async sendActivityPayload(info) {
    if (!this.socket || !this.ready) return;

    const activity = {
      type: 2, // 2 = Listening
      details: this.sanitizeField(info.details, 'Nocturnal player'),
      state: this.sanitizeField(info.state, 'Idle'),
      instance: false
    };

    // Resolve cover art of currently playing music to an HTTPS URL for Discord's large_image
    const coverHttpsUrl = await this.resolveCoverHttpsUrl(info.coverUrl);
    if (!this.socket || !this.ready) return;

    if (coverHttpsUrl) {
      activity.assets = {
        large_image: coverHttpsUrl,
        large_text: this.sanitizeField(info.details, 'Nocturnal player')
      };
    }

    if (info.playing && Number.isFinite(info.duration) && info.duration > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      const currentSec = Number.isFinite(info.currentTime) ? Math.floor(info.currentTime) : 0;
      const startSec = nowSec - currentSec;
      const endSec = startSec + Math.floor(info.duration);
      activity.timestamps = {
        start: startSec,
        end: endSec
      };
    }

    const payload = {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity
      },
      nonce: crypto.randomUUID()
    };

    try {
      this.socket.write(this.encodeFrame(1, payload));
    } catch (_) {
      // Socket write error will trigger close
    }
  }

  destroy() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.ready = false;
    this.connecting = false;
  }
}

module.exports = { DiscordRPCClient, DEFAULT_CLIENT_ID };

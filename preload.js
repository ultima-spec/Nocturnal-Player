const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicAPI', {
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  selectAudioFiles: () => ipcRenderer.invoke('dialog:selectAudioFiles'),
  selectCoverArt: () => ipcRenderer.invoke('dialog:selectCoverArt'),
  selectLrcFile: () => ipcRenderer.invoke('dialog:selectLrcFile'),
  importFromYTMusic: (payload) => ipcRenderer.invoke('ytm:import', payload),
  onYTMusicProgress: (callback) => {
    const listener = (_event, msg) => callback(msg);
    ipcRenderer.on('ytm:progress', listener);
    return () => ipcRenderer.removeListener('ytm:progress', listener);
  },
  fetchLyrics: (payload) => ipcRenderer.invoke('lyrics:fetch', payload),
  deleteLocalLyrics: (filePath) => ipcRenderer.invoke('lyrics:delete', filePath),
  updateDiscordPresence: (payload) => ipcRenderer.invoke('discord:update', payload),
  reconnectDiscord: (clientId) => ipcRenderer.invoke('discord:reconnect', clientId),
  setDiscordEnabled: (enabled) => ipcRenderer.invoke('discord:setEnabled', enabled),
  onDiscordStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('discord:status', listener);
    return () => ipcRenderer.removeListener('discord:status', listener);
  },
  createShortcuts: () => ipcRenderer.invoke('installer:createShortcuts'),
  toggleAppFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
  getWindowBounds: () => ipcRenderer.invoke('window:getBounds'),
  setWindowBounds: (bounds) => ipcRenderer.invoke('window:setBounds', bounds),
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (state) => ipcRenderer.invoke('state:save', state)
});

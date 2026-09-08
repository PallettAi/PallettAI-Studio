// Preload bridge — sandboxed, no Node access in the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pallettai', {
  isElectron: true,
  platform: process.platform,
  versions: {
    app: process.env.npm_package_version || '',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },
  // Subscribe to native-menu actions: 'settings' | 'dashboard' | 'designer' |
  // 'ai' | 'suites' | 'database' | 'new-project' | 'save'
  onMenu: (cb) => {
    const listener = (_e, action) => cb(action);
    ipcRenderer.on('menu', listener);
    return () => ipcRenderer.removeListener('menu', listener);
  },
  secretsGet: (key) => ipcRenderer.invoke('secrets-get', key),
  secretsSet: (key, value) => ipcRenderer.invoke('secrets-set', key, value),
  // Electron-only: a safeStorage-backed session store so the Supabase module
  // can move the refresh token out of localStorage. The methods route through
  // sync IPC channels that validate the sender in main; the browser build has
  // no such channels and window.pallettai is absent, so localStorage is kept.
  sessionStore: () => ({
    get: (key) => ipcRenderer.sendSync('session-get', key),
    set: (key, value) => ipcRenderer.sendSync('session-set', key, value),
    remove: (key) => ipcRenderer.sendSync('session-remove', key)
  })
});

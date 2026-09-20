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
  // Electron-only: mirror the studio's theme choice into the shell so the next
  // launch's startup splash can open in the same palette. Fire-and-forget — the
  // value only matters after this window is gone, and main re-validates it.
  setTheme: (theme) => ipcRenderer.send('theme-changed', theme),
  secretsGet: (key) => ipcRenderer.invoke('secrets-get', key),
  secretsSet: (key, value) => ipcRenderer.invoke('secrets-set', key, value),
  secretsGetSync: (key) => { try { return ipcRenderer.sendSync('secrets-get-sync', key) || ''; } catch (_) { return ''; } },
  secretsSetSync: (key, value) => { try { return !!ipcRenderer.sendSync('secrets-set-sync', key, value); } catch (_) { return false; } },
  // Crash reporting consent mirror: the renderer owns the settings, the main
  // process owns its own process-level handlers, so the choice is forwarded.
  setCrashPrefs: (enabled, dsn) => ipcRenderer.send('crash-report-prefs', { enabled: !!enabled, dsn: String(dsn || '') }),
  // OS accent colour (Electron only): hex without '#' (e.g. '22d3ee'), '' when
  // unavailable. onAccent subscribes to live OS accent changes.
  getAccent: () => ipcRenderer.invoke('get-accent'),
  onAccent: (cb) => {
    const listener = (_e, color) => cb(color);
    ipcRenderer.on('accent-changed', listener);
    return () => ipcRenderer.removeListener('accent-changed', listener);
  },
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

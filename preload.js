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
  secretsSet: (key, value) => ipcRenderer.invoke('secrets-set', key, value)
});

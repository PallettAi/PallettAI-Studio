// Preload bridge — sandboxed, no Node access in the renderer.
const { contextBridge, ipcRenderer } = require('electron');

// One surface, exposed under both names. The renderer's own contract
// (ui/runtime.js) prefers `pallettaiAPI` and falls back to `pallettai`, so
// shipping both means neither spelling can silently disable the bridge.
const api = {
  isElectron: true,
  platform: process.platform,
  // main.js disables GPU acceleration by default for machines that cannot
  // initialise Electron's EGL process. Tell the shell so it can also disable
  // CSS effects that are expensive under software compositing.
  softwareRendering: process.env.PALLETTAI_HARDWARE_ACCELERATION !== '1',
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
  // Signed data-only hotfixes. The main process verifies the manifest before
  // this promise can resolve; the renderer only receives bounded JSON data.
  getHotfix: () => ipcRenderer.invoke('hotfix-get'),
  // Dynamic Widget Engine: compiles a plain-English request into a
  // zero-dependency web component for the static export. Resolves to
  // { ok, id, fallback, warnings, definition } — never rejects, so an
  // export is not aborted by one widget that could not be built.
  generateWidget: (prompt, tokens) => ipcRenderer.invoke('widget:generate', prompt, tokens),
  // Copy engine (modules/copy-optimizer.js + modules/copy-ast-editor.js), the
  // backend behind the Section Toolbar's Voice Lock controls. Both resolve to a
  // result envelope ({ ok, text } / { ok, html }) and never reject, so one
  // failed rewrite cannot take the preview down with it.
  //   optimizeCopy(text, { voiceLock, framework, niche }) -> { ok, text, beats, … }
  //   applySectionCopy(html, sectionId, payload)           -> { ok, html, applied, … }
  optimizeCopy: (text, options) => ipcRenderer.invoke('copy:optimize', text, options),
  applySectionCopy: (html, sectionId, payload) => ipcRenderer.invoke('copy:apply-section', html, sectionId, payload),
  // Static export build (modules/static-compiler.js via main/index.js):
  // compiles the project — or a pre-built file list from the Builder —
  // and writes the folder with async fs.promises to a directory the user
  // picks, with a sha256 integrity manifest. Resolves to
  // { ok, value | error, code } and never rejects, so a failed build is a
  // message rather than an unhandled rejection.
  //   compileStatic({ project | files, outputDir?, pickDirectory?,
  //                   verify?, generatedAt? })
  compileStatic: (projectPayload) => ipcRenderer.invoke('project:compile-static', projectPayload),
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
};

contextBridge.exposeInMainWorld('pallettai', api);
contextBridge.exposeInMainWorld('pallettaiAPI', api);

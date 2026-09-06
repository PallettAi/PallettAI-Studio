// PallettAI Studio — desktop shell (macOS first-class, Windows/Linux run too).
// Distribution is direct-download (Developer ID + notarized DMG), NOT the Mac App Store.
const { app, BrowserWindow, Menu, shell, dialog, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  main();
}

function main() {
  let win = null;
  let stateTimer = null;
  let startupWindow = null;
  let startupWindowReady = false;
  let startupStatus = {
    message: 'Preparing Studio…',
    detail: 'Getting everything ready.',
    progress: null
  };

  // ---------------------------------------------------------------- window state
  const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

  function loadState() {
    try {
      return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    } catch (_) {
      return { width: 1440, height: 900 };
    }
  }

  function saveState() {
    if (!win || win.isDestroyed()) return;
    const s = { isMaximized: win.isMaximized() };
    if (!win.isMaximized() && !win.isFullScreen()) {
      s.bounds = win.getBounds();
    } else {
      const b = loadState().bounds;
      if (b) s.bounds = b;
    }
    try { fs.writeFileSync(stateFile(), JSON.stringify(s)); } catch (_) {}
  }

  function scheduleSaveState() {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(saveState, 400);
  }

  // ---------------------------------------------------------------- window
  function createWindow() {
    const prev = loadState();
    // Make sure the saved position is still on a connected display.
    const onDisplay = screenBoundsContain(prev.bounds);
    const opts = {
      width: prev.bounds && onDisplay ? prev.bounds.width : 1440,
      height: prev.bounds && onDisplay ? prev.bounds.height : 900,
      minWidth: 1100,
      minHeight: 700,
      title: 'PallettAI Studio',
      backgroundColor: '#0f1020',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true
      }
    };
    if (prev.bounds && onDisplay) {
      opts.x = prev.bounds.x;
      opts.y = prev.bounds.y;
    }
    win = new BrowserWindow(opts);

    win.once('ready-to-show', () => {
      if (prev.isMaximized) win.maximize();
      closeStartupWindow();
      win.show();
    });

    win.on('resize', scheduleSaveState);
    win.on('move', scheduleSaveState);
    win.on('close', () => { clearTimeout(stateTimer); saveState(); });

    win.loadFile('index.html');

    // External links always open in the system browser, never inside the app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (url !== win.webContents.getURL() && isSafeExternalUrl(url)) {
        e.preventDefault();
        shell.openExternal(url);
      } else if (url !== win.webContents.getURL()) {
        e.preventDefault();
      }
    });

    win.on('closed', () => { win = null; });
  }

  function isSafeExternalUrl(url) {
    try {
      const parsed = new URL(String(url || ''));
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (_) {
      return false;
    }
  }

  const SECRET_KEYS = new Set(['publish.netlifyToken', 'publish.neocitiesKey']);

  function secretsStorePath() {
    return path.join(app.getPath('userData'), 'publish-secrets.bin');
  }

  function readAllSecrets() {
    try {
      const buf = fs.readFileSync(secretsStorePath());
      if (safeStorage.isEncryptionAvailable()) {
        return JSON.parse(safeStorage.decryptString(buf));
      }
      return JSON.parse(buf.toString('utf8'));
    } catch (_) {
      return {};
    }
  }

  function writeAllSecrets(obj) {
    const json = JSON.stringify(obj || {});
    const payload = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)
      : Buffer.from(json, 'utf8');
    fs.writeFileSync(secretsStorePath(), payload, { mode: 0o600 });
    return true;
  }

  function registerSecretIpc() {
    ipcMain.handle('secrets-get', (event, key) => {
      if (!win || event.sender !== win.webContents) return '';
      const name = String(key || '');
      if (!SECRET_KEYS.has(name)) return '';
      const all = readAllSecrets();
      return typeof all[name] === 'string' ? all[name] : '';
    });
    ipcMain.handle('secrets-set', (event, key, value) => {
      if (!win || event.sender !== win.webContents) return false;
      const name = String(key || '');
      if (!SECRET_KEYS.has(name)) return false;
      const all = readAllSecrets();
      const next = String(value == null ? '' : value);
      if (next) all[name] = next;
      else delete all[name];
      return writeAllSecrets(all);
    });
  }

  function screenBoundsContain(b) {
    if (!b || typeof b.x !== 'number') return false;
    const { screen } = require('electron');
    return screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
  }

  // ---------------------------------------------------------------- menu actions
  function send(action) {
    if (win && !win.isDestroyed()) win.webContents.send('menu', action);
  }

  function openSettings() { send('settings'); }
  function newProject() { send('new-project'); }
  function saveNow() { send('save'); }
  function openAiStudio() { send('ai'); }

  // ---------------------------------------------------------------- startup update gate
  // Packaged builds check before the main workspace is created. This keeps the
  // first-use experience on the newest release, while still allowing an
  // offline user to get to their work after a bounded check timeout.
  let updater = null;
  let startupUpdateRunning = false;
  let manualUpdateInFlight = false;
  const STARTUP_CHECK_TIMEOUT_MS = 20000;
  const STARTUP_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

  function createStartupWindow() {
    if (startupWindow && !startupWindow.isDestroyed()) return;
    startupWindowReady = false;
    startupWindow = new BrowserWindow({
      width: 460,
      height: 300,
      show: true,
      resizable: false,
      movable: true,
      center: true,
      title: 'PallettAI Studio',
      backgroundColor: '#0f1020',
      frame: false,
      alwaysOnTop: true,
      closable: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    startupWindow.on('closed', () => {
      startupWindow = null;
      startupWindowReady = false;
    });
    startupWindow.webContents.on('did-finish-load', () => {
      startupWindowReady = true;
      setStartupStatus(startupStatus.message, startupStatus.detail, startupStatus.progress);
    });
    const splash = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="dark"><style>
      :root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:grid;place-items:center;background:radial-gradient(circle at 20% 0%,rgba(139,92,246,.24),transparent 48%),#0f1020;color:#f5f2ff;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{text-align:center;width:100%;padding:34px 38px}.mark{width:48px;height:48px;margin:0 auto 18px;border:1px solid rgba(194,150,255,.5);border-radius:16px;display:grid;place-items:center;color:#d8b9ff;font-size:22px;box-shadow:0 0 34px rgba(139,92,246,.28)}h1{font-size:19px;letter-spacing:-.03em;margin:0 0 10px}#status{font-weight:600;color:#f5f2ff}#detail{min-height:38px;margin:8px auto 18px;max-width:330px;color:#a7a1b7;font-size:12px;line-height:1.5}.track{height:4px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}.fill{height:100%;width:34%;border-radius:inherit;background:linear-gradient(90deg,#9b6cff,#e1c5ff);animation:pulse 1.5s ease-in-out infinite}.track.has-progress .fill{animation:none}@keyframes pulse{0%,100%{opacity:.45;transform:translateX(-55%)}50%{opacity:1;transform:translateX(190%)}}
    </style></head><body><main class="card" aria-live="polite"><div class="mark">◆</div><h1>PallettAI Studio</h1><div id="status">Preparing Studio…</div><div id="detail">Getting everything ready.</div><div class="track" id="track"><div class="fill" id="fill"></div></div></main><script>window.__setStatus=function(message,detail,progress){document.getElementById('status').textContent=message||'';document.getElementById('detail').textContent=detail||'';var track=document.getElementById('track');var fill=document.getElementById('fill');if(typeof progress==='number'){track.classList.add('has-progress');fill.style.width=Math.max(0,Math.min(100,progress))+'%';fill.style.transform='none';}else{track.classList.remove('has-progress');fill.style.width='34%';fill.style.transform='';}};</script></body></html>`;
    startupWindow.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(splash));
  }

  function setStartupStatus(message, detail, progress) {
    startupStatus = { message: message || '', detail: detail || '', progress: typeof progress === 'number' ? progress : null };
    if (!startupWindow || startupWindow.isDestroyed() || !startupWindowReady) return;
    startupWindow.webContents.executeJavaScript(
      'window.__setStatus(' + JSON.stringify(startupStatus.message) + ',' + JSON.stringify(startupStatus.detail) + ',' + JSON.stringify(startupStatus.progress) + ')'
    ).catch(() => {});
  }

  function closeStartupWindow() {
    if (startupWindow && !startupWindow.isDestroyed()) startupWindow.close();
    startupWindow = null;
    startupWindowReady = false;
  }

  function withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(message));
        }
      }, timeoutMs);
      Promise.resolve(promise).then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function initUpdater() {
    if (!app.isPackaged) return; // dev mode: never check
    try {
      const { autoUpdater } = require('electron-updater');
      updater = autoUpdater;
      // Startup owns the download explicitly so the main window cannot appear
      // before the update is installed. Manual checks use this same path.
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = true;
      updater.on('checking-for-update', () => {
        if (startupUpdateRunning) setStartupStatus('Checking for updates…', 'Looking for the latest Studio release.');
      });
      updater.on('update-available', (info) => {
        if (startupUpdateRunning) setStartupStatus('Update found', 'Preparing ' + ((info && info.version) || 'the latest version') + '…', 0);
      });
      updater.on('update-not-available', () => {
        if (startupUpdateRunning) setStartupStatus('Studio is up to date', 'Starting your workspace…', 100);
      });
      updater.on('download-progress', (progress) => {
        if (!startupUpdateRunning) return;
        const percent = progress && Number.isFinite(progress.percent) ? progress.percent : null;
        const shown = percent === null ? 'Downloading update…' : 'Downloading update… ' + Math.round(percent) + '%';
        setStartupStatus(shown, 'The update will be installed before Studio opens.', percent);
      });
      updater.on('update-downloaded', () => {
        // The startup gate calls quitAndInstall itself. Avoid displaying a
        // restart prompt while the splash screen is still protecting launch.
        // A timed-out/failed manual operation may finish late; ignore that
        // stale event instead of interrupting the user's current work.
        if (startupUpdateRunning || !manualUpdateInFlight) return;
        const r = dialog.showMessageBoxSync(win, {
          type: 'info',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          title: 'PallettAI Studio',
          message: 'A new version of PallettAI Studio is ready.',
          detail: 'Restart now to install it, or it will install when you quit.'
        });
        if (r === 0) updater.quitAndInstall(false, true);
      });
      updater.on('error', (err) => {
        // A missing release, offline connection, or a failed download must not
        // strand the creator at startup. The current app remains usable.
        console.error('auto-update:', err && err.message);
        if (startupUpdateRunning) setStartupStatus('Starting current version', 'The update service is unavailable right now.');
      });
    } catch (e) {
      console.error('updater unavailable:', e && e.message);
      updater = null;
    }
  }

  async function runStartupUpdateGate() {
    if (!app.isPackaged || !updater) return false;
    createStartupWindow();
    startupUpdateRunning = true;
    setStartupStatus('Checking for updates…', 'Current version ' + app.getVersion() + ' · this usually takes a few seconds.');
    try {
      const result = await withTimeout(
        updater.checkForUpdates(),
        STARTUP_CHECK_TIMEOUT_MS,
        'Startup update check timed out'
      );
      if (!result || !result.isUpdateAvailable) {
        setStartupStatus('Studio is up to date', 'Starting your workspace…', 100);
        await wait(350);
        return false;
      }
      const info = result.updateInfo || result.versionInfo || {};
      const nextVersion = info.version || 'the latest version';
      setStartupStatus('Update found', 'Downloading ' + nextVersion + ' before Studio opens…', 0);
      await withTimeout(
        updater.downloadUpdate(),
        STARTUP_DOWNLOAD_TIMEOUT_MS,
        'Update download timed out'
      );
      setStartupStatus('Installing update…', 'Studio will restart automatically.', 100);
      await wait(250);
      startupUpdateRunning = false;
      updater.quitAndInstall(false, true);
      return true;
    } catch (error) {
      console.error('startup update:', error && error.message);
      setStartupStatus('Starting current version', 'No update was installed. You can try again from the app menu.');
      await wait(600);
      return false;
    } finally {
      startupUpdateRunning = false;
    }
  }

  async function checkForUpdatesManually() {
    if (!updater) {
      dialog.showMessageBoxSync(win, {
        type: 'info',
        title: 'PallettAI Studio',
        message: 'Updates are available in packaged releases.',
        detail: 'Run the installed version of Studio to use automatic updates.'
      });
      return;
    }
    if (manualUpdateInFlight) return;
    manualUpdateInFlight = true;
    try {
      const result = await updater.checkForUpdates();
      if (!result || !result.isUpdateAvailable) {
        dialog.showMessageBoxSync(win, {
          type: 'info',
          title: 'PallettAI Studio',
          message: 'You are on the latest version.',
          detail: 'Studio checks again automatically the next time it starts.'
        });
        return;
      }
      await updater.downloadUpdate();
      // update-downloaded displays the existing Restart now / Later prompt.
    } catch (error) {
      console.error('manual update:', error && error.message);
      dialog.showMessageBoxSync(win, {
        type: 'error',
        title: 'Update unavailable',
        message: 'Studio could not download the update.',
        detail: 'Check your internet connection and try again later.'
      });
    } finally {
      manualUpdateInFlight = false;
    }
  }

  // ---------------------------------------------------------------- menu
  function buildMenu() {
    const isDev = !app.isPackaged;
    const template = [
      ...(isMac ? [{
        label: app.name,
        submenu: [
          { role: 'about', label: 'About PallettAI Studio' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'Cmd+,', click: openSettings },
          { type: 'separator' },
          { label: 'Check for Updates…', click: () => { checkForUpdatesManually(); } },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }] : []),
      {
        label: 'File',
        submenu: [
          { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: newProject },
          { type: 'separator' },
          { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: saveNow },
          { type: 'separator' },
          isMac ? { role: 'close', label: 'Close Window' } : { role: 'quit', label: 'Exit' }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' }, { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload', label: 'Reload Studio' },
          ...(isDev ? [{ role: 'toggleDevTools' }] : []),
          { type: 'separator' },
          { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Toggle Full Screen' }
        ]
      },
      {
        label: 'Go',
        submenu: [
          { label: 'Dashboard', accelerator: 'CmdOrCtrl+1', click: () => send('dashboard') },
          { label: 'Designer', accelerator: 'CmdOrCtrl+2', click: () => send('designer') },
          { label: 'AI Studio', accelerator: 'CmdOrCtrl+3', click: openAiStudio },
          { label: 'Upgrade Suites', accelerator: 'CmdOrCtrl+4', click: () => send('suites') },
          { label: 'Database', accelerator: 'CmdOrCtrl+5', click: () => send('database') },
          { label: 'Settings', accelerator: 'CmdOrCtrl+6', click: openSettings }
        ]
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          ...(isMac ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }] : [{ role: 'close' }])
        ]
      },
      {
        role: 'help',
        submenu: [
          // macOS already exposes Check for Updates… in the app menu; Windows &
          // Linux get it here in Help instead.
          ...(!isMac ? [{ label: 'Check for Updates…', click: () => { checkForUpdatesManually(); } }, { type: 'separator' }] : []),
          { label: 'Open pallettai.org', click: () => shell.openExternal('https://pallettai.org') },
          { label: 'Report a Bug', click: () => shell.openExternal('https://pallettai.org/contact') },
          { label: 'Download for Another Platform', click: () => shell.openExternal('https://pallettai.org') }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  // ---------------------------------------------------------------- lifecycle
  app.whenReady().then(() => {
    app.setName('PallettAI Studio');
    if (isMac) {
      app.setAboutPanelOptions({
        applicationName: 'PallettAI Studio',
        applicationVersion: app.getVersion(),
        copyright: 'Made by PallettAI',
        website: 'https://pallettai.org'
      });
    }
    initUpdater();
    buildMenu();
    registerSecretIpc();
    app.on('activate', () => {
      if (startupUpdateRunning) {
        if (startupWindow && !startupWindow.isDestroyed()) startupWindow.focus();
        return;
      }
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else if (win) { win.show(); win.focus(); }
    });

    runStartupUpdateGate().then((restarting) => {
      if (!restarting && !win) createWindow();
    }).catch((error) => {
      // A defensive last resort: a failed updater must never prevent Studio
      // from opening, even if a future updater implementation throws outside
      // its normal guarded path.
      console.error('startup lifecycle:', error && error.message);
      if (!win) createWindow();
    });
  });

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else if (startupWindow && !startupWindow.isDestroyed()) {
      startupWindow.show();
      startupWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}

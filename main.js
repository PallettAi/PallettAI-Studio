// PallettAI Studio — desktop shell (macOS first-class, Windows/Linux run too).
// Distribution is direct-download (Developer ID + notarized DMG), NOT the Mac App Store.
const { app, BrowserWindow, Menu, shell, dialog, ipcMain, safeStorage, nativeTheme, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const isMac = process.platform === 'darwin';

// Some macOS machines (especially older Intel/remote-display sessions) cannot
// initialise Electron's EGL GPU process. Electron then falls back inconsistently
// and the Studio can appear as a blank or partially painted window. The app is
// primarily DOM/CSS work, so prefer a reliable software compositor. An explicit
// opt-in keeps a hardware-GPU escape hatch for machines where it is known to be
// healthy.
if (process.env.PALLETTAI_HARDWARE_ACCELERATION !== '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}

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

  // ---------------------------------------------------------------- crash reporting
  // The main process is where a renderer death is OBSERVED. crashReporter
  // (native minidumps for real crashes) plus process-level handlers for
  // uncaught exceptions/rejections give the opt-in channel something honest to
  // send. OFF until the renderer sends crash-reporting-enabled=true — the
  // renderer owns the settings flag, so it is the single source of truth for
  // consent, and a fresh install reports nothing at all.
  let crashReportsEnabled = false;
  let crashReportDsn = 'https://ingest.pallettai.org/studio-errors';
  let crashUploads = [];
  function startCrashReporter() {
    try {
      require('electron').crashReporter.start({
        uploadToServer: false, // JS-side uploader below; never a background channel
        compress: true
      });
    } catch (e) { /* unavailable in this Electron build — the JS channel still works */ }
    process.on('uncaughtException', (err) => {
      try { console.error('main uncaught:', err && err.message); } catch (_) {}
      queueCrashEvent({ type: 'uncaught-exception', message: (err && err.message) || 'uncaught in main' });
    });
    process.on('unhandledRejection', (reason) => {
      queueCrashEvent({ type: 'unhandled-rejection', message: (reason && reason.message) || String(reason || 'unhandled in main') });
    });
  }
  function queueCrashEvent(input) {
    if (!crashReportsEnabled) return; // consent is set by the renderer's settings
    try {
      const CrashReport = require('./data/crashreport.js');
      crashUploads.push(CrashReport.makeEvent(Object.assign({}, input, {
        scope: 'main',
        installation: 'main',
        session: 'main-' + process.pid,
        appVersion: app.getVersion(),
        platform: process.platform + ' electron/' + process.versions.electron
      })));
      if (crashUploads.length > 30) crashUploads.splice(0, crashUploads.length - 30);
      scheduleCrashFlush();
    } catch (e) { /* reporting must never crash the crash reporter */ }
  }
  let crashFlushTimer = null;
  function scheduleCrashFlush() {
    if (crashFlushTimer) return;
    crashFlushTimer = setTimeout(flushCrashEvents, 10000);
  }
  // The renderer owns the settings and mirrors the crash-reporting choice here
  // (validated like every other channel): enabled flag + optional ingest URL.
  function registerCrashIpc() {
    ipcMain.on('crash-report-prefs', (event, prefs) => {
      if (!fromMainFrame(event, win)) return;
      if (!prefs || typeof prefs !== 'object') return;
      crashReportsEnabled = prefs.enabled === true;
      const dsn = String(prefs.dsn || '');
      if (!dsn) return; // keep the default endpoint when the setting is just a toggle
      try { crashReportDsn = (new URL(dsn).protocol === 'https:') ? dsn : crashReportDsn; } catch (_) { /* keep last good */ }
      if (!crashReportsEnabled) crashUploads.length = 0; // consent withdrawn — drop anything unsent
    });
  }

  async function flushCrashEvents() {
    crashFlushTimer = null;
    if (!crashReportsEnabled || !crashUploads.length) return;
    const batch = crashUploads.splice(0, crashUploads.length);
    try {
      const CrashReport = require('./data/crashreport.js');
      await fetch(CrashReport.storeUrlFromDsn(crashReportDsn), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch })
      });
    } catch (e) {
      // Keep the batch for the next flush rather than losing the report.
      crashUploads = batch.concat(crashUploads).slice(-30);
    }
  }

  // ---------------------------------------------------------------- helpers: atomic writes + safeStorage warnings
  let warnedNoEncryption = false;
  function encryptionAvailable() {
    try { return safeStorage.isEncryptionAvailable(); } catch (_) { return false; }
  }
  function warnIfPlaintextStore(where) {
    if (!warnedNoEncryption && !encryptionAvailable()) {
      warnedNoEncryption = true;
      console.warn(`[security] safeStorage unavailable — ${where} will be stored in plaintext on disk (mode 0600). OS keychain not accessible; secrets remain gated by file permissions (0600) but not OS-encrypted. Set PALLETTAI_FAIL_CLOSED=1 to refuse plaintext writes.`);
    }
  }
  function failClosedIfNoEncryption(where) {
    if (!encryptionAvailable() && process.env.PALLETTAI_FAIL_CLOSED === '1') {
      throw new Error(`${where}: safeStorage unavailable and PALLETTAI_FAIL_CLOSED=1 — refusing plaintext`);
    }
  }
  function writeFileAtomic(filePath, data, mode = 0o600) {
    const dir = path.dirname(filePath);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    fs.writeFileSync(tmp, buf, { mode });
    try { fs.chmodSync(tmp, mode); } catch (_) {}
    fs.renameSync(tmp, filePath);
    try { fs.chmodSync(filePath, mode); } catch (_) {}
  }

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
    const s = loadState();
    s.isMaximized = win.isMaximized();
    if (!win.isMaximized() && !win.isFullScreen()) {
      s.bounds = win.getBounds();
    } else {
      const b = loadState().bounds;
      if (b) s.bounds = b;
    }
    try { writeFileAtomic(stateFile(), JSON.stringify(s), 0o600); } catch (_) {}
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
      // Matches the studio's own --bg, and follows the saved theme so a light-mode
      // user never sees a flash of navy on launch. See shellUsesLight().
      backgroundColor: shellUsesLight() ? '#f2f7fc' : '#04122b',
      show: false,
      // macOS: hiddenInset titlebar lets the studio topbar flow under the
      // traffic lights for a native feel. Windows/Linux keep the standard bar.
      ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } } : {}),
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

    // Reveal the main window — and dismiss the startup splash — on the first of:
    // ready-to-show (first paint), did-finish-load (content ready), or a 6s
    // fallback timer. Relying on ready-to-show alone let the splash strand when
    // that event was delayed (e.g. software-GL rendering), trapping an
    // always-on-top, non-closable window over a usable app.
    let revealed = false;
    let revealTimer = null;
    function revealMainWindow() {
      if (revealed || !win || win.isDestroyed()) return;
      revealed = true;
      if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
      if (prev.isMaximized) win.maximize();
      closeStartupWindow();
      win.show();
    }
    win.once('ready-to-show', revealMainWindow);
    win.webContents.once('did-finish-load', revealMainWindow);

    win.on('resize', scheduleSaveState);
    win.on('move', scheduleSaveState);
    win.on('close', () => { clearTimeout(stateTimer); saveState(); });

    // Keep renderer diagnostics visible in development/source launches. This is
    // deliberately console-only: it does not collect or upload page content.
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const label = ['debug', 'info', 'warning', 'error'][level] || String(level);
      console.log(`[renderer:${label}] ${message} (${path.basename(String(sourceId || 'index.html'))}:${line})`);
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error(`[renderer:load-failed] ${errorCode} ${errorDescription} ${validatedURL}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[renderer:gone] reason=${details && details.reason} exitCode=${details && details.exitCode}`);
    });

    win.loadFile('index.html');
    revealTimer = setTimeout(revealMainWindow, 6000);

    // External links always open in the system browser, never inside the app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isSafeExternalUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    // P0 hardening: deny <webview> creation entirely (the app never uses it).
    win.webContents.on('will-attach-webview', (e) => {
      e.preventDefault();
    });

    // P0 hardening: deny renderer permission requests by default.
    // NOTE: setPermissionRequestHandler lives on the Session, not on webContents.
    win.webContents.session.setPermissionRequestHandler((_request, callback) => {
      callback(false);
    });

    // Native right-click menus (upgrade #7). The renderer tags contextmenu
    // events with data-ctx on the closest interactive element; main builds a
    // native Menu from a strict allow-list. No renderer-supplied menu text is
    // ever shown — only these known actions run, so a compromised renderer
    // cannot inject arbitrary menu content.
    win.webContents.on('context-menu', (_e, params) => {
      const mid = params.midpoint || { x: params.x, y: params.y };
      void mid;
      const items = [];
      const editable = params.isEditable;
      const hasSel = !!params.selectionText.trim();
      const link = params.linkURL && /^https?:\/\//i.test(params.linkURL) ? params.linkURL : '';
      const media = params.mediaType === 'image' ? params.srcURL : '';
      if (editable) {
        items.push(
          { role: 'cut', enabled: hasSel, label: 'Cut' },
          { role: 'copy', enabled: hasSel, label: 'Copy' },
          { role: 'paste', label: 'Paste' },
          { role: 'selectAll', label: 'Select All' }
        );
      } else if (hasSel) {
        items.push(
          { role: 'copy', label: 'Copy' },
          { type: 'separator' },
          { role: 'selectAll', label: 'Select All' }
        );
      }
      if (link) {
        if (items.length) items.push({ type: 'separator' });
        items.push({ label: 'Open Link in Browser', click: () => { if (isSafeExternalUrl(link)) shell.openExternal(link); } },
          { label: 'Copy Link Address', click: () => { try { require('electron').clipboard.writeText(link); } catch (_) {} } });
      }
      if (media) {
        if (items.length) items.push({ type: 'separator' });
        items.push({ label: 'Copy Image Address', click: () => { try { require('electron').clipboard.writeText(media); } catch (_) {} } });
      }
      if (!items.length) return; // no useful actions → keep the default (no menu)
      Menu.buildFromTemplate(items).popup({ window: win });
    });
    // The *check* side (navigator.permissions.query and synchronous capability
    // probes) is a separate Electron hook — denying only requests leaves those
    // reporting a better answer than the request would have got. Deny both.
    win.webContents.session.setPermissionCheckHandler(() => false);

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

  // Only real web links leave the app, and only over TLS — with the single
  // exception of loopback, which the dev workflow uses. This value can come
  // from project data, so everything else (file:, javascript:, data:, smb:,
  // custom app schemes) is refused rather than handed to the OS opener.
  function isSafeExternalUrl(url) {
    try {
      const parsed = new URL(String(url || ''));
      if (parsed.protocol === 'https:') return true;
      if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return true;
      return false;
    } catch (_) {
      return false;
    }
  }

  // Every privileged channel below may only be reached from the MAIN frame of the
  // window that owns it. Checking `event.sender` alone is NOT enough, and this is
  // the subtle half: the Designer renders the exported site — including its own
  // inline scripts and whatever an imported project put in a widget field — in a
  // same-origin about:srcdoc iframe, so that document shares this WebContents and
  // can see window.pallettai through `parent`. A frame cannot forge
  // `event.senderFrame`: Electron fills it from the frame that really sent the
  // message, so a widget running inside the preview reaches the bridge and is
  // refused by it. The alternative — sandboxing the preview frame into an opaque
  // origin — is not open to us, because renderPreview() reads
  // `f.contentDocument` to wire multi-page and legal-page navigation.
  // The property that actually matters is "this did not come from a subframe": a
  // subframe always has a parent and a top-level frame never does. Testing that
  // first, with an identity check against mainFrame as a second opinion, keeps
  // this correct across Electron versions rather than depending on how reliably
  // mainFrame compares by reference. When a build offers no frame at all the
  // message is accepted, which is the pre-existing behaviour and no worse.
  const fromMainFrame = (event, target) => {
    if (!target || target.isDestroyed() || event.sender !== target.webContents) return false;
    const frame = event.senderFrame;
    if (!frame) return true;
    return frame.parent == null || frame === target.webContents.mainFrame;
  };

  const SECRET_KEYS = new Set(['publish.netlifyToken', 'publish.neocitiesKey', 'publish.vercelToken', 'publish.cloudflareToken', 'publish.githubToken', 'online.pixabayKey', 'online.companiesHouseKey']);

  // ---------------------------------------------------------------- signed data-only hotfixes
  // The hotfix channel can change bounded data while Studio is open; it can
  // never replace executable app code. A public key must be configured in the
  // packaged build (or PALLETTAI_HOTFIX_PUBLIC_KEY in a source run). Empty means
  // disabled, which is the safe default until the release key is provisioned.
  const HOTFIX_URL = process.env.PALLETTAI_HOTFIX_URL || 'https://pallettai.org/studio/hotfix.json';
  const HOTFIX_PUBLIC_KEY = process.env.PALLETTAI_HOTFIX_PUBLIC_KEY || '';
  const HOTFIX_TTL_MS = 6 * 60 * 60 * 1000;
  const hotfixCachePath = () => path.join(app.getPath('userData'), 'hotfix-cache.json');
  let hotfixMemory = null;
  function hotfixUrlSafe(url) {
    try { return new URL(String(url || '')).protocol === 'https:'; } catch (_) { return false; }
  }
  function hotfixVerify(raw) {
    try {
      if (!HOTFIX_PUBLIC_KEY || !raw || typeof raw !== 'object' || typeof raw.signature !== 'string') return false;
      const Hotfix = require('./data/hotfix.js');
      const signature = Buffer.from(raw.signature, 'base64');
      return crypto.verify(null, Buffer.from(Hotfix.canonicalPayload(raw), 'utf8'), HOTFIX_PUBLIC_KEY, signature);
    } catch (_) { return false; }
  }
  function hotfixReadCache() {
    try {
      const cached = JSON.parse(fs.readFileSync(hotfixCachePath(), 'utf8'));
      if (cached && cached.savedAt && Date.now() - cached.savedAt < HOTFIX_TTL_MS) {
        const Hotfix = require('./data/hotfix.js');
        const checked = Hotfix.sanitize(cached.manifest, app.getVersion());
        return checked.ok ? checked.value : null;
      }
    } catch (_) {}
    return null;
  }
  async function fetchHotfix() {
    if (!app.isPackaged || !HOTFIX_PUBLIC_KEY || !hotfixUrlSafe(HOTFIX_URL)) return null;
    try {
      const response = await fetch(HOTFIX_URL, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('hotfix HTTP ' + response.status);
      const raw = await response.json();
      if (!hotfixVerify(raw)) throw new Error('hotfix signature rejected');
      const Hotfix = require('./data/hotfix.js');
      const checked = Hotfix.sanitize(raw, app.getVersion());
      if (!checked.ok) throw new Error(checked.error);
      try { writeFileAtomic(hotfixCachePath(), JSON.stringify({ savedAt: Date.now(), manifest: raw }), 0o600); } catch (_) {}
      hotfixMemory = checked.value;
      return hotfixMemory;
    } catch (error) {
      console.warn('hotfix unavailable:', error && error.message);
      return hotfixMemory || hotfixReadCache();
    }
  }
  function registerHotfixIpc() {
    ipcMain.handle('hotfix-get', async (event) => {
      if (!fromMainFrame(event, win)) return null;
      return fetchHotfix();
    });
  }

  function secretsStorePath() {
    return path.join(app.getPath('userData'), 'publish-secrets.bin');
  }

  function readAllSecrets() {
    try {
      const buf = fs.readFileSync(secretsStorePath());
      if (encryptionAvailable()) {
        return JSON.parse(safeStorage.decryptString(buf));
      }
      // Plaintext fallback — warn once so a missing keychain does not silently downgrade security
      warnIfPlaintextStore('publish-secrets.bin');
      return JSON.parse(buf.toString('utf8'));
    } catch (_) {
      return {};
    }
  }

  function writeAllSecrets(obj) {
    failClosedIfNoEncryption('publish-secrets.bin');
    const json = JSON.stringify(obj || {});
    const useEncryption = encryptionAvailable();
    if (!useEncryption) warnIfPlaintextStore('publish-secrets.bin');
    const payload = useEncryption
      ? safeStorage.encryptString(json)
      : Buffer.from(json, 'utf8');
    writeFileAtomic(secretsStorePath(), payload, 0o600);
    return true;
  }

  // Electron-only session store backed by safeStorage. The Supabase module
  // (modules/supabase.js) calls initSessionStore() with a renderer-side wrapper
  // (built in preload.js) that routes through the three sync channels below;
  // the module then persists the refresh token (and the rest of the session)
  // into the OS keychain instead of localStorage.
  // localStorage is kept as the fallback for the browser / web build.
  const SES_KEY = 'pallettai.supabase.session.v1';
  const sesStorePath = () => path.join(app.getPath('userData'), 'supabase-session.bin');

  function readSes() {
    try {
      const buf = fs.readFileSync(sesStorePath());
      if (encryptionAvailable()) {
        return safeStorage.decryptString(buf);
      }
      warnIfPlaintextStore('supabase-session.bin');
      return buf.toString('utf8');
    } catch (_) {
      return null;
    }
  }

  function writeSes(payload) {
    failClosedIfNoEncryption('supabase-session.bin');
    const useEncryption = encryptionAvailable();
    if (!useEncryption) warnIfPlaintextStore('supabase-session.bin');
    const buf = useEncryption
      ? safeStorage.encryptString(payload)
      : Buffer.from(payload, 'utf8');
    writeFileAtomic(sesStorePath(), buf, 0o600);
  }

  function deleteSes() {
    try { fs.unlinkSync(sesStorePath()); } catch (_) { /* already gone is fine */ }
  }

  function registerSecretIpc() {
    ipcMain.handle('secrets-get', (event, key) => {
      if (!fromMainFrame(event, win)) return '';
      const name = String(key || '');
      if (!SECRET_KEYS.has(name)) return '';
      const all = readAllSecrets();
      return typeof all[name] === 'string' ? all[name] : '';
    });
    ipcMain.handle('secrets-set', (event, key, value) => {
      if (!fromMainFrame(event, win)) return false;
      const name = String(key || '');
      if (!SECRET_KEYS.has(name)) return false;
      const all = readAllSecrets();
      const next = String(value == null ? '' : value);
      if (next) all[name] = next;
      else delete all[name];
      return writeAllSecrets(all);
    });
    // Synchronous variants so ONLINE getters and saveSettings can stay synchronous
    // while still reading/writing the encrypted store in Electron. Same allowlist
    // and senderFrame checks as the async channels above.
    ipcMain.on('secrets-get-sync', (event, key) => {
      if (!fromMainFrame(event, win)) { event.returnValue = ''; return; }
      const name = String(key || '');
      if (!SECRET_KEYS.has(name)) { event.returnValue = ''; return; }
      const all = readAllSecrets();
      event.returnValue = typeof all[name] === 'string' ? all[name] : '';
    });
    ipcMain.on('secrets-set-sync', (event, key, value) => {
      if (!fromMainFrame(event, win)) { event.returnValue = false; return; }
      const name = String(key || '');
      if (!SECRET_KEYS.has(name)) { event.returnValue = false; return; }
      try {
        const all = readAllSecrets();
        const next = String(value == null ? '' : value);
        if (next) all[name] = next;
        else delete all[name];
        event.returnValue = writeAllSecrets(all);
      } catch (_) { event.returnValue = false; }
    });
    // SafeStorage-backed session store for the Supabase module. These are sync
    // channels because modules/supabase.js reads/writes the session
    // synchronously (loadSes/persistSes). Every channel validates the SENDER
    // FRAME against the main window's main frame (see fromMainFrame), so neither
    // a compromised renderer nor a widget inside the preview iframe can touch the
    // file. The key name is also checked so a renderer can only reach the session
    // file, never arbitrary paths.
    ipcMain.on('session-get', (event, key) => {
      if (!fromMainFrame(event, win) || String(key || '') !== SES_KEY) {
        event.returnValue = null;
        return;
      }
      event.returnValue = readSes();
    });
    ipcMain.on('session-set', (event, key, value) => {
      if (!fromMainFrame(event, win) || String(key || '') !== SES_KEY) {
        event.returnValue = false;
        return;
      }
      try { writeSes(String(value == null ? '' : value)); event.returnValue = true; }
      catch (_) { event.returnValue = false; }
    });
    ipcMain.on('session-remove', (event, key) => {
      if (!fromMainFrame(event, win) || String(key || '') !== SES_KEY) {
        event.returnValue = false;
        return;
      }
      deleteSes();
      event.returnValue = true;
    });
  }

  // OS accent colour → renderer (Settings ▸ Appearance ▸ "Use system accent").
  // Returns a hex string without '#', or '' when unavailable. Pushed live when
  // the user changes their OS accent while the studio is open.
  function osAccentHex() {
    try {
      if (isMac) {
        // macOS returns a NSColor; toHex gives 'RRGGBB'.
        const sys = systemPreferences.getAccentColor ? systemPreferences.getAccentColor() : '';
        return /^[0-9A-Fa-f]{6}$/.test(sys || '') ? '#' + sys : '';
      }
      if (process.platform === 'win32' && systemPreferences.isAeroGlassEnabled && systemPreferences.isAeroGlassEnabled()) {
        const c = systemPreferences.getAccentColor ? systemPreferences.getAccentColor() : '';
        if (/^[0-9A-Fa-f]{6}$/.test(c || '')) return '#' + c;
      }
    } catch (_) { /* accent colour is a nicety, never a crash */ }
    return '';
  }
  // The renderer owns the theme setting; main owns the splash that runs before
  // it, so the two can only agree by the renderer telling main what it chose.
  // Validated like every other channel — same-sender check, plus the narrow set
  // of values the settings select can actually produce.
  function registerThemeIpc() {
    ipcMain.on('theme-changed', (event, theme) => {
      if (!fromMainFrame(event, win)) return;
      const next = String(theme || '');
      if (next !== 'dark' && next !== 'light' && next !== 'system') return;
      try {
        const s = loadState();
        if (s.theme === next) return;   // already stored: no write, no churn
        s.theme = next;
        writeFileAtomic(stateFile(), JSON.stringify(s), 0o600);
      } catch (_) { /* a splash in the wrong palette is not worth a crash */ }
    });
  }

  // The splash's one message. Sender-checked like every other channel here: the
  // only window that may end the update gate is the splash that is showing it,
  // so a compromised renderer in the main window cannot unlock or lock startup.
  function registerSplashIpc() {
    ipcMain.on('splash-skip', (event) => {
      if (!fromMainFrame(event, startupWindow)) return;
      skipStartupUpdate();
    });
  }

  function registerAccentIpc() {
    ipcMain.handle('get-accent', (event) => {
      if (!fromMainFrame(event, win)) return '';
      return osAccentHex();
    });
    try {
      systemPreferences.on('accent-color-changed', () => {
        if (win && !win.isDestroyed()) win.webContents.send('accent-changed', osAccentHex());
      });
    } catch (_) { /* not supported on every platform */ }
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
  // P0 hardening: validate IPC sender on the menu channel so a compromised
  // renderer can't forge menu actions through the preload bridge.
  function send(action) {
    if (!win || win.isDestroyed()) return;
    // The preload script only subscribes on the main window's webContents,
    // so only messages originated from main land here. A future renderer
    // IPC channel should validate event.sender against win.webContents.
    win.webContents.send('menu', action);
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

  // ---- the escape hatch -----------------------------------------------------
  // The gate runs before the workspace exists, so anything that stalls it holds
  // the user out of their own app: a check that never returns, a download on a
  // bad connection, or — as 0.4.5 shipped — an update that installs only once
  // the app exits while nothing ever quits it. The window is deliberately not
  // closable, so the way out is a button, and it is offered only after a wait
  // longer than a normal launch, so it never invites skipping an update that
  // was about to finish.
  const STARTUP_ESCAPE_AFTER_MS = 4000;
  let startupSkipped = false;
  let startupSkipSignal = null;

  function skipStartupUpdate() {
    // Ignored once the installer is armed: at that point the app is leaving,
    // and a late click cannot un-arm an install that is already handed over.
    if (!startupUpdateRunning || startupSkipped) return false;
    startupSkipped = true;
    setStartupStatus('Starting current version', 'The update will be offered again next time you open Studio.');
    if (startupSkipSignal) startupSkipSignal();
    return true;
  }

  // Race a step of the gate against the skip. The late-failure case matters:
  // work we have stopped waiting on can still reject, and an unhandled
  // rejection would crash the app the skip was meant to rescue.
  function raceStartupSkip(work) {
    work.catch(() => {});
    return Promise.race([work, new Promise((resolve) => { startupSkipSignal = resolve; })]);
  }

  // Which palette native chrome should wear — the splash screen and the window
  // background the user sees before the renderer paints. The studio's theme is a
  // RENDERER setting (localStorage), which main cannot read, and both of those
  // exist before (or instead of) a renderer, so there is nobody to ask. The
  // renderer therefore mirrors the choice into window-state.json (see
  // registerThemeIpc) and main reads it back on the NEXT launch. Until a user
  // ever changes it the value is absent, and 'system' — the default — is
  // resolved here.
  function shellUsesLight() {
    const saved = loadState().theme;
    if (saved === 'light') return true;
    if (saved === 'dark') return false;
    try { return !nativeTheme.shouldUseDarkColors; } catch (_) { return false; }
  }

  function createStartupWindow() {
    if (startupWindow && !startupWindow.isDestroyed()) return;
    startupWindowReady = false;
    const lightSplash = shellUsesLight();
    startupWindow = new BrowserWindow({
      width: 460,
      height: 300,
      show: true,
      resizable: false,
      movable: true,
      center: true,
      title: 'PallettAI Studio',
      backgroundColor: lightSplash ? '#f2f7fc' : '#04122b',
      frame: false,
      alwaysOnTop: true,
      closable: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Carries exactly one message: the skip button. Without it the escape
        // hatch is a button that does nothing.
        preload: path.join(__dirname, 'splash-preload.js')
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
    // The startup gate is the first thing a user sees, so it wears the same
    // navy and ice blue as the studio. The colours are COPIED from styles.css
    // (:root and body.light) rather than imported — this document is a data:
    // URL that loads before the renderer exists, so it cannot read the app's
    // stylesheet, and it has to paint instantly without waiting on a webfont,
    // hence the system font stack but the app's own palette. If the palette
    // moves in styles.css, move it here too; brand-splash-smoke pins the two
    // halves against each other so a drift fails the gate instead of shipping.
    const splash = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="${lightSplash ? 'light' : 'dark'}"><style>
      :root{color-scheme:dark;--bg:#04122b;--text:#eaf5ff;--muted:#9fb8d6;--line:rgba(159,212,255,.16);--blue:#7cc0f8;--blue2:#a9d8ff;--glow:rgba(124,192,248,.3);--wash:rgba(124,192,248,.13)}body.light{color-scheme:light;--bg:#f2f7fc;--text:#08172c;--muted:#5b7089;--line:rgba(10,40,80,.14);--blue:#2f7fd0;--blue2:#4f9be0;--glow:rgba(47,127,208,.2);--wash:rgba(47,127,208,.07)}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{position:relative;display:grid;place-items:center;background:var(--bg);color:var(--text);font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}.aura{position:fixed;inset:-45%;pointer-events:none;background:radial-gradient(38% 32% at 24% 6%,var(--glow),transparent 62%),radial-gradient(32% 26% at 80% 94%,var(--glow),transparent 58%);animation:aura 20s cubic-bezier(.22,.8,.24,1) infinite alternate}@keyframes aura{from{transform:translate3d(-2.5%,-1.5%,0) scale(1)}to{transform:translate3d(3%,2%,0) scale(1.08)}}.card{position:relative;text-align:center;width:100%;padding:30px 40px}.tile{width:56px;height:56px;margin:0 auto 15px;border:1px solid var(--line);border-radius:17px;display:grid;place-items:center;background:linear-gradient(160deg,var(--wash),transparent 70%);box-shadow:0 0 38px var(--glow),inset 0 1px 0 rgba(234,245,255,.09)}.tile svg{width:29px;height:29px;display:block}.tile stop{stop-color:#eaf5ff}.tile stop:nth-child(2){stop-color:#a9d8ff}.tile stop:nth-child(3){stop-color:#7cc0f8}body.light .tile{box-shadow:0 10px 30px rgba(20,50,90,.1),inset 0 1px 0 #fff}body.light .tile stop{stop-color:#1d5fa8}body.light .tile stop:nth-child(2){stop-color:#2f7fd0}body.light .tile stop:nth-child(3){stop-color:#4f9be0}#skip{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:none;border:1px solid var(--line);color:var(--muted);font:inherit;font-size:11.5px;font-weight:600;letter-spacing:.01em;padding:6px 14px;border-radius:999px;cursor:pointer}#skip[hidden]{display:none}#skip:hover{color:var(--text);border-color:var(--blue)}#skip:focus-visible{outline:2px solid var(--blue);outline-offset:2px}#skip[disabled]{opacity:.6;cursor:default}h1{display:flex;align-items:baseline;justify-content:center;font-size:19px;font-weight:800;letter-spacing:-.045em;margin:0}.bw-pallett{background:linear-gradient(150deg,#ffffff 20%,#c9e7ff 60%,#7cc0f8 100%);-webkit-background-clip:text;background-clip:text;color:transparent}.bw-ai{background:linear-gradient(92deg,#a9d8ff 0%,#dceeff 55%,#ffffff 100%);-webkit-background-clip:text;background-clip:text;color:transparent}body.light .bw-pallett{background:none;color:var(--text)}body.light .bw-ai{background:linear-gradient(92deg,#1d5fa8 0%,#2f7fd0 55%,#4f9be0 100%);-webkit-background-clip:text;background-clip:text;color:transparent}.brand-sub{font-size:.57rem;letter-spacing:.34em;text-transform:uppercase;font-weight:700;color:var(--muted);margin:5px 0 17px}#status{font-weight:600;font-size:13px}#detail{min-height:34px;margin:6px auto 16px;max-width:330px;color:var(--muted);font-size:12px;line-height:1.5}.track{height:3px;border-radius:99px;background:var(--line);overflow:hidden}.fill{height:100%;width:34%;border-radius:inherit;background:linear-gradient(90deg,var(--blue),var(--blue2));animation:pulse 1.5s ease-in-out infinite}.track.has-progress .fill{animation:none}@keyframes pulse{0%,100%{opacity:.45;transform:translateX(-55%)}50%{opacity:1;transform:translateX(190%)}}@media (prefers-reduced-motion:reduce){.aura{animation:none}.fill{animation:none}}
    </style></head><body class="${lightSplash ? 'light' : ''}"><div class="aura" aria-hidden="true"></div><main class="card" aria-live="polite"><div class="tile" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><defs><linearGradient id="splashMark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#eaf5ff"/><stop offset=".45" stop-color="#a9d8ff"/><stop offset="1" stop-color="#7cc0f8"/></linearGradient></defs><g stroke="url(#splashMark)" stroke-width="6" stroke-linecap="round"><path d="M14 39V10"/><path d="M14 10h6.2a7.3 7.3 0 0 1 0 14.6H14"/><path d="M27.5 39.8 38 9"/></g></svg></div><h1><span class="bw-pallett">Pallett</span><span class="bw-ai">Ai</span></h1><div class="brand-sub">Studio</div><div id="status">Preparing Studio…</div><div id="detail">Getting everything ready.</div><div class="track" id="track"><div class="fill" id="fill"></div></div></main><button id="skip" type="button" hidden>Skip the update and open Studio</button><script>var skip=document.getElementById('skip');setTimeout(function(){skip.hidden=false;},${STARTUP_ESCAPE_AFTER_MS});skip.addEventListener('click',function(){skip.disabled=true;skip.textContent='Opening Studio…';if(window.paiSplash&&window.paiSplash.skip)window.paiSplash.skip();});window.__setStatus=function(message,detail,progress){document.getElementById('status').textContent=message||'';document.getElementById('detail').textContent=detail||'';var track=document.getElementById('track');var fill=document.getElementById('fill');if(typeof progress==='number'){track.classList.add('has-progress');fill.style.width=Math.max(0,Math.min(100,progress))+'%';fill.style.transform='none';}else{track.classList.remove('has-progress');fill.style.width='34%';fill.style.transform='';}};</script></body></html>`;
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
    // destroy() (not close()): the splash is created with closable: false, and
    // close() "has the same effect as the user clicking the close button" —
    // which is disabled — so close() silently no-ops and strands the window.
    if (startupWindow && !startupWindow.isDestroyed()) startupWindow.destroy();
    startupWindow = null;
    startupWindowReady = false;
  }

  // ------------------------------------------------------- leaving for an update
  // Squirrel.Mac replaces the bundle only once THIS process is gone, and
  // electron-updater's macOS path never asks it to leave: MacUpdater's
  // quitAndInstall() hands the job to Electron's own autoUpdater and returns.
  // Nothing then quits Electron, so ShipIt waits for a process that is never
  // going to die.
  //
  // Measured on a real machine going 0.4.5 → 0.4.6: the app sat in its event
  // loop for eight minutes with ShipIt idle beside it and the splash reading
  // "Installing update…". The moment the process was killed by hand, ShipIt
  // logged "Beginning installation" and had finished six seconds later.
  //
  // So the exit is ours to perform, and the splash has to go first: it is the
  // one window created with closable: false, and a window that will not close
  // can cancel the quit it is part of. The beat before quitting gives ShipIt
  // time to have read the state file it was handed — it is invisible, since the
  // splash is already saying the restart is happening.
  const UPDATE_QUIT_BEAT_MS = 250;
  const UPDATE_EXIT_GRACE_MS = 5000;
  // How long Squirrel may take to read the archive before we stop waiting on it
  // and hand the user back to their work.
  const UPDATE_STAGE_TIMEOUT_MS = 3 * 60 * 1000;

  /*
    Waiting for the archive, not for a stopwatch.

    On macOS the bytes reach Squirrel through a proxy server that electron-updater
    creates INSIDE THIS PROCESS (MacUpdater.setFeedURL → an http server on
    127.0.0.1 that streams the already-downloaded zip). Squirrel then copies the
    whole thing into its own staging folder under ~/Library/Caches. So the process
    has to outlive that transfer.

    It did not. This used to quit on a fixed timer — 250 ms of grace, then a hard
    app.exit(0) five seconds later — and whenever the copy took longer than five
    seconds the pipe died mid-stream. The evidence is unambiguous on the machine
    this was found on: Squirrel's staging folder held a 53 MB fragment of the
    129 MB archive, ShipIt's log had no install line at all, and electron-updater's
    own update.zip in the cache was complete — 129 MB downloaded, 129 MB of it
    re-read locally, and the update thrown away silently at the halfway mark. The
    next launch then downloaded the same 129 MB again, which is what "the updater
    is not working" looks like from the outside.

    Electron's own autoUpdater is the one authority on when Squirrel has the file,
    and MacUpdater itself waits on exactly this event. Note that electron-updater's
    'update-downloaded' is NOT that moment — it fires just before the transfer
    starts, so it is the wrong signal to quit on. This flag is set from the native
    listener instead, and may already be true by the time we arm.
  */
  let squirrelHasArchive = false;

  function noteNativeStageSignal() {
    try {
      const native = require('electron').autoUpdater;
      native.on('update-downloaded', () => { squirrelHasArchive = true; });
    } catch (e) { /* no native updater (Linux/dev): nothing to wait for */ }
  }

  function squirrelStaged() {
    // Windows installs from the file electron-updater downloaded itself, so there
    // is no second transfer to wait for.
    if (process.platform !== 'darwin' || squirrelHasArchive) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => { if (settled) return; settled = true; resolve(ok); };
      let native = null;
      try { native = require('electron').autoUpdater; } catch (e) { return finish(true); }
      native.once('update-downloaded', () => finish(true));
      native.once('error', () => finish(false));
      setTimeout(() => finish(false), UPDATE_STAGE_TIMEOUT_MS);
    });
  }

  function quitForUpdate() {
    setTimeout(() => {
      // The last resort is scheduled BEFORE the polite request, so a quit that
      // throws still leaves the process a way out. If the quit works, this
      // timer never runs — the process is already gone.
      setTimeout(() => { try { app.exit(0); } catch (e) { /* already gone */ } }, UPDATE_EXIT_GRACE_MS);
      closeStartupWindow();
      try { app.quit(); } catch (e) { /* the exit above still runs */ }
    }, UPDATE_QUIT_BEAT_MS);
  }

  // Arm the installer, then leave — once Squirrel actually has the archive.
  //
  // Resolves true when the app is leaving (so the caller must not build the
  // workspace), false when the hand-off did not complete and the caller should
  // carry on as normal. Both callers go through here, because a quitAndInstall
  // without the exit behind it is the deadlock described above, and an exit that
  // arrives before the transfer is done is the truncated update described in
  // squirrelStaged().
  async function armUpdateAndQuit() {
    if (!updater) return false;
    try { updater.quitAndInstall(false, true); } catch (e) {
      // An installer that refuses to arm must not strand the user either: the
      // exit still happens, and the next launch is simply the same version.
      console.error('update install:', e && e.message);
    }
    if (!(await squirrelStaged())) {
      // Leaving now would cut the transfer in half and lose the update without
      // saying so. Keep the workspace open, then enable the library's fallback
      // only for this already-armed update so the user's next deliberate quit
      // can finish it. The normal path remains explicit and single-shot.
      try { updater.autoInstallOnAppQuit = true; } catch (_) {}
      console.error('update hand-off: Squirrel had not finished reading the archive; staying open');
      return false;
    }
    quitForUpdate();
    return true;
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
      // Start listening for the native "Squirrel has the archive" signal before
      // anything can arm an install, because the transfer may already have
      // finished by the time the installer is handed the job.
      noteNativeStageSignal();
      // Startup owns the download explicitly so the main window cannot appear
      // before the update is installed. Manual checks use this same path.
      updater.autoDownload = false;
      // The app owns installation explicitly through the guarded hand-off.
      // Keeping this false prevents electron-updater's implicit quit hook from racing
      // that path and triggering duplicate installer prompts on macOS.
      updater.autoInstallOnAppQuit = false;
      // Windows: refuse an installer whose Authenticode publisher can't be
      // verified. macOS has no equivalent switch because Squirrel.Mac always
      // compares the incoming bundle's code signature against the RUNNING app's,
      // which is also why an unsigned build can never auto-update itself — and
      // why the shipped certificate matters even though it is self-signed rather
      // than a Developer ID one.
      // Explicit rather than leaning on the library default.
      updater.verifyUpdateCodeSignature = true;
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
      updater.on('update-downloaded', (info) => {
        // The startup gate calls quitAndInstall itself. Avoid displaying a
        // restart prompt while the splash screen is still protecting launch.
        // A timed-out/failed manual operation may finish late; ignore that
        // stale event instead of interrupting the user's current work.
        if (startupUpdateRunning || !manualUpdateInFlight) return;
        // Name the version. The event carries it, and "a new version" gives the
        // user nothing to decide with.
        const next = info && info.version ? 'PallettAI Studio ' + info.version + ' is ready.' : 'A new version of PallettAI Studio is ready.';
        const r = dialog.showMessageBoxSync(win, {
          type: 'info',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          title: 'PallettAI Studio',
          message: next,
          detail: 'Restart now to install it, or it will install when you quit.'
        });
        if (r !== 0) return;
        armUpdateAndQuit().then((leaving) => {
          // Armed but the hand-off did not complete: the update is on disk and
          // installs when Studio next quits, so say that rather than restarting
          // into the same version and leaving the user to wonder.
          if (leaving) return;
          dialog.showMessageBoxSync(win, {
            type: 'info',
            title: 'PallettAI Studio',
            message: 'The update will install when you next quit Studio.',
            detail: 'Studio stayed open so the download could finish being handed to the installer.'
          });
        });
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
    startupSkipped = false;
    startupSkipSignal = null;
    setStartupStatus('Checking for updates…', 'Current version ' + app.getVersion() + ' · this usually takes a few seconds.');
    try {
      const result = await raceStartupSkip(withTimeout(
        updater.checkForUpdates(),
        STARTUP_CHECK_TIMEOUT_MS,
        'Startup update check timed out'
      ));
      if (startupSkipped) return false;
      if (!result || !result.isUpdateAvailable) {
        setStartupStatus('Studio is up to date', 'Starting your workspace…', 100);
        await wait(350);
        return false;
      }
      const info = result.updateInfo || result.versionInfo || {};
      const nextVersion = info.version || 'the latest version';
      setStartupStatus('Update found', 'Downloading ' + nextVersion + ' before Studio opens…', 0);
      await raceStartupSkip(withTimeout(
        updater.downloadUpdate(),
        STARTUP_DOWNLOAD_TIMEOUT_MS,
        'Update download timed out'
      ));
      // The download itself cannot be called off. If the user skips, the
      // incomplete hand-off is not installed; a later explicit update check can
      // retry it safely.
      if (startupSkipped) return false;
      // "Installing" is a lie while the archive is still being handed to Squirrel
      // — on a slow disk that copy is the longest part of the whole update, and a
      // splash that names the step it is on is the difference between waiting and
      // force-quitting the app.
      setStartupStatus('Preparing the installer…', 'Handing the update to the installer.', 100);
      startupUpdateRunning = false;
      // The gate owns this when the installer arms: it must leave the process
      // alive long enough to hand over, and the helper owns the exit.
      if (await armUpdateAndQuit()) return true;
      setStartupStatus('Starting current version', 'The update will finish installing when you next quit Studio.');
      await wait(600);
      return false;
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
          // Both of these point at real pages on the site. The support desk is where a
          // bug report lands, and the downloads page is where the other builds are —
          // the bare domain and a /contact route would have sent people to a 404.
          { label: 'Report a Bug', click: () => shell.openExternal('https://pallettai.org/support') },
          { label: 'Download for Another Platform', click: () => shell.openExternal('https://pallettai.org/downloads') }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  // ---------------------------------------------------------------- lifecycle
  app.whenReady().then(() => {
    app.setName('PallettAI Studio');

    // Defence in depth for every webContents the app ever creates — the main
    // window, the startup splash, and anything added later: no <webview>, no
    // popups, no OS permissions. The main window installs its own
    // window-open handler in createWindow() a moment later, which replaces the
    // deny-all below so external links still open in the system browser.
    app.on('web-contents-created', (_event, contents) => {
      contents.on('will-attach-webview', (e) => { e.preventDefault(); });
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const session = contents.session;
      if (session) {
        session.setPermissionRequestHandler((_request, callback) => callback(false));
        session.setPermissionCheckHandler(() => false);
      }
    });
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
    startCrashReporter();
    registerCrashIpc();
    registerSecretIpc();
    registerHotfixIpc();
    registerAccentIpc();
    registerThemeIpc();
    registerSplashIpc();
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

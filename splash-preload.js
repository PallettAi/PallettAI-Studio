// ============================================================
// Startup-splash preload — the escape hatch from the update gate.
//
// The splash is a data: URL window with contextIsolation on, no node
// integration and the sandbox on, so it has no way to talk to the main process
// on its own. It needs exactly one message: "let me in". Everything the splash
// can do is therefore this single call, and main verifies who sent it.
//
// Why the escape exists: the gate runs BEFORE the workspace is created, so a
// check or download that never finishes — or, as happened in 0.4.5, an update
// that installs only once the app exits while nothing ever quits it — leaves
// the user with a splash they cannot dismiss and no way into their own work.
// An update is never worth locking someone out of the app they already have.
//
// This file must be listed in electron-builder.yml `files`; a preload that is
// not packaged fails silently, and updater-smoke pins that.
// ============================================================
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paiSplash', {
  skip: () => ipcRenderer.send('splash-skip')
});

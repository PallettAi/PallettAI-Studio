'use strict';
// ============================================================
// PallettAI Studio — static compile IPC bridge (main process)
// ------------------------------------------------------------
// Registers the build trigger for the 'project:compile-static' channel
// (ipcMain.handle; handler signature (event, projectPayload)). The
// registration below is written in the brief's inline form — channel
// name as a literal, handler inline — so source-level IPC audits can
// see the handler body the way they see the shell's own channels.
//
// The handler compiles the project in memory (modules/static-compiler.js)
// and writes the export with native asynchronous fs.promises — the main
// process event loop and the renderer thread are never blocked by the
// write phase, and every file lands inside the directory the user chose.
//
// Everything the shell provides is injected ({ipcMain, fromMainFrame,
// dialog, defaultOutputDir}), for two reasons taken from main.js's own
// rules:
//
//   1. SENDER VALIDATION IS NOT OPTIONAL. Every privileged channel in
//      main.js re-checks event.sender against the window — the
//      fromMainFrame(event, win) convention. This module fails closed
//      the same way: the check is injected from the shell (bound to its
//      window) and named after the convention, so source-level IPC
//      audits treat this channel exactly like the shell's own; with no
//      check wired, no payload is ever compiled.
//   2. This file loads in plain Node. The smoke suite drives the handler
//      with a stub ipcMain and a temp directory — no Electron required.
//
// projectPayload = {
//   project:      the project JSON for compileProject()
//   files?:       …OR a pre-built file list for compileFileTree()
//                 ({path, data} or {name, content} — the renderer's
//                 Builder output). files wins when both are present.
//   outputDir?:   absolute path the export is written to
//   pickDirectory?: open a native directory picker when outputDir is absent
//   verify?:      re-read every written file and check its sha256
//   generatedAt?: ISO timestamp for the manifest (otherwise byte-stable)
// }
// A bare project object is also accepted (documented alias): when
// projectPayload.project is missing, the payload itself is the project
// and outputDir/pickDirectory are read from it.
//
// The handler never throws across IPC: every outcome is a structured
// { ok, value | error, code } so the renderer gets a usable answer even
// for a hard failure.
// ============================================================

const path = require('path');
const StaticCompiler = require('../modules/static-compiler.js');

const CHANNEL = 'project:compile-static';

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * normalizePayload(projectPayload) → { project, outputDir?, pickDirectory,
 *   verify?, generatedAt? } — throws bad_input on anything unusable.
 */
function normalizePayload(projectPayload) {
  const p = (projectPayload && typeof projectPayload === 'object' && !Array.isArray(projectPayload))
    ? projectPayload : null;
  if (!p) throw fail('bad_input', 'projectPayload must be an object');
  const wrapped = p.project && typeof p.project === 'object' && !Array.isArray(p.project);
  const project = wrapped ? p.project : p;
  return {
    project,
    files: Array.isArray(p.files) ? p.files : null,
    outputDir: p.outputDir,
    pickDirectory: p.pickDirectory === true,
    verify: p.verify === true,
    generatedAt: p.generatedAt
  };
}

/**
 * resolveOutputDir(payload, deps) → absolute directory (created later).
 * Priority: explicit outputDir → native picker (when asked) → the
 * app-level default. Anything unresolved is a coded error, never a
 * silent write to some accidental location.
 */
async function resolveOutputDir(payload, deps) {
  let raw = payload.outputDir;
  if (raw == null && payload.pickDirectory) {
    const dialog = deps.dialog;
    if (!dialog || typeof dialog.showOpenDialog !== 'function') {
      throw fail('bad_input', 'pickDirectory was requested but no dialog is available');
    }
    const result = await dialog.showOpenDialog({
      title: 'Choose the export folder',
      buttonLabel: 'Export here',
      properties: ['openDirectory', 'createDirectory']
    });
    if (result && result.canceled) throw fail('cancelled', 'export cancelled — no folder selected');
    raw = result && Array.isArray(result.filePaths) ? result.filePaths[0] : null;
    if (raw == null) throw fail('no_directory', 'no export folder was selected');
  }
  if (raw == null) raw = deps.defaultOutputDir;
  const target = String(raw == null ? '' : raw).trim();
  if (!target) {
    throw fail('bad_input', 'no output directory — pass projectPayload.outputDir '
      + 'or pickDirectory, or configure defaultOutputDir');
  }
  if (!path.isAbsolute(target)) {
    throw fail('bad_input', 'output directory must be an absolute path (got "' + target + '")');
  }
  return target;
}

/**
 * registerStaticCompileIpc(deps) → { channel }
 * Wire once from main.js after the window exists. The handler is
 * declared inline at the ipcMain.handle call with the literal channel
 * name — the shape the brief specifies, and the only shape a
 * source-level IPC audit can read: a handler stored in a variable is
 * invisible to it.
 */
function registerStaticCompileIpc(deps) {
  const d = (deps && typeof deps === 'object') ? deps : {};
  const ipcMain = d.ipcMain;
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('registerStaticCompileIpc requires an ipcMain with handle()');
  }
  // The shell's fromMainFrame sender check, bound to its window.
  const fromMainFrame = typeof d.fromMainFrame === 'function' ? d.fromMainFrame : null;

  ipcMain.handle('project:compile-static', async (event, projectPayload) => {
    try {
      // Fail closed: no sender check wired → nothing compiles. The
      // reply tells the caller nothing about how the check works, and
      // it runs inside the try so even a throwing sender check resolves
      // to an envelope instead of rejecting across IPC.
      if (!fromMainFrame || !fromMainFrame(event)) {
        return { ok: false, code: 'unauthorised', error: 'unauthorised' };
      }
      const payload = normalizePayload(projectPayload);
      const outDir = await resolveOutputDir(payload, d);
      const tree = Array.isArray(payload.files)
        ? StaticCompiler.compileFileTree(payload.files, { generatedAt: payload.generatedAt })
        : StaticCompiler.compileProject(payload.project, { generatedAt: payload.generatedAt });
      const written = await StaticCompiler.writeExportTree(tree, outDir, {
        verify: payload.verify
      });
      return {
        ok: true,
        value: {
          outDir: written.outDir,
          entry: tree.entry,
          files: written.count,
          bytes: tree.stats.bytes,
          warnings: tree.warnings,
          manifest: tree.manifest
        }
      };
    } catch (e) {
      // A build failure is an answer, not a crash: structured, coded,
      // and never a rejected invoke() the renderer has to special-case.
      return {
        ok: false,
        code: (e && e.code) || 'compile_failed',
        error: String((e && e.message) || e)
      };
    }
  });
  return { channel: CHANNEL };
}

module.exports = {
  CHANNEL,
  registerStaticCompileIpc,
  normalizePayload,
  resolveOutputDir
};

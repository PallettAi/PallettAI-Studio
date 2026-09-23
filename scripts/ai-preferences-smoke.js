#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const db = require(path.join(ROOT, 'data', 'db.js'));
let failed = 0;
function ok(condition, message) {
  if (condition) console.log('  ✓ ' + message);
  else { failed++; console.error('  ✗ ' + message); }
}
console.log('== AI preference defaults ==');
ok(db.defaultSettings.aiPhotoMode === 'real', 'real photos are the safe default');
ok(db.defaultSettings.aiLayoutMode === 'auto', 'auto layouts are the originality-friendly default');
ok(db.defaultSettings.aiOnePager === false, 'one-page mode is opt-in');
ok(db.defaultSettings.aiPhotoGrade === false, 'photo grading is opt-in');
ok(db.defaultSettings.aiConfirmDestructive === true, 'risky Copilot changes require confirmation by default');
ok(db.defaultSettings.aiOriginalityStrict === true, 'strict originality is enabled by default');
ok(db.defaultSettings.aiShowReceipts === true, 'generation receipts are visible by default');
console.log('\n== Settings surface ==');
['AI preferences','setAiPhotoMode','setAiLayoutMode','setAiOnePager','setAiPhotoGrade','setAiConfirm','setAiOriginality','setAiReceipts'].forEach((needle) => ok(app.includes(needle), needle + ' is present'));
console.log('\n== Generator wiring ==');
ok(/settings\.aiPhotoMode === 'real'/.test(app), 'AI photo selector reads the saved preference');
ok(/settings\.aiLayoutMode === 'auto'/.test(app), 'AI layout selector reads the saved preference');
ok(/settings\.aiPhotoGrade \? ' checked'/.test(app), 'photo grading checkbox reads the saved preference');
ok(/settings\.aiPhotoMode = \['real','ai','none'\]/.test(app), 'photo preference is validated before saving');
ok(/settings\.aiLayoutMode = e\.target\.value === 'classic'/.test(app), 'layout preference is normalized before saving');
if (failed) { console.error('\nai-preferences-smoke FAILED — ' + failed + ' failure(s)'); process.exit(1); }
console.log('\nai-preferences-smoke PASSED');

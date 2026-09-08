'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadAI() {
  const sandbox = {
    console, URL, setTimeout, clearTimeout, Math, Date, JSON, Set, Promise, process,
    Image: function Image() {},
    fetch: async () => { throw new Error('harness: no network expected'); }
  };
  sandbox.DB = require(path.join(ROOT, 'data', 'db.js'));
  sandbox.AiBrief = require(path.join(ROOT, 'data', 'ai-brief.js'));
  sandbox.AiNichesExtra = require(path.join(ROOT, 'data', 'ai-niches-extra.js'));
  sandbox.AiFollowup = require(path.join(ROOT, 'data', 'ai-followup.js'));
  sandbox.AiTranslate = require(path.join(ROOT, 'data', 'ai-translate.js'));
  sandbox.AiFingerprint = require(path.join(ROOT, 'data', 'ai-fingerprint.js'));
  sandbox.AiPhotos = require(path.join(ROOT, 'data', 'ai-photos.js'));
  sandbox.AiCompose = require(path.join(ROOT, 'data', 'ai-compose.js'));
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(ROOT, 'modules', 'ai.js'), 'utf8');
  vm.runInContext(code + '\n;globalThis.AI = AI;', sandbox);
  return sandbox.AI;
}

module.exports = { ROOT, loadAI };

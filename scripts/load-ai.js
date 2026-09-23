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
  sandbox.PallettAIDesignDNA = require(path.join(ROOT, 'modules', 'ai-prompts.js'));
  sandbox.AiNichesExtra = require(path.join(ROOT, 'data', 'ai-niches-extra.js'));
  sandbox.AiFollowup = require(path.join(ROOT, 'data', 'ai-followup.js'));
  sandbox.AiScope = require(path.join(ROOT, 'data', 'ai-scope.js'));
  sandbox.Revert = require(path.join(ROOT, 'data', 'revert.js'));
  sandbox.AiTranslate = require(path.join(ROOT, 'data', 'ai-translate.js'));
  sandbox.AiFingerprint = require(path.join(ROOT, 'data', 'ai-fingerprint.js'));
  sandbox.AiVoice = require(path.join(ROOT, 'data', 'ai-voice.js'));
  sandbox.AiRhythm = require(path.join(ROOT, 'data', 'ai-rhythm.js'));
  sandbox.AiShape = require(path.join(ROOT, 'data', 'ai-shape.js'));
  sandbox.AiSystem = require(path.join(ROOT, 'data', 'ai-system.js'));
  sandbox.AiTemplateCatalog = require(path.join(ROOT, 'data', 'ai-template-catalog.js'));
  sandbox.AiPhotos = require(path.join(ROOT, 'data', 'ai-photos.js'));
  sandbox.AiCompose = require(path.join(ROOT, 'data', 'ai-compose.js'));
  sandbox.AiFacts = require(path.join(ROOT, 'data', 'ai-facts.js'));
  sandbox.AiReference = require(path.join(ROOT, 'data', 'ai-reference.js'));
  sandbox.AiArtDirection = require(path.join(ROOT, 'data', 'ai-art-direction.js'));
  sandbox.AiDirector = require(path.join(ROOT, 'data', 'ai-director.js'));
  sandbox.AiOriginality = require(path.join(ROOT, 'data', 'ai-originality.js'));
  sandbox.AiKernel = require(path.join(ROOT, 'data', 'ai-kernel.js'));
  sandbox.AiCritique = require(path.join(ROOT, 'data', 'ai-critique.js'));
  sandbox.Copy = require(path.join(ROOT, 'data', 'copy.js'));
  sandbox.Copilot = require(path.join(ROOT, 'data', 'copilot.js'));
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(ROOT, 'modules', 'ai.js'), 'utf8');
  vm.runInContext(code + '\n;globalThis.AI = AI;', sandbox);
  return sandbox.AI;
}

module.exports = { ROOT, loadAI };

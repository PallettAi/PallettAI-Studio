'use strict';

/*
  ============================================================
  Migration — opening old project files, and saying what changed
  ------------------------------------------------------------
  A project does not only live in the local library. It also travels
  alone, as an exported `.pallettai.json`, and that is the copy that
  arrives from a customer who has not opened the Studio in a year.
  When the shape of a project changes, that file is the thing that has
  to keep opening.

  `data/schema.js` is this codebase's migration engine and it is
  already a good one: an integer version per stored key, a forward
  migration for every version a key has ever had, migrations that run
  once at boot, and three documented rules that exist because the
  naive version of this loses data —
    * a migration that throws changes nothing, so it is retried;
    * the version is advanced only after the value has committed, so
      a crash cannot mark a half-converted project as converted;
    * on-disk values stay plain JSON, so an older build still opens a
      newer library.

  So this module does NOT reimplement that. It handles the one case
  the store does not: a project file arriving on its own, with no
  sidecar to say what version it is. That is why `schemaVersion` is
  stamped *inside* the project — the comment in schema.js is explicit
  that "a version inside the project is the only version that survives
  that trip". This module reads that stamp, walks the same forward
  steps, and reports what it upgraded.

  One rule the implementation keeps, and it is the important one:

  Only fields that cannot change how a project renders are injected.
  A migration that runs on every older file is the last place to make
  a visual decision. So design tokens default to the exact literals
  `modules/builder.js` already falls back to (byte-neutral), and
  advisory fields the builder does not branch on (`layout_variant`)
  are filled, while visual fields that would add a pattern or a
  treatment (`background_style`) are deliberately left absent.

  Note the version numbers: 2 is the current project schema, an
  integer, matching `schemaVersion: 2` already written by
  `projectsToV2`. The `0.1.0 … 0.5.0` range is this *application's*
  release number (`data/release-notes.js`), tracked and enforced by
  `scripts/release-guard.js`. Stamping a project `0.5.0` would collide
  with that guard and describe a schema generation that does not
  exist.
  ============================================================
*/

const path = require('path');

// The store's engine. Loaded defensively: this module still works
// standalone (a Node script migrating one file) without it.
let StoreSchema = null;
try { StoreSchema = require(path.join(__dirname, '..', 'data', 'schema.js')); } catch (e) { StoreSchema = null; }

const CURRENT_VERSION = 2;

/*
  The builder's own fallbacks, copied deliberately and exactly. If
  these ever drift, a migrated project would render differently from
  an unmigrated one — the one outcome a migration must never have.
  See modules/builder.js: `token('btnRadius', '--btn-radius', '999px')`
  and its three neighbours.
*/
function defaultDesignTokens() {
  return {
    '--brand-color': 'oklch(0.65 0.24 260)',
    '--bg-surface': '#0b0e14',
    '--bg-pattern-type': 'none',
    '--btn-radius': '999px',
    '--btn-shadow': '0 10px 30px rgba(0,0,0,.25)',
    '--btn-border': '2px solid transparent',
    '--btn-transform-hover': 'translateY(-2px)'
  };
}

/*
  The archetype vocabulary, read from the AI layer that defines it
  rather than guessed here. The fallback list is the set of looks
  `modules/ai.js` already ranks ("editorial", "minimal", "noir" …).
*/
function archetypeVocabulary() {
  try {
    const prompts = require(path.join(__dirname, 'ai-prompts.js'));
    const a = prompts && (prompts.archetypes || (prompts.ARCHETYPES));
    if (a && typeof a === 'object') {
      const keys = Object.keys(a);
      if (keys.length) return keys;
    }
  } catch (e) { /* fall through */ }
  return ['editorial', 'minimal', 'dark', 'noir', 'light', 'warm', 'bright', 'playful', 'techy'];
}

const DEFAULT_ARCHETYPE = 'editorial';

// ---------------------------------------------------------------
// Forward steps. Each returns the project object, never mutates.
// ---------------------------------------------------------------

/*
  Projects 1 → 2.

  The same change the store makes, applied to one travelling file:
  coerce the two collections that older builds allowed to be missing
  or malformed, and stamp the version so the next reader knows. The
  stamp is the point — without it a file is re-repaired on every open
  and stays malformed for anyone else who imports it.
*/
function projectToV2(project) {
  const out = Object.assign({}, project, { schemaVersion: 2 });
  if (!Array.isArray(out.suites)) out.suites = [];
  if (out.site && typeof out.site === 'object' && !Array.isArray(out.site.sections)) out.site.sections = [];
  if (Array.isArray(out.pages)) {
    out.pages = out.pages.map((p) => {
      if (!p || typeof p !== 'object') return p;
      return Array.isArray(p.sections) ? p : Object.assign({}, p, { sections: [] });
    });
  }
  return out;
}

const STEPS = {
  1: { to: 2, label: 'projects 1 → 2', apply: projectToV2 }
};

/*
  Defaults, applied for any version. Idempotent by construction: a
  field that is present is never touched, so running this twice
  produces identical bytes and the report can say honestly that
  nothing happened.
*/
function injectDefaults(project, report) {
  const out = Object.assign({}, project);

  const tokens = out.design_tokens && typeof out.design_tokens === 'object' && !Array.isArray(out.design_tokens)
    ? Object.assign({}, out.design_tokens)
    : {};
  const defaults = defaultDesignTokens();
  let added = 0;
  Object.keys(defaults).forEach((key) => {
    if (tokens[key] === undefined || tokens[key] === null || tokens[key] === '') {
      tokens[key] = defaults[key];
      added++;
    }
  });
  if (added) report.push('design_tokens: injected ' + added + ' missing token' + (added === 1 ? '' : 's'));
  out.design_tokens = tokens;

  if (!out.chosen_archetype || typeof out.chosen_archetype !== 'string') {
    out.chosen_archetype = DEFAULT_ARCHETYPE;
    report.push('chosen_archetype: injected "' + DEFAULT_ARCHETYPE + '"');
  }

  // `layout_variant` is part of the project contract the AI is asked to
  // produce (modules/ai-prompts.js), and the builder does not branch on
  // it, so filling it cannot change a render — it only stops a section
  // from being silently out of contract. `background_style` is the
  // opposite case and is deliberately not injected: it *is* read, and a
  // default there could paint a texture onto a site that never had one.
  let variants = 0;
  const fillSections = (sections) => {
    if (!Array.isArray(sections)) return sections;
    return sections.map((s) => {
      if (!s || typeof s !== 'object') return s;
      if (s.layout_variant === undefined || s.layout_variant === null || s.layout_variant === '') {
        variants++;
        return Object.assign({}, s, { layout_variant: 'default' });
      }
      return s;
    });
  };
  if (out.site && Array.isArray(out.site.sections)) out.site.sections = fillSections(out.site.sections);
  if (Array.isArray(out.sections)) out.sections = fillSections(out.sections);
  if (Array.isArray(out.pages)) {
    out.pages = out.pages.map((p) => (p && Array.isArray(p.sections) ? Object.assign({}, p, { sections: fillSections(p.sections) }) : p));
  }
  if (variants) report.push('layout_variant: filled ' + variants + ' section' + (variants === 1 ? '' : 's'));

  return out;
}

// ---------------------------------------------------------------
// Public API
// ---------------------------------------------------------------

function parseInput(rawJson) {
  if (rawJson && typeof rawJson === 'object' && !Array.isArray(rawJson)) return { ok: true, value: Object.assign({}, rawJson) };
  const text = String(rawJson == null ? '' : rawJson).trim();
  if (!text) return { ok: false, error: 'the project is empty' };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'the project must be a JSON object' };
    }
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: 'the project is not valid JSON: ' + (e && e.message ? e.message : e) };
  }
}

/*
  Read a project from any older build, return it in the current shape,
  and say exactly what was changed. Never throws and never partially
  converts: on a parse failure the caller gets its input back plus the
  reason, so nothing is written over.
*/
function migrateProjectSchema(rawJson) {
  const result = {
    ok: false,
    raw: typeof rawJson === 'string' ? rawJson : '',
    from: null,
    to: null,
    applied: [],
    report: [],
    warnings: [],
    errors: []
  };

  const parsed = parseInput(rawJson);
  if (!parsed.ok) {
    result.errors.push(parsed.error);
    return result;
  }

  let project = parsed.value;
  const declared = Number(project.schemaVersion);
  // No stamp means the oldest shape, the same conservative direction
  // data/schema.js documents for unrecorded values.
  const from = Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : 1;
  result.from = from;

  if (from > CURRENT_VERSION) {
    // Written by a newer build. Rewriting it would downgrade a file we
    // do not understand; the store's third rule exists so that opening
    // it is safe, so it is passed through with a warning.
    result.ok = true;
    result.to = from;
    result.raw = JSON.stringify(project);
    result.warnings.push('This project was written by a newer version of PallettAI Studio (' + from + '). It has been left exactly as it is.');
    result.report.push('no migration applied: already newer than ' + CURRENT_VERSION);
    return result;
  }

  let version = from;
  let guard = 0;
  while (version < CURRENT_VERSION) {
    const step = STEPS[version];
    if (!step) {
      result.errors.push('no migration from version ' + version);
      return result;
    }
    project = step.apply(project);
    result.applied.push(step.label);
    result.report.push('upgraded ' + step.label);
    version = step.to;
    if (++guard > 100) { result.errors.push('migration did not converge'); return result; }
  }

  const before = JSON.stringify(project);
  project = injectDefaults(project, result.report);
  if (JSON.stringify(project) === before && result.applied.length === 0) {
    result.report.push('nothing to change: this project is already current');
  }

  result.ok = true;
  result.to = version;
  result.raw = JSON.stringify(project);
  return result;
}

/*
  A strict reading of the *current* shape. Stricter than the loader on
  purpose: the loader has to accept whatever is on disk and repair it,
  while this runs before a write or an export and is allowed to say no.
*/
function validateProjectSchema(rawJson) {
  const errors = [];
  const warnings = [];
  const parsed = parseInput(rawJson);
  if (!parsed.ok) return { ok: false, errors: [parsed.error], warnings: [] };

  const p = parsed.value;
  if (typeof p.schemaVersion !== 'number' || !Number.isFinite(p.schemaVersion)) {
    errors.push('schemaVersion must be a number');
  }
  if (typeof p.name !== 'string' || p.name.trim() === '') {
    errors.push('name must be a non-empty string');
  }

  const sections = (p.site && Array.isArray(p.site.sections)) ? p.site.sections
    : (Array.isArray(p.sections) ? p.sections
      : (Array.isArray(p.pages) ? [].concat.apply([], p.pages.map((x) => (x && Array.isArray(x.sections) ? x.sections : []))) : null));
  if (sections === null) errors.push('the project has no sections collection (site.sections, sections or pages[].sections)');
  else {
    sections.forEach((s, i) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push('section ' + i + ' must be an object'); return; }
      if (typeof s.type !== 'string' || !s.type) errors.push('section ' + i + ' has no type');
    });
  }

  if (p.design_tokens !== undefined) {
    if (!p.design_tokens || typeof p.design_tokens !== 'object' || Array.isArray(p.design_tokens)) {
      errors.push('design_tokens must be an object');
    } else {
      Object.keys(p.design_tokens).forEach((k) => {
        if (typeof p.design_tokens[k] !== 'string') errors.push('design_tokens.' + k + ' must be a string');
      });
    }
  }

  if (p.chosen_archetype !== undefined && (typeof p.chosen_archetype !== 'string' || !p.chosen_archetype)) {
    errors.push('chosen_archetype must be a non-empty string');
  }
  if (p.chosen_archetype && archetypeVocabulary().indexOf(p.chosen_archetype) === -1) {
    warnings.push('chosen_archetype "' + p.chosen_archetype + '" is not one of the known archetypes');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/*
  The library path. A stored key has a sidecar record saying what
  version it is, so there is nothing to guess — hand the whole job to
  the engine that owns it and return its verdict unchanged.
*/
function migrateStoreKey(key, raw, from) {
  if (!StoreSchema || typeof StoreSchema.migrate !== 'function') {
    return { ok: false, raw, applied: [], error: 'the store schema engine is unavailable' };
  }
  return StoreSchema.migrate(key, raw, from);
}

/*
  What a run would do, without doing it — used by the UI to warn before
  a library is upgraded in place.
*/
function planForKey(key, from) {
  if (!StoreSchema || typeof StoreSchema.plan !== 'function') return null;
  return StoreSchema.plan(key, from);
}

function currentVersion() {
  return CURRENT_VERSION;
}

module.exports = {
  CURRENT_VERSION,
  currentVersion,
  migrateProjectSchema,
  validateProjectSchema,
  migrateStoreKey,
  planForKey,
  defaultDesignTokens,
  archetypeVocabulary,
  steps: Object.keys(STEPS).map(Number)
};

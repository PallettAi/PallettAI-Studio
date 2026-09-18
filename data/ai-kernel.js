'use strict';
// ============================================================
// PallettAI Studio — Brand kernel
// ------------------------------------------------------------
// A brand preset is an input you *may* apply. A kernel is a constraint the
// generator and the Copilot *must* obey. Same ingredients, one difference:
// per-field lock flags.
//
// The split that matters is which fields can be enforced in code. Palette,
// typography, radius, spacing and the hero treatment are the renderer's own
// settings, so enforcing them is deterministic — no model can talk its way out
// of them. Tone of voice and imagery rules only reach a model as prompt
// constraints, so they are advertised as constraints and verified separately
// (see `describe` / `promptContract`).
// ============================================================

// Named KERNEL_TONES because every data/ module shares one global scope in the
// browser: a bare `TONES` here would collide with data/ai-brief.js and silently
// stop one of the two files from running at all.
const KERNEL_TONES = { warm: true, premium: true, punchy: true };

// Field order is the order a human would set them in, and drives every
// report so two runs never disagree about what "first" means.
const FIELD_ORDER = ['palette', 'type', 'radius', 'spacing', 'layout', 'voice', 'imagery', 'constitution'];

const FIELD_LABELS = {
  palette: 'Palette',
  type: 'Typography',
  radius: 'Corner radius',
  spacing: 'Section spacing',
  layout: 'Hero layout',
  voice: 'Tone of voice',
  imagery: 'Imagery rules',
  constitution: 'Design constitution'
};

// Fields the renderer owns: a lock on these binds generated and edited sites.
const ENFORCED = { palette: true, type: true, radius: true, spacing: true, layout: true };

// Fields that can only ever be a prompt constraint.
const PROMPT_ONLY = { voice: true, imagery: true, constitution: true };

// Prefixed for the same reason: `clip` already exists in data/ai-brief.js, and a
// duplicate top-level function means the last file loaded wins for BOTH.
function kernelClip(s, n) {
  return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, n || 200);
}

function num(v, def, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/*
  Normalize reads a kernel off disk, off a project or out of the UI, and it must
  survive all three. An unknown palette id is kept as-is (the palette library may
  live on another machine); an out-of-range radius is clamped rather than
  rejected, because a kernel that throws on load locks nobody out of anything.
*/
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const locksIn = raw.locks && typeof raw.locks === 'object' && !Array.isArray(raw.locks) ? raw.locks : {};
  const locks = {};
  FIELD_ORDER.forEach((f) => { locks[f] = locksIn[f] === true; });
  const imageryRaw = Array.isArray(raw.imagery)
    ? raw.imagery
    : (kernelClip(raw.imagery) ? [kernelClip(raw.imagery, 120)] : []);
  const tone = kernelClip(raw.voice, 20).toLowerCase();
  return {
    v: 1,
    // presetId is the optional link back to a saved brand system, so the AI
    // Studio can show which lock is active rather than a bare name.
    presetId: kernelClip(raw.presetId, 80),
    name: kernelClip(raw.name, 60) || 'Brand kernel',
    palette: kernelClip(raw.palette, 80),
    font: kernelClip(raw.font, 100),
    fontDisplay: kernelClip(raw.fontDisplay, 100),
    radius: num(raw.radius, 20, 0, 48),
    spacing: num(raw.spacing, 96, 32, 220),
    heroLayout: kernelClip(raw.heroLayout, 40),
    voice: KERNEL_TONES[tone] ? tone : '',
    // De-blank first, then cap: a rule list that silently loses a real rule
    // because a blank entry held its slot would be worse than a short list.
    imagery: imageryRaw.map((x) => kernelClip(x, 120)).filter(Boolean).slice(0, 6),
    // A small constitution travels with the project so later Copilot edits can
    // preserve the approved visual language instead of slowly converging on a
    // generic default. These are guidance tokens, not executable CSS.
    constitution: {
      mood: kernelClip(raw.mood != null ? raw.mood : raw.constitution && raw.constitution.mood, 80),
      button: kernelClip(raw.button != null ? raw.button : raw.constitution && raw.constitution.button, 80),
      shadows: kernelClip(raw.shadows != null ? raw.shadows : raw.constitution && raw.constitution.shadows, 80),
      forbidden: Array.isArray(raw.forbidden) ? raw.forbidden.map((x) => kernelClip(x, 100)).filter(Boolean).slice(0, 8) : (raw.constitution && Array.isArray(raw.constitution.forbidden) ? raw.constitution.forbidden.map((x) => kernelClip(x, 100)).filter(Boolean).slice(0, 8) : []),
      preferred: Array.isArray(raw.preferred) ? raw.preferred.map((x) => kernelClip(x, 100)).filter(Boolean).slice(0, 8) : (raw.constitution && Array.isArray(raw.constitution.preferred) ? raw.constitution.preferred.map((x) => kernelClip(x, 100)).filter(Boolean).slice(0, 8) : [])
    },
    locks
  };
}

/*
  Derive a kernel from a site that already looks right. This is the "approve
  what the AI just made, then keep it" path — the values come from the live
  project, the locks come from the caller.
*/
function derive(project, opts) {
  const s = (project && project.site) || {};
  const d = s.design || {};
  const hero = (Array.isArray(s.sections) ? s.sections : []).find((x) => x && x.type === 'hero');
  const o = opts || {};
  return normalize({
    name: o.name || (s.name ? s.name + ' brand' : 'Brand kernel'),
    palette: s.palette,
    font: s.font,
    fontDisplay: s.fontDisplay,
    radius: d.radius,
    spacing: d.spacing,
    heroLayout: o.heroLayout != null ? o.heroLayout : ((hero && hero.layout) || s.heroLayout),
    voice: (s.voice && s.voice.tone) || '',
    imagery: o.imagery || [],
    mood: o.mood,
    button: o.button,
    shadows: o.shadows,
    forbidden: o.forbidden,
    preferred: o.preferred,
    locks: o.locks
  });
}

/*
  Reuse the brand presets a Pro user already saved: a preset plus locks is a
  kernel, so nothing new has to be stored for a creator who already has one.
  Renderer fields lock by default because that is the point of applying a saved
  visual system to a new site.
*/
function fromPreset(preset, opts) {
  const p = preset || {};
  const d = p.design || {};
  const o = opts || {};
  return normalize({
    presetId: p.id,
    name: p.name || 'Brand kernel',
    palette: p.palette,
    font: p.font,
    fontDisplay: p.fontDisplay,
    radius: d.radius,
    spacing: d.spacing,
    heroLayout: p.heroLayout,
    voice: o.voice || '',
    imagery: o.imagery || [],
    mood: o.mood || (p.constitution && p.constitution.mood),
    button: o.button || (p.constitution && p.constitution.button),
    shadows: o.shadows || (p.constitution && p.constitution.shadows),
    forbidden: o.forbidden || (p.constitution && p.constitution.forbidden),
    preferred: o.preferred || p.preferred || (p.constitution && p.constitution.preferred),
    locks: o.locks || {
      palette: true, type: true, radius: true, spacing: true, layout: true,
      constitution: !!p.constitution
    }
  });
}

function lock(kernel, field, on) {
  const k = normalize(kernel);
  if (!k || FIELD_ORDER.indexOf(field) === -1) return k;
  k.locks[field] = on !== false;
  return k;
}

/*
  Every section list a locked hero treatment must reach: the active page's
  sections (which `site.sections` aliases) plus every additional page. A
  multi-page site is one site to the client, so a locked hero is locked on all
  of it — the lock is per-design, not per-document.
*/
function heroLists(site) {
  const lists = [Array.isArray(site.sections) ? site.sections : []];
  if (Array.isArray(site.pages)) {
    site.pages.forEach((page) => {
      if (page && Array.isArray(page.sections)) lists.push(page.sections);
    });
  }
  return lists;
}

function isLocked(kernel, field) {
  const k = normalize(kernel);
  return !!(k && k.locks[field] === true);
}

function lockedFields(kernel) {
  const k = normalize(kernel);
  if (!k) return [];
  return FIELD_ORDER.filter((f) => k.locks[f]);
}

/*
  Enforcement. Only locked fields are touched, and nothing here reads or writes
  a single word of the client's copy — a locked brand changes how a site looks,
  never what it claims.
*/
function apply(project, kernel) {
  const k = normalize(kernel);
  const s = project && project.site;
  if (!k || !s) return { applied: [], changed: 0 };
  const applied = [];
  s.design = s.design || {};

  if (k.locks.palette && k.palette && s.palette !== k.palette) {
    s.palette = k.palette;
    applied.push('palette');
  }
  if (k.locks.type) {
    let hit = false;
    if (k.font && s.font !== k.font) { s.font = k.font; hit = true; }
    if (String(s.fontDisplay || '') !== String(k.fontDisplay || '')) { s.fontDisplay = k.fontDisplay; hit = true; }
    if (hit) applied.push('type');
  }
  if (k.locks.radius && Number(s.design.radius) !== k.radius) {
    s.design.radius = k.radius;
    applied.push('radius');
  }
  if (k.locks.spacing && Number(s.design.spacing) !== k.spacing) {
    s.design.spacing = k.spacing;
    applied.push('spacing');
  }
  if (k.locks.layout) {
    let hit = false;
    heroLists(s).forEach((list) => {
      list.forEach((sec) => {
        if (sec && sec.type === 'hero' && String(sec.layout || '') !== String(k.heroLayout || '')) {
          sec.layout = k.heroLayout;
          hit = true;
        }
      });
    });
    if (hit) applied.push('layout');
  }
  if (k.locks.voice && k.voice && (!s.voice || s.voice.tone !== k.voice)) {
    // Banned-word lists are the creator's, so they survive the enforcement.
    s.voice = { tone: k.voice, banned: (s.voice && s.voice.banned) || [] };
    applied.push('voice');
  }
  if (k.locks.imagery && k.imagery.length) {
    // Imagery cannot be enforced by a renderer, so it is recorded for the
    // model-facing passes (and for the export receipt) instead of faked.
    s.imageryRules = k.imagery.slice();
    applied.push('imagery');
  }
  if (k.locks.constitution) {
    s.constitution = JSON.parse(JSON.stringify(k.constitution));
    applied.push('constitution');
  }
  return { applied, changed: applied.length };
}

/*
  Drift report: what a site currently does that its locked kernel forbids. Used
  by the Copilot (to refuse a request it must not honour) and by the self-critique
  pass (so an auto-repair can never quietly unlock a brand).
*/
function violations(project, kernel) {
  const k = normalize(kernel);
  const s = (project && project.site) || {};
  const d = s.design || {};
  const hero = (Array.isArray(s.sections) ? s.sections : []).find((x) => x && x.type === 'hero');
  const strayHero = k && k.locks.layout
    ? heroLists(s).some((list) => list.some((sec) => sec && sec.type === 'hero' && String(sec.layout || '') !== String(k.heroLayout || '')))
    : false;
  const out = [];
  const push = (field, expected, actual) => out.push({
    field,
    label: FIELD_LABELS[field],
    expected: String(expected == null ? '' : expected),
    actual: String(actual == null ? '' : actual)
  });
  if (!k) return out;

  if (k.locks.palette && k.palette && s.palette !== k.palette) push('palette', k.palette, s.palette);
  if (k.locks.type && (k.font || k.fontDisplay)) {
    const want = [k.font, k.fontDisplay].filter(Boolean).join(' / ');
    const got = [s.font, s.fontDisplay].filter(Boolean).join(' / ');
    if (String(s.font || '') !== k.font || String(s.fontDisplay || '') !== String(k.fontDisplay || '')) push('type', want, got);
  }
  if (k.locks.radius && Number(d.radius) !== k.radius) push('radius', k.radius + 'px', (d.radius == null ? '' : d.radius) + 'px');
  if (k.locks.spacing && Number(d.spacing) !== k.spacing) push('spacing', k.spacing + 'px', (d.spacing == null ? '' : d.spacing) + 'px');
  if (k.locks.layout && strayHero) push('layout', k.heroLayout, hero ? hero.layout : '');
  if (k.locks.voice && k.voice && ((s.voice && s.voice.tone) || '') !== k.voice) push('voice', k.voice, s.voice && s.voice.tone);
  if (k.locks.constitution && JSON.stringify(s.constitution || {}) !== JSON.stringify(k.constitution)) push('constitution', JSON.stringify(k.constitution), JSON.stringify(s.constitution || {}));
  return out;
}

/*
  The model-facing half. These lines are the contract handed to any AI pass, and
  they are deliberately written as prohibitions: a model respects "keep X, do not
  change it" far more reliably than it respects a description of X.
*/
function promptContract(kernel) {
  const k = normalize(kernel);
  if (!k) return [];
  const lines = [];
  if (k.locks.palette) lines.push('Use the locked brand palette' + (k.palette ? ' (' + k.palette + ')' : '') + ' — do not recolor the site.');
  if (k.locks.type) lines.push('Keep the locked brand typography' + (k.font ? ' (' + [k.font, k.fontDisplay].filter(Boolean).join(' headings / ') + ')' : '') + ' — do not swap fonts.');
  if (k.locks.radius) lines.push('Corner radius stays at ' + k.radius + 'px.');
  if (k.locks.spacing) lines.push('Section rhythm stays at ' + k.spacing + 'px.');
  if (k.locks.layout && k.heroLayout) lines.push('The hero keeps its “' + k.heroLayout + '” treatment.');
  if (k.locks.voice && k.voice) lines.push('Write in the locked ' + k.voice + ' tone of voice.');
  if (k.locks.imagery && k.imagery.length) lines.push('Imagery rules: ' + k.imagery.join('; ') + '.');
  if (k.locks.constitution) {
    const c = k.constitution;
    if (c.mood) lines.push('Visual mood: ' + c.mood + '.');
    if (c.button) lines.push('Button personality: ' + c.button + '.');
    if (c.shadows) lines.push('Shadow rule: ' + c.shadows + '.');
    if (c.preferred.length) lines.push('Prefer: ' + c.preferred.join('; ') + '.');
    if (c.forbidden.length) lines.push('Avoid: ' + c.forbidden.join('; ') + '.');
  }
  return lines;
}

function describe(kernel) {
  const k = normalize(kernel);
  const fields = lockedFields(k);
  if (!k) return 'No brand lock';
  if (!fields.length) return k.name + ' — nothing locked yet';
  const names = fields.map((f) => FIELD_LABELS[f]);
  const list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  const promptOnly = fields.filter((f) => PROMPT_ONLY[f]);
  return k.name + ' — ' + list + ' locked'
    + (promptOnly.length ? ' (' + promptOnly.map((f) => FIELD_LABELS[f]).join(', ') + ' as a prompt constraint)' : '');
}

const AiKernel = {
  FIELD_ORDER, FIELD_LABELS, ENFORCED, PROMPT_ONLY,
  normalize, derive, fromPreset, lock, isLocked, lockedFields,
  apply, violations, promptContract, describe
};
if (typeof module !== 'undefined' && module.exports) module.exports = AiKernel;

'use strict';

/* ============================================================
   Revert — undo one named change, without undoing the ones
   that came after it.

   ⌘Z is a time machine: it walks the history backwards, one
   step at a time, and it is the only thing the app offered. But
   the sentence a client actually types is "put the colours
   back", and answering it with "I undid your last change"
   either undoes the wrong thing or needs them to remember what
   order they did things in. Both are the copilot asking the
   client to do the bookkeeping.

   The distinction that makes this tractable: a change is not one
   thing. "Switch to ocean and make the hero punchier" moved two
   independent paths, and reverting one of them needs no merge
   and no risk — the other path is simply never read. So this
   module works in paths, not steps:

     · find the most recent step where a path the client named
       changed
     · restore THAT PATH from the value it held before that step
     · leave every other path exactly as the client has it now

   Later changes to other paths are therefore untouched — which is
   the whole point — and a later change to the SAME path is picked
   up for free, because "most recent" already means the latest one.

   Three limits are deliberate, and each one is a refusal rather
   than a guess:

     · Structure is not reverted. A section added, removed or
       reordered moves every index after it, so "put the FAQ back"
       is not a field restore — it is a rewind, and ⌘Z is the
       honest answer.
     · Only paths this module knows how to read and write are
       touched, and `applyRestores` re-checks that whitelist on
       the way in. A plan is data, and data that arrives at a
       mutator should not be trusted just because this module
       built it.
     · Nothing here decides WHETHER a revert is wanted. It answers
       which paths to restore, and says plainly when the history
       holds no change of the kind the client named.

   Pure logic on plain project objects: no DOM, no store, no clock.
   ============================================================ */

/* ---------- the fields this module can read and write ---------- */

const SITE_FIELDS = [
  { path: ['site', 'palette'], what: 'colour', said: 'the colours' },
  { path: ['site', 'font'], what: 'font', said: 'the font' },
  { path: ['site', 'heroLayout'], what: 'layout', said: 'the hero layout' },
  { path: ['site', 'design', 'radius'], what: 'layout', said: 'the corner rounding' },
  { path: ['site', 'design', 'spacing'], what: 'layout', said: 'the section spacing' },
  { path: ['site', 'design', 'containerWidth'], what: 'layout', said: 'the container width' },
  { path: ['site', 'name'], what: 'name', said: 'the site name' },
  { path: ['site', 'tagline'], what: 'copy', said: 'the tagline' }
];

/* A section's own content. `extra` is included because for a map it is the
   address and for an embed it is the link — content, as far as a client is
   concerned, whatever the field is called internally. */
const SECTION_FIELDS = [
  { key: 'title', what: 'copy' },
  { key: 'subtitle', what: 'copy' },
  { key: 'text', what: 'copy' },
  { key: 'items', what: 'copy' },
  { key: 'extra', what: 'copy' },
  { key: 'layout', what: 'layout' }
];
const SECTION_KEYS = SECTION_FIELDS.map((f) => f.key);
/* Fields whose change means the page was restructured, not retuned. */
const STRUCTURAL = ['type'];

const DESIGN_KEYS = ['radius', 'spacing', 'containerWidth'];

/* How much of a sentence a revert needs to name. Ordered most specific first,
   so "undo the site name change" is a name question before a copy one. */
const KINDS = [
  { id: 'name', words: /\b(site\s+name|business\s+name|name)\b/, said: 'the site name' },
  { id: 'colour', words: /\b(colours?|colors?|palette|colour\s+scheme|color\s+scheme)\b/, said: 'the colours' },
  { id: 'font', words: /\b(fonts?|typeface|typography)\b/, said: 'the font' },
  { id: 'layout', words: /\b(layout|spacing|corners?|radius|width|rounding)\b/, said: 'the layout' },
  { id: 'copy', words: /\b(copy|text|words|wording|tagline|headlines?|titles?)\b/, said: 'the copy' }
];

/* The verbs. "revert that" and "take that back" are in here because they are
   revert words with no target — recognised so the caller can tell the two
   apart rather than treating a bare one as a named request. */
const VERB = /\b(undo|revert|roll\s*back|restore|change\s+back|go\s+back|take\s+that\s+back)\b/;

/*
  "Put the colours back."

  The most natural way to ask does not put the verb next to the word "back" —
  the thing being restored sits between them, which a `put\s+back` pattern never
  matches. Two constraints keep the looser form honest:

    · `back` must END the sentence, so "put the prices back above the FAQ" stays
      an ordering request and reaches the section matcher it belongs to
    · the gap is bounded, so a long sentence that happens to contain both words
      is not read as a revert
*/
const PUT_BACK = /^\s*(?:please\s+)?(?:put|change|turn|set|switch|take)\b[^.!?]{0,40}?\bback\b\s*[.!?]*\s*$/i;

function isReverb(msg) {
  const raw = String(msg || '');
  return VERB.test(raw) || PUT_BACK.test(raw);
}

/* ---------- reading a sentence ---------- */

function whatFrom(msg) {
  const m = String(msg || '');
  for (let i = 0; i < KINDS.length; i++) {
    if (KINDS[i].words.test(m)) return KINDS[i].id;
  }
  return '';
}

function saidFor(what) {
  const k = KINDS.find((x) => x.id === what);
  return k ? k.said : '';
}

/*
  What the client is asking to revert.

  `targeted` is the question the planner actually needs answered: a revert with
  a target is a different op from a bare "undo", and getting that wrong turns
  "put the colours back" into "undo my last change" — which is worse than not
  understanding, because it changes something they did not name.
*/
function intent(msg, opts) {
  const o = opts || {};
  const raw = String(msg || '');
  const types = (o.types || []).filter(Boolean);
  const what = whatFrom(raw);
  const verbs = isReverb(raw);
  return {
    verbs: verbs,
    what: what,
    types: types,
    targeted: verbs && (!!what || types.length > 0),
    /* What the plan is called before the history is read: the executor replaces
       this with the specific line once it knows which step it found. */
    label: what || types.length ? 'Put ' + (what ? saidFor(what) : 'the ' + types[0] + ' section') + ' back' : 'Undid the last change'
  };
}

/* ---------- reading the history ---------- */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/*
  An absent field and an empty one are the same thing to a client, and treating
  them as different invents changes that never happened. That is not cosmetic:
  restoring items that did not exist leaves `items: []` behind, which reads as a
  fresh change, and the next revert aimed at that section would spend itself
  putting back the emptiness instead of reaching the edit the client meant.
*/
function norm(key, value) {
  if (key === 'items') return Array.isArray(value) ? value : [];
  return value;
}

function at(obj, path) {
  let cur = obj;
  for (let i = 0; i < path.length; i++) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[path[i]];
  }
  return cur;
}

/*
  The paths that differ between two snapshots, each labelled with what a client
  would call it and whether this module can put it back.

  Structural differences are reported rather than ignored, because the reason a
  revert cannot be done is worth saying: "that moved a section, so use ⌘Z"
  tells the client what to do next, and silence does not.
*/
function changedPaths(before, after) {
  const out = [];
  SITE_FIELDS.forEach((f) => {
    const a = at(before, f.path);
    const b = at(after, f.path);
    if (!same(a, b)) out.push({ path: f.path, what: f.what, said: f.said, value: a, type: '', structural: false });
  });

  const as = (Array.isArray(at(before, ['site', 'sections'])) ? at(before, ['site', 'sections']) : []);
  const bs = (Array.isArray(at(after, ['site', 'sections'])) ? at(after, ['site', 'sections']) : []);
  const max = Math.max(as.length, bs.length);
  for (let i = 0; i < max; i++) {
    const a = as[i];
    const b = bs[i];
    if (a == null || b == null) {
      /* Added or removed: every index after it has moved too. */
      const present = b || a || {};
      out.push({ path: ['site', 'sections', i], what: 'structure', said: 'the ' + (present.type || 'section') + ' section', value: a, type: present.type || '', structural: true });
      continue;
    }
    const type = b.type || a.type || '';
    if (same(a, b)) continue;
    if (a.type !== b.type) {
      out.push({ path: ['site', 'sections', i], what: 'structure', said: 'the ' + type + ' section', type: type, structural: true });
      continue;
    }
    SECTION_FIELDS.forEach((f) => {
      const av = norm(f.key, a[f.key]);
      const bv = norm(f.key, b[f.key]);
      if (!same(av, bv)) {
        out.push({ path: ['site', 'sections', i, f.key], what: f.what, said: 'the ' + type + ' section', value: av, type: type, structural: false, section: i });
      }
    });
    STRUCTURAL.forEach((k) => {
      if (!same(a[k], b[k])) out.push({ path: ['site', 'sections', i, k], what: 'structure', said: 'the ' + type + ' section', type: type, structural: true });
    });
  }
  return out;
}

/* ---------- the plan ---------- */

/*
  The most recent step whose change matches what was asked for.

  `states` is the history oldest first, current last, so a transition is
  (states[i], states[i+1]) and states.length - 2 is the most recent one. Walking
  from the end is what makes a later change to the same path win, and what
  keeps a later change to another path out of it entirely.
*/
function plan(states, ask) {
  const list = (states || []).filter((s) => s && typeof s === 'object');
  const want = (ask && ask.what) || '';
  const types = ((ask && ask.types) || []).filter(Boolean);
  if (!want && !types.length) {
    return { ok: false, reason: 'I need to know what to put back — the colours, the font, the layout, the name, or a section\'s own copy.' };
  }
  if (list.length < 2) {
    return { ok: false, reason: 'there is nothing to put back yet — this session has no earlier version of the site to read.' };
  }

  let structural = '';
  for (let i = list.length - 2; i >= 0; i--) {
    const hits = changedPaths(list[i], list[i + 1]).filter((h) => {
      if (types.length && types.indexOf(h.type) === -1) return false;
      if (want && h.what !== want) return false;
      return true;
    });
    const restorable = hits.filter((h) => !h.structural);
    if (!restorable.length) {
      /* Remembered only so a request that found structure and nothing else can
         explain itself; it never wins over a real match earlier in the walk. */
      if (hits.length && !structural) structural = hits[0].said;
      continue;
    }
    const labels = [];
    restorable.forEach((h) => { if (labels.indexOf(h.said) === -1) labels.push(h.said); });
    const stepsAgo = (list.length - 2) - i;
    return {
      ok: true,
      restores: restorable.map((h) => ({ path: h.path, value: clone(h.value) })),
      said: 'Put ' + labels.join(' and ') + ' back to how it was'
        + (stepsAgo === 0 ? ' — that was your last change.' : ' from ' + stepsAgo + ' step' + (stepsAgo === 1 ? '' : 's') + ' ago.')
        + ' Everything you changed after it is untouched.'
    };
  }

  const named = want ? saidFor(want) : 'the ' + types[0] + ' section';
  if (structural) {
    return { ok: false, reason: 'the only change to ' + named + ' moved sections around, and putting that back would move everything after it — use ' + '⌘Z' + ' for that one.' };
  }
  return { ok: false, reason: 'nothing in this session has changed ' + named + ' yet.' };
}

/* ---------- writing it back ---------- */

function allowed(path) {
  if (!Array.isArray(path) || path[0] !== 'site') return false;
  if (path.length === 2) return ['palette', 'font', 'heroLayout', 'name', 'tagline'].indexOf(path[1]) !== -1;
  if (path.length === 3 && path[1] === 'design') return DESIGN_KEYS.indexOf(path[2]) !== -1;
  if (path[1] === 'sections' && path.length === 4) {
    return Number.isInteger(path[2]) && path[2] >= 0 && SECTION_KEYS.indexOf(path[3]) !== -1;
  }
  return false;
}

/*
  Apply a plan to a live project.

  The whitelist is re-checked here rather than trusted from `plan`, because this
  is the function that mutates the client's site: a path that arrived from
  anywhere else — a hand-edited plan, a future caller, a stale shape — must not
  be able to write into the project. Refused paths are returned rather than
  thrown, so the caller can report a partial success honestly.
*/
function applyRestores(project, restores) {
  const p = project || {};
  if (!p.site) return { applied: 0, refused: (restores || []).map((r) => r && r.path) };
  let applied = 0;
  const refused = [];
  (restores || []).forEach((r) => {
    const path = r && r.path;
    if (!allowed(path)) { refused.push(path); return; }
    const value = clone(r.value);
    if (path.length === 4 && path[3] === 'items') {
      /* Items is the one array here; assigned rather than merged so the section
         ends up exactly as it was, extra fields included. */
      const sec = at(p, path.slice(0, 3));
      if (!sec) { refused.push(path); return; }
      sec.items = Array.isArray(value) ? value : [];
      applied++;
      return;
    }
    let cur = p;
    for (let i = 0; i < path.length - 1; i++) {
      if (cur[path[i]] == null || typeof cur[path[i]] !== 'object') cur[path[i]] = {};
      cur = cur[path[i]];
    }
    if (value === undefined) delete cur[path[path.length - 1]];
    else cur[path[path.length - 1]] = value;
    applied++;
  });
  return { applied: applied, refused: refused };
}

const Revert = {
  KINDS, SITE_FIELDS, SECTION_FIELDS, VERB, PUT_BACK,
  whatFrom, saidFor, isReverb, intent, changedPaths, plan, applyRestores, allowed
};
if (typeof module !== 'undefined' && module.exports) module.exports = Revert;

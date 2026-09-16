'use strict';

/* ============================================================
   AiScope — how much of the page a sentence is talking about,
   and what the sentence says must stay as it is.

   Two failures live here, and they are one failure wearing two
   coats: the client's words were read, their meaning was not.

     1. SCOPE. "make the pricing and faq sections consistent"
        names two places and one instruction. The planner
        resolves a single target, so the faq is silently left
        alone — and the client, having asked, believes it was
        handled. Same for "make every section heading shorter",
        where "every" is simply dropped.

     2. CONSTRAINTS. "make it more premium but keep the words"
        is an instruction with a limit on it. The rewrite fires,
        the limit is dropped, and their copy is rewritten after
        they asked for it to be left alone. That is the polarity
        bug approached from the other side.

   This module answers those two questions and nothing else. It
   plans no acts and touches no site state, so the planner can
   ask it freely and a test can pin the answers.

   It deliberately owns no site vocabulary: which section kinds
   exist, and which one is "last", are the planner's business and
   arrive through `opts`. Duplicating that here would be a second
   source of truth waiting to drift from the first.
   ============================================================ */

/* ---------- scope ---------- */

/* The words that widen a sentence from one place to a set. */
const ALL_WORD = /\b(every|each|all|any)\b/;
const REST_WORD = /\bthe\s+(?:rest|others?|remaining)\b|\bthe\s+other\s+(?:sections?|blocks?|ones|parts?)\b/;
const SECTION_NOUN = /\b(sections?|blocks?|ones|parts?|panels?)\b/;

/* How many targets one sentence is allowed to become.
   A scoped copy rewrite costs a credit per section, so a client who says
   "punch up all the copy" and expects one credit must not quietly spend
   eight. The caller sets the cap per operation and says so when it bites. */
const DEFAULT_CAP = 8;

/*
  Which widening word, if any, this sentence uses.

  A quantifier only scopes when there is something to scope: a section noun,
  or a named kind the caller found. Without that guard "at all", "all right"
  and "any good" would widen sentences that are about one thing — and widening
  is not a harmless misread, because it multiplies the work that follows.
*/
function scopeWord(msg, hasNamedKind) {
  const m = String(msg || '');
  if (REST_WORD.test(m)) return 'rest';
  if (ALL_WORD.test(m) && (hasNamedKind || SECTION_NOUN.test(m))) return 'all';
  return '';
}

function uniqueTypes(mentions) {
  const out = [];
  (mentions || []).forEach((mm) => {
    const type = mm && mm.type ? String(mm.type) : '';
    if (type && out.indexOf(type) === -1) out.push(type);
  });
  return out;
}

/*
  `filter` is the caller's answer to "can this operation even land on that
  section?" — supplied rather than assumed, for the same reason the section
  vocabulary is. Widening is only an improvement while every widened act does
  something: a copy rewrite aimed at a countdown or a map writes a field their
  renderer never reads, so it takes a credit and changes nothing. Excluding
  those here rather than downstream keeps `total` honest, so the note that says
  "I did the first four of nine" is counting sections the client can actually
  see change.
*/
function collect(site, predicate, filter) {
  const sections = (site && site.sections) || [];
  const out = [];
  sections.forEach((sec, idx) => {
    if (!sec) return;
    if (typeof filter === 'function' && !filter(sec)) return;
    if (predicate(sec)) out.push({ type: sec.type, idx: idx });
  });
  return out;
}

/* Truncate to the cap, but say whether it bit and what the true total was —
   a silent truncation is the same lie as a silent misread, one step later. */
function pack(targets, how, cap) {
  const limit = cap == null ? DEFAULT_CAP : cap;
  const list = targets || [];
  return {
    targets: list.slice(0, limit),
    how: how,
    total: list.length,
    capped: list.length > limit
  };
}

/*
  The set of sections a sentence points at.

  Returns { targets: [{type, idx}], how, total, capped } or { fail, type? }.
  A failure is named rather than boolean because the copilot has to say which
  thing is missing rather than answer every miss with the same sentence.

    how: 'one'   a single named kind          ("the faq")
         'kind'  all sections of named kinds  ("every pricing section")
         'all'   every section                ("every section")
         'rest'  everything but the named one ("the rest")
         'list'  one target per named kind    ("the pricing and faq sections")

  'list' is opt-in through `opts.allowList`, because two named kinds usually
  mean one instruction about a relationship between them rather than two
  targets — "move the faq above the pricing" names two sections and targets
  neither. Only the caller knows which reading its own verb wants.

  A wide result is passed through `opts.filter` last, so a caller can exclude
  targets its operation cannot affect before the cap is applied.
*/
function resolve(site, msg, opts) {
  const o = opts || {};
  const mentions = o.mentions || [];
  const how = scopeWord(msg, mentions.length > 0);

  if (how === 'rest') {
    /* "the rest" is only meaningful against the thing it is the rest of.
       With nothing named there is no set to subtract from, and guessing —
       every section? every section but the remembered one? — would make a
       wide change on a guess. */
    const excluded = uniqueTypes(mentions);
    if (!excluded.length) return { fail: 'unclear-rest' };
    const targets = collect(site, (sec) => excluded.indexOf(sec.type) === -1, o.filter);
    if (!targets.length) return { fail: 'no-target' };
    return pack(targets, 'rest', o.cap);
  }

  if (how === 'all') {
    const allowed = uniqueTypes(mentions);
    const targets = collect(site, (sec) => !allowed.length || allowed.indexOf(sec.type) !== -1, o.filter);
    if (!targets.length) return allowed.length ? { fail: 'not-on-site', type: allowed[0] } : { fail: 'no-target' };
    return pack(targets, allowed.length ? 'kind' : 'all', o.cap);
  }

  if (o.allowList) {
    const types = uniqueTypes(mentions);
    if (types.length > 1) {
      const lastOf = o.lastOf;
      const targets = types
        .map((type) => ({ type: type, idx: typeof lastOf === 'function' ? lastOf(site, type) : -1 }))
        .filter((tg) => tg.idx >= 0);
      if (targets.length > 1) return pack(targets, 'list', o.cap);
    }
  }

  if (mentions.length === 1) {
    const type = mentions[0].type;
    const idx = typeof o.lastOf === 'function' ? o.lastOf(site, type) : -1;
    if (idx >= 0) return pack([{ type: type, idx: idx }], 'one', o.cap);
    return { fail: 'not-on-site', type: type };
  }

  return { fail: 'no-target' };
}

/* ---------- constraints ---------- */

/* What a client can ask to be left alone, and the words that name it.
   Ordered so the most specific reads first: "branding" is a logo question
   before it is a colour one. */
const CATEGORIES = [
  { id: 'logo', words: /\b(logo|brand\s?mark|branding)\b/ },
  { id: 'copy', words: /\b(copy|text|wording|words|headlines?|sentences?|content|tone of voice)\b/ },
  { id: 'colour', words: /\b(colours?|colors?|palette|colour scheme|color scheme)\b/ },
  { id: 'font', words: /\b(fonts?|typeface|typography|lettering)\b/ },
  { id: 'images', words: /\b(images?|photos?|pictures?|graphics?|imagery)\b/ },
  { id: 'motion', words: /\b(animations?|motion|transitions?|effects)\b/ },
  { id: 'layout', words: /\b(layout|structure|arrangement|order|positioning|spacing)\b/ }
];

/*
  The clauses that carry a constraint. Each one is a way of saying "this part
  is not yours to change", and the category words are then read from inside the
  clause rather than from the sentence — otherwise "make the copy better but
  keep the colours" would read as a constraint on the copy, which is the
  opposite of what it says.
*/
const CONSTRAINT_CLAUSES = [
  /\b(?:don'?t|do not|never)\s+(?:change|touch|alter|edit|rewrite|move|remove)\b[^.;!?]{0,60}/i,
  /\bwithout\s+(?:changing|touching|altering|editing|rewriting|moving)\b[^.;!?]{0,60}/i,
  /\b(?:but|while|whilst|and)\s+(?:keep|keeping|leave|leaving)\b[^.;!?]{0,60}/i,
  /\bkeep\s+(?:the\s+)?[a-z][a-z ]{1,30}?\s+(?:as (?:it|they)\s+(?:is|are)|the same|unchanged|intact|exactly)/i,
  /\bleave\s+(?:the\s+)?[a-z][a-z ]{1,30}?\s+alone\b/i,
  /\b[a-z][a-z ]{2,30}?\s+(?:should|must|needs? to)\s+(?:stay|remain|be left)\b[^.;!?]{0,40}/i
];

/*
  What this sentence says must stay as it is.

    { keeps: ['copy'], clauses: ['but keep the words exactly as they are'] }

  `clauses` is kept so the copilot can quote the client's own words back when
  it explains why it did not do something — an explanation that paraphrases is
  easy to argue with, and one that quotes is not.
*/
function constraints(msg) {
  const m = String(msg || '');
  const keeps = [];
  const clauses = [];
  CONSTRAINT_CLAUSES.forEach((re) => {
    const g = new RegExp(re.source, 'gi');
    let hit;
    while ((hit = g.exec(m)) !== null) {
      const span = String(hit[0] || '').trim();
      if (!span) continue;
      if (clauses.indexOf(span) === -1) clauses.push(span);
      CATEGORIES.forEach((c) => {
        if (c.words.test(span) && keeps.indexOf(c.id) === -1) keeps.push(c.id);
      });
    }
  });
  return { keeps: keeps, clauses: clauses };
}

/* Which part of the site an act touches. One category per op is enough: the
   question is only ever "does this act reach the thing they told me to leave
   alone", and no op here spans two of these. */
const ACT_CATEGORY = {
  rewrite: 'copy',
  rewriteSection: 'copy',
  rewriteAll: 'copy',
  rewriteItems: 'copy',
  enhanceCopy: 'copy',
  setField: 'copy',

  palette: 'colour',
  pack: 'colour',
  themeToggle: 'colour',

  font: 'font',

  design: 'layout',
  layout: 'layout',
  hero: 'layout',
  navStyle: 'layout',
  navCta: 'layout',
  addSection: 'layout',
  removeSection: 'layout',
  moveSection: 'layout',
  duplicateSection: 'layout',

  images: 'images',
  alt: 'images',

  logo: 'logo',
  brandKit: 'logo'
};

function actCategory(act) {
  if (!act || !act.op) return '';
  return ACT_CATEGORY[act.op] || '';
}

/* The kept category this act would reach, or '' when it is safe to run.
   Returned as a string rather than a boolean so the caller can name what it
   protected: "you asked me to keep the copy" beats "that is not allowed". */
function blockedBy(act, keeps) {
  const category = actCategory(act);
  if (!category) return '';
  return (keeps || []).indexOf(category) === -1 ? '' : category;
}

/* The client's own words, for quoting back. Short, and never a whole sentence
   with the constraint clause cut out of it — the span is what they said. */
function quoted(clauses, limit) {
  const list = clauses || [];
  if (!list.length) return '';
  const text = list[0].replace(/^\s*(?:but|and|while|whilst)\s+/i, '').trim();
  const cap = limit == null ? 70 : limit;
  return text.length > cap ? text.slice(0, cap - 1).trim() + '…' : text;
}

const AiScope = {
  scopeWord,
  resolve,
  constraints,
  actCategory,
  blockedBy,
  quoted,
  ACT_CATEGORY,
  CATEGORIES,
  DEFAULT_CAP
};
if (typeof module !== 'undefined' && module.exports) module.exports = AiScope;

'use strict';

// ============================================================
// PallettAI Studio — page shell (the spatial language)
// ------------------------------------------------------------
// WHY THIS EXISTS. Measured across forty generations of one brief, the compiled
// HTML varied in every section but one thing never did: the scaffolding every
// section sat inside. Each block was a full-width band, with a 1140px container,
// the same vertical padding, and a left-aligned heading block pinned to 640px.
//
// So the layouts underneath could differ all they liked — a bento grid and a
// numbered list still arrived in the same frame, with the same gutters, the same
// heading position and the same breathing room. A page assembled out of four
// different grids inside an identical scaffold reads as the same page. That is
// the difference between "the sections were shuffled" and "this is a different
// website", and it is the thing a visitor actually judges.
//
// WHAT A SHELL DECIDES. Four knobs, all of them spatial:
//
//   measure — how wide this block's content is allowed to be
//             (narrow 720 / standard / wide / full-bleed edge-to-edge)
//   ground  — what sits behind it
//             (plain / surface panel / brand wash / hairline rule / contrast band)
//   head    — how the heading block is set
//             (left / centred / split — heading left, standfirst right / none)
//   rhythm  — the vertical space around it (tight / standard / airy)
//
// WHY IT IS NOT RANDOM. Random knobs produce noise, not design. A page gets one
// spatial LANGUAGE chosen from its look, and the language decides which values
// are even in play — a noir site will never get a candy-coloured band, an
// editorial site will never get edge-to-edge media. Then two page-level rules
// hold, because they are the difference between variation and a mess:
//
//   · at most ONE contrast band per page — it is a moment, and a moment only
//     means something if it is scarce;
//   · no two adjacent blocks share a rhythm — variety you can see is contrast,
//     and contrast needs a neighbour.
//
// DETERMINISTIC: a pure function of (seed x look x the page's section list).
// ============================================================

const AiShape = (() => {
  function hashKey(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }
  /*
    Seed-mixed but stable, with a real avalanche.

    A plain `(seed ^ hash) % n` reads only the low bits of the XOR, so with a
    four-entry pool the choice is decided by two bits of parity rather than by
    the seed — which is how a page set ends up with the same rhythm on every
    site while the code looks random. Two rounds, the second after folding the
    key in, so the bits `%` reads depend on every bit of both.
  */
  function mix(a, b) {
    let h = (Number(a) || 0) >>> 0;
    h = (Math.imul(h ^ 0x9e3779b9, 2654435761)) >>> 0;
    h ^= h >>> 15;
    h = (Math.imul(h, 2246822507)) >>> 0;
    h ^= h >>> 13;
    h = (Math.imul(h, 3266489909)) >>> 0;
    h ^= h >>> 16;
    h = (h ^ hashKey(String(b))) >>> 0;
    h ^= h >>> 15;
    h = (Math.imul(h, 2246822507)) >>> 0;
    h ^= h >>> 13;
    h = (Math.imul(h, 3266489909)) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }
  const pick = (seed, key, list) => {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) return '';
    return arr[mix(seed, key) % arr.length];
  };

  /* ---------------- the languages ----------------
     `minHead` is how many blocks must be allowed a centred or split heading
     before the language stops reading as a single idea. `band` is the type the
     contrast band belongs to when the language has one. */
  const LANGUAGES = {
    // Magazine: measure does the work. Rules instead of panels, one big band.
    editorial: {
      measure: ['standard', 'narrow', 'wide'],
      ground: ['plain', 'rule', 'plain', 'surface'],
      head: ['left', 'split', 'center'],
      rhythm: ['airy', 'standard'],
      bandFor: ['stats', 'testimonials', 'cta'],
      galleryMeasure: ['wide', 'full', 'standard'],
      heroMeasure: ['wide', 'standard'],
      headBlock: true
    },
    // Portfolio: the media wins. Edge-to-edge work, type kept out of its way.
    portfolio: {
      measure: ['wide', 'standard', 'narrow'],
      ground: ['plain', 'plain', 'surface'],
      head: ['left', 'left', 'split'],
      rhythm: ['tight', 'standard'],
      bandFor: ['cta', 'stats'],
      galleryMeasure: ['full', 'wide', 'full'],
      heroMeasure: ['full', 'wide'],
      headBlock: true
    },
    // Studio: air and confidence. Wide measure, headings that breathe.
    studio: {
      measure: ['wide', 'standard'],
      ground: ['plain', 'surface', 'wash', 'plain'],
      head: ['split', 'left', 'center'],
      rhythm: ['airy', 'standard'],
      bandFor: ['cta', 'stats', 'features'],
      galleryMeasure: ['wide', 'full'],
      heroMeasure: ['wide', 'full'],
      headBlock: true
    },
    // Signal: density and contrast. Built for trades, tech and offers.
    signal: {
      measure: ['standard', 'wide', 'narrow'],
      ground: ['plain', 'surface', 'rule', 'plain'],
      head: ['left', 'left', 'split'],
      rhythm: ['tight', 'standard'],
      bandFor: ['cta', 'stats', 'pricing'],
      galleryMeasure: ['wide', 'standard'],
      heroMeasure: ['wide', 'standard'],
      headBlock: true
    },
    // Quiet: one column, generous space, headings doing almost nothing.
    quiet: {
      measure: ['narrow', 'standard'],
      ground: ['plain', 'rule', 'plain', 'surface'],
      head: ['left', 'center', 'left'],
      rhythm: ['airy', 'airy', 'standard'],
      bandFor: ['cta'],
      galleryMeasure: ['wide', 'standard'],
      heroMeasure: ['standard', 'wide'],
      headBlock: true
    },
    // Story: prose-led. A narrow measure and no furniture at all.
    story: {
      measure: ['narrow', 'standard', 'wide'],
      ground: ['plain', 'rule', 'plain'],
      head: ['left', 'center'],
      rhythm: ['airy', 'standard'],
      bandFor: ['cta'],
      galleryMeasure: ['wide', 'standard'],
      heroMeasure: ['standard', 'wide', 'full'],
      headBlock: true
    }
  };

  // Which language a look speaks. Every look in the art-direction engine is
  // named here so no site is ever left without one.
  const LOOK_LANGUAGE = {
    editorial: 'editorial',
    noir: 'editorial',
    minimal: 'quiet',
    light: 'quiet',
    warm: 'studio',
    bright: 'studio',
    dark: 'signal',
    bold: 'signal',
    techy: 'signal',
    playful: 'portfolio'
  };

  const norm = (v) => String(v == null ? '' : v).trim();

  /* Every section type has its own idea of what a shell means. A hero is not a
     panel, and a contact block is not a full-bleed gallery — so the type filters
     the vocabulary before the seed gets a say. */
  const NO_HEAD = { hero: true, gallery: true, logos: true, video: true, countdown: true, embed: true, map: true, weather: true, crypto: true, github: true, fx: true, ticker: true };
  const ALWAYS_PLAIN = { hero: true };
  const NEVER_NARROW = { gallery: true, logos: true, video: true, embed: true, map: true, countdown: true, table: true, collection: true, crypto: true, github: true, fx: true };
  /* Media wants to sit on the page, not on furniture. A gallery behind a
     coloured panel has two things competing to be the subject. */
  const PLAIN_PREFERRED = { gallery: true, video: true, logos: true, embed: true, map: true, collection: true, countdown: true };
  /* The taste budget. These are the rules that separate variation from noise:
     at most two blocks may sit on anything other than the page background, the
     same ground may not appear twice in a row, and only one block per page may
     carry the contrast band — it is a moment, and a moment is only a moment
     while it is scarce. */
  const BUDGET = { ground: 2, rule: 1 };

  function languageFor(look) {
    return LANGUAGES[LOOK_LANGUAGE[norm(look)]] || LANGUAGES.studio;
  }

  /* ---------------- the plan ----------------
     `sections` is the page's section list, in order. Returns a map of type to
     shell, plus the language id so callers can explain the decision. */
  function plan(input) {
    const src = input || {};
    const sections = Array.isArray(src.sections) ? src.sections.filter(Boolean) : [];
    if (!sections.length) return null;
    const seed = Number(src.seed) || 0;
    const lang = languageFor(src.look);
    const langId = LOOK_LANGUAGE[norm(src.look)] || 'studio';

    // Where the one contrast band goes, if this page gets one at all. Six pages
    // in seven do — a band on every page would stop being a moment.
    const wantsBand = (((Math.abs(seed) ^ hashKey('band')) >>> 0) % 7) !== 0;
    const bandCandidates = sections.map((s) => s.type).filter((t) => (lang.bandFor || []).indexOf(t) !== -1);
    const bandType = wantsBand && bandCandidates.length
      ? pick(seed, 'bandtype:' + bandCandidates.join(','), bandCandidates)
      : '';

    const out = {};
    const usedRhythms = [];
    const usedGrounds = [];
    sections.forEach((s, i) => {
      const type = s.type;

      // ---- measure
      let measurePool = lang.measure.slice();
      if (type === 'gallery') measurePool = (lang.galleryMeasure || measurePool).slice();
      if (type === 'hero') measurePool = (lang.heroMeasure || measurePool).slice();
      if (NEVER_NARROW[type]) measurePool = measurePool.filter((m) => m !== 'narrow');
      if (!measurePool.length) measurePool = ['standard'];
      // A page whose every block is the same width has no rhythm, so a section
      // next to one of the same measure is pushed off it when it can be.
      const prev = out[sections[i - 1] && sections[i - 1].type];
      let candidates = measurePool.filter((m) => !prev || m !== prev.measure);
      if (!candidates.length) candidates = measurePool;
      const measure = pick(seed, 'measure:' + type, candidates);

      // ---- ground
      let ground = 'plain';
      if (type === bandType) ground = 'band';
      else if (!ALWAYS_PLAIN[type]) {
        const prevGround = prev ? prev.ground : '';
        const spent = usedGrounds.filter((g) => g !== 'plain');
        let groundPool = lang.ground.slice();
        // A section sitting on a coloured panel is the exception, not the rule:
        // once the budget is spent every remaining block rests on the page.
        if (spent.length >= BUDGET.ground) groundPool = groundPool.filter((g) => g === 'plain');
        if (spent.filter((g) => g === 'rule').length >= BUDGET.rule) groundPool = groundPool.filter((g) => g !== 'rule');
        // Two identical grounds side by side read as one block that lost its
        // bearings, so a block never repeats its neighbour's.
        groundPool = groundPool.filter((g) => g !== prevGround);
        if (PLAIN_PREFERRED[type]) groundPool = groundPool.filter((g) => g === 'plain' || g === 'rule');
        if (!groundPool.length) groundPool = ['plain'];
        ground = pick(seed, 'ground:' + type, groundPool);
      }
      usedGrounds.push(ground);

      // ---- head
      let head = 'left';
      if (NO_HEAD[type]) head = 'none';
      else if (lang.headBlock) head = pick(seed, 'head:' + type, lang.head);
      // A centred heading is a statement, so there is at most one per page and
      // it is never the first thing after a centred hero.
      if (head === 'center' && Object.keys(out).some((t) => out[t].head === 'center')) head = 'left';

      // ---- rhythm
      let rhythmPool = lang.rhythm.slice();
      const prevRhythm = prev ? prev.rhythm : '';
      let rhythmCands = rhythmPool.filter((r) => r !== prevRhythm);
      if (!rhythmCands.length) rhythmCands = rhythmPool;
      const rhythm = pick(seed, 'rhythm:' + type, rhythmCands);
      usedRhythms.push(rhythm);

      out[type] = { measure, ground, head, rhythm, language: langId };
    });

    return { id: langId, band: bandType, sections: out };
  }

  /* The renderer reads `section.shell`. It is written to the section rather than
     passed to the builder because every export path rebuilds from the project
     object, and a design decision that does not survive a save would come back
     different on reload. */
  function apply(sections, planResult) {
    if (!planResult || !planResult.sections) return sections;
    (sections || []).forEach((s) => {
      if (!s) return;
      const sh = planResult.sections[s.type];
      if (sh) s.shell = sh;
    });
    return sections;
  }

  return {
    LANGUAGES, LOOK_LANGUAGE, plan, apply, languageFor, mix,
    GROUNDS: ['plain', 'surface', 'wash', 'rule', 'band'],
    MEASURES: ['narrow', 'standard', 'wide', 'full'],
    HEADS: ['left', 'center', 'split', 'none'],
    RHYTHMS: ['tight', 'standard', 'airy']
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AiShape;

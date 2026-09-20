'use strict';

// ============================================================
// PallettAI Studio — design systems (the visual language)
// ------------------------------------------------------------
// WHY THIS EXISTS. Measured across forty generations of one brief
// (scripts/design-system-probe.js), the compiled HTML was 40/40 distinct — and
// only 3/40 distinct once you removed colour and type. Every site the app has
// ever built shares one set of decisions:
//
//     .btn    padding:13px 28px; border-radius:999px; font-weight:700
//     .card   background:var(--surface); box-shadow:var(--shadow); padding:32px
//     .eyebrow  text-transform:uppercase; letter-spacing:.14em
//     .nav    fixed, blurred bar, 1px bottom rule
//     .card:hover  transform:translateY(-6px)
//
// Those are the first things a person reads — long before the section order,
// long before the palette. So two cafés could be told apart by their colours and
// still read as the same website, which is exactly the complaint the shuffle
// probes could never explain. Colour is paint. This file is the architecture.
//
// WHAT A SCHOOL DECIDES. A complete, coherent visual language — the kind a studio
// would put its name to. Coherence is the whole point: random knobs produce noise,
// not design, so each school is authored as one idea rather than assembled from a
// menu. A school pins:
//
//     shape     corner radius of cards / buttons / media (and they differ)
//     weight    cards by shadow, by hairline rule, by flat border, or offset
//     type      heading weight, tracking, case, and the scale ratio
//     label     the eyebrow: tracked caps, small caps, italic lede, ruled, mono
//     space     how much air a section gets, and how wide the page runs
//     compose   an even grid, a wide-first grid, a staggered one, or rows
//     chrome    a blurred bar, a solid bar, a ruled edge, or a floating pill
//     motion    what a card does under the pointer
//     device    the one recurring mark that makes the page memorable
//
// THE CONTRACT. A school never decides anything about content, and never
// overrides a section's own layout — it is the frame, not the picture. Every
// rule it emits is scoped to `body.sys-<id>`, so a project without a system
// renders byte-for-byte as it did before this file existed, and a project with
// one can be switched between schools without touching a single section.
//
// DETERMINISTIC: a pure function of (seed × look × industry × niche), so the same
// brief with the same salt always lands on the same school, and different briefs
// stop converging on one.
// ============================================================

const AiSystem = (() => {
  const norm = (v) => String(v == null ? '' : v).trim();

  function hashKey(str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }
  // Same avalanche the shell and rhythm layers use. A weak `(seed ^ hash) % n`
  // reads only the low bits of the XOR, which is how a pool of eight quietly
  // becomes a pool of two.
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

  /* ------------------------------------------------------------------ schools
     Each entry is one design language, authored whole.

     `name` is what a person calls it, `blurb` is the one-line pitch, and `label`
     is the eyebrow specification — the two are different things and one of them
     used to be called `label` as well, which meant the eyebrow silently
     overwrote the name in every entry. Names are therefore `name`, and the smoke
     suite asserts both fields exist and are of the right type.

     `ground` is a preference handed back to the palette chooser (ink = dark
     pages, paper = light, tint = warm/off-white): a brutalist site in a
     whisper-pastel palette is a costume, so the school gets a say in the paint
     too — it just does not invent it here. */
  const SCHOOLS = {
    /* ---------------- atelier — the print magazine ----------------
       Media and measure do the work. Nothing floats: cards are not boxes, they
       are columns separated by hairline rules, the way a magazine sets a page.
       Square corners, no shadows anywhere, a lowercase italic standfirst in
       place of the tracked-cap eyebrow everyone else uses. */
    atelier: {
      id: 'atelier', name: 'Editorial Atelier', blurb: 'Print-magazine calm: hairline rules, no shadows, serif display type.',
      ground: 'paper', looks: ['editorial', 'noir'],
      radius: { card: 0, btn: 0, media: 2 },
      density: 1.12, container: 1180, typoScale: 1.14, typoTracking: '-0.02',
      typoHeadingLh: 1.1, typoBodyLh: 1.72,
      card: { mode: 'rule', pad: 28, bg: 'none' },
      btn: { radius: 0, pad: '15px 26px', weight: 700, case: 'none', track: '.01em', solid: 'text' },
      label: { case: 'none', style: 'italic', spacing: '.01em', weight: 500, size: '.98rem', prefix: 'none' },
      heading: { weight: 600, tracking: '-.025em', case: 'none' },
      grid: 'wide-first', nav: 'rule', hover: 'border', band: 'flat', device: 'rule'
    },

    /* ---------------- swiss — the grid ----------------
       Absolute, typographic, unornamented. Zero radius, borders instead of
       shadows, headings set in caps with tight tracking, a numbered index down
       the page and one flat brand-colour band. Dense, because a grid is dense. */
    swiss: {
      id: 'swiss', name: 'Swiss Grid', blurb: 'Absolute and typographic: caps headings, flat borders, numbered sections.',
      ground: 'paper', looks: ['noir', 'minimal'],
      radius: { card: 0, btn: 0, media: 0 },
      density: 0.86, container: 1240, typoScale: 0.98, typoTracking: '0',
      typoHeadingLh: 1.06, typoBodyLh: 1.58,
      card: { mode: 'border', pad: 26, bg: 'none' },
      btn: { radius: 0, pad: '14px 24px', weight: 800, case: 'upper', track: '.08em', solid: 'flat' },
      label: { case: 'upper', style: 'normal', spacing: '.16em', weight: 800, size: '.72rem', prefix: 'none' },
      heading: { weight: 800, tracking: '-.03em', case: 'upper' },
      grid: 'even', nav: 'solid', hover: 'none', band: 'flat', device: 'numerals'
    },

    /* ---------------- luxe — quiet luxury ----------------
       Almost nothing happens, expensively. Huge air, hairline rules, displays
       set at a light weight in a large size with a whisper of tracking, buttons
       that are text on a rule rather than a filled pill, and corner ticks as the
       only ornament. */
    luxe: {
      id: 'luxe', name: 'Quiet Luxury', blurb: 'Huge air and hairline rules: light display type, no filled buttons.',
      ground: 'ink', looks: ['editorial', 'dark'],
      radius: { card: 0, btn: 0, media: 1 },
      density: 1.42, container: 1120, typoScale: 1.24, typoTracking: '.06em',
      typoHeadingLh: 1.14, typoBodyLh: 1.86,
      card: { mode: 'rule', pad: 30, bg: 'none' },
      btn: { radius: 0, pad: '17px 4px 13px', weight: 600, case: 'upper', track: '.18em', solid: 'minimal' },
      label: { case: 'upper', style: 'normal', spacing: '.3em', weight: 500, size: '.68rem', prefix: 'none' },
      heading: { weight: 300, tracking: '.02em', case: 'none' },
      grid: 'rows', nav: 'rule', hover: 'none', band: 'ink', device: 'corner'
    },

    /* ---------------- soft — warm and human ----------------
       The friendly consumer language, done properly rather than by default:
       generous radii, real soft shadows, a tinted page, centred heads and a
       pill. This is what the generator used to do to *every* site, so it stays
       as one voice among eight instead of the only voice. */
    soft: {
      id: 'soft', name: 'Warm & Human', blurb: 'Friendly consumer: big radii, soft shadows, pill buttons, centred heads.',
      ground: 'tint', looks: ['warm', 'bright', 'playful'],
      radius: { card: 26, btn: 999, media: 22 },
      density: 1.0, container: 1160, typoScale: 1.04, typoTracking: '-.015',
      typoHeadingLh: 1.16, typoBodyLh: 1.7,
      card: { mode: 'shadow', pad: 34, bg: 'surface' },
      btn: { radius: 999, pad: '14px 32px', weight: 700, case: 'none', track: '0', solid: 'grad' },
      label: { case: 'upper', style: 'normal', spacing: '.12em', weight: 700, size: '.78rem', prefix: 'none' },
      heading: { weight: 700, tracking: '-.02em', case: 'none' },
      grid: 'even', nav: 'float', hover: 'lift', band: 'grad', device: 'none'
    },

    /* ---------------- brutal — neo-brutalist ----------------
       Borders you can see, corners you could cut yourself on, a hard offset
       shadow that the card falls onto when you point at it. Caps headings, one
       saturated band, staggered grid. Unmistakably not a template. */
    brutal: {
      id: 'brutal', name: 'Neo-Brutalist', blurb: 'Hard borders and offset shadows: square corners, caps type, staggered grid.',
      ground: 'paper', looks: ['bold', 'playful', 'techy'],
      radius: { card: 0, btn: 0, media: 0 },
      density: 0.94, container: 1280, typoScale: 1.06, typoTracking: '-.01',
      typoHeadingLh: 1.02, typoBodyLh: 1.6,
      card: { mode: 'offset', pad: 28, bg: 'surface' },
      btn: { radius: 0, pad: '15px 28px', weight: 800, case: 'upper', track: '.06em', solid: 'flat' },
      label: { case: 'upper', style: 'normal', spacing: '.14em', weight: 800, size: '.7rem', prefix: 'rule' },
      heading: { weight: 900, tracking: '-.035em', case: 'upper' },
      grid: 'stagger', nav: 'solid', hover: 'offset', band: 'flat', device: 'edge'
    },


    /* ---------------- instrument — technical precision ----------------
       Read on a screen by someone who cares about the numbers. Monospace
       accents, hairline borders with a brand-tinted hover, compact rhythm,
       wide-first asymmetric grids and a numbered index. */
    instrument: {
      id: 'instrument', name: 'Technical Instrument', blurb: 'Precise and dense: mono accents, hairline borders, asymmetric grids.',
      ground: 'ink', looks: ['techy', 'dark'],
      radius: { card: 6, btn: 6, media: 6 },
      density: 0.88, container: 1320, typoScale: 0.96, typoTracking: '-.005',
      typoHeadingLh: 1.12, typoBodyLh: 1.62,
      card: { mode: 'border', pad: 24, bg: 'none' },
      btn: { radius: 6, pad: '13px 22px', weight: 600, case: 'none', track: '.01em', solid: 'flat' },
      label: { case: 'upper', style: 'mono', spacing: '.1em', weight: 600, size: '.72rem', prefix: 'none' },
      heading: { weight: 600, tracking: '-.02em', case: 'none' },
      grid: 'wide-first', nav: 'blur', hover: 'border', band: 'ink', device: 'numerals'
    },

    /* ---------------- craft — warm and handmade ----------------
       Paper, ink and hands. Warm tinted ground, soft shadows, a small-caps label
       behind a short rule, staggered cards that sit slightly out of line, and a
       serif display — the language of a kitchen, a workshop or a farm. */
    craft: {
      id: 'craft', name: 'Warm & Handmade', blurb: 'Paper and ink: small-caps labels, soft shadows, gently staggered grid.',
      ground: 'tint', looks: ['warm', 'editorial', 'bright'],
      radius: { card: 20, btn: 14, media: 18 },
      density: 1.16, container: 1140, typoScale: 1.1, typoTracking: '.005',
      typoHeadingLh: 1.14, typoBodyLh: 1.76,
      card: { mode: 'shadow', pad: 30, bg: 'surface' },
      btn: { radius: 14, pad: '15px 28px', weight: 700, case: 'none', track: '.01em', solid: 'flat' },
      label: { case: 'smallcaps', style: 'normal', spacing: '.12em', weight: 700, size: '.82rem', prefix: 'rule' },
      heading: { weight: 600, tracking: '-.01em', case: 'none' },
      grid: 'stagger', nav: 'solid', hover: 'lift', band: 'grad', device: 'corner'
    },

    /* ---------------- cinema — the title sequence ----------------
       Big, dark and quiet. Display type at a large scale with tight tracking,
       almost no furniture — long rules and empty space instead of boxes — a
       heavy scrim so the photograph reads as a frame, and nothing moves under
       the pointer because the page should feel still. */
    cinema: {
      id: 'cinema', name: 'Cinematic', blurb: 'Dark and large: tight display type, rules not boxes, a heavy scrim.',
      ground: 'ink', looks: ['dark', 'noir', 'bold'],
      radius: { card: 2, btn: 2, media: 2 },
      density: 1.3, container: 1200, typoScale: 1.3, typoTracking: '-.03',
      typoHeadingLh: 1.04, typoBodyLh: 1.8,
      card: { mode: 'flat', pad: 22, bg: 'none' },
      btn: { radius: 2, pad: '16px 30px', weight: 600, case: 'upper', track: '.14em', solid: 'flat' },
      label: { case: 'upper', style: 'normal', spacing: '.26em', weight: 600, size: '.7rem', prefix: 'none' },
      heading: { weight: 500, tracking: '-.035em', case: 'none' },
      grid: 'rows', nav: 'blur', hover: 'none', band: 'ink', device: 'edge'
    }
  };

  /* How much air a school wants around a block, as a multiplier on the section
     token. Kept beside the school so the vertical rhythm is part of the language
     — and emitted as real CSS rather than only as a number, because "this page
     breathes differently" is a decision a reader can see. */
  const SECTION_AIR = {
    atelier: 1.06, swiss: 0.84, luxe: 1.3, soft: 1,
    brutal: 0.88, instrument: 0.82, craft: 1.14, cinema: 1.24
  };

  /* How tightly a school packs its repeating grids. `gap` writes into the
     measured CSS, so the decision is visible to the probe and to a test rather
     than only to an eye that happens to look at two sites side by side. */
  const GRID_GAP = {
    atelier: 30, swiss: 16, luxe: 44, soft: 24,
    brutal: 12, instrument: 14, craft: 22, cinema: 34
  };

  /* The motion physics: how far a card moves, how long it takes and how it
     eases. `kind` comes from the school's coarse hover vocabulary; these three
     make each school's motion its own. {SEL} is replaced with the body-scoped
     selector so this table stays readable as plain CSS. */
  const HOVER = {
    atelier:    { dist: 3, w: 3, dur: '.45s', ease: 'cubic-bezier(.2,.7,.3,1)' },
    swiss:      { dist: 2, w: 1, dur: '.12s', ease: 'linear' },
    luxe:       { dist: 2, w: 1, dur: '.7s',  ease: 'cubic-bezier(.16,1,.3,1)' },
    soft:       { dist: 9, w: 2, dur: '.34s', ease: 'cubic-bezier(.2,.8,.2,1)' },
    brutal:     { dist: 4, w: 2, dur: '.08s', ease: 'steps(2,end)' },
    instrument: { dist: 5, w: 1, dur: '.18s', ease: 'ease-out' },
    craft:      { dist: 7, w: 2, dur: '.4s',  ease: 'cubic-bezier(.25,.9,.3,1)' },
    cinema:     { dist: 1, w: 1, dur: '.9s',  ease: 'cubic-bezier(.16,1,.3,1)' }
  };

  /* The chrome, authored per school. Four kinds of bar with eight expressions:
     the kind is the promise, the edge weight, link rhythm and brand setting are
     the school. */
  const NAV_CSS = {
    atelier: [
      '{SEL} .nav{background:color-mix(in srgb,var(--bg) 94%,transparent);backdrop-filter:none;border-bottom:1px solid color-mix(in srgb,var(--text) 22%,transparent)}',
      '{SEL} .brand{font-weight:600;font-size:1.28rem;letter-spacing:-.015em;text-transform:none}',
      '{SEL} .nav-links{gap:32px}',
      '{SEL} .page-link{font-size:.92rem;letter-spacing:.01em}'
    ],
    swiss: [
      '{SEL} .nav{background:var(--bg);backdrop-filter:none;border-bottom:2px solid var(--text)}',
      '{SEL} .brand{font-weight:800;font-size:1.05rem;letter-spacing:.02em;text-transform:uppercase}',
      '{SEL} .nav-links{gap:20px}',
      '{SEL} .page-link{font-size:.78rem;letter-spacing:.09em;text-transform:uppercase;font-weight:700}'
    ],
    luxe: [
      '{SEL} .nav{background:color-mix(in srgb,var(--bg) 96%,transparent);backdrop-filter:none;border-bottom:1px solid color-mix(in srgb,var(--text) 14%,transparent)}',
      '{SEL} .brand{font-weight:400;font-size:1.18rem;letter-spacing:.2em;text-transform:uppercase}',
      '{SEL} .nav-links{gap:38px}',
      '{SEL} .page-link{font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;font-weight:500}'
    ],
    soft: [
      '{SEL} .nav{left:16px;right:16px;top:calc(var(--pai-sched-h,0px) + 12px);border-radius:999px;border:1px solid color-mix(in srgb,var(--text) 12%,transparent);background:color-mix(in srgb,var(--bg) 84%,transparent);backdrop-filter:blur(16px);box-shadow:0 12px 36px rgba(0,0,0,.16)}',
      '{SEL} .brand{font-weight:800;font-size:1.16rem;letter-spacing:-.02em;text-transform:none}',
      '{SEL} .nav-links{gap:26px}',
      '{SEL} .page-link{font-size:.95rem;font-weight:600}'
    ],
    brutal: [
      '{SEL} .nav{background:var(--bg);backdrop-filter:none;border-bottom:3px solid var(--text)}',
      '{SEL} .brand{font-weight:900;font-size:1.12rem;letter-spacing:-.02em;text-transform:uppercase}',
      '{SEL} .nav-links{gap:18px}',
      '{SEL} .page-link{font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;font-weight:800}'
    ],
    instrument: [
      '{SEL} .nav{background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid color-mix(in srgb,var(--text) 20%,transparent)}',
      '{SEL} .brand{font-weight:600;font-size:1rem;letter-spacing:0;text-transform:none}',
      '{SEL} .nav-links{gap:22px}',
      '{SEL} .page-link{font-size:.86rem;letter-spacing:.005em}'
    ],
    craft: [
      '{SEL} .nav{background:var(--bg);backdrop-filter:none;border-bottom:1px solid color-mix(in srgb,var(--primary) 30%,transparent)}',
      '{SEL} .brand{font-weight:700;font-size:1.2rem;letter-spacing:.01em;text-transform:none}',
      '{SEL} .nav-links{gap:28px}',
      '{SEL} .page-link{font-size:.93rem;font-variant:small-caps;letter-spacing:.08em}'
    ],
    cinema: [
      '{SEL} .nav{background:linear-gradient(180deg,color-mix(in srgb,#000 62%,transparent),transparent);backdrop-filter:none;border-bottom:1px solid color-mix(in srgb,var(--text) 8%,transparent)}',
      '{SEL} .brand{font-weight:500;font-size:1.1rem;letter-spacing:.26em;text-transform:uppercase}',
      '{SEL} .nav-links{gap:40px}',
      '{SEL} .page-link{font-size:.7rem;letter-spacing:.24em;text-transform:uppercase;font-weight:500}'
    ]
  };

  const IDS = Object.keys(SCHOOLS);

  /* Which looks can speak a language. Every look in the art-direction engine is
     listed so no site is ever left without a school — the first entry is the
     one that look speaks most naturally. */
  const LOOK_SCHOOLS = {
    editorial: ['atelier', 'craft', 'luxe'],
    noir: ['luxe', 'cinema', 'swiss'],
    minimal: ['swiss', 'luxe', 'atelier'],
    light: ['soft', 'swiss', 'craft'],
    warm: ['craft', 'soft', 'atelier'],
    bright: ['soft', 'craft', 'brutal'],
    dark: ['cinema', 'instrument', 'luxe'],
    bold: ['brutal', 'cinema', 'soft'],
    techy: ['instrument', 'swiss', 'brutal'],
    playful: ['soft', 'brutal', 'craft']
  };

  /* An industry has a register, and getting it wrong is worse than being dull:
     a solicitors' site in neo-brutalist caps, or a skate brand in quiet luxury.
     These are preferences, not locks — the seed still chooses, but from a pool
     that will not embarrass the client. */
  const TYPE_POOLS = {
    legal: ['luxe', 'atelier', 'swiss'],
    finance: ['luxe', 'swiss', 'instrument'],
    tech: ['instrument', 'swiss', 'cinema'],
    creative: ['brutal', 'atelier', 'cinema'],
    fitness: ['brutal', 'cinema', 'instrument'],
    food: ['craft', 'atelier', 'soft'],
    hospitality: ['craft', 'luxe', 'cinema'],
    retail: ['soft', 'brutal', 'craft'],
    health: ['soft', 'craft', 'swiss'],
    trades: ['instrument', 'brutal', 'swiss'],
    beauty: ['luxe', 'soft', 'atelier'],
    education: ['craft', 'soft', 'swiss'],
    property: ['luxe', 'swiss', 'instrument'],
    automotive: ['cinema', 'instrument', 'brutal'],
    pets: ['craft', 'soft', 'brutal']
  };

  /* Niche packs beat the industry when they exist, because a wood-fired pizzeria
     is not a "food business" — it is a room with a fire in it. */
  const NICHE_POOLS = {
    pizzeria: ['craft', 'atelier', 'brutal', 'soft'],
    bakery: ['craft', 'atelier', 'soft', 'swiss'],
    coffee: ['craft', 'soft', 'atelier', 'instrument'],
    gastropub: ['craft', 'cinema', 'atelier', 'instrument'],
    steakhouse: ['cinema', 'luxe', 'craft', 'instrument'],
    barbershop: ['brutal', 'instrument', 'cinema', 'swiss'],
    tattoo: ['brutal', 'cinema', 'instrument', 'atelier'],
    florist: ['soft', 'craft', 'atelier', 'luxe'],
    gym: ['brutal', 'instrument', 'cinema', 'swiss'],
    yoga: ['soft', 'craft', 'luxe', 'atelier'],
    photographer: ['cinema', 'atelier', 'luxe', 'swiss'],
    agency: ['brutal', 'swiss', 'cinema', 'instrument'],
    plumber: ['instrument', 'brutal', 'swiss', 'cinema'],
    electrician: ['instrument', 'brutal', 'swiss', 'cinema'],
    builder: ['instrument', 'brutal', 'craft', 'swiss'],
    estateagent: ['luxe', 'swiss', 'instrument', 'cinema'],
    solicitor: ['luxe', 'atelier', 'swiss', 'instrument'],
    accountant: ['swiss', 'luxe', 'instrument', 'atelier'],
    dentist: ['soft', 'swiss', 'instrument', 'craft'],
    vet: ['soft', 'craft', 'instrument', 'swiss'],
    childcare: ['soft', 'craft', 'swiss', 'atelier'],
    salon: ['soft', 'luxe', 'craft', 'atelier'],
    driving: ['instrument', 'swiss', 'soft', 'brutal'],
    wedding: ['luxe', 'atelier', 'cinema', 'craft']
  };

  // Every id in these tables must name a real school; the suite checks it, and
  // filtering here means a typo narrows a pool rather than crashing a build.
  const onlyReal = (list) => (list || []).filter((id) => Object.prototype.hasOwnProperty.call(SCHOOLS, id));

  /*
    The pool a brief may draw from, built as a UNION rather than an intersection.

    Intersecting the niche's choices with the look's collapsed to a pool of one
    or two for most briefs — forty generations of one café drew on three schools
    and the rest of the catalogue was unreachable. But narrowing is not what
    protects quality here: every school in this file is authored to be coherent
    and tasteful, so the real risk is absurdity (a funeral director in Playful
    Pop), not a café in Swiss Grid. So the lists are unioned — niche first,
    because the niche is the most specific truth about the business, then the
    industry's register, then wherever the look would naturally live — and the
    seed chooses evenly across the result.
  */
  function poolFor(look, typeId, nicheId) {
    const seen = [];
    const add = (list) => onlyReal(list).forEach((id) => { if (seen.indexOf(id) === -1) seen.push(id); });
    add(NICHE_POOLS[norm(nicheId)]);
    add(TYPE_POOLS[norm(typeId)]);
    add(LOOK_SCHOOLS[norm(look)]);
    if (!seen.length) return IDS;
    const pool = seen.slice(0, 5);
    // A pool of one or two is the failure this function exists to prevent, so a
    // brief with almost nothing to go on gets the whole catalogue instead.
    return pool.length >= 3 ? pool : IDS;
  }

  /* The choice. `key` lets a caller force a different draw for the same seed
     (the direction lab asks three times from one brief and must get three
     different answers, not one answer three times). */
  function choose(input) {
    const src = input || {};
    const pool = poolFor(src.look, src.typeId, src.nicheId);
    return pick(Number(src.seed) || 0, 'school:' + (src.key || '') + ':' + norm(src.look) + ':' + norm(src.typeId), pool) || 'soft';
  }

  /* The geometry a school contributes to the project object. These are the
     tokens the stylesheet already reads, so a school needs no new plumbing to
     change the page's corner radius, air, measure or type ratio. */
  function geometry(id, seed) {
    const s = SCHOOLS[norm(id)] || SCHOOLS.soft;
    const jitter = (Number(seed) || 0) >>> 0;
    /*
      A small, bounded wobble so two sites in the same school are not identical
      twins, without ever wandering into a different school's territory.

      `min`/`max` bound the *multiplier*, not the value it is applied to — this
      is a scale factor in the range a school is allowed to occupy, and every
      call site below multiplies it afterwards. Bounding it at pixel scale is a
      real bug I shipped once: density (~1.16) clamped to a floor of 40 and a
      section's padding came out at 3840px, which the project validator then
      "repaired" to its 96px default, quietly deleting the school's rhythm.
    */
    const wob = (kind, step, min, max) => {
      const r = (mix(jitter, 'geo:' + kind) % 100) / 100;
      const v = s[kind] * (1 + (r - 0.5) * step);
      return Math.max(min, Math.min(max, v));
    };
    const spacing = Math.round(wob('density', 0.18, 0.45, 1.85) * 96);
    const container = Math.round(wob('container', 0.05, 1000, 1440));
    const scale = Math.round(wob('typoScale', 0.08, 0.9, 1.45) * 100) / 100;
    const track = Math.round((Number(s.typoTracking) || 0) * 1000) / 1000;
    const rad = (v) => Math.max(0, v);
    return {
      containerWidth: container,
      radius: rad(s.radius.card),
      spacing,
      typoScale: scale,
      typoTracking: track,
      typoHeadingLh: s.typoHeadingLh,
      typoBodyLh: s.typoBodyLh
    };
  }

  /* --------------------------------------------------------------------- css
     Scoped to `body.sys-<id>` so the frame can change without the picture. Rules
     are emitted after the base stylesheet, so equal specificity loses to the
     school — which is the point of a language. */
  function css(id) {
    const s = SCHOOLS[norm(id)];
    if (!s) return '';
    const SEL = 'body.sys-' + s.id;
    const r = s.radius;
    const c = s.card;
    const b = s.btn;
    const l = s.label;
    const h = s.heading;
    const out = [];

    const px = (v) => (/^\d+$/.test(String(v)) ? String(v) + 'px' : String(v));

    /* ---- media corners: the one shape a photograph should agree with ---- */
    out.push(`${SEL} .hero-split-media img,${SEL} .about-media img,${SEL} .hero-split-media .media-grade,${SEL} .about-media .media-grade,${SEL} .gs-frame,${SEL} .video-wrap,${SEL} .map-wrap,${SEL} .coll-item,${SEL} .map,${SEL} .gallery img{border-radius:${px(r.media)}}`);
    if (r.media === 0) out.push(`${SEL} .gal-strip{padding-bottom:14px}`);

    /* ---- cards: the single most repeated element on any page ---- */
    const cardBase = [`border-radius:${px(r.card)}`, `padding:${px(c.pad)}`];
    if (c.bg === 'surface') cardBase.push('background:var(--surface)');
    if (c.bg === 'none') cardBase.push('background:transparent');
    if (c.mode === 'shadow') {
      cardBase.push('box-shadow:var(--shadow)', 'border:1px solid color-mix(in srgb,var(--text) 8%,transparent)');
    }
    if (c.mode === 'border') {
      cardBase.push('box-shadow:none', 'border:1px solid color-mix(in srgb,var(--text) 16%,transparent)');
    }
    if (c.mode === 'rule') {
      // A column, not a box: separation comes from a hairline the card owns.
      cardBase.push('box-shadow:none', 'border:0', 'border-top:1px solid color-mix(in srgb,var(--text) 18%,transparent)');
    }
    if (c.mode === 'flat') {
      cardBase.push('box-shadow:none', 'border:0');
    }
    if (c.mode === 'offset') {
      cardBase.push('box-shadow:6px 6px 0 var(--text)', 'border:2px solid var(--text)');
    }
    out.push(`${SEL} .card{${cardBase.join(';')}}`);
    // Cards that live inside a coloured band keep their white-on-band
    // treatment: a school deciding the page's card shape must not accidentally
    // make a card unreadable on the one band on the page.
    out.push(`${SEL} .ground-band .card{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.3);box-shadow:none;color:#fff;backdrop-filter:blur(3px)}`);
    out.push(`${SEL} .ground-band .bento-card,${SEL} .ground-band .cd-cell,${SEL} .ground-band .weather-box{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.3);box-shadow:none;color:#fff}`);
    if (c.mode === 'offset') out.push(`${SEL} .ground-band .card{box-shadow:6px 6px 0 rgba(255,255,255,.85);border-color:#fff}`);

    /* ---- hover: what the page does under the pointer ----
       The *kind* of motion is a coarse vocabulary shared by schools (lift, none,
       offset, rule-colour), because eight different physics models would be
       noise. How far, how fast and how it eases is not coarse at all — those are
       authored per school, so no two schools move the same way and the kind stays
       a legible promise. */
    const hv = Object.assign({ kind: s.hover, dist: 6, w: 2, dur: '.3s', ease: 'ease' }, HOVER[s.id]);
    out.push(`${SEL} .card{transition:transform ${hv.dur} ${hv.ease},box-shadow ${hv.dur} ${hv.ease}}`);
    if (hv.kind === 'none') {
      out.push(`${SEL} .card:hover{transform:none;box-shadow:${c.mode === 'shadow' ? 'var(--shadow)' : 'none'};border-top-color:${c.mode === 'rule' ? 'var(--primary)' : 'inherit'};border-color:${c.mode === 'rule' ? 'inherit' : 'var(--primary)'}}`);
    } else if (hv.kind === 'border') {
      // The rule thickens rather than the card moving: how much it thickens is
      // the school's, so two schools that both answer "quietly" still differ.
      out.push(`${SEL} .card:hover{transform:none;border-top-color:var(--primary);border-top-width:${hv.w}px}`);
      out.push(`${SEL} .card{border-top-color:color-mix(in srgb,var(--text) 18%,transparent);transition:border-color ${hv.dur} ${hv.ease}}`);
    } else if (hv.kind === 'offset') {
      out.push(`${SEL} .card:hover{transform:translate(${hv.dist}px,${hv.dist}px);box-shadow:${Math.max(1, 6 - hv.dist)}px ${Math.max(1, 6 - hv.dist)}px 0 var(--text)}`);
    } else {
      out.push(`${SEL} .card:hover{transform:translateY(-${hv.dist}px)}`);
    }

    /* ---- buttons: the shape a visitor clicks ---- */
    const btn = [`border-radius:${px(b.radius)}`, `padding:${b.pad}`, `font-weight:${b.weight}`, `letter-spacing:${b.track}`];
    if (b.case === 'upper') btn.push('text-transform:uppercase', 'font-size:.82rem');
    out.push(`${SEL} .btn{${btn.join(';')}}`);
    if (b.solid === 'text') {
      // Filled with the ink colour: a black (or cream) button, never a gradient.
      out.push(`${SEL} .btn.solid{background:var(--text);color:var(--bg);box-shadow:none}`);
      out.push(`${SEL} .btn.solid:hover{transform:none;opacity:.88;filter:none}`);
    } else if (b.solid === 'flat') {
      out.push(`${SEL} .btn.solid{background:var(--primary);color:#fff;box-shadow:none}`);
      out.push(`${SEL} .btn.solid:hover{transform:${s.hover === 'offset' ? 'translate(2px,2px)' : 'none'};filter:none;background:var(--primary-text)}`);
    } else if (b.solid === 'minimal') {
      // Luxury does not fill a button: it rules under it.
      out.push(`${SEL} .btn.solid{background:none;color:var(--text);border:0;border-bottom:1px solid var(--text);box-shadow:none;border-radius:0}`);
      out.push(`${SEL} .btn.solid:hover{transform:none;filter:none;border-bottom-color:var(--primary);color:var(--primary-text)}`);
    }
    if (b.radius === 0) out.push(`${SEL} .btn.ghost{border-width:1px}`);
    if (b.radius === 999) out.push(`${SEL} .btn.small{padding:10px 20px}`);

    /* ---- the label (eyebrow): the smallest thing on the page and the one
       that most reliably tells two sites apart ---- */
    const label = [`text-transform:${l.case === 'upper' ? 'uppercase' : 'none'}`, `letter-spacing:${l.spacing}`,
      `font-weight:${l.weight}`, `font-size:${l.size}`];
    if (l.style === 'italic') label.push('font-style:italic', 'text-transform:none');
    if (l.style === 'mono') label.push("font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace");
    out.push(`${SEL} .eyebrow{${label.join(';')}}`);
    if (l.case === 'smallcaps') {
      out.push(`${SEL} .eyebrow{font-variant:small-caps;text-transform:lowercase;letter-spacing:${l.spacing}}`);
    }
    if (l.prefix === 'rule') {
      out.push(`${SEL} .eyebrow::before{content:'';display:inline-block;width:26px;height:2px;background:currentColor;vertical-align:middle;margin-right:10px;opacity:.7}`);
    }
    out.push(`${SEL} .hero-badge{${label.join(';')}}`);

    /* ---- vertical rhythm: the school's own air, not the default ---- */
    const air = SECTION_AIR[s.id];
    if (air && air !== 1) out.push(`${SEL} .section{padding:calc(var(--sec-pad) * ${air}) 0}`);

    /* ---- headings: size ratio, weight, tracking, case ---- */
    out.push(`${SEL} .sec-head h2{font-weight:${h.weight};letter-spacing:${h.tracking}}`);
    if (h.case === 'upper') out.push(`${SEL} .sec-head h2{text-transform:uppercase;font-size:calc(clamp(1.5rem,3.2vw,2.2rem) * var(--typo-scale))}`);
    out.push(`${SEL} .sec-hero h1{font-weight:${h.weight};letter-spacing:${h.tracking}}`);
    out.push(`${SEL} h3,${SEL} .num-body h3{font-weight:${Math.max(500, Math.min(800, h.weight))}}`);
    // The standfirst follows the ground: a light school wants a quiet sub, a
    // dark one wants it lifted off the background.
    out.push(`${SEL} .sub{font-size:1.06rem}`);

    /* ---- the one recurring mark (the device) ---- */
    if (s.device === 'rule') {
      out.push(`${SEL} .sec-head h2::after{content:'';display:block;width:64px;height:2px;background:var(--primary);margin-top:18px}`);
    }
    if (s.device === 'numerals') {
      out.push(`${SEL} .section{counter-increment:syssec}`);
      out.push(`${SEL} .sec-head h2::before{content:counter(syssec,decimal-leading-zero);display:block;font-size:.72rem;font-weight:700;letter-spacing:.18em;color:var(--primary-text);margin-bottom:12px;font-variant-numeric:tabular-nums}`);
    }
    if (s.device === 'edge') {
      out.push(`${SEL} .section::before{content:'';position:absolute;left:0;top:0;width:3px;height:72px;background:var(--grad)}`);
    }
    if (s.device === 'corner') {
      out.push(`${SEL} .card::after{content:'';position:absolute;right:0;bottom:0;width:14px;height:14px;border-right:1px solid var(--primary);border-bottom:1px solid var(--primary);opacity:.6}`);
      out.push(`${SEL} .card{position:relative}`);
    }

    /* ---- the composition: how the repeating grids are set ----
       The kind decides the shape of the grid, the school decides how tightly its
       items are packed — a Swiss grid is dense, an atelier grid is not. Two
       schools sharing a shape still do not share a grid. */
    const gap = GRID_GAP[s.id] || 24;
    out.push(`${SEL} .grid2,${SEL} .grid3,${SEL} .grid4{gap:${gap}px}`);
    if (s.grid === 'wide-first') {
      out.push(`@media(min-width:900px){${SEL} .grid3{grid-template-columns:1.45fr 1fr 1fr}}`);
      out.push(`@media(min-width:900px){${SEL} .grid4{grid-template-columns:1.5fr 1fr 1fr 1fr}}`);
    }
    if (s.grid === 'stagger') {
      out.push(`@media(min-width:900px){${SEL} .grid3>*:nth-child(even){margin-top:${Math.round(gap * 1.4)}px}${SEL} .grid4>*:nth-child(3n){margin-top:${gap}px}}`);
    }
    if (s.grid === 'rows') {
      out.push(`${SEL} .grid3,${SEL} .grid4{grid-template-columns:1fr;gap:${Math.max(10, Math.round(gap * 0.62))}px}`);
    }

    /* ---- the chrome: the bar a visitor meets on every page ----
       The kind decides whether the bar is solid, ruled, blurred or floating; the
       school decides how heavy that edge is, how far the links sit apart and how
       the brand is set. Nothing here touches the bar's height, because the fixed
       bar's offset is accounted for elsewhere — a school may restyle the chrome,
       not move the furniture. */
    out.push(...(NAV_CSS[s.id] || []).map((r) => r.replace(/\{SEL\}/g, SEL)));

    /* ---- the band: the one moment of contrast on the page ---- */
    if (s.band === 'flat') {
      out.push(`${SEL} .ground-band{background:var(--primary)}`);
      out.push(`${SEL} .ground-band::after{background:radial-gradient(70% 90% at 15% 85%,rgba(255,255,255,.14),transparent 62%)}`);
    } else if (s.band === 'ink') {
      out.push(`${SEL} .ground-band{background:${s.ground === 'ink' ? 'color-mix(in srgb,var(--surface) 88%,#000)' : 'var(--text)'}}`);
      out.push(`${SEL} .ground-band::after{background:none}`);
      out.push(`${SEL} .ground-band .btn.ghost{border-color:rgba(255,255,255,.5)}`);
    }

    /* ---- the hero scrim: a photograph must stay readable, so the school may
       change how heavy the scrim is but never turn it off ---- */
    if (s.id === 'cinema' || s.id === 'instrument') {
      out.push(`${SEL} .hero-shade{background:linear-gradient(180deg,rgba(0,0,0,.68),rgba(0,0,0,.45) 58%,var(--bg))}`);
    } else if (s.id === 'soft' || s.id === 'craft') {
      out.push(`${SEL} .hero-shade{background:linear-gradient(180deg,rgba(12,14,32,.44),rgba(12,14,32,.22) 60%,var(--bg))}`);
    }

    /* ---- a school's own signature touches ---- */
    if (s.id === 'brutal') {
      out.push(`${SEL} .bento-card,${SEL} .cd-cell,${SEL} .weather-box{border-radius:0;border:2px solid var(--text);box-shadow:5px 5px 0 var(--text)}`);
      out.push(`${SEL} .tbl-wrap{border-radius:0;border:2px solid var(--text);box-shadow:5px 5px 0 var(--text)}`);
      out.push(`${SEL} .faq-item,${SEL} details{border-radius:0;border:2px solid var(--text)}`);
      out.push(`${SEL} .stat-num{background:none;color:var(--text);-webkit-text-fill-color:currentColor}`);
    }
    if (s.id === 'swiss') {
      out.push(`${SEL} .stat-num{background:none;color:var(--text);-webkit-text-fill-color:currentColor}`);
      out.push(`${SEL} .tbl-wrap{border-radius:0;box-shadow:none}`);
      out.push(`${SEL} .quotes blockquote,.quote-card{border-radius:0}`);
    }
    if (s.id === 'luxe' || s.id === 'cinema') {
      out.push(`${SEL} .tbl-wrap{border-radius:0;box-shadow:none}`);
      out.push(`${SEL} .stat-num{background:none;color:var(--text);-webkit-text-fill-color:currentColor;font-weight:${s.id === 'luxe' ? 400 : 600}}`);
      out.push(`${SEL} .sec-head{max-width:720px}`);
    }
    if (s.id === 'atelier') {
      out.push(`${SEL} .sec-head h2{font-size:calc(clamp(1.7rem,3.6vw,2.5rem) * var(--typo-scale))}`);
      out.push(`${SEL} .tbl-wrap{border-radius:0;box-shadow:none;border:0;border-top:1px solid color-mix(in srgb,var(--text) 22%,transparent)}`);
      out.push(`${SEL} .stat-num{background:none;color:var(--text);-webkit-text-fill-color:currentColor;font-weight:${h.weight}}`);
    }
    if (s.id === 'craft') {
      out.push(`${SEL} .quote-mark{color:var(--accent)}`);
      out.push(`${SEL} .num-idx{-webkit-text-stroke:1.5px var(--primary)}`);
    }
    if (s.id === 'instrument') {
      out.push(`${SEL} .stat-num,${SEL} .num-idx,${SEL} .cd-num{font-variant-numeric:tabular-nums}`);
      out.push(`${SEL} .tbl-wrap{border-radius:6px}`);
      out.push(`${SEL} .stat-num{background:none;color:var(--text);-webkit-text-fill-color:currentColor}`);
    }

    /* Reduced motion is a promise the whole app keeps; a school may not break it. */
    out.push(`@media(prefers-reduced-motion:reduce){${SEL} .card:hover{transform:none}}`);

    return out.join('\n');
  }

  /* What a school promises, in facts a test can check. Kept beside the CSS it
     describes so the two cannot drift: scripts/design-system-smoke.js asserts
     that the rendered page really does carry each of these. */
  function facts(id) {
    const s = SCHOOLS[norm(id)];
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      cardMode: s.card.mode,
      cardRadius: s.radius.card,
      btnRadius: s.radius.btn,
      btnCase: s.btn.case === 'upper' ? 'upper' : 'none',
      btnFill: s.btn.solid,
      labelCase: s.label.case === 'upper' ? 'upper' : (s.label.case === 'smallcaps' ? 'small-caps' : 'none'),
      labelSpacing: s.label.spacing,
      headingCase: s.heading.case === 'upper' ? 'upper' : 'none',
      headingWeight: s.heading.weight,
      density: s.density,
      grid: s.grid,
      nav: s.nav,
      hover: s.hover,
      band: s.band,
      device: s.device,
      ground: s.ground
    };
  }

  function spec(id) { return SCHOOLS[norm(id)] || null; }
  function name(id) { const s = SCHOOLS[norm(id)]; return s ? s.name : ''; }

  return {
    SCHOOLS, IDS, LOOK_SCHOOLS, TYPE_POOLS, NICHE_POOLS, SECTION_AIR, GRID_GAP, HOVER,
    choose, geometry, css, facts, spec, name, poolFor
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AiSystem;

'use strict';

// ============================================================
// PallettAI Studio — voice
// ------------------------------------------------------------
// Word-level copy for generated sites, composed from slots instead of chosen
// from a list.
//
// WHY THIS EXISTS. Measured on the shipped generator: generating one brief forty
// times produced forty distinct design signatures, seventeen palettes and
// thirty-six font pairings — and exactly TWO taglines, with the hero's H1 the
// same in all forty because it fell back to the business name. The variety that
// existed lived in attributes a visitor never reads; the sentence at the top of
// the page was a coin toss. That is what "it still looks the same" means, and no
// amount of palette choice fixes it.
//
// HOW IT WORKS. Each entry point composes a line from an opener, a promise, an
// optional proof and an optional place, using the industry's own vocabulary
// where we know it and a neutral tradesman voice where we do not. Eighteen
// tagline shapes across ~10 word slots, per industry, is thousands of distinct
// sentences per niche rather than two — and every one of them is still a
// sentence a studio would be happy to hand a plumber.
//
// DETERMINISM. Every choice is a pure function of the seed and a per-slot key,
// so the same brief and salt always produce the same sentence (the smoke suite
// asserts it). Nothing here is random at runtime.
//
// The tone pass lives in ai-brief.js `applyVoice` and is applied by the caller,
// so a "punchy" brand still gets its sentence clipped after composition.
// ============================================================

const AiVoice = (() => {
  /* ------------- seeded choice ------------- */

  function hashKey(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* A slot that is stable for a given seed+key, and decorrelated between slots
     so two slots in one sentence do not move together. */
  function pick(seed, key, list) {
    const arr = Array.isArray(list) ? list : [];
    if (!arr.length) return '';
    const n = (Math.abs(Number(seed) || 0) ^ hashKey(String(key))) >>> 0;
    return arr[n % arr.length];
  }

  /* Whole-sentence shape: a different draw space from the word slots, and the
     reason two sites rarely share a sentence. */
  function shape(seed, key, list) {
    return pick(seed, key, list);
  }

  /* ------------- industry vocabulary -------------
     Only the slots a template actually fills. `thing` is the noun for what the
     business makes or does, `who` for the people it serves, `how` for the way it
     works. Anything missing falls through to the generic row, so an industry we
     have not written for still gets sentences rather than blanks. */
  const LEX = {
    food: { thing: ['menu', 'kitchen', 'food', 'seasonal dishes'], who: ['regulars', 'locals', 'families', 'people who care what they eat'], how: ['made from scratch', 'cooked to order', 'sourced locally'] },
    cafe: { thing: ['coffee', 'roast', 'brunch'], who: ['morning regulars', 'locals', 'weekend regulars'], how: ['roasted in small batches', 'pulled properly', 'made fresh daily'] },
    retail: { thing: ['collection', 'range', 'stock'], who: ['locals', 'shoppers', 'people who know what they like'], how: ['chosen by hand', 'kept small on purpose'] },
    tech: { thing: ['product', 'platform', 'software'], who: ['teams', 'founders', 'operators'], how: ['built to be maintained', 'shipped in weeks not quarters'] },
    trade: { thing: ['work', 'craft', 'fitting'], who: ['homeowners', 'landlords', 'families'], how: ['done properly the first time', 'priced before we start'] },
    home: { thing: ['work', 'craft', 'fit-out'], who: ['homeowners', 'families'], how: ['measured twice, fitted once', 'finished by hand'] },
    beauty: { thing: ['treatment', 'appointment', 'cut'], who: ['regulars', 'clients', 'first-timers'], how: ['tailored to you', 'never rushed'] },
    fitness: { thing: ['training', 'programme', 'membership'], who: ['members', 'beginners', 'people starting again'], how: ['coached one to one', 'built around your week'] },
    professional: { thing: ['advice', 'work', 'service'], who: ['clients', 'families', 'business owners'], how: ['explained in plain English', 'handled end to end'] },
    care: { thing: ['care', 'support', 'visit'], who: ['families', 'clients', 'the people we look after'], how: ['delivered by the same faces', 'never hurried'] },
    creative: { thing: ['work', 'portfolio', 'projects'], who: ['clients', 'brands', 'people with a story to tell'], how: ['made to be remembered', 'crafted, not templated'] },
    events: { thing: ['day', 'event', 'celebration'], who: ['couples', 'families', 'planners'], how: ['planned down to the minute', 'handled so you can enjoy it'] },
    generic: { thing: ['work', 'service', 'product'], who: ['customers', 'clients', 'the people we work with'], how: ['done properly', 'done without fuss'] }
  };

  const TYPE_ALIAS = {
    food: 'food', cafe: 'cafe', restaurant: 'food', retail: 'retail', shop: 'retail',
    tech: 'tech', saas: 'tech', trade: 'trade', auto: 'trade', garden: 'trade',
    home: 'home', interior: 'home', beauty: 'beauty', hair: 'beauty', fitness: 'fitness',
    legal: 'professional', money: 'professional', property: 'professional', health: 'care',
    care: 'care', pet: 'care', creative: 'creative', music: 'creative', events: 'events',
    travel: 'events', edu: 'generic', nonprofit: 'generic'
  };

  function lexFor(typeId, nicheId) {
    const key = TYPE_ALIAS[nicheId] || TYPE_ALIAS[typeId] || '';
    return LEX[key] || LEX.generic;
  }

  const cap = (s) => {
    const t = String(s == null ? '' : s).trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  };
  const lower = (s) => String(s == null ? '' : s).trim().toLowerCase();
  /* "in Derby" / "around Derby" / "across Derby and beyond" — a place phrase, or
     nothing at all, so a template can carry it without a dangling preposition. */
  function place(ctx, seed, key) {
    const area = String((ctx && ctx.area) || '').trim();
    if (!area) return '';
    return pick(seed, key, ['in ' + area, 'across ' + area, 'in ' + area + ' and beyond', 'around ' + area]);
  }

  /* An empty slot leaves a hole in the sentence. Two mechanisms fix that:

       [ ... ]  a CLAUSE that is dropped entire when a slot inside it filled nothing.
                "Independent[, in Derby], and stubborn about food" loses the comma
                phrase rather than printing "Independent,, and stubborn…".

     EMPTY is a sentinel, not '' — otherwise there is no way to tell a slot that
     filled with nothing from ordinary punctuation, which is exactly the bug that
     produced "Real menu, made." for every site with no area named. */
  const EMPTY = '\u0001';

  function fill(tpl, ctx, seed) {
    const focus = lower((ctx && ctx.focus) || '');
    const thing = lower((ctx && ctx.thing) || '');
    const who = lower((ctx && ctx.who) || '');
    const how = lower((ctx && ctx.how) || '');
    const brand = String((ctx && ctx.brand) || '').trim();
    const area = String((ctx && ctx.area) || '').trim();
    const sub = (re, value) => { out = out.replace(re, value === '' ? EMPTY : value); };
    let out = String(tpl == null ? '' : tpl);
    sub(/\{Brand\}/g, brand);
    sub(/\{brand\}/g, brand);
    sub(/\{Focus\}/g, cap(focus));
    sub(/\{focus\}/g, focus);
    sub(/\{Thing\}/g, cap(thing) || cap(focus));
    sub(/\{thing\}/g, thing || focus);
    sub(/\{who\}/g, who);
    sub(/\{Who\}/g, cap(who));
    sub(/\{how\}/g, how);
    sub(/\{place\}/g, place(ctx, seed, 'place-tagline'));
    sub(/\{in\}/g, area ? 'in ' + area : '');
    // A clause holding a hole is removed; every other bracket is unwrapped.
    out = out.replace(/\[[^\]]*\u0001[^\]]*\]/g, ' ').replace(/\[([^\]]*)\]/g, '$1');
    return out
      .replace(/\u0001/g, '')
      .replace(/\s{2,}/g, ' ')
      // A dash is not punctuation to close up. Stripping the space before one
      // produced "Amber— made fresh daily" for every template built on a dash.
      .replace(/\s*—\s*/g, ' — ')
      .replace(/\s+([,.])/g, '$1')
      .replace(/^\s*[,.—]\s*/, '')
      .trim();
  }

  /* A sentence with a dangling place or no focus is worse than a plain one, so
     clauses that depend on a slot are dropped when the slot is empty. */
  function tidy(text) {
    const raw = String(text || '')
      .replace(/\s*—\s*/g, ' — ');
    // Sentence case: plenty of shapes begin with a slot ({place}, {thing},
    // {how}), which fills in lowercase and read as a typo.
    const cased = /^[a-z]/.test(raw) ? raw.charAt(0).toUpperCase() + raw.slice(1) : raw;
    return cased
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .replace(/([,;:])\s*\./g, '.')
      .replace(/\.\s*\./g, '.')
      .replace(/\s*,\s*,+/g, ',')
      .replace(/,+\s*(?=[.])/g, '')
      .replace(/\s+(in|across|around)\s*$/i, '')
      .replace(/[,\s]+$/, '')
      .trim();
  }

  /* ------------- the slot kernels ------------- */

  const TAGLINE = [
    '{Focus} {how}, {place}.',
    'The {thing} {who} come back for.',
    'Small team. {Thing} done properly.',
    '{Brand} — {how}.',
    'Your {thing} [{in} — ]{how}.',
    'Real {thing}. No fuss.[ {place}.]',
    '[{place}, ]we make {thing} worth the trip.',
    'Where {who} get {thing} {how}.',
    '{how} — that is the whole promise.',
    'The {thing} worth talking about.',
    '{Focus}, {how}. Nothing filler in between.',
    'Proper {thing} from people who do it every day.',
    '{Brand}: {how}, since day one.',
    'We keep it simple — good {thing}, {how}.',
    'Independent[, {place}], and stubborn about {thing}.',
    '{Thing} you would recommend to a friend.',
    '{Focus}, taken seriously {place}.',
    'Doing {thing} the long way, on purpose.'
  ];

  const HERO = [
    '{Focus} {how}[, {place}].',
    'Good {thing}, {how}.',
    '[{place} — ]{focus}, {how}.',
    'The {thing} worth crossing town for.',
    '{Focus} done properly, first time.',
    'Built for {who} who notice the difference.',
    'Real {thing}[, made {in}].',
    '{Brand} — {thing} {how}.',
    'Serious about {thing}. Relaxed about everything else.',
    '{Focus}[, {place}], {how}.'
  ];

  const CTA = [
    'Tell us what you need',
    'Start with a quick chat',
    'Get a straight answer',
    'Ask us anything',
    'Book it in',
    'Send us the details',
    'Let us take a look',
    'Get started today',
    'Talk it through with us'
  ];

  const EYEBROW = ['{place}', 'Independent {place}', '{Focus} {place}', 'Local, {place}', '{thing} {place}'];

  const ABOUT_LEAD = [
    '{Brand} is a small {thing} outfit[{place}] — {how}.',
    'We started {brand} because {thing}[ {place}] deserved better.',
    '{Brand} has been doing {thing}[ {place}] long enough to know what not to do.',
    'Everything we make is {how}, and that is not a slogan — it is the whole operation.',
    '{Brand} exists for {who}[ {place}] who want {thing} they can trust.'
  ];

  const SERVICE_LINE = [
    '{Focus} — {how}.',
    'The {thing} side of things, {how}.',
    'Straightforward {focus}, no surprises.'
  ];

  /* ------------- public ------------- */

  function ctxOf(input) {
    const c = input || {};
    const typeId = String(c.typeId || '').trim();
    const nicheId = String(c.nicheId || '').trim();
    // The resolved lexicon key travels with the context, because a caller that
    // needs its own vocabulary for the same business (the navigation's short
    // label) must agree with the prose about what kind of business this is.
    const key = TYPE_ALIAS[nicheId] || TYPE_ALIAS[typeId] || 'generic';
    const L = LEX[key] || LEX.generic;
    const seed = Number(c.seed) || 0;
    const base = {
      brand: String(c.brand || '').trim(),
      focus: String(c.focus || '').trim(),
      area: String(c.area || '').trim(),
      seed,
      lex: LEX[key] ? key : 'generic',
      thing: pick(seed, 'thing', L.thing),
      who: pick(seed, 'who', L.who),
      how: pick(seed, 'how', L.how)
    };
    return base;
  }

  function tagline(input) {
    const c = ctxOf(input);
    return tidy(fill(shape(c.seed, 'tagline-shape', TAGLINE), c, c.seed));
  }

  function hero(input) {
    const c = ctxOf(input);
    // A different shape index from the tagline so the H1 and the line under it
    // are not the same sentence wearing two hats.
    return tidy(fill(shape(c.seed, 'hero-shape', HERO), c, c.seed));
  }

  function cta(input) {
    const c = ctxOf(input);
    return tidy(fill(shape(c.seed, 'cta-shape', CTA), c, c.seed));
  }

  function eyebrow(input) {
    const c = ctxOf(input);
    const out = tidy(fill(shape(c.seed, 'eyebrow-shape', EYEBROW), c, c.seed));
    return out;
  }

  function aboutLead(input) {
    const c = ctxOf(input);
    return tidy(fill(shape(c.seed, 'about-shape', ABOUT_LEAD), c, c.seed));
  }

  function serviceLine(input) {
    const c = ctxOf(input);
    return tidy(fill(shape(c.seed, 'service-shape', SERVICE_LINE), c, c.seed));
  }

  /* ------------- section headings -------------
     Every cafe's features section was called "What we do", every one's FAQ
     "Questions" — the same words on every site in an industry, which is the
     other half of why they read as one template with different paint. These are
     the section headings a studio would actually write; the seed picks. */
  const HEADINGS = {
    features: ['What we do', 'What we actually do', 'The work', 'What you get', 'How we help', 'Services', 'What that looks like'],
    gallery: ['Recent work', 'A look inside', 'From the workshop', 'The gallery', 'What we have been up to', 'Selected work'],
    stats: ['By the numbers', 'The short version', 'Where we stand', 'A few facts', 'The record'],
    testimonials: ['In their words', 'What clients say', 'Kind words', 'Reviews', 'Why people come back'],
    faq: ['Questions we get asked', 'Good to know', 'Before you book', 'The honest answers', 'FAQs'],
    pricing: ['What it costs', 'Simple pricing', 'Choosing a tier', 'Pricing', 'What you will pay'],
    about: ['Our story', 'Who you are dealing with', 'About us', 'How it started', 'A bit about us'],
    table: ['What is on', 'The menu', 'This week', 'What we are serving'],
    contact: ['Get in touch', 'Talk to us', 'Find us', 'Say hello', 'Start here'],
    cta: ['Ready when you are', 'Over to you', 'Start today', 'Shall we begin', 'Next step'],
    booking: ['Book a time', 'Pick a slot', 'Check availability'],
    menu: ['Menu', 'What we serve'],
    team: ['Who you will meet', 'The team'],
    services: ['What we do', 'Services'],
    faqAlt: ['FAQ']
  };

  function heading(kind, input) {
    const list = HEADINGS[String(kind || '')];
    if (!list) return '';
    const c = ctxOf(input || {});
    return pick(c.seed, 'heading:' + kind, list);
  }

  /* ------------- the navigation's own label -------------
     A hero CTA is an invitation and can afford a phrase — "Let us take a look"
     earns its space when it is the size of a headline. The same words in a 68px
     bar do not: they wrap inside the button, the wrapped block overflows the
     bar, and on a phone the nav ends up with a tall orange box sitting on top of
     its own brand. So the bar gets its own short, concrete label drawn from the
     same seed — the same site voice, at the size the space allows. */
  const NAV_CTA = {
    food: ['Book a table', 'See the menu', 'Reserve a table'],
    cafe: ['Book a table', 'See the menu', 'Drop in'],
    retail: ['Shop the range', 'Browse the shop', 'Visit us'],
    tech: ['Book a demo', 'See it working', 'Start free'],
    trade: ['Get a quote', 'Request a visit', 'Call us out'],
    home: ['Book a survey', 'Get a quote', 'Plan a project'],
    beauty: ['Book a slot', 'Book in', 'Message us'],
    fitness: ['Book a class', 'Start training', 'Claim a trial'],
    professional: ['Book a call', 'Arrange a call', 'Get in touch'],
    care: ['Book a visit', 'Make an enquiry', 'Register'],
    creative: ['Start a project', 'See the work', 'Tell us the idea'],
    events: ['Check dates', 'Enquire now', 'Plan with us'],
    generic: ['Get in touch', 'Start here', 'Say hello']
  };

  // 22 characters is about what one line holds in a nav button at every width
  // the app's nav bar supports, so a label that does not fit falls back rather
  // than being truncated or wrapped.
  const NAV_CTA_MAX = 22;

  function navCta(input) {
    const c = ctxOf(input || {});
    const list = NAV_CTA[c.lex] || NAV_CTA.generic;
    const out = pick(c.seed, 'nav-cta', list);
    if (out && out.length <= NAV_CTA_MAX) return out;
    return NAV_CTA.generic[0];
  }

  return {
    tagline, hero, cta, eyebrow, aboutLead, serviceLine, heading, navCta,
    HEADINGS, NAV_CTA, NAV_CTA_MAX, LEX, TYPE_ALIAS, pick
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AiVoice;

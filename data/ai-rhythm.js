'use strict';

// ============================================================
// PallettAI Studio — page rhythm
// ------------------------------------------------------------
// The composition pass: what comes second, how long the page is, and which
// treatment each block gets — decided together, as a rhythm, instead of
// shuffled one section at a time.
//
// WHY. Composition was random within a fixed envelope, and the envelope showed.
// Measured across forty generations of one brief: every single site opened
// hero → gallery → about and closed … → cta → contact, every one held seven to
// nine sections, and the hero was one of four shapes. Randomising the middle of
// a page whose first three blocks never move produces forty sites that feel like
// the same site with its furniture rearranged.
//
// A rhythm is an authored answer to "what is this business's page FOR":
//
//   · a restaurant leads with what is on the menu this week;
//   · a photographer leads with the work;
//   · a boiler repair firm leads with proof and a phone number;
//   · an editorial studio leads with a story and takes eleven blocks to do it.
//
// The vocabulary is the sections the generator already produces, so a rhythm can
// never invent a block the renderer does not know. It only chooses order,
// presence, treatment and length — and it can say "no pricing" for a business
// that never publishes prices.
//
// DETERMINISTIC: a pure function of (seed × available sections × tier).
// ============================================================

const AiRhythm = (() => {
  const ALL_LAYOUTS = {
    hero: ['split', 'minimal', '', 'terminal', 'aurora'],
    about: ['', 'left', 'floating', 'timeline'],
    features: ['', 'bento', 'numbered', 'strip'],
    gallery: ['', 'mosaic', 'strip', 'collage', 'reel'],
    stats: ['', 'band', 'ticker'],
    testimonials: ['', 'featured', 'masonry'],
    faq: ['', 'columns', 'accordion', 'split'],
    pricing: ['', 'stacked', 'toggle'],
    cta: ['', 'splash', 'email'],
    contact: ['', 'overlap', 'split', 'cards', 'minimal']
  };

  function hashKey(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }
  /*
    Mix before you modulo.

    This used to be `(seed ^ hashKey(key)) % list.length`, and for a two-entry
    pool that reads the parity of the XOR — which is the parity of the seed XOR
    the parity of a constant. The seed's low bit, not its value, was deciding.
    Measured across thirty builds of one brief: the CTA layout came out `splash`
    29 times and `email` once, and gallery sat on `mosaic` 21 times. Every pool
    built on this function was effectively pinned, which is the whole of "I've
    upgraded it and it still looks the same".

    ai-compose.js learned this exact lesson for its add-bits and reached for an
    avalanche. Doing the same here — twice, once to spread the seed and once
    after folding the key in, so the low bits that `%` reads depend on every bit
    of both.
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

  /* ---------------- the rhythms ----------------
     `lead` is the block that follows the hero — the decision that changes a page
     most. `length` is [min, max] in sections including hero and contact.
     `drop` names blocks this business should never show.

     `layouts` says which treatments BELONG to this intention — never which one
     is used. These pools used to be single-element (`gallery: ['mosaic']`,
     `faq: ['columns']`, `testimonials: ['featured']` on eight of the ten
     rhythms), which quietly pinned most of the page: the rhythm chose an
     intention, and then every site with that intention rendered the identical
     gallery, the identical FAQ and the identical proof wall. Ten rhythms across
     four applicable business types is four page shapes, which is exactly what
     "every site looks the same" means when the section data looks varied.

     A pool below should therefore hold the treatments that suit the intention
     and let the seed pick: the rhythm is a matter of taste, and taste is a
     boundary, not an assignment. */
  const RHYTHMS = [
    {
      id: 'editorial-long',
      lead: ['about', 'features'],
      length: [9, 11],
      layouts: { hero: ['minimal', 'aurora', 'split'], about: ['timeline', 'floating', 'left'], features: ['numbered', 'bento'], gallery: ['collage', 'strip'], stats: ['band', 'ticker'], testimonials: ['featured', 'masonry'], faq: ['columns', 'accordion'], cta: ['splash', 'email'], contact: ['cards', 'split', 'overlap'] }
    },
    {
      id: 'work-first',
      lead: ['gallery'],
      length: [6, 8],
      layouts: { hero: ['split', 'minimal', 'aurora'], gallery: ['mosaic', 'strip', 'collage', 'reel'], features: ['strip', 'bento'], testimonials: ['masonry', 'featured'], about: ['', 'left', 'timeline'], cta: ['splash', 'email'] }
    },
    {
      id: 'proof-led',
      lead: ['stats', 'testimonials'],
      length: [7, 9],
      layouts: { hero: ['', 'split', 'minimal'], stats: ['band', 'ticker'], testimonials: ['featured', 'masonry'], gallery: ['collage', 'reel'], features: ['bento', 'numbered', 'strip'], faq: ['columns', 'accordion'] }
    },
    {
      id: 'what-is-on',
      lead: ['table', 'gallery', 'features'],
      length: [6, 8],
      drop: ['pricing'],
      layouts: { hero: ['split', '', 'minimal'], gallery: ['mosaic', 'strip', 'reel', 'collage'], features: ['strip', 'bento', 'numbered'], about: ['floating', 'left'], testimonials: ['masonry', 'featured'], cta: ['email', 'splash'] }
    },
    {
      id: 'conversion',
      // Proof, then the offer. A stat band before the benefits is the shape this
      // rhythm is for, and it keeps the house rule that every rhythm a proof-led
      // trade can draw opens on evidence rather than on a feature list.
      lead: ['stats', 'features'],
      length: [8, 10],
      layouts: { hero: ['split', 'minimal', ''], features: ['bento', 'numbered', 'strip'], stats: ['band', 'ticker'], pricing: ['stacked', 'toggle'], testimonials: ['featured', 'masonry'], faq: ['columns', 'accordion', 'split'], cta: ['splash', 'email'], contact: ['overlap', 'cards', 'split'] }
    },
    {
      id: 'quiet',
      lead: ['about'],
      length: [5, 6],
      drop: ['stats', 'pricing', 'faq'],
      layouts: { hero: ['minimal', 'aurora'], about: ['floating', 'timeline', 'left'], features: ['strip'], gallery: ['collage', '', 'reel'], testimonials: ['masonry', 'featured'], cta: ['splash', ''], contact: ['minimal', 'cards'] }
    },
    {
      id: 'trade-trust',
      // Proof precedes the pitch. This rhythm exists for the trades and the
      // regulated practices, and it used to open with the feature list — the one
      // thing a person hiring a plumber at 9pm is not reading first. The lead is
      // the whole point of the rhythm, so it is stated as proof, features, proof.
      lead: ['stats', 'testimonials', 'features'],
      length: [7, 8],
      drop: ['pricing'],
      layouts: { hero: ['', 'split', 'terminal'], features: ['numbered', 'strip', 'bento'], stats: ['band', 'ticker'], testimonials: ['featured', 'masonry'], faq: ['columns', 'accordion'], gallery: ['mosaic', 'collage'], contact: ['cards', 'overlap', 'split'] }
    },
    {
      id: 'story',
      lead: ['about'],
      length: [6, 7],
      drop: ['pricing', 'stats'],
      layouts: { hero: ['minimal', 'split', 'aurora'], about: ['timeline', 'floating', 'left'], gallery: ['collage', 'strip', 'mosaic'], features: ['numbered', 'strip'], testimonials: ['featured', 'masonry'], cta: ['splash', 'email'], contact: ['minimal', ''] }
    },
    {
      id: 'portfolio',
      lead: ['gallery'],
      length: [6, 8],
      drop: ['pricing'],
      layouts: { hero: ['split', 'aurora', 'minimal'], gallery: ['collage', 'strip', 'reel', 'mosaic'], features: ['strip', 'numbered'], testimonials: ['masonry', 'featured'], about: ['', 'left', 'timeline'], cta: ['splash', 'email'] }
    },
    {
      id: 'local-reputation',
      lead: ['testimonials', 'about'],
      length: [7, 9],
      layouts: { hero: ['', 'minimal', 'split'], testimonials: ['featured', 'masonry'], about: ['floating', 'timeline', 'left'], features: ['bento', 'strip', 'numbered'], stats: ['ticker', 'band'], gallery: ['collage', 'strip', 'reel'], faq: ['columns', 'accordion', 'split'] }
    }
  ];

  /* Which rhythms suit which kind of business. Everything else is available to
     `generic`, so no industry is ever left without a page shape. */
  const FIT = {
    food: ['what-is-on', 'editorial-long', 'local-reputation', 'quiet'],
    cafe: ['what-is-on', 'quiet', 'local-reputation', 'editorial-long'],
    retail: ['work-first', 'conversion', 'editorial-long', 'local-reputation'],
    creative: ['portfolio', 'story', 'editorial-long', 'work-first'],
    tech: ['conversion', 'proof-led', 'editorial-long', 'quiet'],
    // Every rhythm a trade can draw opens on proof. `quiet` is deliberately not
    // in this list: a moody story page is the wrong shape for a business whose
    // reader is in a hurry and looking for a reason to trust someone.
    trade: ['trade-trust', 'proof-led', 'conversion'],
    home: ['trade-trust', 'work-first', 'conversion', 'editorial-long'],
    professional: ['trade-trust', 'proof-led', 'editorial-long', 'quiet'],
    fitness: ['conversion', 'proof-led', 'local-reputation', 'work-first'],
    beauty: ['work-first', 'local-reputation', 'quiet', 'editorial-long'],
    events: ['portfolio', 'story', 'work-first', 'editorial-long'],
    care: ['local-reputation', 'trade-trust', 'quiet', 'story'],
    generic: ['editorial-long', 'proof-led', 'work-first', 'conversion', 'quiet', 'story', 'trade-trust', 'local-reputation', 'portfolio', 'what-is-on']
  };

  /*
    A niche is more specific than a trade, and the fit has to follow it.

    FIT was keyed by trade (`food`, `trade`, `creative`), but the generator passes
    a NICHE id — `pizzeria`, `plumber`, `photographer`. Every one of those missed
    the table and fell through to `generic`: all ten rhythms, so a pizzeria had a
    one-in-ten chance of a rhythm that leads with the menu and nine chances of one
    that buries it behind a feature list. The same held for every trade, which is
    why "proof-first for a plumber" was a coin toss rather than a rule.

    Mapping the niche to its family restores the intention without duplicating
    the rhythms. Anything unnamed still reaches FIT.generic, so no business is
    left without a page shape.
  */
  const NICHE_FAMILY = {
    // kitchens, bars and bakers lead with what is on
    pizzeria: 'food', coffee: 'food', cafe: 'food', bakery: 'food', burger: 'food',
    japanese: 'food', indian: 'food', mexican: 'food', steakhouse: 'food', pub: 'food',
    winebar: 'food', brewery: 'food', catering: 'food', restaurant: 'food', deli: 'food',
    // trades and regulated practices lead with proof
    plumber: 'trade', electrician: 'trade', solicitor: 'trade', dentist: 'trade',
    accountant: 'trade', garage: 'trade', locksmith: 'trade', vet: 'trade',
    physio: 'trade', landscaper: 'trade', tutor: 'trade', builder: 'trade', roofer: 'trade',
    // work you look at leads with the work
    hair: 'beauty', barber: 'beauty', nails: 'beauty', spa: 'beauty', florist: 'retail',
    boutique: 'retail', wedding: 'events', photography: 'creative', tattoo: 'creative',
    interior: 'creative'
  };

  function rhythmList(typeId, nicheId) {
    const niche = String(nicheId || '').trim();
    const key = NICHE_FAMILY[niche] || niche || String(typeId || '').trim();
    const ids = FIT[key] || FIT.generic;
    const byId = {};
    RHYTHMS.forEach((r) => { byId[r.id] = r; });
    const list = ids.map((id) => byId[id]).filter(Boolean);
    return list.length ? list : RHYTHMS;
  }

  /* The tail of a page is not a design decision — a contact block and a closing
     call to action are the two things a small business site is FOR. */
  const TAIL = ['cta', 'contact'];

  function choose(seed, typeId, nicheId, opts) {
    const o = opts || {};
    const list = rhythmList(typeId, nicheId).filter((r) => !o.id || r.id === o.id);
    return pick(seed, 'rhythm', list.length ? list : RHYTHMS);
  }

  /* Section types the rhythm wants, in the order it wants them. Sections the
     business does not have are skipped; the rhythm never adds a block the
     generator cannot fill. */
  function order(available, rhythm) {
    const have = available.slice();
    const want = [];
    const push = (t) => { if (t && have.indexOf(t) !== -1 && want.indexOf(t) === -1) want.push(t); };
    push('hero');
    (rhythm.lead || []).forEach(push);
    // the middle: whatever is left, in a stable order the rhythm suggests
    const MIDDLE_ORDER = ['about', 'gallery', 'features', 'stats', 'table', 'testimonials', 'pricing', 'faq', 'team', 'menu', 'services', 'booking'];
    MIDDLE_ORDER.forEach(push);
    have.forEach(push);              // anything the vocabulary does not name yet
    TAIL.forEach(push);
    return want;
  }

  /* ---------------- the plan ---------------- */
  function plan(input) {
    const src = input || {};
    const available = Array.isArray(src.sections) ? src.sections.slice() : [];
    if (!available.length) return null;
    const seed = Number(src.seed) || 0;
    const rhythm = src.rhythm || choose(seed, src.typeId, src.nicheId, src);
    const drop = rhythm.drop || [];
    let types = available.filter((t) => drop.indexOf(t) === -1);
    // hero and contact survive every rhythm; they are the page.
    if (available.indexOf('hero') !== -1 && types.indexOf('hero') === -1) types.unshift('hero');
    if (available.indexOf('contact') !== -1 && types.indexOf('contact') === -1) types.push('contact');

    let ordered = order(types, rhythm);
    /*
      Two things about a page are not matters of taste, so they are guaranteed
      rather than hoped for.

      A pizzeria shows its menu, and it shows it before it explains itself. A
      trade shows proof of work before it lists benefits — the reader is looking
      for a reason to trust someone, and a feature list is not one. Both were
      left to whichever rhythm the seed drew, so a food site drawing the
      editorial rhythm buried its menu behind three blocks of prose. The rhythm
      still decides the page's intention; these two decide what may never be
      displaced by it.
    */
    const BEFORE_FEATURES = {
      food: ['table', 'menu', 'gallery'],
      trade: ['stats', 'testimonials'],
      professional: ['stats', 'testimonials'],
      home: ['stats', 'testimonials']
    };
    const familyKey = NICHE_FAMILY[String(src.nicheId || '').trim()] || String(src.typeId || '').trim();
    const priority = BEFORE_FEATURES[familyKey] || [];
    const fi = ordered.indexOf('features');
    if (fi !== -1) {
      const move = priority.filter((t) => ordered.indexOf(t) > fi)[0];
      if (move) {
        const trimmed = ordered.filter((t) => t !== move);
        trimmed.splice(trimmed.indexOf('features'), 0, move);
        ordered = trimmed;
      }
    }
    const len = rhythm.length || [6, 9];
    const cap = Number(src.cap) || 0;               // tier ceiling, when the caller has one
    const max = Math.min(len[1], cap || 99);
    const min = Math.min(len[0], max);
    // A page is trimmed from the middle: the lead block and the tail are the two
    // decisions the rhythm exists to make, so they are the last to go.
    if (ordered.length > max) {
      const head = ordered.slice(0, 2);
      const tail = ordered.slice(-2);
      const middle = ordered.slice(2, -2);
      while (head.length + middle.length + tail.length > max && middle.length) {
        middle.pop();
      }
      ordered = head.concat(middle, tail);
    }
    if (ordered.length < min) {
      // Nothing to add that the business has not got — a short page is better
      // than a padded one, so the range is a preference and not a quota.
      ordered = ordered.slice();
    }
    ordered = ordered.filter((t, i) => ordered.indexOf(t) === i);

    const layouts = {};
    ordered.forEach((type) => {
      const pool = (rhythm.layouts && rhythm.layouts[type]) || null;
      if (pool && pool.length) layouts[type] = pick(seed, 'layout:' + rhythm.id + ':' + type, pool);
      else if (ALL_LAYOUTS[type]) layouts[type] = pick(seed, 'layout:' + type, ALL_LAYOUTS[type]);
    });

    return {
      id: rhythm.id,
      order: ordered,
      layouts,
      dropped: available.filter((t) => ordered.indexOf(t) === -1)
    };
  }

  return { RHYTHMS, FIT, ALL_LAYOUTS, NICHE_FAMILY, plan, choose, order, rhythmList, mix };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AiRhythm;

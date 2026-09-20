'use strict';

// ============================================================
// PallettAI Studio — Meaning
// One small vector space that every "is this the right one?" question in the
// studio can ask: which photo matches the brief, which saved project is the one
// the client meant, which starter is closest to this job.
//
// WHAT THIS IS, HONESTLY
// ---------------------
// This is not a neural embedding. It is a hashed, IDF-weighted lexical space
// with a curated concept layer on top, and that choice is deliberate:
//
//   · it is offline — no model, no download, no network, no key, which is the
//     promise the rest of Studio makes;
//   · it is deterministic — the same text always yields the same vector, so a
//     ranking can be asserted in a smoke test and quoted in a UI tooltip;
//   · it is small — a few kilobytes of tables rather than a 100 MB download.
//
// The concept layer is what makes it behave like more than keyword matching:
// "barber", "hairdresser" and "salon" all carry the same concept feature, so a
// query about a barber can rank a barbershop photo whose title never says
// "barber". It is a bias, not a substitute for a real model, and it is weighted
// so a literal match still outranks a conceptual one.
//
// THE SEAM
// --------
// `useModel({ name, dim, vector })` swaps the whole engine onto a real encoder
// — CLIP, SigLIP or a sentence transformer running in a worker via
// transformers.js — without touching a single caller. Register it once the
// model is loaded, unregister on failure, and every ranking in the app silently
// gets better. Until then the lexical space is what answers, which is why no
// feature in Studio is ever *blocked* on a model being present.
//
// Loaded as a classic script (a browser global) and required directly under
// Node by the smoke suite, exactly like every other data module here.
// ============================================================

const AiEmbed = (() => {
  /* Vector width. The space is split in two and the halves never meet: the
     concept features get fixed low slots and one slot each, and every real term
     gets its own slot from a dictionary the first time it is seen. That matters
     more than it sounds. An earlier version hashed everything into 384
     dimensions, and "a wood oven" against a wood-fired pizzeria doc scored
     *negative* — two unrelated bigrams had landed on the same slot with opposite
     signs. Now a shared term is a guaranteed contribution, not a coin toss. */
  const DIM = 1024;

  /* Words that carry no signal in a short business prompt. Kept small on
     purpose: an over-eager stop list deletes the nouns that matter. */
  const STOP = {
    a: 1, an: 1, the: 1, and: 1, or: 1, of: 1, for: 1, with: 1, to: 1, in: 1, on: 1, at: 1,
    by: 1, from: 1, as: 1, is: 1, are: 1, was: 1, were: 1, be: 1, been: 1, it: 1, its: 1,
    this: 1, that: 1, these: 1, those: 1, our: 1, your: 1, my: 1, we: 1, you: 1, i: 1,
    me: 1, us: 1, they: 1, them: 1, he: 1, she: 1, his: 1, her: 1, their: 1, there: 1,
    here: 1, what: 1, which: 1, who: 1, when: 1, where: 1, why: 1, how: 1, not: 1, no: 1,
    so: 1, if: 1, but: 1, than: 1, then: 1, too: 1, very: 1, can: 1, will: 1, just: 1,
    about: 1, into: 1, over: 1, up: 1, out: 1, do: 1, does: 1, did: 1, has: 1, have: 1,
    had: 1, get: 1, got: 1, make: 1, made: 1, want: 1, need: 1, like: 1, some: 1, any: 1,
    all: 1, more: 1, most: 1, other: 1, new: 1, one: 1, two: 1, also: 1, really: 1
  };

  /* ------------- the concept layer -------------
     Each concept is a bucket of words that mean the same thing to a website
     brief. Drawn from the niches the generator already knows (see the NICHES
     table in ai.js) so the vocabulary matches what clients actually type.

     Every trigger word maps to exactly one concept, and the concept feature is
     weighted below a literal term so precision is never traded for recall. */
  const CONCEPTS = {
    hair: ['barber', 'barbershop', 'hairdresser', 'hairdressing', 'salon', 'hairs', 'fade', 'beard', 'grooming', 'colour'],
    beauty: ['nails', 'nail', 'manicure', 'pedicure', 'lashes', 'brows', 'spa', 'massage', 'facial', 'waxing', 'skin'],
    pizza: ['pizza', 'pizzeria', 'neapolitan', 'margherita', 'calzone', 'italian', 'trattoria'],
    baked: ['bakery', 'baker', 'bread', 'pastry', 'pastries', 'croissant', 'dough', 'sourdough', 'cake', 'cakes', 'patisserie', 'baked', 'loaf'],
    coffee: ['coffee', 'espresso', 'latte', 'barista', 'roastery', 'roaster', 'cafe', 'café', 'brew', 'beans'],
    drink: ['pub', 'pint', 'beer', 'ale', 'lager', 'cider', 'wine', 'gin', 'cocktail', 'cocktails', 'taproom', 'brewery', 'brewhouse', 'keg', 'cellar'],
    food: ['restaurant', 'kitchen', 'chef', 'menu', 'dish', 'dishes', 'cuisine', 'dining', 'takeaway', 'catering', 'food', 'eatery', 'bistro', 'grill', 'roast', 'sunday'],
    trade: ['plumber', 'plumbing', 'electrician', 'electrical', 'locksmith', 'heating', 'boiler', 'drain', 'gas', 'roofing', 'roofer', 'builders', 'builder', 'joinery', 'carpenter', 'handyman', 'glazing'],
    auto: ['garage', 'mechanic', 'mot', 'tyres', 'tire', 'car', 'vehicle', 'valeting', 'servicing', 'motor', 'automotive'],
    garden: ['garden', 'gardening', 'landscaper', 'landscaping', 'lawn', 'fencing', 'patio', 'trees', 'tree', 'horticulture'],
    health: ['dentist', 'dental', 'vet', 'veterinary', 'physio', 'physiotherapy', 'chiropractor', 'clinic', 'doctor', 'surgery', 'optician', 'podiatry'],
    legal: ['solicitor', 'lawyer', 'legal', 'conveyancing', 'wills', 'probate', 'barrister', 'advocate'],
    money: ['accountant', 'accounting', 'bookkeeping', 'tax', 'payroll', 'bookkeeper', 'financial', 'mortgage', 'broker'],
    property: ['estate', 'letting', 'lettings', 'realtor', 'property', 'landlord', 'mortgage', 'surveyor', 'agent'],
    build: ['construction', 'renovation', 'refurbishment', 'extension', 'loft', 'conversion', 'fitter', 'fitting', 'kitchen', 'bathroom'],
    fitness: ['gym', 'fitness', 'pt', 'trainer', 'crossfit', 'yoga', 'pilates', 'bootcamp', 'strength', 'classes', 'weights', 'treadmill', 'cardio', 'dumbbell', 'kettlebell', 'lifting', 'workout', 'spin', 'boxing'],
    creative: ['photographer', 'photography', 'designer', 'design', 'studio', 'branding', 'illustrator', 'videographer', 'film', 'tattoo', 'tattoos'],
    event: ['wedding', 'events', 'venue', 'catering', 'party', 'celebrant', 'florist', 'flowers', 'bouquet', 'marquee'],
    retail: ['shop', 'store', 'boutique', 'clothing', 'fashion', 'jewellery', 'jewelry', 'gifts', 'retail', 'stockist', 'wholesale', 'market'],
    hosting: ['bnb', 'hotel', 'guesthouse', 'cottage', 'lodging', 'accommodation', 'rental', 'holiday', 'camping', 'glamping'],
    education: ['tutor', 'tutoring', 'school', 'course', 'training', 'academy', 'lessons', 'nursery', 'childcare', 'coaching'],
    tech: ['software', 'app', 'development', 'developer', 'it', 'support', 'saas', 'automation', 'bots', 'telegram', 'data', 'cloud'],
    care: ['cleaning', 'cleaner', 'care', 'carer', 'support', 'wellbeing', 'counselling', 'therapy', 'therapist'],
    pet: ['pet', 'pets', 'groomers', 'dog', 'dogs', 'kennels', 'cattery', 'walking', 'boarding'],
    interior: ['interior', 'fitout', 'furniture', 'joinery', 'decor', 'curtains', 'flooring', 'upholstery', 'blinds'],
    photo: ['photo', 'photos', 'photograph', 'image', 'images', 'picture', 'portrait', 'headshot', 'shot', 'shots'],
    place: ['nearby', 'local', 'area', 'town', 'village', 'county', 'midlands', 'city', 'region'],
    premium: ['luxury', 'premium', 'bespoke', 'handmade', 'artisan', 'boutique', 'exclusive', 'high-end'],
    family: ['family', 'independent', 'friendly', 'welcoming', 'community', 'local', 'trusted', 'established'],
    modern: ['modern', 'contemporary', 'minimal', 'clean', 'sleek', 'bold', 'fresh', 'bright'],
    cosy: ['cosy', 'cozy', 'warm', 'rustic', 'homely', 'quaint', 'intimate', 'traditional']
  };

  const TERM_CONCEPT = {};

  /* ------------- concept slots -------------
     Fixed, sorted, and assigned once at load: a concept feature is always at the
     same index in every vector this process ever builds, so a stored vector from
     earlier in the session still lines up. */
  const CONCEPT_NAMES = Object.keys(CONCEPTS).sort();
  const CONCEPT_SLOT = {};
  CONCEPT_NAMES.forEach((name, i) => { CONCEPT_SLOT[name] = i; });
  const TERM_BASE = CONCEPT_NAMES.length;      /* real terms start here */

  /* ------------- text → terms ------------- */

  function stem(word) {
    if (word.length > 4 && /ies$/.test(word)) return word.slice(0, -3) + 'y';
    if (word.length > 4 && /(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
    if (word.length > 4 && /ing$/.test(word)) return word.slice(0, -3);
    if (word.length > 3 && /ed$/.test(word)) return word.slice(0, -2);
    if (word.length > 3 && /s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
    return word;
  }

  /* Reverse map: every trigger word to its concept, keyed by both the word as
     written and its stem, so "pizzas" finds the pizza bucket and "café" is not
     lost to accent stripping. Built here because `stem` is hoisted above. */
  CONCEPT_NAMES.forEach((concept) => {
    CONCEPTS[concept].forEach((word) => {
      if (!TERM_CONCEPT[word]) TERM_CONCEPT[word] = concept;
      const s = stem(word);
      if (!TERM_CONCEPT[s]) TERM_CONCEPT[s] = concept;
    });
  });

  /* Terms, in order, with their type. Bigrams keep "wood fired" from being
     the same thing as "fired wood", which a bag of unigrams cannot tell apart. */
  function terms(text) {
    const raw = String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ');
    const words = [];
    raw.forEach((word) => {
      if (!word || STOP[word]) return;
      const s = stem(word);
      if (s.length < 3) return;
      words.push({ word: s, original: word });
    });
    const out = [];
    words.forEach((w) => out.push({ term: w.word, type: 'uni', original: w.original }));
    /* A five-letter prefix feature is how "pizza" finds "pizzeria" and
       "photographer" finds "photography" without a stemmer that would have to
       know English. It is a weak feature (see the type weights) because it is a
       guess: it links real derivations most of the time and, occasionally,
       "trainer" to "training" when the user meant neither. */
    words.forEach((w) => {
      if (w.word.length >= 5) out.push({ term: 'p:' + w.word.slice(0, 5), type: 'pre', original: w.original });
    });
    for (let i = 0; i < words.length - 1; i++) {
      out.push({ term: words[i].word + ' ' + words[i + 1].word, type: 'bi', original: words[i].original + ' ' + words[i + 1].original });
    }
    /* Concept features: added once per concept, not once per mention, so saying
       "hair" three times does not outvote three separate real nouns. */
    const seen = {};
    words.forEach((w) => {
      const c = TERM_CONCEPT[w.original] || TERM_CONCEPT[w.word];
      if (!c || seen[c]) return;
      seen[c] = 1;
      out.push({ term: '#' + c, type: 'concept', concept: c, original: w.original });
    });
    return out;
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /* Every real term gets a stable slot the first time it is seen. A term that
     repeats, or appears in a thousand documents, always lands in the same place;
     only the overflow of a very large vocabulary falls back to hashing. */
  const slots = new Map();

  function slotOf(term, type) {
    if (type === 'concept') {
      const c = CONCEPT_SLOT[term.slice(1)];
      return c == null ? DIM - 1 : c;
    }
    let slot = slots.get(term);
    if (slot != null) return slot;
    slot = TERM_BASE + slots.size;
    if (slot >= DIM) slot = TERM_BASE + (hash(term) % (DIM - TERM_BASE));
    slots.set(term, slot);
    return slot;
  }

  function norm(v) {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    const len = Math.sqrt(sum);
    if (!len) return v;
    for (let i = 0; i < v.length; i++) v[i] /= len;
    return v;
  }

  /* Inverse document frequency, learned from the studio's own corpus rather
     than guessed. Until fit() is called every term counts equally, which is the
     right default for a single short query against a single short title. */
  let idf = null;
  let idfMax = 0;
  let idfDocs = 0;

  function fit(texts) {
    const docs = Array.isArray(texts) ? texts : [];
    const df = new Map();
    let n = 0;
    docs.forEach((doc) => {
      const seen = new Set();
      terms(doc).forEach((t) => { if (!seen.has(t.term)) { seen.add(t.term); df.set(t.term, (df.get(t.term) || 0) + 1); } });
      if (seen.size) n++;
    });
    idf = new Map();
    df.forEach((count, term) => idf.set(term, Math.log(1 + n / (1 + count))));
    /* A term the corpus has never seen is the rarest thing there is, so it takes
       the corpus's own maximum weight. Reading it as 1 would quietly say "as
       common as everything else" and let a fitted corpus demote the exact word
       the user just typed. */
    idfMax = n ? Math.log(1 + n) : 1;
    idfDocs = n;
    return { docs: n, terms: idf.size };
  }

  function weightOf(term, count) {
    const tf = 1 + Math.log(count);
    const w = idf ? (idf.has(term) ? idf.get(term) : idfMax) : 1;
    return tf * (w <= 0 ? 0.15 : w);
  }

  /* ------------- the model seam ------------- */

  let backend = null;
  let backendFails = 0;

  function useModel(model) {
    backend = (model && typeof model.vector === 'function') ? model : null;
    return backend ? { name: backend.name || 'model', dim: backend.dim || null } : null;
  }

  function modelInfo() {
    return backend ? { name: backend.name || 'model', dim: backend.dim || null } : null;
  }

  /* ------------- vector ------------- */

  /* The weight a feature carries, before it is placed in the vector. Kept in one
     place so the vector and the coverage measure can never disagree about how
     much a word is worth. */
  const TYPE_WEIGHT = { uni: 1, pre: 0.6, concept: 0.55, bi: 1.15 };

  /* feature → weight, counting each term once. */
  function features(text) {
    const counts = new Map();
    terms(text).forEach((t) => {
      const rec = counts.get(t.term);
      if (rec) { rec.n++; return; }
      counts.set(t.term, { n: 1, type: t.type });
    });
    const out = new Map();
    counts.forEach((rec, term) => {
      out.set(term, { type: rec.type, w: weightOf(term, rec.n) * (TYPE_WEIGHT[rec.type] || 1) });
    });
    return out;
  }

  /* The one place text becomes a vector, and the one place that records *how*.
     A caller that mixes a model vector with a lexical one would be comparing
     apples to oranges, so the source travels with the vector instead of being
     guessed from whichever backend happens to be registered right now. */
  /* The lexical half of encode(), isolated so the blend can rebuild a pure
     lexical score without re-asking the model. */
  function lexicalVector(str) {
    const v = new Float32Array(DIM);
    features(str).forEach((rec, term) => {
      v[slotOf(term, rec.type)] += rec.w;
    });
    return norm(v);
  }

  function encode(text) {
    const str = String(text == null ? '' : text);
    if (backend) {
      try {
        const v = backend.vector(str);
        if (v && v.length) return { v: norm(Float32Array.from(v)), via: 'model' };
      } catch (e) {
        /* A backend that throws mid-session must not take the feature down with
           it; falling through keeps every caller working. Counted so stats() can
           report how often the model had to sit a question out. */
        backendFails = Math.min(backendFails + 1, 1e9);
      }
    }
    return { v: lexicalVector(str), via: 'lexical' };
  }

  function vector(text) {
    return encode(text).v;
  }

  function similarity(a, b) {
    if (!a || !b || !a.length || !b.length) return 0;
    if (a.length !== b.length) return 0;
    return dot(a, b);
  }

  function dot(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  }

  /* What share of the query's own weight the item actually carries, ignoring
     how long the item is. Cosine alone punishes a title for being informative:
     a twelve-word pizzeria strapline covered one third of "italian pizza oven"
     and scored below the threshold, while a three-word doc with one stray
     overlap outranked it. Coverage is the half that fixes that, and it is the
     half a person would call "it's about what I searched for". */
  function coverage(qFeatures, f) {
    let total = 0;
    let found = 0;
    qFeatures.forEach((rec, term) => {
      total += rec.w;
      if (f.has(term)) found += rec.w;
    });
    return total ? found / total : 0;
  }

  function textOf(item, opts) {
    if (opts && typeof opts.text === 'function') return String(opts.text(item) || '');
    if (item == null) return '';
    if (typeof item === 'string') return item;
    return [item.title, item.name, item.text, item.hint, item.keywords, item.body, item.area]
      .filter(Boolean).join(' ');
  }

  /* Which of the query's words the item actually shares, for the "why did you
     pick this" line. Concept hits quote the item's own word, so the sentence
     reads like English instead of like a tag list. */
  function why(query, text, limit) {
    const q = terms(query);
    const item = terms(text);
    const qTerms = new Set();
    const qConcepts = new Set();
    q.forEach((t) => { if (t.type === 'concept') qConcepts.add(t.concept); else qTerms.add(t.term); });
    const out = [];
    const push = (word) => {
      const w = String(word || '').trim();
      if (!w || out.indexOf(w) !== -1) return;
      out.push(w);
    };
    item.forEach((t) => {
      if (out.length >= (limit || 4)) return;
      if (t.type === 'concept') {
        if (qConcepts.has(t.concept)) push(t.original);
        return;
      }
      if (qTerms.has(t.term)) push(t.original.replace(/^#/, ''));
    });
    q.forEach((t) => {
      if (out.length >= (limit || 4)) return;
      if (t.type === 'concept' && item.some((i) => i.type === 'concept' && i.concept === t.concept)) push(t.concept);
    });
    return out;
  }

  /* ------------- rank -------------
     Returns every item that shares anything with the query, best first, each
     carrying the score and the words that earned it. `min` defaults to a small
     positive number rather than 0 so a single stray concept match does not fill
     the list with noise. */
  /* 0.55 / 0.45: similarity decides between two items that are both about the
     query, coverage decides whether the item is about the query at all. */
  const W_SIM = 0.55;
  const W_COV = 0.45;

  /* With a real encoder, cosine is already a good measure of "about the same
     thing" and lexical coverage would only drag it back down to the words both
     happened to share — so coverage is for the lexical path alone. */
  function blend(a, b, query, text) {
    const sameSpace = a.v.length === b.v.length;
    const cos = sameSpace ? dot(a.v, b.v) : 0;
    if (a.via === 'model' && b.via === 'model') return sameSpace ? cos : 0;
    if (a.via === 'model' || b.via === 'model') {
      /* A real encoder lives in its own dimension (384 for MiniLM, not this
         engine's 1024), so a model vector and a lexical vector can never be
         compared directly — different widths would score zero, and same-width
         vectors from different spaces would be apples to oranges. When only one
         side came from the model (a cache miss, a failure), score the pair the
         way the lexical engine alone would have, exactly — never as a zero. */
      return W_SIM * dot(lexicalVector(query), lexicalVector(text))
        + W_COV * coverage(features(query), features(text));
    }
    return W_SIM * cos + W_COV * coverage(features(query), features(text));
  }

  function score(query, text) {
    const q = String(query == null ? '' : query);
    if (!q.trim()) return 0;
    return Math.round(blend(encode(q), encode(text), q, text) * 10000) / 10000;
  }

  function rank(query, items, opts) {
    const o = opts || {};
    const list = Array.isArray(items) ? items : [];
    const q = String(query == null ? '' : query).trim();
    if (!q || !list.length) return [];
    const qv = encode(q);
    const out = [];
    list.forEach((item, index) => {
      const text = textOf(item, o);
      const b = encode(text);
      if (!b.v.some((x) => x)) return;
      const rounded = Math.round(blend(qv, b, q, text) * 10000) / 10000;
      if (rounded < (o.min == null ? 0.04 : o.min)) return;
      out.push({ index, item, score: rounded, why: why(q, text, o.why) });
    });
    out.sort((a, b) => b.score - a.score);
    return o.limit ? out.slice(0, o.limit) : out;
  }

  return {
    DIM,
    CONCEPT_SLOT,
    CONCEPTS,
    terms,
    vector,
    similarity,
    score,
    rank,
    why,
    fit,
    useModel,
    modelInfo,
    stats: () => ({ docs: idfDocs, terms: idf ? idf.size : 0, model: modelInfo(), modelFails: backendFails })
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AiEmbed;

'use strict';

const PROOF_NICHES = {
  plumber: 1, electrician: 1, solicitor: 1, dentist: 1, accountant: 1,
  garage: 1, locksmith: 1, vet: 1, physio: 1, landscaper: 1, tutor: 1
};
const MENU_NICHES = {
  pizzeria: 1, coffee: 1, bakery: 1, burger: 1, japanese: 1, indian: 1,
  mexican: 1, steakhouse: 1, pub: 1, winebar: 1, brewery: 1, catering: 1
};
const GALLERY_NICHES = {
  hair: 1, barber: 1, nails: 1, spa: 1, florist: 1, boutique: 1,
  wedding: 1, photography: 1, tattoo: 1, interior: 1
};

// Each recipe carries three layout variants so the same trade can come out with
// a different hero, a different feature treatment and a different gallery — the
// seed (not luck) decides which. Only free-tier catalog variants are used here.
const RECIPES = {
  'menu-first': {
    order: ['table', 'gallery', 'about', 'features', 'stats', 'testimonials', 'faq', 'pricing'],
    layouts: [
      { hero: 'split', gallery: 'mosaic', features: 'numbered' },
      { hero: 'minimal', gallery: 'mosaic', about: 'left' },
      { hero: '', gallery: 'mosaic', features: 'strip', table: 'compare', faq: 'columns' }
    ],
    titles: { gallery: 'On the pass', testimonials: 'Regulars', stats: 'In the kitchen' }
  },
  'gallery-forward': {
    order: ['gallery', 'features', 'about', 'testimonials', 'stats', 'faq', 'pricing'],
    layouts: [
      { hero: 'split', gallery: 'mosaic', features: 'numbered' },
      { hero: 'minimal', gallery: 'mosaic', about: 'floating' },
      { hero: '', gallery: 'mosaic', features: 'strip', about: 'left', faq: 'columns' }
    ],
    titles: { gallery: 'Recent work', testimonials: 'Clients', features: 'What we do' }
  },
  'proof-first': {
    order: ['stats', 'testimonials', 'features', 'about', 'faq', 'pricing', 'gallery'],
    layouts: [
      { hero: 'split', stats: 'band', features: 'strip' },
      { hero: 'split', testimonials: 'featured', features: 'strip' },
      { hero: 'minimal', stats: 'band', features: 'numbered', testimonials: '' }
    ],
    titles: { stats: 'Why people call', testimonials: 'Nearby clients', features: 'The job' }
  },
  'product': {
    order: ['features', 'stats', 'about', 'testimonials', 'faq', 'pricing', 'gallery'],
    layouts: [
      { hero: 'split', features: 'bento', stats: 'band' },
      { hero: 'terminal', features: 'bento', stats: 'band' },
      { hero: 'minimal', features: 'strip', stats: 'band', pricing: 'stacked', faq: 'columns' }
    ],
    titles: { features: 'Product', stats: 'In production' }
  },
  energy: {
    order: ['stats', 'gallery', 'features', 'about', 'testimonials', 'faq', 'pricing'],
    layouts: [
      { hero: 'split', stats: 'band', gallery: 'mosaic' },
      { hero: 'split', features: 'bento', gallery: 'mosaic' },
      { hero: 'terminal', stats: 'band', gallery: 'mosaic', features: 'strip' }
    ],
    titles: { stats: 'The work', gallery: 'In session' }
  },
  quiet: {
    order: ['about', 'features', 'testimonials', 'gallery', 'stats', 'faq', 'pricing'],
    layouts: [
      { hero: 'minimal', about: 'floating', features: 'numbered' },
      { hero: 'split', about: 'left', testimonials: 'masonry' },
      { hero: '', about: '', features: 'strip', gallery: 'mosaic' }
    ],
    titles: { about: 'The story', testimonials: 'People we help' }
  }
};

const TYPE_FAMILY = {
  food: 'menu-first', beauty: 'gallery-forward', retail: 'gallery-forward',
  events: 'gallery-forward', creative: 'gallery-forward',
  tech: 'product', edu: 'product',
  fitness: 'energy', music: 'energy', auto: 'energy',
  home: 'proof-first', generic: 'quiet', nonprofit: 'quiet', travel: 'gallery-forward'
};

function familyFor(typeId, nicheId) {
  const niche = String(nicheId || '');
  if (PROOF_NICHES[niche]) return 'proof-first';
  if (MENU_NICHES[niche]) return 'menu-first';
  if (GALLERY_NICHES[niche]) return 'gallery-forward';
  return TYPE_FAMILY[typeId] || 'quiet';
}

// Keep the two signature blocks pinned, then let the seed shuffle the rest so
// two sites for the same trade never share one section flow.
const ANCHORS = 2;

function seededShuffle(arr, seed) {
  const out = Array.isArray(arr) ? arr.slice() : [];
  let s = (Math.abs(Number(seed) || 0) || 1) >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

function orderSections(sections, preferred, seed) {
  const list = Array.isArray(sections) ? sections.slice() : [];
  const hero = [];
  const mid = [];
  const tail = [];
  list.forEach((sec) => {
    if (!sec) return;
    if (sec.type === 'hero') hero.push(sec);
    else if (sec.type === 'cta' || sec.type === 'contact') tail.push(sec);
    else mid.push(sec);
  });
  const rank = {};
  (preferred || []).forEach((type, i) => { if (rank[type] == null) rank[type] = i; });
  const rankOf = (t) => (rank[t] == null ? 80 : rank[t]);
  const ordered = mid.slice().sort((a, b) => rankOf(a.type) - rankOf(b.type));
  const tailRank = (t) => (t === 'cta' ? 0 : t === 'contact' ? 1 : 2);
  tail.sort((a, b) => tailRank(a.type) - tailRank(b.type));

  let middle = ordered;
  if (Number.isFinite(seed) && ordered.length > ANCHORS + 1) {
    const lead = ordered.slice(0, ANCHORS);
    const rest = ordered.slice(ANCHORS);
    const half = Math.ceil(rest.length / 2);
    // two rough bands: the recipe's own narrative survives, the order doesn't.
    middle = lead.concat(
      seededShuffle(rest.slice(0, half), seed + 17),
      seededShuffle(rest.slice(half), seed + 101)
    );
  }
  return hero.concat(middle).concat(tail);
}

// Which sections a site ships at all. Generation used to hand every business
// the same ten blocks; these are the ones a site can happily live without, so
// the seed can drop a few and give each build its own shape.
const OPTIONAL_SECTIONS = ['pricing', 'faq', 'stats', 'testimonials', 'gallery'];
// Never dropped: the page's spine, the family's signature blocks, and the
// niche's own sections (a pizzeria without its menu is not a pizzeria).
const CORE_SECTIONS = ['hero', 'about', 'features', 'cta', 'contact', 'table'];
const DROP_ONE_IN = 5;

// FNV-1a with a final avalanche. The avalanche matters: plain FNV is
// parity-preserving, so `% 2` on keys that end in an odd character (every
// "add:" key does) came out identical and the add-bits were perfectly
// correlated — a site either gained every optional section or none.
function mixSeed(seed, key) {
  let h = (Number(seed) || 0) >>> 0;
  const s = String(key || '');
  for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 16777619)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function protectedFor(family) {
  const recipe = RECIPES[family] || RECIPES.quiet;
  return new Set(CORE_SECTIONS.concat((recipe.order || []).slice(0, 3)));
}

// Sections a business type can gain. The copy bank can fill every one of these,
// so nothing ever ships empty — a generic brief used to top out at the same
// seven blocks forever.
const EXTRA_SECTIONS = {
  food:      ['gallery', 'faq', 'pricing'],
  retail:    ['pricing', 'faq', 'stats'],
  beauty:    ['pricing', 'faq', 'stats'],
  fitness:   ['pricing', 'faq', 'gallery'],
  travel:    ['pricing', 'faq', 'stats'],
  events:    ['faq', 'pricing', 'stats'],
  creative:  ['pricing', 'faq', 'stats'],
  home:      ['faq', 'gallery', 'pricing'],
  auto:      ['faq', 'pricing', 'testimonials'],
  music:     ['faq', 'pricing', 'gallery'],
  tech:      ['faq', 'gallery'],
  edu:       ['faq', 'gallery'],
  nonprofit: ['faq', 'stats', 'gallery'],
  generic:   ['gallery', 'faq', 'pricing']
};
const ADD_ONE_IN = 2;    // each candidate section lands about half the time
const FREE_SECTION_CAP = 10; // the free tier's sections-per-site ceiling
const MAX_PRACTICAL = 12;    // and a ceiling for everyone, so sites stay tight

// Add the sections that suit this trade but aren't in its base flow yet.
// Returns { names, added } so the caller can protect what it just added.
function varyNames(names, opts) {
  const src = opts || {};
  const list = Array.isArray(names) ? names.slice() : [];
  const added = [];
  if (src.enabled === false) return { names: list, added };
  // sections the caller still has to add (a niche's own menu, say) count
  // against the ceiling, so nothing lands over the free tier's limit
  const cap = (src.tier === 'free' ? FREE_SECTION_CAP : MAX_PRACTICAL) - (Number(src.reserve) || 0);
  const seed = Number(src.seed) || 0;
  const candidates = EXTRA_SECTIONS[src.typeId] || [];
  candidates.forEach((type) => {
    if (list.length >= cap || list.indexOf(type) !== -1) return;
    if (mixSeed(seed, 'add:' + type) % ADD_ONE_IN !== 0) return;
    list.push(type);
    added.push(type);
  });
  return { names: list, added };
}

function varyPresence(sections, opts) {
  const src = opts || {};
  const list = Array.isArray(sections) ? sections : [];
  if (src.enabled === false) return list;
  const family = src.family || familyFor(src.typeId, src.nicheId);
  const keep = protectedFor(family);
  (src.keep || []).forEach((t) => keep.add(t));
  const seed = Number(src.seed) || 0;
  return list.filter((sec) => {
    if (!sec || keep.has(sec.type)) return true;
    if (OPTIONAL_SECTIONS.indexOf(sec.type) === -1) return true;
    return mixSeed(seed, sec.type) % DROP_ONE_IN !== 0;
  });
}

function validLayout(type, id) {
  if (typeof DB === 'undefined' || typeof DB.layoutsFor !== 'function') return true;
  const variants = DB.layoutsFor(type) || [];
  if (!variants.length) return true;
  return variants.some((v) => v.id === id);
}

function applyCompose(project, opts) {
  const src = opts || {};
  if (!project || !project.site) return project;
  const family = familyFor(src.typeId, src.nicheId);
  const recipe = RECIPES[family] || RECIPES.quiet;
  const seed = Number(src.seed) || 0;
  const variant = Math.abs(seed) % recipe.layouts.length;
  const layouts = recipe.layouts[variant] || recipe.layouts[0];
  const photoLed = src.photoMode !== 'none' && src.photoMode !== 'ai';
  const classic = src.layouts === 'classic';

  const restyle = (sections) => {
    let list = orderSections(sections, recipe.order, seed);
    if (!classic && layouts) {
      Object.keys(layouts).forEach((type) => {
        const layout = layouts[type];
        const sec = list.find((s) => s && s.type === type);
        if (!sec || !validLayout(type, layout)) return;
        sec.layout = layout;
      });
    }
    const hero = list.find((s) => s && s.type === 'hero');
    if (hero && photoLed && hero.layout === 'aurora') hero.layout = 'split';
    if (hero && hero.layout === 'terminal' && (src.typeId === 'food' || src.typeId === 'beauty' || src.typeId === 'retail')) {
      hero.layout = 'split';
    }
    if (!classic && recipe.titles) {
      Object.keys(recipe.titles).forEach((type) => {
        const sec = list.find((s) => s && s.type === type);
        if (sec && recipe.titles[type]) sec.title = recipe.titles[type];
      });
    }
    return list;
  };

  const site = project.site;
  if (Array.isArray(site.pages) && site.pages.length) {
    const home = site.pages.find((p) => p && p.slug === 'index') || site.pages[0];
    if (home) {
      home.sections = restyle(home.sections);
      if (!site.activePageId || site.activePageId === home.id) site.sections = home.sections;
    }
  } else {
    site.sections = restyle(site.sections);
  }
  site.compose = { family, variant, at: Date.now() };
  project.aiFamily = family;
  return project;
}

const AiCompose = {
  familyFor, orderSections, seededShuffle, applyCompose, RECIPES, ANCHORS,
  varyPresence, varyNames, protectedFor,
  OPTIONAL_SECTIONS, CORE_SECTIONS, EXTRA_SECTIONS
};
if (typeof module !== 'undefined' && module.exports) module.exports = AiCompose;

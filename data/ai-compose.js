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

const RECIPES = {
  'menu-first': {
    order: ['table', 'gallery', 'about', 'features', 'stats', 'testimonials', 'faq', 'pricing'],
    layouts: [
      { hero: 'split', gallery: 'mosaic', features: 'numbered' },
      { hero: 'minimal', gallery: 'mosaic', about: 'left' }
    ],
    titles: { gallery: 'On the pass', testimonials: 'Regulars', stats: 'In the kitchen' }
  },
  'gallery-forward': {
    order: ['gallery', 'features', 'about', 'testimonials', 'stats', 'faq', 'pricing'],
    layouts: [
      { hero: 'split', gallery: 'mosaic', features: 'numbered' },
      { hero: 'minimal', gallery: 'mosaic', about: 'floating' }
    ],
    titles: { gallery: 'Recent work', testimonials: 'Clients', features: 'What we do' }
  },
  'proof-first': {
    order: ['stats', 'testimonials', 'features', 'about', 'faq', 'pricing', 'gallery'],
    layouts: [
      { hero: 'split', stats: 'band', features: 'strip' },
      { hero: 'split', testimonials: 'featured', features: 'strip' }
    ],
    titles: { stats: 'Why people call', testimonials: 'Nearby clients', features: 'The job' }
  },
  'product': {
    order: ['features', 'stats', 'about', 'testimonials', 'faq', 'pricing', 'gallery'],
    layouts: [
      { hero: 'split', features: 'bento', stats: 'band' },
      { hero: 'terminal', features: 'bento', stats: 'band' }
    ],
    titles: { features: 'Product', stats: 'In production' }
  },
  energy: {
    order: ['stats', 'gallery', 'features', 'about', 'testimonials', 'faq', 'pricing'],
    layouts: [
      { hero: 'split', stats: 'band', gallery: 'mosaic' },
      { hero: 'split', features: 'bento', gallery: 'mosaic' }
    ],
    titles: { stats: 'The work', gallery: 'In session' }
  },
  quiet: {
    order: ['about', 'features', 'testimonials', 'gallery', 'stats', 'faq', 'pricing'],
    layouts: [
      { hero: 'minimal', about: 'floating', features: 'numbered' },
      { hero: 'split', about: 'left', testimonials: 'masonry' }
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

function orderSections(sections, preferred) {
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
  mid.sort((a, b) => {
    const ra = rank[a.type] == null ? 80 : rank[a.type];
    const rb = rank[b.type] == null ? 80 : rank[b.type];
    return ra - rb;
  });
  const tailRank = (t) => (t === 'cta' ? 0 : t === 'contact' ? 1 : 2);
  tail.sort((a, b) => tailRank(a.type) - tailRank(b.type));
  return hero.concat(mid).concat(tail);
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
  const variant = Math.abs(Number(src.seed) || 0) % recipe.layouts.length;
  const layouts = recipe.layouts[variant] || recipe.layouts[0];
  const photoLed = src.photoMode !== 'none' && src.photoMode !== 'ai';
  const classic = src.layouts === 'classic';

  const restyle = (sections) => {
    let list = orderSections(sections, recipe.order);
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

const AiCompose = { familyFor, orderSections, applyCompose, RECIPES };
if (typeof module !== 'undefined' && module.exports) module.exports = AiCompose;

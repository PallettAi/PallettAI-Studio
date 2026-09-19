/*
  Wrapped in an IIFE on purpose: this loads as a classic script, so every
  top-level `const` here shares the global scope with every other script on the
  page. A duplicate `const` is a SyntaxError that takes the whole file down, and
  a duplicate `function` silently lets the last file to load win. Neither is
  acceptable, so nothing here leaks out except Starters.
*/
(function () {
'use strict';

/*
  ============================================================
  Starters — begin the next project from one you already built
  ------------------------------------------------------------
  A freelancer builds the same site shape for every client: the
  same pages, the same section order, the same look. Both of
  the existing ways to start are wrong.

  Duplicating a finished project carries the LAST client's name,
  phone, address, domain, photos and meta description into the
  new build — and nothing looks empty, so it is only noticed
  when the new client sees the old one's phone number. Starting
  from a built-in template gives a shape that is not theirs, and
  the hour they spent arranging their own pages is paid again.

  A starter is the middle: the structure and the look, with the
  previous client left behind. What deliberately does NOT travel:

    * business name, tagline, contact details, domain, hours,
      schema type, socials, SEO description, analytics id and the
      form endpoint — one business's identity, not a design;
    * the logo;
    * every image, and the copy that came with them.

  "Keep the copy" is offered, because a studio building the same
  kind of site twice may genuinely want their own boilerplate — but
  it is opt-in, so the DEFAULT can never leak a client, and the
  dialog says which one is in force.

  Everything here is pure and takes its clock and its id generator
  as arguments, so the app decides nothing about a starter that a
  test cannot reproduce.
  ============================================================ */

// How many starters one install keeps. Deliberately a small number: a starter
// you cannot recognise by name is worse than starting from a template, and 24
// is more distinct site shapes than any one studio has.
const MAX = 24;

// Free gets none. This is a "your own starting point" feature and its whole
// value is that it is yours, but a free user can already see what one would
// look like — the tier bump that sells it is having built the site they want to
// reuse, which is exactly the moment they cannot. Pro and Pro+ get the shelf.
const LIMITS = { free: 0, pro: MAX, proplus: MAX };

const NAME_MAX = 60;
const TIER_NAMES = { free: 'Free', pro: 'Pro', proplus: 'Pro+' };

// Site fields that identify ONE business, or bind a deployment to a domain.
const IDENTITY = [
  'name', 'tagline', 'eyebrow', 'description', 'email', 'phone', 'address',
  'hours', 'area', 'url', 'metaDescription', 'ogImage', 'logo', 'formEndpoint',
  'chatWidget', 'whatsapp', 'analyticsId', 'schemaType', 'socials', 'social'
];

// Section fields that are copy about one business...
const COPY = ['title', 'subtitle', 'text', 'extra', 'badge'];
// ...and the ones that hold their photo and its description. These are kept
// apart from COPY because they are not wording: a starter that blanked the
// headline but kept the previous client's hero photograph would still be
// publishing the wrong business, and that is the failure this file exists to
// prevent.
const ASSET = ['image', 'alt', 'video', 'poster'];
const ITEM_COPY = ['title', 'text', 'extra', 'tag', 'image', 'alt'];

function cleanName(raw, fallback) {
  const cleaned = String(raw === null || raw === undefined ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  if (cleaned) return cleaned;
  return fallback ? String(fallback).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
}

// An unknown plan is treated as Free, never as unlimited.
function limitFor(planId) {
  const id = String(planId || 'free').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LIMITS, id) ? LIMITS[id] : LIMITS.free;
}

function tierName(planId) {
  const id = String(planId || 'free').toLowerCase();
  return TIER_NAMES[id] || TIER_NAMES.free;
}

/*
  May this install save one more starter? Returns the numbers as well as the
  answer, so the UI never has to guess what to say — a shelf that reports
  "3 of 24" and a refusal that reports "all 24" are the same call.
*/
function canSave(list, planId) {
  const plan = String(planId || 'free').toLowerCase();
  const limit = limitFor(plan);
  const used = Array.isArray(list) ? list.length : 0;
  if (!limit) {
    return { ok: false, used, limit, remaining: 0, plan, message: 'Your own starters are a Pro feature — Pro and Pro+ keep up to ' + MAX + '.' };
  }
  if (used >= limit) {
    return { ok: false, used, limit, remaining: 0, plan, message: 'All ' + limit + ' starter slots are in use. Remove one to save another.' };
  }
  return { ok: true, used, limit, remaining: limit - used, plan, message: '' };
}

/*
  Read one starter back, defensively.

  These live in the same store as everything else and can come back from a
  hand-edited file or a newer build, so every field is checked and a starter
  that cannot produce a page is dropped rather than loaded into the editor as a
  half-built project.
*/
function normalize(starter) {
  if (!starter || typeof starter !== 'object') return null;
  const name = cleanName(starter.name, '');
  if (!name) return null;
  const site = (starter.site && typeof starter.site === 'object') ? starter.site : {};
  const rawPages = Array.isArray(site.pages) ? site.pages : [];
  const pages = rawPages.map((pg) => {
    const page = (pg && typeof pg === 'object') ? pg : {};
    const sections = (Array.isArray(page.sections) ? page.sections : []).filter((sec) => sec && typeof sec === 'object' && typeof sec.type === 'string');
    return {
      name: cleanName(page.name, 'Page'),
      slug: String(page.slug || '').trim() || 'index',
      hidden: page.hidden === true,
      sections: sections.map((sec) => Object.assign({}, sec))
    };
  }).filter((pg) => pg.sections.length);
  if (!pages.length) return null;
  if (!pages.some((pg) => pg.slug === 'index')) pages[0].slug = 'index';
  return {
    id: String(starter.id || ''),
    name: name,
    createdAt: Number(starter.createdAt) || 0,
    keepCopy: starter.keepCopy === true,
    // What the shelf shows without loading anything: a starter is chosen by its
    // shape, so the shape has to be visible in the list.
    site: {
      palette: site.palette,
      font: site.font,
      fontDisplay: site.fontDisplay,
      heroLayout: site.heroLayout,
      design: site.design,
      kernel: site.kernel,
      themeToggle: site.themeToggle,
      navSticky: site.navSticky,
      containerWidth: site.containerWidth,
      pages: pages
    },
    suites: Array.isArray(starter.suites) ? starter.suites.slice() : [],
    stats: {
      pages: pages.length,
      sections: pages.reduce((n, pg) => n + pg.sections.length, 0),
      types: Array.from(new Set(pages.reduce((all, pg) => all.concat(pg.sections.map((s) => s.type)), [])))
    }
  };
}

/*
  Capture a project as a starter.

  opts: { name, keepCopy, id, now }. Returns { ok, starter } or { ok:false, error }.
*/
function fromProject(project, opts) {
  const o = opts || {};
  if (!project || !project.site || typeof project.site !== 'object') {
    return { ok: false, error: 'That project could not be read.' };
  }
  let clone;
  try { clone = JSON.parse(JSON.stringify(project)); }
  catch (e) { return { ok: false, error: 'That project could not be copied.' }; }

  const keep = o.keepCopy === true;
  const site = clone.site;

  // One business's identity never travels, with or without "keep the copy" —
  // that switch is about wording, not about carrying a phone number over.
  IDENTITY.forEach((k) => { delete site[k]; });

  if (!keep) {
    site.pages = (Array.isArray(site.pages) ? site.pages : []).map((pg) => {
      const page = Object.assign({}, pg);
      page.sections = (Array.isArray(pg.sections) ? pg.sections : []).map((sec) => {
        const out = Object.assign({}, sec);
        COPY.forEach((k) => { delete out[k]; });
        ASSET.forEach((k) => { delete out[k]; });
        if (Array.isArray(out.items)) {
          out.items = out.items.map((it) => {
            const card = Object.assign({}, it);
            ITEM_COPY.forEach((k) => { delete card[k]; });
            return card;
          });
        }
        return out;
      });
      return page;
    });
  }

  const name = cleanName(o.name, '') || cleanName(project.name, '') || 'Starter';
  const starter = normalize({
    id: String(o.id || ''),
    name: name,
    createdAt: Number(o.now) || Date.now(),
    keepCopy: keep,
    site: {
      palette: site.palette,
      font: site.font,
      fontDisplay: site.fontDisplay,
      heroLayout: site.heroLayout,
      design: site.design,
      kernel: site.kernel,
      themeToggle: site.themeToggle,
      navSticky: site.navSticky,
      containerWidth: site.containerWidth,
      pages: site.pages
    },
    suites: Array.isArray(clone.suites) ? clone.suites : []
  });
  if (!starter) {
    return { ok: false, error: 'That project has no pages to start from yet — add a hero and a contact section first.' };
  }
  return { ok: true, starter: starter };
}

/*
  Turn a starter into a new project.

  opts: { id, name, now, uid } — uid() is app.js's id generator, so section ids
  are the same kind of id the rest of the app makes. Every section is given a
  fresh id: reusing the stored ones would give two open projects colliding ids,
  which is how a section edit lands in the wrong place after a copy.
*/
function instantiate(starter, opts) {
  const o = opts || {};
  const s = normalize(starter);
  if (!s) return { ok: false, error: 'That starter could not be read.' };
  let counter = 0;
  const uid = typeof o.uid === 'function'
    ? o.uid
    : function () { counter += 1; return 'st_' + Date.now().toString(36) + '_' + counter; };
  const now = Number(o.now) || Date.now();
  const name = cleanName(o.name, '') || cleanName(s.name, '') + ' site';

  const pages = s.site.pages.map((pg, i) => ({
    id: uid(),
    name: pg.name || ('Page ' + (i + 1)),
    slug: pg.slug || 'index',
    hidden: pg.hidden === true,
    sections: pg.sections.map((sec) => Object.assign({}, sec, { id: uid() }))
  }));
  const active = pages.find((pg) => pg.slug === 'index') || pages[0];
  // site.sections stays aliased to the active page's array — the rest of the app
  // mutates either one and expects the other to follow (see Builder.pages).
  const site = {
    name: name,
    palette: s.site.palette || 'midnight',
    font: s.site.font || 'inter',
    pages: pages,
    activePageId: active.id,
    sections: active.sections
  };
  ['fontDisplay', 'heroLayout', 'design', 'kernel', 'themeToggle', 'navSticky', 'containerWidth'].forEach((k) => {
    if (s.site[k] !== undefined && s.site[k] !== null) site[k] = JSON.parse(JSON.stringify(s.site[k]));
  });
  return {
    ok: true,
    project: {
      id: String(o.id || uid()),
      name: name,
      createdAt: now,
      updatedAt: now,
      starterId: s.id || '',
      suites: s.suites.slice(),
      site: site
    }
  };
}

// What the shelf renders, in one call: the starters plus the shelf's own rules.
function report(list, planId) {
  const shelf = canSave(list, planId);
  const items = (Array.isArray(list) ? list : []).map(normalize).filter(Boolean);
  return {
    items: items,
    used: items.length,
    limit: shelf.limit,
    plan: shelf.plan,
    tier: tierName(shelf.plan),
    remaining: shelf.remaining,
    atLimit: !shelf.ok && shelf.limit > 0,
    message: shelf.message
  };
}

const Starters = {
  MAX, LIMITS, NAME_MAX, IDENTITY, COPY, ASSET, ITEM_COPY,
  cleanName, limitFor, tierName, canSave, normalize, fromProject, instantiate, report
};

if (typeof window !== 'undefined') window.Starters = Starters;
if (typeof module !== 'undefined' && module.exports) module.exports = Starters;
})();

'use strict';

// PallettAI Studio — brief to sitemap planner
//
// This is an original, offline implementation of a useful pattern seen in
// structured builders: plan the visitor journey before generating the page.
// It returns data only; it never evaluates prompt text or creates network calls.

const AiSitemap = (() => {
  const LIMITS = Object.freeze({ prompt: 800, pages: 6, sections: 9 });
  const PAGE_TYPES = Object.freeze({
    home: { label: 'Home', purpose: 'orient visitors and make the next action obvious' },
    services: { label: 'Services', purpose: 'explain the offer with enough detail to choose' },
    work: { label: 'Work', purpose: 'show evidence, projects or outcomes' },
    about: { label: 'About', purpose: 'build trust through people, process and context' },
    pricing: { label: 'Pricing', purpose: 'make packages, menus or starting points easy to compare' },
    faq: { label: 'FAQ', purpose: 'resolve the questions that stop people taking action' },
    contact: { label: 'Contact', purpose: 'give visitors a low-friction route to enquire or book' },
    journal: { label: 'Journal', purpose: 'create a living place for insights, news or resources' }
  });
  const FAMILIES = {
    product: ['home', 'services', 'pricing', 'faq', 'contact'],
    creative: ['home', 'work', 'about', 'services', 'contact'],
    food: ['home', 'services', 'about', 'faq', 'contact'],
    local: ['home', 'services', 'about', 'faq', 'contact'],
    trust: ['home', 'about', 'services', 'work', 'contact'],
    education: ['home', 'services', 'about', 'faq', 'contact'],
    editorial: ['home', 'work', 'journal', 'about', 'contact'],
    generic: ['home', 'services', 'about', 'work', 'contact']
  };
  const WORDS = {
    product: ['app', 'software', 'platform', 'saas', 'tool', 'startup', 'digital'],
    creative: ['agency', 'studio', 'photographer', 'designer', 'architect', 'portfolio', 'creative'],
    food: ['cafe', 'café', 'restaurant', 'bakery', 'coffee', 'pizza', 'food', 'bar', 'menu'],
    local: ['local', 'plumber', 'builder', 'salon', 'barber', 'garage', 'dentist', 'clinic'],
    trust: ['law', 'solicitor', 'accountant', 'consultant', 'insurance', 'finance'],
    education: ['course', 'academy', 'school', 'tutor', 'training', 'learn'],
    editorial: ['magazine', 'journal', 'news', 'festival', 'music', 'culture', 'event']
  };
  const SECTION_MAP = {
    home: ['hero', 'features', 'testimonials', 'cta', 'contact'],
    services: ['hero', 'features', 'table', 'faq', 'cta'],
    work: ['hero', 'gallery', 'testimonials', 'stats', 'cta'],
    about: ['hero', 'about', 'stats', 'testimonials', 'contact'],
    pricing: ['hero', 'pricing', 'faq', 'cta', 'contact'],
    faq: ['hero', 'faq', 'contact'],
    contact: ['hero', 'contact', 'faq'],
    journal: ['hero', 'collection', 'about', 'cta']
  };

  function clip(value, max) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || LIMITS.prompt); }
  function hash(value) { let h = 2166136261; for (const ch of String(value || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h >>> 0; }
  function hasAny(text, list) { return list.some((word) => text.indexOf(word) !== -1); }
  function familyFor(prompt, brief) {
    const text = clip([prompt, brief && brief.offer, brief && brief.audience].filter(Boolean).join(' '), LIMITS.prompt).toLowerCase();
    for (const key of Object.keys(WORDS)) if (hasAny(text, WORDS[key])) return key;
    return 'generic';
  }
  function unique(list) { return Array.from(new Set((list || []).filter((x) => PAGE_TYPES[x]))); }
  function page(id, index, family) {
    const spec = PAGE_TYPES[id];
    return { id, slug: id === 'home' ? 'index' : id, name: spec.label, purpose: spec.purpose, order: index, sections: (SECTION_MAP[id] || ['hero', 'contact']).slice(0, LIMITS.sections), family };
  }
  const DIRECTION_RULES = Object.freeze({
    conversion: { label: 'Conversion route', description: 'Put the offer, proof and next action in the shortest useful path.', order: ['home', 'services', 'pricing', 'faq', 'contact'] },
    story: { label: 'Story route', description: 'Let people understand the origin, work and meaning before the invitation.', order: ['home', 'about', 'work', 'journal', 'contact'] },
    proof: { label: 'Proof route', description: 'Lead with evidence, outcomes and reassurance for a cautious visitor.', order: ['home', 'work', 'services', 'about', 'contact'] }
  });
  function buildPlan(prompt, brief, family, ids, seed, direction) {
    const pages = ids.map((id, index) => page(id, index, family));
    const rule = DIRECTION_RULES[direction] || DIRECTION_RULES.conversion;
    const rationale = {
      family,
      direction: direction || 'conversion',
      headline: rule.label + ' for ' + family,
      reason: rule.description,
      signature: ['navigation', family, direction || 'conversion', ids.join('>'), Math.abs(seed) % 7].join(':')
    };
    return { version: 1, source: 'local-sitemap-planner', family, direction: direction || 'conversion', pages, rationale, seed: Math.abs(seed) >>> 0 };
  }
  function plan(input) {
    const src = input || {};
    const prompt = clip(src.prompt, LIMITS.prompt);
    const brief = src.brief && typeof src.brief === 'object' ? src.brief : {};
    const family = familyFor(prompt, brief);
    const base = FAMILIES[family] || FAMILIES.generic;
    const requested = Array.isArray(src.pages) ? unique(src.pages.map((x) => typeof x === 'string' ? x : x && x.id)) : [];
    const seed = Number.isFinite(Number(src.seed)) ? Number(src.seed) : hash(prompt + JSON.stringify(brief));
    const makeIds = (direction) => {
      const rule = DIRECTION_RULES[direction] || DIRECTION_RULES.conversion;
      // Alternatives are allowed to propose a different information
      // architecture from the family default. The generator still validates the
      // ids against PAGE_TYPES; restricting them to `base` here would make every
      // route collapse back to the same sitemap before the user could compare it.
      const preferred = requested.length ? requested : rule.order;
      const usable = preferred.filter((id) => !!PAGE_TYPES[id]);
      return unique(['home'].concat(usable.filter((id) => id !== 'home'))).slice(0, LIMITS.pages);
    };
    const directions = Object.keys(DIRECTION_RULES).map((direction, index) => buildPlan(prompt, brief, family, makeIds(direction), seed + index * 7919, direction));
    const selectedDirection = String(src.direction || 'conversion');
    const chosen = directions.find((item) => item.direction === selectedDirection) || directions[0];
    // Explicit page lists are a deliberate user choice: preserve them while
    // still exposing alternatives for comparison.
    if (requested.length) {
      const explicitIds = unique(['home'].concat(requested.filter((id) => id !== 'home'))).slice(0, LIMITS.pages);
      directions.forEach((item) => { item.pages = explicitIds.map((id, index) => page(id, index, family)); item.rationale.signature = ['navigation', family, item.direction, explicitIds.join('>'), Math.abs(item.seed) % 7].join(':'); });
    }
    return { ...chosen, directions };
  }
  function validate(result) {
    const r = result || {};
    const pagesOk = Array.isArray(r.pages) && r.pages.length >= 1 && r.pages.length <= LIMITS.pages && r.pages.some((p) => p && p.id === 'home') && r.pages.every((p) => p && PAGE_TYPES[p.id] && Array.isArray(p.sections) && p.sections.length <= LIMITS.sections);
    const directionsOk = !r.directions || (Array.isArray(r.directions) && r.directions.length === Object.keys(DIRECTION_RULES).length && r.directions.every((item) => item && pagesOkFor(item)));
    return !!(r.version === 1 && pagesOk && directionsOk && r.rationale && typeof r.rationale.signature === 'string');
  }
  function pagesOkFor(result) {
    return !!(result && Array.isArray(result.pages) && result.pages.length >= 1 && result.pages.length <= LIMITS.pages && result.pages.some((p) => p && p.id === 'home') && result.pages.every((p) => p && PAGE_TYPES[p.id] && Array.isArray(p.sections) && p.sections.length <= LIMITS.sections));
  }
  return { LIMITS, PAGE_TYPES, FAMILIES, SECTION_MAP, DIRECTION_RULES, familyFor, plan, validate };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AiSitemap;
if (typeof window !== 'undefined') window.AiSitemap = AiSitemap;

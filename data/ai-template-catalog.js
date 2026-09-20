'use strict';

// ============================================================
// PallettAI Studio — AI template directions
// ------------------------------------------------------------
// These are not copied templates or remote assets. They are authored visual
// briefs: a coherent point of view, page rhythm and section treatment that the
// offline generator can apply to a client's own facts. Keeping the catalogue as
// data means it can grow without adding another rendering architecture.
// ============================================================

const AiTemplateCatalog = (() => {
  const BLUEPRINTS = [
    {
      id: 'signal-house', name: 'Signal House', category: 'AI & SaaS', icon: '✦',
      eyebrow: 'A sharper way forward', look: 'techy', palette: 'cobalt', font: 'spacegrotesk',
      blurb: 'A product-led launch page with a terminal hero, proof strip and crisp conversion path.',
      promptHint: 'product launch, platform, AI tool or software company',
      order: ['hero', 'logos', 'features', 'stats', 'table', 'testimonials', 'faq', 'cta', 'contact'],
      layouts: { hero: 'terminal', features: 'bento', stats: 'band', table: 'compare', testimonials: 'featured', faq: 'columns', cta: 'splash', contact: 'split' },
      design: { containerWidth: 1200, radius: 14, spacing: 88 },
      signature: 'Terminal window, measurable proof, bento product tiles'
    },
    {
      id: 'still-life', name: 'Still Life', category: 'Creative', icon: '◌',
      eyebrow: 'Selected with intention', look: 'editorial', palette: 'pack_editorial', font: 'newsreader',
      blurb: 'An editorial portfolio with a generous masthead, mixed-size work wall and restrained typography.',
      promptHint: 'creative studio, photographer, architect or independent maker',
      order: ['hero', 'gallery', 'about', 'features', 'testimonials', 'logos', 'cta', 'contact'],
      layouts: { hero: 'minimal', gallery: 'collage', about: 'timeline', features: 'numbered', testimonials: 'masonry', logos: 'grid', cta: 'email', contact: 'minimal' },
      design: { containerWidth: 1120, radius: 4, spacing: 120 },
      signature: 'Magazine masthead, collage gallery, hairline story blocks'
    },
    {
      id: 'northline', name: 'Northline', category: 'Professional', icon: '▦',
      eyebrow: 'Clear advice, properly delivered', look: 'light', palette: 'stone', font: 'sourceserif',
      blurb: 'A composed professional-services site that leads with trust, evidence and a calm enquiry route.',
      promptHint: 'law firm, accountant, consultant or regulated practice',
      order: ['hero', 'stats', 'features', 'about', 'table', 'testimonials', 'faq', 'cta', 'contact'],
      layouts: { hero: 'split', stats: 'band', features: 'numbered', about: 'left', table: 'compare', testimonials: 'featured', faq: 'split', cta: 'email', contact: 'cards' },
      design: { containerWidth: 1080, radius: 5, spacing: 96 },
      signature: 'Evidence first, numbered expertise, comparison table'
    },
    {
      id: 'foundry', name: 'Foundry', category: 'Studio & Agency', icon: '◆',
      eyebrow: 'Make the work impossible to ignore', look: 'bold', palette: 'pack_brutal', font: 'archivo',
      blurb: 'A high-contrast agency canvas with hard edges, oversized type and a work-first journey.',
      promptHint: 'branding agency, design team, marketing studio or creative collective',
      order: ['hero', 'gallery', 'features', 'stats', 'about', 'testimonials', 'cta', 'contact'],
      layouts: { hero: 'split', gallery: 'mosaic', features: 'numbered', stats: 'ticker', about: 'floating', testimonials: 'masonry', cta: 'splash', contact: 'overlap' },
      design: { containerWidth: 1280, radius: 0, spacing: 92 },
      signature: 'Hard frame, oversized work wall, offset-energy composition'
    },
    {
      id: 'common-ground', name: 'Common Ground', category: 'Local & Hospitality', icon: '✳',
      eyebrow: 'Come in, stay a while', look: 'warm', palette: 'terracotta', font: 'dmserif',
      blurb: 'A tactile local-business template built around place, menu, atmosphere and regulars.',
      promptHint: 'café, restaurant, bakery, pub or neighbourhood venue',
      order: ['hero', 'about', 'table', 'gallery', 'features', 'testimonials', 'faq', 'cta', 'contact'],
      layouts: { hero: 'split', about: 'floating', table: 'compare', gallery: 'reel', features: 'strip', testimonials: 'masonry', faq: 'accordion', cta: 'splash', contact: 'cards' },
      design: { containerWidth: 1060, radius: 20, spacing: 82 },
      signature: 'Place-led intro, real menu table, warm customer wall'
    },
    {
      id: 'afterlight', name: 'Afterlight', category: 'Events', icon: '◐',
      eyebrow: 'Make a night of it', look: 'dark', palette: 'pack_cosmic', font: 'cormorant',
      blurb: 'An atmospheric event experience with a cinematic opening, countdown and layered social proof.',
      promptHint: 'event organiser, wedding planner, festival or nightlife brand',
      order: ['hero', 'countdown', 'gallery', 'features', 'testimonials', 'pricing', 'faq', 'cta', 'contact'],
      layouts: { hero: 'split', countdown: 'panel', gallery: 'reel', features: 'bento', testimonials: 'featured', pricing: 'stacked', faq: 'columns', cta: 'splash', contact: 'overlap' },
      design: { containerWidth: 1240, radius: 24, spacing: 108 },
      signature: 'Cinematic dark field, event countdown, package ladder'
    },
    {
      id: 'soft-focus', name: 'Soft Focus', category: 'Wellness', icon: '⌁',
      eyebrow: 'A little more room to breathe', look: 'minimal', palette: 'sage', font: 'manrope',
      blurb: 'A quiet wellness layout with spacious pacing, gentle proof and an uncomplicated booking finish.',
      promptHint: 'wellness, yoga, therapist, spa or health practice',
      order: ['hero', 'about', 'features', 'testimonials', 'stats', 'faq', 'booking', 'contact'],
      layouts: { hero: 'minimal', about: 'left', features: 'strip', testimonials: 'featured', stats: 'band', faq: 'split', booking: 'compact', contact: 'minimal' },
      design: { containerWidth: 1040, radius: 26, spacing: 128 },
      signature: 'Quiet hero, generous air, booking as the final answer'
    },
    {
      id: 'playbook', name: 'Playbook', category: 'Sport & Fitness', icon: '➚',
      eyebrow: 'Train with intent', look: 'playful', palette: 'emerald', font: 'oswald',
      blurb: 'An energetic membership site with a bold stats rail, class timetable and clear first-session CTA.',
      promptHint: 'gym, personal trainer, sports club or fitness programme',
      order: ['hero', 'stats', 'features', 'table', 'testimonials', 'pricing', 'faq', 'cta', 'contact'],
      layouts: { hero: 'aurora', stats: 'ticker', features: 'bento', table: 'compare', testimonials: 'masonry', pricing: 'toggle', faq: 'accordion', cta: 'splash', contact: 'cards' },
      design: { containerWidth: 1180, radius: 16, spacing: 86 },
      signature: 'Kinetic gradient, timetable, membership choice'
    },
    {
      id: 'atelier-noir', name: 'Atelier Noir', category: 'Luxury & Fashion', icon: '◇',
      eyebrow: 'Objects with a point of view', look: 'noir', palette: 'pack_lux', font: 'bodoni',
      blurb: 'A high-fashion storefront direction with a quiet hero, editorial product gallery and refined details.',
      promptHint: 'fashion label, jewellery, luxury product or boutique',
      order: ['hero', 'gallery', 'about', 'collection', 'features', 'testimonials', 'cta', 'contact'],
      layouts: { hero: 'minimal', gallery: 'collage', about: 'timeline', collection: 'slider', features: 'numbered', testimonials: 'featured', cta: 'email', contact: 'minimal' },
      design: { containerWidth: 1160, radius: 2, spacing: 136 },
      signature: 'Quiet luxury, editorial collage, product rail'
    },
    {
      id: 'field-notes', name: 'Field Notes', category: 'Community & Cause', icon: '✎',
      eyebrow: 'Small actions, visible change', look: 'light', palette: 'sage', font: 'literata',
      blurb: 'A story-led nonprofit layout that makes the mission tangible through impact, people and transparent funding.',
      promptHint: 'nonprofit, charity, community project or social enterprise',
      order: ['hero', 'about', 'stats', 'features', 'table', 'testimonials', 'cta', 'contact'],
      layouts: { hero: 'split', about: 'timeline', stats: 'band', features: 'numbered', table: 'compare', testimonials: 'masonry', cta: 'splash', contact: 'split' },
      design: { containerWidth: 1140, radius: 10, spacing: 104 },
      signature: 'Mission story, impact band, transparent money trail'
    },
    {
      id: 'open-road', name: 'Open Road', category: 'Travel', icon: '↗',
      eyebrow: 'Go further, differently', look: 'editorial', palette: 'lagoon', font: 'playfair',
      blurb: 'An image-led travel route with a horizontal reel, itinerary cards and proof from people who went.',
      promptHint: 'travel company, tour operator, hotel or destination guide',
      order: ['hero', 'gallery', 'collection', 'about', 'testimonials', 'faq', 'cta', 'contact'],
      layouts: { hero: 'split', gallery: 'reel', collection: 'marquee', about: 'floating', testimonials: 'featured', faq: 'columns', cta: 'email', contact: 'overlap' },
      design: { containerWidth: 1260, radius: 18, spacing: 112 },
      signature: 'Destination reel, itinerary collection, traveller proof'
    },
    {
      id: 'blueprint', name: 'Blueprint', category: 'Property & Home', icon: '⌂',
      eyebrow: 'Good spaces start with good thinking', look: 'light', palette: 'ocean', font: 'barlow',
      blurb: 'A structured property direction for listings, project stages and a confident valuation or enquiry route.',
      promptHint: 'estate agent, architect, builder or renovation company',
      order: ['hero', 'collection', 'stats', 'features', 'gallery', 'about', 'testimonials', 'cta', 'contact'],
      layouts: { hero: 'split', collection: 'slider', stats: 'band', features: 'numbered', gallery: 'mosaic', about: 'left', testimonials: 'masonry', cta: 'email', contact: 'cards' },
      design: { containerWidth: 1220, radius: 12, spacing: 98 },
      signature: 'Listings first, project stages, conversion-ready valuation'
    },
    {
      id: 'monument', name: 'Monument', category: 'Architecture & Design', icon: '▱',
      eyebrow: 'Form follows feeling', look: 'minimal', palette: 'stone', font: 'sourceserif',
      blurb: 'A gallery-first architecture direction with a monumental opening, project index and quiet case-study pacing.',
      promptHint: 'architecture practice, interior designer or industrial designer',
      order: ['hero', 'collection', 'gallery', 'about', 'stats', 'testimonials', 'cta', 'contact'],
      layouts: { hero: 'minimal', collection: 'plain', gallery: 'mosaic', about: 'timeline', stats: 'band', testimonials: 'featured', cta: 'email', contact: 'minimal' },
      design: { containerWidth: 1160, radius: 0, spacing: 140 },
      signature: 'Monumental headline, project index, quiet case-study pacing'
    },
    {
      id: 'tidepool', name: 'Tidepool', category: 'Travel & Hospitality', icon: '≈',
      eyebrow: 'Find your next horizon', look: 'bright', palette: 'lagoon', font: 'playfair',
      blurb: 'A sunlit destination layout with an immersive opening, itinerary rail and an easy route to booking.',
      promptHint: 'hotel, travel guide, retreat or destination brand',
      order: ['hero', 'gallery', 'collection', 'features', 'testimonials', 'faq', 'booking', 'contact'],
      layouts: { hero: 'aurora', gallery: 'reel', collection: 'slider', features: 'strip', testimonials: 'masonry', faq: 'columns', booking: 'compact', contact: 'cards' },
      design: { containerWidth: 1260, radius: 22, spacing: 106 },
      signature: 'Sunlit hero, destination reel, itinerary-to-booking path'
    },
    {
      id: 'kinetic-house', name: 'Kinetic House', category: 'Culture & Media', icon: '↯',
      eyebrow: 'Turn attention into movement', look: 'bold', palette: 'pack_brutal', font: 'archivo',
      blurb: 'A high-energy culture page built around a signal-led hero, event cards and a moving editorial strip.',
      promptHint: 'music label, media studio, festival or cultural organisation',
      order: ['hero', 'stats', 'gallery', 'features', 'collection', 'testimonials', 'cta', 'contact'],
      layouts: { hero: 'terminal', stats: 'ticker', gallery: 'strip', features: 'bento', collection: 'marquee', testimonials: 'featured', cta: 'splash', contact: 'overlap' },
      design: { containerWidth: 1280, radius: 6, spacing: 88 },
      signature: 'Signal-led opening, moving editorial strip, event energy'
    },
    {
      id: 'paper-plane', name: 'Paper Plane', category: 'Startups & Products', icon: '➤',
      eyebrow: 'Make the complex feel obvious', look: 'techy', palette: 'cobalt', font: 'spacegrotesk',
      blurb: 'A product narrative with a clear promise, proof-led feature architecture and a confident conversion finish.',
      promptHint: 'startup, productivity app, software product or digital service',
      order: ['hero', 'logos', 'features', 'stats', 'table', 'pricing', 'faq', 'cta', 'contact'],
      layouts: { hero: 'terminal', logos: 'grid', features: 'bento', stats: 'band', table: 'compare', pricing: 'toggle', faq: 'split', cta: 'email', contact: 'split' },
      design: { containerWidth: 1180, radius: 12, spacing: 90 },
      signature: 'Product promise, proof architecture, comparison-led conversion'
    },
    {
      id: 'market-stall', name: 'Market Stall', category: 'Food & Retail', icon: '✺',
      eyebrow: 'Made here, shared gladly', look: 'warm', palette: 'terracotta', font: 'dmserif',
      blurb: 'A warm, local storefront direction that makes the offer tangible through menu, makers and regulars.',
      promptHint: 'food brand, maker, independent shop, bakery or market trader',
      order: ['hero', 'table', 'gallery', 'about', 'features', 'testimonials', 'faq', 'cta', 'contact'],
      layouts: { hero: 'split', table: 'compare', gallery: 'collage', about: 'floating', features: 'strip', testimonials: 'masonry', faq: 'accordion', cta: 'splash', contact: 'cards' },
      design: { containerWidth: 1100, radius: 18, spacing: 90 },
      signature: 'Offer-first storefront, maker story, local regulars'
    },
    {
      id: 'atlas-house', name: 'Atlas House', category: 'Education & Knowledge', icon: '⌘',
      eyebrow: 'Make the complicated navigable', look: 'light', palette: 'ocean', font: 'barlow',
      blurb: 'A confident knowledge hub with measurable outcomes, clear pathways and a generous resource index.',
      promptHint: 'school, course creator, consultancy, research group or knowledge platform',
      order: ['hero', 'stats', 'features', 'collection', 'table', 'faq', 'testimonials', 'cta', 'contact'],
      layouts: { hero: 'split', stats: 'band', features: 'numbered', collection: 'plain', table: 'compare', faq: 'split', testimonials: 'featured', cta: 'email', contact: 'split' },
      design: { containerWidth: 1180, radius: 8, spacing: 102 },
      signature: 'Outcome-led opening, resource index, pathway clarity'
    },
    {
      id: 'solstice', name: 'Solstice', category: 'Wellness & Beauty', icon: '☼',
      eyebrow: 'A practice for feeling better', look: 'minimal', palette: 'sage', font: 'manrope',
      blurb: 'A calm, tactile service journey with ritual, practitioner trust and booking placed exactly where it belongs.',
      promptHint: 'spa, therapist, skincare studio, yoga teacher or wellbeing practice',
      order: ['hero', 'about', 'features', 'collection', 'testimonials', 'faq', 'booking', 'contact'],
      layouts: { hero: 'minimal', about: 'floating', features: 'strip', collection: 'slider', testimonials: 'featured', faq: 'accordion', booking: 'compact', contact: 'minimal' },
      design: { containerWidth: 1040, radius: 28, spacing: 132 },
      signature: 'Quiet ritual, practitioner proof, low-friction booking'
    },
    {
      id: 'rally-point', name: 'Rally Point', category: 'Sport & Community', icon: '◎',
      eyebrow: 'Bring your people together', look: 'bright', palette: 'emerald', font: 'oswald',
      blurb: 'A spirited membership and community direction with a pulse of activity, timetable clarity and social proof.',
      promptHint: 'sports club, community group, class programme or youth organisation',
      order: ['hero', 'stats', 'table', 'features', 'gallery', 'testimonials', 'cta', 'contact'],
      layouts: { hero: 'aurora', stats: 'ticker', table: 'compare', features: 'bento', gallery: 'strip', testimonials: 'masonry', cta: 'splash', contact: 'cards' },
      design: { containerWidth: 1200, radius: 18, spacing: 84 },
      signature: 'Activity pulse, timetable clarity, community momentum'
    }
  ];

  const byId = Object.create(null);
  BLUEPRINTS.forEach((blueprint) => { byId[blueprint.id] = Object.freeze(blueprint); });

  function get(id) { return byId[String(id || '')] || null; }
  function list(category) {
    const value = String(category || '').trim();
    return value ? BLUEPRINTS.filter((item) => item.category === value) : BLUEPRINTS.slice();
  }
  function categories() { return Array.from(new Set(BLUEPRINTS.map((item) => item.category))); }

  return { BLUEPRINTS, get, list, categories };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AiTemplateCatalog;

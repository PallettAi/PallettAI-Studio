'use strict';

/*
  data/copy.js — the copy engine behind "text → site".

  WHY THIS EXISTS
  ---------------
  The first generation wrote every section header from per-business-TYPE
  constants. That made two different pizzerias — or two different SaaS products —
  come out word for word identical, because only {brand} and {focus} varied:

      features.subtitle  "The things our clients mention first."
      gallery.title      "A glimpse"
      gallery.subtitle   "Recent moments from our world."
      pricing.subtitle   "No surprises. No hidden fees. Ever."
      testimonials.title "Kind words"
      contact.subtitle   "We reply within one business day."

  Worse, the about bullets were a hard-coded TRADES list applied to every
  business on earth:

      ✓ {focus}, done properly   ✓ Quoted before we start   ✓ We answer the phone

  which reads as nonsense on a software or bakery site.

  This module fixes the class of problem, not the instances:

    1. A business belongs to a REGISTER (trade / craft / product / table /
       stage / care / plain) — the voice family — not just an industry.
    2. Every header and subtitle is drawn from a pool of real alternates, picked
       by seed and never repeated within one site.
    3. The client's own words win: their proofs become item titles AND bodies,
       their area is named, their offer is respected.
    4. Tone is an actual transform on the sentence, not a truncation.

  Deterministic by design: same seed in, same copy out. That keeps generation
  reproducible and testable without a network call.
*/

// ---------------------------------------------------------------- registers
// A register is a voice family. Two businesses in the same register still get
// different copy because selection is seeded and never repeats.
const REGISTER_OF_TYPE = {
  tech: 'product', edu: 'product',
  creative: 'craft', retail: 'craft', beauty: 'craft', travel: 'craft',
  food: 'table',
  events: 'stage', music: 'stage', fitness: 'stage',
  home: 'trade', auto: 'trade',
  nonprofit: 'care',
  generic: 'plain'
};

// a stated taste outranks the industry default: a "playful" accountancy is not
// a plain one
const REGISTER_OF_TASTE = {
  playful: 'stage', vibrant: 'stage', bold: 'stage',
  warm: 'table',
  editorial: 'craft', premium: 'craft',
  techy: 'product',
  minimal: 'plain'
};

function registerFor(typeId, taste) {
  const byTaste = REGISTER_OF_TASTE[String(taste || '')];
  const byType = REGISTER_OF_TYPE[String(typeId || '')];
  // taste wins only when the industry has no stronger claim of its own
  if (byTaste && (!byType || byType === 'plain' || byTaste !== 'plain')) return byTaste;
  return byType || 'plain';
}

// ------------------------------------------------------------------- pools
// {brand} {focus} {area} are substituted. Keep every entry a complete,
// client-facing line — these are read by the public, not by us.
const POOLS = {
  trade: {
    aboutTitle: ['Who we are', 'Our story', 'About {brand}', 'The people behind {brand}'],
    aboutClose: [
      'Most of our work still comes from people who were recommended to us.',
      'We would rather do it once, properly, than come back twice.',
      'If we are not the right people for the job, we will say so.'
    ],
    bullets: [
      'Quoted before we start', 'Fixed prices, agreed upfront', 'We answer the phone',
      'Tidy work, every time', 'We clean up after ourselves', 'Licensed and fully insured',
      'We turn up when we say we will', 'Guaranteed in writing', 'Same-week callouts',
      'Local to {area}', 'No call-out fee within {area}', 'Photos before and after',
      'Parts sourced and explained', 'We explain the options in plain English'
    ],
    featuresTitle: ['Why {brand}', 'What you get', 'Why people call {brand}', 'The work, plainly'],
    featuresSub: [
      'The things clients mention first.',
      'Straight answers, fair prices, and the job done once.',
      'What you can count on, every visit.',
      'No jargon, no upsell, and nothing unexpected on the invoice.'
    ],
    statsTitle: ['By the numbers', 'What we have done', 'Track record', 'So far'],
    galleryTitle: ['Recent jobs', 'Our work', 'Completed this month', 'On the tools', 'Before and after'],
    gallerySub: [
      'A look at what we have been working on.',
      'Real jobs, documented as we go.',
      'Straight from this week\u2019s diary.',
      'No stock photos \u2014 this is our work.'
    ],
    pricingTitle: ['What we charge', 'Honest rates', 'Our prices', 'Simple pricing'],
    pricingSub: [
      'Fixed prices agreed before we start.',
      'No call-out surprises and no hidden extras.',
      'Every quote in writing, every time.',
      'You approve the price before any work begins.'
    ],
    testimonialsTitle: ['What clients say', 'Reviews', 'People we have worked for', 'Kind words'],
    testimonialsSub: ['From the people who called us first.', 'Unedited reviews from local customers.', 'All from within {area}.'],
    faqTitle: ['Common questions', 'Before you book', 'Questions, answered', 'The things people ask'],
    ctaTitle: ['Need us today?', 'Get a quote', 'Talk to us about the job', 'Ready when you are'],
    ctaText: [
      'Call or send a message \u2014 we will tell you honestly what it needs.',
      'Send a photo and we will come back with a straight price.',
      'No obligation and no sales pitch, just a clear answer.'
    ],
    contactTitle: ['Get in touch', 'Talk to us', 'Send us a message', 'Request a quote'],
    contactSub: ['We reply the same working day.', 'Tell us what you need and we will price it.', 'Messages answered within a few hours.']
  },

  craft: {
    aboutTitle: ['Our story', 'Who we are', 'About the studio', 'Behind {brand}'],
    aboutClose: [
      'We still work the same way we did on our first commission.',
      'Every project leaves here with a decision behind it, not a template.',
      'We would rather make fewer things, better.'
    ],
    bullets: [
      'Made by hand, checked by eye', 'One team, start to finish', 'No templates, ever',
      'We show our working', 'Prototypes before we commit', 'Deadlines we actually keep',
      'Based in {area}', 'Small on purpose', 'Every detail considered',
      'We tell you what we honestly think', 'Two rounds of revisions included', 'You own everything we make'
    ],
    featuresTitle: ['What we do', 'Our services', 'How we work', 'Services'],
    featuresSub: [
      'The things our clients mention first.',
      'Careful work, made to last.',
      'Considered from the first sketch to the final coat.',
      'Craft first, ego second.'
    ],
    statsTitle: ['By the numbers', 'The studio so far', 'What we have made', 'Track record'],
    galleryTitle: ['Recent work', 'Selected projects', 'From the studio', 'Recent commissions', 'Portfolio'],
    gallerySub: [
      'A small selection of recent work.',
      'Projects we are proud of.',
      'Fresh from the last few months.',
      'Commissioned work, shown with permission.'
    ],
    pricingTitle: ['What it costs', 'Working together', 'Pricing', 'Investment'],
    pricingSub: [
      'Clear scopes, fixed prices, no surprise invoices.',
      'Every project quoted before we begin.',
      'Three ways to work with us.',
      'Scoped honestly, priced in writing.'
    ],
    testimonialsTitle: ['Clients', 'What people say', 'Kind words', 'People we have made for'],
    testimonialsSub: ['From the people who commissioned the work.', 'A few words from recent clients.'],
    faqTitle: ['Questions', 'Good to know', 'Things people ask', 'Before we start'],
    ctaTitle: ['Start a project', 'Work with us', 'Tell us what you have in mind', 'Let\u2019s begin'],
    ctaText: [
      'Tell us about the project and we will tell you honestly how we would approach it.',
      'No brief too early, no idea too rough.',
      'Send us a rough idea and we will come back with a plan.'
    ],
    contactTitle: ['Get in touch', 'Say hello', 'Start a conversation', 'Talk to us'],
    contactSub: ['We reply within one business day.', 'Tell us a little about the project and we will take it from there.', 'We read everything and reply personally.']
  },

  product: {
    aboutTitle: ['Our story', 'Why we built {brand}', 'About us', 'The team'],
    aboutClose: [
      'We ship weekly and publish what changed.',
      'We still answer support ourselves.',
      'Everything we build starts with a customer asking for it.'
    ],
    bullets: [
      'Set up in minutes, no call needed', 'No lock-in contracts', 'Support from real people',
      'Your data stays yours', 'Works with the tools you already use', 'Transparent pricing',
      'Built for teams of any size', 'Updates shipped every week', 'Based in {area}',
      'Export everything, any time', 'No training required', 'Cancel in two clicks'
    ],
    featuresTitle: ['What you get', 'Built in', 'The platform', 'Features'],
    featuresSub: [
      'The things teams mention first.',
      'Everything included, nothing bolted on later.',
      'What makes it quicker to use than what you have now.',
      'All of it in every plan.'
    ],
    statsTitle: ['By the numbers', 'Where we are today', 'Adoption', 'In production'],
    galleryTitle: ['Product', 'How it looks', 'In use', 'Screenshots'],
    gallerySub: ['The product, unchanged.', 'Real screens from the live app.', 'No mockups.'],
    pricingTitle: ['Pricing', 'Plans', 'Simple pricing', 'Pick a plan'],
    pricingSub: [
      'Pay for what you use, cancel whenever.',
      'No setup fees and no minimum term.',
      'Every plan includes the whole product.',
      'Change plan or leave at any time.'
    ],
    testimonialsTitle: ['What teams say', 'Customers', 'Kind words', 'Reviews'],
    testimonialsSub: ['From teams using {brand} daily.', 'Unedited, with permission.'],
    faqTitle: ['Questions', 'The details', 'Good to know', 'FAQ'],
    ctaTitle: ['Start today', 'Try {brand}', 'See it working', 'Get started'],
    ctaText: [
      'Set up in minutes \u2014 no card needed to try it.',
      'Book a walkthrough and we will show you the whole thing.',
      'Start free and upgrade only if it earns its place.'
    ],
    contactTitle: ['Talk to us', 'Get in touch', 'Ask us anything', 'Say hello'],
    contactSub: ['We reply within one business day.', 'Real humans, usually within a few hours.', 'Ask us anything, including the hard questions.']
  },

  table: {
    aboutTitle: ['Our story', 'How it started', 'About {brand}', 'The kitchen'],
    aboutClose: [
      'The menu changes with what is good that week.',
      'We still cook everything to order.',
      'Regulars shaped this menu as much as we did.'
    ],
    bullets: [
      'Sourced within {area} where we can', 'Made fresh, never frozen', 'Menus that follow the season',
      'Vegetarian and vegan choices', 'Allergens handled properly', 'Walk-ins always welcome',
      'Bookings for larger tables', 'Takeaway available', 'Family run since day one',
      'Produce delivered daily', 'Everything made in-house', 'Dietary needs, no fuss'
    ],
    featuresTitle: ['What we do', 'Our approach', 'How we cook', 'The kitchen'],
    featuresSub: [
      'The things guests mention first.',
      'Everything made here, from scratch.',
      'Seasonal, local, and cooked to order.',
      'Good ingredients, treated simply.'
    ],
    statsTitle: ['By the numbers', 'In the kitchen', 'So far', 'What we have built'],
    galleryTitle: ['On the pass', 'From the kitchen', 'This week', 'The plates', 'In the room'],
    gallerySub: [
      'Photographed in the restaurant, not in a studio.',
      'What came off the pass today.',
      'A look at the last few weeks.'
    ],
    pricingTitle: ['Menus and prices', 'What it costs', 'Our menu', 'Prices'],
    pricingSub: ['Prices include everything, service aside.', 'Menus change weekly, prices rarely do.', 'Set menus available for groups.'],
    testimonialsTitle: ['What guests say', 'Regulars', 'Kind words', 'Reviews'],
    testimonialsSub: ['From people who came back.', 'Recent guests, in their own words.', 'All from within {area}.'],
    faqTitle: ['Good to know', 'Common questions', 'Before you visit', 'Questions'],
    ctaTitle: ['Book a table', 'Come and eat', 'Reserve your table', 'Join us'],
    ctaText: [
      'Book online or give us a ring and we will find you a table.',
      'Walk in, or book ahead for weekends.',
      'We will always try to fit you in.'
    ],
    contactTitle: ['Find us', 'Get in touch', 'Say hello', 'Visit us'],
    contactSub: ['Call to book, or just drop in.', 'We reply to messages between services.', 'Open every day except Monday.']
  },

  stage: {
    aboutTitle: ['Who we are', 'Our story', 'About {brand}', 'Why we started'],
    aboutClose: [
      'Everyone is welcome, whatever their level.',
      'The first session is the hardest one, so we make it easy.',
      'Regulars will tell you it gets easier after week two.'
    ],
    bullets: [
      'First session free', 'Beginners genuinely welcome', 'Sessions run by qualified coaches',
      'Equipment provided', 'Small group sizes', 'Flexible memberships, no lock-in',
      'Based in {area}', 'Evening and weekend sessions', 'All levels in the same room',
      'Cancellations handled fairly', 'Pay per session available', 'Named coaches, not a rota'
    ],
    featuresTitle: ['What we offer', 'On the programme', 'What happens', 'Services'],
    featuresSub: [
      'The things people mention first.',
      'High energy, properly run.',
      'Every session planned, never improvised.',
      'Structured enough to work, relaxed enough to enjoy.'
    ],
    statsTitle: ['By the numbers', 'So far this year', 'Members and sessions', 'Since we opened'],
    galleryTitle: ['In session', 'Last week', 'From the floor', 'Recent nights', 'On stage'],
    gallerySub: ['Take a look before you come along.', 'Shot at our own sessions.', 'No stock photos of anyone.'],
    pricingTitle: ['Membership', 'What it costs', 'Sessions and prices', 'Pricing'],
    pricingSub: [
      'No contracts, cancel whenever.',
      'Pay monthly or drop in when it suits.',
      'Every membership includes every session.'
    ],
    testimonialsTitle: ['What people say', 'Members', 'Kind words', 'Reviews'],
    testimonialsSub: ['From people who turn up every week.', 'Recent members, unedited.'],
    faqTitle: ['Questions', 'Good to know', 'Before you come', 'The things people ask'],
    ctaTitle: ['Book a session', 'Come along', 'Try it out', 'Get started'],
    ctaText: [
      'The first session is on us \u2014 come and see.',
      'Places are limited, so book ahead.',
      'Turn up in anything comfortable. That is the only requirement.'
    ],
    contactTitle: ['Get in touch', 'Find us', 'Talk to us', 'Message us'],
    contactSub: ['Message us and we will get back to you today.', 'We reply within a few hours.', 'Ask us anything before you commit.']
  },

  care: {
    aboutTitle: ['Who we are', 'Our story', 'Why we started', 'About {brand}'],
    aboutClose: [
      'Every hour given goes further than you would expect.',
      'We publish what we spend and where it goes.',
      'We work with local groups rather than around them.'
    ],
    bullets: [
      'Every pound accounted for', 'Volunteer-led', 'Working across {area}',
      'Partnerships with local groups', 'Annual accounts published', 'No paid directors',
      'Open to anyone who needs us', 'Referrals are never turned away unseen', 'Reporting back to funders'
    ],
    featuresTitle: ['What we do', 'How we help', 'Our work', 'Where we focus'],
    featuresSub: [
      'The things people mention first.',
      'Practical help, delivered where it is needed.',
      'Small enough to stay flexible, experienced enough to deliver.',
      'Support shaped by the people who use it.'
    ],
    statsTitle: ['By the numbers', 'Our impact', 'What we have done', 'This year'],
    galleryTitle: ['Our work', 'Recent projects', 'From the field', 'What we have been doing'],
    gallerySub: ['Shared with permission.', 'Moments from recent work.', 'Nothing staged.'],
    pricingTitle: ['Get involved', 'How to help', 'Support us', 'Ways to give'],
    pricingSub: ['Every contribution is accounted for.', 'One-off or monthly, both are useful.', 'Volunteering costs nothing but time.'],
    testimonialsTitle: ['Who we help', 'Stories', 'In their words', 'People we work with'],
    testimonialsSub: ['Shared with permission, names changed.', 'From the people who use our services.'],
    faqTitle: ['Questions', 'Good to know', 'Common questions', 'How it works'],
    ctaTitle: ['Get involved', 'Support the work', 'Volunteer with us', 'Help out'],
    ctaText: [
      'Whether you can give time or money, we would love to hear from you.',
      'Get in touch and we will tell you exactly what is needed right now.',
      'Start with one hour a month.'
    ],
    contactTitle: ['Get in touch', 'Contact us', 'Say hello', 'Reach us'],
    contactSub: ['We answer every message personally.', 'We reply within two working days.', 'Ring us if it is easier.']
  },

  plain: {
    aboutTitle: ['About us', 'Our story', 'Who we are', 'Behind {brand}'],
    aboutClose: [
      'We are small, and we like it that way.',
      'Most of our work comes from people telling other people.',
      'We would rather over-deliver than over-promise.'
    ],
    bullets: [
      'Clear prices, agreed upfront', 'We answer the phone', 'Tidy, careful work',
      'Based in {area}', 'We turn up when we say', 'Advice before we sell you anything',
      'Local and independent', 'Honest about what we cannot do', 'No pressure, ever'
    ],
    featuresTitle: ['What we do', 'Why {brand}', 'Our services', 'What you get'],
    featuresSub: [
      'The things our clients mention first.',
      'Straight answers and work done properly.',
      'Simple, and done well.',
      'No jargon, no surprises.'
    ],
    statsTitle: ['By the numbers', 'So far', 'Track record', 'What we have done'],
    galleryTitle: ['Recent work', 'Our work', 'A look around', 'From this month'],
    gallerySub: ['A small selection of recent work.', 'Photos from our own jobs.', 'We will add more as we go.'],
    pricingTitle: ['What it costs', 'Pricing', 'Our prices', 'Simple pricing'],
    pricingSub: ['Prices agreed before we start.', 'No hidden fees, ever.', 'Everything quoted in writing.'],
    testimonialsTitle: ['What people say', 'Kind words', 'Our clients', 'Reviews'],
    testimonialsSub: ['From people we have worked with.', 'Recent feedback, unedited.'],
    faqTitle: ['Questions', 'Common questions', 'Good to know', 'Before you get in touch'],
    ctaTitle: ['Get in touch', 'Let\u2019s talk', 'Start here', 'Ready when you are'],
    ctaText: [
      'Send us a message and we will come back with a clear answer.',
      'No obligation, no pressure.',
      'We will tell you honestly whether we can help.'
    ],
    contactTitle: ['Get in touch', 'Say hello', 'Contact us', 'Talk to us'],
    contactSub: ['We reply within one business day.', 'Messages answered personally.', 'Ask us anything.']
  }
};

// ------------------------------------------------------- page-level intros
/*
  A multi-page site used to be built by CLONING the home page's sections onto
  every other page, so a visitor who clicked "Services" met the exact block they
  had just scrolled past, and every secondary page opened with no hero at all
  (which failed the app's own quality gate).

  Each page now gets an opening written for that page.
*/
const PAGE_INTRO = {
  services: {
    title: ['What we do', 'Our services', 'Services', 'What we offer'],
    subtitle: ['{brand} in more detail.', 'Everything {brand} does, in one place.', 'The full list, without the sales pitch.', 'What we can take on for you.'],
    body: ['The work {brand} takes on day to day, listed without the sales pitch.', 'Everything {brand} does, and a straight answer on what it costs.', 'What we can take off your hands, and how we go about it.']
  },
  menu: {
    title: ['The menu', 'What we cook', 'Our menu', 'Food and drink'],
    subtitle: ['Everything we are serving right now.', 'Changes with the season.', 'What is on today.'],
    body: ['What {brand} is cooking right now \u2014 it changes with the season.', 'Today\u2019s menu, written by the kitchen this morning.']
  },
  about: {
    title: ['About {brand}', 'Who we are', 'Our story', 'The people behind {brand}'],
    subtitle: ['How {brand} started and how we work.', 'A little background before you get in touch.', 'The short version of who you would be working with.'],
    body: ['The people, the history, and the way {brand} actually works.', 'Who you would be dealing with, and what we care about.', 'How {brand} came about and what has not changed since.']
  },
  contact: {
    title: ['Get in touch', 'Contact {brand}', 'Talk to us', 'How to reach us'],
    subtitle: ['We would genuinely like to hear from you.', 'Tell us what you need and we will reply.', 'No forms that go nowhere \u2014 this reaches a person.'],
    body: ['Reach {brand} directly \u2014 a person reads every message.', 'Call, email or send a note and we will come back to you.', 'However you prefer to get in touch, it reaches us.']
  },
  pricing: {
    title: ['What it costs', 'Pricing', 'Our prices', 'How we charge'],
    subtitle: ['Everything we charge for, in the open.', 'No hidden fees and no surprises.', 'Priced clearly, agreed before we start.']
  }
};

function pageIntro(pageKey, ctx) {
  const src = ctx || {};
  const pool = PAGE_INTRO[String(pageKey || '')] || null;
  if (!pool) return null;
  const next = rngFrom(hash(String(src.brand || '') + '|' + pageKey + '|' + (src.seed || 0)));
  const avoid = toAvoid(src.avoid);
  const b = { brand: src.brand || '', focus: src.focus || '', area: src.area || '' };
  return {
    title: pickAvoiding(pool.title, next, avoid, b),
    subtitle: pickAvoiding(pool.subtitle, next, avoid, b),
    body: pool.body ? pickAvoiding(pool.body, next, avoid, b) : ''
  };
}

// ------------------------------------------------------------------ helpers
function toAvoid(list) {
  const set = new Set();
  (Array.isArray(list) ? list : []).forEach((x) => {
    const k = String(x == null ? '' : x).trim().toLowerCase();
    if (k.length > 3) set.add(k);
  });
  return set;
}

// pick a line that has not already appeared elsewhere on this site
function pickAvoiding(list, next, avoid, ctx) {
  const arr = (Array.isArray(list) ? list : []).filter((x) => x != null && String(x).trim());
  if (!arr.length) return '';
  for (let attempt = 0; attempt < arr.length * 2; attempt++) {
    const line = fill(arr[Math.floor(next() * arr.length)], ctx || {});
    if (!avoid || !avoid.has(line.trim().toLowerCase())) return line;
  }
  return fill(arr[Math.floor(next() * arr.length)], ctx || {});
}

function hash(str) {
  let h = 2166136261;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// small deterministic generator so the same brief always yields the same site
function rngFrom(seed) {
  let a = (Number(seed) || 0) >>> 0 || 1;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fill(line, ctx) {
  return String(line == null ? '' : line)
    .replace(/\{brand\}/g, ctx.brand || '')
    .replace(/\{focus\}/g, ctx.focus || '')
    .replace(/\{area\}/g, ctx.area || 'your area');
}

function titleCase(s) {
  const t = String(s || '').trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function clipWords(s, max) {
  const words = String(s || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return words.slice(0, max).join(' ').replace(/[,;:.\u2014-]$/, '');
}

// trim to a length on a word boundary, never mid-word
function clipChars(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:.\u2014-]$/, '');
}

/*
  A client's proof is real evidence about their business, e.g.
      "5-year guarantee \u2014 on every installation, parts and labour"
      "Over 300 five-star reviews"
  It must read intact. We use the head clause as the item title so a real
  promise is never printed under an unrelated heading like "Lightning Fast".
*/
function titleFromProof(proof) {
  const raw = String(proof || '').trim();
  if (!raw) return '';
  // a natural head, if the client wrote one
  const parts = raw.split(/\s+[\u2014\u2013-]\s+|:\s+/);
  const head = parts.length > 1 ? parts[0].trim() : '';
  if (head && head.length >= 3 && head.length <= 48) return titleCase(clipChars(head, 48));
  // short sentence-like proof: it is its own headline
  if (raw.length <= 48 && !/[.!?]$/.test(raw)) return titleCase(raw);
  // otherwise take the leading words, which is where the claim lives
  const lead = clipChars(clipWords(raw, 6), 48);
  return lead ? titleCase(lead) : '';
}

/*
  Tone is a real transform. The first generation only truncated on "punchy" and
  appended a full stop on "premium", so the three tones read identically.
*/
function applyTone(text, tone) {
  let out = String(text || '').trim().replace(/\s{2,}/g, ' ');
  if (!out) return out;
  const id = String(tone || 'warm').toLowerCase();

  // hedging and filler dilute every tone
  out = out
    .replace(/\b(we|I) (just )?(wanted|thought) to\b/gi, 'we')
    .replace(/\bperhaps\b|\bmaybe\b|\bvery\b|\breally\b|\bquite\b|\bsomewhat\b/gi, '')
    .replace(/\bin order to\b/gi, 'to')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .trim();

  if (id === 'punchy') {
    // lead with the strongest clause, cap it, then stop
    let first = out.split(/(?<=[.!?])\s+/)[0] || out;
    if (first.split(/\s+/).length > 14) first = clipWords(first, 14);
    first = first.replace(/[,;:]$/, '');
    out = first.replace(/[.!?]*$/, '') + '.';
  } else if (id === 'premium') {
    // calm declaratives: no exclamation, no contractions, no shouting
    out = out.replace(/!/g, '.').replace(/\bdon't\b/gi, 'do not').replace(/\bcan't\b/gi, 'cannot');
    if (!/[.!?]$/.test(out)) out += '.';
  } else {
    // warm: keep the human sentences, just tidy the ending
    if (!/[.!?\u2026]$/.test(out)) out += '.';
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

// -------------------------------------------------------------------- build
/*
  build(ctx) -> the section bank, in the shape the renderers already expect.

  ctx: { type, brand, focus, area, offer, proofs[], prompt, taste, seed }
*/
function build(ctx) {
  const src = ctx || {};
  const type = src.type || {};
  const brand = String(src.brand || 'Us').trim();
  const focus = String(src.focus || '').trim();
  const register = registerFor(type.id, src.taste);
  const pool = POOLS[register] || POOLS.plain;
  const seed = Number(src.seed) || hash(brand + focus);
  // the page is mixed into the seed so a second page does not inherit the
  // first page's picks even before the avoid list is consulted
  const pageSalt = src.page ? hash(String(src.page)) % 9973 : 0;
  const next = rngFrom(seed + (src.salt || 0) + pageSalt);

  // never print the same line twice on one site, and never repeat a line that
  // an earlier page has already published
  const used = new Set();
  const avoid = toAvoid(src.avoid);
  const pickOne = (list, fallback) => {
    const arr = (Array.isArray(list) ? list : []).filter((x) => x != null && String(x).trim());
    if (!arr.length) return fallback || '';
    for (let attempt = 0; attempt < arr.length * 2; attempt++) {
      const raw = arr[Math.floor(next() * arr.length)];
      const line = fill(raw, { brand, focus, area: src.area });
      const key = line.toLowerCase();
      if (used.has(key) || avoid.has(key)) continue;
      used.add(key);
      return line;
    }
    // pool exhausted: reusing one line beats printing nothing
    const line = fill(arr[Math.floor(next() * arr.length)], { brand, focus, area: src.area });
    used.add(line.toLowerCase());
    return line;
  };

  // ---- about ----
  const aboutBase = fill(type.about || '{brand} is here for {focus}.', { brand, focus, area: src.area });
  let aboutText = aboutBase;
  const close = pickOne(pool.aboutClose, '');
  if (close && aboutText.length < 420 && !aboutText.toLowerCase().includes(close.toLowerCase().slice(0, 24))) {
    aboutText = aboutText.replace(/\s+$/, '') + ' ' + close;
  }

  // bullets: register-appropriate, and one of them names the area when known
  const bulletPool = (pool.bullets || []).slice();
  const bullets = [];
  if (src.area && bulletPool.some((b) => String(b).includes('{area}'))) {
    bullets.push({ icon: '\u2713', title: pickOne(bulletPool.filter((b) => String(b).includes('{area}'))) });
  }
  const wantBullets = 3;
  let guard = 0;
  while (bullets.length < wantBullets && guard++ < 24) {
    const rest = bulletPool.filter((b) => !String(b).includes('{area}') || src.area);
    const line = pickOne(rest);
    if (!line) break;
    if (bullets.some((b) => b.title.toLowerCase() === line.toLowerCase())) continue;
    bullets.push({ icon: '\u2713', title: line });
  }

  // ---- proofs take the wheel ----
  // When the client states real facts, they drive the titles AND the bodies,
  // and the section header must honestly frame them.
  const proofs = (Array.isArray(src.proofs) ? src.proofs : [])
    .map((p) => String(p == null ? '' : p).trim())
    .filter(Boolean);
  const industryFeatures = (type.features || []).map((it) => ({ ...it }));
  const featuresItems = industryFeatures.slice();
  if (proofs.length) {
    featuresItems.forEach((it, i) => {
      const proof = proofs[i];
      if (!proof) return;
      const head = titleFromProof(proof);
      // keep the industry icon, replace the claim with the client's own
      if (head) featuresItems[i] = { ...it, title: head, text: proof };
      else featuresItems[i] = { ...it, text: proof };
    });
    // a fourth proof, if given, extends the row rather than being dropped
    if (proofs.length > featuresItems.length) {
      const icons = industryFeatures.map((f) => f.icon).filter(Boolean);
      for (let i = featuresItems.length; i < proofs.length && i < 6; i++) {
        featuresItems.push({
          icon: icons[i % (icons.length || 1)] || '\u2726',
          title: titleFromProof(proofs[i]) || 'What you get',
          text: proofs[i], extra: '', tag: '', image: ''
        });
      }
    }
  }

  const featuresTitle = proofs.length
    ? pickOne(['What you get', 'Why people choose {brand}', 'What is included', 'Why clients pick {brand}'])
    : pickOne(pool.featuresTitle, 'What we do');
  const featuresSub = proofs.length
    ? pickOne(['Straight from us \u2014 no embellishment.', 'The things we promise, in our own words.'])
    : pickOne(pool.featuresSub, '');

  // ---- assemble the bank ----
  const heroText = aboutText.length > 220 ? clipChars(aboutText, 217) + '\u2026' : aboutText;
  const bank = {
    hero: { title: '', subtitle: fill(pickOneSafe(type.taglines, next), { brand, focus, area: src.area }), text: heroText, animation: 'zoom-in' },
    about: { title: pickOne(pool.aboutTitle, 'About us'), text: aboutText, items: bullets, animation: 'slide-left' },
    features: { title: featuresTitle, subtitle: featuresSub, items: featuresItems, animation: 'fade-up' },
    stats: { title: pickOne(pool.statsTitle, 'By the numbers'), items: (type.stats || []).map((it) => ({ ...it })), animation: 'fade-up' },
    gallery: {
      title: pickOne(pool.galleryTitle, 'Recent work'),
      subtitle: pickOne(pool.gallerySub, ''),
      items: (type.gallery || ['Work one', 'Work two', 'Work three']).map((c, i) => ({ text: c, extra: 'Featured ' + (i + 1) })),
      animation: 'fade-up'
    },
    pricing: { title: pickOne(pool.pricingTitle, 'Pricing'), subtitle: pickOne(pool.pricingSub, ''), items: (type.pricing || []).map((it) => ({ ...it })), animation: 'fade-up' },
    testimonials: { title: pickOne(pool.testimonialsTitle, 'What people say'), subtitle: pickOne(pool.testimonialsSub, ''), items: (type.testis || []).map((it) => ({ ...it })), animation: 'fade-up' },
    faq: { title: pickOne(pool.faqTitle, 'Questions'), items: (type.faqs || []).map((it) => ({ ...it })), animation: 'fade-up' },
    cta: { title: pickOne(pool.ctaTitle, 'Get in touch'), text: pickOne(pool.ctaText, ''), animation: 'bounce-in' },
    contact: { title: pickOne(pool.contactTitle, 'Get in touch'), subtitle: pickOne(pool.contactSub, ''), animation: 'fade-up' }
  };

  // the client's own offer is the strongest tagline available
  if (src.offer) bank.hero.subtitle = String(src.offer).trim();

  return { bank, register: register };
}

function pickOneSafe(list, next) {
  const arr = (Array.isArray(list) ? list : []).filter((x) => x != null && String(x).trim());
  if (!arr.length) return '';
  return arr[Math.floor(next() * arr.length)];
}

const Copy = { build, registerFor, titleFromProof, applyTone, pageIntro, PAGE_INTRO, POOLS, REGISTER_OF_TYPE };
if (typeof module !== 'undefined' && module.exports) module.exports = Copy;

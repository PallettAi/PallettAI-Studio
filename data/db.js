// ============================================================
// PallettAI Studio — local database
// Templates, sections, palettes, fonts, animations, upgrade suites
// ============================================================

const DB = {
  version: '1.3.0',

  // ---------- Color palettes ----------
  palettes: [
    { id: 'midnight', name: 'Midnight Violet', bg: '#0b1020', surface: '#141b33', primary: '#7c5cff', accent: '#22d3ee', text: '#eef1fb', muted: '#9aa3c0', dark: true },
    { id: 'aurora',   name: 'Aurora Sky',     bg: '#f6f9ff', surface: '#ffffff', primary: '#0ea5e9', accent: '#10b981', text: '#0f172a', muted: '#5b6b84', dark: false },
    { id: 'sunset',   name: 'Sunset Glow',    bg: '#fff8f0', surface: '#ffffff', primary: '#f97316', accent: '#ec4899', text: '#3c1e0a', muted: '#8a6a50', dark: false },
    { id: 'emerald',  name: 'Emerald Isle',   bg: '#f2fbf6', surface: '#ffffff', primary: '#059669', accent: '#f59e0b', text: '#052e16', muted: '#4d7a66', dark: false },
    { id: 'cherry',   name: 'Cherry Pop',     bg: '#fdf2f8', surface: '#ffffff', primary: '#e11d48', accent: '#7c3aed', text: '#4c0519', muted: '#8f6474', dark: false },
    { id: 'ocean',    name: 'Deep Ocean',     bg: '#eef5ff', surface: '#ffffff', primary: '#2563eb', accent: '#06b6d4', text: '#172554', muted: '#5c6f96', dark: false },
    { id: 'noir',     name: 'Studio Noir',    bg: '#101014', surface: '#1b1b21', primary: '#f5f5f4', accent: '#a3e635', text: '#fafaf9', muted: '#9d9da8', dark: true },
    { id: 'candy',    name: 'Candy Pop',      bg: '#ffffff', surface: '#fef2f8', primary: '#ec4899', accent: '#8b5cf6', text: '#1e1b4b', muted: '#70698b', dark: false },
    // ---- style-pack palettes (applied by AI style packs) ----
    { id: 'pack_glass',  name: 'Glass Frost',   bg: '#0c1128', surface: '#1c2447', primary: '#8b7bff', accent: '#4cc9f0', text: '#eef0ff', muted: '#9aa4cf', dark: true },
    { id: 'pack_brutal', name: 'Brutal Paper',  bg: '#f3eee4', surface: '#ffffff', primary: '#101014', accent: '#ff3d2e', text: '#17130c', muted: '#6f675a', dark: false },
    { id: 'pack_retro',  name: 'Neo Retro',     bg: '#f9e8c9', surface: '#fff8e9', primary: '#1f6f78', accent: '#e07a1f', text: '#31200c', muted: '#766441', dark: false },
    { id: 'pack_editorial', name: 'Editorial Ink', bg: '#faf9f6', surface: '#ffffff', primary: '#17181c', accent: '#c8442f', text: '#1c1d22', muted: '#6b6d76', dark: false },
    { id: 'pack_cosmic', name: 'Cosmic Dusk',   bg: '#0a0620', surface: '#181136', primary: '#a78bfa', accent: '#f472b6', text: '#f1edff', muted: '#9f94cf', dark: true },
    { id: 'pack_lux',    name: 'Luxury Gold',   bg: '#0d0c11', surface: '#1a1722', primary: '#d4af37', accent: '#f3e5ab', text: '#f6f1e4', muted: '#a89f8a', dark: true },
    { id: 'pack_zen',    name: 'Zen Sage',      bg: '#f2f4ef', surface: '#ffffff', primary: '#4a7c59', accent: '#c9a227', text: '#1d2b20', muted: '#5f7163', dark: false },
    // ---- industry palettes (Phase 1 templates) ----
    { id: 'blush',     name: 'Rose Blush',     bg: '#fff8f6', surface: '#ffffff', primary: '#b76e79', accent: '#d4a373', text: '#43242c', muted: '#8d6872', dark: false },
    { id: 'terracotta', name: 'Terracotta',    bg: '#fdf3ec', surface: '#ffffff', primary: '#c65f3a', accent: '#6f9e7c', text: '#33251c', muted: '#7d6758', dark: false },
    { id: 'stone',     name: 'Slate Stone',    bg: '#f4f6f8', surface: '#ffffff', primary: '#244a5e', accent: '#c8a96a', text: '#152530', muted: '#5a6e7c', dark: false },
    // ---- AI Studio design DNA palettes (AA-safe; tuned by the contrast audit) ----
    { id: 'ink',       name: 'Graphite Ink',   bg: '#14161d', surface: '#1d2029', primary: '#9db4f8', accent: '#5eead4', text: '#f2f4f8', muted: '#9aa4b8', dark: true },
    { id: 'cobalt',    name: 'Signal Blue',    bg: '#0a1628', surface: '#101f38', primary: '#4f9cf7', accent: '#22d3ee', text: '#eef4ff', muted: '#93a7c9', dark: true },
    { id: 'grape',     name: 'Deep Grape',     bg: '#16102a', surface: '#211740', primary: '#c4b5fd', accent: '#7fe3f0', text: '#f4efff', muted: '#a89cc9', dark: true },
    { id: 'pine',      name: 'Forest Noir',    bg: '#0c1512', surface: '#15221d', primary: '#63e6a4', accent: '#f4c95d', text: '#ecf7f0', muted: '#8fb2a0', dark: true },
    { id: 'roast',     name: 'Midnight Roast', bg: '#19110c', surface: '#261a12', primary: '#fbbf24', accent: '#fb7185', text: '#f8f1e8', muted: '#bfa38c', dark: true },
    { id: 'paper',     name: 'Warm Paper',     bg: '#f6f1e7', surface: '#ffffff', primary: '#b45309', accent: '#0f766e', text: '#231c12', muted: '#6f6653', dark: false },
    { id: 'sage',      name: 'Garden Sage',    bg: '#eef1e7', surface: '#ffffff', primary: '#2f6b4f', accent: '#c77f2e', text: '#1a241c', muted: '#55614f', dark: false },
    { id: 'mulberry',  name: 'Mulberry Mist',  bg: '#f7eff4', surface: '#ffffff', primary: '#8c2f5b', accent: '#d4a373', text: '#2a1622', muted: '#7d5f6e', dark: false },
    { id: 'lagoon',    name: 'Lagoon Fresh',   bg: '#e9f4f4', surface: '#ffffff', primary: '#0f6f6f', accent: '#d97706', text: '#0e2626', muted: '#4f6b6b', dark: false }
  ],

  // ---------- Fonts (loaded from Google Fonts CDN when online) ----------
  // cat: sans | serif | display | mono | hand   tier: '' free · 'pro' Premium Font Pack
  // logo: false keeps plain workhorse faces out of the Logo Studio picker
  fonts: [
    // ---- Sans (core) ----
    { id: 'inter',        name: 'Inter',            css: "'Inter', sans-serif",            weight: '400;500;600;700;800', cat: 'sans' },
    { id: 'poppins',      name: 'Poppins',          css: "'Poppins', sans-serif",          weight: '400;500;600;700', cat: 'sans' },
    { id: 'spacegrotesk', name: 'Space Grotesk',    css: "'Space Grotesk', sans-serif",    weight: '400;500;600;700', cat: 'sans' },
    { id: 'sora',         name: 'Sora',             css: "'Sora', sans-serif",             weight: '400;500;600;700;800', cat: 'sans' },
    { id: 'outfit',       name: 'Outfit',           css: "'Outfit', sans-serif",           weight: '400;500;600;700', cat: 'sans' },
    { id: 'manrope',      name: 'Manrope',          css: "'Manrope', sans-serif",          weight: '400;500;600;700;800', cat: 'sans' },
    { id: 'montserrat',   name: 'Montserrat',       css: "'Montserrat', sans-serif",       weight: '400;500;600;700;800', cat: 'sans' },
    { id: 'plusjakarta',  name: 'Plus Jakarta Sans', css: "'Plus Jakarta Sans', sans-serif", weight: '400;500;600;700;800', cat: 'sans', logo: false },
    { id: 'dmsans',       name: 'DM Sans',          css: "'DM Sans', sans-serif",          weight: '400;500;600;700', cat: 'sans', logo: false },
    { id: 'figtree',      name: 'Figtree',          css: "'Figtree', sans-serif",          weight: '400;500;600;700;800', cat: 'sans', logo: false },
    { id: 'worksans',     name: 'Work Sans',        css: "'Work Sans', sans-serif",        weight: '400;500;600;700', cat: 'sans', logo: false },
    { id: 'lexend',       name: 'Lexend',           css: "'Lexend', sans-serif",           weight: '400;500;600;700;800', cat: 'sans', logo: false },
    { id: 'raleway',      name: 'Raleway',          css: "'Raleway', sans-serif",          weight: '400;500;600;700;800', cat: 'sans', logo: false },
    // ---- Serif (core) ----
    { id: 'playfair',     name: 'Playfair Display', css: "'Playfair Display', serif",      weight: '400;500;600;700;800;900', cat: 'serif' },
    { id: 'dmserif',      name: 'DM Serif Display', css: "'DM Serif Display', serif",      weight: '400', cat: 'serif' },
    { id: 'newsreader',   name: 'Newsreader',      css: "'Newsreader', serif",              weight: '400;500;600;700', cat: 'serif' },
    { id: 'lora',         name: 'Lora',             css: "'Lora', serif",                  weight: '400;500;600;700', cat: 'serif', logo: false },
    { id: 'sourceserif',  name: 'Source Serif 4',   css: "'Source Serif 4', serif",        weight: '400;600;700', cat: 'serif', logo: false },
    { id: 'merriweather', name: 'Merriweather',      css: "'Merriweather', serif",          weight: '400;700;900', cat: 'serif', logo: false },
    // ---- Display (core) ----
    { id: 'bebas',        name: 'Bebas Neue',       css: "'Bebas Neue', sans-serif",       weight: '400', cat: 'display' },
    { id: 'oswald',       name: 'Oswald',           css: "'Oswald', sans-serif",           weight: '400;500;600;700', cat: 'display' },
    // ---- Mono (core) ----
    { id: 'jetbrains',    name: 'JetBrains Mono',   css: "'JetBrains Mono', monospace",    weight: '400;500;600;700', cat: 'mono' },
    // ---- Hand (core) ----
    { id: 'pacifico',     name: 'Pacifico',         css: "'Pacifico', cursive",            weight: '400', cat: 'hand' },
    // ---- Free additions (OFL, commercially safe) ----
    { id: 'archivo',      name: 'Archivo',          css: "'Archivo', sans-serif",         weight: '400;500;600;700', cat: 'sans', logo: false },
    { id: 'barlow',       name: 'Barlow',           css: "'Barlow', sans-serif",           weight: '400;500;600;700', cat: 'sans', logo: false },
    { id: 'literata',     name: 'Literata',         css: "'Literata', serif",             weight: '400;500;600;700', cat: 'serif', logo: false },
    { id: 'notoserif',    name: 'Noto Serif',       css: "'Noto Serif', serif",            weight: '400;600;700', cat: 'serif', logo: false },
    // ---- Premium Font Pack (Pro) ----
    { id: 'syne',         name: 'Syne',             css: "'Syne', sans-serif",             weight: '400;500;600;700;800', cat: 'display', tier: 'pro' },
    { id: 'unbounded',    name: 'Unbounded',        css: "'Unbounded', sans-serif",        weight: '400;500;600;700;800;900', cat: 'display', tier: 'pro' },
    { id: 'anton',        name: 'Anton',            css: "'Anton', sans-serif",            weight: '400', cat: 'display', tier: 'pro' },
    { id: 'archivoblack', name: 'Archivo Black',    css: "'Archivo Black', sans-serif",    weight: '400', cat: 'display', tier: 'pro' },
    { id: 'righteous',    name: 'Righteous',        css: "'Righteous', sans-serif",        weight: '400', cat: 'display', tier: 'pro' },
    { id: 'alfaslab',     name: 'Alfa Slab One',    css: "'Alfa Slab One', serif",         weight: '400', cat: 'display', tier: 'pro' },
    { id: 'fraunces',     name: 'Fraunces',         css: "'Fraunces', serif",              weight: '400;500;600;700;900', cat: 'serif', tier: 'pro' },
    { id: 'bodoni',       name: 'Bodoni Moda',      css: "'Bodoni Moda', serif",           weight: '400;500;600;700;800', cat: 'serif', tier: 'pro' },
    { id: 'cormorant',    name: 'Cormorant Garamond', css: "'Cormorant Garamond', serif", weight: '400;500;600;700', cat: 'serif', tier: 'pro' },
    { id: 'caveat',       name: 'Caveat',           css: "'Caveat', cursive",              weight: '400;500;600;700', cat: 'hand', tier: 'pro' },
    { id: 'dancingscript', name: 'Dancing Script',  css: "'Dancing Script', cursive",      weight: '400;500;600;700', cat: 'hand', tier: 'pro' },
    { id: 'greatvibes',   name: 'Great Vibes',      css: "'Great Vibes', cursive",         weight: '400', cat: 'hand', tier: 'pro' },
    { id: 'firacode',     name: 'Fira Code',        css: "'Fira Code', monospace",         weight: '400;500;600;700', cat: 'mono', tier: 'pro' },
    { id: 'spacemono',    name: 'Space Mono',       css: "'Space Mono', monospace",        weight: '400;700', cat: 'mono', tier: 'pro' }
  ],

  // ---------- Animations ----------
  animations: [
    { id: 'none',       name: 'None',           css: '' },
    { id: 'fade-up',    name: 'Fade Up',        css: 'opacity:0;transform:translateY(28px)' },
    { id: 'fade-in',    name: 'Fade In',        css: 'opacity:0' },
    { id: 'slide-left', name: 'Slide In Left',  css: 'opacity:0;transform:translateX(-40px)' },
    { id: 'slide-right',name: 'Slide In Right', css: 'opacity:0;transform:translateX(40px)' },
    { id: 'zoom-in',    name: 'Zoom In',        css: 'opacity:0;transform:scale(.85)' },
    { id: 'flip-up',    name: 'Flip Up',        css: 'opacity:0;transform:perspective(900px) rotateX(-14deg) translateY(20px)' },
    { id: 'bounce-in',  name: 'Bounce In',      css: 'opacity:0;transform:translateY(40px) scale(.96)' }
  ],

  // ---------- Section types ----------
  sectionTypes: {
    hero:         { name: 'Hero',         icon: '🚀', desc: 'Big headline banner with CTA', defaultItems: 0 },
    features:     { name: 'Features',     icon: '✨', desc: 'Grid of feature cards', defaultItems: 3 },
    stats:        { name: 'Stats',        icon: '📊', desc: 'Animated counters', defaultItems: 4 },
    about:        { name: 'About',        icon: '👋', desc: 'Image + text story', defaultItems: 0 },
    gallery:      { name: 'Gallery',      icon: '🖼️', desc: 'Image grid with lightbox', defaultItems: 6 },
    pricing:      { name: 'Pricing',      icon: '💎', desc: 'Three pricing tiers', defaultItems: 3 },
    testimonials: { name: 'Testimonials', icon: '💬', desc: 'Client quotes with avatars', defaultItems: 3 },
    faq:          { name: 'FAQ',          icon: '❓', desc: 'Accordion questions', defaultItems: 4 },
    blog:         { name: 'Blog',         icon: '📝', desc: 'Post cards (Blog Suite)', defaultItems: 3 },
    shop:         { name: 'Shop',         icon: '🛍️', desc: 'Products + cart (Shop Suite)', defaultItems: 4 },
    logos:        { name: 'Logos Strip',  icon: '🏷️', desc: 'Trusted-by marquee of client wordmarks', defaultItems: 6 },
    video:        { name: 'Video Embed',  icon: '🎬', desc: 'YouTube/Vimeo embed (URL in “extra”)', defaultItems: 0 },
    countdown:    { name: 'Countdown',    icon: '⏳', desc: 'Live countdown to a launch date (ISO date in “extra”)', defaultItems: 0 },
    map:          { name: 'Map',          icon: '🗺️', desc: 'Google Maps embed for an address (address in “extra”)', defaultItems: 0 },
    weather:      { name: 'Weather',      icon: '🌤️', desc: 'Live 5-day forecast for a city (city in “extra”)', defaultItems: 0 },
    embed:        { name: 'Embed',        icon: '🔗', desc: 'Any iframe — Spotify, Calendly, Typeform (URL in “extra”)', defaultItems: 0 },
    booking:      { name: 'Booking',      icon: '📅', desc: 'Dedicated appointment booking block — Calendly, Cal.com, TidyCal and more', defaultItems: 0 },
    contact:      { name: 'Contact',      icon: '✉️', desc: 'Form, info, map', defaultItems: 0 },
    cta:          { name: 'CTA Banner',   icon: '📣', desc: 'Call to action strip', defaultItems: 0 },
    crypto:       { name: 'Crypto Ticker', icon: '🪙', desc: 'Live coin prices (coin ids in “extra”, e.g. bitcoin,ethereum) — Pro', defaultItems: 0 },
    github:       { name: 'GitHub Stats', icon: '🐙', desc: 'Live profile + repos for a GitHub username (“extra”) — Pro', defaultItems: 0 },
    fx:           { name: 'FX Rates',     icon: '💱', desc: 'Live exchange rates (base currency in “extra”, e.g. GBP) — Pro', defaultItems: 0 },
    table:        { name: 'Table',       icon: '📋', desc: 'Clean data tables — comparisons, menus, schedules, specs. Headings in “cols”, one row per line', defaultItems: 0 },
    collection:   { name: 'Collection',  icon: '🗂️', desc: 'Your own dynamic card gallery — category chips, live search & sort. Works on any static host, no server', defaultItems: 6 }
  },

  // ---------- Integrations (free & keyless-first) ----------
  integrations: [
    { id: 'maps', name: 'Google Maps', icon: '🗺️', kind: 'section', sectionType: 'map', desc: 'Embed a live map for any address — no API key, no signup.', action: 'Add map section' },
    { id: 'weather', name: 'Open-Meteo', icon: '🌤️', kind: 'section', sectionType: 'weather', desc: 'Live 5-day forecast for any city — free, keyless, unlimited.', action: 'Add weather section' },
    { id: 'embed', name: 'Universal Embed', icon: '🔗', kind: 'section', sectionType: 'embed', desc: 'Embed anything with an iframe URL: Spotify playlists, Calendly, Typeform, Figma…', action: 'Add embed section' },
    { id: 'booking', name: 'Online Booking', icon: '📅', kind: 'section', sectionType: 'booking', desc: 'A purpose-built appointment block for Calendly, Cal.com, TidyCal and other booking links — no API key.', action: 'Add booking section' },
    { id: 'dicebear', name: 'DiceBear Avatars', icon: '🧑‍🎨', kind: 'tool', desc: 'Generate unlimited illustrated avatars from a name — free & keyless. Perfect for testimonials.', action: 'Fetch 8 avatars' },
    { id: 'tawk', name: 'Tawk.to Live Chat', icon: '💬', kind: 'chat', desc: 'Drop a free live-chat widget on your site. Create a property at tawk.to first, then paste its ID.', action: 'Configure chat widget' },
    { id: 'crypto', name: 'CoinGecko Crypto', icon: '🪙', kind: 'section', sectionType: 'crypto', tier: 'pro', desc: 'Live prices for 12,000+ coins — free & keyless. Type coin ids (e.g. bitcoin,ethereum) in the section editor.', action: 'Add crypto ticker' },
    { id: 'github', name: 'GitHub Stats', icon: '🐙', kind: 'section', sectionType: 'github', tier: 'pro', desc: 'Live profile card and recent repos for any GitHub user — free & keyless. Type a username in the section editor.', action: 'Add GitHub stats' },
    { id: 'fx', name: 'FX Rates (ECB)', icon: '💱', kind: 'section', sectionType: 'fx', tier: 'pro', desc: 'Daily exchange rates for 30+ currencies, straight from the European Central Bank via Frankfurter — free & keyless.', action: 'Add FX widget' }
  ],

  // ---------- Booking providers ----------
  // The booking block deliberately uses provider pages in an iframe rather than
  // provider SDKs. That keeps exported sites standalone and lets clients change
  // providers without rebuilding the rest of the site.
  bookingProviders: [
    { id: 'calendly', name: 'Calendly', placeholder: 'https://calendly.com/your-name/30min', hint: 'Paste a public Calendly scheduling link.' },
    { id: 'calcom', name: 'Cal.com', placeholder: 'https://cal.com/your-name/30min', hint: 'Paste a public Cal.com booking link.' },
    { id: 'tidycal', name: 'TidyCal', placeholder: 'https://tidycal.com/your-name/booking', hint: 'Paste a public TidyCal booking link.' },
    { id: 'youcanbookme', name: 'YouCanBookMe', placeholder: 'https://yourname.youcanbook.me/', hint: 'Paste your public booking page.' },
    { id: 'square', name: 'Square Appointments', placeholder: 'https://square.site/book/…', hint: 'Paste your public Square booking link.' },
    { id: 'custom', name: 'Other booking link', placeholder: 'https://booking.example.com/…', hint: 'Any HTTPS booking page that permits embedding.' }
  ],

  // ---------- Templates ----------
  templates: [
    {
      id: 'launchpad', name: 'Launchpad', icon: '🚀', tag: 'Startup', palette: 'midnight', font: 'spacegrotesk',
      desc: 'A bold SaaS landing page: hero, features, stats, pricing, social proof, contact.',
      sections: [
        { type: 'hero', animation: 'zoom-in' },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '⚡', title: 'Lightning Fast', text: 'Blazing performance on every device with a buttery-smooth experience.' },
          { icon: '🔒', title: 'Secure by Design', text: 'Bank-grade encryption and privacy controls built in from day one.' },
          { icon: '🧩', title: 'Plays Well Together', text: 'Integrates with the tools your team already loves and uses daily.' }
        ] },
        { type: 'stats', animation: 'fade-up', items: [
          { title: 'Active Users', text: '48K+' }, { title: 'Uptime', text: '99.99%' }, { title: 'Countries', text: '120+' }, { title: 'Avg. Speed', text: '0.8s' }
        ] },
        { type: 'pricing', animation: 'fade-up', items: [
          { icon: '🌱', title: 'Starter', text: '£9 /mo', tag: '', extra: '1 project · 5k visitors · Email support' },
          { icon: '⚡', title: 'Pro', text: '£29 /mo', tag: 'Popular', extra: '10 projects · Unlimited visitors · Priority support' },
          { icon: '🏢', title: 'Scale', text: '£79 /mo', tag: '', extra: 'Unlimited projects · SLA · Dedicated manager' }
        ] },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Maya Chen', text: 'We doubled conversion in six weeks. The launchpad template paid for itself in days.', extra: 'CEO, Nortide' },
          { title: 'Leo Fischer', text: 'Beautiful, fast, and the suites let us upgrade without rebuilding anything.', extra: 'Founder, Draftline' },
          { title: 'Ava Okafor', text: 'Finally a builder that ships sites clients actually love to show off.', extra: 'Designer, Studio Kala' }
        ] },
        { type: 'cta', animation: 'bounce-in', title: 'Ready to launch?', text: 'Start your free trial today — no credit card required.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'lumina', name: 'Lumina', icon: '🌟', tag: 'Agency', palette: 'aurora', font: 'sora',
      desc: 'A luminous agency portfolio: hero, work showcase, gallery, testimonials, contact.',
      sections: [
        { type: 'hero', animation: 'fade-in' },
        { type: 'about', animation: 'slide-left' },
        { type: 'gallery', animation: 'fade-up', items: [
          { text: 'Brand identity for Solace', extra: 'Branding' }, { text: 'App design — Drift', extra: 'Product' },
          { text: 'Campaign — Wildfire', extra: 'Marketing' }, { text: 'Editorial — Northwind', extra: 'Print' },
          { text: 'Website — Kite Studio', extra: 'Web' }, { text: 'Packaging — Terra', extra: 'Packaging' }
        ] },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Sofia Reyes', text: 'Lumina gave our brand a voice clients instantly remember.', extra: 'CMO, Solace' },
          { title: 'Daniel Kim', text: 'The animations feel alive without being distracting. Perfect balance.', extra: 'Director, Kite Studio' },
          { title: 'Hana Yoshida', text: 'Our new site won two awards in its first month live.', extra: 'Founder, Terra' }
        ] },
        { type: 'cta', animation: 'fade-up', title: 'Let’s make something luminous', text: 'Tell us about your project — we reply within 24 hours.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'bloom', name: 'Bloom', icon: '🌸', tag: 'Small Business', palette: 'candy', font: 'poppins',
      desc: 'A warm, friendly site for local businesses: story, services, work, contact.',
      sections: [
        { type: 'hero', animation: 'bounce-in' },
        { type: 'about', animation: 'slide-right' },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '💐', title: 'Custom Arrangements', text: 'Every order designed by hand with the freshest seasonal blooms.' },
          { icon: '🚚', title: 'Same-Day Delivery', text: 'In the city by 2pm? On your doorstep before dinner.' },
          { icon: '💳', title: 'Easy Booking', text: 'Order online in minutes. Weddings planned end-to-end.' }
        ] },
        { type: 'gallery', animation: 'fade-up' },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Emma Larsen', text: 'The wedding flowers were beyond anything we imagined. Thank you!', extra: 'Wedding client' },
          { title: 'Tom Bisset', text: 'Weekly bouquet subscription is the highlight of my Mondays.', extra: 'Subscriber' },
          { title: 'Priya Nair', text: 'Beautiful, fresh, and delivered with a smile every single time.', extra: 'Local customer' }
        ] },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'meridian', name: 'Meridian', icon: '🎨', tag: 'Portfolio', palette: 'noir', font: 'playfair',
      desc: 'A dramatic one-page portfolio: cinematic hero, work grid, story, contact.',
      sections: [
        { type: 'hero', animation: 'zoom-in' },
        { type: 'gallery', animation: 'fade-up', items: [
          { text: 'Selected work 01', extra: '2025' }, { text: 'Selected work 02', extra: '2024' },
          { text: 'Selected work 03', extra: '2024' }, { text: 'Selected work 04', extra: '2023' }
        ] },
        { type: 'about', animation: 'slide-left' },
        { type: 'cta', animation: 'fade-up', title: 'Have a project in mind?', text: 'Commissions open for this season.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'forge', name: 'Forge', icon: '⚙️', tag: 'Product', palette: 'ocean', font: 'inter',
      desc: 'A conversion-focused product page: problem, features, proof, pricing, FAQ.',
      sections: [
        { type: 'hero', animation: 'fade-up' },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '🗄️', title: 'Unlimited Storage', text: 'Keep every file, version, and backup without ever worrying about space.' },
          { icon: '🤝', title: 'Team Workspaces', text: 'Shared spaces with granular permissions and audit logs.' },
          { icon: '🛠️', title: 'Automations', text: 'Turn repetitive work into one-click flows your whole team uses.' },
          { icon: '📈', title: 'Deep Analytics', text: 'Understand usage, growth, and churn in real time.' }
        ] },
        { type: 'stats', animation: 'fade-up', items: [
          { title: 'Customers', text: '9,400+' }, { title: 'Reviews', text: '4.9★' }, { title: 'Support', text: '24/7' }, { title: 'Apps', text: '60+' }
        ] },
        { type: 'pricing', animation: 'fade-up' },
        { type: 'faq', animation: 'fade-up', items: [
          { title: 'How does the free plan work?', text: 'The free plan includes 2 GB storage and up to 3 members — no credit card required.' },
          { title: 'Can I cancel anytime?', text: 'Yes. Cancel in one click from your billing settings; you keep your data for 30 days.' },
          { title: 'Is my data encrypted?', text: 'All data is encrypted in transit and at rest with AES-256.' },
          { title: 'Do you offer student discounts?', text: 'Students and educators get 50% off any paid plan with a valid .edu email.' }
        ] },
        { type: 'cta', animation: 'bounce-in', title: 'Build something that lasts', text: 'Join 9,400+ teams forging their future with Forge.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'voyage', name: 'Voyage', icon: '🧭', tag: 'Travel & Food', palette: 'sunset', font: 'dmserif',
      desc: 'A wanderlust site for travel or hospitality: journey, highlights, reviews, FAQ.',
      sections: [
        { type: 'hero', animation: 'slide-right' },
        { type: 'about', animation: 'slide-left' },
        { type: 'gallery', animation: 'fade-up', items: [
          { text: 'Coastal trails', extra: 'Day 1' }, { text: 'Old town sunrise', extra: 'Day 2' },
          { text: 'Harbour evening', extra: 'Day 3' }, { text: 'Mountain ridge', extra: 'Day 4' },
          { text: 'Market colors', extra: 'Day 5' }, { text: 'Beach farewell', extra: 'Day 6' }
        ] },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Jonas Weber', text: 'Every itinerary detail was handled. We just showed up and enjoyed.', extra: 'Traveller' },
          { title: 'Clara Mbeki', text: 'The guides felt like old friends showing us their hometown.', extra: 'Traveller' },
          { title: 'Arun Patel', text: 'Best food tour of my life. Booked again for next spring.', extra: 'Foodie' }
        ] },
        { type: 'faq', animation: 'fade-up', items: [
          { title: 'What is your cancellation policy?', text: 'Free cancellation up to 14 days before departure, full refund within 7 days.' },
          { title: 'Are tours suitable for families?', text: 'Absolutely — we have dedicated family routes and child-friendly guides.' },
          { title: 'Do you offer private tours?', text: 'Yes, private tours are available for groups of any size. Contact us for a quote.' }
        ] },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'blank', name: 'Blank Canvas', icon: '🎛️', tag: 'Start from scratch', palette: 'midnight', font: 'inter',
      desc: 'An empty hero + contact page. Add any sections from the library.',
      sections: [
        { type: 'hero', animation: 'fade-up' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'ceremony', name: 'Ceremony', icon: '💍', tag: 'Wedding · Pro', palette: 'blush', font: 'cormorant',
      desc: 'A romantic wedding & events site: couple story, gallery, timeline, registry, RSVP.',
      sections: [
        { type: 'hero', animation: 'zoom-in' },
        { type: 'about', animation: 'slide-left', title: 'Our story', text: 'Two cities, one chance meeting, and a thousand little reasons since. Here we are — planning the party of a lifetime and we would love you to be part of it.', subtitle: 'The wedding of Amelia & James' },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '💒', title: 'The Ceremony', text: 'The Old Chapel, St Mary’s — 2pm sharp. Follow the garden path to the west lawn.' },
          { icon: '🥂', title: 'The Reception', text: 'Canapés in the orangery, dinner under the marquee, dancing until the candles burn low.' },
          { icon: '📸', title: 'Captured', text: 'Our photographer will be everywhere and nowhere — tag away with #AmeliaWedsJames.' }
        ] },
        { type: 'gallery', animation: 'fade-up', items: [
          { text: 'The proposal', extra: 'Lake Como' }, { text: 'Engagement', extra: 'Autumn' },
          { text: 'Save the date', extra: 'Card design' }, { text: 'Venue walkthrough', extra: 'Chapel' },
          { text: 'The dress', extra: 'Fittings' }, { text: 'Registry preview', extra: 'Honeymoon fund' }
        ] },
        { type: 'stats', animation: 'fade-up', items: [
          { title: 'Guests', text: '120' }, { title: 'Toasts', text: '3' }, { title: 'First dance', text: '1' }, { title: 'Party hours', text: '7+' }
        ] },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Emma & Tom', text: 'Amelia & James planned our day start to finish — calm, warm, and flawlessly run.', extra: 'Married 2024' },
          { title: 'Grace Liu', text: 'The flowers were the single most photographed thing at our wedding.', extra: 'Bride, 2023' }
        ] },
        { type: 'faq', animation: 'fade-up', items: [
          { title: 'When should I RSVP by?', text: 'Please let us know by 1 June so we can confirm numbers with the venue.' },
          { title: 'Is there parking?', text: 'Yes — the chapel has a private car park, and a shuttle runs from the village at 1pm.' },
          { title: 'Can I bring a plus one?', text: 'Your invitation states the number of seats reserved for you. If in doubt, drop us a line.' }
        ] },
        { type: 'cta', animation: 'fade-up', title: 'Join us on the big day', text: 'RSVP by 1 June — we can’t wait to celebrate with you.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'hearth', name: 'Hearth', icon: '☕', tag: 'Café & Bakery', palette: 'terracotta', font: 'poppins',
      desc: 'A neighbourhood café & bakery: seasonal menu, opening hours, gallery, reviews, order online.',
      sections: [
        { type: 'hero', animation: 'bounce-in' },
        { type: 'about', animation: 'slide-right', title: 'Slow mornings, honest baking', text: 'Hearth started with one sourdough starter and a very patient landlord. Today we bake everything in-house — bread at dawn, pastries twice daily, and a lunch menu that follows the seasons.', subtitle: 'Baking since 2016' },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '🥐', title: 'Bakery Counter', text: 'Croissants, cruffins and daily specials baked from our own leaven.' },
          { icon: '☕', title: 'House Roast', text: 'Single-origin beans from a family roastery 40 miles away, dialled in daily.' },
          { icon: '🥗', title: 'Kitchen Menu', text: 'Brunch till 3pm — eggs any way, big salads, and the best sandwiches in town.' }
        ] },
        { type: 'gallery', animation: 'fade-up' },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Rosa Lindqvist', text: 'The cardamom buns are a religious experience. I have tried to replicate them at home. I cannot.', extra: 'Local regular' },
          { title: 'Dev Sharma', text: 'Quiet enough to work, warm enough to linger, and the flat white never misses.', extra: 'Remote worker' },
          { title: 'Mia Okonkwo', text: 'We ordered the party box for the office — gone in eleven minutes.', extra: 'Office manager' }
        ] },
        { type: 'faq', animation: 'fade-up', items: [
          { title: 'Do you take bookings?', text: 'Walk-ins welcome all day. Tables for six or more can be reserved for weekends.' },
          { title: 'Is there vegan baking?', text: 'Every day — ask at the counter and we’ll talk you through the cabinet.' },
          { title: 'Can you cater events?', text: 'We do party boxes, celebration cakes and office drops. Order 48 hours ahead.' }
        ] },
        { type: 'cta', animation: 'bounce-in', title: 'Fresh batch out at 8am', text: 'Follow us for the daily special — or just come and smell the bread.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'apex', name: 'Apex', icon: '🏋️', tag: 'Fitness Studio', palette: 'emerald', font: 'oswald',
      desc: 'A high-energy fitness studio: classes, trainers, membership, schedule, results.',
      sections: [
        { type: 'hero', animation: 'fade-up' },
        { type: 'stats', animation: 'fade-up', items: [
          { title: 'Members', text: '1,200+' }, { title: 'Weekly classes', text: '80' }, { title: 'Avg. rating', text: '4.9★' }, { title: 'Trainers', text: '14' }
        ] },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '🔥', title: 'HIIT & Conditioning', text: 'Forty-five minutes, zero mercy, community atmosphere. Every hour, every day.' },
          { icon: '🏋️', title: 'Strength Club', text: 'Coach-led barbell work for every level — technique first, weight second.' },
          { icon: '🧘', title: 'Mobility & Recovery', text: 'Sweat less, move better. Stretch, roll and reset twice a week.' },
          { icon: '🥗', title: 'Nutrition Coaching', text: 'Meal plans and check-ins with our in-house nutritionist, included in membership.' }
        ] },
        { type: 'pricing', animation: 'fade-up', items: [
          { icon: '🎟️', title: 'Drop-in', text: '£12', tag: '', extra: 'Single session · all classes · towel hire' },
          { icon: '📅', title: 'Monthly', text: '£49 /mo', tag: 'Popular', extra: 'Unlimited classes · app booking · guest pass' },
          { icon: '🏆', title: 'Annual', text: '£449 /yr', tag: '', extra: 'Two months free · freeze anytime · PT discount' }
        ] },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Sam Whitfield', text: 'Lost 14kg and found a community I actually look forward to seeing.', extra: 'Member, 2 years' },
          { title: 'Priya Anand', text: 'The coaches know everyone’s name and every modification. It never feels like a chain gym.', extra: 'Member' },
          { title: 'Jon Bell', text: 'Signed up for a month. That was eleven months ago.', extra: 'Member' }
        ] },
        { type: 'cta', animation: 'bounce-in', title: 'Your first class is on us', text: 'Book a free session — no membership, no pressure, just show up.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'harbor', name: 'Harbor', icon: '🤝', tag: 'Nonprofit & Cause', palette: 'ocean', font: 'montserrat',
      desc: 'A cause-driven nonprofit site: mission, impact numbers, programmes, stories, donate.',
      sections: [
        { type: 'hero', animation: 'fade-up' },
        { type: 'about', animation: 'slide-left', title: 'Every child deserves a safe harbour', text: 'Harbor supports families facing homelessness with housing, mentoring and the practical help to get back on their feet. Since 2012 we’ve helped 4,300 families — and the work only grows with you.', subtitle: 'Our mission' },
        { type: 'stats', animation: 'fade-up', items: [
          { title: 'Families housed', text: '4,300' }, { title: 'Volunteers', text: '900+' }, { title: 'Local partners', text: '37' }, { title: 'Funds to programmes', text: '92%' }
        ] },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '🏠', title: 'Emergency Housing', text: 'Safe, furnished rooms within 48 hours — never a night on the street.' },
          { icon: '🎓', title: 'Mentoring & Skills', text: 'Twelve-month mentor pairings and job-readiness workshops for parents.' },
          { icon: '📦', title: 'Family Essentials', text: 'Food, clothing, school kits and household basics while families rebuild.' }
        ] },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Tanya, former guest', text: 'They gave us keys to a home, not just a room. Two years on, we have our own place.', extra: 'Programme graduate' },
          { title: 'Marcus Reed', text: 'Volunteering here changed how I think about my city.', extra: 'Volunteer' },
          { title: 'Helen Achebe', text: 'A transparent charity that tells you exactly where every pound goes.', extra: 'Monthly donor' }
        ] },
        { type: 'cta', animation: 'bounce-in', title: 'Give a family a safe harbour', text: '£25 covers a family’s essentials for a week. Every gift, however small, changes a story.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'chambers', name: 'Chambers', icon: '⚖️', tag: 'Legal', palette: 'stone', font: 'sourceserif',
      desc: 'A trusted law firm site: practice areas, team, results, process, consultations.',
      sections: [
        { type: 'hero', animation: 'fade-up' },
        { type: 'stats', animation: 'fade-up', items: [
          { title: 'Cases won', text: '2,400+' }, { title: 'Years' , text: '38' }, { title: 'Practice areas', text: '9' }, { title: 'Client rating', text: '4.9★' }
        ] },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '🏠', title: 'Property & Conveyancing', text: 'Residential sales and purchases handled end-to-end by a dedicated solicitor.' },
          { icon: '👥', title: 'Family Law', text: 'Divorce, mediation and children matters — clear advice when it matters most.' },
          { icon: '💼', title: 'Business & Contracts', text: 'Formation, shareholder agreements, disputes and day-to-day commercial advice.' },
          { icon: '📝', title: 'Wills & Estates', text: 'Will drafting, lasting powers of attorney and probate with compassion and care.' }
        ] },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'L. Hargreaves', text: 'Calm, straight-talking and worth every penny. They made the hardest year easier.', extra: 'Family law client' },
          { title: 'N. Ostrowski', text: 'Our purchase completed in nine weeks, exactly as promised, no surprises.', extra: 'Conveyancing client' },
          { title: 'R. Fontaine', text: 'They have handled our company contracts for a decade. Reliable beyond doubt.', extra: 'Business client' }
        ] },
        { type: 'faq', animation: 'fade-up', items: [
          { title: 'What does a first consultation cost?', text: 'The first 30-minute consultation is free for new clients, in person or by video.' },
          { title: 'Do you offer fixed fees?', text: 'Yes — conveyancing, wills and many family matters are quoted up front as fixed fees.' },
          { title: 'Are you regulated?', text: 'We are authorised and regulated by the Solicitors Regulation Authority.' }
        ] },
        { type: 'cta', animation: 'fade-up', title: 'Advice you can act on', text: 'Book a free 30-minute consultation with the right solicitor for your matter.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'airwaves', name: 'Airwaves', icon: '🎙️', tag: 'Podcast & Creator', palette: 'midnight', font: 'spacegrotesk',
      desc: 'A podcast & creator hub: episode list, listening links, host bio, subscribe.',
      sections: [
        { type: 'hero', animation: 'zoom-in' },
        { type: 'stats', animation: 'fade-up', items: [
          { title: 'Episodes', text: '210' }, { title: 'Monthly listens', text: '86K' }, { title: 'Countries', text: '41' }, { title: 'Avg. rating', text: '4.8★' }
        ] },
        { type: 'blog', animation: 'fade-up', items: [
          { icon: 'EP 210', title: 'The quiet power of saying no', text: 'We talk boundaries with author Maya Lind — why protecting your focus is the highest-leverage skill in a noisy world.', extra: 'Released this week · 54 min' },
          { icon: 'EP 209', title: 'Building in public, honestly', text: 'Founder Dev Sharma on shipping ugly early, sharing numbers monthly, and why transparency compounds.', extra: 'Listeners’ favourite · 47 min' },
          { icon: 'EP 208', title: 'The economics of creativity', text: 'How three working artists actually make a living — commissions, licenses and the long tail.', extra: 'Season 4 opener · 61 min' }
        ] },
        { type: 'about', animation: 'slide-left', title: 'Two hosts, one mic', text: 'Airwaves is a weekly conversation about work, creativity and modern life. New episodes every Thursday — wherever you get your podcasts.', subtitle: 'Hosted by Sam & Ria' },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Listener review', text: 'The only podcast I actually schedule into my week. Feels like brilliant friends talking.', extra: '★★★★★' },
          { title: 'Listener review', text: 'Genuinely useful ideas, not just hot takes. The notes page is a goldmine.', extra: '★★★★★' }
        ] },
        { type: 'cta', animation: 'bounce-in', title: 'New episodes every Thursday', text: 'Subscribe free on your favourite app — never miss an episode.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'gala', name: 'Gala', icon: '🥂', tag: 'Events & Parties', palette: 'candy', font: 'playfair',
      desc: 'An event planning & entertainment brand: event types, gallery, timeline, booking.',
      sections: [
        { type: 'hero', animation: 'zoom-in' },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '🎂', title: 'Private Parties', text: 'Milestone birthdays, anniversaries and the parties people talk about for years.' },
          { icon: '🎪', title: 'Corporate Events', text: 'Launches, team days and conferences — on brief, on budget, on time.' },
          { icon: '💍', title: 'Weddings & Engagements', text: 'Full planning or day-of coordination with a team that loves the details.' }
        ] },
        { type: 'gallery', animation: 'fade-up', items: [
          { text: 'Rooftop launch', extra: 'Corporate' }, { text: 'Winter gala', extra: 'Charity' },
          { text: 'Sofia turns 40', extra: 'Private' }, { text: 'Marquee wedding', extra: 'Wedding' },
          { text: 'Festival stage', extra: 'Live event' }, { text: 'Product reveal', extra: 'Brand' }
        ] },
        { type: 'countdown', animation: 'zoom-in', title: 'Next big night', subtitle: 'Our annual summer gala — tickets on sale now.', extra: new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 19) },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Claire Dennison', text: 'They ran our 200-guest charity gala like a dream. Raised a record amount.', extra: 'Charity trustee' },
          { title: 'Mike & Sarah', text: 'The wedding was flawless — we were guests at our own party, exactly as promised.', extra: 'Wedding clients' },
          { title: 'Ana Ruiz', text: 'From the napkin sketch to the confetti cannon, every detail was covered.', extra: 'Product launch' }
        ] },
        { type: 'cta', animation: 'bounce-in', title: 'Let’s throw something unforgettable', text: 'Tell us about your event — we’ll call you back within one working day.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'atelier', name: 'Atelier', icon: '🎨', tag: 'Portfolio & Studio', palette: 'sunset', font: 'bebas',
      desc: 'A bold creative portfolio: selected work, services, recognitions, commission.',
      sections: [
        { type: 'hero', animation: 'fade-in' },
        { type: 'gallery', animation: 'fade-up', items: [
          { text: 'Wildfire campaign', extra: 'Brand · 2025' }, { text: 'Kinfolk identity', extra: 'Brand · 2025' },
          { text: 'Northwind editorial', extra: 'Print · 2024' }, { text: 'Solace packaging', extra: 'Packaging · 2024' },
          { text: 'Drift app', extra: 'Product · 2024' }, { text: 'Terra site', extra: 'Web · 2023' }
        ] },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '🎯', title: 'Brand Identity', text: 'Naming, logo, voice and the system that keeps it all consistent.' },
          { icon: '🖥️', title: 'Web & Digital', text: 'Marketing sites and product design that ship fast and age well.' },
          { icon: '📖', title: 'Editorial & Print', text: 'Magazines, books and packaging for brands that care about paper.' }
        ] },
        { type: 'stats', animation: 'fade-up', items: [
          { title: 'Projects', text: '300+' }, { title: 'Awards', text: '12' }, { title: 'Happy clients', text: '180+' }, { title: 'Years', text: '9' }
        ] },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Lena Fischer', text: 'The rebrand paid for itself in the first quarter. Sharp, fast, unforgettable.', extra: 'Founder, Kinfolk' },
          { title: 'Omar Haddad', text: 'They treat your brand like their own portfolio. Rare and valuable.', extra: 'CEO, Wildfire' },
          { title: 'June Park', text: 'Every deadline hit, every detail considered. Hire them before we do again.', extra: 'Head of brand, Drift' }
        ] },
        { type: 'cta', animation: 'fade-up', title: 'Commissions open for Q3', text: 'Tell us about your project — we take on four new clients a season.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'estate', name: 'Estate', icon: '🏡', tag: 'Real Estate · Pro', palette: 'stone', font: 'playfair',
      desc: 'A property agency site: featured listings, neighbourhoods, agents, valuations.',
      sections: [
        { type: 'hero', animation: 'fade-up' },
        { type: 'stats', animation: 'fade-up', items: [
          { title: 'Homes sold', text: '1,900+' }, { title: 'Average days to sell', text: '23' }, { title: 'Local agents', text: '18' }, { title: 'Client rating', text: '4.9★' }
        ] },
        { type: 'shop', animation: 'fade-up', items: [
          { icon: '🏡', title: 'Maple Grove House', text: '£525,000', extra: '4 bed · 2 bath · 0.4 acre · New listing' },
          { icon: '🏙️', title: 'Harbour View Flat', text: '£340,000', extra: '2 bed · 17th floor · Balcony · Chain-free' },
          { icon: '🏡', title: 'Willow Cottage', text: '£685,000', extra: '3 bed · Character home · Outbuildings' },
          { icon: '🏢', title: 'The Old Mill', text: '£890,000', extra: '5 bed · Riverside · Annexe · Rare find' }
        ] },
        { type: 'gallery', animation: 'fade-up', items: [
          { text: 'Maple Grove', extra: '£525,000' }, { text: 'Harbour View', extra: '£340,000' },
          { text: 'Willow Cottage', extra: '£685,000' }, { text: 'The Old Mill', extra: '£890,000' },
          { text: 'Briar Lane', extra: '£475,000' }, { text: 'Kingsmead', extra: '£1.2M' }
        ] },
        { type: 'about', animation: 'slide-left', title: 'Local knowledge, national reach', text: 'Estate has sold homes across the region for over 30 years. We are a team of residents, not a call centre — you will deal with the same agent from first viewing to keys in hand.', subtitle: 'Award-winning independent agency' },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Helen & Rob', text: 'Sold in eleven days at asking price. Their photography alone was worth it.', extra: 'Sellers, Maple Grove' },
          { title: 'Dimitri Kovač', text: 'As first-time buyers we had a hundred questions. They answered every one patiently.', extra: 'Buyers' },
          { title: 'Sandra Osei', text: 'The valuation was spot on and the marketing was beautiful.', extra: 'Landlord' }
        ] },
        { type: 'cta', animation: 'fade-up', title: 'Thinking of selling?', text: 'Book a free, no-obligation valuation — £0 fees if we don’t sell.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    },
    {
      id: 'aperture', name: 'Aperture', icon: '📸', tag: 'Photography · Pro', palette: 'noir', font: 'dmserif',
      desc: 'A photography studio portfolio: galleries by genre, about, bookings, prints.',
      sections: [
        { type: 'hero', animation: 'zoom-in' },
        { type: 'gallery', animation: 'fade-up', items: [
          { text: 'Weddings', extra: 'Collections' }, { text: 'Portraits', extra: 'Studio' },
          { text: 'Editorial', extra: 'Magazine' }, { text: 'Landscape', extra: 'Fine art' },
          { text: 'Events', extra: 'Documentary' }, { text: 'Personal work', extra: 'Film' }
        ] },
        { type: 'features', animation: 'fade-up', items: [
          { icon: '💍', title: 'Weddings', text: 'One photographer, two cameras, full day — delivered as a private online gallery within three weeks.' },
          { icon: '🧑‍🎨', title: 'Portraits & Brands', text: 'Studio or on location, for people, products and the faces behind companies.' },
          { icon: '🖼️', title: 'Fine Art Prints', text: 'Limited edition archival prints, signed and numbered, shipped worldwide.' }
        ] },
        { type: 'testimonials', animation: 'fade-up', items: [
          { title: 'Kate & Jordan', text: 'He caught moments we didn’t even know happened. We cried laughing at the gallery.', extra: 'Wedding clients' },
          { title: 'Studio Nova', text: 'Campaign shots that made our whole look book. Booking again next season.', extra: 'Brand client' },
          { title: 'Marco Ellis', text: 'The print quality is museum-grade. My wall has never looked better.', extra: 'Print collector' }
        ] },
        { type: 'faq', animation: 'fade-up', items: [
          { title: 'How far ahead should we book?', text: 'Weddings book out 6–12 months. Portrait sessions usually have space within three weeks.' },
          { title: 'Do you travel?', text: 'Yes — destination weddings and shoots are welcome. Travel is quoted up front.' },
          { title: 'What do you charge?', text: 'Portrait sessions start at £250. Wedding collections start at £1,400. Every quote is fixed.' }
        ] },
        { type: 'cta', animation: 'fade-up', title: 'Let’s make something worth framing', text: 'Check availability and book your session — hello@ is the fastest way.' },
        { type: 'contact', animation: 'fade-up' }
      ]
    }
  ],

  // ---------- Upgrade suites ----------
  suites: [
    {
      id: 'animation', name: 'Animation Pack', icon: '🪄', tag: 'Motion',
      desc: 'Unlocks every animation preset plus scroll progress bar, floating hero glow and parallax tilt on cards.',
      sections: [], features: { proAnimations: true }
    },
    {
      id: 'contactpro', name: 'Contact Pro', icon: '📨', tag: 'Lead capture',
      desc: 'Upgrades the contact form with validation, success toast, WhatsApp button and Google Maps embed.',
      sections: [], features: { contactPro: true }
    },
    {
      id: 'blog', name: 'Blog Suite', icon: '📝', tag: 'Content',
      desc: 'Adds a blog section with demo posts, reading modal, categories and a newsletter signup box.',
      sections: [
        { type: 'blog', animation: 'fade-up', items: [
          { icon: 'Launch', title: 'Why we redesigned our product', text: 'A behind-the-scenes look at the research, sketches and decisions behind our biggest update yet. Expect honest lessons, a few failed prototypes, and the launch metrics that surprised us.', extra: 'Product · 6 min read' },
          { icon: 'Design', title: 'The anatomy of a great landing page', text: 'Headline, proof, objection handling — the eight sections every high-converting page shares, with real examples pulled from the wild.', extra: 'Design · 9 min read' },
          { icon: 'Culture', title: 'How our team ships weekly', text: 'Small batches, tight feedback loops and a demo-first ritual. A practical guide to the rhythm that keeps 14 people shipping every Friday.', extra: 'Culture · 4 min read' }
        ] }
      ],
      features: { blog: true }
    },
    {
      id: 'shop', name: 'Shop Suite', icon: '🛍️', tag: 'Commerce',
      desc: 'Adds a products grid with a working client-side cart: add/remove items, quantities, totals and a checkout summary.',
      sections: [
        { type: 'shop', animation: 'fade-up', items: [
          { icon: '🌿', title: 'Everyday Bundle', text: '£24', extra: 'Starter kit for daily essentials' },
          { icon: '⚡', title: 'Pro Kit', text: '£49', extra: 'Everything you need to go all-in' },
          { icon: '🎁', title: 'Gift Edition', text: '£39', extra: 'Beautifully boxed and ready to gift' },
          { icon: '🏅', title: 'Limited Run', text: '£89', extra: 'Only 100 made — numbered and signed' }
        ] }
      ],
      features: { shop: true }
    },
    {
      id: 'gallerypro', name: 'Gallery Pro', icon: '🖼️', tag: 'Showcase',
      desc: 'Masonry gallery layout with full-screen lightbox, captions and keyboard navigation.',
      sections: [], features: { galleryPro: true }
    },
    {
      id: 'seo', name: 'SEO Suite', icon: '🔍', tag: 'Visibility',
      desc: 'Adds meta description, Open Graph tags, JSON-LD schema and semantic HTML markup to the exported site.',
      sections: [], features: { seo: true }
    },
    {
      id: 'datawidgets', name: 'Data Widgets', icon: '📡', tag: 'Live data',
      desc: 'Adds live crypto prices (CoinGecko), GitHub profile stats and daily ECB exchange rates — keyless free APIs, refreshed on every visit.',
      sections: [], features: { datawidgets: true }
    }
  ],

  // ---------- Fallback quotes (used when the online API is unreachable) ----------
  fallbackQuotes: [
    { text: 'Design is intelligence made visible.', extra: 'Alina Wheeler' },
    { text: 'Simplicity is the ultimate sophistication.', extra: 'Leonardo da Vinci' },
    { text: 'Good design is obvious. Great design is transparent.', extra: 'Joe Sparano' },
    { text: 'The details are not the details. They make the design.', extra: 'Charles Eames' },
    { text: 'Creativity is intelligence having fun.', extra: 'Albert Einstein' }
  ]
};

// ---------- Helpers ----------
DB.getPalette = (id) => DB.palettes.find((p) => p.id === id) || DB.palettes[0];
DB.getFont = (id) => DB.fonts.find((f) => f.id === id) || DB.fonts[0];
DB.getTemplate = (id) => DB.templates.find((t) => t.id === id) || DB.templates[0];
DB.getSuite = (id) => DB.suites.find((s) => s.id === id) || null;
DB.getAnimation = (id) => DB.animations.find((a) => a.id === id) || DB.animations[0];

// ---------- WCAG contrast helpers (palette picker + SEO/a11y audit) ----------
DB.hexRgb = (hex) => {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
DB.luminance = (hex) => {
  const c = DB.hexRgb(hex);
  if (!c) return 0;
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
DB.contrast = (a, b) => {
  const la = DB.luminance(a), lb = DB.luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};
// Shift a hex colour's lightness in HSL steps until fn(hex) returns true
// (used by the "AA tune" fix). Returns the adjusted hex or the original.
DB.adjustUntil = (hex, fn, darkenFirst) => {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const rgb = DB.hexRgb('#' + h);
  if (!rgb) return hex;
  const to01 = (v) => v / 255;
  let [r, g, b] = [to01(rgb[0]), to01(rgb[1]), to01(rgb[2])];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let l = (mx + mn) / 2;
  const delta = mx - mn;
  let s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  let hh = 0;
  if (delta !== 0) {
    if (mx === r) hh = ((g - b) / delta) % 6;
    else if (mx === g) hh = (b - r) / delta + 2;
    else hh = (r - g) / delta + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  let step = darkenFirst ? -0.022 : 0.022;
  for (let i = 0; i < 40; i++) {
    const hsl = `hsl(${hh}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
    const cur = hslToHex(hh, s, l);
    if (fn(cur)) return cur;
    l = Math.min(0.97, Math.max(0.03, l + step));
    if (l <= 0.03 || l >= 0.97) { step = -step; } // bounce at the ends
    s = Math.min(1, Math.max(0, s));
  }
  return hslToHex(hh, s, l);
  function hslToHex(h2, s2, l2) {
    const hue2rgb = (pp, qq, tt) => {
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return pp + (qq - pp) * 6 * tt;
      if (tt < 1 / 2) return qq;
      if (tt < 2 / 3) return pp + (qq - pp) * (2 / 3 - tt) * 6;
      return pp;
    };
    const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2;
    const p = 2 * l2 - q;
    const to8 = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    return '#' + to8(hue2rgb(p, q, h2 / 360 + 1 / 3)) + to8(hue2rgb(p, q, h2 / 360)) + to8(hue2rgb(p, q, h2 / 360 - 1 / 3));
  }
};
// Key text roles of a palette + their WCAG ratio vs the surfaces they sit on.
DB.paletteChecks = (pal) => {
  if (!pal) return [];
  const roles = [
    { role: 'Body text on background', fg: pal.text, bg: pal.bg, need: 4.5 },
    { role: 'Secondary text on background', fg: pal.muted, bg: pal.bg, need: 4.5 },
    { role: 'Body text on cards', fg: pal.text, bg: pal.surface, need: 4.5 },
    { role: 'Secondary text on cards', fg: pal.muted, bg: pal.surface, need: 4.5 }
  ];
  return roles.map((r) => ({ ...r, ratio: DB.contrast(r.fg, r.bg) }));
};

// Build a fresh section object from a type + preset values
DB.newSection = (type, preset = {}) => {
  const t = DB.sectionTypes[type] || DB.sectionTypes.features;
  const clone = (v) => (Array.isArray(v) ? v.map((x) => (Array.isArray(x) ? [...x] : (x && typeof x === 'object' ? { ...x } : x))) : v);
  const items = (preset.items || []).map((it, i) => ({
    icon: it.icon || '✦',
    title: it.title || '',
    text: it.text || '',
    extra: it.extra || '',
    tag: it.tag || '',
    image: it.image || '',
    imageMeta: it.imageMeta && typeof it.imageMeta === 'object' ? { ...it.imageMeta } : null
  }));
  return {
    id: 'sec_' + Math.random().toString(36).slice(2, 9),
    type,
    layout: preset.layout || '',
    title: preset.title || (type === 'booking' ? 'Book online' : ''),
    subtitle: preset.subtitle || (type === 'booking' ? 'Choose a time that works for you.' : ''),
    text: preset.text || (type === 'booking' ? 'Schedule your appointment in a few clicks.' : ''),
    extra: preset.extra || '',
    image: preset.image || '',
    imageSource: preset.imageSource || '',
    imageMeta: preset.imageMeta && typeof preset.imageMeta === 'object' ? { ...preset.imageMeta } : null,
    // Booking section settings (kept on every section for stable old backups)
    bookingProvider: preset.bookingProvider || (type === 'booking' ? 'calendly' : ''),
    bookingUrl: preset.bookingUrl || (type === 'booking' ? preset.extra || '' : ''),
    bookingButton: preset.bookingButton || (type === 'booking' ? 'Book an appointment' : ''),
    bookingDuration: preset.bookingDuration || '',
    bookingLocation: preset.bookingLocation || '',
    items,
    // Table section: column headings + rows (array of cell arrays)
    cols: clone(preset.cols || []),
    rows: clone(preset.rows || []),
    // Collection section: interactive options (defaults on for the filter grid)
    filter: preset.filter !== false,
    search: preset.search !== false,
    sort: preset.sort !== false,
    animation: preset.animation || 'fade-up'
  };
};

// Creative layout variants available per section type (used by the Layouts
// catalog and the section editor's "Design variant" dropdown).
DB.layoutsFor = (type) => {
  const map = {
    hero: [
      { id: '', name: 'Centered (image background)' },
      { id: 'split', name: 'Split Bold — text + image' },
      { id: 'minimal', name: 'Minimal Statement — clean center' },
      { id: 'terminal', name: 'Code Terminal — dev aesthetic' },
      { id: 'aurora', name: 'Aurora Mesh — gradient glow, no image' }
    ],
    about: [
      { id: '', name: 'Classic — image right' },
      { id: 'left', name: 'Classic — image left' },
      { id: 'floating', name: 'Floating chips over image' },
      { id: 'timeline', name: 'Timeline — vertical story' }
    ],
    features: [
      { id: '', name: 'Card grid (classic)' },
      { id: 'bento', name: 'Bento grid — asymmetric tiles' },
      { id: 'numbered', name: 'Editorial numbered rows' },
      { id: 'strip', name: 'Feature strip — divided columns' }
    ],
    stats: [
      { id: '', name: 'Cards (classic)' },
      { id: 'band', name: 'Gradient band' },
      { id: 'ticker', name: 'Live ticker — scrolling marquee' }
    ],
    pricing: [
      { id: '', name: 'Cards (classic)' },
      { id: 'stacked', name: 'Stacked tier rows' },
      { id: 'toggle', name: 'Monthly / yearly toggle' }
    ],
    testimonials: [
      { id: '', name: 'Card grid (classic)' },
      { id: 'masonry', name: 'Masonry wall' },
      { id: 'featured', name: 'Featured quote + side stack' }
    ],
    gallery: [
      { id: '', name: 'Uniform grid (classic)' },
      { id: 'mosaic', name: 'Mosaic wall — mixed spans' }
    ],
    faq: [
      { id: '', name: 'Single column (classic)' },
      { id: 'columns', name: 'Two-column accordion' }
    ],
    blog: [
      { id: '', name: 'Post grid (classic)' },
      { id: 'featured', name: 'Featured post + grid' }
    ],
    video: [
      { id: '', name: 'Centered player (classic)' },
      { id: 'full', name: 'Cinema — full-bleed player' }
    ],
    countdown: [
      { id: '', name: 'Cards (classic)' },
      { id: 'panel', name: 'Launch panel — gradient' }
    ],
    cta: [
      { id: '', name: 'Banner (classic)' },
      { id: 'splash', name: 'Gradient splash with blobs' },
      { id: 'email', name: 'Email capture panel' }
    ],
    logos: [
      { id: '', name: 'Marquee (classic)' },
      { id: 'grid', name: 'Wordmark grid (static)' }
    ],
    contact: [
      { id: '', name: 'Classic split' },
      { id: 'split', name: 'Gradient info panel' }
    ],
    booking: [
      { id: '', name: 'Booking panel — provider embed' },
      { id: 'compact', name: 'Compact booking card' }
    ],
    table: [
      { id: '', name: 'Clean table' },
      { id: 'compare', name: 'Comparison — bold first column + zebra rows' }
    ],
    collection: [
      { id: '', name: 'Filterable grid — category chips, live search & sort' },
      { id: 'plain', name: 'Plain grid (no controls)' },
      { id: 'slider', name: 'Slider — scroll-snap carousel with arrows' },
      { id: 'marquee', name: 'Marquee — infinite auto-scrolling strip' }
    ]
  };
  return map[type] || [];
};

// ---------------- Layout catalog ----------------
// Curated, creative section layouts — one click adds the fully-populated
// section to the current project. Each preset is a normal section object
// (editable after insertion); `layout` selects the visual variant.
DB.layouts = [
  {
    id: 'hero-split', name: 'Split Bold', icon: '🖤', type: 'hero', tag: 'Trending',
    desc: 'Headline left, imagery right with a glass badge — the classic agency opening.',
    preset: {
      type: 'hero', layout: 'split', animation: 'zoom-in',
      title: 'Design beyond the template',
      subtitle: 'Bold, modern websites for ambitious brands',
      text: 'We craft sites that load fast, look stunning and convert — every page built to feel bespoke.'
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1.1fr .9fr"><div style="display:flex;flex-direction:column;gap:5px;justify-content:center"><div style="height:6px;border-radius:3px;background:var(--accent);width:44%"></div><div style="height:9px;border-radius:4px;background:var(--text);width:92%"></div><div style="height:9px;border-radius:4px;background:var(--text);opacity:.55;width:70%"></div><div style="height:15px;border-radius:8px;background:var(--grad);width:52%;margin-top:3px"></div></div><div style="background:linear-gradient(160deg,var(--surface2),rgba(124,92,255,.25));border:1px solid var(--border);border-radius:9px;min-height:52px;position:relative"><div style="position:absolute;left:-6px;top:-5px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:3px 6px;font-size:.5rem;color:var(--muted)">★ 4.9</div></div></div>'
  },
  {
    id: 'hero-minimal', name: 'Minimal Statement', icon: '🤍', type: 'hero', tag: '',
    desc: 'One huge centered headline, an eyebrow line and two buttons. Nothing else.',
    preset: {
      type: 'hero', layout: 'minimal', animation: 'fade-in',
      title: 'Less, but better.',
      subtitle: 'A design studio for quiet confidence',
      text: 'No noise, no clutter — just the idea, stated clearly.'
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;justify-items:center;align-content:center;gap:5px"><div style="height:5px;border-radius:3px;background:var(--accent);width:22%"></div><div style="height:10px;border-radius:4px;background:var(--text);width:70%"></div><div style="height:10px;border-radius:4px;background:var(--text);opacity:.55;width:48%"></div><div style="display:flex;gap:5px;margin-top:3px"><div style="height:13px;border-radius:7px;background:var(--grad);width:34px"></div><div style="height:13px;border-radius:7px;border:1px solid var(--border);width:34px"></div></div></div>'
  },
  {
    id: 'hero-terminal', name: 'Code Terminal', icon: '💻', type: 'hero', tag: 'New',
    desc: 'A developer-tool hero: your pitch framed inside a live CLI window with typing animation.',
    preset: {
      type: 'hero', layout: 'terminal', animation: 'fade-up',
      title: 'Ship websites like software',
      subtitle: 'Versioned, deployable, client-ready — every build from the PallettAI pipeline',
      text: ''
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:0;background:#0d1024;padding:8px"><div style="display:flex;gap:4px;padding:4px 2px 7px"><span style="width:7px;height:7px;border-radius:50%;background:#ff5f57"></span><span style="width:7px;height:7px;border-radius:50%;background:#febc2e"></span><span style="width:7px;height:7px;border-radius:50%;background:#28c840"></span></div><div style="display:flex;flex-direction:column;gap:4px"><div style="height:5px;border-radius:3px;background:var(--accent);width:70%"></div><div style="height:5px;border-radius:3px;background:rgba(255,255,255,.25);width:92%"></div><div style="height:5px;border-radius:3px;background:#34d399;width:55%"></div></div></div>'
  },
  {
    id: 'features-bento', name: 'Bento Grid', icon: '🧩', type: 'features', tag: 'Trending',
    desc: 'The beloved asymmetric bento: one wide tile, one tall, a gradient hero tile — pure modern SaaS.',
    preset: {
      type: 'features', layout: 'bento', animation: 'zoom-in',
      title: 'Everything in one workspace',
      subtitle: 'Five tiles, zero bloat — the bento layout keeps every feature glanceable.',
      items: [
        { icon: '🚀', title: 'Launch-ready', text: 'Go live in minutes with hosting, SSL and a domain baked into every build.' },
        { icon: '⚡', title: 'Blazing fast', text: 'Ships as a single file with zero dependencies — pages load before the blink.' },
        { icon: '🔒', title: 'Private by design', text: 'Your content, your data. No trackers unless you want them.' },
        { icon: '🎨', title: 'Pixel-perfect', text: 'Every variant tuned by hand across breakpoints.' },
        { icon: '🌍', title: 'Anywhere', text: 'Exports that run on any host, any device, any era.' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:repeat(6,1fr);grid-template-rows:repeat(2,1fr);gap:4px;min-height:74px"><div style="grid-column:span 4;grid-row:span 1;background:var(--grad);border-radius:6px"></div><div style="grid-column:span 2;grid-row:span 2;background:var(--surface2);border:1px solid var(--border);border-radius:6px"></div><div style="grid-column:span 2;background:var(--surface2);border:1px solid var(--border);border-radius:6px"></div><div style="grid-column:span 2;background:var(--surface2);border:1px solid var(--border);border-radius:6px"></div><div style="grid-column:span 2;background:var(--surface2);border:1px solid var(--border);border-radius:6px"></div></div>'
  },
  {
    id: 'features-numbered', name: 'Editorial Numbered', icon: '🔢', type: 'features', tag: '',
    desc: 'Large outlined numerals and hairline dividers — a magazine feel for process or steps.',
    preset: {
      type: 'features', layout: 'numbered', animation: 'fade-up',
      title: 'How we work',
      subtitle: 'Three steps, zero surprises.',
      items: [
        { icon: '', title: 'Discover', text: 'We dig into your goals, audience and market before a single pixel moves.' },
        { icon: '', title: 'Design & build', text: 'Wireframes become a living prototype in the PallettAI Studio pipeline.' },
        { icon: '', title: 'Launch & grow', text: 'Deploy, measure, then keep improving with upgrade suites.' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:6px"><div style="display:grid;grid-template-columns:26px 1fr;gap:6px;align-items:center"><span style="font-size:.7rem;font-weight:800;color:var(--primary)">01</span><span style="height:5px;border-radius:3px;background:var(--text);opacity:.8"></span></div><div style="display:grid;grid-template-columns:26px 1fr;gap:6px;align-items:center"><span style="font-size:.7rem;font-weight:800;color:var(--primary)">02</span><span style="height:5px;border-radius:3px;background:var(--text);opacity:.55"></span></div><div style="display:grid;grid-template-columns:26px 1fr;gap:6px;align-items:center"><span style="font-size:.7rem;font-weight:800;color:var(--primary)">03</span><span style="height:5px;border-radius:3px;background:var(--text);opacity:.3"></span></div></div>'
  },
  {
    id: 'stats-band', name: 'Gradient Band', icon: '📊', type: 'stats', tag: '',
    desc: 'One bold gradient band of animated counters with clean dividers — proof, at a glance.',
    preset: {
      type: 'stats', layout: 'band', animation: 'fade-up',
      title: 'By the numbers',
      items: [
        { title: 'Websites shipped', text: '250+' },
        { title: 'Client rating', text: '4.9★' },
        { title: 'Avg. load time', text: '0.8s' },
        { title: 'Support', text: '24/7' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:repeat(4,1fr);gap:4px;background:var(--grad);min-height:66px;align-items:center;padding:10px"><div style="display:flex;flex-direction:column;gap:4px"><span style="height:9px;border-radius:4px;background:rgba(255,255,255,.95);width:70%"></span><span style="height:4px;border-radius:2px;background:rgba(255,255,255,.55);width:90%"></span></div><div style="display:flex;flex-direction:column;gap:4px"><span style="height:9px;border-radius:4px;background:rgba(255,255,255,.95);width:70%"></span><span style="height:4px;border-radius:2px;background:rgba(255,255,255,.55);width:90%"></span></div><div style="display:flex;flex-direction:column;gap:4px"><span style="height:9px;border-radius:4px;background:rgba(255,255,255,.95);width:70%"></span><span style="height:4px;border-radius:2px;background:rgba(255,255,255,.55);width:90%"></span></div><div style="display:flex;flex-direction:column;gap:4px"><span style="height:9px;border-radius:4px;background:rgba(255,255,255,.95);width:70%"></span><span style="height:4px;border-radius:2px;background:rgba(255,255,255,.55);width:90%"></span></div></div>'
  },
  {
    id: 'pricing-stacked', name: 'Stacked Tier Rows', icon: '💎', type: 'pricing', tag: '',
    desc: 'Plans as horizontal rows — features read left to right, the popular tier wears the ribbon.',
    preset: {
      type: 'pricing', layout: 'stacked', animation: 'fade-up',
      title: 'Simple pricing',
      subtitle: 'Every tier includes hosting, SSL and PallettAI branding-free exports.',
      items: [
        { icon: '🌱', title: 'Starter', text: '£9', extra: '1 project · Email support', tag: '' },
        { icon: '⚡', title: 'Pro', text: '£29', extra: 'Unlimited projects · Priority support · All suites', tag: 'Popular' },
        { icon: '🏢', title: 'Scale', text: '£79', extra: 'Client handoff kit · Dedicated team · White-label', tag: '' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:5px"><div style="display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:6px"><span style="height:5px;border-radius:3px;background:var(--text);width:36px"></span><span style="height:8px;border-radius:4px;background:var(--muted);width:22px"></span><span style="height:11px;border-radius:6px;border:1px solid var(--border);width:26px"></span></div><div style="display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;background:linear-gradient(160deg,var(--surface2),rgba(124,92,255,.14));border:1px solid var(--primary);border-radius:7px;padding:6px"><span style="height:5px;border-radius:3px;background:var(--text);width:36px"></span><span style="height:8px;border-radius:4px;background:var(--text);width:22px"></span><span style="height:11px;border-radius:6px;background:var(--grad);width:26px"></span></div><div style="display:grid;grid-template-columns:1fr auto auto;gap:6px;align-items:center;background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:6px"><span style="height:5px;border-radius:3px;background:var(--text);width:36px"></span><span style="height:8px;border-radius:4px;background:var(--muted);width:22px"></span><span style="height:11px;border-radius:6px;border:1px solid var(--border);width:26px"></span></div></div>'
  },
  {
    id: 'testimonials-masonry', name: 'Masonry Wall', icon: '🗣️', type: 'testimonials', tag: 'Trending',
    desc: 'Quotes of every length in staggered columns — social proof that looks organic, not templated.',
    preset: {
      type: 'testimonials', layout: 'masonry', animation: 'fade-up',
      title: 'Kind words, unedited',
      items: [
        { title: 'Alex Rivera', text: 'Outstanding experience from start to finish. The site they built doubled our demo bookings in a month.', extra: 'Founder, Brightline' },
        { title: 'Mina Park', text: 'They understood the vision immediately. Fast, precise, and the animations are pure joy.', extra: 'CMO, Verdant' },
        { title: 'Sam Oduya', text: 'The results speak for themselves. Highly recommended.', extra: 'Director, Fieldwork' },
        { title: 'Elena Vasquez', text: 'We handed over a napkin sketch and got a brand. Weekly demos kept us in the loop the whole way.', extra: 'CEO, Canopy Labs' },
        { title: 'Jonas Weber', text: 'Loads instantly, ranks beautifully. The upgrade suites paid for themselves in a week.', extra: 'Ops Lead, Nordwerk' },
        { title: 'Priya Nair', text: 'Beautiful.', extra: 'Studio Nair' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:repeat(3,1fr);gap:5px;align-items:start"><div style="display:flex;flex-direction:column;gap:4px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px"><span style="height:5px;border-radius:3px;background:var(--text);width:80%"></span><span style="height:5px;border-radius:3px;background:var(--muted);width:95%"></span><span style="height:5px;border-radius:3px;background:var(--muted);width:60%"></span></div><div style="display:flex;flex-direction:column;gap:4px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px;margin-top:8px"><span style="height:5px;border-radius:3px;background:var(--text);width:65%"></span><span style="height:5px;border-radius:3px;background:var(--muted);width:88%"></span></div><div style="display:flex;flex-direction:column;gap:4px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px;margin-top:14px"><span style="height:5px;border-radius:3px;background:var(--text);width:90%"></span><span style="height:5px;border-radius:3px;background:var(--muted);width:70%"></span></div></div>'
  },
  {
    id: 'gallery-mosaic', name: 'Mosaic Wall', icon: '🖼️', type: 'gallery', tag: '',
    desc: 'Mixed-span tiles with hover captions — portfolio work that fills the frame.',
    preset: {
      type: 'gallery', layout: 'mosaic', animation: 'fade-up',
      title: 'Selected work',
      items: [
        { title: 'Northwind — launch', extra: 'Brand · 2026' },
        { title: 'Solace — platform', extra: 'Product · 2026' },
        { title: 'Drift — campaign', extra: 'Campaign · 2025' },
        { title: 'Kite — editorial', extra: 'Editorial · 2025' },
        { title: 'Terra — e-commerce', extra: 'Shop · 2025' },
        { title: 'Wildfire — festival', extra: 'Event · 2025' },
        { title: 'Halo — identity', extra: 'Identity · 2024' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,1fr);gap:4px;min-height:74px"><div style="grid-column:span 2;grid-row:span 2;background:var(--grad);border-radius:6px"></div><div style="grid-row:span 2;background:var(--surface2);border:1px solid var(--border);border-radius:6px"></div><div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px"></div><div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px"></div><div style="grid-column:span 2;background:var(--surface2);border:1px solid var(--border);border-radius:6px"></div><div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px"></div></div>'
  },
  {
    id: 'about-floating', name: 'Floating Chips', icon: '👋', type: 'about', tag: 'New',
    desc: 'A softly offset photo with two glass chips floating over it — personality plus proof.',
    preset: {
      type: 'about', layout: 'floating', animation: 'fade-up',
      title: 'A studio that ships',
      subtitle: 'Small team, senior craft.',
      text: 'We pair strategy with craft — designing, building and launching sites that earn their keep.',
      items: [
        { icon: '', title: '★ 4.9 / 5', text: '200+ client reviews' },
        { icon: '', title: '12 days', text: 'average build time' },
        { icon: '✓', title: 'Free hosting included' },
        { icon: '✓', title: '30-day care plan' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1.1fr .9fr;gap:8px;align-items:center"><div style="display:flex;flex-direction:column;gap:5px"><span style="height:6px;border-radius:3px;background:var(--text);width:80%"></span><span style="height:5px;border-radius:3px;background:var(--muted);width:95%"></span><span style="height:5px;border-radius:3px;background:var(--muted);width:88%"></span></div><div style="background:linear-gradient(160deg,var(--surface2),rgba(124,92,255,.22));border:1px solid var(--border);border-radius:9px;min-height:54px;position:relative"><div style="position:absolute;left:-7px;top:-7px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:3px 6px;font-size:.5rem;color:var(--text);box-shadow:0 4px 10px rgba(0,0,0,.25)">★ 4.9</div><div style="position:absolute;right:-7px;bottom:-7px;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:3px 6px;font-size:.5rem;color:var(--text);box-shadow:0 4px 10px rgba(0,0,0,.25)">12 days</div></div></div>'
  },
  {
    id: 'cta-splash', name: 'Gradient Splash', icon: '💥', type: 'cta', tag: '',
    desc: 'A full gradient panel with drifting light blobs — the closer that ends pages with energy.',
    preset: {
      type: 'cta', layout: 'splash', animation: 'zoom-in',
      title: 'Ready when you are',
      text: 'Tell us about your project — we reply within one business day.',
      extra: ''
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:0;background:var(--grad);min-height:66px;align-content:center;justify-items:center;position:relative;overflow:hidden"><span style="position:absolute;left:-12px;top:-14px;width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.28);filter:blur(8px)"></span><span style="position:absolute;right:-10px;bottom:-16px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.22);filter:blur(10px)"></span><div style="height:9px;border-radius:4px;background:rgba(255,255,255,.95);width:52%"></div><div style="height:5px;border-radius:3px;background:rgba(255,255,255,.6);width:34%;margin-top:4px"></div><div style="height:14px;border-radius:7px;background:#fff;width:64px;margin-top:6px"></div></div>'
  },
  {
    id: 'logos-marquee', name: 'Trust Marquee', icon: '🏷️', type: 'logos', tag: '',
    desc: 'An infinite scrolling strip of client wordmarks with edge fade — instant credibility.',
    preset: {
      type: 'logos', layout: '', animation: 'fade-up',
      title: 'Trusted by teams at',
      items: [
        { icon: '◆', title: 'Northwind' }, { icon: '✳', title: 'Solace' }, { icon: '▲', title: 'Drift' },
        { icon: '◈', title: 'Kite' }, { icon: '✦', title: 'Terra' }, { icon: '❖', title: 'Wildfire' },
        { icon: '◉', title: 'Halo' }, { icon: '✧', title: 'Lumen' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:0;align-content:center;overflow:hidden"><div style="display:flex;gap:10px;width:max-content;animation:lt-marquee 6s linear infinite"><span style="font-size:.6rem;font-weight:800;color:var(--muted);white-space:nowrap">◆ NORTHWIND</span><span style="font-size:.6rem;font-weight:800;color:var(--muted);white-space:nowrap">✳ SOLACE</span><span style="font-size:.6rem;font-weight:800;color:var(--muted);white-space:nowrap">▲ DRIFT</span><span style="font-size:.6rem;font-weight:800;color:var(--muted);white-space:nowrap">◈ KITE</span><span style="font-size:.6rem;font-weight:800;color:var(--muted);white-space:nowrap">✦ TERRA</span><span style="font-size:.6rem;font-weight:800;color:var(--muted);white-space:nowrap">◆ NORTHWIND</span><span style="font-size:.6rem;font-weight:800;color:var(--muted);white-space:nowrap">✳ SOLACE</span><span style="font-size:.6rem;font-weight:800;color:var(--muted);white-space:nowrap">▲ DRIFT</span><span style="font-size:.6rem;font-weight:800;color:var(--muted);white-space:nowrap">◈ KITE</span><span style="font-size:.6rem;font-weight:800;color:var(--muted);white-space:nowrap">✦ TERRA</span></div></div>'
  },
  // ---- Free tier expansions ----
  {
    id: 'hero-aurora', name: 'Aurora Mesh', icon: '🌌', type: 'hero', tag: 'Pro', tier: 'pro',
    desc: 'A living gradient-mesh backdrop with drifting light orbs — zero images, maximum mood.',
    preset: {
      type: 'hero', layout: 'aurora', animation: 'fade-in',
      title: 'Ideas made luminous',
      subtitle: 'A design studio for the post-digital era',
      text: 'No stock photos. Just colour, motion and a story told in light.'
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:0;background:linear-gradient(135deg,#7c5cff,#22d3ee,#ec4899);align-content:center;justify-items:center;min-height:66px"><span style="position:absolute;left:-10px;top:-12px;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.35);filter:blur(9px)"></span><span style="position:absolute;right:-8px;bottom:-14px;width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.28);filter:blur(11px)"></span><div style="height:9px;border-radius:4px;background:rgba(255,255,255,.95);width:58%"></div><div style="height:5px;border-radius:3px;background:rgba(255,255,255,.65);width:38%;margin-top:4px"></div></div>'
  },
  {
    id: 'features-strip', name: 'Feature Strip', icon: '➰', type: 'features', tag: '',
    desc: 'A calm row of features divided by hairlines — less card, more editorial whitespace.',
    preset: {
      type: 'features', layout: 'strip', animation: 'fade-up',
      title: 'Why teams choose us',
      subtitle: 'Three promises we keep on every engagement.',
      items: [
        { icon: '⚡', title: 'Fast by default', text: 'Sub-second loads on every page, every device.' },
        { icon: '🔒', title: 'Privacy first', text: 'No trackers, no dark patterns, no exceptions.' },
        { icon: '🧭', title: 'Built to last', text: 'Standards-based code that never rots.' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:repeat(3,1fr);gap:0;align-items:center"><div style="display:flex;flex-direction:column;gap:4px;padding:0 8px;border-right:1px solid var(--border)"><span style="height:9px;width:9px;border-radius:3px;background:var(--grad)"></span><span style="height:5px;border-radius:3px;background:var(--text);width:90%"></span><span style="height:4px;border-radius:2px;background:var(--muted);width:80%"></span></div><div style="display:flex;flex-direction:column;gap:4px;padding:0 8px;border-right:1px solid var(--border)"><span style="height:9px;width:9px;border-radius:3px;background:var(--grad)"></span><span style="height:5px;border-radius:3px;background:var(--text);width:90%"></span><span style="height:4px;border-radius:2px;background:var(--muted);width:80%"></span></div><div style="display:flex;flex-direction:column;gap:4px;padding:0 8px"><span style="height:9px;width:9px;border-radius:3px;background:var(--grad)"></span><span style="height:5px;border-radius:3px;background:var(--text);width:90%"></span><span style="height:4px;border-radius:2px;background:var(--muted);width:80%"></span></div></div>'
  },
  {
    id: 'stats-ticker', name: 'Live Ticker', icon: '📈', type: 'stats', tag: 'Pro', tier: 'pro',
    desc: 'A scrolling band of milestones — proof that never sits still.',
    preset: {
      type: 'stats', layout: 'ticker', animation: 'fade-up',
      title: 'Momentum, measured',
      items: [
        { title: 'Sites shipped', text: '250+' }, { title: 'Client rating', text: '4.9★' },
        { title: 'Avg. load', text: '0.8s' }, { title: 'Support', text: '24/7' },
        { title: 'Countries', text: '40+' }, { title: 'Repeat clients', text: '93%' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:0;align-content:center;overflow:hidden;background:var(--surface2);border:1px solid var(--border)"><div style="display:flex;gap:14px;width:max-content;animation:lt-marquee 5s linear infinite;align-items:center"><span style="font-size:.62rem;font-weight:800;color:var(--text);white-space:nowrap">250+ SITES</span><span style="width:4px;height:4px;border-radius:50%;background:var(--primary)"></span><span style="font-size:.62rem;font-weight:800;color:var(--text);white-space:nowrap">4.9★ RATING</span><span style="width:4px;height:4px;border-radius:50%;background:var(--primary)"></span><span style="font-size:.62rem;font-weight:800;color:var(--text);white-space:nowrap">0.8s LOAD</span><span style="width:4px;height:4px;border-radius:50%;background:var(--primary)"></span><span style="font-size:.62rem;font-weight:800;color:var(--text);white-space:nowrap">24/7 SUPPORT</span><span style="width:4px;height:4px;border-radius:50%;background:var(--primary)"></span><span style="font-size:.62rem;font-weight:800;color:var(--text);white-space:nowrap">250+ SITES</span><span style="width:4px;height:4px;border-radius:50%;background:var(--primary)"></span><span style="font-size:.62rem;font-weight:800;color:var(--text);white-space:nowrap">4.9★ RATING</span></div></div>'
  },
  {
    id: 'pricing-toggle', name: 'Monthly / Yearly', icon: '🔁', type: 'pricing', tag: 'Pro', tier: 'pro',
    desc: 'The classic SaaS toggle — yearly shows a “save 20%” state that flips live on click.',
    preset: {
      type: 'pricing', layout: 'toggle', animation: 'fade-up',
      title: 'Simple, honest pricing',
      subtitle: 'Pay monthly, or yearly and save 20%.',
      items: [
        { icon: '🌱', title: 'Starter', text: '£9', extra: '1 project · Email support', tag: '', mo: '£9', yr: '£86' },
        { icon: '⚡', title: 'Pro', text: '£29', extra: 'Unlimited projects · Priority support', tag: 'Popular', mo: '£29', yr: '£278' },
        { icon: '🏢', title: 'Scale', text: '£79', extra: 'White-label · Dedicated team', tag: '', mo: '£79', yr: '£758' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:0;align-content:start"><div style="display:flex;gap:4px;align-self:center;background:var(--surface2);border:1px solid var(--border);border-radius:99px;padding:3px"><span style="height:9px;border-radius:99px;background:var(--grad);width:30px"></span><span style="height:9px;border-radius:99px;width:30px"></span></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:7px"><span style="height:24px;border-radius:6px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:24px;border-radius:6px;background:linear-gradient(160deg,var(--surface2),rgba(124,92,255,.16));border:1px solid var(--primary)"></span><span style="height:24px;border-radius:6px;background:var(--surface2);border:1px solid var(--border)"></span></div></div>'
  },
  {
    id: 'testimonials-featured', name: 'Featured + Stack', icon: '⭐', type: 'testimonials', tag: 'Pro', tier: 'pro',
    desc: 'One flagship quote beside a stack of shorter ones — hierarchy that lands the message.',
    preset: {
      type: 'testimonials', layout: 'featured', animation: 'fade-up',
      title: 'What clients say',
      items: [
        { title: 'Maya Chen', text: 'The site they built doubled our demo bookings within a month — and the launch itself was flawless. This is the studio I recommend to every founder I know.', extra: 'CEO, Nortide' },
        { title: 'Leo Fischer', text: 'Beautiful, fast, and the suites let us upgrade without rebuilding anything.', extra: 'Founder, Draftline' },
        { title: 'Ava Okafor', text: 'Finally a builder that ships sites clients actually love to show off.', extra: 'Designer, Studio Kala' },
        { title: 'Sam Oduya', text: 'Quality is unreal for the price. My third order already.', extra: 'Director, Fieldwork' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1.4fr 1fr;gap:5px;align-items:stretch"><div style="display:flex;flex-direction:column;gap:4px;background:var(--grad);border-radius:7px;padding:8px"><span style="height:5px;border-radius:3px;background:rgba(255,255,255,.95);width:70%"></span><span style="height:5px;border-radius:3px;background:rgba(255,255,255,.7);width:95%"></span><span style="height:5px;border-radius:3px;background:rgba(255,255,255,.7);width:82%"></span><span style="height:5px;border-radius:3px;background:rgba(255,255,255,.7);width:60%"></span></div><div style="display:flex;flex-direction:column;gap:4px"><span style="height:16px;border-radius:5px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:12px;border-radius:5px;background:var(--surface2);border:1px solid var(--border)"></span></div></div>'
  },
  {
    id: 'about-timeline', name: 'Timeline Story', icon: '🕰️', type: 'about', tag: 'Pro', tier: 'pro',
    desc: 'Your story as a vertical timeline — milestones with years, from founding day to now.',
    preset: {
      type: 'about', layout: 'timeline', animation: 'fade-up',
      title: 'Our journey',
      subtitle: 'A decade of shipping.',
      items: [
        { icon: '', title: '2016', text: 'Founded in a spare bedroom with one client and a borrowed camera.' },
        { icon: '', title: '2019', text: 'First studio hire. Moved from freelance to a real studio with a coffee machine.' },
        { icon: '', title: '2022', text: 'Shipped our 100th client site and started building the PallettAI pipeline.' },
        { icon: '', title: 'Today', text: 'A senior team of twelve, shipping sites in 14 countries — still obsessed with the details.' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:5px;padding-left:8px"><div style="display:grid;grid-template-columns:24px 1fr;gap:5px;align-items:start"><span style="width:8px;height:8px;border-radius:50%;background:var(--primary);margin:2px auto"></span><span style="height:12px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span></div><div style="display:grid;grid-template-columns:24px 1fr;gap:5px;align-items:start"><span style="width:8px;height:8px;border-radius:50%;background:var(--primary);margin:2px auto"></span><span style="height:9px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span></div><div style="display:grid;grid-template-columns:24px 1fr;gap:5px;align-items:start"><span style="width:8px;height:8px;border-radius:50%;background:var(--primary);margin:2px auto"></span><span style="height:9px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span></div></div>'
  },
  {
    id: 'faq-columns', name: 'Two-Column FAQ', icon: '🔀', type: 'faq', tag: '',
    desc: 'Accordions split across two columns — more answers above the fold.',
    preset: {
      type: 'faq', layout: 'columns', animation: 'fade-up',
      title: 'Questions, answered',
      items: [
        { title: 'How fast can we start?', text: 'Most projects kick off within a week of the kickoff call.' },
        { title: 'Do we own the code?', text: 'Yes — every build is yours, with full rights on handover.' },
        { title: 'What happens after launch?', text: 'A 30-day care plan covers fixes, tweaks and support.' },
        { title: 'Can you redesign an old site?', text: 'Absolutely — we migrate content and lift your old design.' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr 1fr;gap:5px"><div style="display:flex;flex-direction:column;gap:4px"><span style="height:16px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:11px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span></div><div style="display:flex;flex-direction:column;gap:4px"><span style="height:11px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:16px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span></div></div>'
  },
  {
    id: 'logos-grid', name: 'Wordmark Grid', icon: '🧱', type: 'logos', tag: '',
    desc: 'A stately static grid of client wordmarks — for heritage brands and formal industries.',
    preset: {
      type: 'logos', layout: 'grid', animation: 'fade-up',
      title: 'Trusted by teams at',
      items: [
        { icon: '◆', title: 'Northwind' }, { icon: '✳', title: 'Solace' }, { icon: '▲', title: 'Drift' },
        { icon: '◈', title: 'Kite' }, { icon: '✦', title: 'Terra' }, { icon: '❖', title: 'Wildfire' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:repeat(3,1fr);gap:4px;align-items:center"><span style="height:11px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:11px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:11px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:11px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:11px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:11px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span></div>'
  },
  {
    id: 'contact-split', name: 'Gradient Info Panel', icon: '💠', type: 'contact', tag: '',
    desc: 'A gradient info panel beside the form — contact details that look designed, not listed.',
    preset: {
      type: 'contact', layout: 'split', animation: 'fade-up',
      title: 'Let’s talk',
      subtitle: 'Tell us about your project — we reply within one business day.',
      extra: 'Prefer email? hello@pallettai.org · Mon–Fri, 9–5 UK time'
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1.1fr .9fr;gap:5px;align-items:stretch"><div style="display:flex;flex-direction:column;gap:4px;background:var(--grad);border-radius:7px;padding:7px"><span style="height:6px;border-radius:3px;background:rgba(255,255,255,.95);width:60%"></span><span style="height:4px;border-radius:2px;background:rgba(255,255,255,.6);width:90%"></span><span style="height:4px;border-radius:2px;background:rgba(255,255,255,.6);width:75%"></span><span style="height:12px;border-radius:4px;background:rgba(255,255,255,.9);width:55%;margin-top:2px"></span></div><div style="display:flex;flex-direction:column;gap:4px"><span style="height:9px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:9px;border-radius:4px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:18px;border-radius:5px;background:var(--surface2);border:1px solid var(--border)"></span></div></div>'
  },
  {
    id: 'cta-email', name: 'Email Capture', icon: '📮', type: 'cta', tag: '',
    desc: 'A bold closer with an inline subscribe field — the capture that turns visitors into leads.',
    preset: {
      type: 'cta', layout: 'email', animation: 'zoom-in',
      title: 'First access, zero spam',
      text: 'Join the list for launch updates and early-bird pricing.',
      extra: ''
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:0;align-content:center;background:var(--grad);min-height:66px;padding:9px"><span style="height:7px;border-radius:3px;background:rgba(255,255,255,.95);width:62%;margin:0 auto"></span><span style="height:5px;border-radius:3px;background:rgba(255,255,255,.6);width:44%;margin:5px auto 0"></span><div style="display:flex;gap:4px;margin-top:8px;justify-content:center"><span style="height:13px;border-radius:99px;background:rgba(255,255,255,.85);width:56%"></span><span style="height:13px;border-radius:99px;background:#fff;width:22%"></span></div></div>'
  },
  {
    id: 'blog-featured', name: 'Featured Post', icon: '📰', type: 'blog', tag: 'Pro', tier: 'pro',
    desc: 'The latest post takes the full width with a big read card — the rest stack below.',
    preset: {
      type: 'blog', layout: 'featured', animation: 'fade-up',
      title: 'From the blog',
      items: [
        { icon: 'Launch', title: 'Why we redesigned our product', text: 'A behind-the-scenes look at the research, sketches and decisions behind our biggest update yet. Expect honest lessons, a few failed prototypes, and the launch metrics that surprised us.', extra: 'Product · 6 min read' },
        { icon: 'Design', title: 'The anatomy of a great landing page', text: 'Headline, proof, objection handling — the eight sections every high-converting page shares.', extra: 'Design · 9 min read' },
        { icon: 'Culture', title: 'How our team ships weekly', text: 'Small batches, tight feedback loops and a demo-first ritual.', extra: 'Culture · 4 min read' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:5px;align-content:start"><span style="height:22px;border-radius:6px;background:var(--grad)"></span><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px"><span style="height:13px;border-radius:5px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:13px;border-radius:5px;background:var(--surface2);border:1px solid var(--border)"></span></div></div>'
  },
  {
    id: 'video-full', name: 'Cinema Player', icon: '🎞️', type: 'video', tag: '',
    desc: 'A full-bleed 16:9 stage with a caption bar — the showstopper embed for launch films.',
    preset: {
      type: 'video', layout: 'full', animation: 'fade-up',
      title: 'Watch the film',
      subtitle: 'Two minutes that explain everything.',
      extra: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:0;align-content:center;background:#0d1024;padding:8px"><span style="height:26px;border-radius:5px;background:var(--surface2);border:1px solid var(--border);position:relative"><span style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:0;height:0;border-left:9px solid var(--primary);border-top:6px solid transparent;border-bottom:6px solid transparent"></span></span><span style="height:4px;border-radius:2px;background:var(--muted);width:44%;margin:5px auto 0"></span></div>'
  },
  {
    id: 'countdown-panel', name: 'Launch Panel', icon: '🎆', type: 'countdown', tag: '',
    desc: 'A gradient countdown stage with a headline — the launch-day closer that builds urgency.',
    preset: {
      type: 'countdown', layout: 'panel', animation: 'zoom-in',
      title: 'We’re launching soon',
      subtitle: 'Something big is on the way.',
      extra: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 19)
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:0;align-content:center;background:var(--grad);min-height:66px;padding:8px"><span style="height:6px;border-radius:3px;background:rgba(255,255,255,.95);width:58%;margin:0 auto"></span><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-top:7px"><span style="height:16px;border-radius:4px;background:rgba(255,255,255,.85)"></span><span style="height:16px;border-radius:4px;background:rgba(255,255,255,.85)"></span><span style="height:16px;border-radius:4px;background:rgba(255,255,255,.85)"></span><span style="height:16px;border-radius:4px;background:rgba(255,255,255,.85)"></span></div></div>'
  },
  {
    id: 'collection-filter', name: 'Filterable Gallery', icon: '🗂️', type: 'collection', tag: 'Dynamic',
    desc: 'Your portfolio or product list as a living grid — visitors filter by category, search and sort instantly. Pure HTML + a few lines of JS: works on any static host, no server, no account.',
    preset: {
      type: 'collection', layout: '', animation: 'fade-up',
      title: 'Selected work',
      subtitle: 'Filter by discipline — or search the whole grid.',
      items: [
        { icon: '🖤', title: 'Northwind — launch', text: 'Full brand rollout for a SaaS scale-up, from naming to launch site.', extra: 'Branding', tag: '2026', image: '' },
        { icon: '✨', title: 'Drift — app design', text: 'Product design and design system for a fintech mobile app.', extra: 'Product', tag: '2026', image: '' },
        { icon: '🎯', title: 'Wildfire — campaign', text: 'Integrated campaign across social, outdoor and a microsite.', extra: 'Marketing', tag: '2025', image: '' },
        { icon: '📖', title: 'Northwind — editorial', text: 'Print and editorial identity for a quarterly magazine.', extra: 'Editorial', tag: '2025', image: '' },
        { icon: '🛍️', title: 'Terra — commerce', text: 'Headless storefront rebuild that lifted conversion 40%.', extra: 'Web', tag: '2025', image: '' },
        { icon: '📦', title: 'Kite — packaging', text: 'Unboxing-first packaging system for a DTC skincare brand.', extra: 'Packaging', tag: '2024', image: '' },
        { icon: '🎪', title: 'Solace — identity', text: 'A warm, confident identity for an event agency.', extra: 'Branding', tag: '2024', image: '' },
        { icon: '🚀', title: 'Halo — platform', text: 'Product site with animated 3D hero for a dev-tools startup.', extra: 'Web', tag: '2024', image: '' }
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:1fr;gap:6px"><div style="display:flex;gap:3px;align-self:start"><span style="height:9px;border-radius:99px;background:var(--grad);width:30px"></span><span style="height:9px;border-radius:99px;background:var(--surface2);border:1px solid var(--border);width:26px"></span><span style="height:9px;border-radius:99px;background:var(--surface2);border:1px solid var(--border);width:26px"></span><span style="height:9px;border-radius:99px;background:var(--surface2);border:1px solid var(--border);width:26px"></span></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px"><span style="height:26px;border-radius:6px;background:var(--grad)"></span><span style="height:26px;border-radius:6px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:26px;border-radius:6px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:26px;border-radius:6px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:26px;border-radius:6px;background:var(--surface2);border:1px solid var(--border)"></span><span style="height:26px;border-radius:6px;background:var(--surface2);border:1px solid var(--border)"></span></div></div>'
  },
  {
    id: 'table-compare', name: 'Comparison Table', icon: '📋', type: 'table', tag: 'New',
    desc: 'A pitch-ready comparison table — three plans, twelve rows, one glance. Fully editable afterwards.',
    preset: {
      type: 'table', layout: 'compare', animation: 'fade-up',
      title: 'Compare the plans',
      subtitle: 'Every tier includes hosting, SSL and analytics.',
      cols: ['Feature', 'Starter', 'Pro', 'Scale'],
      rows: [
        ['Price', '£9 /mo', '£29 /mo', '£79 /mo'],
        ['Projects', '1', 'Unlimited', 'Unlimited'],
        ['Visitors / month', '5k', 'Unlimited', 'Unlimited'],
        ['Priority support', '—', '✓', '✓'],
        ['Dedicated manager', '—', '—', '✓'],
        ['SLA', '—', '—', '✓'],
        ['White-label', '—', '—', '✓']
      ]
    },
    thumb: '<div class="lt-thumb" style="grid-template-columns:repeat(4,1fr);gap:4px;align-items:stretch;padding:7px"><span style="height:8px;border-radius:3px;background:var(--primary);opacity:.5"></span><span style="height:8px;border-radius:3px;background:var(--text);opacity:.85"></span><span style="height:8px;border-radius:3px;background:var(--text);opacity:.85"></span><span style="height:8px;border-radius:3px;background:var(--text);opacity:.85"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span><span style="height:5px;border-radius:2px;background:var(--muted)"></span></div>'
  }
];

// Deep-clone a template's sections into fresh section objects
DB.sectionsFromTemplate = (template) =>
  template.sections.map((s) => DB.newSection(s.type, s));

// Default settings
DB.defaultSettings = {
  theme: 'dark',
  accent: '#22d3ee',
  density: 'comfortable',
  reducedMotion: false,
  brandFooter: true,
  brandFooterText: 'Made by PallettAI',
  brandLink: 'https://pallettai.org',
  defaultPalette: 'midnight',
  defaultFont: 'inter',
  defaultAnimation: 'fade-up',
  defaultHeroLayout: 'centered',
  defaultContainerWidth: 1140,
  defaultRadius: 20,
  defaultSpacing: 96,
  defaultNavSticky: true,
  defaultThemeToggle: true,
  exportMeta: true,
  onlineEnabled: true,
  pixabayKey: '',
  onlineTimeoutMs: 9000,
  widgetRefreshSec: 300,
  autosave: true,
  autosaveMs: 2000,
  confirmDelete: true
};

if (typeof module !== 'undefined' && module.exports) module.exports = DB;
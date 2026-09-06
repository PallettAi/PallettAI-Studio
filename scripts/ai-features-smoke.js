// ============================================================
// PallettAI Studio — AI feature smoke tests
// Verifies the engine behind the AI Studio's "rebuild my
// current website" and "use my own photos" flows WITHOUT a
// browser or network:
//   1. studySite()  — parses a real-ish site's HTML (JSON-LD,
//                     meta, headings, contact, photos, FAQ…)
//   2. generateSite() consumes that studied website (brand,
//                     contact, about, services, FAQ, reviews)
//   3. generateImages() places the creator's own uploaded
//                     photos (data URLs) first, in order
//   node scripts/ai-features-smoke.js
// ============================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SAMPLE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Harbour &amp; Co Coffee Roasters | Specialty Coffee in Bristol</title>
<meta property="og:site_name" content="Harbour &amp; Co">
<meta name="description" content="Harbour &amp; Co roasts single-origin specialty coffee in Bristol. Wholesale, subscriptions and a roastery caf&eacute;.">
<script type="application/ld+json">{
  "@type": "LocalBusiness", "name": "Harbour &amp; Co",
  "description": "Specialty coffee roastery with a caf&eacute; in Bristol — single-origin beans roasted in small batches.",
  "telephone": "+44 117 555 0132", "email": "hello@harbourco.example",
  "url": "https://harbourco.example/",
  "image": { "url": "https://harbourco.example/img/roastery.jpg" },
  "address": { "streetAddress": "12 Ferry Lane", "addressLocality": "Bristol", "addressRegion": "Avon", "postalCode": "BS1 6JL", "addressCountry": "GB" },
  "areaServed": "Bristol",
  "serviceType": ["Wholesale coffee supply", "Coffee subscriptions", "Roastery caf&eacute;", "Barista training"]
}</script>
<script type="application/ld+json">{"@type":"FAQPage","mainEntity":[
  {"@type":"Question","name":"Do you deliver wholesale beans?","acceptedAnswer":{"@type":"Answer","text":"Yes — we deliver to caf&eacute;s and restaurants across the South West within three working days."}},
  {"@type":"Question","name":"Can I visit the roastery?","acceptedAnswer":{"@type":"Answer","text":"The roastery caf&eacute; is open Tuesday to Sunday from 8am; tours run on Saturday mornings."}}
]}</script>
<script type="application/ld+json">{"@type":"Review","author":{"@type":"Person","name":"Marta E."},"reviewBody":"Easily the most consistent beans we have served — our regulars noticed within a week.","reviewRating":{"@type":"Rating","ratingValue":"5"}}</script>
</head><body>
<h1>Harbour &amp; Co</h1>
<p>We are a family-run specialty coffee roastery in Bristol. Since 2012 we have sourced single-origin beans directly from growers in Ethiopia, Colombia and Sumatra, roasted in small batches every Tuesday.</p>
<p>Alongside the roastery we run a caf&eacute; on the harbourside, train baristas for caf&eacute;s across the South West and supply wholesale coffee to over sixty independent shops.</p>
<img src="/img/roastery.jpg" alt="The roasting floor" width="1200" height="800">
<img src="/img/cafe.jpg" alt="Harbourside caf&eacute;" width="1200" height="800">
<img src="/img/beans.jpg" width="900" height="600">
<img src="/logo.png" alt="logo" width="200" height="60">
<a href="mailto:hello@harbourco.example">hello@harbourco.example</a>
<a href="tel:+441175550132">Call us</a>
</body></html>`;

const code = fs.readFileSync(path.join(__dirname, '..', 'modules', 'ai.js'), 'utf8');
const sandbox = {
  console, URL, setTimeout, clearTimeout, Math, Date, JSON, Set, Promise, process,
  Image: function Image() { /* network probes never run in this harness */ },
  fetch: async () => { throw new Error('harness: no network expected'); },
  SAMPLE
};
sandbox.DB = require(path.join(__dirname, '..', 'data', 'db.js'));
vm.createContext(sandbox);

const harness = `
;(async () => {
  const AI = globalThis.AI;
  let pass = 0, fail = 0;
  const ok = (cond, label) => {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label); }
  };

  // ---- 1. studySite parses a rich site ----
  const w = await AI.studySite(SAMPLE, 'https://harbourco.example/');
  console.log('[1] studySite()');
  ok(!!w && w.ok === true, 'returns a profile');
  ok(w && w.brand === 'Harbour & Co', 'brand from og:site_name — got "' + (w && w.brand) + '"');
  ok(w && /Harbour & Co roasts single-origin/.test(w.tagline), 'tagline from meta description');
  ok(w && w.email === 'hello@harbourco.example', 'email from JSON-LD — got "' + (w && w.email) + '"');
  ok(w && /555\s?0132/.test(w.phone || ''), 'phone — got "' + (w && w.phone) + '"');
  ok(w && /Bristol/.test(w.address || ''), 'address contains Bristol');
  ok(w && /Bristol/.test(w.area || ''), 'areaServed Bristol');
  ok(w && w.url === 'https://harbourco.example/', 'canonical url');
  ok(w && w.about.length > 120 && /roastery/.test(w.about), 'about from real paragraphs');
  ok(w && w.services.length >= 4 && /Wholesale coffee supply/.test(w.services[0].title), 'services from JSON-LD serviceType');
  ok(w && w.faqs.length === 2, 'FAQ entries from FAQPage JSON-LD');
  ok(w && w.reviews.length === 1, 'review lifted from JSON-LD Review (got ' + (w && w.reviews.length) + ': ' + JSON.stringify((w && w.reviews) || []).slice(0, 160) + ')');
  ok(w && w.images.length >= 3, w && w.images.length >= 3 ? ('images from site (' + w.images.length + ')') : 'images from site');

  // ---- 2. generateSite consumes the studied website ----
  console.log('[2] generateSite(opts.website)');
  const g = AI.generateSite('make me a new website please', { website: w });
  ok(g && g.site.name === 'Harbour & Co', 'brand taken from studied site — got "' + (g && g.site.name) + '"');
  ok(g && g.site.email === 'hello@harbourco.example', 'email carried into project');
  ok(g && /555/.test(g.site.phone || ''), 'phone carried into project');
  ok(g && /Bristol/.test(g.site.address || ''), 'address carried into project');
  ok(g && g.site.url === 'https://harbourco.example/', 'site url carried into project (feeds canonical/sitemap)');
  ok(g && g.site.tagline && g.site.tagline.length > 20 && g.site.tagline !== g.site.tagline.toLowerCase(), 'tagline from the site meta — "' + (g && g.site.tagline) + '"');
  ok(g && g.aiType === 'food', 'industry detected from studied content (got "' + (g && g.aiType) + '")');
  const fsec = g && g.site.sections && g.site.sections.find((s) => s.type === 'features');
  ok(!fsec || fsec.items.length >= 4, fsec ? ('features section rebuilt from the real service list (' + fsec.items.length + ')') : 'no features section for this layout (skipped)');
  const asec = g && g.site.sections && g.site.sections.find((s) => s.type === 'about');
  ok(!asec || asec.text.length > 100, asec ? 'about section carries the site story' : 'no about section for this layout (skipped)');
  // vague prompt WITHOUT a website stays generic — the override only fires on real knowledge
  const gn = AI.generateSite('make me a new website please');
  ok(gn && gn.aiType === 'generic', 'no website → no phantom industry (got "' + (gn && gn.aiType) + '")');

  // ---- 3. generateImages places the creator's uploads first ----
  console.log('[3] generateImages(opts.photos)');
  const tiny = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const p = g;
  p.site.sections = p.site.sections.filter((s) => s.type === 'hero' || s.type === 'about' || s.type === 'gallery');
  const hero = p.site.sections.find((s) => s.type === 'hero');
  const about = p.site.sections.find((s) => s.type === 'about');
  const gal = p.site.sections.find((s) => s.type === 'gallery');
  const out = await AI.generateImages(p, 'harbour co', { source: 'none', online: false, photos: [tiny, tiny] });
  ok(out.hero && hero.image === tiny && hero.imageSource === 'Your photo', 'first upload → hero');
  ok(out.about && about.image === tiny && about.imageSource === 'Your photo', 'second upload → about');
  if (gal && gal.items && gal.items.length) {
    ok(gal.items[0].image == null || gal.items[0].image === '', 'no uploads left over for gallery (source none)');
    ok(gal.items.every((it) => !it.image), 'gallery untouched by later web fetch');
  }

  // ---- 4. deep niche content packs override the generic copy bank ----
  console.log('[4] niche content packs');
  const nz = AI.generateSite('wood fired pizza restaurant in naples');
  ok(nz.aiNicheId === 'pizzeria', 'pizzeria matched — got "' + nz.aiNicheId + '"');
  ok(nz.aiNiche === 'Wood-Fired Pizzeria', 'niche display name — got "' + nz.aiNiche + '"');
  const tbl = nz.site.sections.find((s) => s.type === 'table');
  ok(!!tbl, 'niche adds a menu table section');
  ok(tbl && tbl.cols && tbl.cols[0] === 'Pizza', 'menu table carries real column headings');
  ok(tbl && tbl.rows && tbl.rows.length >= 4, 'menu table carries real rows (' + (tbl && tbl.rows && tbl.rows.length) + ')');
  ok(/450°C|wood|blister|dough|tomatoes|mozzarella/i.test(nz.site.tagline || ''), 'tagline from the niche bank — "' + nz.site.tagline + '"');
  ok(nz.aiScenes && /pizza oven/.test(nz.aiScenes.hero || ''), 'niche scenes drive the photo engine');
  const cf = AI.generateSite('specialty coffee roastery with a cafe');
  ok(cf.aiNicheId === 'coffee' && cf.site.sections.some((s) => s.type === 'table'), 'coffee niche adds a drink menu — got "' + cf.aiNicheId + '"');
  const pl = AI.generateSite('website for my business');
  ok(!pl.aiNicheId, 'vague prompt gets no phantom niche — got "' + pl.aiNicheId + '"');

  // ---- 5. photo picker + hero/about photo fallback regression ----
  console.log('[5] photoPicks() + hero/about photo fallback');
  const pp = AI.generateSite('pizza place');
  pp.site.sections = pp.site.sections.filter((s) => s.type === 'hero' || s.type === 'about' || s.type === 'gallery');
  const pickSlots = await AI.photoPicks(pp, { prompt: 'pizza place', online: false });
  ok(pickSlots.length >= 2, 'picker returns hero/about/gallery slots (' + pickSlots.length + ')');
  ok(pickSlots[0] && pickSlots[0].key === 'hero', 'first slot is the hero');
  ok(pickSlots.every((s) => typeof s.label === 'string' && s.label.length > 0), 'every slot has a label');
  ok(pickSlots.every((s) => Array.isArray(s.pool)), 'every slot carries a pool array');
  ok(pickSlots.every((s) => s.sec && typeof s.sec === 'object'), 'every slot references its live section');
  // regression: hero + about fallbacks must actually WRITE the photo — the
  // old code reported success but put() received slot.sec of a raw section
  // (undefined), so out.hero was true while the section stayed empty
  const reg = AI.generateSite('pizza place');
  reg.site.sections = reg.site.sections.filter((s) => s.type === 'hero' || s.type === 'about' || s.type === 'gallery');
  const h0 = reg.site.sections.find((s) => s.type === 'hero');
  const a0 = reg.site.sections.find((s) => s.type === 'about');
  const g0 = reg.site.sections.find((s) => s.type === 'gallery');
  const rOut = await AI.generateImages(reg, 'pizza place', { source: 'real', online: false });
  ok(rOut.hero && !!h0.image && !!h0.imageSource, 'hero fallback really lands a photo (regression)');
  ok(rOut.about && !!a0.image && !!a0.imageSource, 'about fallback really lands a photo (regression)');
  ok(!g0 || g0.items.every((it) => !!it.image), 'gallery tiles all filled (regression)');

  // ---- 6. three-direction Design Lab ----
  console.log('[6] generateDirections() + remixDirection()');
  const directions = AI.generateDirections('a premium wood-fired pizzeria in Bristol', { tier: 'free', name: 'Tavola Bristol' });
  ok(Array.isArray(directions) && directions.length === 3, 'returns exactly three directions');
  ok(directions.every((d) => d && d.site && d.site.name === 'Tavola Bristol'), 'directions keep one stable business name');
  ok(new Set(directions.map((d) => d.directionId)).size === 3, 'directions have distinct direction identities');
  ok(new Set(directions.map((d) => d.dnaLook)).size === 3, 'directions have distinct design looks');
  ok(new Set(directions.map((d) => d.site.palette)).size >= 2, 'directions vary their palettes');
  ok(directions.every((d) => d.directionName && d.directionBlurb), 'every direction carries presentation metadata');
  ok(directions.every((d) => d.site.sections.some((s) => s.type === 'hero')), 'every direction keeps a hero');
  const originalJson = JSON.stringify(directions[0]);
  const remix = AI.remixDirection(directions[0], { tier: 'free', seed: 17 });
  ok(!!remix && remix !== directions[0], 'remix returns a separate draft');
  ok(remix && remix.id !== directions[0].id, 'remix gets a new draft ID');
  ok(remix && remix.site && remix.site.name === directions[0].site.name, 'remix keeps the business content');
  ok(remix && remix.dnaLook !== directions[0].dnaLook, 'remix changes the design look');
  ok(JSON.stringify(directions[0]) === originalJson, 'remixing does not mutate the original draft');

  // ---- 7. publish quality gate + conservative repairs ----
  console.log('[7] qualityGate() + repairQuality()');
  const broken = {
    id: 'quality-test', name: 'Quality test',
    site: {
      name: '', palette: 'midnight', ctaText: '', ctaLink: 'javascript:alert(1)', url: 'example.com',
      sections: [
        { type: 'features', id: 'duplicate', items: [{ title: 'Craft', text: 'Careful work', image: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', alt: '' }] },
        { type: 'table', id: 'duplicate', cols: [''], rows: [['Dish', '£10'], ['Another']], layout: 'not-a-layout' }
      ],
      design: { containerWidth: 2200, radius: 80, spacing: 4 }
    }
  };
  const exportHtml = '<!doctype html><html><head></head><body><img src=""><h2>Missing primary heading</h2><a href="javascript:alert(1)">Unsafe</a></body></html>';
  const before = AI.qualityGate(broken, { html: exportHtml });
  ok(before.errors >= 3, 'gate catches model and export blocking issues (' + before.errors + ')');
  ok(before.issues.some((i) => i.id === 'html-title') && before.issues.some((i) => i.id === 'html-image-src'), 'gate reports missing title and empty image source');
  ok(before.safeFixes > 0, 'gate identifies safe model repairs');
  const repaired = AI.repairQuality(broken);
  const after = AI.qualityGate(broken);
  ok(repaired.changed > 0 && repaired.changes.length === repaired.changed, 'repair reports each applied change');
  ok(after.errors === 0, 'safe repair removes model-level blocking errors');
  ok(broken.site.name && broken.site.metaDescription && broken.site.ctaText, 'repair fills required site metadata and CTA');
  ok(broken.site.ctaLink === '#top' && String(broken.site.url).indexOf('https://') === 0, 'repair removes unsafe links and normalizes the URL');
  const fixedSections = broken.site.sections;
  const fixedTable = fixedSections.find((s) => s.type === 'table');
  ok(fixedSections.some((s) => s.type === 'hero') && fixedSections.some((s) => s.type === 'contact'), 'repair restores the hero and contact path');
  ok(new Set(fixedSections.map((s) => s.id)).size === fixedSections.length, 'repair makes section IDs unique');
  ok(fixedTable && fixedTable.cols.every((c) => c) && fixedTable.rows.every((r) => r.length === fixedTable.cols.length), 'repair fixes table headings and row shape');
  const fixedFeature = fixedSections.find((s) => s.type === 'features');
  ok(fixedFeature && fixedFeature.items[0].alt, 'repair adds meaningful image alt text');

  // Additional pages are audited and repaired without sharing IDs across documents.
  const multi = AI.generateSite('a modern bakery in Bristol', { name: 'Multi-page Bakehouse' });
  const homeSections = multi.site.sections;
  multi.site.pages = [
    { id: 'pg-home', name: 'Home', slug: 'index', sections: homeSections },
    { id: 'pg-about', name: 'About', slug: 'about', sections: [{ type: 'features', id: 'about-1', items: [] }] }
  ];
  multi.site.activePageId = 'pg-home';
  multi.site.sections = homeSections;
  const multiAudit = AI.qualityGate(multi, { html: '<html lang="en"><head><title>Home</title><meta name="viewport" content="width=device-width"></head><body><h1>Home</h1></body></html>', htmlPages: [
    { name: 'Home', slug: 'index', html: '<html lang="en"><head><title>Home</title><meta name="viewport" content="width=device-width"></head><body><h1>Home</h1></body></html>' },
    { name: 'About', slug: 'about', html: '<html><head></head><body><h2>About</h2></body></html>' }
  ] });
  ok(multiAudit.issues.some((i) => /About/.test(i.msg)), 'gate names findings on additional pages');
  const multiRepair = AI.repairQuality(multi);
  ok(multiRepair.changed > 0, 'repair traverses every page');
  ok(multi.site.pages[1].sections.some((s) => s.type === 'hero') && multi.site.pages[1].sections.some((s) => s.type === 'contact'), 'repair gives an empty secondary page a safe structure');
  ok(multi.site.sections === multi.site.pages[0].sections, 'repair preserves the active home-page alias');

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('smoke crashed:', e); process.exit(1); });
`;
try {
  vm.runInContext(code + '\n;globalThis.AI = AI;\n' + harness, sandbox);
} catch (e) {
  console.error('smoke crashed at load:', e);
  process.exit(1);
}

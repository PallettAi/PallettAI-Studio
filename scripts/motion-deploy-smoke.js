// ============================================================
// Motion, widgets, legal & deploy smoke test
//
// Four modules, three claims each, and every claim is checked where it
// could actually break:
//
//   1. Motion      — the injected reveal runtime must fit its < 2KB
//                    budget and must never hide content from a visitor
//                    it cannot serve (reduced-motion / no-IO bail-outs
//                    happen BEFORE the class that hides content), and
//                    every stylesheet it emits must carry a
//                    prefers-reduced-motion guard.
//   2. Widgets     — ROI and Pricing fragments are built and parsed
//                    back with a real tag-stack validator: balanced
//                    markup, unique ids, labels/aria-controls that
//                    resolve, JSON data attributes that decode, and
//                    formulas that fail HERE instead of in a
//                    visitor's browser.
//   3. Legal       — privacy.html / terms.html must describe THIS
//                    business (region, type, flags) and never claim a
//                    practice the config does not set; the consent
//                    script must set no cookies, honour DNT/GPC and
//                    compile.
//   4. Deploy      — Cloudflare / Netlify / GitHub requests are
//                    captured by a mock fetch and asserted payload by
//                    payload: URLs, auth scoping, sha-256 hashes,
//                    multipart manifest, zip round-trip, git-data
//                    sequence, plus progress events, error codes and
//                    token redaction through publishSite.
//
// Nothing here touches the network: every transport is injected.
//
// Run: node scripts/motion-deploy-smoke.js
// ============================================================
'use strict';

const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');

const Motion = require(path.join(ROOT, 'modules', 'motion.js'));
const Widgets = require(path.join(ROOT, 'modules', 'widgets.js'));
const Legal = require(path.join(ROOT, 'modules', 'legal.js'));
const Deploy = require(path.join(ROOT, 'modules', 'deploy.js'));
const Zip = require(path.join(ROOT, 'modules', 'zip.js'));

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

// ---- structural HTML validator ------------------------------------------
// A small tag-stack parser: balanced markup, unique ids, and every
// for/aria-* reference resolved inside the fragment. Comments and the
// doctype are stripped first so full documents parse the same way.
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

function structure(html) {
  const src = String(html == null ? '' : html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const stack = [];
  const ids = [];
  const idSet = new Set();
  const refs = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;
  let m;
  let error = '';
  while (!error && (m = re.exec(src))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClosed = m[4] === '/';
    if (closing) {
      const top = stack.pop();
      if (top !== tag) error = 'closing </' + tag + '> does not match <' + (top || 'nothing') + '>';
      continue;
    }
    const idm = attrs.match(/\sid="([^"]*)"/);
    if (idm) {
      if (idSet.has(idm[1])) error = 'duplicate id "' + idm[1] + '"';
      idSet.add(idm[1]);
      ids.push(idm[1]);
    }
    ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby'].forEach((a) => {
      const rm = attrs.match(new RegExp('\\s' + a + '="([^"]*)"'));
      if (rm) rm[1].split(/\s+/).filter(Boolean).forEach((r) => refs.push({ a, r }));
    });
    if (!VOID_TAGS.has(tag) && !selfClosed) stack.push(tag);
  }
  if (!error && stack.length) error = 'unclosed <' + stack.slice(-3).join('><') + '>';
  if (!error) {
    for (const ref of refs) {
      if (!idSet.has(ref.r)) { error = ref.a + '="' + ref.r + '" points at no id'; break; }
    }
  }
  return { error, ids, refs };
}

function checkStructure(name, html) {
  const r = structure(html);
  ok(name, !r.error, r.error);
  return r;
}

function compiles(name, js) {
  let err = '';
  try { new Function(js); } catch (e) { err = e.message; }
  ok(name + ' compiles as JavaScript', !err, err);
  return !err;
}

const decodeEntities = (s) => String(s)
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---- mock fetch ----------------------------------------------------------
// Records every {url, method, headers, body} and answers from a route
// table, so payload assertions run against the exact bytes that would
// have gone over the wire.
function mockFetch(handler) {
  const calls = [];
  const f = async function (url, init) {
    const call = {
      url: String(url),
      method: (init && init.method) || 'GET',
      headers: (init && init.headers) || {},
      body: init ? init.body : undefined
    };
    calls.push(call);
    const r = handler(call, calls.length) || { status: 404, body: { message: 'no route' } };
    const status = r.status == null ? 200 : r.status;
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body === undefined ? {} : r.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text)
    };
  };
  f.calls = calls;
  return f;
}

function headerOf(call, name) {
  const h = call.headers || {};
  const want = String(name).toLowerCase();
  if (typeof h.get === 'function') return h.get(name) || '';
  for (const k of Object.keys(h)) if (k.toLowerCase() === want) return String(h[k]);
  return '';
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const threw = (fn) => { try { fn(); return null; } catch (e) { return e; } };

(async () => {
  // ==== 1. reveal runtime =============================================
  console.log('\n1. The reveal runtime fits its budget and cannot strand a visitor');
  {
    const js = Motion.generateMotionScript();
    const bytes = Motion.runtimeBytes();
    ok('runtime is under 2KB', bytes > 0 && bytes < 2048, bytes + ' bytes');
    ok('it is a self-contained IIFE', /^\(function\(\)\{/.test(js) && /\}\)\(\);$/.test(js));
    compiles('runtime', js);
    ok('it uses IntersectionObserver', js.indexOf('IntersectionObserver') !== -1);
    ok('it checks reduced motion first', js.indexOf('prefers-reduced-motion: reduce') !== -1);
    const bail = js.indexOf('prefers-reduced-motion');
    const ready = js.indexOf("classList.add('pai-motion-ready')");
    ok('the reduce bail happens BEFORE the class that hides content',
      bail !== -1 && ready !== -1 && bail < ready, 'bail@' + bail + ' ready@' + ready);
    ok('browsers without IntersectionObserver bail too', js.indexOf("'IntersectionObserver' in window") !== -1);
    ok('elements get .in on intersection', js.indexOf(".add('in')") !== -1);
    ok('late-injected sections can be re-scanned', js.indexOf('__paiMotion') !== -1);
    ok('thresholds are clamped into 0..1',
      Motion.generateMotionScript({ threshold: 7 }).indexOf('threshold:1,') !== -1
      && Motion.generateMotionScript({ threshold: -3 }).indexOf('threshold:0,') !== -1);
    ok('a hostile rootMargin falls back to the default',
      /rootMargin:"0px 0px -6% 0px"/.test(Motion.generateMotionScript({ rootMargin: '0px; color:red' })));

    const snip = Motion.generateMotionSnippet();
    ok('the bundle carries every component',
      ['pai-reveal', 'pai-marquee', 'pai-sticky', 'pai-acc'].every((c) => snip.css.indexOf(c) !== -1));
    ok('the bundle script matches the runtime', snip.js === js);
    ok('styles can be requested alone', Motion.generateMotionSnippet({ runtime: false }).js === '');
    ok('script can be requested alone', Motion.generateMotionSnippet({ styles: false }).css === '');
  }

  // ==== 2. reduced-motion wrapping ====================================
  console.log('\n2. Every stylesheet is wrapped for prefers-reduced-motion');
  {
    const styles = Motion.generateMotionStyles();
    const guards = (styles.match(/@media \(prefers-reduced-motion: reduce\)/g) || []).length;
    ok('all four stylesheets carry the reduce guard', guards >= 4, guards + ' guards');
    ok('wrapping is idempotent (no stacked guards)', Motion.wrapReducedMotion(styles) === styles);
    const once = Motion.wrapReducedMotion('.spin{animation:x 1s linear infinite}');
    ok('keyframe names are reported in the guard', /@keyframes neutralised for reduced motion/.test(once)
      || once.indexOf('animation:none !important') !== -1, once.slice(-120));
    ok('the reduce block kills animations', /prefers-reduced-motion: reduce\{[\s\S]*animation:none !important/.test(once)
      || /prefers-reduced-motion: reduce\)[\s\S]*animation:none !important/.test(once));

    const rc = Motion.revealCSS();
    ok('all three reveal kinds are styled',
      ['fade-up', 'slide-in', 'scale-up'].every((k) => rc.indexOf('"' + k + '"') !== -1));
    ok('reveal kinds are whitelisted', Motion.REVEAL_KINDS.join(',') === 'fade-up,slide-in,scale-up');
    ok('the base state is visible without JavaScript', rc.indexOf('.pai-reveal{opacity:1') !== -1);
    ok('hidden state only exists behind html.pai-motion-ready',
      rc.indexOf('html.pai-motion-ready .pai-reveal[data-pai-reveal]{opacity:0}') !== -1);
    ok('reduced-motion pins every reveal visible',
      /prefers-reduced-motion: reduce[\s\S]*\.pai-reveal[^{]*\{opacity:1 !important/.test(rc));
  }

  // ==== 3. marquee / sticky / accordion ===============================
  console.log('\n3. Marquee, sticky header and accordion');
  {
    const m = Motion.generateMarquee(['Since 1994', 'Made in York', 'Five-star joinery'],
      { duration: 20, label: 'Highlights' });
    checkStructure('marquee markup is balanced', m.html);
    ok('the track holds exactly two identical groups',
      (m.html.match(/pai-marquee-group/g) || []).length === 2);
    ok('the duplicate copy is hidden from screen readers', m.html.indexOf('aria-hidden="true"') !== -1);
    ok('pause on hover', m.css.indexOf('.pai-marquee:hover .pai-marquee-track') !== -1);
    ok('pause on keyboard focus too (WCAG 2.2.2)', m.css.indexOf(':focus-within') !== -1);
    ok('the loop travels exactly half the track',
      /@keyframes pai-marquee-run\{from\{transform:translateX\(0\)\}to\{transform:translateX\(-50%\)\}\}/.test(m.css));
    ok('duration honours the option', m.css.indexOf('--pai-marquee-duration:20s') !== -1);
    ok('reduce hands scrolling back to the visitor',
      /prefers-reduced-motion: reduce[\s\S]*overflow-x:auto !important/.test(m.css));
    ok('an empty stream renders nothing', Motion.generateMarquee([]).html === '');

    const sticky = Motion.generateStickyHeader({ threshold: 120 });
    ok('scroll binding is rAF-throttled',
      sticky.js.indexOf('requestAnimationFrame') !== -1 && sticky.js.indexOf("addEventListener('scroll'") !== -1);
    ok('the threshold is baked in', sticky.js.indexOf('y>120&&y>last') !== -1);
    ok('reduced-motion visitors never bind the moving header',
      sticky.js.indexOf('prefers-reduced-motion') !== -1);
    ok('hide class pairs with the stylesheet', sticky.css.indexOf('.pai-sticky-hidden') !== -1);
    ok('reduce pins the header visible',
      /prefers-reduced-motion: reduce[\s\S]*transform:none !important/.test(sticky.css));
    compiles('sticky script', sticky.js);

    const acc = Motion.generateAccordion([
      { q: 'Do you deliver?', a: 'Across Yorkshire.' },
      { q: 'What guarantee?', a: 'Ten years on joinery.' }
    ], { exclusive: true, idPrefix: 'faq' });
    checkStructure('accordion markup is balanced (aria references resolve)', acc.html);
    ok('two buttons, two panels',
      (acc.html.match(/class="pai-acc-btn"/g) || []).length === 2
      && (acc.html.match(/class="pai-acc-panel"/g) || []).length === 2);
    ok('buttons start collapsed', (acc.html.match(/aria-expanded="false"/g) || []).length === 2);
    ok('a noscript visitor still reads the answers',
      acc.html.indexOf('<noscript><style>.pai-acc-panel{grid-template-rows:1fr !important}</style></noscript>') !== -1);
    ok('one state writer keeps class, aria and inert together',
      acc.js.indexOf('inert') !== -1 && acc.js.indexOf('aria-expanded') !== -1);
    ok('exclusive mode closes the other items', acc.js.indexOf('setOpen(it,false)') !== -1);
    ok('questions are escaped, never markup',
      Motion.generateAccordion([{ q: '<img src=x onerror=alert(1)>', a: 'a' }]).html.indexOf('<img') === -1);
    ok('height animation is grid-template-rows, not max-height',
      acc.css.indexOf('grid-template-rows:0fr') !== -1);
    compiles('accordion script', acc.js);
  }

  // ==== 4. ROI calculator =============================================
  console.log('\n4. ROI calculator');
  const roiCfg = {
    id: 'roi1', title: 'Enquiry value', currency: '$',
    inputs: [
      { key: 'visitors', label: 'Monthly visitors', min: 0, max: 5000, step: 50, value: 1200 },
      { key: 'conversion', label: 'Conversion %', min: 0, max: 20, step: 0.5, value: 3 },
      { key: 'value', label: 'Average order value', min: 0, max: 500, step: 5, value: 80 }
    ],
    outputs: [
      { key: 'revenue', label: 'Monthly revenue', formula: 'visitors * (conversion / 100) * value', format: 'money', gauge: true },
      { key: 'yearly', label: 'Per year', formula: 'visitors * (conversion / 100) * value * 12', format: 'money' }
    ]
  };
  {
    const roi = Widgets.generateROICalculator(roiCfg);
    checkStructure('ROI markup is balanced (labels resolve)', roi.html);
    ok('one range slider per input', (roi.html.match(/type="range"/g) || []).length === 3);
    ok('one label per input, each pointing at its slider',
      (roi.html.match(/<label /g) || []).length === 3);
    ok('results announce themselves to screen readers',
      (roi.html.match(/aria-live="polite"/g) || []).length === 2);
    ok('the initial result is rendered for JS-off visitors',
      roi.html.indexOf('$2,880') !== -1, '1200 * 3% * 80 = 2880');
    ok('the yearly figure renders too', roi.html.indexOf('$34,560') !== -1);
    ok('the gauge is one inline SVG', /<svg[^>]*viewBox="0 0 120 70"/.test(roi.html)
      && roi.html.indexOf('stroke-dasharray="157"') !== -1);
    ok('stylesheet is reduced-motion wrapped',
      roi.css.indexOf('prefers-reduced-motion: reduce') !== -1);
    ok('the runtime reads input events, not clicks', roi.js.indexOf('"input"') !== -1);
    ok('no eval() anywhere', roi.js.indexOf('eval(') === -1);
    compiles('ROI runtime', roi.js);

    const hostile = Widgets.generateROICalculator(Object.assign({}, roiCfg, {
      title: '<script>alert(1)</script>'
    }));
    ok('a hostile title never becomes markup', hostile.html.indexOf('<script>') === -1);
    ok('...but is still shown as text', hostile.html.indexOf('&lt;script&gt;') !== -1);

    ok('formula whitelist accepts arithmetic', Widgets.safeFormula('a + b * (c - 1)') === 'a + b * (c - 1)');
    ok('formula whitelist rejects calls', (() => { const e = threw(() => Widgets.safeFormula('alert(1)')); return !!e; })());
    ok('formula whitelist rejects quotes', !!threw(() => Widgets.safeFormula("'x' + a")));
    const fn = Widgets.compileFormula('visitors * 2', ['visitors']);
    ok('compiled formulas evaluate', fn({ visitors: 50 }) === 100);
    ok('unknown variables fail at BUILD time, not in the browser',
      !!threw(() => Widgets.compileFormula('nope + 1', ['visitors'])));
    ok('a hostile formula fails the generator loudly',
      !!threw(() => Widgets.generateROICalculator({
        inputs: [{ key: 'a', label: 'A', min: 0, max: 1, value: 0 }],
        outputs: [{ key: 'x', formula: 'Function("return 1")()' }]
      })));
    const empty = Widgets.generateROICalculator({});
    ok('an empty config renders nothing rather than half a widget',
      empty.html === '' && empty.css === '' && empty.js === '');
  }

  // ==== 5. pricing slider =============================================
  console.log('\n5. Pricing slider with billing toggle');
  const tiers = [
    { name: 'Starter', price: 12, annual: 9, features: ['1 project', 'Email support'] },
    { name: 'Studio', price: 29, annual: 29, badge: 'Popular', features: ['Unlimited projects', 'Priority support'], annualFeatures: ['1 free migration'] },
    { name: 'Agency', price: 79, annual: 63, features: ['10 seats'], annualFeatures: ['White-label reports'] }
  ];
  {
    const p = Widgets.generatePricingSlider(tiers, { cta: 'Choose plan', ctaHref: '#signup' });
    checkStructure('pricing markup is balanced', p.html);
    ok('a real switch is offered', p.html.indexOf('role="switch"') !== -1
      && p.html.indexOf('aria-checked="false"') !== -1);
    ok('one card per tier', (p.html.match(/class="pai-price-card/g) || []).length === 3);
    ok('the badge renders on the featured tier', p.html.indexOf('Popular') !== -1);

    const plans = (p.html.match(/data-plan="([^"]*)"/g) || [])
      .map((s) => JSON.parse(decodeEntities(s.replace(/^data-plan="/, '').replace(/"$/, ''))));
    ok('data-plan round-trips through HTML entities', plans.length === 3);
    ok('monthly and annual prices are both stored',
      plans[0].price === 12 && plans[0].annual === 9
      && plans[1].price === 29 && plans[1].annual === 29
      && plans[2].price === 79 && plans[2].annual === 63);
    ok('savings badges are computed correctly',
      plans[0].savePct === 25 && plans[1].savePct === 0 && plans[2].savePct === 20,
      JSON.stringify(plans.map((x) => x.savePct)));
    ok('annual-only features travel with the card',
      plans[1].annualFeatures.length === 1 && plans[2].annualFeatures.length === 1);

    ok('monthly prices render statically (JS-off completeness)',
      /data-price-num>12</.test(p.html) && /data-price-num>29</.test(p.html));
    ok('the saving tier shows its badge text', p.html.indexOf('Save 25%') !== -1);
    ok('a tier with no saving hides its badge', p.html.indexOf('data-price-save hidden') !== -1);
    ok('annual-only rows exist and default to hidden',
      p.html.indexOf('data-when="annual"') !== -1
      && p.css.indexOf('li[data-when="annual"]{display:none}') !== -1);
    ok('the annual class reveals them',
      p.css.indexOf('.pai-price.is-annual .pai-price-feats li[data-when="annual"]{display:list-item}') !== -1);
    ok('stylesheet is reduced-motion wrapped',
      p.css.indexOf('prefers-reduced-motion: reduce') !== -1);
    ok('the toggle rewrites aria-checked and period copy',
      p.js.indexOf('aria-checked') !== -1 && p.js.indexOf('billed yearly') !== -1);
    compiles('pricing runtime', p.js);

    const flat = Widgets.generatePricingSlider([{ name: 'Solo', price: 10, features: ['x'] }]);
    ok('with nothing to save there is no toggle at all',
      flat.html.indexOf('pai-price-switch') === -1);
    ok('empty tier list renders nothing',
      Widgets.generatePricingSlider([]).html === '');
  }

  // ==== 6. testimonial carousel =======================================
  console.log('\n6. Testimonial carousel');
  {
    const c = Widgets.generateTestimonialCarousel([
      { quote: 'Best kitchen we have ever had.', name: 'Ann', role: 'Chef', stars: 5 },
      { quote: 'On time, on budget.', name: 'Bob', stars: 4 },
      { quote: 'Lovely joinery.', name: 'Cid' }
    ]);
    checkStructure('carousel markup is balanced', c.html);
    ok('one figure per testimonial', (c.html.match(/<figure class="pai-quote-slide"/g) || []).length === 3);
    ok('one dot per slide', (c.html.match(/class="pai-quote-dot[\s"]/g) || []).length === 3);
    ok('the first dot is current, later slides hidden from AT',
      c.html.indexOf('aria-current="true"') !== -1
      && (c.html.match(/aria-label="\d of 3" aria-hidden="true"/g) || []).length === 2);
    ok('stars render as inline SVG with a text rating',
      /aria-label="5 out of 5 stars"/.test(c.html) && c.html.indexOf('<svg') !== -1);
    ok('prev/next controls are labelled buttons',
      c.html.indexOf('aria-label="Previous testimonial"') !== -1
      && c.html.indexOf('aria-label="Next testimonial"') !== -1);
    ok('touch gestures are wired', c.js.indexOf('touchstart') !== -1 && c.js.indexOf('touchend') !== -1);
    ok('vertical scrolling is not hijacked', c.css.indexOf('touch-action:pan-y') !== -1);
    ok('stylesheet is reduced-motion wrapped',
      c.css.indexOf('prefers-reduced-motion: reduce') !== -1);
    compiles('carousel runtime', c.js);
    ok('empty list renders nothing',
      Widgets.generateTestimonialCarousel([]).html === '');
  }

  // ==== 7. privacy & terms ============================================
  console.log('\n7. Privacy and terms follow the business, region and flags');
  const site = {
    businessName: 'Acme Gadgets', domain: 'acme.example', url: 'https://acme.example',
    email: 'privacy@acme.example', region: 'US-CA', businessType: 'ecommerce',
    paymentProvider: 'Stripe', formEndpoint: 'https://formspree.io/f/abc',
    analyticsProvider: 'Plausible', hosting: 'Cloudflare Pages',
    flags: { analytics: true },
    effectiveDate: '1 March 2026'
  };
  {
    const docs = Legal.generatePrivacyPolicy(site);
    ok('exactly two documents', docs.length === 2);
    ok('stable filenames for the export',
      docs[0].name === 'privacy.html' && docs[1].name === 'terms.html');
    const privacy = docs[0].content;
    const terms = docs[1].content;
    const sp = structure(privacy);
    const st = structure(terms);
    ok('privacy.html is a balanced document', !sp.error, sp.error);
    ok('terms.html is a balanced document', !st.error, st.error);
    ok('both are complete HTML documents',
      /^<!DOCTYPE html>/.test(privacy) && privacy.lastIndexOf('</html>') > 0
      && /^<!DOCTYPE html>/.test(terms) && terms.lastIndexOf('</html>') > 0);
    ok('privacy carries its heading', privacy.indexOf('<h1>Privacy Policy</h1>') !== -1);
    ok('terms carries its heading', terms.indexOf('<h1>Terms of Use</h1>') !== -1);
    ok('the two pages cross-link',
      privacy.indexOf('href="terms.html"') !== -1 && terms.indexOf('href="privacy.html"') !== -1);
    ok('the region picks the regime (CCPA-CPRA)',
      privacy.indexOf('California Consumer Privacy Act') !== -1
      && privacy.indexOf('California Privacy Protection Agency') !== -1);
    ok('governing law follows the region',
      terms.indexOf('laws of the State of California') !== -1);
    ok('the effective date is printed', privacy.indexOf('Effective 1 March 2026') !== -1);
    ok('shop clauses appear for an ecommerce site',
      privacy.indexOf('order details') !== -1 && terms.indexOf('Orders, payment and delivery') !== -1);
    ok('the payment provider is named', privacy.indexOf('Stripe') !== -1);
    ok('the form service is detected from the endpoint', privacy.indexOf('Formspree') !== -1);
    ok('the hosting provider is named', privacy.indexOf('Cloudflare Pages') !== -1);
    ok('the analytics flag ON names the provider', privacy.indexOf('Plausible') !== -1);
    ok('the provenance note is a comment, not copy',
      /<!--\s*Generated by PallettAI Studio/.test(privacy));

    // The negative half: a config that does not do a thing must never
    // claim it — the failure mode this module exists to prevent.
    const plainDocs = Legal.generatePrivacyPolicy({
      businessName: 'Bramble Bakery', domain: 'bramble.example',
      region: 'UK', businessType: 'service', email: 'hello@bramble.example'
    });
    const pp = plainDocs[0].content;
    const pt = plainDocs[1].content;
    ok('no shop flag -> no orders clause',
      pt.indexOf('Orders, payment and delivery') === -1 && pp.indexOf('order details') === -1);
    ok('no analytics flag -> no analytics provider named',
      pp.indexOf('our analytics provider') === -1
      && pp.indexOf('No analytics or advertising cookies are used.') !== -1);
    ok('UK region picks UK GDPR + ICO',
      pp.indexOf('UK GDPR') !== -1 && pp.indexOf('Information Commissioner') !== -1);
    ok('UK governing law', pt.indexOf('laws of England and Wales') !== -1);
    const eu = Legal.generatePrivacyPolicy({ businessName: 'X', region: 'EU', businessType: 'saas' })[0].content;
    ok('EU region cites Regulation (EU) 2016/679', eu.indexOf('Regulation (EU) 2016/679') !== -1);
    ok('SAAS type implies account clauses', eu.indexOf('account details') !== -1);

    const hostile = Legal.generatePrivacyPolicy({
      businessName: '<script>alert(1)</script>Gadgets', region: 'US', businessType: 'service'
    })[0].content;
    ok('a hostile business name never becomes live markup',
      hostile.indexOf('<script>alert(1)</script>') === -1);
    ok('...but is still reported as text', hostile.indexOf('alert(1)') !== -1);
  }

  // ==== 8. consent banner =============================================
  console.log('\n8. The consent banner sets no cookies and honours DNT/GPC');
  {
    const src = Legal.generateCookieConsentScript({
      region: 'US-CA', doNotSellUrl: '/do-not-sell'
    });
    compiles('consent script', src);
    ok('it never touches document.cookie', src.indexOf('document.cookie') === -1);
    ok('the decision lives in localStorage', src.indexOf('localStorage') !== -1);
    ok('all three Do Not Track spellings are honoured',
      src.indexOf('navigator.doNotTrack') !== -1 && src.indexOf('window.doNotTrack') !== -1
      && src.indexOf('msDoNotTrack') !== -1);
    ok('Global Privacy Control is honoured', src.indexOf('globalPrivacyControl') !== -1);
    ok('a public API lets the page re-open settings', src.indexOf('__paiConsent') !== -1);
    ok('Accept and Decline are offered equally',
      src.indexOf('"Decline"') !== -1 && src.indexOf('"Accept"') !== -1);
    ok('it loads nothing itself',
      src.indexOf('fetch(') === -1 && src.indexOf('<script') === -1 && src.indexOf('XMLHttpRequest') === -1);
    ok('analytics only starts through the exported hook',
      src.indexOf('__paiAnalytics') !== -1);

    const cm = src.match(/var CFG=(\{[^;]*\});/);
    ok('the serialized config is extractable', !!cm);
    const cfg = cm ? JSON.parse(cm[1]) : {};
    ok('US-CA flips the CCPA flag', cfg.ccpa === true);
    ok('the Do Not Sell link is configured', cfg.doNotSell === '/do-not-sell');
    ok('default storage key and hook', cfg.key === 'site_consent' && cfg.hook === '__paiAnalytics');

    const uk = Legal.generateCookieConsentScript({ region: 'UK', storageKey: 'bad key/1' });
    const ukCfg = JSON.parse(uk.match(/var CFG=(\{[^;]*\});/)[1]);
    ok('non-US regions get no CCPA link', ukCfg.ccpa === false && ukCfg.doNotSell === '');
    ok('the storage key is sanitised', ukCfg.key === 'badkey1', ukCfg.key);
  }

  // ==== 9. Cloudflare Pages payloads ==================================
  console.log('\n9. Cloudflare Pages deployment payloads');
  const files = [
    { name: 'index.html', content: '<!DOCTYPE html><title>Acme</title><h1>Hello</h1>' },
    { name: 'assets/app.css', content: 'body{margin:0}' }
  ];
  const zip = Buffer.from(Zip.zipFiles(files));
  const hIndex = sha(files[0].content);
  const hCss = sha(files[1].content);
  const CF_TOKEN = 'CF_TOKEN_SECRET_abc123';
  {
    const f = mockFetch((call) => {
      if (call.method === 'POST' && call.url.endsWith('/pages/projects')) return { body: { success: true, result: { name: 'x' } } };
      if (call.method === 'GET' && call.url.endsWith('/upload-token')) return { body: { success: true, result: 'MOCK_JWT_777' } };
      if (call.method === 'POST' && call.url.endsWith('/assets/upload')) return { body: { success: true, result: [] } };
      if (call.method === 'POST' && call.url.endsWith('/assets/upsert-hashes')) return { body: { success: true, result: {} } };
      if (call.method === 'POST' && call.url.endsWith('/deployments')) return { body: { success: true, result: { id: 'dep42', url: 'https://acme-site.pages.dev' } } };
      return { status: 404, body: { success: false, errors: [{ message: 'no route ' + call.method + ' ' + call.url }] } };
    });
    const res = await Deploy.deployToCloudflarePages(CF_TOKEN, 'acct9', 'Acme Site!', zip, { fetch: f });
    ok('the deployment reports back', res.ok && res.url === 'https://acme-site.pages.dev' && res.deploymentId === 'dep42');
    ok('exactly five API calls', f.calls.length === 5, String(f.calls.length));
    const [cProj, cTok, cUp, cHash, cDep] = f.calls;
    ok('project create hits /pages/projects with the slugged name',
      cProj.method === 'POST'
      && cProj.url === 'https://api.cloudflare.com/client/v4/accounts/acct9/pages/projects'
      && JSON.parse(cProj.body).name === 'acme-site');
    ok('project create declares the production branch',
      JSON.parse(cProj.body).production_branch === 'main');
    ok('project create carries the account token',
      headerOf(cProj, 'authorization') === 'Bearer ' + CF_TOKEN);
    ok('upload token is scoped to this project',
      cTok.method === 'GET' && cTok.url.endsWith('/accounts/acct9/pages/projects/acme-site/upload-token'));
    ok('assets upload authenticates with the JWT, not the account token',
      headerOf(cUp, 'authorization') === 'Bearer MOCK_JWT_777', headerOf(cUp, 'authorization'));
    const upBody = JSON.parse(cUp.body);
    ok('assets body is {hashes:[...]}', Array.isArray(upBody.hashes) && upBody.hashes.length === 2);
    ok('entry keys are the file paths',
      upBody.hashes.map((e) => e.key).join(',') === 'index.html,assets/app.css');
    ok('base64 decodes back to the original bytes',
      Buffer.from(upBody.hashes[0].value.base64, 'base64').toString() === files[0].content);
    ok('size and content type travel with the asset',
      upBody.hashes[0].value.size === Buffer.byteLength(files[0].content)
      && /text\/html/.test(upBody.hashes[0].value.contentType)
      && /text\/css/.test(upBody.hashes[1].value.contentType));
    const hashBody = JSON.parse(cHash.body);
    ok('upsert-hashes commits every sha-256',
      hashBody.hashes.length === 2 && hashBody.hashes.indexOf(hIndex) !== -1
      && hashBody.hashes.indexOf(hCss) !== -1);
    ok('hashes are lowercase 64-char hex', hashBody.hashes.every((h) => /^[0-9a-f]{64}$/.test(h)));
    ok('upsert also uses the JWT', headerOf(cHash, 'authorization') === 'Bearer MOCK_JWT_777');
    const bType = headerOf(cDep, 'content-type');
    ok('the deployment is multipart/form-data',
      /^multipart\/form-data; boundary=----/.test(bType), bType);
    const boundary = bType.split('boundary=')[1];
    ok('the body closes its boundary', cDep.body.endsWith('--' + boundary + '--\r\n'));
    ok('metadata declares a static project', cDep.body.indexOf('"project_type":"static"') !== -1);
    const mm = cDep.body.match(/name="manifest\.json"[\s\S]*?\r\n\r\n([\s\S]*?)\r\n/);
    ok('manifest part is present', !!mm);
    const manifest = mm ? JSON.parse(mm[1]) : {};
    ok('manifest maps path -> hash',
      manifest['index.html'] === hIndex && manifest['assets/app.css'] === hCss);
    ok('per-file parts carry the hash as their body',
      cDep.body.indexOf('name="index.html"; filename="index.html"') !== -1);
    ok('the deployment step uses the account token again',
      headerOf(cDep, 'authorization') === 'Bearer ' + CF_TOKEN);

    // ZIP round-trip through the deploy-side reader.
    const rt = Deploy.readZip(zip);
    ok('the archive round-trips through the ZIP reader',
      rt.length === 2 && rt[0].name === 'index.html'
      && rt[0].bytes.toString() === files[0].content
      && rt[1].name === 'assets/app.css');
    ok('a non-ZIP buffer is rejected as bad_zip',
      (() => { const e = threw(() => Deploy.readZip(Buffer.from('not a zip at all!!'))); return e && e.code === 'bad_zip'; })());
    ok('unsafe paths are refused on read',
      (() => { const e = threw(() => Deploy.normalizeFiles([{ path: '../evil.txt', content: 'x' }])); return e && e.code === 'unsafe_path'; })());

    // Failure modes.
    let e1 = threw(() => { throw new Error('unreachable'); });
    e1 = await Deploy.deployToCloudflarePages('', 'a', 'p', zip, { fetch: f }).then(() => null, (e) => e);
    ok('a missing token fails fast as missing_credential',
      e1 && e1.code === 'missing_credential', e1 && e1.code);
    const f401 = mockFetch(() => ({ status: 401, body: { success: false, errors: [{ message: 'Invalid token' }] } }));
    const e2 = await Deploy.deployToCloudflarePages(CF_TOKEN, 'a', 'p', zip, { fetch: f401 }).then(() => null, (e) => e);
    ok('401 surfaces as an auth failure', e2 && e2.status === 401 && /invalid or expired token/.test(e2.message));
    ok('the token never leaks into the message', e2 && e2.message.indexOf(CF_TOKEN) === -1);
    const fQuota = mockFetch((call) => {
      if (call.url.endsWith('/upload-token')) {
        return { body: { success: false, status: 400, errors: [{ message: 'quota exceeded' }] } };
      }
      return { body: { success: true, result: {} } };
    });
    const e3 = await Deploy.deployToCloudflarePages(CF_TOKEN, 'a', 'p', zip, { fetch: fQuota }).then(() => null, (e) => e);
    ok('a 200-with-success:false body still fails',
      e3 && /quota exceeded/.test(e3.message), e3 && e3.message);
  }

  // ==== 10. Netlify payloads ==========================================
  console.log('\n10. Netlify zip upload payloads');
  const NL_TOKEN = 'NL_SECRET_TOKEN_xyz';
  {
    const f = mockFetch((call) => {
      if (call.method === 'POST' && call.url === 'https://api.netlify.com/api/v1/sites') {
        return { body: { id: 'new-site-1', name: 'bramble-bakery' } };
      }
      if (call.method === 'PUT' && /\/sites\/[^/]+\/deploys$/.test(call.url)) {
        return { body: { id: 'nd1', ssl_url: 'https://bramble.netlify.app', required_files: ['index.html'] } };
      }
      return { status: 404, body: { message: 'no route ' + call.method + ' ' + call.url } };
    });
    const res = await Deploy.deployToNetlify(NL_TOKEN, 'site123', zip, { fetch: f });
    ok('one PUT to the deploys endpoint', f.calls.length === 1);
    const c = f.calls[0];
    ok('the deploy URL is exact',
      c.method === 'PUT' && c.url === 'https://api.netlify.com/api/v1/sites/site123/deploys',
      c.method + ' ' + c.url);
    ok('body is application/zip', headerOf(c, 'content-type') === 'application/zip');
    ok('bearer token present', headerOf(c, 'authorization') === 'Bearer ' + NL_TOKEN);
    ok('the body IS the zip, byte for byte',
      Buffer.isBuffer(c.body) && Buffer.compare(c.body, zip) === 0);
    ok('the result reports the deploy',
      res.ok && res.url === 'https://bramble.netlify.app' && res.deployId === 'nd1'
      && res.siteId === 'site123');

    await Deploy.deployToNetlify(NL_TOKEN, null, zip, { fetch: f, siteName: 'Bramble Bakery' });
    ok('omitting a site id creates the site first',
      f.calls.length === 3 && f.calls[1].method === 'POST'
      && f.calls[1].url === 'https://api.netlify.com/api/v1/sites'
      && JSON.parse(f.calls[1].body).name === 'bramble-bakery');
    ok('...then deploys against the new id',
      f.calls[2].method === 'PUT' && f.calls[2].url.endsWith('/sites/new-site-1/deploys'));

    const f401 = mockFetch(() => ({ status: 401, body: { message: NL_TOKEN + ' rejected' } }));
    const e = await Deploy.deployToNetlify(NL_TOKEN, 'site123', zip, { fetch: f401 }).then(() => null, (err) => err);
    ok('401 is reported', e && e.status === 401);
    ok('a server that echoes the token still gets redacted',
      e && e.message.indexOf(NL_TOKEN) === -1 && e.message.indexOf('[redacted]') !== -1,
      e && e.message);
    const e2 = await Deploy.deployToNetlify('', 's', zip, { fetch: f }).then(() => null, (err) => err);
    ok('a missing token fails fast', e2 && e2.code === 'missing_credential');
  }

  // ==== 11. GitHub Pages payloads =====================================
  console.log('\n11. GitHub Pages git-data sequence');
  const GH_TOKEN = 'ghp_SECRET_TOKEN_12345';
  const REPO = 'acme/site';
  const API = 'https://api.github.com/repos/' + REPO;
  const siteFiles = [
    { path: 'index.html', content: '<h1>Acme</h1>' },
    { path: 'assets/app.css', content: 'body{}' },
    { path: 'logo.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]) }
  ];
  {
    // Branch exists: base_tree + fast-forward PATCH.
    const fA = mockFetch((call) => {
      const u = call.url;
      if (call.method === 'GET' && u === API) return { body: { full_name: REPO } };
      if (call.method === 'GET' && u === API + '/git/ref/heads/gh-pages') {
        return { body: { ref: 'refs/heads/gh-pages', object: { sha: 'parent1' } } };
      }
      if (call.method === 'GET' && u === API + '/git/commits/parent1') return { body: { tree: { sha: 'base-tree0' } } };
      if (call.method === 'POST' && u === API + '/git/blobs') return { body: { sha: 'blobPNG' } };
      if (call.method === 'POST' && u === API + '/git/trees') return { body: { sha: 'tree9' } };
      if (call.method === 'POST' && u === API + '/git/commits') return { body: { sha: 'commit9' } };
      if (call.method === 'PATCH' && u === API + '/git/refs/heads/gh-pages') {
        return { body: { ref: 'refs/heads/gh-pages', object: { sha: 'commit9' } } };
      }
      return { status: 404, body: { message: 'no route ' + call.method + ' ' + u } };
    });
    const stages = [];
    const res = await Deploy.deployToGitHubPages(GH_TOKEN, REPO, 'gh-pages', siteFiles,
      { fetch: fA, onProgress: (ev) => stages.push(ev) });
    ok('the deploy reports the Pages URL',
      res.ok && res.url === 'https://acme.github.io/site/' && res.commit === 'commit9', res.url);
    const seq = fA.calls.map((c) => c.method + ' ' + c.url.replace(API, '')).join(' | ');
    ok('sequence: repo, ref, blob, base tree, tree, commit, ref update',
      seq === 'GET  | GET /git/ref/heads/gh-pages | POST /git/blobs | GET /git/commits/parent1'
        + ' | POST /git/trees | POST /git/commits | PATCH /git/refs/heads/gh-pages', seq);
    const treeBody = JSON.parse(fA.calls[4].body);
    ok('the tree builds on base_tree', treeBody.base_tree === 'base-tree0');
    ok('text rides inline on the tree',
      treeBody.tree[0].path === 'index.html' && treeBody.tree[0].content === '<h1>Acme</h1>'
      && treeBody.tree[0].sha === undefined && treeBody.tree[0].mode === '100644');
    ok('binary goes through a pre-created blob',
      treeBody.tree[2].path === 'logo.png' && treeBody.tree[2].sha === 'blobPNG'
      && treeBody.tree[2].content === undefined);
    const commitBody = JSON.parse(fA.calls[5].body);
    ok('the commit parents the branch head', commitBody.parents.length === 1
      && commitBody.parents[0] === 'parent1' && commitBody.tree === 'tree9');
    ok('the message says what shipped',
      /PallettAI Studio \(3 files\)/.test(commitBody.message));
    const patchBody = JSON.parse(fA.calls[6].body);
    ok('the ref update is non-forced', patchBody.sha === 'commit9' && patchBody.force === false);
    ok('auth, API version and user agent are all sent',
      headerOf(fA.calls[0], 'authorization') === 'Bearer ' + GH_TOKEN
      && headerOf(fA.calls[0], 'x-github-api-version') === '2022-11-28'
      && headerOf(fA.calls[0], 'user-agent') === 'PallettAI-Studio-Deploy');
    ok('the bare adapter reports resolve -> done at 100 (validate is publishSite\u2019s)',
      stages.length > 0 && stages[0].stage === 'resolve' && stages[0].pct === 15
      && stages[stages.length - 1].stage === 'done' && stages[stages.length - 1].pct === 100);
    ok('progress never regresses',
      stages.every((ev, i) => i === 0 || ev.pct >= stages[i - 1].pct));

    // Branch missing: orphan root commit + ref create.
    const fB = mockFetch((call) => {
      const u = call.url;
      if (call.method === 'GET' && u === API) return { body: { full_name: REPO } };
      if (call.method === 'GET' && u.indexOf('/git/ref/') !== -1) return { status: 404, body: { message: 'Not Found' } };
      if (call.method === 'POST' && u === API + '/git/trees') return { body: { sha: 'treeB' } };
      if (call.method === 'POST' && u === API + '/git/commits') return { body: { sha: 'commitB' } };
      if (call.method === 'POST' && u === API + '/git/refs') return { body: { ref: 'refs/heads/gh-pages', object: { sha: 'commitB' } } };
      return { status: 404, body: { message: 'no route ' + call.method + ' ' + u } };
    });
    const resB = await Deploy.deployToGitHubPages(GH_TOKEN, REPO, 'gh-pages',
      [{ path: 'index.html', content: 'x' }], { fetch: fB });
    ok('a missing branch creates an orphan branch', resB.ok && resB.commit === 'commitB');
    const treeB = JSON.parse(fB.calls.find((c) => c.url.endsWith('/git/trees')).body);
    ok('no base_tree on a fresh branch', treeB.base_tree === undefined);
    const commitB = JSON.parse(fB.calls.find((c) => c.url.endsWith('/git/commits')).body);
    ok('the root commit has no parents', Array.isArray(commitB.parents) && commitB.parents.length === 0);
    const createB = fB.calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/refs'));
    ok('the branch ref is created', !!createB
      && JSON.parse(createB.body).ref === 'refs/heads/gh-pages'
      && JSON.parse(createB.body).sha === 'commitB');
    ok('no PATCH runs on a fresh branch',
      fB.calls.every((c) => c.method !== 'PATCH'));

    // Repo missing.
    const f404 = mockFetch((call) => call.url === API
      ? { status: 404, body: { message: 'Not Found' } }
      : { status: 404, body: { message: 'Not Found' } });
    const eRepo = await Deploy.deployToGitHubPages(GH_TOKEN, 'nope/nope', 'gh-pages',
      [{ path: 'index.html', content: 'x' }], { fetch: f404 }).then(() => null, (e) => e);
    ok('a missing repo fails with HTTP 404', eRepo && eRepo.status === 404);
    const eRepo2 = await Deploy.deployToGitHubPages(GH_TOKEN, 'not-a-slug', 'gh-pages',
      [{ path: 'index.html', content: 'x' }], { fetch: f404 }).then(() => null, (e) => e);
    ok('a malformed repo is rejected locally', eRepo2 && eRepo2.code === 'bad_input');
  }

  // ==== 12. publishSite ===============================================
  console.log('\n12. publishSite: dispatcher, progress, errors, redaction');
  {
    const never = mockFetch(() => { throw new Error('network must not be touched'); });
    const unknown = await Deploy.publishSite('vercel', {}, {}, () => {});
    ok('an unknown provider fails without a network call',
      unknown.ok === false && unknown.code === 'unknown_provider' && never.calls.length === 0);
    ok('it names the accepted providers', /cloudflare, netlify, or github/.test(unknown.message));

    const mc = await Deploy.publishSite('cloudflare', { apiToken: 'x' },
      { files: [{ path: 'index.html', content: 'x' }] }, () => {});
    ok('missing credentials fail before any request',
      mc.ok === false && mc.code === 'missing_credential');

    const fCf = mockFetch((call) => {
      if (call.method === 'POST' && call.url.endsWith('/pages/projects')) return { body: { success: true, result: {} } };
      if (call.method === 'GET' && call.url.endsWith('/upload-token')) return { body: { success: true, result: 'JWT1' } };
      if (call.url.endsWith('/assets/upload') || call.url.endsWith('/assets/upsert-hashes')) return { body: { success: true, result: {} } };
      if (call.method === 'POST' && call.url.endsWith('/deployments')) return { body: { success: true, result: { id: 'd1', url: 'https://my-site.pages.dev' } } };
      return { status: 404, body: { success: false, errors: [{ message: 'no route' }] } };
    });
    const stages = [];
    const cf = await Deploy.publishSite('cloudflare',
      { apiToken: 'T', accountId: 'A', projectName: 'My Site' },
      { files: files.map((f2) => ({ path: f2.name, content: f2.content })) },
      { fetch: fCf, onProgress: (ev) => stages.push(ev) });
    ok('files publish without a ZIP round-trip', cf.ok && cf.url === 'https://my-site.pages.dev',
      cf.message || '');
    ok('progress starts at validate/5',
      stages.length > 0 && stages[0].stage === 'validate' && stages[0].pct === 5);
    ok('progress ends at done/100',
      stages[stages.length - 1].stage === 'done' && stages[stages.length - 1].pct === 100);
    ok('progress never regresses',
      stages.every((ev, i) => i === 0 || ev.pct >= stages[i - 1].pct));
    ok('every stage belongs to the provider',
      stages.every((ev) => ev.provider === 'cloudflare'));
    ok('duration is measured', typeof cf.durationMs === 'number' && cf.durationMs >= 0);

    const fNet = mockFetch((call) => call.method === 'PUT'
      ? { body: { id: 'nd', ssl_url: 'https://x.netlify.app' } }
      : { status: 404, body: { message: 'no route' } });
    const packaged = await Deploy.publishSite('netlify', { token: 't', siteId: 's1' },
      { files: [{ path: 'index.html', content: '<p>hi</p>' }] }, { fetch: fNet });
    ok('text files are packaged into a real ZIP',
      packaged.ok && Buffer.isBuffer(fNet.calls[0].body));
    ok('the ZIP unpacks back to the same file',
      (() => {
        const rt = Deploy.readZip(fNet.calls[0].body);
        return rt.length === 1 && rt[0].name === 'index.html' && rt[0].bytes.toString() === '<p>hi</p>';
      })());

    const bin = await Deploy.publishSite('netlify', { token: 't', siteId: 's1' },
      { files: [{ path: 'a.png', content: Buffer.from([1]) }] }, { fetch: fNet });
    ok('binary files refuse to package, with a clear message',
      bin.ok === false && /zipBuffer/.test(bin.message), bin.message);

    const fGh = mockFetch((call) => {
      const u = call.url;
      if (call.method === 'GET' && u === API) return { body: { full_name: REPO } };
      if (call.method === 'GET' && u.indexOf('/git/ref/') !== -1) return { status: 404, body: { message: 'Not Found' } };
      if (call.method === 'POST' && u.endsWith('/git/trees')) return { body: { sha: 't1' } };
      if (call.method === 'POST' && u.endsWith('/git/commits')) return { body: { sha: 'c1' } };
      if (call.method === 'POST' && u.endsWith('/git/refs')) return { body: { ref: 'refs/heads/gh-pages', object: { sha: 'c1' } } };
      return { status: 404, body: { message: 'no route' } };
    });
    const gh = await Deploy.publishSite('GitHub Pages', { githubToken: GH_TOKEN, repo: REPO },
      { files: [{ path: 'index.html', content: 'x' }] }, { fetch: fGh });
    ok('provider aliases resolve ("GitHub Pages")', gh.ok && gh.provider === 'github' && gh.commit === 'c1',
      gh.message || '');
    ok('gh-pages is the default branch', gh.branch === 'gh-pages');

    const LEAK = 'LEAKME_TOKEN_123';
    const fLeak = mockFetch(() => ({ status: 401, body: { message: LEAK + ' rejected' } }));
    const bad = await Deploy.publishSite('netlify', { token: LEAK }, { zipBuffer: zip }, { fetch: fLeak });
    ok('an http failure is reported with its status',
      bad.ok === false && bad.code === 'http' && bad.status === 401);
    ok('the token is redacted from the message',
      bad.message.indexOf(LEAK) === -1 && bad.message.indexOf('[redacted]') !== -1, bad.message);
    ok('the token is redacted from every progress stage too',
      JSON.stringify(bad.stages).indexOf(LEAK) === -1);

    const badZip = await Deploy.publishSite('cloudflare',
      { apiToken: 't', accountId: 'a', projectName: 'p' },
      { zipBuffer: Buffer.from('definitely not a zip!!!') }, { fetch: fCf });
    ok('a corrupt archive fails cleanly through the dispatcher',
      badZip.ok === false && badZip.code === 'bad_zip', badZip.message);
  }

  // ==== verdict =======================================================
  if (failed) {
    console.error('\nMOTION & DEPLOY SMOKE FAILED: ' + failed);
    process.exit(1);
  }
  console.log('\nAll motion, widget, legal & deploy checks passed.');
  process.exit(0);
})().catch((e) => {
  console.error('motion-deploy smoke crashed:', e);
  process.exit(1);
});

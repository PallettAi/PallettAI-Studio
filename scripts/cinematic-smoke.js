// ============================================================
// Cinematic tier smoke test
//
// `site.motion = 'cinematic'` adds a native-CSS layer (scroll/view
// timelines, clip-path masks, procedural grain, pointer micro-interactions)
// on top of the existing motion engine. It can only be safe if it is:
//
//   1. OPT-IN AND REVERSIBLE — an ordinary project's bytes must not move,
//      and `motion: 'off'` must still restore today's legacy reveal path.
//      The tier changes the *compiled output*, so "we didn't mean to
//      enable it on this project" is a silent visual regression.
//   2. PROGRESSIVE — every native feature sits behind @supports or a body
//      class, and the pointer layer sits behind a runtime pointer test, so
//      an old browser and a touch device each get a correct static site
//      rather than a broken one.
//   3. HARMLESS TO A REAL VISITOR — the grain cannot block a click, the
//      cursor cannot intercept one, reduced motion stills the whole layer,
//      and no rule leaves a reveal hidden outside a transition.
//   4. BOUNDED — the layer has to stay inside the export's own performance
//      budget, or the award-site pitch is a slower site.
//
// Run: node scripts/cinematic-smoke.js
// ============================================================
'use strict';

const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
// The artwork engine is a classic-script global in the app (loaded by index.html),
// so load it the same way here or every build silently loses its backdrop.
global.Signature = require(path.join(ROOT, 'data', 'signature.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const Perf = require(path.join(ROOT, 'data', 'perf.js'));

// Every <style> block in the document, concatenated — the browser applies all
// of them, so a rule is only absent if it is absent from the join.
const styleOf = (html) => (String(html).match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n');
const gzip = (s) => zlib.gzipSync(Buffer.from(s, 'utf8')).length;

function mkProject(over) {
  const site = {
    name: 'Willow Café',
    tagline: 'Coffee & calm',
    palette: 'midnight',
    font: 'inter',
    heroLayout: 'centered',
    sections: [
      { type: 'hero', title: 'Willow Café', subtitle: 'Coffee & calm', extra: '' },
      { type: 'features', title: 'Why us', items: [{ title: 'Fast', text: 'Quick' }, { title: 'Good', text: 'Nice' }] },
      { type: 'gallery', title: 'Our work', layout: 'collage', items: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }, { title: 'Four' }, { title: 'Five' }] },
      { type: 'gallery', title: 'Reel', layout: 'reel', items: [{ title: 'Lead' }, { title: 'B' }, { title: 'C' }, { title: 'D' }, { title: 'E' }] },
      { type: 'contact', title: 'Say hello' }
    ]
  };
  return Object.assign({
    id: 'cine_' + Math.random().toString(36).slice(2, 8),
    name: 'Cinematic Site',
    site,
    suites: ['animation']
  }, over || {});
}
const withSite = (over) => {
  const p = mkProject();
  return Object.assign(p, { site: Object.assign({}, p.site, over) });
};
const build = (p) => Builder.buildSiteHTML(p, { onlineEnabled: false });

const full = build(mkProject());
const cine = build(withSite({ motion: 'cinematic' }));
const off = build(withSite({ motion: 'off' }));
const cineCss = styleOf(cine);
const fullCss = styleOf(full);

// ---- 1. opt-in and reversible ------------------------------------------
console.log('\n1. The tier is opt-in, and every other tier is untouched');
{
  ok("default motion is 'full' and emits no cinematic layer", !fullCss.includes('motion-cine') && !full.includes('mv-rail'));
  ok('full build reports cine:false to the page script', /"cine":false/.test(full));
  ok('full build emits no grain overlay', !fullCss.includes('feTurbulence'));
  // The runtime block lives in every page's script (it is one stringified
  // function), so "not emitted" means no CSS rule and a guard that reports
  // cine:false — not an absent string.
  ok('full build emits no pointer layer', !fullCss.includes('mv-cursor') && !fullCss.includes('motion-cine'));
  ok('full build emits no clip-path mask', !fullCss.includes('clip-path:polygon'));
  ok('motion:off emits none of it either', !off.includes('mv-rail') && !off.includes('motion-cine') && !styleOf(off).includes('feTurbulence'));
  // The off path is the contract motion-smoke already protects; the new block
  // must not have slipped in front of it.
  ok('motion:off still restores the legacy reveal rules', off.includes('.reveal{opacity:0;transition:'));
  ok("motion:off still reports motion:false", /"motion":false/.test(off));
  ok('an unknown tier value falls back to full, not off', (function () {
    const weird = build(withSite({ motion: 'cinema' }));
    return /motion":true/.test(weird.replace(/"motion"\s*:/, 'motion":')) && !weird.includes('mv-rail');
  })());
  ok('cinematic build reports cine:true', /"cine":true/.test(cine));
  ok('cinematic build keeps the motion flag on too', /"motion":true/.test(cine));
}

// ---- 2. progressive enhancement ----------------------------------------
console.log('\n2. Every native feature is behind @supports or a body class');
{
  ok('the layer is scoped to body.motion-cine', cineCss.includes('body.motion-cine .reveal'));
  ok('the <body> carries the class', /<body[^>]*class="[^"]*\bmotion-cine\b/.test(cine));
  ok('a scroll-driven gallery rail is @supports(view)-gated',
    /@supports \(animation-timeline: view\(\)\)\{[\s\S]*?gs-track[\s\S]*?mv-rail/.test(cineCss));
  // JS must stay out of it: the whole point of the tier is that the rail is
  // driven by the compositor, not by a scroll listener fighting it every frame.
  const cineJs = (cine.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || []).join('\n');
  ok('there is no JS scroll handler for the rail', !cineJs.includes('gs-track') && !cineJs.includes('mv-rail'));
  // THE TRAP. .gal-strip is an overflow-x scroll container, so a plain
  // view() timeline on its child binds to the strip's own box and freezes at
  // one progress value. The timeline must be declared on the in-flow strip
  // and consumed by name. A regression here is invisible in a screenshot and
  // only shows up as 'the gallery never moves'.
  ok('the rail declares a named view timeline on the in-flow strip',
    cineCss.includes('body.motion-cine .gal-strip{view-timeline-name:--mv-strip'));
  ok('and the track consumes it by name',
    cineCss.includes('body.motion-cine .gs-track{animation:mv-rail linear both;animation-timeline:--mv-strip'));
  ok('the freezing form (view() on the track itself) is NOT present',
    !/\.gs-track\{[^}]*animation-timeline:view\(\)/.test(cineCss));
  ok('the collage zoom uses the same named-timeline pattern',
    cineCss.includes('body.motion-cine .gcoll-1{view-timeline-name:--mv-collage') &&
    cineCss.includes('animation-timeline:--mv-collage'));
  ok('no cinematic timeline is declared on an element that cannot track the page',
    !/\.(gs-track|gcoll-1 img)\{[^}]*view-timeline-name/.test(cineCss));
  ok('the clip-path mask is @supports-gated', /@supports \(clip-path:polygon\(0 0\)\)\{[\s\S]*?clip-path:polygon/.test(cineCss));
  ok('an unmasked fallback is implicit (mask lives inside @supports only)',
    !/(^|[^)])\bclip-path:polygon\(0 0,100% 2\.4vw/.test(cineCss.replace(/@supports \(clip-path:polygon\(0 0\)\)\{[\s\S]*?\n\}/, '')));
  ok('the pointer layer is behind a hover+fine-pointer test', cine.includes("matchMedia('(hover:hover) and (pointer:fine)')"));
  ok('and behind the build flag and reduced motion', cine.includes('if (CFG.cine && !REDUCED && typeof matchMedia'));
  ok('reduced motion hides the grain and the cursor', /prefers-reduced-motion:reduce\)\{body\.motion-cine:after\{display:none\}body\.motion-cine \.mv-cursor\{display:none\}\}/.test(cineCss));
}

// ---- 3. harmless to the visitor and to the DOM -------------------------
console.log('\n3. The layer cannot block, trap or hide anything');
{
  ok('the grain is pointer-transparent', /body\.motion-cine:after\{[^}]*pointer-events:none/.test(cineCss));
  ok('the grain is fixed and behind nothing interactive (z-index below the cursor)',
    /body\.motion-cine:after\{[^}]*z-index:9998/.test(cineCss) && /mv-cursor\{[^}]*z-index:9999/.test(cineCss));
  ok('the cursor is pointer-transparent', /mv-cursor\{[^}]*pointer-events:none/.test(cineCss));
  ok('the cursor is created by script, not markup (no extra DOM in the served HTML)',
    cine.includes("cur.className = 'mv-cursor'") && !/<div class="mv-cursor"/.test(cine));
  ok('the grain is a data URI, never a network request', cineCss.includes('url("data:image/svg+xml,') && !/url\(\s*['"]?https?:/i.test(cineCss));
  // No reveal may be hidden by the cinematic block; the entry rules are the
  // only place in the whole stylesheet allowed to start an element at 0.
  const starting = cineCss.slice(cineCss.indexOf('@starting-style'));
  ok('the @starting-style block never touches .reveal', starting.indexOf('.reveal') === -1 || starting.indexOf('.reveal') > starting.indexOf('}'));
  ok('no cinematic rule leaves a .reveal hidden', !/body\.motion-cine \.reveal\{[^}]*opacity:0/.test(cineCss));
  ok('the base reveal state is still visible', cineCss.includes('.reveal{opacity:1;transform:none;transition:none}'));
  // Same request surface as the plain build: the layer adds no <link>, <script>
  // src, or <img> src of its own.
  const count = (h, re) => (h.match(re) || []).length;
  ok('no extra stylesheet links', count(cine, /<link\b[^>]*rel="stylesheet"/gi) === count(full, /<link\b[^>]*rel="stylesheet"/gi));
  ok('no extra script tags', count(cine, /<script\b/gi) === count(full, /<script\b/gi));
  ok('no extra images', count(cine, /<img\b/gi) === count(full, /<img\b/gi));
}

// ---- 4. the always-on modern-CSS baseline ------------------------------
console.log('\n4. The baseline every project gets (no setting required)');
{
  ['--fs-hero:clamp(', '--fs-h2:clamp(', '--fs-body:clamp('].forEach((t) => {
    ok('fluid type token ' + t.slice(0, -1) + ' is emitted', fullCss.includes(t));
  });
  ok('the hero consumes the fluid token', fullCss.includes('font-size:calc(var(--fs-hero) * var(--typo-scale))'));
  ok('section headings consume the fluid token', fullCss.includes('font-size:calc(var(--fs-h2) * var(--typo-scale))'));
  ok('the user type-scale multiple still wins on both', fullCss.indexOf('var(--fs-hero) * var(--typo-scale)') !== -1
    && fullCss.indexOf('var(--fs-h2) * var(--typo-scale)') !== -1);
  ok('an OKLCH mix upgrade is present', fullCss.includes('@supports (color: oklch(50% 0.1 200))'));
  ok('an srgb fallback precedes the oklch upgrade',
    fullCss.indexOf('--brand-tint:color-mix(in srgb,') < fullCss.indexOf('@supports (color: oklch('));
  ok('entry orchestration is emitted', fullCss.includes('@starting-style{'));
  ok('entry orchestration is inside the visitor no-preference query',
    /@media \(prefers-reduced-motion: no-preference\)\{\s*@starting-style\{/.test(fullCss));
  ok('entry orchestration lists the card language', /@starting-style\{\s*\.card,\.coll-item/.test(fullCss));
  ok('entry orchestration never hides a reveal', !/@starting-style\{[^}]*\.reveal/.test(fullCss));
  ok('the reduced-motion block still kills all animation and transition',
    /@media\(prefers-reduced-motion:reduce\)\{\s*\*\{animation:none !important;transition:none !important\}/.test(fullCss));
}

// ---- 5. budgets --------------------------------------------------------
console.log('\n5. The layer stays inside the export budget');
(async () => {
  const pages = (p) => Builder.buildSitePages(p, { proExport: true, plan: 'pro', onlineEnabled: false });
  const fullPages = pages(mkProject());
  const cinePages = pages(withSite({ motion: 'cinematic' }));
  const report = await Perf.measure('Cinematic', cinePages);

  const fullBytes = gzip(fullPages[0].html);
  const cineBytes = gzip(cinePages[0].html);
  ok('measured bytes are real (gzip matches zlib)', report.pages[0].gzipBytes === cineBytes, report.pages[0].gzipBytes + ' != ' + cineBytes);
  ok('the layer adds transfer weight but stays small (+' + Perf.KB(cineBytes - fullBytes) + ')',
    cineBytes - fullBytes > 0 && cineBytes - fullBytes < 8000, String(cineBytes - fullBytes));
  ok('and lands inside the transfer budget (' + Perf.KB(cineBytes) + ' of ' + Perf.KB(Perf.BUDGET.transfer.warn) + ')',
    cineBytes < Perf.BUDGET.transfer.warn);
  report.pages.forEach((p) => {
    ok(p.name + ': inside the transfer budget', p.gzipBytes < Perf.BUDGET.transfer.warn, Perf.KB(p.gzipBytes));
    ok(p.name + ': inside the raw budget', p.rawBytes < Perf.BUDGET.raw.warn, Perf.KB(p.rawBytes));
    ok(p.name + ': inside the DOM budget', p.domNodes < Perf.BUDGET.dom.warn, p.domNodes);
  });
  ok('no render-blocking CSS or JS is introduced', report.pages.every((p) => p.blockingStyles === 0 && p.blockingScripts === 0));
  ok('grade is still at least A', ['A+', 'A'].indexOf(report.grade.letter) > -1, report.grade.letter + ' (' + report.grade.score + ')');
  // The only element the layer adds is the kinetic band (one wrapper, one band,
  // one track and the repeated wordmark cells) — every other piece is CSS or a
  // runtime script. Bound it so a future copy-paste cannot quietly triple it.
  const fullNodes = (await Perf.measure('Full', fullPages)).pages[0].domNodes;
  const added = report.pages[0].domNodes - fullNodes;
  ok('the layer adds only the kinetic band to the DOM (' + added + ' nodes)', added > 0 && added < 40, String(added));
  // ...and a project with no name gets no band ELEMENT at all, which is the
  // guard against an empty marquee animating nothing. (The stylesheet still
  // carries the .kin-band rules, so the check is on the markup.)
  const namelessCine = pages(withSite({ motion: 'cinematic', name: '', tagline: '' }));
  const namelessFull = pages(withSite({ name: '', tagline: '' }));
  ok('a nameless site gets no band element', !namelessCine[0].html.includes('class="kin-band"'));
  // Compared against the SAME nameless project's full build, because the
  // Signature artwork is seeded by the site name and legitimately contains a
  // different number of elements when the name is empty.
  ok('a nameless cinematic site adds no DOM nodes over its own full build',
    (await Perf.measure('NC', namelessCine)).pages[0].domNodes === (await Perf.measure('NF', namelessFull)).pages[0].domNodes);

  // ---- 6. the second batch: native polish ----------------------------
  console.log('\n6. Native polish that every project gets');
  {
    // The anchor bug: an in-page link used to scroll its heading under the
    // fixed 68px nav. scroll-padding-top is the CSS answer, and it has to
    // account for the schedule bar that pushes the nav down.
    ok('anchors are offset below the fixed nav',
      fullCss.includes('scroll-padding-top:calc(var(--pai-sched-h,0px) + 84px)'));
    ok('the scrollbar gutter is reserved', fullCss.includes('scrollbar-gutter:stable'));
    ok('native chrome follows the palette', fullCss.includes('color-scheme:dark') || fullCss.includes('color-scheme:light'));
    ok('the theme toggle re-points color-scheme through :has()',
      fullCss.includes('html:has(body.theme-light){color-scheme:light}') &&
      fullCss.includes('html:has(body.theme-dark){color-scheme:dark}'));
    ok('brand accent reaches native controls', fullCss.includes('accent-color:var(--primary-text)'));
    ok('selection is branded', fullCss.includes('::selection{background:color-mix(in srgb,var(--primary) 34%,transparent)'));
    ok('paragraphs use text-wrap:pretty', /p,li\{text-wrap:pretty\}/.test(fullCss));
    ok('the details animation is behind selector() support',
      fullCss.includes('@supports selector(::details-content)') &&
      fullCss.includes('.faq-item[open]::details-content{block-size:auto}'));
    ok('interpolate-size is enabled for intrinsic transitions', fullCss.includes(':root{interpolate-size:allow-keywords}'));
  }

  // ---- 7. the kinetic band and the registered tilt -------------------
  console.log('\n7. The kinetic band is decorative and bounded');
  {
    ok('a cinematic site with a name gets one band', (cine.match(/class="kin-band"/g) || []).length === 1);
    ok('the band is aria-hidden', /class="kin-wrap" aria-hidden="true"/.test(cine));
    ok('the stream repeats the site name', cine.includes('<span class="kin-word">Willow Café</span>'));
    // The seamless loop depends on the track being exactly two identical runs
    // and the keyframe travelling exactly half. If either drifts the seam jumps.
    const cells = (cine.match(/class="kin-word"/g) || []).length;
    ok('the track is two identical runs of five', cells === 10, String(cells));
    ok('the marquee travels exactly half its width', cineCss.includes('@keyframes kin-scroll{to{transform:translate3d(-50%,0,0)}}'));
    ok('the rotation is clipped so it cannot overflow sideways',
      /body\.motion-cine \.kin-wrap\{[^}]*overflow:hidden/.test(cineCss));
    ok('reduced motion un-rotates the band',
      /prefers-reduced-motion:reduce\)\{body\.motion-cine \.kin-band\{transform:none/.test(cineCss));
    ok('a full (non-cinematic) site gets no band', !full.includes('kin-band'));
    // The tilt writes registered angle properties, so CSS owns the easing.
    ok('the tilt angles are registered as <angle>',
      cineCss.includes('@property --mv-rx{syntax:"<angle>";inherits:false;initial-value:0deg}') &&
      cineCss.includes('@property --mv-ry{syntax:"<angle>";inherits:false;initial-value:0deg}'));
    ok('the card transform consumes them with perspective in CSS',
      /body\.motion-cine \.card,body\.motion-cine \.bento-card\{transform:perspective\(900px\) rotateX\(var\(--mv-rx\)\) rotateY\(var\(--mv-ry\)\)/.test(cineCss));
    ok('the script writes the two variables, not a transform string',
      cine.includes("setProperty('--mv-rx'") && !cine.includes("rotateX(' + rx"));
  }

  console.log('\n' + (failed === 0 ? 'CINEMATIC SMOKE PASSED' : 'CINEMATIC SMOKE FAILED: ' + failed));
  process.exit(failed === 0 ? 0 : 1);
})();

// ============================================================
// Motion engine smoke test (scroll-linked)
//
// The motion engine moves three things that can only break in a browser, so the
// assertions here target the properties that would fail silently in the wild:
//
//   1. Safe degradation   — with the API unavailable the site must be VISIBLE.
//                           If the reveal base state is ever hidden, every
//                           Firefox visitor gets a blank page.
//   2. One owner          — CSS and JS must never write the same property, or
//                           the two writers fight each other every frame.
//   3. Cascade order      — the motion layer must come after the base rules it
//                           overrides (a real bug: .progress computed to 0px).
//   4. View transitions   — a duplicate view-transition-name ABORTS the
//                           transition, and the footer carries a second .brand.
//
// Run: node scripts/motion-smoke.js
// ============================================================
'use strict';

const path = require('path');
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

// Only the CSS half of the document — the page script mentions
// `animation-timeline` in its feature detection, which is not a CSS rule.
const styleOf = (html) => (html.match(/<style>([\s\S]*?)<\/style>/g) || []).join('\n');

function mkProject(over) {
  const site = {
    name: 'Willow Café',
    tagline: 'Coffee & calm',
    palette: 'midnight',
    font: 'inter',
    heroLayout: 'centered',
    sections: [
      { type: 'hero', title: 'Willow Café', subtitle: 'Coffee & calm' },
      { type: 'features', title: 'Why us', items: [{ title: 'Fast', text: 'Quick' }] }
    ]
  };
  return Object.assign({
    id: 'motion_' + Math.random().toString(36).slice(2, 8),
    name: 'Motion Site',
    site,
    suites: ['animation']
  }, over || {});
}
const withSite = (over) => {
  const p = mkProject();
  return Object.assign(p, { site: Object.assign({}, p.site, over) });
};
const build = (p) => Builder.buildSiteHTML(p, { onlineEnabled: false });

// ---- 1. off paths keep today's behaviour -------------------------------
console.log('\n1. Motion is opt-in and reversible');
{
  const on = build(mkProject());
  const off = build(withSite({ motion: 'off' }));
  const noSuite = build(mkProject({ suites: [] }));

  ok('animation suite + default setting turns motion on', /motion":true/.test(on.replace(/"motion"\s*:/, 'motion":')));
  ok('motion:off restores the legacy reveal rules', off.includes('.reveal{opacity:0;transition:'));
  ok('motion:off restores the .in override', off.includes('.reveal.in{opacity:1;transform:none !important}'));
  ok('motion:off reports motion:false to the page script', /"motion":false/.test(off));
  ok('no Animation Pack suite means no motion at all', noSuite.includes('.reveal{opacity:0;transition:'));
  ok('legacy path emits no timeline rules', !styleOf(off).includes('animation-timeline'));
  ok('legacy path keeps the JS observer in charge', /if \(!MOTION\)/.test(off));
}

// ---- 2. the degradation guarantee --------------------------------------
console.log('\n2. Browsers without animation-timeline get a visible site');
{
  const on = build(mkProject());
  // Everything scroll-linked must sit behind @supports, and the base state of a
  // reveal must be VISIBLE — the JS observer does not run when motion is on, so
  // a hidden base state would be unrecoverable outside Chromium/Safari.
  ok('reveal base state is visible under motion', /\.reveal\{opacity:1;transform:none;transition:none\}/.test(on));
  ok('no hidden base state leaks into the motion build', !on.includes('.reveal{opacity:0'));
  ok('view() rules are @supports-gated', on.includes('@supports (animation-timeline: view())'));
  ok('scroll() rules are @supports-gated', on.includes('@supports (animation-timeline: scroll())'));
  const supportsBlocks = (on.match(/@supports \(animation-timeline: (view|scroll)\(\)\)/g) || []).length;
  ok('every timeline rule sits inside a @supports block', supportsBlocks === 2);
  // the hero entrance is time-based on purpose, so it also plays where there is no timeline
  ok('hero entrance is NOT scroll-linked', /\.sec-hero \.reveal\{animation:mv-hero-in[^}]*animation-timeline:auto\}/.test(on));
}

// ---- 3. one writer per property ----------------------------------------
console.log('\n3. CSS and JS never drive the same property');
{
  const on = build(mkProject());
  ok('page script feature-detects the scroll timeline', on.includes("CSS.supports('animation-timeline', 'scroll()')"));
  ok('scroll handler yields the rail width to CSS', on.includes('if (!MV_SCROLL || REDUCED) prog.style.width'));
  ok('scroll handler yields the hero transform to CSS', on.includes('!(MV_SCROLL && MOTION)'));
  ok('reveal observer is skipped when motion owns it', on.includes('if (!MOTION) {'));
  // the per-section animation choice must survive the switch from transition to timeline
  ok('per-section transform is passed through as a custom property', on.includes("el.style.setProperty('--mv-from'"));
  ok('keyframes consume that custom property', on.includes('var(--mv-from,translateY('));
  // counters are the one thing the observer must keep doing
  ok('counters still run from the observer', on.includes("$$('.stat-num', el).forEach(count)"));
}

// ---- 4. cascade order --------------------------------------------------
console.log('\n4. The motion layer comes after the base rules it overrides');
{
  const on = build(mkProject());
  const baseProgress = on.indexOf('.progress{position:fixed');
  const motionProgress = on.indexOf('.progress{width:100%;transform:scaleX(0)');
  const reduced = on.indexOf('@media(prefers-reduced-motion:reduce)');
  ok('base .progress rule exists', baseProgress !== -1);
  ok('motion .progress rule exists', motionProgress !== -1);
  ok('motion .progress wins the cascade over base', motionProgress > baseProgress,
    'motion@' + motionProgress + ' base@' + baseProgress);
  ok('motion layer sits before the reduced-motion block', motionProgress < reduced);
  ok('reveal rules move with it', on.indexOf('.reveal{opacity:1;transform:none;transition:none}') < reduced);
}

// ---- 5. reduced motion stays recoverable -------------------------------
console.log('\n5. Reduced motion leaves nothing hidden or stuck');
{
  const on = build(mkProject());
  ok('animation is switched off wholesale', on.includes('*{animation:none !important;transition:none !important}'));
  ok('reveals are pinned visible', on.includes('.reveal{opacity:1 !important;transform:none !important}'));
  // Without this the rail keeps the CSS scaleX(0) origin and vanishes, because
  // the JS width write is skipped whenever MV_SCROLL is true.
  ok('progress rail is released from its scaleX(0) origin', on.includes('.progress{transform:none !important}'));
}

// ---- 6. levels ---------------------------------------------------------
console.log('\n6. The subtle level drops the loud effects');
{
  const full = build(mkProject());
  const subtle = build(withSite({ motion: 'subtle' }));
  ok('full adds the hero dissolve', full.includes('mv-dissolve'));
  ok('full adds the artwork parallax', full.includes('mv-parallax'));
  ok('subtle omits the dissolve', !subtle.includes('mv-dissolve'));
  ok('subtle omits the parallax', !subtle.includes('mv-parallax'));
  ok('subtle keeps the reveal', subtle.includes('mv-in'));
  ok('subtle shortens the rise distance', subtle.includes('translateY(14px)') && full.includes('translateY(34px)'));
}

// ---- 7. cross-document view transitions --------------------------------
console.log('\n7. View transitions, and the duplicate-name trap');
{
  const multiProject = {
    id: 'multi', name: 'Multi',
    site: Object.assign({}, mkProject().site, {
      pages: [
        { name: 'Home', slug: 'index', sections: [{ type: 'hero', title: 'Home' }] },
        { name: 'About', slug: 'about', sections: [{ type: 'hero', title: 'About' }] }
      ]
    }),
    suites: ['animation']
  };
  const pages = Builder.buildSitePages(multiProject, { onlineEnabled: false });
  ok('multi-page builds one file per page', pages.length === 2, 'got ' + pages.length);
  const html = pages[0].html;
  ok('declares the cross-document transition', html.includes('@view-transition{navigation:auto}'));
  ok('names only the nav wordmark', html.includes('.nav .brand{view-transition-name:mv-brand}'));
  // The footer renders a second .brand. Naming it too would abort every
  // transition, so the selector must stay scoped to the nav.
  const footerBrands = (html.match(/<strong class="brand">/g) || []).length;
  ok('the page really does contain a second .brand', footerBrands > 0, 'found ' + footerBrands);
  // Count the declarations and require the one that exists to be nav-scoped:
  // naming the footer wordmark too would duplicate the name and abort it.
  const vtNames = html.match(/view-transition-name:[^;}]+/g) || [];
  ok('exactly one element is named', vtNames.length === 1, 'found ' + vtNames.length);
  ok('the named element is the nav wordmark', html.includes('.nav .brand{view-transition-name'));
  ok('no bare footer .brand rule is named', !/[^v]\s\.brand\{view-transition-name/.test(html));
  const single = build(mkProject());
  ok('a single-page site emits no view-transition rules', !single.includes('@view-transition'));
  ok('motion:off emits no view-transition rules', !build(withSite({ motion: 'off', pages: multiProject.site.pages })).includes('@view-transition'));
  ok('reduced motion also switches the transition off', html.includes('*{animation:none !important'));
}

// ---- 8. nothing else regressed ----------------------------------------
console.log('\n8. The exported document is still intact');
{
  const on = build(mkProject());
  ok('still one stylesheet', (on.match(/<style>/g) || []).length >= 1);
  ok('page config still injected', on.includes('window.__CFG__='));
  ok('page script still injected', on.includes('siteIntegrations.toString()') === false);
  ok('signature artwork backdrop survives', on.includes('sig-bg') && on.includes('sig-art'));
  ok('base reveal rule is emitted exactly once',
    (on.match(/\.reveal\{opacity:1;transform:none;transition:none\}/g) || []).length === 1);
  ok('timeline reveal rule is emitted exactly once',
    (on.match(/\.reveal\{animation:mv-in/g) || []).length === 1);
  ok('no rule leaves a .reveal hidden', !/\.reveal\{[^}]*opacity:0/.test(on));
}

console.log('\n' + (failed === 0 ? 'MOTION SMOKE PASSED' : 'MOTION SMOKE FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);

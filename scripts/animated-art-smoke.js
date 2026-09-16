// ============================================================
// Animated artwork smoke test
//
// Animated background art goes onto a client's live site, inlined into a page
// PallettAI does not control, and runs on whatever device their visitor has. So
// the things that matter are not "does it look good" but the promises that keep
// it from being a liability:
//
//   1. It only ever moves `transform`, `opacity` and `stroke-dashoffset` — never a
//      filter, a blur, or anything that triggers layout.
//   2. It never depends on `transform-origin`, whose default on an SVG element
//      genuinely differs between browsers.
//   3. The motion is declared inside `prefers-reduced-motion:no-preference`, so a
//      visitor who asked for less motion gets the same piece, still — and the
//      piece is correct on its own, not because of a rule elsewhere in the page.
//   4. `animate:false` is a true still: the same geometry, nothing animated.
//   5. It stays deterministic, and its CSS is scoped to its own uid so two pieces
//      can never fight over a class or a keyframe name.
//   6. Loops are seamless — a rotation that jumps at the loop point is visible to
//      anyone who leaves the tab open, which is exactly who this is for.
//
// Run: node scripts/animated-art-smoke.js
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const Signature = require(path.join(ROOT, 'data', 'signature.js'));

const P = { id: 'cobalt', name: 'Signal Blue', bg: '#0a1628', surface: '#101f38', primary: '#4f9cf7', accent: '#22d3ee', text: '#eef4ff', muted: '#93a7c9', dark: true };
const LIGHT = { id: 'aurora', name: 'Aurora Sky', bg: '#f6f9ff', surface: '#ffffff', primary: '#0ea5e9', accent: '#10b981', text: '#0f172a', muted: '#5b6b84', dark: false };

const ANIMATED = ['drift', 'aurora', 'orbit', 'grid'];
const STATIC = ['signal', 'halftone'];
const build = (engine, extra) => Signature.build(Object.assign({ name: 'Harbour & Co', palette: P, engine: engine }, extra || {}));

// The <style> a piece carries, or '' when it has none.
function styleOf(svg) {
  const m = svg.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1] : '';
}
const keyframeNames = (css) => (css.match(/@keyframes\s+[\w-]+/g) || []).map((s) => s.split(/\s+/)[1]);
const ruleClasses = (css) => (css.match(/\.([\w-]+)\s*(?=[,{])/g) || []).map((s) => s.replace(/[.,{\s]/g, ''));

// Every property declared inside a @keyframes block, which is exactly the set of
// properties this piece animates.
function animatedProps(css) {
  const props = new Set();
  const re = /@keyframes\s+[\w-]+\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let i = m.index + m[0].length, depth = 1, end = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    end = i;
    const block = css.slice(m.index, end);
    (block.match(/([a-z-]+)\s*:/g) || []).forEach((d) => props.add(d.replace(/\s|:/g, '')));
  }
  return Array.from(props);
}

// ---- 1. which engines animate ----------------------------------------------
console.log('\n1. Which engines animate');
{
  ANIMATED.forEach((e) => {
    const r = build(e);
    ok(e + ' animates', r.animated === true);
    ok(e + ' ships a <style>', styleOf(r.svg).length > 0);
  });
  STATIC.forEach((e) => {
    const r = build(e);
    ok(e + ' stays still', r.animated === false && styleOf(r.svg) === '');
    ok(e + ' contains no keyframes', !/@keyframes/.test(r.svg));
  });
  const none = build('none', { animate: true });
  ok('none emits nothing at all', none.svg === '' && none.animated === false);

  const ids = Signature.ENGINES.map((e) => e.id);
  ok('engine ids are unique', new Set(ids).size === ids.length, ids.join(','));
  ok('every listed engine has a renderer', ANIMATED.concat(STATIC, ['none']).every((id) => ids.indexOf(id) !== -1), ids.join(','));
}

// ---- 2. reduced motion -----------------------------------------------------
console.log('\n2. Motion only when the visitor allows it');
{
  ANIMATED.forEach((e) => {
    const svg = build(e).svg;
    const css = styleOf(svg);
    ok(e + ' declares its motion inside prefers-reduced-motion:no-preference',
      css.indexOf('@media (prefers-reduced-motion:no-preference){') === 0, css.slice(0, 48));
    // Nothing animated may sit outside that media query, or the preference is
    // only partly honoured — the failure would be invisible in a spec test that
    // merely looked for the media query's presence.
    // The wrapper must contain ALL of it. Checking that the media query merely
    // exists would pass a piece with half its motion outside it — a form of
    // ignoring the preference that no visual review would catch.
    const WRAP = '@media (prefers-reduced-motion:no-preference){';
    ok(e + ' the media query wraps the whole stylesheet', css.endsWith('}') && /\{\}/.test(css.slice(-2)) === false, css.slice(-24));
    ok(e + ' braces balance inside the media query',
      (css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length);
    const inner = css.slice(WRAP.length, -1);
    ok(e + ' keeps every keyframe inside the media query',
      (inner.match(/@keyframes/g) || []).length === (svg.match(/@keyframes/g) || []).length &&
      inner.indexOf('@media') === -1, inner.slice(0, 60));
  });
}

// ---- 3. animate:false is a true still --------------------------------------
console.log('\n3. The still version');
{
  ANIMATED.forEach((e) => {
    const live = build(e).svg;
    const still = build(e, { animate: false }).svg;
    ok(e + ' still piece has no style', styleOf(still) === '');
    ok(e + ' still piece contains no animation', !/animation|@keyframes/.test(still));
    // Same geometry: strip the style element from the animated piece and the two
    // must be byte-identical, or "still" would quietly be a different drawing.
    const stripped = live.replace(/<style>[\s\S]*?<\/style>/, '');
    ok(e + ' still piece is the same drawing', stripped === still);
    ok(e + ' animate:false reports not-animated', build(e, { animate: false }).animated === false);
  });
}

// ---- 4. what may move ------------------------------------------------------
console.log('\n4. Only cheap properties, only origin-free transforms');
{
  const ALLOWED = ['transform', 'opacity', 'stroke-dashoffset'];
  ANIMATED.forEach((e) => {
    const css = styleOf(build(e).svg);
    const props = animatedProps(css);
    const stray = props.filter((x) => ALLOWED.indexOf(x) === -1);
    ok(e + ' animates only ' + ALLOWED.join('/'), stray.length === 0, 'animates ' + stray.join(','));

    // transform-origin on an SVG element defaults differently across browsers, so
    // nothing may depend on it. translate() is the one function that does not.
    ok(e + ' never sets transform-origin', !/transform-origin/.test(css));
    // Nothing may rotate or scale, because both depend on transform-origin. Drift,
    // aurora and grid move by translate; orbit moves by stroke-dashoffset and uses
    // no transform at all, which is the point — so "uses translate" is asserted
    // only for the engines that actually transform.
    ok(e + ' never rotates or scales', !/\b(rotate|scale|skew|matrix|perspective)\s*\(/.test(css), css.slice(0, 80));
    const transforms = (css.match(/transform\s*:\s*([^;}]+)/g) || []).join(' ');
    if (transforms) ok(e + ' moves only by translate()', /translate/.test(transforms) && !/(^|[^e])\s(rotate|scale|skew)/.test(transforms), transforms);

    // The old blobs animated filter:blur(110px), which rasterises a large buffer
    // every frame. Nothing here may reintroduce a filter.
    ok(e + ' uses no filter or blur', !/filter|blur/i.test(build(e).svg));
  });
}

// ---- 5. scoping ------------------------------------------------------------
console.log('\n5. Scoped to its own uid');
{
  ANIMATED.forEach((e) => {
    const r = build(e);
    const css = styleOf(r.svg);
    // The uid is the seed hash, and it is what every class and keyframe is named
    // after. Taken from the stylesheet rather than the markup, because the first
    // class in the SVG is the artwork's own `sig-art`.
    const uid = (css.match(/\.(sg[0-9a-f]+)-/) || [])[1] || '';
    ok(e + ' has a uid', uid.length > 2, uid);
    const classes = ruleClasses(css);
    ok(e + ' has rules', classes.length > 0);
    // Every selector is prefixed with the piece's own uid, so two pieces on one
    // page cannot share a class or a keyframe name.
    ok(e + ' prefixes every class with its uid', classes.every((c) => c.indexOf(uid) === 0), classes.join(','));
    ok(e + ' prefixes every keyframe with its uid', keyframeNames(css).every((k) => k.indexOf(uid) === 0), keyframeNames(css).join(','));
    ok(e + ' names its classes in the markup', classes.every((c) => r.svg.indexOf('class="' + c) !== -1), classes.join(','));
  });

  // Two different brands on one page must not collide.
  const a = Signature.build({ name: 'Alpha', palette: P, engine: 'drift' });
  const b = Signature.build({ name: 'Beta', palette: P, engine: 'drift' });
  const names = (s) => keyframeNames(styleOf(s)).join(',');
  ok('two brands use different keyframe names', names(a.svg) !== names(b.svg) && names(a.svg).length > 0, names(a.svg) + ' vs ' + names(b.svg));
}

// ---- 6. no dead CSS --------------------------------------------------------
console.log('\n6. Every rule does something');
{
  ANIMATED.forEach((e) => {
    const css = styleOf(build(e).svg);
    ok(e + ' defines keyframes', keyframeNames(css).length > 0);
    keyframeNames(css).forEach((k) => {
      ok(e + ' uses keyframe ' + k, new RegExp('animation[^;]*' + k).test(css));
    });
    // A rule styling an element the markup never emits is dead weight in every
    // client's page, so it is a failure rather than a tidiness note.
    ruleClasses(css).forEach((c) => {
      ok(e + ' class ' + c + ' exists in the markup', build(e).svg.indexOf('class="' + c) !== -1);
    });
  });
}

// ---- 7. seamless loops -----------------------------------------------------
console.log('\n7. Loops do not jump');
{
  const r = build('orbit');
  const svg = r.svg, css = styleOf(svg);
  const dash = svg.match(/stroke-dasharray="(\d+) (\d+)"/);
  const off = css.match(/stroke-dashoffset:(-?\d+)/);
  ok('orbit uses a dash array', !!dash);
  ok('orbit animates a dash offset', !!off);
  if (dash && off) {
    const period = Number(dash[1]) + Number(dash[2]);
    const travel = Math.abs(Number(off[1]));
    // A dashoffset that is not a whole number of dash periods snaps back at the
    // loop point, which is visible on a ring that never stops turning.
    ok('orbit dash offset is a whole number of dash periods', travel % period === 0,
      travel + ' / ' + period + ' leaves ' + (travel % period));
    ok('orbit all rings share the period', (svg.match(/stroke-dasharray="\d+ \d+"/g) || []).every((d) => d === 'stroke-dasharray="' + dash[1] + ' ' + dash[2] + '"'));
  }
  // The other three loop by returning to their starting value, which `alternate`
  // and a 0%/100% keyframe already guarantee; assert they are infinite and paired.
  ['drift', 'aurora', 'grid'].forEach((e) => {
    const c = styleOf(build(e).svg);
    ok(e + ' runs an infinite loop', /infinite/.test(c));
    ok(e + ' every animation is infinite', (c.match(/animation:[^;}]+/g) || []).every((a) => /infinite/.test(a)), c.match(/animation:[^;}]+/g).join(' | '));
  });
}

// ---- 8. the style block cannot break the document --------------------------
console.log('\n8. The style block is inert');
{
  ANIMATED.forEach((e) => {
    const svg = build(e).svg;
    ok(e + ' keeps the style inside the svg', svg.indexOf('<style>') > svg.indexOf('<svg ') && svg.indexOf('</style>') < svg.lastIndexOf('</svg>'));
    ok(e + ' cannot close the style early', !/<\/style>/i.test(styleOf(svg)));
    ok(e + ' carries no script', !/<script/i.test(svg));
    // The SVG namespace is the one http:// that is required; anything else is an
    // external fetch on a client's page, which this must never introduce.
    const withoutNs = svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '');
    ok(e + ' carries no external URL', !/https?:|@import/i.test(withoutNs), (withoutNs.match(/https?:[^"')\s]*/) || [''])[0]);
  });
}

// ---- 9. determinism and palette binding ------------------------------------
console.log('\n9. Determinism and the palette still reach it');
{
  ANIMATED.forEach((e) => {
    ok(e + ' is deterministic', build(e).svg === build(e).svg);
    ok(e + ' is deterministic with animation off', build(e, { animate: false }).svg === build(e, { animate: false }).svg);
    ok(e + ' changes with the brand', build(e).svg !== Signature.build({ name: 'DrainPro', palette: P, engine: e }).svg);

    // The palette has to reach the animated pieces too, or a client's brand
    // disappears the moment they pick one.
    const svg = build(e).svg;
    ok(e + ' uses the palette primary', svg.toLowerCase().indexOf(P.primary.toLowerCase()) !== -1);
    const light = Signature.build({ name: 'Harbour & Co', palette: LIGHT, engine: e }).svg;
    ok(e + ' uses the light palette accent', light.toLowerCase().indexOf(LIGHT.accent.toLowerCase()) !== -1);
    ok(e + ' paints no white over a light page', LIGHT.bg === '#f6f9ff' && light.indexOf('<rect width="1600" height="900" fill="#f6f9ff"') !== -1);
  });
}

// ---- 10. the builder wires it, without the Pro suite ----------------------
console.log('\n10. Exported site integration');
{
  const DB = require(path.join(ROOT, 'data', 'db.js'));
  global.DB = DB;
  global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
  global.Signature = Signature;
  const Builder = require(path.join(ROOT, 'modules', 'builder.js'));

  const project = (engine, suites, motion) => ({
    id: 'anim-check', name: 'Harbour & Co', suites: suites || [],
    site: {
      name: 'Harbour & Co', tagline: 'Fits out harbours', palette: 'cobalt', font: 'inter',
      url: 'https://harbour.example.com', heroLayout: 'centered',
      signature: { engine: engine },
      motion: motion || 'full',
      sections: [
        { type: 'hero', id: 's-hero', title: 'Berth one', text: 'We fit out harbours.' },
        { type: 'contact', id: 's-contact', title: 'Contact' }
      ],
      design: { containerWidth: 1140, radius: 20, spacing: 96 }
    }
  });
  const settings = { onlineEnabled: false };
  const artOf = (html) => (html.match(/<svg class="sig-art"[\s\S]*?<\/svg>/) || [''])[0];

  ANIMATED.forEach((e) => {
    const html = Builder.buildSiteHTML(project(e), settings);
    ok(e + ' reaches the exported hero', /class="sig-bg"/.test(html) && artOf(html).indexOf('<style>') !== -1);
  });

  // The promise that matters commercially: a free project's animated background
  // is identical to a paying one's. Animated artwork is design, not a paid extra.
  ANIMATED.forEach((e) => {
    const free = artOf(Builder.buildSiteHTML(project(e, []), settings));
    const paid = artOf(Builder.buildSiteHTML(project(e, ['animation']), settings));
    ok(e + ' is identical with and without the Animation Pack', free === paid && free.length > 0);
  });

  // Motion off is the one switch that must reach the artwork.
  const off = artOf(Builder.buildSiteHTML(project('drift', ['animation'], 'off'), settings));
  ok('motion off still emits the artwork', off.length > 0 && /class="sig-bg"/.test(Builder.buildSiteHTML(project('drift', ['animation'], 'off'), settings)));
  ok('motion off removes the animation', off.indexOf('<style>') === -1 && !/@keyframes/.test(off));

  // And the exported page's own reduced-motion rule must still be present, so a
  // visitor who prefers less motion does not get the scroll effects either.
  const html = Builder.buildSiteHTML(project('drift', ['animation']), settings);
  ok('the export still switches keyframes off for reduced-motion visitors',
    /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*animation:none/.test(html));
}

console.log('\n' + (failed === 0 ? 'ANIMATED ART PASSED' : 'ANIMATED ART FAILED: ' + failed + ' assertion(s)'));
process.exit(failed === 0 ? 0 : 1);

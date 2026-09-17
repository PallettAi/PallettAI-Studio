#!/usr/bin/env node
// ============================================================
// template-diversity-smoke — every starter must be a different site, not the
// same site in a different colour.
//
// The complaint this suite exists for: a gallery of seventeen templates that
// all delivered the same page. Colour, font and copy varied; nothing
// structural did. Colours are the least of it — what a visitor actually sees
// is the order of the sections, the shape of the hero, the width of the
// container, how round the corners are and how far apart things sit.
//
// Three families of claim are checked, because they fail differently:
//
//   1. THE DATA — no two templates share a section skeleton, the proportions
//      are all different, and no single variant owns a section type. This is
//      the thing that silently regresses when someone adds template #18 by
//      copying #17.
//   2. THE CATALOG — every variant a template names must be one the app
//      actually offers. A typo in `layout: 'masonary'` renders as the classic
//      shape with no error anywhere, so a template can be *described* as
//      diverse and *built* as identical.
//   3. THE OUTPUT — the variants must differ in the compiled HTML, measured
//      on the export with the copy stripped out, so the only thing that can
//      make two contact blocks differ is the layout. A layout that falls
//      through to a default is the failure mode this catches, and it is
//      invisible to both of the checks above.
//
// Run: node scripts/template-diversity-smoke.js
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
// The artwork engine is a classic-script global in the app (loaded by index.html),
// so load it the same way here or every build silently loses its backdrop.
global.Signature = require(path.join(ROOT, 'data', 'signature.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));

const TEMPLATES = DB.templates;
const uniq = (arr) => new Set(arr).size;
const blankCanvas = (tpl) => tpl.id === 'blank'; // "start from scratch" is meant to be empty

function share(arr) {
  const counts = {};
  arr.forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
  return counts;
}
const topShare = (arr) => {
  const c = share(arr);
  return Math.max.apply(null, Object.values(c)) / arr.length;
};

// A template's shape: the sections it ships and the variant each one uses.
// Two templates with the same string here render the same page, whatever
// colours or words arrive on top.
function skeleton(tpl) {
  return tpl.sections.map((s) => s.type + (s.layout ? '/' + s.layout : '')).join('>');
}

// Compile a template the way app.js's projectFromTemplate does, minus the
// settings overrides (a studio-wide customisation is the user's own choice and
// would mask the template's own proportions).
function projectOf(tpl, siteOver) {
  return {
    id: 'diversity',
    name: tpl.name,
    suites: [],
    templateId: tpl.id,
    site: Object.assign({
      name: 'Divergence Test',
      tagline: 'Fixed copy, varying shape',
      eyebrow: 'Hello',
      description: '',
      ctaText: 'Get started',
      ctaLink: '',
      email: 'hello@example.com',
      phone: '01234 567890',
      address: '1 Test Street, York',
      url: 'https://divergence.example.com',
      palette: tpl.palette,
      font: tpl.font,
      heroLayout: tpl.heroLayout,
      navStyle: tpl.navStyle || '',
      themeToggle: tpl.themeToggle,
      design: tpl.design || {},
      sections: DB.sectionsFromTemplate(tpl)
    }, siteOver || {})
  };
}

// Pull one section out of a compiled export. The closing `</section>` is the
// last one before the next section starts, which is enough here because no
// renderer nests a <section> inside another.
function blockOf(html, type) {
  const at = html.indexOf('id="sec-' + type + '-');
  if (at < 0) return '';
  const open = html.lastIndexOf('<section', at);
  const end = html.indexOf('</section>', at);
  return end > open ? html.slice(open, end) : '';
}

// The SHAPE of a block: tags, classes and attributes only. Stripping the text
// is the point — it makes two templates that share a layout produce the same
// signature, so a shared signature can only mean a shared shape, and a
// differing one can only mean the layout changed something. The section index
// is scrubbed because it depends on the template's own section count.
function shape(block) {
  return block
    .replace(/>[^<]*</g, '><')
    .replace(/sec-[a-z]+-\d+/g, (m) => m.replace(/-\d+$/, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

console.log('== 1. No two starters share a shape ==');
{
  const groups = {};
  TEMPLATES.forEach((t) => {
    const key = skeleton(t);
    (groups[key] = groups[key] || []).push(t.id);
  });
  const collisions = Object.values(groups).filter((ids) => ids.length > 1);
  assert(TEMPLATES.length >= 17, 'template set is intact (' + TEMPLATES.length + ' starters)');
  assert(collisions.length === 0,
    'every starter has its own section skeleton' + (collisions.length ? ' — shared by: ' + collisions.map((c) => c.join('=')).join(', ') : ''));
  const thin = TEMPLATES.filter((t) => t.sections.length < 4 && !blankCanvas(t));
  assert(thin.length === 0, 'no starter is down to a stub' + (thin.length ? ' — ' + thin.map((t) => t.id).join(', ') : ''));
}

console.log('\n== 2. Every starter carries its own proportions ==');
{
  const designed = TEMPLATES.filter((t) => !blankCanvas(t));
  const missing = designed.filter((t) => !t.design || !t.design.containerWidth).map((t) => t.id);
  assert(missing.length === 0, 'every starter declares its own design' + (missing.length ? ' — ' + missing.join(', ') : ''));
  const widths = designed.map((t) => t.design.containerWidth);
  const radii = designed.map((t) => t.design.radius);
  const spaces = designed.map((t) => t.design.spacing);
  // Eight distinct values across sixteen starters is a real spread without
  // demanding that none ever coincide — two templates may reasonably share a
  // corner radius as long as the triple as a whole is their own.
  assert(uniq(widths) >= 8, 'container widths vary (' + uniq(widths) + ' distinct)');
  assert(uniq(radii) >= 8, 'corner radii vary (' + uniq(radii) + ' distinct)');
  assert(uniq(spaces) >= 8, 'section rhythm varies (' + uniq(spaces) + ' distinct)');
  const triples = designed.map((t) => [t.design.containerWidth, t.design.radius, t.design.spacing].join('/'));
  assert(uniq(triples) === triples.length, 'no two starters share a whole proportions set');
}

console.log('\n== 3. Hero shapes, fonts, palettes and nav vary ==');
{
  const heroes = TEMPLATES.map((t) => t.heroLayout).filter(Boolean);
  assert(uniq(heroes) >= 5, 'hero treatments vary (' + uniq(heroes) + ' distinct: ' + Object.keys(share(heroes)).join(', ') + ')');
  assert(topShare(heroes) <= 0.5, 'no single hero treatment is used by more than half the set');
  assert(uniq(TEMPLATES.map((t) => t.font)) >= 10, 'typefaces vary (' + uniq(TEMPLATES.map((t) => t.font)) + ' distinct)');
  // Reuse is allowed here — seventeen starters over ten palettes is a deliberate
  // budget, and the shared palette is a different site in every other respect.
  // What is not allowed is one palette carrying the set.
  const pals = TEMPLATES.map((t) => t.palette);
  assert(uniq(pals) >= 8 && topShare(pals) <= 0.25,
    'palettes vary without one dominating (' + uniq(pals) + ' distinct over ' + TEMPLATES.length + ' starters)');
  assert(uniq(TEMPLATES.map((t) => t.navStyle || 'solid')) >= 2, 'nav treatment varies');
  const toggles = TEMPLATES.map((t) => t.themeToggle === false ? 'off' : 'on');
  assert(uniq(toggles) === 2, 'some starters ship without a theme switch, some with');
}

console.log('\n== 4. No section variant dominates the set ==');
{
  // The regression this catches: a new starter copied from an old one, drifting
  // the set back towards a single shape one template at a time.
  for (const type of ['contact', 'testimonials', 'gallery', 'stats', 'cta']) {
    const used = TEMPLATES.map((t) => t.sections.find((s) => s.type === type)).filter(Boolean);
    const values = used.map((s) => s.layout || '(classic)');
    // The bar is the catalog rather than a fixed number: a shape the app offers
    // that no starter uses is a variant nobody will ever see, which is how the
    // catalog grew to five contact layouts while every template still used one.
    const offered = DB.layoutsFor(type).map((o) => o.id || '(classic)');
    const unused = offered.filter((o) => !values.includes(o));
    assert(unused.length === 0,
      type + ' uses its whole vocabulary (' + Object.keys(share(values)).join(', ') + ')' +
      (unused.length ? ' — never used: ' + unused.join(', ') : ''));
    assert(topShare(values) <= 0.6,
      'no single ' + type + ' shape carries more than 60% of the ' + values.length + ' starters that have one');
  }
}

console.log('\n== 5. Every variant a starter names is one the app offers ==');
{
  let unknown = 0;
  for (const tpl of TEMPLATES) {
    for (const s of tpl.sections) {
      const offered = DB.layoutsFor(s.type).map((o) => o.id);
      if (s.layout !== undefined && !offered.includes(s.layout)) {
        fail(tpl.id + '.' + s.type + ' names "' + s.layout + '", which is not offered (' + JSON.stringify(offered) + ')');
        unknown++;
      }
    }
  }
  assert(unknown === 0, 'no starter names a layout the app does not have (a typo would render the classic shape silently)');
}

console.log('\n== 6. The variants render differently ==');
{
  // One project, one section, one thing changed: the layout. If two layouts
  // compile to the same markup, the choice is decorative and the templates are
  // as alike as they ever were.
  const one = (type, layout) => ({
    id: 'diversity',
    name: 'Divergence Test',
    suites: [],
    site: {
      name: 'Divergence Test', tagline: 'Fixed copy', eyebrow: 'Hello', description: '',
      ctaText: 'Get started', ctaLink: '', email: 'hello@example.com', phone: '01234 567890',
      address: '1 Test Street, York', url: 'https://divergence.example.com',
      palette: 'aurora', font: 'inter', heroLayout: 'centered', design: {},
      sections: [DB.newSection(type, { layout })]
    }
  });
  const built = (type, layout) => {
    const settings = { onlineEnabled: false };
    return blockOf(Builder.buildSiteHTML(one(type, layout), settings), type);
  };

  const contactLayouts = DB.layoutsFor('contact').map((o) => o.id);
  const contactShapes = contactLayouts.map((l) => ({ layout: l || '(classic)', sig: shape(built('contact', l)) }));
  const empty = contactShapes.filter((c) => !c.sig || !/<form/.test(c.sig)).map((c) => c.layout);
  assert(empty.length === 0, 'every contact layout renders a working form' + (empty.length ? ' — broken: ' + empty.join(', ') : ''));
  const sigs = contactShapes.map((c) => c.sig);
  assert(uniq(sigs) === sigs.length,
    'all ' + sigs.length + ' contact layouts compile to different markup (' + contactShapes.map((c) => c.layout).join(', ') + ')');

  const heroLayouts = DB.layoutsFor('hero').map((o) => o.id);
  const heroSigs = heroLayouts.map((l) => shape(built('hero', l)));
  const heroEmpty = heroLayouts.filter((l, i) => !heroSigs[i]).map((l) => l || '(classic)');
  assert(heroEmpty.length === 0, 'every hero layout renders' + (heroEmpty.length ? ' — empty: ' + heroEmpty.join(', ') : ''));
  assert(uniq(heroSigs) === heroSigs.length,
    'all ' + heroSigs.length + ' hero layouts compile to different markup');
}

console.log('\n== 7. The starters compile differently from each other ==');
{
  // The end-to-end version of claim 6: two starters that use different contact
  // layouts must differ in the compiled contact block, and two that use the
  // same one must match. Copy is stripped, so agreement can only come from the
  // layout and disagreement can only come from it too.
  const byLayout = {};
  for (const tpl of TEMPLATES) {
    const contact = tpl.sections.find((s) => s.type === 'contact');
    if (!contact) continue;
    const html = Builder.buildSiteHTML(projectOf(tpl), { onlineEnabled: false });
    const key = contact.layout || '(classic)';
    (byLayout[key] = byLayout[key] || []).push({ id: tpl.id, sig: shape(blockOf(html, 'contact')) });
  }
  const layoutKeys = Object.keys(byLayout);
  const sigsPerLayout = layoutKeys.map((k) => uniq(byLayout[k].map((x) => x.sig)));
  const inconsistent = layoutKeys.filter((k, i) => sigsPerLayout[i] !== 1);
  assert(inconsistent.length === 0,
    'starters sharing a contact layout compile to the same block' + (inconsistent.length ? ' — drifting: ' + inconsistent.join(', ') : ''));
  const allSigs = layoutKeys.map((k) => byLayout[k][0].sig);
  assert(uniq(allSigs) === layoutKeys.length,
    'the ' + layoutKeys.length + ' contact layouts in use produce ' + uniq(allSigs) + ' distinct compiled blocks across the set');
  console.log('    ' + layoutKeys.map((k) => k + ' ×' + byLayout[k].length).join(' · '));
}

console.log('\n== 8. The app hands those differences to the project ==');
{
  // Everything above is only true if the path a user actually takes keeps them.
  // projectFromTemplate is lifted out of app.js and RUN, because "does it read
  // tpl.design" is not the same question as "does the project end up with the
  // template's proportions" — and the second is the one a user feels.
  const fs = require('fs');
  const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const from = appJs.indexOf('function projectFromTemplate(');
  const to = appJs.indexOf('\n  function ', from);
  const body = (from < 0 || to < 0) ? '' : appJs.slice(from, to);
  assert(body.length > 400, 'projectFromTemplate was found in app.js');

  const make = (settings) => {
    // eslint-disable-next-line no-new-func
    const factory = new Function('DB', 'settings', 'uid', body + '\n  return projectFromTemplate;');
    return factory(DB, settings, () => 'id-' + Math.random().toString(36).slice(2, 8));
  };

  let made = null;
  try { made = TEMPLATES.map((t) => ({ tpl: t, p: make({ ...DB.defaultSettings })(t) })); }
  catch (e) { fail('projectFromTemplate threw: ' + e.message); }

  if (made) {
    // Blank Canvas is the one starter that means "use my studio defaults", so it
    // is checked the other way round rather than being exempted.
    const designed = made.filter(({ tpl }) => !blankCanvas(tpl));
    const wrong = designed.filter(({ tpl, p }) =>
      !p.site.design ||
      p.site.design.containerWidth !== tpl.design.containerWidth ||
      p.site.design.radius !== tpl.design.radius ||
      p.site.design.spacing !== tpl.design.spacing ||
      p.site.heroLayout !== tpl.heroLayout ||
      p.site.navStyle !== (tpl.navStyle === 'transparent' ? 'transparent' : '')
    ).map(({ tpl }) => tpl.id);
    assert(wrong.length === 0, 'every starter lands with its own proportions, hero and nav' + (wrong.length ? ' — lost: ' + wrong.join(', ') : ''));
    const blank = made.find(({ tpl }) => blankCanvas(tpl));
    assert(!blank || (blank.p.site.design.containerWidth === DB.defaultSettings.defaultContainerWidth &&
      blank.p.site.design.radius === DB.defaultSettings.defaultRadius),
      'Blank Canvas still falls back to the studio defaults');
    const togglesWrong = made.filter(({ tpl, p }) => tpl.themeToggle === false && p.site.themeToggle !== false).map(({ tpl }) => tpl.id);
    assert(togglesWrong.length === 0, 'a starter that ships without a theme switch keeps it off' + (togglesWrong.length ? ' — ' + togglesWrong.join(', ') : ''));

    const dna = made.map(({ p }) => [p.site.palette, p.site.font, p.site.heroLayout, p.site.navStyle,
      p.site.themeToggle, p.site.design.containerWidth, p.site.design.radius, p.site.design.spacing].join('|'));
    assert(uniq(dna) === dna.length, 'no two starters hand the project the same look');
    const flows = made.map(({ p }) => p.site.sections.map((s) => s.type + (s.layout ? '/' + s.layout : '')).join('>'));
    assert(uniq(flows) === flows.length, 'and no two hand it the same flow of sections');

    // The escape hatch has to survive: a palette, font or proportion the user has
    // deliberately changed in Settings still wins over the template's own.
    const custom = make({ ...DB.defaultSettings, defaultRadius: 99, defaultContainerWidth: 999 });
    const customised = TEMPLATES.map((t) => custom(t));
    assert(customised.every((p) => p.site.design.radius === 99 && p.site.design.containerWidth === 999),
      'a proportion the user has changed still overrides the template');
  }
}

if (failed) {
  console.error('\ntemplate-diversity-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ntemplate-diversity-smoke PASSED');

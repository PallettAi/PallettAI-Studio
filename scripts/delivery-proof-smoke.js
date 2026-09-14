// ============================================================
// Delivery proof smoke test — readability, links, tokens, manifest, report.
//
// What these five share is that a client acts on what they say. A readability
// score, a broken-link count and a checksum are all quotable, so the tests are
// about whether the numbers are TRUE:
//
//   1. Reproducible. Same input, same number — checked by running twice.
//   2. Independent. The SHA-256 is compared against Node's own crypto rather
//      than against this module, and the emitted Tailwind config is actually
//      loaded and read back rather than pattern-matched.
//   3. Honest about limits. The syllable heuristic has known misses and they
//      are PINNED here rather than hidden; a composite that silently treats an
//      absent audit as a zero is caught; and the report must never leak a
//      Studio file path into a client's hands.
//
// Run: node scripts/delivery-proof-smoke.js
// ============================================================
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Review = require(path.join(ROOT, 'data', 'review.js'));
global.Images = require(path.join(ROOT, 'data', 'images.js'));
global.Focus = require(path.join(ROOT, 'data', 'focus.js'));
global.OgCard = require(path.join(ROOT, 'data', 'ogcard.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const Perf = require(path.join(ROOT, 'data', 'perf.js'));
const Read = require(path.join(ROOT, 'data', 'readability.js'));
const Links = require(path.join(ROOT, 'data', 'links.js'));
const Tokens = require(path.join(ROOT, 'data', 'tokens.js'));
const Manifest = require(path.join(ROOT, 'data', 'manifest.js'));
const Proof = require(path.join(ROOT, 'data', 'proof.js'));

const project = {
  id: 'p1', name: 'Northwind Joinery', suites: [],
  site: {
    name: 'Northwind Joinery', tagline: 'Bespoke kitchens, built to last',
    palette: 'midnight', font: 'inter', url: 'https://northwind.example', email: 'hi@northwind.example',
    design: { radius: 18, spacing: 96, containerWidth: 1140 },
    pages: [
      {
        id: 'home', name: 'Home', slug: 'index', sections: [
          { type: 'hero', title: 'Bespoke kitchens', subtitle: 'We build kitchens. You get a quote in a day.' },
          { type: 'gallery', title: 'Our work', items: [{ title: 'One', text: 'A kitchen in Leeds.' }] },
          { type: 'contact', title: 'Talk to us', text: 'Call us for a quote.' }
        ]
      },
      { id: 'about', name: 'About', slug: 'about', sections: [{ type: 'about', title: 'Who we are', text: 'We build kitchens in Yorkshire.' }] }
    ]
  }
};

const pages = Builder.buildSitePages(project, { proExport: true }).map((e) => ({ name: e.page.name, slug: e.page.slug, html: e.html }));

// ---- 1. readability -------------------------------------------------------
console.log('\n1. Copy clarity');
{
  // The heuristic has known misses. Pinning them means a change is visible
  // rather than silent — a readability number nobody can reproduce is worse
  // than no number at all.
  const known = [['hello', 2], ['the', 1], ['beautiful', 3], ['made', 1], ['simple', 2], ['encyclopedia', 5]];
  known.forEach(([w, want]) => ok('syllables("' + w + '") = ' + want, Read.syllables(w) === want, String(Read.syllables(w))));
  ok('a known miss stays a miss: "create" = 1 syllable', Read.syllables('create') === 1);
  ok('a known miss stays a miss: "business" = 3 syllables', Read.syllables('business') === 3);
  ok('an empty word is zero syllables', Read.syllables('——') === 0);

  ok('sentences split on full stops', Read.splitSentences('One. Two. Three.').length === 3);
  ok('an abbreviation is not split mid-sentence', Read.splitSentences('We work in the U.S. market today.').length === 1, JSON.stringify(Read.splitSentences('We work in the U.S. market today.')));
  ok('a question and an exclamation end sentences', Read.splitSentences('Ready? Yes! Good.').length === 3);

  const clean = { name: 'H', slug: 'index', sections: [{ type: 'hero', title: 'Bespoke kitchens', subtitle: 'We build kitchens. You get a quote in a day.' }, { type: 'cta', text: 'Get a quote today.' }] };
  const cleanPage = Read.analyzePage(clean);
  ok('short, direct copy scores full marks', cleanPage.score === 100 && cleanPage.findings.length === 0, JSON.stringify(cleanPage.findings));
  ok('a plain page reads as easy', cleanPage.ease >= 60, String(cleanPage.ease));

  const heavy = {
    name: 'H', slug: 'index',
    sections: [
      { type: 'a', text: 'We leverage our cutting-edge, state-of-the-art workshop to deliver a seamless, holistic, best-in-class bespoke solutions experience that is maybe somewhat difficult to describe because the sentence simply keeps going and going without ever reaching its end.' },
      { type: 'b', text: 'word '.repeat(140) }
    ]
  };
  const heavyPage = Read.analyzePage(heavy);
  ok('buzzwords are named', heavyPage.findings.some((f) => /buzzword/i.test(f.msg)), JSON.stringify(heavyPage.findings.map((f) => f.msg)));
  ok('hedging is named', heavyPage.findings.some((f) => /Hedging/i.test(f.msg)));
  ok('a wall of text is flagged', heavyPage.findings.some((f) => /word block of text/i.test(f.msg)));
  ok('a missing call to action is flagged', heavyPage.findings.some((f) => /call to action/i.test(f.msg)));
  ok('heavy copy scores below clean copy', heavyPage.score < cleanPage.score, heavyPage.score + ' vs ' + cleanPage.score);

  const noCta = Read.analyzePage({ name: 'H', slug: 'i', sections: [{ type: 'a', text: 'We build kitchens in Yorkshire.' }] });
  ok('copy that never asks for the work is flagged', noCta.findings.some((f) => /call to action/i.test(f.msg)));
  ok('scoring is reproducible', Read.grade(project).score === Read.grade(project).score);
  ok('an empty project does not crash or divide by zero', Read.grade({ site: {} }).score === 100);
}

// ---- 2. link integrity ----------------------------------------------------
console.log('\n2. Links, anchors and assets');
{
  const extras = Builder.seoExtras(project, {});
  const audit = Links.audit(pages, extras);
  ok('a real export has no broken references', audit.errors === 0, JSON.stringify(audit.findings));
  ok('the favicon data: URI is not mistaken for a page', !audit.findings.some((f) => /data:image/.test(f.msg)));
  ok('any scheme counts as off-site', Links.resolve('data:image/svg+xml,x', 'index', {}).kind === 'external');
  ok('a javascript: link is still caught', Links.audit([{ name: 'H', slug: 'index', html: '<a href="javascript:alert(1)">x</a>' }], []).findings.some((f) => /javascript:/.test(f.msg)));

  const index = Links.pageIndex(pages, extras);
  ok('an internal page resolves', Links.resolve('about.html', 'index', index).kind === 'page');
  ok('a missing page is caught', Links.resolve('nowhere.html', 'index', index).kind === 'missing-page');
  ok('a same-page anchor resolves to itself', Links.resolve('#top', 'index', index).anchor === 'top');
  ok('a cross-page anchor carries its page', Links.resolve('about.html#team', 'index', index).page === 'about.html');

  const brokenAnchor = Links.audit([{ name: 'H', slug: 'index', html: '<a href="#gone">x</a>' }], []);
  ok('an anchor with no target is reported', brokenAnchor.findings.some((f) => /does not exist/.test(f.msg)));
  const brokenCross = Links.audit([
    { name: 'Home', slug: 'index', html: '<a href="about.html#gone">x</a>' },
    { name: 'About', slug: 'about', html: '<main id="main"></main>' }
  ], []);
  ok('a cross-page anchor with no target is an error', brokenCross.errors === 1, JSON.stringify(brokenCross.findings));

  const dupes = Links.audit([{ name: 'H', slug: 'index', html: '<div id="a"></div><div id="a"></div>' }], []);
  ok('duplicate ids are reported', dupes.findings.some((f) => /duplicate id/.test(f.msg)));

  const missingAsset = Links.audit([{ name: 'H', slug: 'index', html: '<img src="photo.png" alt="">' }], []);
  ok('a referenced file that is not exported is an error', missingAsset.errors === 1, JSON.stringify(missingAsset.findings));
  ok('an inlined data: image is not a missing file', Links.audit([{ name: 'H', slug: 'index', html: '<img src="data:image/png;base64,AAA" alt="">' }], []).errors === 0);

  const orphaned = Links.audit(pages.map((p) => ({ name: p.name, slug: p.slug, html: p.html.replace(/href="about\.html"/g, 'href="#top"') })), extras);
  ok('a page nothing links to is reported', orphaned.findings.some((f) => /nothing links to/.test(f.msg)));

  const dupeFindings = Links.audit([{ name: 'H', slug: 'index', html: '<a href="#gone">1</a><a href="#gone">2</a><a href="#gone">3</a>' }], []);
  ok('the same problem is reported once, not once per occurrence', dupeFindings.findings.filter((f) => /#gone/.test(f.msg)).length === 1);
  ok('script source is not treated as links', Links.audit([{ name: 'H', slug: 'index', html: '<script>var a = "<a href=\'nope.html\'>x</a>";</scr' + 'ipt>' }], []).errors === 0);
}

// ---- 3. design tokens -----------------------------------------------------
console.log('\n3. Design tokens');
{
  const t = Tokens.of(project);
  ok('the palette becomes colour tokens', t.colors.primary === '#7c5cff' && t.colors.bg === '#0b1020', JSON.stringify(t.colors));
  ok('an invalid colour is dropped rather than emitted', !Tokens.css({ site: { palette: { primary: 'not-a-colour', bg: '#fff' } } }).includes('not-a-colour'));
  ok('contrast matches the WCAG formula', Tokens.contrast('#000000', '#ffffff') === 21, String(Tokens.contrast('#000000', '#ffffff')));
  ok('contrast is order-independent', Tokens.contrast('#ffffff', '#000000') === 21);
  ok('an unparsable colour has no contrast', Tokens.contrast('nope', '#fff') === null);

  const css = Tokens.css(project);
  ok('CSS custom properties are emitted', /--color-primary: #7c5cff;/.test(css) && /--space-1: 4px;/.test(css));
  ok('the type stack is emitted', /--font-sans:/.test(css));
  ok('radius and container sizes are emitted', /--radius-base: 18px;/.test(css) && /--container: 1140px;/.test(css));

  const json = JSON.parse(Tokens.json(project));
  ok('the JSON is valid and W3C-shaped', json.color.primary.$type === 'color' && json.color.primary.$value === '#7c5cff');
  ok('the JSON has no placeholder left behind', !JSON.stringify(json).includes('undefined'));

  // the config has to be ACTUALLY loadable, not just look right
  const tmp = path.join(os.tmpdir(), 'pai-tokens-' + process.pid + '-' + Date.now() + '.js');
  fs.writeFileSync(tmp, Tokens.tailwind(project));
  let cfg = null;
  try { cfg = require(tmp); } catch (e) { cfg = null; }
  fs.unlinkSync(tmp);
  ok('the Tailwind config is loadable JavaScript', !!cfg && !!cfg.theme && !!cfg.theme.extend, 'require() failed');
  ok('it exposes the palette as Tailwind colours', !!(cfg && cfg.theme.extend.colors.primary));
  ok('it reads from the custom properties, so a rebrand is one file', !!(cfg && /var\(--color-primary\)/.test(cfg.theme.extend.colors.primary)));
  ok('it exposes spacing, radius and container', !!(cfg && cfg.theme.extend.spacing.s1 === '4px' && cfg.theme.extend.borderRadius.base === '18px' && cfg.theme.extend.maxWidth.container === '1140px'));

  ok('a handoff note is produced', /## Contrast/.test(Tokens.readme(project)) && /\| `.+\` on `.+` \|/.test(Tokens.readme(project)));
  ok('a project with no palette still produces all three files', Tokens.files({ site: {} }).length === 3);
}

// ---- 4. manifest ----------------------------------------------------------
console.log('\n4. Export manifest');
(async () => {
  const files = [{ name: 'index.html', content: '<h1>Hi</h1>' }, { name: 'robots.txt', content: 'User-agent: *\n' }];
  ok('SHA-256 is available in this environment', Manifest.hashingAvailable());
  const art = await Manifest.build({ project: project, version: '0.4.3', files: files, stamp: 'stamp-abc', generatedAt: '2026-09-14T12:00:00.000Z', scores: { performance: { score: 98, letter: 'A+' }, ghost: null } });
  const m = art.manifest;

  const expect = crypto.createHash('sha256').update('<h1>Hi</h1>', 'utf8').digest('hex');
  ok('the hash matches Node crypto byte for byte', m.files[0].sha256 === expect);
  ok('byte counts are UTF-8, not character counts', Manifest.bytes('é') === 2 && Manifest.bytes('👋') === 4);
  ok('an unscored audit is omitted rather than zeroed', m.scores.performance.score === 98 && m.scores.ghost === undefined);
  ok('the manifest records what produced it', m.generator === 'PallettAi Studio' && m.version === '0.4.3' && m.stamp === 'stamp-abc');
  ok('the manifest is valid JSON', (() => { try { JSON.parse(art.json); return true; } catch (e) { return false; } })());
  ok('the JSON ends with a newline', art.json.endsWith('\n'));

  const clean = await Manifest.verify(m, files);
  ok('an untouched copy verifies', clean.ok && clean.checked === 2, JSON.stringify(clean));
  const tampered = await Manifest.verify(m, [{ name: 'index.html', content: '<h1>Hacked</h1>' }, files[1]]);
  ok('an edited file is caught', !tampered.ok && tampered.changed[0] === 'index.html');
  const removed = await Manifest.verify(m, [files[0]]);
  ok('a missing file is caught', !removed.ok && removed.missing.includes('robots.txt'));
  const extra = await Manifest.verify(m, files.concat([{ name: 'extra.html', content: 'x' }]));
  ok('an unrecorded file is caught', !extra.ok && extra.added.includes('extra.html'));
  ok('a manifest that is not a manifest is refused cleanly', (await Manifest.verify({}, files)).reason === 'not-a-manifest');
  ok('a manifest given as a JSON string still works', (await Manifest.verify(art.json, files)).ok);

  // The natural check is "verify this folder against its own manifest", which
  // hands the manifest back in as a file. It cannot list its own hash, so it
  // has to be ignored — otherwise every honest verification fails. Found by
  // running the real export in a browser rather than in this harness.
  const asFolder = files.concat([Manifest.fileOf(art)]);
  const folderCheck = await Manifest.verify(m, asFolder);
  ok('a folder containing its own manifest still verifies', folderCheck.ok, JSON.stringify(folderCheck));
  ok('the manifest itself is not counted as an extra file', folderCheck.added.length === 0, JSON.stringify(folderCheck.added));
  ok('a tampered file inside that folder is still caught', !(await Manifest.verify(m, [{ name: 'index.html', content: 'changed' }].concat(files.slice(1)).concat([Manifest.fileOf(art)]))).ok);
  ok('the file is named for what it is', Manifest.fileOf(art).name === 'pallettai-export.json');
})()
  .then(() => {
    // ---- 5. the composite report -----------------------------------------
    console.log('\n5. Delivery report');
    return (async () => {
      const perf = await Perf.measure('Northwind', pages, {});
      const audits = {
        performance: { score: perf.grade.score, letter: perf.grade.letter, pages: perf.grade.pages, totals: perf.totals },
        keyboard: Focus.audit(pages),
        links: Links.audit(pages, Builder.seoExtras(project, {})),
        images: Images.audit(pages),
        copy: Read.grade(project)
      };

      // absent audits must not drag the score down: a site with no images
      // should not be marked down for having none
      // (90×30 + 80×25) / 55 = 85.45 → 85. Scoring the three absent audits as
      // zero would give 47, which is the failure this guards against.
      const partial = Proof.grade({ performance: { score: 90 }, keyboard: { score: 80 } });
      ok('an absent audit is removed from the weighting, not scored zero', partial.score === 85, String(partial.score));
      ok('the weighting is reported, not hidden', partial.weight === 55 && partial.full === false, JSON.stringify({ w: partial.weight }));
      ok('an empty report does not claim a grade', Proof.grade({}).score === 0);

      const full = Proof.grade(audits);
      ok('all five audits are counted', full.parts.length === 5, JSON.stringify(full.parts.map((p) => p.label)));
      ok('the composite is a weighted average', full.score === Math.round(full.parts.reduce((n, p) => n + p.score * (p.weight / full.weight), 0)), String(full.score));
      ok('the composite is reproducible', Proof.grade(audits).score === full.score);
      ok('the headline matches the grade', typeof Proof.headline(full) === 'string' && Proof.headline(full).length > 10);
      // The wording has to track the score, not flatter it: "ready to hand
      // over" belongs at 95 and above, and must not appear at 80.
      ok('a strong score reads as ready', Proof.headline(Proof.grade({ performance: { score: 98 } })).indexOf('ready to hand over') !== -1);
      ok('a middling score does not read as ready', Proof.headline(Proof.grade({ performance: { score: 80 } })).indexOf('ready to hand over') === -1, Proof.headline(Proof.grade({ performance: { score: 80 } })));
      ok('a poor score says so plainly', Proof.headline(Proof.grade({ performance: { score: 40 } })).indexOf('needs attention') !== -1);

      const findings = Proof.findings(audits);
      ok('findings are ordered worst first', (() => {
        const rank = { error: 0, warn: 1, info: 2 };
        for (let i = 1; i < findings.length; i++) if (rank[findings[i].level] < rank[findings[i - 1].level]) return false;
        return true;
      })(), JSON.stringify(findings.map((f) => f.level)));
      ok('a problem repeated across audits is reported once', new Set(findings.map((f) => f.level + f.msg)).size === findings.length);
      ok('every finding carries the area it came from', findings.every((f) => !!f.area));

      const html = Proof.html({ project: project, audits: audits, grade: full, version: '0.4.3', generatedAt: '2026-09-14T12:00:00.000Z', stamp: 'stamp-abc' });
      ok('a report page is produced', html.startsWith('<!DOCTYPE html>') && html.includes('</html>'));
      ok('the report is not indexable', /name="robots" content="noindex/.test(html));
      ok('the report prints without colour loss', /@media print/.test(html));
      ok('the grade is shown with its score', /overall/.test(html) && /<div class="badge/.test(html));
      ok('the report never leaks a Studio file path', !/\/data\/|\/modules\/|\.js\b/.test(html.replace(/<script[^>]*><\/script>/g, '')), 'a path appeared in the report');
      ok('the report does not expose one project', !/pallettai\.revisions|IndexedDB|localStorage/i.test(html));
      ok('a site name cannot inject markup', Proof.html({ project: { site: { name: '<script>x</scr' + 'ipt>' } }, audits: {} }).includes('&lt;script&gt;'));
      ok('the report states what the client received', /Every file is listed with its checksum/.test(Proof.html({ project: project, audits: audits, grade: full, manifest: { files: [{ name: 'index.html', bytes: 2048, sha256: 'abc123def456' }] } })));
      ok('one report file ships', Proof.files({ project: project, audits: audits }).length === 1);

      console.log('\n' + (failed === 0 ? 'DELIVERY PROOF PASSED' : 'DELIVERY PROOF FAILED: ' + failed));
      process.exit(failed === 0 ? 0 : 1);
    })();
  })
  .catch((e) => {
    console.error('  ✗ suite crashed: ' + (e && e.message));
    process.exit(1);
  });

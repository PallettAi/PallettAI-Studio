// ============================================================
// Pre-flight smoke test — the gate between a project and a live site.
//
// This module's job is to be trusted at the worst possible moment, so the
// tests are split the same way the module is: what it must STOP, and what it
// must NOT stop. A gate that blocks a good site is worse than no gate, because
// it teaches the creator to click past it. Pinned here:
//
//   1. Real publish failures are blockers — two pages exporting to one file, a
//      menu link to a page that was never made, an empty project, and every
//      error-level finding site care already knows about.
//   2. Working sites are NOT blocked — a link to a page that exists, an
//      external link, "/", "index.html", and a good project with nothing left
//      to do.
//   3. The composition rule is exactly the one documented: site-care error ->
//      blocker, warn -> warning, note -> note. No finding is invented twice.
//   4. The verdict is about the visitor: warnings alone still publish.
//
// Run: node scripts/preflight-smoke.js
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
const Preflight = require(path.join(ROOT, 'data', 'preflight.js'));

const NOW = '2026-09-15T12:00:00.000Z';

// A project with real copy, real contact details, a description, an address and
// a menu that resolves. This is the baseline a gate must let through.
function cleanProject() {
  return {
    id: 'p1',
    name: 'Northwind Joinery',
    site: {
      name: 'Northwind Joinery',
      email: 'hello@northwindjoinery.co.uk',
      phone: '+44 20 7946 0018',
      tagline: 'Bespoke joinery in south London',
      metaDescription: 'Bespoke kitchens, staircases and fitted furniture, made in south London.',
      url: 'https://northwindjoinery.co.uk',
      navLinks: [{ label: 'Home', href: 'index.html' }, { label: 'Work', href: 'work.html' }],
      pages: [
        { name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'Bespoke joinery, made to measure', subtitle: 'A south London workshop' }] },
        { name: 'Work', slug: 'work', sections: [{ id: 'w', type: 'gallery', title: 'Recent commissions', items: [{ image: 'a.jpg', alt: 'An oak staircase' }] }] }
      ]
    }
  };
}

// Build a project from a base, then patch the site.
const withSite = (patch, pages) => {
  const p = cleanProject();
  Object.assign(p.site, patch);
  if (pages) p.site.pages = pages;
  return p;
};
const areasIn = (rep) => rep.blockers.concat(rep.warnings, rep.notes).map((f) => f.area);

const run = (project) => Preflight.run(project, { now: NOW });

// ---- 1. a good project publishes ------------------------------------------
console.log('\n1. A finished project is not blocked');
{
  const rep = run(cleanProject());
  ok('ready', rep.ready === true);
  ok('no blockers', rep.blockers.length === 0, JSON.stringify(rep.blockers.map((b) => b.msg)));
  ok('no warnings', rep.warnings.length === 0, JSON.stringify(rep.warnings.map((b) => b.msg)));
  ok('headline says so', /Ready to publish/.test(rep.headline), rep.headline);
  ok('kind is stable', rep.kind === 'pallettai-preflight');
  ok('carries its own counts', rep.counts.blocker === 0 && rep.counts.warning === 0, JSON.stringify(rep.counts));
  ok('counts the pages', rep.pages === 2, String(rep.pages));
}

// ---- 2. the check that only exists at publish time -------------------------
console.log('\n2. Two pages, one file');
{
  const rep = run(withSite({}, [
    { name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'Real headline' }] },
    { name: 'Pricing', slug: 'pricing', sections: [{ id: 'a', type: 'features', title: 'Prices' }] },
    { name: 'Our Pricing', slug: 'pricing', sections: [{ id: 'b', type: 'features', title: 'Also prices' }] }
  ]));
  ok('is a blocker', rep.blockers.some((f) => f.area === 'slug'), areasIn(rep).join(','));
  ok('names both pages', /Pricing" and "Our Pricing"/.test(rep.blockers.map((f) => f.msg).join(' ')), rep.blockers.map((f) => f.msg).join(' '));
  ok('names the file', /pricing\.html/.test(rep.blockers.map((f) => f.msg).join(' ')));
  ok('not ready', rep.ready === false);

  // A name that slugifies to the same file is the same collision — the slug may
  // be blank, but the NAME still decides the filename.
  const byName = run(withSite({}, [
    { name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'H' }] },
    { name: 'Our Pricing', slug: '', sections: [{ id: 'a', type: 'hero', title: 'One' }] },
    { name: 'our pricing', slug: '', sections: [{ id: 'b', type: 'hero', title: 'Two' }] }
  ]));
  ok('two names that slugify the same also collide', byName.blockers.some((f) => f.area === 'slug'), areasIn(byName).join(','));

  // Distinct slugs must NOT collide.
  const distinct = run(withSite({}, [
    { name: 'Our Pricing', slug: '', sections: [{ id: 'a', type: 'hero', title: 'One' }] },
    { name: 'Contact', slug: '', sections: [{ id: 'b', type: 'hero', title: 'Two' }] }
  ]));
  ok('different pages do not collide', !distinct.blockers.some((f) => f.area === 'slug'), areasIn(distinct).join(','));

  // The builder renames the first page to "index" when nothing claims that
  // slug, so the export writes index.html — and a menu link to the page's NAME
  // is therefore a 404. The report has to predict that, not trust the slug.
  const forced = Preflight.exportPages({
    site: { pages: [{ name: 'About', slug: '', sections: [] }, { name: 'Contact', slug: '', sections: [] }] }
  });
  ok('the first page is predicted as index', forced[0].slug === 'index', JSON.stringify(forced.map((p) => p.slug)));
  ok('the second keeps its own name', forced[1].slug === 'contact', JSON.stringify(forced.map((p) => p.slug)));
  const forcedNav = run(withSite({ navLinks: [{ label: 'About', href: 'about.html' }] }, [
    { name: 'About', slug: '', sections: [{ id: 'a', type: 'hero', title: 'Real headline' }] },
    { name: 'Contact', slug: '', sections: [{ id: 'b', type: 'contact', title: 'Get in touch' }] }
  ]));
  ok('so a menu link to its name is a 404', forcedNav.blockers.some((f) => f.area === 'nav'), areasIn(forcedNav).join(','));

  // An existing index page is left alone — the rename only fills a gap.
  const untouched = Preflight.exportPages({
    site: { pages: [{ name: 'Home', slug: 'index', sections: [] }, { name: 'About', slug: 'about', sections: [] }] }
  });
  ok('an existing index is not disturbed', untouched[0].slug === 'index' && untouched[1].slug === 'about', JSON.stringify(untouched.map((p) => p.slug)));
  ok('and the project is not mutated by reading it', (function () {
    const p = { site: { pages: [{ name: 'About', slug: '', sections: [] }] } };
    Preflight.exportPages(p);
    return p.site.pages[0].slug === '';
  })());
}

// ---- 3. the menu ----------------------------------------------------------
console.log('\n3. Navigation');
{
  const missing = run(withSite({ navLinks: [{ label: 'Home', href: 'index.html' }, { label: 'Pricing', href: 'pricing.html' }] }));
  ok('a link to a page that does not exist is a blocker', missing.blockers.some((f) => f.area === 'nav'), areasIn(missing).join(','));
  ok('names the label', /"Pricing"/.test(missing.blockers.map((f) => f.msg).join(' ')));
  ok('says 404', /404/.test(missing.blockers.map((f) => f.msg).join(' ')));

  // the same link with the page present is fine
  const present = run(withSite({
    navLinks: [{ label: 'Home', href: 'index.html' }, { label: 'Work', href: 'work.html' }]
  }));
  ok('a link to a real page is not flagged', !present.blockers.some((f) => f.area === 'nav'), areasIn(present).join(','));

  // every shape a real link takes, against the two pages that exist
  const shapes = [['Home', '/' , false], ['Home', './index.html', false], ['Work', '/work.html', false], ['Work', 'work', false],
                  ['Work', '/work/', false], ['Work', 'https://example.org/work', false], ['Work', 'mailto:hi@x.co', false],
                  ['Blog', 'blog.html', true], ['Blog', 'https://ex.org/', false]];
  shapes.forEach(([label, href, shouldBlock]) => {
    const rep = run(withSite({ navLinks: [{ label: label, href: href }] }));
    const blocked = rep.blockers.some((f) => f.area === 'nav');
    ok('"' + href + '" ' + (shouldBlock ? 'blocks' : 'passes'), blocked === shouldBlock, 'got blocked=' + blocked);
  });

  // a hidden link is not something a visitor can follow
  const hidden = run(withSite({ navLinks: [{ label: 'Draft', href: 'draft.html', visible: false }] }));
  ok('a hidden nav link is ignored', !hidden.blockers.some((f) => f.area === 'nav'), areasIn(hidden).join(','));

  // a bare "#" belongs to site care, not here — one problem, one finding
  const hash = run(withSite({ navLinks: [{ label: 'Home', href: 'index.html' }, { label: 'Blog', href: '#' }] }));
  ok('a bare "#" is not reported as a missing page', !hash.blockers.some((f) => f.area === 'nav'), areasIn(hash).join(','));
  ok('a bare "#" still reaches the report through site care', hash.warnings.some((f) => f.area === 'deadlink'), areasIn(hash).join(','));
}

// ---- 4. reachability and search -------------------------------------------
console.log('\n4. Reachability and search');
{
  const noDesc = run(withSite({ metaDescription: '', tagline: '' }));
  ok('no description is a warning', noDesc.warnings.some((f) => f.area === 'seo'), areasIn(noDesc).join(','));
  ok('a missing description does not block', !noDesc.blockers.some((f) => f.area === 'seo'), areasIn(noDesc).join(','));

  const noContact = run(withSite({ email: '', phone: '', address: '' }, [
    { name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'Real headline' }] }
  ]));
  ok('no contact route is a warning', noContact.warnings.some((f) => f.area === 'contact'), areasIn(noContact).join(','));

  const withContactSection = run(withSite({ email: '', phone: '', address: '' }, [
    { name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'Real headline' }] },
    { name: 'Contact', slug: 'contact', sections: [{ id: 'c', type: 'contact', title: 'Get in touch' }] }
  ]));
  ok('a contact section counts as reachable', !withContactSection.warnings.some((f) => f.area === 'contact'), areasIn(withContactSection).join(','));
}

// ---- 5. insecure destinations ---------------------------------------------
console.log('\n5. Insecure links');
{
  const bad = run(withSite({ navLinks: [{ label: 'Work', href: 'work.html' }, { label: 'Blog', href: 'http://oldsite.co.uk/blog' }] }));
  ok('an http link is a warning', bad.warnings.some((f) => f.area === 'insecure'), areasIn(bad).join(','));
  ok('names the host', /oldsite\.co\.uk/.test(bad.warnings.map((f) => f.msg).join(' ')));

  const good = run(withSite({ navLinks: [{ label: 'Work', href: 'work.html' }, { label: 'Blog', href: 'https://oldsite.co.uk/blog' }] }));
  ok('https is not flagged', !good.warnings.some((f) => f.area === 'insecure'), areasIn(good).join(','));

  const local = run(withSite({ navLinks: [{ label: 'Work', href: 'work.html' }] }, [
    { name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'Real', ctaLink: 'http://localhost:3000/preview' }] }
  ]));
  ok('localhost is testing, not a defect', !local.warnings.some((f) => f.area === 'insecure'), areasIn(local).join(','));

  // a http link inside a section button or an item is just as live
  const inSection = run(withSite({}, [
    { name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'Real', ctaLink: 'http://old.example.co/book' }] }
  ]));
  ok('a section button is scanned too', inSection.warnings.some((f) => f.area === 'insecure'), areasIn(inSection).join(','));
}

// ---- 6. nothing to publish ------------------------------------------------
console.log('\n6. An empty project');
{
  const rep = run({ id: 'p', name: 'Untitled', site: { name: 'Untitled', sections: [] } });
  ok('is a blocker', rep.blockers.some((f) => f.area === 'empty-site'), areasIn(rep).join(','));
  ok('not ready', rep.ready === false);
}

// ---- 7. the composition rule ----------------------------------------------
console.log('\n7. Site care is carried, not repeated');
{
  const placeholder = run(withSite({}, [
    { name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'Lorem ipsum dolor sit amet' }] }
  ]));
  ok('a site-care error becomes a blocker', placeholder.blockers.some((f) => f.area === 'placeholder'), areasIn(placeholder).join(','));
  ok('it keeps the original wording', /lorem ipsum filler text/.test(placeholder.blockers.map((f) => f.msg).join(' ')));
  ok('it keeps the location', !!placeholder.blockers.find((f) => f.area === 'placeholder').where);

  const sampled = run(withSite({}, [
    { name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'Real headline' }, { id: 'g', type: 'gallery', title: 'Our work' }] }
  ]));
  ok('a site-care warning stays a warning', sampled.warnings.some((f) => f.area === 'template'), areasIn(sampled).join(','));
  ok('and does not block', !sampled.blockers.some((f) => f.area === 'template'), areasIn(sampled).join(','));

  const altNote = run(withSite({}, [
    { name: 'Home', slug: 'index', sections: [{ id: 'h', type: 'hero', title: 'Real headline', image: 'hero.jpg' }] }
  ]));
  ok('a site-care note stays a note', altNote.notes.some((f) => f.area === 'alt'), areasIn(altNote).join(','));

  // one problem, one finding: the carried audit is not also re-run into the lists
  const count = placeholder.blockers.filter((f) => f.area === 'placeholder').length;
  ok('the same finding is not duplicated', count === 1, 'got ' + count);

  ok('the full care report is attached', !!placeholder.care && placeholder.care.kind === 'pallettai-sitecare');
}

// ---- 8. the verdict -------------------------------------------------------
console.log('\n8. The verdict');
{
  const warnOnly = run(withSite({ metaDescription: '', tagline: '' }));
  ok('warnings alone still publish', warnOnly.ready === true, warnOnly.headline);
  ok('but the headline says to look', /worth a look/.test(warnOnly.headline), warnOnly.headline);

  const blocked = run(withSite({ navLinks: [{ label: 'Blog', href: 'blog.html' }] }));
  ok('a blocker stops publish', blocked.ready === false);
  ok('the headline says why', /Not ready to publish/.test(blocked.headline), blocked.headline);

  const urlOnly = run(withSite({ url: '' }));
  ok('a missing site address is only a note', urlOnly.notes.some((f) => f.area === 'url') && urlOnly.ready === true, areasIn(urlOnly).join(','));
}

// ---- 9. the resolver, directly -------------------------------------------
console.log('\n9. Link resolution');
{
  const T = Preflight.targetSlug;
  ok('"#" is not ours', T('#') === null);
  ok('"" is not ours', T('') === null);
  ok('a URL is not ours', T('https://x.org/a') === null);
  ok('http:// is not ours', T('http://x.org') === null);
  ok('mailto is not ours', T('mailto:hi@x.co') === null);
  ok('"/" is the home page', T('/') === 'index');
  ok('"index.html" is the home page', T('index.html') === 'index');
  ok('"work.html" resolves', T('work.html') === 'work');
  ok('"/work" resolves', T('/work') === 'work');
  ok('"Our Work.html" slugifies', T('Our Work.html') === 'our-work');
  ok('a query string is ignored', T('work.html?ref=nav') === 'work');
  ok('an anchor is ignored', T('work.html#team') === 'work');
}

// ---- 10. determinism ------------------------------------------------------
console.log('\n10. Determinism');
{
  const a = JSON.stringify(run(cleanProject()));
  const b = JSON.stringify(run(cleanProject()));
  ok('the same project gives the same report', a === b);
  const c = JSON.stringify(Preflight.run(cleanProject(), { now: '2027-01-01T00:00:00.000Z' }));
  ok('but the clock is recorded', c !== a);
}

console.log('\n' + (failed === 0 ? 'PREFLIGHT PASSED' : 'PREFLIGHT FAILED: ' + failed + ' assertion(s)'));
process.exit(failed === 0 ? 0 : 1);

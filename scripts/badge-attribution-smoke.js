// ============================================================
// Attribution badge smoke test — the free tier's link back.
//
// The badge is the one place a user's own value is written into every site they
// sell, so two things have to hold:
//
//   1. It is a REAL link carrying their referral code, so the export recruits
//      for the person who built it. A badge that only ever says "pallettai.org"
//      is a wasted impression.
//   2. It is never a way IN. The code is interpolated into an href, so the
//      tests below try to break out of the attribute, and the strict alphabet
//      is what stops them.
//
// Run: node scripts/badge-attribution-smoke.js
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
global.Review = require(path.join(ROOT, 'data', 'review.js'));
global.Images = require(path.join(ROOT, 'data', 'images.js'));
global.Focus = require(path.join(ROOT, 'data', 'focus.js'));
global.OgCard = require(path.join(ROOT, 'data', 'ogcard.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));

const project = {
  id: 'p1', name: 'Northwind Joinery', suites: [],
  site: {
    name: 'Northwind Joinery', tagline: 'Bespoke kitchens, built to last',
    palette: 'midnight', font: 'inter',
    sections: [
      { id: 's1', type: 'hero', title: 'Bespoke kitchens', subtitle: 'Get a quote in a day.' },
      { id: 's2', type: 'contact', title: 'Talk to us', text: 'studio@northwindjoinery.co.uk' }
    ]
  }
};

// ---- 1. the URL itself ----------------------------------------------------
console.log('\n1. Building the link');
{
  ok('a good code becomes a referral link', Builder.badgeHref('AB12CD') === 'https://pallettai.org/ref/AB12CD', Builder.badgeHref('AB12CD'));
  ok('the REF- prefix is accepted and stripped', Builder.badgeHref('REF-AB12CD') === 'https://pallettai.org/ref/AB12CD', Builder.badgeHref('REF-AB12CD'));
  ok('the prefix is stripped case-insensitively', Builder.badgeHref('ref-AB12CD') === 'https://pallettai.org/ref/AB12CD');
  ok('surrounding whitespace is tolerated', Builder.badgeHref('  AB12CD  ') === 'https://pallettai.org/ref/AB12CD');
  ok('lower case codes are kept as-is', Builder.badgeHref('ab12cd') === 'https://pallettai.org/ref/ab12cd');

  ok('no code falls back to the plain site', Builder.badgeHref('') === 'https://pallettai.org');
  ok('null falls back to the plain site', Builder.badgeHref(null) === 'https://pallettai.org');
  ok('undefined falls back to the plain site', Builder.badgeHref(undefined) === 'https://pallettai.org');
  ok('a bare "REF-" falls back to the plain site', Builder.badgeHref('REF-') === 'https://pallettai.org');
  ok('a too-short code falls back', Builder.badgeHref('AB') === 'https://pallettai.org');
  ok('a too-long code falls back', Builder.badgeHref('A'.repeat(40)) === 'https://pallettai.org');
}

// ---- 2. the link is not a way in ------------------------------------------
console.log('\n2. The code cannot break out of the attribute');
{
  const attacks = [
    '"><script>alert(1)</scr' + 'ipt>',
    "' onmouseover='alert(1)",
    '../../evil',
    'AB12CD/../../evil',
    'AB12CD?x=<script>',
    'AB 12CD',
    'AB-12-CD',
    'https://evil.example',
    'AB12CD#@evil.example',
    'javascript:alert(1)'
  ];
  attacks.forEach((code) => {
    const href = Builder.badgeHref(code);
    ok('refused: ' + JSON.stringify(code.slice(0, 30)), href === 'https://pallettai.org', href);
  });
}

// ---- 3. the badge in a real export ----------------------------------------
console.log('\n3. In the exported site');
{
  const free = Builder.buildSiteHTML(project, { proExport: false, refCode: 'REF-AB12CD', exportMeta: false });
  ok('a free export carries the badge', /pallettai-badge/.test(free));
  ok('the badge links with the referral code', free.includes('href="https://pallettai.org/ref/AB12CD"'), 'no referral href found');
  ok('the badge still names the product', /Made with PallettAI Studio/.test(free));
  ok('the badge opens safely', /class="pallettai-badge" href="[^"]+" target="_blank" rel="noopener"/.test(free));

  const noCode = Builder.buildSiteHTML(project, { proExport: false, exportMeta: false });
  ok('a signed-out export still carries the badge', /pallettai-badge/.test(noCode));
  ok('with no code the badge links to the plain site', noCode.includes('href="https://pallettai.org"'), 'no plain href found');
  ok('with no code there is no /ref/ path', !/pallettai-badge[^>]*\/ref\//.test(noCode));

  const pro = Builder.buildSiteHTML(project, { proExport: true, refCode: 'REF-AB12CD', exportMeta: false });
  ok('a Pro+ export carries no badge at all', !/pallettai-badge/.test(pro));
  ok('a Pro+ export carries none of the badge CSS either', !/pallettai-badge/.test(pro), 'white-label means white-label');
  ok('a Pro+ export leaks no referral code', !pro.includes('AB12CD'));
  ok('a Pro+ export still renders a complete document', /<\/html>/.test(pro) && pro.length > 1000);
  ok('a free export does carry the badge CSS', /pallettai-badge\{position:fixed/.test(free));

  const injected = Builder.buildSiteHTML(project, { proExport: false, refCode: '"><script>alert(1)</scr' + 'ipt>', exportMeta: false });
  ok('an injected code cannot reach the export', !/alert\(1\)/.test(injected));
  ok('an injected code falls back to the plain link', injected.includes('href="https://pallettai.org"'));
}

// ---- 4. every page, not just the first ------------------------------------
console.log('\n4. Every page of a multi-page export');
{
  const multi = {
    id: 'p2', name: 'Northwind', suites: [],
    site: {
      name: 'Northwind', palette: 'midnight', font: 'inter',
      pages: [
        { id: 'home', name: 'Home', slug: 'index', sections: [{ id: 'a', type: 'hero', title: 'Bespoke kitchens' }] },
        { id: 'about', name: 'About', slug: 'about', sections: [{ id: 'b', type: 'about', title: 'Who we are', text: 'Joiners in Leeds.' }] }
      ]
    }
  };
  const built = Builder.buildSitePages(multi, { proExport: false, refCode: 'ZZ99YY', exportMeta: false });
  ok('more than one page is produced', built.length >= 2, String(built.length));
  const missing = built.filter((e) => !e.html.includes('href="https://pallettai.org/ref/ZZ99YY"'));
  ok('the referral link is on every exported page', missing.length === 0, JSON.stringify(missing.map((e) => e.page.slug)));
}

console.log('\n' + (failed === 0 ? 'BADGE ATTRIBUTION PASSED' : 'BADGE ATTRIBUTION FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);

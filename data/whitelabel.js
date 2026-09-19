/*
  Wrapped in an IIFE on purpose: this loads as a classic script, so every
  top-level `const` here shares the global scope with every other script on the
  page. A duplicate `const` is a SyntaxError that takes the whole file down, and
  a duplicate `function` silently lets the last file to load win. Neither is
  acceptable, so nothing here leaks out except Whitelabel.
*/
(function () {
'use strict';

/*
  ============================================================
  White-label — what is left of US in a site we hand a client
  ------------------------------------------------------------
  Pro+ sells one sentence: "Unbranded exports (no studio
  badge)". Until this file existed that sentence was false in
  three places the badge code never looked at, all of them
  visible to the client's visitors:

    1. the footer signature, which defaults to "Made by
       PallettAI" pointing at pallettai.org;
    2. the panel a hero or About section draws when there is
       no photo, which says "Built with PallettAI Studio"
       under our ◆ mark;
    3. the cookie policy's own storage table, which listed
       `pallettai_theme_*`, `pallettai_cookies_ok` and
       `pallettai_cart_*` — our name, in the client's privacy
       page, because the exported site's scripts used those
       keys.

  Removing the badge while leaving those is worse than keeping
  the badge, because the studio has paid for the promise and
  has no way to check it. So this module does two jobs:

    * it derives a NEUTRAL storage namespace from the site's
      own name, so the keys an exported site writes (and the
      policy that discloses them) belong to the client;
    * it SCANS a built export and reports what brand text is
      still in it, in the words a studio can act on.

  Severity is the whole point of the split. A visible brand
  string in a Pro+ export is an error — the product is not
  doing what it was paid for. The same string on Free is the
  attribution working as designed, so it is a note. And the
  source fingerprints (`data-pai-build`, `pai-*` class names,
  `--pai-sched-h`) are reported as information only: they are
  invisible to a visitor and several of them are load-bearing
  for the client review round-trip, so they are named rather
  than silently renamed.
  ============================================================ */

// The two things a client must never have to explain to their own customer.
const PRODUCT = 'PallettAI';
const HOST = 'pallettai.org';

// The signature every install ships with (data/db.js owns the default). Named
// here so the builder can tell "the default" apart from "the studio typed our
// name on purpose" — on Pro+ the default is treated as unset, an explicit
// string is not.
const DEFAULT_SIGNATURE = 'Made by ' + PRODUCT;

// Only used to test with. Built from parts so this file does not itself look
// like a leak to a grep for the brand.
const reProduct = new RegExp(PRODUCT, 'i');
const reHost = new RegExp(HOST.replace(/\./g, '\\.'), 'i');

/*
  A neutral namespace for an exported site's local storage.

  Derived from the site's own name rather than from ours, because the keys are
  written by the CLIENT's site and disclosed in the CLIENT's cookie policy —
  and because two sites built by the same studio should not share a theme flag
  in a visitor's browser. Diacritics are folded and everything outside a-z0-9
  is dropped, so "Willow Café" becomes `willowcafe`; a site with no usable name
  falls back to `site`, which is honest rather than branded.
*/
function storagePrefix(project) {
  const site = (project && project.site) || {};
  const raw = String(site.name || (project && project.name) || '');
  const folded = typeof raw.normalize === 'function'
    ? raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    : raw;
  const ascii = folded.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
  return ascii || 'site';
}

/*
  The exact keys an exported site writes, in one place.

  builder.js writes them and data/legal.js discloses them, and a policy that
  names a key the site does not set (or misses one it does) is the single most
  common lie on a small business site. Both sides read this.
*/
function storageKeys(projectOrPrefix) {
  const prefix = typeof projectOrPrefix === 'string'
    ? (projectOrPrefix || 'site')
    : storagePrefix(projectOrPrefix);
  return {
    prefix,
    // `<prefix>_theme_<project>` — the per-site suffix is the builder's own, and
    // is kept so an existing deployed site only changes its namespace once.
    theme: prefix + '_theme_',
    themeGlob: prefix + '_theme_*',
    consent: prefix + '_cookies_ok',
    cart: prefix + '_cart_',
    cartGlob: prefix + '_cart_*'
  };
}

/*
  Scan built pages for brand text.

  pages: [{ name, slug, html }] — exactly what buildSitePages returns.
  opts:  { proExport } — true for a Pro+ export, which promises none of it.

  Returns the per-kind page lists, a flat, ordered findings array for the UI,
  and `ok` — which is only about the promise, not about taste: `ok` is true
  when nothing CLIENT-VISIBLE carries our name in a Pro+ export. On Free and
  Pro the badge is the design, so `ok` stays true there and the same facts come
  back as notes.
*/
function scan(pages, opts) {
  const list = Array.isArray(pages) ? pages : [];
  const proExport = !!(opts && opts.proExport);
  const brands = { signature: [], panel: [], link: [], storage: [], stamp: [] };
  const seen = (kind, where) => { if (brands[kind].indexOf(where) === -1) brands[kind].push(where); };

  list.forEach((entry) => {
    const html = String((entry && entry.html) || '');
    if (!html) return;
    const where = String((entry && (entry.name || entry.slug)) || 'a page');

    // The footer signature. Matched on the *rendered* element, not on the name,
    // so a studio that sets their own name here is never accused of anything —
    // and a studio that types our name deliberately is reported, not blocked.
    const sig = html.match(/class="made-by"[^>]*>([\s\S]{0,200}?)<\/p>/i);
    if (sig && reProduct.test(sig[1])) seen('signature', where);

    // The no-photo panel. This exact sentence only ever comes from
    // heroPlaceholder, so it cannot be confused with copy a studio wrote.
    if (new RegExp('Built with ' + PRODUCT + ' Studio').test(html)) seen('panel', where);

    // Any link or mention of our domain that is not the badge — the badge is
    // gated by proExport already, so on a Pro+ export this is a leftover.
    if (reHost.test(html)) seen('link', where);

    // The exported site's own storage keys, in its scripts and in any policy
    // table the export carries.
    if (new RegExp(PRODUCT + '_(theme|cart|cookies)', 'i').test(html)) seen('storage', where);

    // Developer-visible fingerprints only: the build stamp the review
    // round-trip reads, the client-editor's own class names, and the offset
    // variable the schedule bar publishes.
    if (/data-pai-build|data-pai=|class="pai-|--pai-sched-h/.test(html)) seen('stamp', where);
  });

  const findings = [];
  const pagesOf = (kind) => {
    const names = brands[kind];
    const shown = names.slice(0, 3).join(', ');
    return names.length > 3 ? shown + ' and ' + (names.length - 3) + ' more' : shown;
  };

  if (brands.signature.length) {
    findings.push({
      id: 'wl-signature',
      level: proExport ? 'error' : 'info',
      msg: proExport
        ? 'Every page still ends with “' + DEFAULT_SIGNATURE + '”.'
        : 'The footer signature on ' + brands.signature.length + ' page' + (brands.signature.length === 1 ? '' : 's') + ' is still ours, not yours.',
      fix: proExport
        ? 'Put your own studio name in Settings ▸ Branding, or switch the footer signature off — on your plan nothing of ours should reach the client.'
        : 'The footer signature is where a studio signs its work. Set it in Settings ▸ Branding to your own name and site.',
      fixId: 'signature',
      where: pagesOf('signature')
    });
  }

  if (brands.panel.length) {
    findings.push({
      id: 'wl-panel',
      level: proExport ? 'error' : 'info',
      msg: proExport
        ? 'A hero or About section with no photo shows a “Built with ' + PRODUCT + ' Studio” panel.'
        : 'A section with no photo is filled with a “Built with ' + PRODUCT + ' Studio” panel.',
      fix: proExport
        ? 'Add a photo to that section, or switch the hero to a layout that does not need one. On Pro+ the panel is yours, not ours.'
        : 'Add a photo to that section and the panel goes away.',
      fixId: 'photos',
      where: pagesOf('panel')
    });
  }

  if (brands.link.length && proExport) {
    findings.push({
      id: 'wl-link',
      level: 'error',
      msg: 'The export still links to ' + HOST + '.',
      fix: 'Clear the brand link in Settings ▸ Branding, or point it at your own studio site.',
      fixId: 'signature',
      where: pagesOf('link')
    });
  }
  if (brands.storage.length) {
    findings.push({
      id: 'wl-storage',
      level: 'warn',
      msg: 'The exported site stores its settings under a ' + PRODUCT + ' key.',
      fix: 'This is a build that predates the neutral namespace — re-export and the site will name its own storage after itself.',
      fixId: '',
      where: pagesOf('storage')
    });
  }
  if (brands.stamp.length) {
    findings.push({
      id: 'wl-stamp',
      level: 'info',
      msg: 'The export source carries tooling markers (build stamp, editor class names).',
      fix: 'Not visible to a visitor or to the client — they are what the client-review round-trip reads. Reported so you know they are there.',
      fixId: '',
      where: pagesOf('stamp')
    });
  }

  const visibleHits = brands.signature.length + brands.panel.length + brands.link.length + brands.storage.length;
  return {
    ok: !findings.some((f) => f.level === 'error'),
    proExport,
    pages: list.length,
    brands,
    findings,
    visibleHits,
    // Developer-visible only. Kept apart so a UI can say "6 client-visible
    // mentions of us" without the number being inflated by class names.
    invisibleHits: brands.stamp.length
  };
}

/*
  One line for a toast or an export report.
*/
function summary(result) {
  if (!result) return '';
  const n = result.visibleHits || 0;
  if (!n) return 'Unbranded \u2014 nothing of ours anywhere a client can see.';
  return n + ' mention' + (n === 1 ? '' : 's') + ' of ours a client can see in this export';
}

const Whitelabel = {
  PRODUCT, HOST, DEFAULT_SIGNATURE,
  storagePrefix, storageKeys, scan, summary
};

if (typeof window !== 'undefined') window.Whitelabel = Whitelabel;
if (typeof module !== 'undefined' && module.exports) module.exports = Whitelabel;
})();

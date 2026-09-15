'use strict';

// ============================================================
// Pre-flight — the one gate between a project and a live site.
// ------------------------------------------------------------
// The audits in Studio each answer their own question: site care asks whether
// the copy is still true, perf asks whether the export is fast, vision asks
// whether the page reads well. None of them is the moment that matters, which
// is the second someone presses Publish. Until now that button said yes to
// whatever was in front of it, and the first person to notice the template's
// phone number was a paying customer.
//
// So this composes the audits into a single go/no-go, and adds the checks that
// only exist at publish time:
//
//   * two pages that export to the SAME file — one silently overwrites the
//     other, and the sitemap advertises a page that is not there;
//   * a navigation link to a page that does not exist — a 404 from the menu,
//     the first thing a visitor touches;
//   * nothing to publish at all;
//   * no description, so search results and shared links show a bare name;
//   * no way to contact the owner — a business site an enquiry cannot reach;
//   * an insecure http:// destination on a live site.
//
// The composition rule is deliberately simple and stated rather than implied:
// a site-care ERROR is a blocker, a WARNING is a warning, a note stays a note.
// That keeps one vocabulary — a blocker is "a visitor would see something
// wrong" — and means the findings can be argued with one at a time.
//
// Pure, offline and deterministic: pass `{ now }` and the same project always
// produces the same report.
// ============================================================

const Preflight = (() => {

  // Site care is loaded as a sibling script in the browser and required under
  // Node. Same resolution as the rest of data/: global first, require second,
  // null rather than a throw when neither is there.
  function siteCare() {
    try { if (typeof SiteCare !== 'undefined' && SiteCare) return SiteCare; } catch (e) { /* fall through */ }
    try { return (typeof require === 'function') ? require('./sitecare.js') : null; } catch (e) { return null; }
  }

  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  // Mirrors the builder's own slugify, because a filename is what this is
  // predicting. A page called "Our Pricing" and one called "our-pricing" are
  // the same file to the export, so they must be the same string here.
  const normSlug = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const isExternal = (h) => /^(?:https?:|mailto:|tel:|\/\/)/i.test(h);

  // Where a link would actually land, or null when it is not ours to judge:
  // an in-page anchor, an external address, or no link at all.
  function targetSlug(href) {
    const h0 = str(href);
    if (!h0) return null;
    if (h0.charAt(0) === '#') return null;      // site care already owns a bare "#"
    if (isExternal(h0)) return null;
    const h = h0.split('#')[0].split('?')[0].replace(/^\.?\//, '').replace(/\.html?$/i, '').replace(/\/+$/, '');
    if (!h) return 'index';                     // "/", "./", "index.html"
    return normSlug(h);
  }

  const LEVEL_FROM_CARE = { error: 'blocker', warn: 'warning', info: 'note' };

  function run(project, opts) {
    const o = opts || {};
    const now = o.now ? new Date(o.now) : new Date();
    const site = (project && project.site) || {};
    const care = siteCare();

    // Read the pages the way the EXPORT will, not the way they are stored. This
    // is deliberately not site care's page list: that one fills a missing slug
    // with a "page-N" placeholder, which is right for describing a section and
    // wrong for predicting a filename.
    const pages = exportPages(project);
    const pageSlugs = pages.map((pg) => pg.slug);
    const known = new Set(pageSlugs);
    const totalSections = pages.reduce((n, pg) => n + (Array.isArray(pg.sections) ? pg.sections.length : 0), 0);

    const blockers = [];
    const warnings = [];
    const notes = [];
    const add = (level, area, msg, fix, where) => {
      const f = { id: 'pre-' + area + '-' + (blockers.length + warnings.length + notes.length), level: level, area: area, msg: msg, fix: fix || '', where: where || null };
      if (level === 'blocker') blockers.push(f);
      else if (level === 'warning') warnings.push(f);
      else notes.push(f);
      return f;
    };

    // ---- 1. is there anything here to publish? ------------------------------
    if (!totalSections) {
      add('blocker', 'empty-site',
        'This project has no sections yet, so there is nothing to publish.',
        'Add a section or start from a brief first.', null);
    }

    // ---- 2. two pages, one file --------------------------------------------
    // The export writes each page to <slug>.html. Two pages that resolve to the
    // same slug therefore produce one file, and the loser is not reported by
    // anything: the export succeeds, the zip is valid, and a page is simply
    // missing from the live site.
    const firstSeen = new Map();
    pages.forEach((pg) => {
      const slug = normSlug(pg.slug || pg.name);
      if (!slug) return;
      if (firstSeen.has(slug)) {
        const other = firstSeen.get(slug);
        blockers.push({
          id: 'pre-slug-' + blockers.length,
          level: 'blocker',
          area: 'slug',
          msg: 'The pages "' + other.name + '" and "' + pg.name + '" both export to ' + slug + '.html, so one overwrites the other.',
          fix: 'Rename one of them, or give it a different slug, so visitors can reach both.',
          where: { page: pg.slug || '', pageName: pg.name || '', sectionId: '', sectionType: '', sectionNo: 0 }
        });
      } else {
        firstSeen.set(slug, pg);
      }
    });

    // ---- 3. a menu link with nowhere to go ---------------------------------
    // Site care flags a link that is an explicit "#". This is the other half:
    // a link that looks finished and points at a page that was never made.
    const missing = [];
    (Array.isArray(site.navLinks) ? site.navLinks : []).forEach((l) => {
      if (!l || l.visible === false) return;
      const t = targetSlug(l.href);
      if (t && !known.has(t)) missing.push({ label: str(l.label) || str(l.href), href: str(l.href), slug: t });
    });
    if (missing.length) {
      const names = missing.map((m) => '"' + m.label + '" (' + m.href + ')');
      add('blocker', 'nav',
        names.join(', ') + (missing.length === 1 ? ' points at a page that is not' : ' point at pages that are not') + ' in this project, so a visitor following the menu lands on a 404.',
        'Point the link at a real page, make a page of that name, or hide it.',
        null);
    }

    // ---- 4. what a search engine or a shared link will show ----------------
    const desc = str(site.metaDescription) || str(site.tagline);
    if (!desc) {
      add('warning', 'seo',
        'The site has no meta description or tagline, so search results and shared links show the name and nothing else.',
        'Write one sentence describing the business in Design & branding.', null);
    }

    // ---- 5. can anyone actually reach the owner? ---------------------------
    const hasContactSection = pages.some((pg) => (Array.isArray(pg.sections) ? pg.sections : []).some((s) => s && s.type === 'contact'));
    const reachable = !!(str(site.email) || str(site.phone) || str(site.address)) || hasContactSection;
    if (!reachable) {
      add('warning', 'contact',
        'There is no way for a visitor to get in touch — no email, phone, address or contact section.',
        'Add a contact section, or set an inbox in Design & branding.', null);
    }

    // ---- 6. a live site served over http:// --------------------------------
    // Only destinations a visitor clicks count, and localhost is excluded
    // because testing against a local server is a normal thing to do.
    const insecure = new Set();
    const checkHref = (href) => {
      const h = str(href);
      if (/^http:\/\//i.test(h) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(h)) {
        insecure.add(h.replace(/^http:\/\//i, '').split('/')[0]);
      }
    };
    (Array.isArray(site.navLinks) ? site.navLinks : []).forEach((l) => { if (l && l.visible !== false) checkHref(l.href); });
    pages.forEach((pg) => {
      (Array.isArray(pg.sections) ? pg.sections : []).forEach((s) => {
        if (!s) return;
        checkHref(s.ctaLink);
        (Array.isArray(s.items) ? s.items : []).forEach((it) => { if (it) checkHref(it.href); });
      });
    });
    if (insecure.size) {
      const hosts = Array.from(insecure);
      add('warning', 'insecure',
        'A link on the site points at an insecure http:// address (' + hosts.join(', ') + ').',
        'Use https:// — some browsers warn before loading an insecure link.', null);
    }

    // ---- 7. no address of its own ------------------------------------------
    if (!str(site.url)) {
      add('note', 'url',
        'No site address is set, so the export cannot write a canonical link, a share card or a sitemap.',
        'Set the address in Publish once the site has a home.', null);
    }

    // ---- the audits, carried rather than repeated ---------------------------
    // Everything site care already knows arrives here with its level translated
    // by the one stated rule, and its own wording and location kept intact.
    if (care && care.audit) {
      care.audit(project, { now: now, title: o.title }).findings.forEach((f) => {
        const level = LEVEL_FROM_CARE[f.level] || 'note';
        add(level, f.area, f.msg, f.fix, f.where);
      });
    }

    // ---- the verdict --------------------------------------------------------
    // "Ready" is about the visitor, not the score: a warning is something worth
    // a look, a blocker is something they would actually see go wrong.
    const ready = blockers.length === 0;
    let headline;
    if (!blockers.length && !warnings.length && !notes.length) {
      headline = 'Ready to publish — nothing outstanding.';
    } else if (blockers.length) {
      headline = 'Not ready to publish: ' + blockers.length + ' thing' + (blockers.length === 1 ? '' : 's') + ' would be wrong on the live site.';
    } else if (warnings.length) {
      headline = 'Ready to publish, with ' + warnings.length + ' thing' + (warnings.length === 1 ? '' : 's') + ' worth a look first.';
    } else {
      headline = 'Ready to publish.';
    }

    return {
      kind: 'pallettai-preflight',
      title: String(o.title || (project && project.name) || ''),
      checkedAt: now.toISOString(),
      ready: ready,
      headline: headline,
      counts: { blocker: blockers.length, warning: warnings.length, note: notes.length },
      blockers: blockers,
      warnings: warnings,
      notes: notes,
      care: care && care.audit ? care.audit(project, { now: now, title: o.title }) : null,
      pages: pages.length,
      sections: totalSections,
      slug: { unique: new Set(pageSlugs).size, total: pageSlugs.length }
    };
  }

  // The pages as the builder will actually write them, which is not quite the
  // pages as stored. Two of its rules matter here and neither is obvious:
  //
  //   * an index.html must always exist, so the builder renames the FIRST page
  //     if none claims that slug — meaning a project whose pages have no slugs
  //     publishes its first page at "/" and the rest at their own names;
  //   * the filename is `slug || slugify(name)`, so the name is what decides it
  //     when the slug is blank.
  //
  // Predicting both is what keeps the menu check honest: it must judge a link
  // against the file that will exist, not the one that was typed into it.
  function exportPages(project) {
    const site = (project && project.site) || {};
    let raw;
    if (Array.isArray(site.pages) && site.pages.length) {
      raw = site.pages.map((pg, i) => ({
        name: (pg && pg.name) || ('Page ' + (i + 1)),
        slug: String((pg && pg.slug) || '').trim(),
        sections: Array.isArray(pg && pg.sections) ? pg.sections : []
      }));
    } else {
      raw = [{ name: site.name || 'Home', slug: 'index', sections: Array.isArray(site.sections) ? site.sections : [] }];
    }
    // Copied, never mutated: the builder is allowed to rewrite the project, this
    // report is not.
    if (!raw.some((pg) => pg.slug === 'index')) raw[0] = Object.assign({}, raw[0], { slug: 'index' });
    return raw.map((pg) => ({
      name: pg.name,
      slug: normSlug(pg.slug || pg.name) || 'page',
      sections: pg.sections
    }));
  }

  return { run, targetSlug, normSlug, exportPages };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Preflight;

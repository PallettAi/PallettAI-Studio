'use strict';

// ============================================================
// Keyboard & focus — the export has to be usable without a mouse.
// ------------------------------------------------------------
// Two separate jobs, deliberately kept in one file because they must agree:
//
//   1. pass(html) — emit what a keyboard visitor needs: a skip link that is
//      the first thing focus reaches, a labelled <main> to jump to, a visible
//      focus ring, and aria-current on the nav item you are already on.
//   2. audit(pages) — measure the result, plus the things that cannot be
//      fixed by rewriting a tag, and report them where the agency can act.
//
// The audit deliberately does NOT re-report image alt text or colour
// contrast: the launch-grade audit already owns those, and the same problem
// appearing twice in one report reads as two problems.
//
// Pure and offline.
// ============================================================

const Focus = (() => {

  const SKIP_CLASS = 'skip-link';
  const MAIN_ID = 'main';

  // A skip link is only useful if it is reachable before anything else, so it
  // sits before the nav in the DOM — not merely first in CSS order.
  function skipLink() {
    return '<a class="' + SKIP_CLASS + '" href="#' + MAIN_ID + '">Skip to content</a>';
  }

  // Visually hidden until focused, then a real, high-contrast control. Written
  // with explicit values rather than palette lookups so it cannot be made
  // unreadable by a low-contrast project palette — this is the one element
  // that must always be findable.
  function css() {
    return [
      '.' + SKIP_CLASS + '{position:absolute;left:-9999px;top:0;z-index:9999;background:#ffffff;color:#0b1220;',
      'padding:12px 18px;border-radius:0 0 10px 0;font:600 15px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;',
      'text-decoration:none;box-shadow:0 6px 24px rgba(0,0,0,.35)}',
      '.' + SKIP_CLASS + ':focus{left:0;outline:3px solid #2563eb;outline-offset:2px}',
      // :focus-visible only, so a mouse click does not leave a ring behind —
      // but any element reached by keyboard gets one, including the ones the
      // browser would otherwise style with `outline:none`.
      ':focus-visible{outline:3px solid currentColor;outline-offset:2px}',
      'a:focus-visible,button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:3px solid currentColor;outline-offset:3px}',
      // Form controls are the one place a focus ring must survive author CSS:
      // a site can legitimately write `input:focus{outline:none}` to style its
      // own border, and that selector outranks the plain rule above. A visible
      // indicator is an accessibility requirement, not a style preference, so
      // this single declaration is allowed to win outright.
      'input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid currentColor !important;outline-offset:3px}'
    ].join('');
  }

  const attr = (tag, name) => {
    const m = tag.match(new RegExp('\\s' + name + '=["\']([^"\']*)["\']', 'i'));
    return m ? m[1] : null;
  };
  const hasAttr = (tag, name) => new RegExp('\\s' + name + '(?=[\\s=/>])', 'i').test(tag);

  // The export inlines its own JavaScript, and that source contains strings
  // that look like markup. Measuring them produced findings about elements
  // that do not exist on the page — a report that cries wolf is worse than no
  // report, so scripts and comments come out before anything is counted.
  function markupOnly(html) {
    return String(html == null ? '' : html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, '<!--script-->')
      .replace(/<!--[\s\S]*?-->/g, '');
  }

  // ---- pass -----------------------------------------------------------------
  // Idempotent: running it twice must not produce two skip links or a doubled
  // id, because the export path can legitimately re-run the polish steps.
  //
  // This deliberately does NOT touch the navigation. `aria-current` has to be
  // decided by the renderer, which is the only thing that knows which page it
  // is building — guessing from hrefs marked the wrong link once and would do
  // so again on any site whose pages share a slug prefix.
  function pass(html, opts) {
    let out = String(html == null ? '' : html);

    // 1. <main> needs an address and a name for the skip link to be useful.
    if (/<main\b/i.test(out)) {
      out = out.replace(/<main\b([^>]*)>/i, (m, rest) => {
        let attrs = rest;
        if (!hasAttr('<main' + attrs + '>', 'id')) attrs += ' id="' + MAIN_ID + '"';
        if (!hasAttr('<main' + attrs + '>', 'aria-label') && !hasAttr('<main' + attrs + '>', 'aria-labelledby')) {
          attrs += ' aria-label="Main content"';
        }
        return '<main' + attrs + '>';
      });
    }

    // 2. Skip link first in <body>, before the nav.
    if (!new RegExp('class=["\'][^"\']*' + SKIP_CLASS + '["\']').test(out)) {
      out = out.replace(/(<body\b[^>]*>)/i, (m) => m + '\n' + skipLink());
    }

    // 3. Focus styles, appended to the page's own stylesheet. Appended last on
    //    purpose: the site's own CSS sets `outline:none` on its form controls,
    //    and a rule in this position with the same specificity would lose.
    if (!out.includes(SKIP_CLASS + ':focus')) {
      out = out.replace(/<\/head>/i, '<style>' + css() + '</style>\n</head>');
    }
    return out;
  }

  // ---- audit ----------------------------------------------------------------
  const HEAD = /<h([1-6])(?:\s[^>]*)?>/gi;

  function auditPage(page) {
    const html = markupOnly((page && page.html) || '');
    const findings = [];
    const slug = (page && page.slug) || '';

    // 1. Skip link: present, and ahead of the first nav control.
    const bodyAt = html.search(/<body\b/i);
    const skipAt = html.search(new RegExp('class=["\'][^"\']*' + SKIP_CLASS));
    const navAt = html.search(/<nav\b/i);
    if (skipAt === -1) {
      findings.push({ level: 'warn', msg: 'No skip link', fix: 'Exported sites now start with one — export again.' });
    } else if (navAt !== -1 && skipAt > navAt) {
      findings.push({ level: 'warn', msg: 'Skip link comes after the navigation', fix: 'A keyboard visitor tabs the whole menu before it.' });
    } else if (bodyAt !== -1 && skipAt < bodyAt) {
      findings.push({ level: 'error', msg: 'Skip link is outside <body>', fix: 'It cannot be focused there.' });
    }

    // 2. Landmark to land on.
    if (/<main\b/i.test(html)) {
      const mainTag = (html.match(/<main\b[^>]*>/i) || [''])[0];
      if (!hasAttr(mainTag, 'id')) findings.push({ level: 'warn', msg: '<main> has no id to link to', fix: 'The skip link has nowhere to go.' });
    } else {
      findings.push({ level: 'warn', msg: 'No <main> landmark', fix: 'Screen readers cannot jump past the navigation.' });
    }

    // 3. Language — a screen reader picks its voice from this.
    const htmlTag = (html.match(/<html\b[^>]*>/i) || [''])[0];
    if (!hasAttr(htmlTag, 'lang')) findings.push({ level: 'error', msg: '<html> has no lang attribute', fix: 'Screen readers guess the language, usually wrongly.' });

    // 4. Focus ring — the browser default must not have been removed.
    if (/outline\s*:\s*none/i.test(html) && !/:focus-visible/i.test(html)) {
      findings.push({ level: 'warn', msg: 'Focus outline is suppressed with nothing put back', fix: 'Keyboard visitors cannot see where they are.' });
    }

    // 5. A positive tabindex reorders the whole page and is nearly always a bug.
    const posTab = (html.match(/\btabindex=["']([1-9]\d*)["']/gi) || []).length;
    if (posTab > 0) findings.push({ level: 'warn', msg: posTab + ' element' + (posTab === 1 ? '' : 's') + ' with a positive tabindex', fix: 'Tab order should follow the DOM.' });

    // 6. Heading order — a jump down (h2 → h4) is read as a missing section.
    let prev = 0, jumps = 0;
    HEAD.lastIndex = 0;
    let m;
    while ((m = HEAD.exec(html))) {
      const lvl = +m[1];
      if (prev && lvl > prev + 1) jumps++;
      prev = lvl;
    }
    if (jumps > 0) {
      findings.push({ level: 'info', msg: jumps + ' heading level' + (jumps === 1 ? '' : 's') + ' skipped', fix: 'Headings read as a document outline; avoid jumping down.' });
    }

    // 7. Controls with no accessible name.
    const emptyLinks = (html.match(/<a\b[^>]*>\s*<\/a>/gi) || []).length;
    if (emptyLinks > 0) {
      findings.push({ level: 'warn', msg: emptyLinks + ' empty link' + (emptyLinks === 1 ? '' : 's'), fix: 'Give each one a label or an aria-label.' });
    }

    // 8. On a multi-page site the navigation should say which page you are on.
    //    `page-link` is the marker the renderer puts on cross-page links, so a
    //    single-page site (whose nav is on-page anchors) is not asked for this.
    const multiPage = /class=["'][^"']*\bpage-link\b/i.test(html);
    if (multiPage) {
      const current = (html.match(/aria-current=["']page["']/gi) || []).length;
      if (current === 0) findings.push({ level: 'warn', msg: 'Navigation does not mark the current page', fix: 'aria-current="page" belongs on the link for the page being viewed.' });
      else if (current > 1) findings.push({ level: 'warn', msg: current + ' navigation links marked as the current page', fix: 'Only one page can be current.' });
    }

    let score = 100;
    findings.forEach((f) => { score -= f.level === 'error' ? 20 : f.level === 'warn' ? 10 : 3; });
    return {
      page: (page && page.name) || 'Untitled',
      slug: slug,
      findings: findings,
      score: Math.max(0, score)
    };
  }

  function audit(pages) {
    const list = (Array.isArray(pages) ? pages : []).map(auditPage);
    const all = [];
    list.forEach((p) => p.findings.forEach((f) => all.push(Object.assign({}, f, { page: p.page }))));
    const errors = all.filter((f) => f.level === 'error').length;
    const warnings = all.filter((f) => f.level === 'warn').length;
    const score = list.length ? Math.round(list.reduce((s, p) => s + p.score, 0) / list.length) : 100;
    const letter = score >= 95 ? 'A+' : score >= 88 ? 'A' : score >= 78 ? 'B' : score >= 66 ? 'C' : score >= 50 ? 'D' : 'F';
    return {
      pages: list,
      findings: all,
      errors: errors,
      warnings: warnings,
      score: score,
      letter: letter,
      keyboardReady: errors === 0 && warnings === 0,
      summary: all.length === 0
        ? 'Keyboard and screen-reader basics are all in place.'
        : errors + ' to fix, ' + warnings + ' worth improving, across ' + list.length + ' page' + (list.length === 1 ? '' : 's') + '.'
    };
  }

  return { SKIP_CLASS, MAIN_ID, skipLink, css, pass, audit, auditPage, markupOnly, attr, hasAttr };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Focus;

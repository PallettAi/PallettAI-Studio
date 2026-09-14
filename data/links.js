'use strict';

// ============================================================
// Link & anchor integrity — nothing in the export should dead-end.
// ------------------------------------------------------------
// An exported site is a set of files with no server to catch mistakes: a link
// to a page that was never written, or an anchor pointing at a section that
// was renamed, is a 404 the client discovers in front of their own customer.
//
// This walks the finished export and resolves every reference against what is
// actually being shipped:
//   * internal page links must resolve to an exported file;
//   * `#anchors` must exist on the page they point at (including cross-page
//     ones, which is where a rename usually breaks);
//   * relative assets must be in the export;
//   * ids must be unique, because a duplicate makes an anchor ambiguous;
//   * a page nobody links to is either deliberate or a mistake worth naming.
//
// Pure and offline.
// ============================================================

const Links = (() => {

  // The export inlines JavaScript whose source contains markup-shaped strings,
  // and counting those invents links no visitor can click.
  function markupOnly(html) {
    return String(html == null ? '' : html)
      .replace(/<script\b[\s\S]*?<\/script>/gi, '<!--script-->')
      .replace(/<!--[\s\S]*?-->/g, '');
  }

  // Walk the markup and lift one attribute's values. Written as a scan rather
  // than a built-up RegExp: attribute names and quote characters need so much
  // escaping inside a pattern string that the pattern becomes the bug.
  function attrAll(html, name) {
    const out = [];
    const s = String(html == null ? '' : html);
    const needle = name + '=';
    let i = 0;
    while (i < s.length) {
      const at = s.indexOf(needle, i);
      if (at === -1) break;
      i = at + needle.length;
      // `data-href=` and `xhref=` must not answer for `href=`.
      const before = at > 0 ? s[at - 1] : ' ';
      if (/[A-Za-z0-9_-]/.test(before)) continue;
      const q = s[i];
      if (q !== '"' && q !== "'") continue;
      const end = s.indexOf(q, i + 1);
      if (end === -1) continue;
      out.push(s.slice(i + 1, end));
      i = end + 1;
    }
    return out;
  }

  const idsIn = (html) => {
    const out = [];
    attrAll(html, 'id').forEach((v) => { if (v) out.push(v); });
    return out;
  };

  const isExternal = (href) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(String(href || ''));
  const isAsset = (href) => /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|woff2?|ttf|eot|pdf|mp4|webm|zip)(\?|#|$)/i.test(href);

  // Page files plus any extra files that ship beside them.
  function pageIndex(pages, files) {
    const map = { '': true, 'index.html': true, './': true };
    (Array.isArray(pages) ? pages : []).forEach((p) => {
      const slug = String((p && p.slug) || '').trim();
      if (!slug || slug === 'index') { map['index.html'] = true; map[''] = true; return; }
      map[slug + '.html'] = true;
      map['./' + slug + '.html'] = true;
    });
    (Array.isArray(files) ? files : []).forEach((f) => {
      const n = String((f && f.name) || '').trim();
      if (n) map[n] = true;
    });
    return map;
  }

  // Resolve `about.html#team` against the page it belongs to.
  function resolve(href, fromSlug, index) {
    const raw = String(href || '').trim();
    if (!raw) return { kind: 'empty' };
    // ANY scheme is off-site. Enumerating the ones we expected let a `data:`
    // favicon through and reported it as a missing page — the favicon the
    // builder emits is itself a data: URI, so that fired on every export.
    if (isExternal(raw)) return { kind: 'external', scheme: raw.split(':')[0].toLowerCase(), raw: raw };
    const parts = raw.split('#');
    const pathPart = parts[0] || '';
    const anchor = parts[1] || '';
    const file = String(pathPart).split('?')[0];

    // Same-page anchor: resolved against the page being audited.
    if (!file && anchor) return { kind: 'anchor', anchor: anchor, page: fromSlug };

    const clean = String(file).replace(/^\.\//, '').replace(/^\//, '');
    if (clean === '') return { kind: 'page', page: 'index.html', anchor: anchor };
    const target = index[clean] ? clean : (index[clean + '.html'] ? clean + '.html' : null);
    if (!target) return { kind: 'missing-page', file: clean };
    return { kind: 'page', page: target, anchor: anchor };
  }

  function auditPage(page, index, pages) {
    const html = markupOnly(page && page.html);
    const slug = String((page && page.slug) || 'index');
    const findings = [];
    const hrefs = attrAll(html, 'href');
    const ids = idsIn(html);

    // Duplicate ids make every anchor to that name ambiguous.
    const seen = {};
    const dupes = [];
    ids.forEach((id) => { if (seen[id] && dupes.indexOf(id) === -1) dupes.push(id); seen[id] = true; });
    if (dupes.length) {
      findings.push({
        level: 'warn',
        msg: dupes.length + ' duplicate id' + (dupes.length === 1 ? '' : 's') + ' (' + dupes.slice(0, 3).join(', ') + ')',
        fix: 'Two elements sharing an id makes its anchor land on the wrong one.'
      });
    }

    const idSet = {};
    ids.forEach((id) => { idSet[id] = true; });
    const referencedAssets = [];
    let internal = 0, external = 0;
    const hosts = {};

    hrefs.forEach((href) => {
      const r = resolve(href, slug, index);
      if (r.kind === 'external') {
        external++;
        if (/^https?:/i.test(href)) {
          try { hosts[new URL(href).hostname] = true; } catch (e) { /* not a parsable URL */ }
        }
        if (r.scheme === 'javascript') {
          findings.push({ level: 'error', msg: 'A javascript: link is still in the export', fix: 'These are stripped on export — this one came from custom code.' });
        }
        return;
      }
      if (r.kind === 'missing-page') {
        findings.push({ level: 'error', msg: 'Link to “' + href + '” has no page', fix: 'The page was renamed or never created.' });
        return;
      }
      internal++;
      if (r.kind === 'anchor') {
        if (!idSet[r.anchor]) {
          findings.push({ level: 'warn', msg: 'Anchor “#' + r.anchor + '” does not exist on this page', fix: 'Renaming a section changes its id.' });
        }
        return;
      }
      if (r.kind === 'page' && r.anchor) {
        const other = (Array.isArray(pages) ? pages : []).find((p) => {
          const ps = String((p && p.slug) || 'index');
          return (ps === 'index' ? 'index.html' : ps + '.html') === r.page;
        });
        const otherIds = other ? idsIn(markupOnly(other.html)) : [];
        if (otherIds.indexOf(r.anchor) === -1) {
          findings.push({ level: 'error', msg: 'Cross-page link “' + href + '” points at an anchor that does not exist', fix: 'Check that section id on ' + r.page + '.' });
        }
      }
      if (isAsset(r.page) && !index[r.page]) referencedAssets.push(r.page);
    });

    // Assets referenced by attributes other than href.
    ['src', 'poster', 'data-src'].forEach((a) => {
      attrAll(html, a).forEach((v) => {
        const raw = String(v || '').trim();
        if (!raw || isExternal(raw) || raw.startsWith('data:')) return;
        const clean = raw.split('#')[0].split('?')[0].replace(/^\.\//, '').replace(/^\//, '');
        if (clean && !index[clean]) referencedAssets.push(clean);
      });
    });
    if (referencedAssets.length) {
      const uniq = Array.from(new Set(referencedAssets));
      findings.push({
        level: 'error',
        msg: uniq.length + ' referenced file' + (uniq.length === 1 ? '' : 's') + ' not in the export (' + uniq.slice(0, 3).join(', ') + ')',
        fix: 'The browser will request these and get a 404.'
      });
    }

    return {
      page: (page && page.name) || 'Untitled',
      slug: slug,
      links: hrefs.length,
      internal: internal,
      external: external,
      hosts: Object.keys(hosts),
      findings: findings
    };
  }

  function audit(pages, files) {
    const list = Array.isArray(pages) ? pages : [];
    const index = pageIndex(list, files);
    // The same broken anchor usually appears in the nav, the footer and a
    // button, which would otherwise report the one problem three times.
    const audited = list.map((p) => {
      const a = auditPage(p, index, list);
      const seen = {};
      a.findings = a.findings.filter((f) => {
        const key = f.level + '|' + f.msg;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
      return a;
    });
    const all = [];
    audited.forEach((p) => p.findings.forEach((f) => all.push(Object.assign({}, f, { page: p.page }))));

    // A page nothing links to is reachable only by typing its URL. Sometimes
    // deliberate (a thank-you page), so it is reported and not failed.
    const linkedPages = {};
    list.forEach((p) => {
      const html = markupOnly(p && p.html);
      const slug = String((p && p.slug) || 'index');
      attrAll(html, 'href').forEach((href) => {
        const r = resolve(href, slug, index);
        if (r.kind === 'page') linkedPages[r.page] = true;
      });
    });
    const orphans = list
      .filter((p) => String((p && p.slug) || 'index') !== 'index')
      .filter((p) => !linkedPages[String((p && p.slug) || '') + '.html'])
      .map((p) => (p && p.name) || 'Untitled');
    if (orphans.length) {
      all.push({
        level: 'info',
        page: orphans[0],
        msg: orphans.length + ' page' + (orphans.length === 1 ? '' : 's') + ' nothing links to (' + orphans.slice(0, 3).join(', ') + ')',
        fix: 'Add them to the navigation, or they are invisible to visitors and crawlers.'
      });
    }

    const errors = all.filter((f) => f.level === 'error').length;
    const warnings = all.filter((f) => f.level === 'warn').length;
    const externalHosts = Array.from(new Set(audited.reduce((acc, p) => acc.concat(p.hosts), [])));
    let score = 100;
    all.forEach((f) => { score -= f.level === 'error' ? 18 : f.level === 'warn' ? 8 : 2; });
    score = Math.max(0, Math.round(score));
    const letter = score >= 95 ? 'A+' : score >= 88 ? 'A' : score >= 78 ? 'B' : score >= 66 ? 'C' : score >= 50 ? 'D' : 'F';

    return {
      pages: audited,
      findings: all,
      errors: errors,
      warnings: warnings,
      externalHosts: externalHosts,
      score: score,
      letter: letter,
      summary: (errors + warnings) === 0
        ? 'Every link, anchor and asset in the export resolves.'
        : errors + ' broken reference' + (errors === 1 ? '' : 's') + ', ' + warnings + ' to check.'
    };
  }

  return { markupOnly, attrAll, idsIn, pageIndex, resolve, audit, auditPage, isExternal, isAsset };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Links;

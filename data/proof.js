'use strict';

// ============================================================
// Delivery report — one grade, one page, every audit in one place.
// ------------------------------------------------------------
// Six audits now measure an export: performance, keyboard access, links and
// anchors, images, copy clarity, and the manifest. Each reports inside Studio,
// which is right for fixing things and wrong for handing over: an agency
// cannot email a modal.
//
// So they are fused into one score and one printable page. The weighting is
// stated rather than hidden, because a composite number nobody can decompose
// is a number nobody should quote:
//
//   performance 30 · keyboard 25 · links 20 · images 10 · copy 10 · manifest 5
//
// The page is deliberately plain, single-file and print-first: it is read by a
// client, forwarded to a marketing manager, and occasionally printed and put
// in a file. It never exposes Studio internals — no file paths, no source, no
// revision ids.
//
// Pure and offline.
// ============================================================

const Proof = (() => {

  const WEIGHTS = { performance: 27, keyboard: 22, links: 18, images: 9, copy: 9, manifest: 4, aiSearch: 11 };
  const LABELS = {
    performance: 'Performance',
    keyboard: 'Keyboard & screen readers',
    links: 'Links, anchors and assets',
    images: 'Images',
    copy: 'Copy clarity',
    manifest: 'Integrity',
    aiSearch: 'AI answer visibility'
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const letterOf = (score) => (score >= 95 ? 'A+' : score >= 88 ? 'A' : score >= 78 ? 'B' : score >= 66 ? 'C' : score >= 50 ? 'D' : 'F');
  const toneOf = (letter) => (['A+', 'A', 'B'].includes(letter) ? 'good' : letter === 'C' ? 'ok' : 'bad');

  // ---- composite ------------------------------------------------------------
  // An absent audit is removed from the weighting rather than scored zero:
  // a project with no images should not be marked down for having none.
  function grade(audits) {
    const a = audits || {};
    const parts = [];
    let weight = 0;
    Object.keys(WEIGHTS).forEach((key) => {
      const found = a[key];
      if (!found || typeof found.score !== 'number') return;
      parts.push({ key: key, label: LABELS[key], score: found.score, letter: found.letter || letterOf(found.score), weight: WEIGHTS[key] });
      weight += WEIGHTS[key];
    });
    const total = weight ? Math.round(parts.reduce((n, p) => n + p.score * (p.weight / weight), 0)) : 0;
    return {
      score: total,
      letter: letterOf(total),
      parts: parts,
      weight: weight,
      full: weight === 100,
      summary: parts.length
        ? parts.length + ' audits, weighted ' + parts.map((p) => p.label + ' ' + p.weight).join(' · ')
        : 'Nothing to report yet.'
    };
  }

  // The single sentence that goes at the top of the report. Written to be
  // true at every score rather than reassuring at all of them.
  function headline(g) {
    if (!g.parts.length) return 'Nothing measured yet.';
    if (g.score >= 95) return 'This site is ready to hand over.';
    if (g.score >= 88) return 'This site is in good shape, with a couple of things worth knowing.';
    if (g.score >= 78) return 'This site is solid, with a few items worth a look.';
    if (g.score >= 66) return 'This site works, but some items should be addressed before launch.';
    return 'This site needs attention before it goes in front of visitors.';
  }

  // ---- findings -------------------------------------------------------------
  // Flatten every audit's findings into one list, worst first, so a reader
  // does not have to know which audit produced what.
  const RANK = { error: 0, warn: 1, info: 2 };
  function findings(audits) {
    const a = audits || {};
    const out = [];
    Object.keys(LABELS).forEach((key) => {
      const found = a[key];
      if (!found) return;
      // Audits differ in shape: some carry `findings`, some `pages[].findings`.
      const own = Array.isArray(found.findings) ? found.findings.slice() : [];
      if (Array.isArray(found.pages)) {
        found.pages.forEach((p) => {
          (p.findings || []).forEach((f) => own.push(Object.assign({}, f, { page: f.page || p.page })));
        });
      }
      const seen = {};
      own.forEach((f) => {
        const text = String(f.msg || '');
        if (!text) return;
        const k = String(f.level) + '|' + text;
        if (seen[k]) return;
        seen[k] = true;
        out.push({ level: f.level || 'info', area: LABELS[key], msg: text, fix: f.fix || '', page: f.page || '' });
      });
    });
    return out.sort((x, y) => (RANK[x.level] ?? 3) - (RANK[y.level] ?? 3));
  }

  function counts(list) {
    return {
      errors: list.filter((f) => f.level === 'error').length,
      warnings: list.filter((f) => f.level === 'warn').length,
      notes: list.filter((f) => f.level === 'info').length
    };
  }

  // ---- the page -------------------------------------------------------------
  const CSS = [
    '*{box-sizing:border-box}',
    'body{margin:0;background:#f6f7fb;color:#111827;font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}',
    '.wrap{max-width:860px;margin:0 auto;padding:48px 24px 72px}',
    'header.rp{border-bottom:1px solid #e5e7eb;padding-bottom:28px;margin-bottom:32px}',
    '.kicker{letter-spacing:.1em;text-transform:uppercase;font-size:12px;font-weight:700;color:#6b7280}',
    'h1{font-size:34px;line-height:1.2;margin:10px 0 6px;letter-spacing:-.02em}',
    'h2{font-size:19px;margin:36px 0 12px;letter-spacing:-.01em}',
    '.lede{color:#4b5563;margin:0}',
    '.grade{display:flex;align-items:center;gap:20px;margin:28px 0 0}',
    '.badge{width:84px;height:84px;border-radius:22px;display:grid;place-items:center;font-size:30px;font-weight:800;color:#fff;flex:none}',
    '.badge.good{background:linear-gradient(135deg,#22c55e,#15803d)}',
    '.badge.ok{background:linear-gradient(135deg,#eab308,#ca8a04)}',
    '.badge.bad{background:linear-gradient(135deg,#ef4444,#b91c1c)}',
    '.grade b{font-size:22px}',
    'table{width:100%;border-collapse:collapse;margin-top:8px;font-size:15px}',
    'th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top}',
    'th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280}',
    'td.n{text-align:right;font-variant-numeric:tabular-nums}',
    '.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700}',
    '.pill.good{background:#dcfce7;color:#166534}',
    '.pill.ok{background:#fef9c3;color:#854d0e}',
    '.pill.bad{background:#fee2e2;color:#991b1b}',
    '.item{padding:12px 0;border-bottom:1px solid #eef1f5}',
    '.item .area{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280}',
    '.item .msg{display:block;margin-top:2px}',
    '.item .fix{display:block;color:#4b5563;font-size:14px;margin-top:2px}',
    '.clear{padding:14px 0;color:#166534;font-weight:600}',
    'footer.rp{margin-top:44px;padding-top:20px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px}',
    '@media print{body{background:#fff}.wrap{padding:0 0 24px}.badge{-webkit-print-color-adjust:exact;print-color-adjust:exact}.item,.rel{break-inside:avoid}header.rp{margin-bottom:20px}}'
  ].join('');

  function html(opts) {
    const o = opts || {};
    const site = (o.project && o.project.site) || {};
    const g = o.grade || grade(o.audits);
    const list = findings(o.audits);
    const c = counts(list);
    const tone = toneOf(g.letter);
    const when = o.generatedAt ? new Date(o.generatedAt) : new Date();
    const stamp = o.stamp ? String(o.stamp) : '';

    const rows = g.parts.map((p) => [
      '<tr>',
      '<td>' + esc(p.label) + '</td>',
      '<td class="n">' + p.score + '/100</td>',
      '<td><span class="pill ' + toneOf(p.letter) + '">' + esc(p.letter) + '</span></td>',
      '<td class="n">' + p.weight + '%</td>',
      '</tr>'
    ].join('')).join('');

    const items = list.length
      ? list.map((f) => [
        '<div class="item">',
        '<span class="area">' + esc(f.area) + (f.page ? ' · ' + esc(f.page) : '') + '</span>',
        '<span class="msg">' + esc(f.msg) + '</span>',
        f.fix ? '<span class="fix">' + esc(f.fix) + '</span>' : '',
        '</div>'
      ].join('')).join('')
      : '<div class="clear">No issues found in any audit. Everything measured passes.</div>';

    const files = (o.manifest && Array.isArray(o.manifest.files)) ? o.manifest.files : [];
    const fileRows = files.length
      ? files.map((f) => '<tr><td>' + esc(f.name) + '</td><td class="n">' + (f.bytes >= 1024 ? (f.bytes / 1024).toFixed(1) + ' KB' : f.bytes + ' B') + '</td><td class="n" style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px">' + esc(String(f.sha256 || '').slice(0, 12)) + '…</td></tr>').join('')
      : '';

    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="robots" content="noindex, nofollow">',
      '<title>Delivery report — ' + esc(site.name || 'site') + '</title>',
      '<style>' + CSS + '</style>',
      '</head>',
      '<body>',
      '<div class="wrap">',
      '<header class="rp">',
      '<div class="kicker">Delivery report</div>',
      '<h1>' + esc(site.name || 'Untitled site') + '</h1>',
      '<p class="lede">' + esc(headline(g)) + ' Prepared ' + when.toISOString().slice(0, 10) + (stamp ? ' · build ' + esc(stamp.slice(0, 12)) : '') + '.</p>',
      '<div class="grade">',
      '<div class="badge ' + tone + '">' + esc(g.letter) + '</div>',
      '<div><b>' + g.score + '/100 overall</b><br><span style="color:#4b5563">' + esc(g.summary) + '</span></div>',
      '</div>',
      '</header>',
      '<h2>What was measured</h2>',
      '<table><thead><tr><th>Audit</th><th class="n">Score</th><th>Grade</th><th class="n">Weight</th></tr></thead><tbody>' + rows + '</tbody></table>',
      '<h2>Findings</h2>',
      '<p class="lede">' + c.errors + ' to fix · ' + c.warnings + ' worth improving · ' + c.notes + ' for information.</p>',
      items,
      '<h2>What you received</h2>',
      fileRows
        ? '<table><thead><tr><th>File</th><th class="n">Size</th><th class="n">SHA-256</th></tr></thead><tbody>' + fileRows + '</tbody></table><p class="lede" style="margin-top:10px">Every file is listed with its checksum. The same list travels in <code>pallettai-export.json</code>, so anyone can confirm a copy is unaltered.</p>'
        : '<p class="lede">No manifest was recorded for this export.</p>',
      '<footer class="rp">Generated by PallettAi Studio' + (o.version ? ' ' + esc(o.version) : '') + '. This report describes the export as it was built; it is not a warranty of how a host serves it.</footer>',
      '</div>',
      '</body>',
      '</html>',
      ''
    ].join('\n');
  }

  function files(opts) {
    return [{ name: 'delivery-report.html', content: html(opts) }];
  }

  return { WEIGHTS, LABELS, grade, headline, findings, counts, html, files, letterOf, toneOf };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Proof;

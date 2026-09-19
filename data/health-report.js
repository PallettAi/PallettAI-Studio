// ============================================================
// PallettAI Studio — monthly site-health digest (pure logic)
// The retainer product behind Site Care ▸ "Monthly digest".
//
// CareReport speaks to ONE client about ONE site. The digest is
// the studio's own monthly instrument: every site under care,
// one row each, what went stale, what changed, and what to do
// next — the document a studio prices a retainer from and the
// email their client list actually opens.
//
// Rules it inherits from CareReport:
//   1. TRUE — every verdict traces to the SiteCare audit the
//      studio already saw. Nothing estimated, nothing softened.
//   2. SELF-CONTAINED — one HTML file, no network, prints to PDF.
//   3. THE STUDIO'S DOCUMENT — their name, their accent; PallettAI
//      appears in an HTML comment only.
//
// Pure logic: takes audit shapes and returns strings + a model.
// ============================================================

'use strict';

const HealthReport = (() => {
  const KIND = 'pallettai-health-digest';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function monthLabel(month) {
    // month: 'YYYY-MM' (already local). Unknown → 'This month'.
    const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    if (!m) return 'This month';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, 1);
    return isNaN(d) ? 'This month' : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  // Verdict per project, from the audit the studio already saw.
  //   ok        — nothing stale found
  //   attention — findings exist; the studio should act this month
  //   stale     — findings were already reported last month and are unchanged
  function verdictFor(row) {
    const findings = (row && Array.isArray(row.findings)) ? row.findings : [];
    if (!findings.length) return 'ok';
    if (row && row.previouslyReported && row.unchanged) return 'stale';
    return 'attention';
  }

  const VERDICT_LABEL = { ok: 'Healthy', attention: 'Needs attention', stale: 'Still outstanding' };
  const VERDICT_ORDER = { attention: 0, stale: 1, ok: 2 };

  function build(input) {
    const i = input || {};
    const rowsIn = Array.isArray(i.projects) ? i.projects : [];
    const rows = rowsIn.map((p) => {
      const findings = (Array.isArray(p.findings) ? p.findings : [])
        .map((f) => ({
          area: String((f && f.area) || 'general').slice(0, 40),
          label: String((f && f.label) || (f && f.area) || 'Finding').slice(0, 120),
          detail: String((f && f.detail) || '').slice(0, 200)
        }))
        .slice(0, 8);
      const v = verdictFor(p);
      return {
        id: String(p.id || '').slice(0, 80),
        name: String(p.name || 'Untitled site').slice(0, 120),
        client: String(p.client || '').slice(0, 120),
        plan: p.plan === 'monthly' ? 'monthly' : 'none',
        changed: Array.isArray(p.changes) ? p.changes.map((c) => String(c || '').slice(0, 120)).slice(0, 6) : [],
        findings,
        verdict: v,
        verdictLabel: VERDICT_LABEL[v]
      };
    }).sort((a, b) =>
      (VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict]) ||
      a.name.localeCompare(b.name));

    const attention = rows.filter((r) => r.verdict === 'attention').length;
    const stale = rows.filter((r) => r.verdict === 'stale').length;
    const healthy = rows.filter((r) => r.verdict === 'ok').length;
    const onRetainer = rows.filter((r) => r.plan === 'monthly').length;
    // Retainer math is the studio's own input — a per-site monthly rate they
    // set. The digest never invents a price; it only multiplies what it's given.
    const rate = Number.isFinite(i.monthlyRate) && i.monthlyRate > 0 ? i.monthlyRate : 0;
    const retainerValue = onRetainer * rate;

    return {
      kind: KIND,
      month: String(i.month || ''),
      monthLabel: monthLabel(i.month),
      studioName: String(i.studioName || '').slice(0, 120),
      rows,
      summary: { total: rows.length, healthy, attention, stale, onRetainer, retainerValue }
    };
  }

  function fileName(model) {
    const m = /^(\d{4})-(\d{2})$/.exec(String((model && model.month) || ''));
    const stamp = m ? m[1] + '-' + m[2] : String(Date.now()).slice(0, 10);
    return 'site-health-' + stamp + '.html';
  }

  function page(model, opts) {
    const m = model || {};
    const o = opts || {};
    const accent = /^#[0-9a-fA-F]{6}$/.test(o.accent || '') ? o.accent : '#0d7a4f';
    const rowsHtml = m.rows.map((r) => {
      const chips = r.findings.length
        ? r.findings.map((f) => '<span class="chip">' + esc(f.label) + '</span>').join('')
        : '<span class="chip ok">Nothing stale found</span>';
      const changes = r.changed.length
        ? '<div class="changes"><b>Changed this month:</b> ' + r.changed.map(esc).join(' · ') + '</div>'
        : '';
      return '<tr><td><div class="pname">' + esc(r.name) + '</div>' +
        (r.client ? '<div class="pclient">for ' + esc(r.client) + '</div>' : '') +
        '<div class="v ' + r.verdict + '">' + esc(r.verdictLabel) + '</div></td>' +
        '<td><div class="chips">' + chips + '</div>' + changes + '</td></tr>';
    }).join('');

    const s = m.summary || { total: 0, healthy: 0, attention: 0, stale: 0, onRetainer: 0, retainerValue: 0 };
    const stat = (n, label) => '<div class="stat"><b>' + esc(String(n)) + '</b><span>' + esc(label) + '</span></div>';

    return '<!doctype html>\n<!-- Built with PallettAI Studio — monthly site-health digest (not client-facing) -->\n' +
      '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>' + esc((m.studioName || 'Studio') + ' — site health, ' + (m.monthLabel || '')) + '</title><style>' +
      'body{margin:0;background:#f5f8fc;color:#0b1c30;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
      '.wrap{max-width:860px;margin:0 auto;padding:34px 22px}' +
      'h1{font-size:21px;margin:0 0 2px}h1 small{display:block;font-size:12.5px;font-weight:500;color:#5b7089;margin-top:3px}' +
      '.stats{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 6px}' +
      '.stat{background:#fff;border:1px solid #e2ebf5;border-radius:12px;padding:10px 16px;min-width:92px}' +
      '.stat b{display:block;font-size:20px}.stat span{font-size:11.5px;color:#5b7089;text-transform:uppercase;letter-spacing:.06em}' +
      'table{width:100%;border-collapse:collapse;margin-top:14px;background:#fff;border:1px solid #e2ebf5;border-radius:12px;overflow:hidden}' +
      'td{padding:13px 14px;border-top:1px solid #eef3f9;vertical-align:top;width:50%}' +
      'tr:first-child td{border-top:0}.pname{font-weight:700}.pclient{color:#5b7089;font-size:12.5px;margin-top:1px}' +
      '.v{display:inline-block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-radius:999px;padding:2px 9px;margin-top:7px}' +
      '.v.ok{background:#e5f5ec;color:#0d7a4f}.v.attention{background:#fdeeea;color:#a02c2c}.v.stale{background:#fdf4e3;color:#8a6116}' +
      '.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:12px;background:#f2f6fb;border:1px solid #e2ebf5;border-radius:999px;padding:2px 9px;color:#22374e}' +
      '.chip.ok{background:#e5f5ec;border-color:#cdeada;color:#0d7a4f}' +
      '.changes{margin-top:8px;font-size:12.5px;color:#5b7089}.changes b{color:#22374e}' +
      '.foot{margin-top:18px;color:#8296ad;font-size:12px}' +
      '</style></head><body><div class="wrap">' +
      '<h1>' + esc(m.studioName || 'Studio') + ' — site health' +
      '<small>' + esc(m.monthLabel || '') + ' · a private working document for the studio, not a client deliverable</small></h1>' +
      '<div class="stats">' + stat(s.total, 'sites under care') + stat(s.healthy, 'healthy') + stat(s.attention, 'needs attention') + stat(s.stale, 'still outstanding') + stat(s.onRetainer, 'on retainer') +
      (s.retainerValue > 0 ? stat(s.retainerValue, 'monthly retainer value') : '') + '</div>' +
      (m.rows.length
        ? '<table>' + rowsHtml + '</table>'
        : '<p class="foot">No sites yet — run Site Care on a project and it will appear here.</p>') +
      '<p class="foot">Verdicts come from the same Site Care audit shown in the studio — nothing is estimated and nothing is softened. Sites marked “needs attention” have findings you have not reported before; “still outstanding” repeats last month’s findings, unchanged.</p>' +
      '</div></body></html>';
  }

  return { KIND, build, page, fileName, monthLabel, verdictFor, VERDICT_LABEL };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = HealthReport;

/*
  Wrapped in an IIFE: this loads as a classic script, so a top-level `const`
  here would share one global scope with every other script on the page, and a
  duplicate name is either a SyntaxError for the whole file or a silent
  overwrite of somebody else's function.
*/
(function () {
'use strict';

/*
  ============================================================
  CareReport — the site care report a CLIENT receives
  ------------------------------------------------------------
  Site Care reads a project and tells the studio what has gone
  stale. That is an internal alarm, and it only answers a
  question the studio can act on.

  A client is a different reader with a different question. They
  are not asking "is anything stale?" — they paid for a site and
  want to know it is being looked after, and a maintenance
  retainer is decided from whatever arrives in their inbox. So
  this document has three jobs, and each of them is a rule:

    1. IT HAS TO BE TRUE. Every number is read from the audit the
       studio was already shown: nothing is estimated, nothing is
       softened, and the checks that found NOTHING are listed
       beside the ones that found something. A report that only
       lists problems reads as a bill; a report that lists what
       was looked at reads as work — and only the second one is
       worth sending.

    2. IT HAS TO BE SELF-CONTAINED. One .html file: no network
       fonts, no scripts, no images fetched from anywhere. It
       opens from a downloads folder on a phone and prints to PDF
       from any browser. A report that needs instructions for
       opening it is not a deliverable.

    3. IT HAS TO BE THE STUDIO'S DOCUMENT, NOT OURS. Their name,
       their accent colour, their reply-to. PallettAI appears in
       an HTML comment and nowhere a client will look.

  Pure logic, like ChangeNote: takes plain inputs, returns
  strings and a model. app.js assembles the input from
  SiteCare.audit; the smoke test calls it directly.
  ============================================================ */

const KIND = 'pallettai-care-report';

/*
  What SiteCare looks for, in the order a client would care about.

  Keys are SiteCare's own `area` values. The `note` is written for the client —
  it says what was looked at and why it matters, not what the check is called.
  An area in an audit that this table does not know is still reported, under its
  own name, rather than being dropped from a document that claims to be a full
  account of the work.
*/
const AREAS = [
  { id: 'placeholder', label: 'Placeholder copy', note: 'Wording like “lorem ipsum” or “your text here” that was written as a placeholder and shipped as the real thing.' },
  { id: 'demo', label: 'Sample contact details', note: 'Example addresses, 555 phone numbers and sample street addresses — the details a site publishes by accident, so enquiries go nowhere.' },
  { id: 'expired', label: 'Dates that have passed', note: 'A section dated with a date that is now in the past, which makes the whole page read as out of date.' },
  { id: 'stale', label: 'Prices beside an old year', note: 'A price quoted next to a year that has gone — to a visitor this reads as an offer that expired.' },
  { id: 'template', label: 'Sections running on samples', note: 'A section with none of your own items in it yet, so the published page fills it with template examples visitors cannot tell apart from real content.' },
  { id: 'empty', label: 'Empty sections', note: 'A block with nothing in it at all. In a browser it reads as a broken page.' },
  { id: 'alt', label: 'Images without a description', note: 'The words a screen reader reads aloud, and what search engines index instead of the picture.' },
  { id: 'deadlink', label: 'Links going nowhere', note: 'Buttons and menu items with no destination, which do nothing when a visitor clicks them.' }
];

const LEVELS = [
  { id: 'error', label: 'Needs attention now', blurb: 'These make the site read as unfinished. They are the first thing to put right.' },
  { id: 'warn', label: 'Worth a look', blurb: 'Nothing here is broken. Each one is a place where the site still says something it no longer means.' },
  { id: 'info', label: 'Notes', blurb: 'Small improvements. None of them hold anything up.' }
];

// The paper palette. The client's own accent replaces the blue only when it can
// actually be read as a heading on white — see pickAccent.
const PAPER = { ink: '#131a24', muted: '#5b6879', line: '#e2e8f0', wash: '#f6f9fc', accent: '#2f7dc4' };
const MAX_LINES = 60;

const esc = (v) => String(v === null || v === undefined ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const clip = (v, n) => String(v === null || v === undefined ? '' : v)
  .replace(/\s+/g, ' ').trim().slice(0, n);

function hexOf(raw) {
  const m = String(raw === null || raw === undefined ? '' : raw).trim().toLowerCase().match(/^#?([0-9a-f]{6})$/);
  return m ? '#' + m[1] : '';
}

function luminance(hex) {
  const h = hexOf(hex);
  if (!h) return 0;
  const parts = [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

/*
  A brand colour is only used here when it reads as ink on white.

  Every palette in the studio has a lovely accent, and several of them — cream,
  pale mint, light gold — are invisible at heading size on paper. Falling back
  to a blue is a smaller failure than a report whose headings and grade vanish,
  and the fallback is stated in the suite so it cannot be quietly changed.
*/
function pickAccent(raw) {
  const h = hexOf(raw);
  if (!h) return PAPER.accent;
  return luminance(h) <= 0.45 ? h : PAPER.accent;
}

// White or near-black, whichever can be read on the accent fill.
function onAccent(hex) {
  return luminance(hex) > 0.35 ? PAPER.ink : '#ffffff';
}

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const longDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function slugify(s) {
  const out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out.slice(0, 60) || 'site';
}

/*
  Where a finding lives, in the words a client uses.

  SiteCare reports `where` as a page name and a section, and either can be
  missing — a finding about the site's own email has no location at all. A blank
  location is printed as nothing rather than as "( )".
*/
function placeOf(finding) {
  const at = (finding && finding.where) || {};
  const page = clip(at.pageName || at.page, 60);
  const type = clip(at.sectionType, 40);
  const no = Number(at.sectionNo);
  const bits = [];
  if (page) bits.push(page);
  if (type) bits.push(type + (Number.isFinite(no) && no > 0 ? ' ' + no : ''));
  return bits.join(' · ');
}

/*
  Every check that was run, with what it found.

  The zero rows are the point: "Sample contact details — nothing found" is the
  sentence that makes a retainer worth paying, and it costs one table row.
*/
function checksOf(report) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const counts = Object.create(null);
  findings.forEach((f) => {
    const id = clip(f && f.area, 40) || 'other';
    counts[id] = (counts[id] || 0) + 1;
  });
  const rows = AREAS.map((a) => ({
    id: a.id, label: a.label, note: a.note,
    count: counts[a.id] || 0,
    state: counts[a.id] ? 'found' : 'clear'
  }));
  Object.keys(counts).forEach((id) => {
    if (AREAS.some((a) => a.id === id)) return;
    rows.push({
      id, label: 'Further checks (' + id + ')', note: 'Recorded by the audit under a name this report does not have wording for yet. The count is the audit\'s own.',
      count: counts[id], state: 'found'
    });
  });
  return rows;
}

// The groups of findings, severest first, with the empty ones dropped — a
// heading with nothing under it reads as a mistake rather than as good news.
function groupsOf(report) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  return LEVELS.map((lv) => ({
    key: lv.id, label: lv.label, blurb: lv.blurb,
    items: findings.filter((f) => f && f.level === lv.id).map((f) => ({
      text: clip(f.msg, 300),
      fix: clip(f.fix, 300),
      where: placeOf(f)
    }))
  })).filter((g) => g.items.length);
}

/*
  The arithmetic, shown.

  A grade with no working is a number the client has to take on trust, and this
  document's whole job is to be trusted. The weights come from the audit's own
  table, so a change to the scoring can never leave the explanation behind.
*/
function scoreOf(report) {
  const weight = (report && report.weight && typeof report.weight === 'object') ? report.weight : { error: 12, warn: 5, info: 2 };
  const counts = (report && report.counts) || {};
  const score = Math.max(0, Number(report && report.score) || 0);
  const nouns = { error: 'unfinished item', warn: 'item worth a look', info: 'note' };
  const rows = [];
  let sum = 0;
  ['error', 'warn', 'info'].forEach((level) => {
    const n = Math.max(0, Number(counts[level]) || 0);
    const points = Number(weight[level]) || 0;
    if (!n) return;
    sum += n * points;
    rows.push({
      label: n + ' ' + nouns[level] + (n === 1 ? '' : 's'),
      math: n + ' × ' + points,
      points: n * points
    });
  });
  // The score is clamped at zero, so a site with enough unfinished copy can
  // carry a raw penalty larger than 100. Printing a sum of 126 beside a score of
  // 0 would look like bad arithmetic in the one document that must not contain
  // any, so the capping is stated rather than left to the reader.
  const clamped = sum > 100;
  return { score: score, letter: clip(report && report.letter, 4) || '—', rows: rows, penalty: clamped ? 100 : sum, clamped: clamped && rows.length > 0 };
}

function cadence(days) {
  const d = Number(days) || 0;
  if (d <= 14) return 'Because the site carries dated content, it will be out of date again within a fortnight.';
  if (d <= 30) return 'Because there are unfinished items on the site now, and they are the fastest thing to go wrong.';
  if (d <= 90) return 'Because nothing here is urgent, but prices, dates and offers drift every few months on a site like this.';
  return 'Because nothing on the site is time-sensitive, a look twice a year is enough to keep it true.';
}

const SCOPE = 'This report is about whether the site still says what it means. It reads the site\'s own words, dates, prices, links and image descriptions. It does not measure how fast pages load, how they look on a phone, whether the domain and hosting are healthy, how the site ranks in search, or how it behaves in every browser — those need a different set of tools, and we will say so rather than guess.';

/*
  build() — the whole report, as a model and as words.

  input: {
    report,            // SiteCare.audit() output, unchanged
    project,           // the project it came from (for its name)
    brand,             // { accent } from the site's own palette, or nothing
    studio,            // { name, email } — the reply-to on the document
    portfolio,         // { total, flagged } when the studio looks after others
    now                // ms, injected so the test can pin a date
  }
*/
function build(input) {
  const i = input || {};
  const report = i.report;
  if (!report || typeof report !== 'object' || !Array.isArray(report.findings)) {
    return { ok: false, error: 'There is no site audit to report on — run Site Care on a project first.', html: '', text: '' };
  }

  const at = new Date(Number(i.now) || Date.now());
  const site = clip(report.title || (i.project && i.project.name) || 'this site', 120);
  const studio = i.studio || {};
  const studioName = clip(studio.name, 80);
  const studioEmail = clip(studio.email, 120);
  const accent = pickAccent(i.brand && (i.brand.accent || i.brand.primary));
  const checks = checksOf(report);
  const groups = groupsOf(report);
  const scoring = scoreOf(report);
  const counts = (report && report.counts) || { error: 0, warn: 0, info: 0 };
  const findings = report.findings;

  const totals = {
    findings: findings.length,
    errors: Number(counts.error) || 0,
    warns: Number(counts.warn) || 0,
    notes: Number(counts.info) || 0,
    pages: Number(report.pages) || 0,
    sections: Number(report.sections) || 0,
    imagesMissingAlt: Number(report.imagesMissingAlt) || 0,
    checksRun: checks.length,
    checksClear: checks.filter((c) => c.state === 'clear').length,
    score: scoring.score,
    letter: scoring.letter,
    reviewBy: clip(report.reviewBy, 20),
    reviewDays: Number(report.reviewDays) || 0
  };

  const headline = totals.findings
    ? (totals.errors
      ? totals.errors + ' item' + (totals.errors === 1 ? ' needs' : 's need') + ' attention before anything else.'
      : 'Nothing unfinished, but ' + totals.warns + ' item' + (totals.warns === 1 ? ' is' : 's are') + ' worth a look.')
    : 'Nothing on the site has gone stale.';

  const subject = 'Site care report — ' + site + ' — ' + longDate(at);

  /*
    The plain-text version, because the first thing most studios do with a
    report is paste the list into an email rather than attach it. Same numbers,
    same order, same findings — a text version that disagreed with the
    attachment would be worse than no text version at all.

    The body can be cut to keep an email readable; the closing section never is,
    and a cut is stated in the text rather than being silent.
  */
  let body = [
    site,
    'Site care report · ' + longDate(at),
    '',
    scoring.letter + ' (' + totals.score + '/100) — ' + headline,
    '',
    clip(report.summary, 600),
    '',
    'WHAT WE LOOKED AT (' + totals.checksRun + ' checks over ' + totals.pages + ' page' + (totals.pages === 1 ? '' : 's') + ', ' + totals.sections + ' section' + (totals.sections === 1 ? '' : 's') + ')',
    ''
  ].concat(checks.map((c) => '  • ' + c.label + ' — ' + (c.count ? c.count + ' found' : 'nothing found')));

  groups.forEach((g) => {
    body = body.concat(['', g.label.toUpperCase() + ' (' + g.items.length + ')', '']).concat(
      g.items.map((it) => '  • ' + it.text + (it.where ? '  [' + it.where + ']' : '') + (it.fix ? '\n    Fix: ' + it.fix : ''))
    );
  });

  body = body.concat([
    '',
    'HOW THE SCORE IS REACHED',
    '  100 starting score'
  ]).concat(scoring.rows.map((r) => '  − ' + r.math + '  (' + r.label + ')'))
    .concat(['  = ' + totals.score + '/100']);

  const cut = body.length > MAX_LINES ? body.length - MAX_LINES : 0;
  if (cut) body = body.slice(0, MAX_LINES);

  const text = body.concat([
    cut ? '' : null,
    cut ? '(' + cut + ' further lines are not in this plain-text version — the attached report has every item.)' : null,
    '',
    'NEXT REVIEW: ' + (totals.reviewBy || 'not set'),
    cadence(totals.reviewDays),
    '',
    'WHAT THIS REPORT DOES NOT COVER',
    SCOPE,
    '',
    (studioName ? 'Prepared by ' + studioName : 'Prepared by your studio') + (studioEmail ? ' · ' + studioEmail : '')
  ].filter((l) => l !== null));

  // The grade is floated first so it sits beside the site name rather than
  // drifting down beside the third paragraph — a document's headline number
  // belongs on its headline.
  const html = [
    '<div class="grade" style="--a:' + esc(accent) + ';--on:' + esc(onAccent(accent)) + '">'
      + '<b>' + esc(totals.letter) + '</b><span>' + esc(totals.score) + '/100</span></div>',
    '<h1>' + esc(site) + '</h1>',
    '<p class="lede">' + esc(headline) + '</p>',
    '<p class="summary">' + esc(clip(report.summary, 600)) + '</p>',
    '<h2>What we looked at</h2>',
    '<p class="note">' + esc(totals.checksRun + ' checks over ' + totals.pages + ' page' + (totals.pages === 1 ? '' : 's')
      + ' and ' + totals.sections + ' section' + (totals.sections === 1 ? '' : 's') + '. '
      + totals.checksClear + ' of the ' + totals.checksRun + ' found nothing.') + '</p>',
    '<table class="checks"><tbody>' + checks.map((c) => '<tr>'
      + '<th><b>' + esc(c.label) + '</b><span>' + esc(c.note) + '</span></th>'
      + '<td class="' + (c.state === 'clear' ? 'clear' : 'found') + '">' + esc(c.count ? c.count + ' found' : 'Nothing found') + '</td>'
      + '</tr>').join('') + '</tbody></table>'
  ].concat(groups.map((g) => '<h2>' + esc(g.label) + ' <span class="count">' + g.items.length + '</span></h2>'
    + '<p class="note">' + esc(g.blurb) + '</p>'
    + '<ul class="findings">' + g.items.map((it) => '<li>'
      + '<b>' + esc(it.text) + '</b>'
      + (it.where ? '<span class="where">' + esc(it.where) + '</span>' : '')
      + (it.fix ? '<span class="fix">' + esc(it.fix) + '</span>' : '')
      + '</li>').join('') + '</ul>'))
    .concat([
      '<h2>How the score is reached</h2>',
      '<table class="score"><tbody>',
      '<tr><td>Starting score</td><td class="num">100</td></tr>',
      scoring.rows.map((r) => '<tr><td>' + esc(r.label) + ' <em>' + esc(r.math) + '</em></td><td class="num">−' + esc(r.points) + '</td></tr>').join(''),
      '<tr class="total"><td>Score</td><td class="num">' + esc(totals.score) + '</td></tr>',
      '</tbody></table>',
      scoring.clamped ? '<p class="note">The total penalty is capped: at this many unfinished items the score cannot go below zero.</p>' : '',
      '<h2>Next review</h2>',
      '<p class="note"><b>' + esc(totals.reviewBy || 'Not set') + '</b> — ' + esc(cadence(totals.reviewDays)) + '</p>',
      '<h2>What this report does not cover</h2>',
      '<p class="note">' + esc(SCOPE) + '</p>',
      '<div class="sign">'
        + '<b>' + esc(studioName || 'Prepared by your studio') + '</b>'
        + (studioEmail ? '<span>' + esc(studioEmail) + '</span>' : '')
        + '</div>'
    ]);

  return {
    ok: true,
    error: '',
    kind: KIND,
    site: site,
    subject: subject,
    at: at.toISOString(),
    dateText: longDate(at),
    accent: accent,
    studioName: studioName,
    studioEmail: studioEmail,
    portfolio: i.portfolio && typeof i.portfolio === 'object'
      ? { total: Number(i.portfolio.total) || 0, flagged: Number(i.portfolio.flagged) || 0 }
      : null,
    totals: totals,
    checks: checks,
    groups: groups,
    scoring: scoring,
    headline: headline,
    html: html.filter(Boolean).join('\n'),
    text: text.join('\n').trim()
  };
}

/*
  The standalone document.

  One file, no network anything: the styles are inline, there is no script, and
  there is no image tag. That is not a size optimisation — it is what makes the
  file open on a client's phone from an email attachment with no signals and no
  fonts to wait for.
*/
function page(note, opts) {
  const n = note || {};
  const o = opts || {};
  const accent = hexOf(o.accent) ? o.accent : (hexOf(n.accent) ? n.accent : PAPER.accent);
  const on = onAccent(accent);
  const css = [
    ':root{--ink:' + PAPER.ink + ';--mut:' + PAPER.muted + ';--line:' + PAPER.line + ';--wash:' + PAPER.wash + ';--a:' + accent + ';--on:' + on + '}',
    '*{box-sizing:border-box}',
    'body{margin:0;background:#eef2f7;color:var(--ink);font:16px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}',
    'main{max-width:780px;margin:0 auto;background:#fff;padding:44px 46px 56px}',
    'h1{font-size:1.95rem;line-height:1.15;letter-spacing:-.02em;margin:0 0 6px}',
    '.kicker{font-size:.7rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--a);margin:0 0 14px}',
    '.lede{font-size:1.06rem;color:var(--ink);margin:14px 0 0}',
    '.summary{color:var(--mut);margin:10px 0 0}',
    'h2{font-size:.76rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--a);margin:38px 0 8px;border-top:1px solid var(--line);padding-top:18px}',
    'h2 .count{color:var(--mut);letter-spacing:0}',
    '.note{color:var(--mut);font-size:.9rem;margin:0 0 12px}',
    '.grade{float:right;margin:0 0 8px 18px;width:92px;height:92px;border-radius:16px;background:var(--a);color:var(--on);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}',
    '.grade b{font-size:2rem;line-height:1}',
    '.grade span{font-size:.74rem;opacity:.85;margin-top:4px}',
    'table{border-collapse:collapse;width:100%;font-size:.92rem}',
    'th,td{text-align:left;vertical-align:top;padding:9px 0;border-bottom:1px solid var(--line);font-weight:400}',
    '.checks th b{display:block;font-weight:600}',
    '.checks th span{display:block;color:var(--mut);font-size:.84rem;margin-top:3px;max-width:56ch}',
    '.checks td{width:110px;text-align:right;white-space:nowrap;font-weight:600;font-size:.82rem}',
    '.checks td.clear{color:#1d7f5f}',
    '.checks td.found{color:#b4541b}',
    '.findings{list-style:none;margin:0;padding:0}',
    '.findings li{padding:11px 0;border-bottom:1px solid var(--line)}',
    '.findings b{display:block;font-weight:600}',
    '.findings .where{display:block;color:var(--mut);font-size:.8rem;margin-top:4px}',
    '.findings .fix{display:block;color:var(--mut);font-size:.88rem;margin-top:5px}',
    '.findings .fix:before{content:"Fix: ";color:var(--ink);font-weight:600}',
    '.score .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.score em{color:var(--mut);font-style:normal}',
    '.score .total td{border-bottom:none;border-top:2px solid var(--ink);font-weight:700}',
    '.sign{margin-top:40px;border-top:1px solid var(--line);padding-top:16px;font-size:.92rem}',
    '.sign b{display:block}',
    '.sign span{color:var(--mut)}',
    '.fine{color:var(--mut);font-size:.78rem;margin-top:10px}',
    '@media (max-width:620px){main{padding:26px 20px 40px}.grade{float:none;margin:0 0 16px}}',
    '@page{size:A4;margin:15mm}',
    '@media print{body{background:#fff}main{max-width:none;padding:0}.grade{-webkit-print-color-adjust:exact;print-color-adjust:exact}.findings li{break-inside:avoid}}'
  ].join('');

  const portfolio = n.portfolio && n.portfolio.total
    ? '<p class="fine">This is one of ' + esc(n.portfolio.total) + ' sites we look after'
      + (n.portfolio.flagged ? ', and ' + esc(n.portfolio.flagged) + ' currently ' + (n.portfolio.flagged === 1 ? 'needs' : 'need') + ' attention' : '')
      + '.</p>'
    : '';

  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(n.subject || 'Site care report') + '</title><style>' + css + '</style></head>'
    + '<body><main>'
    + '<p class="kicker">Site care report</p>'
    + (n.html || '')
    + portfolio
    + '<p class="fine">Reported ' + esc(n.dateText || '') + '. Every item above is read from the site\'s own content at that date.</p>'
    + '</main>'
    // The only place the studio's tooling is named, and a client never sees it.
    + '<!-- ' + esc(KIND) + ' — generated by PallettAI Studio' + (o.version ? ' ' + esc(o.version) : '') + ' -->'
    + '</body></html>';
}

function fileName(note) {
  const n = note || {};
  const day = String(n.dateText || '').trim();
  const stamp = day ? ymd(new Date(Date.parse(n.at) || Date.now())) : ymd(new Date());
  return slugify(n.site) + '-site-care-report-' + stamp + '.html';
}

const CareReport = { KIND, AREAS, LEVELS, PAPER, MAX_LINES, build, page, fileName, checksOf, groupsOf, scoreOf, cadence, pickAccent, onAccent, placeOf, esc };

if (typeof window !== 'undefined') window.CareReport = CareReport;
if (typeof module !== 'undefined' && module.exports) module.exports = CareReport;
})();

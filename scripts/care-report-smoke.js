#!/usr/bin/env node
// ============================================================
// PallettAI Studio — client care report smoke
// ------------------------------------------------------------
// This module produces a document that leaves the building: it is opened by a
// client who cannot debug it, printed, and kept next to a retainer invoice. So
// the suite is mostly about the three ways such a document goes wrong:
//
//   1. It lies. Every number must come from the audit, the checks that found
//      nothing must still be listed, and the score's working must add up.
//   2. It arrives broken. One file, no scripts, no fonts, no images fetched
//      from anywhere, and print rules that survive being emailed.
//   3. It gets edited into an attack. A client's own words go on this page, so
//      every value is escaped and that is asserted with real markup.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const CareReport = require(path.join(ROOT, 'data', 'care-report.js'));
const SiteCare = require(path.join(ROOT, 'data', 'sitecare.js'));
const PLANS = require(path.join(ROOT, 'data', 'plans.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function eq(actual, expected, msg) {
  if (actual === expected) pass(msg);
  else fail(msg + '  → got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
}
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const NOW = Date.parse('2026-09-18T09:00:00Z');

// A site with something for several of the checks to find: filler copy, sample
// contact details, a section with no items of its own, a dead link.
const project = {
  id: 'p1',
  name: 'Hearth Bakery',
  suites: ['blog'],
  site: {
    name: 'Hearth Bakery',
    tagline: 'Sourdough in Digbeth',
    palette: 'midnight',
    font: 'inter',
    url: 'https://hearth-bakery.example.com',
    email: 'hello@example.com',
    phone: '555 0134',
    sections: [
      { type: 'hero', id: 's1', title: 'Lorem ipsum dolor sit amet', text: 'Sourdough, baked daily.' },
      { type: 'features', id: 's2', title: 'Why us', items: [] },
      { type: 'gallery', id: 's3', title: 'Our bread', images: [{ src: 'data:image/gif;base64,R0lGOD', alt: '' }] },
      { type: 'cta', id: 's4', title: 'Order now', ctaLink: '#', text: 'Order a loaf' }
    ]
  }
};

const audit = SiteCare.audit(project, { now: NOW });
const note = CareReport.build({
  report: audit,
  project: project,
  brand: { accent: '#2f6f4f' },
  studio: { name: 'Pallett & Co', email: 'studio@pallett.example' },
  portfolio: { total: 7, flagged: 3 },
  now: NOW
});
const page = CareReport.page(note, { version: '9.9.9' });

console.log('\n== 1. It refuses when there is nothing to report on ==');
eq(CareReport.build({}).ok, false, 'no audit at all is refused, not rendered empty');
eq(CareReport.build({ report: { score: 90 } }).ok, false, 'and a report with no findings list is refused too — that is not an audit');
assert(CareReport.build({}).error.length > 20, 'with something the caller can show: ' + CareReport.build({}).error);
eq(CareReport.build({}).html, '', 'and no document comes back with the refusal');
assert(CareReport.build({ report: audit, project: project, now: NOW }).ok, 'a real audit builds');

console.log('\n== 2. Every number comes from the audit ==');
eq(note.totals.findings, audit.findings.length, 'the finding count is the audit\'s own');
eq(note.totals.errors, audit.counts.error, 'broken down by severity, exactly');
eq(note.totals.warns, audit.counts.warn, 'warnings too');
eq(note.totals.notes, audit.counts.info, 'and notes');
eq(note.totals.pages, audit.pages, 'the pages read are what the audit read');
eq(note.totals.sections, audit.sections, 'and so are the sections');
eq(note.totals.score, audit.score, 'the score is copied, never recomputed into something friendlier');
eq(note.totals.letter, audit.letter, 'and so is the grade');
assert(audit.findings.length > 0, 'the fixture actually has something wrong with it (' + audit.findings.length + ' findings)');

const takenOut = note.groups.reduce((n, g) => n + g.items.length, 0);
eq(takenOut, audit.findings.length, 'NOTHING IS DROPPED: every finding reaches the document, once');
note.groups.forEach((g) => {
  eq(g.items.length, audit.findings.filter((f) => f.level === g.key).length, g.key + ': the group holds exactly the findings at that level');
});
const emptyGroups = note.groups.filter((g) => !g.items.length);
eq(emptyGroups.length, 0, 'and a severity with nothing in it is left out rather than printed as an empty heading');
audit.findings.forEach((f) => {
  if (note.html.indexOf(CareReport.esc(CareReport.placeOf(f))) === -1 && f.where) {
    fail('a finding\'s location is missing from the document: ' + JSON.stringify(f.where));
  }
});

console.log('\n== 3. The checks that found nothing are still on it ==');
const find = (id) => note.checks.filter((c) => c.id === id)[0];
eq(note.totals.checksRun, CareReport.AREAS.length, 'every check the catalogue knows about is reported on');
const areasFound = audit.findings.map((f) => f.area).filter((a, i, all) => all.indexOf(a) === i);
eq(note.totals.checksClear, note.totals.checksRun - areasFound.length, 'the clear count is the checks that found nothing');
note.checks.forEach((c) => {
  assert(typeof c.note === 'string' && c.note.length > 30, c.id + ': the report says what that check looked for, in words a client reads');
});
const unknownArea = CareReport.checksOf({ findings: [{ area: 'hologram', level: 'warn', msg: 'x' }] });
eq(unknownArea.length, CareReport.AREAS.length + 1, 'a check the catalogue has never heard of is still reported');
eq(find('hologram'), undefined, 'and does not quietly become one of the known ones');
assert(unknownArea[unknownArea.length - 1].count === 1, 'with its own count, under its own name');

console.log('\n== 4. The working adds up, and the capping is admitted ==');
const raw = audit.counts.error * audit.weight.error + audit.counts.warn * audit.weight.warn + audit.counts.info * audit.weight.info;
eq(note.scoring.rows.reduce((n, r) => n + r.points, 0), raw, 'the penalty lines sum to the penalty the audit applied');
eq(Math.max(0, 100 - note.scoring.penalty), audit.score, 'and 100 minus that penalty is the score on the page');
eq(note.scoring.clamped, false, 'a normal site is not clamped, so it is not explained away either');
assert(page.indexOf('Starting score') !== -1 && page.indexOf('−' + note.scoring.rows[0].points) !== -1,
  'the document shows the arithmetic rather than a bare number');
const broken = CareReport.scoreOf({ score: 0, letter: 'F', counts: { error: 12, warn: 4, info: 2 }, weight: { error: 12, warn: 5, info: 2 } });
assert(broken.clamped && broken.penalty === 100, 'a site with more than 100 points of penalty is clamped to a floor of zero');
assert(broken.score === 0, 'and the clamp does not invent a positive score');
const brokenNote = CareReport.build({ report: Object.assign({}, audit, { score: 0, letter: 'F', counts: { error: 12, warn: 4, info: 2 } }), project: project, now: NOW });
assert(brokenNote.html.indexOf('cannot go below zero') !== -1, 'and the document says so, so the numbers on it never look like a mistake');

console.log('\n== 5. One file, and it works with no network and no script ==');
assert(page.indexOf('<!DOCTYPE html>') === 0, 'the document is a whole page, not a fragment');
assert(page.indexOf('<script') === -1, 'there is no script in it, so nothing can run when a client opens it');
assert(page.indexOf('<link') === -1, 'and no stylesheet to fetch — the styles are inline');
assert(page.indexOf('src="http') === -1 && page.indexOf('href="http') === -1, 'and nothing loads from the network, so it opens anywhere');
assert(page.indexOf('@media print') !== -1 && page.indexOf('@page') !== -1, 'it carries print rules, because printing to PDF is the point');
assert(page.indexOf('break-inside:avoid') !== -1, 'and keeps findings off a page break');
assert(page.indexOf('PallettAI Studio') !== -1 && page.indexOf('<!--') !== -1, 'the tooling is named in a comment a client will never open');
assert(page.indexOf('Pallett &amp; Co') !== -1, 'the studio is named on the document instead');
assert(page.indexOf('studio@pallett.example') !== -1, 'with the reply address on it');
assert(page.indexOf('one of 7 sites we look after') !== -1, 'and the portfolio line, which is the reason an agency sends this at all');
assert(page.indexOf('3 currently need attention') !== -1, 'and it is true about the workspace');

console.log('\n== 6. A client\'s own words cannot become markup ==');
const nasty = {
  id: 'p2',
  name: 'Hearth <script>alert(1)</script>',
  site: {
    name: 'Hearth <script>alert(1)</script>',
    tagline: 'Bread',
    sections: [{ type: 'hero', id: 'n1', title: '<img src=x onerror=alert(2)>Lorem ipsum sit', text: 'Bread & butter' }]
  }
};
const nastyAudit = SiteCare.audit(nasty, { now: NOW });
const nastyNote = CareReport.build({ report: nastyAudit, project: nasty, now: NOW });
const nastyPage = CareReport.page(nastyNote, {});
assert(nastyNote.ok, 'a site with markup in its name still builds');
assert(nastyPage.indexOf('<script>alert(1)') === -1, 'its script tag is not a script tag in the document');
assert(nastyPage.indexOf('&lt;script&gt;') !== -1, 'it is escaped instead');
assert(nastyPage.indexOf('onerror=alert(2)>') === -1, 'and so is an image tag with an event handler in it');
assert(nastyNote.html.indexOf('<img') === -1, 'and no raw image tag reaches the document either');
assert(nastyNote.html.indexOf('Hearth &lt;script&gt;alert(1)&lt;/script&gt;') !== -1,
  'the heading prints the escaped name, which is what a client then reads');
const quoted = CareReport.build({ report: audit, project: project, studio: { name: 'Cake & Co "The Bakery"', email: 'x@y.z' }, now: NOW });
assert(CareReport.page(quoted, {}).indexOf('Cake &amp; Co &quot;The Bakery&quot;') !== -1,
  'an ampersand and a quote in the studio name are escaped, not printed raw');

console.log('\n== 7. The client\'s accent, when it can be read on paper ==');
eq(CareReport.pickAccent('#2f6f4f'), '#2f6f4f', 'a dark brand colour is used as given');
eq(CareReport.pickAccent('#FFF8E7'), CareReport.PAPER.accent, 'a cream that would be invisible as a heading falls back');
eq(CareReport.pickAccent('rgb(1,2,3)'), CareReport.PAPER.accent, 'and anything that is not a hex colour falls back rather than being printed as-is');
eq(CareReport.pickAccent(''), CareReport.PAPER.accent, 'an unset accent is the neutral default');
eq(CareReport.onAccent('#2f6f4f'), '#ffffff', 'a dark accent fill takes white text');
eq(CareReport.onAccent('#FFE9B0'), CareReport.PAPER.ink, 'a light one takes dark text, so the grade is never unreadable');
assert(page.indexOf('--a:#2f6f4f') !== -1, 'and the accent actually reaches the stylesheet');

console.log('\n== 8. The text version says the same thing as the document ==');
assert(note.text.indexOf('Hearth Bakery') === 0, 'the text version opens with the site name, ready to paste into an email');
assert(note.text.indexOf('WHAT WE LOOKED AT') !== -1, 'and lists what was looked at');
assert(note.text.indexOf('HOW THE SCORE IS REACHED') !== -1, 'and the working');
assert(note.text.indexOf('NEXT REVIEW') !== -1, 'and when the next look is due');
assert(note.text.indexOf('WHAT THIS REPORT DOES NOT COVER') !== -1, 'and is honest about its limits');
assert(note.text.indexOf('further lines are not in this plain-text version') === -1,
  'a normal report is not truncated, so nothing claims to be missing');
const lines = note.text.split('\n');
assert(lines.length < CareReport.MAX_LINES + 20, 'and the text version stays short enough to read in an email (' + lines.length + ' lines)');
eq(note.text.indexOf('Prepared by Pallett & Co') !== -1, true, 'the studio is signed on the text version too');
assert(note.text.indexOf('studio@pallett.example') !== -1, 'with the reply address');

console.log('\n== 9. Names, and the file that lands in a downloads folder ==');
const file = CareReport.fileName(note);
eq(file, 'hearth-bakery-site-care-report-2026-09-18.html', 'the file name is the site, what it is, and the date');
eq(CareReport.fileName(CareReport.build({ report: nastyAudit, project: nasty, now: NOW })), 'hearth-script-alert-1-script-site-care-report-2026-09-18.html',
  'a name with markup in it becomes a safe file name rather than a path');
const bare = CareReport.fileName({});
assert(bare.indexOf('site-site-care-report-') === 0 && bare.slice(-5) === '.html',
  'a report with no name and no date still produces a usable file name: ' + bare);
assert(note.subject.indexOf('Hearth Bakery') !== -1 && note.subject.indexOf('2026') !== -1, 'the subject line names the site and the date');

console.log('\n== 10. It is wired into the app, the shell and the plan table ==');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
assert(html.indexOf('src="data/care-report.js"') !== -1, 'the shell loads data/care-report.js');
assert(html.indexOf('src="data/care-report.js"') < html.indexOf('src="app.js"'), 'before app.js, so the app reads it as a global');
assert(app.indexOf('CareReport.build(') !== -1, 'the Care view builds the report through this module');
assert(app.indexOf('CareReport.page(') !== -1 && app.indexOf('CareReport.fileName(') !== -1,
  'and downloads the same document the module renders, rather than a second copy of the markup');
assert(app.indexOf('id="careReport"') !== -1, 'the button is in the report header of the Care view');
assert(app.indexOf("isProPlus()") !== -1 && app.indexOf('The white-label client report is a Pro+ feature') !== -1,
  'and it is gated on Pro+, with a toast that says why');
assert(app.indexOf('id="careRepSave"') !== -1 && app.indexOf('id="careRepCopy"') !== -1,
  'offering both the file and the pasteable text version');
assert(app.indexOf("copyText(note.text") !== -1, 'the copy button copies the text version, not the markup');
assert(app.indexOf('businessEmail') !== -1, 'the studio contact on the document comes from Settings');
['.care-rep-preview', '.care-rep-actions', '.care-rep-note'].forEach((sel) => {
  assert(css.indexOf(sel) !== -1, 'styles.css has ' + sel);
});
// The plan page and the gate are the same promise: a Pro+ bullet that the app
// does not enforce is a refund, and a gate with no bullet is a feature nobody
// discovers.
const proplus = PLANS.plans.filter((p) => p.id === 'proplus')[0];
assert(proplus.features.some((f) => f.toLowerCase().indexOf('care report') !== -1), 'Pro+ advertises the care report');
assert(PLANS.plans.filter((p) => p.id === 'pro').every((p) => p.features.every((f) => f.toLowerCase().indexOf('care report') === -1)),
  'and Pro does not, because the gate is Pro+');

if (failed) {
  console.error('\ncare-report-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\ncare-report-smoke PASSED');

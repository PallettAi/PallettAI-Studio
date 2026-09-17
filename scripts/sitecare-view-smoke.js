// ============================================================
// Site Care VIEW smoke test — the screen, not the engine.
//
// sitecare-smoke.js already proves the audit judges well. This file is about the
// half that can silently rot around it: the view can be wired in four places and
// be missing from any one of them, and every failure mode is invisible until a
// user clicks it.
//
//   1. Wiring      — the view lives in four files (chrome registry, nav button,
//                    #view-{id} section, switchView dispatch). Three out of four
//                    gives you a nav item that opens nothing, or a view nothing
//                    can reach. Both look like "the app is broken".
//   2. Markup      — every class the templates emit has a rule in styles.css. A
//                    typo'd class renders as an unstyled box and no test notices.
//   3. Contract    — every field the templates read exists on a real audit
//                    report. The view reads a plain object, so a renamed field
//                    becomes the word "undefined" on screen rather than an error.
//   4. One colour rule — the letter-to-colour mapping is NOT redefined here.
//                    qualityColor() already owns it, and two copies is how the
//                    same grade ends up two different greens in two screens.
//
// Run: node scripts/sitecare-view-smoke.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const appJs = read('app.js');
const styles = read('styles.css');
const chromeJs = read('data/chrome.js');
const indexHtml = read('index.html');

// The engine, for the contract half.
const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
const SiteCare = require(path.join(ROOT, 'data', 'sitecare.js'));

// ---------------------------------------------------------------- 1. wiring
console.log('\n== 1. The view is wired in all four places ==');

ok('chrome registry has the view', /id:\s*'care'/.test(chromeJs));
ok('the registry gives it a label and an icon', /id:\s*'care'[\s\S]{0,200}?label:\s*'Site Care'/.test(chromeJs)
  && /id:\s*'care'[\s\S]{0,260}?icon:\s*'([a-z]+)'/.test(chromeJs));
ok('the sidebar has the nav button', /data-view="care"/.test(indexHtml));
ok('the shell has the view section', /id="view-care"/.test(indexHtml));
ok('switchView dispatches to renderCare', /if \(name === 'care'\) renderCare\(\)/.test(appJs));
ok('renderCare is defined', /function renderCare\(\)/.test(appJs));
ok('the view root it renders into exists', /id="careRoot"/.test(indexHtml) && /\$\('#careRoot'\)/.test(appJs));

// The icon must be a real key or the nav item renders blank.
const iconKey = (chromeJs.match(/id:\s*'care'[\s\S]{0,260}?icon:\s*'([a-z]+)'/) || [])[1] || '';
const icons = read('data/icons.js');
ok(`the icon '${iconKey}' exists in icons.js`, !!iconKey && new RegExp("(^|[\\s{,])" + iconKey + "\\s*:").test(icons),
  'add the key to data/icons.js or the rail shows an empty box');

// ---------------------------------------------------------------- 2. markup
console.log('\n== 2. Every class the view emits has a style ==');

// The care templates only. `${...}` is stripped first so an interpolated class
// name cannot be mistaken for a literal one.
const region = (appJs.match(/function renderCare\(\)[\s\S]*?\n  function careIntro\(\)/) || [''])[0]
  + (appJs.match(/function careIntro\(\)[\s\S]*?\n  \}/) || [''])[0];
ok('the care templates were found', region.length > 400, 'renderCare/careIntro not located');

const literal = region.replace(/\$\{[^}]*\}/g, ' ');
const classes = new Set();
for (const m of literal.matchAll(/class="([^"]*)"/g)) {
  for (const token of m[1].split(/\s+/)) {
    // A fragment left by a stripped interpolation (`care-${...}`) always ends in
    // a dash; there is nothing to look up, and the concrete names it can produce
    // are covered by the explicit pairs asserted below.
    if (!token || token.endsWith('-')) continue;
    classes.add(token);
  }
}
ok('the view uses its own classes', classes.has('care-row') && classes.has('care-dial'));

// One matcher, used for every class below. `.care-row` must NOT be satisfied by
// `.care-rows`, so the lookahead is load-bearing — and a check that cannot fail
// is not a check, so the matcher asserts itself first.
const hasRule = (c) => new RegExp('\\.' + c.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '(?![\\w-])').test(styles);
ok('the class matcher finds a class that exists', hasRule('care-row'));
ok('and rejects a nearly-identical one', !hasRule('care-rowe') && !hasRule('care-rowz'));
const missing = [...classes].filter((c) => !hasRule(c));
ok(`all ${classes.size} emitted classes have rules`, missing.length === 0, 'unstyled: ' + missing.join(', '));

// The class names an interpolation can produce must exist too, because a missing
// one is silent: `diag-error` with no rule is still a row, just not a red one.
for (const c of ['diag-error', 'diag-warn', 'diag-info']) {
  ok(`interpolated class .${c} exists`, hasRule(c));
}
// A `.care-flag.ok` pill is produced by a stripped interpolation, so it is not in
// the collected set — assert that whole family directly.
for (const c of ['care-flag.ok', 'care-flag.warn', 'care-flag.bad']) {
  ok(`the .${c} pill has a rule`, new RegExp('\\.' + c.replace('.', '\\.') + '(?![\\w-])').test(styles));
}

// Every function a template CALLS must exist. This is the check that would have
// caught a real bug found while building this view: a helper was renamed, two
// call sites were missed, and renderCare would have thrown on open — an empty
// screen and a console error, with every test still green. Only names defined in
// app.js or known globals count.
const BUILTINS = new Set(['Array', 'Boolean', 'Date', 'Error', 'Function', 'JSON', 'Map', 'Math', 'Number',
  'Object', 'Promise', 'RegExp', 'Set', 'String', 'decodeURIComponent', 'encodeURIComponent', 'isFinite',
  'isNaN', 'parseFloat', 'parseInt', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'structuredClone']);
function undefinedCalls(region) {
  const called = new Set();
  // Only the ${...} interpolations, not the prose around them. A first attempt
  // scanned the whole region and reported "FormSubmit", "CSS" and "width" as
  // undefined functions because the copy says things like "FormSubmit (zero
  // setup, free)". Calls only ever live in an interpolation.
  for (const interp of String(region).matchAll(/\$\{([^{}]*)\}/g)) {
    // A lookbehind, not a consumed `(^|[^\w.$])` alternative. The consuming form
    // swallowed the character before each name, so in a nested call like
    // ${esc(localDate(x))} the leading `(` was eaten by the `esc` match and
    // `localDate` was never seen — the check looked like it worked while
    // silently skipping exactly the calls it exists to find.
    for (const m of interp[1].matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(m[1]);
  }
  return [...called].filter((name) => {
    if (BUILTINS.has(name)) return false;
    const esc = name.replace(/[$]/g, '\\$');
    return !new RegExp('(function\\s+' + esc + '\\s*\\()|((const|let|var)\\s+' + esc + '\\s*=)').test(appJs);
  });
}
const careUndefined = undefinedCalls(region);
ok('every function the care templates call is defined', careUndefined.length === 0,
  'undefined: ' + careUndefined.join(', '));

// The same check over the panel that now edits the concierge pack and the
// scheduled messages — it was written in the same sitting, with the same risk.
const panel = (() => {
  const at = appJs.indexOf('Concierge \u2014 answers on the site itself');
  return at < 0 ? '' : appJs.slice(Math.max(0, at - 4000), at + 9000);
})();
ok('the concierge/schedule panel region was found', panel.length > 5000, 'anchor not found');
const panelUndefined = undefinedCalls(panel);
ok('every function that panel calls is defined', panelUndefined.length === 0,
  'undefined: ' + panelUndefined.join(', '));

// ---------------------------------------------------------------- 3. contract
console.log('\n== 3. Every field the view reads exists on a real report ==');

const NOW = '2026-09-15T12:00:00.000Z';
const proj = (sections) => ({ id: 'p1', name: 'Northwind Joinery', site: { name: 'Northwind Joinery', sections: sections || [] } });

const stale = SiteCare.audit(proj([{ id: 'a', type: 'hero', title: 'Lorem ipsum' }]), { now: NOW });
const clean = SiteCare.audit(proj([
  { id: 'a', type: 'hero', title: 'Bespoke kitchens, built to last', subtitle: 'Get a fixed quote in a day.' },
  { id: 'b', type: 'contact', title: 'Talk to us', text: 'studio@northwindjoinery.co.uk' }
]), { now: NOW });

const reportKeys = new Set(Object.keys(stale));
const findingKeys = new Set(Object.keys(stale.findings[0]));
const whereKeys = new Set(Object.keys(stale.findings[0].where));

const fieldsOf = (prefix) => new Set([...region.matchAll(new RegExp('\\b' + prefix + '\\.([A-Za-z]+)', 'g'))].map((m) => m[1]));
const rFields = [...fieldsOf('r')].filter((f) => f !== 'length');
const fFields = [...fieldsOf('f')].filter((f) => f !== 'length');

const badR = rFields.filter((f) => !reportKeys.has(f));
const badF = fFields.filter((f) => !findingKeys.has(f));
const whereFields = [...fFields].includes('where') ? [...region.matchAll(/\bat\.([A-Za-z]+)/g)].map((m) => m[1]) : [];
const badWhere = whereFields.filter((f) => !whereKeys.has(f));

ok(`the ${rFields.length} report fields it reads all exist`, badR.length === 0, 'not on the report: ' + badR.join(', '));
ok(`the ${fFields.length} finding fields it reads all exist`, badF.length === 0, 'not on a finding: ' + badF.join(', '));
ok('the location fields it reads all exist', badWhere.length === 0, 'not on a location: ' + badWhere.join(', '));
ok('it actually reads a finding location', whereFields.length > 0);

// The data the view needs to be non-empty for a stale site.
ok('a stale site yields findings for the report', stale.findings.length > 0);
ok('and a grade, a score and a summary', !!(stale.letter && typeof stale.score === 'number' && stale.summary));
ok('and the three count buckets the pills show',
  ['error', 'warn', 'info'].every((k) => typeof stale.counts[k] === 'number'));
ok('and a review date to print', /^\d{4}-\d{2}-\d{2}$/.test(String(stale.reviewBy)));
ok('a clean site gives the view something to say', clean.letter === 'A+' && clean.findings.length === 0, clean.letter);

// ---------------------------------------------------------------- 4. one rule
console.log('\n== 4. The letter-to-colour rule still has one owner ==');

// The first version of this check matched the rule spelled with the variable
// name `letter` — and the Site health modal had two copies that used
// `audit.letter` and `care.letter`, so the suite that exists to guarantee one
// owner could not see them. Measured instead by the RULE: any single line that
// carries all three grade colours is a copy of it, whatever the variable is
// called.
// Quoted standalone, so the gradient on the review card — which names all three
// inside `linear-gradient(...)` — is not mistaken for a fourth copy.
const gradeLines = appJs.split('\n').filter((l) => /'#22c55e'/.test(l) && /'#eab308'/.test(l) && /'#ef4444'/.test(l));
ok('the grade colour rule is defined exactly once', gradeLines.length === 1,
  gradeLines.length + ' copies: ' + gradeLines.map((l) => l.trim().slice(0, 70)).join('  |  '));
ok('and it is the one qualityColor() returns', /function qualityColor\(letter\)[\s\S]{0,160}?letter === 'C'/.test(appJs));
// Everything that shows a grade has to ask that one function, not re-derive it.
ok('the Site health modal asks qualityColor for the launch grade', /const gColor = qualityColor\(audit\.letter\)/.test(appJs));
ok('and for the Site Care grade', /const careColor = care \? qualityColor\(care\.letter\)/.test(appJs));
ok('neither modal grade maps letters itself', !/includes\(audit\.letter\)|includes\(care\.letter\)/.test(appJs) || !/'#eab308'/.test(appJs.split('\n').filter((l) => /includes\((audit|care)\.letter\)/.test(l)).join('\n')));

// The bands themselves, run rather than read: B is a pass, C is a caution, and
// anything below is a fail. A helper that returned one colour would satisfy
// every text check above.
const qualityFn = (() => {
  const from = appJs.indexOf('function qualityColor(letter)');
  const to = appJs.indexOf('\n  }', from);
  if (from < 0 || to < 0) return null;
  // `to` points at the newline before the closing brace, so the brace itself has
  // to come along or the slice is a function with no end.
  try { return new Function(appJs.slice(from, to + 4) + '\nreturn qualityColor;')(); } catch (e) { return null; }
})();
ok('qualityColor can be lifted out and run', typeof qualityFn === 'function');
if (typeof qualityFn === 'function') {
  ok('A+ is green', qualityFn('A+') === '#22c55e', qualityFn('A+'));
  ok('B is green', qualityFn('B') === '#22c55e', qualityFn('B'));
  ok('C is amber', qualityFn('C') === '#eab308', qualityFn('C'));
  ok('D and F are red', qualityFn('D') === '#ef4444' && qualityFn('F') === '#ef4444', qualityFn('D') + '/' + qualityFn('F'));
}
ok('the view calls qualityColor for its tiles', /const tone = qualityColor\(r\.letter\)/.test(appJs));
ok('the view no longer maps letters itself', !/function careTone\(/.test(appJs));
ok('the tiles take the colour as --tone', /class="care-grade" style="--tone:/.test(appJs) && /class="care-dial" style="--tone:/.test(appJs));
ok('and styles.css consumes --tone', /--tone/.test(styles));
ok('the alert pills are semantic, not graded', /careAlert\(r\)/.test(appJs) && /care-flag\.ok\{/.test(styles));

// ---------------------------------------------------------------- 5. the date the sweep prints
console.log('\n== 5. What the sweep prints after "updated" ==');

// The row prints a project's last edit, and a project carries a millisecond
// stamp. localDate() was written for the yyyy-mm-dd strings Site Care hands it
// (a review date), and String(1737000000000) is not a date Date() understands —
// but toLocaleDateString() on an Invalid Date does not throw, it returns the
// words "Invalid Date". So every sweep row read "updated Invalid Date" in the
// real app while this suite passed, because asserting a helper EXISTS is not
// asserting what it prints. These run the helpers instead of pattern-matching
// them.
const dateFns = (() => {
  const from = appJs.indexOf('function localDate(value)');
  const to = appJs.indexOf('function renderCare()');
  if (from < 0 || to < 0 || to < from) return null;
  try {
    return new Function(appJs.slice(from, to) + '\nreturn { localDate: localDate, updatedStamp: updatedStamp };')();
  } catch (e) { return null; }
})();
ok('the date helpers can be lifted out and run', !!dateFns);

if (dateFns) {
  const { localDate, updatedStamp } = dateFns;
  const ms = Date.UTC(2026, 8, 17, 12);            // what a saved project carries
  const printed = String(localDate(ms));
  ok('a project timestamp prints that day in the reader\u2019s locale',
    printed === new Date(ms).toLocaleDateString(), printed);
  ok('and never the words "Invalid Date"', !/invalid/i.test(printed), printed);
  // The reason localDate exists: a bare yyyy-mm-dd is UTC midnight, which is the
  // previous day west of Greenwich. Built from parts, it is the day written.
  ok('a yyyy-mm-dd prints as the calendar day written, not UTC midnight',
    localDate('2026-12-20') === new Date(2026, 11, 20).toLocaleDateString(), String(localDate('2026-12-20')));
  ok('an unreadable value prints nothing rather than "Invalid Date"',
    localDate('garbage') === '' && localDate(undefined) === '' && localDate(null) === '' && localDate('') === '',
    String(localDate('garbage')));
  // "· updated " with nothing after it is its own small lie, so the suffix is
  // dropped whole when there is no date to print.
  ok('the row\u2019s updated suffix is dropped when there is no date',
    updatedStamp({ updatedAt: 'garbage' }) === '' && updatedStamp(null) === '',
    updatedStamp({ updatedAt: 'garbage' }));
  ok('and it is present, with the date, when there is one',
    /\u00b7 updated /.test(updatedStamp({ updatedAt: ms })), updatedStamp({ updatedAt: ms }));
}

// ---------------------------------------------------------------- 6. the row's verdict
console.log('\n== 6. What a sweep row claims, against what the report shows ==');

// Read on screen: a site whose only finding was a missing alt attribute showed
// "1 note" in the report badge directly below a row that said "nothing
// flagged". Notes are still findings and the row has to admit them, so the
// wording lives in one function and is RUN here rather than pattern-matched —
// the same lesson as the date helpers above.
const flagFn = (() => {
  const from = appJs.indexOf('function careFlag(r)');
  const to = appJs.indexOf('// Shared by Site Care', from);
  if (from < 0 || to < 0 || to < from) return null;
  try { return new Function(appJs.slice(from, to) + '\nreturn { careFlag: careFlag };')().careFlag; } catch (e) { return null; }
})();
ok('the row-flag helper can be lifted out and run', typeof flagFn === 'function');
ok('and the row actually uses it', /const flag = careFlag\(r\);/.test(appJs), 'the row decides the wording itself again');
ok('no second copy of the wording exists', !/const flag = r\.counts\.error/.test(appJs));

if (typeof flagFn === 'function') {
  const at = (error, warn, info) => flagFn({ counts: { error: error, warn: warn, info: info } });
  ok('errors outrank warnings', at(4, 8, 1) === '4 stale', at(4, 8, 1));
  ok('warnings are named as such', at(0, 1, 0) === '1 to check', at(0, 1, 0));
  ok('a single note is reported, not hidden', at(0, 0, 1) === '1 note', at(0, 0, 1));
  ok('and so are several', at(0, 0, 3) === '3 notes', at(0, 0, 3));
  ok('only a genuinely clean site says nothing flagged', at(0, 0, 0) === 'nothing flagged', at(0, 0, 0));
  ok('a missing report does not throw', flagFn(null) === 'nothing flagged' && flagFn({}) === 'nothing flagged');
  // The row and the note badge in the report read the SAME field, so a rename
  // of one cannot leave the two halves of the screen disagreeing again.
  ok('the row counts notes from the same field the badge prints', /c\.info \+ ' note'/.test(String(flagFn)), 'the row derives its own count');
  ok('and the report badge prints counts.info', /counts\.info\} note/.test(appJs));
}

console.log('\n' + (failed === 0 ? 'SITE CARE VIEW PASSED' : 'SITE CARE VIEW FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);

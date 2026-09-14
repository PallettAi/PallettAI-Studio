// ============================================================
// "What changed since they reviewed" smoke test
//
// A changelog that quietly omits an edit is worse than no changelog, because it
// is the receipt the whole review loop rests on. So the load-bearing assertion
// here is a COUNT: every change that goes in comes out as exactly one line, with
// nothing truncated and nothing invented. Unknown labels are checked too — the
// honest failure mode is awkward phrasing, never silence.
//
// The other half checks the note is written for a client: no revision ids, no
// internal vocabulary, and HTML that cannot be broken by a site name.
//
// Run: node scripts/changenote-smoke.js
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
const RevDiff = require(path.join(ROOT, 'data', 'revdiff.js'));
const ChangeNote = require(path.join(ROOT, 'data', 'changenote.js'));

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + String(detail).slice(0, 260) : ''));
  if (!cond) failed++;
}

// Counting the changes a diff represents, independently of the generator, so the
// assertion is a real cross-check rather than a restatement of the code.
function countChanges(diff) {
  return diff.summary.length + diff.sections.reduce((n, s) => n + (s.kind === 'edited' ? s.changes.length : 1), 0);
}

const BEFORE = {
  site: {
    name: 'Willow', tagline: 'Old line', palette: 'midnight', font: 'inter', heroLayout: 'split',
    design: { radius: 12, spacing: 96, containerWidth: 1140 },
    sections: [
      { type: 'hero', title: 'Hi', items: [] },
      { type: 'features', title: 'Why us', items: [{ title: 'A', text: 'a' }, { title: 'B', text: 'b' }, { title: 'C', text: 'c' }] },
      { type: 'testimonials', title: 'Kind words', items: [{ title: 'x', text: 'y' }] }
    ]
  }
};
const AFTER = {
  site: {
    name: 'Willow', tagline: 'New line', palette: 'sand', font: 'inter', heroLayout: 'centered',
    design: { radius: 22, spacing: 96, containerWidth: 1140 },
    sections: [
      { type: 'hero', title: 'Hi', items: [] },
      { type: 'features', title: 'Reasons', items: [{ title: 'A', text: 'a' }, { title: 'B', text: 'b' }] },
      { type: 'pricing', title: 'Plans', items: [] }
    ]
  }
};

// ---- 1. nothing is dropped ----------------------------------------------
console.log('\n1. Every change becomes exactly one line');
const diff = RevDiff.diff(BEFORE, AFTER);
const expected = countChanges(diff);
const note = ChangeNote.build({
  site: 'Willow', from: 'b1abc', to: 'b2def', at: '2026-09-14T10:00:00Z',
  siteChanges: diff.summary, pages: [{ name: 'Home', sections: diff.sections }]
});
ok('one sentence per change (' + expected + ')', note.count === expected, note.count);
ok('nothing truncated', note.truncated === 0, note.truncated);
ok('the plain-text body has a bullet per change', (note.text.match(/\u2022/g) || []).length === expected, (note.text.match(/\u2022/g) || []).length);
ok('the HTML has a list item per change', (note.html.match(/<li>/g) || []).length === expected, (note.html.match(/<li>/g) || []).length);
ok('page-level additions are reported', (() => {
  const n = ChangeNote.build({ site: 'W', pageChanges: [{ kind: 'added', name: 'About' }], pages: [] });
  return n.count === 1 && /About page|new page/.test(n.text);
})(), note.text);
ok('page-level removals are reported', (() => {
  const n = ChangeNote.build({ site: 'W', pageChanges: [{ kind: 'removed', name: 'Old page' }], pages: [] });
  return n.count === 1 && /Removed the Old page/.test(n.text);
})());
ok('page renames are reported', (() => {
  const n = ChangeNote.build({ site: 'W', pageChanges: [{ kind: 'renamed', from: 'Work', to: 'Projects' }], pages: [] });
  return n.count === 1 && /Renamed the Work page to Projects/.test(n.text);
})());
ok('a cap is reported rather than hidden', (() => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push({ label: 'Knob ' + i, from: 'a', to: 'b' });
  const n = ChangeNote.build({ site: 'W', siteChanges: many, pages: [] }, { max: 10 });
  return n.count === 10 && n.truncated === 20;
})());

// ---- 2. it reads like it was written for a client ----------------------
console.log('\n2. Written to the client, not about the code');
const bodyWithoutFooter = note.text.replace(/Compared:[\s\S]*$/, '');
ok('no revision hashes in the body', !/\bb[0-9a-z]{3,}\b/.test(bodyWithoutFooter), bodyWithoutFooter);
ok('no internal vocabulary', !/\bsuites?\b|\bcontainer width\b|\bhero layout\b|@font-face/i.test(bodyWithoutFooter), bodyWithoutFooter);
ok('changes are grouped under client headings', note.groups.map((g) => g.label).join(' | ') === 'Page structure | Wording and content | Look and feel', note.groups.map((g) => g.label).join(' | '));
ok('structure is reported before look and feel', note.groups[0].key === 'structure', note.groups[0].key);
ok('the subject names the site', /Willow/.test(note.subject), note.subject);
ok('sections are named by their heading, not their type', /\u201cReasons\u201d|Reasons section/.test(note.text), note.text);
ok('a heading change names the type, never the new heading twice', !/heading of the \u201cReasons\u201d section to \u201cReasons\u201d/.test(note.text), note.text);
ok('lists are described in counts', /Removed 1 item|Removed 1 items/.test(note.text), note.text);

// ---- 3. a change to one page does not leak another's name --------------
console.log('\n3. Multi-page notes read correctly');
{
  const n = ChangeNote.build({
    site: 'W', siteChanges: [],
    pages: [
      { name: 'Home', sections: [] },
      { name: 'About', sections: [{ index: 0, kind: 'added', label: 'Team', title: 'Our team', changes: [] }] }
    ]
  });
  ok('the changed page is named in a multi-page site', /About page/.test(n.text), n.text);
  const single = ChangeNote.build({
    site: 'W', siteChanges: [],
    pages: [{ name: 'Home', sections: [{ index: 0, kind: 'added', label: 'Team', title: 'Our team', changes: [] }] }]
  });
  ok('a single-page site does not repeat the page name', !/Home page/.test(single.text), single.text);
}

// ---- 4. nothing changed -------------------------------------------------
console.log('\n4. The empty case');
{
  const same = RevDiff.diff(BEFORE, JSON.parse(JSON.stringify(BEFORE)));
  const n = ChangeNote.build({ site: 'Willow', siteChanges: same.summary, pages: [{ name: 'Home', sections: same.sections }] });
  ok('reports that nothing changed', n.count === 0 && /no changes yet/i.test(n.subject), n.subject);
  ok('still produces readable text', /Nothing has changed/.test(n.text));
  ok('still produces a valid page', /^<!DOCTYPE html>/.test(ChangeNote.page(n)) && /<\/html>/.test(ChangeNote.page(n)));
  ok('no empty groups', n.groups.length === 0);
}
{
  const n = ChangeNote.build({});
  ok('an entirely empty input is handled', n.count === 0 && typeof n.text === 'string' && n.text.length > 10);
  ok('a missing site name is handled', n.site === 'your site', n.site);
}

// ---- 5. unknown labels, and escaping ------------------------------------
console.log('\n5. Unknown labels and unsafe input');
{
  const n = ChangeNote.build({ site: 'A', siteChanges: [{ label: 'Mystery knob', from: '1', to: '2' }], pages: [] });
  ok('an unknown setting is still reported', n.count === 1 && /mystery knob/i.test(n.text), n.text);
  const n2 = ChangeNote.build({
    site: 'A', siteChanges: [],
    pages: [{ name: 'Home', sections: [{ index: 0, kind: 'edited', label: 'Features', title: 'W', changes: [{ label: 'Weird field', from: 'a', to: 'b' }] }] }]
  });
  ok('an unknown section change is still reported', n2.count === 1 && /weird field/i.test(n2.text), n2.text);
  const n3 = ChangeNote.build({ site: '<script>alert(1)</script>', siteChanges: [{ label: 'Site name', from: 'a', to: '<img src=x onerror=alert(1)>' }], pages: [] });
  // Checked for user-derived TAGS rather than for the substring "onerror=",
  // which survives as harmless text inside the escaped markup.
  ok('no tag from user content survives', !/<script/i.test(n3.html) && !/<img/i.test(n3.html), n3.html.slice(0, 160));
  ok('the dangerous text is present but escaped', /&lt;img src=x/.test(n3.html), n3.html.slice(0, 200));
  ok('the standalone page escapes it too', (() => {
    const doc = ChangeNote.page(n3);
    return !/<script/i.test(doc) && !/<img/i.test(doc);
  })(), ChangeNote.page(n3).slice(0, 200));
}

console.log('\n   --- sample changelog ---');
console.log(note.text.split('\n').map((l) => '   ' + l).join('\n'));

console.log('\n' + (failed === 0 ? 'CHANGENOTE SMOKE PASSED' : 'CHANGENOTE SMOKE FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);

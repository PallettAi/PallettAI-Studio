// ============================================================
// PallettAI Studio — "what changed since you reviewed"
//
// The question every agency gets asked after a round of feedback is “did you
// actually do what I asked?”. Studio can already answer it internally — RevDiff
// compares two revisions and a build stamp ties an export to a revision — so
// this module turns that diff into the thing the client reads.
//
// Two rules shape everything here:
//
//   1. NOTHING IS DROPPED. Every change in the diff produces exactly one line.
//      A changelog that quietly omits an edit is worse than no changelog,
//      because it is the receipt the whole review loop rests on. There is a
//      test that counts changes in and sentences out.
//   2. IT IS WRITTEN TO THE CLIENT, NOT ABOUT THE CODE. No “suites”, no
//      “container width”, no revision hashes in the body. Technical labels are
//      translated into what a client would say, and anything unrecognised falls
//      back to plain phrasing rather than being invented into something
//      confident and wrong.
//
// Pure logic: takes a plain change object, returns strings. No DOM, no storage.
// app.js assembles the input from RevDiff; the smoke test calls it directly.
// ============================================================

'use strict';

const ChangeNote = (() => {
  const MAX_SENTENCES = 200;

  // Client-facing vocabulary for the diffs RevDiff produces.
  const SUMMARY_RULES = [
    { match: /^site name$/i, group: 'content', say: (c) => 'The site is now called “' + c.to + '”.' },
    { match: /^tagline$/i, group: 'content', say: (c) => c.to && c.to !== '—' ? 'Rewrote the headline line to “' + c.to + '”.' : 'Removed the headline line.' },
    { match: /^palette$/i, group: 'look', say: (c) => 'Refreshed the colour scheme (' + c.from + ' → ' + c.to + ').' },
    { match: /^font$/i, group: 'look', say: (c) => 'Changed the typeface from ' + c.from + ' to ' + c.to + '.' },
    { match: /^hero layout$/i, group: 'look', say: (c) => 'Reworked the top of the page (' + c.from + ' → ' + c.to + ').' },
    { match: /^corner radius$/i, group: 'look', say: (c) => 'Adjusted how rounded the corners are (' + c.from + ' → ' + c.to + ').' },
    { match: /^section spacing$/i, group: 'look', say: (c) => 'Changed the vertical spacing between sections (' + c.from + ' → ' + c.to + ').' },
    { match: /^container width$/i, group: 'look', say: (c) => 'Changed how wide the content sits (' + c.from + ' → ' + c.to + ').' },
    { match: /^suites$/i, group: 'features', say: (c) => 'Changed the extra features the site uses.' }
  ];

  const GROUP_ORDER = [
    { key: 'structure', label: 'Page structure', blurb: 'Sections added, removed or reordered.' },
    { key: 'content', label: 'Wording and content', blurb: 'Text, headlines and list items.' },
    { key: 'look', label: 'Look and feel', blurb: 'Colour, type, spacing and layout.' },
    { key: 'features', label: 'Features', blurb: 'Interactive pieces built into the site.' }
  ];

  const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const quote = (s) => '“' + clip(s, 90) + '”';

  // “Items” rows arrive pre-summarised by RevDiff as “+2 added”, “−1 removed”
  // or “3 edited”, so they are read back rather than recounted.
  function itemsSentence(section, to) {
    const who = sectionTitle(section);
    let m = /^\+\s*(\d+)\s*added/i.exec(to);
    if (m) return 'Added ' + m[1] + ' item' + (m[1] === '1' ? '' : 's') + ' to ' + who + '.';
    m = /^[−-]\s*(\d+)\s*removed/i.exec(to);
    if (m) return 'Removed ' + m[1] + ' item' + (m[1] === '1' ? '' : 's') + ' from ' + who + '.';
    m = /^(\d+)\s*edited/i.exec(to);
    if (m) return 'Rewrote ' + m[1] + ' item' + (m[1] === '1' ? '' : 's') + ' in ' + who + '.';
    return 'Updated the items in ' + who + '.';
  }

  // `forceType` matters for a heading change: naming the section by its NEW
  // heading would produce “changed the heading of the ‘Reasons’ section to
  // ‘Reasons’”, which reads as nonsense. There, and only there, the section type
  // is the only honest reference.
  function sectionTitle(section, forceType) {
    const t = clip(section && section.title, 90);
    const type = clip(section && section.label, 40);
    if (t && !forceType) return 'the ' + quote(t) + ' section';
    if (type) return 'the ' + type + ' section';
    if (t) return 'the ' + quote(t) + ' section';
    return 'a section';
  }

  // One section's row from RevDiff -> one or more client sentences.
  function sectionSentences(section, pageName) {
    const type = clip(section && section.label, 40) || 'section';
    const where = pageName ? ' on the ' + pageName + ' page' : '';
    if (section.kind === 'added') return [{ group: 'structure', text: 'Added a new ' + type + ' section' + where + '.' }];
    if (section.kind === 'removed') return [{ group: 'structure', text: 'Removed the ' + type + ' section' + where + '.' }];

    const out = [];
    (section.changes || []).forEach((ch) => {
      const to = clip(ch.to, 120);
      const from = clip(ch.from, 120);
      switch (String(ch.label || '')) {
        case 'Title':
          out.push({ group: 'content', text: to && to !== '—'
            ? 'Changed the heading of ' + sectionTitle(section, true) + where + ' to ' + quote(to) + '.'
            : 'Removed the heading from ' + sectionTitle(section, true) + where + '.' });
          break;
        case 'Subtitle':
          out.push({ group: 'content', text: to && to !== '—'
            ? 'Changed the supporting line in ' + sectionTitle(section) + where + ' to ' + quote(to) + '.'
            : 'Removed the supporting line in ' + sectionTitle(section) + where + '.' });
          break;
        case 'Layout':
          out.push({ group: 'look', text: 'Changed the layout of ' + sectionTitle(section) + where + ' (' + (from || 'auto') + ' → ' + (to || 'auto') + ').' });
          break;
        case 'Extra field':
          out.push({ group: 'content', text: 'Updated a detail in ' + sectionTitle(section) + where + '.' });
          break;
        case 'Items':
          out.push({ group: 'content', text: itemsSentence(section, to) + (where ? ' (' + pageName + ' page)' : '') });
          break;
        case 'Type':
          out.push({ group: 'structure', text: 'Replaced the ' + (from || 'existing') + ' section' + where + ' with a ' + (to || 'different') + ' one.' });
          break;
        default:
          // Unknown label: still reported, never silently skipped.
          out.push({ group: 'content', text: 'Updated ' + (ch.label || 'something') + ' in ' + sectionTitle(section) + where + '.' });
      }
    });
    return out;
  }

  function summarySentences(rows) {
    const out = [];
    (Array.isArray(rows) ? rows : []).forEach((c) => {
      const rule = SUMMARY_RULES.find((r) => r.match.test(String(c.label || '')));
      if (rule) out.push({ group: rule.group, text: rule.say(c) });
      else out.push({ group: 'content', text: 'Updated ' + String(c.label || 'a setting').toLowerCase() + '.' });
    });
    return out;
  }

  // input: {
  //   site, from, to, at,
  //   siteChanges: [{label, from, to}],           // RevDiff.summary
  //   pages: [{ name, sections:[RevDiff section rows] }, ...]
  // }
  function build(input, opts) {
    const i = input || {};
    const o = opts || {};
    const site = clip(i.site, 120) || 'your site';
    const lines = [];

    summarySentences(i.siteChanges).forEach((l) => lines.push(l));

    // Pages are reported before sections: to a client, “we added an About page”
    // is the headline, and the sections inside it are the detail.
    (Array.isArray(i.pageChanges) ? i.pageChanges : []).forEach((pc) => {
      if (!pc || !pc.kind) return;
      if (pc.kind === 'added') lines.push({ group: 'structure', text: 'Added a new page: ' + clip(pc.name, 60) + '.' });
      else if (pc.kind === 'removed') lines.push({ group: 'structure', text: 'Removed the ' + clip(pc.name, 60) + ' page.' });
      else if (pc.kind === 'renamed') lines.push({ group: 'structure', text: 'Renamed the ' + clip(pc.from, 60) + ' page to ' + clip(pc.to, 60) + '.' });
    });

    (Array.isArray(i.pages) ? i.pages : []).forEach((pg) => {
      const multi = (i.pages || []).length > 1;
      (pg.sections || []).forEach((s) => {
        sectionSentences(s, multi ? clip(pg.name, 60) : '').forEach((l) => lines.push(l));
      });
    });

    const capped = lines.slice(0, o.max || MAX_SENTENCES);
    const groups = GROUP_ORDER
      .map((g) => ({ key: g.key, label: g.label, blurb: g.blurb, items: capped.filter((l) => l.group === g.key).map((l) => l.text) }))
      .filter((g) => g.items.length);

    const count = capped.length;
    const truncated = lines.length - capped.length;
    const when = clip(i.at, 40) || new Date().toISOString();

    const subject = count
      ? 'Changes to ' + site + ' since your feedback'
      : site + ' — no changes yet';

    const text = [
      subject,
      '',
      count
        ? 'Here is everything that has changed since the version you reviewed.'
        : 'Nothing has changed yet since the version you reviewed.',
      ''
    ].concat(groups.map((g) => ['— ' + g.label.toUpperCase() + ' —'].concat(g.items.map((t) => '  • ' + t)).concat(['']).join('\n')))
      .concat(truncated ? ['(' + truncated + ' further change' + (truncated === 1 ? '' : 's') + ' not listed.)', ''] : [])
      .concat([
        i.from || i.to ? 'Compared: ' + (clip(i.from, 40) || 'earlier version') + ' → ' + (clip(i.to, 40) || 'current version') : '',
        'Prepared ' + when.slice(0, 10)
      ])
      .filter((l) => l !== null && l !== undefined)
      .join('\n').trim();

    const html = [
      '<h1>' + esc(subject) + '</h1>',
      '<p class="lede">' + (count
        ? 'Here is everything that has changed since the version you reviewed.'
        : 'Nothing has changed yet since the version you reviewed.') + '</p>',
      groups.map((g) => '<h2>' + esc(g.label) + '</h2><ul>' + g.items.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ul>').join(''),
      truncated ? '<p class="more">' + truncated + ' further change' + (truncated === 1 ? '' : 's') + ' not listed.</p>' : '',
      '<p class="meta">Compared ' + esc(clip(i.from, 40) || 'earlier version') + ' → ' + esc(clip(i.to, 40) || 'current version') + ' · prepared ' + esc(when.slice(0, 10)) + '</p>'
    ].join('\n');

    return {
      site: site,
      subject: subject,
      count: count,
      truncated: truncated,
      groups: groups,
      text: text,
      html: html,
      from: clip(i.from, 40),
      to: clip(i.to, 40),
      at: when
    };
  }

  // Standalone page so the note can be previewed in the app or saved and sent.
  function page(note, brand) {
    return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>' + esc(note.subject) + '</title><style>'
      + 'body{margin:0;background:#f6f7fb;color:#161a2b;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
      + 'main{max-width:720px;margin:0 auto;padding:56px 24px 90px}'
      + 'h1{font-size:1.9rem;letter-spacing:-.02em;margin:0 0 8px}'
      + '.lede{color:#5b6076;margin:0 0 34px;font-size:1.05rem}'
      + 'h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.13em;color:#3d5afe;margin:34px 0 10px}'
      + 'ul{margin:0;padding-left:20px}li{margin:0 0 7px}'
      + '.more{color:#8a8fa3;font-size:.9rem}'
      + '.meta{color:#8a8fa3;font-size:.82rem;margin-top:42px;border-top:1px solid #e3e5ee;padding-top:14px}'
      + '</style></head><body><main>' + note.html
      + (brand ? '<p class="meta">Prepared with ◆ ' + esc(brand) + '</p>' : '')
      + '</main></body></html>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { build, page, sectionTitle, SUMMARY_RULES, GROUP_ORDER, MAX_SENTENCES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChangeNote;

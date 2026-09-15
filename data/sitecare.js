'use strict';

// ============================================================
// Site care — the report that keeps a live site from going stale.
// ------------------------------------------------------------
// Every other audit in Studio asks "is this built well?". This one asks a
// different question, and it is the one that costs a client money: "is this
// still TRUE?".
//
// A site is a snapshot. The moment it is handed over it begins to age — the
// price that changed, the phone number nobody answers, the "TBC" that was
// never filled in, the launch countdown that hit zero eight months ago, the
// address that came from our own template. None of those look like bugs. They
// all look like a business that has stopped paying attention.
//
// So this reads the project the way a stranger would, looking for the things
// that were true when they were written and are not true now. Two rules hold
// it together:
//
//   * a finding names what was found and exactly where, so it can be fixed in
//     one place rather than hunted for;
//   * a clean site reports clean. Inventing maintenance work is how a report
//     gets ignored, so every check here is deliberately narrow — a real
//     placeholder, a real example.com, a real expired date — and a past year
//     is only flagged when it sits beside money, where it means what it says.
//
// Pure, offline and deterministic: pass `{ now }` and the same project always
// produces the same report.
// ============================================================

const SiteCare = (() => {

  // ---- what unfinished looks like ------------------------------------------
  // Ordered most specific first, because the first match is the one reported:
  // "lorem ipsum" should not be described as "the word lorem".
  const PLACEHOLDER = [
    [/\blorem ipsum\b/i, 'lorem ipsum filler text'],
    [/\bdummy text\b/i, 'dummy text'],
    [/\bsample text\b/i, 'sample text'],
    [/\bplaceholder text\b/i, 'placeholder text'],
    [/\byour name here\b/i, '"your name here"'],
    [/\byour text here\b/i, '"your text here"'],
    [/\byour tagline here\b/i, '"your tagline here"'],
    [/\byour description here\b/i, '"your description here"'],
    [/\byour company name\b/i, '"your company name"'],
    [/\bdouble-click to edit\b/i, 'an editing prompt'],
    [/\bclick to edit\b/i, 'an editing prompt'],
    [/\bedit this text\b/i, 'an editing prompt'],
    [/\bchange this text\b/i, 'an editing prompt'],
    [/\blorem\b/i, 'lorem filler text'],
    [/\btbc\b/i, '"TBC"'],
    [/\btbd\b/i, '"TBD"'],
    [/\btodo\b/i, '"TODO"'],
    [/\bfixme\b/i, '"FIXME"'],
    [/\bxxx+\b/i, 'a placeholder run of x']
  ];

  // Our own templates ship sample contact details, which is exactly how a
  // client ends up publishing a phone number for a street in San Francisco.
  const DEMO = [
    [/\bexample\.(com|org|net|edu)\b/i, 'an example.com address'],
    [/@example\./i, 'an @example.com address'],
    [/\b101\s+market\s+street\b/i, 'the template sample address'],
    [/\b123\s+fake\b/i, 'a fake street address'],
    [/\bfake\s+street\b/i, 'a fake street address'],
    [/\byou@(studio|example|yourdomain)\./i, 'a template sign-up address'],
    // No \b before a literal "(": a word boundary cannot sit between a space
    // and a bracket, so the obvious pattern silently never matched the very
    // format a phone placeholder usually takes.
    [/(?:^|[^0-9])\(?555\)?[-\s]?\d{3}[-\s]?\d{4}(?![0-9])/, 'a 555 placeholder phone number'],
    [/(?:^|[^0-9])555[-\s]?0?1\d\d(?![0-9])/, 'a 555 placeholder phone number'],
    [/(?:^|[^0-9])\+1\s?555(?![0-9])/, 'a 555 placeholder phone number'],
    // Our own shipped default. A client's site showing PallettAI's inbox means
    // the field was never touched — and that enquiries are going to the wrong
    // place, or nowhere.
    [/\bhello@pallettai\.org\b/i, 'our own default inbox']
  ];

  // Money is the context where a past year is a statement of fact, not a
  // historical note. "Est. 1998" is fine; "£249 in 2024" is a live problem.
  const MONEY = /[£$€]|\b(price|prices|pricing|offer|offers|sale|deal|from|valid|expires?|save|discount)\b/i;
  const YEAR = /\b(19[89]\d|20\d{2})\b/g;
  const ISO_DATE = /\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;

  // A section with none of this is a wireframe someone forgot to fill in.
  const TEXT_KEYS = [
    'title', 'subtitle', 'text', 'extra', 'desc', 'tagline', 'intro',
    'answer', 'question', 'label', 'caption', 'quote', 'author',
    'name', 'role', 'address', 'email', 'phone', 'note', 'cols'
  ];
  const ITEM_KEYS = ['title', 'text', 'desc', 'label', 'caption', 'extra', 'tag', 'icon'];

  const WEIGHT = { error: 12, warn: 5, info: 2 };
  const letterOf = (score) => (score >= 95 ? 'A+' : score >= 88 ? 'A' : score >= 78 ? 'B' : score >= 66 ? 'C' : score >= 50 ? 'D' : 'F');

  // ---- reading the project --------------------------------------------------

  function pagesOf(project) {
    const site = (project && project.site) || {};
    if (Array.isArray(site.pages) && site.pages.length) {
      return site.pages.map((pg, i) => ({
        name: (pg && pg.name) || ('Page ' + (i + 1)),
        slug: (pg && pg.slug) || ('page-' + (i + 1)),
        sections: Array.isArray(pg && pg.sections) ? pg.sections : []
      }));
    }
    return [{
      name: site.name || 'Home',
      slug: 'index',
      sections: Array.isArray(site.sections) ? site.sections : []
    }];
  }

  // Every string the renderer actually shows, tagged with where it lives.
  function textOf(section) {
    const out = [];
    if (!section || typeof section !== 'object') return out;
    TEXT_KEYS.forEach((k) => {
      const v = section[k];
      if (typeof v === 'string' && v.trim()) out.push({ field: k, text: v.trim(), item: false });
    });
    (Array.isArray(section.items) ? section.items : []).forEach((it, i) => {
      if (!it || typeof it !== 'object') return;
      ITEM_KEYS.forEach((k) => {
        const v = it[k];
        if (typeof v === 'string' && v.trim()) out.push({ field: k, text: v.trim(), item: i + 1 });
      });
    });
    return out;
  }

  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  // Which rows did the writer actually write? An item counts as theirs if it
  // carries any copy OR an image — a gallery of photographs with no captions is
  // finished work, not a gap.
  function ownItems(section) {
    const items = Array.isArray(section && section.items) ? section.items : [];
    return items.filter((it) => it && (ITEM_KEYS.some((k) => str(it[k])) || str(it.image))).length;
  }

  function hasOwnCopy(section) {
    if (TEXT_KEYS.some((k) => str(section[k]))) return true;
    if (str(section.image) || str(section.html)) return true;
    if (Array.isArray(section.rows) && section.rows.length) return true;
    return false;
  }

  // How many rows the RENDERER substitutes when a section has none. This is the
  // number that matters, and it is the product's own declaration of it rather
  // than a guess made here: give the builder no items and it fills the gap with
  // its own — six "Work" tiles on stock photos, three sample testimonials, an
  // invented price column.
  function sampleItemCount(type) {
    if (typeof DB === 'undefined' || !DB || !DB.sectionTypes) return 0;
    const info = DB.sectionTypes[type];
    return info ? (Number(info.defaultItems) || 0) : 0;
  }

  // ---- the audit ------------------------------------------------------------

  function audit(project, opts) {
    const o = opts || {};
    const now = o.now ? new Date(o.now) : new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisYear = now.getFullYear();
    const title = String(o.title || (project && project.name) || '');

    const findings = [];
    const add = (level, area, msg, fix, where) => {
      findings.push({
        id: 'care-' + findings.length,
        level,
        area,
        msg,
        fix: fix || '',
        where: where || null
      });
    };

    const pages = pagesOf(project);
    const site = (project && project.site) || {};
    // Dates are formatted from the LOCAL parts, not via toISOString(): a
    // midnight local date converted to UTC lands on the previous day east of
    // Greenwich, which is exactly where this product is built.
    const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    let sectionCount = 0;
    let imageCount = 0;
    let timeSensitive = 0;

    pages.forEach((page) => {
      const at = (section, i) => ({
        page: page.slug,
        pageName: page.name,
        sectionId: (section && section.id) || '',
        sectionType: (section && section.type) || '',
        sectionNo: i + 1
      });

      page.sections.forEach((section, i) => {
        sectionCount += 1;
        const spot = at(section, i);
        const label = (section && section.type ? section.type : 'section ' + (i + 1));

        // 1 — copy that was never finished
        textOf(section).forEach(({ field, text, item }) => {
          const whereField = field + (item ? ' (item ' + item + ')' : '');
          for (let p = 0; p < PLACEHOLDER.length; p += 1) {
            if (PLACEHOLDER[p][0].test(text)) {
              add('error', 'placeholder',
                'The ' + label + ' section still contains ' + PLACEHOLDER[p][1] + ' in its ' + whereField + '.',
                'Replace it with real copy, or delete the section.',
                spot);
              return;
            }
          }
          // 2 — our own sample details, left in
          for (let d = 0; d < DEMO.length; d += 1) {
            if (DEMO[d][0].test(text)) {
              add('error', 'demo',
                'The ' + label + ' section still shows ' + DEMO[d][1] + ' in its ' + whereField + '.',
                'Put the real contact details in, or remove the line.',
                spot);
              return;
            }
          }
          // 3 — a date that has already been and gone
          ISO_DATE.lastIndex = 0;
          let dm = ISO_DATE.exec(text);
          while (dm) {
            const when = new Date(dm[0] + 'T00:00:00');
            if (!isNaN(when.getTime()) && when < todayMidnight) {
              add('warn', 'expired',
                'The ' + label + ' section is dated ' + dm[0] + ', which has passed.',
                'Update the date, or take the dated content down.',
                spot);
              timeSensitive += 1;
              break;
            }
            dm = ISO_DATE.exec(text);
          }
          // 4 — a past year sitting next to money reads as last season's price
          if (MONEY.test(text)) {
            YEAR.lastIndex = 0;
            let ym = YEAR.exec(text);
            while (ym) {
              const y = parseInt(ym[1], 10);
              if (y < thisYear) {
                add('warn', 'stale',
                  'The ' + label + ' section quotes a price beside the year ' + y + ', so it reads as an old offer.',
                  'Update the year, or drop it from the price.',
                  spot);
                timeSensitive += 1;
                break;
              }
              ym = YEAR.exec(text);
            }
          }
        });

        // 5 — a section still wearing the template's own clothes
        //
        // The renderer is not a blank canvas. Leave its rows out and it fills
        // them in with samples, so the honest finding is never "this is empty"
        // — it is "this is not yours". A pricing page quietly showing three
        // invented tiers is worse than a visible gap, because nothing about it
        // looks wrong.
        const rows = ownItems(section);
        const sampleRows = sampleItemCount(section && section.type);
        const basic = section && ['hr', 'divider', 'spacer'].indexOf(section.type) !== -1;
        // The hero always renders the site name as its headline, so it is never
        // actually blank — marking it down would be crying wolf on every site.
        const alwaysShows = (section && section.type) === 'hero';
        // Contact draws its details from the site, not from the section.
        const fromSite = (section && section.type) === 'contact' && !!(str(site.email) || str(site.phone) || str(site.address));

        if (sampleRows > 0 && rows === 0 && !basic) {
          add('warn', 'template',
            'The ' + label + ' section has no items of its own — the export fills it with ' + sampleRows + ' template samples.',
            'Replace them with your own content \u2014 visitors cannot tell samples from the real thing.',
            spot);
        } else if (!basic && !alwaysShows && !fromSite && rows === 0 && !hasOwnCopy(section)) {
          add('warn', 'empty',
            'The ' + label + ' section has nothing in it at all.',
            'Fill it in or delete it \u2014 an empty block reads as a broken page.',
            spot);
        }

        // 6 — images a screen reader cannot describe
        const imgNoAlt = [];
        if (section && typeof section.image === 'string' && section.image.trim() && !String(section.alt || '').trim()) imgNoAlt.push('the section image');
        (Array.isArray(section && section.items) ? section.items : []).forEach((it) => {
          if (it && typeof it.image === 'string' && it.image.trim() && !String(it.alt || '').trim()) imgNoAlt.push('an item image');
        });
        if (imgNoAlt.length) {
          imageCount += imgNoAlt.length;
          add('info', 'alt',
            'The ' + label + ' section has ' + imgNoAlt.length + ' image' + (imgNoAlt.length === 1 ? '' : 's') + ' with no alt text.',
            'Describe each image — it is what a screen reader reads and what search indexes.',
            spot);
        }

        // 7 — links that go nowhere
        //
        // Only a link that is PRESENT and still "#" counts. An absent field is
        // not a placeholder — it is a section that has no button, and calling
        // that a broken link would make the whole report noise.
        const dead = [];
        const scanLink = (href, what) => {
          if (typeof href !== 'string') return;
          if (href.trim() === '#') dead.push(what);
        };
        scanLink(section && section.ctaLink, 'the section button');
        (Array.isArray(section && section.items) ? section.items : []).forEach((it) => { if (it) scanLink(it.href, 'an item link'); });
        if (dead.length) {
          add('warn', 'deadlink',
            'The ' + label + ' section has ' + dead.length + ' link' + (dead.length === 1 ? '' : 's') + ' pointing at "#".',
            'Give the link a real destination, or make it plain text.',
            spot);
        }
      });
    });

    // 8 — site-wide links and contact details
    //
    // This runs once per site, not once per section: a dead navigation link
    // repeated eleven times is eleven findings for one problem.
    const navDead = [];
    (Array.isArray(site.navLinks) ? site.navLinks : []).forEach((l) => {
      if (l && l.visible !== false && typeof l.href === 'string' && l.href.trim() === '#') navDead.push(String(l.label || l.href));
    });
    if (navDead.length) {
      add('warn', 'deadlink',
        navDead.length + ' navigation link' + (navDead.length === 1 ? '' : 's') + ' point at "#": ' + navDead.join(', ') + '.',
        'Point each one at a real page, or hide it.',
        null);
    }

    if (typeof site.email === 'string' && site.email.trim()) {
      for (let d = 0; d < DEMO.length; d += 1) {
        if (DEMO[d][0].test(site.email)) {
          add('error', 'demo', 'The site email is ' + DEMO[d][1] + '.', 'Set the real inbox in Design & branding.', null);
          break;
        }
      }
    }
    if (typeof site.phone === 'string' && site.phone.trim()) {
      for (let d = 0; d < DEMO.length; d += 1) {
        if (DEMO[d][0].test(site.phone)) {
          add('error', 'demo', 'The site phone number is ' + DEMO[d][1] + '.', 'Set the real number, or clear the field.', null);
          break;
        }
      }
    }

    // ---- scoring ------------------------------------------------------------
    // Plain arithmetic, decomposed, so the number can be argued with: an error
    // is worth 12, a warning 5, a note 2.
    const penalty = findings.reduce((n, f) => n + (WEIGHT[f.level] || 0), 0);
    const score = Math.max(0, 100 - penalty);
    const counts = {
      error: findings.filter((f) => f.level === 'error').length,
      warn: findings.filter((f) => f.level === 'warn').length,
      info: findings.filter((f) => f.level === 'info').length
    };

    // How soon this needs a human eye again. Dated content decays fastest, so
    // it sets the shortest clock.
    const reviewDays = timeSensitive ? 14 : counts.error ? 30 : counts.warn ? 90 : 180;
    const reviewBy = new Date(todayMidnight.getTime() + reviewDays * 86400000);

    let summary;
    if (!findings.length) {
      summary = 'Nothing has gone stale. ' + sectionCount + ' section' + (sectionCount === 1 ? '' : 's') + ' read clean — no placeholders, no sample details, no expired dates.';
    } else {
      const bits = [];
      if (counts.error) bits.push(counts.error + ' unfinished ' + (counts.error === 1 ? 'item' : 'items'));
      if (counts.warn) bits.push(counts.warn + ' worth checking');
      if (counts.info) bits.push(counts.info + ' note' + (counts.info === 1 ? '' : 's'));
      summary = 'This site is not ready to hand over: ' + bits.join(', ') + '. Next review ' + ymd(reviewBy) + '.';
    }

    return {
      kind: 'pallettai-sitecare',
      title: title,
      checkedAt: now.toISOString(),
      score: score,
      letter: letterOf(score),
      stale: counts.error > 0,
      counts: counts,
      weight: WEIGHT,
      summary: summary,
      reviewBy: ymd(reviewBy),
      reviewDays: reviewDays,
      pages: pages.length,
      sections: sectionCount,
      imagesMissingAlt: imageCount,
      findings: findings
    };
  }

  return { audit, pagesOf, letterOf, WEIGHT, PLACEHOLDER, DEMO };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SiteCare;

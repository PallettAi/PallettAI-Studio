'use strict';
// ============================================================
// PallettAI Studio — self-critique pass
// ------------------------------------------------------------
// The deterministic quality gate already knows what is wrong with a site. This
// module holds the *judgement* about what a machine may fix by itself, and what
// is the creator's call. Two rules are load-bearing:
//
//   1. Only findings the gate itself marks as `safe` are eligible, and only the
//      shapes the conservative repair pass actually knows how to fix. A finding
//      the gate flagged as unsafe is advice, never an auto-edit — the gate
//      refusing to fix it is the whole reason it is trustworthy.
//   2. A locked brand is never unlocked by a repair. Finding ids that would edit
//      a locked field (contrast → palette) are downgraded to advice while that
//      field is locked.
//
// The judgement lives here, away from the engine, because it is the part that is
// easiest to get wrong and the cheapest to test on its own.
// ============================================================

/*
  Finding ids the repair pass may act on unattended. Every entry is one the gate
  marks `safe` AND that `repairQualityPage` genuinely handles: metadata, ids,
  structure normalisation, alt text, table shapes, unknown variants. Deliberately
  absent: `site-name` and `no-hero`/`no-sections` (the gate marks them safe, but
  inventing a business name or a missing page structure is a creator decision,
  not a tidy-up) and everything the gate already flags as unsafe.
*/
const AUTO_FIXABLE = [
  /^meta-description$/,
  /^site-url$/,
  /^cta-text$/,
  /^unsafe-cta$/,
  /^contact-section$/,
  /^bad-section-\d+$/,
  /^unknown-section-\d+$/,
  /^section-id-\d+$/,
  /^section-title-\d+$/,
  /^section-items-\d+$/,
  /^table-cols-\d+$/,
  /^table-shape-\d+$/,
  /^image-alt-\d+$/,
  /^item-image-alt-\d+-\d+$/,
  /^section-layout-\d+$/,
  /^page-empty-\d+$/,
  /^page-bad-section-\d+-\d+$/,
  /^page-unknown-section-\d+-\d+$/,
  /^page-section-id-\d+-\d+$/,
  /^page-no-hero-\d+$/,
  /^contrast$/
];

// Findings whose fix is a visible design decision rather than a tidy-up. They
// still auto-apply when the gate says safe, but the caller should say so out loud.
const DESIGN_FIXES = [/^contrast$/];

// Which locked brand field each auto-fix would have to edit. A repair may not
// edit a locked field, however safe the gate thinks it is.
const FIX_TOUCHES_FIELD = { contrast: 'palette' };

// Craft findings with a prompt lever: worth telling a model about, even when the
// deterministic pass has nothing to do.
const SUGGESTIONS = [
  [/^placeholder-/, 'Rewrite the placeholder copy in the client’s own words.'],
  [/^empty-section-|^empty-items-/, 'Give the empty section real content — specific beats generic.'],
  [/^missing-photos$/, 'Drop a real, topic-matched photo on the hero — it is the first thing a visitor judges.'],
  [/^page-repeated-heading-/, 'Give each page a heading of its own; identical headings across pages read as filler.'],
  [/^form-endpoint$|^html-form-action$/, 'Point the form at a real destination so enquiries are not silently lost.'],
  [/^no-contact$/, 'Add a direct contact method — an email or a phone number a visitor can actually use.']
];

function matches(list, id) {
  return list.some((re) => re.test(id));
}

/*
  Split one gate report into what will be fixed, what stays advice, and what a
  model should be told. Pure: it reads a report and returns a decision.
*/
function plan(report, opts) {
  const r = report || {};
  const issues = Array.isArray(r.issues) ? r.issues : [];
  const o = opts || {};
  const locked = Array.isArray(o.locked) ? o.locked : [];
  const fixes = [];
  const advice = [];
  const suggestions = [];

  issues.forEach((x) => {
    if (!x || !x.id) return;
    const lockedField = FIX_TOUCHES_FIELD[x.id];
    const blockedByBrand = !!(lockedField && locked.indexOf(lockedField) !== -1);
    const eligible = x.safe === true
      && x.level !== 'info'
      && matches(AUTO_FIXABLE, x.id)
      && !blockedByBrand;
    if (eligible) {
      fixes.push({
        id: x.id,
        level: x.level,
        kind: matches(DESIGN_FIXES, x.id) ? 'design' : 'structure',
        msg: x.msg,
        fix: x.fix
      });
    } else {
      advice.push({
        id: x.id,
        level: x.level,
        msg: x.msg,
        fix: x.fix,
        reason: blockedByBrand ? 'locked by the brand kernel' : (x.safe === true ? 'a creator decision' : 'not safe to fix automatically')
      });
    }
    SUGGESTIONS.forEach(([re, line]) => {
      if (re.test(x.id) && suggestions.indexOf(line) === -1) suggestions.push(line);
    });
  });

  return {
    letter: r.letter || '',
    score: Number(r.score) || 0,
    fixes,
    advice,
    suggestions,
    blocked: advice.filter((a) => a.level === 'error').length,
    summary: summarise(r, fixes, advice)
  };
}

function summarise(report, fixes, advice) {
  const letter = (report && report.letter) || '';
  const parts = [];
  parts.push(fixes.length
    ? fixes.length + ' safe fix' + (fixes.length === 1 ? '' : 'es') + ' available'
    : 'nothing safe left to fix');
  if (advice.length) parts.push(advice.length + ' finding' + (advice.length === 1 ? '' : 's') + ' for you to decide');
  if (letter) parts.push('launch grade ' + letter);
  return parts.join(' · ');
}

/*
  The one thing a self-repair pass must never do is make the site worse. The
  caller snapshots before repairing; this is the test it applies afterwards.
*/
function worseThan(before, after) {
  const b = Number(before && before.score);
  const a = Number(after && after.score);
  if (!Number.isFinite(b) || !Number.isFinite(a)) return false;
  return a < b;
}

/*
  Plain-English receipt for the creation card. Silence would be the dishonest
  option here: the whole feature is that the AI graded its own work and changed
  it, so the creator is told what changed and what is still open.
*/
function receipt(before, after, repair) {
  const b = before || {};
  const a = after || {};
  const lines = [];
  const changes = (repair && Array.isArray(repair.changes)) ? repair.changes : [];
  lines.push(changes.length
    ? 'Self-critique fixed ' + changes.length + ' thing' + (changes.length === 1 ? '' : 's')
    : 'Self-critique found nothing to fix');
  if (b.letter && a.letter && b.letter !== a.letter) lines.push('launch grade ' + b.letter + ' → ' + a.letter);
  else if (a.letter) lines.push('launch grade ' + a.letter);
  return lines.join(' · ');
}

const AiCritique = { AUTO_FIXABLE, DESIGN_FIXES, FIX_TOUCHES_FIELD, SUGGESTIONS, plan, worseThan, receipt };
if (typeof module !== 'undefined' && module.exports) module.exports = AiCritique;

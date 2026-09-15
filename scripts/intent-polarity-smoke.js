#!/usr/bin/env node
// ============================================================
// PallettAI Studio — intent polarity smoke test
// ------------------------------------------------------------
// Every matcher in the planner reads *content*: which section, which
// palette, which layout. Content alone cannot tell a request from a
// refusal — "make it editorial" and "I don't like the editorial look"
// carry the same two words in the same order.
//
// Without a polarity reading, the second was carried out as the first,
// and the failure is the worst shape one can have in a tool that edits
// someone's website: it is invisible, it is the exact opposite of what
// was asked, and the client only discovers it by looking at their own
// site. Measured, before this suite existed:
//
//   "do not make it dark"                 -> switched to Midnight
//   "I don't like the editorial look"     -> applied the Editorial look
//   "not the candy palette"               -> switched to Candy
//   "don't switch to midnight"            -> switched to Midnight
//   "we should not use a serif"           -> set Playfair Display
//   "i hate the bento grid"               -> applied the bento layout
//   "the bento grid looks nice"           -> applied it anyway
//
// This suite pins both halves: nothing on that list may change the
// site, and every genuine request must still be carried out. A fix
// that mutes the copilot is not a fix.
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadAI } = require('./load-ai.js');
const Copilot = require(path.join(ROOT, 'data', 'copilot.js'));

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }

const AI = loadAI();
const site = AI.generateSite('a bakery', { brief: { name: 'Rustica', offer: 'Sourdough' }, onePager: true }).site;

const planFor = (msg) => {
  try { return AI.chatPlan(site, msg, { targetType: '', ops: [] }) || { acts: [] }; }
  catch (e) { return { acts: [{ op: 'threw:' + String(e).slice(0, 70) }] }; }
};
const actsFor = (msg) => planFor(msg).acts || [];
const opsFor = (msg) => actsFor(msg).map((a) => a.op);

/*
  The design-mutating ops. These are the ones where acting wrongly is both
  invisible and permanent-feeling, and they are exactly the set the polarity
  gate has to hold back.
*/
const DESIGN_OPS = ['pack', 'palette', 'font', 'layout', 'design', 'hero', 'navStyle', 'navSticky'];
const designActs = (msg) => actsFor(msg).filter((a) => DESIGN_OPS.indexOf(a.op) !== -1);

console.log('\n== 1. polarity() reads the sentence, not just the words ==');
{
  const neg = [
    "I don't like the editorial look",
    'i do not want the brutalist style',
    'not the candy palette',
    "don't switch to midnight",
    'i hate the bento grid',
    'no more bento',
    'stop using green',
    'we should not use a serif',
    "i'm not keen on the zen look"
  ];
  neg.forEach((m) => {
    const p = AI.polarity(m);
    assert(p.negated === true && p.designOk === false, 'read as a refusal: "' + m + '"');
  });

  const appr = [
    'the bento grid looks nice',
    'i like the terminal style',
    'i love the aurora palette',
    'the masonry wall is good',
    'the sunset colours are lovely',
    'the hero is fine as it is'
  ];
  appr.forEach((m) => {
    const p = AI.polarity(m);
    assert(p.approval === true && p.designOk === false, 'read as praise, not a request: "' + m + '"');
  });

  ['do not make it dark', "don't change the palette", 'never mind the font'].forEach((m) => {
    assert(AI.polarity(m).prohibition === true, 'read as a prohibition: "' + m + '"');
  });

  ['the stacked tiers are confusing', 'the map is not loading', 'the font is not working for me'].forEach((m) => {
    assert(AI.polarity(m).observation === true, 'read as a description, not an instruction: "' + m + '"');
  });

  const req = ['make it glassmorphism', 'switch to emerald', 'give it an editorial look', 'rounder corners', 'terminal hero', 'make it warmer'];
  req.forEach((m) => {
    assert(AI.polarity(m).designOk === true, 'read as a request: "' + m + '"');
  });
  assert(AI.polarity('what about a darker look').question === false, '"what about X" is a request, not a question');
  assert(AI.polarity('why is the hero so tall').question === true, 'a real wh- question is still a question');
}

console.log('\n== 2. Nothing on the failure list changes the site ==');
{
  const REFUSALS = [
    "I don't like the editorial look",
    'i do not want the brutalist style',
    'i hate the bento grid',
    'the bento grid looks nice',
    'i like the terminal style',
    'the masonry wall is good',
    'do not make it dark',
    "don't change the palette",
    'i dont want it warm',
    'not the candy palette',
    'the sunset colours are lovely',
    'i love the aurora palette',
    'never mind the font',
    "don't switch to midnight",
    'the studio looks editorial in that photo',
    'the hero is fine as it is',
    'this is not premium',
    'stop using green',
    'the font is not working for me',
    'we should not use a serif',
    "i'm not keen on the zen look",
    'the stacked tiers are confusing',
    'no more bento',
    'remove the splash',
    'what about a darker look'
  ];
  REFUSALS.forEach((m) => {
    const d = designActs(m);
    assert(d.length === 0, 'no design change: "' + m + '"' + (d.length ? ' (got ' + d.map((a) => a.op).join(',') + ')' : ''));
  });
  console.log('  (' + REFUSALS.length + ' refusals, observations and praise, zero design changes)');
}

console.log('\n== 3. …and the fix is not a mute button ==');
{
  const REQUESTS = [
    ['make it glassmorphism', 'pack'],
    ['give it an editorial look', 'ask'],
    ['make it sage', 'pack'],
    ['make it luxury gold', 'pack'],
    ['use a serif font', 'font'],
    ['make it serif', 'font'],
    ['make the features bento', 'layout'],
    ['terminal hero', 'layout'],
    ['masonry testimonials', 'layout'],
    ['gradient splash for the cta', 'layout'],
    ['try a dark blue palette', 'palette'],
    ['switch to emerald', 'palette'],
    ['rounder corners', 'design'],
    ['make it more spacious', 'design'],
    ['set the container width to 1140', 'design'],
    ['make the nav sticky', 'navSticky'],
    ['transparent nav', 'navStyle'],
    ['make the hero punchier', 'rewriteSection'],
    ['add a map of London', 'addSection'],
    ['delete the FAQ', 'removeSection'],
    ['duplicate the hero', 'duplicateSection'],
    ['install the blog suite', 'suite'],
    ['review my site', 'review'],
    ['show me other options', 'options']
  ];
  REQUESTS.forEach(([msg, op]) => {
    const got = opsFor(msg);
    assert(got.indexOf(op) !== -1, '"' + msg + '" -> ' + op + (got.indexOf(op) === -1 ? ' (got ' + (got.join(',') || 'nothing') + ')' : ''));
  });
  console.log('  (' + REQUESTS.length + ' genuine requests still carried out)');
}

console.log('\n== 4. Alternatives offered are real, runnable, and never the rejected one ==');
{
  const cases = [
    ["I don't like the editorial look", 'pack', 'editorial'],
    ['not the candy palette', 'palette', 'candy'],
    ["i'm not keen on the zen look", 'pack', 'zen'],
    ['we should not use a serif', 'font', 'playfair'],
    ['i hate the bento grid', 'layout', 'bento'],
    ['stop using green', 'palette', 'emerald'],
    ['no more bento', 'layout', 'bento']
  ];
  cases.forEach(([msg, kind, rejectedId]) => {
    const ask = actsFor(msg).find((a) => a.op === 'ask');
    assert(!!ask && Array.isArray(ask.options) && ask.options.length >= 2,
      '"' + msg + '" answers with alternatives instead of acting');
    if (!ask || !ask.options) return;
    const ids = ask.options.map((o) => (o.act && (o.act[kind === 'layout' ? 'layout' : kind === 'palette' ? 'palette' : kind === 'font' ? 'font' : 'pack'])) || '');
    assert(ids.indexOf(rejectedId) === -1, '…and never offers back the ' + rejectedId + ' the client just turned down');
    assert(ask.options.every((o) => o.act && o.act.op && o.label && o.label.trim()), '…every option carries a label and a real action');
    // A dead button is worse than no button: each id must exist in the build.
    const allReal = ask.options.every((o) => {
      const a = o.act || {};
      if (a.op === 'palette') return !!Copilot.sanitiseChoice('palette', a.palette);
      if (a.op === 'font') return !!Copilot.sanitiseChoice('font', a.font);
      if (a.op === 'layout') return !!Copilot.sanitiseChoice('layout:' + a.type, a.layout);
      if (a.op === 'pack') return (AI.stylePacks || []).some((p) => p.id === a.pack);
      return false;
    });
    assert(allReal, '…every offered id exists in this build (no dead buttons)');
  });
}

console.log('\n== 5. An offer is only accepted when it clears the product\'s own AA check ==');
{
  const ask = actsFor('not the candy palette').find((a) => a.op === 'ask');
  assert(!!ask, 'a rejected palette produces alternatives');
  const palettes = (ask.options || []).map((o) => o.act.palette);
  const DB = require(path.join(ROOT, 'data', 'db.js'));
  const bad = palettes.filter((id) => {
    const pal = DB.getPalette(id);
    const checks = DB.paletteChecks(pal) || [];
    return checks.some((c) => !c || c.ratio < c.need);
  });
  assert(bad.length === 0, '…and every offered palette clears AA (' + palettes.join(', ') + ')');
}

console.log('\n== 6. "address" is a field only when it is being set to an address ==');
{
  const DESTRUCTIVE = [
    'the address in the footer is wrong',
    'address the spacing issue on the home page',
    'add the address to the contact section',
    'the form address field is missing',
    'add the address near the map',
    'make the contact address right'
  ];
  DESTRUCTIVE.forEach((m) => {
    const wrote = actsFor(m).some((a) => a.op === 'setField' && a.key === 'address');
    assert(!wrote, 'never overwrites the address: "' + m + '"');
  });

  const REAL = [
    ['our address is 12 High Street, Ripon', '12 High Street, Ripon'],
    ['set the address to 4 Mill Lane, Bakewell', '4 Mill Lane, Bakewell'],
    ['change our address to 9 Park Road', '9 Park Road'],
    ['the address should be 22 Queen Street', '22 Queen Street'],
    ['address: 7 Church Walk', '7 Church Walk'],
    ['our address is The Old Mill, Bakewell', 'The Old Mill, Bakewell']
  ];
  REAL.forEach(([msg, want]) => {
    const act = actsFor(msg).find((a) => a.op === 'setField' && a.key === 'address');
    assert(!!act && act.value === want, 'still sets a real address: "' + msg + '" -> ' + (act ? JSON.stringify(act.value) : 'nothing'));
  });
}

console.log('\n== 7. The write surface refuses prose, not just long strings ==');
{
  [
    'in the footer is wrong',
    'the spacing issue on the home page',
    'to the contact section',
    'field is missing',
    'near the map'
  ].forEach((v) => {
    const r = Copilot.sanitiseSiteField('address', v);
    assert(r.ok === false && r.value === '', 'the write refuses "' + v + '"');
  });
  ['12 High Street, Ripon', '4 Mill Lane', 'The Old Mill, Bakewell'].forEach((v) => {
    assert(Copilot.sanitiseSiteField('address', v).ok === true, 'the write accepts "' + v + '"');
  });
  assert(Copilot.sanitiseSiteField('address', '').ok === true, 'clearing the address is still allowed');
  assert(Copilot.sanitiseSiteField('phone', 'not a phone at all').ok === false, 'the write refuses a phone number that is a sentence');
  assert(Copilot.sanitiseSiteField('phone', '+44 113 000 0000').ok === true, 'the write accepts a real phone number');
  assert(Copilot.sanitiseSiteField('phone', '').ok === true, 'clearing the phone number is still allowed');
  assert(!Object.prototype.polluted, 'the prototype chain is untouched by all of the above');
}

console.log('\n== 8. A plan that answers instead of acting carries the answer ==');
{
  /*
    chatPlan has always composed these sentences; chatApplyPlan used to throw
    them away, so the client got the generic "I didn\'t quite catch that"
    instead. The plan is the contract the app reads, so it is asserted here.
  */
  const answered = [
    "I don't like the editorial look",
    'do not make it dark',
    'the bento grid looks nice',
    'the stacked tiers are confusing',
    'the hero is fine as it is'
  ];
  answered.forEach((m) => {
    const plan = planFor(m);
    const asks = (plan.acts || []).some((a) => a.op === 'ask');
    const says = !!(plan.reply && String(plan.reply).trim().length > 20);
    assert(asks || says, '"' + m + '" produces something to show the client');
  });
  const appSrc = require('fs').readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert(/plan\.reply/.test(appSrc), 'the app reads plan.reply rather than dropping it');
}

console.log('\n== 9. Nothing sensitive is written where the client cannot see it ==');
{
  // A refusal must be honest: the message says nothing changed, and the site
  // model really is untouched. The plan is pure, so the fixture is the proof.
  const before = JSON.stringify(site);
  [
    "I don't like the editorial look",
    'not the candy palette',
    'do not make it dark',
    'the address in the footer is wrong',
    'the stacked tiers are confusing'
  ].forEach((m) => planFor(m));
  assert(JSON.stringify(site) === before, 'planning never mutates the site it was handed');
}

if (failed) {
  console.error('\nintent-polarity-smoke FAILED — ' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nintent-polarity-smoke PASSED');

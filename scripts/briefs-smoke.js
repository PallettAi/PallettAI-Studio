// ============================================================
// PallettAI Studio — saved briefs smoke test (offline, pure)
// Run: node scripts/briefs-smoke.js
// ============================================================
'use strict';
const Briefs = require('../data/briefs.js');
const AiBrief = require('../data/ai-brief.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label); }
}

console.log('Briefs: normalize');
{
  const b = Briefs.normalize({
    name: '  Willow Café  ',
    prompt: '  A cozy café site '.repeat(100),
    brief: { name: 'Willow', area: 'Leeds', offer: 'Coffee', proofs: ['x'], cta: 'Book', voice: 'NOPE' },
    packId: 'p', photoMode: 'weird', photoGrade: 1, onePager: 'yes', layouts: 'classic', updatedAt: '123.7'
  });
  ok(b.name === 'Willow Café', 'name trimmed');
  ok(b.prompt.length <= 800 && b.prompt.startsWith('A cozy café site'), 'prompt clipped');
  ok(b.brief.proofs.length === 3 && b.brief.proofs[0] === 'x' && b.brief.proofs[1] === '', 'proofs padded to 3');
  ok(b.brief.voice === 'warm', 'bad voice → warm');
  ok(b.photoMode === 'real', 'bad photoMode → real');
  ok(b.photoGrade === false && b.onePager === false, 'truthy junk flags rejected (strict === true)');
  ok(Briefs.normalize({ photoGrade: true, onePager: true }).photoGrade === true, 'real booleans kept');
  ok(b.layouts === 'classic', 'layouts kept');
  ok(typeof b.updatedAt === 'number', 'updatedAt numeric');
  ok(b.id && b.id.startsWith('brf_'), 'id generated');
}

console.log('Briefs: fromOptions round-trips the AI form shape');
{
  const opts = {
    prompt: 'A modern bakery in Paris',
    brief: AiBrief.normalizeBrief({ name: 'Rustica', area: 'Paris', offer: 'Sourdough daily', proofs: ['48h dough', 'Organic flour', ''], cta: 'Book a loaf', voice: 'premium' }),
    packId: 'parisian',
    photoMode: 'real',
    photoGrade: false,
    onePager: true,
    layouts: 'auto'
  };
  const rec = Briefs.fromOptions(opts, 'Rustica — bakery');
  ok(rec.name === 'Rustica — bakery', 'collection name used');
  ok(rec.brief.offer === 'Sourdough daily', 'brief fields kept');
  ok(rec.onePager === true, 'onePager kept');
  const again = Briefs.fromOptions({ ...opts, prompt: rec.prompt, brief: rec.brief, name: rec.name }, rec.name);
  ok(again.prompt === rec.prompt && again.brief.offer === rec.brief.offer, 're-save round-trips');
}

console.log('Briefs: upsert / remove / rename / search');
{
  let list = [];
  const a = Briefs.normalize({ name: 'Alpha', prompt: 'alpha prompt' });
  const b = Briefs.normalize({ name: 'Beta', prompt: 'beta prompt' });
  list = Briefs.upsert(list, a);
  list = Briefs.upsert(list, b);
  ok(list.length === 2 && list[0].id === b.id, 'upsert prepends new');
  const b2 = { ...b, name: 'Beta v2' };
  list = Briefs.upsert(list, b2);
  ok(list.length === 2 && list[0].name === 'Beta v2', 'upsert replaces in place');
  ok(Briefs.upsert([{ garbage: true }, a], { id: 'x', prompt: 'p' }).length === 2, 'garbage filtered');
  list = Briefs.rename(list, b.id, '  Renamed  ');
  ok(list.find((x) => x.id === b.id).name === 'Renamed', 'rename works');
  ok(Briefs.search(list, 'beta').length === 1, 'search hits prompt');
  ok(Briefs.search(list, 'WILLOW').length === 0, 'search case-insensitive, no hit');
  ok(Briefs.search(list, '').length === 2, 'empty query returns all');
  list = Briefs.remove(list, a.id);
  ok(list.length === 1, 'remove works');

  // limit
  let big = [];
  for (let i = 0; i < 50; i++) big = Briefs.upsert(big, Briefs.normalize({ name: 'B' + i, prompt: 'p' + i }));
  ok(big.length === Briefs.MAX_BRIEFS, 'list capped at ' + Briefs.MAX_BRIEFS);
}

console.log('Briefs: does not explode on junk');
{
  ok(Briefs.upsert(null, null).length === 0, 'null list');
  ok(Briefs.search(null, 'x').length === 0, 'null list search');
  const j = Briefs.normalize(undefined);
  ok(j.name === 'Untitled brief', 'undefined input → defaults');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

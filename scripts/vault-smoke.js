// ============================================================
// PallettAI Studio — cloud project vault smoke test
// Drives the REAL modules/supabase.js vault methods + the REAL
// data/vault.js merge engine against the local mock registry
// (scripts/mock-supabase.js, port 54321), covering:
//   * push → read-back round trip
//   * second-device adoption (restore on a fresh local list)
//   * newer-cloud wins / newer-local wins (last-writer-wins)
//   * delete tombstone: other device drops the local copy
//   * re-save after delete resurrects the project
//   * signed-out / bad-input refusals
//   * oversized payload rejected (413 → too-large)
// Run:
//   node scripts/mock-supabase.js &    (terminal 1 — start FRESH)
//   node scripts/vault-smoke.js        (terminal 2)
// ============================================================

const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; }
};

const SUPABASE = require('../modules/supabase.js');
const Vault = require('../data/vault.js');
const URL = 'http://127.0.0.1:54321';
const KEY = 'test-anon-key';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → got: ' + JSON.stringify(extra) : '')); }
};

const mkProject = (id, name, updatedAt) => ({
  id, name, updatedAt, suites: [],
  site: { name, tagline: 't', sections: [{ type: 'hero', id: 's1', title: name }] }
});

(async () => {
  console.log('== setup ==');
  SUPABASE.setConfig(URL, KEY);
  check('config accepted', SUPABASE.isConfigured());

  const anonRpc = await fetch(URL + '/rest/v1/rpc/save_project_backup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_project_id: 'x', p_name: 'x', p_payload: {} })
  });
  check('signed-out vault RPC rejected (401)', anonRpc.status === 401);

  const r = await SUPABASE.signUp('vault@test.local', 'password123');
  check('signup ok', r.ok && !r.needsConfirm);

  console.log('== push + read-back ==');
  const p1 = mkProject('proj-1', 'Acme Site', Date.now());
  const push1 = await SUPABASE.saveProjectBackup('proj-1', 'Acme Site', p1);
  check('push outcome saved', push1.ok && push1.outcome === 'saved', push1);
  check('updatedAt stamped', push1.ok && Number(push1.updatedAt) > 0, push1);

  const read1 = await SUPABASE.getProjectBackups();
  check('read-back returns one row', read1.ok && read1.backups.length === 1, read1);
  check('payload round-trips intact', read1.ok && read1.backups[0].payload.site.sections[0].title === 'Acme Site', read1.backups);
  check('not tombstoned', read1.ok && read1.backups[0].deletedAt === null, read1.backups);

  console.log('== merge plan: second device adopts ==');
  // A second device with an empty local list adopts everything from the vault.
  const plan2 = Vault.plan([], read1.backups);
  check('empty local list → adopt from cloud', plan2.toAdopt.length === 1 && plan2.toPush.length === 0, plan2);
  check('adopted payload passes shape check', plan2.toAdopt.length === 1 && Vault.looksLikeProject(plan2.toAdopt[0]));

  console.log('== newer-cloud wins ==');
  const localStale = mkProject('proj-1', 'Acme Site (old)', Date.now() - 60000);
  const plan3 = Vault.plan([localStale], read1.backups);
  check('older local → adopt cloud, no push', plan3.toAdopt.length === 1 && plan3.toPush.length === 0, plan3);

  console.log('== newer-local wins ==');
  const localNew = mkProject('proj-1', 'Acme Site (new)', Date.now() + 60000);
  const plan4 = Vault.plan([localNew], read1.backups);
  check('newer local → push, no adopt', plan4.toPush.length === 1 && plan4.toAdopt.length === 0, plan4);
  const pushOut = Vault.pushPayload(localNew);
  check('push payload well-formed', pushOut.ok && pushOut.projectId === 'proj-1' && pushOut.name === 'Acme Site (new)', pushOut);
  const pushAllOut = await Vault.pushAll([localNew], (id, name, payload) => SUPABASE.saveProjectBackup(id, name, payload));
  check('pushAll succeeds cleanly', pushAllOut.pushed === 1 && pushAllOut.failed === 0 && pushAllOut.skipped === 0, pushAllOut);

  console.log('== delete tombstone ==');
  const del = await SUPABASE.deleteProjectBackup('proj-1');
  check('delete outcome deleted', del.ok && del.outcome === 'deleted', del);
  const read2 = await SUPABASE.getProjectBackups();
  check('tombstone visible with deletedAt set', read2.ok && read2.backups[0].deletedAt !== null, read2.backups);
  const plan5 = Vault.plan([localNew], read2.backups);
  check('newer local edit survives a tombstone (kept as push)', plan5.toPush.length === 1 && plan5.toAdopt.length === 0 && plan5.toDropLocal.length === 0, plan5);
  const localStale2 = mkProject('proj-1', 'Acme Site (old)', Date.now() - 60000);
  const plan5b = Vault.plan([localStale2], read2.backups);
  check('deletion beats stale local → drop local', plan5b.toDropLocal.length === 1 && plan5b.toAdopt.length === 0 && plan5b.toPush.length === 0, plan5b);

  console.log('== resurrection after delete ==');
  const push2 = await SUPABASE.saveProjectBackup('proj-1', 'Acme Site', mkProject('proj-1', 'Acme Site', Date.now()));
  check('re-save after delete → saved', push2.ok && push2.outcome === 'saved', push2);
  const read3 = await SUPABASE.getProjectBackups();
  check('tombstone cleared on re-save', read3.ok && read3.backups[0].deletedAt === null, read3.backups);

  console.log('== refusals ==');
  const bad1 = await SUPABASE.saveProjectBackup('', 'nope', {});
  check('empty project id refused', bad1.ok && bad1.outcome === 'bad-input', bad1);
  const bad2 = await SUPABASE.saveProjectBackup('proj-2', 'nope', null);
  check('null payload refused', bad2.ok && bad2.outcome === 'bad-input', bad2);
  const huge = mkProject('proj-big', 'Huge', Date.now());
  const tooBig = JSON.parse(JSON.stringify(huge));
  tooBig.site.sections.push({ type: 'features', id: 'pad', text: 'x'.repeat(7 * 1024 * 1024) });
  const bigPrep = Vault.pushPayload(tooBig);
  check('vault.js skips oversized payloads client-side', bigPrep.ok === false && bigPrep.reason === 'too-large', { ok: bigPrep.ok, reason: bigPrep.reason });
  const bigJson = JSON.stringify(tooBig);
  check('oversized body really exceeds the 6MB ceiling', bigJson.length > 6291456);
  const bigRes = await fetch(URL + '/rest/v1/rpc/save_project_backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + JSON.parse(localStorage.getItem('pallettai.supabase.session.v1')).accessToken },
    body: JSON.stringify({ p_project_id: 'proj-big', p_name: 'Huge', p_payload: tooBig })
  });
  check('registry refuses oversized payload (413)', bigRes.status === 413, bigRes.status);
  const clientBig = await SUPABASE.saveProjectBackup('proj-big', 'Huge', tooBig);
  check('client surfaces too-large honestly', clientBig.ok === false && clientBig.tooLarge === true, clientBig);

  console.log('== second account isolation ==');
  await SUPABASE.signOut();
  await SUPABASE.signUp('vault-b@test.local', 'password123');
  const read4 = await SUPABASE.getProjectBackups();
  check('account B sees an empty vault', read4.ok && read4.backups.length === 0, read4.backups);

  console.log('\n' + (fail ? 'VAULT SMOKE FAILED — ' + fail + ' failure(s)' : 'VAULT SMOKE PASSED') + `  (${pass} passed, ${fail} failed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('vault smoke crashed:', e); process.exit(1); });

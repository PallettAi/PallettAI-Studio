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
//   * signed-out / bad-input refusals (including: a refusal is not a "save")
//   * oversized payload: UTF-8 byte ceiling, RPC outcome AND proxy 413
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

  console.log('== content-aware merge (new) ==');
  // Identical content with equal timestamps is a quiet no-op — this is what
  // stops a settled sync from re-adopting its own last push forever.
  const sameA = mkProject('proj-1', 'Acme Site (new)', 1000);
  const sameB = mkProject('proj-1', 'Acme Site (new)', 1000);
  const planEq = Vault.plan([sameA], [{ projectId: 'proj-1', name: 'x', payload: sameB, updatedAt: 9999, deletedAt: null }]);
  check('same updatedAt + same content → quiet no-op', planEq.toPush.length === 0 && planEq.toAdopt.length === 0 && planEq.conflicts.length === 0, planEq);
  // Equal timestamps but genuinely different edits → converge on the cloud
  // row, with the diverged local flagged for a 'conflict' archive.
  const diffB = mkProject('proj-1', 'Acme Site (edited elsewhere)', 1000);
  const planCf = Vault.plan([sameA], [{ projectId: 'proj-1', name: 'x', payload: diffB, updatedAt: 9999, deletedAt: null }]);
  check('same updatedAt + different content → adopt cloud + conflict flagged', planCf.toAdopt.length === 1 && planCf.conflicts.length === 1 && planCf.conflicts[0].id === 'proj-1', planCf);
  // Bookkeeping (the adopt-time vault meta) never counts as divergence.
  const withMeta = Vault.withVaultMeta(mkProject('proj-1', 'Acme Site (new)', 1000), { updatedAt: 1000 });
  const planMeta = Vault.plan([withMeta], [{ projectId: 'proj-1', name: 'x', payload: mkProject('proj-1', 'Acme Site (new)', 1000), updatedAt: 9999, deletedAt: null }]);
  check('adopted vault meta does not look like divergence', planMeta.conflicts.length === 0 && planMeta.toPush.length === 0, planMeta);
  // Key order is not content: eq is structural.
  const reordered = JSON.parse('{"site":{"sections":[{"type":"hero","id":"s1","title":"Acme Site (new)"}],"tagline":"t","name":"Acme Site (new)"},"suites":[],"updatedAt":1000,"id":"proj-1","name":"Acme Site (new)"}');
  check('eq ignores key order', Vault.eq(sameA, reordered) === true);
  const planOrder = Vault.plan([sameA], [{ projectId: 'proj-1', name: 'x', payload: reordered, updatedAt: 9999, deletedAt: null }]);
  check('key-order-only difference merges as a no-op', planOrder.toPush.length === 0 && planOrder.conflicts.length === 0, planOrder);
  // Identical content is a no-op even when the CLOUD looks newer: there is
  // nothing to adopt, nothing to push and no phantom conflict to archive.
  const planIdenticalNewer = Vault.plan(
    [mkProject('proj-1', 'Acme Site (new)', 1000)],
    [{ projectId: 'proj-1', name: 'x', payload: mkProject('proj-1', 'Acme Site (new)', 5000), updatedAt: 9999, deletedAt: null }]
  );
  check('cloud newer but identical content → quiet no-op', planIdenticalNewer.toAdopt.length === 0 && planIdenticalNewer.toPush.length === 0 && planIdenticalNewer.conflicts.length === 0, planIdenticalNewer);
  // A payload that predates updatedAt stamping must not be re-pushed on every
  // sync forever — identical content is identical, dated or not.
  const undated = mkProject('proj-1', 'Acme Site (new)', 1000);
  delete undated.updatedAt;
  const undatedCloud = mkProject('proj-1', 'Acme Site (new)', 1000);
  delete undatedCloud.updatedAt;
  const planUndated = Vault.plan([undated], [{ projectId: 'proj-1', name: 'x', payload: undatedCloud, updatedAt: 9999, deletedAt: null }]);
  check('payload without updatedAt + identical content → no churn', planUndated.toPush.length === 0 && planUndated.toAdopt.length === 0, planUndated);

  console.log('== delete tombstone ==');
  const del = await SUPABASE.deleteProjectBackup('proj-1');
  check('delete outcome deleted', del.ok && del.outcome === 'deleted', del);
  const read2 = await SUPABASE.getProjectBackups();
  check('tombstone visible with deletedAt set', read2.ok && read2.backups[0].deletedAt !== null, read2.backups);
  // A local copy identical to the state the delete archived IS the deleted
  // state: the delete wins even when the local clock runs ahead, so clock skew
  // can never resurrect a project another machine deleted.
  const sameAsDeleted = mkProject('proj-1', 'Acme Site (new)', Date.now() + 60000);
  const planSame = Vault.plan([sameAsDeleted], read2.backups);
  check('local copy identical to the deleted state → delete wins (no skew resurrection)', planSame.toDropLocal.length === 1 && planSame.toPush.length === 0 && planSame.toAdopt.length === 0, planSame);
  // A genuinely newer edit (different content, later payload clock) is work the
  // delete never saw, so it survives as a resurrection push.
  const localNewerEdit = mkProject('proj-1', 'Acme Site (resurrected)', Date.now() + 60000);
  const plan5 = Vault.plan([localNewerEdit], read2.backups);
  check('newer local edit survives a tombstone (kept as push)', plan5.toPush.length === 1 && plan5.toAdopt.length === 0 && plan5.toDropLocal.length === 0, plan5);
  const localStale2 = mkProject('proj-1', 'Acme Site (old)', Date.now() - 60000);
  const plan5b = Vault.plan([localStale2], read2.backups);
  check('deletion beats stale local → drop local', plan5b.toDropLocal.length === 1 && plan5b.toAdopt.length === 0 && plan5b.toPush.length === 0, plan5b);

  console.log('== resurrection after delete ==');
  const push2 = await SUPABASE.saveProjectBackup('proj-1', 'Acme Site', mkProject('proj-1', 'Acme Site', Date.now()));
  check('re-save after delete → saved', push2.ok && push2.outcome === 'saved', push2);
  const read3 = await SUPABASE.getProjectBackups();
  check('tombstone cleared on re-save', read3.ok && read3.backups[0].deletedAt === null, read3.backups);

  console.log('== version archive (Part 6b) ==');
  // Fresh project with two distinct saves: the second push carries
  // p_local_updated_at, the server sees it overwrite a different state
  // and archives the stored payload first.
  const v1 = mkProject('proj-ver', 'Version One', Date.now() - 30000);
  const pushV1 = await SUPABASE.saveProjectBackup('proj-ver', 'Version One', v1);
  check('version target pushed', pushV1.ok, pushV1);
  const v2 = mkProject('proj-ver', 'Version Two', Date.now() - 10000);
  const pushV2 = await SUPABASE.saveProjectBackup('proj-ver', 'Version Two', v2, null, v2.updatedAt);
  check('overwrite push saved', pushV2.ok, pushV2);
  const lv1 = await SUPABASE.listProjectBackupVersions('proj-ver');
  check('server archived the overwritten state', lv1.ok && lv1.versions.length === 1 && lv1.versions[0].reason === 'pre-save', lv1);
  const gv1 = await SUPABASE.getProjectBackupVersion('proj-ver', lv1.versions[0].id);
  check('archived payload round-trips intact', gv1.ok && gv1.payload && gv1.payload.site.sections[0].title === 'Version One', gv1.payload);
  // Re-saving the SAME state must not spam the archive.
  await SUPABASE.saveProjectBackup('proj-ver', 'Version Two', v2, null, v2.updatedAt);
  const lv2 = await SUPABASE.listProjectBackupVersions('proj-ver');
  check('same-state re-save does not archive again', lv2.ok && lv2.versions.length === 1, lv2);
  // Explicit conflict copy (what the client files for a diverged local).
  const cfSave = await SUPABASE.saveProjectBackupVersion('proj-ver', mkProject('proj-ver', 'Lost Race Edit', Date.now() - 5000), 'conflict');
  check('conflict copy accepted', cfSave.ok, cfSave);
  const lv3 = await SUPABASE.listProjectBackupVersions('proj-ver');
  check('conflict copy listed newest-first', lv3.ok && lv3.versions.length === 2 && lv3.versions[0].reason === 'conflict', lv3);
  // Deleting files the live payload as recoverable history.
  await SUPABASE.deleteProjectBackup('proj-ver');
  const lv4 = await SUPABASE.listProjectBackupVersions('proj-ver');
  check('delete archives a pre-delete version', lv4.ok && lv4.versions.length === 3 && lv4.versions[0].reason === 'pre-delete', lv4);
  const miss = await SUPABASE.getProjectBackupVersion('proj-ver', 999999);
  check('unknown version → honest not-found', miss.ok === false, miss);
  const none = await SUPABASE.listProjectBackupVersions('proj-never-archived');
  check('project without history → empty list', none.ok && none.versions.length === 0, none);

  console.log('== refusals ==');
  // A refusal answered with an outcome must NEVER be reported as a save: the
  // caller stamps a sync baseline on ok, so a false ok means a project that is
  // silently never backed up.
  const bad1 = await SUPABASE.saveProjectBackup('', 'nope', {});
  check('empty project id refused (not reported as a save)', bad1.ok === false && bad1.outcome === 'bad-input', bad1);
  const bad2 = await SUPABASE.saveProjectBackup('proj-2', 'nope', null);
  check('null payload refused (not reported as a save)', bad2.ok === false && bad2.outcome === 'bad-input', bad2);

  console.log('== oversized payloads ==');
  const huge = mkProject('proj-big', 'Huge', Date.now());
  const tooBig = JSON.parse(JSON.stringify(huge));
  tooBig.site.sections.push({ type: 'features', id: 'pad', text: 'x'.repeat(7 * 1024 * 1024) });
  const bigPrep = Vault.pushPayload(tooBig);
  check('vault.js skips oversized payloads client-side', bigPrep.ok === false && bigPrep.reason === 'too-large', { ok: bigPrep.ok, reason: bigPrep.reason });
  const bigJson = JSON.stringify(tooBig);
  check('oversized body really exceeds the 6MB ceiling', Vault.byteLength(bigJson) > 6291456);
  // The ceiling is UTF-8 BYTES (`octet_length`), not UTF-16 code units: this
  // payload is well under 6 M characters but over 6 MB of bytes, so measuring
  // chars would let the server refuse a project the client thought was fine.
  const wide = mkProject('proj-wide', 'Wide', Date.now());
  wide.site.sections.push({ type: 'features', id: 'pad2', text: '\u20ac'.repeat(2200000) });
  const widePrep = Vault.pushPayload(wide);
  check('byte length is the unit the client measures', Vault.byteLength('\ud83d\ude00') === 4, Vault.byteLength('\ud83d\ude00'));
  check('multi-byte payload refused on bytes though its char count fits', widePrep.ok === false && widePrep.reason === 'too-large', { ok: widePrep.ok, chars: JSON.stringify(wide).length });
  // schema.sql Part 6 is a jsonb function: a refusal comes back as HTTP 200 with
  // an outcome, so the client has to refuse it there, not at the status code.
  const bigRes = await fetch(URL + '/rest/v1/rpc/save_project_backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: 'Bearer ' + JSON.parse(localStorage.getItem('pallettai.supabase.session.v1')).accessToken },
    body: JSON.stringify({ p_project_id: 'proj-big', p_name: 'Huge', p_payload: tooBig })
  });
  const bigBody = await bigRes.json().catch(() => ({}));
  check('registry reports too-large as an outcome, not an HTTP error', bigRes.status === 200 && bigBody.outcome === 'too-large', { status: bigRes.status, body: bigBody });
  const clientBig = await SUPABASE.saveProjectBackup('proj-big', 'Huge', tooBig);
  check('client surfaces too-large honestly', clientBig.ok === false && clientBig.tooLarge === true, clientBig);
  const afterBig = await SUPABASE.getProjectBackups();
  check('the refused project was never stored', afterBig.ok && !afterBig.backups.some((b) => b.projectId === 'proj-big'), afterBig.backups && afterBig.backups.map((b) => b.projectId));
  // A proxy that rejects the body before the RPC ever runs must land the same way.
  const realFetch = global.fetch;
  let proxyBig;
  try {
    global.fetch = async (u, i) => {
      if (String(u).includes('/rpc/save_project_backup')) {
        return new Response('{"code":"413","message":"payload too large"}', { status: 413, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(u, i);
    };
    proxyBig = await SUPABASE.saveProjectBackup('proj-big2', 'Huge', mkProject('proj-big2', 'Huge', Date.now()));
  } finally {
    global.fetch = realFetch;
  }
  check('a 413 from a proxy is surfaced too-large too', proxyBig && proxyBig.ok === false && proxyBig.tooLarge === true, proxyBig);
  // The version archive shares the ceiling and the outcome shape.
  const bigVer = await SUPABASE.saveProjectBackupVersion('proj-big', tooBig, 'conflict');
  check('oversized archive copy refused with tooLarge', bigVer.ok === false && bigVer.tooLarge === true, bigVer);

  console.log('== second account isolation ==');
  await SUPABASE.signOut();
  await SUPABASE.signUp('vault-b@test.local', 'password123');
  const read4 = await SUPABASE.getProjectBackups();
  check('account B sees an empty vault', read4.ok && read4.backups.length === 0, read4.backups);
  const lvB = await SUPABASE.listProjectBackupVersions('proj-ver');
  check("account B sees none of account A's versions", lvB.ok && lvB.versions.length === 0, lvB);

  console.log('\n' + (fail ? 'VAULT SMOKE FAILED — ' + fail + ' failure(s)' : 'VAULT SMOKE PASSED') + `  (${pass} passed, ${fail} failed)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('vault smoke crashed:', e); process.exit(1); });

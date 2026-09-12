// ============================================================
// PallettAI Studio — cloud project vault (pure logic)
// Merge/payload engine behind Settings ▸ Cloud backup. No DOM,
// no fetch — the app drives it against SUPABASE and the smoke
// test drives it against the mock registry.
//
// Merge rules (last-writer-wins, delete-wins-over-stale):
//   * Local project newer than cloud copy        → push local
//   * Cloud copy newer than local project        → adopt cloud
//   * Tombstoned (deleted) in cloud, local older → local is gone
//   * Equal timestamps but different content     → push local (deterministic:
//     the device that just saved is the one the user is sitting at)
// ============================================================

'use strict';

const Vault = (() => {
  const MAX_PUSH_BYTES = 6 * 1024 * 1024; // mirrors the 6 MB RPC ceiling

  // Whole-project JSON string for the vault. `null` when the project cannot
  // be serialized (corrupt model) — callers skip it.
  function serializeProject(p) {
    try { return JSON.stringify(p || null); } catch (e) { return null; }
  }

  // Basic shape check for a cloud payload before it is adopted as a project.
  function looksLikeProject(p) {
    return !!(p && typeof p === 'object' && p.site && typeof p.site === 'object'
      && Array.isArray(p.site.sections) && typeof p.id === 'string' && p.id);
  }

  // Attach cloud bookkeeping to an adopted project without changing its identity.
  function withVaultMeta(p, row) {
    try {
      const copy = JSON.parse(JSON.stringify(p));
      copy.vault = { updatedAt: (row && row.updatedAt) || Date.now(), syncedAt: Date.now() };
      return copy;
    } catch (e) { return p; }
  }

  // ---------- plan(): what should happen for each cloud row ----------
  // locals: array of local projects (full models)
  // rows:   array of { projectId, name, payload, updatedAt, deletedAt }
  // Returns { toPush: [project], toAdopt: [project], toDropLocal: [id] }
  function plan(locals, rows) {
    const byId = new Map();
    (Array.isArray(locals) ? locals : []).forEach((p) => {
      if (p && typeof p.id === 'string' && p.id) byId.set(p.id, p);
    });

    const toPush = [];
    const toAdopt = [];
    const toDropLocal = [];
    const seen = new Set();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (!row || !row.projectId || seen.has(row.projectId)) return;
      seen.add(row.projectId);
      const local = byId.get(row.projectId);

      if (row.deletedAt && (!local || (local.updatedAt || 0) <= (row.deletedAt || 0))) {
        // Deleted in the cloud after the local edit: the deletion wins.
        if (local) toDropLocal.push(local.id);
        return;
      }

      if (!local) {
        // Only exists in the cloud (or was resurrected there): adopt it.
        if (looksLikeProject(row.payload)) toAdopt.push(row.payload);
        return;
      }

      const localAt = local.updatedAt || local.createdAt || 0;
      if ((row.updatedAt || 0) > localAt) toAdopt.push(row.payload);
      else toPush.push(local);
    });

    // Cloud has never heard of these: push everything the account owns.
    byId.forEach((p, id) => { if (!seen.has(id)) toPush.push(p); });

    return { toPush, toAdopt, toDropLocal };
  }

  // ---------- payload for one push ----------
  // Returns { ok, projectId, name, payload } or { ok: false, reason }.
  function pushPayload(p) {
    const json = serializeProject(p);
    if (json == null) return { ok: false, reason: 'serialize' };
    if (json.length > MAX_PUSH_BYTES) return { ok: false, reason: 'too-large', size: json.length };
    return { ok: true, projectId: p.id, name: String((p.site && p.site.name) || p.name || 'Untitled'), payload: p };
  }

  // ---------- one push round (given a save function) ----------
  // saveFn(projectId, name, payload) → { ok } — provided by the caller
  // (app.js binds SUPABASE.saveProjectBackup; the smoke test binds the
  // mock RPC through SUPABASE too). Never throws; per-project failures
  // are collected so one bad project cannot abort the whole sync.
  async function pushAll(projects, saveFn) {
    const results = { pushed: 0, failed: 0, skipped: 0, errors: [] };
    for (const p of Array.isArray(projects) ? projects : []) {
      const prep = pushPayload(p);
      if (!prep.ok) { results.skipped++; results.errors.push({ id: p && p.id, reason: prep.reason }); continue; }
      try {
        const r = await saveFn(prep.projectId, prep.name, prep.payload);
        if (r && r.ok) results.pushed++;
        else { results.failed++; results.errors.push({ id: prep.projectId, reason: (r && r.msg) || 'save failed' }); }
      } catch (e) {
        results.failed++;
        results.errors.push({ id: prep.projectId, reason: (e && e.message) || 'save failed' });
      }
    }
    return results;
  }

  return { plan, pushPayload, pushAll, serializeProject, looksLikeProject, withVaultMeta, MAX_PUSH_BYTES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Vault;

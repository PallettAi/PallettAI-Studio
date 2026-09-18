# Handoff — Cloud Vault: verified + enhanced

For the lead agent. Uncommitted working-tree change set, alongside other agents' work. No git operations were performed.

## Verification

- `scripts/vault-smoke.js` — **43/43 checks pass** against the mock registry (was 25).
- Full `npm run release:check` — **PASSED** (syntax, all smoke suites, builder output).

## The audit verdict

The vault was already solid: RLS-scoped table, security-definer RPCs with advisory locks, tombstoned deletes, LWW merge engine, and a live mock-registry smoke suite. Found and fixed **five real defects**, then added version history on top.

## Defects fixed (behaviour changes)

1. **Self-adopt churn** — `plan()` compared the cloud row's server `updated_at` against the local device clock. Every later save on the same machine looked "cloud newer", so each sync re-adopted the project's own last push (churn + false "restored" toasts). Now: content-aware comparison via canonical structural equality (`Vault.eq`, key-order and bookkeeping-insensitive). Identical content = quiet no-op.
2. **Clock-skew comparisons** — device clocks were compared against server stamps. Now payload `updatedAt` (device clock, travels inside the payload) is only compared against other payload stamps; the server stamp is used only against tombstones.
3. **Silent divergence loss** — when both sides genuinely diverged, the loser was destroyed with no trace. Now the losing local state is archived as a `'conflict'` version **before** the adopt overwrites it (recoverable from history).
4. **Tombstone fall-through** — a deleted row whose payload looked "newer" could reach the content comparison and get re-adopted. Tombstones now short-circuit: delete wins over stale, a locally newer edit survives as a resurrection push.
5. **Concurrent sync race** — a debounced save-sync and a "Back up now" click could interleave (read→plan→write across two loops). Added a single-flight `vaultSyncing` guard.

## New: version history (schema.sql Part 6b)

- `project_backup_versions` table (owner-scoped RLS, newest-10 self-pruning per project, `reason ∈ pre-save | conflict | pre-delete`).
- **Version guard inside `save_project_backup`** (new optional `p_local_updated_at` param): overwriting a *different* historical state archives the stored payload first, atomically under the same advisory lock. Same-state re-saves never spam the archive.
- `delete_project_backup` archives the live payload → deletions are recoverable from history.
- New RPCs: `save_project_backup_version`, `list_project_backup_versions`, `get_project_backup_version` (metadata list; full payload only via owner-scoped get). The mock registry mirrors all of it.
- Restore is deliberately a normal client push (restore → `updatedAt = now()` → audited save path); the push archives the state it replaces, so a restore is itself undoable.

## New: UI (Settings ▸ Account & billing ▸ Cloud backup)

- **Version history** button → modal: project picker, archive list (timestamp, reason label, size), Restore per row. Restores land locally and sync as the newest save.

## Files touched

`supabase/schema.sql` (Part 6b + guards in the Part 6 RPCs) · `scripts/mock-supabase.js` · `modules/supabase.js` · `data/vault.js` (merge engine rewrite) · `app.js` (sync flow + history UI) · `scripts/vault-smoke.js` (18 new checks).

## Suggested next steps (not built)

Version restore from the dashboard project card; server-side quota enforcement for Pro tiers.

---

# Follow-up pass — bugs fixed, features added

`scripts/vault-smoke.js` — **51/51 checks pass** (was 43). Full `npm run release:check` passes.

## Real defects found and fixed

1. **Oversized saves were reported as successes.** `save_project_backup` is a `jsonb` RPC: its `too-large` refusal comes back as HTTP **200** with `{outcome:'too-large'}`, but the client only looked at the status code, so it returned `{ok:true, outcome:'too-large'}`. The caller then stamped a sync baseline for a project that was never stored — a silent permanent backup gap. The client now reads the outcome and refuses `too-large` / `bad-input` / `not-signed-in`; a proxy's 413 still lands the same way. (The mock was lying here too: it returned 413 where the real schema returns 200, so the client's outcome check was never exercised. Mock now mirrors the schema.)
2. **The 6 MB ceiling was measured in the wrong unit.** The client compared `JSON.stringify(p).length` — UTF-16 code units — while the RPC measures `octet_length` (UTF-8 bytes). Emoji/accented copy could pass the client check and be refused server-side, or measure over and waste a round-trip. `Vault.byteLength` now uses `TextEncoder`; mock and tests follow.
3. **`updatedAt` was treated as content.** A timestamp-only difference between two devices looked like a divergence, so an unchanged project that had merely been re-saved elsewhere produced a phantom `conflict` archive on every sync. `Vault.eq` now ignores the merge clock (and the `vault` meta) — identical content is identical, dated or not. This is also what ends churn for payloads that predate `updatedAt` stamping (previously re-pushed on *every* sync because `cloudAt === 0`).
4. **Tombstones were decided by comparing a device clock to the server stamp** — the one cross-clock comparison the engine's own header says it avoids. A machine with a fast clock would resurrect what another machine deliberately deleted. The tombstoned row still carries the payload it held, so the decision is now content + payload-clock based: identical to the deleted state → delete wins; genuinely newer edit → resurrection push; otherwise → delete wins.
5. **"Back up now" could silently do nothing** while a background sync held the lock (it returned `busy` and the button just re-enabled). The click now waits for idle and runs its own full pass. Conversely, an autosave that landed mid-sync was previously dropped; the debounce path now queues one follow-up pass.
6. **Restore claimed a sync that might never happen.** `scheduleVaultPush()` required an open project (`current()`), so restoring from vault history while on the dashboard never reached the cloud. The debounce is now one vault-wide timer independent of any open project — restores, imports and deletes all sync.
7. **A failed push retried forever.** `if (planOut.toPush.length) saveProjects()` rescheduled a sync (saveProjects debounces one), so a project that can never be pushed — too large, or failing server-side — retried every few seconds indefinitely. Persistence now happens only when something actually landed (`push.pushed`).
8. **A long session outlived its access token.** Nothing refreshed it after launch, so ~1h in, the first cloud call 401'd, cleared the session and signed the account out over routine work. Fixed centrally, below.
9. **The history picker only knew local projects**, so a project deleted on another device — tombstoned, with its last state archived — was unreachable. The picker is now the union of local projects and cloud rows (labelled `deleted in the cloud` / `cloud only`), and restoring one resurrects it deliberately (fresh `updatedAt` beats the tombstone).

## Central fix: expired access tokens refresh themselves

`modules/supabase.js` now owns token expiry for **every** authenticated call, not just the vault (`_authedResponse` + `_refreshSession`):

- Any authenticated request that comes back **401** refreshes the session and is **replayed exactly once**. This covers vault reads/writes, account and profile reads, credits, streak, licence activation, referral redemption, password change, and the translate / Dodo-checkout edge functions.
- The refresh is **single-flight**: three parallel reads 401-ing at the same instant produce one refresh request, not three, and no racing session writes. The caller's abort signal is deliberately not threaded into the refresh, so one view closing cannot cancel a refresh another view is waiting on.
- A **dead** refresh token still fails honestly: one retry, then the original 401 clears the session and the UI asks for a sign-in. No loop, no false "offline".
- Bearer headers are rebuilt **per request** (`_authHeaders`) instead of being captured when a caller was constructed — a captured token is precisely the one the server just rejected.
- The bespoke "refresh if near expiry" guard in the vault sync was removed; one mechanism now owns this.

Mock + tests: `GET /__expireTokens` forgets every issued access token (refresh tokens still work), reproducing an hour passing. `scripts/supabase-smoke.js` grew from 25 to **34 checks**: the retry, the replaced token, an RPC recovering, the account staying signed in, and the dead-refresh-token path clearing the session.

## New: UI

- Cloud backup card: **usage meter** (projects + bytes in the cloud vs. projects on this device, plus anything too large to sync), conflict-snapshot count on the last-sync line, and CSS for the previously unstyled `vault-status` row.
- Version history modal: per-version **Compare** (inline diff via the extracted `revisionDiffBody`, reused by `openRevisionDiff`) and an inline 2-step **Restore** confirmation — no nested modal, the archive stays on screen.

## Files touched

`data/vault.js` · `modules/supabase.js` · `scripts/mock-supabase.js` · `scripts/vault-smoke.js` · `scripts/supabase-smoke.js` · `app.js` · `styles.css` · `README.md`. No git operations; the sibling `pallettai-win-build` worktree was left untouched.

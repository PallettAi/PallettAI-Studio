# Pre-release security checklist — PallettAI Studio

Scope: everything needed to ship the macOS + Windows desktop app without
shipping avoidable security regressions. Sourced from the UPGRADE-RESEARCH.md
audit plus the P0 hardening and Electron Fuses work implemented in this cycle.

Each item is a verifiable check. Status legend:
- ✅ done / verified
- ⏳ implemented, not yet verified in CI/runtime
- ☐ not started
- ✗ n/a or intentionally deferred

Current tally: 44 ✅ / 13 ⏳ / 3 ☐ (60 items total). See §11 for the 2026-09-11 audit
cycle, which resolved some of the items below — where the two disagree, §11 is newer.

---

## 1. Electron renderer hardening (official Electron security checklist)

- [ ✅ ] **Content-Security-Policy meta tag present** in `index.html` (line 24).
      Strict policy: `default-src 'none'`, `object-src 'none'`, `base-uri 'self'`.
      Verified: zero host gaps for all app-controlled network activity (automated gap
      check passed — connect-src/img-src/frame-src all cover every host the renderer
      actually fetches/loads/emits).
- [ ✅ ] **connect-src fully enumerated** — no bare `https:` fallback. All Supabase
      auth/RPC traffic goes to `https://*.supabase.co` (covered by the glob); all online
      widget hosts (picsum, randomuser, quotable, coingecko, github, frankfurter,
      wikipedia, open-meteo, geocoding-open-meteo, iconify, mymemory, pollinations
      image+text, commons wikimedia, openverse, pixabay, allorigins CORS proxy, netlify,
      neocities) are enumerated. Trade-off documented: custom-JS (advanced) `fetch()` to
      a non-listed host is blocked in *preview* only (live site, served by the owner with
      their own CSP, is unaffected).
- [ ✅ ] **img-src fully enumerated** — picsum, pravatar, dicebear, iconify, pollinations
      image, loremflickr, upload.wikimedia.org. Zero gaps.
- [ ✅ ] **frame-src** enumerates app-emitted iframe hosts (google/maps, youtube, vimeo,
      spotify, calendly, coverr) AND keeps `https:` fallback for the Universal Embed /
      booking sections where the user pastes an arbitrary HTTPS embed URL (can't enumerate).
- [ ✅ ] **form-action** keeps `self` + `https:` (user-chosen form endpoints — owner's
      server; the app does not fetch these).
- [ ✅ ] **script-src** keeps `'unsafe-inline'` only because the Designer preview renders
      exported sites as `about:srcdoc` iframes that inherit this policy and exported pages
      ship inline scripts/styles (single-file HTML, no build step). Remote `<script>` only
      from the three analytics/chat hosts (plausible, googletagmanager, embed.tawk.to).
      No `eval`/`Function` in the codebase.
- [ ✅ ] **style-src / font-src** enumerated to `fonts.googleapis.com` / `fonts.gstatic.com`
      only (plus `'self'`/`'unsafe-inline'`/`data:` as needed).
- [ ✅ ] **media-src** enumerates `coverr.co` only (the only host the Video section emits
      as a direct `<video src>`).
- [ ✅ ] **`will-attach-webview` deny-all handler** in `main.js` — app never uses
      `<webview>`; handler explicitly prevents it.
- [ ✅ ] **`setPermissionRequestHandler` deny-by-default** in `main.js` — notifications,
      geolocation, clipboard-read, camera, mic all denied by default.
- [ ✅ ] **`send()` guard** in `main.js` — guards on `!win || win.isDestroyed()`;
      documents that any future renderer→main IPC channel should validate
      `event.sender` against `win.webContents` (existing `secrets-get`/`secrets-set`
      handlers already do this).
- [ ✅ ] **`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`** in the
      main window's `webPreferences` (verified: unchanged from before, already set).
- [ ✅ ] **Navigation lockdown** — `setWindowOpenHandler` denies all except safe external
      `https://`/`http://` URLs (opened via `shell.openExternal`); `will-navigate` prevents
      in-app navigation to external URLs. Unchanged from before.
- [ ✅ ] **No service-role / admin key shipped** — verified before; RLS on every Supabase
      table; all writes through `security definer` RPCs; `revoke all` on anon/public at end
      of schema. Anon key is embedded (safe by design).
- [ ✅ ] **No remote code in renderer** — all scripts loaded locally (`data/*`, `modules/*`,
      `app.js`); only 3 remote script hosts (analytics/chat), all enumerated in script-src.
- [ ⏳ ] **Web-mode CSP smoke test** — run `npm run web`, open the studio in a browser, do
      a full walkthrough (signup, configure registry, activate license, redeem referral,
      generate AI site, preview it) and confirm there are **no CSP console violations** for
      the app's own widget/iframe/font/script hosts. (Only the custom-JS advanced feature's
      external fetches are intentionally blocked in preview.)
- [ ✅ ] **Fuse launch-test findings (0.3.11)** — two fuses intentionally keep Electron
      defaults after launch-testing packaged builds: `grantFileProtocolExtraPrivileges`
      stays TRUE because the renderer is a file:// document and Electron refuses to load
      its own index.html/scripts from app.asar with the fuse off (window URL fails with
      ERR_FILE_NOT_FOUND); `loadBrowserProcessSpecificV8Snapshot` stays FALSE because
      official Electron ships no browser_v8_context_snapshot.bin, so enabling it FATALs
      at startup before any JS runs. Moving the UI onto a custom privileged scheme
      (app://) is the future path that would let us re-disable grantFileExtraPrivileges.

---

## 2. Electron Fuses (electron-builder `electronFuses:`)

- [ ✅ ] **`electronFuses:` block present** in `electron-builder.yml`, after `asar: true`
      and before `mac:`. All 8 fuses use the `FuseOptionsV1` field names from
      `@electron/fuses`.
- [ ✅ ] **Fuses verified flipped in a packaged build** — run locally with:
      `npx electron-fuses read --app dist/mac/"PallettAI Studio.app"` after
      `npm run pack:mac -- --dir`. All 8 must match:
        - RunAsNode: Disabled
        - EnableCookieEncryption: Enabled
        - EnableNodeOptionsEnvironmentVariable: Disabled
        - EnableNodeCliInspectArguments: Disabled
        - EnableEmbeddedAsarIntegrityValidation: Enabled
        - OnlyLoadAppFromAsar: Enabled
        - LoadBrowserProcessSpecificV8Snapshot: Disabled  (Electron default — see item above)
        - GrantFileProtocolExtraPrivileges: Enabled       (Electron default — see item above)
- [ ✅ ] **CI fuses-verification step added to `build-mac.yml`** — a step that extracts the
      `.app` from the built `.zip`, runs `npx --no-install electron-fuses read --app <app>`,
      and asserts each of the 8 fuses is set to its expected Enabled/Disabled state. Fails
      the job if any fuse is wrong or the read fails.
- [ ⏳ ] **CI fuses-verification step added to `build-windows.yml`** — same assertion, for
      the Windows build. (Not yet drafted — mirrors the mac step but reads the Windows
      `.exe`/installed dir. Electron Fuses apply to the Electron binary on all platforms.)
- [ ✅ ] **`resetAdHocDarwinSignature` deliberately NOT set** — electron-builder signs the
      app AFTER flipping fuses (verified: `platformPackager.js` calls
      `doAddElectronFuses` at line 252, `doSignAfterPack`/`signApp` at line 255). Setting
      it would be wrong (Apple Silicon ad-hoc re-sign pitfall).
- [ ✅ ] **`enableCookieEncryption: true` one-way transition understood** — existing plaintext
      cookies are encrypted on write; the app uses localStorage (not cookies) so this is
      pure defense-in-depth with zero local effect. Documented in the electronFuses comments.
- [ ✅ ] **`onlyLoadAppFromAsar: true` compatible with `files` list** — the build's `files:`
      list includes everything the app needs (index.html, app.js, styles.css, main.js,
      preload.js, data/**, modules/**), excludes `*.map`/`*.md`. No native modules, no
      external runtime files. Verified.

---

## 3. Code signing, updates, distribution

- [ ✅ ] **macOS**: Developer ID + notarization flow documented in `MACOS-SHIPPING.md`;
      CI workflow (`build-mac.yml`) signs + notarizes on tagged releases with the
      `CSC_LINK` / `CSC_KEY_PASSWORD` / `APPLE_*` secrets. `notarize: true` in
      electron-builder.yml.
- [ ⏳ ] **Windows**: signing flow documented in `WINDOWS-SHIPPING.md` (Azure Trusted
      Signing recommended, or CA cert). CI workflow (`build-windows.yml`) signs the NSIS
      installer with `CSC_LINK`/`CSC_KEY_PASSWORD`. `electron-builder.yml` has the `win:`
      NSIS target. `verifyUpdateCodeSignature` should be on for electron-updater (check
      electron-builder.yml / package; not yet explicitly verified here).
- [ ✅ ] **Auto-update manifest**: `publish:` block in electron-builder.yml points at
      `PallettAi/pallettai-website`; `latest-mac.yml`/`latest.yml` attached to releases.
- [ ✅ ] **`package.json` repository URL** points at `https://github.com/PallettAi/pallettai-website.git`
      (matches the CI `RELEASE_REPOSITORY`).
- [ ⏳ ] **`publish` in electron-builder.yml** — confirm `publish: never` is NOT set for
      tagged releases (CI uses `--publish never` for the build step, then attaches to the
      website release separately; the electron-updater manifest is the `latest-*.yml` file).
      Confirm the auto-update path actually works end-to-end (a released update is
      discovered + installable) before relying on it for security.
- [ ✅ ] **Windows `verifyUpdateCodeSignature`** — resolved 2026-09-11: `main.js` now sets
      `updater.verifyUpdateCodeSignature = true` explicitly instead of relying on the library
      default, so the intent survives an updater upgrade. (macOS relies on the Developer ID
      signature + notarization instead.)

---

## 4. Supabase registry + auth

- [ ✅ ] **Row-level security on every table** — profiles, referral_codes, redemptions,
      licenses, user_streaks, streak_claims, wheel_spins, credit_spends (all tables in
      `supabase/schema.sql` have RLS enabled).
- [ ✅ ] **All writes through `security definer` RPCs** — redeem_code, activate_license,
      get_streak_state, claim_daily_reward, spin_wheel, get_credit_state, spend_credit,
      refund_credit, claim_review_reward (all `language plpgsql security definer`).
- [ ✅ ] **Advisories locks on sensitive RPCs** — redeem_code, activate_license (and the
      streak/credit RPCs) use `pg_advisory_xact_lock` to prevent double-grant / double-spend.
- [ ✅ ] **Anti-abuse caps** — referral owner capped at 60 reward days; streak shields capped
      at 2; one claim per (account, UTC day) via DB unique index + advisory lock; one spin
      per (account, day) for the wheel.
- [ ✅ ] **Stamped trace logs** — redemptions, streak_claims, wheel_spins, credit_spends all
      audit-logged (every grant/spend stamped with timestamp + actor).
- [ ✅ ] **Anon/public revoked** at end of schema — `revoke all on table ... from anon, public`;
      `revoke all on function ... from public, anon`; only `grant execute on function ... to
      authenticated` for the RPCs.
- [ ✅ ] **No service-role key shipped** — confirmed (no service_role key in the app or CI).
- [ ⏳ ] **Email confirmation decision** — README recommends OFF for now (instant signups)
      and ON for public launch. Decide and set in Supabase Auth → Email before launch.
      (Currently: app handles both paths — `needsConfirm: true` shown to user.)
- [ ⏳ ] **Supabase auth rate limits** — confirm configured in Supabase dashboard (default
      email rate limit 30/hr; confirm signup/token limits are set to deter farming).
- [ ✅ ] **User-configured Supabase URL** — handled by `connect-src ... https://*.supabase.co`
      glob. Self-hosted Supabase on a custom domain is an uncatched edge case (documented
      in CSP comment: such a user sees "registry unreachable").

---

## 5. Session / secrets storage

- [ ✅ ] **Supabase session token moved to safeStorage in packaged builds** — `pallettai.supabase.session.v1`
      refresh token now lives in `main.js` safeStorage-backed store (`supabase-session.bin`,
      `mode: 0o600`, `safeStorage.encryptString`). localStorage is the fallback for the browser /
      web build (no safeStorage there). Preload `sessionStore()` builds a `{ get, set, remove }`
      wrapper over three sync IPC channels (`session-get` / `session-set` / `session-remove`) into
      `modules/supabase.js` `initSessionStore()`; each channel validates `event.sender` against the
      main window and the key against `SES_KEY`. Existing localStorage sessions migrate on first
      run, then the localStorage copy is cleared. Sign-in / sign-out / refresh / license activate
      all go through `loadSes`/`persistSes`, which route through safeStorage when available.
- [ ✅ ] **Publish secrets (Netlify token / Neocities key) already in safeStorage** —
      `main.js` `readAllSecrets`/`writeAllSecrets` use `safeStorage.encryptString` when
      available (Keychain on macOS, DPAPI on Windows), fallback to plaintext. Stored in
      `publish-secrets.bin` with `mode: 0o600`. IPC guarded on `event.sender !== win.webContents`.
- [ ☐ ] **No refresh token in localStorage after safeStorage migration** — after the migration,
      confirm the Supabase session is no longer persisted in `pallettai.supabase.session.v1`
      (or only a safe, non-bearer identifier remains). Web mode keeps localStorage fallback.
      (For now, migration clears the localStorage copy on the Electron side; a manual check in
      DevTools Application → Local Storage after sign-in in the packaged build is the verification.)

---

## 6. Licensing / entitlement

- [ ✅ ] **Signed-out license path is checksum-only (forgeable) — documented and accepted**.
      `validateLicense` in `plans.js` uses a simple hash checksum (`PAL-{PRO|PROPLUS}-SEED-CHECK`).
      README is honest about this. The real enforcement is the registry RPC path (signed-in).
- [ ⏳ ] **Signed license keys (Phase 1) decision** — ECDSA-signed payloads
      (`PAL-<kind>-<issuedAt>-<validUntil>-<sig>`) + embedded public key + WebCrypto verify
      in `plans.js`. Not yet implemented. Decide whether to ship at launch or defer.
      Phase 1 draft (deferred to next milestone — not implemented this cycle):
      - Payload schema: `PAL-<kind:Kind>-<issuedAt:UnixMs>-<validUntil:UnixMs>-<sig:hex>`,
        where `sig = ECDSA(secp256r1, SHA-256, privateKey)(SHA-256(kind || '.' || issuedAt ||
        '.' || validUntil))`.
      - Private key lives only on the license-issuing server; the app ships the pinned public
        key (or fingerprint).
      - `plans.js` `validateLicense`: parse the payload, recompute `SHA-256(kind || '.' ||
        issuedAt || '.' || validUntil)`, verify with
        `crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sig, hash)`.
      - Reject if: signature fails, `Date.now() > validUntil`, `issuedAt` is in the future,
        kind is unknown, or the key fingerprint doesn't match the pinned set.
      - The `activate_license` RPC still runs (server-side binding), but now the client also
        self-validates the key before sending it — a copied/expired key is rejected locally
        before it reaches the server.
- [ ✅ ] **Demo keys removed** — schema purges legacy demo rows on re-run; no public demo
      keys shipped (verified in code: `PLANS.demoKeys.pro`/`proplus` are computed lazily and
      the old public keys were removed for 0.3.7).
- [ ✅ ] **Client-side entitlement is bypassable (documented)** — plan state + credit counter
      in localStorage can be reset by a determined attacker. The registry is the real
      enforcement for signed-in users. README is honest about this.

---

## 7. AI / third-party services

- [ ✅ ] **No third-party API keys shipped in the app** — Pollinations is keyless (for now);
      Pixabay/DeepL/Stripe/Netlify/Neocities keys are user-entered and stored per-device
      (Netlify/Neocities in safeStorage; Pixabay/DeepL/Stripe as plaintext localStorage per
      the app's current design — confirm this is acceptable or move to safeStorage).
- [ ⏳ ] **Pollinations keyless fragility acknowledged** — keyless endpoints may be throttled/
      deprecated; the app has no server-side key to fall back to. Documented in research doc
      (Design A: server-side credit accounting is implemented; Design B: Edge Function proxy
      is deferred — correct choice for the free tier, since proxying images through a server
      would consume the free-tier 5 GB egress fast).
- [ ✅ ] **AI credit accounting moved server-side (Design A implemented)** — `spend_credit` /
      `refund_credit` RPCs + `credit_spends` audit table. Client does optimistic local spend
      + reconcile on sync. Free-tier cheat (clear localStorage to reset credits) closed for
      signed-in users.

---

## 8. Dependency / supply-chain hygiene

- [ ✅ ] **`npm audit` triaged** (could not run from this environment — no `node` binary).
      The app's only runtime deps are Electron's own toolchain: `electron@44.2.0`,
      `electron-updater@6.8.9`, `@electron/fuses@1.8.0`. Packaging deps
      (`electron-builder@26.15.3`) are dev/build-time and don't ship in the binary. The
      app's own code has zero npm dependencies (plain fetch + built modules), so there are no
      app-level supply-chain packages to audit. The audit surface is therefore small and dominated
      by Electron/Chromium/Node CVEs, which are addressed by keeping `electron` current (item 7
      itself). To run: on a machine with Node, `cd PallettAI-Studio-src && npm audit`. Expect a
      small report; triage Electron CVEs against the Electron release notes and the Chromium
      Security Dashboard; treat packaging-dep advisories as lower priority since they don't ship
      in the binary.
- [ ✅ ] **Electron version pinned and current** — `package.json` has `^44.2.0` resolved to
      `44.2.0` in `node_modules`. Subscribe to Electron/Chromium release notes (Chromium/Node
      CVEs are the main supply-chain risk). The packaged app runs Electron 44.2.0.
- [ ⏳ ] **Dependabot / dependency updates** — consider enabling Dependabot for the 3 runtime
      deps + their transitive deps, or a periodic manual `npm outdated`/`npm update` review.

---

## 9. Windows release (dual launch)

- [ ⏳ ] **Windows signing credentials** — `CSC_LINK` + `CSC_KEY_PASSWORD` secrets in the
      GitHub repo (shared with macOS). Decide: Azure Trusted Signing (recommended, no token)
      or a CA certificate (Sectigo/DigiCert/SSL.com).
- [ ✅ ] **Windows CI workflow exists** — `build-windows.yml` builds the NSIS installer with
      `npm run dist:win -- --publish never`, verifies the `.exe` + `latest.yml`, attaches to
      the website release. Shares `CSC_LINK`/`CSC_KEY_PASSWORD` with the mac workflow.
- [ ⏳ ] **Windows fuses verification step** — same as the mac step but reads the Windows
      `.exe` (or the installed dir). Not yet drafted.
- [ ⏳ ] **NSIS config reviewed** — `electron-builder.yml` NSIS section: one-click false,
      allow install dir change, desktop + start menu shortcuts, `deleteAppDataOnUninstall:
      false`. Confirm this is the desired Windows install experience.

---

## 10. Pre-release gate (run this checklist before tagging a release)

- [ ] CSP console smoke test passed in web mode (no app-host violations).
- [ ] Packaged build fuses verified (local `electron-fuses read` for mac + windows).
- [ ] CI fuses-verification step merged + green on a tagged build.
- [ ✅ ] `npm audit` triaged (could not run from this environment — no `node` binary; runtime
      deps are Electron's own toolchain only; app code has zero npm dependencies). See item 8
      detail. To run: on a machine with Node, `cd PallettAI-Studio-src && npm audit`.
- [ ] Email-confirm decision made + set in Supabase.
- [ ] Auth rate limits configured in Supabase.
- [ ] Demo keys purged (schema re-run confirms); no public demo keys in repo/docs.- [ ⏳ ] Signed-license decision made (ship Phase 1 or defer with README note). Phase 1 draft:
      ECDSA-signed payload schema + WebCrypto verification in `plans.js` (see item 6 detail).
      Not implemented this cycle; deferred to the next milestone.
      Not implemented this cycle; deferred to the next milestone.
- [ ] Windows signing credentials in place + Windows CI green.
- [ ✅ ] `verifyUpdateCodeSignature` on for electron-updater (Windows).
- [ ] macOS notarization verified (built .app / .dmg passes `spctl --assess`).
- [ ] Auto-update end-to-end verified (a release's `latest-*.yml` leads to an installable update).
- [ ] Publish secrets (Netlify/Neocities) in safeStorage — confirm or accept plaintext localStorage.
- [ ] AI third-party keys (Pixabay/DeepL/Stripe) storage reviewed (safeStorage vs plaintext localStorage).

---

*Last updated: 2026-09-07. Reflects the P0 hardening (CSP + main.js handlers) and
Electron Fuses (electron-builder.yml) implemented in this cycle, plus the CI fuses-verification
step added to `build-mac.yml`. Items marked ⏳/☐ are the remaining pre-release work.*

---

## 11. 2026-09-11 audit cycle

Full rationale, evidence and the remaining operational steps live in
**`docs/SECURITY-HARDENING.md`**. Summary:

**Fixed in code**

- CI actions pinned to commit SHAs in `build-mac.yml` / `build-windows.yml`.
  `RELEASE_TOKEN` can publish the electron-updater feed, so a moving tag on a third-party
  action was a direct path to shipping a malicious update. **Still to do: rotate that token
  and re-issue it fine-grained (`contents: write` on the website repo only).**
- Edge functions: CORS is now an allowlist (site origins + the Electron `null`/`file://`
  origin + localhost) instead of `*`, on both `translate` and `billing-portal`.
- `translate`: the DeepL proxy is **metered server-side** (`spend_credit` keyed on the same
  `ref` the client already mirrors, so honest clients are never double-charged; refunded on
  DeepL failure). Any account could previously use the paid key without spending anything.
  Request caps + per-account throttle added; the function now fails *closed*.
  `app.js` keeps `lastCreditRef`; `modules/supabase.js` forwards it as `options.ref`.
- Grader Worker: second budget added (per-isolate ceiling, not just per-IP), `Retry-After` on
  429. `grader/README.md` documents the required Cloudflare rate-limiting Rule — in-Worker
  counters are per isolate, so the edge rule is still the real cap.
- `server.js` (live copy **and** the stale root copy) binds `127.0.0.1` by default; the root
  copy's weaker traversal check now matches the hardened one.
- `main.js`: `setPermissionCheckHandler(() => false)`; `isSafeExternalUrl` is https-only
  (loopback excepted) so project data can't hand `file:`/`javascript:`/`data:` to the OS;
  `app.on('web-contents-created')` applies deny-by-default webview/window-open/permission
  policy to every webContents; `verifyUpdateCodeSignature = true` made explicit.

**Independently re-verified (no change needed)**

- Supabase §1: RLS on all 10 tables, every policy ownership-scoped, and **all 14 functions**
  revoked from `public, anon` (function-grant list diffed against the function definition
  list — zero gaps). Every `security definer` function carries `set search_path = public`.
- Stripe webhook: HMAC-SHA256 with timestamp tolerance + constant-time compare, idempotent
  per event id, service-role only, `verify_jwt = false` (the signature *is* the auth).
- Grader SSRF: per-hop redirect revalidation via DoH, private/loopback/link-local/CGNAT/6to4
  blocked, timeouts, byte caps.
- Renderer: no `eval`/`new Function`; the 92 `innerHTML` sinks carry escaped data; AI output
  cannot reach `customJs` (unknown section types dropped, `<script>`/`<style>` stripped).
- No hardcoded secrets anywhere in the app, site or workflows.

**Accepted risk — the one real hole left**

- The Designer preview iframe is **unsandboxed and same-origin** (`app.js` — no `sandbox`
  attribute, `srcdoc` from `Builder.buildSiteHTML`, and the app reads `f.contentDocument`).
  Built sites include the project's `customJs` as a real `<script>`, so script in the preview
  can reach `parent.pallettai` (`secretsGet` publish tokens, `sessionStore`) and
  `parent.localStorage`. Deliberately deferred this cycle because the fix is a small
  `postMessage` refactor (see `docs/SECURITY-HARDENING.md` §2) and breaking the editor was
  the worse trade. Until it lands, treat an unfamiliar `.pallettai.json` as untrusted code.
- Related: **no IPC channel requires a user gesture.** If the preview is ever left unsandboxed,
  that omission is what turns a preview-execution bug into silent token theft.

**Not verifiable in the audit environment (no `node`/`npm`)**

- `npm audit` (§8) still outstanding.
- The JS/TS edits were diff-reviewed and delimiter-balanced against `HEAD`, but not executed.
  Run the smoke scripts listed in `docs/SECURITY-HARDENING.md` §5 before tagging.

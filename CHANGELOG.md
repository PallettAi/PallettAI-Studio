# Changelog — PallettAI Studio

All notable changes to this project. A version here is the string a release
tag carries without its leading `v`; `package.json` and the What's New
registry in `data/release-notes.js` must both carry it, and
`scripts/release-guard.js` refuses to publish a version the public changelog
does not document.

## 0.5.0-rc1 — release candidate

**Status: prepared, not tagged.** See *Release status* at the end. The
content below describes what this tree actually contains, verified by
running the suites named under each heading.

### Core compiler & infrastructure

- **Schema-to-DOM builder** (`modules/builder.js`) — section-based site
  composition with per-project design tokens. Button geometry
  (`--btn-radius`, `--btn-shadow`, `--btn-border`, `--btn-transform-hover`)
  and schema-driven section backgrounds (`pattern-grid`, `pattern-dots`,
  `pattern-noise`, `split-contrast`) both emit **zero bytes when unused**.
- **Scanner-based minifier** (`modules/minifier.js`) — HTML, CSS and JS
  minification that tracks strings, nested template literals, regex
  literals and ASI hazards rather than running regexes over source. All
  three passes are idempotent, and data islands are preserved byte-for-byte.
- **Parallel build pipeline** (`modules/build-pipeline.js`) — page, CSS and
  asset jobs distributed round-robin across `worker_threads` with per-worker
  completion and heap telemetry. Output is byte-identical regardless of
  worker count: results are re-inserted in queue order, so a build is not
  ordered by whichever thread finished first.
- **Incremental compiler** (`modules/incremental-compiler.js`) — a flat,
  indexed AST cache with subtree-precise recompilation, cycle-safe
  dependency invalidation that propagates key→key to a fixed point, and Δt
  timings for the editor preview budget.
- **AST optimiser** (`modules/ast-optimizer.js`) — section tree-shaking and
  CSS pruning that derives runtime-toggled classes (`theme-light`,
  `open`, …) from the document itself, so a class JavaScript adds at runtime
  is not deleted from the stylesheet.
- **Build cache** (`modules/compiler-cache.js`) — content-addressed artefacts
  re-verified on read; a corrupt entry is a miss, never a wrong stylesheet.
- **Profiler** (`modules/compiler-profiler.js`) — `hrtime.bigint()` stage
  timings with self-time excluding children; unmatched stage ends are
  reported rather than fabricated.
- **Atomic project vault** (`modules/project-vault.js`) — validate, write to
  a temp file, `fsync`, rename; rolling snapshots that never drop the
  snapshot just taken.
- **Delta exporter** (`modules/delta-exporter.js`) — changed/added/removed
  sets against a previous manifest. Deletions travel inside the archive as
  data, because a ZIP cannot express an absence.
- **Integrity** (`modules/file-integrity.js`) — signed SHA-256 manifest with
  `selfSigned` / `signatureTrust` reported so a self-signed manifest is not
  mistaken for a tamper-proof one.

### Security

- **SRI and CSP synthesis** (`modules/security-sri.js`) —
  `generateStrictCSP` builds a default-deny policy from *declared*
  dependencies (analytics, forms, widgets) and `injectSRIAndCSPHeaders`
  attaches `sha384` integrity. Two spec rules are enforced rather than
  assumed: a nonce or hash makes the browser **ignore** `'unsafe-inline'`,
  and `frame-ancestors`/`report-uri`/`sandbox` are **ignored in a meta
  tag**. `injectCSPMeta` therefore refuses — with a reason — when a meta
  policy would break the document, which is why the builder ships a
  commented header starter instead.
- **Inline attribute hashing** (`modules/security-csp.js`) — an element hash
  allows a `<script>` element and **cannot** allow an attribute. The builder
  async-loads its font sheet with `onload="this.media='all'"`, so
  `injectSRIAndCSPHeaders` hashes inline event-handler and `style=`
  attributes and permits them with `'unsafe-hashes'`. Without it the policy
  blocks the page's own handler, the sheet never leaves `media="print"` and
  the site renders in fallback fonts — verified against real builder output,
  where the handler digest is `sha384` of `this.media='all'` and
  `'unsafe-inline'` is still never added. The digest is taken over the
  entity-decoded handler source, empty handlers are skipped, and the scan
  blanks `<script>`/`<style>` bodies so a handler mentioned inside JavaScript
  is not mistaken for markup.
- **Credential vault** (`modules/crypto-vault.js`) — AES-256-GCM with PBKDF2
  derivation, and Electron `safeStorage` where a keychain exists.
- **Entitlements** (`modules/entitlements.js`) — offline licence verification
  over the ECDSA key already shipped in `data/refcode.js`, falling back to
  free-tier limits rather than trusting local flags.

### Design DNA, tokens & layout

- **Theme engine** (`modules/theme-engine.js`), **design tokens**
  (`modules/token-exporter.js`), **component styling**
  (`modules/component-styles.js`), **colour extraction and matrixing**
  (`modules/color-extractor.js`, `modules/color-matrix.js`).
- **Fluid typography** (`modules/fluid-typography.js`) and **layout
  variants** (`modules/layout-variants.js`, `modules/responsive-grid.js`).
- **Surface and component libraries** (`modules/surface-shaders.js`,
  `modules/bento-mesh.js`, `modules/component-library.js`,
  `modules/stylebook-generator.js`).
- **Motion** (`modules/motion.js`, `modules/scroll-motion.js`,
  `modules/font-kinetic.js`) and effects (`modules/textures.js`,
  `modules/fx-presets.js`).

### Vision, accessibility & media

- **Media pipeline** (`modules/media.js`), **GPU image processing**
  (`modules/gpuimage.js`), **annotation** (`modules/image-ai-annotator.js`).
- **Contrast checking** — OKLCH-aware palette checks via `data/db.js`,
  consumed by the pre-flight gate in `data/preflight.js`.
- **Compiled-page pre-flight** (`data/preflight.js`) — alt text, links,
  focus order, JSON-LD validity and palette contrast, merged with the model
  gate into one publish verdict.

### SEO, semantic web & vectors

- **Structured data** (`modules/microdata.js`, `modules/rich-snippets.js`,
  `modules/seo-graph.js`), **sitemaps and feeds** (`modules/sitemap.js`,
  `modules/feed-builder.js`), **redirects** (`modules/seo-redirects.js`),
  **canonicals** (`modules/canonical-engine.js`), **hreflang**
  (`modules/geo-hreflang.js`), **internal linking**
  (`modules/internal-linker.js`), **ToC** (`modules/toc-builder.js`),
  **syndication** (`modules/syndication.js`,
  `modules/audio-syndication.js`), **content export**
  (`modules/content-exporter.js`), **search index**
  (`modules/search-index.js`).

### Commerce, motion, PWA & edge

- **Deployment** (`modules/deploy.js`, `modules/deploy-environments.js`)
  for Cloudflare Pages, Netlify and GitHub Pages, with rollback and
  deployment history.
- **Edge configuration** (`modules/edge-headers.js`) — one rule list emitted
  as `_headers`/`_redirects` plus `vercel.json`, header names validated
  against RFC 7230.
- **Commerce** (`modules/cart-router.js`), **forms** (`modules/forms.js`),
  **analytics** (`modules/static-analytics.js`, `modules/analytics.js`),
  **client auth and vault** (`modules/client-auth.js`,
  `modules/client-vault.js`), **filtering**
  (`modules/faceted-filter.js`).
- **Headless build** (`modules/cli-runner.js`) — `--input`, `--out`,
  `--config`, `--parallel`, `--minify`, `--clean-cache`, `--export-zip`,
  `--stats`, `--verbose`, with three outcome codes: `0` success, `2` the
  **input** is unusable, `1` the build broke with valid input.

### Verification

- `scripts/ci-run-all-tests.js` discovers every `*-smoke.js` / `*-check.js`
  suite, runs each in an isolated child process and prints a domain matrix.
  At the time of writing: **132 suites, 128 pass, 4 fail** (see *Known
  issues*), about two minutes wall clock at concurrency 3. Run the runner
  itself for the current figure — suites are being added continuously.
- `scripts/module-surface-smoke.js` loads **every** file in `modules/` and
  `data/` and pins the integration topology: all 92 modules and 78 data files
  load, every module exports at least one function, the four browser-only
  files fail *only* with a "window/document is not defined" reason (so a
  genuine typo still fails), no module exists that this changelog lists as
  undelivered, and `crypto-vault` loads in a plain Node process rather than
  only inside Electron. This is the layer where a failure is total and
  silent: `modules/sitemap.js` once shipped a stray `)` in a template
  literal, so `require()` threw and every caller fell back to "that feature
  does not exist" while looking calm.
- `scripts/ipc-hardening-smoke.js` pins the Electron boundary: all 12 IPC
  channels validate their sender via `fromMainFrame`, `contextIsolation` is
  true and `nodeIntegration` false everywhere, and every member the renderer
  calls on `window.pallettai` exists on the preload bridge and is handled in
  `main.js`.
- `scripts/csp-cli-guards-smoke.js` pins the CSP meta-safety gate against
  **real** builder output, and asserts the parallel export is byte-identical
  to the sequential one.

### Known issues

- Four suites fail in this tree, for one environmental reason and none
  related to the work above: `credit-smoke`, `streak-smoke`,
  `supabase-smoke` and `vault-smoke` need a local Supabase instance
  (`ECONNREFUSED 127.0.0.1:54321`). `release-check` passes.
- Two pairs of modules implement the same concern:
  `modules/security-csp.js` duplicates `generateStrictCSP` /
  `injectSRIAndCSPHeaders` from `modules/security-sri.js`, and
  `modules/cli-engine.js` duplicates `parseArgs` / `resolveOptions` /
  `runHeadlessBuild` / `EXIT` from `modules/cli-runner.js`. Divergent CSP
  implementations are a real hazard — a stale policy is a policy that
  blocks the site it was meant to protect — so one of each pair should be
  chosen deliberately.
- The two CSP modules reach the same conclusion by different routes and the
  API surfaces do not overlap (`default-src 'none'` and a refusal gate in
  `security-sri.js`; `default-src 'self'` with automatic inline hashing in
  `security-csp.js`). Both now allow inline handler attributes by hash. The
  pair is a deliberate, documented duplication rather than a merge: neither
  can be reduced to a re-export of the other without changing the security
  posture a passing suite already pins. Only the brief's two suite files
  (`backend-advanced-v6-smoke.js`, `csp-cli-guards-smoke.js`) assert against
  them.

### Not in this build

The integration briefs named these modules, and they are **absent** from
the tree: `color-harmonizer`, `mesh-gradients`, `token-patcher`,
`vertical-rhythm`, `vision-regression`, `cls-preventer`, `retina-pipeline`,
`contrast-heatmaps`, `topic-cluster`, `site-verification`,
`glossary-builder`, `vector-store`, `pwa-service-worker`, `webhook-queue`,
`micro-search`, `widget-embeds`. Any capability claim resting on them is
not yet true. `scripts/module-surface-smoke.js` asserts their absence, so
one landing later fails the suite and forces the claim to be revisited.

## Release status

`node scripts/release-guard.js v0.5.0-rc1 --changelog ../pallettai-website/changelog.html`

```
  ✓ What's New registry matches 0.4.10
  ✗ tag 0.5.0-rc1 does not match package.json 0.4.10
  ✗ the website changelog has no entry for 0.5.0-rc1 — the release would ship undocumented
RELEASE GUARD FAILED — nothing was published.
```

The guard passes at the current version (`v0.4.10`). Cutting `0.5.0-rc1`
therefore needs three things to move together: `package.json`, the What's
New registry in `data/release-notes.js`, and an entry in
`../pallettai-website/changelog.html` — the last of which lives outside this
repository. Bumping `package.json` alone would turn a passing release gate
into a failing one, and the guard exists precisely because that happened
once before (the 0.4.2 release shipped while the site's changelog said
nothing about it).

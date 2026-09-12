# Security hardening — audit cycle 2026-09-11

Scope: the Electron app, the website, the Supabase registry + edge functions,
the Cloudflare grader Worker, and CI. This file records **what changed**, **what
was deliberately left alone** (and why), and **what still has to be done in a
dashboard** — where no commit can reach.

Read alongside `docs/superpowers/specs/2026-09-07-security-checklist.md`, which
is the running pre-release checklist.

---

## 1. Changed in this cycle

### 1.1 CI release path — actions pinned to SHAs

Both build workflows passed `secrets.RELEASE_TOKEN` (a PAT whose write access
covers the **public website repo, which is also the electron-updater feed**) into
third-party actions referenced by *moving tags*. A moved or compromised tag was
therefore one step away from publishing a malicious auto-update to every
installed app.

- `build-mac.yml` / `build-windows.yml`: `actions/checkout`, `actions/setup-node`,
  `softprops/action-gh-release` and `actions/upload-artifact` are now pinned to
  commit SHAs (with a `# v4` / `# v2` comment). Behaviour is identical to the tag
  refs they replaced; only the immutability changed.
- Comments now state the required token scope at the point of use.

To bump one later: `curl -s https://api.github.com/repos/<owner>/<repo>/commits/<tag>`
and use the returned `sha`.

### 1.2 Edge functions

**CORS is now an allowlist, not `*`** (`translate/index.ts`,
`billing-portal/index.ts`). Allowed: `pallettai.org` + `www`, the packaged
Electron renderer (`Origin: null` / `file://`), and localhost/127.0.0.1 on any
port for `npm run web`. Everything else gets no `Access-Control-Allow-Origin`
header, so a browser cannot read the response. `Vary: Origin` is set.

**The DeepL proxy is metered server-side** (`translate/index.ts`). It previously
required only *a* bearer token, so any account could use the studio's paid DeepL
key without spending anything. Now:

- the request must carry the `ref` the client already mirrors to
  `settleCreditSpend`;
- the function calls `spend_credit(p_ref, 1)` with the **caller's own** JWT —
  the RPC is idempotent on `ref` per account, so this is *the same* spend the
  client makes, never a second one;
- `insufficient` → `402`; an RPC failure or an unexpected outcome → fail
  **closed** (503) rather than serving the paid key unmetered;
- DeepL failing or returning the wrong number of strings triggers
  `refund_credit(ref)`;
- request size is bounded (400 strings, 10 000 chars each, 60 000 total) and
  non-string entries are rejected instead of being coerced to `"[object Object]"`;
- a per-account throttle (30/min per isolate) returns `429` + `Retry-After`.

Client side: `app.js` keeps the ref of the latest `spendCredit()` in
`lastCreditRef`; `modules/supabase.js` `translateSite()` forwards it as
`options.ref`. An older packaged build that omits `ref` gets a `402` and falls
back to the existing MyMemory path — degraded, not broken.

**`billing-portal`**: same CORS allowlist, plus a comment explaining that
`uidFromAuth` decodes without verifying *by design* — the subsequent PostgREST
lookup replays the caller's Authorization header, so RLS is what actually
authorises it.

### 1.3 Grader Worker

The public `/grade` endpoint now has two independent budgets instead of one
per-IP counter: **12 checks/IP/minute** and **90 upstream fetches per isolate
per minute**, both returning `429` with `Retry-After`. The second budget is what
bounds egress when a scraper spreads requests across many IPs — the case a
per-IP counter cannot see. `CF-Connecting-IP` (set by Cloudflare, unspoofable)
remains the key. `grader/README.md` documents the Cloudflare **rate-limiting
Rule that must sit in front of the Worker**, since in-Worker counters are
per-isolate and so only ever approximate a global limit.

### 1.4 Local servers

`server.js` (both the live `PallettAI-Studio-src` copy and the stale root copy)
now binds **127.0.0.1** by default instead of every interface — it serves the
whole app directory, so the old default published the project to whatever
network you were on. `HOST=0.0.0.0` opts back in deliberately.

The stale root `server.js` also had the weaker traversal check; it now matches
the hardened version (`path.resolve` + compare against `ROOT + path.sep`, so a
sibling directory whose name merely *starts with* ROOT can't be reached).

### 1.5 Electron shell (`main.js`)

- **`setPermissionCheckHandler(() => false)`** added next to the existing
  request handler. Denying only *requests* left the synchronous check side
  (`navigator.permissions.query`, capability probes) reporting a better answer
  than a request would have received.
- **`isSafeExternalUrl` is https-only**, with a loopback exception for the dev
  workflow. This value can come from project data, so `http://`, `file:`,
  `javascript:`, `data:` and custom schemes are no longer handed to the OS
  opener.
- **`app.on('web-contents-created')`** applies deny-by-default webview,
  window-open and permission policies to *every* webContents the app creates
  (main window, startup splash, anything added later). The main window installs
  its own window-open handler immediately afterwards, which replaces the
  deny-all, so external links still open in the system browser.
- **`updater.verifyUpdateCodeSignature = true`** is now explicit on Windows
  rather than relying on the library default. (This also resolves the
  contradiction in the 2026-09-07 checklist, which marked the item both done and
  "not yet verified".)

Everything above is additive: no existing handler or behaviour was replaced.

---

## 2. Deliberately NOT changed: the Designer preview iframe

**This is the highest-priority remaining item.** It is recorded here as an
accepted, understood risk — not an oversight.

`app.js` creates `<iframe id="previewFrame">` with **no `sandbox` attribute** and
sets `f.srcdoc = Builder.buildSiteHTML(...)`. An `about:srcdoc` frame inherits
the parent origin, and the app relies on that (it reads `f.contentDocument` to
wire up page links). Built sites legitimately include the project's `customJs`
as a real `<script>` (`jsSafe` only escapes `</script`).

Consequence: script running inside the preview can reach `parent.pallettai` —
i.e. `secretsGet('publish.netlifyToken')`, `secretsSet`, and the
safeStorage-backed `sessionStore()` — plus `parent.localStorage`. The IPC
handlers validate `event.sender === win.webContents`, but a same-origin subframe
*is* that webContents, so the guard passes. The tight CSP still allows exfil to
`https://*.supabase.co` and `api.allorigins.win`.

Trigger: opening a shared/imported `.pallettai.json` (this is a client-work
tool, so project files travel) or pasting a snippet into the "Custom JS
(advanced)" field.

**Why it's deferred this cycle:** the fix is not a one-line attribute. The app's
same-origin `contentDocument` access and the preview's own `localStorage` both
depend on the current setup, so it needs a small refactor, and doing it blind —
without being able to run the app in this environment — risked breaking the
editor.

**The fix when you take it on:**

1. Add `sandbox="allow-scripts"` (deliberately **without** `allow-same-origin`),
   which gives the frame an opaque origin and makes `parent` unreachable.
2. Have `Builder.buildSiteHTML()` inject a tiny `postMessage` bridge for the
   page-link navigation that `renderPreview()` currently wires via
   `contentDocument`; the parent listens and calls `setActivePage`.
3. Optionally go further: have main perform the Netlify/Neocities publish calls
   so the renderer never holds those tokens at all, which independently removes
   the prize for any renderer-execution bug.

Being honest about the blast radius: until step 1 lands, the fuses, safeStorage
and IPC-sender work are all bypassable by anything that executes inside the
preview.

---

## 3. Still to do (no commit can do these)

| # | Action | Where | Why |
|---|---|---|---|
| 1 | **Rotate `RELEASE_TOKEN`** and re-issue it fine-grained: `contents: write` on `PallettAi/pallettai-website` only, short expiry, no other scopes | GitHub org secrets | It can publish the auto-update feed; assume it leaked into any historical CI log or action run |
| 2 | Enable 2FA / org-wide 2FA enforcement; review who has write on the website repo | GitHub | Compromise of that repo = malicious update to every user |
| 3 | Add the Cloudflare **rate-limiting Rule** (20/min per IP on `/grade`); consider Turnstile | Cloudflare dashboard | In-Worker counters are per isolate, so they don't cap globally |
| 4 | Turn **email confirmation ON** and set auth rate limits before public launch | Supabase Auth | Carried over from the 2026-09-07 checklist |
| 5 | Add the **Windows fuses verification** CI step (mirror of the mac one) | `.github/workflows/build-windows.yml` | Windows packaging is otherwise unverified |
| 6 | Run `npm audit` (needs Node) and triage Electron/Chromium CVEs | local machine | Still unverified — this environment has no `node` |
| 7 | `spctl --assess` the built `.dmg`, and confirm auto-update end to end | macOS | Signature/notarization assertions |
| 8 | Decide on the preview fix in §2 | `app.js` + `modules/builder.js` | The one real hole left |
| 9 | If the website is ever fronted by Cloudflare, serve `pallettai-website/_headers` | Cloudflare Pages | GitHub Pages can't set `X-Frame-Options`/HSTS; a meta CSP can't express `frame-ancestors` |

---

## 4. What was verified good (don't redo it)

Supabase: RLS on all 10 tables, every policy ownership-scoped, **all 14
functions revoked from `public, anon`** (list-diffed, zero gaps), all
`security definer` functions pinned `set search_path = public`, nothing granted
to `anon`. Stripe webhook: real HMAC-SHA256 verification, 5-minute tolerance,
constant-time compare, idempotent per event id, service-role only. Grader SSRF
defences: manual redirects revalidated per hop via DoH, private/loopback/
127/8, 10/8, 192.168/16, 169.254/16, CGNAT and 6to4 all blocked, timeouts, byte
caps, `nosniff`. Renderer: no `eval`/`new Function`; the 92 `innerHTML` sinks
carry escaped data; AI output can't reach `customJs` (unknown section types are
dropped and `<script>`/`<style>` stripped from scraped markup). Fuses, asar
integrity, `onlyLoadAppFromAsar`, notarization and the `files:` allowlist all
match their documentation. No hardcoded secrets anywhere (only env reads).

---

## 5. Verification note for this cycle

This environment has **no `node`/`npm`**, so none of the JS/TS changes could be
executed. Each edit was reviewed as a diff and the files' `{}`, `()` and `[]`
balances were compared against `HEAD` (all unchanged, so no unbalanced edit).
Before the next release, run:

```bash
cd PallettAI-Studio-src && npm run release:check
node scripts/security-hardening-smoke.js
node scripts/stripe-entitlement-smoke.js
node scripts/billing-portal-smoke.js
node scripts/ai-translate-smoke.js
cd ../pallettai-website && node grader/ssrf-check.mjs
```

…plus a manual pass: sign in, translate a site (confirm exactly **one** credit
moves), open the billing portal, run a grader check, publish to Netlify.

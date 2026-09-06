# PallettAI Studio — Design & Security Upgrade Research

**Scope:** research only — nothing here is implemented. Prepared for the dual Windows + macOS release.
**Date:** 2026-09-04. Sources: Electron official security docs, electron-builder docs, Supabase docs,
Keygen/Cryptolens licensing docs, referral-fraud industry write-ups, ToDesktop cross-platform UX guide,
Fluent 2 / Liquid Glass design coverage, plus a full audit of the current codebase.

---

## Part A — Design upgrades (cross-platform first)

### A0. Why compatibility is safe here
The app is plain HTML/CSS/JS with zero build step and no native Node modules (deps: electron-updater,
electron-builder — both pure JS). Electron 44 ships the **same Chromium on Windows and macOS**, so all
rendering logic behaves identically. Cross-platform risk is confined to the "chrome" layer:
menus, title bar/window controls, fonts, scrollbars, shortcuts, drag regions, notifications. **Rule of
thumb for this project: keep 100% of the UI in shared code; branch only at the chrome layer** via the
existing `window.pallettai.platform` bridge (darwin/win32) and CSS platform hooks. This is the pattern
used by every major Electron app (VS Code, Slack, Figma).

### A1. Design tokens — the single highest-leverage change (low risk)
Today styles.css hardcodes colors/spacing/radius in many places. Moving to **CSS custom properties**
(design tokens) is zero-runtime-cost, works identically on both platforms, and unlocks everything else:

- Color ramps, spacing scale (4/8/12/16/24/32…), radius scale, elevation/shadows, motion curves.
- Light/dark already exist; tokens make "System theme" (follow `nativeTheme.shouldUseDarkColors`)
  trivial, and let the existing accent-colour feature become a first-class token.
- Per-platform overrides stay tiny: `html.platform-darwin { --control-size: ... }`.

### A2. System fonts instead of web fonts for the UI chrome
The studio UI currently relies on generic stacks. Use the standard cross-platform system stacks
(per Tailwind/ToDesktop guidance) so macOS renders SF Pro and Windows renders Segoe UI naturally:

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  "Helvetica Neue", Arial, "Noto Sans", sans-serif;
```

Google Fonts stay for *client-site content* (a feature), not the studio chrome — this also speeds
launch and removes a dependency.

### A3. Native-feeling window chrome
- **macOS:** keep native traffic lights; consider `titleBarStyle: 'hiddenInset'` + `-webkit-app-region: drag` on the topbar for a modern look. macOS apps expect draggable headers.
- **Windows:** either keep the standard title bar (most predictable) or `titleBarOverlay` + custom
  header (needs `-webkit-app-region: drag` and padding for the overlay controls). Do this last — it's
  the most fiddly part and purely cosmetic.
- Match the native window `backgroundColor` to the app background to kill launch flash (already done: `#0f1020`).

### A4. OS-aware theme & accent (progressive enhancement)
- **Theme:** add "System" option; Electron's `nativeTheme` fires change events, so the app can follow
  the OS live (macOS dark mode + Windows dark mode toggles).
- **Accent:** `systemPreferences.getAccentColor()` is available in Electron on both Windows and macOS —
  offer "Use system accent" next to the existing picker. Falls back cleanly where unsupported.
- **Material:** Windows 11 supports `backgroundMaterial: 'mica'` on BrowserWindow; macOS supports
  `vibrancy`. Both are optional, platform-gated, pure chrome — no web-tech risk. (Liquid Glass on
  macOS 26 and Fluent 2/Mica on Windows 11 are the current platform design languages; adopting even a
  subtle version of each is what makes a cross-platform app feel native on both.)

### A5. Desktop-native interaction polish (both platforms, shared code)
- **Command palette** (⌘K / Ctrl+K): the killer "modern desktop app" upgrade. Search actions, views,
  templates, settings, copilot prompts — Linear/Arc/VS Code pattern. Pure web tech, fully shared code.
- **Context menus:** right-click menus via Electron `Menu.buildFromTemplate` (native menus = free
  platform correctness), wired through the preload bridge — not HTML menus.
- **Text selection & cursor semantics** (desktop convention): `user-select: none` on chrome UI,
  `cursor: default` on buttons, `cursor: pointer` only on links (per ToDesktop guidance).
- **Scrollbars:** macOS overlay vs Windows styled — a few lines of CSS gated by platform class.
- **Notifications:** if ever added, use Electron `Notification` (native on both) and follow platform
  conventions (no error notifications, no sensitive info — per ToDesktop guidance).

### A6. Visual language refresh (taste, low risk)
- Replace emoji icons in the chrome (🏠🎨🗄️…) with an SVG icon set. The app already depends on
  **Iconify** for section emblems — reuse it for the UI chrome (cross-platform safe: it's just SVG).
- Consistent empty states, hover/active/focus states, and a proper modal focus trap + ESC handling
  (today modals have no focus trap — see A7).
- Density: Windows users lean compact, macOS users lean comfortable — you already have a density
  setting; make tokens drive it.

### A7. Accessibility (design + compatibility requirement)
- WCAG 2.2 AA: visible `:focus-visible` rings, 4.5:1 contrast on muted text, `aria-live` on toasts
  (they're dynamic status), labelled icon buttons, `prefers-reduced-motion` (already supported),
  keyboard navigation for every view, modal focus trap.
- Accessibility is a *compatibility* issue too: Windows has a huge assistive-tech population (Narrator/
  NVDA); macOS has VoiceOver. Same DOM = same fix on both.

### A8. Performance (design that feels fast)
- The single 200 KB app.js + 44 KB styles.css re-render via innerHTML everywhere. Cheap wins:
  `content-visibility: auto` on long template/layout lists, lazy-load heavy modules (builder/ai only
  when used — they're separate files already, so `<script defer>` or dynamic import is trivial),
  CSS containment on the designer previews.
- If the Database/Projects lists ever get long: simple windowing (virtual list) — but keep it vanilla.

### A9. Architecture options for the refresh (recommendation)
| Option | Build step | Cross-platform risk | Effort | Fit |
|---|---|---|---|---|
| **A: Stay vanilla + design tokens + component CSS classes** | none | none | low | ✅ best fit — the app's no-build web mode + browser preview stay free |
| B: Web Components (custom elements) for repeated UI (modals, chips, inputs) | none | none (native platform) | medium | ✅ good second phase |
| C: Adopt React/Vue/Svelte + Vite/electron-vite | new (breaks `npm run web` zero-build philosophy) | low but real (build config per platform, CSP source changes) | high | ❌ not recommended unless the UI outgrows vanilla |

**Recommendation: Option A now (tokens + chrome polish + command palette + a11y), Option B later
(Web Components for the modal/toast/chip primitives).** Both keep the browser/web-mode preview intact,
which is a genuine product feature (live client previews) and your cheapest cross-platform test harness.

---

## Part B — Security upgrades

### B0. Current posture (audit result)
**Already strong:** RLS on every Supabase table; all writes flow through security-definer RPCs;
advisory locks on redeem/activate; 60-day referral cap; self-redeem + re-redeem blocked server-side;
stamped trace log; Electron `contextIsolation` + `sandbox` + `nodeIntegration:false`; navigation and
new-window lockdown; HTML-escaping everywhere user content touches DOM/exports; no service-role key;
local fallbacks keep the app honest offline.
**Known trade-offs (documented in README):** signed-out license path is checksum-only (forgeable);
AI credits and plan state live in localStorage (resettable); client-side-only enforcement is always
bypassable by a determined attacker — the registry is the real enforcement.

### B1. Electron hardening (official Electron security checklist — gaps)
The app already passes most of the official checklist; the remaining gaps:

1. **Content-Security-Policy — MISSING (most visible gap).** The dev console warns about it, and it's
   the single biggest renderer hardening step. The app is in a great position: **every script is a
   local file** (index.html loads only `data/*`, `modules/*`, `app.js`), so a strict policy is achievable:
   ```html
   <meta http-equiv="Content-Security-Policy" content="
     default-src 'self';
     script-src 'self';
     style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
     img-src 'self' data: https://picsum.photos https://image.pollinations.ai https://api.dicebear.com https://api.iconify.design https://*.supabase.co;
     connect-src 'self' https://fonts.googleapis.com https://api.iconify.design https://image.pollinations.ai https://text.pollinations.ai https://picsum.photos https://randomuser.me https://api.quotable.io https://en.wikipedia.org https://api.coingecko.com https://api.github.com https://api.frankfurter.app https://api.open-meteo.com https://*.supabase.co;
     frame-src https://www.google.com https://maps.google.com https://open.spotify.com https://calendly.com https://*.typeform.com https://www.figma.com https://player.vimeo.com https://www.youtube.com;">
   ```
   (Exact allowlist must be confirmed against every fetch call in the code before shipping — several
   of the free APIs support CORS; a wrong allowlist would break a feature, so this needs a test pass.)
   The CSP warning is dev-only, but a real XSS→RCE chain is exactly what CSP kills.
2. **`setPermissionRequestHandler`** — deny-all by default for the renderer session (notifications,
   geolocation, clipboard-read, etc.). One call in main.js.
3. **Electron Fuses** (official hardening; `@electron/fuses` is already installed as a transitive dep):
   disable `runAsNode`, `enableNodeCliInspectArguments`, `enableNodeOptionsEnvironmentVariable`;
   enable `cookieEncryption`; `onlyLoadAppFromAsar` once packaged. These stop common
   "turn the app into Node" attack chains (e.g., `ELECTRON_RUN_AS_NODE`).
4. **Validate IPC senders** — the only channel is `menu` (main→renderer). Add a `sender` identity check
   in `webContents.send` paths or restrict to the known window (cheap, prevents any future renderer
   compromise from forging menu actions).
5. **`will-attach-webview` deny-all** — the app doesn't use `<webview>`; explicitly block it
   (attackers who get XSS can otherwise create one).
6. **ASAR integrity** — electron-builder can emit an integrity file and Electron verifies it at
   startup; combined with fuses it defeats tampered-install attacks.
7. **Keep Electron current + dependency hygiene** — Electron 44 is recent; subscribe to release notes
   (Chromium/Node CVEs are the main supply-chain risk), run `npm audit`, consider Dependabot for the
   three runtime deps.

### B2. Code signing & updates on BOTH platforms (prerequisite for "not abused")
- **macOS:** Developer ID + notarization — already fully documented in MACOS-SHIPPING.md and CI.
- **Windows:** SmartScreen will warn on unsigned builds; signing also lets electron-updater verify
  updates. Options: classic **EV certificate** (hardware token — awkward in CI) or the modern
  **Azure Trusted Signing** service (Microsoft's cloud signing — cheap, CI-friendly, the recommended
  path per current Electron Forge/electron-builder guidance). electron-builder supports it.
- **Updates:** electron-updater works on Windows with NSIS installers (`latest.yml` + signed zip);
  ensure `verifyUpdateCodeSignature` is on. Keep one update channel for both OSes in GitHub Releases.
- **Distributables:** NSIS installer for Windows (or MSI via the `msi` target for enterprise);
  skip AppX/Store (electron-updater doesn't support Store updates).

### B3. License & entitlement abuse (the big one)
Current: signed-out = checksum key (trivially forgeable, documented); signed-in = registry RPC
(real). Credits counter + plan live in localStorage (clearing it resets free-tier limits).

**Upgrade ladder (pick based on effort):**
1. **Ship the planned Phase-1 signed keys** (README roadmap): ECDSA-signed payloads
   (`PAL-<kind>-<issuedAt>-<validUntil>-<sig>`), embedded public key, WebCrypto verify in-app.
   Kills key *forging*; doesn't kill key *sharing*.
2. **Node-locked activation** (industry standard — Keygen/Cryptolens and native apps do this):
   machine fingerprint (OS + hardware identifiers via `os` module / systeminformation), one
   activation per device, revocable server-side. Stops casual key sharing; costs a device-binding
   flow. Note: fingerprinting is approximate (MAC spoofing, VM cloning — see real-world bypass
   write-ups); it's a deterrent, not a wall.
3. **Move entitlement state server-side** where it matters: credit accounting via a registry RPC
   (`debit_credit`) instead of a localStorage counter, plan state on the profile (already exists for
   registry licenses). LocalStorage can still cache, but the *authoritative* counter lives in the DB.
4. **Hard enforcement = gate the valuable action server-side**: unbranded export / white-label /
   AI generation through an authenticated endpoint rather than a local check. For a local-first app
   this is a product decision (offline UX vs enforcement) — the honest framing from the README stands:
   client-side can be bypassed; pick what to protect server-side.

### B4. Referral abuse (already hardened — next layer)
Current defenses are solid (advisory locks, 60-day cap, one code per account, self-redeem block,
stamped log). Industry-standard additions, in cost order:
1. **Double opt-in** (voucherify/Stripe guidance): require email confirmation before rewards count —
   this is the single biggest filter for fake accounts. Needs B1's email-sending fix (currently broken
   on the real project — see live-check findings) or Confirm-email OFF + another gate.
2. **Rate-limit signup/redeem** at the Supabase auth level (docs: auth rate limits are configurable;
   default email rate limit is 30/hr with custom SMTP — a farm hits this fast).
3. **Anti-bot on the public redemption page** (ref.html): Cloudflare Turnstile or a honeypot field —
   cheap, kills scripted farming.
4. **Fraud signals + review queue** (unit21/crossclassify/Stripe pattern): flag redemptions where
   redeemer and referrer share IP/device/email pattern; a "pending" state lets you review before
   granting. Overkill at this stage, but the schema (stamped redemptions) already supports it.
5. **Minimum password length + rate limits** (README checklist) — already recommended, still open.

### B5. Service/API abuse ("our services not taken advantage of")
- **Keyless third-party APIs (Pollinations, Picsum, CoinGecko, etc.) are called straight from the
  client.** You can't stop someone scraping them from your app's origin, but you can:
  - Keep the existing graceful fallbacks + caching (already done).
  - When you add a backend (recommended next step), route the hot ones through a small **managed
    proxy** (Supabase Edge Function or Cloudflare Worker) that adds: per-IP + per-account rate limits,
    response caching (Picsum/Quotable/Wikipedia are cacheable), and an AI-image **queue** so
    Pollinations isn't hammered by bursts of generations. This also future-proofs charging for AI.
- **AI credits are client-side** (localStorage counter) — free-tier users can clear storage to
  refill. For a paid product, move the counter to the registry (B3.3). For launch-day, accept it as a
  demo-stage limit (matches the current README honesty).
- **Demo license keys** — removed for 0.3.7 (UI, seeds and docs); the schema now purges any
  legacy demo rows on re-run so a repo-readable key can never be activated live.
- **Form delivery endpoints**: exported client sites POST to endpoints the site owner chooses —
  potential for abuse-of-others (e.g., pointing the form at a victim's webhook). Mitigation: keep it
  opt-in (it is), document it, and optionally add a honeypot field + client-side rate limit in
  generated forms. Not urgent.
- **Web mode is fully public** (any browser can run the studio). That's fine — RLS + the registry are
  the enforcement points; just never ship a service-role key (verified: none exists) and keep writes
  RPC-only (verified: true).
- **ref.html on pallettai.org** is a public page with embedded anon key — fine by design, but add a
  CSP + bot protection (B4.3) since it's the farming entry point.

### B6. Renderer & data-in-transit hygiene
- **Session tokens in localStorage** (current): an XSS could exfiltrate them. CSP (B1.1) + escaping
  mitigate; the robust step is storing the refresh token via `safeStorage` in the main process
  (Electron API: OS-keychain-backed encryption — Keychain on macOS, DPAPI on Windows — exactly the
  cross-platform pair you want). Web mode keeps localStorage as fallback.
- **Exported client sites**: consider emitting a sensible CSP + `no-referrer` + form honeypots in the
  generated HTML as a value-add (client sites are a public abuse surface you're implicitly vending).
- **Strict-Transport-Security / secure cookies** don't apply (no cookies used; JWT in memory) — fine.

### B7. Release-pipeline security for the dual launch
- GitHub Actions: extend the existing mac workflow with a `windows-latest` job (same electron-builder
  config, `--win nsis`), sign with Azure Trusted Signing secrets, attach zips + `latest.yml`.
- Secrets: CSC_LINK/KEY_PASSWORD (mac) + Windows cert identity; never in the repo.
- Pre-release checklist: delete demo keys, confirm-email decision, rate limits set, test account
  cleanup, `npm audit` clean, fuses applied, CSP tested against every online source.

---

## Suggested priority order (for when implementation starts)
**P0 (do before launch):** CSP meta tag + permission handler + fuses + ASAR integrity; remove demo
keys; fix Supabase email sending or confirm-email decision; Windows signing + NSIS + auto-update
verification; `npm audit`.
**P1 (first design pass):** design tokens; system font stacks; command palette; modal focus trap +
a11y pass; theme "System" option; user-select/cursor semantics.
**P2:** safeStorage for session tokens; server-side credit accounting; ECDSA signed keys (Phase 1);
Iconify-based UI icons; background material (Mica/vibrancy); Windows custom title bar; Web Components
for primitives.
**P3:** managed API proxy with rate limits + AI queue; referral fraud signals/review; per-device
activation.

---

## Part C — Framer: what to borrow (same industry, actively used app)

Framer's success = canvas-first editing + AI + templates marketplace + a publishing/badge growth
loop. Mapped to what PallettAI Studio already has, and what to borrow:

### C1. What Framer does that works
1. **Keyboard-first, command-driven UI** — ⌘K command menu, cheat-sheet shortcuts (⌘D duplicate,
   ⌘/ shortcuts overlay, ⌘+ zoom). Users *feel* speed; speed is retention in a design tool.
2. **Contextual right-side inspector** — select anything → its properties appear in a persistent
   panel. Our Designer hides editors behind tabs/modals; a contextual panel is the single biggest
   "feels like a real pro tool" upgrade available to us.
3. **Canvas with zoom + device toggles + status bar** — we have responsive preview (desktop/tablet/
   mobile); add zoom % controls, ⌘+/⌘- zoom, a bottom status bar (save state exists; add zoom,
   page count, publish state).
4. **Templates marketplace with remix** — Framer's marketplace drives signups (free templates are
   its #1 acquisition channel) and "remix" (one click: duplicate + rebrand). We have a template
   grid + duplicate; upgrade it to a browsable marketplace feel with live previews and one-click
   remix into a new project.
5. **AI as a first-class agent, not a wizard** — Framer AI (prompt → site) and the newer "AI
   agents" (CMS agent, refine agent) meet users at every step. We already have AI Studio +
   Copilot; the gap is *discoverability* — surface Copilot as a persistent docked panel (it's
   already a floating panel) and add AI suggestions inline in the designer.
6. **Publishing = the product moment** — Framer turns publish into a celebration (domains,
   analytics, status). We have export + one-click publish (Netlify/Neocities); add a publish
   checklist, a shareable "site live 🎉" card after publish, and make the flow feel ceremonial.
7. **"Made with Framer" badge loop** — every free Framer site ships a badge that links back to
   Framer; it's their viral loop. We already stamp "Made with PallettAI" on free exports — make
   it **clickable** (link to pallettai.org with the user's ref code) so every exported client site
   becomes an acquisition channel. (Pro already removes it — that's the upgrade incentive.)
8. **Component/variant culture** — Framer's component system keeps users in-app. We have 25
   catalog layouts + variants in the section editor; promote variants/layouts as the "component
   library" story.
9. **Design language** — Framer's chrome is minimal: neutral surfaces, hairline borders, one
   accent color, generous whitespace, muted iconography, fast micro-animations. Our design-token
   refresh (Part A) should target exactly this, and Framer's app is the reference for "pro and
   calm" rather than "game-y".

### C2. Explicitly do NOT copy
- Canvas free-form positioning (we're a section-based builder — that's our speed advantage).
- Paywalling core editing behind plans (our free tier is generous by design; Framer's free tier
  is also generous — limits are on publishing/CMS).
- Confusing pricing tiers (keep Free/Pro/Pro+).

---

## Part D — Retention & growth mechanics (daily rewards, streaks, share-to-earn)

Goal: habit + free marketing. Best-practice synthesis from game design and SaaS growth research,
with anti-abuse notes tied to Part B (we already have the server-side primitives: registry RPCs,
advisory locks, stamped logs).

### D1. Daily reward / streak chest (the core ask)
**Mechanics that research consistently supports:**
- **Calendar-day cadence, not 24h-rolling** — rewards reset at a fixed day boundary (e.g. UTC
  midnight or user-local midnight). 24h-rolling timers are universally disliked (fatshark/reddit
  consensus); fixed-day feels fair and is simpler to enforce server-side.
- **Escalating consecutive-day rewards with milestone bumps** — day 1–6 small (e.g. 1–6 credits),
  **day 7 chest = big** (e.g. 10 credits + a bonus like a style-pack credit or 3-day Pro trial
  extension), then cycle resets to a repeating pattern (classic 7-day loop from game design
  sources: "the more consecutive days, the bigger the reward").
- **Streak freeze / grace** — one "freeze" per week (Duolingo pattern) so real life doesn't kill
  the habit; streaks feel *safe* to maintain, which is what makes them sticky.
- **Reward the action, not the login** (strongest single design rule from game devs: "reward the
  fantasy, not the login") — tie the chest to a *meaningful action*: "open the designer and make
  one edit", or "complete one AI generation". Pure login rewards train empty opens; action
  rewards train usage. A hybrid: the chest unlocks by doing one small useful thing that day.
- **Deterministic over random, or guaranteed minimums** — variable-reward "spins" are gambling-
  adjacent (see D4 ethics). If you keep the **spin/chest visual** (it's fun and shareable), make
  the *outcome* deterministic/escalating (day-based) with maybe a small cosmetic "bonus roll".
  Never award zero.
- **Visible progress UI** — 7-slot calendar strip on the dashboard ("Day 3/7, tomorrow +4"),
  with a confetti moment on day 7. Progress visibility is what drives the return.

**Enforcement & anti-abuse (critical — this is free money, farms will come):**
- **Server-side claims only**: `claim_daily_reward()` registry RPC (same pattern as
  `redeem_code`): advisory lock per user, UTC day bucket stored on the profile, streak counter,
  last-claim date. Clock-tampering is impossible because the *server* decides the day.
- Signed-out users: local demo-mode daily rewards (localStorage, honest "demo" framing, same as
  the existing local license/referral paths) — real credits require an account.
- Signed-in users: one claim per account per day, enforced by the DB (unique/update guard).
- Daily *login* can't be spoofed server-side beyond claiming, so make the claim the unit.
- Farming: streak rewards are per-account (farming requires real email confirmations — ties into
  B4 double opt-in). Keep the 60-day-style caps in mind for any "share" rewards.

### D2. Share-to-earn (social sharing with ref link)
**Mechanic:** "Share PallettAI on X/LinkedIn/Facebook → +N credits" with the user's `REF-` code
embedded. Recommended design:
- **Reward the share action, not the outcome** — you cannot verify a social post happened
  (client-side apps can't prove a tweet was posted). Industry practice: credit on share *click*,
  capped (e.g. max 1 reward per network per week, or max 5/wk) so bots can't farm endlessly.
- **Make shares good-looking**: pre-composed share cards (OG image of their best project,
  site-link, ref link), one-tap deep links per network (X/Twitter intent URL, LinkedIn share
  URL, Facebook sharer, WhatsApp, email) opened via `shell.openExternal`.
- **Cross-platform reality check — do NOT rely on `navigator.share()` (Web Share API)**: desktop
  support is inconsistent (works in Chrome/Edge on Windows; macOS/Electron support is patchy —
  multiple reports of it being unavailable in Electron on macOS). The robust dual-platform
  approach is the per-network deep-link sheet + copy-link fallback, which is also testable in web
  mode. If we later want OS-native share sheets, build them in the main process per platform.
- **Hook shares to the good moments**: after first export, after publishing a site, after a 7-day
  streak — "Ship it 🎉 → Share it" is a natural, non-spammy growth loop (growth-loop sources:
  share moments must feel earned, not prompted).
- **Combine with the existing referral program**: sharing spreads the `REF-` code → friend
  redeems → +30d friend / +7d referrer (already live + server-verified). Share-to-earn is the
  *discovery* half; the referral RPC is the *conversion* half.

### D3. Complementary retention mechanics (cheap, high-fit for a pro tool)
- **First-run activation**: guided tour exists; add a "build your first site" checklist with a
  completion reward (credits) — activation is the strongest retention predictor (Day-7 retention
  averages ~13% industry-wide; activation flow is the lever).
- **Milestone badges/achievements** (non-monetary): first export, first AI site, first publish,
  ​7-day streak — social capital, no economy impact. GitHub-contribution-style visual streak.
- **Email/notification re-engagement**: "Your streak is about to break" / "day 7 chest waiting"
  reminders — needs the email-sending fix from B1 before launch.
- **Weekly goals** (e.g. "export 2 sites this week → +5 credits"): less pressure than daily,
  better fit for professional users (RevenueCat's research argues streaks alone under-serve
  goal-aligned users; goals + streaks together cover both habits).
- **Credit economy balance rules**: credits are the premium currency — always pair an earn
  mechanic with a spend mechanic (AI generations, Pro trials, style packs). Make daily rewards
  meaningful but not self-sufficient (they should drive *engagement*, Pro remains the revenue).

### D4. Ethics & dark-pattern guardrails (protects the brand + users)
Research is clear that variable-reward/random-spin mechanics are functionally gambling patterns
and are criticized as dark patterns when used on tools (prototypr/uxmag/arxiv sources). For a
professional product:
- Keep rewards **deterministic and escalating** (or cosmetic randomness only) — never
  zero-reward spins, never odds hidden from the user.
- No countdown-timer FOMO pressure, no "claim or lose everything" — streak freeze exists for a
  reason; losing a 60-day streak to a holiday feels like punishment, not motivation.
- Rewards should **serve the user's goal** (build a site faster) rather than create dependency;
  frame as "bonus credits", not "you must log in or lose Pro".
- Publishing/share prompts: one natural moment, not nagging; always one click to dismiss forever.

---

### Key sources
- Electron official security tutorial & checklist — electronjs.org/docs/latest/tutorial/security
- Electron Fuses — github.com/electron/fuses (via Electron docs "Fuses" page)
- electron-builder — code signing (mac/Windows), NSIS, signature verification docs
- Azure Trusted Signing for Windows (Electron Forge signing guide, 2025)
- Supabase docs — Auth rate limits; Production checklist (email rate limits, going into prod)
- Referral fraud: Unit21, Crossclassify, Stripe account/promotion abuse, Voucherify (double opt-in)
- Offline licensing: Keygen.sh cryptography docs; Cryptolens offline verification; paceap.com overview;
  infosecwriteups "Bypassing License Validation in a Desktop Application" (why client-side is a deterrent)
- Cross-platform UX: ToDesktop "Designing desktop apps for cross-platform UX" (fonts, icons, title
  bars, user-select, theme, vibrancy)
- Platform design languages: Fluent 2 (fluent2.microsoft.design), Apple Liquid Glass announcements (2025)
- safeStorage: Electron API docs; community guidance on storing refresh tokens
- Framer: framer.com help (canvas/shortcuts), Framer marketplace & pricing pages, industry analyses
  of its template/AI/badge growth loop
- Daily rewards: GameDeveloper "The Science & Craft of Designing Daily Rewards"; daily-reward
  psychology write-ups; streak/gamification retention round-ups (Purrweb, Digia, Xtremepush, Userpilot)
- Referral/share growth loops: Adapty, Molfar viral loops, GrowSurf examples, Reteno
- Gamification ethics: prototypr "Ethical Gamification", uxmag "Designing for Dependence", arxiv
  dark-patterns-in-mobile-games study, RevenueCat "Streaks aren't the secret to retention"
- Web Share API: MDN Navigator.share; capacitor-community/electron issue #252 (Electron desktop
  support gaps); web.dev Web Share article

---

## Part E — Daily streak + Day-7 wheel: decided spec (2026-09-05)

**Status: IMPLEMENTED 2026-09-05** — schema `supabase/schema.sql` Part 3 (§11–18), client methods in
`modules/supabase.js`, bonus-credit economy in `data/plans.js`, dashboard widget + wheel modal in
`app.js` / `index.html` / `styles.css`. Verified by `scripts/streak-smoke.js` (47 checks against the
mock registry, including double-claim, clock-tamper and re-spin attempts) and a full UI walkthrough
in web + desktop mode. Remaining knob for the owner: tune the E2 reward table numbers in the SQL
(mirrored by the mock for tests) — generous at ~27 credits + wheel value per perfect week.

Decisions confirmed with the owner: **registry-account only** (no local/demo mode), **one real
action + tap claim** per day, **prizes = credits + short Pro time + streak-freeze shields**, and
**the reward loop resets to Day 1 after each Day-7 wheel**. Research grounding from D1/D4 plus
fresh sources listed at the end of this part.

### E1. The loop
- Fixed **UTC calendar-day** buckets decided by the **server** (claims are the unit; a missed day
  is simply no claim that bucket). Consecutive claim-days form a streak. Cycle day = 1..7,
  computed as `(consecutive_days - 1) mod 7 + 1` — so after the Day-7 wheel the next claim is
  Day 1 again while the streak counter keeps counting upward for display/loss-aversion.
- **Qualifying action first**: the client only enables the day's claim after one meaningful action
  that day (one project edit, one AI Studio generation, or one save). The server accepts the claim
  with an `action` tag recorded for analytics; the *enforcement* that matters is the one-claim-
  per-day server cap + server clock — the action gate is a behavioral device, not an anti-cheat
  device (a determined client can always fake "I did an action"; it cannot fake the date).
- **Missed day**: streak and cycle reset to day 1 **unless** a **streak shield** is held (below),
  in which case the shield is consumed, the missed day is marked frozen (counted as a continuation
  for claim purposes but NOT for reward escalation — the user returns at the day they would have
  been on had they claimed, capped per freeze rules).
- **Week completion**: claiming Day 7 grants **+1 streak shield automatically** (cap 2 held) in
  addition to unlocking the wheel — the weekly "milestone" reward that protects the next cycle.

### E2. Rewards table (concrete, all tunable)
Daily (Day 1-6) — escalating **bonus AI credits** (a new balance layered on the free tier's hard
cap of 3; see E4):
| Cycle day | Reward |
|---|---|
| 1 | +2 credits |
| 2 | +3 credits |
| 3 | +4 credits |
| 4 | +5 credits |
| 5 | +6 credits |
| 6 | +7 credits |
| 7 | **Wheel spin** (see below) + 1 streak shield |

Day-7 wheel — 12 equal segments, **guaranteed win, zero no-prize segments**, server-picked
outcome (RNG on the server, not the client → can't be replayed or re-rolled):
| Segment | Odds |
|---|---|
| +3 credits | 2/12 |
| +5 credits | 2/12 |
| +10 credits | 1/12 |
| +3h Pro time | 2/12 |
| +12h Pro time | 1/12 |
| +1 day Pro time | 1/12 |
| +3 days Pro time | 1/12 |
| Streak shield | 1/12 (converts to +5 credits if already at cap) |
| **+7 days Pro (jackpot)** | 1/12 |

Odds are **published in the UI** next to the wheel (transparency is the fix for the universal
"it's rigged" complaint — see D4/Fetch example). Expected value ≈ 9 credits + ~17h Pro time per
completed week on top of the 27 daily credits — generous enough to matter, not enough to replace
Pro (unlimited credits/watermark-free remain the paid value).

### E3. Streak shields
- Consumable, held **max 2** (Duolingo's sweet spot — two freezes beat one; three erode habit).
- Earned: guaranteed +1 on every Day-7 completion; rare wheel segment; overflow converts to
  credits.
- Spent automatically server-side when a claim arrives after one missed day. No purchase path in
  v1 (avoid monetizing the anxiety).

### E4. Credit-economy change (required by this feature)
Free tier today: **3 AI credits total, never resetting** (`credits.used` only increments). Daily
rewards need a **bonus balance**: store gains `bonusCredits`; `creditsLeft` becomes
`limit = isPro ? Infinity : baseLimit + bonusCredits` (left = max(0, limit - used)). Bonus
credits survive plan changes, never expire, and are capped implicitly by the weekly flow above
(~27/week for a perfect week — a fraction of a Pro month, keeping Pro the revenue).

### E5. Registry schema & RPCs (mirrors the existing redeem_code pattern)
New tables:
- `user_streaks` (1:1 with profiles): `user_id PK/FK`, `consecutive_days int`, `best_days int`,
  `last_claim_date date`, `frozen_date date null`, `shields int default 0`, `bonus_credits int
  default 0`, `updated_at`.
- `streak_claims` (audit log, mirrors redemption trace): `id`, `user_id`, `claim_date date`,
  `action text`, `cycle_day int`, `prize_type text`, `prize_amount int`, `created_at`.
- `wheel_spins`: `id`, `user_id`, `spin_date date`, `outcome text`, `amount int`, `created_at`.

RPCs (SECURITY DEFINER, RLS-restricted as in schema.sql §7/§10, advisory-locked):
- `get_streak_state()` → cycle day, streak, best, shields, today-claimed?, wheel-ready?, prize
  schedule for days 1-7. Safe to call anytime.
- `claim_daily_reward(p_action text)` → one claim per (user, UTC day) via unique index +
  advisory lock; computes cycle day, applies daily prize or marks Day 7 wheel-ready; auto-grants
  the weekly shield; returns the stamped result.
- `spin_wheel()` → allowed only when today is a claimed Day 7 and no spin exists for (user, today);
  picks outcome server-side, writes it, returns it. Client animates to the server-chosen segment.

Anti-abuse (this is free money — farms will come): one claim per account per UTC day (DB
enforced); server decides the day (clock tampering useless); spins require the confirmed account
+ the claimed Day 7 (farming needs real emails — ties to B4); every grant stamped in the audit
logs; shields capped server-side. No local fallback per the registry-only decision — offline
users see cached state and an honest "sign in / go online to claim" state.

### E6. UI plan (cross-platform — pure DOM/CSS/canvas, identical on macOS & Windows & web mode)
- Dashboard **streak widget**: 7-slot progress strip (Day N of 7, next prize on hover), shield
  count with an explainer tooltip, "claim" state that activates after the day's first qualifying
  action.
- Day 7 → **wheel modal**: canvas/CSS spinner that lands on the server-chosen segment, confetti,
  odds panel ("+5 credits · 2 in 12"), streak-shield framing.
- Missed-day UX: friendly reset notice + shield-consumed notice ("a shield kept your streak
  alive ⛨").
- Signed-out users (registry-only decision): a compact "Start your streak — sign in" card;
  after sign-in the widget hydrates from `get_streak_state()`.
- Reward the action, not the login, everywhere in the copy: claims read as "you built today —
  claim your Day N bonus", never "log in every day or lose".

### E7. Fresh sources for this part
- Timezone/day-boundary handling: trophy.so "Streak Timezone & DST Handling"; tigerabrodi.dev
  daily-streak guide; devtools.tools habit-tracker guide (local calendar days are the user
  expectation — we use UTC buckets server-side and display in the user's local day)
- 7-day resetting loops: SL Mobile streak testing write-up (modemworld.me, Jan 2025); bitlabs
  7-Day Streak docs
- Streak psychology: Duolingo engineering blog "The habit-building research behind your Duolingo
  streak"; trophy.so streak psychology; Medium "Why Duolingo streaks work" (freeze sweet spot)
- Short premium bursts: Userpilot free-trial-length analysis (value = experiencing the product);
  ChartMogul SaaS conversion report
- Wheel fairness & gambling-adjacency: FetchReward "is the wheel fixed" threads (user distrust);
  USENIX SOUPS 2025 predatory-monetization study; Ofcom persuasive-design report (spin-the-wheel
  named as gambling-adjacent — hence published odds + no-prize-free segments)

---

# Part F — Server-side credit spend + AI proxy (free-tier reality check)

*Status: **Design A IMPLEMENTED (2026-09-05)** — schema.sql PART 4 (§20–25: `credit_spends`
+ `get_credit_state` / `spend_credit` / `refund_credit` RPCs, anon-revoked), client mirror in
`data/plans.js` (ref ledger) + `modules/supabase.js` + `app.js` (optimistic local spend with
idempotency refs, offline queue flushed on sync, server reconcile). Covered by
`scripts/credit-smoke.js` (38 checks) on top of the 25 registry + 47 streak checks.
Design B (the AI proxy) remains deferred as spec'd. Original research below.*

## F1. What the app does today (the cheat being closed)

- Free tier = **3 AI credits total**, tracked locally as `credits.used` in
  `pallettai.subscription.v1` (localStorage). `creditsLeft()` = `3 + server bonusCredits − used`.
- AI calls go **straight from the client** to Pollinations — keyless:
  `image.pollinations.ai/prompt/…?model=flux` (images) and `text.pollinations.ai/…` (copy).
  A local engine is the offline fallback (`settings.onlineEnabled`).
- So today the *only* thing stopping a signed-in free user from unlimited AI is a local
  counter they can wipe. Wipe → 3 fresh credits, forever.

## F2. Pollinations moved to a key/credits model (relevant risk)

- Pollinations now sells API keys (`enter.pollinations.ai`) and describes the model as
  "users bring their own credits". Their docs: *"All generation requests require an API key"* —
  keyless public endpoints still exist but are the legacy/test path and are the natural
  candidates for throttling or deprecation.
- **Implication for this app:** the current keyless client calls are the fragile link. If
  keyless is throttled or retired, every user's AI features degrade together — and you'd
  have no key to fall back on. A server-held key + proxy is the hedge.
- **Crucially:** Pollinations' cost is on *their* infra, not yours. A user generating AI
  images does not consume your money today. The thing worth protecting is **entitlement**
  (unlimited-AI is a Pro selling point; the 3-credit free budget is a feature boundary), not
  compute spend. Server-side credit accounting protects exactly that.

## F3. Two designs, and which fits the free tier

### Design A — Server-side credit accounting (recommended, ~zero free-tier cost)
A `spend_credit(p_count)` RPC mirroring the streak/`redeem_code` pattern:
- SECURITY DEFINER + advisory lock + RLS; reads the plan/pro licence state from `profiles`,
  computes the authoritative ceiling (`3 + bonus_credits`, or ∞ on Pro/Pro+), rejects
  over-limit, and stamps every spend in a new `credit_spends` audit table.
- Client keeps working offline: it spends against its local mirror optimistically, and on
  the next cloud sync **reconciles** the local `used` count to the server's authoritative one.
  Signed-out users keep today's demo/local behaviour unchanged.
- `refund_credit()` RPC so a failed generation (Pollinations down) returns the credit.
- Cost on the free tier: **~zero.** REST/RPC requests are unlimited on the free plan; the
  tables are a few ints + a timestamp per row. This closes the wipe-reset cheat for every
  signed-in user on both Windows and macOS (one shared budget per account).
- Bonus: you finally get real per-user/plan/week AI usage numbers (product analytics for
  free), and the streak `bonusCredits` become genuinely spendable value instead of theatre.

### Design B — Edge Function AI proxy (conditional, has real free-tier costs)
Route image/text calls through `…/functions/v1/ai-proxy`: function authenticates the user's
JWT, checks entitlement, atomically spends, then forwards to Pollinations with a **server-side
key** (or to any future provider).
- Gains: server-held key (survives keyless deprecation), per-account rate limiting/queue
  fairness, one atomic "spend + forward" (spend can't be separated from the call), provider
  swap without an app update, central prompt/abuse logging, e.g. rejecting abusive prompts.
- **Free-tier costs that make it *not* automatic:**
  - **Egress.** Images proxied through the function consume *your* 5 GB/month egress. A
    single 2–5 MB flux image → roughly **1,000–2,500 proxied images/month** before the cap.
    Fetching images directly from Pollinations' CDN (as today) uses **zero** of your egress.
  - 500 K edge invocations/month is not the constraint; egress and added latency are.
- Verdict: **don't build the proxy now.** Build Design A, keep the client→Pollinations
  direct path, and add the proxy only when one of these is true: (1) you adopt a paid/billed
  AI provider, (2) keyless Pollinations degrades for your users, or (3) you want a server key
  regardless. When that day comes, the proxy wraps the same `spend_credit` RPC.

## F4. Features / differences / benefits summary

| | Today (client-only) | + Design A (server spend) | + Design B (proxy) |
|---|---|---|---|
| Where the credit ceiling lives | localStorage | profiles/DB (per account) | same, enforced in the proxy |
| Wipe/reinstall local state | resets to 3 credits | re-syncs to server truth | same |
| Offline AI | local engine + local budget | local mirror + optimistic spend | needs online (proxy is remote) |
| Multi-device (Win + Mac) | separate budgets | one shared authoritative budget | same |
| AI usage analytics | none | free from `credit_spends` | + prompt logs |
| Cost to you | none (Pollinations pays) | ~zero (RPCs unmetered) | 5 GB egress eats the free cap fast |
| Keyless Pollinations risk | fragile (no key) | same fragility | hedged (server key) |
| Provider swap later | client update required | client update required | server-only change |

## F5. Free-tier operational notes that affect *all* of this

- **1-week inactivity pause** (from Supabase pricing/docs): free projects pause after ~7 days
  of low activity — DB frozen (reads/writes fail) but restorable for 90 days. A desktop app
  with real sign-ins won't pause; an early-stage app with a quiet week will. Cheap insurance:
  a weekly heartbeat (scheduled GitHub Action or a cron-driven Edge Function) that touches the
  REST API. Design the client so "registry unreachable" is already graceful — it is.
- **Limits that matter at your scale (Sep 2026):** 50 K MAU (fine), 500 MB DB (streak/credit
  audit rows are tiny; prune logs later if ever needed), unlimited REST requests (the whole
  RPC architecture is free), 2 active projects (you're on 1).
- Supabase's built-in email only covers auth emails — streak-reminder or receipt emails would
  need a transactional provider (Resend/SMTP), same as Part E noted.

## F6. Recommended shape (when you say go)

1. `supabase/schema.sql` Part 4: `credit_spends` audit table + `spend_credit()` /
   `refund_credit()` RPCs (§-pattern identical to Part 3), revoking anon/PUBLIC execute.
2. `plans.js`: authoritative-ceiling read from cloud when signed in; reconcile-on-sync.
3. `app.js`: `spendCredit()` calls the RPC when signed-in+online (optimistic local debit,
   quiet rollback on failure + refund), stays local for signed-out/demo.
4. Mock + smoke coverage for: over-limit rejection, concurrent double-spend, refund path,
   offline fallback, wipe-then-sync restore, Pro-unlimited unaffected.
5. **No proxy deployment** until a trigger fires (F3 verdict). Heartbeat added when the app
   nears real user counts so the free project never pauses.

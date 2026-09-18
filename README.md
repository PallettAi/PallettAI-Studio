# PallettAI Studio

Design and build fully functioning, animated websites for clients — made by **PallettAI** ([pallettai.org](https://pallettai.org)).

A desktop GUI app (Electron) whose UI is plain HTML/CSS/JS — no build step — so it also runs in a browser for live preview.

```bash
npm install        # installs Electron
npm start          # open as a desktop app
npm run web        # or preview in the browser at http://localhost:4173
```

## macOS desktop app

The same studio ships as a **direct-download Mac app** (Electron 44 — **macOS Sequoia (15)+**, Apple Silicon & Intel) and a **Windows app** (Electron 44 — **Windows 10 1809+ / 11**, x64, signed NSIS installer). It adds native menus (⌘/Ctrl, Settings, ⌘1–6 view switching, ⌘S save), window-size/position memory, single-instance locking, a PallettAI **P/** app icon, and a **startup update gate**: packaged builds check GitHub Releases before showing the workspace, download and install an available update, then relaunch automatically. Offline or unavailable update services fall back to the current app after a bounded timeout. Distribution is a signed + notarized **DMG** and a signed **EXE installer** from pallettai.org / GitHub Releases — not any app store. Build, certificate and shipping instructions: **[`MACOS-SHIPPING.md`](MACOS-SHIPPING.md)** and **[`WINDOWS-SHIPPING.md`](WINDOWS-SHIPPING.md)**.

---

## What's inside

- **Dashboard** — 7 client-ready templates, project management (open / duplicate / **JSON backup** / **import** / export / delete), AI generation entry point. Signed-in accounts also get the **cloud project vault**: projects mirror to the registry automatically and restore on any machine.
- **✦ AI Studio 2.3** — describe a site in plain English and get a complete client-ready site (name, palette, fonts, copy, full layout). **14 business types** with deep copy banks, **phrase-aware industry detection** (“dog grooming studio” is pet care, never a creative agency), a **concrete-subject extractor** (“cozy wood-fired pizza restaurant” → subject *wood-fired pizza*, which then drives the copy and the photos), and a **taste detector** (minimal / editorial / premium / playful / bold / techy / warm / vibrant). Generation options: **style pack** (any of the 8 looks), **layout flavor** (Auto = the AI hand-picks catalog layouts; Classic), and a **photo source** picker:
- **✦ AI Studio 2.3** — describe a site in plain English and get a complete client-ready site (name, palette, fonts, copy, full layout). **14 business types** with deep copy banks, **phrase-aware industry detection** (“dog grooming studio” is pet care, never a creative agency), a **concrete-subject extractor** (“cozy wood-fired pizza restaurant” → subject *wood-fired pizza*, which then drives the copy and the photos), and a **taste detector** (minimal / editorial / premium / playful / bold / techy / warm / vibrant). Generation options: **style pack** (any of the 8 looks), **layout flavor** (Auto = the AI hand-picks catalog layouts; Classic), and a **photo source** picker:
  - 📷 **Real photos from the web (default)** — keyless, topic-matched and **licence-aware**: **Openverse** search (openly licensed images with creator + licence metadata that travel with every photo) with Wikimedia Commons, Pixabay and Flickr-via-LoremFlickr fallbacks, chosen per scene (hero / interior / gallery) for what the site actually sells or does
  - 🎨 **AI-generated art** (Pollinations) or **No photos** for clean, minimal builds
  - 📸 **Use your own photos** — drag & drop up to 10 (re-encoded locally as **WebP** with a JPEG fallback, resized, and **stripped of EXIF/GPS metadata** before they ever enter the project): the 1st fills the hero, the 2nd the about shot, the rest the gallery, before anything is fetched from the web. Reorder with ◀ ▶, remove with ✕; the bank survives view switches and Quick-magic photo re-runs reuse it.
  - 🌐 **Rebuild an existing website** — paste the client's current URL and the AI studies it (direct fetch, then a keyless proxy for sites without CORS): it lifts the real brand, contact details, services, about copy, FAQ, reviews, area served and the site's own photos — then rebuilds the whole thing better. Unreachable sites degrade gracefully to a prompt-only build.
  - 🗂 **Deep niche content packs** — ~20 hand-written sub-niche knowledge bases (pizzeria, specialty coffee, bakery, burger joint, Japanese, Indian, Mexican, steakhouse, florist, boutique, hair salon, barber, nails, spa, gym, yoga, interior design, cleaning, wedding, photography, car detailing, dog groomer…). When the prompt or studied site names one, the AI swaps the generic industry copy for real specialist copy — a pizzeria gets *“Dough proved for 48 hours… 450°C wood-fired oven”* taglines, a real **menu table** section (8 hand-written dishes with prices), niche FAQs, testimonials and pricing, and the photo engine's scene queries switch to the niche's world (wood-fired ovens, not stock food shots). The detected pack is shown as a 🗂 chip on the result card and drives every later photo pass.
  - Every generated site is finished with a **design DNA** — one of 10 coordinated looks (editorial · light · warm · bright · dark · bold · noir · playful · techy · minimal) that selects the palette, a **display/body font pairing** (e.g. Newsreader serif headings over a Montserrat/Inter body), corner radius and section rhythm, so two sites for the same brief don’t come out looking alike. 9 new AA-safe palettes and a new display serif (**Newsreader**) joined the library, and the whole palette set now clears WCAG AA on text roles. Plus:
  - **Photo pass** runs right after generation (hero, about and the full gallery) and is re-runnable from Quick magic as 📷 **Topic-matched real photos** or 🎨 **AI images** (1 credit each)
  - 🖼 **Pick & choose photos** — after a real-photo run (or on demand from Quick magic, 1 credit) a picker opens with every photo spot on the site: the current photo leads each row, real topic-matched candidates (Openverse + Commons + Flickr) follow, with 🎲 shuffle and instant swap previews. Apply commits any number of swaps to the project in one click — the creator, not just the AI, picks the final look.
  - **Licence-clean exports** — when a CC-BY/CC-BY-SA photo from Openverse or Wikimedia Commons is used, the exported site automatically shows a compact “Photos” attribution block in its footer (creator, title, licence and source links, deduped per image). CC0, Pixabay photos and the creator's own uploads carry no credit requirement and stay clean.
  - AI **copy enhancement** (online model, local fallback) — the local engine now refreshes tagline, hero, features, stats, pricing, testimonials, FAQ, gallery captions, CTA and about
  - **AI restyle** — new palette + fonts from a mood prompt
  - **AI logo** — instant random logo (free)
  - **🎨 Logo studio** — 8 logo styles (Monogram, Wordmark, Badge with curved text, Abstract Mark, Outline, Duotone, vintage Seal, Mark + Wordmark), 5 container shapes, 11 fonts, palette-auto or 8 curated duotone pairs, live preview, 🎲 shuffle, one-click apply. Same generator powers the designer's logo row and Copilot.
  - **AI per-section rewrite** (in the section editor) and **alt-text** for every image
  - **🧭 Design Direction Lab** — spend one credit to generate three deliberately contrasting, presentation-ready directions for the same brief (editorial, bold and quiet/minimal by default), with a visual artboard, palette/type/section-flow metadata, selection and per-card remix. Exploration drafts stay ephemeral; only the chosen direction becomes a saved project, and free-tier project limits are enforced before selection.
  - **🔒 Brand kernel — a locked visual system** — a brand preset is a look you *may* apply; a kernel is a look the generator *must* obey. Any **AI Studio ▸ Brand lock** preset (or 🔒 **Lock this look** on a finished site) pins palette, typography, corner radius, section rhythm, the hero treatment, tone of voice and imagery rules behind per-field lock flags. The renderer-owned fields are enforced deterministically on every generated site — a locked palette cannot be recoloured by the DNA pick, a style pack, a self-repair or a Copilot restyle — while voice and imagery rules travel as hard constraints on the prompt (`modules/ai.js` + `data/ai-kernel.js`). A locked brand survives a dog-grooming site being generated from a bakery's brand kit. Drift is reportable (`violations`) and the contract is inspectable from the lock chip.
  - **🧠 Self-critique pass (generation grades its own work)** — every generated site is audited offline by the same deterministic engine as the publish gate *before* the creator sees it, and only findings the gate itself marks **safe** are repaired automatically (metadata, IDs, table shapes, alt text, unknown variants, contact block). A locked brand field is never unlocked by a repair, a `site-name`-style decision stays the creator's call, and a repair run that would *lower* the launch grade is rolled back rather than shipped. The result card says exactly what changed: “Self-critique fixed 1 thing · launch grade B → A” (`data/ai-critique.js`).
  - **🛡 Publish quality gate** — a deterministic, offline audit of the project model plus the exact exported HTML, with launch grade, blocking vs improvement findings, multi-page checks, export-level accessibility/SEO/responsive/link checks, and conservative one-click repairs for metadata, IDs, structure, table shapes, unsafe links and alt text. Safe repairs remain undoable; informational findings never trap a normal export.
- **✦ Copilot (chat editor)** — edit the open site in plain English from the Designer toolbar: “make it glassmorphism”, “rounder corners”, “make the hero punchier”, “make the features bento”, “give the hero a code terminal look”, “add a pricing section”, “add a map of Paris”, “weather in London”, “embed this Spotify link…”, “delete the FAQ”, “move testimonials above pricing”, “add a Book now button to the nav”, “my email is hello@…”, “build me a brand kit”, “generate an AI logo”… The chat understands ~50 command types (styles, palettes, fonts, **catalog layout variants**, design tokens, hero/nav/theme, site fields, sections incl. map/weather/embed with auto-filled data, suites, brand kit, rewrites), applies them live with one-click **↩ Undo this** per message, and suggests next steps as chips. Deterministic edits are free; AI rewrites cost a credit. **Brand kit** does logo + palette + fonts + alt text in one command (1 credit).
- **🎨 AI style packs** — 8 one-click full-look transformations: 🧊 Glassmorphism, 🧱 Brutalist, 🌅 Neo Retro, 📰 Editorial, 🌌 Cosmic Dusk, 👑 Luxury Gold, 🍃 Zen Sage, 🍭 Playful Pop. Each sets a matching palette (7 new colors added to the library), typography, radius/spacing and signature CSS — instantly, undoable, 1 AI credit per look (unlimited on Pro), with a “Clear styling” option that keeps your palette & fonts. Style-pack CSS is injected into previews and exported sites (custom CSS always wins).
- **Designer** — now three working areas:
  - *Site identity* — name, tagline, copy, contact details, palette + **custom palettes** (build & save your own), fonts + **custom font uploads** (woff2/ttf inlined into exports), and **reusable brand presets** (Pro — save up to 12 complete visual systems and apply them across projects)
  - *Design & branding* — container width, corner radius, section spacing, **3 hero layouts** (centered / split / minimal), sticky & transparent nav, nav CTA button, favicon emoji, meta description, Open Graph image, social links editor, **custom CSS + custom JS**, logo upload, and a **form delivery endpoint** field
  - *Sections* — add / reorder (**drag & drop** or arrows) / duplicate / delete, per-section editors, **structured blog post editor**, section **emblems** (Iconify icons above titles), entrance animations, **undo/redo** (Ctrl+Z / Ctrl+Shift+Z), **autosave with revision history** (⏱ button — snapshots ~2s after you stop editing, restore any of the last 12, and **★ pin a named milestone** that no rule will ever prune) and a **responsive preview** (desktop / tablet / mobile)
  - *Sections* — add / reorder (**drag & drop** or arrows) / duplicate / delete, per-section editors, **structured blog post editor**, section **emblems** (Iconify icons above titles), entrance animations, **undo/redo** (Ctrl+Z / Ctrl+Shift+Z) and a **responsive preview** (desktop / tablet / mobile)
- **New section types** — Logos strip (marquee / grid), Video embed (YouTube/Vimeo), live Countdown to a launch date, a dedicated **📅 Booking block** (Calendly, Cal.com, TidyCal, YouCanBookMe, Square or any HTTPS booking page, with an iframe + open-link fallback), and the **live data widgets**: 🪙 Crypto Ticker, 🐙 GitHub Stats, 💱 FX Rates (Pro).
- **Upgrade Suites** — packs that upgrade a site after it's built: Animation Pack, Contact Pro, Blog, Shop (working cart), Gallery Pro, SEO, and **📡 Data Widgets** (Pro — unlocks crypto / GitHub / FX sections, fed by keyless public APIs).
- **Database** — local library (sections, palettes, fonts, animations) plus **8 free online sources**: Picsum, RandomUser, Quotable, Google Fonts, **Wikipedia summaries**, and (Pro) **CoinGecko**, **GitHub API** and **Frankfurter/ECB FX rates** — plus **Iconify** (100k+ searchable icons as section emblems). The panel now shows Pro sources locked behind the subscription.
- **Fonts** — the local library grew from 12 to **36 Google Fonts faces** in 5 categories (sans / serif / display / mono / handwritten). 22 are free; the **Premium Font Pack** (14 display, script & mono faces — Syne, Unbounded, Anton, Fraunces, Bodoni, Cormorant, Great Vibes, Fira Code…) is a **Pro** perk, locked in the library, the database panel and the AI (free-tier AI generations stick to core fonts). All 36 work in the Logo Studio.
- **Layouts** (new tab) — a curated catalog of **25 creative section layouts** with live CSS thumbnails: Split Bold, Minimal Statement, Code Terminal, **Aurora Mesh hero**, Bento Grid, Editorial Numbered, Feature Strip, Gradient Band, **Live Ticker**, Stacked Tier Rows, **Monthly/Yearly pricing toggle**, Masonry Wall, **Featured + Stack**, Mosaic Wall, Floating Chips, **Timeline Story**, **Two-Column FAQ**, Trust Marquee, Wordmark Grid, **Gradient Info Panel contact**, **Email Capture CTA**, **Featured Post**, **Cinema Player**, **Launch Panel** and more. Six premium layouts (Aurora, Ticker, Toggle, Featured, Timeline, Featured Post) are **Pro**-gated. One click adds the fully-populated section; every layout is a normal editable section, and each type also exposes its variants in the section editor's **Design variant** dropdown. Variants render identically in preview and exports.
- **Integrations** (new tab) — the flagship free-services hub: 🗺️ **Google Maps** embed (address → live map, no key), 🌤️ **Open-Meteo** live 5-day weather widget (keyless), 🔗 **Universal Embed** (Spotify / Calendly / Typeform / Figma via iframe), 🧑‍🎨 **DiceBear** avatar generator (one click becomes a section image), 💬 **Tawk.to** live chat (property ID → widget on exported sites), and (Pro) 🪙 **CoinGecko** crypto ticker, 🐙 **GitHub** profile stats, 💱 **FX rates** — all keyless-first with graceful fallbacks.
- **Export** — standalone `.html` site with meta/OG/favicon, optional **client dark/light theme toggle**, **cookie banner**, **GA4/Plausible analytics**, **minified HTML**, custom CSS/JS and custom fonts — plus a 🩺 **site health check** before you ship.
- **Release-safe updating** — packaged Studio builds check for updates before launch, show a branded progress splash while downloading, install and relaunch automatically, and keep the current version usable if the network or release service is unavailable. The macOS app menu and the Windows/Linux **Help** menu both include **Check for Updates…** for an on-demand check.
- **Interface shell** — the look is CSS and the small amount of behaviour it needs lives in `data/uikit.js`: a status-card toast (tone icon, wrapping text, and a bar that drains on the same clock as the auto-hide timer — a long receipt stays up long enough to read), metric numbers that count instead of jumping, a **⌘/Ctrl-cross-fade on every view swap** (View Transitions API — only the view pane is named, so the rail and top bar stay perfectly still), a top bar that lifts once the view scrolls under it, **`?` for a keyboard-shortcut sheet**, and a **ranked command-palette search** with fuzzy hits, highlighted matches and the commands you actually use floated to the top. Details below.

## Interface language

Every surface is built from one token layer in `styles.css` — `--elev-1/2/3` (depth), `--hair` (the 1px inset highlight that keeps a dark panel from reading as a flat rectangle), `--tint`/`--tint-strong` (hover and selection), `--ring` (focus) and `--dur-1/2/3` + `--ease-out` (one clock for one interaction). Rails, panels and dialogs inherit those instead of each inventing its own `.18s` and its own shadow.

Light mode carries its own depth values rather than inverting the dark ones: a 50%-alpha navy shadow reads as a grey smudge on a white surface, and an inset white highlight is invisible on one. Anything colour-shaped is therefore declared twice — `:root` and `body.light` — and `scripts/ui-polish-smoke.js` asserts that every one of them is.

The dashboard metric band is the cautionary tale this pass came out of: the same markup had been styled twice, as a loud `.stat-card` with a gradient orb and as a calmer `.metric` strip, and since `app.js` only ever renders `.metric`, the deliberate redesign had never been on screen at all — the band users saw was the older, plainer one. The band is now a single system (hairline box, three equal cells, mono labels, one icon each: the icon the renderer was already being handed and throwing away), and the seam is tested rather than trusted: every class the shell writes into the DOM must have a rule in the stylesheet, and vice versa.

The shell is verified the same way as the rest of the app — `node scripts/ui-polish-smoke.js` (in `npm run release:check`) covers palette ranking and highlight ranges, toast tone and reading time, number parsing/formatting, the shortcut registry, and a `vm`-harnessed run of the counter that proves a *suspended* frame loop still lands on the real value instead of freezing at 0.

## Plans & subscriptions

**Currency: GBP.** All pricing, template pricing sections, shop carts and AI-generated copy are in pounds sterling (£). The studio's plans are **Free · Pro £9/mo · Pro+ £19/mo**. Free gets the core library (22 fonts, 19 layouts, 4 free databases, map/weather/embed/booking widgets); Pro unlocks the Premium Font Pack (14 faces), 6 premium catalog layouts, the Data Widgets suite (live crypto / GitHub / FX sections), 3 extra online databases, unlimited projects, unbranded site exports and reusable brand presets (save up to 12 visual systems across projects); Pro+ adds a white-label client handoff ZIP with no PallettAI attribution in the hosting guide or brand kit. Pro+ is a delivery tier, not a team-seat or shared-workspace plan. Gating is enforced at every entry point — library, database panel, section editor variants, copilot, integrations and brand presets.

| | Free | Pro (£9/mo) | Pro+ (£19/mo) |
|---|---|---|---|
| Projects | 2 | Unlimited | Unlimited |
| Sections per site | 10 | Unlimited | Unlimited |
| Templates | 4 (3 locked) | All | All |
| Suites | Animation + Contact Pro | All | All |
| AI Studio | 7 credits | Unlimited | Unlimited |
| Brand systems | — | Save up to 12 | Save up to 12 |
| Exports | "Made with PallettAI" badge | Unbranded site export | White-label client handoff ZIP |

Upgrade via in-app checkout (demo) or license keys: `PAL-PRO-XXXX-XXXX` / `PAL-PROPLUS-XXXX-XXXX` — no demo keys are shipped with the app. **Signed in? Keys verify against the registry**: `activate_license` binds the key to your account (one account per key), stamps the activation, and writes the plan + expiry onto your profile — so your plan follows you across devices, and revoked/expired keys are refused with honest messages. Existing `PAL-AGENCY-*` keys are migrated to Pro+ for continuity; Agency is no longer offered as a plan. Signed out, keys use the local checksum path.

**Minting keys:** insert rows into the `licenses` table (SQL Editor → `insert into public.licenses (code, plan, note) values ('PAL-PRO-XXXX-XXXX', 'pro', 'client name');` or `('PAL-PROPLUS-XXXX-XXXX', 'proplus', 'client name')`) or via a secure Edge Function once the sales page exists.

### Referral program
Give a friend **30 days of Pro free**; you earn **7 Pro days** every time a friend redeems your code. Your code (`REF-XXXXXX`) and invite link (`pallettai.org/ref/…`) live in **Settings ▸ Referral program**, friends redeem in the upgrade modal, and the plan pill shows `PRO · Nd trial` while earned days are active (they unlock everything Pro does — unlimited projects/sections/credits, no watermark).

**Two modes.** Connected to a Supabase project (setup below): each account gets **one stable code, minted at signup, that never changes**; every redemption is verified server-side by the `redeem_code` RPC and written to a stamped trace log (`verified` / `already-used` / `self-redeemed` / `not-found`); the redeemer's +30d and referrer's +7d are granted atomically on the server, so rewards are real and follow the account across devices. Signed out (or no project connected): an honest single-machine demo — the “simulate redemption” button exercises the loop locally.

> **Billing runs on Dodo Payments.** The studio asks the registry for a checkout session (Edge Function `dodo-checkout`), Dodo takes the payment, and `dodo-webhook` grants **Pro** or **Pro+** on the signed-in account once the subscription is active. Nothing unlocks locally: `PLANS.store.activate()` refuses any source except the registry. See **[docs/DODO-SETUP.md](docs/DODO-SETUP.md)** for the product ids, secrets and webhook wiring.

## Supabase cloud registry — setup (~10 minutes, free)

The referral program becomes fully server-verified once you point the studio at a free Supabase project. Everything below is $0 on Supabase's free tier.

1. **Create a project** — go to [supabase.com](https://supabase.com) → **Start your project** → new project (e.g. `pallettai-studio`, pick a region, set a database password you'll remember).
2. **Copy your keys** — project dashboard → **Settings → API** → copy the **Project URL** (`https://xxxx.supabase.co`) and the **anon public key** (the long `eyJ…` string). The anon key is safe to embed — row-level security protects the data.
3. **Run the setup script** — **SQL Editor → New query** → paste the **entire** contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. Success = “Success. No rows returned.”
4. **(Recommended for now) instant signups** — **Authentication → Providers → Email**: switch **Confirm email** OFF so accounts activate instantly. (Leave it ON for a public launch.)
5. **Connect the studio** — open **Settings → Account & cloud registry** in PallettAI Studio → paste the Project URL + anon key → **Save & connect** → create your account with an email + password.
6. **Your code is minted** — at signup the registry gives your account a stable `REF-XXXXXX` (visible in Settings). It never changes. Every redemption is stamped server-side, and your +7-day rewards accumulate on the account even if you sign in on another machine.

What the SQL sets up:

| Object | Purpose |
|---|---|
| `profiles` | One row per user — email + server-granted `trial_expires_at` |
| `referral_codes` | One row per user (`owner_id UNIQUE`) — a code can never be minted twice |
| `redemptions` | Immutable trace log — who, which code, when, outcome, days granted |
| `redeem_code(p_code)` RPC | The only redemption path: atomic, stamps every attempt, grants +30d/+7d, blocks self-redeem and re-use |
| `licenses` + `activate_license(p_code)` | PAL-* key registry — bind a key to one account, stamped activation, plan/expiry pushed to the account |
| `user_streaks` | Daily-streak state (1:1 per account) — consecutive days, best, shields (max 2), bonus AI credits, pending wheel |
| `streak_claims` / `wheel_spins` | Stamped audit logs — every daily claim and wheel spin, immutable |
| `get_streak_state()` / `claim_daily_reward(p_action)` / `spin_wheel()` RPCs | The only streak paths: server-decided UTC day, one claim per (user, day), one wheel spin per completed week, outcome picked server-side |
| `credit_spends` | Stamped AI-credit ledger — one row per metered generation (idempotency `ref`, refunds mark `refunded_at`) |
| `get_credit_state()` / `spend_credit(p_ref)` / `refund_credit(p_ref)` RPCs | The only credit paths: the server owns the budget (`3 base + streak bonus`, unlimited on Pro/trial), refunds within 10 minutes |
| `project_backups` + `save_project_backup` / `delete_project_backup` RPCs | Cloud project vault — one row per (account, project); all writes flow through the security-definer RPCs, reads are RLS-scoped, deletes tombstone |
| Signup trigger | Creates the profile + stable code the moment an account is created |
| Row-level security | Users can only read their own profile/code/redemptions/streak/credit rows — the anon key can’t browse data, and signed-out RPC calls are rejected at the permission gate |

**How the app behaves:** on launch it restores the session and syncs your code + trial + license + daily streak in the background; redeeming in the upgrade modal verifies against the registry when you're signed in and falls back to the local demo engine when you're not (or offline). The **Daily streak** widget on the Dashboard lets signed-in users claim a daily bonus after doing one real action (edit, save or AI generation) — Day 1–6 grant escalating bonus AI credits, Day 7 unlocks the prize wheel plus a streak shield, and every grant is decided and stamped by the registry, so it can't be farmed by clock-tampering, double-claims or re-spins. **Signed-in AI credits are server-authoritative too**: every generation is mirrored to the registry with an idempotency key (retries can't double-spend), the budget lives on the server (`3 base + streak bonus`, unlimited on Pro or an earned trial), failed generations refund within 10 minutes, and a wiped local store / reinstall / second device re-syncs to the server's count instead of resetting to 3. Offline spends queue locally and flush on the next sync. **The registry connection is locked once saved** — there's no disconnect button, so verification can't be switched off from the UI (to point at a different project, clear the `pallettai.supabase.cfg.v1` key from DevTools). Nothing leaves this machine except your account row on Supabase.

**Re-running the script:** `schema.sql` is idempotent — re-run the whole file after any update (the license-key, daily-streak and credit-accounting parts are all safe to re-run) with zero risk of duplicates.

### Referral redemption page — pallettai.org/ref/CODE
[`ref.html`](ref.html) is a complete standalone landing page: a friend opens `pallettai.org/ref/AB12CD`, signs in or creates an account right on the page, and the code redeems against the same registry — instantly stamped, with per-outcome messaging (verified / already-used / self-redeemed / not-found). Deploy it to pallettai.org at the `/ref/…` route (it embeds your Supabase URL + anon key at the top of the file), or serve it locally — the dev server already routes `/ref/*` to it.

**Deploying (one file + one rule):** `ref.html` is fully standalone. Upload it to any static host, and add a rewrite so `/ref/CODE` stays in the address bar while serving the page:

| Host | How | Rule file already in the repo |
|---|---|---|
| **GitHub Pages** | Commit `ref.html` + `404.html` to the Pages branch/folder. Pages serves `404.html` for unknown paths; its script catches `/ref/CODE` and forwards to `ref.html?code=…` (merge into an existing 404 if the repo has one) | `404.html` |
| **Netlify** | Drag the folder onto `app.netlify.com/drop` | `_redirects` (works as-is) |
| **Cloudflare Pages** | Upload via dashboard, then paste the rule from `_redirects` into **Settings → Redirects** | `_redirects` |
| **Vercel** | Deploy the folder; `vercel.json` applies the rewrite automatically | `vercel.json` |
| **Any other host** | Upload `ref.html` and share links as `pallettai.org/ref.html?code=CGGHLC` (the page also accepts the query form) | — |

## Where things live

```
data/db.js         Local library — templates, sections, palettes, fonts, animations, suites
data/online.js     Free online databases (Picsum, RandomUser, Quotable, Google Fonts)
data/plans.js      Tiers, limits, license keys, subscription store (cloud-aware referral sync + AI-credit ledger)
modules/supabase.js Zero-dependency Supabase REST client — auth, session restore, registry RPC (referral, license, daily streak, AI credits)
supabase/schema.sql One-paste cloud-registry setup: tables, RLS, triggers, referral/license/streak/credit RPCs
ref.html           Standalone pallettai.org/ref/CODE redemption landing page (same registry)
modules/ai.js      AI engine — prompt → site, images, copy, restyle, logo, alt-text, section rewrite
modules/builder.js Standalone site generator (design system, hero layouts, integrations, theme toggle, cookie banner, multi-page export)
modules/zip.js     Tiny in-app ZIP writer (client handoff bundles)
app.js             Application logic: views, gating, billing, undo/redo, diagnostics, account card, integrations, tabbed settings
```

## The 30-upgrade master roadmap

**Shipped since the roadmap: real form delivery (third-party endpoint), autosave + revision history (⏱), the referral program (7/30 Pro days), the cloud project vault, AI palette extraction from any image, the accessibility + performance pass (focus-visible rings, `aria-live` toasts, OS reduce-motion, `content-visibility` on long lists), saved client briefs, the Reviews + Events/RSVP suites, revision diffing, round-trip client handoff, native chrome (system accent + macOS titlebar), and native right-click menus.**

**A · AI & Intelligence**
1. ✅ AI rewrite for any section (section editor)
2. ✅ AI restyle — palette + fonts from a prompt
3. ✅ AI logo generator
4. ✅ AI alt-text for all images
5. ✅ Iconify icon library (100k+ icons as emblems)
6. ✅ AI palette extraction from any image — drop a client photo, logo or screenshot in Database ▸ Palettes and the dominant colours become a site-ready palette (median-cut quantization, share-weighted brand colour, surface kept AA-solvable, text roles tuned to clear WCAG AA). Fully offline — pixels are analysed on the machine, nothing uploads
7. ◻ Prompt memory — saved client briefs & reusable prompts

**B · Designer & Customization**
8. ✅ Global design panel — width, radius, spacing, custom CSS + JS
9. ✅ Hero layout variants (centered / split / minimal)
10. ✅ Nav options — sticky, transparent, CTA button, uploaded/AI logo
11. ✅ Custom palettes (create, save, apply)
12. ✅ Reusable brand presets (Pro — save up to 12 visual systems across projects)
13. ✅ Custom font uploads (inlined into exports)
14. ✅ Meta description / Open Graph / favicon settings
15. ✅ Client dark/light theme toggle inside exported sites
16. ✅ New sections — Logos strip, Video embed, Countdown
17. ✅ Structured blog post editor
18. ✅ Footer social links editor

**E · Copilot & Style Packs (newest)**
31. ✅ **✦ Copilot chat editor** — plain-English edits to the open site: restyle, copy rewrites, colors/fonts, design tokens, hero/nav/theme, site fields, add/remove/move/duplicate sections, suite install/removal, AI logo/images/alt-text — with per-message undo and suggestion chips
32. ✅ **AI style packs** — 8 one-click looks (Glassmorphism, Brutalist, Neo Retro, Editorial, Cosmic, Luxury Gold, Zen Sage, Playful Pop): palette + typography + spacing/radius + signature CSS in one click

**C · Workflow & Quality**
18. ✅ Undo / redo history (Ctrl+Z / Ctrl+Shift+Z)
19. ✅ Responsive preview — desktop, tablet, mobile
20. ✅ Site diagnostics ("health check" before export)
21. ✅ Project backup & restore (per-project JSON)
22. ✅ Export options — cookie banner, GA4/Plausible analytics, minify
23. ✅ Drag & drop section reordering
24. ✅ Keyboard shortcuts

**D · Growth & Product**
25. ✅ 10 new industry templates (Event, Nonprofit, Podcast, Wedding, Real Estate, Café, Photography, Fitness, Legal, Portfolio — 17 total)
26. ✅ Dedicated Booking block — provider presets, editable booking details, HTTPS validation and export-safe fallback; ◻ New suites — Events/RSVP, Reviews, Membership
27. ✅ Client handoff ZIP (site + hosting guide + brand kit + invoice summary)
28. ✅ One-click publish (Netlify API + Neocities API)
29. ✅ Guided onboarding tour + richer template previews
30. ◻ Shared client review links and workspaces (future collaboration release; not included in Pro+)

**F · Multi-page sites (Phase 1)**
33. ✅ Page model (site.pages) with Home + any extra pages, each with its own sections
34. ✅ Pages bar in the designer — add / rename / delete / switch pages, nav auto-updates
35. ✅ Multi-file export — index.html + about.html etc., nav links resolve across files
36. ✅ Preview iframe navigates between pages and keeps edits in sync

## Settings — tabs & bespoke session

Settings is split into **8 tabs** so nothing is buried:

- **👤 Account & billing** — cloud registry connection, sign in/out, plan, license, referral code + redemption history
- **🎨 Appearance** — studio theme (dark/light), **accent colour** (picker + presets, applies across the studio UI), **UI density** (comfortable/compact), **reduce motion**
- **🏷️ Branding** — the “Made by PallettAI” footer signature (show / text / link)
- **✨ Project defaults** — palette, font, animation, **hero layout, container width, corner radius, section spacing, sticky nav, theme toggle** for new sites (customised palette/font always win; Blank Canvas always uses them)
- **📦 Export** — meta/Open Graph, Google Fonts, cookie banner, analytics provider/ID, minify
- **📡 Online data** — sources on/off, request timeout, **live-widget auto-refresh** (crypto/FX refetch interval on exported sites), cache clear
- **⚙️ Studio** — **autosave snapshots on/off + delay**, **confirm-before-delete on/off**, re-run the guided tour
- **ℹ️ About** — version, pallettai.org, **reset all settings**

## Launched — the “Sites that rank & sell” pass (2026-09-04)

New capabilities added against the research-backed roadmap (see below):

- **🗂️ Collection section (new)** — your own dynamic card gallery that visitors filter by category chips, search and sort live. Pure HTML + a few lines of vanilla JS in the export: works on **any static host with no server and no account**. Variants: filterable grid, plain grid, scroll-snap **slider**, and an auto-scrolling **marquee**. Ships as a free catalog layout (“Filterable Gallery”).
- **📋 Table section (new)** — native, clean, responsive tables for comparisons, menus, schedules and specs. Column headings + one-row-per-line editor, plus a “Comparison — bold first column + zebra rows” design variant and a ready-made “Comparison Table” catalog layout.
- **🔍 Deep SEO engine on every export** — schema.org JSON-LD by business type (LocalBusiness, Restaurant, ProfessionalService… — auto-detects LocalBusiness from address/area), **FAQ rich results** lifted from FAQ sections, canonical + og:url when a site URL is set, and `robots.txt` (+ `sitemap.xml` when a live URL is set) included in zip and publish exports. Set it all in the Designer → Design & branding: Site URL, Business type, Area served.
- **🩺 Launch grade audit** — the health check and every export now show an **A+ → F launch grade** across SEO, performance and accessibility, with plain-English fix hints for each finding.
- **📦 Export report** — after every export you get page weight, lazy-load coverage, structured-data status and the “no lock-in” note (plain HTML/CSS/JS, host it anywhere).
- **⚡ Performance diet** — images export with `decoding=async` + lazy loading (hero stays eager) to protect Core Web Vitals.
- **🎚 WCAG AA palette tuning** — every palette in the Database is scored for text contrast (with per-role ratios); “🎚 AA tune” adjusts the text colours until all roles clear 4.5:1 (brand colours untouched) and saves a tuned custom palette. The Designer palette picker shows a live AA badge too.
- **📐 Custom preview breakpoints** — laptop / tablet-XL / compact-phone presets plus an exact-pixel width field in the Designer preview bar.
- **📍 Local-first AI generation** — the AI Studio takes an optional business name and “town / area served”; the generated site then mentions the area in copy, adds a “Do you serve {area}?” FAQ, and flips the exported schema to LocalBusiness (areaServed) automatically.

**Still on the roadmap (next passes, not yet built):** site-care mode, subscriptions demo toggle for the Shop suite, and the “sites are files, not tenants” trust page. (Round-trip client handoff and visual revision diffing shipped — see below.)

## Launched — the GEO pass — AI answer visibility (2026-09-18)

Answer engines (ChatGPT, Perplexity, Google AI Overviews) increasingly introduce businesses directly instead of listing links, so every export gained an answer layer alongside the SEO stack:

- **📄 `llms.txt` on every export** — the AI-answer summary file at the site root (the llmstxt.org convention): site name, meta-description summary, page links, the site's FAQ passages verbatim (capped at 12) and plain-text contact details. Generated deterministically from the same data the JSON-LD engine reads, so what the structured data claims and what the file offers never drift. Ships unconditionally — with a live URL the page links are absolute; without one they stay relative.
- **🤖 AI-crawler robots.txt policy** — GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended and CCBot are named explicitly with `Allow: /`, so the site's consent to be quoted is unambiguous rather than left to each crawler's default.
- **🧮 AI answer visibility grade** — the export report scores how quotable the site is (meta description, question-shaped content, plain-text contact, live URL), and the delivery-report composite now weights it at 11 alongside performance, keyboard and links.

## The 0.4.0 pass — clients, memory & native feel (2026-09-12)

The remaining roadmap gap-closers, all shipped:

- **✍️ Saved client briefs** — save any prompt + brief + style/photo/one-page options as a named brief, then reload it into the AI Studio with one click. Perfect for repeat clients and seasonal rebuilds. Stored locally (IndexedDB with localStorage fallback), capped at 40, managed with inline chips. Engine: `data/briefs.js`.
- **⭐ Reviews Suite (Pro)** — star-rated review wall with an average rating line and a “leave a review” form that posts through the site's existing form endpoint (Formspree/Web3Forms/generic JSON). Engine + section renderer in `modules/builder.js`.
- **🎟️ Events Suite (Pro)** — dated events list (dates are typed as `YYYY-MM-DD` in the icon field and render localized) with an RSVP form per event — the RSVP button reveals the form pre-filled with the event name and posts through the same delivery pipeline.
- **🕘 Revision diffing** — every snapshot in the ⏱ Autosave history now has a **Diff** button: a human-readable report of what changed (palette, font, spacing, suites, added/removed/edited sections and items) with added/removed/edited badges. Engine: `data/revdiff.js`.
- **📮 Round-trip client handoff** — the Client handoff ZIP now ships every site page with a built-in content editor: the client clicks **✏️ Edit text**, edits headings and copy in place, hits **💾 Save changes**, and their browser downloads the updated page to re-upload to their host. No studio, no account, no build tools. Includes a plain-English `how-to-edit.html` guide, and the editor strips itself from the saved output so round-tripped files stay pristine. Engine: `Builder.injectClientEditor` in `modules/builder.js`.
- **🖥️ Native chrome** — macOS gets a `hiddenInset` titlebar (the topbar flows under the traffic lights and drags the window), plus an optional **Use system accent** setting (Settings ▸ Appearance) that follows the OS accent live, on macOS and Windows.
- **🖱️ Native right-click menus** — cut/copy/paste on inputs, copy on selections, open-in-browser + copy address on links and images. Built in the Electron main process from a strict allow-list (no renderer-supplied menu text), so the web build simply keeps native browser menus.

## Cloud project vault (Settings ▸ Cloud backup)

Projects used to live only in the browser/electron profile — one cleared storage or lost laptop and every client site was gone. The vault mirrors each project to the account's registry row a few seconds after every save and converges the local list with the account's vault on launch:

- **Automatic** — after each save the vault syncs (one debounce for the whole vault, not per project), pushing changed projects through the `save_project_backup` RPC: a 6 MB ceiling per project measured in **UTF-8 bytes** (the same `octet_length` unit the RPC uses), advisory-locked per account+project. A save that lands mid-sync queues one follow-up pass, so nothing is dropped.
- **Multi-device** — on sign-in the vault is read back and merged: identical content (the merge clock ignored) is a quiet no-op whatever the timestamps say, newer local copies are pushed, newer cloud copies are adopted, and a real divergence archives the losing copy as a `conflict` version first. One-off pushes are available via **Back up now**, which waits for any background sync and then runs its own pass.
- **Deletion converges** — deleting a project tombstones its cloud row (`delete_project_backup`), so other devices drop it on their next sync instead of resurrecting it. The decision uses content and payload clocks, never a device clock against a server stamp, so a machine with a fast clock cannot resurrect what another machine deleted. A genuinely newer local edit still survives as a resurrection push.
- **Version history** — every overwrite and deletion files the replaced state in a rolling per-project archive (newest 10). Settings ▸ Cloud backup ▸ **Version history** lets you browse it, **compare** a snapshot with the project as it stands, and restore one; restores go back through the normal audited save path, and the picker includes projects deleted on another device so a tombstoned project can be brought back.
- **Usage at a glance** — the Cloud backup card shows how many projects and how many bytes the account holds in the cloud next to the local count, plus anything too large to sync.
- **Honest limits** — oversized projects are refused client-side on bytes and again by the RPC's own `too-large` outcome (a 200 + outcome, not an HTTP error — never reported as a saved project); unsigned-in users keep local-only behaviour; a vault failure never blocks saving or the rest of the cloud sync.
- **An hour-old session stays signed in** — any authenticated cloud call that comes back 401 (vault reads/writes, credits, streak, account, licenses, checkout, translate) refreshes the session once and replays the request, single-flight so parallel calls share one refresh. A dead refresh token still fails honestly and asks for a sign-in.

Toggle it in Settings ▸ Cloud backup (Automatic backup switch); the merge engine lives in `data/vault.js`, the client methods in `modules/supabase.js`, and `scripts/vault-smoke.js` exercises the whole loop against the mock registry (also part of `npm run release:check`).

## Launched — named milestones & the client care report (2026-09-18)

Each paid tier gained the thing its buyers actually asked for: a way to keep a version, and a way to sell the keeping.

### Pro · Named milestones in autosave history

Autosave history was a rolling log of twelve timestamped snapshots — good for “I just broke it”, useless for “can we go back to the version you sent me on Tuesday?”. A milestone is a snapshot **with a name**, and a named snapshot is **never pruned**: not by the twelve-snapshot rollover at capture time, not by the retention policy behind Settings ▸ Prune (age, per-project count, byte budget), and not by a merge with a second machine. Each tier's allowance lives in one table (`data/milestones.js`) that the plan page and the smoke suite both read — Free keeps 1 per project, Pro 10, Pro+ 25.

- Open ⏱ in the designer, press **★ Pin** on a snapshot and name it (“Approved by the client”). Rename or unpin it later. A milestone row offers **Unpin** where an unnamed row offers Delete, so removing one is always two deliberate steps.
- Restoring and diffing a milestone say which milestone they are: “Comparing the milestone ★ Approved by the client to the project as it is now”.
- The storage panel reports what the guarantee costs and what it bought: “Your 4 milestones are not touched by any of it — 2 of them would have gone without it.”
- The two other places that delete history had to learn the rule (`data/revs-policy.js`, `data/library-merge.js`), and the merge also had to learn that a **name beats an unnamed copy** of the same snapshot — otherwise pinning on the laptop and merging on the desktop could silently discard the name.

### Pro+ · White-label Site Care report

Site Care reads every project and tells the studio which client site needs a call. This is the other half of the same work: the same audit, written for the person who pays the retainer, as one file the studio sends.

- **Client report** in the Site Care header previews and downloads a single self-contained `.html` — inline styles, no script, nothing fetched from the network — so it opens from an email attachment on a phone and prints to PDF from any browser.
- It is built to be **true**: every number is read from the audit taken at that moment; the checks that found *nothing* are listed beside the ones that found something (“Sample contact details — nothing found”), so it reads as work rather than as a bill; and the score's arithmetic is shown line by line, including the case where the penalty is capped at the zero floor.
- It is **the studio's document**: their business name and email from Settings, the site's own accent colour (used only when that colour is dark enough to read on paper), the portfolio line (“one of 7 sites we look after, and 3 currently need attention”), and PallettAI in an HTML comment a client will never open.
- A **text version** is produced from the same model and offered as a copy button, because the first thing most studios do with a report is paste the list into an email.
- It is honest about its limits: nothing here measures page speed, mobile rendering, hosting or ranking, and the report says so rather than implying otherwise.

Both suites run inside `npm run release:check` (`scripts/milestones-smoke.js`, `scripts/care-report-smoke.js`).

## Fixes shipped (2026-09-06)

- **Faster connections & loading** — connection and request-path speedups across the online data sources, so live widgets, photo passes and the database load faster with leaner timeouts and fewer wasted round-trips.
- **Priority 1 reliability hardening** — the crash/error-resilience pass: failures can no longer strand the UI, double-fire an action, or lose work; interrupted AI actions and long-running operations recover their controls and reset/refund cleanly instead of leaving a busy or stuck state.
- **Priority 2 caching, serialization, search & image optimizations** — leaner project save/restore serialization, smarter caching of online data, more robust searching/filtering, and image handling tuned for size and speed (lazy loading, `async` decoding, local re-encoding).
- **ONLINE module fix** — corrected the free online-data module so font lookups, photo sources and their fallbacks behave reliably (see `data/online.js`).
- **Release-prep security work** — hardened the packaged release path: bounded update-check/download timeouts so an offline or unavailable service can never strand the app at launch, safer external-link handling, and a self-contained pre-release gate (`npm run release:check`) that syntax-checks every shipped file, boots the mock registry and runs the full smoke suite before a tag is cut.
- **Windows builds** — the Studio now also ships as a signed Windows NSIS installer via CI, with a stable `PallettAI-Studio-setup.exe` download link and `latest.yml` auto-updates (see [`WINDOWS-SHIPPING.md`](WINDOWS-SHIPPING.md)).

## Fixes shipped (2026-09-05)

- **Design Lab cancellation safety** — closing an in-flight direction study cancels the stale result and refunds its reserved credit exactly once; remix failures do the same.
- **Publish gate safety** — export, handoff and publish share one acknowledgement path; safe repairs re-audit before continuing, and informational-only findings do not block a normal export.
- **AI action recovery** — failed copy/section enhancement and direction remix actions restore their controls and refund the metered credit instead of leaving a busy UI behind.

## Fixes shipped (2026-09-04)

- **Modal re-fire guard** — closing a modal now clears its content, so a stray/retried click on a hidden modal’s button can no longer re-run the action (this previously duplicated pages/projects and could lock the app).
- **Suite-less projects** — importing/restoring older backups (no `suites` array) no longer crashes the exporter (`(p.suites || [])` everywhere).
- **Live widget refresh** — crypto & FX widgets on exported sites can auto-refresh (Settings → Online data).

## Roadmap — referral & license verification

**Shipped — Phase 2b (cloud registry):** accounts + referral verification via Supabase (above). One stable code per user, enforced by the database; atomic redemptions with a stamped trace log; cross-account rewards that follow the account.

**Shipped since:** registry license keys (account-bound `PAL-*` activation via `activate_license` RPC — mint, bind, revoke, expiry), the `pallettai.org/ref/CODE` redemption page, the Integrations hub (Maps, Open-Meteo weather, Universal embed, **Online Booking**, DiceBear, Tawk.to chat), the **Layouts catalog** (12 creative variants — Bento Grid, Code Terminal hero, Masonry Wall, Mosaic Wall, Gradient Band, Stacked pricing, and more — one click to add, all editable, all export-clean), the **Pro+ white-label client handoff** tier, and the **AI Studio v2**: 4 new business types (events, auto, music, nonprofit), layout-aware generation, type-aware image prompts, the 8-style **Logo studio**, and Copilot upgrades (catalog layout commands, map/weather/embed/booking sections, brand kit).

**Still planned:**
- **Phase 1 — offline signed codes:** referral codes become ECDSA-signed payloads (`PAL-REF-<kind>-<issuedAt>-<validUntil>-<sig>`) verified in-app via built-in WebCrypto with an embedded public key (private key stays with PallettAI, so users can’t mint). This turns the app-side verifier into a true offline fallback when the registry is unreachable.
- **Sales plumbing:** a self-serve sales page that mints license keys via a secure Edge Function, so a key can be bought without going through the in-app Upgrade flow.

## Security posture & audit (2026-09-04)

**Already hardened:** RLS on every registry table (users see only their own rows; no client-side insert/update — all writes flow through security-definer RPCs); one stable code per account enforced by `owner_id UNIQUE`; self-redeem and re-redeem blocked server-side; every attempt (success or failure) stamped in `redemptions`; **no demo keys ship with the app** — keys are minted privately and bound one-account-per-key server-side; Electron runs with `contextIsolation` + `sandbox` + `nodeIntegration: false` and external links restricted to http/https; all user content is HTML-escaped (`& < > " '`) everywhere it touches the DOM or an exported site; no service-role key exists anywhere in the repo (only public anon keys).

**Hardened by this audit:**
- `redeem_code` takes an advisory lock per redeemer — a double-click or concurrent tab can never double-grant.
- Referral owners can earn at most **60 reward days total** (farming loops of fake accounts stop paying after that; the friend's +30 still lands).
- `activate_license` takes an advisory lock per key — two accounts racing to bind the same key can't both succeed.
- The signup trigger retries on `unique_violation` instead of failing the whole signup on a rare code collision.
- The dev server returns 400 on malformed URLs instead of crashing (was a one-line DoS) and rejects backslash/null-byte paths.

**Your-side checklist (Supabase dashboard):**
1. Re-run the whole `supabase/schema.sql` (idempotent) to deploy the hardened RPCs + trigger.
2. **Authentication ▸ Providers ▸ Email ▸ enable "Confirm email"** — the single biggest anti-fraud lever: without it, anyone can mint unlimited accounts, which is the only realistic way to farm referrals.
3. Authentication ▸ Settings: raise **minimum password length** to 8+.
4. Authentication ▸ Rate Limits: keep defaults (or tighten signup/token for launch).
5. ~~Delete the demo license rows / demo-key button~~ **Done for 0.3.7** — demo keys are removed from the app, the schema seed, and the docs; the schema now purges any legacy `demo`/`legacy-demo` rows on re-run.
6. Delete the throwaway test accounts under Authentication ▸ Users (`friend-test-927701@example.com`, `friend-web-mtmtwoqw@example.com`).

**Known, accepted trade-offs (client-side app):** the signed-out license path validates a checksum only — forgeable by design, since everything runs locally. The registry path (signed-in) is the real enforcement; for hard enforcement later, gate exports server-side or move the builder to the web. The anon key is public by design (RLS is the protection) — never embed the service-role key in this app.

## Honest caveats

- Contact & newsletter forms in exported sites **deliver for real** when the client pastes a third-party endpoint (Formspree / Web3Forms / any JSON-capable URL) into **Design & branding ▸ Form delivery endpoint** — the exported page POSTs straight to that service, never to PallettAI servers. Without an endpoint, forms stay demo flows. Shop checkout remains a demo.
- AI image generation depends on the free Pollinations API; when unreachable or rate-limited the studio falls back to Picsum and local copy.
- Projects, palettes and subscription state live in `localStorage` on this machine. Optional cloud layer: referral codes and earned trials live on your Supabase project (free tier) and sync in the background. Paid plans are billed through Dodo Payments — the session is created server-side so it is bound to the account you signed in with, and a Standard-Webhooks-signed webhook unlocks Pro or Pro+ once Dodo confirms the subscription.
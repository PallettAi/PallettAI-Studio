# AI Studio Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved 0.3.9 AI slice: structured brief, multi-page generation, rewrite-one-section, Copilot follow-ups, voice lock, competitor structure study, 20 new niches, and DeepL/MyMemory translation with a powered-by label.

**Architecture:** Keep `generateSite`, `studySite`, `enhanceSection`, `chatPlan`, and `site.pages` as the engines. Add small Node/browser helpers (`data/ai-brief.js`, `data/ai-followup.js`, `data/ai-translate.js`) that classic scripts load before `modules/ai.js`. DeepL stays in an authenticated Edge Function; the client never sees the key.

**Tech Stack:** Existing Studio (plain JS, no bundler), Supabase Edge Functions, DeepL API, MyMemory GET API, node smoke scripts.

**Spec:** `docs/superpowers/specs/2026-09-07-ai-studio-upgrade-design.md`

## Global Constraints

- Not a second AI stack — extend the current engines.
- No local translation models; no DeepL key in the client.
- Brand name is not translated unless the user ticks that box.
- Competitor study keeps structure only; a filled brief wins on copy.
- Credits: generate / rewrite section / copy follow-up / translate = 1 on Free, unlimited on Pro or review Pro+.
- Languages: `en es fr de it pt nl pl`.
- New niche ids are exactly: plumber, electrician, solicitor, dentist, accountant, tutor, estateagent, landscaper, vet, physio, nursery, pub, winebar, hotel, garage, tattoo, architect, locksmith, catering, brewery.
- Load new `data/*.js` in `index.html` before `modules/ai.js`.
- TDD: failing smoke first, then minimal implementation. Do not commit unless the user asked in that session (this conversation already said go).

## File map

| File | Responsibility |
|---|---|
| `data/ai-brief.js` | `normalizeBrief`, `normalizeVoice`, `applyBriefToOpts` |
| `data/ai-followup.js` | `isFollowUp`, `applyFollowUp`, last-edit record shape |
| `data/ai-translate.js` | `LANGS`, `collectCopy`, `applyCopy`, `poweredByLabel` |
| `modules/ai.js` | Consume brief/voice/studied; multipage; 20 niches; chatPlan extras |
| `app.js` / `index.html` / `styles.css` | Forms, buttons, chips |
| `modules/builder.js` | `html lang`, translation footer |
| `modules/supabase.js` | `translateSite` RPC to Edge Function |
| `supabase/functions/translate/index.ts` | DeepL proxy |
| `scripts/ai-brief-smoke.js` etc. | Behaviour |
| `scripts/release-check.js` | Wire new smokes |

---

### Task 1: Brief + voice helpers

**Files:**
- Create: `data/ai-brief.js`
- Test: `scripts/ai-brief-smoke.js`

**Interfaces:**
- Produces: `normalizeBrief(input) → { name, area, offer, proofs: string[3], cta, voice }` with `voice` in `warm|premium|punchy`. Empty strings allowed. Proofs always length 3. Name is not required.
- Produces: `normalizeVoice(input) → { tone, banned: string[] }`
- Produces: `briefFilled(brief) → boolean` true when name, offer, or any proof is non-empty.

- [ ] **Step 1: Write the failing smoke**

```js
// scripts/ai-brief-smoke.js
const brief = require('../data/ai-brief.js');
assert(brief.normalizeBrief({ name: '  Rustica  ', proofs: ['A', 'B'] }).proofs.length === 3);
assert(brief.normalizeBrief({ voice: 'LOUD' }).voice === 'warm');
assert(brief.briefFilled({ name: 'Rustica' }) === true);
assert(brief.briefFilled(brief.normalizeBrief({})) === false);
assert(brief.normalizeVoice({ tone: 'premium', banned: ['synergy', ''] }).banned[0] === 'synergy');
```

- [ ] **Step 2: Run it — expect module missing / function missing**
- [ ] **Step 3: Implement `data/ai-brief.js`** (trim, slice proofs to 3, default voice `warm`, banned trimmed non-empty)
- [ ] **Step 4: Re-run smoke — PASS**
- [ ] **Step 5: Load `data/ai-brief.js` in `index.html` before `modules/ai.js`**

---

### Task 2: `generateSite` consumes the brief

**Files:**
- Modify: `modules/ai.js` `generateSite`
- Test: extend `scripts/ai-features-smoke.js` or `scripts/ai-brief-smoke.js` by loading AI via the existing vm harness in `ai-features-smoke.js`

**Interfaces:**
- Consumes: `normalizeBrief`
- Produces: project with `site.brief`, `site.voice`, `site.name` from brief.name, `site.area` from brief.area, tagline/offer from brief.offer, CTA from brief.cta, first three feature texts from proofs when present.

- [ ] **Step 1: Failing test** — `generateSite('generic shop', { brief: { name: 'Rustica', area: 'Leeds', offer: 'Sourdough daily', proofs: ['48h dough','Single farm','Hot delivery'], cta: 'Book a loaf', voice: 'warm' } })` → `site.name === 'Rustica'`, tagline contains sourdough or offer, `site.area === 'Leeds'`, `site.brief.name === 'Rustica'`.
- [ ] **Step 2: Run — fail because opts.brief is ignored**
- [ ] **Step 3: After brand/area resolution, if `opts.brief` then apply those overrides and attach `site.brief` / `site.voice`**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Empty brief fields still use today’s prompt/niche/URL path**

---

### Task 3: Voice lock on copy bank

**Files:**
- Modify: `modules/ai.js` `copyBank` / `fill` / `enhanceSection` / `localPolish`
- Test: `scripts/ai-brief-smoke.js`

**Interfaces:**
- Consumes: `site.voice` or `opts.brief.voice`
- Produces: `applyVoice(text, voice)` — premium lengthens slightly / punchy shortens / banned phrases removed (case-insensitive).

- [ ] **Step 1: Test** `applyVoice('We love synergy and synergy.', { tone: 'punchy', banned: ['synergy'] })` has no `synergy` and is shorter than a premium pass of a long sentence.
- [ ] **Step 2: Fail**
- [ ] **Step 3: Implement `applyVoice` in `data/ai-brief.js`; call it from `enhanceSection` and CTA/hero assignment in `generateSite`**
- [ ] **Step 4: PASS**

---

### Task 4: Multi-page from a filled brief

**Files:**
- Modify: `modules/ai.js` `generateSite` end
- Test: `scripts/ai-brief-smoke.js` (load AI)

**Interfaces:**
- Produces: when `briefFilled(brief)` and `opts.onePager !== true`, `site.pages` with slugs `index`, `services` or `menu` (if niche has `menu`), `about`, `contact`. Home is lean. Contact includes map if area set.
- `opts.onePager: true` keeps a single page.

- [ ] **Step 1: Test pages slugs and that Home hero exists and Contact has a contact section**
- [ ] **Step 2: Fail**
- [ ] **Step 3: After sections exist, `splitPages(project, niche)` moves sections onto pages and aliases `site.sections` to Home**
- [ ] **Step 4: PASS**
- [ ] **Step 5: `Builder.pages` / `buildSitePages` already export extra HTML files — confirm smoke still passes**

---

### Task 5: Twenty niche packs

**Files:**
- Modify: `modules/ai.js` `NICHES`
- Test: `scripts/ai-niche-smoke.js`

**Interfaces:**
- Produces: `matchNiche('emergency plumber in Leeds')` → `plumber`, etc. for all 20 ids. Existing `pizzeria` still wins for pizza.

- [ ] **Step 1: Assert the 20 ids exist and each `matchNiche` keyword hits the right id**
- [ ] **Step 2: Fail**
- [ ] **Step 3: Add 20 packs in the same shape as `cleaning` / `dog` (shorter is OK; include a table when it helps: menu for pub/winebar/brewery, price list for trades)**
- [ ] **Step 4: PASS plus existing `ai-features-smoke` niche pizza/coffee tests**

---

### Task 6: Competitor structure (not copy)

**Files:**
- Modify: `modules/ai.js` `generateSite`
- Test: `scripts/ai-brief-smoke.js`

**Interfaces:**
- Consumes: `opts.studied = [{ url, brand, services: [{title,text}] }]`
- Produces: if brief is filled, do **not** overwrite tagline/about/reviews from studied sites. If services headings exist, use them as feature **titles** only (text still from brief/niche). Attach `site.studied` with url + brand + service titles. Cap at 3.

- [ ] **Step 1: Test filled brief + studied services → feature titles match studied, about text is NOT the competitor about**
- [ ] **Step 2: Fail**
- [ ] **Step 3: In the `if (website)` block, skip copy overwrite when `briefFilled(opts.brief)`; merge `opts.studied` titles**
- [ ] **Step 4: PASS**

---

### Task 7: Copilot follow-ups + niche extras + services page

**Files:**
- Create: `data/ai-followup.js`
- Modify: `modules/ai.js` `chatPlan`
- Test: `scripts/ai-followup-smoke.js`

**Interfaces:**
- `isFollowUp(msg) → 'shorter'|'local'|'salesy'|''`
- `rememberEdit(prev, { raw, targetType, ops })`
- `chatPlan(site, msg, ctx)` — if follow-up and `ctx.targetType`, return `{ acts: [{ op: 'rewriteSection', type, mode, credit: true }] }`. If follow-up and no ctx, reply that there is nothing to tweak.
- `make it more like https://…` → `{ op: 'likeUrl', url, credit: false }`
- `add a menu for a wine bar` → `{ op: 'nicheExtras', nicheId: 'winebar', credit: false }`
- `add a services page` → `{ op: 'servicesPage', credit: false }`

- [ ] **Step 1: Failing tests for those four messages**
- [ ] **Step 2: Fail**
- [ ] **Step 3: Implement helper + chatPlan branches (keep existing commands)**
- [ ] **Step 4: PASS**
- [ ] **Step 5: `app.js` stores last edit after a successful Copilot run; quality-gate chips call the same rewrite/map ops**

---

### Task 8: Translate field walk + label

**Files:**
- Create: `data/ai-translate.js`
- Test: `scripts/ai-translate-smoke.js`
- Modify: `modules/builder.js` footer + `<html lang>`

**Interfaces:**
- `LANGS = [{ id:'en', name:'English' }, …]`
- `collectCopy(project, { translateName:false }) → [{ path, text }]`
- `applyCopy(project, pairs) → project` all-or-nothing (clone first)
- `poweredByLabel(provider)` → `Translations powered by DeepL` / `MyMemory`
- Paths cover tagline, page names, section title/subtitle/text, item title/text. Skip url, email, phone, address, image, href.

- [ ] **Step 1: Failing tests with a tiny project fixture**
- [ ] **Step 2: Fail**
- [ ] **Step 3: Implement walk + builder `lang` + footer when `site.translation` is set**
- [ ] **Step 4: PASS**

---

### Task 9: DeepL Edge Function + client + MyMemory fallback

**Files:**
- Create: `supabase/functions/translate/index.ts`
- Modify: `supabase/config.toml` (add `[functions.translate] verify_jwt = true` — authenticated only)
- Modify: `modules/supabase.js` `translateSite(texts, target, source)`
- Modify: `data/ai-translate.js` `translateViaMyMemory(texts, target)` for unsigned-out / function-down

**Interfaces:**
- Function body: `{ texts: string[], target, source }` → `{ ok, provider:'deepl', texts }` or 503 so the client falls back.
- Never echo `DEEPL_API_KEY`.
- Client: try function when signed in; on fail or unsigned, MyMemory (batch sequentially, join with ` | ` only if under their length cap — prefer one request per string).
- All-or-nothing in `app.js`: apply only if every string returned.

- [ ] **Step 1: Smoke that the function source contains `DEEPL` and does not assign the key into the JSON body**
- [ ] **Step 2: Implement function + `SUPABASE.translateSite`**
- [ ] **Step 3: PASS source smoke**

---

### Task 10: AI Studio + Designer UI

**Files:**
- Modify: `app.js` `renderAI`, `runAI`, section editor, Copilot handler, quality-gate chips
- Modify: `index.html` script tags
- Modify: `styles.css` brief grid

**Interfaces:**
- Brief fields: `#aiOffer`, `#aiProof1-3`, `#aiCta`, `#aiVoice`, `#aiOnePager`, `#aiComp1-3`, `#aiLang`, `#aiTranslateName`, `#btnTranslate`
- Existing `#aiName` / `#aiArea` / `#aiPrompt` stay.
- Filled brief → `onePager` unchecked by default.
- Result card: “Studied N sites”, niche chip, translation label.
- Section editor: “Regenerate this section”.
- Quick magic: Translate control + powered-by label.

- [ ] **Step 1: Wiring smoke in `scripts/ai-studio-upgrade-smoke.js`** asserts those ids / strings exist in `app.js`
- [ ] **Step 2: Fail**
- [ ] **Step 3: Wire `runAI` to pass brief, onePager, and studied (study up to 3 URLs with `isPublicFetchUrl`; skip failures)
- [ ] **Step 4: PASS + `node scripts/release-check.js` still green**

---

### Task 11: Release gate

**Files:**
- Modify: `scripts/release-check.js` to run the new smokes

- [ ] **Step 1: Add the scripts to the smoke list**
- [ ] **Step 2: `npm run release:check` PASS**

---

## Spec coverage

| Spec section | Task |
|---|---|
| Structured brief | 1, 2, 10 |
| Multi-page | 4, 10 |
| Rewrite one section | 3, 7, 10 |
| Copilot follow-ups / like URL / niche extras / gate chips | 7, 10 |
| Voice lock | 3 |
| Competitor study | 6, 10 |
| 20 niches | 5 |
| Translation + powered by | 8, 9, 10 |
| Credits | 10 (reuse existing credit helpers) |
| DeepL key never in client | 9 |

## Execution

User said **go** — execute inline in this session (executing-plans), not a second approval gate.

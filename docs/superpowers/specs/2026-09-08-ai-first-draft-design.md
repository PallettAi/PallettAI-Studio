# AI Studio first draft — ranked photos, uniqueness, generate UX, speed

Date: 2026-09-08
Status: design complete in chat (Approach A: finishing pass on the current engine)
Approved so far: photo ranker (yes). Remaining sections included here so the spec is one implementable document.

## Goal

A friend trial of Generate must open a **complete, distinct site**: logo in the nav, ranked topic-matched real photos already landing, a layout that is not the universal AI skeleton, and copy that does not sound like a prompt. Dropping their own photos onto the live preview must be obvious.

This is a finishing pass on the current engines. `generateSite`, `generateImages`, `photoPicks`, `logo`, `studySite`, `qualityGate`, and `site.pages` stay. We add a ranker, a composition recipe, and a first-draft finisher. We do not replace the generator.

## Non-goals

- A new AI model, BYO keys, or a second generation stack
- Replacing Openverse / Commons / Pixabay / LoremFlickr as sources
- Forcing the user to upload photos before Generate
- Auto-opening the photo picker modal after Generate (that is slow and hides the site)
- Rewriting Studio chrome, billing, Copilot, translation, or niches from 2026-09-07
- Aurora-mesh / no-image heroes as the default for photo-led businesses

## Success for the next trial

1. Prompt only, one click, Designer opens with a logo and visible photo holes.
2. Ranked real photos fill those holes within a few seconds without a blank hero.
3. Two different prompts do not share the same section order, hero layout, and palette.
4. Dropping a JPG onto the preview replaces the targeted slot. No buried “1st → hero” rule as the only path.
5. Generate does not feel like a 5-step spinner then an empty page.

## 1. Photo ranker (approved)

Sources stay: Openverse (primary, commercial licence filter), Wikimedia Commons, Pixabay when a key exists, LoremFlickr last resort.

### Queries

Each slot gets its own query. Do not reuse one search for hero, about, and every gallery tile.

Scene packs grow from `{ hero, about, gallery }` strings to:

```
scenes: {
  hero: [specific, specific, fallback],
  about: [interior / people-at-work, fallback],
  gallery: [close-1, close-2, close-3, close-4]
}
```

Existing niche `scenes` stay valid: a string becomes a one-item list. Gallery string becomes four slight variants (`{scene}`, `{scene} close up`, `{scene} detail`, `{scene} in use`).

Do not broaden to a single generic word (`pizza`, `photo`) until every specific query in that slot has fewer than 4 usable candidates.

### Pool

Fetch ~20 candidates per slot (Openverse page 1 **and** page 2, then Commons if still short). Page 2 exists specifically so we are not stuck with the first-result set.

### Hard rejects

Drop a candidate if any of these match title, filename, tags, or mime:

- diagram, map, flag, logo, icon, chart, screenshot, clipart, seal, coat of arms, svg, vector, book cover, poster, infobox
- width below floor: 1200px hero, 800px about/gallery (when width is known; unknown width is allowed but ranked down)
- non jpeg/png (already Commons-filtered)

### Rank (higher wins)

| Signal | Weight |
|---|---|
| Resolution (width * height) | + |
| Aspect match: hero wants ≥ 1.4 landscape; about wants 0.7–1.3; gallery mixed | + |
| In-scene title/tags: people, interior, kitchen, oven, hands, close, portrait, food, workshop | + |
| First two hits of each raw search | skip entirely |
| Same URL already used on another slot | reject |
| Near-duplicate title (normalized, first 40 chars) already used | reject |
| LoremFlickr | only if the ranked pool produced nothing that loads |

### Placement

1. Creator uploads (if any) still win, in drop order, unless a later Designer drop assigned a slot.
2. Studied-site images next.
3. Ranked web photos fill remaining slots. Validate **top scored** candidates in parallel until one loads. Do not walk the pool in search order.

`bestReal(q, seed)` becomes a thin wrapper: gather, score, return the winner. `generateImages` and `photoPicks` both call the ranker so Pick & choose shows the same quality bar.

Seed still matters: it picks among similarly scored photos so two runs are not identical. It must not pick result #1 because it is #1.

### Failure

If nothing ranked loads: leave the slot empty with a visible hole (see §2). Toast once: “Could not reach photo sources — drop your own onto the preview.” Do not refund the generate credit (the site and logo already exist). Standalone “topic-matched photos” still refunds when zero photos land, as today.

LoremFlickr is last resort for a single slot only after ranked sources fail, never the default look.

## 2. Generate UX

Generate is one credit. That credit buys the site **and** the finishing pass (logo + ranked photos). Logo Studio / later “AI logo” stay free.

### Order of work

1. Spend credit, start progress. Fake 430ms step delays drop to 120ms. Real work (study URL, competitors, `generateSite`) starts immediately, not after the theatre.
2. `generateSite` as today (brief, niche, fingerprint, pages).
3. **Compose** (§3) mutates section order and layouts on the new project.
4. **Logo**: if `site.logo` is empty, `AI.logo(project)` with a spec seeded from the fingerprint (stable for the same brief, not `Date.now()`). Studied-site logos already on the project are kept.
5. Commit project, open Designer. Hero/about/gallery without images render as **photo holes** (skeleton in Builder), not empty color blocks and not random Picsum/pravatar.
6. Background: `runSitePhotos` with the ranker. Each filled slot `touch` + refresh preview. Toast: “Photos landing…” then “Hero, about, and N gallery photos in place.”
7. Do **not** auto-open the photo picker.

### Photo holes

Builder: when `hero` / `about` / gallery items have no `image`, render a reserved-ratio placeholder (hero 16/9, about 4/3, gallery 1/1) with muted fill. No Picsum. Testimonials keep copy-only avatars (initials), not `i.pravatar.cc`, on generated sites. Existing hand-built projects that already have pravatar URLs are untouched.

`qualityGate` already knows image types. Add a **warn** (not error) `missing-photos` when hero has no image after generate. The Copilot chip can say “Drop a photo on the hero.”

### Easy photos (Designer)

Dragging files over the preview iframe shows an overlay with labeled slots currently on the page: Hero, About, Gallery 1…n. Dropping a file compresses through the existing `GPUImage` / `compressPhoto` path and writes that slot (`imageSource: 'Your photo'`).

Also:

- Section editor: click the current image (or the hole) to replace from disk.
- AI Studio upload row: each thumbnail shows a slot chip (Hero / About / Gal 1…). Drag to reorder. Generate still uses that order if they never drop on the preview.
- Pick & choose stays as a power tool. It is not the first-run path.

Caps stay: 10 photos, 20 MB each, 80 MB total.

### AI Studio layout (trial, not a chrome rewrite)

The brief / competitor / voice fields collapse behind **More details**. Prompt, name, area, photo drop, and Generate stay visible. Default photo mode remains `real`. Style pack and classic/auto stay in More details.

## 3. Uniqueness (composition + copy)

Fingerprint, DNA, and niche packs stay. They are not enough: most types still emit hero → about → features → stats → pricing → testimonials → faq → cta → contact.

### Composition recipes

New helper `data/ai-compose.js`. `applyCompose(project, { typeId, nicheId, seed, onePager })` reorders home (and extra pages when present) and assigns catalog layouts that already exist in `DB.layoutsFor`.

Families (pick one variant via seed so two pizza shops still differ):

| Family | Who | Home shape | Layout bias |
|---|---|---|---|
| Menu-first | food niches with a table | hero, table/menu teaser, gallery, about, cta | hero `split`, gallery `mosaic` |
| Gallery-forward | beauty, retail, events, creative | hero, gallery, features, about, cta | hero `split` or `minimal`, features `numbered` |
| Proof-first | plumber, electrician, solicitor, dentist, accountant, garage, locksmith, vet, physio | hero, stats or testimonials, features, about, contact | hero `split`, stats `band`, features `strip` |
| Product/SaaS | tech, edu | hero, features, stats, about, cta | hero `split` or `terminal` (never `aurora` unless prompt says no photos), features `bento` |
| Quiet | default / generic / nonprofit | hero, about, features, testimonials, cta | hero `minimal`, about `floating` |
| Energy | fitness, music, auto | hero, stats, gallery, features, cta | hero `split`, stats `band`, gallery `mosaic` |

Rules:

- Hero stays first. Contact and CTA stay last (CTA then contact, or contact only if no CTA).
- Never three equal feature cards as the first content after the hero when a stronger family exists.
- Do not pick hero `aurora` when photo mode is `real` (aurora is explicitly no-image).
- Do not pick hero `terminal` for food, beauty, or retail.
- `opts.layouts === 'classic'` skips compose layouts but still applies family **order**.
- Extra pages from 2026-09-07 keep their jobs (services/menu, about, contact). Compose only restyles Home plus layout ids that exist on those pages’ sections.

### Copy scrub

`copyBank` default hero line “We'd love to help you with {focus} that makes a difference” is removed. Hero body comes from the niche about (clipped) or the brief offer.

Banned on generated copy (case-insensitive), stripped or rewritten by the existing `speak` / voice path:

`seamless`, `unleash`, `elevate`, `next-gen`, `world-class`, `cutting-edge`, `we’d love to help you`, `makes a difference`, `no jargon, no surprises` as filler.

Eyebrow is not `Welcome to {brand} · {area}`. Use `{area}` alone, or the niche focus, or empty.

Generic about chips (“Certified & experienced team” / “Transparent, honest pricing” / “Local support that answers”) are replaced when a niche pack or brief proofs exist. If neither exists, use three short facts from the prompt focus, not those three stock lines.

Quality titles like “A glimpse”, “Kind words”, “By the numbers” rotate from a small per-family list (still plain language, no section numbering).

## 4. Loading speed

| Today | Change |
|---|---|
| 430ms × ~5 fake generate steps | 120ms theatre; real work overlaps |
| Photo JSON 8s, `loadImage` 8–12s, sequential-ish | JSON 2500ms, image check 2500ms, `mapLimit` 4, stop at first valid per slot |
| Generate opens empty, photos maybe later, picker modal | Holes immediately, fill in place, no modal |
| Openverse page 1 only, 14 hits | Page 1+2, rank locally (CPU is cheap) |
| Full preview rebuild after every photo | Debounce preview refresh 200ms while photos land |
| Gallery Picsum fallback on empty | Hole, then ranked fill; never unrelated Picsum on AI drafts |

Existing `photoCache` / `photoFlights` stay. Ranker results cache by `scene + slot + fingerprint.seed`.

Fake generate steps must not block `studySite`. URL study already has its own timeout; keep it.

## Credits

| Action | Free | Pro |
|---|---|---|
| Generate (compose + logo + ranked photos) | 1 | unlimited |
| Standalone topic-matched photos | 1 | unlimited |
| Pick & choose apply | 1 | unlimited |
| AI logo / Logo Studio after the fact | free | free |
| Dropping your own photo on a slot | free | free |

## Data on the project

```
site.logo                 // SVG data URI from finisher, or studied/uploaded
site.fingerprint          // existing
site.compose = { family, variant, at }
site.photoPass = { status: 'pending' | 'done' | 'failed', placed: { hero, about, gallery } }
```

`photoPass` is session-useful for the toast and the hole state. Safe to omit on old projects.

## Files

| File | Role |
|---|---|
| `data/ai-photos.js` | Score, reject, skip-first-n, aspect, dedupe. Pure. No fetch. |
| `data/ai-compose.js` | Family table, `applyCompose(project, opts)`, copy-title helpers |
| `data/ai-brief.js` | Extend `speak` / banned list for the scrub phrases |
| `modules/ai.js` | Slot queries, gather page 2, call ranker from `bestReal` / `generateImages` / `photoPicks`; finisher logo; fingerprint-stable `randomLogoSpec` |
| `data/online.js` | Openverse already has `page`; pass page 2 from gather |
| `modules/builder.js` | Photo holes; initials avatars on generated testimonials; keep credit markup |
| `app.js` / `styles.css` | Generate order, no auto picker, drop overlay, upload slot chips, More details, faster steps, debounced photo refresh |
| `scripts/ai-photos-smoke.js` | Ranker: rejects diagrams, skips first two, prefers landscape hero, dedupes |
| `scripts/ai-compose-smoke.js` | Food → menu-first; plumber → proof-first; aurora not chosen for real-photo food |
| `scripts/ai-studio-upgrade-smoke.js` | Generate does not auto-open picker; More details; drop overlay hooks exist |
| `scripts/release-check.js` | Wire new smokes |

## Errors

- Ranked sources down: holes + one toast. Site and logo remain.
- Overlay drop of a non-image: existing “Add photo files (JPG, PNG, WebP)” toast.
- Compose gets an unknown layout id: skip that assignment (`qualityGate` already warns).
- User chose photo mode `none` and uploaded nothing: no photo pass, holes stay (minimal look). Logo still applies.
- User chose `ai` art: Pollinations still fills slots; ranker is not used. Logo still applies.

## Tests (TDD)

Failing smokes first:

1. Diagram titled “Flag of Italy map” scores below reject threshold / is filtered out.
2. First two pool items are never selected when ≥ 3 remain.
3. Hero scorer prefers 1600×900 over 800×1200 when both pass floors.
4. Duplicate URL cannot occupy hero and about.
5. String scene `{ gallery: 'pizza' }` expands to ≥ 3 gallery queries.
6. `applyCompose` on a pizzeria home puts table or gallery before features.
7. `applyCompose` on plumber puts stats or testimonials before features.
8. Food + photoMode real never sets hero layout `aurora`.
9. `copyBank` hero text does not contain “makes a difference”.
10. `randomLogoSpec` with the same fingerprint seed returns the same style (no `Date.now()`).
11. App source: `openPicker` is not called with `{ auto: true }` on generate.
12. Builder hole markup exists for hero without image.

Keep existing photo-credit, fingerprint, brief, and niche smokes green.

## Implementation note

TDD: smokes for `ai-photos` and `ai-compose` before wiring `ai.js`. Do not commit unless asked in that session.

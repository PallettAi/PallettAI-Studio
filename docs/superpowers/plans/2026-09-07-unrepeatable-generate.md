# Unrepeatable generate + taste extras

**Goal:** Same brief → same site. Change name/town/offer/voice/niche → a different skeleton. Shuffle look keeps copy. Generated palettes pass WCAG AA. Nav CTA matches the brief. Favicon uses the AI logo. Photo grade is an **optional** toggle (off by default) and must not look cheap.

## Behaviour

- Fingerprint = name + town + offer + voice + niche + prompt + salt. Deterministic seed. No `Date.now` jitter on generate.
- Seed drives look family, AA-safe palette, heading/body pair, hero layout, middle section order (hero first, CTA/contact last), copy-bank picks, photo scene offset.
- Brief facts, niche extras, and Classic layouts stay as they are.
- Save `site.fingerprint`. Shuffle look: increment salt, re-pick palette/fonts/hero/radius/spacing (and grade mode if grade is on). Do **not** reorder sections or rewrite copy. 1 credit (unlimited on Pro).
- `site.navCta` = brief CTA (or the same string as `ctaText`).
- If `site.logo` is a data/image URL and favicon is not a custom emoji, export `<link rel="icon" href="logo">`.
- Photo grade default **off**. Toggle `#aiPhotoGrade`. When on: wrap photographic media only; `isolation: isolate`; `mix-blend-mode: color` or `soft-light` at 12–16%. Food/beauty → soft-light 0.12. Dark/trades → color ~0.16. Skip logos, emblems, avatars, maps, inline SVG. If blend-mode unsupported, skip — never sepia/hue-rotate.

## Files

| File | Role |
|---|---|
| `data/ai-fingerprint.js` | `make`, `nextSalt`, `seededShuffle`, `orderSections`, `photoGradeSpec` |
| `modules/ai.js` | Use fingerprint in `generateSite`; AA palettes; `navCta`; `shuffleLook`; photo seed |
| `modules/builder.js` | Logo favicon; photo-grade CSS/body class |
| `app.js` / `styles.css` / `index.html` | Toggle + Shuffle look |
| `scripts/ai-fingerprint-smoke.js` | Behaviour |

TDD: failing smoke first. Do not commit unless asked.

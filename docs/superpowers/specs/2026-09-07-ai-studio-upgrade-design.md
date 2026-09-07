# AI Studio upgrade — brief, pages, Copilot, niches, translation

Date: 2026-09-07  
Status: approved in chat (DeepL primary, MyMemory fallback)

## Goal

Make the first draft and the edit loop feel like an agency tool: a structured brief, a real multi-page site, rewrite-one-section, a Copilot that remembers the last edit, a voice lock, competitor structure (not copy theft), 20 more niche packs, and whole-site translation via a named online engine.

This is not a second AI stack. `generateSite`, `studySite`, `enhanceSection`, `chatPlan`, and `site.pages` stay the engines.

## Non-goals

- Local / on-device translation models
- BYO model keys in the Studio UI
- Replacing the credit meter or Pro unlimited
- Translating the brand name unless the user ticks that box
- Scraping competitor body copy into the project
- A new chat product or a long-running agent

## Data on the project

```
site.brief = {
  name, area, offer, proofs: [string, string, string],
  cta, voice: 'warm' | 'premium' | 'punchy'
}
site.voice = { tone: 'warm' | 'premium' | 'punchy', banned: string[] }
site.pages = existing multi-page model (Home + extra pages)
site.lang = 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'nl' | 'pl'
site.translation = { lang, provider: 'deepl' | 'mymemory', at }
site.studied = [{ url, brand, services: string[] }]   // up to 3
```

`site.brief` wins over prompt-guessed copy. `site.voice` is set from the brief and obeyed by generate, section rewrite, and Copilot copy ops. Changing voice later does not regenerate the site until the user asks.

## 1. Structured brief

AI Studio grows a compact intake above the prompt: name, town, offer, three proof points, CTA, voice. The free-text prompt stays as flavour.

On Generate, `generateSite` receives `opts.brief`. Filled brief fields override brand, area, tagline/offer, feature proof lines, and the primary CTA. Empty fields fall back to today’s prompt / niche / URL-study behaviour.

The brief is copied onto the saved project so later rewrites use the same facts.

## 2. Multi-page from one brief

When a brief is filled, default to a multi-page site (checkbox can force a one-pager).

Pages, using the existing `normalizePages` / nav:

| Page | Slug | Typical sections |
|---|---|---|
| Home | `index` | hero, features teaser, proof (stats or testimonials), CTA |
| Services or Menu | `services` / `menu` | full features, pricing, niche table if present |
| About | `about` | about, stats, testimonials |
| Contact | `contact` | contact, FAQ, map if `area` is set |

Copilot: “add a Services page from the features” builds that page from the current features section without regenerating Home.

Free-tier section and project limits still apply. Extra pages do not bypass the section cap; we keep the four pages lean.

## 3. Rewrite one section

Section editor and Copilot expose **Regenerate this section**. It calls the existing `enhanceSection` / copy-bank path with brief + voice + niche, and does not touch images or other sections. One credit (unlimited on Pro), undoable.

## 4. Smarter Copilot

`chatPlan` gains a last-edit context owned by `app.js` (the last successful ops + target section + raw message).

- Follow-ups “shorter”, “more local”, “less salesy” apply to that target via a copy rewrite. If there is no last edit, say so — do not restyle the whole site.
- “Make it more like {url}” runs `studySite` and applies design DNA / layout hints only. Copy, brief, and voice stay.
- “Add a menu for a wine bar” (and similar) `matchNiche` + `nicheExtras` onto the current page.
- After the quality gate, chips: “Fix the weak CTA”, “Add a map for {area}” when those findings exist.

Deterministic layout / add-section ops stay free. Copy rewrites stay 1 credit.

## 5. Voice lock

`warm` / `premium` / `punchy` change sentence length, formality, and CTA heat in `copyBank` / `enhanceCopy` / `enhanceSection`. Optional `banned` phrases are stripped or rewritten when they appear. Voice is not a style pack and does not change palette or fonts.

## 6. Competitor study

Up to three public HTTPS URLs (reuse `isPublicFetchUrl`). Each is `studySite`’d. We keep **structure**: service heading list and a suggested section order. We do **not** paste their about/reviews/tagline over a filled brief.

The result card shows “Studied N sites”. Failed URLs are skipped with a toast; one success is enough to continue.

## 7. Twenty new niche packs

Same shape as pizza/coffee (keywords, focus, scenes, taglines, about, features, stats, FAQs, testimonials, pricing, gallery, optional table).

Add exactly these ids, chosen to cover trades and professions the current food/beauty set misses:

`plumber` · `electrician` · `solicitor` · `dentist` · `accountant` · `tutor` · `estateagent` · `landscaper` · `vet` · `physio` · `nursery` · `pub` · `winebar` · `hotel` · `garage` · `tattoo` · `architect` · `locksmith` · `catering` · `brewery`

Matching stays “longest / earliest keyword wins”. New packs must not steal existing ids (`pizzeria`, `coffee`, `dog`, …).

## 8. Translation (online only)

### Engines

1. **Primary — DeepL** via a new Edge Function `translate` on the official registry. `DEEPL_API_KEY` lives in function secrets only. Studio never embeds it.
2. **Fallback — MyMemory** (`https://api.mymemory.translated.net/get`) when DeepL is unset, quota-fails, or the function is unreachable. No key.

The UI always shows which engine actually ran:

- DeepL: `Translations powered by DeepL`
- MyMemory: `Translations powered by MyMemory`

The label appears on the AI Studio translate control and on the exported site footer while `site.translation` is set. It is not a PallettAI claim of authorship.

### Behaviour

Languages: English (source), plus Spanish, French, German, Italian, Portuguese, Dutch, Polish.

Translate **visible copy**: tagline, section titles/subtitles/text, item titles/text, FAQ, CTA, page names. Do not translate the brand name unless “Translate the name” is checked. Do not translate URLs, emails, phones, map addresses, or image srcs.

Sets `site.lang` and the export `<html lang>`. One credit per full-site translate (unlimited on Pro). Undoable. Re-translate to English restores from undo, not a second machine pass, when the previous snapshot exists.

Offline / both engines fail: toast, no partial write.

## Credits and gating

| Action | Free | Pro / review Pro+ |
|---|---|---|
| Generate (brief / multi-page / competitors) | 1 credit (same as today) | unlimited |
| Rewrite one section | 1 | unlimited |
| Copilot copy follow-up | 1 | unlimited |
| Translate site | 1 | unlimited |
| “Like this URL” restyle | free if only DNA/layout | 1 if copy is also rewritten (it is not, in this spec) |
| Add niche extras | free | free |

## Files

| File | Role |
|---|---|
| `data/ai-brief.js` | Normalize / validate brief + voice |
| `data/ai-followup.js` | Last-edit context + follow-up detection |
| `data/ai-translate.js` | Field walk, language list, label helper (no secrets) |
| `modules/ai.js` | `generateSite` consumes brief/voice/studied; 20 niches; multi-page assembly |
| `app.js` / `index.html` / `styles.css` | Brief form, pages checkbox, rewrite button, translate UI, Copilot follow-ups, gate chips |
| `modules/builder.js` | `lang` on `<html>`, powered-by footer when translated |
| `modules/supabase.js` | `translateSite` → Edge Function |
| `supabase/functions/translate/index.ts` | DeepL proxy, authenticated only |
| `scripts/ai-features-smoke.js` + new brief/followup/translate/niche smokes | Behaviour |

## Errors

- Competitor URL private / failed: skip that URL, continue.
- Brief invalid (empty name when other fields set): keep generating from the prompt, do not block.
- Translate: no silent English leftover mixed with a new language — all-or-nothing.
- DeepL 403/456: fall through to MyMemory once, then fail.

## Tests (TDD)

Failing smokes first for: brief override, multi-page slugs, section rewrite isolation, follow-up targeting, voice banned phrases, competitor structure-not-copy, each new niche id matches, translate field walk + powered-by label, Edge function never returns the DeepL key.

## Approval

Approved in chat 2026-09-07: items 1–5, competitor study, 20 niches, DeepL + MyMemory translation with a `powered by` label.

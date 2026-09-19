# Handoff — Pro and Pro+ feature pass

Two features, one per paid tier, chosen because each tier was selling a promise
it did not really keep.

`scripts/milestones-smoke.js` — **110 checks pass**. `scripts/care-report-smoke.js`
— **90 checks pass**. Full `npm run release:check` passes. Nothing was committed.

## Why these two

- **Pro** sold “unlimited projects, all suites, unlimited AI” — which is Pro
  being *Free without limits*, and nothing a freelancer could not get by working
  around it. Meanwhile autosave history kept twelve disposable snapshots and
  nothing else, so the one version a client signed off on expired about ten
  edits later. Pro now owns keeping a version.
- **Pro+** sold removing our badge — a negative. A tier that costs £19/month
  needs something the studio can **sell on**, not something it can stop showing.
  The Site Care sweep already knew which client site had gone stale, and no
  studio can bill a client for an internal alarm. Pro+ now owns the document
  that alarm becomes.

## Pro · Named milestones (`data/milestones.js`)

A milestone is a revision with a `pin` name on it, and **a named snapshot is
never pruned**. That guarantee is the whole feature, so it is enforced in all
three places that delete history rather than only where it is described:

| Place | Before | Now |
| --- | --- | --- |
| `captureRevision` (app.js) | newest 12 only, then a global byte prune | `Milestones.rollover` keeps every named row *in addition* to the 12; `Milestones.trimToBudget` keeps named rows and each project's newest snapshot |
| `RevsPolicy.plan` (the Prune button) | age, count and byte budget applied to everything | named rows exempted before anything is counted, and what that saved is reported (`milestones.savedByAge/Count/Budget`) |
| `LibraryMerge.union` (a merge with a second machine) | union capped at 12, newest first | the cap counts unnamed rows only, and a **name beats an unnamed copy** of the same snapshot |

Tier allowances (Free 1, Pro 10, Pro+ 25, per project) exist in one table,
`Milestones.LIMITS`, which `data/plans.js` advertises and the suite cross-checks —
a feature list that promises more than the module allows is a refund.

UI: the ⏱ history picker gains **★ Pin** / **Rename** / **Unpin**, a named row is
marked and named, its diff and restore say which milestone they refer to, and a
milestone row offers Unpin where an unnamed row offers Delete — so removing one
is always two deliberate steps. Free users get one, on purpose: the thing that
sells this feature is having used it once.

## Pro+ · Client care report (`data/care-report.js`)

One self-contained `.html` built from the audit, with three rules taken from the
document's own job (it is read by someone who cannot debug it):

1. **It has to be true.** Every number is read from the audit at the moment the
   button is pressed; all eight checks are listed, including the ones that found
   nothing (“Sample contact details — nothing found”); the score's arithmetic is
   shown; and the zero-floor clamp is stated rather than hidden.
2. **It has to arrive working.** Inline styles, no `<script>`, no `<link>`, no
   network URL of any kind, plus `@page` and `@media print` rules.
3. **It has to be the studio's document.** Their business name/email from
   Settings, the site's own accent colour — used only when it is dark enough to
   read as ink on white, with a stated fallback — and the portfolio line. The
   tooling is named in an HTML comment and nowhere a client will look.

Preview is the exported document itself, in an `about:srcdoc` frame (the same
pattern the designer preview and the changelog already use), so the preview
cannot drift from the file. A plain-text version is generated from the same
model for pasting into an email.

## Defects found on the way

1. **`RevsPolicy.apply` could delete the wrong snapshot.** Pass 2 recorded the
   drop index from the *compacted* list, while `apply` splices the *stored* list.
   The two coincide while pass-1 drops form a suffix — which they do for a
   time-ordered list — so the bug was latent rather than live, and reachable for
   a project whose list came back out of order (a restored or hand-edited file).
   Pass 2 now carries each row's original index, and `plan.keep` is materialised
   from the rows that survived instead of being sliced from the end, so the plan
   and the prune are the same decision. Asserted directly.
2. **The capture-time byte prune could empty a small project's history.** It
   decided purely on the global sort, so whether a project lost its only restore
   point depended on byte sizes elsewhere in the library — the exact worst case
   `RevsPolicy` refuses. `Milestones.trimToBudget` keeps each project's newest
   snapshot unconditionally, and the suite asserts it with a big project beside
   a small one.
3. **`LibraryMerge.union` gave the revision cap no idea what a name was**, and
   its duplicate rule was “whoever was read first”. Both fixed: the cap skips
   named rows, and a pin beats an unnamed copy of the same timestamp (later
   `pinAt` wins between two names). Reported as `milestones` + a note in the
   restore dialog.

## Honest caveats

- **The 12 is a cap on unnamed snapshots, not on stored rows.** A project with
  25 milestones holds 25 + 12. That is deliberate — the alternative makes each
  new autosave trade one milestone away — but it means the per-project row count
  is not bounded by a constant any more, only by the tier allowance and the
  global byte budget.
- **The budget is a target, not a wall**, and both guarantees can exceed it.
  That was already true of “the newest snapshot is never dropped”; it is now
  true of named ones too, and the panel says so.
- **The care report has no trend line.** A “62 → 81 since July” line would be
  the strongest sentence in the document, but there is nowhere to read a past
  score from that is not a lie — no scan history is stored. It needs a new store
  key (`pallettai.carescans.v1`), a `Schema` registration and a `LibraryMerge`
  kind; deliberately not smuggled in here.
- **The report is not a substitute for the studio's judgement.** It reads
  content, not construction, and says so in its own last section.

## Files touched

`data/milestones.js` (new) · `data/care-report.js` (new) ·
`data/revs-policy.js` · `data/library-merge.js` · `data/plans.js` · `app.js` ·
`styles.css` · `index.html` · `scripts/milestones-smoke.js` (new) ·
`scripts/care-report-smoke.js` (new) · `scripts/release-check.js` · `README.md`.

No git operations. The sibling `pallettai-win-build` worktree was left untouched.

---

# Second pass — the promise, and a starting point of your own

`scripts/whitelabel-smoke.js` — **50 checks pass**. `scripts/starters-smoke.js`
— **90 checks pass**. Full `npm run release:check` passes. Nothing was committed.

## Why these

- **Pro+ sold “Unbranded exports (no studio badge)” and that sentence was
  false.** The badge was removed and three other client-visible things carried
  our name: the footer signature (from the shipped default), the panel a
  photo-less hero or About section draws, and the storage keys the exported site
  wrote — which its own generated cookie policy then disclosed. A studio paying
  £19/month for white-label delivery could not see any of it, and no test
  covered it: `badge-attribution-smoke` asserted only that
  `/pallettai-badge/` was absent.
- **Pro sold “unlimited everything”, which is Free without limits.** Its
  buyers build the same site shape repeatedly; the two ways to start were
  duplicating a finished project (which carries the last client's identity,
  copy and photos into the new build, and looks full the whole time) or a
  built-in template that is not their shape. Pro now owns the shelf.

## Pro+ · White-label, actually (`data/whitelabel.js`)

One module owns two jobs: derive a neutral storage namespace for an exported
site, and scan a built export for brand text. Severity is the whole design — the
same fact is an error on Pro+ and a note on Free, because on Free the
attribution is the deal.

| Where | Before | Now |
| --- | --- | --- |
| Footer signature (`builder.js` `buildFooter`) | our shipped default on every page, on every plan | on Pro+ the default is treated as **unset**: the studio's own business name/site, or nothing. A string the studio typed is always honoured |
| No-photo panel (`heroPlaceholder`) | “Built with PallettAI Studio” + our ◆ | on Pro+ the site's own tagline, no mark. The panel stays: an empty media column looks broken, not unbranded |
| Site storage keys | `pallettai_theme_*`, `pallettai_cookies_ok`, `pallettai_cart_*` | derived from the site's own name (`willowcafe_theme_*`) on **every** plan — it is the client's site on every plan |
| Cookie policy table (`legal.js` `storageRows`) | disclosed our key names | reads the same function the builder writes with, so the policy cannot disagree with the site |
| Before delivery | nothing checked | every export, handoff and publish scans and shows the findings with **Use my studio details**, or lets the studio ship anyway. Dismissal is remembered per revision |

Developer-visible fingerprints (`data-pai-build`, `pai-*` classes, `--pai-sched-h`)
are reported as information and **not** renamed: they are invisible to a visitor,
and `review-smoke.js` and `concierge-schedule-smoke.js` pin the exact strings
because the client-review round-trip and the schedule bar read them. Renaming
them is a real option later, and it is the one remaining gap between “nothing a
client can see” and “nothing at all”.

One deliberate behaviour worth knowing: on Pro+, typing our exact shipped
default into the footer text field does nothing, because it is
indistinguishable from never having touched it. Anything else is honoured —
including, if a studio insists, our name in words of their own — and the scan
then reports it as the breach it is.

## Pro · Starters (`data/starters.js`)

A starter is a project with the client taken out. `fromProject` strips
`IDENTITY` (business name, tagline, description, contacts, hours, area, domain,
SEO description, og image, logo, form endpoint, chat widget, WhatsApp, analytics
id, schema type, socials), and — unless **Keep this copy and photos** is ticked —
every section's `COPY` (`title`, `subtitle`, `text`, `extra`, `badge`) and `ASSET`
(`image`, `alt`, `video`, `poster`), plus each card's text and image. What
survives is the shape: pages and their order, section types and order, layouts,
animations, card counts and icons, palette, fonts, design numbers, hero layout,
the locked brand kernel and the suites.

`instantiate` builds a new project with fresh ids for every page and section
(ids are passed in, so the app's own `uid()` is used and a test can reproduce
it), keeps `site.sections` aliased to the active page, and stamps `createdAt`/
`updatedAt` at the moment of the build rather than the moment the starter was
saved.

Tier: Free 0, Pro 24, Pro+ 24, in one table that `plans.js` advertises
(`limits.starters`) and the suite cross-checks. The shelf renders in Templates
(the place a project begins), saves from the ★ on a project card, is in the
library backup, and merges across machines as a `list` kind by id + createdAt.

## Bugs found on the way

1. **The handoff invoice threw and took the whole ZIP with it.** Its line item
   read `${esc(p.name || 'website')}` where `p` exists in no enclosing scope, so
   entering a client name or an amount raised a `ReferenceError` inside the click
   handler — and because the invoice card is rendered while the file list is
   built, **no handoff ZIP was produced at all**. The invoice is one of the four
   things the Pro+ pack advertises. Fixed, and the card now names the studio as
   the biller.
2. **The brand-preset cap silently deleted the oldest system.**
   `brandPresets.unshift(next); if (length > 12) pop();` — twice. Saving a
   thirteenth preset removed a customer's first client's whole visual system
   with no message. Now `saveBrandPreset` refuses and the dialog names the row it
   would have to give up.
3. **The client how-to page described the Edit button as purple** when
   `.pai-edit-btn` is `#7cc0f8`. It ships in every handoff ZIP.
4. **`README.md` claimed Pro gets “unbranded site exports”.** It does not —
   `proExport` is `isProPlus()`, and the exported-site footer kept our name on
   Pro too. The README table and paragraph now match the code.

## Honest caveats

- **The neutral storage namespace renames a visitor's stored preference once.**
  An already-deployed site exported before this change keeps reading the old key
  until it is re-exported, and one theme choice or basket is lost when it is.
  That is the price of the client's own name in their own privacy page.
- **Copy is blanked, not templated.** A structure-only starter arrives with the
  right pages and sections and no words, which the quality gate will correctly
  flag as empty sections until the studio fills them in. Inventing filler copy
  would be worse: it is the thing that gets published by mistake.
- **`Keep this copy and photos` is a one-way switch per starter.** It is
  recorded on the starter (`keepCopy`) and shown on its card, but flipping it
  later means saving a new starter.
- **The starters shelf is not in the cloud vault** — it travels in a library
  backup and across a merge, like brand presets, but not automatically between
  machines.

## Files touched

`data/whitelabel.js` (new) · `data/starters.js` (new) · `modules/builder.js` ·
`data/legal.js` · `data/plans.js` · `data/library-merge.js` · `app.js` ·
`styles.css` · `index.html` · `scripts/whitelabel-smoke.js` (new) ·
`scripts/starters-smoke.js` (new) · `scripts/legal-pages-smoke.js` ·
`scripts/release-check.js` · `README.md`.

No git operations. The sibling `pallettai-win-build` worktree was left untouched.

## Suggested next steps (not built)

1. **Scan history and a trend line** for the care report (store key + schema +
   merge kind), which is the one sentence that turns a report into a retainer
   argument.
2. **A recurring care run** — the report already carries a `reviewBy` date and
   the reason for it; a job tray reminder on that date is what makes the retainer
   automatic rather than remembered.
3. **Milestones in the cloud vault.** Pinned revisions are local and merge
   locally; they are not yet part of the vault payload, so a milestone does not
   travel to a second machine unless a library backup is taken by hand.
4. **A batch care report** across every flagged project, for the studios whose
   whole point is looking after more than one site.

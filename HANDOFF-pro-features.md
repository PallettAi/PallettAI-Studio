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

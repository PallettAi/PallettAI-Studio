# Dodo Payments — setup

Everything the code needs is already wired. What is left is creating the
products and pasting ids and secrets into three places.

Nothing here is code you have to write. It is copying strings between two
dashboards and this repo.

---

## What you need before you start

- A Dodo Payments account (you have one, from calibrEAT).
- Your **test-mode** credentials first. Switch to live only once a real payment
  has worked end to end in test mode.
- Access to the Supabase project for Studio: `fjahxichioccknszuxhb`.

Dodo has two credential sets — one for test mode, one for live mode. The
secret **names** are the same in both; only the values change. That is
deliberate: switching to live is replacing four values, not editing code.

---

## Step 1 — Create two Studio products

Dodo dashboard → **Products** → **Add Product**.

| Product | Type | Price | Billing | Currency |
|---|---|---|---|---|
| PallettAI Studio Pro | Subscription | 9 | monthly | GBP |
| PallettAI Studio Pro+ | Subscription | 19 | monthly | GBP |

Subscription products have a **$1 minimum** in Dodo, so keep the amount in the
currency's major unit as above.

Do **not** enable license keys on these two. The Studio plan binds to the
signed-in account through session metadata, and licence keys are a separate
thing the app already handles itself.

After saving each product, copy its **product id** — it looks like
`pdt_xxxxxxxxxxxxx`. You need both for Step 2.

> Create these first in **test mode** and again in **live mode**. A test-mode
> product id will not work with a live-mode API key.

---

## Step 2 — Put the product ids on the registry

The checkout session is created by an Edge Function, so the product ids are
**secrets**, not website config.

Supabase dashboard → your project → **Edge Functions** → **Secrets**
(or the CLI, shown in Step 6):

| Secret | Value |
|---|---|
| `DODO_PRODUCT_PRO` | the Pro product id (`pdt_…`) |
| `DODO_PRODUCT_PROPLUS` | the Pro+ product id (`pdt_…`) |

---

## Step 3 — Create the API key

Dodo dashboard → **Developer → API**.

Copy the key. It goes into the same secrets list, as `DODO_API_KEY`.

This key never appears in the app or the website. Only the `dodo-checkout`
function reads it, and only server-side.

Also set the **API base** so test and live are unambiguous:

| Secret | Value |
|---|---|
| `DODO_API_BASE` | `https://test.dodopayments.com` for test mode, `https://live.dodopayments.com` for live |

Leaving `DODO_API_BASE` unset defaults to test mode — which is the safe
default, but it will quietly accept a test key with live products, so set it
explicitly.

---

## Step 4 — Add the webhook

Dodo dashboard → **Developer → Webhooks** → **Add endpoint**.

**URL**

```
https://fjahxichioccknszuxhb.supabase.co/functions/v1/dodo-webhook
```

**Events to subscribe to**

```
payment.succeeded
payment.failed
payment.processing
payment.cancelled
subscription.active
subscription.renewed
subscription.updated
subscription.plan_changed
subscription.unpaused
subscription.paused
subscription.on_hold
subscription.past_due
subscription.cancelled
subscription.failed
subscription.expired
```

`subscription.updated` is the important one and the dangerous one: Dodo fires
it on *any* field change. The function reads the `status` inside it rather than
treating the event's arrival as a plan change, so a customer who edits their
billing address keeps their plan. Events not in this list are ignored safely —
Dodo gets a 200 and stops retrying.

**Signing secret**

Dodo shows a signing secret starting `whsec_`. Put it in secrets as:

| Secret | Value |
|---|---|
| `DODO_WEBHOOK_SECRET` | the `whsec_…` value |

Dodo signs webhooks with the **Standard Webhooks** spec — headers
`webhook-id`, `webhook-timestamp`, `webhook-signature`, and the signed content
is `id.timestamp.body`. That is not Stripe's scheme, and the code implements it
directly with Web Crypto (no dependency). If you ever swap the secret, events
start being rejected with a 400 `bad-signature` until you update it.

---

## Step 5 — Run the database migration

The schema changed: `apply_stripe_entitlement` is dropped and
`apply_dodo_entitlement` replaces it, with `dodo_*` columns.

Supabase dashboard → **SQL Editor** → paste and run
`supabase/schema.sql`.

The file is idempotent — it is safe to run again. Two things it does that are
worth knowing:

- It **drops** `apply_stripe_entitlement` and the `stripe_events` table. A
  webhook-shaped function that grants Pro should not outlive the provider it
  was written for.
- It **keeps** the `stripe_customer_id` / `stripe_subscription_id` columns.
  They hold the ids of anyone who paid before the switch, and a dropped column
  cannot be read back. Nothing reads them any more.

### About your existing Stripe subscribers

This is a hard cutover, so nothing grants Pro from Stripe any more. But the
webhook deliberately will **not** strip anyone either: a profile still carrying
`entitlement_source = 'stripe'` is left untouched by a Dodo event, and keeps
whatever plan it had. So nobody loses access silently — you decide their fate
by hand.

To see who is affected:

```sql
select id, email, plan, plan_expires_at, stripe_subscription_id
from public.profiles
where entitlement_source = 'stripe';
```

You have three options for that list, and they are all one statement:

```sql
-- (a) Grandfather them: keep Pro, but note why, so a future audit can find them.
update public.profiles
set entitlement_source = 'grandfathered', plan_expires_at = null, updated_at = now()
where entitlement_source = 'stripe';

-- (b) Leave them on Stripe until their period ends, then let them lapse.
--     Do nothing now, and clear them once you have cancelled in Stripe:
-- update public.profiles set plan = 'free', entitlement_source = null
-- where entitlement_source = 'stripe' and plan_expires_at < now();

-- (c) Move them onto Dodo subscriptions and let the webhook take over.
```

Whichever you pick, do it **after** running the schema, and cancel the
corresponding Stripe subscriptions in Stripe or you will keep being charged
fees on them.

---

## Step 6 — Deploy the functions

From `PallettAI-Studio-src`. Two things about the commands below that cost
time if you hit them cold:

- **The CLI is not installed as a bare `supabase` on this machine.** It ran
  through `npx` originally, so `supabase secrets set` gives
  `command not found` — use `npx supabase ...` instead.
- **Every command needs the project ref.** Run in this folder without it, the
  CLI answers `Cannot find project ref. Have you run supabase link?` — the
  earlier session never wrote the link state it looks for. Passing
  `--project-ref` is the quickest way past it.

```bash
REF=fjahxichioccknszuxhb
npx supabase login

npx supabase secrets set --project-ref "$REF" \
  DODO_API_KEY=... \
  DODO_WEBHOOK_SECRET=whsec_... \
  DODO_API_BASE=https://test.dodopayments.com \
  DODO_PRODUCT_PRO=pdt_... \
  DODO_PRODUCT_PROPLUS=pdt_...

npx supabase functions deploy dodo-webhook --project-ref "$REF"
npx supabase functions deploy dodo-checkout --project-ref "$REF"
```

**No CLI needed:** Dashboard → Project Settings → Edge Functions → Secrets
adds the same values by hand, which avoids the install and login entirely. It
is the easier route if you are only setting these once.

**Where it actually stands:** `DODO_PRODUCT_PRO` and `DODO_PRODUCT_PROPLUS` are
set. `DODO_API_KEY`, `DODO_WEBHOOK_SECRET` and `DODO_API_BASE` are **not** — so
`dodo-checkout` returns `503 not-configured` and the app cannot take a payment
until they are. Nothing in the app says which one is missing; the Edge Function
log is the only place that names it.

`supabase/config.toml` already sets `verify_jwt = true` for `dodo-checkout`
and `false` for `dodo-webhook`. Do not flip those: the JWT is what makes the
account binding trustworthy on checkout, and the signature is what
authenticates the webhook.

The old `stripe-webhook` and `billing-portal` functions have been deleted from
the repo. Delete them in the Supabase dashboard too, or they stay live as
reachable endpoints with nothing behind them:

```bash
supabase functions delete stripe-webhook
supabase functions delete billing-portal
```

---

## Step 7 — Wire the website

The site's buttons all read from **one file**: `pallettai-website/payments.js`.

1. In Dodo, create the products behind each key below (test mode first).
2. Paste each `pdt_…` id into the matching `''`.
3. Put your **Business id** (Dodo dashboard → Settings) into
   `PORTAL_BUSINESS_ID`. That is what "Manage billing" opens.
4. Set `PORTAL_MODE` to `'test'` while testing, `'live'` when you go live.

| Key | Product | Price |
|---|---|---|
| `studioPro` | PallettAI Studio Pro | £9/mo |
| `studioProPlus` | PallettAI Studio Pro+ | £19/mo |
| `depositCreate` | Create Website — deposit | £99 |
| `depositRefresh` | Refresh & Upgrade — deposit | £49 |
| `depositCustom` | Custom Builds & Bots — deposit | £149 |
| `balanceCreate` | Create Website — balance | £150 |
| `balanceRefresh` | Refresh — balance | £100 |
| `balanceCustom` | Custom Builds — balance | £200 |
| `careLiteMonthly` | Care Lite | £19/mo |
| `careLiteAnnual` | Care Lite, billed yearly | £15/mo |
| `careMonthly` | Care | £49/mo |
| `careAnnual` | Care, billed yearly | £39/mo |
| `carePlusMonthly` | Care Plus | £99/mo |
| `carePlusAnnual` | Care Plus, billed yearly | £79/mo |

`studioPro` and `studioProPlus` **must** be the same products you set as
`DODO_PRODUCT_PRO` and `DODO_PRODUCT_PROPLUS` in Step 2 — otherwise someone
buys one thing on the website and is granted another in the app.

Then check your work:

```bash
cd pallettai-website
node check-payments.js
```

It prints how many ids are still empty and fails if any page references a key
the config does not define. When it says every id is set, the website is live.

**Until you fill these in**, every Pay button says "Order by email" and points
at the support page — deliberately. A button that silently does nothing is
worse than one that offers an alternative, and the console names the exact keys
still missing.

---

## Step 8 — Prove it works before going live

In test mode, with Dodo's test card:

1. **Subscribe.** Sign in to Studio → Upgrade → Choose Pro. The modal should
   show "Pay with Dodo" and open a Dodo checkout page.
2. **Check the binding.** The plan must land on the account you signed in as —
   not the email on the card. Use a different email at checkout to prove it.
3. **Watch the webhook land.** Dodo dashboard → Webhooks → your endpoint should
   show a 200 with `{"outcome":"granted"}`.
4. **Confirm Studio unlocked.** The waiting screen closes itself and the plan
   pill reads PRO.
5. **Cancel, and check it revokes.** Cancel in the Dodo customer portal. A
   `subscription.cancelled` with cancel-at-period-end should *keep* Pro until
   the period ends and set the renewal date — not drop it immediately.
6. **Force a failure.** In the Dodo dashboard, put the subscription on hold.
   Pro should drop to Free and Settings should explain why.

Then repeat with live credentials and a real card, once.

---

## What each piece does

| Piece | Where | Job |
|---|---|---|
| `supabase/functions/dodo-checkout` | Supabase | Makes the checkout session. Reads the account from the caller's JWT, so the binding cannot be forged, and puts `account_id` + `plan` in the session metadata. |
| `supabase/functions/dodo-webhook` | Supabase | Verifies the Standard Webhooks signature, decides paid / not paid, calls the RPC. |
| `apply_dodo_entitlement` | Postgres | Grants or revokes the plan, idempotent on event id. The only thing that can change a paid plan. |
| `data/plans.js` | Studio app | Holds the customer-portal link and the checkout-host allowlist. No secrets. |
| `payments.js` | Website | The single place every Pay button's link comes from. |

## When something goes wrong

| Symptom | Cause |
|---|---|
| Checkout says "not switched on yet" | `DODO_API_KEY` or the product id secret is missing for that tier. |
| Webhook returns 400 `bad-signature` | `DODO_WEBHOOK_SECRET` is wrong or from the other mode. |
| Webhook returns 200 `ignored` | The event type is not one we act on, or its `status` was unrecognisable. Working as intended. |
| Webhook returns 200 `no-account` | The session metadata had no `account_id`, so it came from a link or product not created by `dodo-checkout`. |
| Webhook returns 200 `bad-plan` | The product's `metadata.plan` is missing or not `pro` / `proplus`. |
| Paid but still Free | Check the profile row: `select plan, entitlement_source, dodo_subscription_id from public.profiles where id = '<uid>';` |
| A website button goes to the support page | That product id is still empty in `payments.js`. |

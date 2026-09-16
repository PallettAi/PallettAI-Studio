# Dodo products — the exact details to fill in

14 products. You create each one **twice**: once in Test mode, once in Live mode.
Test and live product ids are different strings, so the two passes are not a
formality — the ids you paste into the app for test will not work live.

Prices are in **GBP** and every product is **tax inclusive** (see the notes at the
end — this one is not optional for UK consumer pricing, and the site's advertised
numbers assume it).

---

## Step 0 — account settings, once

| Setting | Value |
|---|---|
| Base currency | **GBP** |
| Tax inclusive pricing | **On** for all 14 products |
| Business id | Dashboard → Settings → Business details |

Your **Business id** is needed in three places:

| Place | What to set |
|---|---|
| `pallettai-website/payments.js` | `PORTAL_BUSINESS_ID` |
| `PallettAI-Studio-src/data/plans.js` | `DODO.businessId` (replaces `REPLACE_WITH_DODO_BUSINESS_ID`) |
| `PallettAI-Studio-src/data/plans.js` | `DODO.mode` → `'live'` when you go live |

---

## Step 1 — the 14 products

Name, price, model and interval are exact. **The first sentence of each
description appears on the checkout page**, so keep it customer-facing.

### Studio subscriptions — create a collection called `PallettAI Studio`

| # | Name | Model | Price | Repeat every | Tax cat. |
|---|---|---|---|---|---|
| 1 | `PallettAI Studio — Pro` | Subscription | **£9.00** | 1 month | SaaS / digital |
| 2 | `PallettAI Studio — Pro+` | Subscription | **£19.00** | 1 month | SaaS / digital |

**1 — PallettAI Studio — Pro**
> Unlimited projects, every template and unlimited AI Studio generations.
> Billed monthly in GBP, cancel any time from your billing portal.
> Includes premium fonts and layouts, live data widgets and image generation.

**2 — PallettAI Studio — Pro+**
> Everything in Pro, with unbranded exports and white-label client handoff.
> Billed monthly in GBP, cancel any time from your billing portal.
> Adds reusable brand presets, a client delivery pack and no PallettAI attribution.

### Project deposits — one-time

| # | Name | Model | Price |
|---|---|---|---|
| 3 | `Create Website — Deposit` | One-time | **£99.00** |
| 4 | `Refresh & Upgrade — Deposit` | One-time | **£49.00** |
| 5 | `Custom Builds & Bots — Deposit` | One-time | **£149.00** |

**3 — Create Website — Deposit**
> Starts your website build and books you into the next available slot.
> A custom one-page site, mobile-ready and fast, with local SEO basics,
> a preview before launch and two rounds of changes. £150 balance before launch.

**4 — Refresh & Upgrade — Deposit**
> Starts work on making an existing site useful again.
> Cleaner design, faster load, better on mobile, sharper copy, and a
> before/after health score so you can see the difference. £100 balance before launch.

**5 — Custom Builds & Bots — Deposit**
> Starts a scoped custom build — multi-page sites, booking, tools, Telegram bots and API work.
> We agree the scope and quote a fixed price before any work begins. £200 balance before launch.

### Remaining balance — one-time

| # | Name | Model | Price |
|---|---|---|---|
| 6 | `Create Website — Balance` | One-time | **£150.00** |
| 7 | `Refresh & Upgrade — Balance` | One-time | **£100.00** |
| 8 | `Custom Builds & Bots — Balance` | One-time | **£200.00** |

**6 — Create Website — Balance**
> The remaining balance on your website build, paid before launch.
> Deposit £99 + balance £150 = £249 total.

**7 — Refresh & Upgrade — Balance**
> The remaining balance on your refresh project, paid before launch.
> Deposit £49 + balance £100 = £149 total.

**8 — Custom Builds & Bots — Balance**
> The remaining balance on your custom build, paid before launch.
> Deposit £149 + balance £200 = £349 total.

### Aftercare — monthly

| # | Name | Model | Price | Repeat every |
|---|---|---|---|---|
| 9 | `Aftercare — Care Lite (Monthly)` | Subscription | **£19.00** | 1 month |
| 10 | `Aftercare — Care (Monthly)` | Subscription | **£49.00** | 1 month |
| 11 | `Aftercare — Care Plus (Monthly)` | Subscription | **£99.00** | 1 month |

### Aftercare — annual

The site shows an *effective monthly* figure, but Dodo charges the **yearly
total in one go**. Enter the yearly amount, not the monthly one:

| # | Name | Model | Price | Repeat every |
|---|---|---|---|---|
| 12 | `Aftercare — Care Lite (Annual)` | Subscription | **£180.00** | 1 year |
| 13 | `Aftercare — Care (Annual)` | Subscription | **£468.00** | 1 year |
| 14 | `Aftercare — Care Plus (Annual)` | Subscription | **£948.00** | 1 year |

Those totals are the site's effective monthly rates × 12: £15, £39 and £79.

**9 — Aftercare — Care Lite (Monthly)**
> The essentials, watched for you — backup, uptime, security and SSL monitoring,
> plus one content or image swap a month. Cancel any time with 30 days' notice.

**10 — Aftercare — Care (Monthly)**
> Changes handled for you, no tech skills needed. Everything in Care Lite, plus
> small changes made for you, a monthly speed and security health score,
> priority support and a seasonal refresh. Cancel any time with 30 days' notice.

**11 — Aftercare — Care Plus (Monthly)**
> Build time every month, for sites that keep moving. Up to 2 hours of build time
> monthly — new pages, features and tweaks — plus a quarterly performance and SEO
> tune-up and same-day weekday replies. Cancel any time with 30 days' notice.

**12 — Aftercare — Care Lite (Annual)**
> A year of Care Lite, paid yearly — £15 a month effective, £180 billed once.
> Backup, uptime, security and SSL monitoring, plus one content or image swap a month.
> Save £48 against paying monthly.

**13 — Aftercare — Care (Annual)**
> A year of Care, paid yearly — £39 a month effective, £468 billed once.
> Small changes made for you, a monthly health score, priority support and a
> seasonal refresh. Save £120 against paying monthly.

**14 — Aftercare — Care Plus (Annual)**
> A year of Care Plus, paid yearly — £79 a month effective, £948 billed once.
> Up to 2 hours of build time monthly, a quarterly SEO tune-up and same-day
> weekday replies. Save £240 against paying monthly.

---

## Step 2 — collections (do not skip)

Monthly and annual are separate products in Dodo by design. Grouping them is
what lets a customer switch between them in the portal instead of emailing you:

| Collection | Products |
|---|---|
| `PallettAI Studio` | 1, 2 (so Pro can upgrade to Pro+ in the portal) |
| `Care Lite` | 9, 12 |
| `Care` | 10, 13 |
| `Care Plus` | 11, 14 |

The deposits and balances are one-offs and belong in no collection.

---

## Step 3 — where each id goes

Every product's page shows an id starting with `pdt_`. Copy it to **exactly one**
website key. The Studio pair goes to a second place as well.

| Product | `pallettai-website/payments.js` | Supabase secret |
|---|---|---|
| 1 Pro | `studioPro` | `DODO_PRODUCT_PRO` |
| 2 Pro+ | `studioProPlus` | `DODO_PRODUCT_PROPLUS` |
| 3 Create deposit | `depositCreate` | — |
| 4 Refresh deposit | `depositRefresh` | — |
| 5 Custom deposit | `depositCustom` | — |
| 6 Create balance | `balanceCreate` | — |
| 7 Refresh balance | `balanceRefresh` | — |
| 8 Custom balance | `balanceCustom` | — |
| 9 Care Lite monthly | `careLiteMonthly` | — |
| 10 Care monthly | `careMonthly` | — |
| 11 Care Plus monthly | `carePlusMonthly` | — |
| 12 Care Lite annual | `careLiteAnnual` | — |
| 13 Care annual | `careAnnual` | — |
| 14 Care Plus annual | `carePlusAnnual` | — |

**The Studio pair must be the same products in both columns.** The app bills
through `dodo-checkout` and the site links through `payments.js`; if they point at
different products a customer is charged for one thing and granted another.

Website check: `node check-payments.js` in `pallettai-website/` — it reports how
many ids are left and fails if a page references a key the config doesn't define.

---

## Step 4 — secrets and webhooks

| Secret | Where from |
|---|---|
| `DODO_API_KEY` | Dodo → Developers → API keys |
| `DODO_WEBHOOK_SECRET` | Shown when you create the webhook endpoint (starts `whsec_`) |
| `DODO_PRODUCT_PRO` | Product 1's `pdt_…` |
| `DODO_PRODUCT_PROPLUS` | Product 2's `pdt_…` |
| `DODO_API_BASE` | **`https://live.dodopayments.com`** when live |

`DODO_API_BASE` defaults to the **test** host, so if you only paste the four ids
and the key, live checkouts will not work and nothing will say why.

Webhook endpoint: `https://fjahxichioccknszuxhb.supabase.co/functions/v1/dodo-webhook`

Subscribe it to the payment and subscription lifecycle events — see
`docs/DODO-SETUP.md` for the exact list and the deploy commands.

---

## Notes worth knowing before you start

**Tax inclusive is the right setting here.** The site advertises £9/mo, £249,
£99 and so on. UK consumer pricing must show the VAT-inclusive figure, and
tax-inclusive mode makes Dodo derive the net and tax portions from the number you
typed — so the site's prices stay true and the invoice still breaks tax out. If
you leave it off, customers are charged tax *on top* of the advertised price.

**The annual figures are the ones to be careful with.** Entering £15 as the price
with a 1-year interval would charge £15 for a whole year. The price is the
**charge**, and the interval is how often it repeats: £180 every 1 year.

**Pricing model is immutable.** If a product is created as one-time it can never
become a subscription — the docs are explicit. Get the model right first, and
create a new product rather than editing if you pick wrong.

**Deposit + balance reconciles to the advertised total** for all three packages
(99+150=249, 49+100=149, 149+200=349), so the rounding on the site holds.

**"2 months free" is understated, not overstated.** The annual rates work out at
about 2.4–2.5 months free on every tier. Customers get slightly more than the
badge promises, so there is nothing misleading to fix — but if you want the copy
exact, "over 2 months free" is the honest phrasing.

**Discount codes and trials stay off.** The site promises no lock-in and a
straight monthly price; a trial field left populated would contradict it.

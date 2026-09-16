# Aftercare renewals — the one thing that does not renew itself

Annual aftercare is a **one-time payment**. That was a deliberate choice: no
auto-renewal, no surprise charges, no subscription to cancel.

The trade-off is that **nothing renews on its own**. A year of care ends
silently — no invoice goes out, no reminder arrives, nothing fails. You would
find out either by noticing the revenue stopped or by a client asking why their
monitoring went quiet.

The pricing page now says *"We will get in touch before your year ends"*, so
this is a commitment rather than a nicety.

---

## Which tiers need this

| Tier | Model | Renews itself? |
|---|---|---|
| Care Lite / Care / Care Plus — **Monthly** | Subscription | **Yes** — Dodo bills and retries automatically |
| Care Lite / Care / Care Plus — **Annual** | One-time | **No — this is the whole problem** |

The build packages (Create, Refresh, Custom) and their balances are one-offs by
nature and need nothing here.

So the exposure is narrow: **three products**. Only annual aftercare needs a human.

---

## The routine — monthly, about five minutes

1. Open the Dodo dashboard → **Payments**.
2. Filter to the three `(Annual)` aftercare products.
3. Any payment roughly **11 months old** is a client whose year ends within the
   month.
4. Email them a renewal link **before** it lapses. The products are:

| Tier | Charge | Checkout |
|---|---|---|
| Care Lite (Annual) | £180 for 12 months | `pdt_0Nnhz8djqfGAfZQ9rHBw1` |
| Care (Annual) | £468 for 12 months | `pdt_0Nni1ssg3gxKV6ZicXiPH` |
| Care Plus (Annual) | £948 for 12 months | `pdt_0Nni36MFLGSbSHikmWHv1` |

A renewal is just the same link bought again. Nothing special happens on your
side — the client pays, the year restarts.

---

## Make it hard to forget — pick one

**The calendar habit (recommended).** Dodo emails you on every payment. When one
arrives for an annual product, immediately create a calendar event 11 months out
with the client's name and tier. That is one action at a moment you are already
looking at the sale, and it means the reminder finds you rather than the other
way round.

**The first-of-the-month habit.** On the 1st, filter Dodo → Payments to the three
annual products and work through anything near the 11-month mark. Predictable,
but it is a standing task you have to remember.

Either way, put the month you started in the event or the note. A reminder that
says only "renew PallettAI care" is useless in eleven months' time.

---

## If it becomes a chore

Switching the three annual products to **yearly subscriptions** makes it vanish
entirely: Dodo bills the same £180 / £468 / £948 every year, retries failed
cards, and the customer manages it in the portal. The cost is auto-renewal,
which is the thing the one-time model was chosen to avoid.

The pricing-model field cannot be changed on an existing product, so that would
mean creating three new products, re-wiring `careLiteAnnual`, `careAnnual` and
`carePlusAnnual` in `pallettai-website/payments.js`, and updating the copy that
now describes a one-time payment.

---

## Worth revisiting later

This routine is manual only because nothing here can read your Dodo payments
yet. The `DODO_API_KEY` secret is still unset — once billing is live, a small
report listing every annual client due in the next 60 days would replace the
dashboard filter entirely, and could run as part of the release check.

The three statements that stopped being true when the annual products became
one-time are fixed in `pricing.html` and `theme.js`, and
`pallettai-website/check-payments.js` still passes. The copy on the pricing page
is now the source of truth for what this process has to deliver:

> "A year paid up front is a single payment covering twelve months … We will get
> in touch before your year ends."

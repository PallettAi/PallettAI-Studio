# Stripe webhooks → registry entitlements

Date: 2026-09-07  
Status: approved (approach 2)

## Goal

A paid Stripe Payment Link grants Pro or Pro+ on the **signed-in Studio account**, not the card email. Anything other than paid leaves or returns that account to Free. License keys are not wiped by a Stripe failure.

## Host

Supabase Edge Function `stripe-webhook` at  
`https://fjahxichioccknszuxhb.supabase.co/functions/v1/stripe-webhook`  
`verify_jwt = false`. Auth is the Stripe signing secret.

## Bind the account

Studio appends `client_reference_id=<auth user uuid>` to the Payment Link. Email is ignored. Renewals look up `stripe_customer_id` / `stripe_subscription_id` on `profiles`.

## Paid only

Grant only when the mapped event is paid (`payment_status=paid`, `invoice.paid`, or subscription `status=active`). Failed, expired, canceled, unpaid, past_due, paused, action-required → revoke if `entitlement_source=stripe`.

## Registry

`apply_stripe_entitlement` (service_role only) is idempotent on Stripe event id. `activate_license` sets `entitlement_source=license`.

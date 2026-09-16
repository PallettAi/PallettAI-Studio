'use strict';

// ============================================================
// Dodo checkout — the decisions, separated from the network call.
//
// The point of creating the session on the server is that the account id is
// taken from the caller's *verified JWT*, never from the request body. Under
// Stripe the binding rode in a query string the client could edit; here a
// forged account id is not possible, because it is never read from input.
// The functions below are pure so that property can be asserted in a test.
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAID_PLANS = { pro: true, proplus: true };

// Which secret holds this plan's Dodo product id. Two tiers, two products —
// kept as a table so a future tier is one line rather than a new branch.
const PRODUCT_ENV = {
  pro: 'DODO_PRODUCT_PRO',
  proplus: 'DODO_PRODUCT_PROPLUS'
};

const FALLBACK_RETURN = 'https://pallettai.org/?paid=1';

function normalizePlan(planId) {
  const id = String(planId || '').toLowerCase().trim();
  return PAID_PLANS[id] ? id : '';
}

function productEnvFor(planId) {
  const id = normalizePlan(planId);
  return id ? PRODUCT_ENV[id] : '';
}

/**
 * Where Dodo sends the customer after paying. Allowlisted rather than echoed
 * back, because an unvalidated return url is an open redirect on a page we
 * control the branding of.
 */
function checkoutReturnUrl(raw) {
  try {
    const u = new URL(String(raw || ''));
    const local = (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:';
    const site = (u.hostname === 'pallettai.org' || u.hostname === 'www.pallettai.org') && u.protocol === 'https:';
    if (!local && !site) return FALLBACK_RETURN;
    u.searchParams.set('paid', '1');
    u.hash = '';
    return u.toString();
  } catch (_) {
    return FALLBACK_RETURN;
  }
}

/**
 * The exact body sent to POST {api}/checkouts.
 *
 * `metadata` is what makes the whole flow work: it comes back on every
 * subscription event, which is how a webhook that only knows a subscription id
 * finds the Studio account to grant. `account_id` is rejected unless it is a
 * real UUID, so a session can never be created that no profile could match.
 */
function buildSessionBody(input) {
  const src = input || {};
  const plan = normalizePlan(src.planId);
  const accountId = String(src.accountId || '');
  if (!plan) return { ok: false, reason: 'bad-plan' };
  if (!UUID.test(accountId)) return { ok: false, reason: 'bad-account' };
  const productId = String(src.productId || '').trim();
  if (!productId) return { ok: false, reason: 'not-configured' };

  const customer = {};
  const email = String(src.email || '').trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) customer.email = email;

  const body = {
    product_cart: [{ product_id: productId, quantity: 1 }],
    metadata: { account_id: accountId, plan: plan },
    return_url: checkoutReturnUrl(src.returnUrl),
    // UK pricing, stated rather than left to IP-based detection: an
    // inconsistent currency on a £9 product is a support ticket per customer.
    billing_currency: 'GBP'
  };
  if (Object.keys(customer).length) body.customer = customer;
  return { ok: true, body: body, plan: plan, productEnv: PRODUCT_ENV[plan] };
}

/** Pull the plan + return url out of a request body, ignoring anything else. */
function parseRequestBody(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  return {
    planId: String(b.plan || b.planId || ''),
    returnUrl: String(b.returnUrl || '')
  };
}

/** Plan is echoed back so the app can label the waiting screen without a second lookup. */
function sessionResult(status, payload) {
  const p = payload || {};
  if (status === 200 && p.ok === true) return { ok: true, url: String(p.url || ''), plan: String(p.plan || '') };
  return { ok: false, error: String(p.error || 'checkout-unavailable') };
}

const api = {
  UUID,
  PRODUCT_ENV,
  FALLBACK_RETURN,
  normalizePlan,
  productEnvFor,
  checkoutReturnUrl,
  buildSessionBody,
  parseRequestBody,
  sessionResult
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;

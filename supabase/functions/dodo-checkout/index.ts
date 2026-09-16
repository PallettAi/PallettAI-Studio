// Authenticated Dodo checkout. The API key never leaves this function, and the
// account the plan lands on is taken from the caller's verified JWT rather than
// from the request — a client cannot buy Pro for, or as, anybody else.
//
// CORS is an allowlist (the Electron renderer's file:// origin, the web build
// on localhost, and pallettai.org) rather than `*`, so an arbitrary site cannot
// use this endpoint to mint sessions.
//
// Keep this file self-contained — the Edge runtime crashes on createRequire.

const ALLOWED_ORIGINS = new Set(['https://pallettai.org', 'https://www.pallettai.org']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAID_PLANS: Record<string, boolean> = { pro: true, proplus: true };
const PRODUCT_ENV: Record<string, string> = {
  pro: 'DODO_PRODUCT_PRO',
  proplus: 'DODO_PRODUCT_PROPLUS'
};
const FALLBACK_RETURN = 'https://pallettai.org/?paid=1';

function corsOrigin(raw: string): string {
  const o = String(raw || '').trim();
  if (!o) return '';
  if (ALLOWED_ORIGINS.has(o)) return o;
  if (o === 'null' || o.startsWith('file://')) return 'null'; // packaged Electron renderer
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o; // `npm run web`
  return '';
}

function corsHeaders(origin: string): Record<string, string> {
  const allow = corsOrigin(origin);
  const base: Record<string, string> = { Vary: 'Origin' };
  if (!allow) return base;
  return {
    ...base,
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

const json = (status: number, body: Record<string, unknown>, origin: string) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });

// The gateway verifies the JWT (verify_jwt = true in supabase/config.toml).
// This decode only decides *which* profile to read; the read itself replays the
// caller's own Authorization header into PostgREST, so RLS is what authorises
// it and a forged token yields no row and no checkout.
function uidFromAuth(header: string): string {
  const token = header.replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length < 2) return '';
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPart = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    const payload = JSON.parse(atob(jsonPart));
    return String(payload.sub || '');
  } catch {
    return '';
  }
}

function checkoutReturnUrl(raw: string): string {
  try {
    const u = new URL(String(raw || ''));
    const local = (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:';
    const site = (u.hostname === 'pallettai.org' || u.hostname === 'www.pallettai.org') && u.protocol === 'https:';
    if (!local && !site) return FALLBACK_RETURN;
    u.searchParams.set('paid', '1');
    u.hash = '';
    return u.toString();
  } catch {
    return FALLBACK_RETURN;
  }
}

function planFromPlan(planId: string): string {
  const id = String(planId || '').toLowerCase().trim();
  return PAID_PLANS[id] ? id : '';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') || '';

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' }, origin);

  const auth = req.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return json(401, { ok: false, error: 'auth' }, origin);

  const uid = uidFromAuth(auth);
  if (!uid) return json(401, { ok: false, error: 'auth' }, origin);

  let asked: { planId: string; returnUrl: string } = { planId: '', returnUrl: '' };
  try {
    const body = await req.json() as Record<string, unknown>;
    asked = {
      planId: String(body.plan || body.planId || ''),
      returnUrl: String(body.returnUrl || '')
    };
  } catch {
    asked = { planId: '', returnUrl: '' };
  }

  const plan = planFromPlan(asked.planId);
  if (!plan) return json(400, { ok: false, error: 'bad-plan' }, origin);
  if (!UUID.test(uid)) return json(401, { ok: false, error: 'auth' }, origin);

  const apiKey = Deno.env.get('DODO_API_KEY') || '';
  const productId = Deno.env.get(PRODUCT_ENV[plan]) || '';
  // Naming the missing secret in the response would be a reconnaissance gift on
  // a public endpoint; the log is where it belongs.
  if (!apiKey || !productId) {
    console.error('dodo-checkout not configured: ' + (!apiKey ? 'DODO_API_KEY' : PRODUCT_ENV[plan]));
    return json(503, { ok: false, error: 'not-configured' }, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !anon) return json(500, { ok: false, error: 'misconfigured' }, origin);

  let email = '';
  try {
    const profRes = await fetch(
      supabaseUrl.replace(/\/+$/, '') + '/rest/v1/profiles?select=email&id=eq.' + encodeURIComponent(uid),
      { headers: { apikey: anon, Authorization: auth } }
    );
    const rows = await profRes.json().catch(() => []);
    if (Array.isArray(rows) && rows[0] && rows[0].email) email = String(rows[0].email);
  } catch {
    email = '';
  }

  const customer: Record<string, string> = {};
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) customer.email = email;

  const sessionBody: Record<string, unknown> = {
    product_cart: [{ product_id: productId, quantity: 1 }],
    // Comes back on every subscription event — this is how the webhook finds
    // the account to grant.
    metadata: { account_id: uid, plan: plan },
    return_url: checkoutReturnUrl(asked.returnUrl),
    billing_currency: 'GBP'
  };
  if (customer.email) sessionBody.customer = customer;

  const apiBase = (Deno.env.get('DODO_API_BASE') || 'https://test.dodopayments.com').replace(/\/+$/, '');

  try {
    const res = await fetch(apiBase + '/checkouts', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sessionBody)
    });
    const data = await res.json().catch(() => ({})) as { checkout_url?: string };
    const url = String((data && data.checkout_url) || '');
    // Only a Dodo checkout host is handed back, so a compromised or spoofed
    // upstream response cannot redirect the user somewhere else entirely.
    if (!res.ok || !/^https:\/\/(test\.)?checkout\.dodopayments\.com\//.test(url)) {
      console.error('dodo-checkout upstream failed: ' + res.status);
      return json(503, { ok: false, error: 'checkout-unavailable' }, origin);
    }
    return json(200, { ok: true, url: url, plan: plan }, origin);
  } catch {
    return json(503, { ok: false, error: 'checkout-unavailable' }, origin);
  }
});

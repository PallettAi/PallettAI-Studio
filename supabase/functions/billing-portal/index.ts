// Authenticated Stripe Customer Portal. The restricted key never leaves this function.
//
// Hardening (rationale in .docs/SECURITY-HARDENING.md): CORS is an allowlist
// (the Electron renderer's file:// origin, the web build on localhost, and
// pallettai.org) instead of `*`, so an arbitrary website cannot read the
// portal URL out of this endpoint's response.
//
// Keep this file self-contained — the Edge runtime crashes on createRequire.

const ALLOWED_ORIGINS = new Set(['https://pallettai.org', 'https://www.pallettai.org']);

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
// This decode is only used to pick *which* profile to look up: the lookup below
// replays the caller's own Authorization header into PostgREST, so RLS is what
// actually authorises it — a forged token yields no row and no portal.
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

function portalReturnUrl(raw: string): string {
  const fallback = 'https://pallettai.org/?paid=1';
  try {
    const u = new URL(String(raw || ''));
    const local = (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.protocol === 'http:';
    const site = (u.hostname === 'pallettai.org' || u.hostname === 'www.pallettai.org') && u.protocol === 'https:';
    if (!local && !site) return fallback;
    u.searchParams.set('paid', '1');
    u.hash = '';
    return u.toString();
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') || '';

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' }, origin);

  const auth = req.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return json(401, { ok: false, error: 'auth' }, origin);

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
  if (!stripeKey) return json(503, { ok: false, error: 'portal-unavailable' }, origin);

  const uid = uidFromAuth(auth);
  if (!uid) return json(401, { ok: false, error: 'auth' }, origin);

  let asked = '';
  try {
    const body = await req.json() as { returnUrl?: unknown };
    asked = String(body.returnUrl || '');
  } catch {
    asked = '';
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !anon) return json(500, { ok: false, error: 'misconfigured' }, origin);

  let customer = '';
  try {
    const profRes = await fetch(
      supabaseUrl.replace(/\/+$/, '') + '/rest/v1/profiles?select=stripe_customer_id&id=eq.' + encodeURIComponent(uid),
      { headers: { apikey: anon, Authorization: auth } }
    );
    const rows = await profRes.json().catch(() => []);
    if (Array.isArray(rows) && rows[0] && rows[0].stripe_customer_id) {
      customer = String(rows[0].stripe_customer_id);
    }
  } catch {
    customer = '';
  }
  if (!customer) return json(409, { ok: false, error: 'no-customer' }, origin);

  const form = new URLSearchParams();
  form.set('customer', customer);
  form.set('return_url', portalReturnUrl(asked));

  try {
    const stripe = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + stripeKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    const data = await stripe.json().catch(() => ({})) as { url?: string };
    const url = String((data && data.url) || '');
    if (!stripe.ok || !url.startsWith('https://billing.stripe.com/')) {
      return json(503, { ok: false, error: 'portal-unavailable' }, origin);
    }
    return json(200, { ok: true, url: url }, origin);
  } catch {
    return json(503, { ok: false, error: 'portal-unavailable' }, origin);
  }
});

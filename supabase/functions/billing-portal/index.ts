// Authenticated Stripe Customer Portal. The restricted key never leaves this function.

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type'
    }
  });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type'
};

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });

  const auth = req.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return json(401, { ok: false, error: 'auth' });

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
  if (!stripeKey) return json(503, { ok: false, error: 'portal-unavailable' });

  const uid = uidFromAuth(auth);
  if (!uid) return json(401, { ok: false, error: 'auth' });

  let asked = '';
  try {
    const body = await req.json() as { returnUrl?: unknown };
    asked = String(body.returnUrl || '');
  } catch {
    asked = '';
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !anon) return json(500, { ok: false, error: 'misconfigured' });

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
  if (!customer) return json(409, { ok: false, error: 'no-customer' });

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
      return json(503, { ok: false, error: 'portal-unavailable' });
    }
    return json(200, { ok: true, url: url });
  } catch {
    return json(503, { ok: false, error: 'portal-unavailable' });
  }
});

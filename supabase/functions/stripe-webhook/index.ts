// Stripe → registry. JWT verify is off; the Stripe signature is the auth.
// Keep this file self-contained — Edge runtime was crashing on createRequire.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAID_PLANS: Record<string, boolean> = { pro: true, proplus: true };

type StripeObject = Record<string, unknown> & {
  object?: string;
  id?: string;
  payment_status?: string;
  status?: string;
  client_reference_id?: string;
  metadata?: { plan?: string; account_id?: string };
  subscription_details?: { metadata?: { plan?: string } };
  customer?: string | { id?: string };
  subscription?: string | { id?: string };
  current_period_end?: number;
  items?: { data?: Array<{ current_period_end?: number }> };
};

type StripeEvent = { id?: string; type?: string; data?: { object?: StripeObject } };

type MappedEvent = {
  ignore: boolean;
  eventId?: string;
  eventType?: string;
  paid?: boolean;
  accountId?: string;
  plan?: string;
  customerId?: string;
  subscriptionId?: string;
  expiresAt?: string | null;
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });

function idOf(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value && 'id' in value) return String((value as { id?: string }).id || '');
  return '';
}

function planFrom(obj: StripeObject): string {
  const raw = String(obj.metadata?.plan || obj.subscription_details?.metadata?.plan || '').toLowerCase();
  return PAID_PLANS[raw] ? raw : '';
}

function accountFrom(obj: StripeObject): string {
  const id = String(obj.client_reference_id || obj.metadata?.account_id || '');
  return UUID.test(id) ? id : '';
}

function subscriptionId(obj: StripeObject): string {
  if (obj.object === 'subscription') return idOf(obj.id);
  return idOf(obj.subscription);
}

function expiresFrom(obj: StripeObject): string | null {
  let end = obj.current_period_end;
  if (!end && obj.items?.data?.[0]?.current_period_end) end = obj.items.data[0].current_period_end;
  if (!end) return null;
  const ms = Number(end) * 1000;
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function isPaid(type: string, obj: StripeObject): boolean | null {
  if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
    return obj.payment_status === 'paid';
  }
  if (type === 'checkout.session.async_payment_failed' || type === 'checkout.session.expired') return false;
  if (type === 'invoice.paid') return true;
  if (type === 'invoice.payment_failed' || type === 'invoice.payment_action_required') return false;
  if (type === 'customer.subscription.updated') return obj.status === 'active';
  if (type === 'customer.subscription.deleted' || type === 'customer.subscription.paused') return false;
  return null;
}

function mapStripeEvent(event: StripeEvent): MappedEvent {
  const type = event && event.type;
  const obj = event && event.data && event.data.object;
  if (!type || !obj) return { ignore: true };
  const paid = isPaid(type, obj);
  if (paid == null) return { ignore: true };
  return {
    ignore: false,
    eventId: String(event.id || ''),
    eventType: type,
    paid: paid === true,
    accountId: accountFrom(obj),
    plan: planFrom(obj),
    customerId: idOf(obj.customer),
    subscriptionId: subscriptionId(obj),
    expiresAt: expiresFrom(obj)
  };
}

function parseSignature(header: string): { timestamp: string; signatures: string[] } {
  let timestamp = '';
  const signatures: string[] = [];
  String(header).split(',').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  });
  return { timestamp, signatures };
}

function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyStripeSignature(payload: string, header: string, secret: string, nowMs: number): Promise<boolean> {
  if (!payload || !header || !secret) return false;
  const { timestamp, signatures } = parseSignature(header);
  if (!timestamp || !signatures.length) return false;
  const age = Math.abs(nowMs - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + '.' + payload));
  const expected = bytesToHex(signed);
  return signatures.some((sig) => hexEqual(expected, sig.toLowerCase()));
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { outcome: 'method' });

    const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!secret || !supabaseUrl || !serviceKey) return json(500, { outcome: 'misconfigured' });

    const payload = await req.text();
    const header = req.headers.get('stripe-signature') || '';
    if (!(await verifyStripeSignature(payload, header, secret, Date.now()))) {
      return json(400, { outcome: 'bad-signature' });
    }

    let event: StripeEvent;
    try { event = JSON.parse(payload); }
    catch { return json(400, { outcome: 'bad-json' }); }

    const mapped = mapStripeEvent(event);
    if (mapped.ignore) return json(200, { outcome: 'ignored' });

    const rpc = await fetch(supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/apply_stripe_entitlement', {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_event_id: mapped.eventId,
        p_event_type: mapped.eventType,
        p_paid: mapped.paid,
        p_account_id: mapped.accountId || null,
        p_plan: mapped.plan || null,
        p_customer_id: mapped.customerId || null,
        p_subscription_id: mapped.subscriptionId || null,
        p_expires_at: mapped.expiresAt || null
      })
    });

    let result: Record<string, unknown> = {};
    try { result = await rpc.json(); } catch { result = { outcome: 'rpc-error' }; }
    if (!rpc.ok) return json(502, { outcome: 'rpc-error', detail: result });
    return json(200, result);
  } catch (err) {
    return json(500, { outcome: 'crash', message: err instanceof Error ? err.message : 'error' });
  }
});

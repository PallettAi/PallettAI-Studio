// Dodo Payments → registry. JWT verify is off; the Standard Webhooks
// signature is the auth.
//
// Keep this file self-contained — the Edge runtime was crashing on
// createRequire, which is also why the mapping below is duplicated from
// entitlement.js rather than imported. entitlement.js is the copy the smoke
// suite drives; the two must agree, and dodo-entitlement-smoke.js checks that
// every event name they care about is handled identically in both.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAID_PLANS: Record<string, boolean> = { pro: true, proplus: true };

const STATUS_PAID: Record<string, boolean> = {
  active: true,
  past_due: true,
  pending: false,
  on_hold: false,
  paused: false,
  cancelled: false,
  failed: false,
  expired: false
};

type DodoObject = Record<string, unknown> & {
  status?: string;
  subscription_id?: string;
  customer_id?: string;
  next_billing_date?: string;
  past_due_ends_at?: string;
  cancel_at_next_billing_date?: boolean;
  metadata?: { plan?: string; account_id?: string; accountId?: string };
  customer?: { customer_id?: string; id?: string; email?: string };
};

type DodoEvent = {
  type?: string;
  id?: string;
  webhook_id?: string;
  data?: DodoObject;
};

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
  if (typeof value === 'object' && value && 'customer_id' in value) {
    return String((value as { customer_id?: string }).customer_id || '');
  }
  return '';
}

function planFrom(data: DodoObject): string {
  const meta = (data.metadata || {}) as Record<string, unknown>;
  const raw = String(meta.plan || '').toLowerCase();
  return PAID_PLANS[raw] ? raw : '';
}

function accountFrom(data: DodoObject): string {
  const meta = (data.metadata || {}) as Record<string, unknown>;
  const id = String(meta.account_id || meta.accountId || '');
  return UUID.test(id) ? id : '';
}

function customerIdFrom(data: DodoObject): string {
  const customer = (data.customer || {}) as Record<string, unknown>;
  return idOf(customer.customer_id || customer.id || data.customer_id);
}

function subscriptionIdFrom(data: DodoObject): string {
  const nested = (data.subscription || {}) as Record<string, unknown>;
  return String(data.subscription_id || nested.subscription_id || '');
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function expiryFrom(type: string, data: DodoObject): string | null {
  if (type === 'subscription.past_due') {
    return isoOrNull(data.past_due_ends_at) || isoOrNull(data.next_billing_date);
  }
  if (type === 'subscription.cancelled' && data.cancel_at_next_billing_date === true) {
    return isoOrNull(data.next_billing_date);
  }
  return isoOrNull(data.next_billing_date);
}

function isPaid(type: string, data: DodoObject): boolean | null {
  if (type === 'subscription.active' || type === 'subscription.renewed' || type === 'subscription.unpaused') {
    return true;
  }
  if (type === 'subscription.cancelled' && data.cancel_at_next_billing_date === true) return true;
  if (type === 'subscription.plan_changed' || type === 'subscription.updated') {
    const status = String(data.status || '').toLowerCase();
    return Object.prototype.hasOwnProperty.call(STATUS_PAID, status) ? STATUS_PAID[status] : null;
  }
  if (['subscription.past_due', 'subscription.on_hold', 'subscription.paused',
    'subscription.cancelled', 'subscription.failed', 'subscription.expired'].includes(type)) {
    const status = String(data.status || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(STATUS_PAID, status) && status !== 'active') {
      return STATUS_PAID[status];
    }
    return false;
  }
  // A payment only tells us anything when it belongs to a subscription. A bare
  // one-off returns null (ignore), never false — false means "this customer has
  // not paid", which would revoke.
  if (type === 'payment.succeeded') return subscriptionIdFrom(data) ? true : null;
  if (type === 'payment.processing') return null; // not terminal
  if (type === 'payment.failed') return subscriptionIdFrom(data) ? false : null;
  if (type === 'payment.cancelled') return null;
  return null;
}

function mapDodoEvent(event: DodoEvent): MappedEvent {
  const type = String((event && event.type) || '');
  const data = (event && event.data) as DodoObject;
  if (!type || !data) return { ignore: true };
  const paid = isPaid(type, data);
  if (paid == null) return { ignore: true };
  return {
    ignore: false,
    eventId: String(event.webhook_id || event.id || data.webhook_id || ''),
    eventType: type,
    paid: paid === true,
    accountId: accountFrom(data),
    plan: planFrom(data),
    customerId: customerIdFrom(data),
    subscriptionId: subscriptionIdFrom(data),
    expiresAt: expiryFrom(type, data)
  };
}

/* ── Standard Webhooks (Web Crypto) ──────────────────────────────────── */

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(String(b64));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (_) {
    return null;
  }
}

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function decodeSecret(secret: string): Uint8Array {
  const raw = String(secret || '');
  const body = raw.startsWith('whsec_') ? raw.slice(6) : raw;
  const decoded = base64ToBytes(body);
  if (decoded && decoded.length) return decoded;
  return new TextEncoder().encode(raw);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyStandardWebhook(
  payload: string,
  headers: Record<string, string>,
  secret: string,
  nowMs: number
): Promise<boolean> {
  if (!payload || !secret) return false;
  const id = String(headers['webhook-id'] || headers['svix-id'] || '').trim();
  const timestamp = String(headers['webhook-timestamp'] || headers['svix-timestamp'] || '').trim();
  const signature = String(headers['webhook-signature'] || headers['svix-signature'] || '').trim();
  if (!id || !timestamp || !signature) return false;

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(nowMs - seconds * 1000) > 5 * 60 * 1000) return false;

  const key = await crypto.subtle.importKey(
    'raw', decodeSecret(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(id + '.' + timestamp + '.' + payload)
  );
  const expected = new Uint8Array(signed);

  return signature.trim().split(/\s+/).some((part) => {
    const i = part.indexOf(',');
    if (i < 0) return false;
    if (part.slice(0, i).trim() !== 'v1') return false;
    const got = base64ToBytes(part.slice(i + 1).trim());
    return !!got && bytesEqual(got, expected);
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { outcome: 'method' });

    const secret = Deno.env.get('DODO_WEBHOOK_SECRET') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!secret || !supabaseUrl || !serviceKey) return json(500, { outcome: 'misconfigured' });

    const payload = await req.text();
    const headers: Record<string, string> = {
      'webhook-id': req.headers.get('webhook-id') || '',
      'webhook-timestamp': req.headers.get('webhook-timestamp') || '',
      'webhook-signature': req.headers.get('webhook-signature') || ''
    };
    if (!(await verifyStandardWebhook(payload, headers, secret, Date.now()))) {
      return json(400, { outcome: 'bad-signature' });
    }

    let event: DodoEvent;
    try { event = JSON.parse(payload); }
    catch { return json(400, { outcome: 'bad-json' }); }

    // The signature covers the body but not the event id, so the id the RPC
    // dedupes on is taken from the signed header — a body-supplied id could be
    // rewritten to make a replayed event look new.
    const mapped = mapDodoEvent({ ...event, webhook_id: headers['webhook-id'] || event.webhook_id });
    if (mapped.ignore) return json(200, { outcome: 'ignored' });

    const rpc = await fetch(supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/apply_dodo_entitlement', {
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

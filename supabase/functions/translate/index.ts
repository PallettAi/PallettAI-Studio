// Authenticated DeepL proxy. The API key never leaves this function.
//
// Hardening (rationale in .docs/SECURITY-HARDENING.md):
//  - CORS is an allowlist (the Electron renderer's file:// origin, the web
//    build on localhost, and pallettai.org) rather than `*`.
//  - A credit is spent *server-side* through `spend_credit` before DeepL is
//    called, and refunded if DeepL produces nothing. The RPC is idempotent on
//    `ref` per account, and the client sends the same ref it already mirrors,
//    so honest clients are never double-charged — but the studio's paid key
//    can no longer be used for free by calling this endpoint directly.
//  - Request size is bounded (text count, per-text length, total characters)
//    and there is a best-effort per-account throttle.
//
// Keep this file self-contained — the Edge runtime crashes on createRequire.

const MAX_TEXTS = 400;          // matches what the client sends for one site
const MAX_TEXT_CHARS = 10_000;  // one string
const MAX_TOTAL_CHARS = 60_000; // whole request (DeepL's own cap is 128 KiB)
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;      // per account, per isolate (best effort)

const ALLOWED_ORIGINS = new Set(['https://pallettai.org', 'https://www.pallettai.org']);

function corsOrigin(raw: string): string {
  const o = String(raw || '').trim();
  if (!o) return '';                                    // non-browser caller: no CORS needed
  if (ALLOWED_ORIGINS.has(o)) return o;
  if (o === 'null' || o.startsWith('file://')) return 'null'; // packaged Electron renderer
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return o; // `npm run web`
  return '';                                            // anything else gets no ACAO
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

// The gateway verifies the JWT (verify_jwt = true in supabase/config.toml), so
// decoding the payload here is safe for identity/throttle purposes only — it is
// never used for authorisation, which stays with PostgREST + RLS.
function subFromAuth(header: string): string {
  const token = String(header || '').replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length < 2) return '';
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)));
    return String(payload.sub || '');
  } catch {
    return '';
  }
}

const hits = new Map<string, number[]>();
function throttled(key: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) {
    for (const [k, times] of hits) {
      if (!times.some((t) => now - t < WINDOW_MS)) hits.delete(k);
    }
  }
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

async function rpc(
  name: string,
  body: Record<string, unknown>,
  supabaseUrl: string,
  anon: string,
  auth: string
): Promise<Record<string, unknown>> {
  const res = await fetch(supabaseUrl.replace(/\/+$/, '') + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: auth,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error('rpc');
  return data || {};
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin') || '';

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' }, origin);

  const auth = req.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return json(401, { ok: false, error: 'auth' }, origin);

  const key = Deno.env.get('DEEPL_API_KEY') || '';
  if (!key) return json(503, { ok: false, error: 'deepl-unavailable' }, origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!supabaseUrl || !anon) return json(500, { ok: false, error: 'misconfigured' }, origin);

  let body: { texts?: unknown; target?: unknown; source?: unknown; ref?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'json' }, origin);
  }

  // Only strings/numbers are accepted; the old `String(t || '')` silently
  // turned objects into "[object Object]" and let arrays smuggle extra work.
  const rawTexts = Array.isArray(body.texts) ? body.texts : [];
  if (rawTexts.some((t) => typeof t !== 'string' && typeof t !== 'number')) {
    return json(400, { ok: false, error: 'texts' }, origin);
  }
  const texts = rawTexts.slice(0, MAX_TEXTS).map((t) => String(t ?? ''));
  if (!texts.length) return json(400, { ok: false, error: 'texts' }, origin);
  if (texts.some((t) => t.length > MAX_TEXT_CHARS)) return json(413, { ok: false, error: 'too-long' }, origin);
  const totalChars = texts.reduce((n, t) => n + t.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) return json(413, { ok: false, error: 'too-long' }, origin);

  const target = String(body.target || 'ES').toUpperCase().slice(0, 2);
  const source = String(body.source || 'EN').toUpperCase().slice(0, 2);
  const LANG = new Set(['EN', 'ES', 'FR', 'DE', 'IT', 'PT', 'NL', 'PL']);
  if (!LANG.has(target) || !LANG.has(source)) return json(400, { ok: false, error: 'lang' }, origin);

  // A credit is required, keyed on the same ref the client mirrors, so the
  // entry is idempotent with the client's own optimistic spend.
  const ref = String(body.ref || '').slice(0, 64);
  if (!ref) return json(402, { ok: false, error: 'credits' }, origin);

  const sub = subFromAuth(auth);
  if (sub && throttled(sub)) {
    return new Response(JSON.stringify({ ok: false, error: 'slow-down' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...corsHeaders(origin) }
    });
  }

  let charged = false;
  try {
    const spend = await rpc('spend_credit', { p_ref: ref, p_amount: 1 }, supabaseUrl, anon, auth);
    const outcome = String(spend.outcome || '');
    if (outcome === 'insufficient') return json(402, { ok: false, error: 'credits' }, origin);
    if (outcome === 'unlimited' || outcome === 'spent' || outcome === 'already-spent') {
      charged = outcome !== 'unlimited';
    } else {
      // 'no-ref' or anything unexpected: fail closed rather than serving the
      // paid key unmetered. The client falls back to MyMemory.
      return json(503, { ok: false, error: 'credits' }, origin);
    }
  } catch {
    return json(503, { ok: false, error: 'credits' }, origin);
  }

  const endpoint = key.endsWith(':fx') || key.includes('free')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  const refund = async () => {
    if (!charged) return;
    try {
      await rpc('refund_credit', { p_ref: ref }, supabaseUrl, anon, auth);
    } catch { /* best effort: the spend stays, the client can re-request */ }
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'DeepL-Auth-Key ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: texts,
        target_lang: target,
        source_lang: source
      })
    });
    if (!res.ok) {
      await refund();
      return json(503, { ok: false, error: 'deepl-unavailable' }, origin);
    }
    const data = (await res.json()) as { translations?: Array<{ text?: string }> };
    const out = (data.translations || []).map((row) => String((row && row.text) || ''));
    if (out.length !== texts.length || out.some((t) => !t)) {
      await refund();
      return json(503, { ok: false, error: 'deepl-unavailable' }, origin);
    }
    return json(200, { ok: true, provider: 'deepl', texts: out }, origin);
  } catch {
    await refund();
    return json(503, { ok: false, error: 'deepl-unavailable' }, origin);
  }
});

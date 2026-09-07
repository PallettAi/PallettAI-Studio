// Authenticated DeepL proxy. The API key never leaves this function.

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

const LANG = new Set(['EN', 'ES', 'FR', 'DE', 'IT', 'PT', 'NL', 'PL']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method' });

  const auth = req.headers.get('Authorization') || '';
  if (!auth.toLowerCase().startsWith('bearer ')) return json(401, { ok: false, error: 'auth' });

  const key = Deno.env.get('DEEPL_API_KEY') || '';
  if (!key) return json(503, { ok: false, error: 'deepl-unavailable' });

  let body: { texts?: unknown; target?: unknown; source?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: 'json' });
  }

  const texts = Array.isArray(body.texts) ? body.texts.map((t) => String(t || '')).slice(0, 400) : [];
  if (!texts.length) return json(400, { ok: false, error: 'texts' });

  const target = String(body.target || 'ES').toUpperCase().slice(0, 2);
  const source = String(body.source || 'EN').toUpperCase().slice(0, 2);
  if (!LANG.has(target) || !LANG.has(source)) return json(400, { ok: false, error: 'lang' });

  const endpoint = key.endsWith(':fx') || key.includes('free')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'DeepL-Auth-Key ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: texts,
        target_lang: target,
        source_lang: source
      })
    });
    if (!res.ok) return json(503, { ok: false, error: 'deepl-unavailable' });
    const data = await res.json() as { translations?: Array<{ text?: string }> };
    const out = (data.translations || []).map((row) => String(row.text || ''));
    if (out.length !== texts.length || out.some((t) => !t)) return json(503, { ok: false, error: 'deepl-unavailable' });
    return json(200, { ok: true, provider: 'deepl', texts: out });
  } catch {
    return json(503, { ok: false, error: 'deepl-unavailable' });
  }
});

'use strict';
// ============================================================
// PallettAI Studio — client-side webhook & notification dispatcher
// Static pages can announce what happens on them — a form lands,
// a guide gets downloaded, a lead arrives — by POSTing a JSON
// payload straight from the visitor's browser to a Slack,
// Discord, Zapier/Make/n8n (or any custom) webhook. No server,
// no SDK, no third-party script on the page.
// ------------------------------------------------------------
//   1. generateWebhookDispatcherScript(targets, options)
//      → self-contained inline JS that binds:
//          form submit  → [data-webhook="target"] forms (honeypot
//                         `botcheck` excluded; reload prevented
//                         only when the form has no action)
//          click        → [data-webhook] elements (links/buttons;
//                         navigation is never blocked)
//          CustomEvent  → document "pai:webhook" {detail:{target,…}}
//          public API   → window.paiWebhook(target, data) → Promise
//      …and delivers to configured targets with exponential-backoff
//      retry on network failures, 408, 429 and 5xx responses
//      (4xx like a bad token fails fast — retrying can't help).
//   2. formatSlackPayload(event, meta)  — blocks with the user
//      message, referrer and timestamp (mrkdwn-encoded).
//   3. formatDiscordPayload(event, meta) — rich embed with custom
//      theme color and grouped fields.
//   4. formatGenericPayload(event, meta) — clean key/value JSON
//      for Zapier / Make / n8n or a custom Worker.
//
// ---- what this file guarantees ----------------------------------
// 1. FORMATTERS ARE PURE AND TESTED. Every payload builder takes
//    (event, meta) and returns plain JSON — no I/O, no clock
//    reads beyond meta defaults — so the smoke runner pins the
//    exact shapes clients depend on.
// 2. RETRY POLICY IS EXPORTED, NOT HIDDEN: shouldRetryStatus()
//    and backoffDelay() are module functions (injectable random
//    for determinism); the generated script embeds the same rules
//    with jitter off, so schedule = base · 2^attempt.
// 3. KINDS INFER FROM THE URL (hooks.slack.com → slack,
//    discord.com/api/webhooks → discord, everything else →
//    generic) and accept aliases zapier/make/n8n → generic.
//    Bad URLs and unknown kinds throw typed codes at BUILD time.
// 4. MRDWN/EMBED TEXT IS ENCODED — &, <, > escaped for Slack;
//    Discord field/description lengths sliced to API limits —
//    so a hostile form value can't break or inject into a message.
// ============================================================

// ---- shared policy (module + generated script stay in sync) ----

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 300;
const MAX_BACKOFF_MS = 8000;
const DISCORD_COLOR = 0x5865F2; // Discord blurple
const KINDS = {
  slack: 'slack',
  discord: 'discord',
  generic: 'generic',
  zapier: 'generic',
  make: 'generic',
  n8n: 'generic'
};

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * Resolve a target's payload kind. Explicit kind wins (with
 * aliases); otherwise the URL decides.
 */
function webhookKind(url, kind) {
  if (kind != null && kind !== '') {
    const k = String(kind).toLowerCase().trim();
    if (!KINDS[k]) {
      throw fail('unknown_provider', 'Unknown webhook kind "' + String(kind)
        + '". Use slack, discord, generic, zapier, make, or n8n.');
    }
    return KINDS[k];
  }
  const u = String(url || '');
  if (/hooks\.slack\.com/i.test(u)) return 'slack';
  if (/discord(?:app)?\.com\/api\/webhooks/i.test(u)) return 'discord';
  return 'generic';
}

/** Retry on throttling / server errors / request timeout only. */
function shouldRetryStatus(status) {
  const s = Number(status);
  if (s === 408 || s === 429) return true;
  return Number.isFinite(s) && s >= 500 && s < 600;
}

/**
 * Exponential backoff: base · 2^attempt capped at MAX_BACKOFF_MS,
 * plus optional jitter ratio (default off — the generated script
 * matches this exact schedule). `rnd` injectable for tests.
 */
function backoffDelay(attempt, baseDelay, jitter, rnd) {
  const b = Number(baseDelay);
  const base = Number.isFinite(b) && b > 0 ? b : DEFAULT_BASE_DELAY_MS;
  const n = Math.max(0, Math.floor(Number(attempt) || 0));
  const exp = Math.min(MAX_BACKOFF_MS, base * Math.pow(2, n));
  const j = Number(jitter) > 0 ? Number(jitter) : 0;
  const r = typeof rnd === 'function' ? Number(rnd()) || 0 : Math.random();
  return Math.round(exp + exp * j * r);
}

// ---- event/meta normalization ------------------------------------

const EVENT_KEYS = /^(target|title|message|fields|data|color)$/;

/**
 * Normalize any event bag: explicit fields/data objects first,
 * then hoisted top-level keys (so {name, email, message} works
 * as a form payload). Values become strings (objects → JSON).
 */
function normalizeEvent(event) {
  const o = event && typeof event === 'object' ? event : {};
  const fields = {};
  const merge = (src) => {
    if (!src || typeof src !== 'object') return;
    Object.keys(src).forEach((k) => { if (fields[k] == null) fields[k] = src[k]; });
  };
  merge(o.fields);
  merge(o.data);
  Object.keys(o).forEach((k) => {
    if (!EVENT_KEYS.test(k) && fields[k] == null) fields[k] = o[k];
  });
  Object.keys(fields).forEach((k) => {
    const v = fields[k];
    fields[k] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
  const raw = String(o.title || o.target || 'webhook');
  return {
    target: String(o.target || 'event'),
    title: raw.charAt(0).toUpperCase() + raw.slice(1),
    message: String(o.message || ''),
    color: o.color,
    fields
  };
}

function normalizeMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const ts = m.timestamp instanceof Date ? m.timestamp.toISOString()
    : m.timestamp ? String(m.timestamp) : new Date().toISOString();
  return {
    page: m.page == null ? '' : String(m.page),
    referrer: m.referrer == null ? '' : String(m.referrer),
    timestamp: ts,
    color: m.color
  };
}

/** Slack mrkdwn requires & < > entity-encoded. */
const mrkdwn = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Discord accepts a decimal theme color; strings parse as hex when tagged. */
function discordColor(v) {
  if (v == null || v === '') return DISCORD_COLOR;
  if (typeof v === 'string') {
    const s = v.trim();
    const tagged = s.charAt(0) === '#';
    const hex = s.replace(/^#/, '');
    if ((tagged || /[a-f]/i.test(hex)) && /^[0-9a-f]{3,8}$/i.test(hex)) {
      // 3-digit shorthand (#0af) expands to 00aaff.
      v = parseInt(hex.length === 3 ? hex.replace(/./g, '$&$&') : hex, 16);
    } else {
      v = Number(s);
    }
  }
  if (!Number.isFinite(v)) return DISCORD_COLOR;
  return Math.max(0, Math.min(0xFFFFFF, Math.round(Number(v))));
}

// ---- payload formatters (pure) -----------------------------------

/**
 * Slack: notification `text` fallback + section blocks — user
 * message first, then a fields section (≤10 per Slack's limit)
 * carrying the form values, referrer and timestamp, then a
 * context row with the page URL.
 */
function formatSlackPayload(event, meta) {
  const e = normalizeEvent(event);
  const m = normalizeMeta(meta);
  const head = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*' + mrkdwn(e.title) + '*' + (e.message ? '\n' + mrkdwn(e.message) : '')
    }
  };
  const entries = Object.keys(e.fields).slice(0, 8)
    .map((k) => ({ title: k, value: e.fields[k] || '—' }));
  entries.push({ title: 'Referrer', value: m.referrer || 'Direct' });
  entries.push({ title: 'Time', value: m.timestamp });
  const fields = entries.slice(0, 10).map((f) => ({
    type: 'mrkdwn',
    text: '*' + mrkdwn(f.title) + '*\n' + mrkdwn(f.value)
  }));
  const blocks = [head];
  if (fields.length) blocks.push({ type: 'section', fields });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: mrkdwn((m.page || 'unknown page').slice(0, 300)) }]
  });
  return {
    text: mrkdwn(e.title) + (e.message ? ' — ' + mrkdwn(e.message) : ''),
    blocks
  };
}

/**
 * Discord: one rich embed — custom theme color, message as the
 * description, page as the permalink, grouped fields (form
 * values + referrer; timestamp rides embed.timestamp).
 */
function formatDiscordPayload(event, meta) {
  const e = normalizeEvent(event);
  const m = normalizeMeta(meta);
  const embed = {
    title: e.title.slice(0, 256),
    color: discordColor(e.color != null ? e.color : m.color),
    timestamp: m.timestamp
  };
  if (e.message) embed.description = e.message.slice(0, 4096);
  if (m.page) embed.url = m.page.slice(0, 2048);
  const fields = Object.keys(e.fields).slice(0, 21).map((k) => ({
    name: k.slice(0, 256),
    value: (e.fields[k] || '—').slice(0, 1024),
    inline: true
  }));
  if (m.referrer && fields.length < 22) {
    fields.push({ name: 'Referrer', value: m.referrer.slice(0, 1024), inline: false });
  }
  if (fields.length) embed.fields = fields;
  return { embeds: [embed] };
}

/** Zapier / Make / n8n / custom Workers: flat key/value JSON. */
function formatGenericPayload(event, meta) {
  const e = normalizeEvent(event);
  const m = normalizeMeta(meta);
  return {
    event: e.target,
    title: e.title,
    message: e.message,
    data: e.fields,
    page: m.page,
    referrer: m.referrer,
    timestamp: m.timestamp
  };
}

// ---- the generated dispatcher ------------------------------------

const jsonSafe = (obj) => JSON.stringify(obj)
  .replace(/<\//g, '<\\/')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

/**
 * generateWebhookDispatcherScript(targets, options) → inline JS.
 *
 * targets = {
 *   contact:  'https://hooks.slack.com/…'        (string form), or
 *   lead:     {url, kind}                        (kind optional)
 * }
 * options  = {retries: 0..10 (default 3), baseDelay: ms (default 300)}
 *
 * Missing/invalid urls and unknown kinds throw here (typed codes)
 * so a broken target is a build error, never a silent runtime drop.
 */
function generateWebhookDispatcherScript(targets, options) {
  if (!targets || typeof targets !== 'object' || !Object.keys(targets).length) {
    throw fail('bad_input', 'generateWebhookDispatcherScript requires at least one target');
  }
  const T = {};
  Object.keys(targets).forEach((name) => {
    const raw = targets[name];
    const entry = typeof raw === 'string' ? { url: raw } : raw && typeof raw === 'object' ? raw : null;
    if (!entry || !entry.url) {
      throw fail('missing_credential', 'webhook target "' + name + '" needs a url');
    }
    const url = String(entry.url);
    if (!/^https?:\/\//i.test(url)) {
      throw fail('bad_input', 'webhook target "' + name + '" url must be http(s)');
    }
    const key = String(name).replace(/[^\w-]/g, '');
    if (!key) {
      throw fail('bad_input', 'webhook target name "' + String(name) + '" is empty after sanitizing');
    }
    T[key] = { url: url, kind: webhookKind(url, entry.kind) };
  });
  const o = options || {};
  const retriesRaw = Number(o.retries);
  const retries = Number.isFinite(retriesRaw) ? Math.max(0, Math.min(10, Math.round(retriesRaw))) : DEFAULT_RETRIES;
  const delayRaw = Number(o.baseDelay);
  const baseDelay = Number.isFinite(delayRaw) && delayRaw > 0
    ? Math.min(5000, Math.round(delayRaw)) : DEFAULT_BASE_DELAY_MS;

  return '(function(){'
    + 'var T=' + jsonSafe(T) + ',O={r:' + retries + ',d:' + baseDelay + '},'
      + 'M={p:location.href,r:document.referrer,t:""};'
    + 'function esc(s){return(""+s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}'
    + 'function col(v){if(v==null||v==="")return 5793266;'
      + 'if(typeof v==="string"){var s=v.trim(),h=s.replace(/^#/,"");'
      + 'v=(s.charAt(0)==="#"||/[a-f]/i.test(h))&&/^[0-9a-f]{3,8}$/i.test(h)?'
      + 'parseInt(h.length===3?h.replace(/./g,"$&$&"):h,16):Number(s)}'
      + 'return isFinite(v)?Math.max(0,Math.min(16777215,Math.round(v))):5793266}'
    // normalizeEvent mirror: merge fields/data, hoist the rest, stringify.
    + 'function ev(d){var o=d&&typeof d==="object"?d:{},f={},k,q,x=[o.fields,o.data];'
      + 'for(k=0;k<2;k++)if(x[k])for(q in x[k])if(f[q]==null)f[q]=x[k][q];'
      + 'for(q in o)if(!/^(target|title|message|fields|data|color)$/.test(q)&&f[q]==null)f[q]=o[q];'
      + 'for(q in f)f[q]=f[q]==null?"":typeof f[q]==="object"?JSON.stringify(f[q]):""+f[q];'
      + 'var t=""+(o.title||o.target||"webhook");'
      + 'return{t:t.charAt(0).toUpperCase()+t.slice(1),m:""+(o.message||""),'
      + 'f:f,g:""+(o.target||"event"),c:o.color}}'
    + 'function slack(e){var k,F=[],B=[{type:"section",text:{type:"mrkdwn",'
      + 'text:"*"+esc(e.t)+"*"+(e.m?"\\n"+esc(e.m):"")}}];'
      + 'for(k in e.f)if(F.length<8)F.push({type:"mrkdwn",text:"*"+esc(k)+"*\\n"+esc(e.f[k]||"—")});'
      + 'F.push({type:"mrkdwn",text:"*Referrer*\\n"+esc(M.r||"Direct")});'
      + 'F.push({type:"mrkdwn",text:"*Time*\\n"+M.t});'
      + 'B.push({type:"section",fields:F.slice(0,10)});'
      + 'B.push({type:"context",elements:[{type:"mrkdwn",text:esc((M.p||"unknown page").slice(0,300))}]});'
      + 'return{text:esc(e.t+(e.m?" — "+e.m:"")),blocks:B}}'
    + 'function disc(e){var k,en={title:e.t.slice(0,256),color:col(e.c),timestamp:M.t},F=[];'
      + 'if(e.m)en.description=e.m.slice(0,4096);'
      + 'if(M.p)en.url=M.p.slice(0,2048);'
      + 'for(k in e.f)if(F.length<21)F.push({name:k.slice(0,256),value:(e.f[k]||"—").slice(0,1024),inline:true});'
      + 'if(M.r&&F.length<22)F.push({name:"Referrer",value:M.r.slice(0,1024),inline:false});'
      + 'if(F.length)en.fields=F;return{embeds:[en]}}'
    + 'function gen(e){return{event:e.g,title:e.t,message:e.m,data:e.f,'
      + 'page:M.p,referrer:M.r,timestamp:M.t}}'
    // Retry: 408/429/5xx and network failures back off; other 4xx fail fast.
    + 'function post(u,b,n){return fetch(u,{method:"POST",'
      + 'headers:{"content-type":"application/json"},body:JSON.stringify(b)})'
      + '.then(function(r){if(r.ok)return 1;'
        + 'if(n<O.r&&(r.status===408||r.status===429||r.status>=500&&r.status<600))'
        + 'return wait(n).then(function(){return post(u,b,n+1)});return 0},'
      + 'function(){if(n<O.r)return wait(n).then(function(){return post(u,b,n+1)});return 0})}'
    + 'function wait(n){return new Promise(function(res){'
      + 'setTimeout(res,Math.round(O.d*Math.pow(2,n)))})}'
    + 'function fire(d){var o=d&&typeof d==="object"?d:{},t=T[o.target];if(!t)return;'
      + 'var e=ev(o);M.t=new Date().toISOString();'
      + 'var b=t.kind==="slack"?slack(e):t.kind==="discord"?disc(e):gen(e);'
      + 'return post(t.url,b,0).then(function(ok){'
      + 'if(!ok)console.warn("[webhook]",o.target);return ok})}'
    // Auto-binding: forms (honeypot excluded), links/buttons, custom event.
    + 'document.addEventListener("submit",function(e){var f=e.target;'
      + 'if(f.tagName!=="FORM"||!f.dataset.webhook)return;'
      + 'if(!f.getAttribute("action"))e.preventDefault();'
      + 'var d={},fd=new FormData(f);'
      + 'fd.forEach(function(v,k){if(k!=="botcheck")d[k]=v});'
      + 'd.target=f.dataset.webhook;fire(d)});'
    + 'document.addEventListener("click",function(e){'
      + 'var b=e.target.closest&&e.target.closest("[data-webhook]");'
      + 'if(!b||b.tagName==="FORM")return;'
      + 'fire({target:b.dataset.webhook,label:(b.textContent||"").trim().slice(0,120)})});'
    + 'document.addEventListener("pai:webhook",function(e){fire(e&&e.detail)});'
    + 'window.paiWebhook=function(t,d){'
      + 'return fire(typeof t==="string"?Object.assign({target:t},d||{}):t)};'
    + '})();';
}

module.exports = {
  DEFAULT_RETRIES,
  DEFAULT_BASE_DELAY_MS,
  MAX_BACKOFF_MS,
  DISCORD_COLOR,
  webhookKind,
  shouldRetryStatus,
  backoffDelay,
  normalizeEvent,
  normalizeMeta,
  formatSlackPayload,
  formatDiscordPayload,
  formatGenericPayload,
  generateWebhookDispatcherScript
};

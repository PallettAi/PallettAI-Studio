'use strict';
// ============================================================
// Motion & Deploy v4 — e-commerce, webhooks, filters, environments
//
// The four modules of this brief, checked where they could break:
//
//   1. cart-router    — the drawer script against its < 2KB (2048 B)
//                       budget for BOTH a default and a worst-case
//                       config (both must compile), ledger math
//                       (clamps, cents, promo rules, poison rows),
//                       and Stripe/PayPal/Snipcart/LemonSqueezy
//                       checkout payload generation incl. typed
//                       failure modes.
//   2. webhooks       — Slack blocks / Discord embeds / generic JSON
//                       formatting pure-function assertions, the
//                       exported retry policy (408/429/5xx, doubling
//                       schedule, cap, injected-random jitter), and
//                       the generated dispatcher (compile + kinds +
//                       options + bindings).
//   3. faceted-filter — query-string logic: build/parse round-trips,
//                       the open-ended price grammar, OR-within /
//                       AND-across facet semantics, the unpriced
//                       item rule, CSS guards, script compile.
//   4. deploy-env     — zero-packet mocked fetch over all three
//                       providers: environment → branch mapping
//                       (CF form field, Netlify builds multipart,
//                       Vercel target/gitBranch), normalized list
//                       output, rollback URLs (CF rollback, Netlify
//                       restore, Vercel redeploy), typed errors and
//                       token redaction.
//
// Usage: node scripts/motion-deploy-v4-smoke.js   (exit 0 = green)
// ============================================================

const cart = require('../modules/cart-router.js');
const hooks = require('../modules/webhooks.js');
const filter = require('../modules/faceted-filter.js');
const env = require('../modules/deploy-environments.js');
const deploy = require('../modules/deploy.js');
const { zipFiles } = require('../modules/zip.js');

let fails = 0;
let total = 0;
const ok = (cond, label) => {
  total++;
  console.log((cond ? '  ok   ' : '  FAIL ') + label);
  if (!cond) fails++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const section = (title) => console.log('\n== ' + title + ' ==');
const compiles = (src) => { try { new Function(src); return null; } catch (e) { return e.message; } };

// ============================================================
section('1. cart-router — script budget, ledger math, checkout payloads');
// ============================================================

const DEFAULT_CFG = { promos: { SAVE10: { percent: 10 } }, empty: 'Nothing yet', promoErrorMessage: 'Nope' };
const WORST_CFG = {
  storageKey: 'checkout_cart', storage: 'session', currency: '€', drawerId: 'cart-drawer',
  promos: { SAVE10: { percent: 10 }, WELCOME: { amount: 5 } },
  emptyMessage: 'Your basket is empty', promoErrorMessage: "That code doesn't work"
};

const drawerScript = cart.generateCartDrawerScript(DEFAULT_CFG);
console.log('  (default cfg: ' + drawerScript.length + ' B, worst cfg: '
  + cart.generateCartDrawerScript(WORST_CFG).length + ' B, budget 2048)');
ok(drawerScript.length < 2048, 'drawer script under 2KB (2048 B)');
const worstScript = cart.generateCartDrawerScript(WORST_CFG);
ok(worstScript.length < 2048, 'worst-case config also under 2KB');
ok(compiles(drawerScript) === null, 'default script compiles');
ok(compiles(worstScript) === null, 'worst-case script compiles');
ok(/function E\(s\)/.test(drawerScript) && !/\.replace \?/.test(drawerScript), 'E() escape helper intact');
ok(drawerScript.indexOf('data-cart-act=rm') > -1 && drawerScript.indexOf('"promo"') > -1, 'qty/remove/promo controls wired');
ok(drawerScript.indexOf('sessionStorage:localStorage') > -1, 'storage choice driven by config');

// config serialization: short keys, #-prefixed promos (positive percent / negative amount), s only when session
const dc = cart.drawerConfig(DEFAULT_CFG);
ok(dc.k === 'pai_cart' && dc.u === '$' && typeof dc.P === 'object', 'drawerConfig short keys');
ok(dc.P['#SAVE10'] === 10, 'percent promo serialized positive under # key');
const dcAmt = cart.drawerConfig({ promos: { FIVE: { amount: 5 } } });
ok(dcAmt.P['#FIVE'] === -5, 'amount promo serialized negative under # key');
ok(cart.drawerConfig({}).s === undefined && cart.drawerConfig({ storage: 'session' }).s === 1, 'session flag omitted unless configured');
ok(cart.drawerConfig({ promos: { 'constructor': { percent: 50 } } }).P['#CONSTRUCTOR'] === 50, 'promo keys uppercased + # prefixed (proto-safe lookup)');

// ids: drawerIds ⇄ cartDrawerHTML must agree
const ids = cart.drawerIds(WORST_CFG);
const html = cart.cartDrawerHTML(WORST_CFG);
ok(ids.list === 'checkout_cart-list' && ids.disc === 'checkout_cart-disc' && ids.code === 'checkout_cart-code', 'drawerIds derive from config key');
['list', 'count', 'sub', 'disc', 'tot', 'code', 'perr'].forEach((k) => {
  ok(html.indexOf('id="' + ids[k] + '"') > -1, 'cartDrawerHTML emits id for ' + k);
});
ok(html.indexOf('id="cart-drawer"') > -1, 'drawer element uses configured drawerId');
ok(/<div class="cart-row cart-disc" hidden><span>Discount<\/span><b id="[^"]*">/.test(html), 'discount VALUE element carries the -disc id (row label survives)');
ok(html.indexOf('data-cart-act="promo"') > -1 && html.indexOf('role="alert"') > -1, 'promo control + alert region present');

// ledger math
ok(cart.adjustQty(1, -1) === 1 && cart.adjustQty(99, 5) === 99 && cart.adjustQty(10, -3) === 7, 'adjustQty clamps 1..99');
ok(cart.adjustQty(undefined, 0) === 1 && cart.adjustQty(undefined, 1) === 2, 'adjustQty defaults to 1 then applies delta');
ok(cart.cartSubtotal([{ p: 10, q: 2 }, { p: 5.555, q: 1 }]) === 25.56, 'subtotal rounds to cents');
ok(cart.cartSubtotal([null, { p: -5, q: 1 }]) === 0, 'poison rows dropped from subtotal');
const t = cart.cartTotals([{ p: 20, q: 2 }], 'SAVE10', { SAVE10: { percent: 10 } });
ok(t.subtotal === 40 && t.discount === 4 && t.total === 36 && t.promoApplied, 'percent promo: 40 − 10% = 36');
ok(t.count === 2, 'count is quantity sum');
const t2 = cart.cartTotals([{ p: 3, q: 1 }], 'X', { X: { amount: 99 } });
ok(t2.discount === 3 && t2.total === 0, 'amount promo clamps at subtotal (never negative)');
ok(cart.promoDiscount(10, 'nope', { A: { percent: 1 } }).ok === false, 'unknown promo code rejected');
ok(cart.parseCart('not json').length === 0 && cart.parseCart('{"a":1}').length === 0, 'malformed storage → []');
ok(cart.parseCart('[{"i":"a","n":"A","p":9.99,"q":3}]')[0].q === 3, 'parseCart keeps valid rows');
ok(cart.fmtMoney(12.345, '£') === '£12.35', 'fmtMoney formats currency');

// checkout: stripe
const st = cart.generateCheckoutRedirect('stripe', [{ id: 'p1', name: 'P', price: 10, qty: 1 }],
  { checkoutUrl: 'https://buy.stripe.com/abc', email: 'a@b.co' });
ok(st.kind === 'redirect' && /^https:\/\/buy\.stripe\.com\/abc\?/.test(st.url), 'stripe redirects to checkout url');
ok(/prefilled_email=a%40b\.co/.test(st.url), 'stripe prefilled_email appended');
ok(st.total === 10 && st.items[0].id === 'p1', 'stripe result carries items + total');
const stLink = cart.generateCheckoutRedirect('stripe',
  [{ id: 'p2', price: 5, paymentLink: 'https://buy.stripe.com/link' }], {});
ok(stLink.url === 'https://buy.stripe.com/link', 'stripe falls back to payment link');
let threw = null;
try { cart.generateCheckoutRedirect('stripe', [{ id: 'x', price: 1 }], {}); } catch (e) { threw = e.code; }
ok(threw === 'missing_credential', 'stripe without url throws missing_credential');
threw = null;
try { cart.generateCheckoutRedirect('stripe', [{ id: 'x', price: 1 }], { checkoutUrl: 'javascript:alert(1)' }); } catch (e) { threw = e.code; }
ok(threw === 'bad_input', 'non-http stripe url throws bad_input');

// checkout: paypal
threw = null;
try { cart.generateCheckoutRedirect('paypal', [{ id: 'x', price: 1 }], {}); } catch (e) { threw = e.code; }
ok(threw === 'missing_credential', 'paypal without clientId throws missing_credential');
const pp = cart.generateCheckoutRedirect('paypal', [{ id: 'x', price: 19.5, qty: 2 }], { clientId: 'CID', currency: 'eur' });
ok(pp.kind === 'script' && pp.html.indexOf('paypal.com/sdk/js?client-id=CID') > -1, 'paypal SDK snippet with client id');
ok(pp.html.indexOf('currency=EUR') > -1 && pp.html.indexOf('value:39.00') > -1, 'paypal currency + line total');
ok(pp.total === 39, 'paypal total = price × qty');

// checkout: snipcart / lemonsqueezy
const sn = cart.dataAttributes('snipcart', { id: 'sku1', name: 'Widget', price: 9.9, qty: 2, url: 'https://acme.com/p/1' }, {});
ok(sn['data-item-id'] === 'sku1' && sn['data-item-price'] === '9.9', 'snipcart id + price attrs');
ok(sn['data-item-url'] === 'https://acme.com/p/1' && sn['data-item-quantity'] === '2', 'snipcart url + quantity attrs');
const le = cart.dataAttributes('lemonsqueezy', { id: '42', name: 'Kit', price: 25 }, { siteUrl: 'https://acme.com/kit' });
ok(le['ls-add-to-cart'] === '42' && le['data-item-url'] === 'https://acme.com/kit', 'lemonsqueezy attrs');
threw = null;
try { cart.generateCheckoutRedirect('snipcart', [{ id: 'a', price: 1 }], {}); } catch (e) { threw = e.code; }
ok(threw === 'bad_input', 'snipcart without url/siteUrl throws bad_input');
threw = null;
try { cart.generateCheckoutRedirect('monday-com', [], {}); } catch (e) { threw = e.code; }
ok(threw === 'unknown_provider', 'unknown provider throws unknown_provider');
threw = null;
try { cart.generateCheckoutRedirect('snipcart', [], {}); } catch (e) { threw = e.code; }
ok(threw === 'bad_input', 'empty cart throws bad_input');

const snip = cart.generateCheckoutRedirect('snipcart',
  [{ id: 's1', name: 'A', price: 5, url: 'https://a.co/a' }, { id: 's2', name: 'B', price: 7, url: 'https://a.co/b' }], {});
ok(snip.kind === 'attributes' && snip.attributes.length === 2 && snip.total === 12, 'snipcart multi-item attributes');
ok(snip.html.indexOf('data-item-id="s2"') > -1, 'snipcart html carries per-item attrs');

// ============================================================
section('2. webhooks — Slack/Discord/generic formatting, retry policy, dispatcher');
// ============================================================

ok(hooks.webhookKind('https://hooks.slack.com/services/T/B/x') === 'slack', 'slack inferred from url');
ok(hooks.webhookKind('https://discord.com/api/webhooks/1/a') === 'discord', 'discord inferred from url');
ok(hooks.webhookKind('https://hook.zapier.com/hooks/catch/1/x') === 'generic', 'zapier url → generic');
ok(hooks.webhookKind('https://example.com/worker', 'n8n') === 'generic', 'n8n alias → generic');
ok(hooks.webhookKind('https://example.com/w', 'slack') === 'slack', 'explicit kind wins');
threw = null;
try { hooks.webhookKind('https://x.co', 'carrier-pigeon'); } catch (e) { threw = e.code; }
ok(threw === 'unknown_provider', 'unknown kind throws unknown_provider');

ok(hooks.shouldRetryStatus(408) && hooks.shouldRetryStatus(429) && hooks.shouldRetryStatus(503), 'retry 408/429/5xx');
ok(!hooks.shouldRetryStatus(400) && !hooks.shouldRetryStatus(401) && !hooks.shouldRetryStatus(404) && !hooks.shouldRetryStatus(499), 'never retry other 4xx');
ok(!hooks.shouldRetryStatus(600), '600+ not retryable');
ok(hooks.backoffDelay(0, 300) === 300 && hooks.backoffDelay(1, 300) === 600 && hooks.backoffDelay(2, 300) === 1200, 'exact exponential doubling');
ok(hooks.backoffDelay(9, 300) === hooks.MAX_BACKOFF_MS, 'backoff capped at MAX_BACKOFF_MS');
ok(hooks.backoffDelay(0, null) === hooks.DEFAULT_BASE_DELAY_MS, 'default base delay');
ok(hooks.backoffDelay(0, 300, 0.5, () => 1) === 450 && hooks.backoffDelay(0, 300, 0.5, () => 0) === 300, 'jitter bounds with injected random');

const meta = { page: 'https://acme.com/thanks', referrer: 'https://news.ycombinator.com/', timestamp: '2026-09-22T10:00:00.000Z' };
const sl = hooks.formatSlackPayload({ target: 'contact', message: 'Hello <world> & co', name: 'Ada', email: 'ada@lovelace.io' }, meta);
ok(sl.text.indexOf('Contact') === 0 && sl.text.indexOf('&amp;') > -1, 'slack notification text: title + escaped');
ok(sl.blocks.length === 3 && sl.blocks[0].type === 'section' && sl.blocks[0].text.type === 'mrkdwn', 'slack head block shape');
ok(sl.blocks[0].text.text.indexOf('Hello &lt;world&gt; &amp; co') > -1, 'slack mrkdwn-escapes the user message');
const flat = sl.blocks[1].fields.map((f) => f.text).join('|');
ok(flat.indexOf('*name*') > -1 && flat.indexOf('Ada') > -1 && flat.indexOf('ada@lovelace.io') > -1, 'slack fields carry form values');
ok(flat.indexOf('*Referrer*') > -1 && flat.indexOf('news.ycombinator.com') > -1, 'slack fields carry referrer');
ok(flat.indexOf('*Time*') > -1 && flat.indexOf('2026-09-22T10:00:00.000Z') > -1, 'slack fields carry timestamp');
ok(sl.blocks[1].fields.length <= 10, 'slack respects the 10-field section cap');
ok(sl.blocks[2].type === 'context' && sl.blocks[2].elements[0].text === 'https://acme.com/thanks', 'slack context row = page');

const dcx = hooks.formatDiscordPayload({ target: 'download', message: 'Guide claimed', file: 'ui-guide.pdf', color: '#0af' }, meta);
const en = dcx.embeds[0];
ok(dcx.embeds.length === 1 && en.title === 'Download', 'discord embed head');
ok(en.description === 'Guide claimed', 'discord description = message');
ok(en.color === 0x00aaff, 'discord 3-digit shorthand expands (#0af → 00aaff)');
ok(en.url === 'https://acme.com/thanks' && en.timestamp === '2026-09-22T10:00:00.000Z', 'discord permalink + timestamp');
ok(en.fields.some((f) => f.name === 'file' && f.value === 'ui-guide.pdf' && f.inline), 'discord grouped inline fields');
ok(en.fields[en.fields.length - 1].name === 'Referrer' && en.fields[en.fields.length - 1].inline === false, 'discord referrer field');
ok(hooks.formatDiscordPayload({ target: 'x' }, {}).embeds[0].color === hooks.DISCORD_COLOR, 'default blurple color');
ok(hooks.formatDiscordPayload({ target: 'x', color: 'not-a-color' }, {}).embeds[0].color === hooks.DISCORD_COLOR, 'garbage color → default');
ok(hooks.formatDiscordPayload({ target: 'x', color: 99999999 }, {}).embeds[0].color === 0xFFFFFF, 'color clamps to 0xFFFFFF');
const sparse = hooks.formatDiscordPayload({ target: 'x' }, {}).embeds[0];
ok(!('description' in sparse) && !('fields' in sparse), 'empty optional keys omitted');

const gen = hooks.formatGenericPayload({ target: 'lead', message: 'hi', company: 'Acme' }, meta);
ok(gen.event === 'lead' && gen.data.company === 'Acme', 'generic key/value data');
ok(gen.page === meta.page && gen.referrer === meta.referrer && gen.timestamp === meta.timestamp, 'generic meta passthrough');

const nev = hooks.normalizeEvent({ target: 'contact', fields: { a: 1 }, note: 'x', color: 'red', nested: { k: 2 } });
ok(nev.fields.a === '1' && nev.fields.nested === '{"k":2}', 'field values coerced to strings');
ok(!('color' in nev.fields) && !('target' in nev.fields), 'control keys stay out of fields');

const dispatcher = hooks.generateWebhookDispatcherScript({
  contact: 'https://hooks.slack.com/services/T/B/x',
  download: { url: 'https://discord.com/api/webhooks/1/y' },
  lead: 'https://hook.zapier.com/hooks/catch/1/z'
}, { retries: 2, baseDelay: 150 });
console.log('  (dispatcher: ' + dispatcher.length + ' B)');
ok(compiles(dispatcher) === null, 'dispatcher script compiles');
ok(dispatcher.indexOf('"kind":"slack"') > -1 && dispatcher.indexOf('"kind":"discord"') > -1 && dispatcher.indexOf('"kind":"generic"') > -1, 'kinds embedded per target');
ok(dispatcher.indexOf('r:2') > -1 && dispatcher.indexOf('d:150') > -1, 'retry options embedded');
ok(dispatcher.indexOf('paiWebhook') > -1 && dispatcher.indexOf('botcheck') > -1, 'public API + honeypot exclusion');
ok(dispatcher.indexOf('Math.pow(2,n)') > -1, 'script backoff doubles with attempt');
threw = null;
try { hooks.generateWebhookDispatcherScript({}); } catch (e) { threw = e.code; }
ok(threw === 'bad_input', 'empty targets throws bad_input');
threw = null;
try { hooks.generateWebhookDispatcherScript({ x: 'ftp://nope' }); } catch (e) { threw = e.code; }
ok(threw === 'bad_input', 'non-http target throws bad_input');

// ============================================================
section('3. faceted-filter — query logic, URL formatting, script');
// ============================================================

ok(eq(filter.normalizeFilters({ category: [' Design ', 'design', 'BRANDING'], q: ' logo ', price: { min: '10', max: '' }, sort: 'price-asc' }),
  { category: ['design', 'branding'], price: { min: 10 }, q: 'logo', sort: 'price-asc' }), 'normalize: dedupe, lowercase, coerce');
ok(eq(filter.normalizeFilters(null), { category: [], price: {}, q: '', sort: '' }), 'normalize(null) → empty state');
ok(filter.buildFilterQuery({}) === '', 'empty filters → empty query');
ok(filter.buildFilterQuery({ category: ['design'], sort: 'price-asc' }) === 'category=design&sort=price-asc', 'spec example query string');
ok(filter.buildFilterQuery({ category: ['a', 'b'], price: { min: 10, max: 50 }, q: 'logo mark' }) === 'category=a,b&price=10-50&q=logo%20mark', 'all facets emitted');
ok(filter.buildFilterQuery({ price: { max: 50 } }) === 'price=-50', 'open min → "-50"');
ok(filter.buildFilterQuery({ price: { min: 10 } }) === 'price=10-', 'open max → "10-"');

const parsed = filter.parseFilterQuery('?category=design&sort=price-asc');
ok(eq(parsed, { category: ['design'], price: {}, q: '', sort: 'price-asc' }), 'parse spec example');
ok(eq(filter.parseFilterQuery('category=A,a,b').category, ['a', 'b']), 'parse lowercases + dedupes');
ok(eq(filter.parseFilterQuery('price=10-50').price, { min: 10, max: 50 }) &&
  eq(filter.parseFilterQuery('price=-50').price, { max: 50 }) &&
  eq(filter.parseFilterQuery('price=10-').price, { min: 10 }) &&
  eq(filter.parseFilterQuery('price=-').price, {}), 'price grammar: bounds, open ends');
ok(Object.keys(filter.parseFilterQuery('price=abc').price).length === 0, 'garbage price ignored');
ok(filter.parseFilterQuery('q=%20logo%20').q === 'logo', 'q decoded + trimmed');
ok(filter.parseFilterQuery(null).q === '', 'null query safe');

const rt = { category: ['Design', 'ux'], price: { min: 5, max: 9 }, q: 'a b', sort: 'price-desc' };
ok(eq(filter.parseFilterQuery('?' + filter.buildFilterQuery(rt)), filter.normalizeFilters(rt)), 'parse∘build round-trips');
ok(filter.buildFilterQuery(filter.parseFilterQuery('?' + filter.buildFilterQuery(rt))) === filter.buildFilterQuery(rt), 'build∘parse stable string');

const item = { categories: ['design', 'branding'], price: 49, title: 'Brand kit', text: 'Complete identity' };
ok(filter.matchesFilters(item, { category: ['design'] }), 'category hit');
ok(!filter.matchesFilters(item, { category: ['photo'] }), 'category miss');
ok(filter.matchesFilters(item, { category: ['photo', 'branding'] }), 'OR within the category facet');
ok(filter.matchesFilters(item, { category: ['design'], q: 'identity' }), 'AND across facets');
ok(filter.matchesFilters(item, { price: { min: 40, max: 60 } }), 'price in range');
ok(!filter.matchesFilters(item, { price: { max: 48 } }) && !filter.matchesFilters(item, { price: { min: 50 } }), 'price out of range');
ok(!filter.matchesFilters({ title: 'free' }, { price: { min: 1 } }), 'unpriced item excluded when price active');
ok(filter.matchesFilters({ title: 'free' }, {}), 'unpriced item kept with no price facet');
ok(filter.matchesFilters({ title: 'BRAND Kit' }, { q: 'brand' }), 'q case-insensitive');
ok(!filter.matchesFilters(item, { q: 'zzz' }), 'q miss');
ok(filter.matchesFilters(null, null), 'null item + null filters safe');

const css = filter.facetedFilterCSS('.cards');
ok(css.indexOf('.cards > *{transition:opacity') > -1, 'grid children transition');
ok(css.indexOf('.is-hiding{opacity:0;transform:scale(') > -1, 'opacity + scale hide animation');
ok(css.indexOf('.is-hidden{display:none}') > -1, 'hidden cards leave the flow');
ok(css.indexOf('@media (prefers-reduced-motion:reduce)') > -1, 'reduced-motion guard');
ok(filter.facetedFilterCSS('div{background:url(x)}').indexOf('{background') === -1, 'braces stripped from selector');
ok(filter.facetedFilterCSS('').indexOf('.pai-grid > *') === 0, 'default selector fallback');

const fscript = filter.generateFacetedFilterScript('.cards');
console.log('  (filter script: ' + fscript.length + ' B)');
ok(compiles(fscript) === null, 'filter script compiles');
ok(fscript.indexOf('history.replaceState') > -1, 'writes state via replaceState');
ok(fscript.indexOf('data-filter-category') > -1 && fscript.indexOf('data-price-min') > -1 && fscript.indexOf('data-filter-sort') > -1, 'control bindings present');
ok(fscript.indexOf('URLSearchParams') > -1 && fscript.indexOf('location.search') > -1, 'reads URL on load (bidirectional)');
ok(fscript.indexOf('is-hiding') > -1 && fscript.indexOf('is-hidden') > -1, 'two-phase hide classes');
threw = null;
try { filter.generateFacetedFilterScript('  '); } catch (e) { threw = e.code; }
ok(threw === 'bad_input', 'empty selector throws bad_input');
ok(compiles(filter.generateFacetedFilterScript('#a{b}')) === null, 'hostile selector still yields compiling script');

// ============================================================
section('4. deploy-environments — mocked dispatch, list, rollback (zero packets)');
// ============================================================

function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body, headers: (init && init.headers) || {} });
    for (const r of routes) {
      if (r.when(String(url), init)) {
        const status = r.status || 200;
        const bodyText = typeof r.body === 'string' ? r.body : JSON.stringify(r.body === undefined ? {} : r.body);
        return { ok: status >= 200 && status < 300, status, text: async () => bodyText, json: async () => JSON.parse(bodyText) };
      }
    }
    return { ok: false, status: 404, text: async () => '{"message":"not found"}', json: async () => ({ message: 'not found' }) };
  };
  fn.calls = calls;
  return fn;
}

ok(eq(env.parseEnvironment('production'), { environment: 'production', branch: '' }), 'production → no branch');
ok(env.parseEnvironment('staging').branch === 'staging', 'staging → branch staging');
ok(env.parseEnvironment('preview-login').branch === 'login' && env.parseEnvironment('preview-login').environment === 'preview', 'preview-login → branch login');
ok(env.parseEnvironment('feature/x').branch === 'feature/x' && env.parseEnvironment('feature/x').environment === 'preview', 'raw branch passthrough');
threw = null;
try { env.parseEnvironment('..'); } catch (e) { threw = e.code; }
ok(threw === 'bad_input', 'hostile branch throws bad_input');
threw = null;
try { env.parseEnvironment(''); } catch (e) { threw = e.code; }
ok(threw === null && eq(env.parseEnvironment(''), { environment: 'production', branch: '' }), 'empty environment → production');

// deploy.js branch plumbing (the shapes the adapters send)
const man = deploy.cfDeployMultipart({ 'index.html': deploy.sha256(Buffer.from('x')) }, { project_type: 'static' }, 'staging');
ok(man.body.indexOf('name="branch"') > -1 && man.body.indexOf('staging') > -1, 'CF multipart carries branch form field');
const noMan = deploy.cfDeployMultipart({ 'index.html': deploy.sha256(Buffer.from('x')) }, { project_type: 'static' });
ok(noMan.body.indexOf('name="branch"') < 0, 'CF multipart omits branch for production');

const TEXT_SITE = { files: [{ path: 'index.html', content: '<h1>hi</h1>' }] };

(async () => {
  // --- Cloudflare dispatch: production vs staging vs preview
  async function cfDeploy(environment) {
    const f = mockFetch([
      { when: (u, i) => u.includes('/upload-token'), body: { success: true, result: 'mock.jwt' } },
      { when: (u, i) => u.includes('/deployments') && i.method === 'POST', body: { success: true, result: { id: 'cfdep1', url: 'https://mock.pages.dev' } } },
      { when: (u) => u.includes('/assets/upload'), body: { success: true, result: {} } },
      { when: (u) => u.includes('upsert-hashes'), body: { success: true, result: {} } },
      { when: (u) => u.includes('/pages/projects'), body: { success: true, result: {} } }
    ]);
    const r = await env.deployToEnvironment('cloudflare',
      { apiToken: 'cf-secret-token', accountId: 'acct1', projectName: 'my-site' },
      TEXT_SITE, environment, { fetch: f });
    return { r, f };
  }
  {
    const { r, f } = await cfDeploy('production');
    ok(r.ok && r.environment === 'production' && r.branch === '' && r.deploymentId === 'cfdep1', 'CF production result shape');
    const create = f.calls.filter((c) => c.url.includes('/deployments') && c.method === 'POST')[0];
    ok(create.body.indexOf('name="branch"') < 0, 'CF production deployment body has no branch');
    ok(f.calls.every((c) => !c.headers.Authorization || c.headers.Authorization === 'Bearer cf-secret-token' || c.headers.Authorization === 'Bearer mock.jwt'),
      'CF auth headers never clobbered by content-type headers');
    ok(create.url.includes('/accounts/acct1/pages/projects/my-site/deployments'), 'CF deployment URL shape');
  }
  {
    const { r, f } = await cfDeploy('staging');
    ok(r.environment === 'staging' && r.branch === 'staging', 'CF staging result');
    const create = f.calls.filter((c) => c.url.includes('/deployments') && c.method === 'POST')[0];
    ok(/\r\n\r\nstaging\r\n/.test(create.body), 'CF staging body carries branch=staging');
  }
  {
    const { f } = await cfDeploy('preview-login');
    const create = f.calls.filter((c) => c.url.includes('/deployments') && c.method === 'POST')[0];
    ok(/\r\n\r\nlogin\r\n/.test(create.body), 'CF preview-login body carries branch=login');
  }

  // --- Netlify dispatch: production PUT vs staging builds multipart
  const siteZip = Buffer.from(zipFiles([{ name: 'index.html', content: '<h1>hi</h1>' }]));
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/sites/site_abc/deploys') && i.method === 'PUT', body: { id: 'nl1', url: 'https://x.netlify.app', ssl_url: 'https://x.netlify.app' } }
    ]);
    const r = await env.deployToEnvironment('netlify', { personalAccessToken: 'nl-secret', siteId: 'site_abc' },
      { zipBuffer: siteZip }, 'production', { fetch: f });
    ok(r.ok && r.environment === 'production' && r.deploymentId === 'nl1', 'NL production deploy');
    ok(f.calls[0].url.includes('/sites/site_abc/deploys') && f.calls[0].method === 'PUT', 'NL production uses PUT /deploys');
  }
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/sites/site_abc/builds') && i.method === 'POST', body: { id: 'nl2', url: 'https://x.netlify.app' } }
    ]);
    const r = await env.deployToEnvironment('netlify', { personalAccessToken: 'nl-secret', siteId: 'site_abc' },
      { zipBuffer: siteZip }, 'staging', { fetch: f });
    ok(r.environment === 'staging' && r.branch === 'staging' && r.deploymentId === 'nl2', 'NL staging deploy');
    const c = f.calls[0];
    ok(c.url.includes('/sites/site_abc/builds') && c.method === 'POST', 'NL staging uses POST /builds');
    const body = Buffer.isBuffer(c.body) ? c.body.toString('latin1') : String(c.body);
    ok(body.indexOf('name="zip"') > -1 && body.indexOf('name="branch"') > -1, 'NL builds multipart has zip + branch parts');
    ok(/\r\n\r\nstaging\r\n/.test(body), 'NL builds branch value staging');
    ok(String(c.headers['Content-Type']).includes('multipart/form-data; boundary='), 'NL builds content-type boundary');
    ok(c.headers.Authorization === 'Bearer nl-secret', 'NL builds auth header');
  }

  // --- Vercel dispatch
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/v13/deployments') && i.method === 'POST', body: { id: 'vdep9', url: 'my-site-abc123.vercel.app' } }
    ]);
    const r = await env.deployToEnvironment('vercel', { token: 'v-secret', projectName: 'my-site' },
      TEXT_SITE, 'preview-login', { fetch: f });
    ok(r.ok && r.environment === 'preview' && r.branch === 'login', 'Vercel preview result');
    ok(r.url === 'https://my-site-abc123.vercel.app' && r.deploymentId === 'vdep9', 'Vercel url scheme + id');
    const body = JSON.parse(f.calls[0].body);
    ok(body.name === 'my-site' && body.target === 'preview' && body.gitBranch === 'login', 'Vercel body name/target/gitBranch');
    ok(body.files.length === 1 && body.files[0].file === 'index.html' && body.files[0].encoding === 'base64', 'Vercel inline files shape');
    ok(Buffer.from(body.files[0].data, 'base64').toString() === '<h1>hi</h1>', 'Vercel file data decodes to content');
    ok(f.calls[0].headers.Authorization === 'Bearer v-secret', 'Vercel auth header');
  }
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/v13/deployments'), body: { id: 'vprod1', url: 'my-site.vercel.app', target: 'production' } }
    ]);
    const r = await env.deployToEnvironment('vercel', { token: 'v-secret', projectName: 'my-site' },
      { zipBuffer: siteZip }, 'production', { fetch: f });
    const body = JSON.parse(f.calls[0].body);
    ok(body.target === 'production' && body.gitBranch === undefined, 'Vercel production: target only, no gitBranch');
    ok(body.files[0].file === 'index.html', 'Vercel zip unpacked to files');
    ok(r.environment === 'production', 'Vercel production environment');
  }
  threw = null;
  try { await env.deployToEnvironment('vercel', { token: 'x' }, TEXT_SITE, 'production', { fetch: mockFetch([]) }); } catch (e) { threw = e.code; }
  ok(threw === 'missing_credential', 'Vercel missing projectName throws missing_credential');
  threw = null;
  try { await env.deployToEnvironment('carrier-pigeon', {}, {}, 'production', {}); } catch (e) { threw = e.code; }
  ok(threw === 'unknown_provider', 'unknown provider throws unknown_provider');

  // --- listDeployments normalization
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/deployments') && i.method === 'GET', body: { success: true, result: { deployments: [
        { id: 'd1', environment: 'production', url: 'https://a.pages.dev', created_on: '2026-09-01T00:00:00Z', latest_stage: { status: 'success' }, deployment_trigger: { metadata: { branch: 'main', commit_hash: 'abc123' } } }
      ] } } }
    ]);
    const r = await env.listDeployments('cloudflare', { apiToken: 't-secret', accountId: 'a', projectName: 'p' }, 'p', { fetch: f });
    const d = r.deployments[0];
    ok(r.ok && d.id === 'd1' && d.environment === 'production' && d.branch === 'main' && d.commit === 'abc123', 'CF list normalized (id/env/branch/commit)');
    ok(d.createdAt === '2026-09-01T00:00:00.000Z' && d.status === 'success' && d.url === 'https://a.pages.dev', 'CF list ISO date + status + preview url');
    ok(f.calls[0].url.includes('/accounts/a/pages/projects/p/deployments?per_page=10'), 'CF list URL');
  }
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/sites/site_nl/deploys') && i.method === 'GET', body: [
        { id: 'nlA', context: 'production', branch: 'main', ssl_url: 'https://x.netlify.app', created_at: '2026-09-02T00:00:00Z', commit_id: 'fff000', state: 'current' },
        { id: 'nlB', context: 'deploy-preview', branch: 'feat', url: 'https://feat-x.netlify.app', created_at: '2026-09-03T00:00:00Z', commit_id: null, state: 'ready' }
      ] },
      { when: (u, i) => u.includes('/sites/site_nl') && i.method === 'GET', body: { id: 'site_nl', name: 'x' } }
    ]);
    const r = await env.listDeployments('netlify', { personalAccessToken: 't-secret' }, 'site_nl', { fetch: f });
    ok(r.deployments.length === 2 && r.siteId === 'site_nl', 'NL list length + siteId');
    ok(r.deployments[0].environment === 'production' && r.deployments[0].commit === 'fff000', 'NL production item');
    ok(r.deployments[1].environment === 'preview' && r.deployments[1].branch === 'feat' && r.deployments[1].context === 'deploy-preview', 'NL preview item');
    ok(r.deployments[1].url === 'https://feat-x.netlify.app', 'NL preview url');
  }
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/v6/deployments'), body: { deployments: [
        { uid: 'v1', name: 'other', url: 'other.vercel.app', createdAt: 1756700000000, target: 'preview', meta: {} },
        { uid: 'v2', name: 'my-site', url: 'https://my-site.vercel.app', createdAt: 1756700000000, target: 'production', meta: { githubCommitSha: 'beef99', githubCommitRef: 'main' }, readyState: 'READY' }
      ] } }
    ]);
    const r = await env.listDeployments('vercel', { token: 't-secret' }, 'my-site', { fetch: f });
    ok(r.deployments.length === 1 && r.deployments[0].id === 'v2', 'Vercel list filters by project name');
    ok(r.deployments[0].commit === 'beef99' && r.deployments[0].branch === 'main', 'Vercel commit/branch from meta');
    ok(/^\d{4}-\d{2}-\d{2}T/.test(r.deployments[0].createdAt), 'Vercel createdAt ms → ISO');
    ok(f.calls[0].url.includes('/v6/deployments?limit=10'), 'Vercel list URL');
  }
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/sites?per_page=100'), body: [{ id: 'site_real', name: 'my-site', slug: 'my-site' }] },
      { when: (u, i) => u.includes('/sites/site_real/deploys'), body: [] },
      { when: (u, i) => u.includes('/sites/my-site') && i.method === 'GET', status: 404, body: { message: 'Not Found' } }
    ]);
    const r = await env.listDeployments('netlify', { personalAccessToken: 't-secret' }, 'my-site', { fetch: f });
    ok(r.siteId === 'site_real', 'Netlify site name resolves via sites list after 404');
  }

  // --- rollbackDeployment: the three revert endpoints
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/deployments/dold/rollback') && i.method === 'POST', body: { success: true, result: { id: 'dnew', url: 'https://b.pages.dev', environment: 'production' } } }
    ]);
    const r = await env.rollbackDeployment('cloudflare', { apiToken: 't-secret', accountId: 'a', projectName: 'p' }, 'p', 'dold', { fetch: f });
    ok(r.ok && r.deploymentId === 'dnew' && r.url === 'https://b.pages.dev' && r.environment === 'production', 'CF rollback result');
    ok(f.calls[0].url.includes('/accounts/a/pages/projects/p/deployments/dold/rollback') && f.calls[0].method === 'POST', 'CF rollback URL + method');
  }
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/deploys/nlold/restore') && i.method === 'POST', body: { id: 'nlold', ssl_url: 'https://back.netlify.app', context: 'production' } },
      { when: (u, i) => u.includes('/sites/site_nl') && i.method === 'GET', body: { id: 'site_nl' } }
    ]);
    const r = await env.rollbackDeployment('netlify', { personalAccessToken: 't-secret', siteId: 'site_nl' }, 'site_nl', 'nlold', { fetch: f });
    ok(r.ok && r.deploymentId === 'nlold' && r.url === 'https://back.netlify.app' && r.environment === 'production', 'NL rollback result');
    ok(f.calls.some((c) => c.url.includes('/sites/site_nl/deploys/nlold/restore') && c.method === 'POST'), 'NL restore URL + method');
  }
  {
    const f = mockFetch([
      { when: (u, i) => u.includes('/v13/deployments') && i.method === 'POST', body: { id: 'vreb1', url: 'https://my-site.vercel.app' } }
    ]);
    const r = await env.rollbackDeployment('vercel', { token: 't-secret', projectName: 'my-site' }, 'my-site', 'vold', { fetch: f });
    ok(r.ok && r.deploymentId === 'vreb1' && r.url === 'https://my-site.vercel.app', 'Vercel redeploy (rollback) result');
    ok(JSON.parse(f.calls[0].body).deploymentId === 'vold', 'Vercel redeploy body carries deploymentId');
  }
  threw = null;
  try { await env.rollbackDeployment('cloudflare', { apiToken: 't', accountId: 'a', projectName: 'p' }, '', '', { fetch: mockFetch([]) }); } catch (e) { threw = e.code; }
  ok(threw === 'bad_input', 'missing deploymentId throws bad_input');

  // --- typed errors + token redaction
  {
    const f = mockFetch([
      { when: (u) => u.includes('/deployments/d1/rollback'), status: 403, body: { message: 'token abc123secret rejected' } }
    ]);
    let err = null;
    try {
      await env.rollbackDeployment('cloudflare', { apiToken: 'abc123secret', accountId: 'a', projectName: 'p' }, 'p', 'd1', { fetch: f });
    } catch (e) { err = e; }
    ok(err && err.code === 'http_error' && err.status === 403, '403 → http_error with status');
    ok(err && err.message.indexOf('abc123secret') === -1 && err.message.indexOf('[redacted]') > -1, 'token redacted from error message');
  }
  {
    const f = mockFetch([
      { when: (u) => u.includes('/deployments/d1/rollback'), body: { success: false, errors: [{ message: 'deployment not found' }] } }
    ]);
    let err = null;
    try {
      await env.rollbackDeployment('cloudflare', { apiToken: 'cf-secret-xyz', accountId: 'a', projectName: 'p' }, 'p', 'd1', { fetch: f });
    } catch (e) { err = e; }
    ok(err && err.code === 'provider_error' && err.message.indexOf('deployment not found') > -1, 'CF success:false → provider_error');
  }
  {
    const f = mockFetch([]);
    let err = null;
    try { await env.listDeployments('netlify', {}, 'x', { fetch: f }); } catch (e) { err = e; }
    ok(err && err.code === 'missing_credential', 'Netlify missing token → missing_credential');
    err = null;
    try { await env.listDeployments('cloudflare', { apiToken: 't' }, '', { fetch: f }); } catch (e) { err = e; }
    ok(err && err.code === 'missing_credential', 'Cloudflare incomplete creds → missing_credential');
    err = null;
    const savedFetch = globalThis.fetch;
    try {
      globalThis.fetch = undefined;
      try { await env.listDeployments('cloudflare', { apiToken: 't', accountId: 'a', projectName: 'p' }, 'p', {}); } catch (e) { err = e; }
    } finally { globalThis.fetch = savedFetch; }
    ok(err && err.code === 'no_fetch', 'missing fetch → no_fetch');
  }

  // ============================================================
  console.log('\n' + (total - fails) + '/' + total + ' checks passed' + (fails ? ' — ' + fails + ' FAILED' : ' — ALL PASS'));
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('\nCRASH', e);
  process.exit(1);
});

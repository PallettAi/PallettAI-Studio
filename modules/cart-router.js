'use strict';
// ============================================================
// PallettAI Studio — zero-backend cart & checkout router
// Static exports get a working cart and real checkout hand-offs
// with no server: state lives in web storage, money maths is
// shared between module and script, and payment providers are
// reached through the mechanisms they actually publish.
// ------------------------------------------------------------
//   1. generateCartDrawerScript(config) — an inline script
//      under 2KB (2048 bytes) driving a slide-out cart:
//      add/increment/decrement/remove, subtotal + promo
//      discount + total, badge count, and persistence in
//      localStorage (or sessionStorage when configured).
//      ONE delegated click listener handles every control, so
//      re-rendered rows need no per-item closures. Inject the
//      script after the drawer markup (render() reads the DOM
//      immediately).
//   2. cartDrawerHTML(config) — the slide-out drawer markup
//      whose ids come from the SAME drawerConfig() the script
//      uses, so the two halves cannot drift apart.
//   3. generateCheckoutRedirect(provider, items, config):
//        stripe       → {kind:'redirect'} a Payment Link (or a
//                       pre-built client checkout session URL)
//        paypal       → {kind:'script'} Smart Payment Buttons
//                       SDK snippet + render container
//        snipcart     → {kind:'attributes'} data-item-id /
//                       data-item-price / data-item-url attrs
//        lemonsqueezy → {kind:'attributes'} ls-add-to-cart +
//                       the same data-item-* attribute set
//
// ---- what this file guarantees ----------------------------------
// 1. MONEY NEVER GOES NEGATIVE. Discounts clamp to the
//    subtotal, quantities clamp to 1..99, and every figure is
//    rounded to whole cents at the print boundary (M()), so the
//    visible ledger and cartTotals() agree to the cent.
// 2. ONE CONFIG SOURCE. drawerConfig() emits short keys the
//    generated script reads verbatim; drawerIds()/cartDrawerHTML
//    derive every element id from the same object.
// 3. HOSTILE STORAGE IS INERT. parse() only accepts arrays;
//    non-objects fall back to 0 at use sites; promo lookup goes
//    through a "#"-prefixed key so Object.prototype members
//    (e.g. "constructor") can never validate a promo; product
//    names reach innerHTML only through E().
// 4. CHECKOUT BUILDERS VALIDATE UP FRONT: unknown providers,
//    empty carts and missing Payment Links throw typed errors
//    here instead of dead-linking a visitor.
// ============================================================

// ---- shared helpers ----------------------------------------------------

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PROVIDERS = {
  stripe: 'stripe', paypal: 'paypal', snipcart: 'snipcart',
  lemonsqueezy: 'lemonsqueezy', lemon: 'lemonsqueezy'
};

const MIN_QTY = 1;
const MAX_QTY = 99;

const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtMoney = (n, currency) => String(currency == null ? '$' : currency) + cents(n).toFixed(2);

function adjustQty(qty, delta, min, max) {
  const lo = Number.isFinite(min) ? min : MIN_QTY;
  const hi = Number.isFinite(max) ? max : MAX_QTY;
  const next = (Number.isFinite(qty) ? qty : lo) + (Number(delta) || 0);
  return Math.max(lo, Math.min(hi, Math.round(next)));
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  items.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const id = String(raw.id == null ? raw.i : raw.id);
    const price = Number(raw.price == null ? raw.p : raw.price);
    if (!id || !Number.isFinite(price) || price < 0) return; // drop poison rows
    const qty = Number(raw.qty == null ? raw.q : raw.qty);
    out.push({
      i: id,
      n: String(raw.name == null ? raw.n : raw.name || id),
      p: cents(price),
      q: Number.isFinite(qty) ? Math.max(MIN_QTY, Math.min(MAX_QTY, Math.round(qty))) : MIN_QTY
    });
  });
  return out;
}

/** Parse a stored cart payload; anything malformed becomes []. */
function parseCart(raw) {
  if (raw == null || raw === '') return [];
  try {
    return normalizeItems(JSON.parse(raw));
  } catch (e) {
    return [];
  }
}

function cartSubtotal(items) {
  return cents(normalizeItems(items).reduce((sum, it) => sum + it.p * it.q, 0));
}

/**
 * Promo discount against a subtotal.
 * promos = { CODE: {percent: 10} | {amount: 5} }
 * Returns {ok, discount} — discount always in [0, subtotal].
 */
function promoDiscount(subtotal, code, promos) {
  const sub = Math.max(0, cents(subtotal));
  const rule = code && promos && typeof promos === 'object' ? promos[String(code).toUpperCase()] : null;
  if (!rule) return { ok: false, discount: 0 };
  let d = Number(rule.percent) ? sub * (Number(rule.percent) / 100) : Number(rule.amount) || 0;
  d = Math.max(0, Math.min(sub, cents(d)));
  return { ok: true, discount: d };
}

/** The full ledger the drawer renders: subtotal, discount, total. */
function cartTotals(items, code, promos) {
  const subtotal = cartSubtotal(items);
  const promo = promoDiscount(subtotal, code, promos);
  return {
    subtotal,
    discount: promo.discount,
    total: Math.max(0, cents(subtotal - promo.discount)),
    promoApplied: promo.ok,
    count: normalizeItems(items).reduce((n, it) => n + it.q, 0)
  };
}

/**
 * The ONE config object shared by generateCartDrawerScript and
 * cartDrawerHTML. Short keys keep the generated script inside
 * its 2KB budget; promo rules are serialized as "#"+CODE →
 * percent (positive) or amount (negative) so a single expression
 * in tot() serves both and prototype keys can never match.
 */
function drawerConfig(config) {
  const c = config || {};
  const key = String(c.storageKey || 'pai_cart').replace(/[^\w:.-]/g, '') || 'pai_cart';
  const promos = {};
  const rawPromos = c.promos && typeof c.promos === 'object' ? c.promos : {};
  Object.keys(rawPromos).forEach((code) => {
    const k = String(code).toUpperCase().replace(/[^\w-]/g, '');
    const r = rawPromos[code] || {};
    if (!k) return;
    if (Number(r.percent)) promos['#' + k] = Math.max(1, Math.min(100, Number(r.percent)));
    else if (Number(r.amount)) promos['#' + k] = -Math.max(0, Number(r.amount));
  });
  const out = {
    k: key,
    u: String(c.currency == null ? '$' : c.currency),
    d: String(c.drawerId || key + '-drawer').replace(/[^\w-]/g, '') || 'pai_cart-drawer',
    P: promos,
    e: String(c.emptyMessage || 'Cart is empty'),
    m: String(c.promoErrorMessage || 'Invalid code')
  };
  if (c.storage === 'session') out.s = 1; // omitted when false: default cfg stays lean
  return out;
}

// ---- 1. the drawer script ---------------------------------------------

/**
 * generateCartDrawerScript(config) → inline JS, budget < 2KB (2048 B).
 *
 * Controls are data-attributes on the page:
 *   [data-cart-act="open|close|add|inc|dec|rm|promo"]
 *   add → carries data-item-id / data-item-name / data-item-price
 *   inc/dec/rm → resolve the id from the closest [data-item-id]
 *   (their row, or the add button itself)
 * Promo input id: {storageKey}-code. Markup from cartDrawerHTML()
 * provides the list/totals/badge ids this script fills.
 *
 * Structure: render() accumulates count and subtotal in ONE pass
 * over the rows; money rounds only at print (M) — toFixed does
 * the cent-rounding, so display equals cartTotals() output.
 */
function generateCartDrawerScript(config) {
  const c = drawerConfig(config);
  // Sanitize for inlining in a <script> tag: absent sequences cost
  // zero bytes in the output, so the budget only sees real config.
  const json = JSON.stringify(c)
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return '(function(){'
    + 'var c=' + json + ',S=c.s?sessionStorage:localStorage,H=document.body;'
    + 'function G(k){return document.getElementById(c.k+k)}'
    + 'function T(k,v){G(k).textContent=v}'
    // The ONLY innerHTML escape path — names/ids reach markup through it.
    + 'function E(s){return(""+s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;")}'
    + 'function M(v){return c.u+v.toFixed(2)}'
    // The 1..99 clamp, shared by the row render and the qty controls.
    + 'function Q(x){return Math.max(1,Math.min(99,Math.round(x||1)))}'
    // Structural guard only (array check); values are guarded at use sites.
    + 'function parse(r){try{r=JSON.parse(r);return Array.isArray(r)?r:[]}catch(e){return[]}}'
    + 'function save(a){S.setItem(c.k,JSON.stringify(a));render()}'
    + 'function render(){var a=parse(S.getItem(c.k)),L=G("-list"),q=0,s=0,h="",i,x,j;'
      + 'for(i=0;i<a.length;i++){x=a[i]||0;q+=j=Q(x.q);s+=(x.p>0?x.p:0)*j;'
      + 'h+=\'<li data-item-id="\'+E(x.i)+\'"><b>\'+E(x.n||x.i)+\'</b><b><button data-cart-act=inc>+</button>\''
      + '+j+\'<button data-cart-act=dec>\u2212</button><button data-cart-act=rm>\u00d7</button></b><b>\'+M((+x.p||0)*j)+\'</b></li>\'}'
      + 'L.innerHTML=h||"<li class=cart-empty>"+E(c.e)+"</li>";'
      + 'var r=c.P["#"+S.getItem(c.k+":p")],d=r?(r>0?s*r/100:Math.min(-r,s)):0,D=G("-disc");'
      + 'T("-count",q||"");T("-sub",M(s));T("-tot",M(s-d));'
      + 'D.textContent=d?"\u2212"+M(d):"",D.parentNode.hidden=!d}'
    // ONE delegated listener drives every control, current and future.
    + 'document.addEventListener("click",function(e){'
      + 'if(!(b=e.target.closest("[data-cart-act]")))return;var b,d=b.dataset,a=d.cartAct,A,j,w,p,i;'
      + 'if(a==="open"||a==="close")H.classList[a==="open"?"add":"remove"](c.d+"-open");'
      + 'if(a==="promo"){var R=G("-perr"),f=G("-code"),v=(f&&f.value||"").trim().toUpperCase();'
        + 'if(c.P["#"+v]){S.setItem(c.k+":p",v);render();R&&(R.hidden=1)}'
        + 'else if(R)R.textContent=c.m,R.hidden=0}'
      + 'if(/^(inc|dec|add|rm)$/.test(a)){'
        + 'if(!(w=b.closest("[data-item-id]")))return;i=w.dataset.itemId;'
        + 'A=parse(S.getItem(c.k));for(j=0;j<A.length&&!(A[j]&&A[j].i===i);j++);'
        + 'if(a==="rm"){j<A.length&&A.splice(j,1);save(A)}'          + 'else{if(j<A.length)A[j].q=Q(+A[j].q+(a==="dec"?-1:1));'
          + 'else{if(a!=="add")return;p=parseFloat(d.itemPrice);if(!(p>=0&&p<1/0))return;'
          + 'A.push({i:i,n:d.itemName||i,p:p,q:1})}'
          + 'save(A)}}});'
    + 'render()})();';
}

// ---- 2. drawer markup --------------------------------------------------

/** Ids the script fills — one source (drawerConfig) for both halves. */
function drawerIds(config) {
  const c = drawerConfig(config);
  return {
    cfg: c,
    list: c.k + '-list',
    count: c.k + '-count',
    sub: c.k + '-sub',
    disc: c.k + '-disc',
    tot: c.k + '-tot',
    code: c.k + '-code',
    perr: c.k + '-perr'
  };
}

/**
 * cartDrawerHTML(config) → the slide-out drawer fragment.
 * Quantity/remove buttons carry the data-cart-act attributes the
 * script delegates on; ids match drawerIds(). The discount VALUE
 * element carries the -disc id (the script writes into it and
 * toggles its row), so the row's label survives every update.
 */
function cartDrawerHTML(config) {
  const ids = drawerIds(config);
  const c = ids.cfg;
  const btn = (act, label, extra) => '<button type="button" class="cart-b"'
    + ' data-cart-act="' + act + '"' + (extra || '') + '>' + esc(label) + '</button>';
  return '<aside class="pai-cart" id="' + c.d + '" aria-label="Shopping cart">'
    + '<div class="cart-head"><h2>Your cart</h2>'
    + '<span class="cart-badge" id="' + ids.count + '" aria-live="polite"></span>'
    + btn('close', '\u00d7', ' aria-label="Close cart"') + '</div>'
    + '<ul class="cart-list" id="' + ids.list + '"></ul>'
    + '<div class="cart-foot">'
    + '<div class="cart-row"><span>Subtotal</span><b id="' + ids.sub + '">$0.00</b></div>'
    + '<div class="cart-row cart-disc" hidden><span>Discount</span><b id="' + ids.disc + '"></b></div>'
    + '<div class="cart-row cart-row--total"><span>Total</span><b id="' + ids.tot + '">$0.00</b></div>'
    + '<div class="cart-promo">'
    + '<label for="' + ids.code + '">Promo code</label>'
    + '<input id="' + ids.code + '" type="text" autocomplete="off" spellcheck="false">'
    + btn('promo', 'Apply')
    + '</div>'
    + '<p class="cart-perr" id="' + ids.perr + '" role="alert" hidden></p>'
    + btn('close', 'Close', ' class="cart-b cart-close"')
    + '</div></aside>';
}

// ---- 3. checkout redirects --------------------------------------------

function normalizeCheckoutItems(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    const e = new Error('checkout requires at least one item');
    e.code = 'bad_input';
    throw e;
  }
  return list.map((raw, idx) => {
    const it = raw && typeof raw === 'object' ? raw : {};
    const price = Number(it.price == null ? it.p : it.price);
    const id = String(it.id == null ? it.i : it.id || '');
    if (!id) {
      const e = new Error('item #' + idx + ' is missing an id');
      e.code = 'bad_input';
      throw e;
    }
    if (!Number.isFinite(price) || price < 0) {
      const e = new Error('item "' + id + '" needs a non-negative numeric price');
      e.code = 'bad_input';
      throw e;
    }
    return {
      id,
      name: String(it.name == null ? it.n : it.name || id),
      price: cents(price),
      qty: Math.max(MIN_QTY, Math.min(MAX_QTY, Math.round(Number(it.qty == null ? it.q : it.qty) || MIN_QTY))),
      url: String(it.url || it.u || ''),
      paymentLink: String(it.paymentLink || it.stripeLink || '')
    };
  });
}

function appendQuery(url, key, value) {
  return url + (url.indexOf('?') === -1 ? '?' : '&') + encodeURIComponent(key) + '=' + encodeURIComponent(value);
}

/** Attribute set per provider — exported so tests pin the exact keys. */
function dataAttributes(provider, item, config) {
  const p = PROVIDERS[String(provider || '').toLowerCase().trim()];
  const c = config || {};
  const it = item && typeof item === 'object' ? item : {};
  if (p === 'snipcart') {
    const attrs = {
      'data-item-id': String(it.id || ''),
      'data-item-name': String(it.name || it.id || ''),
      'data-item-price': String(Number(it.price) || 0)
    };
    const url = String(it.url || c.siteUrl || '');
    if (url) attrs['data-item-url'] = url;
    if (Number(it.qty) > 1) attrs['data-item-quantity'] = String(Math.round(Number(it.qty)));
    return attrs;
  }
  if (p === 'lemonsqueezy') {
    const attrs = { 'ls-add-to-cart': String(it.id || '') };
    attrs['data-item-id'] = String(it.id || '');
    attrs['data-item-name'] = String(it.name || it.id || '');
    attrs['data-item-price'] = String(Number(it.price) || 0);
    const url = String(it.url || c.siteUrl || '');
    if (url) attrs['data-item-url'] = url;
    return attrs;
  }
  const e = new Error('dataAttributes supports snipcart and lemonsqueezy (got "' + String(provider) + '")');
  e.code = 'unknown_provider';
  throw e;
}

/**
 * generateCheckoutRedirect(provider, items, config) → result
 *
 * stripe:       {kind:'redirect', url}   Payment Link per item
 *               (item.paymentLink) or one config.paymentLink;
 *               config.checkoutUrl (a created client Checkout
 *               session) wins when present. config.email is
 *               appended as prefilled_email.
 * paypal:       {kind:'script', html}    Smart Payment Buttons
 *               SDK snippet + container rendering the total.
 * snipcart /
 * lemonsqueezy: {kind:'attributes', attributes[], html}
 */
function generateCheckoutRedirect(provider, items, config) {
  const p = PROVIDERS[String(provider || '').toLowerCase().trim()];
  if (!p) {
    const e = new Error('Unknown checkout provider "' + String(provider)
      + '". Use stripe, paypal, snipcart, or lemonsqueezy.');
    e.code = 'unknown_provider';
    throw e;
  }
  const c = config || {};
  const list = normalizeCheckoutItems(items);
  const total = cents(list.reduce((s, it) => s + it.price * it.qty, 0));
  const currency = String(c.currency == null ? 'USD' : c.currency).toUpperCase().replace(/[^A-Z]/g, '') || 'USD';

  if (p === 'stripe') {
    // A pre-created client Checkout session URL is the most direct
    // route; otherwise the first item's Payment Link (Payment Links
    // are one-URL-per-product by design).
    const url = String(c.checkoutUrl || list[0].paymentLink || c.paymentLink || '');
    if (!url) {
      const e = new Error('stripe requires config.checkoutUrl or a paymentLink on the first item');
      e.code = 'missing_credential';
      throw e;
    }
    if (!/^https?:\/\//i.test(url)) {
      const e = new Error('stripe URL must be http(s)');
      e.code = 'bad_input';
      throw e;
    }
    return {
      provider: 'stripe',
      kind: 'redirect',
      url: c.email ? appendQuery(url, 'prefilled_email', c.email) : url,
      items: list.map((it) => ({ id: it.id, price: it.price, qty: it.qty })),
      total
    };
  }

  if (p === 'paypal') {
    const clientId = String(c.clientId || c.paypalClientId || '');
    if (!clientId) {
      const e = new Error('paypal requires config.clientId (from the PayPal developer dashboard)');
      e.code = 'missing_credential';
      throw e;
    }
    const containerId = String(c.containerId || 'paypal-buttons').replace(/[^\w-]/g, '') || 'paypal-buttons';
    const html = '<div id="' + containerId + '"></div>'
      + '<script src="https://www.paypal.com/sdk/js?client-id=' + encodeURIComponent(clientId)
      + '&currency=' + currency + '"><\/script>'
      + '<script>'
      + 'paypal.Buttons({createOrder:function(){return actions.order.create({'
      + 'purchase_units:[{amount:{value:' + (Math.round(total * 100) / 100).toFixed(2)
      + ',currency_code:' + JSON.stringify(currency) + '}}]})},'
      + 'onApprove:function(){return actions.order.capture().then(function(){'
      + (c.thanksUrl ? 'location=' + JSON.stringify(String(c.thanksUrl)) + ';' : '')
      + '})}}).render(' + JSON.stringify('#' + containerId) + ');'
      + '<\/script>';
    return { provider: 'paypal', kind: 'script', html, containerId, total };
  }

  // snipcart / lemonsqueezy → the attribute set itself.
  const attributes = list.map((it) => dataAttributes(p, it, c));
  const missingUrl = attributes.filter((a) => !a['data-item-url']);
  if (missingUrl.length && !c.siteUrl) {
    const e = new Error(p + ' needs item.url or config.siteUrl — data-item-url must point at the product page');
    e.code = 'bad_input';
    throw e;
  }
  const html = list.map((it) => {
    const attrs = dataAttributes(p, it, c);
    const cls = p === 'snipcart' ? ' class="snipcart-add-item"' : '';
    const body = Object.keys(attrs)
      .map((k) => ' ' + k + '="' + esc(attrs[k]) + '"').join('');
    const href = p === 'lemonsqueezy' ? ' href="' + esc(it.url || c.siteUrl || '#') + '"' : ' href="#"';
    return '<a' + href + cls + body + '>' + esc(it.name) + '</a>';
  }).join('');
  return { provider: p, kind: 'attributes', attributes, html, total };
}

module.exports = {
  esc,
  PROVIDERS,
  MIN_QTY,
  MAX_QTY,
  adjustQty,
  normalizeItems,
  parseCart,
  cartSubtotal,
  promoDiscount,
  cartTotals,
  fmtMoney,
  drawerConfig,
  drawerIds,
  generateCartDrawerScript,
  cartDrawerHTML,
  dataAttributes,
  generateCheckoutRedirect
};

'use strict';
// ============================================================
// PallettAI Studio — interactive client-side widgets
// Zero-backend UI components that match an export's Design DNA.
// ------------------------------------------------------------
// Three generators, all returning a self-contained HTML fragment
// (<style> + markup + <script>) that drops into any exported page:
//
//   1. generateROICalculator(config) — range sliders + numeric inputs
//      feeding small formula math, with a live inline-SVG gauge and
//      result rows that update on every input event.
//   2. generatePricingSlider(tiers) — multi-tier cards with a
//      monthly/annual toggle (role="switch") that rewrites price
//      numbers, savings badges and per-period feature lists in place.
//   3. generateTestimonialCarousel(items) — swipeable quote cards
//      with touch gestures (touchstart/move/end), prev/next buttons,
//      dots and keyboard arrows. No external JS libraries.
//
// ---- what this file guarantees ----------------------------------
// 1. EVERY USER-SUPPLIED STRING IS ESCAPED at the point it enters
//    markup, and formulas are whitelisted to numbers, identifiers and
//    arithmetic operators before they are ever evaluated — there is no
//    eval() of raw config anywhere in a generated page.
// 2. WIDGETS DEGRADE WITHOUT JS: prices, features and gauge markup all
//    ship with their monthly/static values rendered server-side, so a
//    scriptless visitor still sees a complete price table.
// 3. ALL MOTION PASSES THROUGH Motion.wrapReducedMotion, so keyframe
//    animation is neutralised under prefers-reduced-motion:reduce and
//    the toggle/carousel remain fully operable (instant, not animated).
// 4. FRAGMENTS ARE SELF-CONTAINED: scoped class prefixes (pai-roi,
//    pai-price, pai-quote) plus per-widget <style> — no dependency on
//    the host page's stylesheet, no collision with the Design DNA's
//    own classes. Design tokens are read via var(--…, fallback) so the
//    widget inherits the site palette when one exists.
//
// Pure string generators: no network, no storage, no DOM access here.
// ============================================================

const Motion = require('./motion.js');

const esc = Motion.esc;

// ============================================================
// Shared helpers
// ============================================================

// Unique fragment ids: caller id, sanitised, with a per-call suffix so
// two widgets on one page never fight over getElementById.
function fragId(prefix, given, salt) {
  const base = String(given || '').replace(/[^\w-]/g, '').slice(0, 40);
  return (base || prefix) + '-' + salt;
}

let saltCounter = 0;
function salt() {
  saltCounter = (saltCounter + 1) % 1e6;
  return saltCounter.toString(36);
}

// Formula whitelist: numbers, bare identifiers, arithmetic. Rejected
// before evaluation so a hostile formula can never reach a parser.
//   allowed: 0-9 A-Z _ . + - * / % ( ) , space
//   rejected: quotes, brackets, semicolons, dots-on-identifiers (a.b)
const FORMULA_OK = /^[0-9A-Za-z_\s+\-*/%(),]+$/;
const FORMULA_SUSPECT = /[^\s0-9A-Za-z_+\-*/%(),]/;
// `a.b` member access is arithmetic-hostile (window.location…): the
// only dot allowed is inside a numeric literal like .5 or 3.14.
const MEMBER_ACCESS = /[A-Za-z_]\s*\.\s*[A-Za-z_]/;
// `name(` is a call expression — ROI math is arithmetic over input
// keys, it never needs one, and every sandbox escape (`alert(1)`,
// `Function('…')`) arrives this way.
const CALL_EXPRESSION = /[A-Za-z_][A-Za-z0-9_]*\s*\(/;

function safeFormula(expr) {
  const src = String(expr == null ? '' : expr).trim();
  if (!src) return null;
  if (src.length > 200) throw new Error('formula too long');
  if (!FORMULA_OK.test(src) || FORMULA_SUSPECT.test(src)
    || MEMBER_ACCESS.test(src) || CALL_EXPRESSION.test(src)) {
    throw new Error('unsafe formula rejected: ' + src.slice(0, 60));
  }
  return src;
}

// Compile a whitelisted formula into a function of named variables.
// The Function constructor only ever receives validated arithmetic —
// quotes/brackets/semicolons never survive safeFormula().
function compileFormula(expr, varNames) {
  const src = safeFormula(expr);
  if (!src) return () => 0;
  const names = Array.isArray(varNames) ? varNames.slice() : [];
  names.forEach((n) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new Error('bad variable name: ' + n);
  });
  // Every identifier in the formula must be a declared input key —
  // anything else would throw a ReferenceError in the visitor's
  // browser at first paint instead of failing loudly here.
  const declared = new Set(names);
  const known = new Set(['true', 'false', 'Infinity', 'NaN', 'undefined']);
  (src.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).forEach((ident) => {
    if (!declared.has(ident) && !known.has(ident)) {
      throw new Error('unknown variable in formula: ' + ident);
    }
  });
  let fn;
  try {
    fn = Function.apply(null, names.concat('return (' + src + ');'));
  } catch (e) {
    throw new Error('formula does not parse: ' + src.slice(0, 60));
  }
  return (vars) => {
    const out = fn.apply(null, names.map((n) => Number(vars[n]) || 0));
    return Number.isFinite(out) ? out : 0;
  };
}

const fmtNumber = (n) => {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US');
};

// ============================================================
// Task 2.1 — ROI calculator
// ============================================================
//
// config = {
//   id?, title?, currency? ('$'|'£'|'€'|''),
//   inputs: [{ key, label, min, max, step, value, prefix?, suffix? }],
//   outputs: [{ key, label, formula, format?: 'money'|'number'|'percent', gauge?: true }]
// }
//
// The gauge is one inline SVG (dial + needle) rotated by the first
// gauge output's percent-of-max — no canvas, no images.
function generateROICalculator(config) {
  const cfg = config || {};
  const s = salt();
  const id = fragId('pai-roi', cfg.id, s);
  const currency = esc(cfg.currency == null ? '$' : cfg.currency);
  const title = cfg.title ? '<h3 class="pai-roi-title">' + esc(cfg.title) + '</h3>' : '';

  const inputs = (Array.isArray(cfg.inputs) ? cfg.inputs : []).filter((i) => i && i.key);
  const outputs = (Array.isArray(cfg.outputs) ? cfg.outputs : []).filter((o) => o && o.key);
  if (!inputs.length || !outputs.length) {
    return { html: '', css: '', js: '' };
  }

  // ---- compile everything up front so a bad config throws HERE,
  // in Node, rather than in a visitor's browser -------------------
  const inputKeys = inputs.map((i) => String(i.key));
  inputs.forEach((i, idx) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(i.key))) throw new Error('bad input key at #' + idx);
  });
  const compiled = outputs.map((o) => ({
    def: o,
    fn: compileFormula(o.formula, inputKeys)
  }));

  // ---- server-side initial render (JS-off completeness) ---------
  const initialValues = {};
  inputs.forEach((i) => {
    const v = Number(i.value);
    initialValues[i.key] = Number.isFinite(v) ? v : (Number(i.min) || 0);
  });
  const computeAll = (vars) => {
    const res = {};
    compiled.forEach(({ def, fn }) => { res[def.key] = fn(vars); });
    return res;
  };
  const fmtOut = (def, v) => {
    const format = def.format || 'number';
    if (format === 'money') return currency + fmtNumber(v);
    if (format === 'percent') return fmtNumber(v) + '%';
    return fmtNumber(v);
  };
  const initial = computeAll(initialValues);

  // ---- markup ---------------------------------------------------
  const gaugeOut = compiled.find((c) => c.def.gauge) || compiled[0];
  const gaugeMax = Math.max(1, Number(gaugeOut.def.gaugeMax) || Math.max(initial[gaugeOut.def.key] * 1.5, 100));
  const gaugePct = Math.max(0, Math.min(100, (initial[gaugeOut.def.key] / gaugeMax) * 100));

  const inputRows = inputs.map((i) => {
    const iid = id + '-' + i.key;
    const min = Number(i.min) || 0;
    const max = Number(i.max) || 100;
    const step = Number(i.step) || 1;
    const val = initialValues[i.key];
    return '<div class="pai-roi-field">'
      + '<label class="pai-roi-label" for="' + iid + '">' + esc(i.label || i.key) + '</label>'
      + '<div class="pai-roi-ctl">'
      + '<input class="pai-roi-range" type="range" id="' + iid + '"'
      + ' data-roi-key="' + esc(i.key) + '"'
      + ' min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '">'
      + '<output class="pai-roi-val" data-roi-out="' + esc(i.key) + '" for="' + iid + '">'
      + esc(i.prefix || '') + fmtNumber(val) + esc(i.suffix || '')
      + '</output>'
      + '</div></div>';
  }).join('');

  const outputRows = compiled.map(({ def }) => {
    const fmt = fmtOut(def, initial[def.key]);
    return '<div class="pai-roi-metric">'
      + '<span class="pai-roi-metric-label">' + esc(def.label || def.key) + '</span>'
      + '<strong class="pai-roi-metric-value" data-roi-metric="' + esc(def.key) + '" aria-live="polite">' + fmt + '</strong>'
      + '</div>';
  }).join('');

  // inline SVG dial: arc track, value arc, needle. All strokes use
  // currentColor so it inherits the palette with zero extra tokens.
  const gaugeSvg = '<svg class="pai-roi-gauge" viewBox="0 0 120 70" role="img"'
    + ' aria-label="' + esc(gaugeOut.def.label || gaugeOut.def.key) + ' gauge">'
    + '<path class="pai-roi-gauge-track" d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke-width="10" stroke-linecap="round"/>'
    + '<path class="pai-roi-gauge-fill" data-roi-arc d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke-width="10" stroke-linecap="round"'
    + ' stroke-dasharray="157" stroke-dashoffset="' + (157 - (157 * gaugePct) / 100).toFixed(1) + '"/>'
    + '<text data-roi-arc-label x="60" y="56" text-anchor="middle" font-size="16" font-weight="700" fill="currentColor">'
    + esc(fmtOut(gaugeOut.def, initial[gaugeOut.def.key]))
    + '</text></svg>';

  const html = '<div class="pai-roi" id="' + id + '">'
    + title
    + '<div class="pai-roi-body">'
    + '<div class="pai-roi-controls">' + inputRows + '</div>'
    + '<div class="pai-roi-panel">' + gaugeSvg
    + '<div class="pai-roi-metrics">' + outputRows + '</div>'
    + '</div></div></div>';

  // ---- stylesheet ----------------------------------------------
  const css = [
    '.pai-roi{--pai-gap:1rem;display:grid;gap:1.4rem;padding:1.4rem;border:1px solid var(--line,rgba(127,127,127,.22));border-radius:var(--radius,16px);background:var(--surface,rgba(127,127,127,.04));color:var(--text,inherit);font:inherit}',
    '.pai-roi-title{margin:0 0 .3rem;font-size:1.1rem;letter-spacing:-.02em}',
    '.pai-roi-body{display:grid;gap:1.4rem;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}',
    '.pai-roi-field{display:grid;gap:.35rem;margin-bottom:.9rem}',
    '.pai-roi-label{font-size:.8rem;font-weight:650;color:var(--muted,#5f6b7a)}',
    '.pai-roi-ctl{display:flex;align-items:center;gap:.7rem}',
    '.pai-roi-range{flex:1 1 auto;min-width:0;accent-color:var(--primary,#5b8cff);height:1.5rem}',
    '.pai-roi-range:focus-visible{outline:2px solid var(--primary,#5b8cff);outline-offset:3px;border-radius:6px}',
    '.pai-roi-val{min-width:5.5rem;text-align:right;font-variant-numeric:tabular-nums;font-weight:700;font-size:.92rem}',
    '.pai-roi-panel{display:grid;gap:.9rem;align-content:start;justify-items:center}',
    '.pai-roi-gauge{width:100%;max-width:230px;color:var(--primary,#5b8cff)}',
    '.pai-roi-gauge-track{stroke:rgba(127,127,127,.25)}',
    '.pai-roi-gauge-fill{transition:stroke-dashoffset .45s cubic-bezier(.2,.7,.2,1)}',
    '.pai-roi-metrics{display:grid;gap:.55rem;width:100%}',
    '.pai-roi-metric{display:flex;align-items:baseline;justify-content:space-between;gap:.6rem;padding:.5rem .7rem;border-radius:10px;background:rgba(127,127,127,.07)}',
    '.pai-roi-metric-label{font-size:.78rem;color:var(--muted,#5f6b7a)}',
    '.pai-roi-metric-value{font-size:1.05rem;font-variant-numeric:tabular-nums;letter-spacing:-.02em}',
    '@media(max-width:640px){.pai-roi-body{grid-template-columns:minmax(0,1fr)}}'
  ].join('\n');
  const reducedCss = Motion.wrapReducedMotion(css, {
    static: '.pai-roi-gauge-fill{transition:none !important}'
  });

  // ---- runtime --------------------------------------------------
  // Formulas are serialized ONCE (already validated by compileFormula
  // at build time) and re-evaluated client-side on input events.
  const formulaPlan = compiled.map(({ def }) => ({
    key: String(def.key),
    formula: safeFormula(def.formula),
    format: def.format || 'number',
    gauge: !!def.gauge,
    gaugeMax: Math.max(1, Number(def.gaugeMax) || Math.max(initial[def.key] * 1.5, 100))
  }));
  const inputPlan = inputs.map((i) => ({
    key: String(i.key),
    prefix: String(i.prefix || ''),
    suffix: String(i.suffix || '')
  }));

  const js = '(function(){'
    + 'var root=document.getElementById(' + JSON.stringify(id) + ');'
    + 'if(!root)return;'
    + 'var INPUTS=' + JSON.stringify(inputPlan) + ';'
    + 'var OUTPUTS=' + JSON.stringify(formulaPlan) + ';'
    + 'var CURRENCY=' + JSON.stringify(cfg.currency == null ? '$' : String(cfg.currency)) + ';'
    + "var ranges=root.querySelectorAll('.pai-roi-range');"
    // Each output's formula compiled from the SAME whitelist the
    // builder validated — quotes/brackets were stripped before here —
    // with every input key bound as a named parameter.
    + 'var INKEYS=INPUTS.map(function(i){return i.key;});'
    + 'var fns=OUTPUTS.map(function(o){'
    + 'return Function.apply(null,INKEYS.concat("return ("+o.formula+");"));'
    + '});'
    + 'function num(n){return Math.round(Number(n)||0).toLocaleString("en-US");}'
    + 'function fmt(o,v){if(o.format==="money")return CURRENCY+num(v);if(o.format==="percent")return num(v)+"%";return num(v);}'
    + 'function readVars(){var v={};INPUTS.forEach(function(i){var el=root.querySelector(\'[data-roi-key="\'+i.key+\'"]\');v[i.key]=el?Number(el.value):0;});return v;}'
    + 'function update(){'
    + 'var vars=readVars();'
    + 'INPUTS.forEach(function(i){var el=root.querySelector(\'[data-roi-key="\'+i.key+\'"]\');'
    + 'var out=root.querySelector(\'[data-roi-out="\'+i.key+\'"]\');'
    + "if(out)out.textContent=i.prefix+num(el?el.value:0)+i.suffix;"
    + '});'
    + 'OUTPUTS.forEach(function(o,idx){'
    + 'var val=fns[idx].apply(null,INKEYS.map(function(k){return vars[k];}));'
    + 'var cell=root.querySelector(\'[data-roi-metric="\'+o.key+\'"]\');'
    + 'if(cell)cell.textContent=fmt(o,val);'
    + 'if(o.gauge){'
    + 'var arc=root.querySelector("[data-roi-arc]");'
    + 'var label=root.querySelector("[data-roi-arc-label]");'
    + 'var pct=Math.max(0,Math.min(100,(val/o.gaugeMax)*100));'
    + 'if(arc)arc.setAttribute("stroke-dashoffset",(157-(157*pct)/100).toFixed(1));'
    + 'if(label)label.textContent=fmt(o,val);'
    + '}'
    + '});'
    + '}'
    + 'Array.prototype.forEach.call(ranges,function(r){r.addEventListener("input",update);});'
    + 'update();'
    + '})();';

  return { html, css: reducedCss, js };
}

// ============================================================
// Task 2.2 — pricing slider with billing toggle
// ============================================================
//
// tiers = [{ name, price (monthly), annual?, features: [], badge? }]
//   annual — price per month when billed annually (defaults to price)
// options = { id?, currency?, monthlyLabel?, annualLabel?, cta? }
//
// Static HTML ships monthly prices and full feature lists; the toggle
// rewrites numbers + savings badges + annual-adjusted features from
// data attributes, so JS-off shows a complete (monthly) table.
function generatePricingSlider(tiers, options) {
  const o = options || {};
  const s = salt();
  const id = fragId('pai-price', o.id, s);
  const list = (Array.isArray(tiers) ? tiers : []).filter(Boolean);
  if (!list.length) return { html: '', css: '', js: '' };

  const currency = esc(o.currency == null ? '$' : o.currency);
  const monthlyLabel = esc(o.monthlyLabel || 'Monthly');
  const annualLabel = esc(o.annualLabel || 'Annual');

  // savings is computed once here (build-time) so the badge text is
  // truthful in the static render too, and again client-side for the
  // annual figure the visitor toggles to.
  const cards = list.map((t, i) => {
    const price = Math.max(0, Number(t.price) || 0);
    const annual = Math.max(0, Number(t.annual) || price);
    const savePct = price > 0 && annual < price ? Math.round(((price - annual) / price) * 100) : 0;
    const features = (Array.isArray(t.features) ? t.features : []).map(String);
    const annualFeatures = (Array.isArray(t.annualFeatures) ? t.annualFeatures : []).map(String);
    const cid = id + '-t-' + i;
    const badge = t.badge ? '<span class="pai-price-badge">' + esc(t.badge) + '</span>' : '';
    const featHtml = (arr, when) => arr.map((f) => '<li data-when="' + when + '">' + esc(f) + '</li>').join('');
    // data-plan carries only numbers + JSON-safe strings (escaped).
    const plan = esc(JSON.stringify({
      price, annual, savePct,
      features, annualFeatures
    }));
    return '<div class="pai-price-card' + (t.badge ? ' is-featured' : '') + '" id="' + cid + '" data-plan="' + plan + '">'
      + '<div class="pai-price-head"><span class="pai-price-name">' + esc(t.name || ('Plan ' + (i + 1))) + '</span>' + badge + '</div>'
      + '<p class="pai-price-amount"><span class="pai-price-cur">' + currency + '</span>'
      + '<span class="pai-price-num" data-price-num>' + fmtNumber(price) + '</span>'
      + '<span class="pai-price-per" data-price-per>/mo</span></p>'
      + '<p class="pai-price-save" data-price-save' + (savePct ? '' : ' hidden') + '>'
      + '<span data-save-text>Save ' + savePct + '%</span></p>'
      + '<ul class="pai-price-feats">'
      + featHtml(features, 'base')
      + featHtml(annualFeatures, 'annual')
      + '</ul>'
      + (t.cta || o.cta
        ? '<a class="pai-price-cta" href="' + esc(t.ctaHref || o.ctaHref || '#') + '">' + esc(t.cta || o.cta) + '</a>'
        : '')
      + '</div>';
  }).join('');

  const anySaving = list.some((t) => {
    const p = Number(t.price) || 0;
    const a = Number(t.annual) || p;
    return p > 0 && a < p;
  });

  const html = '<div class="pai-price" id="' + id + '">'
    + (anySaving
      ? '<div class="pai-price-toggle" role="group" aria-label="Billing period">'
        + '<span class="pai-price-tlabel" data-lbl-monthly>' + monthlyLabel + '</span>'
        + '<button type="button" class="pai-price-switch" role="switch" aria-checked="false"'
        + ' aria-label="Switch to ' + annualLabel.toLowerCase() + ' billing"><span class="pai-price-knob"></span></button>'
        + '<span class="pai-price-tlabel is-off" data-lbl-annual>' + annualLabel + '</span>'
        + '</div>'
      : '')
    + '<div class="pai-price-grid">' + cards + '</div></div>';

  const css = [
    '.pai-price{display:grid;gap:1.3rem;font:inherit;color:var(--text,inherit)}',
    '.pai-price-toggle{display:flex;align-items:center;justify-content:center;gap:.7rem}',
    '.pai-price-tlabel{font-size:.85rem;font-weight:650;color:var(--muted,#5f6b7a);transition:color .2s ease}',
    '.pai-price-tlabel.is-off{opacity:.6}',
    '.pai-price-switch{position:relative;width:52px;height:28px;padding:0;border:0;border-radius:99px;background:rgba(127,127,127,.3);cursor:pointer;transition:background .25s ease}',
    '.pai-price-switch[aria-checked="true"]{background:var(--primary,#5b8cff)}',
    '.pai-price-switch:focus-visible{outline:2px solid var(--primary,#5b8cff);outline-offset:3px}',
    '.pai-price-knob{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:transform .25s cubic-bezier(.2,.7,.2,1)}',
    '.pai-price-switch[aria-checked="true"] .pai-price-knob{transform:translateX(24px)}',
    '.pai-price-grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}',
    '.pai-price-card{position:relative;display:grid;gap:.7rem;align-content:start;padding:1.3rem 1.2rem;border:1px solid var(--line,rgba(127,127,127,.22));border-radius:var(--radius,16px);background:var(--surface,rgba(127,127,127,.04))}',
    '.pai-price-card.is-featured{border-color:var(--primary,#5b8cff);box-shadow:0 12px 34px rgba(0,0,0,.12)}',
    '.pai-price-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem}',
    '.pai-price-name{font-weight:700;font-size:.95rem}',
    '.pai-price-badge{font-size:.66rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:.22em .6em;border-radius:99px;background:var(--primary,#5b8cff);color:#fff}',
    '.pai-price-amount{display:flex;align-items:baseline;gap:.15rem;margin:.1rem 0 0}',
    '.pai-price-cur{font-size:1.1rem;font-weight:700;opacity:.8}',
    '.pai-price-num{font-size:2.3rem;font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums;transition:opacity .18s ease}',
    '.pai-price-num.is-swap{opacity:0}',
    '.pai-price-per{font-size:.8rem;color:var(--muted,#5f6b7a)}',
    '.pai-price-save{margin:0;font-size:.74rem;font-weight:700;color:var(--ok,#12a150)}',
    '.pai-price-save[hidden]{display:none}',
    '.pai-price-feats{list-style:none;margin:.2rem 0 0;padding:0;display:grid;gap:.45rem}',
    '.pai-price-feats li{position:relative;padding-left:1.3rem;font-size:.86rem;color:var(--muted,#5f6b7a)}',
    '.pai-price-feats li:before{content:"\\2713";position:absolute;left:0;color:var(--primary,#5b8cff);font-weight:800}',
    '.pai-price-feats li[data-when="annual"]{display:none}',
    '.pai-price.is-annual .pai-price-feats li[data-when="annual"]{display:list-item}',
    '.pai-price-cta{display:block;margin-top:.4rem;padding:.65rem 1rem;text-align:center;border-radius:10px;background:var(--primary,#5b8cff);color:#fff;font-weight:700;font-size:.9rem;text-decoration:none;transition:filter .2s ease,transform .2s ease}',
    '.pai-price-cta:hover{filter:brightness(1.08);transform:translateY(-1px)}',
    '.pai-price-cta:focus-visible{outline:2px solid var(--primary,#5b8cff);outline-offset:3px}'
  ].join('\n');
  const reducedCss = Motion.wrapReducedMotion(css, {
    static: '.pai-price-switch,.pai-price-knob,.pai-price-num,.pai-price-cta,.pai-price-tlabel{transition:none !important}\n'
      + '.pai-price-cta:hover{transform:none !important}'
  });

  const js = '(function(){'
    + 'var root=document.getElementById(' + JSON.stringify(id) + ');'
    + 'if(!root)return;'
    + "var sw=root.querySelector('.pai-price-switch');"
    + 'if(!sw)return;'
    + "var cards=root.querySelectorAll('.pai-price-card');"
    + 'function num(n){return Math.round(Number(n)||0).toLocaleString("en-US");}'
    + 'function apply(annual){'
    + "sw.setAttribute('aria-checked',annual?'true':'false');"
    + "root.classList.toggle('is-annual',annual);"
    + "var lm=root.querySelector('[data-lbl-monthly]'),la=root.querySelector('[data-lbl-annual]');"
    + "if(lm)lm.classList.toggle('is-off',annual);"
    + "if(la)la.classList.toggle('is-off',!annual);"
    + 'Array.prototype.forEach.call(cards,function(card){'
    + 'var plan={};try{plan=JSON.parse(card.getAttribute("data-plan")||"{}");}catch(e){return;}'
    + "var n=card.querySelector('[data-price-num]');"
    + "var per=card.querySelector('[data-price-per]');"
    + "var save=card.querySelector('[data-price-save]');"
    + "var txt=card.querySelector('[data-save-text]');"
    + 'if(n){'
    + "n.classList.add('is-swap');"
    + 'var next=annual?plan.annual:plan.price;'
    + 'setTimeout(function(){n.textContent=num(next);n.classList.remove("is-swap");},120);'
    + '}'
    + "if(per)per.textContent=annual?'/mo, billed yearly':'/mo';"
    + 'if(save&&plan.savePct>0){save.hidden=false;if(txt)txt.textContent="Save "+plan.savePct+"%";}'
    + 'else if(save){save.hidden=true;}'
    + '});'
    + '}'
    + "sw.addEventListener('click',function(){"
    + "apply(sw.getAttribute('aria-checked')!=='true');"
    + '});'
    // keyboard: a role="switch" must answer to Space/Enter natively —
    // buttons do — but arrow keys are the convention for switches.
    + "sw.addEventListener('keydown',function(e){"
    + 'if(e.key==="ArrowRight"){apply(true);e.preventDefault();}'
    + 'if(e.key==="ArrowLeft"){apply(false);e.preventDefault();}'
    + '});'
    + 'apply(false);'
    + '})();';

  return { html, css: reducedCss, js };
}

// ============================================================
// Task 2.3 — testimonial carousel with touch gestures
// ============================================================
//
// items = [{ quote, name, role?, stars? }]
// options = { id?, autoplayMs? (0 = off) }
//
// Gesture model: touchstart records the anchor, touchmove tracks
// delta X only after the gesture proves horizontal (|dx| > |dy| and
// > 12px), touchend commits past a 45px threshold. Vertical page
// scroll is never hijacked — the axis test is what keeps native
// scrolling intact on a card the visitor meant to scroll past.
function generateTestimonialCarousel(items, options) {
  const o = options || {};
  const s = salt();
  const id = fragId('pai-quote', o.id, s);
  const list = (Array.isArray(items) ? items : []).filter((it) => it && (it.quote || it.text));
  if (!list.length) return { html: '', css: '', js: '' };

  const starSvg = (n) => {
    const stars = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    if (!stars) return '';
    let out = '<span class="pai-quote-stars" aria-label="' + stars + ' out of 5 stars">';
    for (let i = 0; i < 5; i++) {
      out += '<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" focusable="false"'
        + (i < stars ? ' class="is-on"' : ' class="is-off"') + '>'
        + '<path fill="currentColor" d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9z"/></svg>';
    }
    return out + '</span>';
  };

  const slides = list.map((it, i) => {
    const quote = it.quote || it.text;
    const who = it.name || it.author || '';
    const role = it.role || it.title || '';
    return '<figure class="pai-quote-slide" aria-roledescription="slide"'
      + ' aria-label="' + (i + 1) + ' of ' + list.length + '"' + (i === 0 ? '' : ' aria-hidden="true"')
      + '>'
      + starSvg(it.stars)
      + '<blockquote class="pai-quote-text"><p>' + esc(quote) + '</p></blockquote>'
      + (who || role
        ? '<figcaption class="pai-quote-who">'
          + (who ? '<span class="pai-quote-name">' + esc(who) + '</span>' : '')
          + (role ? '<span class="pai-quote-role">' + esc(role) + '</span>' : '')
          + '</figcaption>'
        : '')
      + '</figure>';
  }).join('');

  const dots = list.map((it, i) =>
    '<button type="button" class="pai-quote-dot' + (i === 0 ? ' is-on' : '') + '"'
    + ' data-goto="' + i + '" aria-label="Go to testimonial ' + (i + 1) + '"'
    + (i === 0 ? ' aria-current="true"' : '') + '></button>').join('');

  const html = '<div class="pai-quote" id="' + id + '" role="region" aria-roledescription="carousel"'
    + ' aria-label="Testimonials" tabindex="0">'
    + '<div class="pai-quote-viewport"><div class="pai-quote-track" data-track>' + slides + '</div></div>'
    + '<div class="pai-quote-nav">'
    + '<button type="button" class="pai-quote-arrow" data-prev aria-label="Previous testimonial">'
    + '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    + '</button>'
    + '<div class="pai-quote-dots">' + dots + '</div>'
    + '<button type="button" class="pai-quote-arrow" data-next aria-label="Next testimonial">'
    + '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    + '</button>'
    + '</div></div>';

  const css = [
    '.pai-quote{position:relative;display:grid;gap:1rem;font:inherit;color:var(--text,inherit)}',
    '.pai-quote:focus-visible{outline:2px solid var(--primary,#5b8cff);outline-offset:4px;border-radius:var(--radius,16px)}',
    '.pai-quote-viewport{overflow:hidden;border-radius:var(--radius,16px)}',
    '.pai-quote-track{display:flex;transition:transform .45s cubic-bezier(.2,.7,.2,1);will-change:transform;touch-action:pan-y}',
    '.pai-quote-slide{flex:0 0 100%;min-width:0;margin:0;padding:1.5rem 1.4rem;border:1px solid var(--line,rgba(127,127,127,.22));border-radius:var(--radius,16px);background:var(--surface,rgba(127,127,127,.04));display:grid;gap:.8rem;align-content:start}',
    '.pai-quote-stars{display:flex;gap:.15rem;color:var(--primary,#5b8cff)}',
    '.pai-quote-stars .is-off{opacity:.3}',
    '.pai-quote-text{margin:0;font-size:1.02rem;line-height:1.6}',
    '.pai-quote-text p{margin:0}',
    '.pai-quote-who{display:grid;gap:.1rem}',
    '.pai-quote-name{font-weight:700;font-size:.9rem}',
    '.pai-quote-role{font-size:.78rem;color:var(--muted,#5f6b7a)}',
    '.pai-quote-nav{display:flex;align-items:center;justify-content:center;gap:.9rem}',
    '.pai-quote-arrow{display:grid;place-items:center;width:38px;height:38px;border:1px solid var(--line,rgba(127,127,127,.3));border-radius:50%;background:transparent;color:inherit;cursor:pointer;transition:border-color .2s ease,background .2s ease}',
    '.pai-quote-arrow:hover{border-color:var(--primary,#5b8cff);background:rgba(127,127,127,.08)}',
    '.pai-quote-arrow:focus-visible{outline:2px solid var(--primary,#5b8cff);outline-offset:3px}',
    '.pai-quote-dots{display:flex;gap:.45rem}',
    '.pai-quote-dot{width:9px;height:9px;padding:0;border:0;border-radius:50%;background:rgba(127,127,127,.4);cursor:pointer;transition:background .2s ease,transform .2s ease}',
    '.pai-quote-dot.is-on{background:var(--primary,#5b8cff);transform:scale(1.25)}',
    '.pai-quote-dot:focus-visible{outline:2px solid var(--primary,#5b8cff);outline-offset:3px}'
  ].join('\n');
  const reducedCss = Motion.wrapReducedMotion(css, {
    static: '.pai-quote-track,.pai-quote-arrow,.pai-quote-dot{transition:none !important}'
  });

  const autoplay = Math.max(0, Number(o.autoplayMs) || 0);
  const js = '(function(){'
    + 'var root=document.getElementById(' + JSON.stringify(id) + ');'
    + 'if(!root)return;'
    + 'var track=root.querySelector("[data-track]");'
    + 'if(!track)return;'
    + 'var slides=track.children;'
    + 'var total=slides.length;'
    + 'var index=0;'
    + 'var dots=root.querySelectorAll("[data-goto]");'
    // Reduced motion: no track transition — jump instead of glide.
    + 'var still=typeof matchMedia==="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches;'
    + 'function go(n){'
    + 'index=((n%total)+total)%total;'
    + 'track.style.transform="translateX("+(-index*100)+"%)";'
    + 'for(var i=0;i<slides.length;i++){'
    + 'if(i===index)slides[i].removeAttribute("aria-hidden");else slides[i].setAttribute("aria-hidden","true");'
    + '}'
    + 'Array.prototype.forEach.call(dots,function(d,k){'
    + "d.classList.toggle('is-on',k===index);"
    + 'if(k===index)d.setAttribute("aria-current","true");else d.removeAttribute("aria-current");'
    + '});'
    + '}'
    // ---- touch gestures ----------------------------------------
    + 'var x0=0,y0=0,dx=0,dy=0,decided=0,active=0;'
    + "track.addEventListener('touchstart',function(e){"
    + 'if(e.touches.length!==1)return;'
    + 'x0=e.touches[0].clientX;y0=e.touches[0].clientY;dx=0;dy=0;decided=0;active=1;'
    + "},{passive:true});"
    + "track.addEventListener('touchmove',function(e){"
    + 'if(!active||e.touches.length!==1)return;'
    + 'dx=e.touches[0].clientX-x0;dy=e.touches[0].clientY-y0;'
    // Axis lock: only claim the gesture once horizontal intent is
    // proven; until then the browser keeps scrolling the page.
    + 'if(!decided){'
    + 'if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){decided=1;}'
    + 'else if(Math.abs(dy)>12){active=0;return;}'
    + '}'
    + 'if(decided&&e.cancelable)e.preventDefault();'
    + "},{passive:false});"
    + "track.addEventListener('touchend',function(){"
    + 'if(!active)return;'
    + 'active=0;'
    + 'if(decided&&Math.abs(dx)>45){go(index+(dx<0?1:-1));}'
    + 'decided=0;'
    + "},{passive:true});"
    // ---- buttons, dots, keyboard --------------------------------
    + "var prev=root.querySelector('[data-prev]'),next=root.querySelector('[data-next]');"
    + "if(prev)prev.addEventListener('click',function(){go(index-1);});"
    + "if(next)next.addEventListener('click',function(){go(index+1);});"
    + 'Array.prototype.forEach.call(dots,function(d){'
    + "d.addEventListener('click',function(){go(Number(d.getAttribute('data-goto'))||0);});"
    + '});'
    + "root.addEventListener('keydown',function(e){"
    + 'if(e.key==="ArrowLeft"){go(index-1);e.preventDefault();}'
    + 'if(e.key==="ArrowRight"){go(index+1);e.preventDefault();}'
    + '});'
    + (autoplay > 0 && !still
      ? 'setInterval(function(){go(index+1);},' + autoplay + ');'
      : '')
    + 'go(0);'
    + '})();';

  return { html, css: reducedCss, js };
}

// ============================================================
// Bundle helper: { html, css, js } → styled + scripted fragment
// ============================================================
function assemble(part) {
  if (!part || !part.html) return '';
  return (part.css ? '<style>' + part.css + '</style>' : '')
    + part.html
    + (part.js ? '<script>' + part.js + '</script>' : '');
}

module.exports = {
  esc,
  generateROICalculator,
  generatePricingSlider,
  generateTestimonialCarousel,
  compileFormula,
  safeFormula,
  assemble
};

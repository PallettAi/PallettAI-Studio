'use strict';
// ============================================================
// PallettAI Studio — advanced FX, tilt & scroll presets
// Zero-dependency micro-interaction scripts for exported sites.
// ------------------------------------------------------------
//   1. generate3DTiltCardsScript()  — subtle perspective tilt on
//      card hover, driven by pointer position.
//   2. generateMagneticButtonsScript() — CTAs that lean toward
//      the cursor and spring back on leave.
//   3. generateScrollProgressBarScript() — a 0.2KB top-of-page
//      reading-progress bar tied to scroll depth.
//
// ---- what this file guarantees ----------------------------------
// 1. TOUCH DEVICES RUN NONE OF IT. Every cursor-driven script
//    bails at runtime on matchMedia('(hover: hover) and (pointer:
//    fine)'), and every stylesheet those effects need is wrapped
//    in the same @media — so a phone never downloads transitions
//    for tilts it can never trigger, and a touch scroll never
//    fights a hijacked pointer handler.
// 2. REDUCED MOTION BAILS TOO. The tilt and magnetic scripts
//    check prefers-reduced-motion before binding; the CSS halves
//    are wrapped to match (wrapHoverCSS keeps both guards).
// 3. JS ONLY WRITES transform. Opacity, transitions and layout
//    stay in CSS, so the two writers cannot fight over a
//    property — the same split motion.js enforces.
// 4. PURE STRING GENERATION — selectors and amplitudes are
//    serialized defensively; nothing here touches a DOM at
//    build time.
// ============================================================

// Shared guard strings — exported so the smoke runner can assert
// every script and stylesheet uses the exact same query.
const HOVER_QUERY = '(hover: hover) and (pointer: fine)';
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';
const HOVER_MEDIA = '@media ' + HOVER_QUERY;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Runtime guards, interpolated into every spatial script.
function hoverGuardJS() {
  return 'if(typeof matchMedia!=="function"||!matchMedia(' + JSON.stringify(HOVER_QUERY) + ').matches)return;';
}
function reduceGuardJS() {
  return 'if(typeof matchMedia==="function"&&matchMedia(' + JSON.stringify(REDUCE_QUERY) + ').matches)return;';
}

function sanitizeSelector(given, fallback) {
  const s = String(given == null ? '' : given).trim();
  // A selector becomes JSON.stringify'd source; only allow the
  // characters a CSS selector may contain so it can never break out.
  if (!s || !/^[\w\s.#[\]="'':>,*+~()!-]+$/.test(s)) return fallback;
  return s.slice(0, 120);
}

function amplitude(given, fallback, lo, hi) {
  const n = Number(given);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

// Wrap a stylesheet so it only ships where a fine pointer exists.
// Idempotent: an already-wrapped sheet returns untouched.
function wrapHoverCSS(css) {
  const src = String(css == null ? '' : css).trim();
  if (!src) return '';
  if (src.indexOf(HOVER_MEDIA) !== -1) return src;
  const body = src.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
  return HOVER_MEDIA + '{\n' + body + '\n}';
}

// ============================================================
// 1) 3D tilt cards
// ============================================================
/**
 * generate3DTiltCardsScript(options?) → JS string.
 * options: { selector = '[data-pai-tilt]', max = 8 (degrees) }
 * Transform only; the CSS half (see tiltCSS) owns the transition.
 */
function generate3DTiltCardsScript(options) {
  const o = options || {};
  const sel = JSON.stringify(sanitizeSelector(o.selector, '[data-pai-tilt]'));
  const max = amplitude(o.max, 8, 1, 30);
  return '(function(){'
    + 'var s=' + sel + ',m=' + max + ';'
    + hoverGuardJS() + reduceGuardJS()
    + 'var els=document.querySelectorAll(s);if(!els.length)return;'
    + 'Array.prototype.forEach.call(els,function(el){'
    // Normalize once so a stray percentage scale stays in degrees.
    + 'el.addEventListener("pointermove",function(e){'
    + 'var r=el.getBoundingClientRect();if(!r.width||!r.height)return;'
    + 'var x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;'
    + 'el.style.transform="perspective(1000px) rotateX("+(-y*m).toFixed(2)'
    + '+"deg) rotateY("+(x*m).toFixed(2)+"deg)";'
    + '});'
    + 'el.addEventListener("pointerleave",function(){el.style.transform="";});'
    + '});'
    + '})();';
}

function tiltCSS(options) {
  const o = options || {};
  const sel = sanitizeSelector(o.selector, '[data-pai-tilt]');
  return wrapHoverCSS(sel + '{'
    + 'transition:transform .18s cubic-bezier(.2,.7,.2,1);'
    + 'will-change:transform;transform-style:preserve-3d}'
    + sel + ':active{transition:transform .08s ease}');
}

// ============================================================
// 2) magnetic buttons
// ============================================================
/**
 * generateMagneticButtonsScript(options?) → JS string.
 * options: { selector = '[data-pai-magnetic]', strength = 0.35,
 *            maxShift = 16 (px clamp at the button centre) }
 */
function generateMagneticButtonsScript(options) {
  const o = options || {};
  const sel = JSON.stringify(sanitizeSelector(o.selector, '[data-pai-magnetic]'));
  const str = amplitude(o.strength, 0.35, 0.05, 1);
  const cap = amplitude(o.maxShift, 16, 2, 64);
  return '(function(){'
    + 'var s=' + sel + ',k=' + str + ',c=' + cap + ';'
    + hoverGuardJS() + reduceGuardJS()
    + 'var els=document.querySelectorAll(s);if(!els.length)return;'
    + 'Array.prototype.forEach.call(els,function(el){'
    + 'el.addEventListener("pointermove",function(e){'
    + 'var r=el.getBoundingClientRect();'
    + 'var dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2);'
    // Clamped so a large CTA can never leap out from under the cursor.
    + 'var tx=Math.max(-c,Math.min(c,dx*k)),ty=Math.max(-c,Math.min(c,dy*k));'
    + 'el.style.transform="translate("+tx.toFixed(1)+"px,"+ty.toFixed(1)+"px)";'
    + '});'
    + 'el.addEventListener("pointerleave",function(){el.style.transform="";});'
    + '});'
    + '})();';
}

function magneticCSS(options) {
  const o = options || {};
  const sel = sanitizeSelector(o.selector, '[data-pai-magnetic]');
  return wrapHoverCSS(sel + '{'
    + 'transition:transform .32s cubic-bezier(.2,.8,.2,1);'
    + 'will-change:transform}');
}

// ============================================================
// 3) scroll progress bar
// ============================================================

/**
 * The whole indicator, target ≤ 0.2KB. No init call needed: the
 * stylesheet's base state is scaleX(0) and only scroll events move it.
 */
function generateScrollProgressBarScript(options) {
  const o = options || {};
  const sel = JSON.stringify(sanitizeSelector(o.selector, '.pai-progress'));
  // No guard clause needed around the listener itself (b&&…): if the
  // document is not scrollable no scroll event can ever fire, and the
  // stylesheet's base state is already scaleX(0). Budget: ≤ 0.2KB.
  return '(function(){var b=document.querySelector(' + sel + ');'
    + 'b&&addEventListener("scroll",()=>{'
    + 'b.style.transform="scaleX("+scrollY/(document.documentElement.scrollHeight-innerHeight)+")"'
    + '},{passive:1})})();';
}

/** Track + fill. Scroll-tied, not cursor-tied, so no hover guard. */
function scrollProgressCSS(options) {
  const o = options || {};
  const sel = sanitizeSelector(o.selector, '.pai-progress');
  return [
    sel + '{position:fixed;top:0;left:0;z-index:9999;width:100%;height:4px;',
    '  pointer-events:none;transform-origin:0 50%;transform:scaleX(0);',
    '  background:linear-gradient(90deg,var(--primary,#2f6fed),var(--accent,#7aa5ff))}'
  ].join('\n');
}

module.exports = {
  esc,
  HOVER_QUERY,
  REDUCE_QUERY,
  HOVER_MEDIA,
  hoverGuardJS,
  reduceGuardJS,
  wrapHoverCSS,
  generate3DTiltCardsScript,
  tiltCSS,
  generateMagneticButtonsScript,
  magneticCSS,
  generateScrollProgressBarScript,
  scrollProgressCSS
};

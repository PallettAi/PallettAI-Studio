'use strict';
// ============================================================
// PallettAI Studio — lightweight motion & animation engine
// Zero-dependency runtime micro-interactions for exported sites.
// ------------------------------------------------------------
// Four deliverables live here:
//
//   1. generateMotionScript()  — a < 2KB vanilla JS runtime that uses
//      IntersectionObserver to add `.in` to scroll-reveal elements
//      (fade-up / slide-in / scale-up), plus generateMotionSnippet()
//      for one-call style+script injection.
//   2. Generators for the three shared micro-interactions: infinite
//      marquee loops (.pai-marquee) with pause-on-hover, sticky
//      header reveal/hide on scroll direction, and smooth FAQ
//      accordion bindings. Each returns { html, css, js }.
//   3. wrapReducedMotion() — every stylesheet this module emits passes
//      through it, so keyframe animations are automatically wrapped in
//      a `@media (prefers-reduced-motion: reduce)` guard.
//
// ---- what this file guarantees ----------------------------------
// 1. THE SITE IS VISIBLE WITHOUT JAVASCRIPT. The reveal base state is
//    opacity:1; the hidden state only exists behind
//    `html.pai-motion-ready`, a class the runtime script adds ONLY
//    after it has confirmed it can reveal again (reduced-motion
//    visitors and browsers without IntersectionObserver never get the
//    class, so their content simply stays visible). A crash between
//    the class add and the first observe() costs one frame of hidden
//    content at worst — a blank page never does.
// 2. JAVASCRIPT ONLY TOGGLES CLASSES. Every animated property
//    (transform, opacity, grid-template-rows) is owned by CSS, so the
//    two writers can never fight over the same property — the failure
//    mode this studio's motion-smoke suite exists to catch.
// 3. REDUCED MOTION IS ENFORCED IN CSS, NOT JUST JS. wrapReducedMotion
//    appends a `prefers-reduced-motion: reduce` block that switches off
//    every animation/transition it found, pins reveals visible, and
//    (marquee) converts the strip into a manually scrollable one so no
//    content is lost when the loop stops.
// 4. THE MARQUEE LOOP IS SEAMLESS BY CONSTRUCTION: the track holds two
//    identical groups and the keyframe travels exactly -50%, and each
//    group carries a trailing padding equal to its internal gap so the
//    halves are the same width. No JS measures anything.
//
// This module is standalone: it never touches builder.js output and
// makes no network calls. Everything here is a pure string generator.
// ============================================================

// ---- shared escaping ------------------------------------------------
// Site copy, item labels and config strings arrive from user projects;
// they end up inside HTML text and attributes, so they are escaped here
// exactly the way Builder.esc does it. Never interpolate raw.
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Whitelisted reveal kinds. Anything else falls back to fade-up, so a
// project written by a newer build cannot inject an unknown transform.
const REVEAL_KINDS = ['fade-up', 'slide-in', 'scale-up'];

// ============================================================
// Reduced-motion wrapping (Task 1.3)
// ============================================================
//
// wrapReducedMotion(css, { static }) analyses a flat stylesheet, finds
// every rule that drives an animation or transition (including ones
// nested inside @media/@supports), finds every @keyframes name, and
// appends ONE media block:
//
//   @media (prefers-reduced-motion: reduce){
//     /* @keyframes neutralised for reduced motion: name, ... */
//     selector, ...{animation:none !important;transition:none !important}
//     <caller-supplied forced end-states>
//   }
//
// The original rules are left where they are (moving them into a
// `no-preference` wrapper would delete their non-motion declarations
// for reduced-motion visitors — a marquee that loses display:flex is
// a layout bug, not an accessibility win). Neutralising at the point
// the brief names — inside the reduce query — is what actually stops
// the keyframes from ever resolving.
//
// Idempotent: a stylesheet that already carries the reduce query is
// returned untouched, so composing pre-wrapped pieces cannot stack
// duplicate guards.

// Replace comments with equal-length whitespace so byte offsets into
// the cleaned copy still index the ORIGINAL string (a `/* } */` must
// not confuse the brace counter, and we slice output from `src`).
function blankComments(css) {
  return String(css).replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
}

// Top-level (and nested for at-rule bodies) block scanner.
function analyzeBlocks(css, out, insideAtRule) {
  const clean = blankComments(css);
  let ptr = 0, depth = 0, open = -1;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && open >= 0) {
        const selector = clean.slice(ptr, open).trim();
        const body = css.slice(open + 1, i);
        const animated = /\b(?:animation|transition)[\w-]*\s*:/.test(body);
        if (/^@keyframes\s+/.test(selector)) {
          const m = selector.match(/^@keyframes\s+([\w-]+)/);
          if (m) out.keyframes.push(m[1]);
        } else if (/^@media\b|^@supports\b|^@layer\b/.test(selector)) {
          // Recurse: an animation rule living inside a responsive query
          // still needs a reduce override, and that override is valid
          // emitted outside the query (same selector, !important).
          analyzeBlocks(body, out, true);
        } else if (selector && animated && selector.charAt(0) !== '@') {
          if (out.animated.indexOf(selector) === -1) out.animated.push(selector);
        }
        ptr = i + 1;
        open = -1;
      }
    }
  }
  return out;
}

function wrapReducedMotion(css, options) {
  const src = String(css == null ? '' : css).trim();
  if (!src) return '';
  // Already guarded — do not stack a second copy (composition safety).
  if (/prefers-reduced-motion:\s*reduce/.test(src)) return src;

  const info = analyzeBlocks(src, { animated: [], keyframes: [] }, false);
  const lines = [src, '', '@media (prefers-reduced-motion: reduce){'];
  if (info.keyframes.length) {
    lines.push('  /* @keyframes neutralised for reduced motion: ' + info.keyframes.join(', ') + ' */');
  }
  if (info.animated.length) {
    lines.push('  ' + info.animated.join(',\n  ') + '{animation:none !important;transition:none !important}');
  }
  const stat = options && options.static ? String(options.static).trim() : '';
  if (stat) {
    stat.split('\n').map((l) => l.trim()).filter(Boolean)
      .forEach((l) => lines.push('  ' + l));
  }
  lines.push('}');
  return lines.join('\n');
}

// ============================================================
// Task 1.1 — scroll reveal runtime (< 2KB) + reveal stylesheet
// ============================================================
//
// generateMotionScript(options) returns a bare IIFE string. Inject it
// once per page, ideally right after the markup it observes.
//
// Safety ordering inside the script is deliberate:
//   1. reduced-motion check  → bail BEFORE adding pai-motion-ready
//   2. IntersectionObserver check → bail BEFORE adding pai-motion-ready
//   3. only then add the class that unlocks the hidden CSS state
// so every visitor the script cannot serve for leaves the page fully
// visible. `.in` is added on intersection and the element is
// unobserved; window.__paiMotion.refresh() re-scans for content the
// page injects later (SPA-style sections).
function generateMotionScript(options) {
  const o = options || {};
  const selector = o.selector ? String(o.selector) : '[data-pai-reveal],.pai-reveal';
  let threshold = Number(o.threshold);
  if (!Number.isFinite(threshold)) threshold = 0.12;
  threshold = Math.max(0, Math.min(1, threshold));
  const rawMargin = String(o.rootMargin == null ? '0px 0px -6% 0px' : o.rootMargin);
  const rootMargin = /^[\d.%a-z\s\-]+$/.test(rawMargin) ? rawMargin : '0px 0px -6% 0px';

  return '(function(){'
    + 'var d=document.documentElement;'
    // 1. motion preference first — a reduced visitor must never receive
    //    the class that hides content waiting for an observer.
    + "if(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;"
    // 2. no observer → no hidden state (classic Firefox feature gap).
    + "if(!('IntersectionObserver' in window))return;"
    + "d.classList.add('pai-motion-ready');"
    + 'var io=new IntersectionObserver(function(es){'
    + 'es.forEach(function(e){'
    + 'if(!e.isIntersecting)return;'
    + "e.target.classList.add('in');"
    + 'io.unobserve(e.target);'
    + '});'
    + '},{threshold:' + threshold + ',rootMargin:' + JSON.stringify(rootMargin) + '});'
    + 'var sel=' + JSON.stringify(selector) + ';'
    + 'var scan=function(){'
    + 'Array.prototype.forEach.call(document.querySelectorAll(sel),function(el){'
    + "if(el.classList.contains('in'))return;"
    + 'io.observe(el);'
    + '});'
    + '};'
    + 'scan();'
    // Late-injected sections call refresh(); observing twice is a no-op.
    + 'window.__paiMotion={refresh:scan};'
    + '})();';
}

// The reveal stylesheet. Base state is VISIBLE (guarantee 1); the four
// hidden-state rules sit inside no-preference so a reduced-motion
// visitor cannot be stranded by JS that never runs — CSS enforces it
// even if the script is stripped by a CSP.
function revealCSS() {
  const rules = [
    '/* PaiStudio scroll reveals — base state visible, hidden state gated on html.pai-motion-ready */',
    '.pai-reveal{opacity:1;transform:none;transition:opacity .7s ease,transform .7s cubic-bezier(.2,.72,.2,1)}',
    '@media (prefers-reduced-motion:no-preference){',
    '  html.pai-motion-ready .pai-reveal[data-pai-reveal]{opacity:0}',
    '  html.pai-motion-ready .pai-reveal[data-pai-reveal="fade-up"]{transform:translateY(20px)}',
    '  html.pai-motion-ready .pai-reveal[data-pai-reveal="slide-in"]{transform:translateX(-36px)}',
    '  html.pai-motion-ready .pai-reveal[data-pai-reveal="scale-up"]{transform:scale(.94)}',
    '  html.pai-motion-ready .pai-reveal[data-pai-reveal].in{opacity:1;transform:none}',
    '}'
  ].join('\n');
  return wrapReducedMotion(rules, {
    // Forced end-state: whatever happened, a reduce visitor sees text.
    static: '.pai-reveal,html.pai-motion-ready .pai-reveal[data-pai-reveal]{opacity:1 !important;transform:none !important}'
  });
}

// ============================================================
// Task 1.2a — infinite marquee (.pai-marquee)
// ============================================================
//
// { html, css, js } — the loop is CSS-only (js stays ''), pause is
// :hover/:focus-within, so keyboard users get the same control mouse
// users do (WCAG 2.2.2 needs a pause mechanism; focus-within is it).
//
// Seamless geometry: the track is exactly two identical groups with
// gap:0 BETWEEN them; each group pads its own trailing gap, so half
// the track equals one group plus its trailing gap and translateX(-50%)
// lands on the seam. Passing fewer items than fill the viewport leaves
// a gap on very wide screens — repeat items in the array instead.
function generateMarquee(items, options) {
  const o = options || {};
  const list = (Array.isArray(items) ? items : [])
    .map((it) => (it == null ? '' : String(typeof it === 'object' ? (it.label || it.text || '') : it).trim()))
    .filter(Boolean);
  // An empty stream would animate nothing (and the -50% keyframe would
  // travel across an empty track) — same guard as the kinetic band.
  if (!list.length) return { html: '', css: '', js: '' };

  const duration = Math.max(4, Number(o.duration) || 32);
  const gap = String(o.gap || '2.4rem').replace(/[^0-9a-z.%\s-]/gi, '');
  const label = o.label ? esc(o.label) : '';

  const group = '<span class="pai-marquee-group">'
    + list.map((t) => '<span class="pai-marquee-item">' + esc(t) + '</span>').join('')
    + '</span>';
  // Second copy is decorative: screen readers must hear each item once.
  const html = '<div class="pai-marquee"'
    + (label ? ' aria-label="' + label + '"' : '')
    + '><div class="pai-marquee-track">' + group
    + group.replace('<span class="pai-marquee-group">', '<span class="pai-marquee-group" aria-hidden="true">')
    + '</div></div>';

  return { html, css: marqueeCSS({ duration, gap }), js: '' };
}

function marqueeCSS(options) {
  const o = options || {};
  const duration = Math.max(4, Number(o.duration) || 32);
  const gap = String(o.gap || '2.4rem').replace(/[^0-9a-z.%\s-]/gi, '') || '2.4rem';
  const rules = [
    '.pai-marquee{--pai-marquee-gap:' + gap + ';--pai-marquee-duration:' + duration + 's;position:relative;max-width:100%;overflow:hidden;',
    '  -webkit-mask-image:linear-gradient(90deg,transparent,#000 5%,#000 95%,transparent);mask-image:linear-gradient(90deg,transparent,#000 5%,#000 95%,transparent)}',
    '.pai-marquee-track{display:flex;width:max-content;align-items:center;animation:pai-marquee-run var(--pai-marquee-duration) linear infinite;will-change:transform}',
    '.pai-marquee-group{display:flex;flex:0 0 auto;align-items:center;gap:var(--pai-marquee-gap);padding-right:var(--pai-marquee-gap)}',
    '.pai-marquee-item{white-space:nowrap}',
    /* pause-on-hover AND on keyboard focus inside the strip */
    '.pai-marquee:hover .pai-marquee-track,.pai-marquee:focus-within .pai-marquee-track{animation-play-state:paused}',
    '@keyframes pai-marquee-run{from{transform:translateX(0)}to{transform:translateX(-50%)}}'
  ].join('\n');
  return wrapReducedMotion(rules, {
    // Loop stops → the strip must stay readable, so hand scrolling back.
    static: '.pai-marquee{overflow-x:auto !important;-webkit-mask-image:none !important;mask-image:none !important}\n'
      + '.pai-marquee .pai-marquee-track{animation:none !important}'
  });
}

// ============================================================
// Task 1.2b — sticky header reveal/hide
// ============================================================
//
// Returns { html:'', css, js }: sites keep their own <header>, this
// module supplies the .pai-sticky treatment plus a rAF-throttled
// scroll-direction binding. Scrolling down past `threshold` hides the
// bar, scrolling up reveals it, and near the top it is always visible
// so the wordmark is never missing on a fresh page.
//
// Reduced motion: the script returns before binding (nothing moves)
// AND wrapReducedMotion pins translateY(-101%) back to none, so even a
// script that half-ran cannot make the header vanish without motion.
function generateStickyHeader(options) {
  return { html: '', css: stickyCSS(options), js: stickyScript(options) };
}

function stickyCSS() {
  const rules = [
    '.pai-sticky{position:sticky;top:0;z-index:60;transform:translateY(0);transition:transform .34s cubic-bezier(.2,.7,.2,1),box-shadow .3s ease;will-change:transform}',
    '.pai-sticky.pai-sticky-hidden{transform:translateY(-101%)}'
  ].join('\n');
  return wrapReducedMotion(rules, {
    static: '.pai-sticky,.pai-sticky.pai-sticky-hidden{transform:none !important;transition:none !important}'
  });
}

function stickyScript(options) {
  const o = options || {};
  // JSON.stringify makes the selector safe inside the JS string literal
  // (quotes, backslashes, newlines cannot break out of it).
  const sel = JSON.stringify(String(o.selector || '.pai-sticky'));
  let threshold = Number(o.threshold);
  if (!Number.isFinite(threshold)) threshold = 96;
  threshold = Math.max(0, Math.floor(threshold));
  return '(function(){'
    + 'var el=document.querySelector(' + sel + ');'
    + 'if(!el)return;'
    // Reduced motion never gets a moving header: bail before binding.
    + "if(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;"
    + 'var last=window.pageYOffset||0,ticking=false;'
    + 'function apply(){'
    + 'var y=window.pageYOffset||document.documentElement.scrollTop||0;'
    + 'if(y<0)y=0;'
    // near the top: always visible; scrolling up: visible; down: hidden
    + 'var hide=y>' + threshold + '&&y>last;'
    + "el.classList.toggle('pai-sticky-hidden',hide);"
    + 'last=y;ticking=false;'
    + '}'
    + "window.addEventListener('scroll',function(){"
    + 'if(ticking)return;'
    + 'ticking=true;'
    + 'requestAnimationFrame(apply);'
    + "},{passive:true});"
    + '})();';
}

// ============================================================
// Task 1.2c — smooth FAQ accordion bindings
// ============================================================
//
// Returns { html, css, js }.
//
// No-JS story (the reason this looks the way it does): panels ship
// collapsed (aria-expanded="false") but the fragment carries a
// <noscript> style that forces them open, so a JS-off visitor READS
// the answers instead of finding dead buttons. The JS binding adds
// `inert` + aria-hidden on collapse so keyboard focus cannot land in
// a zero-height panel — a bug max-height accordions always had.
//
// Height animation is grid-template-rows 0fr→1fr: no scrollHeight
// measuring, no resize handler, correct at any content length.
function generateAccordion(items, options) {
  const o = options || {};
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { html: '', css: accordionCSS(), js: '' };

  const prefix = String(o.idPrefix || 'pai-acc').replace(/[^\w-]/g, '') || 'pai-acc';
  const html = list.map((it, i) => {
    const item = it && typeof it === 'object' ? it : { q: String(it == null ? '' : it) };
    const q = esc(item.q != null ? item.q : item.question != null ? item.question : item.title);
    const a = item.a != null ? item.a : item.answer != null ? item.answer : item.body;
    const answerHtml = item.html ? item.html : '<p>' + esc(a == null ? '' : a) + '</p>';
    const bid = prefix + '-b-' + i;
    const pid = prefix + '-p-' + i;
    return '<div class="pai-acc-item">'
      + '<h3 class="pai-acc-h"><button type="button" class="pai-acc-btn" id="' + bid + '"'
      + ' aria-expanded="false" aria-controls="' + pid + '">'
      + '<span>' + q + '</span>'
      + '<svg class="pai-acc-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">'
      + '<path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>'
      + '</svg></button></h3>'
      + '<div class="pai-acc-panel" id="' + pid + '" role="region" aria-labelledby="' + bid + '">'
      + '<div class="pai-acc-inner">' + answerHtml + '</div>'
      + '</div></div>';
  }).join('\n');

  const htmlOut = '<div class="pai-acc" data-pai-acc>' + html + '</div>'
    // JS-off fallback: answers readable, buttons merely decorative.
    + '<noscript><style>.pai-acc-panel{grid-template-rows:1fr !important}</style></noscript>';

  return { html: htmlOut, css: accordionCSS(), js: accordionScript(o) };
}

function accordionCSS() {
  const rules = [
    '.pai-acc{display:flex;flex-direction:column;gap:.75rem}',
    '.pai-acc-item{border:1px solid var(--line,rgba(127,127,127,.22));border-radius:var(--radius,14px);background:var(--surface,rgba(127,127,127,.04))}',
    '.pai-acc-h{margin:0}',
    '.pai-acc-btn{display:flex;align-items:center;justify-content:space-between;gap:1rem;width:100%;padding:1rem 1.15rem;background:none;border:0;color:inherit;font:inherit;font-weight:650;text-align:left;cursor:pointer}',
    '.pai-acc-btn:focus-visible{outline:2px solid var(--primary,#5b8cff);outline-offset:2px;border-radius:var(--radius,14px)}',
    '.pai-acc-icon{flex:0 0 auto;transition:transform .3s ease}',
    '.pai-acc-item.is-open .pai-acc-icon{transform:rotate(45deg)}',
    '.pai-acc-panel{display:grid;grid-template-rows:0fr;transition:grid-template-rows .34s ease}',
    '.pai-acc-item.is-open .pai-acc-panel{grid-template-rows:1fr}',
    '.pai-acc-inner{overflow:hidden;min-height:0}',
    '.pai-acc-inner>p{margin:0;padding:0 1.15rem 1.1rem;color:var(--muted,#5f6b7a);line-height:1.6}'
  ].join('\n');
  // static: under reduce the transition dies (instant toggle — still
  // fully functional, which is the point: reduced motion ≠ reduced feature).
  return wrapReducedMotion(rules, { static: '.pai-acc-panel,.pai-acc-icon{transition:none !important}' });
}

function accordionScript(options) {
  const o = options || {};
  const sel = JSON.stringify(String(o.selector || '[data-pai-acc]'));
  const exclusive = o.exclusive === true;
  return '(function(){'
    + 'var root=document.querySelector(' + sel + ');'
    + 'if(!root)return;'
    // One state writer: class, aria and inert can never disagree.
    + 'function setOpen(item,open){'
    + "item.classList.toggle('is-open',open);"
    + "var btn=item.querySelector('.pai-acc-btn');"
    + "if(btn)btn.setAttribute('aria-expanded',open?'true':'false');"
    + "var panel=item.querySelector('.pai-acc-panel');"
    + 'if(panel){'
    + "panel.setAttribute('aria-hidden',open?'false':'true');"
    + "if('inert' in panel)panel.inert=!open;"
    + '}'
    + '}'
    + 'var items=root.querySelectorAll(".pai-acc-item");'
    + 'Array.prototype.forEach.call(items,function(it){setOpen(it,false);});'
    + "root.addEventListener('click',function(e){"
    + 'var btn=e.target&&e.target.closest?e.target.closest(\'.pai-acc-btn\'):null;'
    + 'if(!btn||!root.contains(btn))return;'
    + 'var item=btn.closest(".pai-acc-item");'
    + 'if(!item)return;'
    + "var open=!item.classList.contains('is-open');"
    + (exclusive
      ? "Array.prototype.forEach.call(items,function(it){if(it!==item)setOpen(it,false);});"
      : '')
    + 'setOpen(item,open);'
    + "});"
    + '})();';
}

// ============================================================
// Convenience bundles
// ============================================================

// Everything the reveal system needs, in injection order.
function generateMotionStyles() {
  return [
    revealCSS(),
    marqueeCSS(),
    stickyCSS(),
    accordionCSS()
  ].filter(Boolean).join('\n\n');
}

// One-call snippet: { css, js } for a page that wants the whole engine.
function generateMotionSnippet(options) {
  const o = options || {};
  return {
    css: o.styles === false ? '' : generateMotionStyles(),
    js: o.runtime === false ? '' : generateMotionScript(o)
  };
}

// Human-sized byte count for the runtime, so callers can assert the
// < 2KB budget the same way the smoke suite does.
function runtimeBytes(options) {
  return Buffer.byteLength(generateMotionScript(options), 'utf8');
}

module.exports = {
  esc,
  REVEAL_KINDS,
  wrapReducedMotion,
  generateMotionScript,
  generateMotionStyles,
  generateMotionSnippet,
  runtimeBytes,
  revealCSS,
  generateMarquee,
  marqueeCSS,
  generateStickyHeader,
  stickyCSS,
  generateAccordion,
  accordionCSS
};

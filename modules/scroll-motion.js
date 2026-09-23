'use strict';
// ============================================================
// PallettAI Studio — scroll-driven motion & parallax engine
// Native CSS scroll timelines for viewport motion — no JS
// animation library, no rAF main-thread cost for the common
// cases — with a tiny IntersectionObserver + rAF parallax
// fallback for layered depth on browsers without scroll
// timelines (or for effects that must track a sensitivity
// map rather than pure viewport progress).
// ------------------------------------------------------------
//   1. generateScrollTimelineCSS(animationType, targetSelector)
//        'reveal'     — fade/translate entry tied to view()
//        'scale-down' — page-progress zoom-out tied to scroll()
//        'progress'   — scaleX progress bar tied to scroll()
//      Returns @keyframes + animation-timeline declarations.
//   2. generateParallaxLayersScript(sensitivityMap) → < 0.8KB
//      inline JS: selector → depth map, IntersectionObserver
//      gates the work to on-screen layers, rAF batches it.
//   3. prefers-reduced-motion is honored twice, deliberately:
//      — applying blocks are gated by (prefers-reduced-motion:
//        no-preference), so reduce visitors never receive the
//        animation AT ALL, and
//      — an explicit reduce override sets `animation: none`
//        for the selector, so a stray animation can never move
//        a spatial element under reduce.
//      Net guarantee: without @supports (animation-timeline),
//      without JS, or under reduce, the element renders in its
//      authored, fully visible state — content is never hidden
//      behind an animation the visitor cannot receive.
// ============================================================

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// animationType aliases → canonical keys.
const TYPES = {
  reveal: 'reveal',
  'fade-up': 'reveal',
  fade: 'reveal',
  fadein: 'reveal',
  'fade-in': 'reveal',
  'scale-down': 'scale-down',
  scaledown: 'scale-down',
  zoom: 'scale-down',
  progress: 'progress',
  'progress-bar': 'progress',
  'scroll-progress': 'progress'
};

/**
 * generateScrollTimelineCSS(animationType, targetSelector) → CSS text.
 *
 * Every variant is three layers deep on purpose:
 *   1. @keyframes — inert on their own.
 *   2. @supports (animation-timeline: …) { @media
 *      (prefers-reduced-motion: no-preference) { SEL {…} } }
 *      — the animation only exists where the browser can drive
 *      it from scroll AND the visitor accepts motion.
 *   3. @media (prefers-reduced-motion: reduce) { SEL { animation:
 *      none } } — an explicit stop, even if something else
 *      tried to animate the selector.
 */
function generateScrollTimelineCSS(animationType, targetSelector) {
  const key = TYPES[String(animationType == null ? '' : animationType).toLowerCase().trim()];
  if (!key) {
    throw fail('bad_input', 'Unknown animationType "' + String(animationType)
      + '". Use reveal, scale-down, or progress.');
  }
  const sel = String(targetSelector == null ? '' : targetSelector).trim().replace(/[<>{}]/g, '');
  if (!sel) throw fail('bad_input', 'targetSelector is required');

  let keyframes;
  let rule;
  if (key === 'reveal') {
    keyframes = '@keyframes pai-reveal{'
      + 'from{opacity:0;transform:translateY(24px)}'
      + 'to{opacity:1;transform:none}}';
    rule = sel + '{animation:pai-reveal linear both;'
      + 'animation-timeline:view();'
      + 'animation-range:entry 0% entry 100%}';
  } else if (key === 'scale-down') {
    keyframes = '@keyframes pai-scale-down{'
      + 'from{transform:scale(1)}'
      + 'to{transform:scale(.92)}}';
    rule = sel + '{animation:pai-scale-down linear both;'
      + 'animation-timeline:scroll();'
      + 'animation-range:0 100%}';
  } else {
    keyframes = '@keyframes pai-progress{'
      + 'from{transform:scaleX(0)}'
      + 'to{transform:scaleX(1)}}';
    rule = sel + '{transform-origin:left center;'
      + 'animation:pai-progress linear both;'
      + 'animation-timeline:scroll();'
      + 'animation-range:0 100%}';
  }

  return keyframes + '\n'
    + '@supports (animation-timeline: view()){\n'
    + '@media (prefers-reduced-motion: no-preference){\n'
    + rule + '\n'
    + '}\n'
    + '}\n'
    + '@media (prefers-reduced-motion: reduce){\n'
    + sel + '{animation:none}\n'
    + '}';
}

// ---- parallax fallback -------------------------------------------

const DEFAULT_DEPTH = 0.1;

/**
 * generateParallaxLayersScript(sensitivityMap) → inline JS, budget < 0.8KB (819 B).
 *
 * sensitivityMap = {'[data-depth="bg"]': 0.15, '[data-depth="fg"]': -0.08}
 * Depth signs: positive shifts the layer toward the viewport
 * center as it passes (background drift), negative moves with
 * the scroll (foreground rise). Zero/invalid depths are dropped.
 *
 * Mechanics: IntersectionObserver marks which layers are on
 * screen (the first callback fires for everything, visible or
 * not); scroll/resize schedule ONE rAF; the frame loop only
 * touches visible layers. Without IntersectionObserver every
 * layer counts as visible and the rAF path still runs. Under
 * prefers-reduced-motion the script returns before registering
 * anything — layers keep their authored position.
 */
function generateParallaxLayersScript(sensitivityMap) {
  if (!sensitivityMap || typeof sensitivityMap !== 'object' || !Object.keys(sensitivityMap).length) {
    throw fail('bad_input', 'generateParallaxLayersScript requires a selector → depth map');
  }
  const map = {};
  let kept = 0;
  Object.keys(sensitivityMap).forEach((sel) => {
    const d = Number(sensitivityMap[sel]);
    const s = String(sel).trim().replace(/[<>{}]/g, '');
    if (!s || !Number.isFinite(d) || d === 0) return;
    map[s] = d;
    kept++;
  });
  if (!kept) throw fail('bad_input', 'sensitivityMap has no selector with a finite, non-zero depth');
  const json = JSON.stringify(map)
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return '(function(){'
    + 'var M=' + json + ';'
    + 'if(matchMedia("(prefers-reduced-motion:reduce)").matches)return;'
    + 'var L=[],k,n,i;'      + 'for(k in M){n=document.querySelectorAll(k);for(i=0;i<n.length;i++)L.push([n[i],M[k]])}'
    + 'if(!L.length)return;'
    + 'var io="IntersectionObserver" in window?'
      + 'new IntersectionObserver(function(es){'
        + 'es.forEach(function(e){e.target._pv=e.isIntersecting})}):0,'
      + 'q=0;'
    + 'function draw(){q=0;var h=innerHeight/2,j,x,r,o;'
      + 'for(j=0;j<L.length;j++){x=L[j][0];if(x._pv===false)continue;'
        + 'r=x.getBoundingClientRect();o=(h-(r.top+r.height/2))*L[j][1];'
        + 'x.style.transform="translateY("+(o|0)+"px)"}}'
    + 'function wake(){if(!q)q=requestAnimationFrame(draw)}'
    + 'addEventListener("scroll",wake,{passive:1});'
    + 'addEventListener("resize",wake,{passive:1});'
    + 'if(io)for(i=0;i<L.length;i++)io.observe(L[i][0]);'
    + 'draw()})();';
}

module.exports = {
  generateScrollTimelineCSS,
  generateParallaxLayersScript
};

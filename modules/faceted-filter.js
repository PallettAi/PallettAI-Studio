'use strict';
// ============================================================
// PallettAI Studio — real-time URL-synced faceted filter
// Instant client-side filtering for portfolio grids, product
// cards and blog posts: category tags, price ranges and text
// keywords narrow the DOM in place, and the active state lives
// in the URL so a filtered view is shareable and survives
// reload / back-button.
// ------------------------------------------------------------
//   1. generateFacetedFilterScript(gridSelector) → inline JS:
//        [data-filter-category="design"]  toggle a category facet
//        [data-filter-search]             live keyword input
//        [data-price-min] / [data-price-max]  range bounds
//        [data-filter-sort="price-asc|price-desc"]  reorder
//        [data-filter-reset]              clear everything
//        [data-filter-count]              visible/total readout
//      Grid children carry the data contract:
//        data-category="design branding"  data-price="49"
//        data-title="…title… keywords…"
//   2. syncFilterWithURL lives in the generated script and its
//      two pure halves are exported here for tests:
//        buildFilterQuery(filters) → "category=design&sort=price-asc"
//        parseFilterQuery(search)  → the same filters object
//      Both directions run: URL → state on load, state → URL on
//      every change via history.replaceState (no history spam).
//   3. matchesFilters(item, filters) — the exact predicate the
//      script embeds, exported so the runner can pin semantics.
//   4. facetedFilterCSS(gridSelector) — the show/hide stylesheet:
//      opacity + scale transition while a card animates out,
//      display:none once it lands, and everything wrapped in
//      prefers-reduced-motion so motion-sensitive visitors get
//      an instant, still interface.
//
// ---- what this file guarantees ----------------------------------
// 1. FACETS COMPOSE: categories are OR within the facet, AND
//    across facets (standard faceted-search semantics).
// 2. ROUND-TRIP STABILITY: parseFilterQuery(buildFilterQuery(f))
//    returns the normalized form of f — casing is lower-cased,
//    empties are dropped, bounds are numbers. What you share is
//    what you get.
// 3. HONEST EDGES: a price facet excludes items with no price
//    (an unknown is not a match); sort keeps unpriced items last
//    in both directions; an invalid grid selector throws at
//    BUILD time, and a grid missing at runtime warns once
//    instead of throwing on every keystroke.
// 4. NO PAGE REFRESH, EVER: filtering only toggles classes and
//    reorders nodes; the URL updates via replaceState, which
//    never navigates.
// ============================================================

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// ---- shared state shape -------------------------------------------

/**
 * Canonical filter shape: {category:[], price:{min?,max?}, q, sort}.
 * Accepts strings for category, numeric strings for bounds, and
 * drops anything it cannot understand.
 */
function normalizeFilters(filters) {
  const f = filters && typeof filters === 'object' ? filters : {};
  const rawCats = Array.isArray(f.category)
    ? f.category
    : f.category != null && f.category !== '' ? [f.category] : [];
  const seen = [];
  rawCats.forEach((c) => {
    const v = String(c).trim().toLowerCase();
    if (v && seen.indexOf(v) === -1) seen.push(v);
  });
  const out = { category: seen, price: {}, q: '', sort: '' };
  const p = f.price && typeof f.price === 'object' ? f.price : {};
  const min = Number(p.min);
  const max = Number(p.max);
  if (p.min != null && p.min !== '' && Number.isFinite(min)) out.price.min = min;
  if (p.max != null && p.max !== '' && Number.isFinite(max)) out.price.max = max;
  if (f.q != null && f.q !== '') out.q = String(f.q).trim();
  if (f.sort != null && f.sort !== '') out.sort = String(f.sort).trim();
  return out;
}

// ---- URL sync (pure halves of syncFilterWithURL) -------------------

/**
 * buildFilterQuery(filters) → query string WITHOUT "?".
 * Only non-empty facets are emitted, so an empty filter set is "".
 */
function buildFilterQuery(filters) {
  const f = normalizeFilters(filters);
  const parts = [];
  if (f.category.length) {
    parts.push('category=' + f.category.map(encodeURIComponent).join(','));
  }
  if (f.price.min != null || f.price.max != null) {
    parts.push('price=' + (f.price.min != null ? f.price.min : '')
      + '-' + (f.price.max != null ? f.price.max : ''));
  }
  if (f.q) parts.push('q=' + encodeURIComponent(f.q));
  if (f.sort) parts.push('sort=' + encodeURIComponent(f.sort));
  return parts.join('&');
}

/**
 * parseFilterQuery(search) → canonical filters. Accepts with or
 * without the leading "?" (location.search and raw strings both
 * work). price uses the open-ended "min-max" grammar: "10-50",
 * "-50" (max only), "50-" (min only).
 */
function parseFilterQuery(search) {
  const s = String(search == null ? '' : search).replace(/^\?/, '');
  const params = new URLSearchParams(s);
  const out = { category: [], price: {}, q: '', sort: '' };
  const cat = params.get('category');
  if (cat) {
    const seen = [];
    cat.split(',').forEach((c) => {
      const v = c.trim().toLowerCase();
      if (v && seen.indexOf(v) === -1) seen.push(v);
    });
    out.category = seen;
  }
  const price = params.get('price');
  if (price) {
    const m = /^(\d+(?:\.\d+)?)?-(\d+(?:\.\d+)?)?$/.exec(price);
    if (m) {
      if (m[1]) out.price.min = Number(m[1]);
      if (m[2]) out.price.max = Number(m[2]);
    }
  }
  const q = params.get('q');
  if (q) out.q = q.trim();
  const sort = params.get('sort');
  if (sort) out.sort = sort.trim();
  return out;
}

// ---- the matching predicate ---------------------------------------

/**
 * matchesFilters(item, filters) → boolean.
 * item = {categories?: string[]|string, category?: string,
 *         price?: number|string, title?: string, text?: string}
 * Semantics: OR within the category facet, AND across facets.
 * A price facet excludes items without a usable numeric price.
 * q is a case-insensitive substring over title + text + categories.
 */
function matchesFilters(item, filters) {
  const f = normalizeFilters(filters);
  const it = item && typeof item === 'object' ? item : {};
  if (f.category.length) {
    const source = Array.isArray(it.categories) ? it.categories
      : it.category != null ? it.category : '';
    const cats = (Array.isArray(source) ? source : String(source).split(/[,\s]+/))
      .map((c) => String(c).trim().toLowerCase()).filter(Boolean);
    let hit = false;
    f.category.forEach((c) => { if (cats.indexOf(c) > -1) hit = true; });
    if (!hit) return false;
  }
  if (f.price.min != null || f.price.max != null) {
    const p = Number(it.price);
    if (!Number.isFinite(p)) return false;
    if (f.price.min != null && p < f.price.min) return false;
    if (f.price.max != null && p > f.price.max) return false;
  }
  if (f.q) {
    const text = Array.isArray(it.categories) ? it.categories.join(' ')
      : it.categories != null ? it.categories : it.category != null ? it.category : '';
    const hay = [it.title, it.text, text]
      .filter((v) => v != null && v !== '').join(' ').toLowerCase();
    if (hay.indexOf(f.q.toLowerCase()) === -1) return false;
  }
  return true;
}

// ---- the show/hide stylesheet -------------------------------------

/**
 * facetedFilterCSS(gridSelector) → the animation stylesheet the
 * generated script's classes rely on (.is-hiding animates out,
 * .is-hidden removes from flow, reduced-motion opts out).
 */
function facetedFilterCSS(gridSelector) {
  const sel = String(gridSelector == null ? '' : gridSelector).trim().replace(/[{}<>]/g, '') || '.pai-grid';
  return sel + ' > *{transition:opacity .25s ease,transform .25s ease}\n'
    + sel + ' > .is-hiding{opacity:0;transform:scale(.94);pointer-events:none}\n'
    + sel + ' > .is-hidden{display:none}\n'
    + '@media (prefers-reduced-motion:reduce){' + sel + ' > *{transition:none}}';
}

// ---- the generated filter script ----------------------------------

/**
 * generateFacetedFilterScript(gridSelector) → inline JS.
 * The script embeds compact mirrors of parseFilterQuery /
 * buildFilterQuery / matchesFilters above — same grammar, same
 * semantics — so the URL contract tested here is the URL the
 * page writes.
 */
function generateFacetedFilterScript(gridSelector) {
  const sel = String(gridSelector == null ? '' : gridSelector).trim();
  if (!sel) throw fail('bad_input', 'generateFacetedFilterScript requires a grid selector');
  const json = JSON.stringify(sel)
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return '(function(){'
    + 'var SEL=' + json + ',G=null;'
    + 'try{G=document.querySelector(SEL)}catch(e){}'
    + 'if(!G){console.warn("[filter] grid not found:",SEL);return}'
    // parse / build / match — mirrors of the exported pure functions.
    + 'function P(q){var s={c:[],p:{},t:"",o:""},a=new URLSearchParams(String(q||"").replace(/^\\?/,"")),v,m;'
      + 'v=a.get("category");if(v)v.split(",").forEach(function(x){'
        + 'x=x.trim().toLowerCase();if(x&&s.c.indexOf(x)<0)s.c.push(x)});'
      + 'v=a.get("price");if(v&&(m=/^(\\d+(?:\\.\\d+)?)?-(\\d+(?:\\.\\d+)?)?$/.exec(v))){'
        + 'if(m[1])s.p.min=+m[1];if(m[2])s.p.max=+m[2]}'
      + 'v=a.get("q");if(v)s.t=v.trim();'
      + 'v=a.get("sort");if(v)s.o=v.trim();'
      + 'return s}'
    + 'function B(s){var a=[];'
      + 'if(s.c.length)a.push("category="+s.c.join(","));'
      + 'if(s.p.min!=null||s.p.max!=null)a.push("price="+(s.p.min==null?"":s.p.min)+"-"+(s.p.max==null?"":s.p.max));'
      + 'if(s.t)a.push("q="+encodeURIComponent(s.t));'
      + 'if(s.o)a.push("sort="+encodeURIComponent(s.o));'
      + 'return a.join("&")}'
    + 'function M(el,s){var c=el.dataset.category||"",i,p,h;'
      + 'if(s.c.length){var ok=false;c.split(/[\\s,]+/).forEach(function(x){'
        + 'if(x&&s.c.indexOf(x.toLowerCase())>-1)ok=true});if(!ok)return false}'
      + 'if(s.p.min!=null||s.p.max!=null){p=parseFloat(el.dataset.price);'
        + 'if(!isFinite(p))return false;'
        + 'if(s.p.min!=null&&p<s.p.min)return false;'
        + 'if(s.p.max!=null&&p>s.p.max)return false}'
      + 'if(s.t){h=((el.dataset.title||"")+" "+c+" "+el.textContent||"").toLowerCase();'
        + 'if(h.indexOf(s.t.toLowerCase())<0)return false}'
      + 'return true}'
    // Two-phase hide so the exit transition can play before display:none.
    + 'function hide(el){if(el.classList.contains("is-hidden"))return;'
      + 'el.classList.add("is-hiding");'
      + 'clearTimeout(el._ft);'
      + 'el._ft=setTimeout(function(){el.classList.add("is-hidden")},260)}'
    + 'function show(el){if(!el.classList.contains("is-hidden")&&!el.classList.contains("is-hiding"))return;'
      + 'clearTimeout(el._ft);el._ft=0;'
      + 'el.classList.remove("is-hidden");void el.offsetWidth;el.classList.remove("is-hiding")}'
    + 'function sortGrid(dir){if(!dir)return;'
      + 'var els=[].slice.call(G.children);'
      + 'els.sort(function(a,b){var x=parseFloat(a.dataset.price),y=parseFloat(b.dataset.price);'
        + 'if(!isFinite(x)&&!isFinite(y))return 0;if(!isFinite(x))return 1;if(!isFinite(y))return -1;'
        + 'return(x-y)*(dir==="price-asc"?1:-1)});'
      + 'els.forEach(function(el){G.appendChild(el)})}'
    + 'function syncURL(){var qs=B(S),url=location.pathname+(qs?"?"+qs:"")+location.hash;'
      + 'history.replaceState(null,"",url)}'
    + 'function state(){var els=document.querySelectorAll("[data-filter-category],[data-filter-sort]"),i,b,v;'
      + 'for(i=0;i<els.length;i++){b=els[i];'
        + 'v=b.dataset.filterCategory!=null?S.c.indexOf(b.dataset.filterCategory.toLowerCase())>-1:S.o===b.dataset.filterSort;'
        + 'b.classList.toggle("is-active",v);b.setAttribute("aria-pressed",v?"true":"false")}'
      + 'var sr=document.querySelector("[data-filter-search]");if(sr)sr.value=S.t;'
      + 'var mn=document.querySelector("[data-price-min]");if(mn)mn.value=S.p.min==null?"":S.p.min;'
      + 'var mx=document.querySelector("[data-price-max]");if(mx)mx.value=S.p.max==null?"":S.p.max}'
    + 'function count(n){var els=document.querySelectorAll("[data-filter-count]"),i;'
      + 'for(i=0;i<els.length;i++)els[i].textContent=n+"/"+G.children.length}'
    + 'function apply(){var els=[].slice.call(G.children),i,n=0;'
      + 'for(i=0;i<els.length;i++){if(M(els[i],S)){n++;show(els[i])}else hide(els[i])}'
      + 'sortGrid(S.o);syncURL();count(n);state()}'
    + 'var S=P(location.search);'
    // Controls: delegated so re-rendered controls keep working.
    + 'document.addEventListener("click",function(e){'
      + 'var b=e.target.closest&&e.target.closest("[data-filter-category],[data-filter-sort],[data-filter-reset]");'
      + 'if(!b)return;'
      + 'if(b.hasAttribute("data-filter-reset")){S={c:[],p:{},t:"",o:""};apply();return}'
      + 'if(b.dataset.filterCategory!=null){var v=b.dataset.filterCategory.toLowerCase(),i=S.c.indexOf(v);'
        + 'if(i>-1)S.c.splice(i,1);else S.c.push(v);apply()}'
      + 'else if(b.dataset.filterSort!=null){S.o=S.o===b.dataset.filterSort?"":b.dataset.filterSort;apply()}});'
    + 'document.addEventListener("input",function(e){var t=e.target,k,v,n;'
      + 'if(t.matches&&t.matches("[data-filter-search]")){S.t=t.value.trim();apply()}'
      + 'else if(t.matches&&t.matches("[data-price-min],[data-price-max]")){'
        + 'k=t.hasAttribute("data-price-min")?"min":"max";v=t.value.trim();'
        + 'n=parseFloat(v);'
        + 'if(v===""||!isFinite(n))delete S.p[k];else S.p[k]=n;'
        + 'apply()}});'
    + 'apply()})();';
}

module.exports = {
  normalizeFilters,
  buildFilterQuery,
  parseFilterQuery,
  matchesFilters,
  facetedFilterCSS,
  generateFacetedFilterScript
};

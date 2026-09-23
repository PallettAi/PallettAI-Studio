// ============================================================
// PallettAI Studio — StylebookGenerator
// Exports a standalone, zero-dependency interactive /styleguide.html
// for developer handoff and client review.
//
// generateStylebookHTML(tokenCatalog, archetypeKey, options)
//   The page ships everything inside one HTML file:
//
//   • OKLCH/hex colour swatches — click to copy, with a
//     clipboard-API → execCommand fallback and visual feedback.
//   • Typography specimen rows driven by real clamp() tokens, plus
//     a simulated-viewport slider that evaluates each clamp at an
//     arbitrary width (reference evaluator, no page resize needed).
//   • Live rendered components: buttons, badges, cards, form
//     controls (input, switch, checkbox), accordion, tabs —
//     styled by the real per-archetype ComponentLibrary CSS.
//   • Surface shader samples (glass / neumorphic / clay) tinted
//     from the active palette.
//   • An inline theme switcher: all 6 Design DNA archetypes swap
//     in real time (component CSS + palette + surfaces), with
//     deep-linking via location.hash. No reload, no dependencies.
//
// tokenCatalog: { colors: {primary, secondary, accent, background,
//   surface, ink, ...}, typography?: [{role, clamp, lineHeight,
//   tracking}], name?: string }
// Colour values are strictly validated (hex / oklch() / rgb() /
// hsl() / color-mix()) before being embedded — the stylebook can
// never be used as a CSS/HTML injection vector.
//
// When colors are omitted, the archetype's default palette is
// used; when typography is omitted, a modular scale is computed.
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  var ComponentLibrary =
    (typeof window !== 'undefined' && window.ComponentLibrary) ||
    require('./component-library.js');
  var FluidTypography =
    (typeof window !== 'undefined' && window.FluidTypography) ||
    require('./fluid-typography.js');
  var SurfaceShaders =
    (typeof window !== 'undefined' && window.SurfaceShaders) ||
    require('./surface-shaders.js');

  var StylebookGenerator = {};

  var ARCHETYPES = ComponentLibrary.ARCHETYPES.slice();
  StylebookGenerator.ARCHETYPES = ARCHETYPES;
  StylebookGenerator.STYLEBOOK_VERSION = '1.0.0';

  /* ---------------- validation helpers ---------------- */

  var COLOR_RE = new RegExp(
    '^(' +
    '#[0-9a-fA-F]{3,8}' +
    '|(oklch|rgb|rgba|hsl|hsla|lab|lch|hwb)\\((?:[^()]|\\([^()]*\\))*\\)' +
    '|color-mix\\((?:[^()]|\\([^()]*\\))*\\)' +
    ')$'
  );

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escJs(s) {
    return JSON.stringify(String(s)).replace(/</g, '\\u003c');
  }

  function validName(n) { return /^[a-z][a-z0-9-]*$/.test(String(n)); }

  function validateColors(colors) {
    var out = {};
    var names = Object.keys(colors);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (!validName(name)) {
        return { ok: false, error: 'invalid colour token name: ' + String(name) };
      }
      var v = colors[name];
      if (typeof v !== 'string' || !COLOR_RE.test(v.trim())) {
        return { ok: false, error: 'colour "' + name + '" is not an allowed CSS colour: ' + String(v) };
      }
      out[name] = v.trim();
    }
    return { ok: true, colors: out };
  }

  function validTypoRow(r) {
    return r &&
      typeof r.role === 'string' && validName(r.role) &&
      typeof r.clamp === 'string' && /^clamp\(/.test(r.clamp) && r.clamp.length < 160 && !/[<"'`]|\}/.test(r.clamp) &&
      (r.lineHeight == null || (typeof r.lineHeight === 'number' && isFinite(r.lineHeight))) &&
      (r.tracking == null || (typeof r.tracking === 'string' && r.tracking.length < 40 && !/[<"'`}]/.test(r.tracking)));
  }

  /* ---------------- default palettes ---------------- */

  var DEFAULT_PALETTES = {
    'bento-glass':        { primary: '#4f6df5', secondary: '#7c8ff8', accent: '#22d3ee', background: '#f5f7ff', surface: '#ffffff', ink: '#171b2e', muted: '#5c6484', danger: '#e04141', success: '#1ea97c' },
    'brutalist-kinetic':  { primary: '#ff4d00', secondary: '#ffd400', accent: '#0037ff', background: '#f4f1ea', surface: '#ffffff', ink: '#0a0a0a', muted: '#565349', danger: '#d40000', success: '#008a3c' },
    'editorial-magazine': { primary: '#1a1a18', secondary: '#8c6f46', accent: '#9d2b2b', background: '#faf7f0', surface: '#ffffff', ink: '#22201c', muted: '#6f6a5e', danger: '#9d2b2b', success: '#4a6b4f' },
    'retro-cyberpunk':    { primary: '#00f0ff', secondary: '#ff2fb3', accent: '#f9e900', background: '#0b0f1e', surface: '#141a30', ink: '#d7fbff', muted: '#6f7fa8', danger: '#ff3860', success: '#00ff9d' },
    'organic-clay':       { primary: '#c96f4a', secondary: '#e0a184', accent: '#7d9b76', background: '#f6efe7', surface: '#fffbf6', ink: '#3f2f25', muted: '#8a7666', danger: '#c14f4f', success: '#6f9b6a' },
    'neo-minimalist':     { primary: '#111318', secondary: '#4b5563', accent: '#2563eb', background: '#ffffff', surface: '#f7f8fa', ink: '#111318', muted: '#6b7280', danger: '#dc2626', success: '#16a34a' }
  };

  /* ---------------- specimen plumbing ---------------- */

  function defaultTypoScale() {
    var res = FluidTypography.buildFluidTypeTokens({ baseSizePx: 16, scaleRatio: 'fourth' });
    return res.scale.map(function (r) {
      return { role: r.role, clamp: r.clamp, lineHeight: r.lineHeight, tracking: r.tracking };
    });
  }

  /* ---------------- page chrome CSS ---------------- */

  var BASE_CSS = [
    ':root{--sb-max:1120px;--sb-gap:32px;}',
    '*,*::before,*::after{box-sizing:border-box;}',
    'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;',
    '  background:var(--c-background,#fff);color:var(--c-ink,#111);line-height:1.55;}',
    '.sb-wrap{max-width:var(--sb-max);margin:0 auto;padding:0 24px 96px;}',
    'header.sb-head{padding:48px 0 8px;border-bottom:2px solid var(--c-ink,#111);margin-bottom:40px;}',
    '.sb-head h1{font-size:2rem;margin:0 0 4px;letter-spacing:-0.02em;}',
    '.sb-head p{margin:0 0 20px;color:var(--c-muted,#666);}',
    '.sb-switcher{display:flex;flex-wrap:wrap;gap:8px;padding-bottom:20px;}',
    '.sb-switcher button{all:unset;cursor:pointer;padding:8px 14px;border:1px solid var(--c-ink,#111);',
    '  border-radius:9999px;font-size:.85rem;font-weight:600;color:var(--c-ink,#111);transition:background .15s,color .15s;}',
    '.sb-switcher button[aria-pressed="true"]{background:var(--c-ink,#111);color:var(--c-background,#fff);}',
    '.sb-switcher button:focus-visible{outline:2px solid var(--c-primary,#333);outline-offset:2px;}',
    'section{margin-block:56px;}',
    'h2.sb-title{font-size:1.1rem;text-transform:uppercase;letter-spacing:.12em;',
    '  color:var(--c-muted,#666);margin:0 0 20px;padding-bottom:8px;border-bottom:1px solid color-mix(in oklab, var(--c-ink,#111) 15%, transparent);}',
    '.sb-grid{display:grid;gap:16px;}',
    /* swatches */
    '.sb-swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;}',
    '.sb-swatch{all:unset;cursor:pointer;border:1px solid color-mix(in oklab, var(--c-ink,#111) 12%, transparent);',
    '  border-radius:14px;overflow:hidden;font:inherit;display:block;}',
    '.sb-swatch:focus-visible{outline:2px solid var(--c-primary,#333);outline-offset:2px;}',
    '.sb-swatch-chip{height:72px;border-bottom:1px solid rgb(0 0 0 / .08);}',
    '.sb-swatch-meta{padding:10px 12px;font-size:.78rem;line-height:1.4;}',
    '.sb-swatch-name{font-weight:700;}',
    '.sb-swatch-val{color:var(--c-muted,#666);font-family:ui-monospace,monospace;word-break:break-all;}',
    '.sb-swatch.copied .sb-swatch-val::after{content:" — copied!";color:var(--c-success,#1a9a6c);font-weight:700;}',
    /* typography */
    '.sb-specimen{padding:16px 0;border-bottom:1px dashed color-mix(in oklab, var(--c-ink,#111) 15%, transparent);}',
    '.sb-specimen-label{font-size:.75rem;color:var(--c-muted,#666);font-family:ui-monospace,monospace;}',
    '.sb-viewport-tester{margin:20px 0;padding:16px;border:1px solid color-mix(in oklab, var(--c-ink,#111) 15%, transparent);border-radius:14px;}',
    '.sb-viewport-tester label{display:flex;gap:12px;align-items:center;font-size:.85rem;}',
    '.sb-viewport-tester input[type=range]{flex:1;accent-color:var(--c-primary,#333);}',
    '.sb-vp-out{font-family:ui-monospace,monospace;font-size:.85rem;min-width:9ch;text-align:right;}',
    /* demo surfaces */
    '.sb-row{display:flex;flex-wrap:wrap;gap:14px;align-items:center;}',
    '.sb-card{padding:24px;border-radius:14px;background:var(--c-surface,#fff);',
    '  border:1px solid color-mix(in oklab, var(--c-ink,#111) 12%, transparent);}',
    '.sb-card h3{margin:0 0 8px;}.sb-card p{margin:0;color:var(--c-muted,#666);}',
    '.sb-surface-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;padding:24px;',
    '  background:linear-gradient(120deg,color-mix(in oklab,var(--c-primary) 22%,var(--c-background)),var(--c-background));border-radius:18px;}',
    '.sb-tile{padding:28px;border-radius:18px;font-weight:600;min-height:110px;display:grid;place-content:center;text-align:center;}',
    /* demo components need a positioning context */
    '.sb-demo-tooltip,.sb-demo-dropdown{padding:12px;}',
    '@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important;}}'
  ].join('\n');

  /* Demo atoms (buttons / badges / cards) — expressed through the
   * shared --c-* tokens so they retint with the archetype switch. */
  var DEMO_ATOMS_CSS = [
    '.pai-btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:8px;',
    '  padding:.65em 1.3em;border-radius:10px;font-weight:600;font-size:.95rem;',
    '  background:var(--c-primary);color:var(--c-background,#fff);',
    '  transition:transform .15s ease, box-shadow .15s ease, background .15s ease;}',
    '.pai-btn:hover{box-shadow:0 6px 18px -6px rgb(0 0 0 / .35);transform:translateY(-1px);}',
    '.pai-btn:active{transform:translateY(0) scale(.98);}',
    '.pai-btn:focus-visible{outline:2px solid var(--c-ink);outline-offset:2px;}',
    '.pai-btn--secondary{background:var(--c-surface,#fff);color:var(--c-ink,#111);',
    '  border:1px solid color-mix(in oklab, var(--c-ink) 25%, transparent);}',
    '.pai-btn--ghost{background:transparent;color:var(--c-primary);}',
    '.pai-badge{display:inline-block;padding:.3em .85em;border-radius:9999px;',
    '  font-size:.75rem;font-weight:700;background:var(--c-primary);color:var(--c-background,#fff);}',
    '.pai-badge--muted{background:color-mix(in oklab, var(--c-ink) 12%, transparent);color:var(--c-ink);}',
    '.pai-badge--success{background:var(--c-success,#1a9a6c);color:#fff;}',
    '.pai-badge--danger{background:var(--c-danger,#d43a3a);color:#fff;}'
  ].join('\n');

  /* ---------------- inline page script ---------------- */

  var PAGE_SCRIPT = [
    '(function(){',
    '"use strict";',
    'var PAI = window.__PAI_STYLEBOOK__;',
    'var styleEl = document.getElementById("pai-components");',
    'function setArchetype(key, skipHash){',
    '  var arch = PAI.archetypes[key]; if(!arch) return;',
    '  styleEl.textContent = arch.css;',
    '  var root = document.documentElement.style;',
    '  Object.keys(arch.colors).forEach(function(k){ root.setProperty("--c-" + k, arch.colors[k]); });',
    '  document.body.dataset.archetype = key;',
    '  document.querySelectorAll(".sb-switcher button").forEach(function(b){',
    '    b.setAttribute("aria-pressed", String(b.dataset.archetype === key));',
    '  });',
    '  renderSwatches(arch.colors);',
    '  if(!skipHash) try { history.replaceState(null, "", "#" + key); } catch(e){}',
    '}',
    'function renderSwatches(colors){',
    '  var host = document.getElementById("sb-swatches");',
    '  host.textContent = "";',
    '  Object.keys(colors).forEach(function(name){',
    '    var v = colors[name];',
    '    var b = document.createElement("button");',
    '    b.className = "sb-swatch"; b.type = "button";',
    '    b.setAttribute("aria-label", "Copy " + name + " colour value");',
    '    var chip = document.createElement("span"); chip.className = "sb-swatch-chip"; chip.style.background = v;',
    '    var meta = document.createElement("span"); meta.className = "sb-swatch-meta";',
    '    var n = document.createElement("span"); n.className = "sb-swatch-name"; n.textContent = name;',
    '    var val = document.createElement("span"); val.className = "sb-swatch-val"; val.textContent = v;',
    '    meta.appendChild(n); meta.appendChild(document.createElement("br")); meta.appendChild(val);',
    '    b.appendChild(chip); b.appendChild(meta);',
    '    b.addEventListener("click", function(){ copyText(v, b); });',
    '    host.appendChild(b);',
    '  });',
    '}',
    'function copyText(text, el){',
    '  function done(ok){',
    '    if(!ok) return;',
    '    el.classList.add("copied");',
    '    setTimeout(function(){ el.classList.remove("copied"); }, 1400);',
    '  }',
    '  if(navigator.clipboard && navigator.clipboard.writeText){',
    '    navigator.clipboard.writeText(text).then(function(){ done(true); }, function(){ legacy(); });',
    '  } else legacy();',
    '  function legacy(){',
    '    var ta = document.createElement("textarea");',
    '    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";',
    '    document.body.appendChild(ta); ta.select();',
    '    var okk = false;',
    '    try { okk = document.execCommand("copy"); } catch(e){}',
    '    document.body.removeChild(ta); done(okk);',
    '  }',
    '}',
    'function evalClamp(str, vw){',
    '  var m = /^clamp\\(\\s*([-\\d.]+)rem\\s*,\\s*(.+?)\\s*,\\s*([-\\d.]+)rem\\s*\\)$/.exec(str);',
    '  if(!m) return null;',
    '  var pref = m[2]; var pr = /^\\s*([-\\d.]+)rem\\s*\\+\\s*([-\\d.]+)vw\\s*$/.exec(pref);',
    '  var rem = 16, vwPart = 0, remPart = 0;',
    '  if(pr){ remPart = parseFloat(pr[1]); vwPart = parseFloat(pr[2]); }',
    '  else { var vo = /^\\s*([-\\d.]+)vw\\s*$/.exec(pref); if(!vo) return null; vwPart = parseFloat(vo[1]); }',
    '  var px = remPart * rem + (vwPart / 100) * vw;',
    '  return Math.min(parseFloat(m[3]) * rem, Math.max(parseFloat(m[1]) * rem, px));',
    '}',
    'function initSpecimens(){',
    '  var rows = Array.prototype.slice.call(document.querySelectorAll(".sb-specimen"));',
    '  var slider = document.getElementById("sb-vp-slider");',
    '  var out = document.getElementById("sb-vp-out");',
    '  function apply(){',
    '    var vw = parseInt(slider.value, 10);',
    '    out.textContent = vw + "px";',
    '    rows.forEach(function(row){',
    '      var clampStr = row.dataset.clamp;',
    '      var px = evalClamp(clampStr, vw);',
    '      var probe = row.querySelector(".sb-specimen-probe");',
    '      var readout = row.querySelector(".sb-specimen-readout");',
    '      if(px != null && probe){ probe.style.fontSize = px + "px"; }',
    '      if(readout && px != null){ readout.textContent = px.toFixed(1) + "px"; }',
    '    });',
    '  }',
    '  slider.addEventListener("input", apply);',
    '  apply();',
    '}',
    'function initDemos(){',
    '  document.querySelectorAll(".pai-accordion__trigger").forEach(function(t){',
    '    t.addEventListener("click", function(){',
    '      var item = t.closest(".pai-accordion__item");',
    '      item.dataset.open = item.dataset.open === "true" ? "false" : "true";',
    '      t.setAttribute("aria-expanded", item.dataset.open);',
    '    });',
    '  });',
    '  document.querySelectorAll(".pai-tabs").forEach(function(tabs){',
    '    var tabEls = tabs.querySelectorAll(".pai-tabs__tab");',
    '    tabs.style.setProperty("--pai-tabs-count", tabEls.length);',
    '    tabs.style.setProperty("--pai-tabs-active", "0");',
    '    tabEls.forEach(function(tab, i){',
    '      tab.addEventListener("click", function(){',
    '        tabs.style.setProperty("--pai-tabs-active", String(i));',
    '        tabEls.forEach(function(t2, j){ t2.setAttribute("aria-selected", String(i === j)); });',
    '      });',
    '    });',
    '  });',
    '}',
    'document.querySelectorAll(".sb-switcher button").forEach(function(b){',
    '  b.addEventListener("click", function(){ setArchetype(b.dataset.archetype); });',
    '});',
    'var initial = (location.hash || "").slice(1);',
    'setArchetype(PAI.archetypes[initial] ? initial : PAI.active, true);',
    'initSpecimens();',
    'initDemos();',
    '})();'
  ].join('\n');

  /* ---------------- specimen + demo markup ---------------- */

  function specimenHTML(scale) {
    var rows = scale.map(function (r) {
      var lh = r.lineHeight == null ? 1.4 : r.lineHeight;
      var tr = r.tracking == null ? '0' : r.tracking;
      return (
        '<div class="sb-specimen" data-clamp="' + escHtml(r.clamp) + '">' +
        '<div class="sb-specimen-label">' + escHtml(r.role) +
        ' · <span class="sb-specimen-readout">—</span> · lh ' + escHtml(String(lh)) +
        ' · tracking ' + escHtml(tr) + '</div>' +
        '<div class="sb-specimen-probe" style="font-size:' + escHtml(r.clamp) + ';line-height:' + escHtml(String(lh)) + ';letter-spacing:' + escHtml(tr) + ';">' +
        'The quick brown fox jumps over the lazy dog 0123456789</div>' +
        '</div>'
      );
    }).join('\n');

    return (
      '<div class="sb-viewport-tester">' +
      '<label for="sb-vp-slider">Simulated viewport' +
      '<input id="sb-vp-slider" type="range" min="320" max="1600" step="8" value="1280" aria-describedby="sb-vp-out">' +
      '<output id="sb-vp-out" class="sb-vp-out" for="sb-vp-slider">1280px</output>' +
      '</label>' +
      '<p style="margin:8px 0 0;font-size:.8rem;color:var(--c-muted,#666);">' +
      'Probes below render at each clamp\u2019s evaluated size for the simulated width — the real page still scales with your actual window.</p>' +
      '</div>' +
      rows
    );
  }

  function componentsHTML() {
    return [
      '<h3>Buttons</h3><div class="sb-row">',
      '<button class="pai-btn" type="button">Primary</button>',
      '<button class="pai-btn pai-btn--secondary" type="button">Secondary</button>',
      '<button class="pai-btn pai-btn--ghost" type="button">Ghost</button>',
      '<button class="pai-btn" type="button" disabled style="opacity:.5;cursor:not-allowed;">Disabled</button>',
      '</div>',
      '<h3>Badges</h3><div class="sb-row">',
      '<span class="pai-badge">Default</span>',
      '<span class="pai-badge--muted pai-badge" style="background:color-mix(in oklab, var(--c-ink) 12%, transparent);color:var(--c-ink);">Muted</span>',
      '<span class="pai-badge" style="background:var(--c-success);">Success</span>',
      '<span class="pai-badge" style="background:var(--c-danger);">Danger</span>',
      '</div>',
      '<h3>Cards</h3>',
      '<div class="sb-grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));">',
      '<div class="sb-card"><h3>Standard card</h3><p>Body copy sits here. This card uses the archetype\u2019s surface tokens.</p></div>',
      '<div class="pai-clay sb-card" style="border:none;"><h3>Clay surface</h3><p>Rendered by the surface-shader engine from the active palette.</p></div>',
      '<div class="pai-glass sb-tile" style="min-height:0;">Glass surface</div>',
      '<div class="pai-neu sb-tile" style="min-height:0;background:var(--c-surface);">Neumorphic surface</div>',
      '</div>',
      '<h3>Form controls</h3>',
      '<div class="sb-grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">',
      '<label class="pai-input" style="display:block;"><span style="font-size:.8rem;font-weight:600;">Email</span>',
      '<input class="pai-input__field" type="email" placeholder="you@example.com" style="margin-top:6px;"></label>',
      '<label class="pai-input" style="display:block;"><span style="font-size:.8rem;font-weight:600;">With error</span>',
      '<input class="pai-input__field" type="text" value="not-an-email" aria-invalid="true" style="margin-top:6px;">',
      '<span class="pai-input__error">Please enter a valid email.</span></label>',
      '<label class="pai-switch"><span class="pai-switch__native" style="position:absolute;opacity:0;width:1px;height:1px;"></span>',
      '<input type="checkbox" class="pai-switch__native" style="position:absolute;opacity:0;width:1px;height:1px;">',
      '<span class="pai-switch__track"></span><span>Switch control</span></label>',
      '<label class="pai-switch"><input type="checkbox" class="pai-switch__native" style="position:absolute;opacity:0;width:1px;height:1px;" checked>',
      '<span class="pai-switch__track"></span><span>Checked state</span></label>',
      '</div>',
      '<h3>Accordion</h3>',
      '<div class="pai-accordion" style="max-width:560px;">',
      '<div class="pai-accordion__item" data-open="true">',
      '<button class="pai-accordion__trigger" type="button" aria-expanded="true"><span>What is this?</span><span class="pai-accordion__icon">\u203a</span></button>',
      '<div class="pai-accordion__panel"><div class="pai-accordion__panel-inner">A living stylebook: every component you see is styled by the same CSS that ships with your exported site.</div></div>',
      '</div>',
      '<div class="pai-accordion__item" data-open="false">',
      '<button class="pai-accordion__trigger" type="button" aria-expanded="false"><span>Can I switch archetype?</span><span class="pai-accordion__icon">\u203a</span></button>',
      '<div class="pai-accordion__panel"><div class="pai-accordion__panel-inner">Yes \u2014 use the switcher in the header. Components, palette, and surfaces all retint live.</div></div>',
      '</div>',
      '</div>',
      '<h3>Tabs</h3>',
      '<div class="pai-tabs" role="tablist" style="max-width:480px;">',
      '<span class="pai-tabs__indicator"></span>',
      '<button class="pai-tabs__tab" role="tab" aria-selected="true" type="button">Overview</button>',
      '<button class="pai-tabs__tab" role="tab" aria-selected="false" type="button">Specs</button>',
      '<button class="pai-tabs__tab" role="tab" aria-selected="false" type="button">Reviews</button>',
      '</div>'
    ].join('\n');
  }

  /* ---------------- main generator ---------------- */

  /**
   * generateStylebookHTML(tokenCatalog, archetypeKey, options)
   * options: { title = 'Stylebook', includeSurfaces = true }
   */
  StylebookGenerator.generateStylebookHTML = function (tokenCatalog, archetypeKey, options) {
    var opts = options || {};
    var catalog = tokenCatalog || {};
    var arch = ComponentLibrary.canonicalArchetype(archetypeKey || catalog.archetype);
    if (!arch) {
      return { ok: false, error: 'unknown archetype: ' + String(archetypeKey || catalog.archetype) };
    }

    // Colours: catalog wins, archetype defaults fill the rest.
    var provided = catalog.colors || {};
    var vres = validateColors(provided);
    if (!vres.ok) return vres;
    var colors = Object.assign({}, DEFAULT_PALETTES[arch], vres.colors);

    // Typography: catalog rows or a computed modular scale.
    var scale = catalog.typography;
    if (scale == null) scale = defaultTypoScale();
    if (!Array.isArray(scale) || scale.length === 0) {
      return { ok: false, error: 'catalog.typography must be a non-empty array when provided' };
    }
    for (var i = 0; i < scale.length; i++) {
      if (!validTypoRow(scale[i])) {
        return { ok: false, error: 'typography row ' + i + ' is invalid (role/clamp/lineHeight/tracking)' };
      }
    }

    // Per-archetype embedded registries: component CSS + palette.
    var archetypes = {};
    var primaries = {};
    for (var a = 0; a < ARCHETYPES.length; a++) {
      var key = ARCHETYPES[a];
      var all = ComponentLibrary.generateAll(key);
      var css = Object.keys(all.components).map(function (k) { return all.components[k].css; }).join('\n\n');
      css += '\n\n' + DEMO_ATOMS_CSS;
      if (opts.includeSurfaces !== false) {
        var surfaces = SurfaceShaders.generateAllShaders(
          SurfaceShaders.oklchToHex ? hexToOklch(colors.primary) : colors.primary
        );
        if (surfaces.ok) css += '\n\n' + surfaces.stylesheet;
      }
      archetypes[key] = { label: key, css: css, colors: key === arch ? colors : DEFAULT_PALETTES[key] };
      primaries[key] = DEFAULT_PALETTES[key].primary;
    }

    var title = String(opts.title || catalog.name || 'Stylebook');

    var html =
      '<!DOCTYPE html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<meta name="robots" content="noindex">\n' +
      '<title>' + escHtml(title) + ' \u2014 PallettAI Stylebook</title>\n' +
      '<style id="pai-base">\n' + BASE_CSS + '\n</style>\n' +
      '<style id="pai-components">/* populated by the archetype switcher */</style>\n' +
      '</head>\n' +
      '<body data-archetype="' + escHtml(arch) + '">\n' +
      '<div class="sb-wrap">\n' +
      '<header class="sb-head">\n' +
      '<h1>' + escHtml(title) + '</h1>\n' +
      '<p>Living stylebook \u00b7 Design DNA: <strong>' + escHtml(arch) + '</strong> \u00b7 v' + StylebookGenerator.STYLEBOOK_VERSION + '</p>\n' +
      '<div class="sb-switcher" role="group" aria-label="Switch Design DNA archetype">\n' +
      ARCHETYPES.map(function (k) {
        return '<button type="button" data-archetype="' + escHtml(k) + '" aria-pressed="false">' + escHtml(k) + '</button>';
      }).join('\n') +
      '\n</div>\n' +
      '</header>\n' +
      '<section id="colors"><h2 class="sb-title">Colour tokens</h2>' +
      '<p style="font-size:.85rem;color:var(--c-muted,#666);margin-top:-12px;">Click any swatch to copy its value.</p>' +
      '<div id="sb-swatches" class="sb-swatches"></div></section>\n' +
      '<section id="typography"><h2 class="sb-title">Typography</h2>' + specimenHTML(scale) + '</section>\n' +
      '<section id="components"><h2 class="sb-title">Components</h2>' + componentsHTML() + '</section>\n' +
      '</div>\n' +
      '<script>window.__PAI_STYLEBOOK__ = ' +
      '{ active: ' + escJs(arch) + ', archetypeLabels: ' + JSON.stringify(ARCHETYPES) +
      ', archetypes: { ' + Object.keys(archetypes).map(function (k) {
        return escJs(k) + ': { label: ' + escJs(k) + ', colors: ' + JSON.stringify(archetypes[k].colors) + ', css: ' + escJs(archetypes[k].css) + ' }';
      }).join(', ') + ' } };\n' +
      '</script>\n' +
      '<script>\n' + PAGE_SCRIPT + '\n</script>\n' +
      '</body>\n</html>\n';

    return {
      ok: true,
      html: html,
      byteLength: html.length,
      archetype: arch,
      sections: ['colors', 'typography', 'components'],
      archetypes: ARCHETYPES.slice(),
      colorTokenCount: Object.keys(colors).length,
      typographyRowCount: scale.length
    };
  };

  /* Hex → oklch object for tinting surfaces from palette hexes. */
  function hexToOklch(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return { l: 0.55, c: 0.14, h: 250 };
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    function lin(u) { return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }
    var R = lin(r), G = lin(g), B = lin(b);
    var l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
    var mm = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
    var s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
    var l_ = Math.cbrt(l), m_ = Math.cbrt(mm), s_ = Math.cbrt(s);
    var A = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    var Bb = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    var Cc = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    var c = Math.sqrt(Bb * Bb + Cc * Cc);
    var h = (Math.atan2(Cc, Bb) * 180 / Math.PI + 360) % 360;
    return { l: Math.min(1, Math.max(0, A)), c: c, h: h };
  }

  StylebookGenerator.hexToOklch = hexToOklch;
  StylebookGenerator.DEFAULT_PALETTES = DEFAULT_PALETTES;

  /* CommonJS + browser global */
  if (typeof module !== 'undefined' && module.exports) module.exports = StylebookGenerator;
  if (typeof window !== 'undefined') window.StylebookGenerator = StylebookGenerator;
})();

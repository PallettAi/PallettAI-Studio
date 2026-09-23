'use strict';

/*
  Design Tokens — the five knobs the export actually reads, wired to the project.

  Two things this panel must not do, because an earlier draft of it did:

  1. Promise a live update it cannot make. The preview is an opaque sandbox: it
     is srcdoc with scripting only, so the parent cannot reach into its document
     and there is no listener inside the exported page for a token message. It
     posts the message anyway, which looks live and does nothing. The honest
     version writes the token into the open project and repaints the preview —
     the same path every other editor control takes, so the change survives a
     reopen, lands in the export, and takes part in undo.
  2. Measure a pair nobody reads. "Brand colour vs surface" is a decorative pair;
     the ratio that decides whether a client's site is legible is body text on
     surface. That is the number in the badge, measured against the colours the
     open project resolves to (pushed in through sync()), and the brand pair is
     reported separately, under the control that changes it.

  The token names under each control are the ones buyer-visible CSS carries
  (--brand-color, --bg-surface, --sec-pad, --btn-radius, --btn-shadow), not the
  schema spellings, so what the panel promises is what the stylesheet contains.
*/
(function () {
  const $ = (s) => document.querySelector(s);

  // The project's values, in project terms. `text` is read-only: it comes from
  // the palette, and a legibility badge that can be argued with is worse than
  // none.
  const state = {
    brand: '#7cc0f8',
    surface: '#08203c',
    text: '#f2f6ff',
    space: 96,
    radius: '18px',
    shadow: '0 10px 30px rgba(0,0,0,.25)'
  };

  const hex = (v) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(v == null ? '' : v).trim());
    return m ? '#' + m[1].toLowerCase() : null;
  };
  const toRgb = (v) => {
    const h = hex(v);
    if (!h) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255);
  };
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  function ratio(a, b) {
    const x = toRgb(a), y = toRgb(b);
    if (!x || !y) return 0;
    const la = luminance(x), lb = luminance(y);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // AA for body text is 4.5:1; large text and non-text UI are 3:1.
  const verdict = (r, need) => (r >= need ? { pass: true, label: 'AA PASS' } : { pass: false, label: 'AA FAIL' });

  function paint() {
    const root = $('#tokenInspector');
    if (!root) return;
    const body = ratio(state.text, state.surface);
    const bodyVerdict = verdict(body, 4.5);
    const badge = root.querySelector('[data-body-ratio]');
    if (badge) {
      badge.textContent = bodyVerdict.label + ' \u00b7 ' + body.toFixed(2) + ':1';
      badge.className = 'token-ratio ' + (bodyVerdict.pass ? 'pass' : 'fail');
      badge.title = 'Body text ' + hex(state.text) + ' on surface ' + hex(state.surface) + ' \u2014 WCAG AA needs 4.5:1';
    }
    const brandRatio = root.querySelector('[data-brand-ratio]');
    if (brandRatio) {
      const r = ratio(state.brand, state.surface);
      const v = verdict(r, 3);
      brandRatio.textContent = r.toFixed(2) + ':1 ' + (v.pass ? 'AA' : 'below AA (3:1)');
      brandRatio.className = 'token-mini ' + (v.pass ? 'pass' : 'fail');
    }
    root.querySelectorAll('[data-value]').forEach((el) => {
      const key = el.dataset.value;
      if (key === 'space') el.textContent = state.space + 'px';
      if (key === 'radius') el.textContent = (parseFloat(state.radius) || 0) + 'px';
    });
  }

  // Only the keys that changed reach the project, so a slider drag is one token
  // per step rather than a wholesale design object rewritten from the panel's
  // idea of what the project holds.
  function push(key) {
    const api = window.PallettAITokens;
    if (!api || typeof api.onChange !== 'function') return;
    const patch = {};
    if (key === 'brand') patch.brandColor = hex(state.brand) || '';
    else if (key === 'surface') patch.bgSurface = hex(state.surface) || '';
    else if (key === 'space') patch.spacing = Number(state.space);
    else if (key === 'radius') patch.btnRadius = String(state.radius).slice(0, 40);
    else if (key === 'shadow') patch.btnShadow = String(state.shadow).slice(0, 160);
    if (Object.keys(patch).length) api.onChange(patch);
  }

  function render() {
    const root = $('#tokenInspector');
    if (!root) return;
    root.innerHTML = '<div class="token-head"><div>'
      + '<span class="eyebrow">LIVE DESIGN SYSTEM</span><h2>Design Tokens</h2>'
      + '<p>Five knobs the export reads: brand colour, surface, section rhythm, button radius and button shadow. Each change is written to the open project and repainted in the preview, so it survives a reopen, lands in the exported files and comes back with undo.</p>'
      + '</div><span class="token-ratio" data-body-ratio>\u2014</span></div>'
      + '<div class="token-grid">'
      + '<label class="token-control"><span>Brand colour</span>'
      + '<input type="color" data-token="brand" value="' + hex(state.brand) + '">'
      + '<code>--brand-color</code><em class="token-mini" data-brand-ratio></em></label>'
      + '<label class="token-control"><span>Surface colour</span>'
      + '<input type="color" data-token="surface" value="' + hex(state.surface) + '">'
      + '<code>--bg-surface</code><em class="token-mini">body text is checked against this</em></label>'
      + '<label class="token-control"><span>Section rhythm <b data-value="space">' + state.space + 'px</b></span>'
      + '<input type="range" min="24" max="180" step="4" data-token="space" value="' + state.space + '">'
      + '<code>--sec-pad</code></label>'
      // Up to 999px, because a pill button is the shipped default and a control
      // that cannot reach the value the export starts with is a control nobody
      // can put back.
      + '<label class="token-control"><span>Button radius <b data-value="radius">' + (parseFloat(state.radius) || 0) + 'px</b></span>'
      + '<input type="range" min="0" max="999" step="1" data-token="radius" value="' + (Math.max(0, Math.min(999, parseFloat(state.radius) || 0))) + '">'
      + '<code>--btn-radius</code></label>'
      + '<label class="token-control token-wide"><span>Button shadow</span>'
      + '<input type="text" data-token="shadow" value="' + String(state.shadow).replace(/"/g, '&quot;') + '">'
      + '<code>--btn-shadow</code></label>'
      + '</div>';
    root.querySelectorAll('[data-token]').forEach((el) => {
      el.addEventListener('input', () => {
        const key = el.dataset.token;
        // A range gives a number where the token is a length: store what the
        // stylesheet needs, not what the input happens to hold.
        if (key === 'radius') state.radius = el.value + 'px';
        else if (key === 'space') state.space = Number(el.value);
        else state[key] = el.value;
        push(key);
        paint();
      });
    });
    paint();
  }

  function sync(next) {
    if (!next || typeof next !== 'object') return;
    ['brand', 'surface', 'text', 'shadow'].forEach((k) => {
      if (typeof next[k] === 'string' && next[k]) state[k] = next[k];
    });
    if (Number.isFinite(Number(next.space))) state.space = Math.max(24, Math.min(180, Number(next.space)));
    if (next.radius != null && String(next.radius).trim()) state.radius = String(next.radius);
    if ($('#tokenInspector')) render();
  }

  function open() { render(); }

  window.PallettAITokens = { open: open, sync: sync, ratio: ratio, state: state, onChange: null };

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-view="tokens"]')) setTimeout(open, 0);
  });
})();

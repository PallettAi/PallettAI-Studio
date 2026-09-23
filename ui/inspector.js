'use strict';

(function () {
  const defaults = { brand: '#7cc0f8', surface: '#08203c', space: 88, radius: 10, shadow: '0 12px 30px rgba(0,0,0,.22)' };
  const state = Object.assign({}, defaults);
  const $ = (s) => document.querySelector(s);
  function hexRgb(v) { const m = /^#?([0-9a-f]{6})$/i.exec(String(v)); if (!m) return null; return [0,2,4].map(i => parseInt(m[1].slice(i,i+2), 16) / 255); }
  function lin(c) { return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }
  function contrast(a, b) { const x = hexRgb(a), y = hexRgb(b); if (!x || !y) return 0; const l1 = .2126*lin(x[0]) + .7152*lin(x[1]) + .0722*lin(x[2]); const l2 = .2126*lin(y[0]) + .7152*lin(y[1]) + .0722*lin(y[2]); return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05); }
  function post(vars) { const frame = document.querySelector('#previewFrame'); const message = { channel: 'pai-preview', type: 'design-tokens', vars }; if (frame && frame.contentWindow) frame.contentWindow.postMessage(message, '*'); window.postMessage(message, '*'); }
  function paint() {
    const root = $('#tokenInspector'); if (!root) return;
    const ratio = contrast(state.brand, state.surface); const pass = ratio >= 4.5;
    root.querySelector('[data-ratio]').textContent = `${pass ? 'PASS' : 'FAIL'} (${ratio.toFixed(1)}:1)`;
    root.querySelector('[data-ratio]').className = `token-ratio ${pass ? 'pass' : 'fail'}`;
  }
  function render() {
    const root = $('#tokenInspector'); if (!root) return;
    root.innerHTML = `<div class="token-head"><div><span class="eyebrow">LIVE DESIGN SYSTEM</span><h2>Design Tokens</h2><p>Adjust the visual DNA without rebuilding the preview.</p></div><span class="token-ratio" data-ratio>—</span></div>
      <div class="token-grid">
        <label class="token-control"><span>Brand colour</span><input type="color" data-token="brand" value="${state.brand}"><code>--brand-oklch</code></label>
        <label class="token-control"><span>Surface colour</span><input type="color" data-token="surface" value="${state.surface}"><code>--bg-surface</code></label>
        <label class="token-control"><span>Section space <b data-value="space">${state.space}px</b></span><input type="range" min="24" max="180" step="4" data-token="space" value="${state.space}"><code>--space-section</code></label>
        <label class="token-control"><span>Button radius <b data-value="radius">${state.radius}px</b></span><input type="range" min="0" max="9999" step="1" data-token="radius" value="${state.radius}"><code>--btn-radius</code></label>
        <label class="token-control token-wide"><span>Button shadow</span><input type="text" data-token="shadow" value="${state.shadow}"><code>--btn-shadow</code></label>
      </div>`;
    root.querySelectorAll('[data-token]').forEach((el) => el.addEventListener('input', () => { state[el.dataset.token] = el.type === 'range' ? Number(el.value) : el.value; const vars = { '--brand-oklch': state.brand, '--bg-surface': state.surface, '--space-section': `${state.space}px`, '--btn-radius': `${state.radius}px`, '--btn-shadow': state.shadow }; post(vars); const v = root.querySelector(`[data-value="${el.dataset.token}"]`); if (v) v.textContent = `${state[el.dataset.token]}px`; paint(); }));
    paint();
  }
  function open() { render(); }
  window.PallettAITokens = { open, contrast, state };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-view="tokens"]'); if (b) setTimeout(open, 0); });
})();

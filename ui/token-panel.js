'use strict';

// ============================================================
// PallettAI Studio — Design System Control Panel
// Exposes the GLM 5.3 Design DNA engine:
//   • sliders + colour pickers that emit OKLCH seed values
//   • palette harmony fetched from `generateHarmony` (with a local fallback)
//   • slider input wired to the Hot Module Patcher so previews repaint
//     instantly without a full page reload
//
// Colour maths implements Björn Ottosson's OKLab transform directly, so the
// panel can convert hex <-> OKLCH without shipping a colour library.
// ============================================================

(function (root) {
  const RUNTIME = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./runtime.js')
    : (root && root.PallettAIDashboardRuntime);

  /** Harmony schemes understood by both the bridge and the local fallback. */
  const HARMONY_SCHEMES = [
    { id: 'complementary', label: 'Complementary', offsets: [180] },
    { id: 'analogous', label: 'Analogous', offsets: [-30, 30] },
    { id: 'triadic', label: 'Triadic', offsets: [120, 240] },
    { id: 'split-complementary', label: 'Split complementary', offsets: [150, 210] },
    { id: 'tetradic', label: 'Tetradic', offsets: [90, 180, 270] },
    { id: 'monochromatic', label: 'Monochromatic', offsets: [0, 0, 0] }
  ];

  // ------------------------------------------------------------
  // Colour conversion (sRGB <-> OKLab <-> OKLCH)
  // ------------------------------------------------------------

  const SRGB_TO_LINEAR = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const LINEAR_TO_SRGB = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const cbrt = (x) => Math.cbrt(x);
  const deg = (rad) => (rad * 180) / Math.PI;
  const rad = (d) => (d * Math.PI) / 180;
  const norm360 = (h) => ((h % 360) + 360) % 360;

  /**
   * Parse `#rgb` / `#rrggbb` into 0..255 channel values.
   * Returns null for anything malformed so callers can keep the previous seed.
   */
  function parseHex(hex) {
    if (typeof hex !== 'string') return null;
    const value = hex.trim().replace(/^#/, '');
    if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(value)) return null;
    const full = value.length === 3
      ? value.split('').map((ch) => ch + ch).join('')
      : value;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16)
    };
  }

  function toHexString(rgb255) {
    const channel = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + channel(rgb255.r) + channel(rgb255.g) + channel(rgb255.b);
  }

  /** hex -> { l, c, h } in OKLCH (l 0..1, c unbounded, h degrees). */
  function hexToOklch(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return null;

    const r = SRGB_TO_LINEAR(rgb.r / 255);
    const g = SRGB_TO_LINEAR(rgb.g / 255);
    const b = SRGB_TO_LINEAR(rgb.b / 255);

    const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

    return {
      l: L,
      c: Math.sqrt(A * A + B * B),
      h: norm360(deg(Math.atan2(B, A)))
    };
  }

  /**
   * OKLCH -> hex. Out-of-gamut values are clamped per channel, which keeps the
   * picker usable at high chroma instead of returning NaN.
   */
  function oklchToHex(l, c, h) {
    const L = RUNTIME.clamp(Number(l) || 0, 0, 1);
    const C = Math.max(0, Number(c) || 0);
    const H = norm360(Number(h) || 0);

    const A = C * Math.cos(rad(H));
    const B = C * Math.sin(rad(H));

    const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
    const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
    const s_ = L - 0.0894841775 * A - 1.2914855480 * B;

    const lc = l_ * l_ * l_;
    const mc = m_ * m_ * m_;
    const sc = s_ * s_ * s_;

    const r = LINEAR_TO_SRGB(+4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc);
    const g = LINEAR_TO_SRGB(-1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc);
    const b = LINEAR_TO_SRGB(-0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc);

    return toHexString({ r: r * 255, g: g * 255, b: b * 255 });
  }

  /**
   * Local harmony generator, used when the bridge has no `generateHarmony`
   * channel. Mirrors the offsets the GLM engine uses so the UI never blocks.
   */
  function generateHarmonyLocal(seed, scheme, count) {
    const base = Object.assign({ l: 0.62, c: 0.16, h: 262 }, seed || {});
    const chosen = HARMONY_SCHEMES.find((s) => s.id === scheme) || HARMONY_SCHEMES[1];
    const offsets = chosen.offsets;
    const total = Math.max(1, Number(count) || offsets.length + 1);

    const swatches = [{
      role: 'primary',
      l: base.l, c: base.c, h: base.h,
      hex: oklchToHex(base.l, base.c, base.h)
    }];

    for (let i = 0; i < total - 1; i += 1) {
      const offset = offsets[i % offsets.length];
      // Monochromatic walks lightness instead of rotating hue.
      const isMono = chosen.id === 'monochromatic';
      const l = isMono
        ? RUNTIME.clamp(base.l + (i + 1) * 0.1, 0.15, 0.95)
        : base.l;
      const c = isMono ? Math.max(0.02, base.c * (1 - (i + 1) * 0.12)) : base.c;
      const h = norm360(base.h + offset);

      swatches.push({
        role: 'swatch-' + (i + 1),
        l, c, h,
        hex: oklchToHex(l, c, h)
      });
    }

    return {
      ok: true,
      source: 'local',
      scheme: chosen.id,
      seed: base,
      swatches
    };
  }

  /**
   * Create the token panel.
   *
   * @param {Object} options
   *   host    - { document, window } override for headless tests
   *   api     - IPC bridge (resolved automatically when omitted)
   *   tokens  - starting token set
   *   preview - element (or getter) whose CSS variables receive hot patches
   * @returns {Object} panel instance
   */
  function createTokenPanel(options) {
    const opts = options || {};
    const host = RUNTIME.createHost(opts.host || {});
    const api = opts.api || RUNTIME.resolveBridge({ host: opts.host });
    const emitter = RUNTIME.createEmitter();

    let tokens = Object.assign(RUNTIME.defaultTokens(), opts.tokens || {});
    let harmony = null;
    let mounted = false;
    let patchedCss = '';
    const cleanups = [];
    const refs = { root: null, swatches: null, status: null, source: null, outputs: {} };

    // ----------------------------------------------------------
    // Token mutation + hot patching
    // ----------------------------------------------------------

    function getTokens() {
      return JSON.parse(JSON.stringify(tokens));
    }

    /**
     * Merge a partial token update and push it to the Hot Module Patcher.
     *
     * The local CSS variables are always applied first so the user sees the
     * change immediately; the bridge call is fire-and-forget because the
     * preview iframe owns its own repaint.
     */
    function setTokens(partial, meta) {
      tokens = Object.assign({}, tokens, partial || {});
      if (partial && partial.seed) tokens.seed = Object.assign({}, tokens.seed, partial.seed);

      const derived = RUNTIME.deriveTokenSet(tokens);
      patchedCss = RUNTIME.tokensToCss(tokens);
      applyLocalPatch(derived);

      emitter.emit('change', { tokens: getTokens(), derived, reason: (meta && meta.reason) || 'update' });

      return derived;
    }

    /** Write the OKLCH custom properties onto the live document. */
    function applyLocalPatch(derived) {
      const doc = host.document;
      const target = (typeof opts.preview === 'function' ? opts.preview() : opts.preview) ||
        (doc && doc.documentElement) || refs.root;

      if (!target || !target.style) return false;

      try {
        Object.keys(derived.css).forEach((prop) => {
          if (typeof target.style.setProperty === 'function') {
            target.style.setProperty(prop, derived.css[prop]);
          } else {
            target.style[prop] = derived.css[prop];
          }
        });
      } catch (_) {
        return false;
      }

      return true;
    }

    /**
     * Send the new tokens through the GLM Hot Module Patcher so the preview
     * updates without a full reload. Tries the specific channel first, then
     * the generic patch channel, and always resolves.
     */
    function patchPreview(reason) {
      const payload = {
        scope: 'tokens',
        css: patchedCss,
        tokens: getTokens(),
        reason: reason || 'panel'
      };

      emitter.emit('patch:start', payload);

      let call;
      try {
        call = typeof api.patchTokens === 'function'
          ? api.patchTokens(payload)
          : (typeof api.applyHotPatch === 'function'
            ? api.applyHotPatch(payload)
            : Promise.resolve({ ok: false, offline: true, reason: 'no-patch-channel' }));
      } catch (err) {
        call = Promise.reject(err);
      }

      return Promise.resolve(call).then((res) => {
        const response = res || {};
        const online = response.ok !== false && !response.offline;
        if (refs.status) {
          refs.status.textContent = online
            ? 'Hot patch applied (' + (response.ms ? response.ms + 'ms' : 'live') + ')'
            : 'Applied locally \u2014 hot patch channel unavailable';
          refs.status.setAttribute('data-state', online ? 'ok' : 'warn');
        }
        emitter.emit('patch:done', response);
        return response;
      }).catch((err) => {
        if (refs.status) {
          refs.status.textContent = 'Hot patch failed: ' + (err && err.message ? err.message : err);
          refs.status.setAttribute('data-state', 'error');
        }
        emitter.emit('error', { scope: 'patch', error: err });
        return { ok: false, error: String(err && err.message ? err.message : err) };
      });
    }

    // ----------------------------------------------------------
    // Harmony
    // ----------------------------------------------------------

    /** Fetch a palette from the GLM engine, falling back to local maths. */
    function loadHarmony(scheme, count) {
      const chosen = scheme || tokens.harmony;
      const total = count || 5;
      const seed = tokens.seed;

      let call;
      try {
        call = api.generateHarmony(seed, chosen, total);
      } catch (err) {
        call = Promise.reject(err);
      }

      return Promise.resolve(call).then((res) => {
        const response = res || {};
        // A missing channel resolves to { offline: true }; treat that, and any
        // malformed payload, as a signal to use the local generator.
        const usable = response.ok !== false && !response.offline &&
          Array.isArray(response.swatches) && response.swatches.length > 0;

        harmony = usable
          ? Object.assign({ source: 'bridge' }, response)
          : generateHarmonyLocal(seed, chosen, total);

        renderSwatches();
        if (refs.source) {
          refs.source.textContent = harmony.source === 'bridge'
            ? 'Palette from GLM harmony engine'
            : 'Palette generated locally (harmony channel unavailable)';
          refs.source.setAttribute('data-state', harmony.source === 'bridge' ? 'ok' : 'warn');
        }

        emitter.emit('harmony', harmony);
        return harmony;
      }).catch(() => {
        harmony = generateHarmonyLocal(seed, chosen, total);
        renderSwatches();
        emitter.emit('harmony', harmony);
        return harmony;
      });
    }

    function getHarmony() {
      return harmony;
    }

    // ----------------------------------------------------------
    // Rendering
    // ----------------------------------------------------------

    function slider(label, key, attrs, onInput) {
      const field = host.el('div', { class: 'pai-field' });
      field.appendChild(host.el('label', {
        textContent: label,
        for: 'pai-' + key
      }));

      const input = host.el('input', Object.assign({
        id: 'pai-' + key,
        type: 'range',
        'data-token': key
      }, attrs));

      const output = host.el('output', {
        'data-output': key,
        textContent: String(input.value)
      });
      refs.outputs[key] = output;

      RUNTIME.on(input, 'input', () => {
        output.textContent = String(input.value);
        onInput(input.value);
      });

      field.appendChild(input);
      field.appendChild(output);
      return field;
    }

    function numberField(label, key, attr) {
      const field = host.el('div', { class: 'pai-field' });
      field.appendChild(host.el('label', { textContent: label, for: 'pai-' + key }));
      field.appendChild(host.el('input', {
        id: 'pai-' + key,
        type: 'number',
        step: 'any',
        'data-token': key,
        value: String(attr.value)
      }));
      return field;
    }

    function buildColorPicker() {
      const field = host.el('div', { class: 'pai-field' });
      field.appendChild(host.el('label', { textContent: 'Seed', for: 'pai-seed-color' }));

      const seed = tokens.seed;
      const picker = host.el('input', {
        id: 'pai-seed-color',
        type: 'color',
        'data-token': 'seedHex',
        value: oklchToHex(seed.l, seed.c, seed.h)
      });

      RUNTIME.on(picker, 'input', () => {
        const converted = hexToOklch(picker.value);
        if (!converted) return;
        // Preserve the user's chroma when the hex round-trip is in-gamut-neutral.
        syncSeed(converted, 'color-picker');
      });

      field.appendChild(picker);
      refs.outputs.seedHex = host.el('output', {
        'data-output': 'seedHex',
        textContent: oklchToHex(seed.l, seed.c, seed.h)
      });
      field.appendChild(refs.outputs.seedHex);
      return field;
    }

    /** Update the seed from any control and refresh dependents. */
    function syncSeed(partialSeed, reason) {
      const nextSeed = Object.assign({}, tokens.seed, partialSeed || {});
      setTokens({ seed: nextSeed }, { reason });

      // Keep the numeric outputs and colour input honest.
      if (refs.outputs.c) refs.outputs.c.textContent = nextSeed.c.toFixed(3);
      if (refs.outputs.h) refs.outputs.h.textContent = nextSeed.h.toFixed(0);
      if (refs.outputs.l) refs.outputs.l.textContent = nextSeed.l.toFixed(2);
      if (refs.outputs.seedHex) refs.outputs.seedHex.textContent = oklchToHex(nextSeed.l, nextSeed.c, nextSeed.h);

      renderSwatches();
      return nextSeed;
    }

    function buildControls() {
      const card = host.el('div', { class: 'pai-card' });
      card.appendChild(host.el('h3', { textContent: 'OKLCH seed' }));

      card.appendChild(buildColorPicker());

      card.appendChild(slider('Lightness', 'l', {
        min: '0', max: '1', step: '0.01', value: String(tokens.seed.l)
      }, (value) => syncSeed({ l: Number(value) }, 'lightness')));

      card.appendChild(slider('Chroma', 'c', {
        min: '0', max: '0.4', step: '0.005', value: String(tokens.seed.c)
      }, (value) => syncSeed({ c: Number(value) }, 'chroma')));

      card.appendChild(slider('Hue', 'h', {
        min: '0', max: '360', step: '1', value: String(tokens.seed.h)
      }, (value) => syncSeed({ h: Number(value) }, 'hue')));

      // ---- harmony ----
      const harmonyField = host.el('div', { class: 'pai-field' });
      harmonyField.appendChild(host.el('label', { textContent: 'Harmony', for: 'pai-harmony' }));
      const select = host.el('select', { id: 'pai-harmony', 'data-token': 'harmony' });
      HARMONY_SCHEMES.forEach((scheme) => {
        const option = host.el('option', { value: scheme.id, textContent: scheme.label });
        if (scheme.id === tokens.harmony) option.setAttribute('selected', '');
        select.appendChild(option);
      });
      RUNTIME.on(select, 'change', () => {
        setTokens({ harmony: select.value }, { reason: 'harmony-scheme' });
        loadHarmony(select.value);
      });
      harmonyField.appendChild(select);
      card.appendChild(harmonyField);

      // ---- geometry ----
      card.appendChild(slider('Radius', 'radius', {
        min: '0', max: '32', step: '1', value: String(tokens.radius)
      }, (value) => setTokens({ radius: Number(value) }, { reason: 'radius' })));

      card.appendChild(slider('Type scale', 'scale', {
        min: '1', max: '1.6', step: '0.01', value: String(tokens.scale)
      }, (value) => setTokens({ scale: Number(value) }, { reason: 'scale' })));

      const actions = host.el('div', { class: 'pai-field' });
      actions.appendChild(host.el('button', {
        type: 'button', class: 'pai-btn', 'data-variant': 'primary',
        'data-action': 'apply-tokens', textContent: 'Apply to preview',
        onClick: () => patchPreview('manual')
      }));
      actions.appendChild(host.el('button', {
        type: 'button', class: 'pai-btn',
        'data-action': 'refresh-harmony', textContent: 'Regenerate palette',
        onClick: () => loadHarmony()
      }));
      actions.appendChild(host.el('button', {
        type: 'button', class: 'pai-btn',
        'data-action': 'reset-tokens', textContent: 'Reset',
        onClick: () => reset()
      }));
      card.appendChild(actions);

      refs.status = host.el('p', { class: 'pai-status', 'data-role': 'patch-status', textContent: 'Idle' });
      card.appendChild(refs.status);

      return card;
    }

    function renderSwatches() {
      if (!refs.swatches) return;
      RUNTIME.clear(refs.swatches);

      const derived = RUNTIME.deriveTokenSet(tokens);
      const buttons = Object.keys(derived.color);

      buttons.forEach((name) => {
        const cell = host.el('div', { class: 'pai-swatch', 'data-swatch': name });
        const value = derived.color[name];
        cell.setAttribute('title', name + ': ' + value);
        cell.setAttribute('data-oklch', value);
        if (cell.style && typeof cell.style.setProperty === 'function') {
          cell.style.setProperty('background', value);
        }
        refs.swatches.appendChild(cell);
      });

      // Bridge/local harmony colours sit alongside the derived ramp.
      const list = harmony && Array.isArray(harmony.swatches) ? harmony.swatches : [];
      list.forEach((swatch, index) => {
        const cell = host.el('div', {
          class: 'pai-swatch',
          'data-harmony': swatch.role || ('swatch-' + index),
          title: (swatch.role || 'swatch') + ': ' + swatch.hex
        });
        if (cell.style && typeof cell.style.setProperty === 'function') {
          cell.style.setProperty('background', swatch.hex);
        }
        refs.swatches.appendChild(cell);
      });
    }

    function reset() {
      harmony = null;
      setTokens(RUNTIME.defaultTokens(), { reason: 'reset' });
      loadHarmony(tokens.harmony);
      return getTokens();
    }

    // ----------------------------------------------------------
    // Mount
    // ----------------------------------------------------------

    function mount(container) {
      const target = container || host.document.body;
      if (!target) throw new Error('TokenPanel.mount: no container element.');

      const layout = host.el('div', { 'data-role': 'token-panel' });
      layout.appendChild(buildControls());

      const previewCard = host.el('div', { class: 'pai-card' });
      previewCard.appendChild(host.el('h3', { textContent: 'Derived palette' }));
      refs.swatches = host.el('div', {
        class: 'pai-grid',
        'data-role': 'swatches',
        style: { gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }
      });
      previewCard.appendChild(refs.swatches);
      refs.source = host.el('p', { class: 'pai-status', 'data-role': 'harmony-source', textContent: 'Palette pending\u2026' });
      previewCard.appendChild(refs.source);

      layout.appendChild(previewCard);
      target.appendChild(layout);
      refs.root = target;

      // Publish the starting palette straight away: the shell and the preview
      // frame read the CSS variables, so mounting must not wait for the first
      // slider nudge to colour anything.
      setTokens({}, { reason: 'mount' });
      renderSwatches();
      loadHarmony();
      mounted = true;
      emitter.emit('mount', { tokens: getTokens() });
      return layout;
    }

    function destroy() {
      while (cleanups.length) {
        const fn = cleanups.pop();
        try { fn(); } catch (_) { /* ignore */ }
      }
      if (refs.root && refs.root.parentNode) refs.root.parentNode.removeChild(refs.root);
      mounted = false;
      emitter.removeAll();
    }

    const panel = {
      mount, destroy,
      // tokens
      getTokens, setTokens, reset,
      getDerived: () => RUNTIME.deriveTokenSet(tokens),
      getPatchedCss: () => patchedCss,
      // harmony
      loadHarmony, getHarmony,
      // preview
      patchPreview, applyLocalPatch: () => applyLocalPatch(RUNTIME.deriveTokenSet(tokens)),
      // introspection
      getElement: () => refs.root,
      getSwatches: () => refs.swatches,
      getStatus: () => (refs.status ? refs.status.textContent : null),
      isMounted: () => mounted,
      on: emitter.on, off: emitter.off, emit: emitter.emit,
      _internals: { refs, getRefs: () => refs, syncSeed }
    };

    return panel;
  }

  const tokenPanel = {
    createTokenPanel,
    HARMONY_SCHEMES,
    // colour maths is exported for reuse and direct testing
    hexToOklch,
    oklchToHex,
    parseHex,
    generateHarmonyLocal
  };

  if (root) root.PallettAITokenPanel = tokenPanel;
  if (typeof module !== 'undefined' && module.exports) module.exports = tokenPanel;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));

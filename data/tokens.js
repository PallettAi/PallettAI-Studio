'use strict';

// ============================================================
// Design tokens — hand the developer the system, not the pixels.
// ------------------------------------------------------------
// The export has always been finished HTML/CSS. That is the right artefact
// for the client, and the wrong one for the developer who has to extend it
// next quarter: they end up guessing which of the forty colours in the
// stylesheet is "the" blue.
//
// So the export now carries its own design system, derived from the same
// palette and type scale the site was built from:
//
//   design-tokens.css     custom properties, drop-in for any project
//   design-tokens.json    W3C-style, for Figma/Style Dictionary pipelines
//   tailwind.config.js    a working config, so a dev can carry on in Tailwind
//
// The Tailwind output has to be valid JavaScript, not a lookalike: the smoke
// test loads it and reads the values back out.
//
// Pure and offline.
// ============================================================

const Tokens = (() => {

  // The site's own spacing scale, in the same steps the stylesheet uses.
  const SPACE = [4, 8, 12, 16, 24, 32, 48, 64, 96, 128];

  const hex = (v) => {
    let h = String(v == null ? '' : v).trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) return null;
    if (h.length === 4) h = '#' + h.slice(1).split('').map((c) => c + c).join('');
    return h.toLowerCase();
  };

  const rgb = (v) => {
    const h = hex(v);
    if (!h) return null;
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  // WCAG relative luminance, so the token file can say whether a pair is
  // legible rather than leaving the developer to find out in a review.
  function luminance(v) {
    const c = rgb(v);
    if (!c) return null;
    const lin = c.map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    if (la == null || lb == null) return null;
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }

  const kebab = (s) => String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // ---- the token set --------------------------------------------------------
  function of(project) {
    const site = (project && project.site) || {};
    const pal = (typeof DB !== 'undefined' && DB.getPalette) ? DB.getPalette(site.palette) : (site.palette && typeof site.palette === 'object' ? site.palette : null);
    const font = (typeof DB !== 'undefined' && DB.getFont) ? DB.getFont(site.font) : (site.font && typeof site.font === 'object' ? site.font : null);
    const disp = (typeof DB !== 'undefined' && DB.getFont) ? DB.getFont(site.fontDisplay || site.font) : font;
    const d = site.design || {};

    const colors = {};
    if (pal) {
      [['bg', pal.bg], ['surface', pal.surface], ['primary', pal.primary], ['accent', pal.accent], ['text', pal.text], ['muted', pal.muted]]
        .forEach(([k, v]) => { const h = hex(v); if (h) colors[k] = h; });
    }

    const typography = {};
    if (font) typography.sans = String(font.css || '').trim() || "'Inter', sans-serif";
    if (disp && disp.css) typography.display = String(disp.css).trim();

    return {
      name: kebab((site.name || projectName(project)) || 'site') || 'site',
      paletteName: pal ? pal.name : '',
      dark: !!(pal && pal.dark),
      colors: colors,
      typography: typography,
      radius: { base: num(d.radius, 18), pill: 999, card: Math.round(num(d.radius, 18) * 1.4) },
      spacing: { section: num(d.spacing, 96), scale: SPACE.slice() },
      layout: { container: num(d.containerWidth, 1140) },
      fontWeights: weights(font)
    };
  }

  function num(v, fallback) { return typeof v === 'number' && isFinite(v) && v >= 0 ? v : fallback; }
  function projectName(project) { return (project && (project.name || project.id)) || 'site'; }

  // A font entry carries the weights the family was loaded with ("400;500;700").
  function weights(font) {
    const raw = String((font && font.weight) || '400;500;600;700').split(';');
    const out = {};
    raw.forEach((w) => {
      const n = parseInt(w, 10);
      if (!n) return;
      out[n >= 700 ? 'bold' : n >= 600 ? 'semibold' : n >= 500 ? 'medium' : 'regular'] = n;
    });
    return out;
  }

  // ---- CSS ------------------------------------------------------------------
  function css(project) {
    const t = of(project);
    const lines = [];
    lines.push('/* Design tokens — ' + (t.paletteName ? t.paletteName + ' palette · ' : '') + t.name + ' */');
    lines.push(':root {');
    Object.keys(t.colors).forEach((k) => lines.push('  --color-' + k + ': ' + t.colors[k] + ';'));
    if (t.typography.sans) lines.push('  --font-sans: ' + t.typography.sans + ';');
    if (t.typography.display) lines.push('  --font-display: ' + t.typography.display + ';');
    lines.push('  --radius-base: ' + t.radius.base + 'px;');
    lines.push('  --radius-card: ' + t.radius.card + 'px;');
    lines.push('  --radius-pill: ' + t.radius.pill + 'px;');
    lines.push('  --section-space: ' + t.spacing.section + 'px;');
    lines.push('  --container: ' + t.layout.container + 'px;');
    t.spacing.scale.forEach((s, i) => lines.push('  --space-' + (i + 1) + ': ' + s + 'px;'));
    lines.push('}');
    return lines.join('\n') + '\n';
  }

  // ---- JSON (W3C design-token shape) ----------------------------------------
  function json(project) {
    const t = of(project);
    const obj = {
      $description: 'Design tokens exported from PallettAi Studio for ' + t.name + (t.paletteName ? ' (' + t.paletteName + ')' : ''),
      palette: { $type: 'color', $value: undefined },
      color: {},
      font: {},
      radius: {},
      space: {},
      size: {}
    };
    delete obj.palette;
    Object.keys(t.colors).forEach((k) => { obj.color[k] = { $type: 'color', $value: t.colors[k] }; });
    if (t.typography.sans) obj.font.sans = { $type: 'fontFamily', $value: t.typography.sans };
    if (t.typography.display) obj.font.display = { $type: 'fontFamily', $value: t.typography.display };
    obj.radius.base = { $type: 'dimension', $value: t.radius.base + 'px' };
    obj.radius.card = { $type: 'dimension', $value: t.radius.card + 'px' };
    t.spacing.scale.forEach((s, i) => { obj.space['s' + (i + 1)] = { $type: 'dimension', $value: s + 'px' }; });
    obj.space.section = { $type: 'dimension', $value: t.spacing.section + 'px' };
    obj.size.container = { $type: 'dimension', $value: t.layout.container + 'px' };
    return JSON.stringify(obj, null, 2) + '\n';
  }

  // ---- Tailwind -------------------------------------------------------------
  // Emitted as a real config file, not a snippet: `module.exports` is what
  // `tailwind.config.js` has to be, and the smoke test requires it to prove it.
  function tailwind(project) {
    const t = of(project);
    const c = {};
    Object.keys(t.colors).forEach((k) => { c[k] = 'var(--color-' + k + ')'; });
    const fam = {};
    if (t.typography.sans) fam.sans = ['var(--font-sans)'];
    if (t.typography.display) fam.display = ['var(--font-display)'];
    const spacing = {};
    t.spacing.scale.forEach((s, i) => { spacing['s' + (i + 1)] = s + 'px'; });
    const radius = { base: t.radius.base + 'px', card: t.radius.card + 'px', pill: t.radius.pill + 'px' };
    return [
      '/** @type {import(\'tailwindcss\').Config} */',
      '// Generated by PallettAi Studio from the project palette and type scale.',
      '// Colors reference the CSS custom properties in design-tokens.css, so a',
      '// rebrand is one file, not a find-and-replace.',
      'module.exports = {',
      '  theme: {',
      '    extend: {',
      '      colors: ' + JSON.stringify(c, null, 6).replace(/\n/g, '\n      ') + ',',
      '      fontFamily: ' + JSON.stringify(fam, null, 6).replace(/\n/g, '\n      ') + ',',
      '      spacing: ' + JSON.stringify(spacing, null, 6).replace(/\n/g, '\n      ') + ',',
      '      borderRadius: ' + JSON.stringify(radius, null, 6).replace(/\n/g, '\n      ') + ',',
      '      maxWidth: { container: \'' + t.layout.container + 'px\' }',
      '    }',
      '  }',
      '};',
      ''
    ].join('\n');
  }

  // ---- handoff notes --------------------------------------------------------
  // The contrast pairs are checked here rather than asserted: if a palette is
  // failing AA, the developer should read that in the same file that gives
  // them the colours.
  function readme(project) {
    const t = of(project);
    const pairs = [['text', 'bg'], ['text', 'surface'], ['muted', 'bg'], ['bg', 'primary']];
    const rows = pairs
      .filter(([a, b]) => t.colors[a] && t.colors[b])
      .map(([a, b]) => {
        const r = contrast(t.colors[a], t.colors[b]);
        return '| `' + a + '` on `' + b + '` | ' + t.colors[a] + ' on ' + t.colors[b] + ' | ' + r + ':1 | ' + (r >= 4.5 ? 'AA' : r >= 3 ? 'AA large only' : 'fails') + ' |';
      });
    return [
      '# Design tokens — ' + t.name,
      '',
      'Generated from the project palette' + (t.paletteName ? ' (' + t.paletteName + ')' : '') + ' and type scale.',
      '',
      '| File | Use |',
      '| --- | --- |',
      '| `design-tokens.css` | import it, then use `var(--color-primary)` and friends |',
      '| `design-tokens.json` | Figma Tokens / Style Dictionary pipelines |',
      '| `tailwind.config.js` | drop beside a Tailwind build; it reads the custom properties |',
      '',
      '## Contrast',
      '',
      '| Pair | Value | Ratio | WCAG |',
      '| --- | --- | --- | --- |',
      rows.join('\n'),
      ''
    ].join('\n');
  }

  // Files that ride along in every export.
  function files(project) {
    return [
      { name: 'design-tokens.css', content: css(project) },
      { name: 'design-tokens.json', content: json(project) },
      { name: 'tailwind.config.js', content: tailwind(project) }
    ];
  }

  return { of, css, json, tailwind, readme, files, contrast, luminance, hex, SPACE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Tokens;

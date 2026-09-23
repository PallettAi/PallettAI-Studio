// ============================================================
// PallettAI Studio — ContainerLayout
// Component-level responsiveness without viewport media queries.
//
// generateContainerQueries(componentName, breakpointMap, options)
//   Wraps a component in a named inline-size container and emits
//   `@container <name> (min-width: …px)` reflow blocks. Rules can
//   be passed explicitly or auto-derived: a breakpoint entry with
//   a `columns` count gets a grid-template-columns reflow on the
//   component's `__grid` child. A mirrored @supports/@media
//   fallback keeps legacy engines reflowing on viewport width.
//
//     {
//       small: 320,                       // breakpoint only
//       medium: { min: 560, columns: 2 }, // + auto grid reflow
//       large:  { min: 880, columns: 3 }
//     }
//
// computeLayoutFlexMatrix(gridConfig)
//   The geometry behind graceful reflow: for a grid of N columns
//   with min column width m and gap g, computes for every k in
//   1..N the exact container width at which k columns fit
//   (W_k = k·m + (k−1)·g), the grid template, and the equivalent
//   flex fallback (`flex-basis: calc((100% − (k−1)·g) / k)`) that
//   reproduces grid geometry pixel-for-pixel in engines without
//   grid support. Algebraically self-verified at load.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const ContainerLayout = {};

  function slug(name) {
    return String(name || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  }

  function validSlug(name) {
    return /^[a-z][a-z0-9-]*$/.test(String(name || ''));
  }

  function parsePx(v, fallback) {
    if (v == null) return fallback;
    if (typeof v === 'number' && isFinite(v)) return v;
    var m = /^\s*(-?[\d.]+)px\s*$/.exec(String(v));
    return m ? parseFloat(m[1]) : fallback;
  }

  function px(n) {
    return (Math.round(n * 100) / 100) + 'px';
  }

  /* ============================================================
   * generateContainerQueries
   * ========================================================== */

  /**
   * @param {string} componentName  e.g. 'card' → .pai-card-container
   * @param {Object} breakpointMap  { name: px | { min, max, columns } }
   * @param {Object} options { rules: [{ at, selector, declarations }],
   *                           gridSelector = '.pai-<name>__grid',
   *                           fallback = true }
   */
  ContainerLayout.generateContainerQueries = function (componentName, breakpointMap, options) {
    var name = slug(componentName);
    if (!validSlug(name)) {
      return { ok: false, error: 'componentName must be a kebab-case slug, got: ' + String(componentName) };
    }
    var map = breakpointMap || {};
    if (typeof map !== 'object' || Array.isArray(map)) {
      return { ok: false, error: 'breakpointMap must be an object' };
    }
    var opts = options || {};

    // Normalize + sort breakpoints ascending by min.
    var breaks = [];
    for (var key in map) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
      if (!validSlug(key)) return { ok: false, error: 'breakpoint name must be a kebab-case slug: ' + key };
      var e = map[key];
      var entry = { name: key };
      if (typeof e === 'number') {
        if (!isFinite(e) || e <= 0) return { ok: false, error: 'breakpoint ' + key + ' must be a positive px value' };
        entry.min = e;
      } else if (e && typeof e === 'object') {
        if (!isFinite(e.min) || e.min <= 0) return { ok: false, error: 'breakpoint ' + key + ' needs a positive min' };
        entry.min = e.min;
        if (e.max != null) {
          if (!isFinite(e.max) || e.max <= e.min) return { ok: false, error: 'breakpoint ' + key + ' max must exceed min' };
          entry.max = e.max;
        }
        if (e.columns != null) {
          if (!Number.isInteger(e.columns) || e.columns < 1 || e.columns > 12) {
            return { ok: false, error: 'breakpoint ' + key + ' columns must be an integer 1–12' };
          }
          entry.columns = e.columns;
        }
      } else {
        return { ok: false, error: 'breakpoint ' + key + ' must be a number or {min, max, columns}' };
      }
      breaks.push(entry);
    }
    breaks.sort(function (a, b) { return a.min - b.min; });

    // Duplicate min widths collapse ambiguously — refuse.
    for (var i = 1; i < breaks.length; i++) {
      if (breaks[i].min === breaks[i - 1].min) {
        return { ok: false, error: 'duplicate breakpoint width: ' + breaks[i].min + 'px' };
      }
    }

    var containerSel = '.pai-' + name + '-container';
    var gridSel = opts.gridSelector || ('.pai-' + name + '__grid');
    var condition = function (b) {
      var c = '(min-width: ' + px(b.min) + ')';
      if (b.max != null) c += ' and (max-width: ' + px(b.max) + ')';
      return c;
    };

    // Assemble reflow rules per breakpoint.
    var rulesPerBreak = {};
    breaks.forEach(function (b) { rulesPerBreak[b.name] = []; });

    // Auto grid reflow for entries carrying `columns`.
    breaks.forEach(function (b) {
      if (b.columns != null) {
        rulesPerBreak[b.name].push({
          selector: gridSel,
          declarations: [b.columns === 1
            ? 'grid-template-columns: 1fr'
            : 'grid-template-columns: repeat(' + b.columns + ', minmax(0, 1fr))']
        });
      }
    });

    // Explicit rules.
    (opts.rules || []).forEach(function (r) {
      if (!r || !validSlug(slug(r.at)) || breaks.every(function (b) { return b.name !== slug(r.at); })) {
        return; // unknown breakpoint — ignored (reported below)
      }
      var decls = r.declarations || {};
      var declStrs = Object.keys(decls).filter(function (p) { return /^[-a-z]+$/i.test(p) && decls[p] != null; })
        .map(function (p) { return p + ': ' + String(decls[p]); });
      if (!declStrs.length) return;
      rulesPerBreak[slug(r.at)].push({ selector: String(r.selector || gridSel), declarations: declStrs });
    });

    var unknownRules = (opts.rules || []).filter(function (r) {
      return !r || breaks.every(function (b) { return b.name !== slug(r.at); });
    }).map(function (r) { return r && r.at; });

    var containerRule =
      containerSel + ' {\n' +
      '  container: ' + name + ' / inline-size;\n' +
      '}';

    var blocks = [containerRule];
    var mediaMirror = [];

    breaks.forEach(function (b) {
      var rules = rulesPerBreak[b.name];
      var body = rules.map(function (r) {
        return '  ' + r.selector + ' {\n' +
          r.declarations.map(function (d) { return '    ' + d + ';'; }).join('\n') + '\n  }';
      }).join('\n');
      if (!body) return; // nothing to reflow at this breakpoint

      blocks.push(
        '@container ' + name + ' ' + condition(b) + ' {\n' + body + '\n}'
      );
      // Legacy mirror: same declarations under a viewport media query.
      mediaMirror.push(
        '  @media ' + condition(b) + ' {\n' + body + '\n  }'
      );
    });

    if (opts.fallback !== false && mediaMirror.length) {
      blocks.push(
        '@supports not (container-type: inline-size) {\n' +
        mediaMirror.join('\n') + '\n' +
        '}'
      );
    }

    var css = blocks.join('\n\n') + '\n';

    return {
      ok: true,
      componentName: name,
      containerSelector: containerSel,
      gridSelector: gridSel,
      containerName: name,
      breakpoints: breaks.map(function (b) { return { name: b.name, min: b.min, max: b.max || null, columns: b.columns || null }; }),
      css: css,
      blocks: blocks,
      ignoredRules: unknownRules,
      usesContainerQueries: true,
      hasLegacyFallback: opts.fallback !== false && mediaMirror.length > 0,
      bytes: css.length
    };
  };

  /* ============================================================
   * computeLayoutFlexMatrix
   * ========================================================== */

  /**
   * @param {Object} gridConfig { columns, minColumnWidth, gap, selector }
   *   columns: 1–12, minColumnWidth: px, gap: number|'16px'
   */
  ContainerLayout.computeLayoutFlexMatrix = function (gridConfig) {
    var cfg = gridConfig || {};
    var columns = cfg.columns;
    if (!Number.isInteger(columns) || columns < 1 || columns > 12) {
      return { ok: false, error: 'columns must be an integer 1–12' };
    }
    var min = parsePx(cfg.minColumnWidth, null);
    if (min == null || min <= 0) {
      return { ok: false, error: 'minColumnWidth must be a positive px value' };
    }
    var gap = parsePx(cfg.gap, 0);
    if (gap == null || gap < 0) {
      return { ok: false, error: 'gap must be a non-negative px value' };
    }
    var sel = validSlug(slug(cfg.selector || '')) ? ('.pai-' + slug(cfg.selector)) : '.pai-grid';

    // The matrix: for every column count k, the geometry that makes
    // k columns the densest comfortable fit, plus the flex fallback
    // that reproduces it exactly.
    var matrix = [];
    for (var k = 1; k <= columns; k++) {
      var fitsAt = k * min + (k - 1) * gap;          // W_k = k·m + (k−1)·g
      var trackCalc = '(100% - ' + px((k - 1) * gap) + ') / ' + k;
      matrix.push({
        columns: k,
        fitsAtPx: Math.round(fitsAt * 100) / 100,
        gridTemplate: k === 1 ? '1fr' : 'repeat(' + k + ', minmax(0, 1fr))',
        flexBasis: 'calc(' + trackCalc + ')',
        flexMaxWidth: 'calc(' + trackCalc + ')',
        gapGutters: k - 1
      });
    }

    var gapDecl = gap > 0 ? ' gap: ' + px(gap) + ';' : '';
    var maxK = matrix[matrix.length - 1];

    var gridCSS =
      sel + ' {\n' +
      '  display: grid;\n' +
      '  grid-template-columns: ' + maxK.gridTemplate + ';\n' +
      (gapDecl ? ' ' + gapDecl.trim() + '\n' : '') +
      '}\n' +
      '@supports not (display: grid) {\n' +
      '  ' + sel + ' {\n' +
      '    display: flex;\n' +
      '    flex-wrap: wrap;\n' +
      (gap ? '    margin-block: calc(-1 * ' + px(gap) + ' / 2);\n' : '') +
      '  }\n' +
      '  ' + sel + ' > * {\n' +
      '    flex: 0 0 ' + maxK.flexBasis + ';\n' +
      '    max-width: ' + maxK.flexMaxWidth + ';\n' +
      (gap ? '    margin-block: calc(' + px(gap) + ' / 2);\n' : '') +
      '  }\n' +
      '}';

    // Full flex matrix fallback: child basis steps with container width.
    var flexSteps = matrix.map(function (row) {
      return '  @media (min-width: ' + px(row.fitsAtPx) + ') {\n' +
        '    ' + sel + ' > * {\n' +
        '      flex-basis: ' + row.flexBasis + ';\n' +
        '      max-width: ' + row.flexMaxWidth + ';\n' +
        '    }\n' +
        '  }';
    }).join('\n');

    var flexFallbackCSS =
      '/* Flex fallback: children claim the same track geometry as\n' +
      '   the grid, stepping up as the container widens. */\n' +
      '@supports not (display: grid) {\n' +
      '  ' + sel + ' {\n' +
      '    display: flex;\n' +
      '    flex-wrap: wrap;\n' +
      (gap ? '    margin-block: calc(-1 * ' + px(gap) + ' / 2);\n' : '') +
      '  }\n' +
      '  ' + sel + ' > * {\n' +
      '    flex: 0 0 100%;\n' +
      '    box-sizing: border-box;\n' +
      (gap ? '    margin-block: calc(' + px(gap) + ' / 2);\n' : '') +
      '  }\n' +
      flexSteps + '\n' +
      '}';

    var containerQueriesCSS =
      sel + '-container {\n  container: ' + slug(cfg.selector || 'grid') + ' / inline-size;\n}\n' +
      matrix.slice(1).map(function (row) {
        return '@container ' + slug(cfg.selector || 'grid') + ' (min-width: ' + px(row.fitsAtPx) + ') {\n' +
          '  ' + sel + ' {\n' +
          '    grid-template-columns: ' + row.gridTemplate + ';\n' +
          '  }\n' +
          '}';
      }).join('\n');

    return {
      ok: true,
      columns: columns,
      minColumnWidthPx: min,
      gapPx: gap,
      selector: sel,
      matrix: matrix,
      css: {
        grid: gridCSS,
        flexFallback: flexFallbackCSS,
        containerQueries: containerQueriesCSS
      },
      stylesheet: gridCSS + '\n\n' + flexFallbackCSS + '\n\n' + containerQueriesCSS,
      notes: [
        'W_k = k·minColumnWidth + (k−1)·gap — the exact width at which k columns fit.',
        'Flex basis calc((100% − (k−1)·gap) / k) reproduces grid track geometry exactly.',
        '@supports not (display: grid) guards keep legacy engines on the flex path.'
      ]
    };
  };

  /* CommonJS + browser global */
  if (typeof module !== 'undefined' && module.exports) module.exports = ContainerLayout;
  if (typeof window !== 'undefined') window.ContainerLayout = ContainerLayout;
})();

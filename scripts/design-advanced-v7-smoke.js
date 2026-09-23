#!/usr/bin/env node
// ============================================================
// PallettAI Studio — Design System v7 Smoke Runner
// Covers:
//   1. modules/token-compiler.js    (multi-file manifest, extends chain, validation, minified CSS)
//   2. modules/container-layout.js  (@container queries + flex/grid fallback matrix)
//   3. modules/micro-interactions.js (spring → cubic-bezier + interactive states)
//   4. modules/theme-migrator.js    (legacy CSS parse → archetype map → migration report)
// Plus a cross-module chain and determinism checks.
// Zero dependencies. Run: node scripts/design-advanced-v7-smoke.js
// ============================================================
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');

var TC = require('../modules/token-compiler.js');
var CL = require('../modules/container-layout.js');
var MI = require('../modules/micro-interactions.js');
var TM = require('../modules/theme-migrator.js');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pai-v7-'));
var PASS = 0, FAIL = 0, FAILURES = [], CRASH = null;

function ok(cond, label) {
  if (cond) { PASS++; return; }
  FAIL++; FAILURES.push(label);
  console.error('  x ' + label);
}
function eq(actual, expected, label) {
  ok(actual === expected, label + ' (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')');
}
function approx(actual, expected, tol, label) {
  ok(typeof actual === 'number' && Math.abs(actual - expected) <= (tol == null ? 1e-6 : tol),
    label + ' (got ' + actual + ', want ' + expected + ' +/- ' + (tol == null ? 1e-6 : tol) + ')');
}
function has(str, needle, label) { ok(String(str).indexOf(needle) !== -1, label + ' (missing "' + needle + '")'); }
function lacks(str, needle, label) { ok(String(str).indexOf(needle) === -1, label + ' (unexpected "' + needle + '")'); }
function re(pattern, str, label) { ok(pattern.test(String(str)), label + ' (pattern ' + pattern + ')'); }
function section(name) { console.log('\n== ' + name + ' =='); }
function writeFile(dir, name, content) {
  var p = path.join(dir, name);
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
}

function main() {
  /* ============================================================
     1. TOKEN COMPILER — multi-file manifest + inheritance
     ============================================================ */
  section('token-compiler: multi-file manifest + inheritance');

  var design = path.join(TMP, 'design');
  fs.mkdirSync(design, { recursive: true });

  // colors.json is a plain group body, referenced by file path.
  writeFile(design, 'colors.json', {
    brand: '#3B82F6', ink: '#0f172a', background: '#f8fafc', text: '#0f172a', muted: '#64748b'
  });

  var baseManifest = {
    name: 'acme',
    colors: 'colors.json',
    typography: {
      'size-body': '16px',
      'size-display': 'clamp(2rem, 1.2rem + 2.5vw, 3.5rem)',
      'line-body': 1.6
    },
    spacing: { sm: '8px', md: '16px', lg: '24px' },
    radii: { md: '12px' },
    shadows: { rest: '0 1px 2px rgba(15,23,42,.35)' },
    scopes: {
      dark: { colors: { background: '#0b1220', text: '#e2e8f0', brand: '#3B82F6' } }
    },
    archetypes: {
      'bento-glass': {
        radii: { md: '16px' },
        shadows: { rest: '0 4px 12px rgba(15,23,42,.3)' }
      }
    }
  };
  var basePath = writeFile(design, 'base.json', baseManifest);

  var compiled = TC.compileDesignTokens(basePath);
  ok(compiled.ok, 'manifest with file-referenced group compiles clean');
  eq(compiled.name, 'acme', 'manifest name carried through');
  eq(compiled.stats.tokens, 13, 'root token count (5 colors + 3 type + 3 spacing + 1 radius + 1 shadow)');
  eq(compiled.stats.scopes, 1, 'one scope registered');
  eq(compiled.stats.archetypes, 1, 'one archetype registered');
  eq(compiled.stats.errors, 0, 'no validation errors');

  // The bug this suite guards: internal bookkeeping keys must never
  // become tokens (they used to leak as --color-__dir and fail validation).
  ok(!Object.prototype.hasOwnProperty.call(compiled.byName, 'color-__dir'),
    'internal __dir key never leaks as a token from file references');
  ok(!Object.keys(compiled.byName).some(function (k) { return k.indexOf('__') !== -1; }),
    'no internal double-underscore keys in the token stream');
  ok(!compiled.tokens.some(function (t) { return t.valid === false; }),
    'every token from a file-referenced group validates');

  eq(compiled.byName['color-brand'].value, '#3B82F6', 'file-referenced colour token');
  eq(compiled.byName['type-size-body'].value, '16px', 'nested type token named type-size-body');
  eq(compiled.byName['type-line-body'].value, '1.6', 'unitless number preserved as string');
  eq(compiled.byName['spacing-sm'].value, '8px', 'spacing token named spacing-sm');
  eq(compiled.byName['radius-md'].value, '12px', 'radii → radius alias applied');
  has(compiled.byName['shadow-rest'].value, 'rgba', 'shadow value kept intact');
  has(compiled.byName['type-size-display'].value, 'clamp(', 'clamp() dimension token kept verbatim');
  eq(compiled.byName['type-size-body'].group, 'type', 'typography → type group alias');

  eq(compiled.scopes.dark.length, 3, 'dark scope flattened');
  eq(compiled.archetypes['bento-glass'].length, 2, 'archetype overrides flattened');
  eq(compiled.archetypes['bento-glass'][0].scope, 'bento-glass', 'archetype tokens tagged with scope');
  eq(compiled.pairs.length, 1, 'default contrast pair auto-derived');
  eq(compiled.pairs[0].fg, 'color-text', 'default pair foreground is color-text');
  eq(compiled.pairs[0].bg, 'color-background', 'default pair background is color-background');
  eq(compiled.contrastResults[0].status, 'pass', 'default pair passes contrast');
  ok(compiled.contrastResults[0].ratio > 15, 'ink on canvas is high contrast');

  // extends: child manifest object overriding one token
  var child = TC.compileDesignTokens({
    extends: basePath,
    colors: { brand: '#8B5CF6' }
  });
  ok(child.ok, 'child manifest with extends compiles');
  eq(child.stats.tokens, 13, 'child keeps the full inherited token set');
  eq(child.byName['color-brand'].value, '#8B5CF6', 'child override wins over parent');
  eq(child.byName['color-ink'].value, '#0f172a', 'non-overridden parent tokens inherit');

  // three-level chain: grandparent → parent → inline child
  var gp = writeFile(design, 'gp.json', { colors: { brand: '#000000', accent: '#ff0000' } });
  var parentPath = writeFile(design, 'p.json', { extends: gp, colors: { brand: '#111111' } });
  var grand = TC.compileDesignTokens({ extends: parentPath, colors: { brand: '#8B5CF6' } });
  ok(grand.ok, 'three-level extends chain compiles');
  eq(grand.byName['color-brand'].value, '#8B5CF6', 'deepest child wins the chain');
  eq(grand.byName['color-accent'].value, '#ff0000', 'root ancestor tokens survive the chain');

  /* ============================================================
     TOKEN COMPILER — minified CSS emission
     ============================================================ */
  section('token-compiler: minified CSS emission + scope diffing');

  var out = TC.generateOptimizedCSSVariables(compiled);
  ok(out.ok, 'CSS emission reports ok');
  eq(out.rootCount, 13, 'root block carries every valid token');
  eq(out.blocks.length, 3, 'three blocks: root + dark scope + archetype');
  eq(out.scopeBlockCount, 2, 'two variant blocks counted');
  eq(out.dropped.length, 0, 'nothing dropped when all tokens are valid');
  eq(out.bytes, out.css.length, 'byte count matches emitted css');

  var root = out.blocks[0];
  re(/^:root\{/, root, 'root block opens with :root{');
  eq(root.charAt(root.length - 1), '}', 'root block is brace-closed');
  eq(root.indexOf('\n'), -1, 'root block is minified onto one line');
  eq((root.match(/;/g) || []).length, 13, 'one declaration per token in root');
  eq((root.match(/--color-brand/g) || []).length, 1, 'no duplicate properties emitted');
  has(root, '--type-line-body:1.6', 'unitless line-height emitted raw');
  has(root, '--shadow-rest:0 1px 2px rgba(15,23,42,.35)', 'shadow value emitted intact');
  has(root, '--radius-md:12px', 'radius token emitted');
  ok(!/[;{]\s/.test(root), 'no padding whitespace between declarations in the minified root block');
  ok(!/\s\}/.test(root), 'no whitespace before the closing brace');

  var dark = out.blocks[1];
  re(/^\[data-theme="dark"\]\{/, dark, 'dark scope block selector');
  has(dark, '--color-background:#0b1220', 'dark background override emitted');
  has(dark, '--color-text:#e2e8f0', 'dark text override emitted');
  lacks(dark, '--color-brand', 'unchanged dark token diffed away');
  eq((dark.match(/;/g) || []).length, 2, 'only the two differing dark tokens emitted');

  var arch = out.blocks[2];
  re(/^\[data-archetype="bento-glass"\]\{/, arch, 'archetype block selector');
  has(arch, '--radius-md:16px', 'archetype radius override emitted');
  has(arch, '--shadow-rest:0 4px 12px rgba(15,23,42,.3)', 'archetype shadow override emitted');
  lacks(arch, '--color-brand', 'root colour not repeated in archetype block');

  eq(out.css.indexOf('\n\n'), -1, 'no blank lines between blocks');
  eq(out.css.charAt(out.css.length - 1), '\n', 'stylesheet terminated with newline');

  var custom = TC.generateOptimizedCSSVariables(compiled, { scopeAttribute: 'data-mode' });
  re(/^\[data-mode="dark"\]\{/, custom.blocks[1], 'custom scope attribute honoured');

  var badCompiled = TC.compileDesignTokens({ colors: { brand: 'oklch(1.4 0.3 200)', background: '#ffffff', text: '#111111' } });
  eq(badCompiled.ok, false, 'out-of-bounds OKLCH fails compile');
  var badCss = TC.generateOptimizedCSSVariables(badCompiled);
  ok(badCss.ok, 'CSS still emits for a compiled result with dropped tokens');
  eq(badCss.dropped.length, 1, 'invalid token reported as dropped');
  eq(badCss.dropped[0], 'color-brand', 'the invalid token is named');
  lacks(badCss.css, '--color-brand', 'invalid token never reaches the stylesheet');
  eq(badCss.rootCount, 2, 'only valid tokens emitted');

  ok(TC.generateOptimizedCSSVariables(null).ok === false, 'null input rejected by CSS emitter');
  ok(TC.generateOptimizedCSSVariables({}).ok === false, 'non-compiled object rejected by CSS emitter');

  /* ============================================================
     TOKEN COMPILER — semantic validation
     ============================================================ */
  section('token-compiler: semantic validation');

  function compileCodes(obj, opts) {
    var r = TC.compileDesignTokens(obj, opts);
    var codes = {};
    r.issues.forEach(function (i) {
      codes[i.code + ':' + i.severity] = (codes[i.code + ':' + i.severity] || 0) + 1;
    });
    return { ok: r.ok, codes: codes, result: r };
  }

  var a = compileCodes({ colors: { brand: 'oklch(1.4 0.3 200)' } });
  eq(a.ok, false, 'OKLCH lightness above 1 fails');
  ok(a.codes['oklch-l-bound:error'] === 1, 'oklch-l-bound raised as an error');
  eq(a.result.invalidTokens[0], 'color-brand', 'invalid token listed by name');

  var b = compileCodes({ colors: { brand: 'oklch(0.7 -0.1 200)' } });
  eq(b.ok, false, 'negative OKLCH chroma fails');
  ok(b.codes['oklch-c-bound:error'] === 1, 'oklch-c-bound raised as an error');

  var c = compileCodes({ colors: { brand: 'oklch(0.7 0.5 200)' } });
  eq(c.ok, true, 'out-of-gamut chroma is advisory, not fatal');
  ok(c.codes['oklch-gamut-risk:warning'] === 1, 'gamut risk raised as a warning');
  var cStrict = compileCodes({ colors: { brand: 'oklch(0.7 0.5 200)' } }, { strict: true });
  eq(cStrict.ok, false, 'strict mode promotes the gamut warning to an error');

  var d = compileCodes({ colors: { brand: '#zzz' } });
  eq(d.ok, false, 'malformed hex rejected');
  ok(d.codes['invalid-color:error'] === 1, 'invalid-color raised');

  var e = compileCodes({ colors: { text: '#4a4a4a', background: '#555555' } });
  eq(e.ok, true, 'low contrast is a warning by default');
  eq(e.result.contrastResults[0].status, 'fail', 'contrast pair reported as failing');
  approx(e.result.contrastResults[0].ratio, 1.19, 0.02, 'measured contrast ratio');
  eq(e.result.contrastResults[0].min, 4.5, 'default minimum is WCAG AA body text');
  ok(e.codes['contrast-fail:warning'] === 1, 'contrast-fail raised as a warning');
  var eStrict = compileCodes({ colors: { text: '#4a4a4a', background: '#555555' } }, { strict: true });
  eq(eStrict.ok, false, 'strict mode promotes contrast failure to an error');

  var f = compileCodes({ colors: { text: '#ffffff', background: '#ffffff' } });
  eq(f.ok, true, 'white-on-white is a warning, not a crash');
  eq(f.result.contrastResults[0].ratio, 1, 'white on white measured at 1:1');
  eq(f.result.contrastResults[0].status, 'fail', 'white on white fails');

  var g = compileCodes({ colors: { text: '#111111' }, pairs: [{ fg: 'color-text', bg: 'color-nope' }] });
  eq(g.ok, true, 'pair referencing a missing token does not break compilation');
  ok(g.codes['missing-contrast-pair:warning'] === 1, 'missing contrast pair flagged');
  eq(g.result.contrastResults[0].status, 'missing-token', 'unresolvable pair reported as missing-token');
  eq(g.result.contrastResults[0].ratio, null, 'no ratio invented for a missing pair');

  var h = compileCodes({ colors: { ink: '#111111' }, archetypes: { 'bento-glass': { colors: { brand: '#3B82F6' } } } });
  eq(h.ok, true, 'archetype-only token compiles');
  ok(h.codes['unmapped-archetype-token:warning'] === 1, 'archetype override without a root token flagged');

  var i = compileCodes({ colors: { ink: '#111111' }, archetypes: { 'not-a-real-style': { colors: { ink: '#222222' } } } });
  eq(i.ok, true, 'unknown archetype key does not break compilation');
  ok(i.codes['unknown-archetype:warning'] === 1, 'non-canonical archetype key flagged');

  var j = compileCodes({ colors: { ink: '#111111' }, scopes: { 'Bad Scope': { colors: { ink: '#222222' } } } });
  eq(j.ok, false, 'invalid scope name fails');
  ok(j.codes['bad-scope-name:error'] === 1, 'bad-scope-name raised');

  var k = compileCodes({ colors: { ink: { nested: { deep: true } }, ok: '#111111' } });
  eq(k.ok, false, 'unsupported token value type fails');
  ok(k.codes['bad-token-value:error'] === 1, 'bad-token-value raised');

  /* ============================================================
     TOKEN COMPILER — error paths
     ============================================================ */
  section('token-compiler: error paths');

  var missing = TC.compileDesignTokens(path.join(TMP, 'nope.json'));
  eq(missing.ok, false, 'missing manifest file fails');
  ok(missing.issues.some(function (i2) { return i2.code === 'file-unreadable'; }), 'file-unreadable reported');

  var malformed = writeFile(TMP, 'bad-syntax.json', '{ not json at all');
  var malformedResult = TC.compileDesignTokens(malformed);
  eq(malformedResult.ok, false, 'malformed JSON fails');
  ok(malformedResult.issues.some(function (i2) { return i2.code === 'file-invalid-json'; }), 'file-invalid-json reported');

  var circularA = path.join(TMP, 'circ-a.json');
  var circularB = writeFile(TMP, 'circ-b.json', { extends: circularA, colors: { ink: '#111111' } });
  writeFile(TMP, 'circ-a.json', { extends: circularB, colors: { ink: '#222222' } });
  var circular = TC.compileDesignTokens(circularA);
  eq(circular.ok, false, 'circular extends chain fails');
  ok(circular.issues.some(function (i2) { return i2.code === 'circular-extends'; }), 'circular-extends reported');

  var missingGroup = TC.compileDesignTokens({ colors: 'does-not-exist.json' });
  eq(missingGroup.ok, false, 'group referencing a missing token file fails');
  ok(missingGroup.issues.some(function (i2) { return i2.code === 'file-unreadable'; }), 'missing group file reported');

  var empty = TC.compileDesignTokens({});
  eq(empty.ok, true, 'empty manifest is not an error');
  eq(empty.stats.tokens, 0, 'empty manifest yields no tokens');
  eq(TC.generateOptimizedCSSVariables(empty).rootCount, 0, 'empty manifest emits an empty root');

  ok(TC.compileDesignTokens(null).ok === false, 'null manifest rejected');
  ok(TC.compileDesignTokens(42).ok === false, 'non-object manifest rejected');

  /* ============================================================
     2. CONTAINER LAYOUT — @container queries
     ============================================================ */
  section('container-layout: @container query generation');

  var breakpoints = {
    sm: { min: 320, columns: 1 },
    md: { min: 480, max: 719, columns: 2 },
    lg: { min: 720, columns: 3 }
  };
  var q = CL.generateContainerQueries('card', breakpoints, {
    rules: [{ at: 'sm', selector: '.pai-card__title', declarations: { 'font-size': '18px' } }]
  });

  ok(q.ok, 'container queries generate');
  eq(q.componentName, 'card', 'component name normalised');
  eq(q.containerName, 'card', 'container name matches component');
  eq(q.containerSelector, '.pai-card-container', 'container selector derived');
  eq(q.gridSelector, '.pai-card__grid', 'grid selector derived');
  eq(q.usesContainerQueries, true, 'flagged as container-query based');
  eq(q.hasLegacyFallback, true, 'legacy fallback present by default');
  eq(q.breakpoints.length, 3, 'all breakpoints reported');
  eq(q.breakpoints[0].name, 'sm', 'breakpoints kept in ascending order');
  eq(q.breakpoints[1].max, 719, 'range breakpoint max preserved');
  eq(q.breakpoints[2].columns, 3, 'column counts preserved');
  eq(q.blocks.length, 5, 'container rule + 3 query blocks + fallback');
  eq(q.bytes, q.css.length, 'byte count matches css length');

  has(q.blocks[0], '.pai-card-container', 'first block is the container declaration');
  has(q.blocks[0], 'container: card / inline-size', 'container-type declared as inline-size');

  var smBlock = q.blocks[1];
  has(smBlock, '@container card (min-width: 320px)', 'sm block uses named container query');
  has(smBlock, 'grid-template-columns: 1fr', 'single column reflow at the smallest breakpoint');
  has(smBlock, '.pai-card__title', 'explicit reflow rule attached to its breakpoint');
  has(smBlock, 'font-size: 18px', 'explicit declaration emitted');

  has(q.blocks[2], '@container card (min-width: 480px) and (max-width: 719px)', 'range query emitted');
  has(q.blocks[2], 'grid-template-columns: repeat(2, minmax(0, 1fr))', 'two-column reflow');
  has(q.blocks[3], 'grid-template-columns: repeat(3, minmax(0, 1fr))', 'three-column reflow');
  has(q.css, '@supports not (container-type: inline-size)', 'legacy guard emitted');
  has(q.css, '@media (min-width: 320px)', 'viewport mirror emitted for legacy engines');
  ok(q.css.indexOf('@media') > q.css.indexOf('@supports not (container-type'), 'view mirror lives inside the @supports guard');
  lacks(q.css, 'display: none', 'no destructive fallback declarations');

  var noFallback = CL.generateContainerQueries('card', { sm: { min: 320, columns: 1 } }, { fallback: false });
  eq(noFallback.hasLegacyFallback, false, 'fallback can be disabled');
  ok(!/@media/.test(noFallback.css), 'no viewport media queries when fallback is off');
  eq(noFallback.blocks.length, 2, 'container rule + one query block only');

  var unordered = CL.generateContainerQueries('card', { lg: { min: 720, columns: 3 }, sm: { min: 320, columns: 1 } });
  eq(unordered.breakpoints[0].name, 'sm', 'breakpoints sorted ascending regardless of declaration order');

  var numberForm = CL.generateContainerQueries('panel', { md: 480 });
  ok(numberForm.ok, 'plain number breakpoints accepted');
  eq(numberForm.breakpoints[0].min, 480, 'number treated as min width');
  eq(numberForm.blocks.length, 1, 'no reflow block when only widths are given');

  var ignored = CL.generateContainerQueries('card', breakpoints, {
    rules: [
      { at: 'xxl', selector: '.x', declarations: { color: 'red' } },
      { at: 'sm', selector: '.pai-card__x', declarations: {} }
    ]
  });
  eq(ignored.ignoredRules.length, 1, 'unknown breakpoint rule ignored');
  eq(ignored.ignoredRules[0], 'xxl', 'ignored rule reported by breakpoint name');

  var emptyMap = CL.generateContainerQueries('card', null);
  ok(emptyMap.ok, 'missing breakpoint map tolerated');
  eq(emptyMap.blocks.length, 1, 'only the container rule emitted with no breakpoints');

  eq(CL.generateContainerQueries('Bad Name!', breakpoints).ok, false, 'non-slug component name rejected');
  eq(CL.generateContainerQueries('card', { 'Bad Key': 320 }).ok, false, 'non-slug breakpoint name rejected');
  eq(CL.generateContainerQueries('card', { sm: 0 }).ok, false, 'non-positive breakpoint rejected');
  eq(CL.generateContainerQueries('card', { sm: { min: 400 }, md: { min: 400 } }).ok, false, 'duplicate widths rejected');
  eq(CL.generateContainerQueries('card', { sm: { min: 480, max: 320 } }).ok, false, 'inverted range rejected');
  eq(CL.generateContainerQueries('card', { sm: { min: 320, columns: 13 } }).ok, false, 'column count above 12 rejected');
  eq(CL.generateContainerQueries('card', 'nope').ok, false, 'non-object breakpoint map rejected');

  /* ============================================================
     CONTAINER LAYOUT — flex/grid fallback matrix
     ============================================================ */
  section('container-layout: flex/grid fallback matrix');

  var fm = CL.computeLayoutFlexMatrix({ columns: 3, minColumnWidth: 200, gap: 24 });
  ok(fm.ok, 'flex matrix computes');
  eq(fm.columns, 3, 'column count echoed');
  eq(fm.minColumnWidthPx, 200, 'min column width parsed');
  eq(fm.gapPx, 24, 'gap parsed');
  eq(fm.selector, '.pai-grid', 'default selector applied');
  eq(fm.matrix.length, 3, 'one row per column count');

  eq(fm.matrix[0].fitsAtPx, 200, 'W_1 = 1*200 + 0*24');
  eq(fm.matrix[1].fitsAtPx, 424, 'W_2 = 2*200 + 1*24');
  eq(fm.matrix[2].fitsAtPx, 648, 'W_3 = 3*200 + 2*24');
  eq(fm.matrix[0].gridTemplate, '1fr', 'single-column template');
  eq(fm.matrix[2].gridTemplate, 'repeat(3, minmax(0, 1fr))', 'three-column template');
  eq(fm.matrix[2].flexBasis, 'calc((100% - 48px) / 3)', 'flex basis reproduces the grid track');
  eq(fm.matrix[1].flexBasis, 'calc((100% - 24px) / 2)', 'two-column flex basis');
  eq(fm.matrix[2].gapGutters, 2, 'gutter count for three columns');
  eq(fm.matrix[0].gapGutters, 0, 'no gutters for a single column');

  has(fm.css.grid, 'display: grid', 'grid fallback declares display grid');
  has(fm.css.grid, 'grid-template-columns: repeat(3, minmax(0, 1fr))', 'grid template in stylesheet');
  has(fm.css.grid, 'gap: 24px', 'gap declared when positive');
  has(fm.css.grid, '@supports not (display: grid)', 'legacy guard for engines without grid');
  has(fm.css.grid, 'display: flex', 'flex fallback declared');
  has(fm.css.grid, 'flex: 0 0 calc((100% - 48px) / 3)', 'children claim the same track geometry');
  has(fm.css.flexFallback, '@media (min-width: 424px)', 'flex fallback steps up with container width');
  has(fm.css.flexFallback, '@media (min-width: 648px)', 'final flex step present');
  has(fm.css.flexFallback, 'flex: 0 0 100%', 'flex fallback starts full width');
  has(fm.css.containerQueries, '.pai-grid-container', 'container wrapper derived from selector');
  has(fm.css.containerQueries, 'container: grid / inline-size', 'container named from selector');
  has(fm.css.containerQueries, '@container grid (min-width: 424px)', 'container query per step');
  has(fm.css.containerQueries, '@container grid (min-width: 648px)', 'final container query step');
  ok(fm.stylesheet.indexOf(fm.css.flexFallback) > fm.stylesheet.indexOf(fm.css.grid), 'stylesheet composes grid then flex then container queries');

  var noGap = CL.computeLayoutFlexMatrix({ columns: 2, minColumnWidth: 150, gap: 0, selector: 'feature Cards' });
  eq(noGap.selector, '.pai-feature-cards', 'custom selector slugified');
  ok(!/gap:/.test(noGap.css.grid), 'no gap declaration when gap is zero');
  eq(noGap.matrix[1].fitsAtPx, 300, 'gap of zero keeps W_2 = 2*150');

  eq(CL.computeLayoutFlexMatrix({ columns: 13, minColumnWidth: 200 }).ok, false, 'column count above 12 rejected');
  eq(CL.computeLayoutFlexMatrix({ columns: 0, minColumnWidth: 200 }).ok, false, 'zero columns rejected');
  eq(CL.computeLayoutFlexMatrix({ columns: 2.5, minColumnWidth: 200 }).ok, false, 'fractional columns rejected');
  eq(CL.computeLayoutFlexMatrix({ columns: 3 }).ok, false, 'missing min column width rejected');
  eq(CL.computeLayoutFlexMatrix({ columns: 3, minColumnWidth: 0 }).ok, false, 'zero min column width rejected');
  eq(CL.computeLayoutFlexMatrix({ columns: 3, minColumnWidth: 200, gap: -4 }).ok, false, 'negative gap rejected');

  /* ============================================================
     3. MICRO-INTERACTIONS — spring → cubic-bezier
     ============================================================ */
  section('micro-interactions: spring → cubic-bezier');

  var nearCritical = MI.generateSpringTransition(170, 26);
  ok(nearCritical.ok, 'near-critical spring fits');
  re(/^cubic-bezier\([\d.-]+, [\d.-]+, [\d.-]+, [\d.-]+\)$/, nearCritical.cubicBezier, 'bezier string well formed');

  function bezierNumbers(bezier) {
    return bezier.replace(/^cubic-bezier\(|\)$/g, '').split(',').map(function (s) { return parseFloat(s); });
  }
  var nc = bezierNumbers(nearCritical.cubicBezier);
  eq(nc.length, 4, 'four control values');
  ok(nc[0] >= 0 && nc[0] <= 1 && nc[2] >= 0 && nc[2] <= 1, 'control x values stay within [0,1]');
  approx(nearCritical.damping, 26 / (2 * Math.sqrt(170)), 1e-4, 'damping ratio ζ = F/(2√T)');
  eq(nearCritical.underdamped, true, '170/26 is (just) underdamped');
  approx(nearCritical.overshoot, 0, 0.02, 'near-critical spring barely overshoots');
  ok(nearCritical.durationMs > 0, 'positive duration');
  eq(nearCritical.settleMs >= nearCritical.durationMs, true, 'settle time at least the driven duration');
  ok(nearCritical.fitError < 0.2, 'fitted curve tracks the simulated spring');
  has(nearCritical.transition, 'cubic-bezier', 'transition string carries the curve');
  has(nearCritical.transition, nearCritical.durationMs + 'ms', 'transition carries the fitted duration');

  var bouncy = MI.generateSpringTransition(100, 8);
  ok(bouncy.ok, 'bouncy spring fits');
  eq(bouncy.underdamped, true, '100/8 is strongly underdamped');
  ok(bouncy.overshoot > 0.2, 'bouncy spring overshoots visibly (' + bouncy.overshoot + ')');
  var bn = bezierNumbers(bouncy.cubicBezier);
  ok(bn[1] > 1 || bn[3] > 1, 'bounce encoded as control y above 1 (legal in CSS)');
  ok(bn[0] >= 0 && bn[0] <= 1 && bn[2] >= 0 && bn[2] <= 1, 'bounce keeps legal x values');
  ok(bouncy.durationMs > nearCritical.durationMs, 'bouncier spring takes longer to settle');

  var overdamped = MI.generateSpringTransition(120, 40);
  ok(overdamped.ok, 'overdamped spring fits');
  eq(overdamped.underdamped, false, '120/40 is overdamped');
  approx(overdamped.overshoot, 0, 1e-6, 'overdamped spring never overshoots');
  var od = bezierNumbers(overdamped.cubicBezier);
  ok(od[0] >= 0 && od[0] <= 1 && od[2] >= 0 && od[2] <= 1, 'overdamped curve keeps legal x values');

  var stiff = MI.generateSpringTransition(300, 22);
  ok(stiff.ok, 'stiff spring fits');
  ok(stiff.durationMs < bouncy.durationMs, 'stiffer spring settles sooner');
  ok(stiff.cubicBezier !== bouncy.cubicBezier, 'different tuning yields a different curve');

  eq(MI.generateSpringTransition(170, 26).cubicBezier, nearCritical.cubicBezier, 'spring fit is deterministic');

  eq(MI.generateSpringTransition(0, 26).ok, false, 'zero tension rejected');
  eq(MI.generateSpringTransition(170, 0).ok, false, 'zero friction rejected');
  eq(MI.generateSpringTransition(-10, 26).ok, false, 'negative tension rejected');
  eq(MI.generateSpringTransition(2000, 26).ok, false, 'tension above the cap rejected');
  eq(MI.generateSpringTransition(170, 500).ok, false, 'friction above the cap rejected');
  ok(MI.generateSpringTransition('x', 26).ok === false, 'non-numeric tension rejected');

  /* ============================================================
     MICRO-INTERACTIONS — interactive state CSS
     ============================================================ */
  section('micro-interactions: interactive state CSS');

  var states = MI.generateInteractiveStatesCSS('button');
  ok(states.ok, 'button states generate');
  eq(states.componentType, 'button', 'component type canonicalised');
  eq(states.selector, '.pai-button', 'default selector derived');
  eq(states.usesHardwareAcceleration, true, 'flagged as hardware accelerated');
  eq(states.hasReducedMotionGuard, true, 'reduced-motion guard present');
  eq(states.animatedProperties.join(','), 'transform', 'button animates transform only');
  eq(states.bytes, states.css.length, 'byte count matches css');
  has(states.css, '.pai-button {', 'base rule emitted');
  has(states.css, 'transition: transform 150ms cubic-bezier', 'transition uses transform + a bezier');
  has(states.css, 'will-change: transform', 'will-change declared for compositing');
  has(states.css, ':hover', 'hover state emitted');
  has(states.css, '@media (hover: hover)', 'hover gated on real pointer devices');
  has(states.css, ':active', 'active state emitted');
  has(states.css, 'transition-duration: 90ms', 'press reacts faster than hover');
  has(states.css, ':focus-visible', 'focus-visible state emitted');
  has(states.css, 'outline: 2px solid', 'visible focus ring');
  has(states.css, ':disabled', 'disabled state emitted');
  has(states.css, '[aria-disabled="true"]', 'aria-disabled covered');
  has(states.css, 'pointer-events: none', 'disabled state is inert');
  has(states.css, 'prefers-reduced-motion', 'reduced-motion media query emitted');
  ok(!/\b(width|height|margin|padding|top|left|bottom|right):/.test(states.css),
    'no layout-thrashing properties animated');
  eq(states.states.join(','), 'hover,active,focus-visible,disabled', 'state list reported');

  var linkStates = MI.generateInteractiveStatesCSS('link');
  ok(linkStates.ok, 'link states generate');
  eq(linkStates.animatedProperties.join(','), 'transform,opacity', 'link also animates opacity');
  has(linkStates.css, 'opacity: 0.8', 'hover opacity applied');
  has(linkStates.css, 'will-change: transform, opacity', 'both properties hinted');

  var custom = MI.generateInteractiveStatesCSS('chip', { selector: '.badge', durationMs: 5000, easing: 'ease-out' });
  ok(custom.ok, 'custom selector, duration and easing accepted');
  has(custom.css, '.badge', 'custom selector honoured');
  has(custom.css, 'transform 800ms', 'duration clamped to the documented maximum');
  has(custom.css, 'ease-out', 'CSS keyword easing accepted');

  var noGuard = MI.generateInteractiveStatesCSS('button', { reducedMotionGuard: false });
  eq(noGuard.hasReducedMotionGuard, false, 'guard can be disabled');
  lacks(noGuard.css, 'prefers-reduced-motion', 'no reduced-motion block when disabled');

  ok(MI.generateInteractiveStatesCSS('btn').componentType === 'button', 'btn alias resolves');
  ok(MI.generateInteractiveStatesCSS('tab').componentType === 'nav', 'tab alias resolves');
  ok(MI.generateInteractiveStatesCSS('badge').componentType === 'chip', 'badge alias resolves');
  ok(MI.generateInteractiveStatesCSS('switch').componentType === 'toggle', 'switch alias resolves');
  ok(MI.generateInteractiveStatesCSS('dialog').componentType === 'modal', 'dialog alias resolves');
  ok(MI.generateInteractiveStatesCSS('field').componentType === 'input', 'field alias resolves');

  var unknown = MI.generateInteractiveStatesCSS('widget');
  eq(unknown.ok, false, 'unknown component type rejected');
  has(unknown.error, 'button', 'error lists known component types');
  eq(MI.generateInteractiveStatesCSS('button', { easing: 'wobble' }).ok, false, 'invalid easing rejected');
  ok(MI.STATE_PRESETS.length >= 8, 'preset catalogue exposed');

  var inputStates = MI.generateInteractiveStatesCSS('input');
  ok(inputStates.ok, 'input states generate');
  lacks(inputStates.css, ':hover', 'input preset deliberately has no hover transform');
  has(inputStates.css, ':focus-visible', 'input keeps its focus ring');

  var bundle = MI.generateInteractionBundle('button', { tension: 170, friction: 26 });
  ok(bundle.ok, 'interaction bundle composes spring + states');
  eq(bundle.spring.cubicBezier, nearCritical.cubicBezier, 'bundle reuses the fitted spring');
  has(bundle.css, bundle.spring.cubicBezier, 'bundle CSS wires the spring curve in');
  has(bundle.css, bundle.spring.durationMs + 'ms', 'bundle CSS uses the spring duration');
  eq(MI.generateInteractionBundle('widget').ok, false, 'bundle rejects unknown component types');

  /* ============================================================
     4. THEME MIGRATOR — legacy parse
     ============================================================ */
  section('theme-migrator: legacy stylesheet parsing');

  var legacyCss = [
    '/* legacy css - do not edit */',
    "body { font-family: Georgia, serif; color: #1a1a1a; background-color: #faf8f5; font-size: 17px; }",
    "h1 { font-family: Playfair Display, serif; font-size: 42px; content: '#00ff00'; }",
    '.btn {',
    '  background: linear-gradient(135deg, #c0392b 0%, #8e2b20 100%);',
    '  color: #ffffff;',
    '  border-radius: 4px;',
    '  padding: 12px 24px;',
    '  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);',
    '}',
    '.card { background: #ffffff; border-radius: 6px; padding: 24px; }',
    '.footer { color: #555555; font-size: 14px; }',
    '/* commented-out: .gone { color: #123456; } */'
  ].join('\n');

  var parsed = TM.parseLegacyStylesheet(legacyCss);
  ok(parsed.ok, 'legacy stylesheet parses');
  eq(parsed.stats.rules, 5, 'rule count');
  eq(parsed.stats.declarations, 17, 'declaration count');
  eq(parsed.stats.uniqueColors, 7, 'unique colour count');
  eq(parsed.stats.uniqueFonts, 2, 'unique font count');
  eq(parsed.stats.pxDeclarations, 7, 'px declaration count');
  eq(parsed.colors.length, 7, 'colour list length');
  eq(parsed.fonts.length, 2, 'font list length');

  var hexes = parsed.colors.map(function (c) { return c.value; }).sort().join(',');
  eq(hexes, '#000000,#1a1a1a,#555555,#8e2b20,#c0392b,#faf8f5,#ffffff', 'every distinct colour captured');
  ok(parsed.colors.some(function (c) { return c.value === '#c0392b' && c.count === 1; }), 'gradient stop captured with provenance');
  ok(parsed.colors.some(function (c) { return c.value === '#ffffff' && c.count === 2; }), 'repeated colour counted across rules');
  ok(parsed.colors.some(function (c) { return c.rgba === true && c.alpha === 0.25; }), 'rgba() colour converted with alpha kept');
  ok(parsed.colors.some(function (c) { return c.value === '#000000'; }), 'rgba(0,0,0) converted to hex');
  ok(parsed.colors.every(function (c) { return c.context && c.prop && typeof c.line === 'number'; }), 'every colour keeps selector/property/line provenance');
  ok(!parsed.colors.some(function (c) { return c.value === '#00ff00'; }), 'quoted colour string is not migrated');
  ok(!parsed.colors.some(function (c) { return c.value === '#123456'; }), 'commented-out colour is not migrated');

  ok(parsed.fonts.some(function (f) { return f.family === 'Georgia'; }), 'font stack head captured');
  ok(parsed.fonts.some(function (f) { return f.family === 'Playfair Display'; }), 'display font captured');
  ok(parsed.sizes.some(function (s) { return s.px === 42 && /h1/.test(s.context); }), 'heading size captured with context');
  ok(parsed.radii.some(function (r) { return r.px === 4; }), 'radius captured');
  ok(parsed.spacing.some(function (s) { return s.px === 12; }) && parsed.spacing.some(function (s) { return s.px === 24; }), 'multi-value spacing shorthand split');
  eq(TM.parseLegacyStylesheet('').ok, false, 'empty stylesheet rejected');
  eq(TM.parseLegacyStylesheet(null).ok, false, 'null stylesheet rejected');

  /* ============================================================
     THEME MIGRATOR — archetype mapping + OKLCH
     ============================================================ */
  section('theme-migrator: archetype mapping + OKLCH');

  var mapping = TM.mapLegacyToArchetype(parsed);
  ok(mapping.ok, 'mapping succeeds');
  eq(mapping.archetype, 'editorial-magazine', 'serif editorial site maps to Editorial Magazine');
  ok(mapping.confidence > 0.5, 'confidence above coin flip');
  eq(mapping.scores.length, 6, 'all six archetypes scored');
  eq(mapping.scores[0].archetype, mapping.archetype, 'winner heads the score list');
  ok(mapping.scores[0].score > mapping.scores[5].score, 'scores strictly ordered');
  ok(mapping.scores[0].evidence.length > 0, 'winner carries supporting evidence');

  var paletteRoles = Object.keys(mapping.palette).sort().join(',');
  eq(paletteRoles, 'background,ink,muted,primary,secondary,surface', 'semantic roles assigned');
  eq(mapping.palette.primary.hex, '#c0392b', 'brand red becomes primary');
  eq(mapping.palette.background.hex, '#faf8f5', 'body background-colour claims the canvas role');
  eq(mapping.palette.surface.hex, '#ffffff', 'white card becomes surface');
  eq(mapping.palette.ink.hex, '#1a1a1a', 'body text becomes ink');
  re(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/, mapping.palette.primary.oklch, 'primary converted to OKLCH');
  ok(!JSON.stringify(mapping.palette).match(/NaN/), 'no NaN leaks into the palette');
  approx(mapping.palette.primary.h, 29.7, 0.1, 'primary hue preserved through conversion');
  approx(mapping.palette.primary.l, 0.543, 0.01, 'primary lightness correct');
  eq(mapping.palette.muted.derived, true, 'muted neutral flagged as derived, not extracted');
  approx(mapping.palette.muted.c, 0.03, 1e-6, 'derived neutral is low chroma');
  re(/^#[0-9a-f]{6}$/, mapping.palette.muted.hex, 'derived neutral has a hex fallback');
  eq(mapping.conversions.length, mapping.palette ? parsed.colors.length : 0, 'every colour has a conversion entry');
  ok(mapping.conversions.every(function (cv) { return /^oklch\(/.test(cv.to); }), 'conversions emit OKLCH strings');

  var red = TM.hexToOklch('#ff0000');
  approx(red.l, 0.628, 0.001, '#ff0000 lightness');
  approx(red.c, 0.258, 0.001, '#ff0000 chroma');
  approx(red.h, 29.23, 0.01, '#ff0000 hue');
  eq(TM.hexToOklch('#000000').l, 0, 'black lightness');
  eq(TM.hexToOklch('#000000').c, 0, 'black chroma');
  approx(TM.hexToOklch('#ffffff').l, 1, 1e-6, 'white lightness');
  approx(TM.wcagRatio('#000000', '#ffffff'), 21, 0.01, 'WCAG black on white is 21:1');
  approx(TM.wcagRatio('#ffffff', '#ffffff'), 1, 1e-6, 'WCAG white on white is 1:1');
  eq(TM.ARCHETYPES.length, 6, 'six Design DNA archetypes exposed');
  eq(TM.mapLegacyToArchetype({ ok: false }).ok, false, 'mapping rejects a failed parse');

  /* ============================================================
     THEME MIGRATOR — migration report
     ============================================================ */
  section('theme-migrator: migration report');

  var delta = {
    parse: parsed,
    mapping: mapping,
    converted: mapping.conversions.map(function (cv) { return { rule: cv.context, from: cv.from, to: cv.to }; }),
    manual: [{ rule: '.btn background', reason: 'linear-gradient needs manual treatment' }]
  };
  var report = TM.generateMigrationReport(delta);
  ok(report.ok, 'report generates');
  eq(report.archetype, 'editorial-magazine', 'report names the mapped archetype');
  eq(report.confidence, mapping.confidence, 'report carries mapping confidence');
  ok(typeof report.generatedAt === 'string' && report.generatedAt.length > 0, 'report timestamped');
  eq(report.summary.rulesScanned, parsed.stats.rules, 'rules scanned carried through');
  eq(report.summary.declarationsScanned, parsed.stats.declarations, 'declarations scanned carried through');
  eq(report.summary.colorsFound, parsed.stats.uniqueColors, 'colours found carried through');
  eq(report.summary.colorsConverted, mapping.conversions.length, 'converted colour count');
  eq(report.summary.tokensEmitted, 6, 'semantic token count');
  eq(report.summary.converted, mapping.conversions.length, 'converted rule count');
  eq(report.summary.manualReview, 1, 'manual review count');
  eq(report.converted.length, mapping.conversions.length, 'itemized converted list');
  eq(report.manualReview.length, 1, 'itemized manual list');
  eq(report.manualReview[0].rule, '.btn background', 'manual item preserved');
  eq(report.contrastChecks.length, 3, 'three contrast pairs checked');
  ok(report.contrastChecks.every(function (ch) { return ch.pass === true; }), 'healthy palette passes every contrast gate');
  ok(report.contrastChecks.some(function (ch) { return ch.pair === 'ink/background' && ch.ratio > 10; }), 'ink on canvas measured');
  eq(report.archetypeScores.length, 6, 'archetype scores included in the report');
  eq(report.warnings.length, 0, 'no warnings for a clean migration');

  var lowContrastCss = 'body { color: #333333; background-color: #444444; }';
  var lowParsed = TM.parseLegacyStylesheet(lowContrastCss);
  var lowMapping = TM.mapLegacyToArchetype(lowParsed);
  var lowReport = TM.generateMigrationReport({ parse: lowParsed, mapping: lowMapping, converted: [], manual: [] });
  ok(lowReport.ok, 'low-contrast site still produces a report');
  var failedPairs = lowReport.contrastChecks.filter(function (ch) { return ch.pass === false; });
  ok(failedPairs.length >= 1, 'failing contrast pair detected');
  eq(lowReport.summary.manualReview, failedPairs.length, 'each failing pair escalated to manual review');
  ok(lowReport.manualReview.some(function (m) { return /contrast/i.test(m.reason); }), 'escalation reason names contrast');
  ok(lowReport.warnings.some(function (w) { return /contrast/i.test(w); }), 'warning text names the contrast failure');

  eq(TM.generateMigrationReport({ parse: null, mapping: null }).ok, false, 'report rejects missing inputs');
  eq(TM.generateMigrationReport({ parse: parsed, mapping: { ok: false } }).ok, false, 'report rejects a failed mapping');
  eq(TM.generateMigrationReport(null).ok, false, 'report rejects null delta');

  /* ============================================================
     5. CROSS-MODULE CHAIN
     ============================================================ */
  section('cross-module: legacy site → Design DNA tokens → layout → motion');

  var pal = mapping.palette;
  var migratedManifest = {
    name: 'migrated-editorial',
    colors: {
      brand: pal.primary.hex,
      secondary: pal.secondary.hex,
      text: pal.ink.hex,
      background: pal.background.hex,
      surface: pal.surface.hex,
      muted: pal.muted.hex
    },
    typography: {
      'size-body': '17px',
      'size-display': 'clamp(2.5rem, 1.7rem + 4vw, 4.5rem)',
      'line-body': 1.6
    },
    spacing: { sm: '12px', md: '24px' },
    radii: { md: '6px' },
    shadows: { rest: '0 2px 4px rgba(0,0,0,0.25)' },
    pairs: [
      { fg: 'color-text', bg: 'color-background', min: 4.5 },
      { fg: 'color-brand', bg: 'color-background', min: 3 }
    ]
  };

  var migrated = TC.compileDesignTokens(migratedManifest);
  ok(migrated.ok, 'migrated palette compiles into a token set');
  eq(migrated.stats.tokens, 13, 'migrated token count');
  eq(migrated.contrastResults.length, 2, 'declared contrast pairs evaluated');
  ok(migrated.contrastResults.every(function (cr) { return cr.status === 'pass'; }), 'migrated palette clears both contrast gates');
  ok(migrated.contrastResults.some(function (cr) { return cr.fg === 'color-brand' && cr.ratio > 3; }), 'brand on canvas measured after migration');

  var migratedCss = TC.generateOptimizedCSSVariables(migrated);
  ok(migratedCss.ok, 'migrated tokens emit CSS');
  has(migratedCss.css, '--color-brand:' + pal.primary.hex, 'migrated brand colour reaches the stylesheet');
  has(migratedCss.css, '--shadow-rest:0 2px 4px rgba(0,0,0,0.25)', 'migrated shadow reaches the stylesheet');
  lacks(migratedCss.css, 'NaN', 'no NaN in migrated CSS');
  lacks(migratedCss.css, 'undefined', 'no undefined in migrated CSS');

  var migratedCard = CL.generateContainerQueries('card', {
    sm: { min: 320, columns: 1 },
    lg: { min: 720, columns: 3 }
  }, { rules: [{ at: 'sm', selector: '.pai-card__title', declarations: { 'font-size': '18px' } }] });
  ok(migratedCard.ok, 'container queries generate for the migrated card');
  has(migratedCard.css, '@container card (min-width: 720px)', 'migrated card reflows at the large container width');
  has(migratedCard.css, '.pai-card__title', 'migrated typography rule attached');

  var migratedGrid = CL.computeLayoutFlexMatrix({ columns: 3, minColumnWidth: 280, gap: 24, selector: 'feature-grid' });
  ok(migratedGrid.ok, 'flex matrix computes for the migrated grid');
  eq(migratedGrid.matrix[2].fitsAtPx, 888, 'W_3 = 3*280 + 2*24');
  has(migratedGrid.stylesheet, 'display: grid', 'grid path emitted');
  has(migratedGrid.stylesheet, '@supports not (display: grid)', 'flex fallback emitted');

  var migratedMotion = MI.generateInteractionBundle('button', { tension: 170, friction: 26, selector: '.pai-btn' });
  ok(migratedMotion.ok, 'interaction bundle composes for the migrated site');
  has(migratedMotion.css, '.pai-btn', 'migrated button selector honoured');
  has(migratedMotion.css, migratedMotion.spring.cubicBezier, 'spring easing wired into the migrated button');
  has(migratedMotion.css, ':focus-visible', 'migrated button stays keyboard accessible');

  /* ============================================================
     DETERMINISM
     ============================================================ */
  section('determinism: repeated runs produce identical output');

  eq(TC.compileDesignTokens(basePath).stats.tokens, compiled.stats.tokens, 'token count stable across recompiles');
  eq(TC.generateOptimizedCSSVariables(TC.compileDesignTokens(basePath)).css, out.css, 'compiled CSS byte-identical across runs');
  eq(TM.generateMigrationReport(delta).summary.colorsConverted, report.summary.colorsConverted, 'migration summary stable');
  eq(JSON.stringify(TM.generateMigrationReport(delta).contrastChecks), JSON.stringify(report.contrastChecks), 'contrast checks identical across runs');
  eq(TM.mapLegacyToArchetype(parsed).archetype, mapping.archetype, 'archetype mapping stable across runs');
  eq(CL.computeLayoutFlexMatrix({ columns: 3, minColumnWidth: 200, gap: 24 }).stylesheet, fm.stylesheet, 'layout stylesheet byte-identical across runs');
  eq(MI.generateInteractiveStatesCSS('button').css, states.css, 'state CSS stable across runs');
  eq(MI.generateSpringTransition(170, 26).cubicBezier, nearCritical.cubicBezier, 'spring fitting stable across runs');
}

try { main(); } catch (e) { CRASH = e; }

console.log('\n========================================');
console.log('PASSED: ' + PASS + '   FAILED: ' + FAIL);
if (FAIL) console.log('failed checks:\n - ' + FAILURES.join('\n - '));
if (CRASH) console.error('\nCRASHED: ' + CRASH.message + '\n' + CRASH.stack);
console.log('========================================');
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
process.exit((FAIL || CRASH) ? 1 : 0);

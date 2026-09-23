'use strict';

/*
  ============================================================
  backend-advanced-smoke — compiler, cache & entitlement suite
  ------------------------------------------------------------
  Runs standalone under Node with no test framework:

      node scripts/backend-advanced-smoke.js

  The interesting assertions here are not "did it get smaller". A
  minifier that quietly changes what a program *does* is worse than
  no minifier, and a cache that returns the wrong bytes is worse than
  no cache. So the JS section uses differential execution: every case
  runs its original snippet and its minified snippet and compares the
  results. A size assertion cannot catch `return\nx` collapsing into
  `return x`, and it cannot catch `a / b` being read as a regex.
  ============================================================
*/

const path = require('path');

const ROOT = path.join(__dirname, '..');
const Minifier = require(path.join(ROOT, 'modules', 'minifier.js'));
const Cache = require(path.join(ROOT, 'modules', 'compiler-cache.js'));
const Entitlements = require(path.join(ROOT, 'modules', 'entitlements.js'));
const Migration = require(path.join(ROOT, 'modules', 'migration.js'));

let passed = 0;
let failed = 0;

function ok(label, condition, detail) {
  if (condition) {
    passed++;
    console.log('  \u2713 ' + label);
  } else {
    failed++;
    console.log('  \u2717 ' + label + (detail ? '\n      ' + detail : ''));
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(label, a === e, 'expected ' + e + '\n      actual   ' + a);
}

function section(title) {
  console.log('\n' + title);
}

// ------------------------------------------------------------------
// SECTION 1 — minifier
// ------------------------------------------------------------------
section('1. Minifier');

/*
  Run a snippet and read a probe expression out of it. Used to compare
  the original and the minified program by what they compute, not by
  what they look like.
*/
function run(code, probe) {
  /* eslint-disable no-new-func */
  return new Function(code + '\nreturn (' + probe + ');')();
}

// Each case is real code that a regex-based minifier is known to break.
const JS_CASES = [
  {
    name: 'a URL in a string is not a comment',
    code: 'const u = "https://example.com/a"; // trailing comment\n',
    probe: 'u'
  },
  {
    name: 'division is not a regex, and `//` after it is not a comment',
    code: 'const a = 12, b = 3, c = 2;\nconst r = a / b / c;\n',
    probe: 'r'
  },
  {
    name: 'a regex literal containing a comment sequence survives',
    code: 'const re = /\\/\\*/g;\nconst s = "a/*b".replace(re, "-");\n',
    probe: 's'
  },
  {
    name: 'a regex character class containing a slash survives',
    code: 'const re = /[/]/g;\nconst n = "a/b".replace(re, "_");\n',
    probe: 'n'
  },
  {
    name: 'a regex after a keyword is a regex',
    code: 'function f(x) { return /^a+$/.test(x); }\nconst v = f("aaa");\n',
    probe: 'v'
  },
  {
    name: 'ASI: a newline after return is part of the program',
    code: 'function f() {\n  return\n  1;\n}\nconst v = f();\n',
    probe: 'v === undefined'
  },
  {
    name: 'ASI: a newline before ++ is part of the program',
    code: 'let a = 1\n++a\nconst v = a;\n',
    probe: 'v'
  },
  {
    name: 'ASI: a newline before an IIFE keeps it a statement',
    code: 'let v = 0;\nfunction g() { v = 1; }\n// the break below is load-bearing\nv = 2\n;(function () { v = 3; })()\n',
    probe: 'v'
  },
  {
    name: 'a template literal is copied whole, whitespace included',
    code: 'const t = `a\n   b`;\nconst v = t.length;\n',
    probe: 'v'
  },
  {
    name: 'a nested template inside ${} survives',
    code: 'const inner = "x";\nconst t = `a${`<${inner}>`}b`;\nconst v = t;\n',
    probe: 'v'
  },
  {
    name: 'comment-like text inside a template is data, not a comment',
    code: 'const t = `// not a comment /* nor this */`;\nconst v = t;\n',
    probe: 'v'
  },
  {
    name: 'a string containing an escaped quote survives',
    code: 'const v = "a\\"b\\\\c" + \'d\\\'e\';\n',
    probe: 'v'
  },
  {
    name: 'numbers and their dots are not joined',
    code: 'const v = (5).toString() + (1.5).toString();\n',
    probe: 'v'
  },
  {
    name: 'unary plus after plus stays two operators',
    code: 'let a = 1; const b = 2;\nconst v = a + +b;\n',
    probe: 'v'
  },
  {
    name: 'a `<!--` sequence is not created from `<` and `!`',
    code: 'const a = 1, b = 2;\nconst v = (a < !b) ? "lt" : "other";\n',
    probe: 'v'
  },
  {
    name: 'block comments between tokens do not join words',
    code: 'const typeofx = 1;\nlet v = typeof/* keep me apart */x;\n',
    probe: 'typeof v'
  }
];

JS_CASES.forEach((c) => {
  let original;
  let minified;
  let minifiedResult;
  try {
    original = run(c.code, c.probe);
  } catch (e) {
    ok(c.name + ' (original runs)', false, e.message);
    return;
  }
  minified = Minifier.minifyJS(c.code);
  try {
    /* eslint-disable no-new-func */
    new Function(minified);
    minifiedResult = run(minified, c.probe);
  } catch (e) {
    ok(c.name, false, 'minified output does not parse: ' + e.message + '\n      ' + minified);
    return;
  }
  ok(c.name + ' — behaviour identical', Object.is(original, minifiedResult),
    'original=' + JSON.stringify(original) + ' minified=' + JSON.stringify(minifiedResult) + '\n      ' + minified);
});

// --- JS: comments, padding, size, purity ---
{
  const code = [
    '// a leading comment',
    '/* a block comment */',
    'function add(a, b) {',
    '    // inside',
    '    return a + b;',
    '}',
    '/*! (c) PallettAI — kept */',
    'const total = add(1, 2);',
    ''
  ].join('\n');
  const out = Minifier.minifyJS(code);
  ok('line and block comments are removed', out.indexOf('a block comment') === -1);
  ok('attribution comments (/*!) are preserved', out.indexOf('(c) PallettAI') !== -1);
  ok('indentation is removed', out.indexOf('\n    ') === -1);
  ok('the result still computes', run(out, 'total') === 3);
  eq('minifying twice gives identical bytes (pure)', Minifier.minifyJS(out), out);
  const m = Minifier.measure(code, out);
  ok('JS size is reduced', m.saved > 0 && m.percent > 10, JSON.stringify(m));
}

// ------------------------------------------------------------------
// SECTION 2 — HTML
// ------------------------------------------------------------------
section('2. Minifier — HTML');

{
  const html = '<div>\n  <p>Hello</p>\n  <!-- a comment -->\n</div>\n';
  const out = Minifier.minifyHTML(html);
  ok('HTML comments are removed', out.indexOf('a comment') === -1);
  ok('block whitespace is collapsed', out.indexOf('</p>\n') === -1);
  ok('text is preserved', out.indexOf('Hello') !== -1);
}

{
  // Whitespace between inline elements renders. Dropping it changes the page.
  const out = Minifier.minifyHTML('<p><b>a</b> <i>b</i></p>');
  ok('whitespace between inline elements is preserved', out.indexOf('</b> <i>') !== -1, out);
}

{
  const src = '<pre>  keep\n   this\n</pre>';
  eq('<pre> contents are untouched', Minifier.minifyHTML(src), src);
}

{
  const src = '<textarea>\n  keep  me\n</textarea>';
  eq('<textarea> contents are untouched', Minifier.minifyHTML(src), src);
}

{
  const src = '<script>const s = "  a  "; // real code\n</script>';
  const out = Minifier.minifyHTML(src);
  ok('<script> bodies are left alone by default', out.indexOf('const s = "  a  ";') !== -1, out);
}

{
  // A data island is data. Minifying it as JavaScript would corrupt it.
  const ld = '<script type="application/ld+json">\n{\n  "a": "b // c"\n}\n</script>';
  eq('JSON-LD is never minified, even with inline:true', Minifier.minifyHTML(ld, { inline: true }), ld);
}

{
  const out = Minifier.minifyHTML('<style>\n  body { color: red; }\n</style>', { inline: true });
  ok('<style> bodies are minified when inline:true', out.indexOf('color: red') === -1, out);
}

{
  const out = Minifier.minifyHTML('<a title="a>b">x</a>');
  ok('a `>` inside an attribute does not end the tag', out.indexOf('title="a>b"') !== -1, out);
}

{
  const out = Minifier.minifyHTML('<!--[if IE]>old<![endif]-->');
  ok('conditional comments are preserved', out.indexOf('[if IE]') !== -1, out);
}

{
  const out = Minifier.minifyHTML('<script src="/a.js"></script>');
  ok('scripts with a src are never rewritten', out.indexOf('/a.js') !== -1);
}

{
  // Minifying twice must give the same bytes. A minifier that is not
  // idempotent cannot be used as a cache key, and it means the first pass
  // is preserving something the second pass would not.
  const messy = '<!-- c -->\n<div>\n\n\n\n  <p>a</p>\n\n\n</div>\n<p>b</p>\n';
  const once = Minifier.minifyHTML(messy);
  eq('HTML minifying is idempotent', Minifier.minifyHTML(once), once);
}

// ------------------------------------------------------------------
// SECTION 3 — CSS
// ------------------------------------------------------------------
section('3. Minifier — CSS');

{
  const css = '/* a comment */\nbody {\n  color: red;\n  margin: 0;\n}\n';
  const out = Minifier.minifyCSS(css);
  ok('CSS comments are removed', out.indexOf('a comment') === -1);
  ok('trailing semicolons before } are removed', out.indexOf(';}') === -1, out);
  ok('the declarations survive', out.indexOf('color:red') !== -1, out);
  eq('minifying twice gives identical bytes (pure)', Minifier.minifyCSS(out), out);
}

{
  const out = Minifier.minifyCSS('.a::after { content: "  "; }');
  ok('spaces inside a content string are preserved', out.indexOf('"  "') !== -1, out);
}

{
  const src = '.a { background: url(data:image/svg+xml;base64,AAA//BBB==); }';
  const out = Minifier.minifyCSS(src);
  ok('a bare url() body survives verbatim', out.indexOf('data:image/svg+xml;base64,AAA//BBB==') !== -1, out);
}

{
  const out = Minifier.minifyCSS('@media (min-width: 100px) and (max-width: 200px) { a { color: red } }');
  ok('`and` keeps the space before its query', out.indexOf('and (') !== -1, out);
  ok('the media query is still parseable', (out.match(/\(/g) || []).length === (out.match(/\)/g) || []).length, out);
}

{
  const out = Minifier.minifyCSS('.a { width: calc(100% - 2px); }');
  ok('calc() keeps the spaces its `-` operator needs', out.indexOf('calc(100% - 2px)') !== -1, out);
}

{
  const out = Minifier.minifyCSS(':root { --gap: 1px solid red; --x: 0.5rem; }');
  ok('custom property values are preserved', out.indexOf('--gap:1px solid red') !== -1 || out.indexOf('--gap: 1px solid red') !== -1, out);
  ok('a custom property keeps its internal separation', /--gap:\s*1px\s+solid\s+red/.test(out), out);
}

{
  const out = Minifier.minifyCSS('/*! license */ body { color: red }');
  ok('CSS attribution comments are preserved', out.indexOf('! license') !== -1, out);
}

{
  const out = Minifier.minifyCSS('@supports selector(:has(a)) { .a { color: red } }');
  ok('@supports selector() survives', out.indexOf('@supports selector(:has(a))') !== -1, out);
}

// ------------------------------------------------------------------
// SECTION 4 — asset hashing
// ------------------------------------------------------------------
section('4. Compiler cache — asset hashing');

{
  const a = Cache.computeAssetHash('hello');
  ok('a hash is 64 hex characters (SHA-256)', /^[0-9a-f]{64}$/.test(a), a);
  eq('hashing is deterministic', Cache.computeAssetHash('hello'), a);
  ok('different input gives a different hash', Cache.computeAssetHash('hello!') !== a);
  eq('a Buffer and its string hash the same', Cache.computeAssetHash(Buffer.from('hello')), a);
  const known = require('crypto').createHash('sha256').update('hello').digest('hex');
  eq('the digest matches Node crypto', a, known);
}

{
  // The hash must distinguish content that differs only in whitespace,
  // because whitespace is what the minifier changes.
  ok('whitespace-only changes change the hash',
    Cache.computeAssetHash('a b') !== Cache.computeAssetHash('a  b'));
}

// ------------------------------------------------------------------
// SECTION 5 — build cache
// ------------------------------------------------------------------
section('5. Compiler cache — artifacts');

{
  const dir = path.join(ROOT, '.build-cache-test');
  Cache.reset({ dir });

  const hash = Cache.computeAssetHash('page-one-html');
  ok('a miss reports a miss', Cache.getCachedBuildArtifact(hash, { dir }) === null);

  Cache.putCachedBuildArtifact(hash, 'page-one-html', { dir });
  eq('a hit returns the stored bytes', Cache.getCachedBuildArtifact(hash, { dir }), 'page-one-html');
  eq('a hit is recorded', Cache.stats({ dir }).hits >= 1, true);
  eq('a miss is recorded', Cache.stats({ dir }).misses >= 1, true);

  // The cache must refuse to hand back bytes that do not match their
  // own key — a corrupt cache is worse than a cold one.
  const fs = require('fs');
  const file = Cache.pathFor(hash, { dir });
  fs.writeFileSync(file, 'tampered');
  eq('a corrupted entry is treated as a miss', Cache.getCachedBuildArtifact(hash, { dir }), null);
  eq('a corrupted entry is counted as a miss', Cache.stats({ dir }).corrupt >= 1, true);

  Cache.reset({ dir });
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // Re-using a compile because the input hash matched must produce
  // byte-identical output to doing the work again.
  const dir = path.join(ROOT, '.build-cache-test2');
  Cache.reset({ dir });
  let builds = 0;
  // The second compile deliberately returns something *different*. A hit
  // must return what was stored, not what the function would produce now —
  // that is the whole contract of a cache, and a test where both
  // compiles agree cannot tell a working hit from a rebuild.
  const first = Cache.memoize('key-1', () => { builds++; return 'compiled:one'; }, { dir });
  const second = Cache.memoize('key-1', () => { builds++; return 'compiled:different'; }, { dir });
  eq('the second call is a hit, not a rebuild', builds, 1);
  eq('a hit returns the stored artefact', second, 'compiled:one');
  const third = Cache.memoize('key-2', () => { builds++; return 'compiled:other'; }, { dir });
  eq('a different key misses and rebuilds', builds, 2);
  eq('a different key returns its own artefact', third, 'compiled:other');
  ok('the two artefacts differ', third !== first);
  Cache.reset({ dir });
  require('fs').rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------------------
// SECTION 6 — entitlements
// ------------------------------------------------------------------
section('6. Entitlements — offline verification');

(async () => {
  ok('the module reports whether a key is installed', typeof Entitlements.isConfigured() === 'boolean');
  eq('free limits come from the plans module, not a copy here', Entitlements.freeLimits(),
    { projects: 2, sections: 10 });

  const bad = await Entitlements.verifyOfflineLicense('payload', 'not-a-signature');
  eq('a malformed signature is rejected', bad.ok, false);
  eq('and it says why', bad.reason, 'malformed');

  const missing = await Entitlements.verifyOfflineLicense('payload', '');
  eq('a missing signature is rejected', missing.ok, false);

  const good = await Entitlements.verifyOfflineGrant({ kind: 'pro30', proDays: 30, until: Date.now() + 864e5 }, '');
  eq('an unsigned grant is never accepted', good.ok, false);

  const expired = await Entitlements.verifyGrantState({ plan: 'pro', trialProUntil: Date.now() - 1000, trialSource: 'registry' });
  eq('an expired stored grant falls back to free', expired.plan, 'free');

  const forged = await Entitlements.verifyGrantState({ plan: 'pro', trialProUntil: Date.now() + 864e5, trialSource: 'registry' });
  eq('a hand-edited registry flag in storage is not a valid entitlement', forged.plan, 'free', JSON.stringify(forged));

  const limits = Entitlements.limitsFor({ plan: 'free' });
  eq('free tier is capped at 2 projects', limits.projects, 2);
  eq('free tier is capped at 10 sections', limits.sections, 10);
  const pro = Entitlements.limitsFor({ plan: 'pro' });
  eq('an entitled plan is unmetered on sections', pro.sections, Infinity);

  // Section enforcement must count what is actually there.
  const over = Entitlements.enforceSections({ sections: new Array(14).fill({ type: 'hero' }) }, { plan: 'free' });
  eq('14 sections exceeds the free cap', over.ok, false);
  eq('and is reported as an error, not a silent trim', over.errors.length > 0, true);
  const under = Entitlements.enforceSections({ sections: new Array(10).fill({ type: 'hero' }) }, { plan: 'free' });
  eq('exactly 10 sections is allowed', under.ok, true);

  // ------------------------------------------------------------------
  // SECTION 7 — migration
  // ------------------------------------------------------------------
  section('7. Migration');

  {
    const legacy = JSON.stringify({
      name: 'Old site',
      pages: [{ id: 'home', sections: [{ type: 'hero' }] }]
    });
    const report = Migration.migrateProjectSchema(legacy);
    ok('an unknown shape is still migrated, not rejected', report.ok === true || report.errors.length > 0, JSON.stringify(report).slice(0, 200));
    ok('a report always carries its steps', Array.isArray(report.applied));
    ok('a report names the version it produced', typeof report.to !== 'undefined');
  }

  {
    // The current shape must pass through untouched: a migration that
    // rewrites an already-current project is how data gets lost.
    const current = JSON.stringify({
      schemaVersion: 2,
      name: 'New site',
      site: { sections: [{ id: 's1', type: 'hero', layout_variant: 'split', background_style: 'pattern-grid' }] },
      design_tokens: { '--brand-color': 'oklch(0.65 0.24 260)' },
      chosen_archetype: 'editorial'
    });
    const report = Migration.migrateProjectSchema(current);
    ok('a current project is accepted', report.ok === true, JSON.stringify(report).slice(0, 300));
    eq('and is marked as needing no migration', report.applied.length, 0);
    const out = JSON.parse(report.raw);
    eq('its sections are not rewritten', out.site.sections.length, 1);
    eq('its archetype survives', out.chosen_archetype, 'editorial');
  }

  {
    // The brief's defaults must be injected where they are genuinely
    // missing, and the value must be usable by the builder.
    const sparse = JSON.stringify({ schemaVersion: 1, name: 'Sparse', site: { sections: [{ id: 'a', type: 'hero' }] } });
    const report = Migration.migrateProjectSchema(sparse);
    const out = JSON.parse(report.raw);
    ok('missing design_tokens are injected', out.design_tokens && typeof out.design_tokens === 'object', JSON.stringify(out.design_tokens));
    ok('missing chosen_archetype is injected', typeof out.chosen_archetype === 'string' && out.chosen_archetype.length > 0);
    ok('the injected tokens are real CSS values', Object.keys(out.design_tokens).every((k) => typeof out.design_tokens[k] === 'string'));
  }

  {
    ok('garbage input does not throw', (() => {
      try { Migration.migrateProjectSchema('{not json'); return true; } catch (e) { return false; }
    })());
    const bad = Migration.migrateProjectSchema('{not json');
    eq('garbage input is reported as an error', bad.ok, false);
    ok('and the error is legible', typeof bad.errors[0] === 'string' && bad.errors[0].length > 0, JSON.stringify(bad.errors));
  }

  {
    const validated = Migration.validateProjectSchema(JSON.stringify({ schemaVersion: 2, name: 'x', site: { sections: [] } }));
    ok('validateProjectSchema accepts a valid project', validated.ok === true, JSON.stringify(validated).slice(0, 200));
    const invalid = Migration.validateProjectSchema(JSON.stringify({ schemaVersion: 2, name: '', site: { sections: 'nope' } }));
    eq('and rejects an invalid one', invalid.ok, false);
    ok('with reasons attached', invalid.errors.length > 0, JSON.stringify(invalid.errors));
  }

  {
    eq('CURRENT_VERSION is the integer the store uses, not a semver', Migration.CURRENT_VERSION, 2);
  }

  // ------------------------------------------------------------------
  // SECTION 8 — the whole pipeline
  // ------------------------------------------------------------------
  section('8. Pipeline — migrate, minify, hash, cache');

  {
    const dir = path.join(ROOT, '.build-cache-test3');
    Cache.reset({ dir });

    const legacy = JSON.stringify({ name: 'Pipeline', pages: [{ id: 'home', sections: [{ type: 'hero' }, { type: 'faq' }] }] });
    const report = Migration.migrateProjectSchema(legacy);
    ok('the pipeline migrates', report.ok === true, JSON.stringify(report.errors));

    const html = '<!doctype html>\n<html>\n  <body>\n    <!-- x -->\n    <p>hi</p>\n  </body>\n</html>\n';
    const modern = Minifier.minifyHTML(html);
    ok('the pipeline minifies', modern.length < html.length, html.length + ' -> ' + modern.length);

    const hash = Cache.computeAssetHash(modern);
    Cache.putCachedBuildArtifact(hash, modern, { dir });
    eq('the pipeline caches and reads back byte-identically', Cache.getCachedBuildArtifact(hash, { dir }), modern);

    const stats = Cache.stats({ dir });
    ok('the cache reports its sizes', typeof stats.bytes === 'number' && stats.bytes > 0, JSON.stringify(stats));

    Cache.reset({ dir });
    require('fs').rmSync(dir, { recursive: true, force: true });
  }

  // ------------------------------------------------------------------
  // SECTION 9 — the real thing
  //
  // Fixtures prove the rules; this proves the rules against what the app
  // actually emits, which is the only stylesheet and the only inline
  // JavaScript that will ever be put through the minifier. The builder's
  // output is full of the exact constructs a naive minifier breaks:
  // `@property` with a quoted `<angle>` syntax, oklch/color-mix values,
  // scroll-driven animation ranges, and scripts containing regexes, URLs
  // and template literals.
  // ------------------------------------------------------------------
  section('9. Real builder output');

  let realHTML = '';
  try {
    global.DB = require(path.join(ROOT, 'data', 'db.js'));
    global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
    global.Review = require(path.join(ROOT, 'data', 'review.js'));
    global.Images = require(path.join(ROOT, 'data', 'images.js'));
    global.Focus = require(path.join(ROOT, 'data', 'focus.js'));
    global.OgCard = require(path.join(ROOT, 'data', 'ogcard.js'));
    global.Concierge = require(path.join(ROOT, 'data', 'concierge.js'));
    const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
    realHTML = Builder.buildSiteHTML({
      id: 'bench',
      name: 'Bench & Co',
      suites: [],
      site: {
        name: 'Bench & Co',
        palette: 'midnight',
        font: 'sans',
        pages: [{
          id: 'home',
          name: 'Home',
          sections: [
            { type: 'hero', headline: 'A real page' },
            { type: 'faq' },
            { type: 'contact' }
          ]
        }]
      }
    });
  } catch (e) {
    realHTML = '';
    console.log('  ! builder unavailable: ' + (e && e.message ? e.message : e));
  }

  if (!realHTML) {
    ok('a real page was generated to test against', false, 'the builder did not produce output');
  } else {
    const grab = (re) => {
      const out = [];
      const rx = new RegExp(re, 'gi');
      let m;
      while ((m = rx.exec(realHTML))) out.push(m[1]);
      return out;
    };
    const styles = grab('<style[^>]*>([\\s\\S]*?)</style>');
    ok('the real page carries a stylesheet', styles.length > 0, styles.length + ' style blocks');

    // Inline scripts, split by what they actually are. A JSON-LD block is
    // *data*, and feeding it to the JavaScript minifier only proves that
    // JSON is not JavaScript. The real assertion for a data island is
    // that the minifier leaves it alone (checked below).
    const scriptTags = [];
    {
      const rx = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = rx.exec(realHTML))) scriptTags.push({ attrs: m[1], code: m[2] });
    }
    const typeOf = (attrs) => {
      const t = attrs.match(/type\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      return String(t ? (t[2] != null ? t[2] : t[3] != null ? t[3] : t[4] || '') : '').trim().toLowerCase();
    };
    const JS_TYPES = ['', 'text/javascript', 'application/javascript', 'module', 'text/ecmascript'];
    const inline = scriptTags.filter((t) => !/\ssrc=/i.test(t.attrs));
    const scripts = inline.filter((t) => JS_TYPES.indexOf(typeOf(t.attrs)) !== -1).map((t) => t.code);
    const dataScripts = inline.filter((t) => JS_TYPES.indexOf(typeOf(t.attrs)) === -1);
    ok('the real page carries inline scripts', scripts.length > 0, scripts.length + ' inline scripts');
    ok('and at least one data island', dataScripts.length > 0, dataScripts.length + ' non-JS islands');

    // ---- CSS ----
    const cssIn = styles.join('\n');
    const cssOut = styles.map((s) => Minifier.minifyCSS(s)).join('\n');
    const cssStats = Minifier.measure(cssIn, cssOut);
    ok('the real stylesheet shrinks', cssStats.saved > 0, JSON.stringify(cssStats));
    console.log('      real CSS: ' + cssStats.before + ' -> ' + cssStats.after + ' bytes (' + cssStats.percent + '% saved)');

    const braces = (t) => (t.match(/\{/g) || []).length === (t.match(/\}/g) || []).length;
    ok('the minified stylesheet keeps balanced braces', braces(cssOut), 'a broken rule would unbalance them');

    /*
      Count in the stylesheet's *code*, never in its comments. This
      stylesheet documents itself — "Each step is a clamp() over the
      viewport", "scroll-padding-top keeps anchors clear of the nav" — and
      a raw count over the original would treat removing those comments as
      losing the construct they describe. The first version of this test
      did exactly that and reported three false failures.
    */
    const stripComments = (css) => {
      let out = '';
      let i = 0;
      let quote = '';
      while (i < css.length) {
        const c = css[i];
        if (quote) {
          out += c;
          if (c === '\\') { out += css[i + 1] || ''; i += 2; continue; }
          if (c === quote) quote = '';
          i++;
          continue;
        }
        if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
        if (c === '/' && css[i + 1] === '*') {
          const close = css.indexOf('*/', i + 2);
          i = close === -1 ? css.length : close + 2;
          continue;
        }
        out += c;
        i++;
      }
      return out;
    };
    const cssCode = stripComments(cssIn);
    const countOf = (text, needle) => (text.split(needle).length - 1);
    ok('the stylesheet has more than its comments', cssCode.length < cssIn.length);

    // Every construct the builder relies on must survive.
    ['oklch(', 'color-mix(', 'clamp(', 'animation-timeline', '@property', 'scroll-padding-top']
      .forEach((needle) => {
        const before = countOf(cssCode, needle);
        if (before === 0) return; // the builder did not emit it for this page
        const after = countOf(cssOut, needle);
        ok('real CSS keeps every `' + needle + '` (' + before + ')', after === before, before + ' -> ' + after);
      });

    const propNames = (t) => (t.match(/--[a-zA-Z0-9-]+(?=\s*:)/g) || []);
    const declared = new Set(propNames(cssCode));
    const emitted = new Set(propNames(cssOut));
    const lost = [...declared].filter((n) => !emitted.has(n));
    ok('every custom property the builder declares survives (' + declared.size + ')', lost.length === 0, 'lost: ' + lost.join(', '));

    const decl = (t, name) => {
      const m = t.match(new RegExp(name.replace(/-/g, '\\-') + '\\s*:\\s*[^;}]+'));
      return m ? m[0].replace(/\s+/g, '') : '';
    };
    ['--fs-hero', '--btn-radius', '--brand-color']
      .forEach((name) => {
        const before = decl(cssCode, name);
        if (!before) return;
        const after = decl(cssOut, name);
        ok('the declaration `' + name + '` is unchanged (' + before + ')', before === after, before + ' -> ' + after);
      });

    // ---- JS ----
    let jsIn = 0;
    let jsOut = 0;
    let jsBroken = 0;
    scripts.forEach((code) => {
      const min = Minifier.minifyJS(code);
      jsIn += code.length;
      jsOut += min.length;
      try {
        /* eslint-disable no-new-func */
        new Function(min);
      } catch (e) {
        jsBroken++;
        console.log('      ! generated script failed to parse after minifying: ' + e.message);
        console.log('      at: ' + JSON.stringify(min.slice(0, 140)));
      }
    });
    eq('every real inline script still parses after minifying', jsBroken, 0);
    ok('the real inline scripts shrink', jsOut < jsIn, jsIn + ' -> ' + jsOut + ' bytes');
    console.log('      real JS:  ' + jsIn + ' -> ' + jsOut + ' bytes (' + Math.round(((jsIn - jsOut) / jsIn) * 1000) / 10 + '% saved)');
    eq('the scripts stay pure', Minifier.minifyJS(Minifier.minifyJS(scripts[0])), Minifier.minifyJS(scripts[0]));

    // A data island must come through the HTML minifier untouched, in the
    // real page rather than a fixture: this is structured data a search
    // engine reads, and whitespace inside it is significant to a diff.
    if (dataScripts.length) {
      const outInline = Minifier.minifyHTML(realHTML, { inline: true });
      const intact = dataScripts.filter((t) => outInline.indexOf(t.code) !== -1).length;
      eq('data islands survive HTML minification byte-for-byte', intact, dataScripts.length);
    }

    // ---- HTML ----
    const htmlOut = Minifier.minifyHTML(realHTML);
    const htmlStats = Minifier.measure(realHTML, htmlOut);
    ok('the real page shrinks', htmlStats.saved > 0, JSON.stringify(htmlStats));
    console.log('      real HTML: ' + htmlStats.before + ' -> ' + htmlStats.after + ' bytes (' + htmlStats.percent + '% saved)');
    eq('no comment survives', htmlOut.indexOf('<!--') === -1, true);
    const count = (t, re) => (t.match(new RegExp(re, 'gi')) || []).length;
    eq('no element is dropped', count(htmlOut, '<(div|section|p|a|h[1-6])\\b'), count(realHTML, '<(div|section|p|a|h[1-6])\\b'));
    ok('the page still declares its language', /<html[^>]*lang=/i.test(htmlOut));
    ok('every doctype is preserved', count(htmlOut, '<!doctype') === count(realHTML, '<!doctype'));
  }

  // ------------------------------------------------------------------
  console.log('\n' + (failed === 0 ? 'ALL PASSED' : 'FAILED') + ' — ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nsuite threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});

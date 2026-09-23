#!/usr/bin/env node
// ============================================================
// PallettAI Studio — CSP + CLI guard smoke runner
// ------------------------------------------------------------
// The two guards that are easy to get wrong and expensive to get
// wrong, checked against REAL builder output rather than fixtures:
//
//   1. The meta-CSP safety gate. The builder emits
//      `onload="this.media='all'"` to async-load font stylesheets.
//      Per the CSP spec a nonce or hash in `script-src` makes the
//      browser IGNORE `'unsafe-inline'`, so a hash-bearing policy
//      blocks that handler — the sheet keeps media="print", and the
//      site silently renders in fallback fonts. `injectCSPMeta` must
//      therefore REFUSE, with a reason, instead of shipping a page
//      that cannot load its own typeface.
//
//   2. CLI outcome codes and config handling. An unusable INPUT (bad
//      flags, unreadable config, missing or invalid project) is a
//      different outcome from a build that broke with valid input,
//      and a CI job acts differently on each — so 2 and 1 are kept
//      apart, and a config file must never outrank an explicit flag.
//
//   node scripts/csp-cli-guards-smoke.js
// ============================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

['DB', 'ONLINE', 'Review', 'Images', 'Focus', 'OgCard', 'Concierge'].forEach((name) => {
  const rel = { DB: 'db', ONLINE: 'online', Review: 'review', Images: 'images', Focus: 'focus', OgCard: 'ogcard', Concierge: 'concierge' }[name];
  global[name] = require(path.join(ROOT, 'data', rel + '.js'));
});

const Builder = require(path.join(ROOT, 'modules', 'builder.js'));
const SRI = require(path.join(ROOT, 'modules', 'security-sri.js'));
const CSP = require(path.join(ROOT, 'modules', 'security-csp.js'));
const CLI = require(path.join(ROOT, 'modules', 'cli-runner.js'));

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(label);
  console.error('  x ' + label + (detail ? ' [' + String(detail).slice(0, 180) + ']' : ''));
}
function eq(a, b, label) { ok(a === b, label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function section(name) { console.log('\n== ' + name + ' =='); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pai-csp-cli-'));
const clone = (x) => JSON.parse(JSON.stringify(x));

function fixture(pageCount) {
  const ids = ['home', 'about', 'work'];
  const names = ['Home', 'About', 'Work'];
  return {
    id: 'guards', name: 'Guards Co',
    site: {
      name: 'Guards Co', tagline: 'g', url: 'https://guards.example',
      palette: 'midnight', font: 'inter', archetype: 'editorial',
      metaDescription: 'guards',
      pages: Array.from({ length: pageCount }, (_, i) => ({
        id: ids[i] || 'page-' + i,
        name: names[i] || 'Page ' + i,
        slug: i === 0 ? 'index' : (ids[i] || 'page-' + i),
        sections: [
          { type: 'hero', title: 'Headline ' + i, subtitle: 'sub' },
          { type: 'text', title: 'Body', body: 'copy' }
        ]
      }))
    }
  };
}

async function main() {

  /* ---- 1. the meta-CSP safety gate, on real output ---- */
  section('the meta-CSP gate refuses to break a real page');
  const realHtml = Builder.buildSitePages(clone(fixture(2)), {}).map((e) => e.html).join('\n');
  {
    const handlers = SRI.detectInlineHandlers(realHtml);
    ok(handlers.handlers >= 1, 'the real generated page has inline handlers (' + handlers.handlers + ')');
    ok(handlers.names.indexOf('onload') !== -1,
      'including the font-sheet onload that motivated this guard', JSON.stringify(handlers.names));

    const res = SRI.injectSRIAndCSPHeaders(realHtml, {}, { meta: true, dependencies: ['google-fonts'] });
    eq(res.metaInjected, false, 'a meta CSP is REFUSED rather than shipped');
    eq(res.metaSafe, false, 'and metaSafe reports the danger');
    ok(/would block/.test(res.warnings.join(' ')), 'the refusal explains itself');
    ok(/header/.test(res.warnings.join(' ')), 'and points at the header form');
    ok(/Content-Security-Policy/.test(res.csp.header), 'which is produced and usable');
    eq(res.html.indexOf('http-equiv="Content-Security-Policy"'), -1,
      'and no meta tag reached the document');

    // The refusal is about THIS document, not a blanket "never".
    const clean = '<!DOCTYPE html><html><head><title>t</title></head><body><h1>ok</h1></body></html>';
    const cleanCsp = SRI.generateStrictCSP({ dependencies: ['plausible'] });
    const injected = SRI.injectCSPMeta(clean, cleanCsp.metaPolicy, { handlers: SRI.detectInlineHandlers(clean) });
    eq(injected.injected, true, 'a document with no handlers may carry a meta policy');
    ok(/http-equiv="Content-Security-Policy"/.test(injected.tag), 'as a real CSP meta tag');

    eq(SRI.injectCSPMeta(clean, '').injected, false, 'and an empty policy is refused');

    // Header-only directives must not be presented as meta rules.
    const csp = SRI.generateStrictCSP({ dependencies: ['plausible'], frameAncestors: ["'none'"] });
    ok(/frame-ancestors/.test(csp.header), 'the header carries frame-ancestors');
    ok(!/frame-ancestors/.test(csp.metaPolicy), 'the meta form does not: a meta tag ignores it');
    eq(csp.metaEquivalent, false, 'and the loss is reported');
    eq(csp.metaSafe, true, 'while metaSafe stays true — dropping a directive does not break the page');
  }

  section("the CSP rule that disables 'unsafe-inline'");
  {
    const mixed = SRI.inlineScriptPermissions("script-src 'self' 'unsafe-inline' 'sha256-abc'");
    eq(mixed.hasHash, true, 'the policy carries a hash');
    eq(mixed.broadInlineHonoured, false, "so the browser IGNORES 'unsafe-inline'");
    eq(mixed.inlineHandlersAllowed, false, 'and inline handlers are blocked');
    eq(SRI.inlineScriptPermissions("script-src 'self' 'unsafe-inline'").broadInlineHonoured, true,
      'with no hash or nonce, unsafe-inline works');
    eq(SRI.inlineScriptPermissions("script-src 'unsafe-hashes' 'sha256-a'").inlineHandlersAllowed, true,
      "and 'unsafe-hashes' is the documented escape");
    eq(SRI.inlineScriptPermissions("script-src 'nonce-xyz' 'unsafe-inline'").broadInlineHonoured, false,
      'a nonce disables unsafe-inline too');
    ok(!/''sha256/.test(SRI.generateStrictCSP({ hashes: ["'sha256-abc'"] }).policy),
      'a pre-quoted hash is normalised, not double-quoted into a token that matches nothing');
  }

  section('inline ATTRIBUTE hashing — the case an element hash cannot cover');
  {
    // The builder async-loads its font sheet with onload="this.media='all'".
    // An element hash allows a <script> element and cannot allow an
    // ATTRIBUTE, so without 'unsafe-hashes' the browser refuses the handler,
    // the sheet stays media="print" and the site renders in fallback fonts.
    const realOne = Builder.buildSitePages(clone(fixture(1)), {}).map((e) => e.html).join('\n');
    const res = CSP.injectSRIAndCSPHeaders(realOne, {});
    const scriptSrc = (res.policy.match(/script-src([^;]*)/) || ['', ''])[1];
    const names = res.inlineAttributes.handlers.map((h) => h.event);

    ok(res.inlineAttributes.handlers.length >= 1,
      'the real generated page exposes its inline handlers (' + names.join(', ') + ')');
    ok(names.indexOf('onload') !== -1, 'including the font-sheet onload', JSON.stringify(names));
    ok(/'unsafe-hashes'/.test(scriptSrc),
      "without 'unsafe-hashes' the browser refuses the handler entirely");
    ok(/\son[a-z]+\s*=\s*"/.test(res.html), 'the handler is still in the document');
    eq(res.inlineAttributes.handlers.every((h) => scriptSrc.indexOf(h.hash) !== -1), true,
      'and every handler digest is carried in script-src');
    ok(scriptSrc.indexOf("'unsafe-inline'") === -1,
      "while 'unsafe-inline' is still never added — permission stays per-document");
    eq(res.inlineAttributes.handlers.filter((h) => h.event === 'onload')[0].hash,
      CSP.sha384Hash("this.media='all'"),
      'the digest is over the handler source as the browser sees it');

    // Guards against the loose-regex trap: /\son\w+=/ matches one= and only=.
    const traps = CSP.scanInlineAttributes(
      '<html><head></head><body><p one="1" only="2" onclick="x()" onload="">t</p></body></html>');
    eq(traps.handlers.length, 1, 'only a real handler is hashed (one=/only= are not handlers)');
    eq(traps.handlers[0].event, 'onclick', 'and it is the right one');
    eq(traps.handlers[0].code, 'x()', 'with its source decoded');
    eq(traps.handlers.filter((h) => h.event === 'onload').length, 0,
      'an empty handler cannot run, so it is not hashed');

    eq(CSP.scanInlineAttributes(
      '<html><head></head><body><script>var s = "onclick=evil()";<\/script></body></html>').handlers.length,
      0, 'a handler string inside a script block is not markup');
    eq(CSP.scanInlineAttributes(
      '<html><head></head><body><a onmouseover="a&amp;b">t</a></body></html>').handlers[0].hash,
      CSP.sha384Hash('a&b'), 'entities are decoded before hashing, or the digest never matches');

    // Same mechanism for style attributes (blocked by the same CSP rule).
    const styled = CSP.injectSRIAndCSPHeaders(
      '<html><head></head><body><div style="color: red">t</div></body></html>', {});
    const styleSrc = (styled.policy.match(/style-src([^;]*)/) || ['', ''])[1];
    eq(styled.inlineAttributes.styles.length, 1, 'a style attribute is picked up too');
    ok(/'unsafe-hashes'/.test(styleSrc), 'and allowed by hash in style-src');
    ok(styleSrc.indexOf('unsafe-inline') === -1, 'never by a blanket unsafe-inline');

    const plain = CSP.injectSRIAndCSPHeaders(
      '<html><head></head><body><h1>plain</h1></body></html>', {});
    ok(/'unsafe-hashes'/.test(plain.policy) === false,
      "a document with no inline attributes gets no 'unsafe-hashes' — strictness is not defaulted away");
  }

  /* ---- 2. CLI config and outcome codes ---- */
  section('CLI: config files');
  {
    const cfg = path.join(TMP, 'build.json');
    fs.writeFileSync(cfg, JSON.stringify({ out: path.join(TMP, 'cfg-out'), minify: false, parallel: true }));
    const fromCfg = CLI.resolveOptions(['--input', 'p', '--config', cfg]);
    eq(fromCfg.out, path.join(TMP, 'cfg-out'), 'a config supplies the output directory');
    eq(fromCfg.minify, false, 'and minify');
    eq(fromCfg.parallel, true, 'and parallel');
    eq(CLI.resolveOptions(['--input', 'p', '--config', cfg, '--out', path.join(TMP, 'flag-out')]).out,
      path.join(TMP, 'flag-out'), 'an explicit flag outranks the file');

    const dev = path.join(TMP, 'dev.json');
    fs.writeFileSync(dev, JSON.stringify({ environment: 'development' }));
    eq(CLI.resolveOptions(['--input', 'p', '--config', dev]).minify, false,
      'a config that sets the environment moves the minify default with it');

    eq(CLI.loadConfig(path.join(TMP, 'nope.json')).ok, false, 'a missing config is reported');
    const bad = path.join(TMP, 'bad.json');
    fs.writeFileSync(bad, '{oops');
    eq(CLI.loadConfig(bad).ok, false, 'invalid JSON is reported');
    fs.writeFileSync(path.join(TMP, 'arr.json'), '[1,2]');
    eq(CLI.loadConfig(path.join(TMP, 'arr.json')).ok, false, 'a non-object config is reported');
    eq(CLI.resolveOptions(['--input', 'p', '--config', bad]).errors.length > 0, true, 'and a bad config becomes an error');
  }

  section('CLI: outcome codes');
  {
    eq(CLI.EXIT.OK, 0, 'success is 0');
    eq(CLI.EXIT.BUILD_FAILED, 1, 'a build failure is 1');
    eq(CLI.EXIT.INVALID_INPUT, 2, 'an unusable input is 2');

    const invalid = path.join(TMP, 'invalid.pallettai.json');
    fs.writeFileSync(invalid, JSON.stringify({ schemaVersion: 2, name: 'No sections' }));
    const res = await CLI.runHeadlessBuild(invalid, {
      out: path.join(TMP, 'dist-invalid'), logger: CLI.createLogger({ quiet: true })
    });
    eq(res.ok, false, 'an invalid project fails');
    eq(res.exitCode, CLI.EXIT.INVALID_INPUT, 'with the INPUT code, not a build-failure code');

    const script = path.join(ROOT, 'modules', 'cli-runner.js');
    const run = (args) => {
      try {
        execFileSync(process.execPath, [script].concat(args), { encoding: 'utf8', env: Object.assign({}, process.env, { NO_COLOR: '1' }) });
        return 0;
      } catch (e) { return e.status; }
    };
    eq(run(['--input', path.join(TMP, 'nope.json')]), 2, 'a missing project exits 2 from the process');
    eq(run(['--nope']), 2, 'an unknown flag exits 2');
    eq(run(['--help']), 0, '--help exits 0');
  }

  /* ---- 3. the parallel transform must not change a byte ---- */
  section('CLI: --parallel is byte-identical to sequential');
  {
    const projectFile = path.join(TMP, 'site.pallettai.json');
    fs.writeFileSync(projectFile, JSON.stringify(fixture(2), null, 2));
    const quiet = CLI.createLogger({ quiet: true });
    const parDir = path.join(TMP, 'dist-par');
    const seqDir = path.join(TMP, 'dist-seq');

    const par = await CLI.runHeadlessBuild(projectFile, { out: parDir, minify: true, parallel: true, stats: true, logger: quiet });
    const seq = await CLI.runHeadlessBuild(projectFile, { out: seqDir, minify: true, parallel: false, stats: true, logger: quiet });
    eq(par.ok, true, 'the parallel build succeeds', JSON.stringify(par.errors));
    eq(seq.ok, true, 'the sequential build succeeds', JSON.stringify(seq.errors));

    eq(fs.readFileSync(path.join(parDir, 'index.html'), 'utf8'),
      fs.readFileSync(path.join(seqDir, 'index.html'), 'utf8'),
      'PARITY: the parallel export matches the sequential one byte for byte');
    eq(fs.readFileSync(path.join(parDir, 'about.html'), 'utf8'),
      fs.readFileSync(path.join(seqDir, 'about.html'), 'utf8'),
      'on every page');

    const t = par.telemetry;
    ok(t && t.workers >= 1, 'telemetry reports the worker count (' + (t && t.workers) + ')');
    eq(t.inline, false, 'the transform ran in real worker threads');
    eq(t.completed, 2, 'and completed every page');
    eq(t.completionRate, 100, 'with a 100% completion rate');
    eq(t.dispatched, 2, 'one dispatched job per page');
    ok(t.savedBytes > 0, 'with real byte savings (' + t.savedBytes + ')');

    eq(par.stats && fs.existsSync(par.stats.path), true, 'build-stats.json was written');
    const stats = JSON.parse(fs.readFileSync(path.join(parDir, 'build-stats.json'), 'utf8'));
    eq(stats.pages, 2, 'the report states the page count');
    eq(stats.parallel, true, 'and that it ran in parallel');
    eq(fs.readFileSync(path.join(parDir, 'manifest.json'), 'utf8').indexOf('build-stats.json'), -1,
      'and the build report is NOT in the integrity manifest');
  }

  delete global.DB; delete global.ONLINE; delete global.Review; delete global.Images;
  delete global.Focus; delete global.OgCard; delete global.Concierge;
}

main()
  .then(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* windows lock */ }
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    if (fail > 0) {
      console.log('\nFailures:');
      failures.forEach((f) => console.log('  - ' + f));
      process.exit(1);
    }
    console.log('csp-cli-guards smoke: ALL GREEN');
  })
  .catch((e) => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (err) { /* ignore */ }
    console.error('\ncsp-cli-guards smoke crashed: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  });

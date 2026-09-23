// ============================================================
// Extended motion & forms smoke test
//
// Five claims, each checked where it could actually break:
//
//   1. Form router   — provider endpoints resolve to the real
//                      URLs (Web3Forms/Formspree/Netlify/
//                      Formtorch/custom Worker), and the
//                      generated handler stays UNDER its 1.5KB
//                      inline budget while still intercepting
//                      submit, validating, honouring the
//                      botcheck honeypot and toasting through
//                      real ARIA live-region roles.
//   2. Client vault  — encrypt → PBKDF2(100k)/AES-256-GCM →
//                      decrypt recovers the EXACT payload, wrong
//                      passwords and tampered bytes cannot, and
//                      the generated browser script's decrypt
//                      core is evaluated for real under Node's
//                      spec-compliant crypto.subtle.
//   3. FX presets    — tilt/magnetic/scroll scripts compile,
//                      every spatial effect bails on
//                      (hover: hover) and (pointer: fine) plus
//                      prefers-reduced-motion, every stylesheet
//                      is wrapped in the same media query, and
//                      the progress bar fits its 0.2KB budget.
//   4. Domain check  — DNS expectations are proven against
//                      MOCKED resolvers (Cloudflare/Netlify/
//                      GitHub pass AND fail paths) and the TLS
//                      report against mocked sockets (valid,
//                      expiring, expired, SAN mismatch, no cert,
//                      handshake error).
//
// No packet leaves this process: dns and tls are injected.
//
// Run: node scripts/motion-deploy-advanced-smoke.js
// ============================================================
'use strict';

const path = require('path');
const { EventEmitter } = require('events');
const ROOT = path.join(__dirname, '..');

const Forms = require(path.join(ROOT, 'modules', 'forms.js'));
const Vault = require(path.join(ROOT, 'modules', 'client-vault.js'));
const FX = require(path.join(ROOT, 'modules', 'fx-presets.js'));
const Dom = require(path.join(ROOT, 'modules', 'domain-checker.js'));

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const threw = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const rej = async (p) => { try { await p; return null; } catch (e) { return e; } };

// ---- structural HTML validator (tag stack + id/aria references) ---------
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

function structure(html) {
  const src = String(html == null ? '' : html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<script>[\s\S]*?<\/script>/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '');
  const stack = [];
  const idSet = new Set();
  const refs = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;
  let m;
  let error = '';
  while (!error && (m = re.exec(src))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClosed = m[4] === '/';
    if (closing) {
      const top = stack.pop();
      if (top !== tag) error = 'closing </' + tag + '> does not match <' + (top || 'nothing') + '>';
      continue;
    }
    const idm = attrs.match(/\sid="([^"]*)"/);
    if (idm) {
      if (idSet.has(idm[1])) error = 'duplicate id "' + idm[1] + '"';
      idSet.add(idm[1]);
    }
    ['for', 'aria-controls', 'aria-labelledby'].forEach((a) => {
      const rm = attrs.match(new RegExp('\\s' + a + '="([^"]*)"'));
      if (rm) rm[1].split(/\s+/).filter(Boolean).forEach((r) => refs.push({ a, r }));
    });
    if (!VOID_TAGS.has(tag) && !selfClosed) stack.push(tag);
  }
  if (!error && stack.length) error = 'unclosed <' + stack.slice(-3).join('><') + '>';
  if (!error) {
    for (const ref of refs) {
      if (!idSet.has(ref.r)) { error = ref.a + '="' + ref.r + '" points at no id'; break; }
    }
  }
  return { error };
}

function checkStructure(name, html) {
  const r = structure(html);
  ok(name, !r.error, r.error);
}

// Extract the JS from a generated fragment and prove it compiles.
function scriptOf(fragment) {
  const m = String(fragment).match(/<script>([\s\S]*?)<\/script>/);
  return m ? m[1] : '';
}
function compiles(name, js) {
  let err = '';
  try { new Function(js); } catch (e) { err = e.message; }
  ok(name + ' compiles as JavaScript', !!js && !err, err);
  return !err;
}

// ---- DNS / TLS mocks ----------------------------------------------------
function resolverMock(cname, a) {
  const absent = () => { const e = new Error('no record'); e.code = 'ENODATA'; return e; };
  return {
    resolveCname: async () => { if (!cname || !cname.length) throw absent(); return cname; },
    resolve4: async () => { if (!a || !a.length) throw absent(); return a; }
  };
}

function tlsMock(spec) {
  // spec: { cert, error, authErr, silent }
  return function connect() {
    const ee = new EventEmitter();
    ee.setTimeout = () => {};
    ee.destroy = () => {};
    ee.getPeerCertificate = () => spec.cert || {};
    if (spec.authErr) ee.authorizationError = spec.authErr;
    setImmediate(() => {
      if (spec.error) ee.emit('error', spec.error);
      else if (!spec.silent) ee.emit('secureConnect');
    });
    return ee;
  };
}

function certFixture(o) {
  const c = {
    subject: { CN: o.subject || 'acme.example' },
    issuer: { CN: o.issuer || "Let's Encrypt R3" },
    subjectaltname: o.san === undefined ? 'DNS:acme.example' : o.san,
    fingerprint256: 'AA:BB:CC'
  };
  if (o.validToDate) c.validToDate = o.validToDate;
  else c.valid_to = new Date(o.validToMs).toUTCString();
  return c;
}

const DAY = 86400000;

(async () => {
  // ==== 1. provider routing ==========================================
  console.log('\n1. Provider endpoints resolve to the real backends');
  {
    const w3 = Forms.formEndpoint({ provider: 'web3forms', accessKey: 'KEY1' });
    ok('web3forms posts JSON to api.web3forms.com/submit',
      w3.url === 'https://api.web3forms.com/submit' && w3.json === true);
    ok('web3forms carries the access_key for injection',
      w3.inject && w3.inject.access_key === 'KEY1');

    const fs = Forms.formEndpoint({ provider: 'formspree', formId: 'xyzABC_123' });
    ok('formspree posts to /f/{formId}', fs.url === 'https://formspree.io/f/xyzABC_123' && fs.json);
    ok('formspree rejects a malformed formId',
      (() => { const e = threw(() => Forms.formEndpoint({ provider: 'formspree', formId: '../etc' })); return e && e.code === 'bad_input'; })());
    ok('formspree without a formId fails fast',
      (() => { const e = threw(() => Forms.formEndpoint({ provider: 'formspree' })); return e && e.code === 'missing_credential'; })());

    const ft = Forms.formEndpoint({ provider: 'formtorch', formId: 'abc123' });
    ok('formtorch posts to formtorch.com/f/{formId}', ft.url === 'https://formtorch.com/f/abc123' && ft.json);

    const nl = Forms.formEndpoint({ provider: 'netlify', formName: 'contact' });
    ok('netlify uses urlencoded form posts', nl.json === false);
    ok('netlify injects the form-name field', nl.inject['form-name'] === 'contact');
    ok('netlify without an endpoint falls back to the current path', nl.url === '');
    const nl2 = Forms.formEndpoint({ provider: 'netlify', endpoint: '/thanks' });
    ok('netlify honours an explicit endpoint', nl2.url === '/thanks');

    const cf = Forms.formEndpoint({ provider: 'cloudflare', endpoint: 'https://forms.worker.dev/hook' });
    ok('cloudflare workers accept a custom endpoint',
      cf.url === 'https://forms.worker.dev/hook' && cf.json === true);
    ok('cloudflare without an endpoint fails fast',
      (() => { const e = threw(() => Forms.formEndpoint({ provider: 'cloudflare' })); return e && e.code === 'missing_credential'; })());
    ok('a non-http endpoint is rejected',
      (() => { const e = threw(() => Forms.formEndpoint({ provider: 'custom', endpoint: 'ftp://x' })); return e && e.code === 'bad_input'; })());
    ok('an unknown provider names the supported set',
      (() => { const e = threw(() => Forms.formEndpoint({ provider: 'mailchimp' })); return e && e.code === 'unknown_provider' && /formspree/.test(e.message); })());
    ok('the honeypot default is botcheck', Forms.HONEYPOT_DEFAULT === 'botcheck');
  }

  // ==== 2. handler script ============================================
  console.log('\n2. The handler script: budget, validation, honeypot, toasts');
  {
    const script = Forms.generateFormHandlerScript({
      id: 'contact',
      provider: 'web3forms',
      accessKey: 'abc-123',
      fields: { name: 'required', email: 'email', phone: 'phone', company: 'optional' }
    });
    const bytes = Buffer.byteLength(script);
    ok('stays under the 1.5KB inline budget', bytes > 0 && bytes < 1536, bytes + ' bytes');
    compiles('handler script', script);
    ok('intercepts submit and prevents the native post',
      script.indexOf('addEventListener("submit"') !== -1 && script.indexOf('preventDefault') !== -1);
    ok('doubles up as a double-submit guard', script.indexOf('if(f.busy)return') !== -1);
    ok('the endpoint URL is baked in literally',
      script.indexOf('"https://api.web3forms.com/submit"') !== -1);
    ok('the access_key rides along', script.indexOf('"access_key":"abc-123"') !== -1);
    ok('no eval() anywhere', script.indexOf('eval(') === -1);

    // Validation: the shared core the tests drive directly...
    const badEmail = Forms.validateValues({ email: 'a@b.c' }, { email: 'email' });
    ok('a one-letter TLD fails email validation',
      badEmail.length === 1 && badEmail[0].kind === 'email');
    ok('a good email passes',
      Forms.validateValues({ email: 'hi@acme.example' }, { email: 'email' }).length === 0);
    ok('an empty required field is caught',
      Forms.validateValues({ name: '  ' }, { name: 'required' })[0].kind === 'required');
    ok('an optional empty field is not',
      Forms.validateValues({}, { nickname: 'optional' }).length === 0);
    ok('a too-short phone fails (digit floor)',
      Forms.validateValues({ phone: '123' }, { phone: 'phone' }).length === 1);
    ok('a letter-stuffed phone fails the shape',
      Forms.validateValues({ phone: 'call me maybe' }, { phone: 'phone' }).length === 1);
    ok('an international number passes',
      Forms.validateValues({ phone: '+44 20 7946 0958' }, { phone: 'phone' }).length === 0);
    ok('parenthesised local numbers pass',
      Forms.validateValues({ phone: '(01904) 555123' }, { phone: 'phone' }).length === 0);

    // ...and the script carries the SAME regex sources.
    ok('the script interpolates the exported EMAIL_RE source',
      script.indexOf(Forms.EMAIL_RE.source) !== -1);
    ok('the script interpolates the exported PHONE_RE source',
      script.indexOf(Forms.PHONE_RE.source) !== -1);
    ok('the script applies the same digit floor', script.indexOf('.length>6') !== -1);

    // Honeypot.
    ok('the script checks the honeypot before anything else',
      script.indexOf('if(c.hp&&v[c.hp])') !== -1
      && script.indexOf('if(c.hp&&v[c.hp])') < script.indexOf('preventDefault') + 400
      && script.indexOf('say(c.ok,1);f.reset();return;') !== -1);
    ok('the honeypot field name is in the runtime config', script.indexOf('"hp":"botcheck"') !== -1);
    const noHp = Forms.generateFormHandlerScript({
      id: 'c', provider: 'custom', endpoint: 'https://w.example/h', honeypot: false, fields: {}
    });
    ok('the honeypot can be switched off', noHp.indexOf('"hp":""') !== -1);
    const hp = Forms.honeypotFieldHTML();
    checkStructure('honeypot markup is balanced (label resolves)', hp);
    ok('the honeypot is off-screen, not display:none',
      hp.indexOf('left:-100vw') !== -1 && hp.indexOf('display:none') === -1);
    ok('the honeypot is unreachable by keyboard and AT',
      hp.indexOf('tabindex="-1"') !== -1 && hp.indexOf('aria-hidden="true"') !== -1
      && hp.indexOf('autocomplete="off"') !== -1);
    ok('the honeypot is named botcheck by default', hp.indexOf('name="botcheck"') !== -1);

    // Toasts.
    ok('success announces through role="status", failure through role="alert"',
      script.indexOf('ok?"status":"alert"') !== -1);
    ok('the default success message is the promised copy',
      script.indexOf('Thank you! Your message has been sent.') !== -1);
    const custom = Forms.generateFormHandlerScript({
      id: 'c', provider: 'custom', endpoint: 'https://w.example/h',
      successMessage: 'Merci beaucoup!', errorMessage: 'Champs invalides.'
    });
    ok('messages are customisable', custom.indexOf('Merci beaucoup!') !== -1
      && custom.indexOf('Champs invalides.') !== -1);
    ok('a missing form id fails fast',
      (() => { const e = threw(() => Forms.generateFormHandlerScript({ provider: 'custom', endpoint: 'https://x.example/' })); return e && e.code === 'bad_input'; })());

    const nlScript = Forms.generateFormHandlerScript({
      id: 'signup', provider: 'netlify', formName: 'newsletter', fields: { email: 'email' }
    });
    ok('the netlify variant stays under budget too',
      Buffer.byteLength(nlScript) < 1536, Buffer.byteLength(nlScript) + ' bytes');
    compiles('netlify handler', nlScript);
    ok('netlify posts urlencoded with form-name',
      nlScript.indexOf('URLSearchParams') !== -1
      && nlScript.indexOf('application/x-www-form-urlencoded') !== -1
      && nlScript.indexOf('"form-name":"newsletter"') !== -1);
  }

  // ==== 3. client vault ==============================================
  console.log('\n3. The vault: exact recovery, and the browser core for real');
  const SECRET = '<section class="gated"><h3>Client files</h3>'
    + '<p>Pass: tr\u00f6uble &amp; "quotes" — 100% exact.</p>'
    + '<a href="/dl/x.zip">Download</a></section>';
  {
    const enc = Vault.encryptSectionContent(SECRET, 'correct horse');
    const saltB = Buffer.from(enc.salt, 'base64');
    const ivB = Buffer.from(enc.iv, 'base64');
    const tagB = Buffer.from(enc.tag, 'base64');
    const ctB = Buffer.from(enc.encryptedData, 'base64');
    ok('PBKDF2 runs 100,000 iterations', enc.iterations === 100000 && Vault.PBKDF2_ITERATIONS === 100000);
    ok('salt is 16 random bytes', saltB.length === Vault.SALT_BYTES && saltB.length === 16);
    ok('IV is the GCM-canonical 12 bytes', ivB.length === 12 && ivB.length === Vault.IV_BYTES);
    ok('auth tag is 16 bytes', tagB.length === 16 && tagB.length === Vault.TAG_BYTES);
    ok('AES-256-GCM ciphertext does not expand the payload',
      ctB.length === Buffer.byteLength(SECRET, 'utf8'));
    ok('the plaintext is nowhere in the ciphertext', ctB.toString('utf8').indexOf('gated') === -1);

    const back = Vault.decryptSectionContent(enc, 'correct horse');
    ok('the PBKDF2/AES-GCM cycle recovers the EXACT payload', back === SECRET);
    const enc2 = Vault.encryptSectionContent(SECRET, 'correct horse');
    ok('every encryption gets a fresh salt and IV',
      enc2.salt !== enc.salt && enc2.iv !== enc.iv && enc2.encryptedData !== enc.encryptedData);

    ok('a wrong password is rejected as auth_failed',
      (() => { const e = threw(() => Vault.decryptSectionContent(enc, 'wrong horse')); return e && e.code === 'auth_failed'; })());
    const flipped = (enc.encryptedData[0] === 'A' ? 'B' : 'A') + enc.encryptedData.slice(1);
    ok('tampered ciphertext is rejected',
      (() => { const e = threw(() => Vault.decryptSectionContent(Object.assign({}, enc, { encryptedData: flipped }), 'correct horse')); return e && e.code === 'auth_failed'; })());
    ok('empty content fails fast',
      (() => { const e = threw(() => Vault.encryptSectionContent('', 'pw')); return e && e.code === 'bad_input'; })());
    ok('a missing password fails fast',
      (() => { const e = threw(() => Vault.encryptSectionContent('<p>x</p>', '')); return e && e.code === 'bad_input'; })());

    // THE BROWSER PATH: evaluate the exact core source the page gets.
    const core = new Function('return (' + Vault.browserDecryptCore() + ')')();
    const viaBrowser = await core(enc.encryptedData, enc.salt, enc.iv, enc.tag, 'correct horse');
    ok('the browser decrypt core (crypto.subtle) recovers the EXACT payload',
      viaBrowser === SECRET, JSON.stringify(viaBrowser).slice(0, 60));
    const wrongPw = await core(enc.encryptedData, enc.salt, enc.iv, enc.tag, 'nope')
      .then(() => null, (e) => e);
    ok('the browser core rejects a wrong password', !!wrongPw);
    const tampered = await core(flipped, enc.salt, enc.iv, enc.tag, 'correct horse')
      .then(() => null, (e) => e);
    ok('the browser core rejects tampered ciphertext', !!tampered);

    // The unlock fragment.
    const frag = Vault.generateVaultUnlockScript(enc, { title: 'Member area' });
    checkStructure('unlock card markup is balanced', frag);
    ok('the card carries a labelled password field',
      frag.indexOf('type="password"') !== -1 && frag.indexOf('for="pai-vault-pw"') !== -1);
    ok('errors land in role="alert"', frag.indexOf('role="alert"') !== -1);
    ok('the wrong-password path marks aria-invalid and refocuses',
      frag.indexOf('aria-invalid') !== -1 && frag.indexOf('fail()') !== -1);
    ok('the payload travels inside the script, never the markup',
      frag.indexOf(enc.encryptedData) !== -1
      && structure(frag.replace(/<script>[\s\S]*?<\/script>/, '')).error === ''
      && frag.split('</script>')[0].indexOf(enc.encryptedData) !== -1);
    ok('the decrypt core is embedded with its iteration count',
      frag.indexOf('crypto.subtle') !== -1 && frag.indexOf('iterations:100000') !== -1
      && frag.indexOf('AES-GCM') !== -1 && frag.indexOf('PBKDF2') !== -1);
    ok('the tag is concatenated for WebCrypto', frag.indexOf('both.set(t,c.length)') !== -1);
    ok('the hand-off fades the card out, swaps, fades in',
      frag.indexOf('box.style.opacity="0"') !== -1 && frag.indexOf('box.innerHTML=html') !== -1
      && frag.indexOf('transitionend') !== -1);
    ok('the shake keyframes are reduced-motion guarded',
      frag.indexOf('@keyframes pai-vault-shake') !== -1
      && frag.indexOf('@media (prefers-reduced-motion: reduce)') !== -1);
    compiles('unlock script', scriptOf(frag));
    ok('the four-argument form works too',
      Vault.generateVaultUnlockScript(enc.encryptedData, enc.salt, enc.iv, enc.tag)
        .indexOf(enc.encryptedData) !== -1);
    ok('missing payload fields fail fast',
      (() => { const e = threw(() => Vault.generateVaultUnlockScript(null, 'x')); return e && e.code === 'bad_input'; })());
  }

  // ==== 4. FX presets =================================================
  console.log('\n4. Tilt, magnetic and scroll presets');
  const HOVER = '(hover: hover) and (pointer: fine)';
  const REDUCE = '(prefers-reduced-motion: reduce)';
  {
    const tilt = FX.generate3DTiltCardsScript();
    compiles('tilt script', tilt);
    ok('the perspective transform is exactly as specified',
      tilt.indexOf('perspective(1000px)') !== -1
      && tilt.indexOf('rotateX(') !== -1 && tilt.indexOf('rotateY(') !== -1);
    ok('the script bails without a fine pointer',
      tilt.indexOf('matchMedia("' + HOVER + '")') !== -1, tilt.slice(0, 140));
    ok('the script bails under reduced motion',
      tilt.indexOf('matchMedia("' + REDUCE + '")') !== -1);
    ok('pointerleave resets the transform', tilt.indexOf('pointerleave') !== -1
      && tilt.indexOf('el.style.transform=""') !== -1);
    const tilt20 = FX.generate3DTiltCardsScript({ max: 20 });
    ok('the amplitude is configurable and clamped',
      tilt20.indexOf(',m=20;') !== -1 && FX.generate3DTiltCardsScript({ max: 999 }).indexOf(',m=30;') !== -1);
    const evilTilt = FX.generate3DTiltCardsScript({ selector: '";alert(1);//' });
    ok('a hostile selector falls back to the default',
      evilTilt.indexOf('alert(1)') === -1 && evilTilt.indexOf('[data-pai-tilt]') !== -1);

    const mag = FX.generateMagneticButtonsScript();
    compiles('magnetic script', mag);
    ok('magnetic pull translates toward the cursor',
      mag.indexOf('translate(') !== -1 && mag.indexOf('pointermove') !== -1);
    ok('magnetic buttons carry the same hover and reduce guards',
      mag.indexOf('matchMedia("' + HOVER + '")') !== -1
      && mag.indexOf('matchMedia("' + REDUCE + '")') !== -1);
    ok('the shift is clamped so buttons cannot leap away',
      mag.indexOf('Math.max(-c,') !== -1);
    ok('strength and clamp are configurable',
      FX.generateMagneticButtonsScript({ strength: 0.5 }).indexOf(',k=0.5,') !== -1
      && FX.generateMagneticButtonsScript({ maxShift: 40 }).indexOf(',c=40;') !== -1);

    const prog = FX.generateScrollProgressBarScript();
    const pb = Buffer.byteLength(prog);
    ok('the progress indicator fits its 0.2KB budget', pb > 0 && pb <= 204, pb + ' bytes');
    compiles('progress script', prog);
    ok('it is tied to scroll depth',
      prog.indexOf('scrollY(') !== -1 || prog.indexOf('scrollY/') !== -1);
    ok('it listens passively so scrolling stays smooth', prog.indexOf('passive:1') !== -1);
    ok('it targets the progress bar', prog.indexOf('.pai-progress') !== -1);

    const tiltCss = FX.tiltCSS();
    const magCss = FX.magneticCSS();
    ok('tilt styles are wrapped in the hover/pointer media query',
      tiltCss.indexOf(FX.HOVER_MEDIA) === 0, tiltCss.slice(0, 60));
    ok('magnetic styles are wrapped the same way',
      magCss.indexOf(FX.HOVER_MEDIA) === 0);
    ok('the media constant matches the brief exactly',
      FX.HOVER_MEDIA === '@media ' + HOVER && FX.HOVER_QUERY === HOVER);
    ok('wrapping is idempotent', FX.wrapHoverCSS(tiltCss) === tiltCss);
    const wrapped = FX.wrapHoverCSS('.x{color:red}');
    ok('raw CSS gets wrapped and balanced',
      wrapped.indexOf('@media (hover: hover) and (pointer: fine){') === 0
      && wrapped.trim().slice(-1) === '}');
    ok('empty CSS stays empty', FX.wrapHoverCSS('') === '');
    const progCss = FX.scrollProgressCSS();
    ok('the progress track starts at zero and is fixed to the top',
      progCss.indexOf('transform:scaleX(0)') !== -1 && progCss.indexOf('position:fixed;top:0') !== -1);
    ok('a hostile progress selector falls back too',
      FX.scrollProgressCSS({ selector: 'a{}b' }).indexOf('a{}b') === -1);
  }

  // ==== 5. DNS diagnostics (mocked) ===================================
  console.log('\n5. DNS pre-flight against mocked resolvers');
  {
    const cfPass = await Dom.verifyDomainDNS('acme.example', 'cloudflare',
      { dns: resolverMock(['acme-site.pages.dev'], []) });
    ok('cloudflare passes on CNAME to *.pages.dev',
      cfPass.ok === true && cfPass.missing.length === 0
      && cfPass.matched[0] === 'CNAME → acme-site.pages.dev');
    ok('the expectation is reported for the UI',
      cfPass.expected[0] === 'CNAME → *.pages.dev' && cfPass.records.cname[0] === 'acme-site.pages.dev');

    const cfExact = await Dom.verifyDomainDNS('acme.example', 'cf',
      { dns: resolverMock(['other.pages.dev'], []), expectedTarget: 'acme-site.pages.dev' });
    ok('an exact expected target rejects a near miss',
      cfExact.ok === false && cfExact.missing.indexOf('CNAME → acme-site.pages.dev') !== -1);

    const cfFlat = await Dom.verifyDomainDNS('acme.example', 'cloudflare',
      { dns: resolverMock(null, ['104.21.10.8']) });
    ok('flattened anycast A records pass WITH a warning',
      cfFlat.ok === true && cfFlat.warnings.length === 1
      && /flattening/.test(cfFlat.warnings[0]), JSON.stringify(cfFlat.warnings));

    const cfFail = await Dom.verifyDomainDNS('acme.example', 'cloudflare',
      { dns: resolverMock(['elsewhere.example.com'], ['203.0.113.9']) });
    ok('a wrong CNAME fails with the expectation listed',
      cfFail.ok === false && cfFail.matched.length === 0
      && cfFail.missing.indexOf('CNAME → *.pages.dev') !== -1);

    const nlCname = await Dom.verifyDomainDNS('shop.example', 'netlify',
      { dns: resolverMock(['dazzling-pastry-123.netlify.app'], []) });
    ok('netlify passes on CNAME to *.netlify.app', nlCname.ok === true);
    const nlApex = await Dom.verifyDomainDNS('example.com', 'netlify',
      { dns: resolverMock(null, ['75.2.60.5', '203.0.113.7']) });
    ok('netlify passes on its apex A record',
      nlApex.ok === true && nlApex.matched[0] === 'A → 75.2.60.5');
    const nlFail = await Dom.verifyDomainDNS('example.com', 'netlify',
      { dns: resolverMock(null, ['104.16.1.1']) });
    ok('a foreign A record fails netlify',
      nlFail.ok === false && nlFail.missing[0].indexOf('netlify.app') !== -1);

    const ghA = await Dom.verifyDomainDNS('docs.example', 'github',
      { dns: resolverMock(null, ['192.0.2.44', '185.199.108.153']) });
    ok('github passes when ANY expected Pages IP answers',
      ghA.ok === true && ghA.matched[0] === 'A → 185.199.108.153');
    const ghCname = await Dom.verifyDomainDNS('docs.example', 'github-pages',
      { dns: resolverMock(['octocat.github.io'], []) });
    ok('github also accepts a *.github.io CNAME', ghCname.ok === true);
    const ghFail = await Dom.verifyDomainDNS('docs.example', 'gh',
      { dns: resolverMock([], ['192.0.2.1']) });
    ok('a non-Pages A record fails github',
      ghFail.ok === false && ghFail.missing[0].indexOf('185.199.108.153') !== -1);

    const none = await Dom.verifyDomainDNS('fresh.example', 'cloudflare',
      { dns: resolverMock([], []) });
    ok('a domain with no records at all fails with a propagation hint',
      none.ok === false && none.warnings.some((w) => /propagation/.test(w)));

    const servfail = await Dom.verifyDomainDNS('acme.example', 'cloudflare', {
      dns: {
        resolveCname: async () => { const e = new Error('SERVFAIL'); e.code = 'ESERVFAIL'; throw e; },
        resolve4: async () => { const e = new Error('SERVFAIL'); e.code = 'ESERVFAIL'; throw e; }
      }
    });
    ok('a resolver outage fails CLOSED, not with a crash', servfail.ok === false);

    ok('an unknown provider throws',
      await rej(Dom.verifyDomainDNS('acme.example', 'vercel', { dns: resolverMock([], []) }))
        .then((e) => e && e.code === 'unknown_provider'));
    ok('a malformed domain throws',
      await rej(Dom.verifyDomainDNS('localhost', 'cloudflare', { dns: resolverMock([], []) }))
        .then((e) => e && e.code === 'bad_input'));
    ok('pasted URLs are tolerated and normalised',
      Dom.normalizeHost('https://Acme.Example/path?q=1') === 'acme.example');
    ok('CIDR matching is correct',
      Dom.inCIDR('104.21.10.8', '104.16.0.0/13') === true
      && Dom.inCIDR('105.0.0.1', '104.16.0.0/13') === false);
  }

  // ==== 6. TLS checks (mocked) ========================================
  console.log('\n6. TLS handshake checks against mocked sockets');
  {
    const good = await Dom.checkSSLStatus('acme.example', {
      connect: tlsMock({ cert: certFixture({ validToDate: new Date(Date.now() + 90 * DAY) }) })
    });
    ok('a healthy certificate passes', good.ok === true && good.errors.length === 0);
    ok('the expiry countdown is reported',
      good.daysRemaining >= 89 && good.daysRemaining <= 90, String(good.daysRemaining));
    ok('hostname match is recorded', good.hostnameMatches === true);
    ok('a string valid_to (legacy field) is also read', (await Dom.checkSSLStatus('acme.example', {
      connect: tlsMock({ cert: certFixture({ validToMs: Date.now() + 30 * DAY }) })
    })).ok === true);

    const expiring = await Dom.checkSSLStatus('acme.example', {
      connect: tlsMock({ cert: certFixture({ validToDate: new Date(Date.now() + 5 * DAY) }) })
    });
    ok('a cert expiring in 5 days warns but still passes',
      expiring.ok === true && expiring.warnings.some((w) => /expires in [45] day/.test(w)),
      JSON.stringify(expiring.warnings));

    const expired = await Dom.checkSSLStatus('acme.example', {
      connect: tlsMock({ cert: certFixture({ validToDate: new Date(Date.now() - 2 * DAY) }) })
    });
    ok('an expired certificate fails with a dated error',
      expired.ok === false && expired.errors.some((e) => /expired [23] day/.test(e)),
      JSON.stringify(expired.errors));

    const mismatch = await Dom.checkSSLStatus('acme.example', {
      connect: tlsMock({ cert: certFixture({ validToDate: new Date(Date.now() + 60 * DAY), san: 'DNS:other.example' }) })
    });
    ok('a SAN mismatch fails', mismatch.ok === false && mismatch.hostnameMatches === false
      && mismatch.errors.some((e) => /SAN mismatch/.test(e)));

    const wildOk = await Dom.checkSSLStatus('acme.example.com', {
      connect: tlsMock({ cert: certFixture({ subject: 'example.com', validToDate: new Date(Date.now() + 60 * DAY), san: 'DNS:*.example.com' }) })
    });
    ok('a wildcard covers one label', wildOk.ok === true && wildOk.hostnameMatches === true);
    const wildNo = await Dom.checkSSLStatus('a.b.example.com', {
      connect: tlsMock({ cert: certFixture({ subject: 'example.com', validToDate: new Date(Date.now() + 60 * DAY), san: 'DNS:*.example.com' }) })
    });
    ok('...but never two labels', wildNo.ok === false && wildNo.hostnameMatches === false);

    const selfSigned = await Dom.checkSSLStatus('acme.example', {
      connect: tlsMock({ cert: certFixture({ subject: 'acme.example', issuer: 'acme.example', validToDate: new Date(Date.now() + 60 * DAY) }) })
    });
    ok('self-signed is called out as a warning',
      selfSigned.ok === true && selfSigned.warnings.some((w) => /self-signed/.test(w)));

    const noCert = await Dom.checkSSLStatus('acme.example', { connect: tlsMock({ cert: {} }) });
    ok('a socket with no certificate fails cleanly',
      noCert.ok === false && noCert.errors[0].indexOf('no certificate') !== -1);

    const broke = await Dom.checkSSLStatus('acme.example', {
      connect: tlsMock({ error: new Error('self signed certificate chain') })
    });
    ok('a handshake error is reported verbatim',
      broke.ok === false && /self signed certificate chain/.test(broke.errors[0]));

    const chained = await Dom.checkSSLStatus('acme.example', {
      connect: tlsMock({ cert: certFixture({ validToDate: new Date(Date.now() + 60 * DAY) }), authErr: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })
    });
    ok('a chain authorization error surfaces as a warning',
      chained.warnings.some((w) => /UNABLE_TO_VERIFY/.test(w)), JSON.stringify(chained.warnings));

    const slow = await Dom.checkSSLStatus('acme.example', {
      connect: tlsMock({ silent: true }), timeout: 30
    });
    ok('a stalled handshake times out', slow.ok === false && /timed out after 30ms/.test(slow.errors[0]));

    ok('a non-domain hostname throws',
      await rej(Dom.checkSSLStatus('not a host', { connect: tlsMock({ cert: {} }) }))
        .then((e) => e && e.code === 'bad_input'));
  }

  // ==== 7. combined pre-flight =======================================
  console.log('\n7. The combined pre-flight report');
  {
    const ready = await Dom.preflightDeployment('acme.example', 'cloudflare', {
      dns: resolverMock(['acme-site.pages.dev'], []),
      connect: tlsMock({ cert: certFixture({ validToDate: new Date(Date.now() + 90 * DAY) }) })
    });
    ok('DNS + valid cert → ready', ready.ready === true && ready.blockers.length === 0);
    ok('the summary says what passed',
      /^Ready — DNS matches cloudflare/.test(ready.summary), ready.summary);

    const blocked = await Dom.preflightDeployment('acme.example', 'cloudflare', {
      dns: resolverMock(['wrong.example.net'], []),
      connect: tlsMock({ cert: certFixture({ validToDate: new Date(Date.now() - 1 * DAY) }) })
    });
    ok('broken DNS + expired cert → blocked',
      blocked.ready === false && blocked.blockers.length >= 2);
    ok('blockers are prefixed by subsystem',
      blocked.blockers.some((b) => b.indexOf('DNS: ') === 0)
      && blocked.blockers.some((b) => b.indexOf('SSL: ') === 0),
      JSON.stringify(blocked.blockers));
    ok('the summary is a human diagnosis',
      /^Blocked — 2 issue\(s\)/.test(blocked.summary), blocked.summary);

    const dnsOnly = await Dom.preflightDeployment('fresh.example', 'netlify', {
      dns: resolverMock([], []), ssl: false
    });
    ok('the SSL stage can be skipped (record not created yet)',
      dnsOnly.ssl === null && dnsOnly.ready === false
      && dnsOnly.blockers.every((b) => b.indexOf('DNS: ') === 0));
    ok('both reports carry a timestamp',
      typeof ready.checkedAt === 'string' && typeof ready.ssl.checkedAt === 'string');
  }

  // ==== verdict =======================================================
  if (failed) {
    console.error('\nEXTENDED MOTION & FORMS SMOKE FAILED: ' + failed);
    process.exit(1);
  }
  console.log('\nAll extended motion, forms, vault, FX & domain checks passed.');
  process.exit(0);
})().catch((e) => {
  console.error('motion-deploy-advanced smoke crashed:', e);
  process.exit(1);
});

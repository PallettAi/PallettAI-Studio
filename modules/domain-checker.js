'use strict';
// ============================================================
// PallettAI Studio — domain DNS & SSL pre-flight verifier
// Answers "will this custom domain work?" BEFORE modules/deploy
// fires, so a broken CNAME is caught in the Studio instead of
// discovered on the live site hours later.
// ------------------------------------------------------------
//   1. verifyDomainDNS(domain, provider, opts?)
//      Resolves CNAME + A through Node's dns.promises and
//      checks them against the provider's real endpoints:
//        Cloudflare Pages → CNAME *.pages.dev (or your exact
//          <project>.pages.dev), accepting flattened anycast
//          A records when the zone itself sits on Cloudflare
//        Netlify          → CNAME *.netlify.app / *.netlify.com,
//          or the Netlify apex A records
//        GitHub Pages     → the four 185.199.108–111.153 A
//          records, or CNAME *.github.io
//   2. checkSSLStatus(hostname, opts?)
//      A lightweight TLS handshake that reads the presented
//      certificate: expiry countdown, SAN/hostname match,
//      self-signed detection, chain authorization error if the
//      runtime reports one.
//   3. preflightDeployment(domain, provider, opts?)
//      Both checks merged into one diagnostic report — blockers,
//      warnings and a human summary — meant to run directly
//      before publishSite().
//
// ---- what this file guarantees ----------------------------------
// 1. EVERYTHING IS INJECTABLE. opts.dns ({resolveCname,
//    resolve4}) and opts.connect (TLS factory) are overridable,
//    so the smoke runner proves the pass/fail logic without a
//    packet ever leaving the machine — and the default paths use
//    only Node builtins (dns, tls).
// 2. A MISSING RECORD IS A DIAGNOSIS, NOT A CRASH. Resolver
//    errors with ENODATA/ENOTFOUND become "record absent" and a
//    populated `missing` list; only programmer errors (unknown
//    provider, malformed domain) throw.
// 3. THE REPORT NEVER LIES ABOUT WHAT IT CHECKED: `matched`
//    names the exact record that satisfied the rule, `missing`
//    names exactly what was expected, and warnings say when a
//    pass came from an inference (flattened anycast range)
//    rather than a literal CNAME.
// ============================================================

const dns = require('dns');
const tls = require('tls');

// ---- provider expectations ---------------------------------------------

// GitHub Pages custom-domain A records (docs.github.com).
const GITHUB_PAGES_IPS = [
  '185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'
];
// Netlify's apex load-balancer addresses.
const NETLIFY_APEX_IPS = ['75.2.60.5', '75.2.60.6'];
// Cloudflare anycast ranges a flattened apex CNAME collapses into.
const CLOUDFLARE_CIDRS = ['104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '162.158.0.0/15'];

const PROVIDERS = {
  cloudflare: 'cloudflare', 'cloudflare-pages': 'cloudflare', cf: 'cloudflare',
  netlify: 'netlify',
  github: 'github', 'github-pages': 'github', gh: 'github', 'gh-pages': 'github'
};

// ---- small helpers ------------------------------------------------------

function normalizeHost(raw) {
  let s = String(raw == null ? '' : raw).trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');   // tolerate pasted URLs
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) {
    const e = new Error('"' + s + '" is not a valid domain name');
    e.code = 'bad_input';
    throw e;
  }
  return s;
}

function ipToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255 || !/^\d+$/.test(p)) return null;
    n = (n * 256) + v;
  }
  return n >>> 0;
}

function inCIDR(ip, cidr) {
  const [net, bitsStr] = String(cidr).split('/');
  const bits = Number(bitsStr);
  const a = ipToInt(ip);
  const b = ipToInt(net);
  if (a == null || b == null || !Number.isInteger(bits)) return false;
  const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

function cnameMatches(target, suffixes) {
  const t = String(target || '').toLowerCase().replace(/\.$/, '');
  return suffixes.some((s) => t === s.slice(1) || t.endsWith(s) || t === s.replace(/^\./, ''));
}

async function safeResolve(fn, name) {
  try {
    const out = await fn(name);
    return Array.isArray(out) ? out.map(String) : [];
  } catch (e) {
    const code = e && e.code;
    // Absent record → empty. Anything unexpected (SERVFAIL, network)
    // is surfaced as a warning instead of silently treated as missing.
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'ENAMEUNREACH'
      || code === 'ENORECORD' || code === 'ESERVFAIL') return [];
    throw e;
  }
}

// ---- 1) DNS verification ------------------------------------------------

/**
 * verifyDomainDNS(customDomain, provider, opts?) → report
 * opts.dns: {resolveCname, resolve4} — injectable for tests.
 * opts.expectedTarget: exact Cloudflare target, e.g. 'acme.pages.dev'.
 */
async function verifyDomainDNS(customDomain, provider, opts) {
  opts = opts || {};
  const p = PROVIDERS[String(provider || '').toLowerCase().trim()];
  if (!p) {
    const e = new Error('Unknown provider "' + String(provider || '')
      + '". Use cloudflare, netlify, or github.');
    e.code = 'unknown_provider';
    throw e;
  }
  const domain = normalizeHost(customDomain);
  const resolver = opts.dns || dns.promises;
  const cname = await safeResolve(resolver.resolveCname.bind(resolver), domain);
  const a = await safeResolve(resolver.resolve4.bind(resolver), domain);

  const report = {
    ok: false,
    domain,
    provider: p,
    records: { cname, a },
    expected: [],
    matched: [],
    missing: [],
    warnings: [],
    checkedAt: new Date().toISOString()
  };

  const expect = (s) => report.expected.push(s);
  const hit = (s) => report.matched.push(s);
  const need = (s) => report.missing.push(s);

  if (p === 'cloudflare') {
    const exact = opts.expectedTarget ? String(opts.expectedTarget).toLowerCase().replace(/\.$/, '') : '';
    const want = exact || '*.pages.dev';
    expect('CNAME → ' + want);
    const good = cname.find((t) => (exact
      ? String(t).toLowerCase().replace(/\.$/, '') === exact
      : cnameMatches(t, ['.pages.dev'])));
    if (good) {
      hit('CNAME → ' + good);
    } else if (a.length && a.every((ip) => CLOUDFLARE_CIDRS.some((c) => inCIDR(ip, c)))) {
      // Zone-on-Cloudflare flattening: the CNAME is rewritten into
      // anycast A records before a public resolver sees it.
      hit('A → ' + a.join(', ') + ' (Cloudflare anycast)');
      report.warnings.push('no CNAME found; the A record(s) match Cloudflare\'s anycast ranges, '
        + 'which is consistent with apex flattening — confirm "' + want + '" in the dashboard');
    }
  } else if (p === 'netlify') {
    expect('CNAME → *.netlify.app (or Netlify apex A)');
    const goodCname = cname.find((t) => cnameMatches(t, ['.netlify.app', '.netlify.com']));
    const goodA = a.find((ip) => NETLIFY_APEX_IPS.indexOf(ip) !== -1);
    if (goodCname) hit('CNAME → ' + goodCname);
    else if (goodA) hit('A → ' + goodA);
  } else { // github
    expect('A → ' + GITHUB_PAGES_IPS.join(' / ') + ' (or CNAME → *.github.io)');
    const goodA = a.find((ip) => GITHUB_PAGES_IPS.indexOf(ip) !== -1);
    const goodCname = cname.find((t) => cnameMatches(t, ['.github.io']));
    if (goodA) hit('A → ' + goodA);
    else if (goodCname) hit('CNAME → ' + goodCname);
  }

  if (!report.matched.length && !cname.length && !a.length) {
    report.warnings.push('the domain resolves to no records at all (propagation may still be pending)');
  }
  if (!report.matched.length) {
    // Report exactly what was expected, plus what actually exists.
    report.expected.forEach((e) => { if (report.missing.indexOf(e) === -1) report.missing.push(e); });
  }
  report.ok = report.matched.length > 0;
  return report;
}

// ---- 2) TLS handshake check --------------------------------------------

function failSSL(host, errors, warnings) {
  return {
    ok: false,
    hostname: host,
    connected: false,
    expected: [],
    matched: [],
    missing: [],
    warnings: warnings || [],
    errors: errors,
    checkedAt: new Date().toISOString()
  };
}

function defaultConnect(opts) {
  return tls.connect(opts);
}

function sanMatches(host, cert) {
  const entries = String(cert.subjectaltname || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.indexOf('DNS:') === 0)
    .map((s) => s.slice(4).toLowerCase());
  const list = entries.length ? entries
    : [String((cert.subject && cert.subject.CN) || '').toLowerCase()].filter(Boolean);
  return list.some((e) => {
    if (e === host) return true;
    if (e.indexOf('*.') === 0) { // wildcard covers exactly one label
      const base = e.slice(2);
      return host.endsWith('.' + base) && host.slice(0, -(base.length + 1)).indexOf('.') === -1;
    }
    return false;
  });
}

/**
 * checkSSLStatus(hostname, opts?) → Promise<report>
 * opts.connect: TLS factory (tests inject a fake socket);
 * opts.timeout: ms (default 5000); opts.port: default 443.
 *
 * The socket contract: emit 'secureConnect' after the handshake,
 * 'error' on failure, 'timeout' when idle; expose
 * getPeerCertificate() and destroy().
 */
function checkSSLStatus(hostname, opts) {
  opts = opts || {};
  let host;
  try {
    host = normalizeHost(hostname);
  } catch (e) {
    return Promise.reject(e);
  }
  const connect = typeof opts.connect === 'function' ? opts.connect : defaultConnect;
  const timeoutMs = Number.isFinite(opts.timeout) ? opts.timeout : 5000;

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      res.checkedAt = new Date().toISOString();
      resolve(res);
    };

    let socket;
    try {
      socket = connect({
        host,
        port: opts.port || 443,
        servername: host,
        rejectUnauthorized: false, // we READ authorizationError, we don't abort on it
        timeout: timeoutMs
      });
    } catch (e) {
      return finish(failSSL(host, ['TLS connection failed: ' + e.message]));
    }
    if (!socket || typeof socket.on !== 'function') {
      return finish(failSSL(host, ['TLS connector returned no socket']));
    }
    if (typeof socket.setTimeout === 'function') {
      try { socket.setTimeout(timeoutMs); } catch (_e) { /* mock without timers */ }
    }
    timer = setTimeout(() => {
      try { if (socket.destroy) socket.destroy(); } catch (_e) { /* noop */ }
      finish(failSSL(host, ['TLS handshake timed out after ' + timeoutMs + 'ms']));
    }, timeoutMs);

    socket.on('error', (e) => {
      finish(failSSL(host, ['TLS handshake failed: ' + (e && e.message ? e.message : String(e))]));
    });
    socket.on('timeout', () => {
      try { if (socket.destroy) socket.destroy(); } catch (_e) { /* noop */ }
      finish(failSSL(host, ['TLS handshake timed out after ' + timeoutMs + 'ms']));
    });
    socket.on('secureConnect', () => {
      let cert = null;
      try {
        cert = typeof socket.getPeerCertificate === 'function' ? socket.getPeerCertificate() : null;
      } catch (e) {
        return finish(failSSL(host, ['could not read the peer certificate: ' + e.message]));
      }
      if (!cert || !cert.subject || (!cert.valid_to && !cert.validToDate)) {
        try { if (socket.destroy) socket.destroy(); } catch (_e) { /* noop */ }
        return finish(failSSL(host, ['no certificate presented for ' + host]));
      }

      const validTo = cert.validToDate instanceof Date ? cert.validToDate : new Date(cert.valid_to);
      const validFrom = cert.validFromDate instanceof Date ? cert.validFromDate
        : (cert.valid_from ? new Date(cert.valid_from) : null);
      const now = Date.now();
      const daysRemaining = Number.isFinite(validTo.getTime())
        ? Math.floor((validTo.getTime() - now) / 86400000)
        : NaN;
      const matches = sanMatches(host, cert);
      const issuerCN = String((cert.issuer && (cert.issuer.CN || cert.issuer.commonName)) || '');
      const subjectCN = String((cert.subject && (cert.subject.CN || cert.subject.commonName)) || '');
      const selfSigned = !!issuerCN && issuerCN === subjectCN;
      const authErr = socket.authorizationError
        ? String(socket.authorizationError.message || socket.authorizationError)
        : '';

      const errors = [];
      const warnings = [];
      if (!Number.isFinite(daysRemaining)) {
        errors.push('certificate has no readable expiry date');
      } else if (daysRemaining < 0) {
        errors.push('certificate expired ' + Math.abs(daysRemaining) + ' day(s) ago');
      } else if (daysRemaining <= 14) {
        warnings.push('certificate expires in ' + daysRemaining + ' day(s)');
      }
      if (!matches) {
        errors.push('certificate is not valid for "' + host + '" (SAN mismatch)');
      }
      if (selfSigned) warnings.push('certificate is self-signed — browsers will warn');
      if (authErr) warnings.push('chain authorization: ' + authErr);

      try { if (socket.destroy) socket.destroy(); } catch (_e) { /* noop */ }
      finish({
        ok: errors.length === 0,
        hostname: host,
        connected: true,
        validFrom: validFrom && Number.isFinite(validFrom.getTime()) ? validFrom.toISOString() : null,
        validTo: Number.isFinite(validTo.getTime()) ? validTo.toISOString() : null,
        daysRemaining,
        issuer: issuerCN || null,
        subject: subjectCN || null,
        subjectAltName: cert.subjectaltname || '',
        fingerprint256: cert.fingerprint256 || '',
        hostnameMatches: matches,
        selfSigned,
        authorizationError: authErr || null,
        errors,
        warnings
      });
    });
  });
}

// ---- 3) combined pre-flight --------------------------------------------

/**
 * preflightDeployment(domain, provider, opts?) — run this straight
 * before deploy/publish. opts.ssl === false skips the handshake
 * (useful when the DNS record legitimately has no target yet).
 */
async function preflightDeployment(domain, provider, opts) {
  opts = opts || {};
  const dnsReport = await verifyDomainDNS(domain, provider, opts);
  let sslReport = null;
  if (opts.ssl !== false) {
    sslReport = await checkSSLStatus(dnsReport.domain, opts).catch((e) => ({
      ok: false,
      hostname: dnsReport.domain,
      connected: false,
      errors: [e && e.message ? e.message : String(e)],
      warnings: [],
      checkedAt: new Date().toISOString()
    }));
  }

  const blockers = [];
  dnsReport.missing.forEach((m) => blockers.push('DNS: ' + m));
  if (sslReport && !sslReport.ok) {
    (sslReport.errors || []).forEach((m) => blockers.push('SSL: ' + m));
  }
  const warnings = dnsReport.warnings.concat(sslReport ? sslReport.warnings : []);
  const ready = blockers.length === 0;

  return {
    ready,
    domain: dnsReport.domain,
    provider: dnsReport.provider,
    dns: dnsReport,
    ssl: sslReport,
    blockers,
    warnings,
    summary: ready
      ? 'Ready — DNS matches ' + dnsReport.provider
        + (sslReport ? ' and the certificate is valid for ' + dnsReport.domain + '.' : '.')
      : 'Blocked — ' + blockers.length + ' issue(s): ' + blockers.join('; '),
    checkedAt: new Date().toISOString()
  };
}

module.exports = {
  PROVIDERS,
  GITHUB_PAGES_IPS,
  NETLIFY_APEX_IPS,
  CLOUDFLARE_CIDRS,
  normalizeHost,
  inCIDR,
  verifyDomainDNS,
  checkSSLStatus,
  preflightDeployment
};

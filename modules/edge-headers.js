'use strict';
// ============================================================
// PallettAI Studio — edge worker routing & headers generator.
// Emits the static-host config files (`_headers`, `_redirects`)
// that Cloudflare Pages and Netlify read natively, plus the
// `vercel.json` equivalents, so one rule set can be applied
// across all three edge providers.
// ------------------------------------------------------------
//   1. generateCloudflareHeaders(securityHeaders, cacheRules)
//        → `_headers` text: HSTS, CORS-friendly security headers
//          and granular Cache-Control, each rule path scoped.
//   2. generateRedirectsMatrix(redirectRules, options)
//        → {cloudflare, netlify, vercel} — the same logical rule
//          list in each provider's syntax: 301/302/303/307/308
//          redirects, canonical-domain enforcement
//          (forceWww/forceApex) and a custom 404 route, with
//          200 rewrites kept separate from redirects.
//
// ---- what this file guarantees ----------------------------------
// 1. ONE RULE LIST → THREE TARGETS: callers describe intent once
//    and receive provider-correct syntax. Vercel rewrites live in
//    their own key (a 200 rule is a rewrite there, never a
//    redirect), and canonical-domain rules use Vercel's documented
//    host `has` condition instead of a host-prefixed source.
// 2. HEADER NAMES ARE VALIDATED against the RFC 7230 token grammar
//    at build time, so the edge never silently drops a rule.
// 3. ONLY {200, 301, 302, 303, 307, 308} statuses are accepted —
//    exactly the set Cloudflare `_redirects` documents (301/302/
//    303/307/308) plus the 200 rewrite form.
// 4. DETERMINISTIC OUTPUT: stable ordering, no timestamps — the
//    same input always yields byte-identical files (safe for git
//    diff and CI drift checks).
// 5. SPA CATCH-ALL WINS: when both `spa` and `notFound` are set,
//    the catch-all is emitted alone (a 404 rule listed first
//    would shadow it on first-match-wins edge hosts).
// ============================================================

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// RFC 7230 token — a header name must match this exactly.
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const ALLOWED_STATUS = [200, 301, 302, 303, 307, 308];

const DEFAULT_SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin'
};

const DEFAULT_CACHE_RULES = [
  { path: '/*', 'cache-control': 'public, max-age=0, must-revalidate' },
  { path: '/static/*', 'cache-control': 'public, max-age=31536000, immutable' },
  { path: '/images/*', 'cache-control': 'public, max-age=86400' },
  { path: '/sw.js', 'cache-control': 'public, max-age=0, must-revalidate' }
];

function assertHeaderName(name) {
  if (typeof name !== 'string' || !HEADER_NAME_RE.test(name)) {
    throw fail('bad_input', 'Invalid header name ' + JSON.stringify(name));
  }
}

// ============================================================
// generateCloudflareHeaders(securityHeaders, cacheRules)
// ------------------------------------------------------------
// securityHeaders: {name: value} applied to /* (optional — the
//                  secure defaults are used when omitted).
// cacheRules:      [{path, ...headers}] scoped rules; pass [] to
//                  emit only the global block, omit to get the
//                  sensible defaults.
// Returns `_headers` file text.
// ============================================================

function generateCloudflareHeaders(securityHeaders, cacheRules) {
  const base = Object.assign({}, DEFAULT_SECURITY_HEADERS,
    securityHeaders && typeof securityHeaders === 'object' ? securityHeaders : {});
  Object.keys(base).forEach(assertHeaderName);
  if (Object.prototype.hasOwnProperty.call(base, 'cache-control')) {
    throw fail('bad_input',
      'cache-control belongs in cacheRules — it needs a path scope.');
  }

  let rules;
  if (cacheRules === undefined || cacheRules === null) {
    rules = DEFAULT_CACHE_RULES.slice();
  } else if (Array.isArray(cacheRules)) {
    rules = cacheRules;
  } else {
    throw fail('bad_input', 'cacheRules must be an array of {path, ...headers}.');
  }

  const lines = [];
  // 1) global security block — every matching path inherits it
  lines.push('/*');
  Object.keys(base).forEach((k) => {
    lines.push('  ' + k + ': ' + String(base[k]));
  });

  // 2) scoped cache blocks (first-match semantics are handled by
  //    the edge: later, more specific rules override)
  rules.forEach((rule) => {
    if (!rule || typeof rule.path !== 'string' || !rule.path) {
      throw fail('bad_input', 'Each cache rule needs a non-empty path.');
    }
    const headers = Object.keys(rule).filter((k) => k !== 'path');
    if (headers.length === 0) {
      throw fail('bad_input', 'Cache rule for ' + rule.path + ' has no headers.');
    }
    headers.forEach((h) => assertHeaderName(h));
    lines.push('');
    lines.push(rule.path);
    headers.forEach((h) => {
      lines.push('  ' + h + ': ' + String(rule[h]));
    });
  });

  return lines.join('\n') + '\n';
}

// ============================================================
// generateRedirectsMatrix(redirectRules, options)
// ------------------------------------------------------------
// redirectRules: [{from, to, status?}] — status defaults to 301.
// options:       {
//   notFound:   custom 404 page path (e.g. '/404.html');
//               defaults to '/* /404.html 404'
//   spa:        catch-all rewrite to '/index.html' (wins over
//               notFound — see guarantee 5)
//   forceWww:   canonical enforcement: 'example.com' (or true
//               with options.host) → apex 301s to www
//   forceApex:  'www.example.com' (or true with options.host)
//               → www 301s to apex
//   host:       used when forceWww/forceApex is boolean true
// }
// Returns {cloudflare, netlify, vercel} file texts.
// ============================================================

function normalizeRedirects(rules) {
  if (rules == null) return [];
  if (!Array.isArray(rules)) {
    throw fail('bad_input', 'redirectRules must be an array.');
  }
  return rules.map((r, i) => {
    if (!r || typeof r.from !== 'string' || typeof r.to !== 'string') {
      throw fail('bad_input', 'Rule ' + i + ' needs {from, to} strings.');
    }
    const status = r.status == null ? 301 : Number(r.status);
    if (ALLOWED_STATUS.indexOf(status) === -1) {
      throw fail('bad_input',
        'Rule ' + i + ' status ' + status + ' not in ' + ALLOWED_STATUS.join('/') + '.');
    }
    return { from: r.from, to: r.to, status };
  });
}

function canonicalRules(opts) {
  const out = [];
  const www = typeof opts.forceWww === 'string' ? opts.forceWww
    : (opts.forceWww ? opts.host : null);
  const apex = typeof opts.forceApex === 'string' ? opts.forceApex
    : (opts.forceApex ? opts.host : null);
  if (www) {
    if (typeof www !== 'string' || !www) {
      throw fail('bad_input', 'forceWww needs a host (options.host or the domain itself).');
    }
    const bare = www.replace(/^www\./, '');
    // Netlify/CF canonical pattern: wildcard from, :splat to
    out.push({
      from: 'https://' + bare + '/*',
      to: 'https://www.' + bare + '/:splat',
      status: 301
    });
  }
  if (apex) {
    if (typeof apex !== 'string' || !apex) {
      throw fail('bad_input', 'forceApex needs a host (options.host or the domain itself).');
    }
    const bare = apex.replace(/^www\./, '');
    out.push({
      from: 'https://www.' + bare + '/*',
      to: 'https://' + bare + '/:splat',
      status: 301
    });
  }
  return out;
}

// Vercel source/destination patterns: Netlify's `*` / `:splat`
// tokens become Vercel's `:path*` named wildcard. Order matters:
// convert `*` FIRST — the :splat pass then has no `*` to re-hit
// (the reverse order produced `:path:path*` on canonical rules).
function vercelPath(p) {
  return p.replace(/\*/g, ':path*').replace(/:splat/g, ':path*');
}

function splitRule(r) {
  const m = /^(?:https?:\/\/([^/]+))?(\S*)$/.exec(r);
  return { host: m[1] || '', path: m[2] || '/' };
}

function generateRedirectsMatrix(redirectRules, options) {
  const opts = options || {};
  const rules = normalizeRedirects(redirectRules).concat(canonicalRules(opts));

  // ---- Cloudflare Pages / Netlify `_redirects` ----------------
  // Same syntax on both hosts: `from to status`, first match wins.
  const cfLines = [];
  const nlLines = [];
  rules.forEach((r) => {
    if (r.status === 200) {
      cfLines.push(r.from + ' ' + r.to + ' 200');
      // Netlify forces an override with `!` so the rewrite beats
      // an existing file match
      nlLines.push(r.from + ' ' + r.to + ' 200!');
      return;
    }
    cfLines.push(r.from + ' ' + r.to + ' ' + r.status);
    nlLines.push(r.from + ' ' + r.to + ' ' + r.status);
  });
  const notFoundPage = opts.notFound || '/404.html';
  if (opts.spa) {
    cfLines.push('/* /index.html 200');
    nlLines.push('/* /index.html 200!');
  } else {
    cfLines.push('/* ' + notFoundPage + ' 404');
    nlLines.push('/* ' + notFoundPage + ' 404');
  }

  // ---- Vercel `vercel.json` ----------------------------------
  // Redirects and rewrites are separate arrays; host-canonical
  // rules use a `has` host condition (sources can't carry hosts).
  const vercelRedirects = [];
  const vercelRewrites = [];
  rules.forEach((r) => {
    const from = splitRule(r.from);
    const to = splitRule(r.to);
    if (r.status === 200) {
      vercelRewrites.push({
        source: vercelPath(from.path),
        destination: vercelPath(to.path)
      });
      return;
    }
    const entry = { permanent: r.status === 301 || r.status === 308 };
    if (from.host && to.host && from.host !== to.host) {
      // cross-host canonical rule → host condition + absolute dest
      entry.source = vercelPath(from.path);
      entry.has = [{ type: 'host', value: from.host }];
      entry.destination = (to.host ? 'https://' + to.host : '') + vercelPath(to.path);
    } else {
      entry.source = vercelPath(from.path);
      entry.destination = vercelPath(to.path);
    }
    vercelRedirects.push(entry);
  });
  if (opts.spa) {
    vercelRewrites.push({ source: '/(.*)', destination: '/index.html' });
  } else {
    // top-level rewrites run AFTER the filesystem check on Vercel,
    // so existing files win and unmatched URLs fall through here
    vercelRewrites.push({ source: '/(.*)', destination: notFoundPage });
  }

  return {
    cloudflare: cfLines.join('\n') + '\n',
    netlify: nlLines.join('\n') + '\n',
    vercel: JSON.stringify(
      { redirects: vercelRedirects, rewrites: vercelRewrites }, null, 2) + '\n'
  };
}

module.exports = {
  DEFAULT_SECURITY_HEADERS,
  DEFAULT_CACHE_RULES,
  ALLOWED_STATUS,
  generateCloudflareHeaders,
  generateRedirectsMatrix
};

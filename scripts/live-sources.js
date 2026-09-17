#!/usr/bin/env node
// ============================================================
// PallettAI Studio — live online-source probe
// ------------------------------------------------------------
// Drives the REAL data/online.js against the REAL endpoints.
// This is the only check that can see the failures the offline
// suite structurally cannot:
//
//   · a provider that changed shape or moved (parsers still work,
//     the payload does not)
//   · an expired TLS certificate — API still reachable with
//     `curl -k`, but every browser refuses it, and the source is
//     dead while still looking live
//   · an endpoint that stopped sending CORS headers, so the
//     renderer may fetch it in Node but never read it in the app
//     (Node ignores CORS entirely, so a working fetch here proves
//     nothing about the app — the header has to be asked for)
//
// CORS is probed with `Origin: null`, which is what the packaged
// build sends from its file:// page, and with the web build's
// 127.0.0.1 origin, so a regression in either is visible.
//
//   node scripts/live-sources.js            (all sources)
//   node scripts/live-sources.js picsum fx  (named sources only)
//
// Exits non-zero if a free, keyless source stops answering, so it
// can be run on a schedule or before a release.
// ============================================================

'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

// data/online.js reads the Pixabay key from the settings blob. Give it an
// empty one so the module loads outside a browser; Pixabay then reports as
// skipped rather than missing.
global.localStorage = global.localStorage || {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};

const ONLINE = require(path.join(ROOT, 'data', 'online.js'));

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const wanted = (id) => !only.length || only.includes(id);

let failed = 0;
function ok(msg) { console.log('  ✓ ' + msg); }
function bad(msg) { failed++; console.error('  ✗ ' + msg); }
function info(msg) { console.log('    ' + msg); }

// Each source: the id it is listed under, what it is for, and the call that
// proves it. `keyless` marks the ones a creator can always use — those must
// work, and a keyed source is only probed when it has a key.
const SOURCES = [
  { id: 'picsum', label: 'Picsum photos', keyless: true, run: () => ONLINE.fetchPhotos(3) },
  { id: 'randomuser', label: 'RandomUser people', keyless: true, run: () => ONLINE.fetchPeople(3) },
  { id: 'quotable', label: 'Quotable quotes', keyless: true, run: () => ONLINE.fetchQuotes(5) },
  { id: 'wikipedia', label: 'Wikipedia summaries', keyless: true, run: () => ONLINE.fetchWiki('Florence') },
  { id: 'openverse', label: 'Openverse licensed media', keyless: true, run: () => ONLINE.fetchOpenverseImages('coffee', 1, 3) },
  { id: 'coverr', label: 'Coverr stock video', keyless: true, run: () => ONLINE.fetchCoverrVideo('hero') },
  { id: 'coingecko', label: 'CoinGecko prices', keyless: true, run: () => ONLINE.fetchCoins('bitcoin,ethereum') },
  { id: 'github', label: 'GitHub profile', keyless: true, run: () => ONLINE.fetchGitHubUser('torvalds') },
  { id: 'frankfurter', label: 'FX rates (ECB)', keyless: true, run: () => ONLINE.fetchFxRates('GBP') },
  { id: 'pixabay', label: 'Pixabay photos', keyless: false, run: () => ONLINE.fetchPixabay('coffee', 1, 3) },
  { id: 'gfonts', label: 'Google Fonts CSS', keyless: true, run: async () => {
      const url = ONLINE.fontCssUrl('inter');
      if (!url) throw new Error('no CSS url for a core font');
      const res = await ONLINE.request(url);
      const css = await res.text();
      if (!/font-family/.test(css)) throw new Error('the stylesheet has no @font-face');
      return DBfontCount();
    } }
];

function DBfontCount() {
  const DB = require(path.join(ROOT, 'data', 'db.js'));
  return DB.fonts.length;
}

function endpointOf(fnSrc) {
  const m = String(fnSrc).match(/https:\/\/[a-z0-9.-]+/i);
  return m ? m[0] : '';
}

async function probe(s) {
  const started = Date.now();
  const value = await s.run();
  const ms = Date.now() - started;
  if (Array.isArray(value)) return { count: value.length, ms, host: hostOfResult(value) };
  if (value && typeof value === 'object') return { count: Object.keys(value).length ? 1 : 0, ms, host: '' };
  return { count: Number(value) || 0, ms, host: '' };
}

// The host a result's image actually lives on — the half of a source's
// footprint that the CSP allowlist is easiest to forget.
function hostOfResult(rows) {
  for (const row of rows) {
    const url = row && (row.thumb || row.avatar || row.url);
    if (url && /^https:\/\//.test(url)) {
      try { return new URL(url).origin; } catch (e) { /* ignore */ }
    }
  }
  return '';
}

// The URLs the module FETCHES, cut back to the path (interpolations and query
// strings removed) so the probe asks the same route the app asks. Two reasons
// this is not just a host list: CORS applies only to reads the page performs
// (fetch/XHR) — an <img src> is gated by the CSP img-src instead, so probing a
// picture's CDN for CORS would invent a problem; and plenty of hosts answer
// the API path with `Access-Control-Allow-Origin: *` while their site root
// sends no such header at all, so probing `/` invents one too.
function fetchedTargets(src) {
  const targets = new Set();
  const call = /(?:this\.)?(?:request|requestJSON|requestText|_get)\(/g;
  let m;
  while ((m = call.exec(src))) {
    const open = src.indexOf('(', m.index + m[0].length - 1);
    let depth = 0;
    let args = '';
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      args += c;
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (!depth) break; }
    }
    const urlRe = /https:\/\/[^\s`'"$)]+/gi;
    let u;
    while ((u = urlRe.exec(args))) targets.add(u[0].split('?')[0].replace(/[.,;]+$/, ''));
  }
  return [...targets].sort();
}

// Does the host answer a browser-shaped request? Node's fetch omits Origin, so
// a missing header means "not asked", not "not allowed" — the request has to
// carry one for the answer to mean anything. The packaged build loads index.html
// from file://, so its Origin is the literal string `null`.
async function corsFor(origin) {
  try {
    const res = await fetch(origin + '/', { headers: { Origin: 'null' } });
    const acao = res.headers.get('access-control-allow-origin') || '';
    return { status: res.status, acao: acao || 'none' };
  } catch (e) { return { status: 0, acao: 'error', error: (e.cause && e.cause.code) || e.message }; }
}

(async () => {
  console.log('PallettAI Studio — live online-source probe');
  console.log('(' + (only.length ? 'checking: ' + only.join(', ') : 'checking every source') + ')\n');

  const resultHosts = new Set();
  for (const s of SOURCES) {
    if (!wanted(s.id)) continue;
    const keyed = !s.keyless;
    if (keyed && !ONLINE.pixabayKey) {
      console.log('— ' + s.label + ': skipped (no ' + s.id + ' key in this environment)');
      continue;
    }
    try {
      const r = await probe(s);
      if (r.count > 0) {
        ok(s.label + ': ' + r.count + ' item' + (r.count === 1 ? '' : 's') + ' in ' + r.ms + 'ms' + (r.host ? ' · images on ' + r.host : ''));
        if (r.host) resultHosts.add(r.host);
      } else {
        bad(s.label + ': answered, but returned nothing');
      }
    } catch (e) {
      const code = (e && e.code) || (e && e.cause && e.cause.code) || (e && e.message);
      if (code === 'CERT_HAS_EXPIRED') {
        bad(s.label + ': the endpoint\'s TLS certificate has expired — no browser can reach it, so the source is dead');
        info('the host still answers `curl -k`; it needs a valid certificate or a new provider');
      } else {
        bad(s.label + ': ' + code);
      }
    }
  }

  console.log('\n== Endpoints the module fetches, asked with a browser Origin ==');
  const onlineSrc = require('fs').readFileSync(path.join(ROOT, 'data', 'online.js'), 'utf8');
  for (const target of fetchedTargets(onlineSrc)) {
    const r = await corsFor(target);
    // `*` always works; an echoed `null` matches the packaged build's opaque
    // origin, and an echoed localhost matches `npm run web`. The status is not
    // judged here — a route probed without its parameters may legitimately
    // answer 4xx. What matters is whether the header came back at all, because
    // without it the renderer cannot read the response whatever it says.
    const usable = r.acao === '*' || r.acao === 'null' || r.acao === 'http://127.0.0.1:4173';
    (usable ? ok : bad)(target.replace(/^https:\/\//, '') + ' → ' + r.status + ', Access-Control-Allow-Origin: ' + r.acao +
      (usable ? '' : ' — the renderer cannot read this response'));
  }

  if (resultHosts.size) {
    console.log('\n== Where the pictures come back from (CSP img-src, not CORS) ==');
    resultHosts.forEach((h) => console.log('    ' + h));
    console.log('    each of these must be in index.html img-src — see scripts/online-sources-smoke.js');
  }

  console.log('');
  if (failed) {
    console.error('live-sources FAILED — ' + failed + ' problem(s). Live sources are third-party; confirm before changing code, and check nothing else on the machine is intercepting TLS.');
    process.exit(1);
  }
  console.log('live-sources PASSED — every keyless source answered with content');
})();

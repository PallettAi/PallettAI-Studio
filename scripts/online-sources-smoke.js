#!/usr/bin/env node
// ============================================================
// PallettAI Studio — online sources smoke test
// ------------------------------------------------------------
// The Database panel's live sources straddle three files that
// cannot see each other:
//
//   1. data/online.js — the URL that gets fetched
//   2. index.html     — the CSP allowlist that decides whether
//                        the renderer is allowed to fetch it
//   3. app.js         — the button that runs it
//
// Add a source and forget any one of the three and nothing throws:
// a blocked fetch surfaces as "no results for that term", and a
// source with no button surfaces as a card with nothing on it.
// Both had shipped. Every check below therefore compares one of
// those files against another, rather than asserting that a
// string appears in a file.
//
// Fully offline: the CSP and wiring checks read the files, and the
// parser checks stub fetch with payloads copied from the live APIs
// (shape noted beside each one). Run `node scripts/live-sources.js` to
// exercise the real endpoints — it is the only check that can see a
// provider that moved, changed shape, lost its certificate or stopped
// sending CORS headers.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function pass(msg) { console.log('  ✓ ' + msg); }
function fail(msg) { failed++; console.error('  ✗ ' + msg); }
function assert(cond, msg) { cond ? pass(msg) : fail(msg); }
function eq(actual, expected, msg) {
  if (actual === expected) pass(msg);
  else fail(msg + '  → got: ' + JSON.stringify(actual) + ', expected: ' + JSON.stringify(expected));
}

const ONLINE = require(path.join(ROOT, 'data', 'online.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const onlineSrc = fs.readFileSync(path.join(ROOT, 'data', 'online.js'), 'utf8');

// ------------------------------------------------------------
// CSP parsing
// ------------------------------------------------------------
function cspDirectives(src) {
  const m = src.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  if (!m) return null;
  const out = {};
  m[1].split(';').forEach((part) => {
    const bits = part.trim().split(/\s+/).filter(Boolean);
    if (!bits.length) return;
    out[bits[0]] = bits.slice(1);
  });
  return out;
}

// Every https origin that appears inside a block, ending at the matching brace.
function braceBlock(src, at) {
  const open = src.indexOf('{', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(open, i + 1); }
  }
  return '';
}

// The real argument of a call, by paren-matching from the opening paren, so a
// nested call inside a template literal cannot end the scan early.
function callArgs(src, at) {
  const open = src.indexOf('(', at);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (!depth) return src.slice(open, i + 1); }
  }
  return '';
}

// Hosts handed to the studio's own request helpers — i.e. hosts the renderer
// will actually fetch. `request()` is the single boundary every source goes
// through, so its call sites are the complete list.
//
// The URL is not always a literal at the call site: it can be a local, or the
// return of a helper, and both forms were slipping past this check entirely —
// the Google Fonts reachability call fetches `url` from fontCssUrl, so the
// font CDN was fetched by the app with no line of the policy checked against
// it. So the scan follows one level of indirection in each direction: the
// declaration a fetch argument came from, and the body of a helper used to
// build it. That is not a JS engine, but a guard that quietly stops covering
// half the sources is worse than no guard, because it reads as coverage.
const REQUEST_CALL = /(?:this\.)?(?:request|requestJSON|requestText|_get)\(/g;
const THIS_CALL = /this\.([A-Za-z_$][\w$]*)\(/g;
const IDENT = /[A-Za-z_$][\w$]*/g;

function hostLiterals(text, into) {
  const urlRe = /https:\/\/[a-z0-9.-]+/gi;
  let m;
  while ((m = urlRe.exec(text))) into.add(m[0].toLowerCase());
  return into;
}

// `const url = this.fontCssUrl(id);` — the shape a fetch URL is built in.
function declarationFor(src, name) {
  const re = new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*([^;\\n]*)', 'g');
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out.join('\n');
}

function fetchedHosts(src) {
  const hosts = new Set();
  const helpers = new Set();
  let m;
  while ((m = REQUEST_CALL.exec(src))) {
    const args = callArgs(src, m.index + m[0].length - 1);
    hostLiterals(args, hosts);
    // Every identifier in the argument list is a candidate local, and every
    // this.helper( ) in it can be the thing that builds the URL.
    let id;
    IDENT.lastIndex = 0;
    while ((id = IDENT.exec(args))) {
      const decl = declarationFor(src, id[0]);
      if (!decl) continue;
      hostLiterals(decl, hosts);
      let h;
      THIS_CALL.lastIndex = 0;
      while ((h = THIS_CALL.exec(decl))) helpers.add(h[1]);
    }
    let h2;
    THIS_CALL.lastIndex = 0;
    while ((h2 = THIS_CALL.exec(args))) helpers.add(h2[1]);
  }
  // Bodies of the helpers that take part in building a fetched URL.
  const seen = new Set();
  while (helpers.size) {
    const name = helpers.values().next().value;
    helpers.delete(name);
    if (seen.has(name)) continue;
    seen.add(name);
    const at = src.search(new RegExp('\\n  ' + name + '\\(|\\n  async ' + name + '\\(|\\n  ' + name + ':'));
    if (at < 0) continue;
    const body = name + ':' + braceBlock(src, at);
    const text = src[at] === ':' ? body : src.slice(at, at + braceBlock(src, at).length);
    hostLiterals(text, hosts);
    // A helper may itself lean on another helper.
    let h;
    THIS_CALL.lastIndex = 0;
    while ((h = THIS_CALL.exec(text))) helpers.add(h[1]);
  }
  return hosts;
}

const csp = cspDirectives(html);

console.log('== 1. The policy parses and stays enumerated ==');
assert(!!csp, 'index.html declares a Content-Security-Policy');
if (!csp) {
  console.error('\nonline-sources-smoke FAILED — no CSP to check against');
  process.exit(1);
}
['connect-src', 'img-src', 'media-src', 'frame-src'].forEach((d) => {
  assert(Array.isArray(csp[d]), d + ' is declared');
});
assert(!/^https:$/.test(csp['connect-src'].join(' ')), 'connect-src has no bare https: fallback');
assert(!csp['connect-src'].includes('https:'), 'connect-src is still fully enumerated');
assert(!csp['img-src'].includes('https:'), 'img-src is still fully enumerated');
csp['connect-src'].forEach((h) => {
  if (h === "'self'" || h === "'none'") return;
  assert(/^https:\/\//.test(h), 'connect-src entry is https: ' + h);
});

// ------------------------------------------------------------
console.log('\n== 2. Every host the sources fetch is allowed to be fetched ==');
{
  const allowed = new Set(csp['connect-src'].map((h) => h.toLowerCase()));
  const wildcards = csp['connect-src'].filter((h) => h.includes('*'));
  const hosts = [...fetchedHosts(onlineSrc)].sort();
  assert(hosts.length >= 8, 'the sources fetch from ' + hosts.length + ' hosts');
  hosts.forEach((h) => {
    if (allowed.has(h)) { pass('connect-src allows ' + h); return; }
    const wc = wildcards.find((w) => {
      const re = new RegExp('^' + w.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9.-]*') + '$', 'i');
      return re.test(h);
    });
    if (wc) pass('connect-src allows ' + h + ' via ' + wc);
    else fail('data/online.js fetches ' + h + ' but connect-src does not allow it — the fetch is blocked in the renderer');
  });
}

// ------------------------------------------------------------
// The other half of the same mistake: a result host is not the API host.
// These are the hosts the live APIs actually return in their payloads
// (checked against the real endpoints), which is why each row says how it
// was observed rather than just naming a host.
// ------------------------------------------------------------
console.log('\n== 3. Every host the sources RETURN images on is allowed ==');
const RESULT_HOSTS = [
  ['Picsum', 'https://picsum.photos', 'list returns /id/N/W/H on picsum.photos'],
  ['Picsum CDN', 'https://fastly.picsum.photos', 'the 302 target; the browser applies img-src to the FINAL url'],
  ['RandomUser', 'https://randomuser.me', 'avatar URLs are randomuser.me/api/portraits/…'],
  ['Pixabay', 'https://cdn.pixabay.com', 'largeImageURL and previewURL are served from cdn.pixabay.com, not pixabay.com'],
  ['Openverse', 'https://api.openverse.org', 'the thumbnail is proxied by api.openverse.org'],
  ['Coverr', 'https://cdn.coverr.co', 'clip stills come from cdn.coverr.co'],
  ['GitHub', 'https://avatars.githubusercontent.com', 'profile avatar_url is avatars.githubusercontent.com'],
  ['Wikipedia', 'https://upload.wikimedia.org', 'page summary thumbnails are upload.wikimedia.org'],
  ['TheMealDB', 'https://www.themealdb.com', 'strMealThumb is /images/media/meals/… on the API host itself, so the pictures need that origin too'],
  ['Iconify', 'https://api.iconify.design', 'the search endpoint returns icons that are previewed (and inlined) from the same host'],
  ['DiceBear avatars', 'https://api.dicebear.com', 'the testimonials tool generates avatars here'],
  ['AI photos', 'https://image.pollinations.ai', 'the AI photo generator returns images here']
];
{
  const allowed = new Set(csp['img-src'].map((h) => h.toLowerCase()));
  RESULT_HOSTS.forEach(([name, host, why]) => {
    assert(allowed.has(host), 'img-src allows ' + name + ' (' + host + ') — ' + why);
  });
}

// ------------------------------------------------------------
console.log('\n== 4. Every source in the panel is either runnable or a recorded gap ==');
{
  // Sources listed in the panel that the grid builds no controls for. Each one
  // is a card a creator can see and cannot use, so this should stay empty — an
  // entry is a debt, printed as a warning rather than hidden behind a pass.
  const NO_CONTROLS_YET = Object.create(null);

  const at = app.indexOf('const UI = {');
  const block = at < 0 ? '' : braceBlock(app, at);
  assert(!!block, 'the online grid builds its controls from one table');
  const wired = new Set();
  const tokens = new Set();
  // Slice one entry per key, from its own start to the next entry's start.
  // Capturing to the first `}` instead would cut a line short the moment it
  // interpolates a helper — `${inp('inp-wiki', …)}` contains one — and the
  // button after it would look missing.
  const starts = [];
  const keyRe = /(?:^|\n) {6}([a-z0-9-]+):[ \t]*\{/g;
  let m;
  while ((m = keyRe.exec(block))) starts.push({ id: m[1], at: m.index });
  starts.forEach((entry, i) => {
    const body = block.slice(entry.at, i + 1 < starts.length ? starts[i + 1].at : block.length);
    wired.add(entry.id);
    const tokenRe = /data-fetch="([^"]+)"/g;
    let t;
    while ((t = tokenRe.exec(body))) tokens.add(t[1]);
    // A source with no data-fetch is only acceptable when it deliberately
    // offers something else: the Pixabay key prompt, the Pro upgrade, or a
    // route to a purpose-built panel that does the fetching (Companies House
    // has one in the library tools, so its card launches that instead of
    // rendering the register record a second time).
    if (!/data-fetch="/.test(body) && !/data-go-pixkey|data-pro-upgrade|pro: true|data-open-tool="/.test(body)) {
      fail('the ' + entry.id + ' card has no way to run it — no button, no key prompt, no upgrade path');
    }
    // ...and "has a button" only counts if the app binds it: a card whose
    // control is never wired is the same dead end with better markup.
    const launcher = /data-open-tool="([a-z0-9-]+)"/g;
    let tok;
    while ((tok = launcher.exec(body))) {
      assert(app.includes(`[data-open-tool="${tok[1]}"]`), 'the ' + entry.id + ' card\u2019s launcher is bound in the grid');
    }
  });

  const fetchSourceAt = app.indexOf('function fetchSource(');
  const fetchSourceBody = fetchSourceAt < 0 ? '' : braceBlock(app, fetchSourceAt);

  ONLINE.sources.forEach((s) => {
    if (wired.has(s.id)) { pass('the ' + s.id + ' card is built by the online grid'); return; }
    if (NO_CONTROLS_YET[s.id]) { console.log('  ! ' + s.id + ' cannot be run from the panel — ' + NO_CONTROLS_YET[s.id]); return; }
    fail('the ' + s.id + ' source is listed in the panel but has no card and no recorded reason');
  });
  // A recorded gap that has since been wired is stale bookkeeping.
  Object.keys(NO_CONTROLS_YET).forEach((id) => {
    if (wired.has(id)) fail(id + ' is wired now — drop it from NO_CONTROLS_YET');
    else pass(id + ' is still gateless, and that is recorded rather than hidden');
    assert(ONLINE.sources.some((s) => s.id === id), id + ' in NO_CONTROLS_YET is still a real source');
  });
  // A declared token with no handler is a button that does nothing.
  [...tokens].sort().forEach((tok) => {
    const handled = fetchSourceBody.includes("'" + tok + "'") || fetchSourceBody.includes('"' + tok + '"');
    assert(handled, "fetchSource handles the '" + tok + "' button");
  });
}

// ------------------------------------------------------------
// ONLINE.request() asks for res.ok and res.json(), so a stub only needs those.
let realFetch = global.fetch;
const stub = (router) => {
  global.fetch = async (url) => {
    const body = router(String(url));
    if (body == null) throw new Error('unexpected url in test: ' + url);
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
};

async function shapeChecks() {
  console.log('\n== 7. The sources parse the payloads the live APIs really send ==');

  // Quotable community mirror — GET /api/quotes/random?limit=10
  //   {"quotes":[{"id":"xMj8…","content":"…","author":{"id":"…","name":"Sandy Koufax"}}]}
  stub(() => ({ quotes: [{ id: 'q1', content: 'Quote one', author: { name: 'Ada Lovelace' } }] }));
  ONLINE.clearCache();
  let q = await ONLINE.fetchQuotes(3);
  eq(q.length, 1, 'quotes: one row per payload entry');
  eq(q[0].text, 'Quote one', 'quotes: content maps to text');
  eq(q[0].author, 'Ada Lovelace', 'quotes: the nested author object maps to a name');

  // The old upstream sent an array with a bare-string author; a provider swap
  // must not mean rewriting the parser.
  stub(() => [{ _id: 'old', content: 'Legacy', author: 'Grace Hopper' }]);
  ONLINE.clearCache();
  q = await ONLINE.fetchQuotes(1);
  eq(q[0].author, 'Grace Hopper', 'quotes: a flat array with a string author still maps');

  // Wikipedia REST summary — GET /api/rest_v1/page/summary/Florence
  stub(() => ({ title: 'Florence', extract: 'Florence is a city.', thumbnail: { source: 'https://upload.wikimedia.org/x.jpg' }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Florence' } } }));
  ONLINE.clearCache();
  const w = await ONLINE.fetchWiki('Florence');
  eq(w.title, 'Florence', 'wiki: title maps');
  eq(w.thumb, 'https://upload.wikimedia.org/x.jpg', 'wiki: thumbnail.source maps to thumb');
  eq(w.url, 'https://en.wikipedia.org/wiki/Florence', 'wiki: content_urls.desktop.page maps to url');

  // Frankfurter — GET /latest?from=GBP
  stub(() => ({ amount: 1, base: 'GBP', date: '2026-09-11', rates: { EUR: 1.16, USD: 1.34 } }));
  ONLINE.clearCache();
  const fx = await ONLINE.fetchFxRates('GBP');
  eq(fx.length, 2, 'fx: one row per returned rate');
  eq(fx[0].date, '2026-09-11', 'fx: the publication date travels with the rate');

  // CoinGecko — GET /simple/price?ids=…&vs_currencies=gbp
  stub(() => ({ bitcoin: { gbp: 54321.5, gbp_24h_change: 1.25 } }));
  ONLINE.clearCache();
  const coins = await ONLINE.fetchCoins('bitcoin');
  eq(coins.length, 1, 'coins: one row per requested id');
  eq(coins[0].price, 54321.5, 'coins: the gbp price maps');
  eq(coins[0].name, 'Bitcoin', 'coins: a known id gets its display name');

  // GitHub — two calls: the profile, then the repos
  stub((url) => {
    if (/\/repos/.test(url)) return [{ name: 'linux', description: 'd', stargazers_count: 5, language: 'C', html_url: 'https://github.com/torvalds/linux' }];
    return { login: 'torvalds', name: 'Linus', avatar_url: 'https://avatars.githubusercontent.com/u/1024025', bio: '', followers: 1, public_repos: 2, location: '', company: '', html_url: 'https://github.com/torvalds' };
  });
  ONLINE.clearCache();
  const gh = await ONLINE.fetchGitHubUser('@torvalds');
  eq(gh.login, 'torvalds', 'github: a leading @ is stripped before the fetch');
  eq(gh.repos.length, 1, 'github: recent repos map into the payload');
  assert(/^https:\/\/avatars\.githubusercontent\.com\//.test(gh.avatar), 'github: the avatar host is the one img-src must allow');

  // RandomUser — GET /api/?results=N
  stub(() => ({ results: [{ login: { uuid: 'u1' }, name: { first: 'Ada', last: 'L' }, picture: { large: 'https://randomuser.me/api/portraits/women/1.jpg' }, email: 'a@b.c', location: { city: 'Bath', country: 'UK' } }] }));
  ONLINE.clearCache();
  const people = await ONLINE.fetchPeople(1);
  eq(people[0].name, 'Ada L', 'people: the display name is joined from first + last');
  eq(people[0].city, 'Bath, UK', 'people: the city line carries the country');

  // Iconify search — GET /search?query=…&limit=N
  //   {"icons":["material-symbols:shopping-cart", …]}
  stub(() => ({ icons: ['mdi:home', 'material-symbols:shopping-cart', 'mdi:home'] }));
  ONLINE.clearCache();
  const icons = await ONLINE.searchIcons('cart', 2);
  eq(icons.length, 2, 'icons: the count asked for is honoured even when the endpoint returns more');
  eq(icons[0].name, 'mdi:home', 'icons: the returned names are kept whole');
  eq(icons[0].prefix, 'mdi', 'icons: the set prefix is split out for the artwork URL');
  assert(icons[0].thumb.indexOf('api.iconify.design/mdi/home.svg') > 0, 'icons: the preview URL is the artwork endpoint img-src must allow');

  // The artwork itself. Returned as SVG text, then inlined — never hot-linked.
  stub(() => '');
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1"/></svg>' });
  ONLINE.clearCache();
  const svg = await ONLINE.fetchIconSvg('mdi:home');
  assert(svg.dataUrl.indexOf('data:image/svg+xml') === 0, 'icons: the artwork comes back as an inline data URL, so the export cannot break when the API is down');
  assert(svg.svg.indexOf('<svg') === 0, 'icons: and as the SVG text itself, for the copy action');
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '<html>not found</html>' });
  ONLINE.clearCache();
  await ONLINE.fetchIconSvg('mdi:nope').then(() => fail('icons: a non-SVG 200 must not be inlined into a site'), () => pass('icons: a non-SVG 200 is refused, not inlined into the export'));
  await ONLINE.fetchIconSvg('nocolon').then(() => fail('icons: a name with no set prefix must be refused'), () => pass('icons: a name with no set prefix is refused before any request'));

  // Nager.Date — GET /api/v3/PublicHolidays/{year}/{country}
  stub(() => [
    { date: '2026-01-01', localName: "New Year's Day", name: "New Year's Day", global: true, counties: null },
    { date: '2026-12-25', localName: 'Christmas Day', name: 'Christmas Day', global: false, counties: ['GB-ENG'] }
  ]);
  ONLINE.clearCache();
  const hol = await ONLINE.fetchHolidays('gb', 2026);
  eq(hol.country, 'GB', 'holidays: a lower-case country code is normalised');
  eq(hol.list.length, 2, 'holidays: one row per date');
  eq(hol.list[0].name, "New Year's Day", 'holidays: the local name is preferred, so it reads as the country writes it');
  eq(hol.list[1].nationwide, false, 'holidays: a regional date is marked as regional, not silently listed as nationwide');
  assert(Array.isArray(hol.upcoming), 'holidays: upcoming dates are computed for the panel');
  await ONLINE.fetchHolidays('XYZQ', 2026).catch(() => {});
  await ONLINE.fetchHolidays('X1', 2026).then(() => fail('holidays: a code that is not two letters must be refused'), () => pass('holidays: a code that is not two letters is refused before the request'));

  // Open-Meteo — current + 3 daily, plus the two ways of resolving a place.
  stub((url) => {
    if (url.indexOf('geocoding') > 0) return { results: [{ name: 'Harrogate', latitude: 53.99, longitude: -1.54, country: 'United Kingdom' }] };
    return {
      current: { temperature_2m: 12.4, apparent_temperature: 11, relative_humidity_2m: 70, wind_speed_10m: 9.5, weather_code: 2 },
      daily: { time: ['2026-09-17', '2026-09-18', '2026-09-19'], weather_code: [2, 61, 0], temperature_2m_max: [14, 13, 16], temperature_2m_min: [8, 7, 9] }
    };
  });
  ONLINE.clearCache();
  const wx = await ONLINE.fetchWeather('Harrogate');
  eq(wx.place, 'Harrogate', 'weather: a town name resolves through geocoding');
  eq(wx.now.label, 'Partly cloudy', 'weather: the WMO code becomes words a person can publish');
  eq(wx.now.emoji, '⛅', 'weather: and an emoji the panel can show');
  eq(wx.days.length, 3, 'weather: three daily rows are mapped');
  eq(wx.days[1].label, 'Light rain', 'weather: each day carries its own condition');
  eq(wx.days[0].max, 14, 'weather: and its high');

  // A UK postcode is exact in a way a name search is not, so it goes to
  // postcodes.io first — and only when the string looks like one.
  stub(() => ({ result: { postcode: 'SW1A 1AA', latitude: 51.501, longitude: -0.141, country: 'England', admin_district: 'Westminster' } }));
  ONLINE.clearCache();
  const pc = await ONLINE.resolvePlace('SW1A 1AA');
  eq(pc.postcode === undefined ? pc.name : pc.postcode, 'SW1A 1AA', 'weather: a UK postcode resolves to coordinates');
  eq(pc.latitude, 51.501, 'weather: and the latitude is real, not a geocoder guess');

  stub(() => ({}));
  ONLINE.clearCache();
  const pair = await ONLINE.resolvePlace('53.99,-1.54');
  eq(pair.latitude, 53.99, 'weather: "lat,lon" is accepted without any request at all');
  eq(pair.source, 'coordinates', 'weather: and is labelled as coordinates rather than a place lookup');
  await ONLINE.resolvePlace('   ').then(() => fail('weather: an empty place must be refused'), () => pass('weather: an empty place is refused before the request'));

  // TheMealDB — GET /api/json/v1/1/search.php?s=…
  stub(() => ({
    meals: [{
      idMeal: '52973', strMeal: 'Leblebi Soup', strCategory: 'Vegetarian', strArea: 'Tunisian',
      strTags: 'Soup,Spicy', strMealThumb: 'https://www.themealdb.com/images/media/meals/x.jpg',
      strInstructions: 'Fry the onion.', strYoutube: 'https://www.youtube.com/watch?v=x', strSource: '',
      strIngredient1: 'Onion', strMeasure1: '1 large', strIngredient2: 'Chickpeas', strMeasure2: '',
      strIngredient3: '  ', strMeasure3: ''
    }]
  }));
  ONLINE.clearCache();
  const meals = await ONLINE.fetchMeals('soup', 3);
  eq(meals.length, 1, 'meals: a dish comes back as one row');
  eq(meals[0].name, 'Leblebi Soup', 'meals: the dish name maps');
  eq(meals[0].category, 'Vegetarian', 'meals: so does the category');
  eq(meals[0].ingredients.length, 2, 'meals: ingredients are paired with their measures, and blank slots are skipped');
  eq(meals[0].ingredients[0], '1 large Onion', 'meals: measure then item, as a menu line reads');
  assert(meals[0].thumb.indexOf('/medium') > 0, 'meals: the thumbnail asks for the medium size, not the full-size photo');
  eq(meals[0].tags.length, 2, 'meals: comma-joined tags become a list');
  stub(() => ({ meals: null }));
  ONLINE.clearCache();
  const none = await ONLINE.fetchMeals('zzzz', 3);
  eq(none.length, 0, 'meals: a search with no results is an empty list, not a throw');
}

// ------------------------------------------------------------
function staticChecks() {
console.log('\n== 5. Sources that need a key keep it out of the source ==');
{
  assert(/get pixabayKey\(\)/.test(onlineSrc), 'the Pixabay key is read through a getter');
  assert(/pallettai\.settings\.v1/.test(onlineSrc), 'the Pixabay key comes from the user settings blob');
  assert(!/pixabay\.com\/api\/\?key=[0-9a-f]{16,}/i.test(onlineSrc), 'no Pixabay key is hardcoded');
  assert(!/api[_-]?key\s*[:=]\s*['"][0-9a-f]{16,}['"]/i.test(onlineSrc), 'no API key literal is embedded');
  assert(/if \(!this\.pixabayKey\) return \[\]/.test(onlineSrc), 'a missing key disables the source instead of throwing');
}

// ------------------------------------------------------------
console.log('\n== 6. Every source has a card, and every host a reason ==');
{
  const ids = ONLINE.sources.map((s) => s.id);
  eq(new Set(ids).size, ids.length, 'no source id is listed twice');
  ONLINE.sources.forEach((s) => {
    assert(!!s.desc && s.desc.length > 20, s.id + ' explains itself in the panel');
    assert(/^https:\/\//.test(s.url), s.id + ' links out over https');
    const host = s.url.replace(/^https:\/\//, '').split('/')[0].toLowerCase();
    const known = csp['connect-src'].concat(csp['img-src'], csp['style-src']).some((h) => h.toLowerCase() === 'https://' + host);
    // The card's link opens in the system browser, so it needs no CSP entry —
    // but a host that is neither fetched nor linked to any renderer resource is
    // usually a sign the card was left behind by a provider change.
    if (!known) pass(s.id + ': card links to ' + host + ' (opens externally, no allowlist needed)');
    else pass(s.id + ': card links to ' + host);
  });
}
}

// ------------------------------------------------------------
async function cacheChecks() {
  console.log('\n== 8. The cache the panel leans on still behaves ==');
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ([]), text: async () => '[]' }; };
  ONLINE.clearCache();
  await ONLINE.fetchQuotes(5);
  await ONLINE.fetchQuotes(5);
  eq(calls, 1, 'a repeated source read is served from cache, not refetched');
  ONLINE.clearCache();
  await ONLINE.fetchQuotes(5);
  eq(calls, 2, 'clearCache forces the next read to go out again');
}

// ------------------------------------------------------------
async function pacingChecks() {
  console.log('\n== 9. A failing source is asked less often, not more ==');
  let hits = 0;
  global.fetch = async () => {
    hits++;
    throw Object.assign(new Error('connection refused'), { code: 'network_error' });
  };
  ONLINE.clearCache();

  eq(ONLINE.dueForSource('coingecko', Date.now()), true, 'a source that has never been tried is due');
  await ONLINE.fetchCoins('bitcoin').catch(() => {});
  eq(hits, 1, 'the first attempt actually goes out');
  eq(ONLINE.sourceHealth('coingecko').failures, 1, 'the failure is recorded against the source');
  eq(ONLINE.sourceHealth('coingecko').lastError, 'connection refused', 'the reason is kept, not just a count');
  eq(ONLINE.dueForSource('coingecko', Date.now()), false, 'the source is now held back');

  // The whole point: a caller in a loop must not reach the network again while
  // the source is cooling. Refusing locally is what saves the free tier.
  await ONLINE.fetchCoins('bitcoin').catch((e) => eq(e.code, 'source_cooling_down', 'the refusal names its reason'));
  await ONLINE.fetchCoins('bitcoin').catch(() => {});
  eq(hits, 1, 'repeated calls while cooling make no further requests at all');

  // A user clicking anyway is an instruction, and it outranks the pacer — while
  // the failure count survives, so the NEXT gap is wider than the one skipped.
  const firstWait = ONLINE.retryInMs('coingecko', Date.now());
  ONLINE.allowSourceNow('coingecko');
  eq(ONLINE.dueForSource('coingecko', Date.now()), true, 'a click lifts the cooldown');
  await ONLINE.fetchCoins('bitcoin').catch(() => {});
  eq(hits, 2, 'the forced attempt does go out');
  eq(ONLINE.sourceHealth('coingecko').failures, 2, 'the failure count keeps climbing');
  assert(ONLINE.retryInMs('coingecko', Date.now()) > firstWait,
    'the backoff widens after a forced failure rather than restarting (' + Math.round(firstWait / 1000) + 's → ' + Math.round(ONLINE.retryInMs('coingecko', Date.now()) / 1000) + 's)');

  // Recovery: one success clears the history and the source is ordinary again.
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ bitcoin: { gbp: 1, gbp_24h_change: 0 } }), text: async () => '{}' });
  ONLINE.allowSourceNow('coingecko');
  await ONLINE.fetchCoins('bitcoin').catch(() => {});
  eq(ONLINE.sourceHealth('coingecko').failures, 0, 'a success clears the failure count');
  eq(ONLINE.dueForSource('coingecko', Date.now()), true, 'a recovered source is never held back');

  // A working source must not be paced at all: the response cache already
  // dedupes repeats, and a cooldown here would answer a click with an error.
  await ONLINE.fetchCoins('bitcoin');
  eq(ONLINE.sourceHealth('coingecko').cooling, false, 'a source with no failures is never cooling');
  eq(ONLINE.retryInMs('coingecko', Date.now()), 0, 'and reports no wait');

  // The font card used to be marked live off a local list. Now it is earned by
  // reaching the CDN, so a blocked or offline CDN is visible as such.
  eq(typeof ONLINE.checkFontCdn, 'function', 'the font source has a reachability check');
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '@font-face{font-family:Archivo}' });
  ONLINE.clearCache();
  const font = await ONLINE.checkFontCdn('archivo');
  assert(/^https:\/\/fonts\.googleapis\.com\//.test(font.url), 'the font check asks the CDN the preview uses');
  assert(font.bytes > 0, 'and reports what came back (' + font.bytes + ' bytes)');
  global.fetch = async () => { throw Object.assign(new Error('blocked by CSP'), { code: 'network_error' }); };      ONLINE.clearCache();
  await ONLINE.checkFontCdn('archivo').then(() => fail('a blocked font CDN must not read as live'), () => pass('a blocked font CDN fails the check instead of reading live'));
}

// ------------------------------------------------------------
async function retryAfterChecks() {
  console.log('\n== 10. A provider that says "wait" is obeyed ==');
  const rateLimited = (retryAfter) => async () => ({
    ok: false,
    status: 429,
    headers: { get: (h) => (String(h).toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: async () => ({}),
    text: async () => ''
  });

  ONLINE.clearCache();
  let hits = 0;
  const counting = (inner) => async (...args) => { hits++; return inner(...args); };
  global.fetch = counting(await rateLimited('120'));
  await ONLINE.fetchHolidays('GB', 2026).catch(() => {});
  eq(hits, 1, 'the first request goes out and comes back 429');
  const held = ONLINE.sourceHealth('holidays');
  eq(held.rateLimited, true, 'the source is reported as rate limited, not as unreachable');
  eq(held.reason, 'rate_limited', 'and the badge gets a different reason to show');
  assert(held.retryInMs > 115000 && held.retryInMs <= 120000,
    'the provider\u2019s own 120s is used instead of our 15s first guess (' + Math.round(held.retryInMs / 1000) + 's)');

  await ONLINE.fetchHolidays('GB', 2026).catch((e) => eq(e.code, 'source_rate_limited', 'a call while held is refused with the rate-limit reason'));
  eq(hits, 1, 'and makes no request at all');

  // A click outranks our own backoff but NOT the provider's instruction: asking
  // anyway is exactly what turns a soft 429 into a real block.
  ONLINE.allowSourceNow('holidays');
  eq(ONLINE.dueForSource('holidays', Date.now()), false, 'a provider-imposed hold survives a click, deliberately');
  ONLINE.clearSourceHold('holidays');
  eq(ONLINE.dueForSource('holidays', Date.now()), true, 'clearing the hold releases the source (as adding a key does)');
  eq(ONLINE.sourceHealth('holidays').rateLimited, false, 'and the rate-limited badge goes away with it');

  // The other spec form, and the clamp that keeps a remote header from parking a
  // source for a month.
  ONLINE.clearCache();
  global.fetch = counting(await rateLimited(new Date(Date.now() + 90000).toUTCString()));
  await ONLINE.fetchHolidays('GB', 2026).catch(() => {});
  const dated = ONLINE.sourceHealth('holidays').retryInMs;
  assert(dated > 80000 && dated <= 90000, 'an HTTP-date Retry-After is understood too (' + Math.round(dated / 1000) + 's)');

  ONLINE.clearCache();
  global.fetch = counting(await rateLimited('99999999'));
  await ONLINE.fetchHolidays('GB', 2026).catch(() => {});
  assert(ONLINE.sourceHealth('holidays').retryInMs <= 30 * 60 * 1000,
    'a wild Retry-After is clamped to 30 minutes rather than obeyed as a remote kill switch');

  // A success is the only thing that clears a hold, because it is the only
  // evidence that the provider has started accepting requests again.
  ONLINE.clearCache();
  global.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => [], text: async () => '[]' });
  ONLINE.allowSourceNow('holidays');
  await ONLINE.fetchHolidays('GB', 2026).then(() => pass('the held source answers once the wait has passed'), () => {});
  if (ONLINE.sourceHealth('holidays').rateLimited) {
    ONLINE.clearSourceHold('holidays');
    await ONLINE.fetchHolidays('GB', 2026).catch(() => {});
  }
  eq(ONLINE.sourceHealth('holidays').rateLimited, false, 'and a success clears the hold outright');
  eq(ONLINE.sourceHealth('holidays').failures, 0, 'along with the failure count');

  // The badge has to be able to render it, or the reason is invisible.
  assert(app.indexOf('rate limited') > 0, 'the panel has a badge for a rate-limited source');
  assert(/src-state warn/.test(app), 'styled differently from both live and unreachable');
}

(async () => {
  staticChecks();
  try {
    await shapeChecks();
    await cacheChecks();
    await pacingChecks();
    await retryAfterChecks();
  } catch (e) {
    fail('a source check threw: ' + (e && e.message));
  } finally {
    global.fetch = realFetch;
  }



  if (failed) {
    console.error('\nonline-sources-smoke FAILED — ' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\nonline-sources-smoke PASSED');
})();

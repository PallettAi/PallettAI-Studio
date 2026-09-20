// ============================================================
// PallettAI Studio — free online databases
  // Picsum (photos) · RandomUser (avatars/people) · Quotable (quotes) · Google Fonts
// Iconify (icons) · Nager.Date (public holidays) · Open-Meteo (weather) ·
// TheMealDB (food & menu content)
// Every source is free, keyless and CORS-enabled (Pixabay needs a user-supplied
// key — see Settings ▸ Online data), with graceful fallbacks.
// ============================================================

/*
  Provider-imposed pacing.

  Our exponential backoff GUESSES how long a struggling provider needs. This is
  the only case where one actually tells us, and it does so on 429 and 503 — the
  two statuses that mean "you, specifically, are asking too often". Ignoring the
  header is not neutral: guessing 15s against a provider that asked for 60 earns
  a second 429, spends an attempt, and widens our own backoff for no reason.

  Both spec forms appear in the wild (delta-seconds and an HTTP date), as does
  `X-RateLimit-Reset` in unix seconds OR milliseconds. Clamped to 30 minutes: a
  header is a hint from the far end of the network, and one that could park a
  source for a month would be a remote kill switch for our own panel.
*/
const RETRY_AFTER_MAX_MS = 30 * 60 * 1000;

function clampHold(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(1000, Math.round(ms)));
}

function retryAfterMsFrom(res, now) {
  if (!res || !res.headers || typeof res.headers.get !== 'function') return 0;
  const at = Number.isFinite(now) ? now : Date.now();
  let raw = '';
  try { raw = String(res.headers.get('retry-after') || '').trim(); } catch (e) { raw = ''; }
  if (raw) {
    if (/^\d+(\.\d+)?$/.test(raw)) return clampHold(Number(raw) * 1000);
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return clampHold(parsed - at);
  }
  try {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    // Over 1e11 can only be milliseconds: 1e11 seconds is the year 5138.
    if (Number.isFinite(reset) && reset > 0) return clampHold((reset > 1e11 ? reset : reset * 1000) - at);
  } catch (e) { /* a header we cannot read is simply no instruction */ }
  return 0;
}

const ONLINE = {
  // Pixabay key is user-supplied. In Electron it lives encrypted via
  // safeStorage (main.js secrets store); in the browser/web build it is kept
  // in the settings blob. The getter prefers the encrypted store when present
  // so the renderer never needs to keep the key in plaintext on disk. Never
  // ship a hardcoded API key in source.
  get pixabayKey() {
    try {
      const bridge = (typeof window !== 'undefined' && window.pallettai) ? window.pallettai : null;
      if (bridge && typeof bridge.secretsGetSync === 'function') {
        const v = String(bridge.secretsGetSync('online.pixabayKey') || '').trim();
        if (v) return v;
      }
    } catch (e) { /* fall through to localStorage */ }
    try {
      const raw = localStorage.getItem('pallettai.settings.v1');
      const s = raw ? JSON.parse(raw) : {};
      return (s && typeof s.pixabayKey === 'string' ? s.pixabayKey : '').trim();
    } catch (e) { return ''; }
  },
  // Companies House (UK) — same pattern: user's own registration key, read
  // live from the encrypted store in Electron. Never shipped in source.
  get companiesHouseKey() {
    try {
      const bridge = (typeof window !== 'undefined' && window.pallettai) ? window.pallettai : null;
      if (bridge && typeof bridge.secretsGetSync === 'function') {
        const v = String(bridge.secretsGetSync('online.companiesHouseKey') || '').trim();
        if (v) return v;
      }
    } catch (e) { /* fall through */ }
    try {
      const raw = localStorage.getItem('pallettai.settings.v1');
      const s = raw ? JSON.parse(raw) : {};
      return (s && typeof s.companiesHouseKey === 'string' ? s.companiesHouseKey : '').trim();
    } catch (e) { return ''; }
  },
  sources: [
    {
      id: 'picsum', name: 'Picsum Photos', icon: '🖼️', url: 'https://picsum.photos',
      desc: 'Free high-quality stock photos from Lorem Picsum. Seeded so images stay consistent per client.',
      fields: ['Width', 'Height']
    },
    {
      id: 'pixabay', name: 'Pixabay Photos', icon: '🔎', url: 'https://pixabay.com',
      desc: 'Free, topic-matched photos — search any subject, CC0, no attribution. Uses your own free Pixabay API key (add it in Settings ▸ Online data).',
      fields: ['Topic']
    },
    {
      id: 'openverse', name: 'Openverse Licensed Media', icon: '🌍', url: 'https://openverse.org',
      desc: 'Search openly licensed photography from many public collections. Creator, source, licence and attribution details travel with every image.',
      fields: ['Topic']
    },
    {
      id: 'coverr', name: 'Coverr Stock Video', icon: '🎬', url: 'https://coverr.co',
      desc: 'Free cinematic stock video for hero backgrounds — CC0, no attribution, keyless. Search any subject and drop a clip straight into a video section.',
      fields: ['Topic']
    },
    {
      id: 'randomuser', name: 'RandomUser People', icon: '🧑‍💼', url: 'https://randomuser.me',
      desc: 'Free, real-looking avatars and names — perfect for testimonial cards and team sections.',
      fields: []
    },
    {
      id: 'quotable', name: 'Quotable Quotes', icon: '💬', url: 'https://api.quotable.kurokeita.dev',
      desc: 'Curated quotes from thousands of authors, fetched live. Great for hero and CTA copy. Served by the community mirror of the Quotable dataset — the original api.quotable.io stopped renewing its TLS certificate in September 2024 and can no longer be reached by any browser.',
      fields: []
    },
    {
      id: 'gfonts', name: 'Google Fonts', icon: '🔤', url: 'https://fonts.google.com',
      desc: 'The fonts in the library stream live from Google’s CDN — preview them, then apply to a project.',
      fields: []
    },
    {
      id: 'wikipedia', name: 'Wikipedia Summaries', icon: '📚', url: 'https://en.wikipedia.org',
      desc: 'Concise, cited summaries of any topic — brilliant for About and Story sections. Free & keyless.',
      fields: ['Topic']
    },
    {
      id: 'coingecko', name: 'CoinGecko Crypto', icon: '🪙', url: 'https://www.coingecko.com',
      tier: 'pro',
      desc: 'Live prices for 12,000+ coins — free, keyless and CORS-enabled. Feeds the Crypto Ticker widget (Pro).',
      fields: ['Coin ids']
    },
    {
      id: 'github', name: 'GitHub API', icon: '🐙', url: 'https://docs.github.com/rest',
      tier: 'pro',
      desc: 'Public profile stats and recent repos for any GitHub user — free, keyless (60 requests/hour per IP). Feeds the GitHub widget (Pro).',
      fields: ['Username']
    },
    {
      id: 'frankfurter', name: 'FX Rates (ECB)', icon: '💱', url: 'https://frankfurter.app',
      tier: 'pro',
      desc: 'Daily exchange rates for 30+ currencies, published by the European Central Bank — free, keyless, CORS-enabled. Feeds the FX widget (Pro).',
      fields: ['Base currency']
    },
    {
      id: 'companieshouse', name: 'Companies House (UK)', icon: '🇬🇧', url: 'https://find-and-update.company-information.service.gov.uk',
      desc: 'The official UK register. Type a company number to pull the registered name, address and industry — then pre-fill the AI brief or the site contact details. Free with a one-time registration key (Settings ▸ Online data).',
      fields: ['Company number']
    },
    {
      id: 'iconify', name: 'Iconify Icons', icon: '🧩', url: 'https://iconify.design',
      desc: 'Search 200,000+ open-source interface icons from 150+ sets and drop the artwork into a section. Keyless, no attribution, and the SVG is INLINED into the export — an icon cannot break because someone else’s API went down.',
      fields: ['Search']
    },
    {
      id: 'holidays', name: 'Public Holidays', icon: '📅', url: 'https://date.nager.at',
      desc: 'Official public holidays for 100+ countries. The honest way to write “closed for the holidays” opening hours or a seasonal campaign: the actual dates, not a guess. Free and keyless.',
      fields: ['Country', 'Year']
    },
    {
      id: 'weather', name: 'Weather (Open-Meteo)', icon: '🌤️', url: 'https://open-meteo.com',
      desc: 'Today’s conditions and a three-day outlook for any town, UK postcode or “lat,lon”. Feeds “today at the shop” copy, and resolves the place once so the live weather widget is added with coordinates that are known to work. Free, keyless, no tracking.',
      fields: ['Town or postcode']
    },
    {
      id: 'themealdb', name: 'TheMealDB (food & menu)', icon: '🍽️', url: 'https://www.themealdb.com',
      desc: 'A free, open recipe and menu database — dish names, categories, cuisines, photos and method text for café, restaurant and food-truck sites. Keyless, no attribution required.',
      fields: ['Dish or ingredient']
    }
  ],

  cache: Object.create(null),
  cacheMeta: Object.create(null),
  _flights: new Map(),
  _cacheGeneration: 0,
  CACHE_LIMIT: 80,
  CACHE_TTL: 10 * 60 * 1000,

  _cacheRead(key) {
    if (!Object.prototype.hasOwnProperty.call(this.cache, key)) return null;
    const meta = this.cacheMeta[key] || {};
    // Touch on reads so the bounded cache evicts genuinely least-recently-used entries.
    meta.touchedAt = Date.now();
    this.cacheMeta[key] = meta;
    return { value: this.cache[key], stale: meta.expiresAt > 0 && Date.now() >= meta.expiresAt };
  },
  _cacheWrite(key, value, ttl = this.CACHE_TTL) {
    this.cache[key] = value;
    this.cacheMeta[key] = { expiresAt: Date.now() + ttl, touchedAt: Date.now() };
    const keys = Object.keys(this.cache);
    if (keys.length > this.CACHE_LIMIT) {
      keys.sort((a, b) => (this.cacheMeta[a].touchedAt || 0) - (this.cacheMeta[b].touchedAt || 0));
      keys.slice(0, keys.length - this.CACHE_LIMIT).forEach((old) => { delete this.cache[old]; delete this.cacheMeta[old]; });
    }
  },
  _refreshCache(key, loader, ttl = this.CACHE_TTL) {
    const existing = this._flights.get(key);
    if (existing) return existing;
    const generation = this._cacheGeneration;
    const flight = Promise.resolve().then(loader).then((value) => {
      if (generation === this._cacheGeneration) this._cacheWrite(key, value, ttl);
      return value;
    });
    this._flights.set(key, flight);
    flight.then(() => { if (this._flights.get(key) === flight) this._flights.delete(key); }, () => { if (this._flights.get(key) === flight) this._flights.delete(key); });
    return flight;
  },
  _cached(key, loader, ttl = this.CACHE_TTL) {
    const hit = this._cacheRead(key);
    if (!hit) return this._refreshCache(key, loader, ttl);
    if (hit.stale) this._refreshCache(key, loader, ttl).catch(() => {});
    return Promise.resolve(hit.value);
  },

  /*
    A cached read that also paces a FAILING source.

    Every source read goes through here rather than _cached directly. A success
    is left alone — the response cache already dedupes repeats, and holding a
    working source back would turn a click into an error. A failure widens the
    gap before the next attempt, so a provider that is down is asked less often
    the harder it is struggling.

    That matters because the studio asks in loops, not once: the AI photo pass
    requests a subject per scene, and the cached reads refresh themselves in the
    background when stale. One dead provider used to mean one dead request per
    scene, or a fresh request every time a stale entry was touched.

    The pacing maths lives in dueForRetry (pure, and asserted in its own suite);
    this only applies it and remembers why the source is being held back.
  */
  _cachedFor(id, key, loader, ttl = this.CACHE_TTL) {
    const now = Date.now();
    if (!this.dueForSource(id, now)) {
      const health = this.sourceHealth(id);
      const secs = Math.ceil(health.retryInMs / 1000);
      const e = new Error(health.rateLimited
        // Rate limiting is the provider's own instruction, and saying so is far
        // more useful than a generic "not retrying yet" — it tells the creator
        // the source is alive and merely asked for space.
        ? (this.sourceName(id) || id) + ' asked us to wait about ' + secs + 's before the next request.'
        : (this.sourceName(id) || id) + ' is recovering from a failure — not retrying yet.');
      e.code = health.rateLimited ? 'source_rate_limited' : 'source_cooling_down';
      e.source = id;
      e.retryInMs = health.retryInMs;
      return Promise.reject(e);
    }
    return this._cached(key, async () => {
      try {
        const value = await loader();
        this.recordSourceResult(id, true);
        return value;
      } catch (err) {
        this.recordSourceResult(id, false, err);
        throw err;
      }
    }, ttl);
  },

  // Shared external-request boundary for the studio. The controller aborts
  // the underlying fetch, so a timeout does not leave a connection running in
  // the background. Callers can pass { signal, timeoutMs } for cancellation.
  async request(url, init, options) {
    const opts = options || {};
    const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 9000;
    const callerSignal = opts.signal;
    if (callerSignal && callerSignal.aborted) {
      const e = new Error('Request cancelled.'); e.code = 'request_cancelled'; throw e;
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    let cancelled = false;
    let timedOut = false;
    let removeAbort = null;
    if (controller) {
      if (callerSignal) {
        const onAbort = () => { cancelled = true; controller.abort(); };
        callerSignal.addEventListener('abort', onAbort, { once: true });
        removeAbort = () => callerSignal.removeEventListener('abort', onAbort);
      }
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    }
    try {
      const requestInit = { ...(init || {}) };
      if (controller) requestInit.signal = controller.signal;
      const request = fetch(url, requestInit);
      const res = controller ? await request : await Promise.race([
        request,
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('Request timed out.'), { code: 'request_timeout' })), timeoutMs))
      ]);
      if (!res.ok && !opts.allowHttpError) {
        const e = new Error('HTTP ' + res.status);
        e.code = res.status === 429 ? 'rate_limited' : 'http_error';
        e.status = res.status;
        // Read before throwing: the response object is gone by the time the
        // breaker sees this error, and the holding instruction is on it.
        const wait = retryAfterMsFrom(res);
        if (wait) e.retryAfterMs = wait;
        throw e;
      }
      // allowHttpError: hand the response back even on 4xx/5xx. API providers put
      // the actionable reason in the body (“Project not found”, “invalid token”),
      // and throwing on status alone would replace it with a bare status code
      // just when the creator most needs to know what to fix.
      return res;
    } catch (e) {
      if (timedOut || (e && e.code === 'request_timeout')) {
        const x = new Error('Request timed out.'); x.code = 'request_timeout'; throw x;
      }
      if (cancelled || (e && e.name === 'AbortError')) {
        const x = new Error('Request cancelled.'); x.code = 'request_cancelled'; throw x;
      }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (removeAbort) removeAbort();
    }
  },

  async requestJSON(url, init, options) {
    const res = await this.request(url, init, options);
    return res.json();
  },
  async requestText(url, init, options) {
    const res = await this.request(url, init, options);
    return res.text();
  },
  async _get(url, ms = 9000) {
    return this.requestJSON(url, undefined, { timeoutMs: ms });
  },

  // ----- Companies House (UK) -----
  //
  // The official UK register of companies. Free, CORS-enabled, and open about
  // it: the API asks for HTTP Basic auth where the username is the API key and
  // the password is empty — `Authorization: Basic base64(key + ':')`. Unlike
  // Pixabay there is no fallback server, so every failure surfaces as an
  // honest error and the manual-entry path stays the default. Company numbers
  // are 8 characters: digits, or 2 letters + 6 digits (SC, NI, OC, FC…).
  //
  // SIC codes are 5-digit industry codes (47110 = retail, 56103 = restaurants…).
  // The Studio maps the two leading digits to its own business types — local
  // knowledge here rather than a second API, and the map is exported for
  // tests and future callers (brief prefill, site schemas).
  CH_SIC_MAP: [
    [10, 'food'], [11, 'food'], [56, 'food'], [47, 'boutique'],
    [96, 'salon'], [85, 'fitness'], [86, 'fitness'], [62, 'techy'], [63, 'techy'],
    [69, 'professional'], [70, 'professional'], [74, 'professional'], [41, 'realestate'],
    [68, 'realestate'], [55, 'hotel'], [79, 'hotel'], [77, 'boutique'], [93, 'fitness'],
    [87, 'professional'], [88, 'professional'], [49, 'auto'], [52, 'auto'], [45, 'auto']
  ],
  sicToBusinessType(code) {
    const n = parseInt(String(code || '').replace(/[^0-9]/g, '').slice(0, 2), 10);
    if (!Number.isFinite(n)) return '';
    const hit = this.CH_SIC_MAP.find((row) => row[0] === n);
    return hit ? hit[1] : '';
  },

  // Look up a company by its 8-character registered number.
  async fetchCompany(number) {
    const key = this.companiesHouseKey;
    if (!key) {
      const e = new Error('Add your free Companies House key in Settings ▸ Online data first.');
      e.code = 'no_key';
      throw e;
    }
    const num = String(number || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (!/^[0-9]{1,8}$/.test(num) && !/^[A-Z]{2}[0-9]{6}$/.test(num)) {
      const e = new Error('That does not look like a UK company number (8 characters, e.g. 09462154 or SC123456).');
      e.code = 'bad_number';
      throw e;
    }
    return this._cachedFor('companieshouse', 'ch_' + num, async () => {
      let d;
      try {
        d = await this.requestJSON('https://api.company-information.service.gov.uk/company/' + encodeURIComponent(num), {
          headers: { Authorization: 'Basic ' + btoa(key + ':') }
        }, { timeoutMs: 9000 });
      } catch (err) {
        if (err && err.status === 404) {
          const e = new Error('No company found with number ' + num + ' on the register.');
          e.code = 'not_found';
          throw e;
        }
        if (err && (err.status === 401 || err.status === 403)) {
          const e = new Error('Companies House rejected the key — check it in Settings ▸ Online data.');
          e.code = 'bad_key';
          throw e;
        }
        throw err;
      }
      const addr = d.registered_office_address || {};
      const address = [addr.address_line_1, addr.address_line_2, addr.locality, addr.region, addr.postal_code, addr.country]
        .filter(Boolean).join(', ');
      return {
        number: d.company_number || num,
        name: d.company_name || '',
        address,
        postcode: addr.postal_code || '',
        locality: addr.locality || '',
        sic: Array.isArray(d.sic_codes) ? d.sic_codes.filter(Boolean) : [],
        status: String(d.company_status || '').toLowerCase(),
        type: String(d.type || ''),
        createdAt: d.date_of_creation || '',
        source: 'Companies House'
      };
    });
  },

  // ----- Picsum -----
  async fetchPhotos(count = 8, w = 800, h = 600) {
    const key = `picsum_${count}_${w}_${h}`;
    return this._cachedFor('picsum', key, async () => {
      const list = await this._get(`https://picsum.photos/v2/list?page=${Math.floor(Math.random() * 30) + 1}&limit=${count}`);
      return list.map((p) => ({
        id: p.id,
        author: p.author,
        url: `https://picsum.photos/id/${p.id}/${w}/${h}`,
        thumb: `https://picsum.photos/id/${p.id}/320/240`,
        source: 'Picsum'
      }));
    });
  },

  // ----- RandomUser -----
  async fetchPeople(count = 6) {
    const key = `randomuser_${count}`;
    return this._cachedFor('randomuser', key, async () => {
      const data = await this._get(`https://randomuser.me/api/?results=${count}&nat=us,gb,fr,de,br,au&noinfo`);
      return data.results.map((r) => ({
        id: r.login.uuid,
        name: `${r.name.first} ${r.name.last}`,
        avatar: r.picture.large,
        email: r.email,
        city: `${r.location.city}, ${r.location.country}`,
        source: 'RandomUser'
      }));
    });
  },

  // ----- Quotable -----
  //
  // This used to call api.quotable.io/quotes/random. That host still answers,
  // but its certificate expired on 10 September 2024 and was never renewed, so
  // every request from the renderer failed with ERR_CERT_DATE_INVALID and the
  // Quotable card was permanently dead while still looking live: the only way
  // the panel could report it was "offline". The community mirror below serves
  // the same dataset with a valid certificate and `Access-Control-Allow-Origin:
  // *`, from both the file:// renderer and `npm run web`.
  //
  // Its `limit` accepts only 10, 25, 50 or 100 (anything else is a 400), so we
  // ask for the smallest bucket that covers the request and slice back down.
  // The author arrives as an object here, where quotable.io returned a bare
  // string — read both, so a future move back needs no edit.
  async fetchQuotes(count = 5) {
    const want = Math.max(1, Math.min(100, Math.floor(Number(count)) || 5));
    const bucket = want <= 10 ? 10 : want <= 25 ? 25 : want <= 50 ? 50 : 100;
    const key = `quotes_${want}`;
    return this._cachedFor('quotable', key, async () => {
      const data = await this._get(`https://api.quotable.kurokeita.dev/api/quotes/random?limit=${bucket}`);
      const rows = Array.isArray(data) ? data : (data && Array.isArray(data.quotes) ? data.quotes : []);
      return rows.map((q) => ({
        id: q.id || q._id || '',
        text: q.content || q.text || '',
        author: (q.author && typeof q.author === 'object' ? q.author.name : q.author) || 'Unknown',
        source: 'Quotable'
      })).filter((q) => q.text).slice(0, want);
    });
  },

  // ----- Google Fonts CSS (for previewing a font live) -----
  fontCssUrl(fontId) {
    // Keep in sync with DB.fonts. Browsers handle the CSS link directly (CORS-safe).
    const map = {
      inter: 'Inter:wght@400;500;600;700;800',
      poppins: 'Poppins:wght@400;500;600;700',
      spacegrotesk: 'Space+Grotesk:wght@400;500;600;700',
      sora: 'Sora:wght@400;500;600;700;800',
      outfit: 'Outfit:wght@400;500;600;700',
      manrope: 'Manrope:wght@400;500;600;700;800',
      montserrat: 'Montserrat:wght@400;500;600;700;800',
      plusjakarta: 'Plus+Jakarta+Sans:wght@400;500;600;700;800',
      dmsans: 'DM+Sans:wght@400;500;600;700',
      figtree: 'Figtree:wght@400;500;600;700;800',
      worksans: 'Work+Sans:wght@400;500;600;700',
      lexend: 'Lexend:wght@400;500;600;700;800',
      raleway: 'Raleway:wght@400;500;600;700;800',
      playfair: 'Playfair+Display:wght@400;500;600;700;800;900',
      dmserif: 'DM+Serif+Display:ital@0;1',
      newsreader: 'Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500',
      lora: 'Lora:wght@400;500;600;700',
      sourceserif: 'Source+Serif+4:wght@400;600;700',
      merriweather: 'Merriweather:wght@400;700;900',
      bebas: 'Bebas+Neue',
      oswald: 'Oswald:wght@400;500;600;700',
      pacifico: 'Pacifico',
      archivo: 'Archivo:wght@400;500;600;700',
      barlow: 'Barlow:wght@400;500;600;700',
      literata: 'Literata:opsz,wght@7..72,400;7..72,500;7..72,600;7..72,700',
      notoserif: 'Noto+Serif:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700',
      jetbrains: 'JetBrains+Mono:wght@400;500;600;700',
      syne: 'Syne:wght@400;500;600;700;800',
      unbounded: 'Unbounded:wght@400;500;600;700;800;900',
      anton: 'Anton',
      archivoblack: 'Archivo+Black',
      righteous: 'Righteous',
      alfaslab: 'Alfa+Slab+One',
      fraunces: 'Fraunces:wght@400;500;600;700;900',
      bodoni: 'Bodoni+Moda:wght@400;500;600;700;800',
      cormorant: 'Cormorant+Garamond:wght@400;500;600;700',
      caveat: 'Caveat:wght@400;500;600;700',
      dancingscript: 'Dancing+Script:wght@400;500;600;700',
      greatvibes: 'Great+Vibes',
      firacode: 'Fira+Code:wght@400;500;600;700',
      spacemono: 'Space+Mono:wght@400;700',
    };
    const fam = map[fontId];
    return fam ? `https://fonts.googleapis.com/css2?family=${fam}&display=swap` : null;
  },

  // Helpers kept here for integrations that use ONLINE as their endpoint
  // normalizer. They do not alter exported site behavior.
  deliveryFor(endpoint) {
    const raw = String(endpoint || '').trim();
    if (!raw) return { mode: 'demo', endpoint: '', key: '' };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { mode: 'formsubmit', endpoint: 'https://formsubmit.co/' + raw, key: raw };
    if (/^https?:\/\//i.test(raw)) return { mode: /formspree\.io/i.test(raw) ? 'formspree' : 'generic', endpoint: raw, key: '' };
    return { mode: 'web3forms', endpoint: 'https://api.web3forms.com/submit', key: raw };
  },
  _isJSONEndpoint(endpoint) {
    const raw = String(endpoint || '').trim();
    return /formsubmit\.co/i.test(raw) || /api\.web3forms\.com\/submit/i.test(raw) || /^https?:\/\//i.test(raw);
  },
  _isFormPost(action) {
    const raw = String(action || '').trim();
    return !!raw && (raw.startsWith('http') || raw.startsWith('/'));
  },

  // ----- CoinGecko (crypto prices — free, keyless, CORS-enabled) -----
  async fetchCoins(ids = 'bitcoin,ethereum,solana') {
    const list = String(ids).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const key = 'coins_' + list.join('_');
    if (!list.length) return [];
    return this._cachedFor('coingecko', key, async () => {
    const data = await this._get(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(list.join(','))}&vs_currencies=gbp&include_24hr_change=true&precision=2`);
    const names = { bitcoin: 'Bitcoin', ethereum: 'Ethereum', solana: 'Solana', cardano: 'Cardano', ripple: 'XRP', dogecoin: 'Dogecoin', polkadot: 'Polkadot', litecoin: 'Litecoin', chainlink: 'Chainlink', avalanche: 'Avalanche', polygon: 'Polygon', uniswap: 'Uniswap' };
    const coins = list.map((id) => ({
      id, name: names[id] || id.charAt(0).toUpperCase() + id.slice(1),
      price: data[id] ? data[id].gbp : null,
      change: data[id] ? data[id].gbp_24h_change : null,
      source: 'CoinGecko'
    }));
    return coins;
    });
  },

  // ----- GitHub API (public stats — free, keyless, 60 req/hr per IP) -----
  async fetchGitHubUser(user) {
    const u = String(user || '').trim().replace(/^@/, '');
    const key = 'gh_' + u.toLowerCase();
    if (!u) throw new Error('missing-username');
    return this._cachedFor('github', key, async () => {
    const profile = await this._get(`https://api.github.com/users/${encodeURIComponent(u)}`);
    const repos = await this._get(`https://api.github.com/users/${encodeURIComponent(u)}/repos?per_page=5&sort=updated`);
    const data = {
      login: profile.login, name: profile.name || profile.login, avatar: profile.avatar_url,
      bio: profile.bio || '', followers: profile.followers, public_repos: profile.public_repos,
      location: profile.location || '', company: profile.company || '', url: profile.html_url,
      repos: repos.map((r) => ({ name: r.name, desc: r.description || '', stars: r.stargazers_count, lang: r.language || '', url: r.html_url })),
      source: 'GitHub'
    };
    return data;
    });
  },

  // ----- Frankfurter (ECB daily FX rates — free, keyless, CORS-enabled) -----
  async fetchFxRates(base = 'GBP') {
    const b = String(base).trim().toUpperCase() || 'GBP';
    const key = 'fx_' + b;
    return this._cachedFor('frankfurter', key, async () => {
    const data = await this._get(`https://api.frankfurter.app/latest?from=${encodeURIComponent(b)}&to=EUR,USD,GBP,JPY,CHF,CAD,AUD`);
    const flags = { EUR: '🇪🇺', USD: '🇺🇸', GBP: '🇬🇧', JPY: '🇯🇵', CHF: '🇨🇭', CAD: '🇨🇦', AUD: '🇦🇺' };
    const rates = Object.entries(data.rates || {}).map(([code, rate]) => ({
      code, flag: flags[code] || '💱', rate, date: data.date || '', source: 'ECB via Frankfurter'
    }));
    return rates;
    });
  },

  // ----- Wikipedia REST summaries (free, keyless, CORS-enabled) -----
  async fetchWiki(topic) {
    const t = String(topic || '').trim();
    const key = 'wiki_' + t.toLowerCase().replace(/\s+/g, '_');
    if (!t) throw new Error('missing-topic');
    return this._cachedFor('wikipedia', key, async () => {
    const data = await this._get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/\s+/g, '_'))}`);
    const summary = {
      title: data.title || t,
      text: data.extract || '',
      thumb: (data.thumbnail || {}).source || '',
      url: ((data.content_urls || {}).desktop || {}).page || '',
      source: 'Wikipedia'
    };
    return summary;
    });
  },

  // ----- Pixabay (free photos by topic — CC0, no attribution, key-gated) -----
  async fetchPixabay(term, page = 1, count = 12) {
    const key = 'pixabay_' + String(term).trim().toLowerCase() + '_' + page + '_' + count;
    if (!this.pixabayKey) return []; // no key configured — silent, no UI breakage
    const q = String(term).trim();
    return this._cachedFor('pixabay', key, async () => {
    if (!q) throw new Error('missing-term');
    const data = await this._get(
      `https://pixabay.com/api/?key=${encodeURIComponent(this.pixabayKey)}&q=${encodeURIComponent(q)}&image_type=photo&orientation=horizontal&per_page=${count}&page=${page}&order=latest`,
      12000
    );
    const photos = (data.hits || []).map((h) => ({
      id: 'pixabay_' + h.id,
      title: h.tags || q,
      author: h.user ? h.user.username : '',
      url: h.largeImageURL || h.previewURL,
      thumb: h.previewURL,
      width: h.imageWidth, height: h.imageHeight,
      source: 'Pixabay'
    }));
    return photos;
    }, 15 * 60 * 1000);
  },

  // ----- Openverse (openly licensed photography — no key) -----
  // Openverse aggregates multiple collections and returns the licence record
  // alongside each image. We keep that record instead of reducing a result to
  // a bare URL, so generated sites can show the right credit and handoffs can
  // include a machine-readable attribution report.
  async fetchOpenverseImages(term, page = 1, count = 12, options) {
    const opts = options || {};
    const q = String(term || '').trim();
    if (!q) throw new Error('missing-term');
    const size = Math.max(1, Math.min(20, Number(count) || 12));
    const pg = Math.max(1, Number(page) || 1);
    const commercial = opts.commercial !== false;
    const key = 'openverse_' + q.toLowerCase() + '_' + pg + '_' + size + '_' + (commercial ? 'commercial' : 'all');
    return this._cachedFor('openverse', key, async () => {
    const params = `q=${encodeURIComponent(q)}&page=${pg}&page_size=${size}&mature=false`;
    let data;
    try {
      // The commercial filter keeps the default generator useful for client
      // work. Older API deployments may not support it, so retry the same
      // query without that filter rather than making the feature disappear.
      data = await this._get('https://api.openverse.org/v1/images/?' + params + (commercial ? '&license_type=commercial' : ''), 12000);
    } catch (firstError) {
      if (!commercial) throw firstError;
      data = await this._get('https://api.openverse.org/v1/images/?' + params, 12000);
    }
    const text = (value) => String(value == null ? '' : value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, ' ').trim();
    const licenseLabel = (value, version) => {
      const raw = String(value || '').trim();
      if (!raw) return 'Licence not supplied';
      const label = raw.toUpperCase().replace(/_/g, '-');
      return version && !label.includes(String(version).toUpperCase()) ? label + ' ' + version : label;
    };
    const results = (data && Array.isArray(data.results) ? data.results : []).map((hit) => {
      const id = String(hit.id == null ? '' : hit.id);
      const title = text(hit.title) || 'Openverse image';
      const creator = text(hit.creator || hit.author || '');
      const license = String(hit.license || '').trim().toLowerCase();
      const licenseVersion = String(hit.license_version || '').trim();
      const licenseUrl = String(hit.license_url || '').trim();
      const sourceUrl = String(hit.foreign_landing_url || hit.detail_url || '').trim() || (id ? 'https://openverse.org/image/' + encodeURIComponent(id) : 'https://openverse.org');
      const direct = String(hit.url || '').trim();
      const thumb = String(hit.thumbnail || direct).trim();
      const requiresAttribution = !/^(cc0|pdm|publicdomain|public-domain|zero)$/i.test(license);
      const attribution = text(hit.attribution) || [
        title,
        creator ? 'by ' + creator : '',
        licenseLabel(license, licenseVersion)
      ].filter(Boolean).join(' — ');
      if (!/^https?:\/\//i.test(direct) || !/^https?:\/\//i.test(thumb)) return null;
      return {
        id: id || 'openverse_' + Math.random().toString(36).slice(2, 8),
        title,
        author: creator,
        creator,
        creatorUrl: String(hit.creator_url || '').trim(),
        url: direct,
        thumb,
        width: Number(hit.width) || 0,
        height: Number(hit.height) || 0,
        source: 'Openverse',
        meta: {
          source: 'Openverse',
          sourceUrl,
          creator,
          creatorUrl: String(hit.creator_url || '').trim(),
          license: licenseLabel(license, licenseVersion),
          licenseId: license,
          licenseVersion,
          licenseUrl,
          attribution,
          requiresAttribution,
          title,
          id
        }
      };
    }).filter(Boolean);
    return results;
    }, 15 * 60 * 1000);
  },

  // Friendly alias for integrations that call the service a search rather than
  // a fetch. Keeping one implementation means both paths share the same cache.
  async searchOpenverse(term, options) {
    const opts = options || {};
    return this.fetchOpenverseImages(term, opts.page || 1, opts.count || opts.pageSize || 12, opts);
  },

  // ----- Coverr (free cinematic stock video — CC0, no attribution) -----
  async fetchCoverrVideo(query = 'hero') {
    const key = 'coverr_' + String(query).trim().toLowerCase();
    const q = String(query).trim().replace(/\s+/g, '+') || 'hero';
    return this._cachedFor('coverr', key, async () => {
    try {
      const data = await this._get(
        `https://coverr.co/api/videos?query=${encodeURIComponent(q)}&page=0&per_page=12`,
        12000
      );
      const hits = Array.isArray(data) ? data : (data && data.hits ? data.hits : []);
      const videos = hits.slice(0, 12).map((h) => {
        const slug = String((h && h.slug) || '').trim();
        const title = String((h && h.title) || slug || query);
        const thumb = String((h && h.thumbnail) || '').trim();
        const duration = Number(h && h.duration || 0);
        const isPremium = !!(h && h.is_premium);
        const tags = Array.isArray(h && h.tags) ? h.tags : [];
        const downloads = Number(h && h.downloads || 0);
        const views = Number(h && h.views || 0);
        // Coverr clips are published through Mux, but the public playback URLs for
        // these clips are not reliably reachable from an automated/http context (the
        // studio has seen 403 on stream.mux.com/{playback_id}/medium.mp4 and on the
        // Mux .m3u8 shapes for public Coverr clips). The canonical, reliable surface
        // for any visitor is the clip page itself: https://coverr.co/s/{slug} — it
        // plays in-browser, shows the CC0 license, and offers downloads.
        //
        // We store the clip page URL as the primary value and keep the Mux playback_id
        // as reference metadata only. The studio does not render a direct <video src>
        // to a stream.mux.com URL in exports because that path is not publicly playable.
        const playbackId = String((h && h.playback_id) || '').trim();
        const clipPageUrl = slug
          ? `https://coverr.co/s/${encodeURIComponent(slug)}`
          : `https://coverr.co/search/${encodeURIComponent(q)}`;
        return {
          id: 'coverr_' + (h && h.video_id ? h.video_id : slug || query),
          title,
          caption: String((h && h.description) || '').slice(0, 120),
          url: clipPageUrl,
          playbackId,
          thumb,
          duration,
          isPremium,
          tags,
          downloads,
          views,
          source: isPremium ? 'Coverr (premium)' : 'Coverr'
        };
      });
      return videos;
    } catch (e) {
      // The API answering "nothing matches that query" is not an outage, but a
      // transport, TLS or CORS failure is. Returning [] for both is how a
      // source the renderer cannot reach used to read as "no clips for that
      // term" — a silent failure wearing an empty-result message.
      if (e && e.code === 'http_error') return [];
      throw e;
    }
    }, 15 * 60 * 1000);
  },

  // href parameter fragment for a Google Fonts family (used by the builder's
  // self-hosted @font-face). Kept private — only Builder.pageHTML calls it.
  _fontFamilyParam(fontId) {
    const map = {
      archivo: 'Archivo:wght@400;500;600;700',
      barlow: 'Barlow:wght@400;500;600;700',
      literata: 'Literata:opsz,wght@7..72,400;7..72,500;7..72,600;7..72,700',
      notoserif: 'Noto+Serif:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700'
    };
    const fam = map[fontId];
    return fam ? fam.replace(/:/g, '-') : null;
  },

  /* ----- Iconify (icons) -----

     A search across 200,000+ open-source interface icons. Two endpoints: /search
     answers with names ("mdi:home") and /{prefix}/{name}.svg answers with the
     artwork itself.

     The artwork is fetched and inlined as a data URL rather than referenced by
     URL, and that is the whole point: an exported site whose icons are hot-linked
     to somebody else's API is a site with missing icons the first time that API is
     slow, rate-limits us or disappears. An inline SVG cannot break.
  */
  async searchIcons(query, limit = 24) {
    const q = String(query || '').trim() || 'star';
    const n = Math.max(1, Math.min(64, Math.floor(Number(limit) || 24)));
    return this._cachedFor('iconify', `iconify_search_${q}_${n}`, async () => {
      const d = await this._get('https://api.iconify.design/search?query=' + encodeURIComponent(q) + '&limit=' + n);
      return (Array.isArray(d && d.icons) ? d.icons : []).map((full) => {
        const name = String(full || '');
        const cut = name.indexOf(':');
        const prefix = cut > 0 ? name.slice(0, cut) : '';
        const icon = cut > 0 ? name.slice(cut + 1) : name;
        return {
          id: name, name, prefix, icon, set: prefix,
          thumb: 'https://api.iconify.design/' + prefix + '/' + icon + '.svg?height=32',
          source: 'Iconify'
        };
      // Sliced here as well as asked for above: the search endpoint treats
      // `limit` as a hint and can answer with more, and the panel's grid is a
      // fixed shape.
      }).filter((x) => x.prefix && x.icon).slice(0, n);
    }, 30 * 60 * 1000);
  },

  // One icon, as SVG text and as an inline data URL ready for img-src="data:".
  async fetchIconSvg(name, color) {
    const full = String(name || '').trim();
    const cut = full.indexOf(':');
    if (cut <= 0) {
      const e = new Error('That is not an icon name — expected something like mdi:home.');
      e.code = 'bad_icon';
      throw e;
    }
    const prefix = full.slice(0, cut);
    const icon = full.slice(cut + 1);
    const hex = /^#[0-9a-f]{3,8}$/i.test(String(color || '')) ? String(color) : '';
    const url = 'https://api.iconify.design/' + prefix + '/' + icon + '.svg?height=64' + (hex ? '&color=' + encodeURIComponent(hex) : '');
    return this._cachedFor('iconify', 'iconify_svg_' + prefix + '_' + icon + '_' + (hex || 'current'), async () => {
      let svg = '';
      try {
        svg = await this.requestText(url, undefined, { timeoutMs: 9000 });
      } catch (err) {
        if (err && err.status === 404) {
          const e = new Error('Icon ' + full + ' is not in that set — search again and pick one from the list.');
          e.code = 'not_found';
          throw e;
        }
        throw err;
      }
      // A 200 that is not SVG means the set name was wrong and the API answered
      // with an error document — checked, because inlining that into a site would
      // put an API error message where the icon should be.
      if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg/i.test(svg || '')) {
        const e = new Error('Iconify did not return an SVG for ' + full + '.');
        e.code = 'bad_svg';
        throw e;
      }
      return {
        id: full, name: full, set: prefix, svg,
        dataUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
        bytes: String(svg).length,
        source: 'Iconify',
        license: 'Open source (the set is the part before the colon)'
      };
    }, 24 * 60 * 60 * 1000);
  },

  /* ----- Public holidays (Nager.Date) -----

     Official public holidays for 100+ countries. For a small business site this
     is the difference between "closed for the holidays" and a list of the actual
     dates the shop is shut — and the dates are the part a template cannot guess.
  */
  async fetchHolidays(country = 'GB', year) {
    const cc = String(country || 'GB').trim().toUpperCase().slice(0, 2) || 'GB';
    if (!/^[A-Z]{2}$/.test(cc)) {
      const e = new Error('Use a two-letter country code — GB, IE, US, FR, DE, ES, AU, CA…');
      e.code = 'bad_country';
      throw e;
    }
    const y = Math.floor(Number(year) || new Date().getFullYear());
    return this._cachedFor('holidays', `holidays_${cc}_${y}`, async () => {
      let d;
      try {
        d = await this._get(`https://date.nager.at/api/v3/PublicHolidays/${y}/${cc}`, 10000);
      } catch (err) {
        if (err && err.status === 404) {
          const e = new Error('No holiday data for "' + cc + '". Try GB, IE, US, FR, DE, ES, IT, AU, CA or NZ.');
          e.code = 'bad_country';
          throw e;
        }
        throw err;
      }
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      const list = (Array.isArray(d) ? d : []).map((h) => ({
        id: String(h.date || '') + '|' + String(h.name || ''),
        date: String(h.date || ''),
        name: String(h.localName || h.name || ''),
        englishName: String(h.name || ''),
        counties: Array.isArray(h.counties) ? h.counties : [],
        nationwide: h.global !== false,
        source: 'Nager.Date'
      })).filter((h) => h.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return {
        country: cc, year: y, list,
        upcoming: list.filter((h) => new Date(h.date + 'T00:00:00') >= midnight).slice(0, 6),
        source: 'Nager.Date'
      };
    }, 12 * 60 * 60 * 1000);
  },

  /* ----- Weather (Open-Meteo, keyless) -----

     The exported site already has a live 5-day weather widget; this is the other
     half of that feature — the panel showing today's conditions while you write,
     and resolving a place name ONCE here so the widget is added with coordinates
     that are known to work instead of a city string that may or may not geocode.
  */
  WMO: {
    0: ['Clear', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
    45: ['Fog', '🌫️'], 48: ['Freezing fog', '🌫️'],
    51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
    56: ['Freezing drizzle', '🌧️'], 57: ['Freezing drizzle', '🌧️'],
    61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
    66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
    71: ['Light snow', '🌨️'], 73: ['Snow', '❄️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
    80: ['Light showers', '🌦️'], 81: ['Showers', '🌦️'], 82: ['Heavy showers', '⛈️'],
    85: ['Snow showers', '🌨️'], 86: ['Snow showers', '❄️'],
    95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm with hail', '⛈️'], 99: ['Thunderstorm with hail', '⛈️']
  },
  weatherLabel(code) {
    const hit = this.WMO[Math.round(Number(code))];
    return hit ? hit[0] : 'Unknown';
  },
  weatherEmoji(code) {
    const hit = this.WMO[Math.round(Number(code))];
    return hit ? hit[1] : '🌡️';
  },

  // A town name, a UK postcode, or "lat,lon" — any of them to coordinates.
  async resolvePlace(query) {
    const q = String(query || '').trim();
    if (!q) {
      const e = new Error('Type a town, a UK postcode or "lat,lon".');
      e.code = 'no_place';
      throw e;
    }
    const pair = q.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (pair) {
      const lat = Number(pair[1]);
      const lon = Number(pair[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { name: lat.toFixed(3) + ', ' + lon.toFixed(3), latitude: lat, longitude: lon, country: '', source: 'coordinates' };
    }
    // A UK postcode is exact in a way a search is not, so it is tried first and
    // only when the string actually looks like one.
    if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(q)) {
      return this._cachedFor('weather', 'place_pc_' + q.toUpperCase().replace(/\s+/g, ''), async () => {
        let d;
        try {
          d = await this._get('https://api.postcodes.io/postcodes/' + encodeURIComponent(q.toUpperCase().replace(/\s+/g, '')), 9000);
        } catch (err) {
          if (err && err.status === 404) {
            const e = new Error('No UK postcode matches "' + q + '".');
            e.code = 'no_place';
            throw e;
          }
          throw err;
        }
        const r = (d && d.result) || {};
        if (!Number.isFinite(Number(r.latitude))) { const e = new Error('That postcode has no location.'); e.code = 'no_place'; throw e; }
        return { name: String(r.postcode || q).toUpperCase(), latitude: Number(r.latitude), longitude: Number(r.longitude), country: String(r.country || ''), region: String(r.admin_district || ''), source: 'postcodes.io' };
      }, 30 * 24 * 60 * 60 * 1000);
    }
    return this._cachedFor('weather', 'place_' + q.toLowerCase(), async () => {
      const d = await this._get('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=1&language=en', 9000);
      const hit = d && Array.isArray(d.results) ? d.results[0] : null;
      if (!hit) {
        const e = new Error('No place called "' + q + '" — try a nearby town, or "lat,lon".');
        e.code = 'no_place';
        throw e;
      }
      return { name: String(hit.name || q), latitude: Number(hit.latitude), longitude: Number(hit.longitude), country: String(hit.country || ''), region: String(hit.admin1 || ''), source: 'Open-Meteo geocoding' };
    }, 30 * 24 * 60 * 60 * 1000);
  },
  async fetchWeather(place) {
    const loc = typeof place === 'string' ? await this.resolvePlace(place) : place;
    if (!loc || !Number.isFinite(Number(loc.latitude))) { const e = new Error('No location to look up.'); e.code = 'no_place'; throw e; }
    const lat = Number(loc.latitude).toFixed(4);
    const lon = Number(loc.longitude).toFixed(4);
    return this._cachedFor('weather', `weather_${lat}_${lon}`, async () => {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
        '&timezone=auto&forecast_days=3';
      const d = await this._get(url, 10000);
      const cur = (d && d.current) || {};
      const daily = (d && d.daily) || {};
      const times = Array.isArray(daily.time) ? daily.time : [];
      const days = times.map((day, i) => ({
        date: String(day),
        code: Number((daily.weather_code || [])[i]),
        label: this.weatherLabel((daily.weather_code || [])[i]),
        emoji: this.weatherEmoji((daily.weather_code || [])[i]),
        max: Number((daily.temperature_2m_max || [])[i]),
        min: Number((daily.temperature_2m_min || [])[i])
      }));
      return {
        place: loc.name,
        country: loc.country || '',
        latitude: Number(loc.latitude),
        longitude: Number(loc.longitude),
        now: {
          temp: Number(cur.temperature_2m),
          feels: Number(cur.apparent_temperature),
          humidity: Number(cur.relative_humidity_2m),
          wind: Number(cur.wind_speed_10m),
          code: Number(cur.weather_code),
          label: this.weatherLabel(cur.weather_code),
          emoji: this.weatherEmoji(cur.weather_code)
        },
        days,
        fetchedAt: Date.now(),
        source: 'Open-Meteo'
      };
    }, 20 * 60 * 1000);
  },

  /* ----- TheMealDB (food & menu content) -----

     A free, open recipe database behind the public test key "1". Nothing secret
     is in that key — it is the documented key for the free tier, which is why it
     can be a constant here where the Pixabay and Companies House keys cannot.
     Meal thumbnails come back from the same host, so the pictures need no extra
     origin either.
  */
  MEALDB_KEY: '1',
  async fetchMeals(term = 'soup', limit = 9) {
    const q = String(term || '').trim() || 'soup';
    const n = Math.max(1, Math.min(24, Math.floor(Number(limit) || 9)));
    return this._cachedFor('themealdb', `meals_${q.toLowerCase()}_${n}`, async () => {
      const d = await this._get('https://www.themealdb.com/api/json/v1/' + this.MEALDB_KEY + '/search.php?s=' + encodeURIComponent(q), 10000);
      const rows = d && Array.isArray(d.meals) ? d.meals : [];
      return rows.slice(0, n).map((m) => {
        const ingredients = [];
        for (let i = 1; i <= 20; i++) {
          const item = String(m['strIngredient' + i] || '').trim();
          if (!item) continue;
          const measure = String(m['strMeasure' + i] || '').trim();
          ingredients.push(measure ? measure + ' ' + item : item);
        }
        return {
          id: String(m.idMeal || ''),
          name: String(m.strMeal || 'Untitled dish'),
          category: String(m.strCategory || ''),
          area: String(m.strArea || ''),
          tags: String(m.strTags || '').split(',').map((t) => t.trim()).filter(Boolean),
          instructions: String(m.strInstructions || ''),
          ingredients: ingredients.slice(0, 12),
          thumb: String(m.strMealThumb || '') + (m.strMealThumb ? '/medium' : ''),
          video: String(m.strYoutube || ''),
          sourceUrl: String(m.strSource || ''),
          source: 'TheMealDB'
        };
      });
    }, 12 * 60 * 60 * 1000);
  },

  // Preview text rendered in each font, returned with the font's CSS family.
  //
  // Local on purpose — it is a list off DB.fonts, so it cannot fail and must not
  // be used to judge whether the CDN is reachable. checkFontCdn does that.
  async fontPreview(sample = 'Aa Bb 123 · Stylish sites, seriously fast') {
    return DB.fonts.map((f) => ({ ...f, sample }));
  },

  /*
    Google Fonts is the one source whose payload the renderer loads, not us: the
    panel emits a <link> and the browser fetches the stylesheet. So fontPreview()
    answering says nothing about the CDN, and marking the source "live" from it
    was a status invented from no check at all — the card could read "live" while
    every font behind it failed to load.

    This asks the CDN for the stylesheet the preview actually uses, so the badge
    means the same thing here as it does for every other source. Cached half an
    hour: a reachability check does not need to be a per-render tax.
  */
  async checkFontCdn(fontId = 'archivo') {
    const url = this.fontCssUrl(fontId);
    if (!url) {
      const e = new Error('Unknown font: ' + fontId);
      e.code = 'unknown_font';
      throw e;
    }
    return this._cachedFor('gfonts', 'gfonts_' + fontId, async () => {
      const css = await this.requestText(url, undefined, { timeoutMs: 10000 });
      return { fontId, url, bytes: String(css || '').length };
    }, 30 * 60 * 1000);
  },

  /*
    Is a repeated external read due yet?

    Free tiers are spent by the requests a UI makes when nothing changed. The
    pattern that causes it is retrying on failure more eagerly than on success:
    an unreachable registry, a paused project or a pulled cable used to make
    every save fire another request, so the harder the service was struggling
    the faster we asked. Pacing has to widen while a service is failing, and
    only a success may restore the normal cadence.

    Pure on purpose: it takes the clock as an argument, so the behaviour above
    is asserted in tests rather than described in a comment.
  */
  dueForRetry(state, now) {
    const s = state || {};
    const at = Number.isFinite(now) ? now : Date.now();
    const ok = Number(s.okTtlMs) > 0 ? Number(s.okTtlMs) : 45000;
    const base = Number(s.failMs) > 0 ? Number(s.failMs) : 15000;
    const cap = Number(s.failCapMs) > 0 ? Number(s.failCapMs) : 300000;
    const failures = Math.max(0, Math.floor(Number(s.failures) || 0));
    // A known-good read is trustworthy for its full window.
    if (failures === 0) {
      return !(Number(s.lastSuccess) > 0 && at - Number(s.lastSuccess) < ok);
    }
    // After failures, wait longer each time — never forever, never instantly.
    const wait = Math.min(cap, base * Math.pow(2, failures - 1));
    return !(Number(s.lastAttempt) > 0 && at - Number(s.lastAttempt) < wait);
  },

  clearCache() {
    this.cache = Object.create(null);
    this.cacheMeta = Object.create(null);
    this._cacheGeneration++;
    // Clearing the cache is a deliberate "start over", so the failure history
    // goes with it — otherwise a source that recovers the moment you ask would
    // still be held back by a stale count.
    this._breaker = Object.create(null);
    // Existing requests may still finish, but their results are prevented from
    // repopulating this freshly cleared cache by the generation guard above.
    this._flights.forEach((flight) => { if (flight && typeof flight.catch === 'function') flight.catch(() => {}); });
    this._flights.clear();
  },

  /*
    Per-source failure history — one row per source id.

    Separate from the response cache on purpose: a cached answer and a reachable
    provider are different facts. A source can have a perfectly good (stale)
    value while every live request to it is failing, and the UI needs to say
    the second thing rather than show the first as if it were current.
  */
  _breaker: Object.create(null),

  // Pacing constants, shared by dueForSource and retryInMs so the numbers the
  // UI counts down are the same numbers the gate uses.
  RETRY: { failMs: 15000, failCapMs: 300000 },

  sourceName(id) {
    const s = this.sources.find((x) => x.id === id);
    return s ? s.name : String(id || '');
  },

  /*
    A user asking again is an explicit instruction, and it outranks the pacer:
    the failure count is kept, so if this attempt also fails the NEXT gap is
    wider than the one being skipped. Without this, clicking a button would be
    answered with "not retrying yet", which is not a thing a button may say.
  */
  allowSourceNow(id) {
    const s = this._breaker[id];
    if (s) s.lastAttempt = 0;
    // A provider that sent Retry-After outranks a click, and deliberately so:
    // the instruction is about the next request the provider will accept, and
    // asking anyway is what turns a soft 429 into a hard block. The card shows
    // the countdown instead, which is a better answer than a second failure.
    return true;
  },

  recordSourceResult(id, ok, error) {
    const now = Date.now();
    const s = this._breaker[id] || (this._breaker[id] = {
      failures: 0, lastAttempt: 0, lastSuccess: 0, lastError: '', hasValue: false
    });
    s.lastAttempt = now;
    if (ok) {
      s.failures = 0;
      s.lastSuccess = now;
      s.lastError = '';
      s.hasValue = true;
      // A success is the only thing that clears a hold: the request that was
      // asked to wait has now been accepted, so the instruction has expired.
      s.holdUntil = 0;
      s.holdReason = '';
      return s;
    }
    s.failures += 1;
    s.lastError = (error && (error.message || error.code)) || 'request failed';
    const hold = Number(error && error.retryAfterMs) || 0;
    if (hold > 0) {
      s.holdUntil = now + hold;
      s.holdReason = 'rate_limited';
    } else if (s.holdUntil && s.holdUntil <= now) {
      s.holdUntil = 0;
      s.holdReason = '';
    }
    return s;
  },

  // Only a FAILING source is held back. dueForRetry's success window exists for
  // scheduled re-reads; applying it here would refuse a source that is fine.
  // A provider-imposed hold (Retry-After) comes first and is absolute.
  dueForSource(id, now) {
    const s = this._breaker[id];
    if (!s) return true;
    const at = Number.isFinite(now) ? now : Date.now();
    if (s.holdUntil && s.holdUntil > at) return false;
    if (!s.failures) return true;
    return this.dueForRetry({ ...s, failMs: this.RETRY.failMs, failCapMs: this.RETRY.failCapMs }, at);
  },

  // Milliseconds until this source may be asked again (0 when it may now).
  retryInMs(id, now) {
    const s = this._breaker[id];
    if (!s) return 0;
    const at = Number.isFinite(now) ? now : Date.now();
    if (s.holdUntil && s.holdUntil > at) return Math.max(0, Math.round(s.holdUntil - at));
    if (!s.failures) return 0;
    const wait = Math.min(this.RETRY.failCapMs, this.RETRY.failMs * Math.pow(2, s.failures - 1));
    const elapsed = s.lastAttempt > 0 ? at - s.lastAttempt : wait;
    return Math.max(0, Math.round(wait - elapsed));
  },

  // Somewhere for a caller to say "stop trusting that source's cooldown" — used
  // by Settings when a key is added, since a keyless failure is not a verdict
  // about the provider.
  clearSourceHold(id) {
    const s = this._breaker[id];
    if (!s) return false;
    s.holdUntil = 0; s.holdReason = ''; s.failures = 0;
    return true;
  },

  // What the UI shows for one source: why it is unreachable and when we will
  // try again. hasValue distinguishes "down, showing nothing" from "down,
  // serving the last good answer" — a very different thing to tell a user.
  sourceHealth(id) {
    const s = this._breaker[id];
    const now = Date.now();
    return {
      id,
      name: this.sourceName(id),
      failures: s ? s.failures : 0,
      lastError: s ? s.lastError : '',
      lastSuccess: s ? s.lastSuccess : 0,
      cooling: !this.dueForSource(id, now),
      retryInMs: this.retryInMs(id, now),
      hasValue: !!(s && s.hasValue),
      // "Down" and "asked us to wait" are different problems with different
      // advice, so the UI needs to tell them apart rather than show one badge.
      rateLimited: !!(s && s.holdUntil && s.holdUntil > now),
      holdUntil: s ? (s.holdUntil || 0) : 0,
      reason: s && s.holdUntil && s.holdUntil > now ? 'rate_limited' : (s && s.failures ? 'unreachable' : '')
    };
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = ONLINE;
// ============================================================
// PallettAI Studio — free online databases
// Picsum (photos) · RandomUser (avatars/people) · Quotable (quotes) · Google Fonts
// Every source is free, keyless and CORS-enabled (Pixabay needs a user-supplied
// key — see Settings ▸ Online data), with graceful fallbacks.
// ============================================================

const ONLINE = {
  // Pixabay key is user-supplied and lives in the app settings blob (saved from
  // Settings ▸ Online data). Never ship a hardcoded API key in source — anyone
  // who reads the repo could burn the quota. Read it live so every caller
  // (Database grid, AI photo fallback) sees the current value.
  get pixabayKey() {
    try {
      const raw = localStorage.getItem('pallettai.settings.v1');
      const s = raw ? JSON.parse(raw) : {};
      return (s && typeof s.pixabayKey === 'string' ? s.pixabayKey : '').trim();
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
      id: 'quotable', name: 'Quotable Quotes', icon: '💬', url: 'https://api.quotable.io',
      desc: 'Curated quotes from thousands of authors, fetched live. Great for hero and CTA copy.',
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
      if (!res.ok) {
        const e = new Error('HTTP ' + res.status);
        e.code = 'http_error'; e.status = res.status;
        throw e;
      }
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

  // ----- Picsum -----
  async fetchPhotos(count = 8, w = 800, h = 600) {
    const key = `picsum_${count}_${w}_${h}`;
    return this._cached(key, async () => {
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
    return this._cached(key, async () => {
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
  async fetchQuotes(count = 5) {
    const key = `quotable_${count}`;
    return this._cached(key, async () => {
      const data = await this._get(`https://api.quotable.io/quotes/random?limit=${count}`);
      return data.map((q) => ({
        id: q._id,
        text: q.content,
        author: q.author,
        source: 'Quotable'
      }));
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
    return this._cached(key, async () => {
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
    return this._cached(key, async () => {
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
    return this._cached(key, async () => {
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
    return this._cached(key, async () => {
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
    return this._cached(key, async () => {
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
    return this._cached(key, async () => {
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
    return this._cached(key, async () => {
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
      return [];
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

  // Preview text rendered in each font, returned with the font's CSS family
  async fontPreview(sample = 'Aa Bb 123 · Stylish sites, seriously fast') {
    return DB.fonts.map((f) => ({ ...f, sample }));
  },

  clearCache() {
    this.cache = Object.create(null);
    this.cacheMeta = Object.create(null);
    this._cacheGeneration++;
    // Existing requests may still finish, but their results are prevented from
    // repopulating this freshly cleared cache by the generation guard above.
    this._flights.forEach((flight) => { if (flight && typeof flight.catch === 'function') flight.catch(() => {}); });
    this._flights.clear();
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = ONLINE;
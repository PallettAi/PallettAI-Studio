// ============================================================
// PallettAI Studio — Supabase cloud registry client
// Phase 2b: accounts + one stable referral code per account,
// server-verified redemption with a stamped trace log.
//
// Zero dependencies: talks to Supabase's REST + auth APIs with
// plain fetch, so the studio stays dependency-free and works
// offline (falling back to the local demo engine).
// ============================================================

const SUPABASE = (() => {
  const CFG_KEY = 'pallettai.supabase.cfg.v1';
  const SES_KEY = 'pallettai.supabase.session.v1';
  const TIMEOUTS = {
    auth: 12000,
    read: 9000,
    write: 15000,
    logout: 6000
  };
  const inflightReads = new Map();

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { return null; }
  }
  function loadSes() {
    try { return JSON.parse(localStorage.getItem(SES_KEY) || 'null'); } catch (e) { return null; }
  }
  function persistSes(s) {
    if (s) localStorage.setItem(SES_KEY, JSON.stringify(s));
    else localStorage.removeItem(SES_KEY);
  }

  function base() {
    const c = loadCfg();
    return c && c.url ? c.url.replace(/\/+$/, '') : '';
  }
  function anon() {
    const c = loadCfg();
    return c ? c.anonKey : '';
  }

  // ---------- configuration ----------
  const api = {
    // Public anon key — same one already shipped on pallettai.org/ref.
    // Safe to embed; RLS + revoked PUBLIC/anon grants protect the registry.
    REGISTRY: {
      url: 'https://fjahxichioccknszuxhb.supabase.co',
      anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqYWh4aWNoaW9jY2tuc3p1eGhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MDk0MjUsImV4cCI6MjEwNDA4NTQyNX0.n1NMO7W5StuAAIxIZh2ZnMuM6qJqytKQaOUIav4aDm4'
    },
    isOfficialConfig(c) {
      const cfg = c || loadCfg();
      return !!(cfg && cfg.url === api.REGISTRY.url && cfg.anonKey === api.REGISTRY.anonKey);
    },
    connectOfficial() {
      return api.setConfig(api.REGISTRY.url, api.REGISTRY.anonKey);
    },
    ensureOfficial() {
      if (api.isOfficialConfig()) return { ok: true, already: true };
      return api.connectOfficial();
    },
    isConfigured() {
      const c = loadCfg();
      return !!(c && c.url && c.anonKey);
    },
    getConfig() { return loadCfg(); },
    setConfig(url, anonKey) {
      const c = {
        url: String(url || '').trim().replace(/\/+$/, ''),
        anonKey: String(anonKey || '').trim()
      };
      if (!c.url || !c.anonKey) return { ok: false, msg: 'Enter both the project URL and the anon key.' };
      localStorage.setItem(CFG_KEY, JSON.stringify(c));
      inflightReads.clear();
      return { ok: true };
    },
    clearConfig() {
      localStorage.removeItem(CFG_KEY);
      persistSes(null);
      inflightReads.clear();
    },

    // ---------- session ----------
    session() { return loadSes(); },
    signedIn() {
      const s = loadSes();
      return !!(s && s.accessToken && s.email);
    },

    // Store a session object from a token payload
    _adopt(t, email, uid) {
      const s = {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: Date.now() + (t.expires_in || 3600) * 1000,
        email: email || (t.user && t.user.email) || '',
        uid: uid || (t.user && t.user.id) || ''
      };
      persistSes(s);
      inflightReads.clear();
      return s;
    },

    // Restore the persisted session, refreshing the token if near/after expiry.
    // Returns true when a usable session exists afterwards.
    async restoreSession(options) {
      const s = loadSes();
      if (!s || !s.accessToken) return false;
      if (!api.isConfigured()) { persistSes(null); return false; }
      if (s.expiresAt && Date.now() < s.expiresAt - 60000) return true;
      if (!s.refreshToken) { persistSes(null); return false; }
      try {
        const j = await _post('token?grant_type=refresh_token', { refresh_token: s.refreshToken }, options, TIMEOUTS.auth);
        api._adopt(j, s.email, s.uid);
        return true;
      } catch (e) {
        // A timeout, cancellation, or transport failure is transient. Keep the
        // persisted session so the next launch can retry; only an auth response
        // from the server proves that the refresh token is invalid.
        if (!e || (!e.status || e.code === 'request_timeout' || e.code === 'request_cancelled')) return false;
        if (e.status !== 400 && e.status !== 401 && e.status !== 403) return false;
        persistSes(null);
        return false;
      }
    },

    // ---------- auth ----------
    async signUp(email, password, options) {
      try {
        const j = await _post('signup', { email, password }, options, TIMEOUTS.auth);
        // If email confirmation is ON, no session is returned yet.
        if (!j.access_token) return { ok: true, needsConfirm: true, email };
        api._adopt(j);
        return { ok: true, needsConfirm: false, email: j.user ? j.user.email : email };
      } catch (e) { return _err(e); }
    },
    async signIn(email, password, options) {
      try {
        const j = await _post('token?grant_type=password', { email, password }, options, TIMEOUTS.auth);
        api._adopt(j);
        return { ok: true, needsConfirm: false, email: j.user ? j.user.email : email };
      } catch (e) {
        const r = _err(e);
        if (e && e.code === 'email_not_confirmed') return { ...r, needsConfirm: true };
        return r;
      }
    },
    async resetPassword(email, options) {
      try {
        await _post('recover', { email: String(email || '').trim() }, options, TIMEOUTS.auth);
        return { ok: true };
      } catch (e) { return _err(e); }
    },
    async updatePassword(password, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to change your password.' };
      try {
        const res = await _request(base() + '/auth/v1/user', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            apikey: anon(),
            Authorization: 'Bearer ' + s.accessToken
          },
          body: JSON.stringify({ password: String(password || '') })
        }, options, TIMEOUTS.auth);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          const e = new Error(j.msg || j.error_description || j.message || 'Could not update password.');
          e.code = j.error_code || j.code || 'request_failed';
          e.status = res.status;
          throw e;
        }
        return { ok: true };
      } catch (e) { return _err(e); }
    },
    async signOut(options) {
      try {
        const s = loadSes();
        if (s && s.accessToken) {
          await _request(base() + '/auth/v1/logout', {
            method: 'POST',
            headers: { apikey: anon(), Authorization: 'Bearer ' + s.accessToken }
          }, options, TIMEOUTS.logout);
        }
      } catch (e) { /* ignore network errors — still sign out locally */ }
      persistSes(null);
      inflightReads.clear();
      return { ok: true };
    },

    // ---------- registry data ----------
    // Returns the account's profile + stable referral code + bound license.
    async getMyState(options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Not signed in.' };
      const reads = [
        ['profile', _get('profiles?select=*&id=eq.' + encodeURIComponent(s.uid), options, TIMEOUTS.read)],
        ['code', _get('referral_codes?select=*&owner_id=eq.' + encodeURIComponent(s.uid), options, TIMEOUTS.read)],
        ['license', _get('licenses?select=code,plan,expires_at&owner_id=eq.' + encodeURIComponent(s.uid), options, TIMEOUTS.read)]
      ];
      const results = await Promise.allSettled(reads.map((entry) => entry[1]));
      const state = { ok: true, profile: null, code: null, license: null };
      const warnings = [];
      let authExpired = false;
      results.forEach((result, i) => {
        const name = reads[i][0];
        if (result.status === 'fulfilled') {
          const rows = result.value || [];
          state[name] = rows[0] || null;
        } else {
          // A rejected authenticated read with 401 means the session is no
          // longer valid globally; transport failures remain isolated.
          if (result.reason && result.reason.status === 401) authExpired = true;
          else warnings.push(_warning(name, result.reason));
        }
      });
      if (authExpired) {
        persistSes(null);
        inflightReads.clear();
        return { ok: false, msg: 'Session expired — please sign in again.' };
      }
      if (warnings.length === results.length) return _err(results[0].reason);
      if (warnings.length) { state.partial = true; state.warnings = warnings; }
      return state;
    },

    // Activate a PAL-* license key against the registry (binds it to this
    // account and returns the granted plan + expiry).
    // Outcomes: verified | not-found | in-use | revoked | expired
    async activateLicense(code, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to activate license keys against the registry.' };
      try {
        const j = await _rpc('activate_license', { p_code: String(code || '').trim() }, options, TIMEOUTS.write);
        return { ok: true, outcome: j.outcome || 'not-found', plan: j.plan || null, expiresAt: j.expiresAt || null };
      } catch (e) { return _err(e); }
    },

    // Redeem a referral code against the registry RPC.
    // Returns { ok, outcome, grantedDays, trialExpiresAt } — outcomes:
    //   verified | already-used | self-redeemed | not-found
    async claimReviewReward(name, quote, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to leave a review and claim 3 days of Pro+.' };
      try {
        const j = await _rpc('claim_review_reward', {
          p_name: String(name || ''),
          p_quote: String(quote || '')
        }, options, TIMEOUTS.write);
        return { ok: true, outcome: j.outcome || 'bad-input', days: j.days || 0, until: j.until || null, reason: j.reason || null };
      } catch (e) { return _err(e); }
    },
    async redeem(code, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to verify codes against the cloud registry.' };
      try {
        const j = await _rpc('redeem_code', { p_code: String(code || '').trim() }, options, TIMEOUTS.write);
        return { ok: true, outcome: j.outcome || 'not-found', grantedDays: j.grantedDays || 0, trialExpiresAt: j.trialExpiresAt || null };
      } catch (e) { return _err(e); }
    },

    // ---------- daily streak (registry-decided, anti-cheat) ----------
    // The UTC day, the one-claim-per-day cap and the wheel outcome all
    // live on the server, so local clock tampering / replay is useless.
    // Returns the shared streak payload (see schema.sql §14).
    async getStreakState(options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Not signed in.' };
      try {
        const j = await _rpc('get_streak_state', {}, options, TIMEOUTS.read, true);
        return { ok: true, ...(j || {}) };
      } catch (e) { return _err(e); }
    },

    // Claim today's bonus. Server enforces one claim per (account, UTC day).
    // Returns { ok, outcome: claimed | already-claimed, claim: { cycleDay,
    // prizeType, prizeAmount, shieldGranted, shieldUsed }, ...state }.
    async claimDailyReward(action, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to claim your daily streak bonus.' };
      try {
        const j = await _rpc('claim_daily_reward', { p_action: String(action || 'claim').slice(0, 40) }, options, TIMEOUTS.write);
        return { ok: true, ...(j || {}) };
      } catch (e) { return _err(e); }
    },

    // Spin the Day-7 wheel — exactly once per completed week (server-guarded).
    // Returns { ok, outcome: spun | not-ready, prize: { type: credits |
    // pro_hours | shield, amount }, trialExpiresAt?, ...state }.
    async spinWheel(options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to spin the Day-7 wheel.' };
      try {
        const j = await _rpc('spin_wheel', {}, options, TIMEOUTS.write);
        return { ok: true, ...(j || {}) };
      } catch (e) { return _err(e); }
    },

    // ---------- AI credits (Part F Design A — server-authoritative) ----------
    // The server owns the budget: used = unrefunded spend rows, ceiling =
    // 3 base + streak bonus credits, unlimited on Pro/earned trial.
    // Returns { ok, unlimited, baseCredits, bonusCredits, used, left, ... }.
    async getCreditState(options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Not signed in.' };
      try {
        const j = await _rpc('get_credit_state', {}, options, TIMEOUTS.read, true);
        return { ok: true, ...(j || {}) };
      } catch (e) { return _err(e); }
    },

    // Consume one credit for an AI generation. `ref` is this attempt's
    // idempotency key (retries can never double-spend). Outcomes: spent |
    // already-spent | insufficient | unlimited | no-ref.
    async spendCredit(ref, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to spend AI credits.' };
      try {
        const j = await _rpc('spend_credit', { p_ref: String(ref || '').slice(0, 64), p_amount: 1 }, options, TIMEOUTS.write);
        return { ok: true, ...(j || {}) };
      } catch (e) { return _err(e); }
    },

    // Return a credit for a generation that produced nothing. Outcomes:
    // refunded | already-refunded | not-found | too-late.
    async refundCredit(ref, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to refund AI credits.' };
      try {
        const j = await _rpc('refund_credit', { p_ref: String(ref || '').slice(0, 64) }, options, TIMEOUTS.write);
        return { ok: true, ...(j || {}) };
      } catch (e) { return _err(e); }
    },

    async translateSite(texts, target, source, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, fallback: true, msg: 'Sign in to use DeepL.' };
      try {
        const res = await _request(base() + '/functions/v1/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anon(),
            Authorization: 'Bearer ' + s.accessToken
          },
          body: JSON.stringify({
            texts: Array.isArray(texts) ? texts : [],
            target: String(target || 'ES'),
            source: String(source || 'EN')
          })
        }, options, TIMEOUTS.write);
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j || j.ok !== true || !Array.isArray(j.texts)) {
          return { ok: false, fallback: true, msg: (j && j.error) || 'DeepL unavailable' };
        }
        return { ok: true, provider: 'deepl', texts: j.texts };
      } catch (e) {
        const err = _err(e);
        return { ok: false, fallback: true, msg: err.msg };
      }
    },

    async openBillingPortal(returnUrl, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to manage billing.' };
      try {
        const res = await _request(base() + '/functions/v1/billing-portal', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anon(),
            Authorization: 'Bearer ' + s.accessToken
          },
          body: JSON.stringify({ returnUrl: String(returnUrl || '') })
        }, options, TIMEOUTS.write);
        const j = await res.json().catch(() => ({}));
        if (j && j.error === 'no-customer') {
          return { ok: false, msg: 'No Stripe subscription on this account — use Upgrade to pay, or a license key.' };
        }
        if (!res.ok || !j || j.ok !== true || !j.url) {
          return { ok: false, msg: 'Billing portal is unavailable right now.' };
        }
        return { ok: true, url: j.url };
      } catch (e) { return _err(e); }
    }
  };

  // ---------- low-level helpers ----------
  // Every request gets a bounded lifetime. Callers may pass { signal } to
  // cancel work when a view closes or a newer refresh supersedes it. Mutations
  // use the same helper but are deliberately never retried here.
  async function _request(url, init, options, defaultTimeout) {
    const opts = options || {};
    const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : defaultTimeout;
    const callerSignal = opts.signal;
    let controller = null;
    let timer = null;
    let cancelled = false;
    let timedOut = false;
    let removeAbort = null;

    if (callerSignal && callerSignal.aborted) throw requestError('request_cancelled', 'Request cancelled.', { cancelled: true });
    if (typeof AbortController !== 'undefined') {
      controller = new AbortController();
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
      if (controller) return await request;
      return await Promise.race([
        request,
        new Promise((_, reject) => setTimeout(() => reject(requestError('request_timeout', 'Request timed out.', { timeout: true })), timeoutMs))
      ]);
    } catch (e) {
      if (timedOut) throw requestError('request_timeout', 'Request timed out.', { timeout: true });
      if (cancelled || (e && e.name === 'AbortError')) throw requestError('request_cancelled', 'Request cancelled.', { cancelled: true });
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (removeAbort) removeAbort();
    }
  }

  function requestError(code, message, flags) {
    const e = new Error(message);
    e.code = code;
    Object.assign(e, flags || {});
    return e;
  }

  function _warning(name, e) {
    if (e && e.code === 'request_timeout') return name + ' request timed out';
    if (e && e.code === 'request_cancelled') return name + ' request was cancelled';
    return name + ' could not be loaded';
  }

  async function _post(endpoint, body, options, timeoutMs) {
    const res = await _request(base() + '/auth/v1/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon() },
      body: JSON.stringify(body)
    }, options, timeoutMs || TIMEOUTS.auth);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(j.msg || j.error_description || j.message || 'Request failed');
      e.code = j.error_code || j.code || 'request_failed';
      e.status = res.status;
      throw e;
    }
    return j;
  }

  async function _readResponse(url, init, options, timeoutMs, message) {
    const res = await _request(url, init, options, timeoutMs);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(j.message || j.msg || message);
      e.code = j.code || 'request_failed';
      e.status = res.status;
      throw e;
    }
    return j;
  }

  async function _get(path, options, timeoutMs) {
    const s = loadSes();
    const url = base() + '/rest/v1/' + path;
    const request = () => _readResponse(url, {
      headers: { apikey: anon(), Authorization: 'Bearer ' + (s ? s.accessToken : '') }
    }, options, timeoutMs || TIMEOUTS.read, 'Request failed');
    return _dedupeRead(url + '\n' + (s ? s.accessToken : ''), request, options);
  }

  async function _rpc(fn, args, options, timeoutMs, dedupeRead) {
    const s = loadSes();
    const url = base() + '/rest/v1/rpc/' + fn;
    const request = () => _readResponse(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anon(),
        Authorization: 'Bearer ' + (s ? s.accessToken : '')
      },
      body: JSON.stringify(args || {})
    }, options, timeoutMs || TIMEOUTS.write, 'Registry request failed');
    return dedupeRead
      ? _dedupeRead(url + '\n' + (s ? s.accessToken : '') + '\n' + JSON.stringify(args || {}), request, options)
      : request();
  }

  function _dedupeRead(key, request, options) {
    // Abortable callers must own their request. Otherwise a cancellation from
    // one view could cancel a shared request another view is still using.
    if (options && options.signal) return request();
    const timeoutKey = options && options.timeoutMs ? ':' + options.timeoutMs : '';
    const fullKey = key + timeoutKey;
    const existing = inflightReads.get(fullKey);
    if (existing) return existing;
    const promise = request();
    inflightReads.set(fullKey, promise);
    promise.then(
      () => { if (inflightReads.get(fullKey) === promise) inflightReads.delete(fullKey); },
      () => { if (inflightReads.get(fullKey) === promise) inflightReads.delete(fullKey); }
    );
    return promise;
  }

  function _err(e) {
    if (e && e.code === 'request_cancelled') {
      return { ok: false, msg: 'Cloud registry request cancelled.', cancelled: true };
    }
    if (!e || !e.status || e.code === 'request_timeout') {
      return { ok: false, msg: 'Can’t reach the PallettAI cloud registry — check your connection and try again.', offline: true, timeout: !!(e && e.code === 'request_timeout') };
    }
    if (e.status === 401) {
      persistSes(null);
      inflightReads.clear();
      return { ok: false, msg: 'Session expired — please sign in again.' };
    }
    return { ok: false, msg: e.message || 'Cloud registry error.' };
  }

  return api;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SUPABASE;
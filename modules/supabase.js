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

  // The refresh token (and, by extension, the whole session) is a bearer secret
  // for the registry. In the Electron build it lives in safeStorage (OS-backed
  // encryption — Keychain on macOS, DPAPI on Windows, libsecret on Linux) rather
  // than in localStorage, so a local file-read or XSS-in-renderer cannot exfiltrate
  // it. localStorage is still the storage medium in the browser / web build, where
  // we have no safeStorage. The API below is the same shape either way.
  let sesStore = null; // set by initSessionStore() — null means "use localStorage"

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { return null; }
  }
  function loadSes() {
    if (!sesStore) {
      try { return JSON.parse(localStorage.getItem(SES_KEY) || 'null'); } catch (e) { return null; }
    }
    try {
      const raw = sesStore.get(SES_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function persistSes(s) {
    if (!sesStore) {
      if (s) localStorage.setItem(SES_KEY, JSON.stringify(s));
      else localStorage.removeItem(SES_KEY);
      return;
    }
    try {
      if (s) sesStore.set(SES_KEY, JSON.stringify(s));
      else sesStore.remove(SES_KEY);
    } catch (e) { /* storage error is non-fatal — the session still lives in memory via loadSes() until the next persistence */ }
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
        await _readResponse(base() + '/auth/v1/user', () => ({
          method: 'PUT',
          headers: _authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ password: String(password || '') })
        }), options, TIMEOUTS.auth, 'Could not update password.');
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

    // ---------- cloud project vault (Part 6 of schema.sql) ----------
    // Projects live in the studio's local store; the vault mirrors them to
    // the registry per account so work survives a lost device or a cleared
    // profile. Writes go through the security-definer RPCs; reads are a
    // plain RLS-scoped REST select.
    // Push one project snapshot. Returns { ok, outcome, updatedAt (epoch ms) }.
    // The payload is passed through unchanged — the registry validates its
    // shape and size, so a bad or oversized payload surfaces honestly.
    async saveProjectBackup(projectId, name, payload, options, localUpdatedAt) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to back projects up to the vault.' };
      try {
        const j = await _rpc('save_project_backup', {
          p_project_id: String(projectId || '').slice(0, 80),
          p_name: String(name || '').slice(0, 200),
          p_payload: payload,
          // Server-side version guard: when this push overwrites a DIFFERENT
          // historical state, the RPC archives the stored payload first.
          // (JSON.stringify drops undefined, so absent stays absent.)
          p_local_updated_at: Number.isFinite(localUpdatedAt) ? Math.round(localUpdatedAt) : undefined
        }, options, TIMEOUTS.write);
        // The RPC answers with an outcome, not an HTTP status, for the cases it
        // decides itself — a too-large payload comes back as 200 + outcome
        // 'too-large' from PostgREST, and reporting that as a successful save
        // would stamp a baseline for a project that was never stored. Only an
        // explicit 'saved' is a save.
        const outcome = (j && j.outcome) || 'saved';
        if (outcome === 'too-large') return { ok: false, outcome, tooLarge: true, msg: 'This project is too large for the vault — remove some embedded photos and try again.' };
        if (outcome === 'bad-input') return { ok: false, outcome, msg: 'The registry refused this project — check it and try again.' };
        if (outcome === 'not-signed-in') return { ok: false, outcome, msg: 'Session expired — please sign in again.' };
        const at = j.updatedAt ? Date.parse(j.updatedAt) : 0;
        return { ok: true, outcome, updatedAt: Number.isFinite(at) ? at : null };
      } catch (e) {
        const r = _err(e);
        // Some proxies reject an oversized body before the RPC ever runs.
        if (e && e.status === 413) return { ok: false, msg: 'This project is too large for the vault — remove some embedded photos and try again.', tooLarge: true };
        return r;
      }
    },

    // Remove one project from the vault (tombstoned, not hard-wiped).
    async deleteProjectBackup(projectId, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to manage your cloud vault.' };
      try {
        const j = await _rpc('delete_project_backup', { p_project_id: String(projectId || '').slice(0, 80) }, options, TIMEOUTS.write);
        return { ok: true, outcome: j.outcome || 'deleted' };
      } catch (e) { return _err(e); }
    },

    // Read this account's whole vault (RLS scopes it to the caller).
    // Returns { ok, backups: [{ projectId, name, payload, updatedAt, deletedAt }] }.
    async getProjectBackups(options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Not signed in.' };
      try {
        const rows = await _get('project_backups?select=project_id,project_name,payload,updated_at,deleted_at&owner_id=eq.' + encodeURIComponent(s.uid), options, TIMEOUTS.read);
        const backups = (Array.isArray(rows) ? rows : []).map((r) => ({
          projectId: r.project_id,
          name: r.project_name || '',
          payload: r.payload || null,
          updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
          deletedAt: r.deleted_at ? new Date(r.deleted_at).getTime() : null
        }));
        return { ok: true, backups };
      } catch (e) { return _err(e); }
    },

    // Cloud vault version history (schema.sql Part 6b): the rolling per-project
    // archive the server writes on overwrite/delete, plus explicit conflict
    // copies. List returns metadata only; get returns the full payload.
    async listProjectBackupVersions(projectId, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Not signed in.' };
      try {
        const j = await _rpc('list_project_backup_versions', { p_project_id: String(projectId || '').slice(0, 80) }, options, TIMEOUTS.read);
        return { ok: true, versions: Array.isArray(j && j.versions) ? j.versions : [] };
      } catch (e) { return _err(e); }
    },

    async getProjectBackupVersion(projectId, versionId, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Not signed in.' };
      try {
        const j = await _rpc('get_project_backup_version', {
          p_project_id: String(projectId || '').slice(0, 80),
          p_version_id: Math.round(Number(versionId) || 0)
        }, options, TIMEOUTS.read);
        if (j && j.outcome === 'not-found') return { ok: false, msg: 'That version is no longer in the archive (it keeps the newest 10).' };
        return { ok: true, payload: (j && j.payload) || null, createdAt: (j && j.createdAt) || null, reason: (j && j.reason) || '' };
      } catch (e) { return _err(e); }
    },

    // Explicit archive write (the merge engine files 'conflict' copies here).
    async saveProjectBackupVersion(projectId, payload, reason, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Not signed in.' };
      try {
        const j = await _rpc('save_project_backup_version', {
          p_project_id: String(projectId || '').slice(0, 80),
          p_payload: payload,
          p_reason: String(reason || 'pre-save').slice(0, 20)
        }, options, TIMEOUTS.write);
        const outcome = (j && j.outcome) || 'saved';
        if (outcome === 'saved') return { ok: true, outcome };
        if (outcome === 'too-large') return { ok: false, outcome, tooLarge: true, msg: 'This snapshot is too large for the archive.' };
        return { ok: false, outcome, msg: 'The registry refused this snapshot.' };
      } catch (e) {
        const r = _err(e);
        if (e && e.status === 413) return { ok: false, msg: 'This snapshot is too large for the archive.', tooLarge: true };
        return r;
      }
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
        const res = await _authedResponse(base() + '/functions/v1/translate', () => ({
          method: 'POST',
          headers: _authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            texts: Array.isArray(texts) ? texts : [],
            target: String(target || 'ES'),
            source: String(source || 'EN'),
            // The same ref the client already mirrors to `settleCreditSpend`,
            // so the function's own `spend_credit` call is idempotent with it
            // (one charge, not two) while still metering direct callers.
            ref: String((options && options.ref) || '')
          })
        }), options, TIMEOUTS.write);
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

    // Asks the registry to create a Dodo checkout session. The account the plan
    // lands on is resolved server-side from this request's own token, so nothing
    // here needs to carry (or can tamper with) an account id.
    async startCheckout(planId, returnUrl, options) {
      const s = loadSes();
      if (!api.isConfigured() || !s) return { ok: false, msg: 'Sign in to upgrade.' };
      try {
        const res = await _authedResponse(base() + '/functions/v1/dodo-checkout', () => ({
          method: 'POST',
          headers: _authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ plan: String(planId || ''), returnUrl: String(returnUrl || '') })
        }), options, TIMEOUTS.write);
        const j = await res.json().catch(() => ({}));
        // "not switched on yet" and "broken" are different answers and the
        // customer deserves the true one: the first is fixed with a license key,
        // the second by trying again.
        if (j && j.error === 'not-configured') {
          return { ok: false, msg: 'Card checkout is not switched on yet — paste a license key, or try again later.' };
        }
        if (j && j.error === 'bad-plan') {
          return { ok: false, msg: 'That plan cannot be billed — choose Pro or Pro+.' };
        }
        if (!res.ok || !j || j.ok !== true || !j.url) {
          return { ok: false, msg: 'Checkout is unavailable right now — please try again.' };
        }
        return { ok: true, url: j.url, plan: j.plan || String(planId || '') };
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

  // Bearer headers for an authenticated call, built at REQUEST time. A token
  // captured when the caller was constructed would be the token the server just
  // rejected, so every authenticated request rebuilds them through here.
  function _authHeaders(extra) {
    const s = loadSes();
    return Object.assign(
      { apikey: anon(), Authorization: 'Bearer ' + (s ? s.accessToken : '') },
      extra || {}
    );
  }

  // One authenticated request plus the single recovery every caller needs: a 401
  // from an access token that outlived its hour is refreshed and the request
  // replayed exactly once. Without this, an app left open signs itself out over
  // routine background work (a vault autosave, a credit read, a streak refresh).
  async function _authedResponse(url, makeInit, options, timeoutMs) {
    let res = await _request(url, makeInit(), options, timeoutMs);
    if (res.status === 401 && await _refreshSession()) {
      res = await _request(url, makeInit(), options, timeoutMs);
    }
    return res;
  }

  // Single-flight refresh: several views can 401 in the same instant and must not
  // each spend the refresh token or race each other's session write. The caller's
  // signal is deliberately NOT threaded through, so one view closing cannot abort
  // a refresh another view is waiting on.
  let refreshInFlight = null;
  function _refreshSession() {
    if (refreshInFlight) return refreshInFlight;
    const s = loadSes();
    if (!s || !s.refreshToken || !api.isConfigured()) return Promise.resolve(false);
    refreshInFlight = (async () => {
      try {
        const j = await _post('token?grant_type=refresh_token', { refresh_token: s.refreshToken }, null, TIMEOUTS.auth);
        api._adopt(j, s.email, s.uid);
        return true;
      } catch (e) {
        // A really-dead refresh token still fails honestly: the replayed request
        // 401s and _err() clears the session, exactly as before.
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  async function _readResponse(url, makeInit, options, timeoutMs, message) {
    const res = await _authedResponse(url, makeInit, options, timeoutMs);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(j.message || j.msg || message);
      // Auth endpoints report `error_code`; REST reports `code`.
      e.code = j.code || j.error_code || 'request_failed';
      e.status = res.status;
      throw e;
    }
    return j;
  }

  async function _get(path, options, timeoutMs) {
    const url = base() + '/rest/v1/' + path;
    const request = () => _readResponse(url, () => ({ headers: _authHeaders() }), options, timeoutMs || TIMEOUTS.read, 'Request failed');
    const s = loadSes();
    return _dedupeRead(url + '\n' + (s ? s.accessToken : ''), request, options);
  }

  async function _rpc(fn, args, options, timeoutMs, dedupeRead) {
    const url = base() + '/rest/v1/rpc/' + fn;
    const body = JSON.stringify(args || {});
    const request = () => _readResponse(url, () => ({
      method: 'POST',
      headers: _authHeaders({ 'Content-Type': 'application/json' }),
      body
    }), options, timeoutMs || TIMEOUTS.write, 'Registry request failed');
    const s = loadSes();
    return dedupeRead
      ? _dedupeRead(url + '\n' + (s ? s.accessToken : '') + '\n' + body, request, options)
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

  // Electron-only: swap the session storage backend from localStorage to
  // safeStorage. Keep the localStorage key path as a web-mode fallback so the
  // same module still works in a browser build. Call once, early, from preload
  // (after contextIsolation is set up) or from main via a one-shot IPC.
  //
  // The store is per-process and OS-encrypted, so it survives a normal app
  // restart but not a full uninstall / profile wipe (same lifecycle as the
  // publish-secrets.bin path in main.js).
  api.initSessionStore = function (store) {
    if (!store || typeof store.get !== 'function' || typeof store.set !== 'function' || typeof store.remove !== 'function') {
      return false;
    }
    sesStore = store;
    // Migrate any session that already exists in localStorage into safeStorage,
    // then clear the localStorage copy so the secret is not written twice.
    try {
      const existing = (typeof localStorage !== 'undefined' && localStorage.getItem(SES_KEY)) || null;
      if (existing) {
        try {
          JSON.parse(existing); // validate shape quickly
          sesStore.set(SES_KEY, existing);
          if (typeof localStorage !== 'undefined') localStorage.removeItem(SES_KEY);
        } catch (e) { /* unparseable leftover — leave it; safeStorage stays empty */ }
      }
    } catch (e) { /* localStorage may be unavailable in some contexts */ }
    return true;
  };

  return api;
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SUPABASE;
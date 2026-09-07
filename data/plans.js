// ============================================================
// PallettAI Studio — plans, licenses & entitlement engine
// Free / Pro / Pro+ tiers. Paid unlocks and referral days are granted
// only after the cloud registry verifies them — local checkout and
// checksum keys are not entitlements.
// ============================================================

const PLANS = {
  version: '1.6.0',

  currency: { symbol: '£', code: 'GBP' },

  plans: [
    {
      id: 'free', name: 'Free', price: 0, period: 'forever', popular: false,
      tagline: 'Try the studio with sample templates.',
      features: [
        '2 active projects',
        'Up to 10 sections per site',
        '10 starter templates (7 more unlocked on Pro)',
        'Animation Pack + Contact Pro suites',
        '22 core fonts + 19 free catalog layouts',
        'Free live widgets: map, weather, embeds, online booking',
        '4 free online databases (photos, people, quotes, fonts)',
        '3 AI Studio credits',
        '“Made with PallettAI” badge on exports'
      ],
      limits: { projects: 2, sectionsPerSite: 10, aiCredits: 3 }
    },
    {
      id: 'pro', name: 'Pro', price: 9, period: 'month', popular: true,
      tagline: 'For freelancers building client sites.',
      features: [
        'Unlimited projects & sections',
        'All templates unlocked',
        'All upgrade suites (Blog, Shop, Gallery Pro, SEO, Data Widgets)',
        'Premium Font Pack — 14 extra display, script & mono fonts',
        '6 premium catalog layouts (aurora hero, pricing toggle, timeline…)',
        'Live data widgets: crypto ticker, GitHub stats, FX rates',
        '3 extra online databases (CoinGecko, GitHub, Frankfurter + Wikipedia)',
        'Unlimited AI Studio generations',
        'AI image generation',
        'Priority support'
      ],
      limits: { projects: Infinity, sectionsPerSite: Infinity, aiCredits: Infinity },
      checkoutUrl: 'https://buy.stripe.com/fZu3co2pDesB7wyfWL2B20m'
    },
    {
      id: 'proplus', name: 'Pro+', price: 19, period: 'month', popular: false,
      tagline: 'For professionals delivering polished client work.',
      features: [
        'Everything in Pro',
        'Unbranded exports (no studio badge)',
        'Reusable brand presets — save up to 12 visual systems across projects',
        'White-label client handoff ZIP',
        'No PallettAI attribution in the hosting guide or brand kit',
        'A polished delivery pack for every client project'
      ],
      limits: { projects: Infinity, sectionsPerSite: Infinity, aiCredits: Infinity },
      checkoutUrl: 'https://buy.stripe.com/4gM4gsggtfwFcQS11R2B20l'
    }
  ],

  // Suites that require a paid plan to install
  suitePlan: { blog: 'pro', shop: 'pro', gallerypro: 'pro', seo: 'pro', datawidgets: 'pro' },

  // Section types that require a paid plan (added via editor / copilot / integrations)
  sectionSuite: { crypto: 'datawidgets', github: 'datawidgets', fx: 'datawidgets' },

  // Fonts and catalog layouts that require a paid plan
  fontTier: 'pro',
  proLayouts: ['hero-aurora', 'stats-ticker', 'pricing-toggle', 'testimonials-featured', 'about-timeline', 'blog-featured'],

  // Templates that require a paid plan
  proTemplates: ['lumina', 'meridian', 'forge', 'voyage', 'ceremony', 'estate', 'aperture'],

  premium: ['pro', 'proplus'],

  // Agency was never a real collaboration tier. Keep old local subscriptions
  // and registry keys working by mapping that retired id to Pro+.
  normalizePlan(id) {
    const value = String(id || '').toLowerCase();
    return value === 'agency' ? 'proplus' : (value || 'free');
  },
  isProPlus(id) {
    return this.normalizePlan(id) === 'proplus';
  },
  getPlan(id) {
    const normalized = this.normalizePlan(id);
    return this.plans.find((p) => p.id === normalized) || this.plans[0];
  },
  isStripePaymentLink(url) {
    try {
      const parsed = new URL(String(url || ''));
      if (parsed.protocol !== 'https:') return false;
      if (parsed.hostname !== 'buy.stripe.com') return false;
      if (parsed.username || parsed.password) return false;
      return /^\/[A-Za-z0-9]+$/.test(parsed.pathname);
    } catch (_) {
      return false;
    }
  },
  getCheckoutUrl(planId) {
    const url = (this.getPlan(planId) || {}).checkoutUrl;
    return this.isStripePaymentLink(url) ? url : '';
  },
  checkoutUrlForAccount(planId, accountId) {
    const base = this.getCheckoutUrl(planId);
    const uid = String(accountId || '');
    if (!base || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid)) return '';
    const parsed = new URL(base);
    parsed.searchParams.set('client_reference_id', uid);
    return parsed.toString();
  },

  // ---------- License keys ----------
  // Format: PAL-{PRO|PROPLUS}-{SEED}-{CHECK}. Legacy PAL-AGENCY keys are
  // accepted and mapped to Pro+ so existing customers are not downgraded.
  _check(code) {
    let s = 0;
    for (const ch of code) s = (s * 31 + ch.charCodeAt(0)) % 99991;
    return s.toString(36).toUpperCase().padStart(4, '0').slice(-4);
  },
  makeKey(planCode, seed) {
    const base = 'PAL-' + planCode + '-' + String(seed).toUpperCase();
    return base + '-' + this._check(base);
  },
  validateLicense(key) {
    const k = String(key || '').trim().toUpperCase();
    const m = k.match(/^PAL-(PRO|PROPLUS|AGENCY)-([A-Z0-9]{2,8})-([A-Z0-9]{4})$/);
    if (!m) return { ok: false, reason: 'format' };
    if (this._check('PAL-' + m[1] + '-' + m[2]) !== m[3]) return { ok: false, reason: 'invalid' };
    return { ok: true, plan: m[1] === 'PRO' ? 'pro' : 'proplus', key: k };
  },

  // ---------- Subscription store (localStorage) ----------
  store: {
    key: 'pallettai.subscription.v1',
    _default() {
      return {
        plan: 'free', active: true, source: 'trial', key: '', expiresAt: null,
        planExpiresAt: null,   // registry licenses can expire; local checkout is not an entitlement
        credits: { used: 0 },
        creditsSpends: [],  // ledger: refs + statuses for server-mirrored AI spends
        bonusCredits: 0,    // server-tracked bonus AI credits (daily streak rewards)
        trialProUntil: 0,   // free-plan users with earned Pro trial days (referrals)
        reviewProPlusUntil: 0, // one-time testimonial gift (3 days of Pro+)
        refCode: null,      // this install's referral code, e.g. REF-XXXXXX
        referrals: [],      // redemption history
        updatedAt: Date.now()
      };
    },
    load() {
      try {
        const state = { ...this._default(), ...JSON.parse(localStorage.getItem(this.key) || '{}') };
        let dirty = false;
        const normalized = PLANS.normalizePlan(state.plan);
        if (normalized !== state.plan) {
          state.plan = normalized;
          dirty = true;
        }
        // Demo checkout and client-side checksum keys are not entitlements.
        if (state.source === 'checkout' || state.source === 'license') {
          state.plan = 'free';
          state.source = 'trial';
          state.key = '';
          state.planExpiresAt = null;
          dirty = true;
        }
        // Local referral redeem used to stamp trialProUntil without the registry.
        if ((state.trialProUntil || 0) > 0 && state.trialSource !== 'registry') {
          state.trialProUntil = 0;
          state.trialSource = '';
          dirty = true;
        }
        if (dirty) {
          try { localStorage.setItem(this.key, JSON.stringify(state)); } catch (e) { /* read-only storage */ }
        }
        return state;
      } catch (e) { return this._default(); }
    },
    save(sub) {
      try {
        localStorage.setItem(this.key, JSON.stringify(sub));
        return true;
      } catch (e) {
        // Subscription state is also reconstructed defensively by load(); a
        // blocked quota must not crash an otherwise usable local studio.
        return false;
      }
    },
    current() { return this.load(); },
    plan() { return PLANS.getPlan(this.load().plan); },
    // Pro entitlement = paid plan (registry keys can carry an expiry) OR an active earned trial
    isPro() {
      const s = this.load();
      if (PLANS.premium.includes(PLANS.normalizePlan(s.plan))) {
        if (s.planExpiresAt && s.planExpiresAt <= Date.now()) {
          // expired registry license → drop back to Free honestly
          s.plan = 'free'; s.source = 'trial'; s.key = ''; s.planExpiresAt = null;
          s.updatedAt = Date.now(); this.save(s);
          return false;
        }
        return true;
      }
      return (s.trialProUntil || 0) > Date.now() || (s.reviewProPlusUntil || 0) > Date.now();
    },
    isProPlus() {
      if ((this.load().reviewProPlusUntil || 0) > Date.now()) return true;
      return this.isPro() && PLANS.isProPlus(this.load().plan);
    },
    applyReviewProPlus(untilMs) {
      const s = this.load();
      const t = Number(untilMs) || 0;
      if (t > Date.now()) {
        s.reviewProPlusUntil = Math.max(s.reviewProPlusUntil || 0, t);
        s.updatedAt = Date.now();
        this.save(s);
      }
      return s.reviewProPlusUntil || 0;
    },
    // Whole Pro days left on an earned trial (0 when on a paid plan or no trial)
    trialDaysLeft() {
      const s = this.load();
      if (PLANS.premium.includes(PLANS.normalizePlan(s.plan))) return 0;
      return Math.max(0, Math.ceil(((s.trialProUntil || 0) - Date.now()) / 864e5));
    },
    creditsLeft() {
      const s = this.load();
      // Free tier = the base AI credits (3) + any server-tracked bonus credits
      // earned from the daily streak. Pro/Pro+ stay unlimited.
      const lim = this.isPro() ? Infinity : PLANS.getPlan('free').limits.aiCredits + (s.bonusCredits || 0);
      return { used: s.credits.used, limit: lim, left: lim === Infinity ? Infinity : Math.max(0, lim - s.credits.used) };
    },
    // Adopt the registry's authoritative bonus-credit balance (0 when signed out).
    setBonusCredits(n) {
      const s = this.load();
      const b = Math.max(0, Math.floor(Number(n) || 0));
      if (s.bonusCredits !== b) {
        s.bonusCredits = b;
        s.updatedAt = Date.now();
        this.save(s);
      }
      return s.bonusCredits;
    },

    // ---------- AI-credit ledger (Part F Design A) ----------
    // Local spend is still the instant gate (offline-safe), but every cloud
    // spend carries an idempotency `ref` and is mirrored to the registry RPC.
    // status: local (signed-out demo) | pending (cloud, unconfirmed) |
    //         pushed (cloud, confirmed) | refund-pending | refunded
    useCredit(kind) {
      const s = this.load();
      s.credits.used++;
      const cloud = kind === 'cloud';
      s.creditsSpends = s.creditsSpends || [];
      s.creditsSpends.unshift({
        ref: 'crd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
        kind: cloud ? 'cloud' : 'local',
        status: cloud ? 'pending' : 'local',
        at: Date.now(),
        attempts: 0
      });
      this._trimCreditLedger(s);
      this.save(s);
      return s.creditsSpends[0].ref;
    },
    // Local-only undo. Returns { ref, server } for the entry it restored, or
    // null when there is nothing left to refund. server=true → the registry
    // must be told (the spend was pushed or is still pending); server=false →
    // a signed-out/local spend that the registry never saw.
    refundCredit() {
      const s = this.load();
      const list = s.creditsSpends || [];
      const idx = list.findIndex((e) => e.status === 'local' || e.status === 'pending' || e.status === 'pushed');
      if (idx === -1) { this.save(s); return null; }
      const e = list[idx];
      s.credits.used = Math.max(0, s.credits.used - 1);
      const server = e.kind === 'cloud' && (e.status === 'pending' || e.status === 'pushed');
      // cloud refunds stay retryable until the registry confirms (the spend
      // may not have landed yet when the refund is requested)
      e.status = server ? 'refund-pending' : 'refunded';
      e.attempts = 0;
      this._trimCreditLedger(s);
      this.save(s);
      return { ref: e.ref, server };
    },
    _trimCreditLedger(s) {
      const list = s.creditsSpends || [];
      if (list.length <= 160) return;
      const cut = Date.now() - 864e5;
      // drop settled entries older than a day, keep anything unresolved
      s.creditsSpends = list.filter((e) =>
        e.status === 'pending' || e.status === 'pushed' || e.status === 'refund-pending' || e.at > cut
      );
      if (s.creditsSpends.length > 240) s.creditsSpends.length = 240;
    },
    creditEntryStatus(ref) {
      const s = this.load();
      const e = (s.creditsSpends || []).find((x) => x.ref === ref);
      return e ? e.status : null;
    },
    // Mark a cloud spend as confirmed server-side (only from 'pending').
    markCreditPushed(ref) {
      const s = this.load();
      const e = (s.creditsSpends || []).find((x) => x.ref === ref);
      if (e && e.status === 'pending') { e.status = 'pushed'; e.attempts = 0; this.save(s); }
      return e ? e.status : null;
    },
    markCreditRefunded(ref) {
      const s = this.load();
      const e = (s.creditsSpends || []).find((x) => x.ref === ref);
      if (e && e.status !== 'refunded') { e.status = 'refunded'; this.save(s); }
    },
    // The server refund failed (offline / not landed yet) — keep for retry.
    bumpCreditAttempt(ref) {
      const s = this.load();
      const e = (s.creditsSpends || []).find((x) => x.ref === ref);
      if (!e) return 99;
      e.attempts = (e.attempts || 0) + 1;
      if (e.status !== 'refund-pending' && e.status !== 'pushed') { /* stays */ }
      if (e.status === 'pushed') e.status = 'refund-pending';
      this.save(s);
      return e.attempts;
    },
    pendingCreditSpends() {
      return (this.load().creditsSpends || [])
        .filter((e) => e.kind === 'cloud' && e.status === 'pending').map((e) => e.ref);
    },
    pendingCreditRefunds() {
      return (this.load().creditsSpends || [])
        .filter((e) => e.status === 'refund-pending').map((e) => e.ref);
    },
    // Unresolved cloud ops — while any exist we can't trust a bare server pull.
    creditOutstanding() {
      const l = this.load().creditsSpends || [];
      return l.filter((e) => e.status === 'pending' || e.status === 'refund-pending').length;
    },
    // Adopt the server's authoritative budget. Call only when the ledger has
    // no outstanding ops (creditOutstanding() === 0), otherwise local used is
    // ahead of the server by exactly the outstanding count.
    setServerCredits({ used, bonusCredits, unlimited }) {
      const s = this.load();
      if (typeof bonusCredits === 'number' && !Number.isNaN(bonusCredits)) {
        s.bonusCredits = Math.max(0, Math.floor(bonusCredits));
      }
      if (!unlimited && typeof used === 'number' && !Number.isNaN(used)) {
        s.credits.used = Math.max(0, Math.floor(used));
      }
      s.updatedAt = Date.now();
      this.save(s);
      return this.creditsLeft();
    },
    // Resets the ledger after sign-out / demo transitions.
    clearCreditLedger() {
      const s = this.load();
      s.creditsSpends = [];
      this.save(s);
    },
    activate(planId, source, key, expiresAtMs) {
      // Local checkout / checksum unlocks are not entitlements. Paid plans
      // only stick when the cloud registry verified the key.
      if (source !== 'registry') return this.load();
      return this.applyRegistryPlan({ plan: planId, key, expiresAt: expiresAtMs });
    },
    // Adopt an account-bound registry license (plan + key + optional expiry).
    applyRegistryPlan({ plan, key, expiresAt }) {
      const s = this.load();
      s.plan = PLANS.normalizePlan(plan || 'pro');
      s.active = true;
      s.source = 'registry';
      if (key) s.key = key;
      s.planExpiresAt = Number(expiresAt) || null;
      s.trialProUntil = 0;
      s.trialSource = '';
      s.updatedAt = Date.now();
      this.save(s);
      return s;
    },
    downgrade() {
      // deliberately clears earned trial days: switching to Free locks Pro immediately
      const s = this.load();
      s.plan = 'free';
      s.active = true;
      s.source = 'trial';
      s.key = '';
      s.trialProUntil = 0;
      s.trialSource = '';
      s.planExpiresAt = null;
      s.updatedAt = Date.now();
      this.save(s);
      return s;
    },

    // ---------- Referral program ----------
    // Give a friend 30 days of Pro free; earn 7 days yourself when they redeem.
    // This demo is single-account, so redeeming YOUR OWN code simulates the
    // friend side of the loop (+7 to you). Real cross-account credit needs the
    // PallettAI accounts/sync milestone — the data model is ready for it.
    refCode() {
      const s = this.load();
      if (!s.refCode) {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let c = '';
        for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
        s.refCode = 'REF-' + c;
        this.save(s);
      }
      return s.refCode;
    },
    redeem(raw) {
      const code = String(raw || '').trim().toUpperCase();
      if (!/^REF-[A-Z0-9]{4,10}$/.test(code)) {
        return { ok: false, msg: 'That referral code doesn’t look right — codes look like REF-XXXXXX' };
      }
      return {
        ok: false,
        reason: 'signin-required',
        msg: 'Sign in to redeem a referral code — rewards are verified on the registry.'
      };
    },

    // ---------- Cloud registry sync (Supabase Phase 2b) ----------
    // The app pushes these after a successful cloud sync; everything else
    // in this store stays identical, so offline mode keeps working.
    // Adopt the account's stable code (minted at signup, never changes).
    setRefCode(code) {
      const s = this.load();
      if (!code) return;
      if (s.refCode !== code) {
        s.refCode = code;
        s.refSource = 'cloud';
        s.updatedAt = Date.now();
        this.save(s);
      }
    },
    // Apply a server-granted trial expiry (epoch ms). Returns days left.
    applyTrialUntil(untilMs) {
      const s = this.load();
      const t = Number(untilMs) || 0;
      if (t > 0) {
        s.trialProUntil = Math.max(s.trialProUntil || 0, t);
        s.trialSource = 'registry';
        s.updatedAt = Date.now();
        this.save(s);
      }
      return this.trialDaysLeft();
    },
    // Append a stamped record to the redemption history (local mirror of
    // the server trace log). source: 'local' | 'cloud', outcome for attempts.
    logReferral(entry) {
      const s = this.load();
      s.referrals = s.referrals || [];
      s.referrals.unshift({ at: Date.now(), ...entry });
      if (s.referrals.length > 40) s.referrals.length = 40;
      this.save(s);
    }
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = PLANS;
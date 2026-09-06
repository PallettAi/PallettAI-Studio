// ============================================================
// PallettAI Studio — application logic
// ============================================================

const App = (() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const uid = () => Math.random().toString(36).slice(2, 10);
  // platform-aware shortcut label (⌘ on macOS, Ctrl elsewhere)
  const KBD = (typeof window !== 'undefined' && window.pallettai && window.pallettai.platform === 'darwin') ? '⌘' : 'Ctrl+';

  // ---------------- state ----------------
  let projects = [];
  let currentId = null;
  let settings = {};
  let settingsTab = 'account'; // active Settings tab (Settings → tabs)
  let dbTab = 'sections';
  let selectedSec = null;
  let onlineHealth = { checked: false, ok: null };
  let currentView = 'dashboard';
  let lastAI = null;
  let directionState = null;
  let aiBusy = false;
  let qualityBusy = false;
  let qualityAfter = null;
  let qualityTarget = null;
  let accMode = 'signin'; // settings account card: signin | signup
  let bootStoreOK = false; // IndexedDB (AppStore) ready — else localStorage fallback
  let dashPrompt = ''; // prompt staged from the dashboard's AI Studio tile
  let aiStudyController = null;
  let initialized = false;
  let dataVersion = 0;
  let dashBytesCache = { version: -1, value: 0 };
  const projectJsonCache = new Map();

  function serializedProject(project) {
    if (!project || !project.id) return JSON.stringify(project);
    const cached = projectJsonCache.get(project.id);
    if (cached && cached.project === project) return cached.json;
    const json = JSON.stringify(project);
    projectJsonCache.set(project.id, { project, json });
    return json;
  }

  // Keep only low-cardinality runtime diagnostics. Never persist project text,
  // URLs, tokens, or request payloads; this is for local crash recovery only.
  const DIAG_KEY = 'pallettai.diagnostics.v1';
  function recordDiagnostic(kind, error) {
    try {
      const message = String(error && (error.message || error.reason) || error || 'Unknown error').slice(0, 180);
      const row = { kind: String(kind || 'runtime').slice(0, 32), message, at: Date.now() };
      const previous = JSON.parse(localStorage.getItem(DIAG_KEY) || '[]');
      const next = Array.isArray(previous) ? previous.slice(-19) : [];
      next.push(row);
      localStorage.setItem(DIAG_KEY, JSON.stringify(next));
    } catch (e) { /* diagnostics must never affect the application */ }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => recordDiagnostic('error', e.error || e.message));
    window.addEventListener('unhandledrejection', (e) => recordDiagnostic('unhandled-rejection', e.reason));
  }

  const LS = {
    projects: 'pallettai.projects.v1',
    settings: 'pallettai.settings.v1',
    seeded: 'pallettai.seeded.v1',
    revs: 'pallettai.revisions.v1',
    brandPresets: 'pallettai.brandPresets.v1'
  };

  // Projects + autosave revisions live in IndexedDB (AppStore); localStorage
  // is used only for small settings-style keys. Boot hydrates from the store
  // and migrates any leftover localStorage copy on first run.
  async function loadProjects() {
    let raw = null;
    if (bootStoreOK) {
      try { raw = await AppStore.get(LS.projects); }
      catch (e) { bootStoreOK = false; }
    }
    if (raw == null) {
      raw = localStorage.getItem(LS.projects); // legacy / first run
      if (raw != null && bootStoreOK) {
        try { await AppStore.put(LS.projects, raw); localStorage.removeItem(LS.projects); } catch (e) { /* keep the LS copy as fallback */ }
      }
    }
    try {
      const parsed = JSON.parse(raw || '[]');
      projects = Array.isArray(parsed) ? parsed.filter((p) => p && typeof p === 'object') : [];
    } catch (e) { projects = []; }
    try {
      projects.forEach((p) => {
        if (!Array.isArray(p.suites)) p.suites = [];
        if (p.site && !Array.isArray(p.site.sections)) p.site.sections = [];
        Builder.pages(p);
      });
    } catch (e) { /* older / foreign files */ }
  }
  function saveProjects() {
    dataVersion++;
    projectJsonCache.clear();
    // Serialize lazily at flush time — many rapid saves cost one write.
    if (bootStoreOK) {
      AppStore.schedule(LS.projects, () => JSON.stringify(projects));
    } else {
      try {
        localStorage.setItem(LS.projects, JSON.stringify(projects));
      } catch (e) {
        try { toast('⚠ Storage is full — could not save. Export the site (📦) or remove some uploaded photos from newer projects.', false); } catch (e2) { /* too early to toast */ }
        return;
      }
    }
    const el = $('#saveState');
    if (el) {
      el.textContent = 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      el.classList.add('on');
    }
    scheduleRevision(current());
    // an edit/save counts as today's qualifying action for the streak claim
    if (SUPABASE.isConfigured() && SUPABASE.signedIn()) noteStreakAction('edit');
    // Defer a full dashboard rebuild out of the typing/save hot path. The dashboard
    // re-renders on view switch / explicit refresh already; rebuilding it on every
    // autosave is redundant work while the user is deep in the designer.
    scheduleDashboardRefresh();
  }

  // Keep the dashboard current after save bursts without paying for one rebuild per
  // keystroke. This is a cheap coalesce of the refresh that saveProjects() used to
  // trigger immediately on every write.
  let dashboardRefreshTimer = null;
  function scheduleDashboardRefresh() {
    clearTimeout(dashboardRefreshTimer);
    dashboardRefreshTimer = setTimeout(() => {
      dashboardRefreshTimer = null;
      if (currentView === 'dashboard') {
        // Project changes only affect dashboard metrics/activity; keep the
        // template library and import controls mounted during autosave bursts.
        renderDashOverview();
        renderStreakWidget();
      }
    }, 400);
  }

  function loadSettings() {
    try { settings = { ...DB.defaultSettings, ...JSON.parse(localStorage.getItem(LS.settings) || '{}') }; } catch (e) { settings = { ...DB.defaultSettings }; }
    applyTheme();
  }
  function saveSettings() {
    try { localStorage.setItem(LS.settings, JSON.stringify(settings)); }
    catch (e) { try { toast('⚠ Settings could not be saved on this device.', false); } catch (e2) {} }
    applyTheme();
  }
  function applyTheme() {
    document.body.classList.toggle('light', settings.theme === 'light');
    // bespoke session: accent colour, UI density, reduced motion
    document.documentElement.style.setProperty('--accent', settings.accent || DB.defaultSettings.accent);
    document.body.classList.toggle('ui-compact', settings.density === 'compact');
    document.body.classList.toggle('no-motion', settings.reducedMotion === true);
  }

  const current = () => projects.find((p) => p.id === currentId) || null;

  // ---------------- autosave revisions ----------------
  // After every save, a debounced snapshot of the open project is kept in
  // IndexedDB (up to 12 per project, ~2s after you stop editing, generous
  // cross-project budget — no more localStorage quota walls). Restore them
  // from the ⏱ button in the designer toolbar.
  const revTimers = {};
  const REV_BUDGET = 24 * 1024 * 1024; // global cap across all projects
  let revs = {}; // in-memory view — callers read it synchronously
  const BRAND_PRESET_LIMIT = 12;
  let brandPresets = [];
  const brandNumber = (value, fallback, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  function cleanBrandFonts(fonts) {
    return Array.isArray(fonts)
      ? fonts.filter((f) => f && typeof f === 'object' && String(f.name || '').trim()).slice(0, 24).map((f) => ({
          name: String(f.name).trim().slice(0, 100), data: String(f.data || '')
        }))
      : [];
  }
  function cleanBrandPalette(value, id) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const fallback = DB.getPalette(id) || DB.palettes[0];
    const color = (key) => {
      const v = String(value[key] || '').trim();
      return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback[key];
    };
    return {
      id: String(id || value.id || fallback.id).trim().slice(0, 80) || fallback.id,
      name: String(value.name || fallback.name || 'Custom palette').trim().slice(0, 80),
      bg: color('bg'), surface: color('surface'), primary: color('primary'), accent: color('accent'),
      text: color('text'), muted: color('muted'),
      dark: typeof value.dark === 'boolean' ? value.dark : DB.luminance(color('bg')) < 0.5
    };
  }
  function brandFontInfo(source, id) {
    const name = String(id || '');
    const custom = cleanBrandFonts(source && source.customFonts).find((f) => f.name === name);
    return custom || DB.getFont(name) || DB.fonts[0] || { name: 'Inter', id: 'inter' };
  }
  function normalizeBrandPreset(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const p = { ...raw };
    p.id = String(raw.id || uid()).trim().slice(0, 80) || uid();
    p.name = String(raw.name || 'Brand system').trim().slice(0, 60) || 'Brand system';
    p.createdAt = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now();
    p.updatedAt = Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : p.createdAt;
    p.palette = String(raw.palette || 'midnight').trim().slice(0, 80) || 'midnight';
    p.paletteData = cleanBrandPalette(raw.paletteData, p.palette);
    p.font = String(raw.font || 'inter').trim().slice(0, 100) || 'inter';
    p.fontDisplay = String(raw.fontDisplay || '').trim().slice(0, 100);
    p.customFonts = cleanBrandFonts(raw.customFonts);
    p.logo = String(raw.logo || '');
    const d = raw.design && typeof raw.design === 'object' && !Array.isArray(raw.design) ? raw.design : {};
    p.design = {
      containerWidth: brandNumber(d.containerWidth, 1140, 960, 1680),
      radius: brandNumber(d.radius, 20, 0, 48),
      spacing: brandNumber(d.spacing, 96, 32, 220),
      customCss: String(d.customCss || '').slice(0, 16000),
      styleCss: String(d.styleCss || '').slice(0, 16000)
    };
    p.heroLayout = ['centered', 'split', 'minimal'].includes(String(raw.heroLayout)) ? String(raw.heroLayout) : 'centered';
    p.navSticky = raw.navSticky !== false;
    p.navStyle = raw.navStyle === 'transparent' ? 'transparent' : '';
    p.themeToggle = raw.themeToggle !== false;
    p.navCta = String(raw.navCta || '').slice(0, 120);
    p.favicon = String(raw.favicon || '').slice(0, 8);
    p.stylePack = raw.stylePack && typeof raw.stylePack === 'object' && !Array.isArray(raw.stylePack) && raw.stylePack.id
      ? { id: String(raw.stylePack.id).slice(0, 60), name: String(raw.stylePack.name || 'Style pack').slice(0, 80) }
      : null;
    p.seo = raw.seo && typeof raw.seo === 'object' && !Array.isArray(raw.seo) ? {
      metaDescription: String(raw.seo.metaDescription || '').slice(0, 500),
      schemaType: String(raw.seo.schemaType || '').slice(0, 80),
      area: String(raw.seo.area || '').slice(0, 160),
      ogImage: String(raw.seo.ogImage || '').slice(0, 2000)
    } : null;
    return p;
  }
  async function hydrateRevs() {
    let raw = null;
    if (bootStoreOK) {
      try { raw = await AppStore.get(LS.revs); }
      catch (e) { bootStoreOK = false; }
    }
    if (raw == null) {
      raw = localStorage.getItem(LS.revs); // legacy / first run
      if (raw != null && bootStoreOK) {
        try { await AppStore.put(LS.revs, raw); localStorage.removeItem(LS.revs); } catch (e) { /* keep the LS copy */ }
      }
    }
    try { revs = JSON.parse(raw || '{}'); } catch (e) { revs = {}; }
  }
  function loadRevs() { return revs; }
  function persistRevs() {
    if (bootStoreOK) AppStore.schedule(LS.revs, () => JSON.stringify(revs));
    else { try { localStorage.setItem(LS.revs, JSON.stringify(revs)); } catch (e) { /* quota — old behaviour */ } }
  }
  function scheduleRevision(c) {
    if (!c) return;
    if (settings.autosave === false) return; // autosave snapshots disabled in Settings
    clearTimeout(revTimers[c.id]);
    revTimers[c.id] = setTimeout(() => captureRevision(c), settings.autosaveMs || 2000);
  }
  function captureRevision(c) {
    const snap = serializedProject(c);
    if (!c || snap.length > 1200000) return; // skip huge snapshots (inlined fonts etc.)
    const list = (revs[c.id] || []).filter((r) => r && r.snap);
    if (list[0] && list[0].snap === snap) return;
    list.unshift({ t: Date.now(), snap });
    if (list.length > 12) list.length = 12;
    revs[c.id] = list;
    // soft global prune: newest first, generous budget across all projects
    const all = [];
    Object.keys(revs).forEach((id) => revs[id].forEach((r) => all.push({ id, t: r.t, snap: r.snap })));
    all.sort((a, b) => b.t - a.t);
    const kept = {};
    let total = 0;
    all.forEach((r) => {
      if (total + r.snap.length > REV_BUDGET) return;
      total += r.snap.length;
      (kept[r.id] = kept[r.id] || []).push({ t: r.t, snap: r.snap });
    });
    revs = kept;
    dataVersion++;
    persistRevs();
  }
  function clearRevisions(id) {
    clearTimeout(revTimers[id]);
    delete revs[id];
    persistRevs();
  }

  // ---------------- reusable brand presets ----------------
  // Presets are local-first and stored beside projects in IndexedDB when it is
  // available. That keeps logos and uploaded fonts from hitting localStorage's
  // small quota, while the fallback still works in older/browser-only builds.
  async function hydrateBrandPresets() {
    let raw = null;
    if (bootStoreOK) {
      try { raw = await AppStore.get(LS.brandPresets); }
      catch (e) { bootStoreOK = false; }
    }
    if (raw == null) {
      try { raw = localStorage.getItem(LS.brandPresets); } catch (e) { raw = null; }
      if (raw != null && bootStoreOK) {
        try { await AppStore.put(LS.brandPresets, raw); localStorage.removeItem(LS.brandPresets); }
        catch (e) { bootStoreOK = false; }
      }
    }
    try {
      const parsed = JSON.parse(raw || '[]');
      brandPresets = Array.isArray(parsed)
        ? parsed.map(normalizeBrandPreset).filter(Boolean).slice(0, BRAND_PRESET_LIMIT)
        : [];
    } catch (e) { brandPresets = []; }
  }
  function persistBrandPresets() {
    brandPresets = brandPresets.map(normalizeBrandPreset).filter(Boolean).slice(0, BRAND_PRESET_LIMIT);
    if (bootStoreOK) AppStore.schedule(LS.brandPresets, () => JSON.stringify(brandPresets));
    else {
      try { localStorage.setItem(LS.brandPresets, JSON.stringify(brandPresets)); }
      catch (e) { toast('Could not save this brand preset — storage is full.', false); }
    }
  }
  function brandPresetFromProject(c, name, includeSeo) {
    const s = c.site || {};
    const d = s.design || {};
    const palette = DB.getPalette(s.palette) || DB.palettes[0];
    return normalizeBrandPreset({
      id: uid(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      palette: palette.id,
      paletteData: palette ? { ...palette } : null,
      font: s.font || 'inter',
      fontDisplay: s.fontDisplay || '',
      customFonts: cleanBrandFonts(s.customFonts),
      logo: s.logo || '',
      design: {
        containerWidth: brandNumber(d.containerWidth, 1140, 960, 1680),
        radius: brandNumber(d.radius, 20, 0, 48),
        spacing: brandNumber(d.spacing, 96, 32, 220),
        customCss: String(d.customCss || '').slice(0, 16000),
        styleCss: String(d.styleCss || '').slice(0, 16000)
      },
      heroLayout: s.heroLayout || 'centered',
      navSticky: s.navSticky !== false,
      navStyle: s.navStyle || '',
      themeToggle: s.themeToggle !== false,
      navCta: s.navCta || '',
      favicon: s.favicon || '',
      stylePack: s.stylePack && s.stylePack.id ? { id: s.stylePack.id, name: s.stylePack.name } : null,
      // SEO copy is client-specific, so it is opt-in at save time. The site
      // URL is intentionally excluded because it belongs to the destination.
      seo: includeSeo ? {
        metaDescription: s.metaDescription || '',
        schemaType: s.schemaType || '',
        area: s.area || '',
        ogImage: s.ogImage || ''
      } : null
    });
  }
  function ensureBrandPresetPalette(preset) {
    const id = String(preset && preset.palette || '').trim().slice(0, 80);
    if (!id) return DB.palettes[0].id;
    const existing = DB.palettes.find((p) => p.id === id);
    if (existing) return existing.id;
    const data = cleanBrandPalette(preset.paletteData, id);
    if (data) {
      DB.palettes.push(data);
      if (id.indexOf('custom_') === 0) {
        DB.customPalettes = DB.customPalettes || [];
        if (!DB.customPalettes.some((p) => p.id === id)) {
          DB.customPalettes.push(data);
          try { localStorage.setItem('pallettai.customPalettes.v1', JSON.stringify(DB.customPalettes)); } catch (e) { /* non-fatal */ }
        }
      }
      return data.id;
    }
    return DB.palettes[0].id;
  }
  function applyBrandPreset(preset, c) {
    const safe = normalizeBrandPreset(preset);
    if (!safe || !c) return;
    const s = c.site || (c.site = {});
    const d = safe.design || {};
    s.palette = ensureBrandPresetPalette(safe);
    s.font = safe.font || 'inter';
    s.fontDisplay = safe.fontDisplay || '';
    s.customFonts = cleanBrandFonts(safe.customFonts);
    s.logo = safe.logo || '';
    s.design = {
      ...(s.design || {}),
      containerWidth: brandNumber(d.containerWidth, 1140, 960, 1680),
      radius: brandNumber(d.radius, 20, 0, 48),
      spacing: brandNumber(d.spacing, 96, 32, 220),
      customCss: String(d.customCss || '').slice(0, 16000),
      styleCss: String(d.styleCss || '').slice(0, 16000)
    };
    s.heroLayout = safe.heroLayout || 'centered';
    s.navSticky = safe.navSticky !== false;
    s.navStyle = safe.navStyle || '';
    s.themeToggle = safe.themeToggle !== false;
    s.navCta = safe.navCta || '';
    s.favicon = safe.favicon || '';
    if (safe.stylePack) s.stylePack = { ...safe.stylePack };
    else delete s.stylePack;
    if (safe.seo && typeof safe.seo === 'object') {
      s.metaDescription = safe.seo.metaDescription || '';
      s.schemaType = safe.seo.schemaType || '';
      s.area = safe.seo.area || '';
      s.ogImage = safe.seo.ogImage || '';
    }
  }

  // ---------------- plan / subscription ----------------
  const planState = () => PLANS.store.current();
  const isPro = () => PLANS.store.isPro();
  const isProPlus = () => isPro() && PLANS.isProPlus(planState().plan);

  function requirePro() {
    if (isPro()) return true;
    openPricing();
    return false;
  }
  // ---------- AI-credit accounting (Part F Design A) ----------
  // The instant gate stays local (offline-safe), but every cloud spend is
  // mirrored to the registry with an idempotency ref — so a wiped local
  // store, reinstall, or second device all re-sync to the server's budget.
  function cloudSignedIn() {
    return SUPABASE.isConfigured() && SUPABASE.signedIn();
  }
  function spendCredit() {
    const c = PLANS.store.creditsLeft();
    if (c.left === 0) { openPricing(); return false; }
    const ref = PLANS.store.useCredit(cloudSignedIn() ? 'cloud' : 'local');
    // mirror this spend to the registry (fire + forget; offline leaves it pending)
    if (cloudSignedIn() && ref) settleCreditSpend(ref);
    // a real AI generation counts as today's qualifying action for the streak
    if (cloudSignedIn()) noteStreakAction('ai');
    return true;
  }
  const creditFlights = new Map();
  let creditSyncFlight = null;

  // Push one spend to the registry and reconcile when the ledger clears.
  async function settleCreditSpendImpl(ref) {
    let r;
    try { r = await SUPABASE.spendCredit(ref); } catch (e) { return; } // offline → stays pending
    if (!r || !r.ok) return;
    PLANS.store.markCreditPushed(ref); // no-op unless still pending
    // the spend landed but this ref was already refunded locally → refund it now
    if (PLANS.store.creditEntryStatus(ref) === 'refund-pending') { settleCreditRefund(ref); return; }
    if (PLANS.store.creditOutstanding() === 0) PLANS.store.setServerCredits(r);
  }
  function settleCreditSpend(ref) {
    const key = 'spend:' + ref;
    if (creditFlights.has(key)) return creditFlights.get(key);
    const flight = settleCreditSpendImpl(ref)
      .catch((e) => { console.warn('Cloud credit spend settlement failed:', e); })
      .finally(() => creditFlights.delete(key));
    creditFlights.set(key, flight);
    return flight;
  }

  // Return one credit locally; tell the registry when that spend reached it.
  function refundCredit() {
    const got = PLANS.store.refundCredit();
    if (!got || !got.server) return;
    settleCreditRefund(got.ref);
  }
  async function settleCreditRefundImpl(ref) {
    let r;
    try { r = await SUPABASE.refundCredit(ref); } catch (e) {
      PLANS.store.bumpCreditAttempt(ref); // offline → retry on next sync
      return;
    }
    if (!r || !r.ok) { PLANS.store.bumpCreditAttempt(ref); return; }
    if (r.outcome === 'refunded' || r.outcome === 'already-refunded' || r.outcome === 'too-late') {
      PLANS.store.markCreditRefunded(ref);
      if (PLANS.store.creditOutstanding() === 0) PLANS.store.setServerCredits(r);
      return;
    }
    // not-found: the spend may not have landed yet (or never did offline).
    // Give it a few tries across syncs, then accept the local settlement.
    if (PLANS.store.bumpCreditAttempt(ref) > 4) PLANS.store.markCreditRefunded(ref);
  }
  function settleCreditRefund(ref) {
    const key = 'refund:' + ref;
    if (creditFlights.has(key)) return creditFlights.get(key);
    const flight = settleCreditRefundImpl(ref)
      .catch((e) => { console.warn('Cloud credit refund settlement failed:', e); })
      .finally(() => creditFlights.delete(key));
    creditFlights.set(key, flight);
    return flight;
  }

  // Called on every successful sign-in / session restore: flush anything that
  // couldn't reach the registry while offline, then adopt the server budget.
  async function syncCreditOpsImpl() {
    if (!cloudSignedIn()) return;
    // Spends for different refs are independent. Refunds run after all spends
    // so an offline refund can never beat its still-pending spend on the server.
    await Promise.allSettled(PLANS.store.pendingCreditSpends().map(settleCreditSpend));
    await Promise.allSettled(PLANS.store.pendingCreditRefunds().map(settleCreditRefund));
    const st = await SUPABASE.getCreditState();
    if (st && st.ok && PLANS.store.creditOutstanding() === 0) {
      PLANS.store.setServerCredits(st);
    }
  }
  function syncCreditOps() {
    if (!creditSyncFlight) creditSyncFlight = syncCreditOpsImpl().finally(() => { creditSyncFlight = null; });
    return creditSyncFlight;
  }
  function canAddSection() {
    const c = current();
    if (!c) return true;
    if (isPro()) return true;
    const lim = PLANS.getPlan('free').limits.sectionsPerSite;
    if (totalSections(c) >= lim) {
      openPricing();
      toast(`Free plan allows up to ${lim} sections per site — upgrade for unlimited`, false);
      return false;
    }
    return true;
  }
  function renderPlanPill() {
    const p = planState();
    const pill = $('#planPill');
    if (!pill) return;
    const pro = isPro();
    pill.className = 'plan-pill' + (pro ? ' pro' : '');
    const trialD = PLANS.store.trialDaysLeft();
    const plan = PLANS.getPlan(p.plan);
    const label = pro && p.plan === 'free' ? `PRO · ${trialD}d trial` : esc(plan.name.toUpperCase());
    pill.innerHTML = `<span class="pill-dot"></span><span class="pill-txt">${label}</span><span class="pill-x">${pro ? '★' : '▸'}</span>`;
    pill.title = pro && p.plan === 'free' ? 'Pro trial — ' + trialD + ' days left. Earn more with referrals.' : 'Manage plan';
    pill.onclick = openPricing;
    const up = $('#btnUpgrade');
    if (up) up.hidden = pro;
  }
  function refreshEntitlements() {
    renderPlanPill();
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'designer') renderDesigner();
    if (currentView === 'suites') renderSuites();
    if (currentView === 'database') renderDatabase();
    if (currentView === 'settings') renderSettings();
    if (currentView === 'ai') renderAI();
  }
  function exportSettings() {
    return { ...settings, proExport: isPro(), plan: planState().plan };
  }

  // ---------------- undo / redo ----------------
  const undoStack = [];
  const redoStack = [];
  let histLast = 0;
  function histCapture() {
    const c = current();
    if (!c) return;
    const now = Date.now();
    if (now - histLast < 1500) return;
    histLast = now;
    undoStack.push(JSON.stringify(c));
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  }
  function histUndo() {
    const c = current();
    if (!c || !undoStack.length) return toast('Nothing to undo');
    redoStack.push(JSON.stringify(c));
    const prev = JSON.parse(undoStack.pop());
    const idx = projects.findIndex((x) => x.id === prev.id);
    if (idx === -1) return toast('Undo unavailable for this project');
    projects[idx] = prev;
    currentId = prev.id;
    histLast = Date.now();
    saveProjects();
    renderDesigner();
    renderEditor();
    toast('Undone ↩', true);
  }
  function histRedo() {
    const c = current();
    if (!c || !redoStack.length) return toast('Nothing to redo');
    undoStack.push(JSON.stringify(c));
    const next = JSON.parse(redoStack.pop());
    const idx = projects.findIndex((x) => x.id === next.id);
    if (idx === -1) return toast('Redo unavailable');
    projects[idx] = next;
    currentId = next.id;
    histLast = Date.now();
    saveProjects();
    renderDesigner();
    renderEditor();
    toast('Redone ↪', true);
  }

  function histOpen() {
    const c = current();
    if (!c) return toast('Open a project first');
    const list = (loadRevs()[c.id] || []);
    if (!list.length) {
      return openModal('⏱ Autosave history', `
        <p style="color:var(--muted)">No autosaved revisions for “${esc(c.name)}” yet. Snapshots are taken about 2 seconds after you stop editing (up to 12 per project) — and every edit is also covered by <b>Undo</b> (${KBD}Z) while the designer is open.</p>`);
    }
    const fmt = (t) => {
      const d = new Date(t);
      const secs = Math.max(0, (Date.now() - t) / 1000);
      const ago = secs < 60 ? Math.round(secs) + 's ago'
        : secs < 3600 ? Math.floor(secs / 60) + 'm ago'
          : secs < 86400 ? Math.floor(secs / 3600) + 'h ago'
            : Math.floor(secs / 86400) + 'd ago';
      return ago + ' · ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    openModal('⏱ Autosave history — ' + esc(c.name), `
      <p style="color:var(--muted);margin-bottom:12px">Autosaved snapshots of this project. Restoring keeps the current state in Undo (${KBD}Z) so nothing is lost.</p>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:360px;overflow:auto">
        ${list.map((r, i) => {
          let meta = '';
          try { const s = JSON.parse(r.snap); meta = (s.site.sections || []).length + ' sections · ' + (s.suites || []).length + ' suites'; } catch (e) {}
          return `<div class="rev-row"><div><b>${fmt(r.t)}</b><small>${esc(meta)}</small></div><div style="display:flex;gap:6px"><button class="btn ghost small" data-rev-del="${i}">🗑</button><button class="btn primary small" data-rev-use="${i}">Restore</button></div></div>`;
        }).join('')}
      </div>`);
    $$('[data-rev-use]').forEach((b) => b.onclick = () => {
      const rev = list[+b.dataset.revUse];
      if (!rev) return;
      const prev = JSON.parse(rev.snap);
      const pi = projects.findIndex((x) => x.id === c.id);
      if (pi === -1) return closeModal();
      undoStack.push(JSON.stringify(c));
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
      histLast = Date.now();
      prev.updatedAt = Date.now();
      projects[pi] = prev;
      selectedSec = null;
      saveProjects();
      closeModal();
      renderDesigner();
      renderEditor();
      toast('Revision restored ⏱', true);
    });
    $$('[data-rev-del]').forEach((b) => b.onclick = () => {
      const revs = loadRevs();
      if (revs[c.id]) revs[c.id].splice(+b.dataset.revDel, 1);
      persistRevs(revs);
      histOpen();
    });
  }

  async function aiSectionRewrite(sec) {
    const c = current();
    if (!c) return;
    if (!spendCredit()) return;
    const btn = $('#seAi');
    if (btn) { btn.disabled = true; btn.textContent = '✦ Rewriting…'; }
    try {
      const r = await AI.enhanceSection(sec, '', c, settings.onlineEnabled !== false);
      if (!r || !r.applied) {
        refundCredit();
        refreshEntitlements();
        return toast('Nothing to rewrite here yet — add some content first', false);
      }
      touch(c);
      renderEditor();
      refreshEntitlements();
      toast(r.source === 'ai' ? 'Section rewritten by the AI model ✦' : 'Section refreshed by the local engine ✦', true);
    } catch (e) {
      refundCredit();
      refreshEntitlements();
      console.error('AI section rewrite failed', e);
      toast('The section rewrite failed — your credit was refunded. Try again.', false);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✦ AI rewrite this section (1 credit)'; }
    }
  }

  function runDiagnostics() {
    const c = current();
    if (!c) return toast('Open a project first');
    const issues = [];
    const s = c.site;
    const pages = Builder.pages(c);
    const all = [];
    pages.forEach((pg) => (pg.sections || []).forEach((sec) => all.push({ sec, page: pages.length > 1 ? pg : null })));
    if (!s.email && !s.phone) issues.push({ level: 'warn', msg: 'No contact email or phone — visitors can’t reach you from the Contact section.' });
    if (!all.length) issues.push({ level: 'error', msg: 'The site has no sections yet.' });
    const home = pages.find((pg) => pg.slug === 'index') || pages[0];
    if (!(home.sections || []).some((x) => x.type === 'hero')) issues.push({ level: 'warn', msg: 'No hero section on the home page — add one so visitors instantly know what you do.' });
    all.forEach(({ sec, page }) => {
      const t = (DB.sectionTypes[sec.type] || {}).name || sec.type;
      const where = page ? ' [' + esc(page.name) + ' page]' : '';
      if (['features', 'stats', 'about', 'gallery', 'pricing', 'testimonials', 'faq', 'blog', 'shop', 'cta', 'contact', 'logos', 'video', 'countdown', 'booking'].includes(sec.type) && !sec.title) {
        issues.push({ level: 'warn', msg: (t + ' section' + where) + ' has no title.' });
      }
      if (sec.type === 'contact' && !s.address && !s.phone) issues.push({ level: 'info', msg: 'Contact section: no address or phone — adding them builds trust.' });
      if (sec.type === 'countdown' && !sec.extra) issues.push({ level: 'warn', msg: 'Countdown section: set a launch date (extra field).' });
      if (sec.type === 'video' && !sec.extra) issues.push({ level: 'warn', msg: 'Video section: paste a YouTube/Vimeo link in the extra field.' });
      if (sec.type === 'booking') {
        const bookingUrl = String(sec.bookingUrl || sec.extra || '').trim();
        if (!bookingUrl) issues.push({ level: 'warn', msg: 'Booking section: paste a public HTTPS scheduling link in the section editor.' });
        else if (!/^https:\/\//i.test(bookingUrl)) issues.push({ level: 'warn', msg: 'Booking section: the scheduling link must use HTTPS.' });
      }
    });
    if (!(c.suites || []).length) issues.push({ level: 'info', msg: 'No suites installed — the Animation Pack alone adds scroll progress and glow effects.' });
    if (!s.metaDescription) issues.push({ level: 'info', msg: 'No meta description — add one in Design & branding for better SEO.' });
    if (!s.formEndpoint) issues.push({ level: 'info', msg: 'Forms are demo flows — paste a Formspree/Web3Forms endpoint in Design & branding to receive real messages.' });
    const audit = seoAudit(c);
    const gColor = ['A+', 'A', 'B'].includes(audit.letter) ? '#22c55e' : audit.letter === 'C' ? '#eab308' : '#ef4444';
    const ic = (l, fix) => (l === 'error' ? '🔴' : l === 'warn' ? '🟡' : (fix ? '🔵' : '✅'));
    openModal('🩺 Site health check', `
      <p style="color:var(--muted);margin-bottom:14px">${issues.length ? issues.length + ' finding' + (issues.length === 1 ? '' : 's') + ' for “' + esc(s.name) + '”.' : 'No issues found — this site is in great shape. 🎉'}</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${issues.map((i) => `<div class="diag-row diag-${esc(i.level)}">${i.level === 'error' ? '🔴' : i.level === 'warn' ? '🟡' : '🔵'} ${esc(i.msg)}</div>`).join('')}
      </div>
      <h4 style="margin:18px 0 8px;font-size:.9rem">🔍 Launch grade — <span style="color:${gColor};font-weight:800">${esc(audit.letter)} · ${audit.score}/100</span> <small style="color:var(--muted);font-weight:600">SEO · performance · accessibility</small></h4>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${audit.checks.map((i) => `<div class="diag-row diag-${esc(i.level)}"><div>${ic(i.level, i.fix)} ${esc(i.msg)}${i.fix ? `<br><small style="color:var(--muted)">Fix: ${esc(i.fix)}</small>` : ''}</div></div>`).join('')}
      </div>`);
  }

  // ---------------- Publish quality gate ----------------
  // The gate is deliberately deterministic: it runs against the exact project
  // data and exported HTML, so a creator can trust the result offline. Safe
  // repairs are reversible through the normal Designer undo stack.
  function qualityReport(project) {
    const p = project || current();
    if (!p) return null;
    let html = '';
    let htmlPages = [];
    try {
      const built = Builder.buildSitePages(p, exportSettings());
      htmlPages = built.map((entry) => ({
        name: entry.page && entry.page.name ? entry.page.name : 'Untitled',
        slug: entry.page && entry.page.slug ? entry.page.slug : '',
        html: entry.html
      }));
      const home = htmlPages.find((entry) => entry.slug === 'index') || htmlPages[0];
      html = home ? home.html : buildHtml(p);
    } catch (e) {
      try { html = buildHtml(p); } catch (e2) { html = ''; }
    }
    return AI.qualityGate(p, { html, htmlPages });
  }

  function qualityColor(letter) {
    return ['A+', 'A', 'B'].includes(letter) ? '#22c55e' : letter === 'C' ? '#eab308' : '#ef4444';
  }

  function setAIBusy(on) {
    aiBusy = !!on;
    const run = $('#aiRun');
    const directions = $('#aiDirections');
    if (run) run.disabled = aiBusy;
    if (directions) directions.disabled = aiBusy;
  }

  function qualityIcon(level) {
    return level === 'error' ? '🔴' : level === 'warn' ? '🟡' : '🔵';
  }

  function renderQualityGate(audit) {
    const p = qualityTarget || current();
    if (!audit || !p) return;
    const color = qualityColor(audit.letter);
    const issues = audit.issues || [];
    const rows = issues.length
      ? issues.map((issue) => `
        <div class="quality-issue diag-row diag-${esc(issue.level)}">
          <div class="quality-issue-main"><span>${qualityIcon(issue.level)}</span><div><b>${esc(issue.msg)}</b>${issue.fix ? `<small>${esc(issue.fix)}</small>` : ''}</div></div>
          ${issue.safe && issue.level !== 'info' ? '<span class="quality-safe">Safe repair</span>' : ''}
        </div>`).join('')
      : '<div class="quality-clear">✓ No findings — this project is ready to publish.</div>';
    const repairLabel = audit.safeFixes
      ? '🛠 Run ' + audit.safeFixes + ' safe repair' + (audit.safeFixes === 1 ? '' : 's')
      : '🛠 No safe repairs available';
    const afterLabel = qualityAfter ? 'Export site' : 'Export / hand off';
    openModal('🛡 Publish quality gate', `
      <div class="quality-hero">
        <div class="quality-score" style="--quality-color:${color}"><strong>${esc(audit.letter)}</strong><span>${audit.score}/100</span></div>
        <div class="quality-summary"><span class="quality-kicker">${esc(audit.summary)}</span><h4>${esc(p.site.name || 'Untitled site')}</h4><p>Checked SEO, accessibility, content structure, responsive export safety and conversion essentials.</p></div>
      </div>
      <div class="quality-metrics">
        <span><b>${audit.errors}</b> blocking</span><span><b>${audit.warnings}</b> improvements</span><span><b>${audit.safeFixes}</b> safe repairs</span>
      </div>
      <div class="quality-list">${rows}</div>
      <div class="quality-note">Safe repairs only normalize structure, metadata, IDs, alt text and unsafe links — they never rewrite client claims or delete authored content. Your current version remains undoable.</div>
      <div class="quality-actions">
        <button class="btn primary small" id="qualityRepair" ${audit.safeFixes ? '' : 'disabled'}>${repairLabel}</button>
        <button class="btn ghost small" id="qualityReaudit">↻ Run audit again</button>
        ${audit.ready ? `<button class="btn primary small" id="qualityExport">${afterLabel}</button>` : '<button class="btn ghost small" id="qualityExportAnyway">Export anyway</button>'}
      </div>`, true);
    const repair = $('#qualityRepair');
    if (repair) repair.onclick = () => {
      if (qualityBusy || !audit.safeFixes) return;
      qualityBusy = true;
      repair.disabled = true;
      const target = qualityTarget || current();
      const isCurrent = target && current() && target.id === current().id;
      if (isCurrent) histCapture();
      const result = AI.repairQuality(target);
      if (target) {
        target.updatedAt = Date.now();
        if (isCurrent) touch(target); else saveProjects();
      }
      qualityBusy = false;
      if (result.changed) toast(result.changed + ' safe quality repair' + (result.changed === 1 ? '' : 's') + ' applied — checking again…', true);
      else toast('No safe changes were needed');
      renderQualityGate(qualityReport(target));
    };
    const reaudit = $('#qualityReaudit');
    if (reaudit) reaudit.onclick = () => renderQualityGate(qualityReport(qualityTarget || current()));
    const proceed = () => {
      const done = qualityAfter;
      qualityAfter = null;
      qualityTarget = null;
      closeModal();
      if (done) done();
      else openExportMenu({ skipQuality: true });
    };
    const exportBtn = $('#qualityExport');
    if (exportBtn) exportBtn.onclick = proceed;
    const exportAnyway = $('#qualityExportAnyway');
    if (exportAnyway) exportAnyway.onclick = proceed;
  }

  function openQualityGate(after, project) {
    // A toolbar click starts a fresh gate; a repair/re-audit calls the renderer
    // directly so an export callback remains attached through the loop.
    if (arguments.length === 0) qualityAfter = null;
    if (typeof after === 'function') qualityAfter = after;
    qualityTarget = project || current();
    if (!qualityTarget) return toast('Open a project first');
    renderQualityGate(qualityReport(qualityTarget));
  }

  // ---------------- toast / modal ----------------
  let toastTimer = null;
  function toast(msg, ok) {
    const t = $('#appToast');
    t.textContent = msg;
    t.classList.toggle('ok', !!ok);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
  }
  function openModal(title, bodyHTML, wide) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modalBackdrop').querySelector('.modal-card').classList.toggle('wide', !!wide);
    $('#modalBackdrop').scrollTop = 0;
    $('#modalBackdrop').hidden = false;
  }
  function closeModal() {
    // Closing a live Direction Lab cancels the reservation. The async study
    // request may still resolve, but its identity check will discard the draft.
    if (directionState && directionState.busy) {
      directionState.cancelled = true;
      if (directionState.studyController) directionState.studyController.abort();
      refundCredit();
    }
    const cancellingDirection = !!(directionState && directionState.busy);
    directionState = null;
    pickState = null;
    if (cancellingDirection) setAIBusy(false);
    qualityAfter = null;
    qualityTarget = null;
    $('#modalBackdrop').hidden = true;
    // Drop the modal content so stale buttons (and their handlers) can never be
    // re-fired after close — e.g. a stray click on a hidden modal's "create"
    // button used to re-run the whole action, duplicating projects/pages.
    $('#modalBody').innerHTML = '';
  }

  // ---------------- plans / pricing ----------------
  function openPricing() {
    const pro = isPro();
    const body = `
      <div class="pricing-grid">
        ${PLANS.plans.map((p) => {
          const hot = p.popular ? ' hot' : '';
          const cur = planState().plan === p.id;
          const price = p.price === 0
            ? '<div class="pc-price">Free<small> forever</small></div>'
            : `<div class="pc-price">${PLANS.currency.symbol}${p.price}<small>/mo</small></div>`;
          const btn = p.price === 0
            ? (pro ? '<button class="btn ghost small" data-down>Switch to Free</button>' : '<button class="btn ghost small" disabled>Current plan</button>')
            : `<button class="btn ${p.popular ? 'primary' : 'ghost'} small" data-choose="${p.id}">${cur ? '✓ Current plan' : pro ? 'Switch to ' + p.name : 'Choose ' + p.name}</button>`;
          return `
          <div class="price-card${hot}">
            ${p.popular ? '<span class="pc-tag">BEST VALUE</span>' : ''}
            <div class="pc-name">${p.name}</div>
            <div class="pc-tagline">${esc(p.tagline)}</div>
            ${price}
            <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
            ${btn}
          </div>`;
        }).join('')}
      </div>
      ${SUPABASE.isConfigured() && SUPABASE.signedIn()
        ? '<p class="lic-hint" style="color:var(--accent)">☁ Signed in — keys verify against the registry and bind to this account.</p>'
        : ''}
      <div class="lic-row">
        <input id="licKey" placeholder="PAL-PRO-XXXX-XXXX or PAL-PROPLUS-XXXX-XXXX" spellcheck="false" autocomplete="off">
        <button class="btn ghost small" id="licActivate">Activate key</button>
      </div>
      <div class="lic-row">
        <input id="refCodeInput" placeholder="REF-XXXXXX — got a referral code?" spellcheck="false" autocomplete="off">
        <button class="btn ghost small" id="btnRedeemRef">🎁 Redeem free Pro days</button>
      </div>
      <p class="lic-hint">Paste a license key issued by pallettai.org, or redeem a referral code for free Pro days — no card needed. Find your own referral code in Settings.</p>`;
    openModal('Upgrade PallettAI Studio', body, true);
    $$('[data-choose]').forEach((b) => b.onclick = () => checkoutFlow(b.dataset.choose));
    $$('[data-down]').forEach((b) => b.onclick = downgradePlan);
    $('#licActivate').onclick = () => activateLicense($('#licKey').value);
    $('#licKey').onkeydown = (e) => { if (e.key === 'Enter') activateLicense($('#licKey').value); };
    // cloud-aware redemption: verifies against the registry when signed in,
    // falls back to the local demo engine otherwise (see applyReferralCode)
    $('#btnRedeemRef').onclick = () => applyReferralCode($('#refCodeInput').value);
    $('#refCodeInput').onkeydown = (e) => { if (e.key === 'Enter') redeemRef(); };
  }

  function checkoutFlow(planId) {
    const plan = PLANS.getPlan(planId);
    openModal('Checkout — ' + plan.name, `
      <div class="checkout-form">
        <div class="demo-note">Demo checkout — no real payment is processed. In production, wire Stripe (or your provider) here — see the README.</div>
        <div><label>Card number</label><input id="ccNum" value="4242 4242 4242 4242" inputmode="numeric"></div>
        <div class="cf-row">
          <div><label>Expiry</label><input id="ccExp" value="12/29"></div>
          <div><label>CVC</label><input id="ccCvc" value="123"></div>
        </div>
        <div><label>Name on card</label><input id="ccName" value="Pallett AI"></div>
        <div class="checkout-sum"><span>${plan.name} · billed ${plan.period}</span><b>${plan.price ? PLANS.currency.symbol + plan.price + '/mo' : 'Free'}</b></div>
        <button class="btn primary pay-btn" id="payBtn">Pay ${plan.price ? PLANS.currency.symbol + plan.price + ' / month' : ''} →</button>
        <button class="btn ghost small" id="ccBack">← Back to plans</button>
      </div>`, true);
    $('#payBtn').onclick = () => {
      PLANS.store.activate(planId, 'checkout');
      refreshEntitlements();
      openModal('Welcome to ' + plan.name + '! 🎉', `
        <div class="upgrade-ok">
          <div class="big">🎉</div>
          <h3 style="color:var(--text);letter-spacing:0;text-transform:none">You're on ${plan.name}</h3>
          <p style="color:var(--muted)">Every ${plan.name} feature is unlocked. Happy building!</p>
          <button class="btn primary" id="okBtn">Start building</button>
        </div>`);
      $('#okBtn').onclick = closeModal;
      toast('Welcome to ' + plan.name + ' ★', true);
    };
    $('#ccBack').onclick = openPricing;
  }

  // Activate a license key. Signed in → verified against the registry and bound
  // to the account (syncs across devices). Signed out → local checksum demo path.
  async function activateLicense(key) {
    if (SUPABASE.isConfigured() && SUPABASE.signedIn()) {
      const btn = $('#licActivate');
      const old = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
      const r = await SUPABASE.activateLicense(key);
      if (btn) { btn.disabled = false; btn.textContent = old; }
      if (!r.ok) return toast(r.msg, false);
      if (r.outcome === 'verified') {
        PLANS.store.applyRegistryPlan({
          plan: r.plan, key: String(key).trim().toUpperCase(),
          expiresAt: r.expiresAt ? new Date(r.expiresAt).getTime() : null
        });
        closeModal();
        refreshEntitlements();
        toast('License verified on the registry — welcome to ' + PLANS.getPlan(r.plan).name + ' ★', true);
      } else {
        const msgs = {
          'not-found': 'That key isn’t in the registry — check it or buy one at pallettai.org.',
          'in-use': 'That key is already activated on another account.',
          'revoked': 'That key has been revoked.',
          'expired': 'That key has expired.'
        };
        toast(msgs[r.outcome] || 'Key could not be verified.', false);
      }
      return;
    }
    const r = PLANS.validateLicense(key);
    if (!r.ok) return toast('Invalid license key — expected PAL-PRO-XXXX-XXXX or PAL-PROPLUS-XXXX-XXXX', false);
    PLANS.store.activate(r.plan, 'license', r.key);
    closeModal();
    refreshEntitlements();
    toast('License activated — welcome to ' + PLANS.getPlan(r.plan).name + ' ★', true);
  }

  // Redeem a referral code. Signed in → verified against the cloud registry
  // (one stable code per account, stamped trace log, cross-device rewards).
  // Signed out → the honest local demo engine.
  async function applyReferralCode(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^REF-[A-Z0-9]{4,10}$/.test(code)) return toast('That referral code doesn’t look right — codes look like REF-XXXXXX', false);
    if (SUPABASE.isConfigured() && SUPABASE.signedIn()) {
      const btn = $('#btnRedeemRef');
      const old = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
      const r = await SUPABASE.redeem(code);
      if (btn) { btn.disabled = false; btn.textContent = old; }
      if (!r.ok) return toast(r.msg, false);
      if (r.outcome === 'verified') {
        if (r.trialExpiresAt) PLANS.store.applyTrialUntil(new Date(r.trialExpiresAt).getTime());
        PLANS.store.logReferral({ code, kind: 'friend-code', days: r.grantedDays || 30, source: 'cloud', outcome: 'verified' });
        closeModal();
        refreshEntitlements();
        toast('Referral verified on the cloud — +' + (r.grantedDays || 30) + ' days of Pro free 🎉', true);
      } else {
        const msgs = {
          'already-used': 'That code was already redeemed by your account — codes work once per account.',
          'self-redeemed': 'That’s your own referral code — share it with a friend instead!',
          'not-found': 'That code isn’t in the registry — double-check the letters.'
        };
        PLANS.store.logReferral({ code, kind: 'attempt', days: 0, source: 'cloud', outcome: r.outcome });
        toast(msgs[r.outcome] || 'That code could not be verified.', false);
        if (currentView === 'settings') renderSettings();
      }
      return;
    }
    const r = PLANS.store.redeem(code);
    if (!r.ok) return toast(r.msg, false);
    refreshEntitlements();
    toast(r.msg, true);
  }

  // Pull account, credit and streak state independently. A slow or failed
  // profile/license read must not prevent the credit budget or streak from
  // refreshing; each operation has its own bounded Supabase requests.
  async function syncCloud() {
    if (!SUPABASE.isConfigured() || !SUPABASE.signedIn()) return;
    const results = await Promise.allSettled([
      syncCreditOps(),
      SUPABASE.getMyState(),
      hydrateStreak(true)
    ]);
    const creditResult = results[0];
    const accountResult = results[1];
    const streakResult = results[2];
    if (creditResult.status === 'rejected') console.warn('Cloud credit sync failed:', creditResult.reason);

    const st = accountResult.status === 'fulfilled' ? accountResult.value : null;
    if (accountResult.status === 'rejected') console.warn('Cloud account sync failed:', accountResult.reason);
    if (streakResult.status === 'rejected') console.warn('Cloud streak sync failed:', streakResult.reason);
    if (st && st.ok) {
      if (st.code && st.code.code) PLANS.store.setRefCode(st.code.code);
      if (st.profile && st.profile.trial_expires_at) {
        PLANS.store.applyTrialUntil(new Date(st.profile.trial_expires_at).getTime());
      }
      // account-bound license → plan follows the account across devices
      if (st.license && st.license.code) {
        PLANS.store.applyRegistryPlan({
          plan: st.license.plan || 'pro', key: st.license.code,
          expiresAt: st.license.expires_at ? new Date(st.license.expires_at).getTime() : null
        });
      }
      if (st.partial) console.warn('Cloud account sync completed partially:', st.warnings);
    }
    refreshEntitlements();
  }

  function downgradePlan() {
    openModal('Switch to the Free plan?', `
      <p style="color:var(--muted)">You'll keep your projects and exported sites, but AI Studio credits, Pro templates, Pro suites and unbranded exports will lock again.</p>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn danger small" id="modalDownYes">Switch to Free</button>
        <button class="btn ghost small" id="modalDownNo">Keep my plan</button>
      </div>`);
    $('#modalDownYes').onclick = () => {
      PLANS.store.downgrade();
      closeModal();
      refreshEntitlements();
      toast('Switched to the Free plan');
    };
    $('#modalDownNo').onclick = closeModal;
  }

  // ---------------- navigation ----------------
  function switchView(name) {
    if (name !== 'ai' && aiStudyController) {
      aiStudyController.abort();
      aiStudyController = null;
    }
    currentView = name;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach((v) => v.classList.remove('active'));
    $('#view-' + name).classList.add('active');
    const titles = { dashboard: 'Dashboard', designer: 'Designer', ai: 'AI Studio', suites: 'Upgrade Suites', database: 'Database', settings: 'Settings' };
    $('#viewTitle').textContent = titles[name] || name;
    if (name === 'dashboard') renderDashboard();
    if (name === 'designer') renderDesigner();
    if (name === 'ai') renderAI();
    if (name === 'suites') renderSuites();
    if (name === 'database') renderDatabase();
    if (name === 'settings') renderSettings();
    $('#projectChip').hidden = !(name === 'designer' || name === 'suites' || name === 'database') || !current();
    if (current() && ['designer', 'suites', 'database'].includes(name)) {
      $('#projectChip').textContent = '◆ ' + current().name;
    }
    if (name !== 'designer') chatOpenPanel(false);
    $('#topbarActions').innerHTML = '';
    if (name === 'designer') {
      const c = current();
      if (c) {
        $('#topbarActions').innerHTML = `
          <button class="btn ghost small" id="btnUndo" title="Undo (${KBD}Z)">↩</button>
          <button class="btn ghost small" id="btnRedo" title="Redo (${KBD}Shift+Z)">↪</button>
          <button class="btn ghost small" id="btnHistory" title="Autosave history — restore an earlier version">⏱</button>
          <button class="btn ghost small" id="btnChat" title="✦ Copilot — edit this site in plain English">✦ Copilot</button>
          <button class="btn ghost small" id="btnPacks" title="One-click AI style packs">🎨 Styles</button>
          <button class="btn ghost small" id="btnBrandPresets" title="Save and reuse your visual identity across projects">✦ Brand presets</button>
          <button class="btn ghost small" id="btnDiag" title="Site health check">🩺</button>
          <button class="btn ghost small" id="btnQuality" title="Publish quality gate — audit and safely repair this site">🛡</button>
          <button class="btn ghost small" id="btnCopyHtml" title="Copy the current page as HTML">📋 Copy code</button>
          <button class="btn ghost small" id="btnHandoff" title="Client handoff ZIP — site + guide + brand kit">🎁 Handoff</button>
          <button class="btn ghost small" id="btnPublish" title="Publish online for a live link">🌐 Publish</button>
          <button class="btn primary small" id="btnExport">⬇ Export site</button>
          <button class="btn ghost small" id="btnCloseProject">✕ Close</button>`;
        $('#btnUndo').onclick = histUndo;
        $('#btnRedo').onclick = histRedo;
        $('#btnHistory').onclick = histOpen;
        $('#btnChat').onclick = chatToggle;
        $('#btnPacks').onclick = openPacks;
        $('#btnBrandPresets').onclick = openBrandPresets;
        $('#btnDiag').onclick = runDiagnostics;
        $('#btnQuality').onclick = () => openQualityGate();
        $('#btnExport').onclick = openExportMenu;
        $('#btnCopyHtml').onclick = copyHtml;
        $('#btnHandoff').onclick = openHandoff;
        $('#btnPublish').onclick = openPublish;
        $('#btnCloseProject').onclick = () => { currentId = null; switchView('dashboard'); };
        if (chatState.open) chatOpenPanel(true);
      }
    }
  }

  // ---------------- daily streak + Day-7 wheel ----------------
  // Registry-only rewards (schema.sql §11-18): the server owns the UTC day,
  // the one-claim-per-day cap and the wheel outcome. The client hydrates the
  // state, gates the claim button behind one real action today (a behavioural
  // nudge — the server cap is the actual enforcement) and animates the wheel
  // to land on the segment the server already picked.
  const STREAK = {
    key: 'pallettai.streak.v1',
    actKey: 'pallettai.streak.action.v1',
    cache: null,
    lastFetch: 0,
    lastErr: null
  };
  // 12 segments, drawn & documented in the same order as schema.sql §17.
  const WHEEL_SEGS = [
    ['credits', 3], ['credits', 5], ['credits', 10], ['pro_hours', 3], ['pro_hours', 3],
    ['pro_hours', 12], ['pro_hours', 24], ['pro_hours', 72], ['shield', 0],
    ['pro_hours', 168], ['credits', 5], ['credits', 3]
  ];

  function dayPrize(d) {
    return d === 7 ? { type: 'wheel' } : { type: 'credits', amount: d + 1 };
  }
  function prizeNice(p) {
    if (!p) return '';
    if (p.type === 'credits') return '+' + p.amount + ' bonus AI credit' + (p.amount === 1 ? '' : 's');
    if (p.type === 'pro_hours') {
      const h = p.amount;
      if (h < 24) return h + (h === 1 ? ' hour' : ' hours') + ' of Pro free';
      const d = h / 24;
      return (d === 1 ? '1 day' : d + ' days') + ' of Pro free';
    }
    if (p.type === 'shield') return 'A streak shield ⛨';
    return 'Something good!';
  }

  // the day's last meaningful action (one edit / save / AI generation)
  function actionKindToday() {
    try {
      const a = JSON.parse(localStorage.getItem(STREAK.actKey) || 'null');
      return (a && a.d === new Date().toDateString()) ? (a.k || 'edit') : null;
    } catch (e) { return null; }
  }
  function noteStreakAction(kind) {
    if (!SUPABASE.isConfigured() || !SUPABASE.signedIn()) return;
    try { localStorage.setItem(STREAK.actKey, JSON.stringify({ d: new Date().toDateString(), k: kind || 'edit' })); } catch (e) { return; }
    if (currentView === 'dashboard') renderStreakWidget(); // unlocks the claim button now
  }

  function adoptStreakState(r) {
    if (!r || !r.ok) return;
    STREAK.cache = r;
    STREAK.lastFetch = Date.now();
    PLANS.store.setBonusCredits(r.bonusCredits || 0);
  }
  function clearStreakLocal() {
    STREAK.cache = null;
    STREAK.lastFetch = 0;
    STREAK.lastErr = null;
    PLANS.store.setBonusCredits(0);
    try { localStorage.removeItem(STREAK.actKey); } catch (e) {}
  }
  async function hydrateStreak(force) {
    if (!SUPABASE.isConfigured() || !SUPABASE.signedIn()) { renderStreakWidget(); return; }
    if (!force && STREAK.cache && STREAK.cache.ok && Date.now() - STREAK.lastFetch < 45000) { renderStreakWidget(); return; }
    const r = await SUPABASE.getStreakState();
    STREAK.lastErr = (r && r.ok) ? null : (r && r.msg ? r.msg : 'Can’t reach the registry right now.');
    if (r && r.ok) adoptStreakState(r);
    renderStreakWidget();
  }

  function renderStreakWidget() {
    const root = $('#streakRoot');
    if (!root) return;
    const signedIn = SUPABASE.isConfigured() && SUPABASE.signedIn();
    if (!signedIn) {
      root.innerHTML = `
        <div class="streak-card">
          <div class="streak-head">
            <span class="streak-ico">🔥</span>
            <div class="streak-titles">
              <b>Daily streak</b>
              <span class="streak-sub">Earn free AI credits every day you build — and a Day-7 prize wheel. Claims are verified on the cloud registry.</span>
            </div>
          </div>
          <button class="btn primary small" id="streakGoSettings">Start your streak — sign in</button>
        </div>`;
      const b = $('#streakGoSettings');
      if (b) b.onclick = () => { settingsTab = 'account'; switchView('settings'); };
      return;
    }
    const st = STREAK.cache;
    if (!st || !st.ok) {
      root.innerHTML = `
        <div class="streak-card">
          <div class="streak-head">
            <span class="streak-ico">☁</span>
            <div class="streak-titles">
              <b>Daily streak</b>
              <span class="streak-sub">${STREAK.lastErr ? esc(STREAK.lastErr) + ' Your streak is safe on the registry.' : 'Syncing your streak from the cloud registry…'}</span>
            </div>
          </div>
        </div>`;
      return;
    }
    const claimed = !!st.claimedToday;
    const streak = st.streak || 0;
    const best = st.best || 0;
    const shields = st.shields || 0;
    const wheelPending = !!st.wheelPending;
    const restarting = !!st.restarting && !claimed;
    let filled = 0;
    if (claimed) filled = st.cycleDay || 1;
    else if (streak > 0 && !restarting) filled = ((streak - 1) % 7) + 1;
    const nextD = restarting ? 1 : (st.nextCycle || 1);
    const actionKind = actionKindToday();
    const day7 = nextD === 7;
    const claimBtn = claimed
      ? ''
      : `<button class="btn primary small streak-claim" id="streakClaimBtn" ${actionKind ? '' : 'disabled'} title="${actionKind ? 'Claim your bonus' : 'Make one edit or run one AI generation first — claims celebrate building'}">
           ${day7 ? '🎡 Complete Day 7 — unlock the wheel' : (actionKind ? 'Claim Day ' + nextD + ' → ' + prizeNice(st.nextPrize) : 'Build today to claim ' + prizeNice(st.nextPrize))}
         </button>`;
    const spinBtn = wheelPending
      ? `<button class="btn primary small streak-spin" id="streakSpinBtn">🎡 Spin the Day-7 wheel${claimed ? ' — it’s ready!' : ''}</button>`
      : '';
    let sub = '';
    if (claimed) {
      const todayPrize = dayPrize(st.cycleDay || 1);
      sub = wheelPending
        ? 'Day ' + st.cycleDay + ' claimed — your wheel is waiting below! 🎡'
        : st.cycleDay === 7
          ? 'Week complete — Day 7 claimed. Back tomorrow for Day 1.'
          : 'Day ' + st.cycleDay + ' claimed · ' + prizeNice(todayPrize) + '. Back tomorrow for Day ' + ((st.cycleDay % 7) + 1) + '.';
    } else if (restarting) {
      sub = 'Your streak was broken — claim Day 1 and start a new one.';
    } else if (st.freezeNext) {
      sub = '⛨ A shield will keep your streak alive today — claim Day ' + nextD + '.';
    } else {
      sub = (streak === 0 ? 'Claim your first Day-1 bonus today.' : (day7 ? 'One more day to the wheel — complete Day 7.' : 'Claim Day ' + nextD + ' for ' + prizeNice(st.nextPrize) + ' tomorrow keeps the streak alive.'));
    }
    if (st.frozenToday && !claimed) sub = '⛨ A shield covered your missed day — your streak is intact.';
    const chips = [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const on = d <= filled;
      const now = !claimed && d === nextD && !restarting;
      const p = dayPrize(d);
      const tip = 'Day ' + d + ': ' + (p.type === 'wheel' ? 'prize wheel 🎡 + streak shield' : prizeNice(p));
      return `<span class="sk-chip ${on ? 'on' : ''} ${now ? 'now' : ''} ${d === 7 ? 'big' : ''}" title="${esc(tip)}">${d === 7 ? '🎡' : (p.type === 'credits' ? '+' + p.amount : '')}</span>`;
    }).join('');
    root.innerHTML = `
      <div class="streak-card">
        <div class="streak-head">
          <span class="streak-ico">${claimed ? '✅' : '🔥'}</span>
          <div class="streak-titles">
            <b>Daily streak</b>
            <span class="streak-sub">${esc(sub)}</span>
          </div>
          <div class="streak-meta">
            ${shields ? `<span class="streak-shield" title="Streak shields protect your streak for one missed day (max 2).">⛨ ${shields}</span>` : ''}
            ${streak ? `<span class="streak-best" title="Longest streak">🔥 ${streak}${best !== streak ? ' · best ' + best : ''}</span>` : ''}
          </div>
        </div>
        <div class="streak-row">
          <div class="streak-chips">${chips}</div>
          <div class="streak-cta">${spinBtn || claimBtn}</div>
        </div>
      </div>`;
    const cb = $('#streakClaimBtn');
    if (cb && !cb.disabled) cb.onclick = claimStreakNow;
    const sb = $('#streakSpinBtn');
    if (sb) sb.onclick = openWheelModal;
  }

  async function claimStreakNow() {
    const st = STREAK.cache;
    if (!st || st.claimedToday) return;
    const btn = $('#streakClaimBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Claiming…'; }
    const r = await SUPABASE.claimDailyReward(actionKindToday() || 'edit');
    if (!r || !r.ok) {
      if (btn) { btn.disabled = false; }
      return toast(r ? r.msg : 'Could not reach the registry.', false);
    }
    adoptStreakState(r);
    refreshEntitlements();
    renderStreakWidget();
    const c = r.claim || {};
    const parts = [];
    if (c.shieldUsed) parts.push('⛨ A shield kept your streak alive');
    if (c.prizeType === 'credits') parts.push('+' + c.prizeAmount + ' bonus AI credits');
    if (c.prizeType === 'wheel') {
      parts.push('Day 7 complete — wheel unlocked! 🎡');
      if (c.shieldGranted) parts.push('+1 streak shield ⛨');
    }
    toast(parts.join(' — ') || 'Streak claimed ✓', true);
    if (c.prizeType === 'wheel') setTimeout(openWheelModal, 500);
  }

  // ---------- the wheel ----------
  function drawWheel() {
    const cv = $('#wheelCanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const R = 285, cx = 300, cy = 300, n = WHEEL_SEGS.length;
    ctx.clearRect(0, 0, 600, 600);
    const hueOf = (seg) => {
      if (seg[0] === 'credits') return 158;
      if (seg[0] === 'shield') return 214;
      if (seg[1] === 168) return 43;   // jackpot
      return 258;                      // pro hours
    };
    const labelOf = (seg) => {
      if (seg[0] === 'shield') return '⛨';
      if (seg[1] === 168) return '7d★';
      if (seg[1] === 3) return '3h';
      if (seg[1] === 12) return '12h';
      if (seg[1] === 24) return '1d';
      if (seg[1] === 72) return '3d';
      return '+' + seg[1];
    };
    for (let i = 0; i < n; i++) {
      const a0 = (-90 + i * (360 / n)) * Math.PI / 180;
      const a1 = (-90 + (i + 1) * (360 / n)) * Math.PI / 180;
      const seg = WHEEL_SEGS[i];
      const h = hueOf(seg);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = (seg[1] === 168) ? 'hsl(43,90%,52%)' : (i % 2 ? 'hsl(' + h + ',70%,' + (seg[0] === 'shield' ? 60 : 52) + '%)' : 'hsl(' + h + ',65%,' + (seg[0] === 'shield' ? 52 : 44) + '%)');
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.28)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((a0 + a1) / 2);
      ctx.fillStyle = '#fff';
      ctx.font = '800 26px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.4)';
      ctx.shadowBlur = 4;
      ctx.fillText(labelOf(seg), R * 0.62, 0);
      ctx.restore();
    }
    // centre dot
    ctx.beginPath();
    ctx.arc(cx, cy, 40, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 32, 0, Math.PI * 2);
    ctx.fillStyle = 'var(--grad, linear-gradient(135deg,#7c5cff,#22d3ee))';
    ctx.fill();
  }
  function segIndexForPrize(p) {
    const i = WHEEL_SEGS.findIndex((s) => s[0] === p.type && s[1] === (p.amount || 0));
    return i === -1 ? 0 : i;
  }
  function burstConfetti() {
    const zone = $('#wheelConfetti');
    if (!zone) return;
    const cols = ['#7c5cff', '#22d3ee', '#f59e0b', '#34d399', '#f43f5e', '#fff'];
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('i');
      s.className = 'confetti';
      s.style.left = (8 + Math.random() * 84) + '%';
      s.style.background = cols[i % cols.length];
      s.style.animationDelay = (Math.random() * .5) + 's';
      s.style.animationDuration = (.9 + Math.random() * .8) + 's';
      s.style.transform = 'rotate(' + Math.floor(Math.random() * 360) + 'deg)';
      zone.appendChild(s);
    }
    setTimeout(() => { try { zone.innerHTML = ''; } catch (e) {} }, 2600);
  }
  function wheelReveal(p) {
    const res = $('#wheelResult');
    const btn = $('#wheelSpinBtn');
    if (btn) btn.hidden = true;
    if (!res) return;
    const jackpot = p.type === 'pro_hours' && p.amount === 168;
    res.hidden = false;
    res.className = 'wheel-result show' + (jackpot ? ' jackpot' : '');
    res.innerHTML = `
      <div class="wr-emoji">${jackpot ? '👑' : (p.type === 'credits' ? '✨' : p.type === 'shield' ? '⛨' : '⏱')}</div>
      <div class="wr-title">${jackpot ? 'JACKPOT!' : 'You won'}</div>
      <div class="wr-prize">${prizeNice(p)}</div>
      <div class="wr-sub">${p.type === 'pro_hours' ? 'It’s already active — every Pro feature is unlocked while it lasts.' : p.type === 'shield' ? 'Shields keep your streak alive through one missed day (max 2).' : 'Added to your AI credit balance — spendable on AI Studio, styles & Copilot.'}</div>
      <button class="btn primary" id="wheelDone">Awesome ✨</button>`;
    const done = $('#wheelDone');
    if (done) done.onclick = closeModal;
    burstConfetti();
  }
  function openWheelModal() {
    const st = STREAK.cache;
    if (!st || !st.wheelPending) return;
    openModal('Day 7 complete — spin the wheel 🎡', `
      <div class="wheel-stage">
        <div class="confetti-zone" id="wheelConfetti"></div>
        <div class="wheel-box">
          <span class="wheel-needle"></span>
          <canvas id="wheelCanvas" width="600" height="600"></canvas>
        </div>
        <button class="btn primary wheel-go" id="wheelSpinBtn">Spin the wheel</button>
        <div id="wheelResult" class="wheel-result" hidden></div>
      </div>
      <div class="wheel-odds">
        <div class="wo-title">Every segment wins — one outcome is picked on the registry server (no re-rolls).</div>
        <div class="wo-list">
          <span>✨ +3 credits ×2</span><span>✨ +5 credits ×2</span><span>✨ +10 credits ×1</span>
          <span>⏱ 3h Pro ×2</span><span>⏱ 12h Pro ×1</span><span>⏱ 1 day Pro ×1</span><span>⏱ 3 days Pro ×1</span>
          <span>⛨ Streak shield ×1</span><span>👑 7 days Pro ×1</span>
        </div>
      </div>`, true);
    drawWheel();
    $('#wheelSpinBtn').onclick = spinWheelNow;
  }
  async function spinWheelNow() {
    const btn = $('#wheelSpinBtn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Picking your prize…';
    const r = await SUPABASE.spinWheel();
    if (!r || !r.ok || r.outcome !== 'spun') {
      btn.disabled = false;
      btn.textContent = 'Spin the wheel';
      if (r && r.outcome === 'not-ready') toast('No wheel to spin right now — complete a Day 7 first.', false);
      else toast(r ? r.msg : 'Could not reach the registry.', false);
      return;
    }
    adoptStreakState(r);
    if (r.trialExpiresAt) PLANS.store.applyTrialUntil(new Date(r.trialExpiresAt).getTime());
    refreshEntitlements();
    const p = r.prize || {};
    const idx = segIndexForPrize(p);
    const cv = $('#wheelCanvas');
    if (cv) {
      const fast = document.body.classList.contains('no-motion');
      const dur = fast ? 40 : 4300;
      const finalDeg = 2145 - idx * 30; // lands segment centre under the needle
      cv.style.transition = 'transform ' + dur + 'ms cubic-bezier(.12,.8,.16,1)';
      cv.style.transform = 'rotate(' + finalDeg + 'deg)';
      setTimeout(() => { try { wheelReveal(p); } catch (e) { toast(prizeNice(p) + ' 🎉', true); } }, dur + (fast ? 60 : 350));
    } else {
      wheelReveal(p);
    }
  }

  // ---------------- dashboard ----------------
  // Redesigned live overview band. Every figure comes from real state —
  // projects, credit budget, streak cache, local byte counts and the AI
  // credit ledger — never mocked. Skipped while another view is active
  // (renderDashboard also fires on saves); rebuilt on every Dashboard render.
  const DASH_AI_STATES = ['local', 'pending', 'pushed']; // a generation that was spent & not refunded
  function dashBytes() {
    if (dashBytesCache.version === dataVersion) return dashBytesCache.value;
    try {
      // Reuse the per-project snapshot generated by autosave/history where
      // possible. This avoids walking photo-heavy projects a second time just
      // to display the local-storage metric.
      const p = projects.reduce((total, project) => total + serializedProject(project).length, 2) + Math.max(0, projects.length - 1);
      const r = Object.keys(revs).reduce((t, id) => t + (revs[id] || []).reduce((a, v) => a + (v.snap ? v.snap.length : 0), 0), 0);
      dashBytesCache = { version: dataVersion, value: p + r };
      return dashBytesCache.value;
    } catch (e) { return 0; }
  }
  function dashFmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }
  function relWhen(ts) {
    const d = Date.now() - ts;
    if (d < 60e3) return 'just now';
    if (d < 3600e3) return Math.floor(d / 60e3) + 'm ago';
    if (d < 86400e3) return Math.floor(d / 3600e3) + 'h ago';
    const days = Math.floor(d / 86400e3);
    if (days < 7) return days === 1 ? 'yesterday' : days + 'd ago';
    return new Date(ts).toLocaleDateString();
  }
  function renderCoreTools() {
    const root = $('#coreTools');
    if (!root) return;
    const now = Date.now();
    const weekAgo = now - 7 * 864e5;
    const editedWeek = projects.filter((p) => Number(p.updatedAt) >= weekAgo).length;
    const projectRatio = projects.length ? Math.min(100, Math.round((editedWeek / projects.length) * 100)) : 0;
    const cred = PLANS.store.creditsLeft();
    const sub = PLANS.store.load();
    const generationCount = (sub.creditsSpends || []).filter((e) => DASH_AI_STATES.includes(e.status)).length;
    const availableIntegrations = (DB.integrations || []).filter((item) => !item.tier || isPro()).length;
    const currentProject = current();
    const activityDays = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(now - i * 864e5);
      const key = day.toDateString();
      const n = projects.filter((p) => new Date(Number(p.updatedAt) || 0).toDateString() === key).length;
      activityDays.push({ day, n });
    }
    const activityMax = Math.max(1, ...activityDays.map((d) => d.n));
    const activityPoints = activityDays.map((d, i) => {
      const x = 12 + (i * 263 / 6);
      const y = 84 - ((d.n / activityMax) * 60);
      return [Math.round(x), Math.round(y)];
    });
    const activityPath = activityPoints.map((point, i) => (i ? 'L' : 'M') + point[0] + ' ' + point[1]).join(' ');
    const activityFill = activityPath + ' L275 92 L12 92 Z';
    const swatches = ['#a855f7', '#7c3aed', '#c084fc', '#4c1d95', '#d8b4fe', '#6d28d9', '#9333ea', '#2e1065'];
    const svg = (content, cls) => `<svg class="tool-svg ${cls || ''}" viewBox="0 0 320 100" aria-hidden="true">${content}</svg>`;
    const card = (cls, icon, title, desc, body, action) => `
      <article class="core-tool ${cls}">
        <div class="tool-head">
          <span class="tool-icon">${icon}</span>
          <div><h3>${title}</h3><p>${desc}</p></div>
          <span class="tool-more" aria-hidden="true">···</span>
        </div>
        <div class="tool-body">${body}</div>
        ${action ? `<button class="tool-action" data-tool-action="${action.key}">${action.label}<span>↗</span></button>` : ''}
      </article>`;
    const aiBody = `<div class="tool-prompt-row"><span class="prompt-caret">›</span><input id="coreAiPrompt" value="${esc(dashPrompt)}" placeholder="Describe a site to create…" autocomplete="off"></div>
      <div class="tool-ai-preview"><div class="mini-site"><span></span><b></b><i></i><em></em></div><div class="mini-site-lines"><span></span><span></span><span></span></div></div>
      <div class="tool-foot"><span class="tool-credit"><b>✦</b> ${isPro() ? 'Unlimited AI credits' : esc(String(cred.left)) + ' AI credit' + (cred.left === 1 ? '' : 's') + ' left'}</span><button class="tool-generate" id="coreAiGenerate">Generate</button></div>`;
    const designerBody = `<div class="designer-mini"><div class="swatch-grid">${swatches.map((s) => `<i style="background:${s}"></i>`).join('')}</div><div class="wire-grid"><span class="wire-label">Drag-and-drop wires</span><i></i><i></i><i></i><b></b></div></div><div class="tool-summary"><span>Style guide</span><b>${currentProject ? esc((DB.getPalette(currentProject.site.palette) || {}).name || 'Midnight Violet') : 'Midnight Violet'}</b></div>`;
    const teamBody = `<div class="team-status"><div class="avatar-stack"><span>YOU</span></div><span class="presence-dot"></span><b>${cloudSignedIn() ? 'Cloud account connected' : 'Local workspace'}</b></div><ul class="task-list">${projects.length ? projects.slice(0, 3).map((p) => `<li><span></span>${esc(p.name)} · ${relWhen(Number(p.updatedAt) || now)}</li>`).join('') : '<li><span></span>No projects yet — your workspace is clear</li>'}</ul><div class="presence-graph">${activityDays.map((d) => `<i style="height:${Math.max(10, Math.round((d.n / activityMax) * 100))}%" title="${d.n} project update${d.n === 1 ? '' : 's'}"></i>`).join('')}</div><small class="tool-note">${projects.length ? 'Recent project activity on this device.' : 'Create a project to start your activity timeline.'}</small>`;
    const databaseBody = `<div class="db-toggle" id="coreDbToggle"><span class="active" data-db-mode="sql">SQL</span><span data-db-mode="nosql">NoSQL</span></div>${svg('<path d="M55 50H142M178 50h87M160 35V18M160 65v17"/><circle cx="45" cy="50" r="13"/><circle cx="160" cy="50" r="18"/><circle cx="275" cy="50" r="13"/><circle cx="160" cy="15" r="9"/><circle cx="160" cy="85" r="9"/>', 'relationship-svg')}<div class="db-health" id="coreDbHealth"><span>IndexedDB · ${projects.length} record${projects.length === 1 ? '' : 's'}</span><b>Ready</b></div>`;
    const integrationNames = ['Maps', 'Weather', 'Embeds', 'Booking', 'Avatars', 'Chat', 'Crypto'];
    const integrationIcons = ['⌖', '☼', '↗', '▣', '✦', '•••', '₿'];
    const integrationBody = `<div class="integration-grid">${integrationNames.map((name, i) => { const available = i < availableIntegrations; return `<div class="integration-chip"><span class="integration-mark mark-${i}">${integrationIcons[i]}</span><b>${name}</b><i class="${available ? 'available' : 'locked'}" title="${available ? 'Available in this plan' : 'Pro plan required'}"></i></div>`; }).join('')}</div><div class="integration-status"><span class="status-dot"></span>${availableIntegrations} of ${DB.integrations.length} services available · keyless-ready</div>`;
    const analyticsBody = `${svg('<path class="graph-fill" d="' + activityFill + '"/><path class="graph-line" d="' + activityPath + '"/>', 'growth-svg')}<div class="analytics-metrics"><div class="velocity-gauge" style="--velocity:${projectRatio}%"><span>${projectRatio}%</span><small>Velocity</small></div><div><b>${editedWeek}</b><span>projects active this week</span><b>${generationCount}</b><span>AI generations tracked</span></div></div>`;
    root.innerHTML = `<div class="core-tools-heading"><div><span class="eyebrow">CORE TOOLS</span><h2>Everything you need to ship.</h2></div><span class="core-tools-meta">Live workspace overview</span></div><div class="core-tools-grid">
      ${card('tool-ai', '✦', 'AI Studio Creator', 'Prompt-based website & asset builder.', aiBody, { key: 'ai', label: 'Open AI Studio' })}
      ${card('tool-designer', '⌘', 'Project Designer', 'Visual editor for layout, colors, and components.', designerBody, { key: 'designer', label: 'Open Designer' })}
      ${card('tool-team', '♧', 'Team Collaboration Hub', 'Keep your tasks and workspace presence in view.', teamBody, { key: 'settings', label: 'Workspace settings' })}
      ${card('tool-database', '◉', 'Database Manager', 'Connect and manage data, palettes, and relationships.', databaseBody, { key: 'database', label: 'Open Database' })}
      ${card('tool-integrations', '↗', 'Integration Hub', 'Connect third-party apps and APIs.', integrationBody, { key: 'integrations', label: 'Explore integrations' })}
      ${card('tool-analytics', '⌁', 'Analytics Engine', 'Track real project activity and AI usage.', analyticsBody, null)}
    </div>`;
    const prompt = $('#coreAiPrompt');
    if (prompt) prompt.addEventListener('input', () => { dashPrompt = prompt.value; });
    const generate = $('#coreAiGenerate');
    if (generate) generate.onclick = () => { dashPrompt = (prompt && prompt.value || '').trim(); switchView('ai'); const aiPrompt = $('#aiPrompt'); if (aiPrompt && dashPrompt) aiPrompt.value = dashPrompt; };
    $$('#coreDbToggle [data-db-mode]').forEach((tab) => tab.onclick = () => {
      $$('#coreDbToggle [data-db-mode]').forEach((x) => x.classList.toggle('active', x === tab));
      const health = $('#coreDbHealth');
      if (health) health.innerHTML = `<span>${tab.dataset.dbMode === 'sql' ? 'SQL view · ' + projects.length + ' project record' + (projects.length === 1 ? '' : 's') : 'NoSQL view · ' + projects.length + ' project document' + (projects.length === 1 ? '' : 's')}</span><b>Ready</b>`;
    });
    $$('#coreTools [data-tool-action]').forEach((button) => button.onclick = () => {
      const action = button.dataset.toolAction;
      if (action === 'integrations') { dbTab = 'integrations'; switchView('database'); setTimeout(() => { $$('.db-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'integrations')); renderDbList(); }, 0); }
      else switchView(action);
    });
  }

  function renderDashOverview() {
    renderCoreTools();
    if (currentView !== 'dashboard') return;
    const stats = $('#dashStats');
    const ins = $('#dashInsight');
    if (!stats || !ins) return;
    const signedIn = cloudSignedIn();
    const now = Date.now();
    const weekAgo = now - 7 * 864e5;
    const editedWeek = projects.filter((p) => p.updatedAt >= weekAgo).length;
    const makeStat = (cls, label, ico, valueHtml, sub, go) =>
      `<div class="stat-card ${cls}"${go ? ` data-go="${go}"` : ''}>
        <div class="sc-top"><span class="sc-label">${label}</span><span class="sc-ico">${ico}</span></div>
        <div class="sc-value">${valueHtml}</div>
        <div class="sc-sub">${sub}</div>
      </div>`;
    // 1 — active projects (local, real)
    const pSub = !projects.length
      ? 'Start a project from a template below'
      : (editedWeek === projects.length
          ? 'Every project touched in the last 7 days'
          : editedWeek + ' of ' + projects.length + ' edited in the last 7 days');
    // 2 — AI credits: server-authoritative when signed in, local mirror offline
    const cred = PLANS.store.creditsLeft();
    const pro = isPro();
    const cSub = (() => {
      const s = PLANS.store.load();
      if (pro) {
        if (s.plan === 'free') {
          const d = PLANS.store.trialDaysLeft();
          return 'Pro trial — ' + d + (d === 1 ? ' day' : ' days') + ' left · unlimited AI';
        }
        return ((PLANS.getPlan(s.plan) || {}).name || s.plan) + ' plan · unlimited AI';
      }
      const bonus = s.bonusCredits || 0;
      return cred.used + ' used · ' + cred.limit + ' available' + (bonus ? ' · incl. ' + bonus + ' streak bonus' : '');
    })();
    // 3 — daily streak (registry truth when signed in)
    const st = STREAK.cache;
    let sVal, sSub;
    if (!signedIn) { sVal = '—'; sSub = 'Sign in to earn daily AI credits and spin the Day-7 wheel'; }
    else if (!st || !st.ok) { sVal = '…'; sSub = 'Syncing your streak from the cloud registry'; }
    else {
      const cur = st.streak || 0;
      const nd = st.nextCycle || 1;
      const claimed = !!st.claimedToday;
      const shield = st.shields ? ' · ⛨ ' + st.shields + ' shield' + (st.shields === 1 ? '' : 's') : '';
      if (claimed) {
        const d = st.cycleDay || 1;
        sVal = (cur || d) + '<small>day streak</small>';
        sSub = (st.wheelPending ? 'Day ' + d + ' claimed — wheel ready! 🎡' : 'Day ' + d + ' claimed ✓ — back tomorrow for Day ' + ((d % 7) + 1)) + shield;
      } else {
        sVal = cur > 0 ? cur + '<small>day streak</small>' : 'Day ' + nd;
        sSub = (nd === 7
          ? 'Complete Day 7 today to unlock the wheel 🎡'
          : (st.restarting ? 'Streak reset — claim Day 1 to start a new one' : 'Claim Day ' + nd + ' for +' + (nd + 1) + ' bonus credits')) + shield;
      }
    }
    // 4 — local studio data size (projects + autosave history, real bytes)
    const totB = dashBytes();
    const st4 = !projects.length
      ? 'Nothing saved yet — projects stay on this device'
      : projects.length + ' project' + (projects.length === 1 ? '' : 's') + ' + autosave history · local only';
    stats.innerHTML =
      makeStat('sc-projects', 'Active projects', '📁', '<span>' + projects.length + '</span>', pSub, 'projects') +
      makeStat('sc-ai', 'AI credits', '✦', '<span>' + (pro ? '∞' : cred.left) + '</span><small>' + (pro ? 'unlimited' : 'left') + '</small>', cSub, 'ai') +
      makeStat('sc-streak', 'Daily streak', '🔥', '<span>' + sVal + '</span>', sSub) +
      makeStat('sc-store', 'Local studio data', '💾', '<span>' + dashFmtBytes(totB) + '</span>', st4);
    $$('#dashStats .stat-card[data-go]').forEach((c) => c.onclick = () => {
      const go = c.dataset.go;
      if (go === 'ai') switchView('ai');
      else if (go === 'projects') $('#projectsGrid').scrollIntoView({ behavior: 'smooth' });
    });
    // ---- insight row: AI usage this week (real ledger) + recent activity ----
    const ledger = (PLANS.store.load().creditsSpends || []).filter((e) => DASH_AI_STATES.includes(e.status));
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 864e5);
      days.push({ date: d, key: d.toDateString(), n: 0 });
    }
    ledger.forEach((e) => { const day = days.find((x) => x.key === new Date(e.at).toDateString()); if (day) day.n++; });
    const total = days.reduce((t, d) => t + d.n, 0);
    const max = Math.max(1, ...days.map((d) => d.n));
    const todayKey = new Date(now).toDateString();
    const chartHtml = total === 0
      ? ''
      : `<div class="ch-bars">${days.map((d) => {
          const today = d.key === todayKey;
          const h = d.n ? Math.max(4, Math.round((d.n / max) * 104)) : 2;
          return `<div class="ch-col${today ? ' today' : ''}" title="${d.date.toLocaleDateString()}: ${d.n} generation${d.n === 1 ? '' : 's'}">
            <div class="ch-val">${d.n || ''}</div>
            <div class="ch-track"><div class="ch-bar" style="height:${h}px"></div></div>
            <div class="ch-lbl">${d.date.toLocaleDateString(undefined, { weekday: 'short' })}</div>
          </div>`;
        }).join('')}</div>`;
    const sorted = projects.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
    const recentHtml = !sorted.length
      ? `<div class="ins-empty"><div class="ie-emoji">🪄</div><p>No projects yet — create one from a template above and your activity will appear here.</p></div>`
      : `<div class="act-list">${sorted.map((p) => {
          const secs = totalSections(p);
          const pages = Builder.pages(p).length;
          const su = (p.suites || []).length;
          const tpl = p.templateId && p.templateId.indexOf('ai:') === 0 ? '✦ AI-generated' : ((DB.getTemplate(p.templateId) || {}).name || 'custom');
          const metaBits = [tpl + ' template', secs + ' section' + (secs === 1 ? '' : 's')];
          if (pages > 1) metaBits.push(pages + ' pages');
          if (su) metaBits.push(su + ' suite' + (su === 1 ? '' : 's'));
          return `<div class="act-item" data-open="${p.id}" title="Open ${esc(p.name)}">
            <span class="act-dot"></span>
            <div class="act-body">
              <span class="act-name">${esc(p.name)}</span>
              <span class="act-meta">${esc(metaBits.join(' · '))}</span>
            </div>
            <span class="act-time">${relWhen(p.updatedAt)}</span>
            <span class="act-open">↗</span>
          </div>`;
        }).join('')}</div>`;
    ins.innerHTML =
      `<div class="ins-card">
        <div class="ins-head"><h3>AI generations — last 7 days</h3><span class="ins-note">${signedIn ? 'tied to your registry account' : 'tracked on this device'}</span></div>
        ${total === 0
          ? `<div class="ins-empty"><div class="ie-emoji">✦</div><p>No AI generations this week. Describe a site in the AI Studio and it will show up here.</p><button class="btn primary small" id="insAiGo">Open AI Studio</button></div>`
          : chartHtml}
      </div>
      <div class="ins-card">
        <div class="ins-head"><h3>Recent activity</h3><span class="ins-note">${projects.length} project${projects.length === 1 ? '' : 's'} · newest first</span></div>
        ${recentHtml}
      </div>`;
    const aiGo = $('#insAiGo');
    if (aiGo) aiGo.onclick = () => switchView('ai');
    $$('#dashInsight .act-item').forEach((el) => el.onclick = () => { currentId = el.dataset.open; switchView('designer'); });
  }

  function renderDashboard() {
    renderDashOverview();
    renderStreakWidget();
    if (SUPABASE.isConfigured() && SUPABASE.signedIn()) hydrateStreak();
    $('#tplGrid').innerHTML = DB.templates.map((t) => {
      const proTpl = PLANS.proTemplates.includes(t.id);
      const locked = proTpl && !isPro();
      return `
      <div class="card tpl-card ${locked ? 'locked' : ''}" data-tpl="${t.id}">
        <span class="tag">${esc(t.tag)}${proTpl ? ' · <span class="pro-chip">🔒 Pro</span>' : ''}</span>
        <div class="tpl-icon">${t.icon}</div>
        <h4>${esc(t.name)}</h4>
        <p>${esc(t.desc)}</p>
        <div class="mini-row">
          <button class="btn primary small" data-use="${t.id}">${locked ? '🔒 Upgrade' : '＋ Start'}</button>
          <button class="btn ghost small" data-prev="${t.id}">👁 Preview</button>
        </div>
        ${locked ? `<div class="lock-veil"><span class="lock-chip"><span class="pill-dot"></span>${esc(t.name)} is a Pro template</span></div>` : ''}
      </div>`;
    }).join('');

    $$('[data-use]').forEach((b) => b.onclick = () => {
      const t = DB.getTemplate(b.dataset.use);
      if (PLANS.proTemplates.includes(t.id) && !isPro()) {
        openPricing();
        toast('Upgrade to Pro to unlock this template 🔒', false);
        return;
      }
      createProject(t);
    });
    $$('[data-prev]').forEach((b) => b.onclick = () => previewTemplate(DB.getTemplate(b.dataset.prev)));

    const grid = $('#projectsGrid');
    // renderDashboard re-runs on every save/refresh, so keep exactly one
    // import row (prune duplicates from older runs before inserting).
    const rows = $$('.import-row');
    rows.slice(1).forEach((el) => el.remove());
    if (!rows.length) grid.insertAdjacentHTML('beforebegin', `
      <div class="import-row" style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
        <button class="btn ghost small" id="btnImport">⬆ Import project (JSON)</button>
        <span style="font-size:.75rem;color:var(--muted)">Backups are per-project JSON files — restore them on any machine.</span>
        <input type="file" id="importFile" accept=".json,application/json" hidden>
      </div>`);
    $('#btnImport').onclick = () => $('#importFile').click();
    const importFile = $('#importFile');
    if (importFile) importFile.onchange = (e) => importProjectFile(e.target.files[0]);
    if (!projects.length) {
      grid.innerHTML = '<div class="empty-state">No projects yet — start from a template above. ✨</div>';
      return;
    }
    grid.innerHTML = projects.map((p) => `
      <div class="card project-card">
        <h4>${esc(p.name)}</h4>
        <p>${esc(p.templateId && p.templateId.indexOf('ai:') === 0 ? '✦ AI-generated' : DB.getTemplate(p.templateId).name + ' template')} · ${totalSections(p)} section${totalSections(p) === 1 ? '' : 's'}${Builder.pages(p).length > 1 ? ' · ' + Builder.pages(p).length + ' pages' : ''} · ${(p.suites || []).length} suite${(p.suites || []).length === 1 ? '' : 's'}</p>
        <div>${(p.suites || []).map((s) => `<span class="chip">${esc((DB.getSuite(s) || {}).name || s)}</span>`).join('')}</div>
        <div class="mini-row">
          <button class="btn primary small" data-open="${p.id}">Open</button>
          <button class="btn ghost small" data-dup="${p.id}">⧉</button>
          <button class="btn ghost small" data-bak="${p.id}" title="Backup as JSON">💾</button>
          <button class="btn ghost small" data-exp="${p.id}">⬇</button>
          <button class="btn danger small" data-del="${p.id}">🗑</button>
        </div>
        <div class="project-meta"><span>${esc(new Date(p.updatedAt).toLocaleDateString())}</span><span>${esc(new Date(p.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span></div>
      </div>`).join('');

    $$('[data-open]').forEach((b) => b.onclick = () => { currentId = b.dataset.open; switchView('designer'); });
    $$('[data-dup]').forEach((b) => b.onclick = () => duplicateProject(b.dataset.dup));
    $$('[data-bak]').forEach((b) => b.onclick = () => backupProject(b.dataset.bak));
    $$('[data-exp]').forEach((b) => b.onclick = () => exportSiteById(b.dataset.exp));
    $$('[data-del]').forEach((b) => b.onclick = () => deleteProject(b.dataset.del));
  }

  function previewTemplate(tpl) {
    const p = projectFromTemplate(tpl);
    openModal(`Preview — ${tpl.name}`, `
      <p style="color:var(--muted);margin-bottom:12px">This is a live render of the template with sample content.</p>
      <div style="border:1px solid var(--border);border-radius:14px;overflow:hidden;background:#fff">
        <iframe srcdoc="${esc(Builder.buildSiteHTML(p, exportSettings()))}" style="width:100%;height:420px;border:none"></iframe>
      </div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn primary small" id="modalUseTpl">＋ Create project from this template</button>
      </div>`);
    $('#modalUseTpl').onclick = () => { closeModal(); createProject(tpl); };
  }

  // ---------------- projects ----------------
  function projectFromTemplate(tpl) {
    const pal = DB.getPalette(tpl.palette);
    // New-project defaults from Settings: a customised palette/font wins over the
    // template's own; Blank Canvas always uses them. Design numbers are studio-wide.
    const custPal = settings.defaultPalette && settings.defaultPalette !== DB.defaultSettings.defaultPalette;
    const custFont = settings.defaultFont && settings.defaultFont !== DB.defaultSettings.defaultFont;
    const p = {
      id: uid(),
      name: tpl.name + ' Site',
      templateId: tpl.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      suites: [],
      site: {
        name: tpl.name + ' Studio',
        tagline: 'We craft memorable, animated experiences for the modern web.',
        eyebrow: 'Welcome to ' + tpl.name,
        description: '',
        ctaText: 'Get started',
        ctaLink: '',
        email: 'hello@' + (settings.brandLink || 'pallettai.org').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
        phone: '',
        address: '',
        url: '',
        palette: (tpl.id === 'blank' || custPal) ? settings.defaultPalette : tpl.palette,
        font: (tpl.id === 'blank' || custFont) ? settings.defaultFont : tpl.font,
        heroLayout: settings.defaultHeroLayout || 'centered',
        navSticky: settings.defaultNavSticky !== false,
        themeToggle: settings.defaultThemeToggle !== false,
        design: {
          containerWidth: settings.defaultContainerWidth || 1140,
          radius: settings.defaultRadius || 20,
          spacing: settings.defaultSpacing || 96
        },
        sections: DB.sectionsFromTemplate(tpl)
      }
    };
    return p;
  }

  function ensureProjectCapacity() {
    if (isPro()) return true;
    const lim = PLANS.getPlan('free').limits.projects;
    if (projects.length >= lim) {
      openPricing();
      toast(`Free plan allows ${lim} project${lim === 1 ? '' : 's'} — upgrade for unlimited`, false);
      return false;
    }
    return true;
  }

  function createProject(tpl) {
    if (!ensureProjectCapacity()) return;
    const p = projectFromTemplate(tpl);
    projects.unshift(p);
    saveProjects();
    currentId = p.id;
    selectedSec = null;
    switchView('designer');
    toast(`Project “${p.name}” created ✨`, true);
  }

  function backupProject(id) {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (p.site.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pallettai.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Project backed up 💾', true);
  }
  function importProjectFile(file) {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const p = JSON.parse(String(rd.result));
        if (!p || !p.site || !Array.isArray(p.site.sections)) throw new Error('bad file');
        if (!ensureProjectCapacity()) return;         p.id = uid();
         p.createdAt = p.updatedAt = Date.now();
         if (!Array.isArray(p.suites)) p.suites = [];
         Builder.pages(p); // normalize (older backups are single-page)
        projects.unshift(p);
        saveProjects();
        currentId = p.id;
        toast('Project “' + p.site.name + '” imported ⬆', true);
        switchView('designer');
      } catch (e) {
        toast('Not a valid PallettAI project file', false);
      }
    };
    rd.readAsText(file);
  }

  function duplicateProject(id) {
    const p = projects.find((x) => x.id === id);
    if (!p || !ensureProjectCapacity()) return;
    const copy = JSON.parse(JSON.stringify(p));     copy.id = uid();
     if (!Array.isArray(copy.suites)) copy.suites = [];
     copy.name = p.name + ' copy';
    copy.createdAt = copy.updatedAt = Date.now();
    projects.unshift(copy);
    saveProjects();
    toast('Project duplicated ⧉', true);
  }

  function deleteProject(id) {
    const name = esc((projects.find((p) => p.id === id) || {}).name);
    const doDel = () => {
      projects = projects.filter((p) => p.id !== id);
      if (currentId === id) currentId = null;
      clearRevisions(id);
      saveProjects();
      toast('Project deleted');
    };
    if (settings.confirmDelete === false) return doDel();
    openModal('Delete project?', `
      <p style="color:var(--muted)">This permanently removes “${name}” from this app.</p>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn danger small" id="modalDelYes">Delete</button>
        <button class="btn ghost small" id="modalDelNo">Cancel</button>
      </div>`);
    $('#modalDelYes').onclick = () => { closeModal(); doDel(); };
    $('#modalDelNo').onclick = closeModal;
  }

  // ---------------- designer ----------------
  let previewTimer = null;
  function renderDesigner() {
    const c = current();
    if (!c) {
      $('#designerRoot').innerHTML = `
        <div class="panel" style="grid-column:1/-1;align-items:center;padding:60px;text-align:center">
          <div style="font-size:3rem">🎨</div>
          <h3 style="margin:12px 0 6px;color:var(--text);letter-spacing:0;text-transform:none;font-size:1.2rem">No project open</h3>
          <p style="color:var(--muted);margin-bottom:18px">Open a project from the dashboard to start designing.</p>
          <button class="btn primary" onclick="App.go('dashboard')">Go to Dashboard</button>
        </div>`;
      return;
    }
    const pal = DB.getPalette(c.site.palette);
    const s = c.site;
    const customF = c.site.customFonts || [];
    const pgList = Builder.pages(c);
    const multiPg = pgList.length > 1;
    const pgNow = pgList.find((pg) => pg.id === c.site.activePageId) || pgList[0] || { name: 'Home' };
    $('#designerRoot').innerHTML = `
    <div class="designer-col">
      <div class="panel">
        <h3>Site identity</h3>
        <div class="field"><label>Site name</label><input id="siteName" value="${esc(s.name)}"></div>
        <div class="field"><label>Tagline</label><input id="siteTagline" value="${esc(s.tagline)}"></div>
        <div class="field"><label>Badge text (hero)</label><input id="siteEyebrow" value="${esc(s.eyebrow)}"></div>
        <div class="field"><label>Description</label><textarea id="siteDesc">${esc(s.description)}</textarea></div>
        <div class="field"><label>Button text</label><input id="siteCtaText" value="${esc(s.ctaText)}"></div>
        <div class="field"><label>Button link</label><input id="siteCtaLink" placeholder="https://… or #anchor" value="${esc(s.ctaLink)}"></div>
        <div class="field"><label>Contact email</label><input id="siteEmail" value="${esc(s.email)}"></div>
        <div class="field"><label>Phone (WhatsApp works with Contact Pro)</label><input id="sitePhone" value="${esc(s.phone)}"></div>
        <div class="field"><label>Address (map works with Contact Pro)</label><input id="siteAddress" value="${esc(s.address)}"></div>
        <div class="field"><label>Palette</label>
          <select id="sitePalette">${DB.palettes.map((p) => `<option value="${p.id}" ${p.id === c.site.palette ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          ${DB.palettes.map((p) => `<span title="${esc(p.name)}" style="width:22px;height:22px;border-radius:7px;background:${p.primary};cursor:pointer;border:2px solid ${p.id === c.site.palette ? 'var(--accent)' : 'transparent'}" data-pal="${p.id}"></span>`).join('')}
        </div>
        <div class="set-desc" id="palA11y" style="margin-top:2px"></div>
        <div class="field"><label>Font ${customF.length ? `· <span style="color:var(--accent)">${customF.length} custom</span>` : ''}</label>
          <select id="siteFont">${customF.map((f) => `<option value="${esc(f.name)}" ${f.name === c.site.font ? 'selected' : ''}>${esc(f.name)} · custom ⬆</option>`).join('')}${DB.fonts.map((f) => `<option value="${f.id}" ${f.id === c.site.font ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input type="file" id="fontFile" accept=".woff2,.woff,.ttf,application/font-woff2,application/font-woff,font/ttf" hidden>
          <button class="btn ghost small" id="btnUploadFont">⬆ Upload custom font</button>
          ${customF.map((f) => `<span class="chip">${esc(f.name)} <b data-rmfont="${esc(f.name)}" style="cursor:pointer;color:var(--danger)">✕</b></span>`).join('')}
        </div>
      </div>

      <div class="panel">
        <h3>Design & branding</h3>
        <div class="set-row" style="padding:6px 0"><div><label>Logo</label></div>
          <div style="display:flex;gap:8px;align-items:center">
            ${s.logo ? `<img src="${esc(s.logo)}" style="width:34px;height:34px;border-radius:9px;background:var(--surface2);padding:3px" alt="">` : ''}
            <button class="btn ghost small" id="btnAiLogo">✦ AI logo</button>
            <button class="btn ghost small" id="btnLogoUp">⬆</button>
            ${s.logo ? '<button class="btn ghost small" id="btnLogoClear">✕</button>' : ''}
            <input type="file" id="logoFile" accept="image/*" hidden>
          </div>
        </div>
        <div class="field"><label>Container width (px)</label><input type="number" id="dWidth" value="${s.design && Number.isFinite(Number(s.design.containerWidth)) ? s.design.containerWidth : 1140}" min="960" max="1680"></div>
        <div class="field"><label>Corner radius (px)</label><input type="number" id="dRadius" value="${s.design && Number.isFinite(Number(s.design.radius)) ? s.design.radius : 20}" min="0" max="48"></div>
        <div class="field"><label>Section spacing (px)</label><input type="number" id="dSpacing" value="${s.design && Number.isFinite(Number(s.design.spacing)) ? s.design.spacing : 96}" min="32" max="220"></div>
        <div class="field"><label>Hero layout</label>
          <select id="dHero"><option value="centered" ${(s.heroLayout || 'centered') === 'centered' ? 'selected' : ''}>Centered (image bg)</option><option value="split" ${s.heroLayout === 'split' ? 'selected' : ''}>Split (text + image)</option><option value="minimal" ${s.heroLayout === 'minimal' ? 'selected' : ''}>Minimal (clean)</option></select>
        </div>
        <div class="set-row"><div><label>Sticky nav</label></div><label class="switch"><input type="checkbox" id="dSticky" ${s.navSticky !== false ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="set-row"><div><label>Transparent nav</label></div><label class="switch"><input type="checkbox" id="dNavT" ${s.navStyle === 'transparent' ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="set-row"><div><label>Theme toggle in site</label><div class="set-desc">Visitors can switch dark/light</div></div><label class="switch"><input type="checkbox" id="dTheme" ${s.themeToggle !== false ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="field"><label>Nav CTA button text (empty = none)</label><input id="dNavCta" value="${esc(s.navCta || '')}" placeholder="e.g. Book now"></div>
        <div class="field"><label>Favicon emoji</label><input id="dFavicon" value="${esc(s.favicon || '')}" placeholder="e.g. 🥐 (empty = ◆)"></div>
        <div class="field"><label>Meta description (SEO)</label><textarea id="dMeta">${esc(s.metaDescription || '')}</textarea></div>
        <div class="field"><label>Social share image URL (Open Graph)</label><input id="dOg" value="${esc(s.ogImage || '')}" placeholder="https://…"></div>
        <div class="field"><label>Site URL (canonical · enables sitemap.xml + robots.txt)</label><input id="dUrl" value="${esc(s.url || '')}" placeholder="https://www.yourdomain.com" spellcheck="false"></div>
        <div class="field"><label>Business type (schema.org structured data)</label>
          <select id="dSchema">
            <option value="" ${(s.schemaType || '') === '' ? 'selected' : ''}>Auto — LocalBusiness when an address/area is set, else WebSite</option>
            ${[['WebSite', 'WebSite'], ['LocalBusiness', 'LocalBusiness'], ['Restaurant', 'Restaurant'], ['CafeOrCoffeeShop', 'Café / coffee shop'], ['ProfessionalService', 'Professional service (lawyer, accountant…)' ], ['HealthAndBeautyBusiness', 'Health & beauty business'], ['SportsActivityLocation', 'Gym / sports'], ['TravelAgency', 'Travel agency'], ['RealEstateAgent', 'Real estate agency'], ['Event', 'Event'], ['Organization', 'Organization']].map(([v, l]) => `<option value="${v}" ${s.schemaType === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
          </select>
          <div class="set-desc">Adds JSON-LD + FAQ rich results to every export — the single biggest local-SEO lever AI builders skip.</div>
        </div>
        <div class="field"><label>Area served (local SEO)</label><input id="dArea" value="${esc(s.area || '')}" placeholder="e.g. Leeds & West Yorkshire" spellcheck="false"></div>
        <div class="field"><label>Social links — one per line: icon|url</label>
          <textarea id="dSocials" rows="3" style="font-size:.75rem;font-family:monospace">${esc((s.socials || []).map((x) => x.icon + '|' + x.url).join('\n'))}</textarea>
        </div>
        <div class="field"><label>Custom CSS (advanced)</label><textarea id="dCss" rows="4" style="font-size:.72rem;font-family:monospace" placeholder="/* injected into the exported site */&#10;.sec-hero h1{letter-spacing:-.03em}">${esc(s.design && s.design.customCss || '')}</textarea></div>
        <div class="field"><label>Custom JS (advanced)</label><textarea id="dJs" rows="3" style="font-size:.72rem;font-family:monospace" placeholder="console.log('hello from my site');">${esc(s.design && s.design.customJs || '')}</textarea></div>
        <div class="field"><label>Form delivery endpoint (optional)</label>
          <input id="dFormEp" placeholder="your@email.com  ·  https://formspree.io/f/…  ·  a Web3Forms access key" value="${esc(s.formEndpoint || '')}" spellcheck="false">
          <div class="set-desc">Contact & newsletter forms on the exported site POST directly to this third-party service — nothing touches PallettAI servers. Empty = demo forms that only fake success. Use <b>your@email.com</b> for FormSubmit (zero setup, free, no monthly cap — first submission activates the address by email), a Formspree URL, or a Web3Forms access key.</div></div>
      </div>
    </div>

      <div class="preview-wrap">
        <div class="preview-bar">
          <div class="preview-dots"><span></span><span></span><span></span></div>
          <div class="preview-url">${esc(s.name)} — live preview</div>
          <div class="pw-group">
            <select id="previewPageSel" class="page-sel" title="Preview another page" hidden></select>
            <button class="pw-btn active" data-pw="100%" title="Desktop">🖥</button>
            <button class="pw-btn" data-pw="1024" title="Laptop">💻</button>
            <button class="pw-btn" data-pw="768" title="Tablet">📱</button>
            <button class="pw-btn" data-pw="390" title="Mobile">📲</button>
            <select id="pwPreset" class="page-sel" title="Custom breakpoints">
              <option value="">Custom…</option>
              <option value="1440">1440 · desktop XL</option>
              <option value="1280">1280 · laptop</option>
              <option value="1024">1024 · laptop small</option>
              <option value="820">820 · tablet XL</option>
              <option value="768">768 · tablet</option>
              <option value="430">430 · phone XL</option>
              <option value="390">390 · phone</option>
              <option value="344">344 · compact phone</option>
            </select>
            <input type="number" id="pwW" value="" min="280" max="2200" step="1" title="Exact preview width (px)" placeholder="px" style="width:58px;padding:4px 6px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:.75rem">
          </div>
        </div>
        <iframe id="previewFrame" title="Live site preview"></iframe>
      </div>

      <div class="panel">
        <div class="pages-bar" id="pagesBar"></div>
        <h3>Sections <span style="color:var(--muted);font-weight:600">(${c.site.sections.length})</span>${multiPg ? '<span class="chip" style="margin-left:6px">📄 ' + esc(pgNow.name) + ' page</span>' : ''}</h3>
        <div class="add-sec-row">
          <select id="addSecType">${Object.entries(DB.sectionTypes).map(([k, v]) => `<option value="${k}">${v.icon} ${v.name}</option>`).join('')}</select>
          <button class="btn primary small" id="addSecBtn">＋ Add</button>
        </div>
        <div class="section-list" id="secList"></div>
        <div class="sec-editor" id="secEditor"></div>
      </div>`;

    // bind site inputs
    [
      ['siteName', 'name'], ['siteTagline', 'tagline'], ['siteEyebrow', 'eyebrow'],
      ['siteDesc', 'description'], ['siteCtaText', 'ctaText'], ['siteCtaLink', 'ctaLink'],
      ['siteEmail', 'email'], ['sitePhone', 'phone'], ['siteAddress', 'address']
    ].forEach(([id, key]) => {
      const el = $('#' + id);
      el.oninput = () => { histCapture(); c.site[key] = el.value; touch(c); };
    });

    // design & branding panel
    const bindD = (id, key) => {
      const el = $('#' + id);
      if (!el) return;
      el.oninput = () => { histCapture(); c.site.design = c.site.design || {}; c.site.design[key] = +el.value || 0; touch(c); };
    };
    bindD('dWidth', 'containerWidth'); bindD('dRadius', 'radius'); bindD('dSpacing', 'spacing');
    const dHero = $('#dHero');
    if (dHero) dHero.onchange = () => { histCapture(); c.site.heroLayout = dHero.value; touch(c); };
    const dSticky = $('#dSticky');
    if (dSticky) dSticky.onchange = () => { histCapture(); c.site.navSticky = dSticky.checked; touch(c); };
    const dNavT = $('#dNavT');
    if (dNavT) dNavT.onchange = () => { histCapture(); c.site.navStyle = dNavT.checked ? 'transparent' : ''; touch(c); };
    const dTheme = $('#dTheme');
    if (dTheme) dTheme.onchange = () => { histCapture(); c.site.themeToggle = dTheme.checked; touch(c); };
    const bindT = (id, key) => {
      const el = $('#' + id);
      if (!el) return;
      el.oninput = () => { histCapture(); c.site[key] = el.value; touch(c); };
    };
    bindT('dNavCta', 'navCta'); bindT('dFavicon', 'favicon'); bindT('dMeta', 'metaDescription'); bindT('dOg', 'ogImage'); bindT('dFormEp', 'formEndpoint');
    bindT('dUrl', 'url'); bindT('dArea', 'area');
    const dSchema = $('#dSchema');
    if (dSchema) dSchema.onchange = () => { histCapture(); c.site.schemaType = dSchema.value; touch(c); };
    const dCss = $('#dCss');
    if (dCss) dCss.oninput = () => { histCapture(); c.site.design = c.site.design || {}; c.site.design.customCss = dCss.value; touch(c); };
    const dJs = $('#dJs');
    if (dJs) dJs.oninput = () => { histCapture(); c.site.design = c.site.design || {}; c.site.design.customJs = dJs.value; touch(c); };
    const dSocials = $('#dSocials');
    if (dSocials) dSocials.oninput = () => {
      histCapture();
      c.site.socials = dSocials.value.split('\n').filter((l) => l.trim()).map((l) => {
        const [icon, url] = l.split('|');
        return { icon: (icon || '•').trim(), url: (url || '#').trim() };
      });
      touch(c);
    };
    const btnAiLogo = $('#btnAiLogo');
    if (btnAiLogo) btnAiLogo.onclick = () => openLogoStudio(c);
    const btnLogoUp = $('#btnLogoUp'), logoFile = $('#logoFile');
    if (btnLogoUp && logoFile) btnLogoUp.onclick = () => logoFile.click();
    if (logoFile) logoFile.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { histCapture(); c.site.logo = String(rd.result); touch(c); toast('Logo uploaded 🖼️', true); };
      rd.readAsDataURL(f);
    };
    const btnLogoClear = $('#btnLogoClear');
    if (btnLogoClear) btnLogoClear.onclick = () => { histCapture(); c.site.logo = ''; touch(c); toast('Logo removed'); };
    const btnUploadFont = $('#btnUploadFont'), fontFile = $('#fontFile');
    if (btnUploadFont && fontFile) btnUploadFont.onclick = () => fontFile.click();
    if (fontFile) fontFile.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const name = f.name.replace(/\.[^.]+$/, '');
      const rd = new FileReader();
      rd.onload = () => {
        histCapture();
        c.site.customFonts = c.site.customFonts || [];
        c.site.customFonts.push({ name, data: String(rd.result).split(',')[1] || '' });
        touch(c);
        toast('Font “' + name + '” added — pick it in the Font dropdown 🅰️', true);
      };
      rd.readAsDataURL(f);
    };
    $$('[data-rmfont]').forEach((b) => b.onclick = () => {
      histCapture();
      c.site.customFonts = (c.site.customFonts || []).filter((f) => f.name !== b.dataset.rmfont);
      if (c.site.font === b.dataset.rmfont) c.site.font = 'inter';
      touch(c);
      toast('Font removed');
    });
    const setFrameW = (w) => {
      const f = $('#previewFrame');
      if (!f) return;
      f.style.width = w;
      f.style.margin = '0 auto';
      f.style.display = 'block';
      $$('.pw-btn').forEach((x) => x.classList.toggle('active', x.dataset.pw === w.replace('px', '')));
    };
    $$('.pw-btn').forEach((b) => b.onclick = () => setFrameW(b.dataset.pw === '100%' ? '100%' : b.dataset.pw + 'px'));
    const pwPreset = $('#pwPreset'), pwW = $('#pwW');
    if (pwPreset) pwPreset.onchange = () => {
      const v = pwPreset.value;
      if (v === '100%') setFrameW('100%');
      else if (v) { pwW.value = v; setFrameW(v + 'px'); }
    };
    if (pwW) pwW.oninput = () => {
      const v = parseInt(pwW.value, 10);
      if (v >= 280 && v <= 2200) { pwPreset.value = ''; setFrameW(v + 'px'); }
    };
    $('#sitePalette').onchange = (e) => { c.site.palette = e.target.value; touch(c); paintSwatches(c.site.palette); };
    $('#siteFont').onchange = (e) => { c.site.font = e.target.value; touch(c); };
    $$('[data-pal]').forEach((sw) => sw.onclick = () => { c.site.palette = sw.dataset.pal; touch(c); paintSwatches(c.site.palette); });
    paintSwatches(c.site.palette);
    $('#addSecBtn').onclick = () => {
      if (!canAddSection()) return;
      histCapture();
      const ns = DB.newSection($('#addSecType').value, { animation: settings.defaultAnimation });
      const last = c.site.sections[c.site.sections.length - 1];
      const insertAt = last && last.type === 'contact' ? c.site.sections.length - 1 : c.site.sections.length;
      c.site.sections.splice(insertAt, 0, ns);
      selectedSec = insertAt;
      touch(c);
      renderEditor();
    };
    $('#addSecType').onchange = () => {};
    const pageSel = $('#previewPageSel');
    if (pageSel) pageSel.onchange = () => setActivePage(pageSel.value);

    renderPagesBar();
    renderSecList();
    renderEditor();
    schedulePreview();
  }

  function touch(c) {
    c.updatedAt = Date.now();
    saveProjects();
    const chip = $('#projectChip');
    if (chip && !chip.hidden) chip.textContent = '◆ ' + c.name;
    schedulePreview();
    // The section list contents do not change during typing, so do not rebuild it
    // on every keystroke. Section-order / section-content changes call their own
    // editors or explicit list refreshes where needed.
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 500);
  }
  function paintSwatches(activeId) {
    $$('[data-pal]').forEach((sw) => { sw.style.borderColor = sw.dataset.pal === activeId ? 'var(--accent)' : 'transparent'; });
    const note = $('#palA11y');
    if (!note) return;
    const pal = DB.getPalette(activeId);
    const checks = DB.paletteChecks(pal);
    const worst = Math.min(...checks.map((c) => c.ratio));
    const failing = checks.filter((c) => c.ratio < c.need).length;
    note.innerHTML = failing
      ? `<span style="color:var(--warn, #eab308)">⚠ ${failing} text role${failing === 1 ? '' : 's'} below WCAG AA (worst ${worst.toFixed(1)}:1) — tune the palette in the Database tab</span>`
      : `<span style="color:var(--ok, #22c55e)">✓ WCAG AA text contrast — worst pair ${worst.toFixed(1)}:1</span>`;
  }

  function renderPreview() {
    const c = current();
    const f = $('#previewFrame');
    if (!c || !f) return;
    f.srcdoc = Builder.buildSiteHTML(c, exportSettings());
    if (Builder.pages(c).length > 1) {
      f.onload = () => {
        const d = f.contentDocument;
        if (!d) return;
        d.querySelectorAll('a.page-link').forEach((a) => {
          a.onclick = (e) => { e.preventDefault(); const id = a.getAttribute('data-page'); if (id) setActivePage(id); };
        });
      };
    } else {
      f.onload = null;
    }
  }

  function renderSecList() {
    const c = current();
    const wrap = $('#secList');
    if (!c || !wrap) return;
    wrap.innerHTML = c.site.sections.map((s, i) => {
      const t = DB.sectionTypes[s.type] || { name: s.type, icon: '🧩' };
      return `
      <div class="sec-card ${selectedSec === i ? 'active' : ''}" data-sec="${i}">
        <div class="sec-top"><span>${t.icon}</span> ${esc(s.title || t.name)}</div>
        <div class="sec-type">${esc(t.name)} · ${esc((DB.getAnimation(s.animation) || {}).name || 'none')}</div>
        <div class="sec-actions">
          <button class="icon-btn" data-sec-up="${i}" title="Move up">↑</button>
          <button class="icon-btn" data-sec-down="${i}" title="Move down">↓</button>
          <button class="icon-btn" data-sec-dup="${i}" title="Duplicate">⧉</button>
          <button class="icon-btn" data-sec-del="${i}" title="Delete">🗑</button>
        </div>
      </div>`;
    }).join('') || `<div class="empty-state" style="padding:30px 12px">
        <div style="font-size:1.6rem;margin-bottom:6px">Looks empty here</div>
        <p style="color:var(--muted);margin:0 0 18px">Your site has no sections yet. Add the first one below — most sites start with a <b>hero</b>, then an <b>about</b> and a <b>contact</b>.</p>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button class="btn primary small" data-add-sec-type="hero">＋ Hero</button>
          <button class="btn ghost small" data-add-sec-type="about">＋ About</button>
          <button class="btn ghost small" data-add-sec-type="features">＋ Features</button>
          <button class="btn ghost small" data-add-sec-type="testimonials">＋ Testimonials</button>
          <button class="btn ghost small" data-add-sec-type="contact">＋ Contact</button>
        </div>
      </div>`;

    $$('#secList [data-sec]').forEach((card) => {
      card.onclick = () => { selectedSec = +card.dataset.sec; renderSecList(); renderEditor(); };
      card.draggable = true;
      card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', card.dataset.sec); card.classList.add('dragging'); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.classList.remove('drag-over');
        const from = +e.dataTransfer.getData('text/plain');
        const to = +card.dataset.sec;
        if (from === to || isNaN(from)) return;
        const proj = current();
        if (!proj) return;
        histCapture();
        const [sec] = proj.site.sections.splice(from, 1);
        proj.site.sections.splice(to, 0, sec);
        selectedSec = to;
        touch(proj);
        renderEditor();
      });
    });
    $$('[data-sec-up]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); histCapture(); moveSec(+b.dataset.secUp, -1); });
    $$('[data-sec-down]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); histCapture(); moveSec(+b.dataset.secDown, 1); });
    $$('[data-sec-dup]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); histCapture(); dupSec(+b.dataset.secDup); });
    $$('[data-sec-del]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); histCapture(); delSec(+b.dataset.secDel); });
    $$('[data-add-sec-type]').forEach((b) => b.onclick = (e) => {
      e.stopPropagation();
      const type = b.dataset.addSecType;
      const c = current();
      if (!c) return;
      if (!canAddSection()) return;
      histCapture();
      const ns = DB.newSection(type);
      c.site.sections.push(ns);
      selectedSec = c.site.sections.length - 1;
      touch(c);
      renderSecList();
      renderEditor();
      toast('Section added — edit it on the right', true);
    });
  }

  function moveSec(i, dir) {
    const c = current();
    const j = i + dir;
    if (!c || j < 0 || j >= c.site.sections.length) return;
    [c.site.sections[i], c.site.sections[j]] = [c.site.sections[j], c.site.sections[i]];
    selectedSec = j;
    touch(c);
    renderEditor();
  }
  function dupSec(i) {
    const c = current();
    const copy = JSON.parse(JSON.stringify(c.site.sections[i]));
    copy.id = uid();
    c.site.sections.splice(i + 1, 0, copy);
    selectedSec = i + 1;
    touch(c);
    renderEditor();
  }
  function delSec(i) {
    const c = current();
    const doDel = () => {
      c.site.sections.splice(i, 1);
      selectedSec = Math.min(selectedSec, c.site.sections.length - 1);
      if (selectedSec < 0) selectedSec = null;
      touch(c);
      renderEditor();
    };
    if (settings.confirmDelete === false) return doDel();
    openModal('Delete section?', `
      <p style="color:var(--muted)">“${esc((DB.sectionTypes[c.site.sections[i] && c.site.sections[i].type] || {}).name || 'Section')}” will be removed from this page.</p>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn danger small" id="modalSecDel">Delete section</button>
        <button class="btn ghost small" id="modalSecNo">Cancel</button>
      </div>`);
    $('#modalSecDel').onclick = () => { closeModal(); doDel(); };
    $('#modalSecNo').onclick = closeModal;
  }

  // ---------------- pages (multi-page sites) ----------------
  // Builder.pages() is the authoritative page model: site.pages holds every
  // page ({id,name,slug,sections}); the page the studio is editing keeps its
  // sections array aliased to site.sections so all legacy section code paths
  // (designer, copilot, AI polish, suites) keep working untouched.
  const totalSections = (c) => {
    if (!c) return 0;
    return Builder.pages(c).reduce((n, pg) => n + (pg.sections || []).length, 0);
  };
  const slugUnique = (base, pages) => {
    const used = new Set(pages.map((pg) => pg.slug));
    let slug = Builder.slugify(base);
    let i = 2;
    while (used.has(slug)) slug = Builder.slugify(base) + '-' + i++;
    return slug;
  };

  function renderPagesBar() {
    const c = current();
    const bar = $('#pagesBar');
    if (!c || !bar) return;
    const pages = Builder.pages(c);
    const multi = pages.length > 1;
    const active = c.site.activePageId;
    bar.innerHTML =
      pages.map((pg) => `
        <button class="page-chip ${pg.id === active ? 'active' : ''}" data-page-go="${esc(pg.id)}" title="Edit the “${esc(pg.name)}” page">
          ${esc(pg.name)}${pg.slug === 'index' ? ' <span style="opacity:.6">🏠</span>' : ''}
        </button>`).join('') +
      (multi ? `<span class="page-chip-sep"></span>
        <button class="icon-btn" data-page-ren title="Rename this page">✎</button>
        <button class="icon-btn" data-page-del title="Delete this page" ${(Builder.pages(c).find((pg) => pg.id === active) || {}).slug === 'index' ? 'disabled' : ''}>🗑</button>` : '') +
      `<button class="page-chip add" data-page-add title="Add another page — e.g. About, Services, Gallery…">＋ Page</button>`;
    $$('[data-page-go]').forEach((b) => b.onclick = () => setActivePage(b.dataset.pageGo));
    const del = $('[data-page-del]');
    if (del) del.onclick = () => askDeletePage();
    const ren = $('[data-page-ren]');
    if (ren) ren.onclick = () => askRenamePage();
    const add = $('[data-page-add]');
    if (add) add.onclick = askAddPage;
    const sel = $('#previewPageSel');
    if (sel) {
      sel.hidden = !multi;
      sel.innerHTML = pages.map((pg) => `<option value="${esc(pg.id)}" ${pg.id === active ? 'selected' : ''}>${esc(pg.name)}</option>`).join('');
    }
  }

  function askAddPage() {
    const c = current();
    if (!c) return toast('Open a project first');
    const usedNames = Builder.pages(c).map((pg) => pg.name.toLowerCase());
    const ideas = ['About', 'Services', 'Portfolio', 'Gallery', 'Team', 'Pricing', 'Blog', 'Contact']
      .filter((n) => !usedNames.includes(n.toLowerCase()));
    const chips = ideas.map((n) => `<button class="chip" style="cursor:pointer" data-idea="${n}">＋ ${n}</button>`).join('') || '<span style="color:var(--muted)">Every page name is taken — pick your own below.</span>';
    openModal('📄 Add a page', `
      <p style="color:var(--muted);margin-bottom:10px">A new page starts with a ready-made header + contact, and shows up in the site nav. You can rename or delete it any time.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${chips}</div>
      <div class="field"><label>Page name</label><input id="pgName" placeholder="e.g. About" maxlength="24"></div>
      <div class="field"><label>Web address</label><input id="pgSlug" placeholder="about" maxlength="32" spellcheck="false" style="font-family:monospace"><div class="set-desc">Exported as <b>about.html</b> — letters, numbers and dashes only.</div></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn primary small" id="pgCreate">＋ Add page</button>
      </div>`);
    $$('[data-idea]').forEach((ch) => ch.onclick = () => {
      const nm = ch.dataset.idea;
      $('#pgName').value = nm;
      $('#pgSlug').value = Builder.slugify(nm);
    });
    $('#pgSlug').value = slugUnique('page', Builder.pages(c));
    $('#pgName').oninput = () => { if (!$('#pgSlug').dataset.touched) $('#pgSlug').value = Builder.slugify($('#pgName').value || 'page'); };
    $('#pgSlug').oninput = () => { $('#pgSlug').dataset.touched = '1'; };
    $('#pgCreate').onclick = () => {
      const name = ($('#pgName').value || '').trim() || 'Untitled';
      let slug = Builder.slugify(($('#pgSlug').value || '').trim() || name);
      const pages = Builder.pages(c);
      if (pages.length >= 40) { closeModal(); toast('That\'s 40 pages already — plenty for any site 😄', false); return; }
      if (pages.some((pg) => pg.slug === slug)) {
        slug = slugUnique(slug, pages);
        $('#pgSlug').value = slug;
      }
      if (!isPro() && totalSections(c) + 2 > PLANS.getPlan('free').limits.sectionsPerSite) {
        closeModal();
        openPricing();
        toast('The free plan allows up to ' + PLANS.getPlan('free').limits.sectionsPerSite + ' sections per site — upgrade for multi-page sites', false);
        return;
      }
      histCapture();
      const pg = { id: 'pg_' + uid(), name: name.slice(0, 40), slug, sections: [] };
      pg.sections.push(DB.newSection('hero', { animation: settings.defaultAnimation }));
      pg.sections[pg.sections.length - 1].title = name;
      pg.sections.push(DB.newSection('contact', { animation: settings.defaultAnimation }));
      pages.push(pg);
      closeModal();
      setActivePage(pg.id);
      toast('Page “' + name + '” added — design it like the home page 📄', true);
    };
  }

  function setActivePage(id) {
    const c = current();
    if (!c || !id) return;
    const pages = Builder.pages(c);
    const target = pages.find((pg) => pg.id === id);
    if (!target || id === c.site.activePageId) return;
    histCapture();
    c.site.sections = target.sections;    // switch the working array to the target page's
    c.site.activePageId = id;
    selectedSec = null;
    touch(c);
    renderDesigner();
  }

  function askRenamePage() {
    const c = current();
    const pages = Builder.pages(c);
    const pg = pages.find((x) => x.id === c.site.activePageId);
    if (!pg) return;
    openModal('✎ Rename page', `
      <div class="field"><label>Page name (shown in the nav)</label><input id="pgRName" value="${esc(pg.name)}" maxlength="24"></div>
      <div class="field"><label>Web address</label><input id="pgRSlug" value="${esc(pg.slug)}" maxlength="32" spellcheck="false" style="font-family:monospace"><div class="set-desc">The file keeps this address: ${esc(pg.slug)}.html</div></div>
      <div style="display:flex;gap:10px;margin-top:16px"><button class="btn primary small" id="pgSave">Save</button></div>`);
    $('#pgSave').onclick = () => {
      const name = ($('#pgRName').value || '').trim();
      let slug = Builder.slugify(($('#pgRSlug').value || '').trim() || name);
      if (!name) return toast('Give the page a name', false);
      if (slug === 'index' && pg.slug !== 'index' && Builder.pages(c).some((x) => x.slug === 'index')) return toast('Another page already uses index', false);
      histCapture();
      pg.name = name.slice(0, 40);
      if (!pages.some((x) => x.id !== pg.id && x.slug === slug)) pg.slug = slug;
      touch(c);
      closeModal();
      renderDesigner();
      toast('Page renamed — “' + pg.name + '”');
    };
  }

  function askDeletePage() {
    const c = current();
    const pages = Builder.pages(c);
    const pg = pages.find((x) => x.id === c.site.activePageId);
    if (!pg || pages.length < 2) return;
    if (pg.slug === 'index' && pages.some((x) => x.slug !== 'index')) return toast('Home (index) can’t be deleted while other pages exist', false);
    const doDel = () => {
      histCapture();
      const idx = pages.findIndex((x) => x.id === pg.id);
      if (idx > -1) pages.splice(idx, 1);
      const next = pages[idx] || pages[idx - 1] || pages[0];
      c.site.sections = next.sections;
      c.site.activePageId = next.id;
      selectedSec = null;
      touch(c);
      renderDesigner();
      toast('Page deleted');
    };
    if (settings.confirmDelete === false) return doDel();
    openModal('Delete page?', `
      <p style="color:var(--muted)">“${esc(pg.name)}” and its ${pg.sections.length} section${pg.sections.length === 1 ? '' : 's'} will be removed from the site. This is undoable with ${KBD}Z.</p>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn danger small" id="modalPgDel">Delete page</button>
        <button class="btn ghost small" id="modalPgNo">Cancel</button>
      </div>`);
    $('#modalPgDel').onclick = () => { closeModal(); doDel(); };
    $('#modalPgNo').onclick = closeModal;
  }

  function renderEditor() {
    const c = current();
    const box = $('#secEditor');
    if (!c || !box) return;
    if (selectedSec == null || !c.site.sections[selectedSec]) { box.classList.remove('open'); return; }
    const s = c.site.sections[selectedSec];
    const t = DB.sectionTypes[s.type] || {};
    box.classList.add('open');
    box.innerHTML = `
      <h4>${t.icon} Editing ${esc(t.name || s.type)}</h4>
      <div class="field"><label>Title</label><input id="seTitle" value="${esc(s.title)}"></div>
      <div class="field"><label>Subtitle / tagline</label><input id="seSubtitle" value="${esc(s.subtitle)}"></div>
      <div class="field"><label>Text</label><textarea id="seText">${esc(s.text)}</textarea></div>
      <div class="field"><label>Emblem image (shown above title)</label>
        <input id="seEmblem" placeholder="https://… or icon URL" value="${esc(s.emblem || '')}"></div>
      <div class="field"><label>Image URL ${s.imageSource ? `· <span style="color:var(--accent)">from ${esc(s.imageSource)}</span>` : ''}</label>
        <input id="seImage" placeholder="https://… or leave empty for auto" value="${esc(s.image)}"></div>
      <button class="btn ghost small" id="seAi" style="align-self:flex-start">✦ AI rewrite this section (1 credit)</button>
      ${DB.layoutsFor(s.type).length ? `
      <div class="field"><label>Design variant</label>
        <select id="seLayout">${DB.layoutsFor(s.type).map((v) => `<option value="${esc(v.id)}" ${(s.layout || (s.type === 'hero' ? (c.site.heroLayout || '') : '')) === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
        <label style="font-size:.68rem;color:var(--muted)">Creative layout from the catalog — switch anytime, your content stays.</label>
      </div>` : ''}
      <div class="field"><label>Entrance animation</label>
        <select id="seAnim">${DB.animations.map((a) => `<option value="${a.id}" ${a.id === (s.animation || 'fade-up') ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      </div>
      ${s.type === 'blog' ? `
      <div class="field"><label>Posts</label>
        <div class="post-edits">
        ${(s.items || []).map((it, j) => `
          <div class="post-edit">
            <input data-pk="title" value="${esc(it.title)}" placeholder="Post title">
            <input data-pk="extra" value="${esc(it.extra)}" placeholder="Category · X min read">
            <textarea data-pk="text" rows="4" placeholder="Post body…">${esc(it.text)}</textarea>
            <button class="icon-btn" data-post-del="${j}" title="Delete post">🗑</button>
          </div>`).join('')}
        </div>
        <button class="btn ghost small" id="postAdd" style="align-self:flex-start">＋ Add post</button>
      </div>` : ['features', 'stats', 'pricing', 'testimonials', 'faq', 'shop', 'about', 'gallery', 'collection'].includes(s.type) ? `
      <div class="field"><label>Items — one per line: icon|title|text|extra|tag|image</label>
        <textarea id="seItems" rows="6" style="font-size:.75rem;font-family:monospace">${esc(itemsToText(s.items))}</textarea>
        <label style="font-size:.68rem;color:var(--muted)">${s.type === 'collection' ? 'One entry per line — ✦|Title|Text|Category|Tag|Image-URL. Categories become the filter chips.' : 'For gallery: caption|—|—|tag|—|image-url'}</label>
      </div>` : ''}
      ${s.type === 'contact' ? `
      <div class="field"><label>Form note</label><input id="seExtra" value="${esc(s.extra)}"></div>` : ''}
      ${['map', 'weather', 'embed'].includes(s.type) ? `
      <div class="field"><label>${s.type === 'map' ? 'Address (embedded on Google Maps)' : s.type === 'weather' ? 'City (live 5-day forecast)' : 'Embed URL (Spotify / Calendly / Typeform…)'}</label><input id="seExtra" placeholder="${s.type === 'map' ? 'e.g. 221B Baker Street, London' : s.type === 'weather' ? 'e.g. Paris' : 'e.g. https://open.spotify.com/embed/playlist/…'}" value="${esc(s.extra)}"></div>` : ''}
      ${s.type === 'booking' ? `
      <div class="field"><label>Booking provider</label>
        <select id="seBookingProvider">${(DB.bookingProviders || []).map((provider) => `<option value="${esc(provider.id)}" ${provider.id === (s.bookingProvider || 'calendly') ? 'selected' : ''}>${esc(provider.name)}</option>`).join('')}</select>
        <label id="seBookingHint" style="font-size:.68rem;color:var(--muted)">${esc(((DB.bookingProviders || []).find((provider) => provider.id === (s.bookingProvider || 'calendly')) || DB.bookingProviders[0] || {}).hint || 'Use a public HTTPS booking page.')}</label>
      </div>
      <div class="field"><label>Public booking URL</label><input id="seBookingUrl" type="url" placeholder="${esc(((DB.bookingProviders || []).find((provider) => provider.id === (s.bookingProvider || 'calendly')) || DB.bookingProviders[0] || {}).placeholder || 'https://booking.example.com/…')}" value="${esc(s.bookingUrl || s.extra || '')}" spellcheck="false"><label style="font-size:.68rem;color:var(--muted)">HTTPS only. If the provider blocks embedding, the exported block keeps a clear “open booking” link.</label></div>
      <div class="field"><label>Button label</label><input id="seBookingButton" value="${esc(s.bookingButton || 'Book an appointment')}" placeholder="Book an appointment"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <div class="field" style="flex:1;min-width:140px"><label>Appointment length</label><input id="seBookingDuration" value="${esc(s.bookingDuration || '')}" placeholder="e.g. 30 minutes"></div>
        <div class="field" style="flex:1;min-width:140px"><label>Location / format</label><input id="seBookingLocation" value="${esc(s.bookingLocation || '')}" placeholder="e.g. Online · London"></div>
      </div>` : ''}
      ${s.type === 'hero' ? `
      <div class="field"><label>Button link (leave empty to use site button link)</label><input id="seExtra" placeholder="#sec-contact-… or https://…" value="${esc(s.extra)}"></div>` : ''}
      ${s.type === 'cta' ? `
      <div class="field"><label>Button link</label><input id="seExtra" value="${esc(s.extra)}"></div>` : ''}
      ${s.type === 'table' ? `
      <div class="field"><label>Column headings — comma separated</label><input id="seCols" value="${esc((s.cols || []).join(', '))}" spellcheck="false"></div>
      <div class="field"><label>Rows — one per line, cells separated by |</label>
        <textarea id="seRows" rows="8" style="font-size:.75rem;font-family:monospace">${esc((s.rows || []).map((r) => (Array.isArray(r) ? r.join('|') : String(r || ''))).join('\n'))}</textarea>
        <label style="font-size:.68rem;color:var(--muted)">Menus & schedules: “Item|Price|Notes”. Perfect for price comparisons, opening hours or specs.</label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost small" id="seRowAdd">＋ Add row</button><button class="btn ghost small" id="seColAdd">＋ Add column</button></div>` : ''}
      ${s.type === 'collection' ? `
      <div class="field"><label>Live controls on the exported site</label>
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center">
          <label style="display:flex;gap:6px;align-items:center;font-size:.8rem;cursor:pointer"><input type="checkbox" id="seCollFilter" ${s.filter !== false ? 'checked' : ''}> Category chips</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.8rem;cursor:pointer"><input type="checkbox" id="seCollSearch" ${s.search !== false ? 'checked' : ''}> Search box</label>
          <label style="display:flex;gap:6px;align-items:center;font-size:.8rem;cursor:pointer"><input type="checkbox" id="seCollSort" ${s.sort !== false ? 'checked' : ''}> Sort menu</label>
        </div>
      </div>` : ''}`;

    const bind = (id, key) => {
      const el = $('#' + id);
      if (el) el.oninput = () => { histCapture(); s[key] = el.value; touch(current()); };
    };
    bind('seTitle', 'title'); bind('seSubtitle', 'subtitle'); bind('seText', 'text');
    bind('seImage', 'image'); bind('seExtra', 'extra');
    const seBookingProvider = $('#seBookingProvider');
    if (seBookingProvider) {
      seBookingProvider.onchange = () => {
        histCapture();
        s.bookingProvider = seBookingProvider.value;
        const provider = (DB.bookingProviders || []).find((item) => item.id === s.bookingProvider) || DB.bookingProviders[0] || {};
        const hint = $('#seBookingHint');
        const url = $('#seBookingUrl');
        if (hint) hint.textContent = provider.hint || 'Use a public HTTPS booking page.';
        if (url && provider.placeholder) url.placeholder = provider.placeholder;
        touch(current());
      };
    }
    const seBookingUrl = $('#seBookingUrl');
    if (seBookingUrl) seBookingUrl.oninput = () => { histCapture(); s.bookingUrl = seBookingUrl.value; s.extra = seBookingUrl.value; touch(current()); };
    [['seBookingButton', 'bookingButton'], ['seBookingDuration', 'bookingDuration'], ['seBookingLocation', 'bookingLocation']].forEach(([id, key]) => {
      const el = $('#' + id);
      if (el) el.oninput = () => { histCapture(); s[key] = el.value; touch(current()); };
    });
    const seEmblem = $('#seEmblem');
    if (seEmblem) seEmblem.oninput = () => { histCapture(); s.emblem = seEmblem.value; touch(current()); };
    const seAi = $('#seAi');
    if (seAi) seAi.onclick = () => aiSectionRewrite(s);
    // structured blog editor
    $$('.post-edit [data-pk]').forEach((el) => el.oninput = () => {
      histCapture();
      const idx = [...el.closest('.post-edit').querySelectorAll('[data-pk]')].indexOf(el);
      const key = el.dataset.pk;
      s.items[idx] = s.items[idx] || { icon: 'Post', title: '', text: '', extra: '' };
      s.items[idx][key] = el.value;
      touch(current());
    });
    $$('[data-post-del]').forEach((b) => b.onclick = () => {
      histCapture();
      s.items.splice(+b.dataset.postDel, 1);
      touch(current());
      renderEditor();
    });
    const postAdd = $('#postAdd');
    if (postAdd) postAdd.onclick = () => {
      histCapture();
      s.items = s.items || [];
      s.items.push({ icon: 'Post', title: 'New post', text: 'Write your post here…', extra: 'News · 2 min read' });
      touch(current());
      renderEditor();
    };
    const lay = $('#seLayout');
    if (lay) lay.onchange = () => {
      if (PLANS.proLayouts.includes(lay.value) && !isPro()) {
        lay.value = s.layout || '';
        openPricing();
        return toast('That design variant is a Pro catalog layout 🔒', false);
      }
      histCapture(); s.layout = lay.value; touch(current());
    };
    const anim = $('#seAnim');
    if (anim) anim.onchange = () => { histCapture(); s.animation = anim.value; touch(current()); };
    const items = $('#seItems');
    if (items) items.oninput = () => { histCapture(); s.items = textToItems(items.value); touch(current()); };
    // table editor: headings + rows
    const seCols = $('#seCols');
    if (seCols) seCols.oninput = () => { histCapture(); s.cols = seCols.value.split(',').map((x) => x.trim()).filter(Boolean); touch(current()); };
    const seRows = $('#seRows');
    if (seRows) seRows.oninput = () => { histCapture(); s.rows = seRows.value.split('\n').filter((l) => l.trim()).map((l) => l.split('|').map((x) => x.trim())); touch(current()); };
    const seRowAdd = $('#seRowAdd');
    if (seRowAdd) seRowAdd.onclick = () => { histCapture(); s.rows = s.rows || []; s.rows.push(new Array(Math.max(1, (s.cols || []).length)).fill('')); touch(current()); renderEditor(); };
    const seColAdd = $('#seColAdd');
    if (seColAdd) seColAdd.onclick = () => { histCapture(); s.cols = s.cols || []; s.cols.push('Column ' + (s.cols.length + 1)); touch(current()); renderEditor(); };
    // collection toggles: chips / search / sort
    [['seCollFilter', 'filter'], ['seCollSearch', 'search'], ['seCollSort', 'sort']].forEach(([id, key]) => {
      const el = $('#' + id);
      if (el) el.onchange = () => { histCapture(); s[key] = el.checked; touch(current()); };
    });
  }

  function itemsToText(items) {
    return (items || []).map((it) => [it.icon || '✦', it.title || '', it.text || '', it.extra || '', it.tag || '', it.image || ''].join('|')).join('\n');
  }
  function textToItems(txt) {
    return txt.split('\n').filter((l) => l.trim()).map((l) => {
      const p = l.split('|');
      return { icon: p[0] || '✦', title: p[1] || '', text: p[2] || '', extra: p[3] || '', tag: p[4] || '', image: p[5] || '' };
    });
  }

  // ---------------- export / handoff / publish ----------------
  function siteSlug(c) {
    return (c.site.name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
  }
  function siteFileName(c) { return siteSlug(c) + '.html'; }
  function buildHtml(c) { return Builder.buildSiteHTML(c, exportSettings()); }

  // Page files for the open site: [{slug, name, html}] — one entry per page.
  function sitePageFiles(c) {
    return Builder.buildSitePages(c, exportSettings()).map((f) => ({
      slug: String(f.page.slug || Builder.slugify(f.page.name) || 'page'),
      name: f.page.name || 'Untitled',
      html: f.html
    }));
  }

  function exportSite(options) {
    const c = current();
    if (!c) return toast('Open a project first');
    const skipQuality = !!(options && options.skipQuality);
    const go = () => {
      const pages = Builder.pages(c);
      if (pages.length > 1) downloadSiteZip(c);
      else downloadHtml(c);
    };
    const audit = qualityReport(c);
    if (!skipQuality && audit && audit.issues && audit.issues.some((issue) => issue.level !== 'info')) return openQualityGate(go, c);
    go();
  }
  function exportSiteById(id, options) {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    const skipQuality = !!(options && options.skipQuality);
    const go = () => { if (Builder.pages(p).length > 1) downloadSiteZip(p); else downloadHtml(p); };
    const audit = qualityReport(p);
    if (!skipQuality && audit && audit.issues && audit.issues.some((issue) => issue.level !== 'info')) {
      currentId = p.id;
      return openQualityGate(go, p);
    }
    go();
  }
  function downloadHtml(c) {
    const html = buildHtml(c);
    if (html.length > 12 * 1024 * 1024) {
      return toast('This page is larger than 12 MB. Remove or resize some assets before exporting.', false);
    }
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = siteFileName(c);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Site exported — ${a.download} ⬇`, true);
    showExportReport(c, [{ name: a.download, content: html }], a.download);
  }
  function downloadSiteZip(c) {
    const files = exportFileList(c);
    const pages = files.filter((f) => f.name.endsWith('.html'));
    let name;
    try { name = ZIP.downloadZip(siteSlug(c) + '-site.zip', files); }
    catch (e) { return toast(e && e.message ? e.message : 'The site could not be exported. Remove some assets and try again.', false); }
    toast(`Site exported — ${pages.length} page${pages.length === 1 ? '' : 's'} (+SEO files) in ${name} ⬇`, true);
    showExportReport(c, files, name);
  }
  function copyHtml() {
    const c = current();
    if (!c) return toast('Open a project first');
    navigator.clipboard.writeText(buildHtml(c)).then(
      () => toast('HTML copied to clipboard 📋 (current page)', true),
      () => toast('Could not copy — use Export instead')
    );
  }

  // Page file list including robots.txt / sitemap.xml (the latter needs a live URL).
  function exportFileList(c) {
    return [...sitePageFiles(c).map((f) => ({ name: f.slug + '.html', content: f.html })), ...Builder.seoExtras(c, exportSettings())];
  }

  // ---------- export report & SEO / performance / accessibility audit ----------
  function seoAudit(c) {
    const checks = [];
    const pagesFiles = Builder.buildSitePages(c, exportSettings());
    const home = pagesFiles.find((f) => f.page && f.page.slug === 'index') || pagesFiles[0] || null;
    const html = home ? home.html : '';
    const totalImg = (html.match(/<img\b/g) || []).length;
    const lazyImg = (html.match(/loading="lazy"/g) || []).length;
    const noAlt = (html.match(/<img\b(?![^>]*\balt=)[^>]*>/g) || []).length;
    const hasLd = html.includes('application/ld+json');
    const hasCanonical = html.includes('rel="canonical"');
    let score = 100;
    const add = (level, msg, fix, w) => { checks.push({ level, msg, fix }); score -= (level === 'error' ? 18 : level === 'warn' ? 8 : 0) * (w || 1); };
    const metaDesc = String(c.site.metaDescription || '').trim();
    if (!metaDesc) add('warn', 'No meta description — Google writes its own (usually worse) snippet.', 'Write 50–160 characters in the Designer ▸ Design & branding.', 1.3);
    else if (metaDesc.length < 50 || metaDesc.length > 160) add('info', 'Meta description is ' + metaDesc.length + ' characters (ideal 50–160).', 'Tighten it in Design & branding.');
    if (!c.site.url) add('warn', 'No site URL set — no canonical link, sitemap.xml or sitemap-aware robots.txt yet.', 'Add your domain in Design & branding ▸ Site URL before publishing.', 1.2);
    else if (!hasCanonical) add('error', 'Canonical link missing even though a site URL is set.', 'Re-export after saving the URL in Design & branding.');
    if (!hasLd) add('error', 'No JSON-LD structured data in the export.', 'Set a Business type in Design & branding (or add an address for Auto LocalBusiness).', 1.2);
    else add('info', 'JSON-LD structured data is exported (schema.org).', '');
    const h1s = (html.match(/<h1(?:\s|>)/g) || []).length;
    if (h1s === 0) add('warn', 'No <h1> heading on the home page — the page has no primary topic signal.', 'Give the hero section a title.', 1.1);
    else if (h1s > 1) add('info', h1s + ' <h1> headings on the home page — search engines expect exactly one.', 'Use a subtitle on the second hero instead.');
    if (totalImg > 0) {
      if (noAlt > 0) add('warn', noAlt + ' image' + (noAlt === 1 ? '' : 's') + ' without an alt attribute.', 'Describe each image briefly in the section editor.');
      if (lazyImg < totalImg) add('info', lazyImg + '/' + totalImg + ' images lazy-load (the hero intentionally stays eager for speed).', '');
    }
    const pchecks = DB.paletteChecks(DB.getPalette(c.site.palette));
    const fails = pchecks.filter((x) => x.ratio < x.need);
    const worst = Math.min(...pchecks.map((x) => x.ratio));
    if (fails.length) add('warn', fails.length + ' text colour role' + (fails.length === 1 ? '' : 's') + ' below WCAG AA (worst ' + worst.toFixed(1) + ':1) — visitors with low vision struggle.', 'Database ▸ Palettes ▸ “🎚 AA tune” fixes it in one click.', 1.3);
    else add('info', 'Palette passes WCAG AA text contrast (worst pair ' + worst.toFixed(1) + ':1).', '');
    const kb = Math.round(html.length / 1024);
    if (kb > 350) add('info', 'Home page markup ≈ ' + kb + ' KB — consider enabling minify in Settings ▸ Export.', '');
    else add('info', 'Home page markup ≈ ' + kb + ' KB — light. (Images load from their own URLs.)', '');
    const letter = score >= 95 ? 'A+' : score >= 88 ? 'A' : score >= 78 ? 'B' : score >= 66 ? 'C' : score >= 50 ? 'D' : 'F';
    return { score: Math.max(0, Math.round(score)), letter, checks, htmlCount: pagesFiles.length };
  }
  function showExportReport(c, files, name) {
    const a = seoAudit(c);
    const totalKb = Math.max(1, Math.round(files.reduce((s, f) => s + (f.content || '').length, 0) / 1024));
    const good = ['A+', 'A', 'B'].includes(a.letter);
    const tone = good ? 'linear-gradient(135deg,#22c55e,#15803d)' : a.letter === 'C' ? 'linear-gradient(135deg,#eab308,#ca8a04)' : 'linear-gradient(135deg,#ef4444,#b91c1c)';
    const ic = (l, fix) => (l === 'error' ? '🔴' : l === 'warn' ? '🟡' : (fix ? '🔵' : '✅'));
    openModal('📦 Export report', `
      <div style="display:flex;gap:16px;align-items:center;margin-bottom:14px">
        <div style="width:76px;height:76px;border-radius:20px;display:grid;place-items:center;font-size:2rem;font-weight:800;color:#fff;background:${tone};flex:none">${esc(a.letter)}</div>
        <div style="flex:1;min-width:0">
          <b>Launch grade — ${esc(a.letter)} (${a.score}/100)</b>
          <div class="set-desc">“${esc(c.site.name)}” · ${files.length} file${files.length === 1 ? '' : 's'} ≈ ${totalKb} KB · ${a.checks.length} check${a.checks.length === 1 ? '' : 's'} across SEO, performance and accessibility.</div>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto">
        ${a.checks.map((i) => `<div class="diag-row diag-${esc(i.level)}"><div>${ic(i.level, i.fix)} ${esc(i.msg)}${i.fix ? `<br><small style="color:var(--muted)">Fix: ${esc(i.fix)}</small>` : ''}</div></div>`).join('')}
      </div>
      <div class="set-desc" style="margin-top:12px">🔓 No lock-in: “${esc(name || '')}” is plain HTML/CSS/JS — you own it and can host it anywhere. No PallettAI runtime, cookies or account required on the exported site. robots.txt included${c.site.url ? ' + sitemap.xml ✓' : ' — set the Site URL to also receive sitemap.xml'}.</div>`);
  }

  // ---------------- client handoff (ZIP) ----------------
  // One click produces everything a client needs to go live: their site files,
  // a plain-English hosting guide, a brand kit and (optionally) an invoice.
  function openExportMenu(options) {
    const c = current();
    if (!c) return toast('Open a project first');
    const skipQuality = !!(options && options.skipQuality);
    const pages = Builder.pages(c);
    openModal('⬇ Export & hand off', `
      <p style="color:var(--muted);margin-bottom:14px">${esc(c.name)} — ${pages.length} page${pages.length === 1 ? '' : 's'}, ready to ship.</p>
      <div class="export-cards">
        <button class="export-card" id="exDownload"><span class="export-ico">⬇</span><b>Download site</b><small>${pages.length === 1 ? 'Single self-contained .html file' : pages.length + ' pages as a .zip folder (index.html + more)'}</small></button>
        <button class="export-card" id="exHandoff"><span class="export-ico">🎁</span><b>Client handoff ZIP</b><small>Site + hosting guide + brand kit + optional invoice — hand to your client</small></button>
        <button class="export-card" id="exPublish"><span class="export-ico">🌐</span><b>Publish online</b><small>Deploy to a free host (Netlify / Neocities) and get a live link</small></button>
      </div>`);
    $('#exDownload').onclick = () => { closeModal(); exportSite({ skipQuality }); };
    $('#exHandoff').onclick = () => { closeModal(); openHandoff({ skipQuality }); };
    $('#exPublish').onclick = () => { closeModal(); openPublish({ skipQuality }); };
  }

  function handoffBrand(c) {
    const pal = DB.getPalette(c.site.palette);
    const f = DB.getFont(c.site.font);
    return { pal, font: f, pages: Builder.pages(c), multi: Builder.pages(c).length > 1 };
  }
  function handoffPage(c, brIn) {
    const br = brIn || handoffBrand(c);
    const p = c.site;
    const whiteLabel = isProPlus();
    const credit = whiteLabel ? '' : '<div class="hd-made">Prepared with ◆ PallettAI Studio</div>';
    return `
    <style>
      body{font-family:Georgia,'Times New Roman',serif;background:#f6f4f0;color:#241f1a;margin:0;line-height:1.6}
      .hd-wrap{max-width:760px;margin:0 auto;padding:44px 24px 80px}
      h1{font-size:2rem;letter-spacing:-.02em;margin:0 0 4px}
      h2{font-size:1.15rem;text-transform:uppercase;letter-spacing:.12em;color:#8a5f3c;margin:44px 0 12px}
      .hd-sub{color:#6d6459;margin:0 0 26px}
      .hd-card{background:#fff;border:1px solid #e7dfd3;border-radius:16px;padding:22px 24px;margin-bottom:14px}
      .hd-note{color:#6d6459;font-size:.95rem}
      code{background:#efe9de;padding:2px 7px;border-radius:6px;font-size:.9em}
      .sw{display:inline-block;width:46px;height:46px;border-radius:12px;margin:0 8px 8px 0;border:1px solid rgba(0,0,0,.08)}
      .hd-foot{margin-top:40px;font-size:.85rem;color:#8d847a;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
      .hd-made{background:#241f1a;color:#fff;display:inline-block;padding:8px 16px;border-radius:999px;font-size:.85rem}
      .hd-link{margin-right:16px;color:#6d6459;text-decoration:none;border-bottom:1px solid #cbbda9}
      a{color:inherit}
    </style>
    <div class="hd-wrap">
      <h1>${esc(p.name || 'Your website')} — ready to go live</h1>
      <p class="hd-sub">A short guide for ${esc(c.name)} · prepared ${new Date().toLocaleDateString()}</p>
      <div class="hd-card" id="guide">
        <h2>Putting your site online (10 minutes, free)</h2>
        <p class="hd-note">Everything you need is in the files next to this one${br.multi ? ' — the pages are linked, just upload them together' : ''}. You have three easy options:</p>
        <p><b>Option 1 — Netlify Drop (easiest, free):</b> go to <a href="https://app.netlify.com/drop">app.netlify.com/drop</a>, drag this folder onto the page, and your site is live with its own address. No signup needed to try; a free account lets you keep it and add your own domain.</p>
        <p><b>Option 2 — Neocities (free, no ads):</b> create a free site at <a href="https://neocities.org">neocities.org</a>, then upload <code>index.html</code>${br.multi ? ' and the other pages' : ''} in the dashboard. Your address will be <code>yourname.neocities.org</code>.</p>
        <p><b>Option 3 — GitHub Pages (great for developers):</b> create a repository, upload these files to it, then enable Pages under Settings. Your site appears at <code>yourname.github.io/repo</code>.</p>
        <p class="hd-note">Want to make changes later? Ask your designer — they can re-export this site in seconds. To buy a custom domain (e.g. yourbusiness.co.uk), do it at your domain registrar and point it at whichever host you chose.</p>
      </div>
      <div class="hd-card" id="brand">
        <h2>Brand kit</h2>
        ${p.logo ? `<img src="${esc(p.logo)}" alt="Logo" style="max-height:72px;margin-bottom:12px">` : (whiteLabel ? '<p class="hd-note">Logo: add your own mark in Studio before delivery.</p>' : '<p class="hd-note">Logo: ◆ (PallettAI mark — replace with your logo any time)</p>')}
        <p><b>Site name:</b> ${esc(p.name)}<br><b>Tagline:</b> ${esc(p.tagline || '—')}<br><b>Font:</b> ${esc(br.font.name)}</p>
        <p style="margin-top:10px">${['bg', 'surface', 'primary', 'accent'].map((k) => `<span class="sw" title="${k}: ${br.pal[k]}" style="background:${br.pal[k]}"></span>`).join('')}</p>
        <p class="hd-note" style="font-family:monospace;font-size:.85rem">${['bg', 'surface', 'primary', 'accent'].map((k) => k + ' ' + br.pal[k]).join(' · ')}</p>
        ${p.socials && p.socials.length ? '<p><b>Social links:</b> ' + p.socials.map((so) => esc(so.icon + ' ' + so.url)).join(' · ') + '</p>' : ''}
        <p><b>Contact on the site:</b> ${esc([p.email, p.phone, p.address].filter(Boolean).join(' · ') || '—')}</p>
      </div>
      ${handoffInvoiceCard(c, br)}
      <div class="hd-foot"><span>© ${new Date().getFullYear()} ${esc(p.name || 'Your website')}</span>${credit}</div>
    </div>`;
  }
  function handoffInvoiceCard(c, br) {
    const inv = br.invoice;
    if (!inv) return '';
    const pal = br.pal;
    const total = '£' + (Number(inv.amount) || 0).toFixed(2);
    return `
      <div class="hd-card" id="invoice" style="border-color:${pal.primary}">
        <h2>Invoice</h2>
        <p><b>${esc(inv.client || c.name)}</b></p>
        <p class="hd-note">${esc(c.name)} — website design & build · ${inv.date}</p>
        <table style="width:100%;border-collapse:collapse;margin-top:10px"><tr><td style="padding:8px 0">${esc(c.name)} — ${esc(p.name || 'website')}</td><td style="text-align:right;font-weight:bold">${total}</td></tr><tr><td style="padding:8px 0;border-top:2px solid #eee"><b>Total due</b></td><td style="text-align:right;border-top:2px solid #eee;font-weight:bold;font-size:1.1rem">${total}</td></tr></table>
        <p class="hd-note" style="margin-top:10px">Payment details & bank reference: ask your designer.</p>
      </div>`;
  }
  function openHandoff(options) {
    const c = current();
    if (!c) return toast('Open a project first');
    const skipQuality = !!(options && options.skipQuality);
    if (!skipQuality) {
      const audit = qualityReport(c);
      if (audit && audit.issues && audit.issues.some((issue) => issue.level !== 'info')) {
        return openQualityGate(() => openHandoff({ skipQuality: true }), c);
      }
    }
    openModal('🎁 Client handoff', `        <p style="color:var(--muted);margin-bottom:12px">Generates one ZIP with the live site files, a plain-English hosting guide, the brand kit — and an optional invoice you can email straight to the client. Pro+ removes PallettAI attribution from the delivery pack.</p>
      <div class="field"><label>Client / business name</label><input id="hoClient" placeholder="e.g. Willow Café Ltd." value="${esc((c.name || '').replace(/ Site$/, ''))}"></div>
      <div class="field"><label>Invoice amount £ (optional — blank = no invoice)</label><input id="hoAmount" type="number" min="0" step="0.01" placeholder="e.g. 450"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn primary small" id="hoGo">🎁 Build handoff ZIP</button>
      </div>`);
    $('#hoGo').onclick = () => {
      const client = ($('#hoClient').value || '').trim();
      const amount = parseFloat($('#hoAmount').value);
      const br = handoffBrand(c);
      br.invoice = (client || amount > 0) ? { client: client || c.name, amount: isNaN(amount) ? 0 : amount, date: new Date().toLocaleDateString() } : null;
      const files = sitePageFiles(c).map((f) => ({ name: f.slug + '.html', content: f.html }));
      files.push({ name: 'hosting-guide.html', content: '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hosting guide</title></head><body>' + handoffPage(c, br) + '</body></html>' });
      const pal = DB.getPalette(c.site.palette);
      const f2 = DB.getFont(c.site.font);
      const kit = `
      <div style="padding:40px;font-family:var(--font,Georgia,serif)">
        <h1 style="margin:0 0 4px">${esc(c.site.name || c.name)}</h1>
        <p style="color:#888;margin:0 0 26px">${esc(c.site.tagline || 'Brand kit')}</p>
        ${c.site.logo ? `<img src="${esc(c.site.logo)}" style="max-height:80px;display:block;margin-bottom:20px">` : ''}
        <h2 style="font-size:.8rem;text-transform:uppercase;letter-spacing:.14em;color:#999">Palette</h2>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">${['bg', 'surface', 'primary', 'accent', 'text', 'muted'].map((k) => `<div><div style="width:84px;height:60px;border-radius:12px;background:${pal[k]};border:1px solid #00000014"></div><div style="font-size:.7rem;font-family:monospace;margin-top:4px">${k}<br>${pal[k]}</div></div>`).join('')}</div>
        <h2 style="font-size:.8rem;text-transform:uppercase;letter-spacing:.14em;color:#999">Typography</h2>
        <p style="font-family:'${esc(f2.name)}',sans-serif;font-size:1.6rem;margin:4px 0 24px">${esc(f2.name)} — The quick brown fox</p>
        <h2 style="font-size:.8rem;text-transform:uppercase;letter-spacing:.14em;color:#999">Contact & social</h2>
        <p style="margin:4px 0">${esc([c.site.email, c.site.phone, c.site.address].filter(Boolean).join(' · ') || '—')}</p>
        ${c.site.socials && c.site.socials.length ? '<p style="margin:4px 0">' + c.site.socials.map((so) => esc(so.icon + ' ' + so.url)).join(' · ') + '</p>' : ''}
      </div>`;
      files.push({ name: 'brand-kit.html', content: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Brand kit</title></head><body>' + kit + '</body></html>' });
      let name;
      try { name = ZIP.downloadZip(siteSlug(c) + '-client-handoff.zip', files); }
      catch (e) { return toast(e && e.message ? e.message : 'The handoff ZIP could not be built. Remove some assets and try again.', false); }
      closeModal();
      toast('Client handoff ready — ' + name + ' 🎁', true);
    };
  }

  // ---------------- one-click publish ----------------
  const PUB_KEY = 'pallettai.publish.v1';
  function loadPublish() { try { return JSON.parse(localStorage.getItem(PUB_KEY) || '{}'); } catch (e) { return {}; } }
  function savePublish(v) {
    try { localStorage.setItem(PUB_KEY, JSON.stringify(v)); return true; }
    catch (e) { toast('Publishing credentials could not be saved on this device.', false); return false; }
  }
  function publishFiles(c) {
    // Every page as {name (file), content (html)} — index.html guaranteed by the page model.
    // robots.txt + sitemap.xml ride along (sitemap needs the site URL set).
    return [...sitePageFiles(c).map((f) => ({ name: f.slug + '.html', content: f.html })), ...Builder.seoExtras(c, exportSettings())];
  }
  async function netlifyDeploy(c, token) {
    const sub = (siteSlug(c) + '-' + Math.random().toString(36).slice(2, 6)).replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'palletai-site';
    const mk = await ONLINE.request('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: sub })
    });
    const site = await mk.json().catch(() => ({}));
    if (!mk.ok) throw new Error((site && site.message) || 'Netlify could not create the site (' + mk.status + ')' + (site && site.error ? ': ' + site.error : ''));
    const zip = ZIP.zipFiles(publishFiles(c));
    const up = await ONLINE.request('https://api.netlify.com/api/v1/sites/' + site.id + '/deploys', {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/zip'
      },
      body: zip
    });
    const dep = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error((dep && dep.message) || 'Netlify deploy failed (' + up.status + ')');
    return { url: 'https://' + (site.subdomain || sub) + '.netlify.app', provider: 'Netlify' };
  }
  function multipartBody(fields, files) {
    const boundary = '----pallettai' + Math.random().toString(36).slice(2, 12);
    const enc = new TextEncoder();
    const parts = [];
    for (const [k, v] of Object.entries(fields || {})) {
      parts.push(enc.encode('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n'));
    }
    for (const f of files || []) {
      parts.push(enc.encode('--' + boundary + '\r\nContent-Disposition: form-data; name="' + f.name + '"; filename="' + f.name + '"\r\nContent-Type: text/html; charset=utf-8\r\n\r\n'));
      parts.push(enc.encode(f.content));
      parts.push(enc.encode('\r\n'));
    }
    parts.push(enc.encode('--' + boundary + '--\r\n'));
    let total = 0; parts.forEach((p) => { total += p.length; });
    const out = new Uint8Array(total);
    let pos = 0;
    parts.forEach((p) => { out.set(p, pos); pos += p.length; });
    return { body: new Blob([out], { type: 'multipart/form-data; boundary=' + boundary }), boundary };
  }
  async function neocitiesKey(user, pass) {
    const fd = new URLSearchParams(); fd.set('username', user); fd.set('password', pass);
    const r = await ONLINE.request('https://neocities.org/api/key', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fd.toString()
    });
    const j = await r.json().catch(() => ({}));
    if (j.result !== 'success' || !j.api_key) throw new Error((j.message && j.message !== 'success' ? j.message : 'Neocities login failed — check the username & password'));
    return j.api_key;
  }
  async function neocitiesUpload(user, key, files) {
    const { body } = multipartBody({ api_key: key }, files);
    const r = await ONLINE.request('https://neocities.org/api/upload', { method: 'POST', body });
    const j = await r.json().catch(() => ({}));
    if (j.result !== 'success') throw new Error(j.message || 'Neocities upload failed (' + r.status + ')');
    return { url: 'https://' + user + '.neocities.org/', provider: 'Neocities' };
  }

  function openPublish(options) {
    const c = current();
    if (!c) return toast('Open a project first');
    const skipQuality = !!(options && options.skipQuality);
    if (!skipQuality) {
      const audit = qualityReport(c);
      if (audit && audit.issues && audit.issues.some((issue) => issue.level !== 'info')) {
        return openQualityGate(() => openPublish({ skipQuality: true }), c);
      }
    }
    const cred = loadPublish();
    const pages = Builder.pages(c);
    openModal('🌐 Publish online', `
      <p style="color:var(--muted);margin-bottom:14px">${esc(c.name)} — ${pages.length} page${pages.length === 1 ? '' : 's'}. Choose a free host, connect once, then publish with one click. Credentials stay in this app only.</p>

      <div class="pub-card">
        <div class="pub-head"><span class="export-ico">▲</span><b>Netlify</b><span class="chip">Free · fast · custom domains</span></div>
        <p class="pub-note">Get a free personal access token: <b>app.netlify.com → User settings → Applications → Personal access tokens</b> (create one with the default scopes). Paste it below.</p>
        ${cred.netlifyToken
          ? `<p class="pub-saved">✓ Token saved${cred.netlifyUrl ? ' — last live at <a href="' + esc(cred.netlifyUrl) + '" target="_blank" rel="noopener">' + esc(cred.netlifyUrl.replace(/^https?:\/\//, '')) + '</a>' : ''}</p>`
          : '<p class="pub-saved" style="color:var(--danger)">No token yet — paste one to enable publishing.</p>'}
        <input id="pubNetlifyTok" type="password" placeholder="nfp_…" spellcheck="false" autocomplete="off" ${cred.netlifyToken ? 'value="' + esc(cred.netlifyToken) + '"' : ''}>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn primary small" id="pubNetlify">▲ Publish to Netlify</button>
          ${cred.netlifyToken ? '<button class="btn ghost small" id="pubNetlifyForget">Forget token</button>' : ''}
        </div>
      </div>

      <div class="pub-card">
        <div class="pub-head"><span class="export-ico">⚑</span><b>Neocities</b><span class="chip">Free · no ads</span></div>
        <p class="pub-note">Create a free site at <b>neocities.org</b>, then enter its username + password once here (the password is never stored — only the session key).</p>
        ${cred.neocitiesUser ? `<p class="pub-saved">✓ Signed in as <b>${esc(cred.neocitiesUser)}</b>${cred.neocitiesUrl ? ' — <a href="' + esc(cred.neocitiesUrl) + '" target="_blank" rel="noopener">' + esc(cred.neocitiesUrl.replace(/^https?:\/\//, '')) + '</a>' : ''}</p>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input id="pubNeoUser" placeholder="Neocities username" value="${esc(cred.neocitiesUser || '')}" autocomplete="off" spellcheck="false">
          <input id="pubNeoPass" type="password" placeholder="Password" autocomplete="off">
          <button class="btn primary small" id="pubNeo">⚑ Publish to Neocities</button>
          ${cred.neocitiesUser ? '<button class="btn ghost small" id="pubNeoForget">Sign out</button>' : ''}
        </div>
      </div>

      <div class="pub-card">
        <div class="pub-head"><span class="export-ico">🐙</span><b>GitHub Pages</b><span class="chip">For developers</span></div>
        <p class="pub-note">Export the site, push the files to a repository, then enable <b>Pages</b> under the repo Settings. Your site appears at <code>yourname.github.io/repo</code>. Full steps are in the handoff ZIP’s hosting guide (🎁 Handoff).</p>
      </div>
      <div id="pubResult" style="display:none;margin-top:8px"></div>`);
    const busy = (b, on, label) => { b.disabled = on; b.textContent = on ? 'Working…' : label; };
    $('#pubNetlify').onclick = async () => {
      const tok = ($('#pubNetlifyTok').value || '').trim();
      const btn = $('#pubNetlify');
      if (!tok) return toast('Paste a Netlify token first', false);
      busy(btn, true);
      try {
        const r = await netlifyDeploy(c, tok);
        const v = loadPublish(); v.netlifyToken = tok; v.netlifyUrl = r.url; savePublish(v);
        $('#pubResult').style.display = '';
        $('#pubResult').innerHTML = `<div class="pub-success">🎉 Live! <a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.url)}</b></a> <button class="btn ghost small" data-copy="${esc(r.url)}">Copy link</button></div>`;
        $('#pubResult [data-copy]').onclick = (e) => { navigator.clipboard.writeText(e.target.dataset.copy); toast('Link copied 📋', true); };
        toast('Published to Netlify 🎉', true);
      } catch (err) {
        toast(err.message || 'Netlify publish failed', false);
      } finally { busy(btn, false, '▲ Publish to Netlify'); }
    };
    $('#pubNeo').onclick = async () => {
      const user = ($('#pubNeoUser').value || '').trim();
      const pass = $('#pubNeoPass').value || '';
      const btn = $('#pubNeo');
      if (!user || !pass) return toast('Enter your Neocities username and password', false);
      busy(btn, true);
      try {
        let key = (loadPublish() || {}).neocitiesKey;
        if (cred.neocitiesUser !== user || !key) key = await neocitiesKey(user, pass);
        const r = await neocitiesUpload(user, key, publishFiles(c));
        const v = loadPublish(); v.neocitiesUser = user; v.neocitiesKey = key; v.neocitiesUrl = r.url; savePublish(v);
        $('#pubResult').style.display = '';
        $('#pubResult').innerHTML = `<div class="pub-success">🎉 Live! <a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.url)}</b></a> <button class="btn ghost small" data-copy="${esc(r.url)}">Copy link</button></div>`;
        $('#pubResult [data-copy]').onclick = (e) => { navigator.clipboard.writeText(e.target.dataset.copy); toast('Link copied 📋', true); };
        toast('Published to Neocities 🎉', true);
      } catch (err) {
        toast(err.message || 'Neocities publish failed', false);
      } finally { busy(btn, false, '⚑ Publish to Neocities'); }
    };
    const forgetNetlify = $('#pubNetlifyForget');
    if (forgetNetlify) forgetNetlify.onclick = () => { const v = loadPublish(); delete v.netlifyToken; delete v.netlifyUrl; savePublish(v); toast('Netlify token forgotten'); openPublish({ skipQuality: true }); };
    const forgetNeo = $('#pubNeoForget');
    if (forgetNeo) forgetNeo.onclick = () => { const v = loadPublish(); delete v.neocitiesUser; delete v.neocitiesKey; delete v.neocitiesUrl; savePublish(v); toast('Neocities signed out'); openPublish({ skipQuality: true }); };
  }

  // ---------------- suites ----------------
  function renderSuites() {
    const c = current();
    const grid = $('#suitesGrid');
    if (!c) {
      grid.innerHTML = `
        <div class="panel" style="grid-column:1/-1;align-items:center;padding:60px;text-align:center">
          <div style="font-size:3rem">🧩</div>
          <h3 style="margin:12px 0 6px;color:var(--text);letter-spacing:0;text-transform:none;font-size:1.2rem">Open a project to install suites</h3>
          <p style="color:var(--muted);margin-bottom:18px">Suites upgrade a finished site — blog, shop, animations, SEO and more.</p>
          <button class="btn primary" onclick="App.go('dashboard')">Go to Dashboard</button>
        </div>`;
      return;
    }
    grid.innerHTML = DB.suites.map((s) => {
      const installed = (c.suites || []).includes(s.id);
      const proOnly = PLANS.suitePlan[s.id] === 'pro';
      const locked = proOnly && !isPro();
      return `
      <div class="suite-card ${installed ? 'installed' : ''} ${locked ? 'locked' : ''}">
        <div class="suite-icon">${s.icon}</div>
        <span class="suite-tag">${esc(s.tag)}${proOnly ? ' · <span class="pro-chip">🔒 Pro</span>' : ''}</span>
        <h4>${esc(s.name)}</h4>
        <p>${esc(s.desc)}</p>
        <div class="suite-features">
          ${s.features.proAnimations ? '<span>Scroll progress bar</span><span>Hero glow orbs</span><span>Parallax</span>' : ''}
          ${s.features.contactPro ? '<span>Form validation</span><span>WhatsApp</span><span>Map embed</span>' : ''}
          ${s.features.blog ? '<span>Blog section</span><span>Reading modal</span><span>Newsletter</span>' : ''}
          ${s.features.shop ? '<span>Product grid</span><span>Working cart</span><span>Checkout demo</span>' : ''}
          ${s.features.galleryPro ? '<span>Masonry layout</span><span>Lightbox</span><span>Keyboard nav</span>' : ''}
          ${s.features.seo ? '<span>Meta tags</span><span>Open Graph</span><span>JSON-LD schema</span>' : ''}
          ${s.features.datawidgets ? '<span>Live crypto prices</span><span>GitHub profile stats</span><span>ECB FX rates</span>' : ''}
        </div>
        ${installed
          ? `<div class="installed-badge">✓ Installed</div><button class="btn danger small" data-uninstall="${s.id}">Uninstall</button>`
          : locked
            ? `<button class="btn primary small" data-upgrade="${s.id}">🔒 Upgrade to install</button>`
            : `<button class="btn primary small" data-install="${s.id}">＋ Install on “${esc(c.name)}”</button>`}
      </div>`;
    }).join('');

    $$('[data-upgrade]').forEach((b) => b.onclick = () => { openPricing(); toast('This suite is a Pro feature 🔒', false); });
    $$('[data-install]').forEach((b) => b.onclick = () => {
      const r = Builder.applySuite(c, b.dataset.install);
      if (!r.ok) return toast('Suite already installed');
      saveProjects();
      renderSuites();
      toast(`Suite “${r.suite.name}” installed — check the Designer preview 🧩`, true);
    });
    $$('[data-uninstall]').forEach((b) => b.onclick = () => {
      const s = DB.getSuite(b.dataset.uninstall);
      openModal(`Uninstall ${s.name}?`, `
        <p style="color:var(--muted)">Sections added by this suite will be removed from the project. Everything else stays untouched.</p>
        <div style="display:flex;gap:10px;margin-top:18px">
          <button class="btn danger small" id="modalUnYes">Uninstall</button>
          <button class="btn ghost small" id="modalUnNo">Cancel</button>
        </div>`);
      $('#modalUnYes').onclick = () => {
        Builder.removeSuite(c, s.id);
        saveProjects();
        closeModal();
        renderSuites();
        toast(`${s.name} uninstalled`);
      };
      $('#modalUnNo').onclick = closeModal;
    });
  }

  // ---------------- AI Studio ----------------
  // Session state that survives re-renders while the app is open: photos the
  // creator uploads (compressed to data URLs) and an existing website URL for
  // the AI to study. Nothing here is persisted to localStorage — uploads are
  // baked straight into the generated project when it runs.
  let aiUploads = [];
  let aiSiteUrl = '';
  const AI_CHIPS = [
    { label: 'Tech startup', prompt: 'A modern tech startup building an AI assistant for small businesses, sleek and confident' },
    { label: 'Restaurant', prompt: 'A cozy family restaurant in the city with seasonal dishes and a warm atmosphere' },
    { label: 'Agency', prompt: 'A bold creative agency with a strong portfolio, editorial and elegant' },
    { label: 'Boutique shop', prompt: 'A curated boutique shop selling handmade gifts and home goods' },
    { label: 'Travel tours', prompt: 'A travel tour company offering small-group adventures in the mountains' },
    { label: 'Fitness studio', prompt: 'A high-energy fitness studio for busy professionals' },
    { label: 'Beauty salon', prompt: 'A premium beauty salon and spa with a calming, luxurious feel' },
    { label: 'Academy', prompt: 'An online academy teaching design and coding skills' },
    { label: 'Local services', prompt: 'A trusted local home renovation company, honest and friendly' },
    { label: 'Events', prompt: 'An elegant wedding and event planning studio with a warm, celebratory feel' },
    { label: 'Auto garage', prompt: 'A trusted family-run auto repair garage, precise and honest' },
    { label: 'Music band', prompt: 'A bold indie music band with a gritty, electric live sound' },
    { label: 'Charity', prompt: 'A hopeful community charity foundation focused on clean water' }
  ];

  function renderAI() {
    const cred = PLANS.store.creditsLeft();
    const pro = isPro();
    const pill = $('#aiCreditPill');
    pill.className = 'pill' + (pro ? ' ok' : (cred.left <= 1 ? ' bad' : ''));
    pill.textContent = pro ? '∞ Pro credits' : cred.left + ' credit' + (cred.left === 1 ? '' : 's') + ' left';
    const c = current();
    const proj = lastAI ? projects.find((p) => p.id === lastAI.id) : null;
    const root = $('#aiRoot');
    root.innerHTML = `
      <div class="ai-card">
        <h3>✦ Generate a site from a prompt</h3>
        <p class="sub">One credit per site. Describe the business — or paste your current website's URL and add your own photos, and the AI studies them and rebuilds you something better. New sites ship with real, topic-matched photos from the web by default.</p>
        <textarea id="aiPrompt" placeholder="e.g. A modern bakery in Paris with a cozy, artisanal feel…"></textarea>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <input id="aiName" placeholder="Business name (optional — e.g. “Rustica”) — or just say it in the prompt" autocomplete="off" spellcheck="false" style="flex:1;min-width:200px;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font:inherit;font-size:.85rem">
          <input id="aiArea" placeholder="Town / area served (optional — e.g. “Leeds”) — powers local SEO" autocomplete="off" spellcheck="false" style="flex:1;min-width:200px;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font:inherit;font-size:.85rem">
        </div>
        <input id="aiSiteUrl" class="ai-in" placeholder="Your current website URL (optional) — the AI opens it, keeps the brand, contact details, services & content, and rebuilds it better" autocomplete="off" spellcheck="false">
        <div class="ai-upload">
          <div class="ai-upload-head">
            <span class="up-title">📸 Your own photos <small>optional — used first: 1st → hero, 2nd → about, the rest → gallery</small></span>
            <label for="aiFile" class="btn ghost small up-add">＋ Add photos</label>
          </div>
          <input type="file" id="aiFile" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden>
          <div class="upload-drop" id="aiDrop">Drop photos here or click — they're used before anything else, in the order shown</div>
          <div class="upload-grid" id="aiUploadGrid"></div>
        </div>
        <div class="chip-row" id="aiChips"></div>
        <div class="ai-opts">
          <select id="aiPack" title="Finish the site with a signature look"><option value="">No style pack</option>${AI.stylePacks.map((p) => `<option value="${p.id}">${p.icon} ${p.name}</option>`).join('')}</select>
          <select id="aiFlavor" title="How the AI arranges sections"><option value="auto">✦ Auto — AI picks creative layouts</option><option value="classic">Classic layouts only</option></select>
          <select id="aiPhoto" title="Where the site's photos come from">
            <option value="real">📷 Real photos from the web — topic-matched (recommended)</option>
            <option value="ai">🎨 AI-generated art</option>
            <option value="none">No photos (clean, minimal)</option>
          </select>
        </div>
        <div class="ai-gen-actions">
          <button class="btn primary ai-run" id="aiRun" ${aiBusy ? 'disabled' : ''}>✦ Generate site</button>
          <button class="btn ghost ai-directions" id="aiDirections" ${aiBusy ? 'disabled' : ''}>🧭 Explore 3 directions <small>(1 credit)</small></button>
        </div>
        <div class="ai-progress" id="aiProgress" hidden></div>
        <div class="ai-result" id="aiResult" hidden></div>
      </div>
      <div class="ai-card">
        <h3>Quick magic${c ? ' on “' + esc(c.site.name) + '”' : ''}</h3>
        <p class="sub">Upgrade a finished site without touching the design.</p>
        <div class="ai-actions">
          <button class="btn ghost" id="aiImagesReal" ${c ? '' : 'disabled'}>📷 Topic-matched real photos <small>(1 credit)</small></button>
          <button class="btn ghost" id="aiImagesAi" ${c ? '' : 'disabled'}>🎨 AI-generated images <small>(1 credit)</small></button>
          <button class="btn ghost" id="aiPickBtn" ${c ? '' : 'disabled'}>🖼 Pick & choose photos <small>(1 credit)</small></button>
          <button class="btn ghost" id="aiEnhance" ${c ? '' : 'disabled'}>✨ Enhance copy with AI <small>(1 credit)</small></button>
          <button class="btn ghost" id="aiRestyleBtn" ${c ? '' : 'disabled'}>🎭 AI restyle <small>(1 credit)</small></button>
          <button class="btn ghost" id="aiLogoBtn" ${c ? '' : 'disabled'}>◆ AI logo <small>(free)</small></button>
          <button class="btn ghost" id="aiStudioBtn" ${c ? '' : 'disabled'}>🎨 Logo studio <small>(free)</small></button>
          <button class="btn ghost" id="aiAltBtn" ${c ? '' : 'disabled'}>🏷 Alt text for all images <small>(free)</small></button>
        </div>
        <div class="ai-quick">
          <h4 style="font-size:.8rem;color:var(--muted);margin:14px 0 4px">Starter prompts</h4>
          <ul id="aiQuickList"></ul>
        </div>
      </div>`;

    const chips = $('#aiChips');
    chips.innerHTML = AI_CHIPS.map((ch, i) => `<button class="chip-btn ${i === 0 ? 'active' : ''}" data-chip="${i}">${esc(ch.label)}</button>`).join('');
    $$('#aiChips [data-chip]').forEach((b) => b.onclick = () => {
      $$('#aiChips .chip-btn').forEach((x) => x.classList.toggle('active', x === b));
      $('#aiPrompt').value = AI_CHIPS[+b.dataset.chip].prompt;
    });
    const quick = $('#aiQuickList');
    quick.innerHTML = ['A modern bakery in Paris', 'A fitness studio for busy professionals', 'A travel agency for mountain adventures']
      .map((q) => `<li><span>${esc(q)}</span><button class="btn ghost small" data-quick="${esc(q)}">Use</button></li>`).join('');
    $$('[data-quick]').forEach((b) => b.onclick = () => { $('#aiPrompt').value = b.dataset.quick; $('#aiRun').scrollIntoView({ behavior: 'smooth', block: 'center' }); });

    const urlInp = $('#aiSiteUrl');
    if (urlInp) {
      urlInp.value = aiSiteUrl;
      urlInp.addEventListener('input', () => { aiSiteUrl = urlInp.value.trim(); });
    }
    const fileInp = $('#aiFile');
    if (fileInp) fileInp.addEventListener('change', () => { addAIFiles(fileInp.files); fileInp.value = ''; });
    const dropEl = $('#aiDrop');
    if (dropEl) {
      dropEl.addEventListener('click', () => { if (fileInp) fileInp.click(); });
      dropEl.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropEl.classList.add('over'); });
      dropEl.addEventListener('dragleave', () => dropEl.classList.remove('over'));
      dropEl.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation(); dropEl.classList.remove('over');
        addAIFiles(e.dataTransfer && e.dataTransfer.files);
      });
    }
    renderUploads();
    $('#aiRun').onclick = runAI;
    $('#aiDirections').onclick = openDirectionLab;
    $('#aiImagesReal').onclick = () => aiImages('real');
    $('#aiImagesAi').onclick = () => aiImages('ai');
    $('#aiPickBtn').onclick = aiPickPhotos;
    $('#aiEnhance').onclick = aiEnhance;
    $('#aiRestyleBtn').onclick = aiRestyle;
    $('#aiLogoBtn').onclick = aiLogoNow;
    $('#aiStudioBtn').onclick = () => { const cc = current(); if (!cc) return toast('Open a project first'); openLogoStudio(cc); };
    $('#aiAltBtn').onclick = aiAltNow;

    if (proj) {
      const res = $('#aiResult');
      res.hidden = false;
      const nicheTag = proj.aiNiche ? `<span class="chip" style="background:color-mix(in srgb,var(--accent) 16%,transparent);border-color:color-mix(in srgb,var(--accent) 40%,transparent)">🗂 ${esc(proj.aiNiche)} pack</span>` : '';
      res.innerHTML = `<span>✦ “${esc(proj.site.name)}” generated from “${esc(lastAI.prompt.slice(0, 48))}${lastAI.prompt.length > 48 ? '…' : ''}”</span>${nicheTag}<button class="btn primary small" id="aiOpen">Open in Designer</button>`;
      $('#aiOpen').onclick = () => { currentId = proj.id; selectedSec = null; switchView('designer'); };
    }
  }

  const AI_STEPS = ['Reading your prompt…', 'Understanding the business…', 'Choosing palette & typography…', 'Writing the copy…', 'Assembling the sections…'];

  // ---------- AI Studio photo bank (own photos, compressed locally) ----------
  // Photos run through the GPUImage module (modules/gpuimage.js): WebGPU
  // downscale when available, otherwise the identical canvas routine below.
  const MAX_AI_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_AI_TOTAL_BYTES = 80 * 1024 * 1024;
  function compressPhoto(file, maxW = 1280, thumbMax = 300, q = 0.78) {
    if (typeof GPUImage !== 'undefined') {
      return GPUImage.process(file, { maxW, thumbMax, q }).catch(() => null);
    }
    return legacyCompressPhoto(file, maxW, thumbMax, q); // older builds
  }
  function legacyCompressPhoto(file, maxW, thumbMax, q) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      const done = (v) => { try { URL.revokeObjectURL(url); } catch (e) { /* noop */ } resolve(v); };
      img.onload = () => {
        try {
          const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
          if (!w0 || !h0) return done(null);
          const sc = Math.min(1, maxW / Math.max(w0, h0));
          const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const cx = cv.getContext('2d');
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
          cx.drawImage(img, 0, 0, w, h);
          const data = cv.toDataURL('image/jpeg', q);
          const ts = Math.min(1, thumbMax / Math.max(w0, h0));
          const tw = Math.max(1, Math.round(w0 * ts)), th = Math.max(1, Math.round(h0 * ts));
          const tv = document.createElement('canvas');
          tv.width = tw; tv.height = th;
          const tx = tv.getContext('2d');
          tx.fillStyle = '#fff'; tx.fillRect(0, 0, tw, th);
          tx.drawImage(img, 0, 0, tw, th);
          done({ data, thumb: tv.toDataURL('image/jpeg', 0.72), name: file.name || 'photo.jpg', w, h });
        } catch (e) { done(null); }
      };
      img.onerror = () => done(null);
      img.src = url;
    });
  }

  async function addAIFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f && /^image\/(jpeg|png|webp|gif)/i.test(f.type));
    if (!files.length) return toast('Add photo files (JPG, PNG, WebP) 🖼️');
    if (aiUploads.length >= 10) return toast('Up to 10 photos — remove one first');
    const existingBytes = aiUploads.reduce((total, item) => total + Number(item.sourceBytes || 0), 0);
    const accepted = [];
    let incomingBytes = existingBytes;
    for (const f of files.slice(0, 10 - aiUploads.length)) {
      if (Number(f.size) > MAX_AI_FILE_BYTES) {
        toast('“' + (f.name || 'This image') + '” is larger than 20 MB — choose a smaller file.', false);
        continue;
      }
      if (incomingBytes + Number(f.size || 0) > MAX_AI_TOTAL_BYTES) {
        toast('Uploads are limited to 80 MB at a time — remove a photo or choose smaller files.', false);
        break;
      }
      accepted.push(f);
      incomingBytes += Number(f.size || 0);
    }
    const cards = accepted.map((f) => ({
      file: f,
      card: { data: '', thumb: '', name: f.name || 'photo.jpg', w: 0, h: 0, sourceBytes: Number(f.size || 0) }
    }));
    cards.forEach(({ card }) => aiUploads.push(card));
    renderUploads();
    // Image decoding is CPU/GPU work. Two workers improve batch latency without
    // opening a large decode burst or freezing the renderer on weaker machines.
    let next = 0;
    const worker = async () => {
      while (next < cards.length) {
        const item = cards[next++];
        const done = await compressPhoto(item.file);
        const index = aiUploads.indexOf(item.card);
        if (done) {
          item.card.data = done.data; item.card.thumb = done.thumb; item.card.name = done.name;
          item.card.w = done.w || 0; item.card.h = done.h || 0;
        } else {
          // The user may remove a card while it is processing. Never use
          // splice(-1, 1), which would accidentally remove the last upload.
          if (index >= 0) aiUploads.splice(index, 1);
          toast('Could not read “' + (item.file.name || 'file') + '” — try a JPG or PNG', false);
        }
        renderUploads();
      }
    };
    await Promise.all([worker(), worker()]);
  }

  function renderUploads() {
    const grid = $('#aiUploadGrid');
    if (!grid) return;
    const drop = $('#aiDrop');
    if (drop) drop.style.display = aiUploads.length ? 'none' : '';
    grid.innerHTML = aiUploads.map((u, i) => `
      <div class="upload-card">
        ${u.thumb ? `<img src="${u.thumb}" loading="lazy" decoding="async" alt="">` : '<div class="upload-thumb-ph">…</div>'}
        <div class="upload-role">${i === 0 ? 'Hero' : i === 1 ? 'About' : 'Gallery'}</div>
        <div class="upload-name" title="${esc(u.name)}">${esc(u.name)}</div>
        <div class="upload-ctrls">
          <button class="btn ghost small" data-mv="${i}" data-dir="-1" title="Move earlier">◀</button>
          <button class="btn ghost small" data-mv="${i}" data-dir="1" title="Move later">▶</button>
          <button class="btn danger small" data-del="${i}" title="Remove">✕</button>
        </div>
      </div>`).join('');
    $$('#aiUploadGrid [data-del]').forEach((b) => b.onclick = () => { aiUploads.splice(+b.dataset.del, 1); renderUploads(); });
    $$('#aiUploadGrid [data-mv]').forEach((b) => b.onclick = () => {
      const i = +b.dataset.mv, d = +b.dataset.dir, j = i + d;
      if (j < 0 || j >= aiUploads.length) return;
      const t = aiUploads[i]; aiUploads[i] = aiUploads[j]; aiUploads[j] = t;
      renderUploads();
    });
  }

  // ---------------- Design Direction Lab ----------------
  // Directions are lightweight, editable drafts. Only the chosen direction is
  // persisted as a project; exploration never creates duplicates in storage.
  function directionOptions(website) {
    const name = ($('#aiName') && $('#aiName').value.trim()) || '';
    const area = ($('#aiArea') && $('#aiArea').value.trim()) || '';
    const packId = ($('#aiPack') && $('#aiPack').value) || '';
    const photoMode = ($('#aiPhoto') && $('#aiPhoto').value) || 'real';
    return {
      layouts: ($('#aiFlavor') && $('#aiFlavor').value) === 'classic' ? 'classic' : 'auto',
      tier: isPro() ? 'pro' : 'free',
      name: name || undefined,
      area: area || undefined,
      website: website || undefined,
      packId,
      photoMode,
      photos: aiUploads.filter((u) => u && u.data).map((u) => u.data)
    };
  }

  function directionCard(project, index, selected) {
    const pal = DB.getPalette(project.site.palette);
    const profile = AI.DIRECTION_PROFILES.find((d) => d.id === project.directionId) || {};
    const sections = project.site.sections || [];
    const hero = sections.find((s) => s.type === 'hero') || {};
    const font = DB.getFont(project.site.font) || { name: project.site.font || 'Inter' };
    const display = project.site.fontDisplay ? (DB.getFont(project.site.fontDisplay) || {}).name : '';
    const order = sections.slice(0, 6).map((s) => (DB.sectionTypes[s.type] || {}).name || s.type).join(' · ');
    const title = profile.label || project.directionName || ('Direction ' + (index + 1));
    const blurb = profile.blurb || project.directionBlurb || 'A fresh, considered direction for this brief.';
    const heroTitle = project.site.name || 'Your brand';
    const heroSub = project.site.tagline || 'A considered first impression.';
    return `<article class="direction-card ${selected ? 'selected' : ''}" data-direction-card="${index}">
      <div class="direction-art" style="--dir-bg:${pal.bg};--dir-surface:${pal.surface};--dir-primary:${pal.primary};--dir-accent:${pal.accent};--dir-text:${pal.text}">
        <div class="direction-art-nav"><span style="background:${pal.primary}"></span><i></i><i></i><i></i></div>
        <div class="direction-art-copy"><small>${esc(hero.eyebrow || project.site.eyebrow || title)}</small><b>${esc(heroTitle)}</b><em>${esc(heroSub.slice(0, 88))}${heroSub.length > 88 ? '…' : ''}</em><strong style="background:${pal.primary}"></strong><u style="background:${pal.accent}"></u></div>
        <div class="direction-art-blocks"><span style="background:${pal.primary}"></span><span style="background:${pal.accent}"></span><span style="background:${pal.surface}"></span></div>
      </div>
      <div class="direction-info"><div class="direction-heading"><span class="direction-icon">${profile.icon || '✦'}</span><div><h4>${esc(title)}</h4><p>${esc(blurb)}</p></div></div>
        <div class="direction-swatches"><span style="background:${pal.bg}"></span><span style="background:${pal.surface}"></span><span style="background:${pal.primary}"></span><span style="background:${pal.accent}"></span><small>${esc(pal.name)}</small></div>
        <div class="direction-meta"><span><b>Look</b>${esc(project.dnaLook || project.directionId || 'custom')}</span><span><b>Type</b>${esc(font.name)}${display ? ' + ' + esc(display) : ''}</span><span><b>Flow</b>${esc(order || 'Hero · content · contact')}</span></div>
      </div>
      <div class="direction-actions"><button class="btn ${selected ? 'primary' : 'ghost'} small" data-direction-use="${index}">${selected ? '✓ Selected' : 'Choose this direction'}</button><button class="btn ghost small" data-direction-remix="${index}">↻ Remix <small>(1 credit)</small></button></div>
    </article>`;
  }

  function renderDirectionLab() {
    const st = directionState;
    if (!st || !st.drafts) return;
    const selected = Math.max(0, Math.min(st.selected || 0, st.drafts.length - 1));
    st.selected = selected;
    const cards = st.drafts.map((p, i) => directionCard(p, i, i === selected)).join('');
    openModal('🧭 Design Direction Lab', `
      <div class="direction-intro"><span class="direction-lab-mark">🧭</span><div><b>Three ways to make the same brief unforgettable.</b><p>${esc(st.prompt)}${st.studied ? ' · current site studied' : ''}</p></div></div>
      <div class="direction-grid">${cards}</div>
      <div class="direction-footer"><span>Choose one to open it in the Designer. Remixing replaces only that draft; nothing is saved until you choose.</span><div><button class="btn ghost small" id="directionCancel">Keep exploring later</button><button class="btn primary small" id="directionChoose">✓ Use selected direction</button></div></div>`, true);
    $$('[data-direction-card]').forEach((card) => card.onclick = () => { directionState.selected = +card.dataset.directionCard; renderDirectionLab(); });
    $$('[data-direction-use]').forEach((button) => button.onclick = (e) => { e.stopPropagation(); chooseDirection(+button.dataset.directionUse); });
    $$('[data-direction-remix]').forEach((button) => button.onclick = (e) => { e.stopPropagation(); remixDirection(+button.dataset.directionRemix); });
    $('#directionCancel').onclick = closeModal;
    $('#directionChoose').onclick = () => chooseDirection(st.selected);
  }

  async function openDirectionLab() {
    if (aiBusy || (directionState && directionState.busy)) return;
    const prompt = ($('#aiPrompt') && $('#aiPrompt').value.trim()) || (current() && current().site.tagline) || '';
    if (!prompt) return toast('Describe the site before exploring directions ✍️');
    if (!ensureProjectCapacity()) return;
    if (!spendCredit()) return;
    const siteUrl = (($('#aiSiteUrl') && $('#aiSiteUrl').value.trim()) || aiSiteUrl).trim();
    const opts = directionOptions(null);
    const state = { busy: true, prompt, siteUrl, opts, drafts: null, selected: 0, studied: false, cancelled: false };
    directionState = state;
    setAIBusy(true);
    openModal('🧭 Design Direction Lab', `
      <div class="direction-loading"><span class="spinner"></span><b>Art-directing three contrasting directions…</b><p>Comparing palettes, typography, hero composition and section rhythm for this brief.</p></div>`, true);
    try {
      let website = null;
      if (siteUrl && AI.studySite) {
        const studyController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        state.studyController = studyController;
        const result = await AI.studySite(siteUrl, undefined, {
          signal: studyController ? studyController.signal : undefined,
          timeoutMs: 8500
        }).catch(() => null);
        if (directionState !== state || state.cancelled) return;
        website = result && result.ok ? result : null;
      }
      if (directionState !== state || state.cancelled) return;
      const finalOpts = directionOptions(website);
      const drafts = AI.generateDirections(prompt, finalOpts);
      if (directionState !== state || state.cancelled) return;
      const pack = finalOpts.packId;
      if (pack) drafts.forEach((draft) => { /* apply after selection so directions stay distinct */ draft.directionPack = pack; });
      directionState = { ...state, busy: false, opts: finalOpts, drafts, selected: 0, studied: !!website, website };
      setAIBusy(false);
      renderDirectionLab();
    } catch (e) {
      // Closing the modal already refunded the reserved credit and cleared the
      // state; do not refund a second time when a late request rejects.
      if (directionState !== state || state.cancelled) return;
      refundCredit();
      directionState = null;
      setAIBusy(false);
      closeModal();
      toast('The direction lab could not finish — your credit was refunded. Try again.', false);
    }
  }

  function remixDirection(index) {
    const st = directionState;
    if (!st || !st.drafts || !st.drafts[index]) return;
    if (!spendCredit()) return;
    try {
      const next = AI.remixDirection(st.drafts[index], {
        tier: isPro() ? 'pro' : 'free',
        seed: Date.now() + index * 7919
      });
      if (!next) {
        refundCredit();
        return toast('Could not remix that direction — credit refunded', false);
      }
      next.directionPack = st.opts.packId || '';
      st.drafts[index] = next;
      st.selected = index;
      renderDirectionLab();
    } catch (e) {
      refundCredit();
      console.error('AI direction remix failed', e);
      toast('The direction remix failed — your credit was refunded. Try again.', false);
    }
  }

  function chooseDirection(index) {
    const st = directionState;
    if (!st || !st.drafts || !st.drafts[index]) return;
    if (!ensureProjectCapacity()) return;
    const chosen = JSON.parse(JSON.stringify(st.drafts[index]));
    const pack = st.opts.packId || chosen.directionPack;
    if (pack) AI.applyStylePack(chosen, pack);
    chosen.id = 'ai_' + uid();
    chosen.createdAt = chosen.updatedAt = Date.now();
    chosen.name = (chosen.site.name || 'AI direction') + ' — Website';
    projects.unshift(chosen);
    saveProjects();
    currentId = chosen.id;
    selectedSec = null;
    lastAI = { id: chosen.id, prompt: st.prompt };
    const photos = st.opts.photos || [];
    const photoMode = st.opts.photoMode || 'real';
    const siteImages = st.website ? (st.website.images || []) : [];
    directionState = null;
    closeModal();
    refreshEntitlements();
    switchView('designer');
    toast('✦ “' + chosen.site.name + '” direction selected — now make it yours', true);
    if (photoMode !== 'none' || photos.length) runSitePhotos(chosen, st.prompt, photoMode, { photos, siteImages, openPicker: photoMode === 'real' });
  }

  async function runAI() {
    if (aiBusy || (directionState && directionState.busy)) return;
    const prompt = ($('#aiPrompt') && $('#aiPrompt').value.trim()) || '';
    if (!prompt) return toast('Describe the site you want first ✍️');
    if (!ensureProjectCapacity()) return;
    if (!spendCredit()) return;
    setAIBusy(true);
    const siteUrl = (($('#aiSiteUrl') && $('#aiSiteUrl').value.trim()) || aiSiteUrl).replace(/^\s+|\s+$/g, '');
    const photos = aiUploads.filter((u) => u && u.data).map((u) => u.data);
    const steps = siteUrl
      ? ['Reading your prompt…', 'Studying your current website…', 'Understanding the business…', 'Choosing palette & typography…', 'Writing the copy…', 'Assembling the sections…']
      : AI_STEPS;
    const box = $('#aiProgress');
    let website = null;
    let committed = false;
    try {
      if (box) {
        box.hidden = false;
        box.innerHTML = steps.map((t, i) => `<div class="ai-step" id="aiStep${i}"><span class="spinner"></span>${t}</div>`).join('');
      }
      for (let i = 0; i < steps.length; i++) {
        const el = $('#aiStep' + i);
        if (el) el.classList.add('on');
        if (steps[i].indexOf('Studying') === 0) {
          // give the site a real chance: direct fetch is usually CORS-blocked, so
          // studySite falls back to a proxy within the same total deadline
          aiStudyController = typeof AbortController !== 'undefined' ? new AbortController() : null;
          website = await AI.studySite(siteUrl, undefined, {
            signal: aiStudyController ? aiStudyController.signal : undefined,
            timeoutMs: 8500
          });
          aiStudyController = null;
        } else {
          await new Promise((r) => setTimeout(r, 430));
        }
        const done = $('#aiStep' + i);
        if (done) { done.classList.add('done'); done.classList.remove('on'); }
      }
      const packId = $('#aiPack') ? $('#aiPack').value : '';
      const flavor = $('#aiFlavor') ? $('#aiFlavor').value : 'auto';
      const photoMode = ($('#aiPhoto') && $('#aiPhoto').value) || 'real';
      const bizName = ($('#aiName') && $('#aiName').value.trim()) || '';
      const bizArea = ($('#aiArea') && $('#aiArea').value.trim()) || '';
      const p = AI.generateSite(prompt, {
        layouts: flavor === 'classic' ? 'classic' : 'auto',
        tier: isPro() ? 'pro' : 'free',
        name: bizName || undefined,
        area: bizArea || undefined,
        website: website || undefined
      });
      if (!p || !p.site) throw new Error('AI returned no project');
      if (packId) AI.applyStylePack(p, packId);
      projects.unshift(p);
      saveProjects();
      committed = true;
      currentId = p.id;
      selectedSec = null;
      lastAI = { id: p.id, prompt };
      setAIBusy(false);
      if (box) box.hidden = true;
      switchView('designer');
      if (siteUrl) {
        if (!website) {
          toast('⚠ Could not read that website — the site was generated from your prompt alone', false);
        } else {
          const host = (website.url || siteUrl).replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '');
          toast('✦ Studied ' + host + ' — brand, contact, services, FAQ & photos lifted, then rebuilt better', true);
        }
      } else {
        toast('✦ AI Studio built “' + p.site.name + '”', true);
      }
      if (photoMode !== 'none' || photos.length) {
        runSitePhotos(p, prompt, photoMode, { photos, siteImages: website ? (website.images || []) : [], openPicker: photoMode === 'real' });
      }
    } catch (e) {
      if (aiStudyController) { aiStudyController.abort(); aiStudyController = null; }
      if (!committed) refundCredit();
      setAIBusy(false);
      if (box) box.hidden = true;
      const run = $('#aiRun');
      const directions = $('#aiDirections');
      if (run) run.disabled = false;
      if (directions) directions.disabled = false;
      console.error('AI generation failed', e);
      toast(committed ? 'The site opened, but one finishing step failed — your project is safe.' : 'The site could not be generated — your credit was refunded. Try again.', false);
    }
  }

  // Photo pass after generation — real topic-matched photos by default,
  // Pollinations AI art when the user opts in. Runs in the background so the
  // site opens instantly; the toast reports exactly what was placed.
  async function runSitePhotos(p, prompt, source, extra) {
    const opts = extra || {};
    const hasLocal = !!(opts.photos && opts.photos.length);
    if (settings.onlineEnabled === false && !hasLocal) {
      toast('📡 Photos need an internet connection — add them any time from Database ▸ Online sources', false);
      return;
    }
    let out;
    try {
      out = await AI.generateImages(p, prompt, Object.assign({ source, online: settings.onlineEnabled !== false }, opts));
    } catch (e) {
      refundCredit();
      renderPlanPill();
      console.error('AI photo pass failed', e);
      toast('The photo pass failed — your credit was refunded. Try again in a moment.', false);
      return;
    }
    touch(p);
    refreshEntitlements();
    const ok = (out.hero ? 1 : 0) + (out.about ? 1 : 0) + out.gallery;
    if (ok === 0) {
      refundCredit();
      renderPlanPill();
      toast('Could not fetch photos right now — credit refunded. Try again in a moment.', false);
      return;
    }
    const phrase = source === 'ai'
      ? ok + ' AI-generated photos in place'
      : source === 'none'
        ? ok + ' of your uploaded photos in place'
        : ok + ' real, topic-matched photos in place';
    const what = [out.hero ? 'hero' : '', out.about ? 'about' : '', out.gallery ? out.gallery + ' gallery' : ''].filter(Boolean).join(', ');
    toast('Photos ready — ' + phrase + ': ' + what + ' 🖼️', true);
    // after a fresh real-photo run, let the creator fine-tune which photos
    // land where — the engine already picked well, they get the final say
    if (opts.openPicker && source === 'real' && ok > 0 && current() === p) {
      openPhotoPicker(p, prompt, { auto: true });
    }
  }

  // ---------------- Photo picker ----------------
  // Opens a modal of real candidate photos per slot (hero / about / each
  // gallery tile). Clicking a candidate swaps it in live; Apply commits all
  // changes. From the AI Studio “Pick & choose photos” action one credit is
  // charged per apply (mirrors the topic-matched-photos action).
  let pickState = null;

  function renderPicks() {
    const st = pickState;
    const root = $('#pickRoot');
    if (!st || !root) return;
    let changed = 0;
    st.slots.forEach((s) => { if (s.picked && s.picked !== s.cur) changed++; });
    const status = $('#pickStatus');
    if (status) {
      status.textContent = st.slots.length
        ? 'Tap a photo to swap it in — ' + st.slots.length + ' spots shown. Click the shuffle button to roll more suggestions.'
        : 'No photo spots found in this project — add a hero, about or gallery section first.';
    }
    root.innerHTML = st.slots.map((s, i) => {
      const n = Math.max(0, (s.pool || []).length);
      const off = s.off == null ? 0 : s.off;
      // the “current” photo always leads the row so you can see (and keep)
      // what the AI picked; suggestions follow behind it
      const backToCur = !s.picked || s.picked === s.cur;
      const curTile = s.cur
        ? `<div class="pt${backToCur ? ' on cur' : ''}" data-si="${i}" data-cur="1" title="Current photo — tap to keep it">
            <img src="${esc(s.cur)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.pt').classList.add('dead')">
            <div class="pt-badge">${backToCur ? '●' : ''}</div>
          </div>` : '';
      const sugg = (s.pool || []).filter((c) => c.url !== s.cur);
      const m = sugg.length;
      const win = m ? Array.from({ length: Math.min(m, 4) }, (_, j) => sugg[(off + j) % m]) : [];
      const tiles = win.map((c) => {
        const on = s.picked === c.url;
        const cls = 'pt' + (on ? ' on' : '');
        return `<div class="${cls}" data-si="${i}" data-url="${esc(c.url)}" data-src="${esc(c.src || 'Web')}" title="Use this photo">
          <img src="${esc(c.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.pt').classList.add('dead')">
          <div class="pt-badge">${on ? '✓' : ''}</div>
        </div>`;
      }).join('');
      const reset = s.picked && s.picked !== s.cur ? `<button class="btn ghost small" data-reset="${i}">↺ back to auto</button>` : '';
      return `<div class="pick-slot">
        <div class="pick-slot-head"><b>${esc(s.label)}</b>${reset}</div>
        <div class="pick-grid">${curTile}${tiles || '<span class="pick-empty">No suggestions loaded — check your connection or shuffle.</span>'}</div>
      </div>`;
    }).join('') || '<p class="pick-empty">Nothing to pick — this project has no photo slots.</p>';
    const apply = $('#pickApply');
    if (apply) {
      apply.disabled = changed === 0;
      apply.textContent = changed ? '✓ Apply ' + changed + ' change' + (changed === 1 ? '' : 's') : '✓ No changes yet';
    }
    $$('#pickRoot .pt[data-url]').forEach((el) => el.onclick = () => {
      const s = pickState.slots[+el.dataset.si];
      s.picked = el.dataset.url; s.pickedSrc = el.dataset.src;
      renderPicks();
    });
    $$('#pickRoot .pt[data-cur]').forEach((el) => el.onclick = () => {
      const s = pickState.slots[+el.dataset.si];
      s.picked = s.cur; s.pickedSrc = s.curSrc;
      renderPicks();
    });
    $$('#pickRoot [data-reset]').forEach((el) => el.onclick = () => {
      const s = pickState.slots[+el.dataset.reset];
      s.picked = s.cur; s.pickedSrc = s.curSrc;
      renderPicks();
    });
    // live-preview the swap in the section editor? no — commit only on Apply
  }

  function shufflePicks() {
    const st = pickState;
    if (!st) return;
    st.slots.forEach((s) => {
      const n = (s.pool || []).length;
      if (n > 3) {
        s.off = ((s.off == null ? -1 : s.off) + 3) % n;
      } else {
        s.off = 0;
      }
    });
    renderPicks();
  }

  function closePicks() {
    pickState = null;
    closeModal();
  }

  function applyPicks() {
    const st = pickState;
    if (!st) return;
    const live = new Set();
    const addLive = (section) => {
      if (!section || live.has(section)) return;
      live.add(section);
      (section.items || []).forEach((item) => { if (item && typeof item === 'object') live.add(item); });
    };
    (st.project && st.project.site && st.project.site.sections || []).forEach(addLive);
    const changes = st.slots.filter((s) => s.sec && live.has(s.sec) && s.picked && s.picked !== s.cur);
    if (!changes.length) {
      toast('No photo changes to apply');
      closePicks();
      return;
    }
    if (st.standalone && !spendCredit()) return;
    changes.forEach((s) => {
      s.sec.image = s.picked;
      const src = s.picked && s.picked.slice(0, 5) === 'data:' ? 'Your photo' : (s.pickedSrc || 'Web');
      s.sec.imageSource = src;
    });
    const c = st.project;
    if (c && projects.some((project) => project && project.id === c.id)) {
      touch(c);
      if (current() === c) renderEditor();
    }
    const n = changes.length;
    pickState = null;
    closeModal();
    toast(n + ' photo' + (n === 1 ? ' swapped' : 's swapped') + ' — check the preview 🖼️', true);
  }

  async function openPhotoPicker(project, prompt, o) {
    const opts = o || {};
    const st = { project, prompt: String(prompt || '').trim() || project.site.name + ' — ' + project.site.tagline, standalone: !!opts.standalone, slots: null, loaded: false };
    pickState = st;
    openModal('🖼 Pick your photos', `
      <p style="color:var(--muted);margin:0 0 10px">Real, topic-matched photos for each spot. Tap a photo to try it — Apply commits every swap. ${st.standalone ? 'One credit per apply.' : ''}</p>
      <div id="pickStatus" style="color:var(--muted);font-size:.8rem;margin-bottom:8px">Finding candidate photos…</div>
      <div id="pickRoot" style="min-height:120px"><span class="spinner" style="margin:40px auto"></span></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
        <button class="btn primary" id="pickApply" disabled>✓ No changes yet</button>
        <button class="btn ghost" id="pickShuffle">🎲 Shuffle suggestions</button>
        <button class="btn ghost" id="pickKeep">Keep current photos</button>
      </div>`, true);
    $('#pickShuffle').onclick = shufflePicks;
    $('#pickKeep').onclick = closePicks;
    $('#pickApply').onclick = applyPicks;
    let slots = [];
    try {
      slots = await AI.photoPicks(project, { prompt: st.prompt, online: settings.onlineEnabled !== false });
    } catch (e) {
      slots = [];
    }
    if (pickState !== st) return; // closed while loading
    st.slots = slots;
    st.loaded = true;
    const status = $('#pickStatus');
    if (status) status.textContent = '';
    renderPicks();
  }

  async function aiPickPhotos() {
    const c = current();
    if (!c) return toast('Open a project first');
    if (settings.onlineEnabled === false) return toast('📡 Photo picking needs an internet connection — enable it in Database ▸ Online sources', false);
    const prompt = ($('#aiPrompt') && $('#aiPrompt').value.trim()) || c.site.name + ' — ' + c.site.tagline;
    openPhotoPicker(c, prompt, { standalone: true });
  }

  async function aiImages(source) {
    const c = current();
    if (!c) return toast('Open a project first');
    if (!spendCredit()) return;
    const src = source === 'ai' ? 'ai' : 'real';
    const btnId = src === 'ai' ? 'aiImagesAi' : 'aiImagesReal';
    const btn = $('#' + btnId);
    if (btn) { btn.disabled = true; btn.textContent = src === 'ai' ? '🎨 Generating… (~20s)' : '📷 Finding real photos…'; }
    const prompt = ($('#aiPrompt') && $('#aiPrompt').value.trim()) || c.site.name + ' — ' + c.site.tagline;
    const bank = aiUploads.filter((u) => u && u.data).map((u) => u.data);
    let out;
    try {
      out = await AI.generateImages(c, prompt, { source: src, online: settings.onlineEnabled !== false, photos: bank });
    } catch (e) {
      refundCredit();
      refreshEntitlements();
      console.error('Quick photo pass failed', e);
      toast(src === 'ai' ? 'Could not reach the AI image service — credit refunded' : 'Could not find real photos right now — credit refunded', false);
      out = null;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = src === 'ai'
        ? '🎨 AI-generated images <small>(1 credit)</small>'
        : '📷 Topic-matched real photos <small>(1 credit)</small>';
    }
    if (!out) return;
    const ok = (out.hero ? 1 : 0) + (out.about ? 1 : 0) + out.gallery;
    if (ok === 0) {
      refundCredit();
      refreshEntitlements();
      toast(src === 'ai' ? 'Could not reach the AI image service — check your connection' : 'Could not find real photos right now — credit refunded', false);
    } else {
      touch(c);
      refreshEntitlements();
      toast(src === 'ai'
        ? `AI images ready — hero ${out.hero ? '✓' : '–'}, about ${out.about ? '✓' : '–'}, gallery ${out.gallery} 🎨`
        : `Real photos placed — hero ${out.hero ? '✓' : '–'}, about ${out.about ? '✓' : '–'}, gallery ${out.gallery} 📷`, true);
    }
  }

  async function aiRestyle() {
    const c = current();
    if (!c) return toast('Open a project first');
    if (!spendCredit()) return;
    const prompt = ($('#aiPrompt') && $('#aiPrompt').value.trim()) || c.site.name + ' — ' + c.site.tagline;
    const r = AI.restyle(c, prompt, isPro() ? 'pro' : 'free');
    histCapture();
    touch(c);
    refreshEntitlements();
    toast('Restyled — ' + DB.getPalette(r.palette).name + ' · ' + DB.getFont(r.font).name + ' 🎭', true);
  }

  function aiLogoNow() {
    const c = current();
    if (!c) return toast('Open a project first');
    histCapture();
    AI.logo(c);
    touch(c);
    refreshEntitlements();
    toast('AI logo generated ◆', true);
  }

  // ---------------- Logo Studio ----------------
  let logoStudio = null;
  function openLogoStudio(c) {
    logoStudio = { ...AI.randomLogoSpec(c), project: c };
    renderLogoStudio();
  }
  function logoStudioUri() {
    const p = logoStudio;
    if (!p) return '';
    return AI.logoPreview(p.project, { style: p.style, shape: p.shape, font: p.font, colors: p.colors, text: p.text, seed: p.seed });
  }
  function renderLogoStudio() {
    const p = logoStudio;
    if (!p) return;
    const uri = logoStudioUri();
    const shapeable = (AI.LOGO_STYLES.find((s) => s.id === p.style) || {}).shapeable;
    const pairs = AI.LOGO_DUOTONES.map((d) => {
      const active = d.id === 'auto' && p.pair === undefined ? true : p.pair === d.id;
      const sw = d.c ? d.c.map((col) => `<span style="background:${col}"></span>`).join('') : `<span style="background:linear-gradient(135deg,#7c5cff,#22d3ee)"></span>`;
      return `<button class="lo-pair ${active ? 'active' : ''}" data-pair="${d.id}" title="${esc(d.name)}">${sw}</button>`;
    }).join('');
    openModal('🎨 Logo studio', `
      <div class="lo-wrap">
        <div class="lo-preview">
          <div class="lo-stage"><img src="${uri}" alt="Logo preview" id="loImg"></div>
          <p class="lo-hint">Live preview — “Made by PallettAI” sites keep your logo in the nav and footer.</p>
        </div>
        <div class="lo-controls">
          <div class="field"><label>Style</label>
            <div class="lo-styles">${AI.LOGO_STYLES.map((s) => `<button class="lo-style ${s.id === p.style ? 'active' : ''}" data-style="${s.id}">${esc(AI.STYLE_GLYPHS[s.id])}<span>${esc(s.name)}</span></button>`).join('')}</div>
          </div>
          ${shapeable ? `<div class="field"><label>Shape</label>
            <select id="loShape">${AI.LOGO_SHAPES.map((sh) => `<option value="${sh}" ${sh === p.shape ? 'selected' : ''}>${sh[0].toUpperCase() + sh.slice(1)}</option>`).join('')}</select></div>` : ''}
          <div class="field"><label>Colors</label><div class="lo-pairs">${pairs}</div></div>
          <div class="field"><label>Font</label>
            <select id="loFont">${DB.fonts.filter((f) => f.logo !== false).map((f) => `<option value="${f.id}" ${f.id === p.font ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Text <span style="color:var(--muted);font-weight:400">(initial for monogram/badge — full name for wordmark styles)</span></label>
            <input id="loText" value="${esc(p.text)}" maxlength="40"></div>
          <div class="lo-actions">
            <button class="btn ghost" id="loShuffle">🎲 Shuffle</button>
            <button class="btn primary" id="loApply">✓ Apply to site</button>
          </div>
        </div>
      </div>`, true);
    $$('.lo-style').forEach((b) => b.onclick = () => { logoStudio.style = b.dataset.style; renderLogoStudio(); });
    $$('.lo-pair').forEach((b) => b.onclick = () => {
      const d = AI.LOGO_DUOTONES.find((x) => x.id === b.dataset.pair);
      logoStudio.pair = d.id;
      logoStudio.colors = d.c ? [...d.c] : undefined;
      renderLogoStudio();
    });
    const sh = $('#loShape');
    if (sh) sh.onchange = () => { logoStudio.shape = sh.value; renderLogoStudio(); };
    const fnt = $('#loFont');
    if (fnt) fnt.onchange = () => { logoStudio.font = fnt.value; renderLogoStudio(); };
    const txt = $('#loText');
    if (txt) txt.oninput = () => { logoStudio.text = txt.value; renderLogoStudio(); };
    $('#loShuffle').onclick = () => {
      const c2 = logoStudio.project;
      logoStudio = { ...AI.randomLogoSpec(c2), pair: logoStudio.pair, colors: logoStudio.colors, project: c2 };
      renderLogoStudio();
    };
    $('#loApply').onclick = () => {
      histCapture();
      AI.logo(logoStudio.project, { style: logoStudio.style, shape: logoStudio.shape, font: logoStudio.font, colors: logoStudio.colors, text: logoStudio.text, seed: logoStudio.seed });
      touch(logoStudio.project);
      refreshEntitlements();
      closeModal();
      if (current() && current().id === logoStudio.project.id) renderDesigner();
      toast('Logo applied ◆', true);
    };
  }

  function aiAltNow() {
    const c = current();
    if (!c) return toast('Open a project first');
    const n = AI.altText(c);
    touch(c);
    refreshEntitlements();
    toast(n ? n + ' alt text' + (n === 1 ? '' : 's') + ' generated 🏷' : 'No images without alt text found', n > 0);
  }

  async function aiEnhance() {
    const c = current();
    if (!c) return toast('Open a project first');
    if (!spendCredit()) return;
    const btn = $('#aiEnhance');
    if (btn) { btn.disabled = true; btn.textContent = '✨ Rewriting copy…'; }
    const prompt = ($('#aiPrompt') && $('#aiPrompt').value.trim()) || c.site.tagline;
    try {
      const r = await AI.enhanceCopy(c, prompt, settings.onlineEnabled !== false);
      touch(c);
      refreshEntitlements();
      toast(r && r.source === 'ai' ? 'Copy enhanced by the AI model ✨' : 'Copy refreshed by the local AI engine ✨', true);
    } catch (e) {
      refundCredit();
      refreshEntitlements();
      console.error('AI copy enhancement failed', e);
      toast('Copy enhancement failed — your credit was refunded. Try again.', false);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '✨ Enhance copy with AI <small>(1 credit)</small>'; }
    }
  }

  // ---------------- database ----------------
  function updateOnlineStatus() {
    const el = $('#onlineStatus');
    if (!el) return;
    const ok = onlineHealth.checked && onlineHealth.ok;
    el.className = 'pill' + (!settings.onlineEnabled ? ' bad' : onlineHealth.checked ? (ok ? ' ok' : ' bad') : '');
    el.textContent = !settings.onlineEnabled ? 'disabled'
      : onlineHealth.checked ? (ok ? '● online' : '● offline')
      : 'not checked';
  }
  function renderDatabase() {
    updateOnlineStatus();
    renderOnlineGrid();
    renderDbList();
  }

  async function renderOnlineGrid() {
    const wrap = $('#onlineGrid');
    if (!wrap) return;
    const tpl = (s, actions, results) => `
      <div class="online-card${s.tier ? ' pro-locked-src' : ''}">
        <div class="src-top"><span class="src-ico">${s.icon}</span><div><h4>${esc(s.name)}${s.tier ? ' <span class="pro-chip">🔒 Pro</span>' : ''}</h4><a class="src-url" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, ''))}</a></div></div>
        <p>${esc(s.desc)}</p>
        <div class="src-actions">${actions}</div>
        <div class="src-results" id="res-${s.id}">${results || ''}</div>
      </div>`;

    const c = current();
    const needProject = `<span style="font-size:.72rem;color:var(--muted)">${c ? '' : '⚠ no project open — results are saved for later use'}</span>`;
    const inp = (id, ph) => `<input class="src-input" id="${id}" placeholder="${ph}" spellcheck="false" autocomplete="off">`;
    const UI = {
      picsum: { acts: `<button class="btn ghost small" data-fetch="picsum">Fetch photos</button>
         <button class="btn ghost small" data-fetch="picsum-wide">Wide hero shots</button>${needProject}` },
      pixabay: { acts: ONLINE.pixabayKey
          ? `<input class="src-input" id="inp-pixabay" placeholder="e.g. coffee, architecture, food" spellcheck="false" autocomplete="off" style="width:150px">
            <button class="btn ghost small" data-fetch="pixabay">Search photos</button>
            <button class="btn ghost small" data-fetch="pixabay-wide">Wide shots</button>${needProject}`
          : `<span style="font-size:.72rem;color:var(--muted)">Pixabay photos need your free API key — </span><button class="btn ghost small" data-go-pixkey>🔑 Add in Settings</button>` },
      randomuser: { acts: `<button class="btn ghost small" data-fetch="people">Fetch 6 people</button>${needProject}` },
      quotable: { acts: `<button class="btn ghost small" data-fetch="quotes">Fetch 5 quotes</button>${needProject}` },
      gfonts: { acts: `<button class="btn ghost small" data-fetch="fonts">Show all fonts</button>`, results: `<div class="src-results" id="res-gfonts" style="display:grid;grid-template-columns:1fr;gap:8px"></div>` },
      wikipedia: { acts: `${inp('inp-wiki', 'Topic, e.g. Florence')}<button class="btn ghost small" data-fetch="wiki">Get summary</button>` },
      coingecko: { pro: true, acts: `${inp('inp-coins', 'bitcoin,ethereum,solana')}<button class="btn ghost small" data-fetch="coins">Fetch prices</button>` },
      github: { pro: true, acts: `${inp('inp-gh', 'GitHub username')}<button class="btn ghost small" data-fetch="github">Fetch profile</button>` },
      frankfurter: { pro: true, acts: `${inp('inp-fx', 'Base currency, e.g. GBP')}<button class="btn ghost small" data-fetch="fx">Fetch rates</button>` },
      coverr: { acts: `<input class="src-input" id="inp-coverr" placeholder="e.g. hero, drone, city" spellcheck="false" autocomplete="off" style="width:150px">
        <button class="btn ghost small" data-fetch="coverr">Fetch videos</button>
        <span style="font-size:.72rem;color:var(--muted)">Free CC0 stock video for hero backgrounds.</span>` }
    };

    // A short, live hint under the Online sources heading so first-time users notice
    // what is actually live and free right now (Pixabay photos only once a key is
    // added, Coverr clips, FormSubmit forms) rather than only reading the card copy.
    const liveHint = `<p style="font-size:.78rem;color:var(--muted);margin:-4px 0 14px"><b>Live &amp; free right now:</b>
        ${ONLINE.pixabayKey ? 'Pixabay photos — topic search (CC0, no attribution) · ' : ''}Coverr stock video clips — CC0, no attribution ·
        FormSubmit forms — just paste your email, no account needed.</p>`;
    wrap.innerHTML = liveHint + ONLINE.sources.map((s) => {
      const ui = UI[s.id] || {};
      const locked = ui.pro && !isPro();
      const acts = locked
        ? `<button class="btn ghost small" data-pro-upgrade>🔒 Pro database — upgrade</button>`
        : (ui.acts || '');
      return tpl(s, acts, ui.results || '');
    }).join('');

    $$('[data-fetch]').forEach((b) => b.onclick = () => fetchSource(b.dataset.fetch));
    $$('[data-pro-upgrade]').forEach((b) => b.onclick = () => { openPricing(); toast('That online database is a Pro feature 🔒', false); });
    $$('[data-go-pixkey]').forEach((b) => b.onclick = () => { settingsTab = 'online'; switchView('settings'); toast('Paste your free Pixabay key below 🔑', true); });
  }

  const RES_BOX = { picsum: 'picsum', 'picsum-wide': 'picsum', pixabay: 'pixabay', 'pixabay-wide': 'pixabay', coverr: 'coverr', people: 'randomuser', quotes: 'quotable', coins: 'coingecko', github: 'github', fx: 'frankfurter', wiki: 'wikipedia' };

  // Add a live-data widget section (crypto / github / fx) from the databases panel
  function addWidget(type, extra) {
    const c = current();
    if (!c) return toast('Open a project first');
    if (!canAddSection()) return;
    if (PLANS.sectionSuite[type] && !isPro()) { openPricing(); return toast('Live data widgets are a Pro feature 🔒', false); }
    const ns = DB.newSection(type);
    if (extra) ns.extra = extra;
    c.site.sections.splice(c.site.sections.length - 1, 0, ns);
    selectedSec = c.site.sections.indexOf(ns);
    touch(c);
    switchView('designer');
    toast('Widget added — open the section editor to tweak its settings 📡', true);
  }
  const resBox = (what) => $('#res-' + (RES_BOX[what] || what));

  function emptyResultsHtml(what) {
    if (what === 'pixabay' || what === 'pixabay-wide') {
      return '<p style="font-size:.85rem;color:var(--muted);padding:18px 4px">No Pixabay photos for that term — try a broader topic like <b>cafe</b>, <b>office</b> or <b>architecture</b>. Pixabay only returns photos that match the search.</p>';
    }
    if (what === 'coverr') {
      return '<p style="font-size:.85rem;color:var(--muted);padding:18px 4px">No Coverr clips for that term right now — try <b>hero</b>, <b>city</b>, <b>drone</b> or <b>nature</b>, or search a wider subject.</p>';
    }      if (what === 'picsum' || what === 'picsum-wide') {
      return '<p style="font-size:.85rem;color:var(--muted);padding:18px 4px">No Picsum photos came back for this request. Try again in a moment or pick another source.</p>';
    }
    if (what === 'wiki') {
      return '<p style="font-size:.85rem;color:var(--muted);padding:18px 4px">No Wikipedia summary for that topic — try a broader subject, or search for something with a dedicated article.</p>';
    }
    return '<p style="font-size:.85rem;color:var(--muted);padding:18px 4px">No results for that request. Try a different term or source.</p>';
  }

  async function fetchSource(what) {
    if (settings.onlineEnabled === false) return toast('Online databases are disabled in Settings');
    const btn = $(`[data-fetch="${what}"]`);
    const original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Loading…';
    try {
      let items, html;
      if (what === 'picsum' || what === 'picsum-wide') {
        const w = what === 'picsum-wide' ? 1400 : 640;
        items = await ONLINE.fetchPhotos(8, w, what === 'picsum-wide' ? 800 : 480);
        html = items.map((p) => `
          <div class="res-item">
            <img src="${esc(p.thumb)}" data-full="${esc(p.url)}" data-label="${esc(p.author)}" data-kind="image">
            <b>${esc(p.author)}</b>
            <div class="res-actions">
              <button class="icon-btn" data-img-hero="${esc(p.url)}" title="Set hero bg">🚀</button>
              <button class="icon-btn" data-img-sec="${esc(p.url)}" title="Set selected section image">🎯</button>
            </div>
          </div>`).join('');
      } else if (what === 'pixabay' || what === 'pixabay-wide') {
        const q = ($('#inp-pixabay').value || 'photography').trim() || 'photography';
        const w = what === 'pixabay-wide' ? 1400 : 640;
        items = await ONLINE.fetchPixabay(q, 1, what === 'pixabay-wide' ? 8 : 12);
        html = items.map((p) => `
          <div class="res-item">
            <img src="${esc(p.thumb)}" data-full="${esc(p.url)}" data-label="${esc(p.author || 'Pixabay')}" data-kind="image" data-source="Pixabay">
            <b>${esc(p.title)}</b>
            <div class="res-actions">
              <button class="icon-btn" data-img-hero="${esc(p.url)}" title="Set hero bg">\u25b2</button>
              <button class="icon-btn" data-img-sec="${esc(p.url)}" title="Set selected section image">\u25ce</button>
            </div>
          </div>`).join('');
      } else if (what === 'people') {
        items = await ONLINE.fetchPeople(6);
        html = items.map((p) => `
          <div class="res-item" style="grid-column:span 2">
            <div style="display:flex;gap:10px;align-items:center"><img src="${esc(p.avatar)}" style="width:44px;height:44px;border-radius:50%;object-fit:cover"><div><b>${esc(p.name)}</b><div>${esc(p.city)}</div></div></div>
            <div class="res-actions"><button class="btn ghost small" data-t-avatar="${esc(p.avatar)}" data-t-name="${esc(p.name)}" data-t-city="${esc(p.city)}">＋ Testimonial</button></div>
          </div>`).join('');
      } else if (what === 'quotes') {
        items = await ONLINE.fetchQuotes(5);
        html = items.map((q) => `
          <div class="res-item" style="grid-column:span 2">
            <b>“${esc(q.text.slice(0, 90))}${q.text.length > 90 ? '…' : ''}”</b>
            <div style="color:var(--muted)">— ${esc(q.author)}</div>
            <div class="res-actions">
              <button class="btn ghost small" data-q-cta="${esc(q.text)}" data-q-auth="${esc(q.author)}">📣 CTA</button>
              <button class="btn ghost small" data-q-t="${esc(q.text)}" data-q-auth="${esc(q.author)}">💬 Testimonial</button>
            </div>
          </div>`).join('');
      } else if (what === 'fonts') {
        const list = await ONLINE.fontPreview();
        const box = $('#res-gfonts');
        box.innerHTML = list.map((f) => {
          const url = ONLINE.fontCssUrl(f.id);
          return `
          <div class="res-item" style="display:flex;flex-direction:row;justify-content:space-between;align-items:center;gap:12px">
            <link rel="stylesheet" href="${url}">
            <span style="font-family:${esc(f.css)};font-size:1.05rem;flex:1">${esc(f.sample)}</span>
            <button class="btn ghost small" data-font-apply="${f.id}">Apply</button>
          </div>`;
        }).join('');
        $$('#res-gfonts [data-font-apply]').forEach((b) => b.onclick = () => applyFont(b.dataset.fontApply));
        onlineHealth = { checked: true, ok: true };
        updateOnlineStatus();
        toast('Fonts loaded from Google’s CDN 🔤', true);
        return;
      } else if (what === 'coverr') {
        const q = ($('#inp-coverr').value || 'hero').trim() || 'hero';
        items = await ONLINE.fetchCoverrVideo(q);
        html = items.map((v) => {
          const thumb = v.thumb || '';
          const videoPreview = thumb
            ? `<img src="${esc(thumb)}" style="width:220px;height:124px;border-radius:10px;object-fit:cover;background:#0b1020;display:block" loading="lazy" alt="${esc(v.title)}">`
            : `<div style="width:220px;height:124px;border-radius:10px;background:#0b1020;display:flex;align-items:center;justify-content:center;color:#7a8699;font-size:.75rem">no preview</div>`;
          const badge = v.isPremium
            ? `<span style="font-size:.65rem;color:#f59e0b;background:#fffbeb;border:1px solid #fcd34d;border-radius:999px;padding:1px 7px">premium</span>`
            : `<span style="font-size:.65rem;color:var(--muted)">CC0</span>`;
          return `
          <div class="res-item">
            ${videoPreview}
            <b>${esc(v.title)}</b>
            <div style="font-size:.68rem;color:var(--muted)">${esc(v.tags.slice(0, 4).join(', '))}</div>
            <div class="res-actions">
              <button class="icon-btn" data-video-url="${esc(v.url)}" data-video-title="${esc(v.title)}" title="Use as hero — embeds the Coverr clip page">▲</button>
              ${badge}
            </div>
          </div>`;
        }).join('');

      } else if (what === 'coins' || what === 'github' || what === 'fx' || what === 'wiki') {
        const box = resBox(what);
        if (!box) throw new Error('missing container for ' + what);
        if (what === 'coins') {
          const ids = ($('#inp-coins').value || 'bitcoin,ethereum,solana').trim();
          const coins = await ONLINE.fetchCoins(ids);
          box.innerHTML = coins.map((c2) => `
            <div class="res-item" style="grid-column:span 2">
              <b>${esc(c2.name)}</b>
              <div>${c2.price != null
                ? `<span style="font-weight:800">£${Number(c2.price).toFixed(2)}</span> <span style="color:${(c2.change || 0) >= 0 ? 'var(--ok)' : 'var(--danger)'}">${(c2.change || 0) >= 0 ? '▲' : '▼'} ${Math.abs(c2.change || 0).toFixed(1)}%</span>`
                : '<span style="color:var(--danger)">unknown coin id — try bitcoin,ethereum</span>'}</div>
              <div class="res-actions"><button class="btn ghost small" data-widget="crypto" data-extra="${esc(ids)}">＋ Add crypto ticker</button></div>
            </div>`).join('');
          toast('Coin prices fetched 🪙', true);
        } else if (what === 'github') {
          const user = ($('#inp-gh').value || '').trim();
          const gh = await ONLINE.fetchGitHubUser(user);
          box.innerHTML = `
            <div class="res-item" style="grid-column:span 2">
              <div style="display:flex;gap:10px;align-items:center"><img src="${esc(gh.avatar)}" style="width:44px;height:44px;border-radius:50%" alt=""><div><b>${esc(gh.name)}</b><div style="color:var(--muted)">${esc(gh.bio || '@' + gh.login)}</div></div></div>
              <div style="color:var(--muted)">${gh.public_repos} repos · ${gh.followers} followers · ${esc(gh.location || '—')}</div>
              <div class="res-actions"><button class="btn ghost small" data-widget="github" data-extra="${esc(gh.login)}">＋ Add GitHub widget</button></div>
            </div>`;
          toast('GitHub profile fetched 🐙', true);
        } else if (what === 'fx') {
          const base = ($('#inp-fx').value || 'GBP').trim().toUpperCase();
          const rates = await ONLINE.fetchFxRates(base);
          box.innerHTML = `
            <div class="res-item" style="grid-column:span 2">
              <b>1 ${esc(base)} =</b>
              <div style="display:flex;gap:12px;flex-wrap:wrap;font-weight:700">${rates.map((r) => `<span>${esc(r.flag)} ${r.code} ${Number(r.rate).toFixed(2)}</span>`).join('')}</div>
              <div class="res-actions"><button class="btn ghost small" data-widget="fx" data-extra="${esc(base)}">＋ Add FX widget</button></div>
            </div>`;
          toast('FX rates fetched 💱', true);
        } else {
          const topic = ($('#inp-wiki').value || '').trim();
          const w = await ONLINE.fetchWiki(topic);
          box.innerHTML = `
            <div class="res-item" style="grid-column:span 2">
              <b>${esc(w.title)}</b>
              <p style="color:var(--muted);font-size:.88rem">${esc(w.text.slice(0, 240))}${w.text.length > 240 ? '…' : ''}</p>
              ${w.thumb ? `<img src="${esc(w.thumb)}" style="max-width:130px;border-radius:8px" alt="">` : ''}
              <div class="res-actions">
                <button class="btn ghost small" data-q-about="${esc(w.text)}" data-title="${esc(w.title)}">📖 Use in About</button>
                ${w.url ? `<a class="btn ghost small" href="${esc(w.url)}" target="_blank" rel="noopener">Open article ↗</a>` : ''}
              </div>
            </div>`;
          toast('Wikipedia summary fetched 📚', true);
        }
        onlineHealth = { checked: true, ok: true };
        updateOnlineStatus();
        $$('[data-widget]').forEach((b) => b.onclick = () => addWidget(b.dataset.widget, b.dataset.extra));
        $$('[data-q-about]').forEach((b) => b.onclick = () => {
          const c = current();
          if (!c) return toast('Open a project first');
          let sec = c.site.sections.find((x) => x.type === 'about');
          if (!sec) {
            if (!canAddSection()) return;
            sec = DB.newSection('about');
            c.site.sections.splice(c.site.sections.length - 1, 0, sec);
          }
          sec.title = b.dataset.title;
          sec.text = b.dataset.qAbout;
          selectedSec = c.site.sections.indexOf(sec);
          touch(c);
          switchView('designer');
          toast('About section updated from Wikipedia 📚', true);
        });
        return;
      }
      const box = resBox(what);
      if (!box) throw new Error('missing container for ' + what);
      box.innerHTML = html || emptyResultsHtml(what);
      onlineHealth = { checked: true, ok: true };
      updateOnlineStatus();
      bindResults(what);
      toast(what.startsWith('picsum') ? 'Photos fetched 🖼️' : what.startsWith('pixabay') ? 'Pixabay photos fetched 🔎' : what === 'people' ? 'People fetched 🧑‍💼' : 'Quotes fetched 💬', true);
    } catch (err) {
      onlineHealth = { checked: true, ok: false };
      updateOnlineStatus();
      if (what === 'quotes') {
        // graceful fallback: local quotes
        const items = DB.fallbackQuotes;
        resBox('quotes').innerHTML = items.map((q) => `
          <div class="res-item" style="grid-column:span 2">
            <b>“${esc(q.text)}”</b>
            <div style="color:var(--muted)">— ${esc(q.extra)} <span style="color:var(--danger)">(offline fallback)</span></div>
            <div class="res-actions"><button class="btn ghost small" data-q-cta="${esc(q.text)}" data-q-auth="${esc(q.extra)}">📣 CTA</button><button class="btn ghost small" data-q-t="${esc(q.text)}" data-q-auth="${esc(q.extra)}">💬 Testimonial</button></div>
          </div>`).join('');
        bindResults('quotes');
        toast('Online unreachable — used offline fallback quotes', true);
      } else {
        toast('Offline: could not reach ' + what + '. Check your connection.', false);
      }
    } finally {
      btn.disabled = false; btn.textContent = original;
    }
  }

  function bindResults(what) {
    if (what === 'picsum' || what === 'picsum-wide') {
      $$('[data-img-hero]').forEach((b) => b.onclick = () => setImage('hero', b.dataset.imgHero, 'Picsum'));
      $$('[data-img-sec]').forEach((b) => b.onclick = () => setImage('section', b.dataset.imgSec, 'Picsum'));
      $$('#res-picsum img').forEach((img) => img.onclick = () => { img.style.outline = '2px solid var(--accent)'; toast('Use 🚀 (hero) or 🎯 (selected section)', true); });
    }
    if (what === 'pixabay' || what === 'pixabay-wide') {
      $$('[data-img-hero]').forEach((b) => b.onclick = () => setImage('hero', b.dataset.imgHero, 'Pixabay'));
      $$('[data-img-sec]').forEach((b) => b.onclick = () => setImage('section', b.dataset.imgSec, 'Pixabay'));
      $$('#res-pixabay img').forEach((img) => img.onclick = () => { img.style.outline = '2px solid var(--accent)'; toast('Use 🚀 (hero) or 🎯 (selected section)', true); });
    }
    if (what === 'coverr') {
      $$('[data-video-url]').forEach((b) => b.onclick = () => {
        const c = current();
        if (!c) return toast('Open a project first', false);
        if (selectedSec == null) return toast('Select a section first (right panel)', false);
        const sec = c.site.sections[selectedSec];
        const url = b.dataset.videoUrl || '';
        sec.image = url;
        sec.imageSource = 'Coverr';
        sec.extra = url;
        sec.title = (b.dataset.videoTitle || '').trim() || 'Coverr video';
        touch(c);
        toast('Coverr video set as hero background 🎬', true);
      });
    }
    if (what === 'wikimedia' || what === 'wiki') {
      $$('[data-img-hero]').forEach((b) => b.onclick = () => setImage('hero', b.dataset.imgHero, b.dataset.source || 'Wikimedia'));
      $$('[data-img-sec]').forEach((b) => b.onclick = () => setImage('section', b.dataset.imgSec, b.dataset.source || 'Wikimedia'));
      $$('[data-t-avatar]').forEach((b) => b.onclick = () => addTestimonial(b.dataset.tAvatar, b.dataset.tName, b.dataset.tCity, { src: b.dataset.source || 'Wikimedia' }));
    }
    if (what === 'people') {
      $$('[data-t-avatar]').forEach((b) => b.onclick = () => addTestimonial(b.dataset.tAvatar, b.dataset.tName, b.dataset.tCity));
    }
    if (what === 'quotes') {
      $$('[data-q-cta]').forEach((b) => b.onclick = () => {
        const c = current();
        if (!c) return toast('Open a project first');
        const hero = c.site.sections.find((s) => s.type === 'hero');
        if (hero) { hero.text = b.dataset.qCta; touch(c); toast('Quote set as hero description 💬', true); }
        else toast('No hero section in this project');
      });
      $$('[data-q-t]').forEach((b) => b.onclick = () => addTestimonial('', b.dataset.qAuth, b.dataset.qT));
    }
  }

  function setImage(kind, url, source) {
    const c = current();
    if (!c) return toast('Open a project first');
    if (kind === 'hero') {
      const hero = c.site.sections.find((s) => s.type === 'hero');
      if (!hero) return toast('No hero section in this project');
      hero.image = url; hero.imageSource = source; touch(c);
      toast('Hero background updated 🖼️', true);
    } else {
      const s = selectedSec != null ? c.site.sections[selectedSec] : null;
      if (!s) return toast('Select a section first (right panel)');
      s.image = url; s.imageSource = source; touch(c);
      toast(`${DB.sectionTypes[s.type] ? DB.sectionTypes[s.type].name : 'Section'} image updated 🎯`, true);
    }
  }

  function addTestimonial(avatar, name, text) {
    const c = current();
    if (!c) return toast('Open a project first');
    let t = c.site.sections.find((s) => s.type === 'testimonials');
    if (!t) {
      if (!canAddSection()) return;
      t = DB.newSection('testimonials');
      c.site.sections.splice(c.site.sections.length - 1, 0, t);
    }
    t.items.push({ icon: '💬', title: name || 'Guest', text: text || 'A wonderful experience!', extra: '', tag: '', image: avatar });
    selectedSec = c.site.sections.indexOf(t);
    touch(c);
    toast('Added to testimonials 💬', true);
  }

  function applyFont(id) {
    const f = DB.getFont(id);
    if (f && f.tier === PLANS.fontTier && !isPro()) {
      openPricing();
      return toast('“' + f.name + '” is in the Premium Font Pack — upgrade to Pro 🔒', false);
    }
    const c = current();
    if (!c) return toast('Open a project first');
    c.site.font = id;
    touch(c);
    toast(`Font applied — ${f.name} 🔤`, true);
  }

  function renderDbList() {
    if (dbTab !== 'icons') {
      clearTimeout(iconTimer);
      iconSearchSerial++;
      if (iconSearchController) { try { iconSearchController.abort(); } catch (e) {} iconSearchController = null; }
    }
    const q = ($('#dbSearch').value || '').trim().toLowerCase();
    const items = [];
    if (dbTab === 'sections') {
      Object.entries(DB.sectionTypes).forEach(([k, t]) => {
        if (q && !(t.name + ' ' + t.desc).toLowerCase().includes(q)) return;
        items.push(`
        <div class="db-item">
          <h5>${t.icon} ${esc(t.name)}</h5>
          <p>${esc(t.desc)}</p>
          <button class="btn ghost small" data-add-sec="${k}">＋ Add to project</button>
        </div>`);
      });
    } else if (dbTab === 'palettes') {
      items.push(`
        <div class="db-item" style="border-style:dashed;align-items:center;justify-content:center;text-align:center;cursor:pointer" id="newPalCard">
          <div style="font-size:1.6rem">🎨</div>
          <h5 style="color:var(--accent)">＋ Create your own palette</h5>
          <p>Pick background, surface, primary and accent — saved to your library.</p>
        </div>`);
      DB.palettes.forEach((p) => {
        if (q && !p.name.toLowerCase().includes(q)) return;
        items.push(`
        <div class="db-item">
          <h5>${esc(p.name)}${p.id.indexOf('custom_') === 0 ? ' <span class="chip">yours</span>' : ''}</h5>
          <div class="db-preview">
            <span class="swatch" style="background:${p.bg}" title="Background"></span>
            <span class="swatch" style="background:${p.surface}" title="Surface"></span>
            <span class="swatch" style="background:${p.primary}" title="Primary"></span>
            <span class="swatch" style="background:${p.accent}" title="Accent"></span>
          </div>
          <div data-a11y="${p.id}" style="font-size:.68rem;min-height:1em"></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn ghost small" data-palette="${p.id}">Apply palette</button>
            <button class="btn ghost small" data-pal-tune="${p.id}" title="Adjust the text colours until every text role passes WCAG AA (brand colours untouched)">🎚 AA tune</button>
            ${p.id.indexOf('custom_') === 0 ? `<button class="btn danger small" data-del-pal="${p.id}">🗑</button>` : ''}
          </div>
        </div>`);
      });
    } else if (dbTab === 'icons') {
      if (q.length < 2) {
        clearTimeout(iconTimer);
        iconSearchSerial++;
        if (iconSearchController) { try { iconSearchController.abort(); } catch (e) {} iconSearchController = null; }
        $('#dbList').innerHTML = q ? '<div class="empty-state">Type at least 2 characters to search Iconify.</div>' : '<div class="empty-state">Search 100k+ free icons from Iconify — try “coffee”, “rocket”, “heart”, “leaf”…</div>';
        return;
      }
      $('#dbList').innerHTML = '<div class="empty-state">Searching Iconify…</div>';
      clearTimeout(iconTimer);
      const serial = ++iconSearchSerial;
      if (iconSearchController) { try { iconSearchController.abort(); } catch (e) {} }
      iconTimer = setTimeout(async () => {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        iconSearchController = controller;
        try {
          const res = await ONLINE.request('https://api.iconify.design/search?query=' + encodeURIComponent(q) + '&limit=48', undefined, { signal: controller ? controller.signal : undefined, timeoutMs: 7000 });
          if (serial !== iconSearchSerial) return;
          if (!res.ok) throw new Error('bad');
          const data = await res.json();
          if (serial !== iconSearchSerial) return;
          const icons = (data.icons || []).slice(0, 48);
          if (!icons.length) {
            $('#dbList').innerHTML = '<div class="empty-state">No icons match “' + esc(q) + '”. Try another word.</div>';
            return;
          }
          $('#dbList').innerHTML = `
            <div class="icon-grid">
              ${icons.map((n) => `<button class="icon-cell" data-icon="${esc(n)}" title="${esc(n)}"><img src="https://api.iconify.design/${esc(n)}.svg?color=%23888" loading="lazy" alt=""></button>`).join('')}
            </div>
            <p style="font-size:.72rem;color:var(--muted);margin-top:10px">Click an icon to set it as the <b>emblem</b> of the selected section (shown above its title). Select a section in the Designer first.</p>`;
          $$('[data-icon]').forEach((b) => b.onclick = () => setEmblem(b.dataset.icon));
          $('#dbList').insertAdjacentHTML('beforeend', '<p style="font-size:.7rem;color:var(--muted);margin-top:10px">Icons come from Iconify collections — most are MIT/OFL/CC0 (free for commercial use). A few collections require visible attribution — check the collection\u2019s license before using an icon in client work.</p>');

        } catch (e) {
          if (serial !== iconSearchSerial || (e && e.code === 'request_cancelled')) return;
          $('#dbList').innerHTML = '<div class="empty-state">Iconify is unreachable — check your connection.</div>';
        } finally {
          if (iconSearchController === controller) iconSearchController = null;
        }
      }, 350);
      return;
    } else if (dbTab === 'fonts') {
      const cats = [['sans', 'Sans-serif'], ['serif', 'Serif'], ['display', 'Display'], ['mono', 'Mono'], ['hand', 'Handwritten']];
      const matched = DB.fonts.filter((f) => !q || f.name.toLowerCase().includes(q));
      cats.forEach(([cat, label]) => {
        const group = matched.filter((f) => (f.cat || 'sans') === cat);
        if (!group.length) return;
        items.push(`<div class="db-group"><h6>${label}${cat === 'display' || cat === 'hand' || cat === 'mono' ? ' · <span class="pro-chip">some Pro</span>' : ''}</h6></div>`);
        group.forEach((f) => {
          const pro = f.tier === PLANS.fontTier;
          const locked = pro && !isPro();
          items.push(`
          <div class="db-item${locked ? ' pro-locked' : ''}">
            <h5>${esc(f.name)}${pro ? ' <span class="pro-chip">🔒 Pro</span>' : ''}</h5>
            <link rel="stylesheet" href="${ONLINE.fontCssUrl(f.id)}">
            <div class="font-preview" style="font-family:${esc(f.css)}">The quick brown fox jumps over the lazy dog — 0123456789</div>
            ${locked
              ? `<button class="btn ghost small" data-font-upgrade>🔒 Premium Font Pack — upgrade</button>`
              : `<button class="btn ghost small" data-font="${f.id}">Apply font</button>`}
          </div>`);
        });
      });
    } else if (dbTab === 'animations') {
      DB.animations.forEach((a) => {
        if (q && !a.name.toLowerCase().includes(q)) return;
        items.push(`
        <div class="db-item">
          <h5>${esc(a.name)}</h5>
          <p class="anim-preview">${esc(a.css || 'No animation — static section')}</p>
          <button class="btn ghost small" data-anim-all="${a.id}">Apply to all sections</button>
        </div>`);
      });
    } else if (dbTab === 'integrations') {
      DB.integrations.forEach((it) => {
        if (q && !(it.name + ' ' + it.desc).toLowerCase().includes(q)) return;
        items.push(`
        <div class="db-item">
          <h5>${it.icon} ${esc(it.name)}</h5>
          <p>${esc(it.desc)}</p>
          <button class="btn ghost small" data-int="${it.id}">${esc(it.action)}</button>
          <div class="src-results" id="int-${it.id}"></div>
        </div>`);
      });
    } else if (dbTab === 'layouts') {
      DB.layouts.forEach((l) => {
        const tname = (DB.sectionTypes[l.type] || { name: l.type }).name;
        if (q && !(l.name + ' ' + l.desc + ' ' + tname).toLowerCase().includes(q)) return;
        const proL = l.tier === 'pro';
        const lockedL = proL && !isPro();
        items.push(`
        <div class="db-item lt-item${lockedL ? ' pro-locked' : ''}">
          ${l.thumb}
          <h5>${l.icon} ${esc(l.name)}${l.tag ? ` <span class="chip${proL ? ' chip-pro' : ''}">${esc(l.tag)}</span>` : ''}</h5>
          <p>${esc(l.desc)}</p>
          <small class="lt-type">${esc(tname)} section</small>
          ${lockedL
            ? `<button class="btn ghost small" data-layout-upgrade="${l.id}">🔒 Pro layout — upgrade</button>`
            : `<button class="btn ghost small" data-add-layout="${l.id}">＋ Add to project</button>`}
        </div>`);
      });
    }
    $('#dbList').innerHTML = items.join('') || '<div class="empty-state">No matches in the library.</div>';

    if (dbTab === 'palettes') {
      // WCAG contrast badges on every palette card
      $$('[data-a11y]').forEach((el) => {
        const pal = DB.getPalette(el.dataset.a11y);
        const checks = DB.paletteChecks(pal);
        const failing = checks.filter((c) => c.ratio < c.need);
        const worst = Math.min(...checks.map((c) => c.ratio));
        el.innerHTML = failing.length
          ? `<span title="${esc(failing.map((f) => f.role + ' ' + f.ratio.toFixed(1) + ':1').join(' · '))}" style="color:#eab308">⚠ ${failing.length} text role${failing.length === 1 ? '' : 's'} below WCAG AA · worst ${worst.toFixed(1)}:1</span>`
          : `<span style="color:#22c55e">✓ WCAG AA text contrast · worst ${worst.toFixed(1)}:1</span>`;
      });
      // one-click AA tune: adjust text colours, save as a new custom palette
      $$('[data-pal-tune]').forEach((b) => b.onclick = () => {
        const pal = DB.getPalette(b.dataset.palTune);
        const tuned = tunePalette(pal);
        if (!tuned) return toast('That palette already passes WCAG AA text contrast ✓', true);
        persistCustomPalette(tuned);
        const c = current();
        if (c) { c.site.palette = tuned.id; touch(c); toast('Tuned palette applied — “' + tuned.name + '” 🎚', true); }
        else { settings.defaultPalette = tuned.id; saveSettings(); toast('Tuned palette saved as your default 🎚', true); }
        renderDbList();
      });
    }

    $$('[data-add-sec]').forEach((b) => b.onclick = () => {
      const c = current();
      if (!c) return toast('Open a project first');
      if (!canAddSection()) return;
      const secSuite = PLANS.sectionSuite[b.dataset.addSec];
      if (secSuite && !isPro()) { openPricing(); return toast('The ' + (DB.sectionTypes[b.dataset.addSec] || {}).name + ' section is a Pro feature 🔒', false); }
      const ns = DB.newSection(b.dataset.addSec);
      c.site.sections.splice(c.site.sections.length - 1, 0, ns);
      selectedSec = c.site.sections.indexOf(ns);
      touch(c);
      switchView('designer');
      toast('Section added 🧩', true);
    });
    $$('[data-layout-upgrade]').forEach((b) => b.onclick = () => {
      const L = DB.layouts.find((x) => x.id === b.dataset.layoutUpgrade);
      openPricing();
      toast('“' + (L ? L.name : 'That layout') + '” is a Pro catalog layout 🔒', false);
    });
    $$('[data-font-upgrade]').forEach((b) => b.onclick = () => { openPricing(); toast('The Premium Font Pack is a Pro feature 🔒', false); });
    $$('[data-add-layout]').forEach((b) => b.onclick = () => {
      const c = current();
      if (!c) return toast('Open a project first');
      if (!canAddSection()) return;
      const L = DB.layouts.find((x) => x.id === b.dataset.addLayout);
      if (!L) return;
      const ns = DB.newSection(L.preset.type, L.preset);
      c.site.sections.splice(c.site.sections.length - 1, 0, ns);
      selectedSec = c.site.sections.indexOf(ns);
      touch(c);
      switchView('designer');
      toast(`“${L.name}” added — edit it like any section 🎨`, true);
    });
    const newPal = $('#newPalCard');
    if (newPal) newPal.onclick = openPaletteBuilder;
    $$('[data-del-pal]').forEach((b) => b.onclick = () => {
      DB.customPalettes = (DB.customPalettes || []).filter((x) => x.id !== b.dataset.delPal);
      localStorage.setItem('pallettai.customPalettes.v1', JSON.stringify(DB.customPalettes));
      DB.palettes = DB.palettes.filter((x) => x.id !== b.dataset.delPal);
      if (current() && current().site.palette === b.dataset.delPal) { current().site.palette = 'midnight'; touch(current()); }
      renderDbList();
      toast('Palette deleted');
    });
    $$('[data-palette]').forEach((b) => b.onclick = () => {
      const c = current();
      if (c) { c.site.palette = b.dataset.palette; touch(c); toast(`Palette applied — ${DB.getPalette(b.dataset.palette).name} 🎨`, true); }
      else { settings.defaultPalette = b.dataset.palette; saveSettings(); toast('Saved as default palette 🎨', true); }
    });
    $$('[data-font]').forEach((b) => b.onclick = () => applyFont(b.dataset.font));
    $$('[data-anim-all]').forEach((b) => b.onclick = () => {
      const c = current();
      if (!c) return toast('Open a project first');
      c.site.sections.forEach((s) => { s.animation = b.dataset.animAll; });
      touch(c);
      toast(`Animation “${DB.getAnimation(b.dataset.animAll).name}” applied to all sections 🪄`, true);
    });
    $$('[data-int]').forEach((b) => b.onclick = () => integrationAction(b.dataset.int));
  }

  // ---------------- Integrations (free & keyless-first) ----------------
  function integrationAction(id) {
    const it = (DB.integrations || []).find((x) => x.id === id);
    const c = current();
    if (!it) return;
    if (it.tier === 'pro' && !isPro()) { openPricing(); return toast(it.name + ' is a Pro feature 🔒', false); }
    if (it.kind === 'section') {
      if (!c) return toast('Open a project first');
      if (!canAddSection()) return;
      const ns = DB.newSection(it.sectionType);
      c.site.sections.splice(c.site.sections.length - 1, 0, ns);
      selectedSec = c.site.sections.indexOf(ns);
      touch(c);
      switchView('designer');
      const setting = it.sectionType === 'map' ? 'the address' : it.sectionType === 'weather' ? 'the city' : it.sectionType === 'booking' ? 'the provider and booking link' : 'the embed URL';
      toast(it.name + ' section added — set ' + setting + ' in the section editor 🧩', true);
    } else if (it.kind === 'tool' && id === 'dicebear') {
      fetchDicebear(c);
    } else if (it.kind === 'chat' && id === 'tawk') {
      configureChat(c);
    }
  }

  async function fetchDicebear(c) {
    const box = $('#int-dicebear');
    if (!box) return;
    box.innerHTML = '<span style="font-size:.75rem;color:var(--muted)">Generating…</span>';
    try {
      const names = ['Ava Stone', 'Leo Moon', 'Mia Rose', 'Noah Vale', 'Zoe Sky', 'Max Reed', 'Ivy Lane', 'Kai Fox'];
      const html = names.map((n) => {
        const seed = encodeURIComponent(n.toLowerCase().replace(/[^a-z]+/g, '-'));
        const img = 'https://api.dicebear.com/9.x/avataaars/png?seed=' + seed;
        return `<div class="res-item" style="align-items:center">
          <img src="${img}" style="width:52px;height:52px;border-radius:50%;object-fit:cover" alt="">
          <b style="font-size:.75rem">${esc(n)}</b>
          <div class="res-actions"><button class="btn ghost small" data-avatar-img="${img}">🎯 Section image</button></div>
        </div>`;
      }).join('');
      box.innerHTML = html;
      $$('#int-dicebear [data-avatar-img]').forEach((b) => b.onclick = () => {
        if (!c) return toast('Open a project first');
        if (selectedSec == null) return toast('Select a section in the Designer first', false);
        c.site.sections[selectedSec].image = b.dataset.avatarImg;
        c.site.sections[selectedSec].imageSource = 'DiceBear';
        touch(c);
        toast('Avatar set as the section image 🎯', true);
      });
    } catch (e) {
      box.innerHTML = '<span style="font-size:.75rem;color:var(--danger)">DiceBear unreachable — check your connection.</span>';
    }
  }

  function configureChat(c) {
    if (!c) return toast('Open a project first');
    openModal('💬 Live chat — Tawk.to', `
      <p style="color:var(--muted)">Create a free property at <a href="https://tawk.to" target="_blank" rel="noopener">tawk.to</a>, then paste its Property ID here. The chat widget appears on the exported site (and in previews).</p>
      <div class="field"><label>Property ID</label><input id="tawkId" placeholder="e.g. 5f2a1b2c3d4e5f6a7b8c9d0e" value="${esc((c.site.chatWidget || {}).id || '')}" spellcheck="false"></div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn primary small" id="tawkSave">Save widget</button>
        ${c.site.chatWidget ? '<button class="btn danger small" id="tawkRemove">Remove widget</button>' : ''}
      </div>`);
    $('#tawkSave').onclick = () => {
      const id = $('#tawkId').value.trim();
      if (!/^[a-z0-9]{15,}$/i.test(id)) return toast('That doesn’t look like a Tawk.to property ID', false);
      c.site.chatWidget = { provider: 'tawk', id };
      touch(c);
      closeModal();
      toast('Live chat widget added to the site 💬', true);
    };
    const rm = $('#tawkRemove');
    if (rm) rm.onclick = () => { delete c.site.chatWidget; touch(c); closeModal(); toast('Chat widget removed'); };
  }

  function openPaletteBuilder() {
    openModal('Create your own palette', `
      <div class="checkout-form">
        <div><label>Palette name</label><input id="palName" value="My Palette" placeholder="e.g. Client Brand 2026"></div>
        <div class="cf-row">
          <div><label>Background</label><input type="color" id="palBg" value="#f6f7fb"></div>
          <div><label>Surface (cards)</label><input type="color" id="palSurface" value="#ffffff"></div>
        </div>
        <div class="cf-row">
          <div><label>Primary</label><input type="color" id="palPrimary" value="#7c5cff"></div>
          <div><label>Accent</label><input type="color" id="palAccent" value="#22d3ee"></div>
        </div>
        <div class="set-row"><div><label>Dark site (light text)</label></div>
          <label class="switch"><input type="checkbox" id="palDark"><span class="slider"></span></label></div>
        <div style="display:flex;gap:10px">
          <button class="btn primary small" id="palSave" style="flex:1;justify-content:center">Save palette</button>
          <button class="btn ghost small" id="palCancel">Cancel</button>
        </div>
      </div>`);
    $('#palSave').onclick = () => {
      const name = $('#palName').value.trim() || 'My Palette';
      const pal = {
        id: 'custom_' + uid(),
        name,
        bg: $('#palBg').value,
        surface: $('#palSurface').value,
        primary: $('#palPrimary').value,
        accent: $('#palAccent').value,
        text: $('#palDark').checked ? '#eef1fb' : '#0f172a',
        muted: $('#palDark').checked ? '#9aa3c0' : '#5b6b84',
        dark: $('#palDark').checked
      };
      DB.customPalettes = DB.customPalettes || [];
      DB.customPalettes.push(pal);
      localStorage.setItem('pallettai.customPalettes.v1', JSON.stringify(DB.customPalettes));
      DB.palettes.push(pal);
      closeModal();
      renderDbList();
      toast('Palette “' + name + '” saved 🎨', true);
    };
    $('#palCancel').onclick = closeModal;
  }

  let iconTimer = null;
  let iconSearchController = null;
  let iconSearchSerial = 0;
  async function setEmblem(iconName) {
    const c = current();
    const s = selectedSec != null ? (c ? c.site.sections[selectedSec] : null) : null;
    if (!s) return toast('Open a project and select a section first', false);
    try {
      const res = await ONLINE.request('https://api.iconify.design/' + iconName + '.svg');
      if (!res.ok) throw new Error('bad');
      const svg = await res.text();
      histCapture();
      s.emblem = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
      touch(c);
      toast('Icon set as section emblem 🏷', true);
    } catch (e) {
      toast('Could not fetch that icon — check your connection', false);
    }
  }

  // One-click WCAG fix: adjust a palette's text colours until every body/secondary
  // role clears 4.5:1, returning a new custom palette (brand colours untouched).
  function tunePalette(pal) {
    if (!pal) return null;
    const checks = DB.paletteChecks(pal);
    const copy = { ...pal };
    let changed = false;
    checks.forEach((ck) => {
      if (ck.ratio >= ck.need) return;
      const key = ck.fg === pal.text ? 'text' : ck.fg === pal.muted ? 'muted' : null;
      if (!key) return;
      const fixed = DB.adjustUntil(ck.fg, (hex) => DB.contrast(hex, ck.bg) >= ck.need, DB.luminance(ck.bg) > 0.5);
      if (fixed && fixed.toLowerCase() !== ck.fg.toLowerCase()) { copy[key] = fixed; changed = true; }
    });
    if (!changed) return null;
    copy.id = 'custom_' + uid();
    copy.name = String(pal.name || 'Palette').replace(/\s*\(AA tuned\)\s*$/i, '') + ' (AA tuned)';
    copy.dark = DB.luminance(copy.bg) < 0.5;
    return copy;
  }
  function persistCustomPalette(pal) {
    if (!pal) return null;
    DB.customPalettes = DB.customPalettes || [];
    DB.customPalettes.push(pal);
    localStorage.setItem('pallettai.customPalettes.v1', JSON.stringify(DB.customPalettes));
    if (!DB.palettes.find((x) => x.id === pal.id)) DB.palettes.push(pal);
    return pal;
  }

  // ---------------- settings ----------------
  function renderSettings() {
    const s = settings;
    const pro = isPro();
    const plan = PLANS.getPlan(planState().plan);
    const sub = planState();
    const trialD = PLANS.store.trialDaysLeft();
    const myRef = PLANS.store.refCode();
    const cloudOn = SUPABASE.isConfigured();
    const signedIn = SUPABASE.signedIn();
    const ses = SUPABASE.session();
    const refHistoryHtml = (sub.referrals || []).length
      ? `<div class="rev-list">${sub.referrals.map((r) => {
          const lbl = r.kind === 'friend-redeemed' ? '🎁 A friend redeemed your code'
            : r.kind === 'attempt' ? '⛔ Code rejected by the registry'
            : '⭐ You redeemed a friend’s code';
          const grant = r.days ? ` · +${r.days} Pro days` : (r.outcome ? ` · ${r.outcome}` : '');
          return `<div class="rev-row"><b>${lbl}${r.source === 'cloud' ? ' ☁' : ''}</b><small>${new Date(r.at).toLocaleDateString()} ${new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${grant}</small></div>`;
        }).join('')}</div>`
      : '<p class="sub" style="margin-top:10px">No redemptions yet — share your code and earn 7 Pro days every time a friend redeems it.</p>';
    const accountCard = !cloudOn ? `
      <div class="set-row"><div><label>Supabase project URL</label><div class="set-desc">From your Supabase project: Settings → API → Project URL.</div></div>
        <input id="sbUrl" placeholder="https://xxxxxxxx.supabase.co" spellcheck="false"></div>
      <div class="set-row"><div><label>Anon public key</label><div class="set-desc">Settings → API → anon public key. Safe to embed — database rules protect the data.</div></div>
        <input id="sbKey" placeholder="eyJhbGciOi…" spellcheck="false"></div>
      <div class="acc-row"><button class="btn primary small" id="btnAccSave">💾 Save & connect</button></div>
      <div class="acc-status">Not connected — referral codes work in local demo mode. Run the one-file setup script (supabase/schema.sql) in your project, then paste the URL + key above. Full walkthrough in the README.</div>`
      : !signedIn ? `
      <div class="acc-row"><span class="acc-badge">☁ Connected · registry live</span><span class="conn-host">${esc(String((SUPABASE.getConfig() || {}).url || '').replace(/^https?:\/\//, ''))}</span></div>
      <div class="set-row"><div><label>Email</label></div><input type="email" id="accEmail" placeholder="you@example.com" autocomplete="email"></div>
      <div class="set-row"><div><label>Password</label></div><input type="password" id="accPass" placeholder="min 6 characters" autocomplete="current-password"></div>
      <div class="acc-row">
        <button class="btn primary small" id="btnAccSubmit">Sign in</button>
        <button class="btn ghost small" id="btnAccToggle">Create a new account</button>
      </div>
      <div class="acc-status" id="accStatus">Signed out — sign in to verify codes and sync your trial. The registry connection is locked so verification always stays on.</div>`
      : `
      <div class="acc-row">
        <span class="acc-badge">☁ Cloud registry · verified</span>
        <b>${esc(ses.email)}</b>
        <button class="btn ghost small" id="btnAccOut">Sign out</button>
      </div>
      <div class="set-row"><div><label>Your stable referral code</label><div class="set-desc">Minted when your account was created — it never changes. Every redemption is stamped on the registry.</div></div>
        <code class="ref-code" id="myRefCode">${esc(myRef)}</code></div>
      <div class="set-row"><div><label>Pro trial</label><div class="set-desc">Server-granted days, synced from the registry.</div></div>
        <b>${trialD > 0 ? trialD + ' day' + (trialD === 1 ? '' : 's') + ' left' : (pro ? 'unlocked' : 'none — share your code to earn 7 days per friend')}</b></div>
      <div class="acc-status">Your code, rewards and redemption history are verified server-side and follow you across devices.</div>`;
    const TABS = [
      ['account', '👤 Account & billing'], ['appearance', '🎨 Appearance'], ['branding', '🏷️ Branding'],
      ['defaults', '✨ Project defaults'], ['export', '📦 Export'], ['online', '📡 Online data'],
      ['studio', '⚙️ Studio'], ['about', 'ℹ️ About']
    ];
    const cards = (name, html) => (settingsTab === name ? html : '');
    $('#settingsRoot').innerHTML =
      `<div class="settings-tabs">${TABS.map(([id, label]) => `<button class="settings-tab ${settingsTab === id ? 'active' : ''}" data-set-tab="${id}">${label}</button>`).join('')}</div>` +
      cards('account', `
      <div class="settings-card">
        <h3>Account & cloud registry</h3>
        <p class="sub">One stable referral code per account, verified server-side with a stamped redemption log — rewards follow you across devices. Without an account, codes use local demo mode and still work offline.</p>
        ${accountCard}
      </div>

      <div class="settings-card">
        <h3>Plan & billing</h3>
        <p class="sub">Your PallettAI Studio subscription. Checkout is a demo — see the README for production billing.</p>
        <div class="plan-banner">
          <div class="plan-badge ${pro ? '' : 'free'}"><span class="pb-ico">${pro ? '★' : '✦'}</span>${esc(plan.name)}</div>
          <div class="plan-meta">
            <span>${plan.name}${plan.price ? ' · ' + PLANS.currency.symbol + plan.price + '/mo' : (pro ? ' · free, powered by an earned Pro trial' : ' · free forever')}</span>
            ${pro && plan.id === 'free' ? `<span class="trial-chip">★ Pro trial · ${trialD} day${trialD === 1 ? '' : 's'} left — earn more by referring</span>` : ''}
            <span id="setCreditsTxt"></span>
            ${sub.key ? `<span>License: ${esc(sub.key)}${sub.source === 'registry' ? ' ☁' : ''}${sub.planExpiresAt ? ' · until ' + new Date(sub.planExpiresAt).toLocaleDateString() : ''}</span>` : ''}
          </div>
          <div style="margin-left:auto;display:flex;gap:8px">
            <button class="btn primary small" id="btnManagePlan">${pro ? 'Manage plan' : '✦ Upgrade'}</button>
            ${pro ? '<button class="btn ghost small" id="btnDowngrade">Switch to Free</button>' : ''}
          </div>
        </div>
        <div class="credits-bar" title="AI Studio credits used"><span id="creditsBar" style="width:0%"></span></div>
      </div>

      <div class="settings-card">
        <h3>Referral program — give Pro, earn Pro</h3>
        ${cloudOn && signedIn
          ? `<p class="sub">Give a friend <b>30 days of Pro</b> free when they redeem your code — you earn <b>7 days</b> every time they do. Rewards are granted by the cloud registry, so they work across devices.</p>
        <div class="set-row"><div><label>Your referral code</label><div class="set-desc">One stable code per account — share it anywhere.</div></div>
          <div style="display:flex;gap:8px;align-items:center"><code class="ref-code" id="myRefCode">${esc(myRef)}</code><button class="btn ghost small" id="btnCopyRef">🔗 Copy invite link</button></div></div>
        <div class="set-row"><div><label>Invite link</label><div class="set-desc">https://pallettai.org/ref/… — redeemable here or in the upgrade modal.</div></div>
          <input id="refLink" readonly value="https://pallettai.org/ref/${esc(myRef.replace('REF-', ''))}"></div>
        <h4 style="margin:16px 0 4px">Redemption history <span class="acc-status">☁ stamped by the registry</span></h4>`
          : `<p class="sub">Give a friend <b>30 days of Pro</b> free when they redeem your code — you earn <b>7 days</b> every time they do. ${cloudOn ? 'Sign in above to verify codes against the cloud registry.' : 'Works instantly in the upgrade modal; connect an account above to verify codes server-side.'}</p>
        <div class="set-row"><div><label>Your referral code</label><div class="set-desc">Share it with clients, friends, or on your own site.</div></div>
          <div style="display:flex;gap:8px;align-items:center"><code class="ref-code" id="myRefCode">${esc(myRef)}</code><button class="btn ghost small" id="btnCopyRef">🔗 Copy invite link</button></div></div>
        <div class="set-row"><div><label>Invite link</label><div class="set-desc">https://pallettai.org/ref/… — redeemable here or in the upgrade modal.</div></div>
          <input id="refLink" readonly value="https://pallettai.org/ref/${esc(myRef.replace('REF-', ''))}"></div>
        <div class="set-row"><div><label>Try it — demo</label><div class="set-desc">Simulates a friend redeeming your code and adds your 7-day reward now (single-machine demo).</div></div>
          <button class="btn primary small" id="btnSimRef">🎁 Simulate a friend redeeming</button></div>
        <h4 style="margin:16px 0 4px">Redemption history</h4>`}
        ${refHistoryHtml}
      </div>
`) +
      cards('appearance', `
      <div class="settings-card">
        <h3>Appearance</h3>
        <p class="sub">How PallettAI Studio looks on your machine.</p>
        <div class="set-row"><div><label>Theme</label><div class="set-desc">Dark or light studio UI.</div></div>
          <select id="setTheme"><option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option><option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option></select></div>
        <div class="set-row"><div><label>Accent colour</label><div class="set-desc">The highlight colour across the whole studio UI.</div></div>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="color" id="setAccent" value="${esc(s.accent || '#22d3ee')}" title="Pick any colour" style="width:44px;height:32px;padding:2px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;cursor:pointer">
            <span style="display:flex;gap:6px">${['#22d3ee', '#7c5cff', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6'].map((c) => `<span class="acc-swatch" data-acc="${c}" style="background:${c}${c === (s.accent || '#22d3ee') ? ';outline:2px solid var(--text);outline-offset:2px' : ''}"></span>`).join('')}</span>
          </div></div>
        <div class="set-row"><div><label>UI density</label><div class="set-desc">Compact keeps more panels on screen at once.</div></div>
          <select id="setDensity"><option value="comfortable" ${s.density !== 'compact' ? 'selected' : ''}>Comfortable</option><option value="compact" ${s.density === 'compact' ? 'selected' : ''}>Compact</option></select></div>
        <div class="set-row"><div><label>Reduce motion in the studio</label><div class="set-desc">Turns off transitions & animations inside this app.</div></div>
          <label class="switch"><input type="checkbox" id="setMotion" ${s.reducedMotion ? 'checked' : ''}><span class="slider"></span></label></div>
      </div>
`) +
      cards('branding', `
      <div class="settings-card">
        <h3>Branding — “Made by PallettAI”</h3>
        <p class="sub">Shown in the footer of every site you export. PallettAI is a proud signature on all client work.</p>
        <div class="set-row"><div><label>Show in exported sites</label></div>
          <label class="switch"><input type="checkbox" id="setBrandFooter" ${s.brandFooter === false ? '' : 'checked'}><span class="slider"></span></label></div>
        <div class="set-row"><div><label>Footer text</label></div><input type="text" id="setBrandText" value="${esc(s.brandFooterText)}"></div>
        <div class="set-row"><div><label>Brand link</label><div class="set-desc">Where the footer signature points.</div></div><input type="text" id="setBrandLink" value="${esc(s.brandLink)}"></div>
      </div>
`) +
      cards('defaults', `
      <div class="settings-card">
        <h3>Defaults for new projects</h3>
        <p class="sub">Applied when you create a site from a template.</p>
        <div class="set-row"><div><label>Default palette</label></div>
          <select id="setPalette">${DB.palettes.map((p) => `<option value="${p.id}" ${p.id === s.defaultPalette ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="set-row"><div><label>Default font</label></div>
          <select id="setFont">${DB.fonts.map((f) => `<option value="${f.id}" ${f.id === s.defaultFont ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
        <div class="set-row"><div><label>Default animation</label></div>
          <select id="setAnim">${DB.animations.map((a) => `<option value="${a.id}" ${a.id === s.defaultAnimation ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
        <div class="set-row"><div><label>Default hero layout</label></div>
          <select id="setHeroLayout"><option value="centered" ${s.defaultHeroLayout !== 'split' && s.defaultHeroLayout !== 'minimal' ? 'selected' : ''}>Centered (image bg)</option><option value="split" ${s.defaultHeroLayout === 'split' ? 'selected' : ''}>Split (text + image)</option><option value="minimal" ${s.defaultHeroLayout === 'minimal' ? 'selected' : ''}>Minimal (clean)</option></select></div>
        <div class="set-row"><div><label>Container width (px)</label></div><input type="number" id="setWidth" value="${s.defaultContainerWidth || 1140}" min="960" max="1680"></div>
        <div class="set-row"><div><label>Corner radius (px)</label></div><input type="number" id="setRadius" value="${s.defaultRadius || 20}" min="0" max="48"></div>
        <div class="set-row"><div><label>Section spacing (px)</label></div><input type="number" id="setSpacing" value="${s.defaultSpacing || 96}" min="32" max="220"></div>
        <div class="set-row"><div><label>Sticky nav on new sites</label></div>
          <label class="switch"><input type="checkbox" id="setNavSticky" ${s.defaultNavSticky !== false ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="set-row"><div><label>Theme toggle on new sites</label><div class="set-desc">Visitors can switch dark/light.</div></div>
          <label class="switch"><input type="checkbox" id="setThemeToggle" ${s.defaultThemeToggle !== false ? 'checked' : ''}><span class="slider"></span></label></div>
      </div>
`) +
      cards('export', `
      <div class="settings-card">
        <h3>Export</h3>
        <p class="sub">Options for the standalone HTML files you download.</p>
        <div class="set-row"><div><label>Include meta & Open Graph tags</label></div>
          <label class="switch"><input type="checkbox" id="setMeta" ${s.exportMeta === false ? '' : 'checked'}><span class="slider"></span></label></div>
        <div class="set-row"><div><label>Load Google Fonts in previews</label><div class="set-desc">Off for fully offline use.</div></div>
          <label class="switch"><input type="checkbox" id="setFontsOn" ${s.onlineEnabled === false ? '' : 'checked'}><span class="slider"></span></label></div>
        <div class="set-row"><div><label>Cookie consent banner</label><div class="set-desc">Shows a GDPR-style accept banner on exported sites.</div></div>
          <label class="switch"><input type="checkbox" id="setCookies" ${s.cookieBanner ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="set-row"><div><label>Analytics provider</label></div>
          <select id="setAnalyticsProvider"><option value="ga4" ${s.analyticsProvider !== 'plausible' ? 'selected' : ''}>Google Analytics 4</option><option value="plausible" ${s.analyticsProvider === 'plausible' ? 'selected' : ''}>Plausible</option></select></div>
        <div class="set-row"><div><label>Analytics ID</label><div class="set-desc">e.g. G-XXXXXXXXXX or your-plausible-domain</div></div><input type="text" id="setAnalyticsId" value="${esc(s.analyticsId || '')}" placeholder="leave empty to disable"></div>
        <div class="set-row"><div><label>Minify exported HTML</label><div class="set-desc">Smaller files, faster loads.</div></div>
          <label class="switch"><input type="checkbox" id="setMinify" ${s.minify ? 'checked' : ''}><span class="slider"></span></label></div>
      </div>
`) +
      cards('online', `
      <div class="settings-card">
        <h3>Online databases</h3>
        <p class="sub">Free sources: Picsum, RandomUser, Quotable, Google Fonts run keyless. Pixabay photo search uses your own free API key — stored only on this device.</p>
        <div class="set-row"><div><label>Enabled</label></div>
          <label class="switch"><input type="checkbox" id="setOnline" ${s.onlineEnabled === false ? '' : 'checked'}><span class="slider"></span></label></div>
        <div class="set-row"><div><label>Pixabay API key</label><div class="set-desc">Optional — enables topic photo search in Database ▸ Online sources. Free key at <a href="https://pixabay.com/api/docs/" target="_blank" rel="noopener">pixabay.com/api/docs</a>.</div></div>
          <input type="text" id="setPixabayKey" value="${esc(s.pixabayKey || '')}" placeholder="e.g. 12345678-abcdef…" spellcheck="false" autocomplete="off"></div>
        <div class="set-row"><div><label>Request timeout (ms)</label></div><input type="number" id="setTimeout" value="${s.onlineTimeoutMs}" min="2000" max="30000" step="500"></div>
        <div class="set-row"><div><label>Clear fetched data cache</label><div class="set-desc">Forget previously fetched photos, people and quotes.</div></div>
          <button class="btn ghost small" id="btnClearCache">Clear cache</button></div>
        <div class="set-row"><div><label>Live widget auto-refresh</label><div class="set-desc">How often crypto & FX widgets on exported sites re-fetch (0 = never).</div></div>
          <select id="setWidgetRefresh"><option value="0" ${!s.widgetRefreshSec ? 'selected' : ''}>Never</option><option value="60" ${s.widgetRefreshSec === 60 ? 'selected' : ''}>Every minute</option><option value="300" ${s.widgetRefreshSec === 300 ? 'selected' : ''}>Every 5 minutes</option><option value="900" ${s.widgetRefreshSec === 900 ? 'selected' : ''}>Every 15 minutes</option></select></div>
      </div>
`) +
      cards('studio', `
      <div class="settings-card">
        <h3>Studio behaviour</h3>
        <p class="sub">How the app itself behaves on your machine.</p>
        <div class="set-row"><div><label>Autosave snapshots</label><div class="set-desc">Revision history (⏱ in the designer toolbar) records automatically.</div></div>
          <label class="switch"><input type="checkbox" id="setAutosave" ${s.autosave !== false ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="set-row"><div><label>Snapshot delay (ms)</label><div class="set-desc">How long after you stop editing before a snapshot is taken.</div></div>
          <input type="number" id="setAutosaveMs" value="${s.autosaveMs || 2000}" min="500" max="30000" step="500"></div>
        <div class="set-row"><div><label>Confirm before deleting</label><div class="set-desc">Ask for confirmation before deleting projects, pages and sections.</div></div>
          <label class="switch"><input type="checkbox" id="setConfirmDel" ${s.confirmDelete !== false ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="set-row"><div><label>Guided tour</label><div class="set-desc">Run the welcome tour again any time.</div></div>
          <button class="btn ghost small" id="btnReTour">▶ Re-run the tour</button></div>
      </div>
`) +
      cards('about', `
      <div class="settings-card">
        <h3>About</h3>
        <p class="sub">PallettAI Studio ${esc(DB.version)} — design & build websites for clients.</p>
        <div class="set-row"><div><label>Made by PallettAI</label><div class="set-desc">Visit the studio online.</div></div>
          <a class="btn ghost small" href="https://pallettai.org" target="_blank" rel="noopener">pallettai.org ↗</a></div>
        <div class="set-row"><div><label>Reset all settings</label><div class="set-desc">Restore every option to its factory default.</div></div>
          <button class="btn danger small" id="btnResetSettings">Reset</button></div>
      </div>
`);

    // tabs render one card set at a time, so every binding must tolerate its
    // element not being present on the active tab.
    const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
    const set = (sel, fn) => { const el = $(sel); if (el) fn(el); };
    const cred = PLANS.store.creditsLeft();
    set('#setCreditsTxt', (el) => { el.textContent = cred.limit === Infinity ? 'AI Studio: unlimited generations' : 'AI Studio: ' + cred.used + ' of ' + cred.limit + ' credits used'; });
    set('#creditsBar', (el) => { el.style.width = (cred.limit === Infinity ? 100 : Math.min(100, Math.round((cred.used / cred.limit) * 100))) + '%'; });
    set('#btnManagePlan', (el) => { el.onclick = openPricing; });
    set('#btnDowngrade', (el) => { el.onclick = downgradePlan; });
    on('#setTheme', 'change', (e) => { settings.theme = e.target.value; saveSettings(); });
    on('#setBrandFooter', 'change', (e) => { settings.brandFooter = e.target.checked; saveSettings(); renderPreview(); });
    on('#setBrandText', 'input', (e) => { settings.brandFooterText = e.target.value; saveSettings(); schedulePreview(); });
    on('#setBrandLink', 'input', (e) => { settings.brandLink = e.target.value; saveSettings(); schedulePreview(); });
    on('#setPalette', 'change', (e) => { settings.defaultPalette = e.target.value; saveSettings(); });
    on('#setFont', 'change', (e) => { settings.defaultFont = e.target.value; saveSettings(); });
    on('#setAnim', 'change', (e) => { settings.defaultAnimation = e.target.value; saveSettings(); });
    on('#setMeta', 'change', (e) => { settings.exportMeta = e.target.checked; saveSettings(); schedulePreview(); });
    on('#setFontsOn', 'change', (e) => { settings.onlineEnabled = e.target.checked; saveSettings(); schedulePreview(); });
    on('#setCookies', 'change', (e) => { settings.cookieBanner = e.target.checked; saveSettings(); schedulePreview(); });
    on('#setAnalyticsProvider', 'change', (e) => { settings.analyticsProvider = e.target.value; saveSettings(); schedulePreview(); });
    on('#setAnalyticsId', 'input', (e) => { settings.analyticsId = e.target.value.trim(); saveSettings(); schedulePreview(); });
    on('#setMinify', 'change', (e) => { settings.minify = e.target.checked; saveSettings(); schedulePreview(); });
    on('#setOnline', 'change', (e) => { settings.onlineEnabled = e.target.checked; saveSettings(); renderDatabase(); });
    on('#setPixabayKey', 'input', (e) => {
      const k = e.target.value.trim();
      settings.pixabayKey = k;
      saveSettings();
      // Purging the pixabay cache avoids stale results from a previously saved key.
      try { ONLINE.clearCache(); } catch (err) {}
    });
    on('#setTimeout', 'change', (e) => { settings.onlineTimeoutMs = +e.target.value || 9000; saveSettings(); });
    on('#btnClearCache', 'click', () => { ONLINE.clearCache(); toast('Online cache cleared 🧹', true); });
    // settings tabs + bespoke-session options
    $$('[data-set-tab]').forEach((b) => b.onclick = () => { settingsTab = b.dataset.setTab; renderSettings(); });
    on('#setAccent', 'input', (e) => { settings.accent = e.target.value; saveSettings(); });
    $$('[data-acc]').forEach((sw) => sw.onclick = () => { settings.accent = sw.dataset.acc; saveSettings(); renderSettings(); });
    on('#setDensity', 'change', (e) => { settings.density = e.target.value; saveSettings(); });
    on('#setMotion', 'change', (e) => { settings.reducedMotion = e.target.checked; saveSettings(); });
    on('#setHeroLayout', 'change', (e) => { settings.defaultHeroLayout = e.target.value; saveSettings(); });
    on('#setWidth', 'change', (e) => { settings.defaultContainerWidth = +e.target.value || 1140; saveSettings(); });
    on('#setRadius', 'change', (e) => { settings.defaultRadius = +e.target.value || 20; saveSettings(); });
    on('#setSpacing', 'change', (e) => { settings.defaultSpacing = +e.target.value || 96; saveSettings(); });
    on('#setNavSticky', 'change', (e) => { settings.defaultNavSticky = e.target.checked; saveSettings(); });
    on('#setThemeToggle', 'change', (e) => { settings.defaultThemeToggle = e.target.checked; saveSettings(); });
    on('#setWidgetRefresh', 'change', (e) => { settings.widgetRefreshSec = +e.target.value || 0; saveSettings(); });
    on('#setAutosave', 'change', (e) => { settings.autosave = e.target.checked; saveSettings(); });
    on('#setAutosaveMs', 'change', (e) => { settings.autosaveMs = +e.target.value || 2000; saveSettings(); });
    on('#setConfirmDel', 'change', (e) => { settings.confirmDelete = e.target.checked; saveSettings(); });
    on('#btnReTour', 'click', () => { try { localStorage.removeItem(TOUR_KEY); } catch (e) {} startTour(); toast('Tour restarted 🎓', true); });
    on('#btnResetSettings', 'click', () => {
      settings = { ...DB.defaultSettings };
      saveSettings();
      renderSettings();
      toast('Settings reset to defaults ↺', true);
    });
    // account & cloud registry
    const accSave = $('#btnAccSave');
    if (accSave) accSave.onclick = () => {
      try {
        const r = SUPABASE.setConfig($('#sbUrl').value, $('#sbKey').value);
        if (!r.ok) return toast(r.msg, false);
        accSave.disabled = true;
        accSave.textContent = 'Connecting…';
        setTimeout(() => renderSettings(), 250);
        toast('Connected to the cloud registry ☁ — create your account below', true);
      } catch (e) {
        toast('Could not connect: ' + ((e && e.message) || e), false);
      }
    };
    const accSubmit = $('#btnAccSubmit');
    if (accSubmit) accSubmit.onclick = async () => {
      const email = $('#accEmail').value.trim();
      const pass = $('#accPass').value;
      const st = $('#accStatus');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Enter a valid email address', false);
      if (pass.length < 6) return toast('Password must be at least 6 characters', false);
      if (accSubmit.disabled) return;
      accSubmit.disabled = true;
      accSubmit.textContent = accMode === 'signup' ? 'Creating…' : 'Signing in…';
      const r = accMode === 'signup' ? await SUPABASE.signUp(email, pass) : await SUPABASE.signIn(email, pass);
      accSubmit.disabled = false;
      accSubmit.textContent = accMode === 'signup' ? 'Create account' : 'Sign in';
      if (!r.ok) { if (st) st.textContent = r.msg; return toast(r.msg, false); }
      if (r.needsConfirm) {
        if (st) st.textContent = 'Confirmation email sent to ' + email + ' — click the link in it, then sign in. (Or turn off email confirmation in Supabase → Authentication → Providers → Email for instant signup.)';
        return;
      }
      await syncCloud();
      renderSettings();
      toast('Signed in as ' + (r.email || email) + ' ☁', true);
    };
    const accToggle = $('#btnAccToggle');
    if (accToggle) accToggle.onclick = () => {
      accMode = accMode === 'signup' ? 'signin' : 'signup';
      accToggle.textContent = accMode === 'signup' ? 'I already have an account' : 'Create a new account';
      const b = $('#btnAccSubmit');
      if (b) b.textContent = accMode === 'signup' ? 'Create account' : 'Sign in';
      const p = $('#accPass');
      if (p) p.autocomplete = accMode === 'signup' ? 'new-password' : 'current-password';
    };
    const accOut = $('#btnAccOut');
    if (accOut) accOut.onclick = async () => {
      await SUPABASE.signOut();
      clearStreakLocal();
      PLANS.store.clearCreditLedger();
      renderSettings();
      toast('Signed out — sign back in anytime to re-sync');
    };
    // referral program
    const copyRef = $('#btnCopyRef');
    if (copyRef) copyRef.onclick = () => {
      const txt = 'https://pallettai.org/ref/' + myRef.replace('REF-', '');
      const done = () => toast('Invite link copied — share it! 🔗', true);
      const fallback = () => { const inp = $('#refLink'); if (inp) { inp.select(); document.execCommand('copy'); } done(); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fallback);
      else fallback();
    };
    const simRef = $('#btnSimRef');
    if (simRef) simRef.onclick = () => applyReferralCode(myRef);
  }

  // ---------------- seed sample project on first run ----------------
  function seed() {
    if (localStorage.getItem(LS.seeded)) return;
    const tpl = DB.getTemplate('launchpad');
    const p = projectFromTemplate(tpl);
    p.name = 'Acme Launchpad';
    p.site.name = 'Acme Launchpad';
    p.site.email = 'hello@acme.example';
    p.site.phone = '+1 555 0100';
    p.site.address = '101 Market Street, San Francisco';
    p.suites = ['animation', 'contactpro'];
    projects.push(p);
    localStorage.setItem(LS.seeded, '1');
    saveProjects();
  }

  function loadCustomPalettes() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem('pallettai.customPalettes.v1') || '[]'); } catch (e) { list = []; }
    DB.customPalettes = list;
    list.forEach((p) => { if (!DB.palettes.find((x) => x.id === p.id)) DB.palettes.push(p); });
  }

  // ============================================================
  // AI Copilot — chat editor (plain-English site edits)
  // ============================================================
  const chatState = { open: false, busy: false };

  function chatOpenPanel(open) {
    chatState.open = !!open && !!current();
    const el = $('#chatPanel');
    if (el) el.hidden = !chatState.open;
    if (chatState.open) {
      const c = current();
      $('#chatProj').textContent = c.site.name;
      const list = $('#chatList');
      if (!list.childElementCount) {
        chatAdd('bot', 'Hi — I\'m your site copilot. Tell me what to change and I\'ll do it live.\n\nTry: “make it glassmorphism”, “make the hero punchier”, “add a pricing section” or “rounder corners”.\n\nEvery edit is undoable with <b>${KBD}Z</b> — AI rewrites cost 1 credit.');
      }
      chatRenderChips();
      const inp = $('#chatInput');
      if (inp) inp.focus();
    }
  }
  function chatToggle() {
    if (!current()) return toast('Open a project first — Copilot edits the open site', false);
    chatOpenPanel(!chatState.open);
  }
  function chatAdd(role, html) {
    const list = $('#chatList');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', `<div class="msg ${role}">${html}</div>`);
    list.scrollTop = list.scrollHeight;
  }
  function chatBotLine(text) {
    chatAdd('bot ok', esc(text) + `<span class="m-act"><button data-chat-undo="1" title="Revert this last copilot change">↩ Undo this</button></span>`);
  }
  function chatRenderChips() {
    const wrap = $('#chatChips');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!current()) return;
    chatChipIdeas().forEach((label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip-q';
      b.textContent = label;
      b.onclick = () => { $('#chatInput').value = label; chatSend(); };
      wrap.appendChild(b);
    });
  }
  function chatChipIdeas() {
    const c = current();
    if (!c) return [];
    const out = [];
    if (!c.site.stylePack) {
      const pk = AI.stylePacks[(Date.now() / 7) % AI.stylePacks.length | 0];
      out.push('Make it ' + pk.name);
    } else {
      out.push('Add a pricing section', 'Make the hero centered');
    }
    out.push('Make the hero punchier', 'Add a testimonials section', 'Try a dark blue palette', 'Rounder corners');
    if (!c.site.logo) out.push('Generate an AI logo');
    return out.slice(0, 6);
  }

  async function chatSend() {
    if (!current()) return toast('Open a project first — Copilot edits the open site', false);
    if (chatState.busy) return;
    const inp = $('#chatInput');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    chatAdd('user', esc(text));
    chatState.busy = true;
    $('#chatSend').disabled = true;
    $('#chatSend').textContent = '…';
    histCapture();
    try {
      const plan = AI.chatPlan(current().site, text);
      const res = await chatExecute(plan.acts, text);
      if (res.reply) chatAdd('bot', esc(res.reply));
      if (res.summary.length) chatBotLine(res.summary.join('\n'));
      if (res.needsCredit) chatAdd('bot', '⚠️ ' + esc(res.needsCredit));
      if (res.changed) chatFinalize(res.full);
      else if (!res.summary.length && !res.reply) chatAdd('bot', 'Hmm, I didn\'t quite catch that — try “make it luxury gold”, “delete the FAQ section” or “set my email to hello@example.com”.');
    } catch (err) {
      console.error('Copilot error', err);
      chatAdd('bot', 'Something went wrong running that — please try again.');
    } finally {
      chatState.busy = false;
      $('#chatSend').disabled = false;
      $('#chatSend').textContent = '➤';
      chatRenderChips();
    }
  }

  async function chatExecute(acts, text) {
    const out = { reply: '', summary: [], changed: false, full: false, needsCredit: '' };
    for (const act of (acts || [])) {
      const c = current();
      if (!c) break;
      if (act.op === 'help') { out.reply = AI.chatHelp; continue; }
      if (act.op === 'closeChat') { chatOpenPanel(false); continue; }
      if (act.op === 'undo') { histUndo(); out.changed = true; out.full = true; return out; }
      if (act.credit && !spendCredit()) {
        out.needsCredit = 'That action needs an AI credit — the free plan includes 3 (Pro is unlimited).';
        continue;
      }
      try {
        const r = chatAct(c, act, text);
        if (r && r.then) await r;
        const meta = r || {};
        if (meta.skipped) { if (act.credit) refundCredit(); out.summary.push(act.label + ' — ' + meta.reason); continue; }
        out.summary.push(act.label);
        out.changed = true;
        if (meta.full || act.credit || act.op === 'suite' || act.op === 'unsuite' || act.op === 'logo') out.full = true;
      } catch (e) {
        console.error('Copilot act failed', e);
        out.summary.push(act.label + ' — could not be applied');
      }
    }
    return out;
  }

  function chatLastIdx(s, type) {
    for (let i = s.sections.length - 1; i >= 0; i--) if (s.sections[i].type === type) return i;
    return -1;
  }
  function chatSuite(c, id, install) {
    const sd = DB.getSuite(id);
    if (!sd) return { skipped: true, reason: 'that suite doesn\'t exist' };
    if (PLANS.suitePlan[id] === 'pro' && !isPro()) return { skipped: true, reason: 'the ' + sd.name + ' is a Pro suite — upgrade to install it' };
    if (install) {
      const r = Builder.applySuite(c, id);
      if (!r.ok) return { skipped: true, reason: 'it\'s already installed' };
    } else {
      Builder.removeSuite(c, id);
    }
    return { full: true };
  }

  function chatAct(c, act, text) {
    const s = c.site;
    switch (act.op) {
      case 'pack': {
        if (!spendCredit()) return { skipped: true, reason: 'each new look costs 1 AI credit' };
        AI.applyStylePack(c, act.pack);
        return { full: true };
      }
      case 'palette': s.palette = act.palette; return { full: true };
      case 'font': s.font = act.font; return { full: true };
      case 'design': {
        s.design = s.design || {};
        const defs = { radius: 20, spacing: 96, containerWidth: 1140 };
        const cur = s.design[act.key] != null ? s.design[act.key] : defs[act.key];
        let v = act.to != null ? act.to : (cur || 0) + (act.delta || 0);
        if (act.key === 'radius') v = Math.max(0, Math.min(48, v));
        if (act.key === 'spacing') v = Math.max(32, Math.min(220, v));
        if (act.key === 'containerWidth') v = Math.max(960, Math.min(1680, v));
        s.design[act.key] = v;
        return { full: true };
      }
      case 'hero': s.heroLayout = act.layout; return { full: true };
      case 'layout': {
        const secSuite = PLANS.sectionSuite[act.type];
        if (secSuite && !isPro()) return { skipped: true, reason: 'the ' + ((DB.sectionTypes[act.type] || {}).name || act.type) + ' section is a Pro feature — upgrade to add it' };
        const i = chatLastIdx(s, act.type);
        if (i === -1) {
          if (!isPro() && totalSections(c) >= PLANS.getPlan('free').limits.sectionsPerSite) {
            return { skipped: true, reason: 'the free plan allows ' + PLANS.getPlan('free').limits.sectionsPerSite + ' sections per site — upgrade for unlimited' };
          }
          const ns = AI.sampleSection(act.type, c);
          ns.layout = act.layout;
          const last = s.sections[s.sections.length - 1];
          s.sections.splice((last && last.type === 'contact') ? s.sections.length - 1 : s.sections.length, 0, ns);
          return { full: true };
        }
        s.sections[i].layout = act.layout;
        return { full: true };
      }
      case 'brandKit': {
        AI.logo(c);
        AI.restyle(c, text || s.name, isPro() ? 'pro' : 'free');
        AI.altText(c);
        return { full: true };
      }
      case 'navStyle': s.navStyle = act.style; return { full: true };
      case 'navSticky': s.navSticky = act.on; return { full: true };
      case 'navCta': s.navCta = act.text; return { full: true };
      case 'themeToggle': s.themeToggle = act.on; return { full: true };
      case 'setField': s[act.key] = act.value; return { full: ['name', 'tagline', 'description', 'ctaText', 'ctaLink', 'favicon', 'email'].includes(act.key) };
      case 'logo': AI.logo(c); return { full: true };
      case 'alt': AI.altText(c); return {};
      case 'suite': return chatSuite(c, act.suite, true);
      case 'unsuite': return chatSuite(c, act.suite, false);
      case 'addSection': {
        const secSuite = PLANS.sectionSuite[act.type];
        if (secSuite && !isPro()) return { skipped: true, reason: 'the ' + ((DB.sectionTypes[act.type] || {}).name || act.type) + ' section is a Pro feature — upgrade to add it' };
        if (!isPro() && totalSections(c) >= PLANS.getPlan('free').limits.sectionsPerSite) {
          return { skipped: true, reason: 'the free plan allows ' + PLANS.getPlan('free').limits.sectionsPerSite + ' sections per site — upgrade for unlimited' };
        }
        const ns = AI.sampleSection(act.type, c);
        if (act.extra) ns.extra = act.extra;
        if (act.type === 'booking') {
          if (act.bookingUrl) ns.bookingUrl = act.bookingUrl;
          if (act.bookingProvider) ns.bookingProvider = act.bookingProvider;
          if (!ns.bookingUrl && ns.extra) ns.bookingUrl = ns.extra;
          if (ns.bookingUrl) ns.extra = ns.bookingUrl;
        }
        const last = s.sections[s.sections.length - 1];
        const idx = (last && last.type === 'contact') ? s.sections.length - 1 : s.sections.length;
        s.sections.splice(idx, 0, ns);
        selectedSec = idx;
        return { full: true };
      }
      case 'removeSection': {
        const i = chatLastIdx(s, act.type);
        if (i === -1) return { skipped: true, reason: 'there is no ' + act.type + ' section on this site' };
        s.sections.splice(i, 1);
        if (selectedSec != null) selectedSec = Math.min(selectedSec, Math.max(0, s.sections.length - 1));
        return { full: true };
      }
      case 'duplicateSection': {
        const i = chatLastIdx(s, act.type);
        if (i === -1) return { skipped: true, reason: 'there is no ' + act.type + ' section on this site' };
        const copy = JSON.parse(JSON.stringify(s.sections[i]));
        copy.id = uid();
        s.sections.splice(i + 1, 0, copy);
        return { full: true };
      }
      case 'moveSection': {
        const aIdx = chatLastIdx(s, act.a);
        if (aIdx === -1) return { skipped: true, reason: 'couldn\'t find the section to move' };
        const [sec] = s.sections.splice(aIdx, 1);
        if (act.b && act.b !== act.a) {
          const bIdx = chatLastIdx(s, act.b);
          if (bIdx === -1) { s.sections.splice(aIdx, 0, sec); return { skipped: true, reason: 'couldn\'t find the target section' }; }
          s.sections.splice(bIdx + (act.rel === 'above' ? 0 : 1), 0, sec);
        } else if (act.rel === 'top') {
          s.sections.unshift(sec);
        } else {
          s.sections.push(sec);
        }
        return { full: true };
      }
      case 'rewriteItems': {
        const sec = s.sections[act.idx];
        if (!sec) return { skipped: true, reason: 'that section is gone' };
        const fresh = AI.sampleSection(sec.type, c);
        if (fresh.items && fresh.items.length) sec.items = fresh.items;
        if (fresh.title) sec.title = fresh.title;
        return { full: true };
      }
      case 'rewrite': {
        const sec = s.sections[act.idx];
        if (!sec) return { skipped: true, reason: 'that section is gone' };
        return (async () => {
          await AI.enhanceSection(sec, act.prompt || text, c, settings.onlineEnabled !== false);
          return { full: true };
        })();
      }
      case 'rewriteAll': {
        return (async () => {
          await AI.enhanceCopy(c, text, settings.onlineEnabled !== false);
          return { full: true };
        })();
      }
      case 'images': {
        return (async () => {
          const prompt = (s.name || '') + ' — ' + (s.tagline || '');
          const out = await AI.generateImages(c, prompt, { source: 'real', online: settings.onlineEnabled !== false });
          if (!out.hero && !out.about && out.gallery === 0) {
            refundCredit();
            return { skipped: true, reason: 'no topic-matched photos could be fetched right now — your credit was refunded' };
          }
          return { full: true };
        })();
      }
      default: return { skipped: true, reason: 'not supported yet' };
    }
  }

  function chatFinalize(full) {
    const c = current();
    if (!c) return;
    touch(c);
    if (full) {
      renderDesigner();
      if (selectedSec != null && c.site.sections[selectedSec]) renderEditor();
    }
    renderPlanPill();
  }

  // ============================================================
  // Reusable brand presets — save once, apply across projects
  // ============================================================
  function openBrandPresets() {
    const c = current();
    if (!c) return toast('Open a project first', false);
    if (!isPro()) {
      openPricing();
      return toast('Reusable brand presets are a Pro feature 🔒', false);
    }
    const render = () => {
      const currentPalette = DB.getPalette(c.site.palette) || DB.palettes[0] || { name: 'Default palette' };
      const currentFont = brandFontInfo({ customFonts: c.site.customFonts }, c.site.font);
      const rows = brandPresets.length
        ? brandPresets.map((p) => {
            const pal = cleanBrandPalette(p.paletteData, p.palette) || DB.getPalette(p.palette);
            const font = brandFontInfo(p, p.font);
            const display = p.fontDisplay ? brandFontInfo(p, p.fontDisplay) : null;
            const swatches = ['bg', 'surface', 'primary', 'accent'].map((key) => `<span style="display:inline-block;width:15px;height:15px;border-radius:5px;background:${esc((pal && pal[key]) || '#7c5cff')};border:1px solid rgba(255,255,255,.16)"></span>`).join('');
            return `<div class="rev-row" style="align-items:center">
              <div style="display:flex;gap:10px;align-items:center;min-width:0">
                <div style="display:flex;gap:3px;flex:none">${swatches}</div>
                <div style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name || 'Brand system')}</b><small>${esc((pal && pal.name) || 'Custom palette')} · ${esc((font && font.name) || p.font || 'Inter')}${display ? ' + ' + esc(display.name) : ''}${p.stylePack ? ' · ' + esc(p.stylePack.name || 'Style pack') : ''}${p.seo ? ' · SEO defaults' : ''}</small></div>
              </div>
              <div style="display:flex;gap:6px;flex:none"><button class="btn primary small" data-brand-apply="${esc(p.id)}">Apply</button><button class="btn ghost small" data-brand-delete="${esc(p.id)}" title="Delete preset">🗑</button></div>
            </div>`;
          }).join('')
        : '<p class="sub" style="margin:0">No saved brand systems yet. Save the current project above and reuse it whenever you start a new client site.</p>';
      openModal('✦ Reusable brand presets', `
        <p style="color:var(--muted);margin-bottom:14px">Save the visual system once — palette, type, logo, spacing, hero, navigation and custom CSS — then apply it to any project on this machine. Your site copy, sections, contacts and URLs stay untouched.</p>
        <div style="padding:14px;border:1px solid var(--border);border-radius:14px;background:var(--surface2);margin-bottom:16px">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px"><b>Current brand</b><span class="chip">${esc(currentPalette.name)}</span><span class="chip">${esc(currentFont.name)}</span>${c.site.stylePack ? '<span class="chip">🎨 ' + esc(c.site.stylePack.name || 'Style pack') + '</span>' : ''}${c.site.logo ? '<span class="chip">◆ logo</span>' : ''}</div>
          <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
            <div class="field" style="flex:1;min-width:210px;margin:0"><label>Preset name</label><input id="brandPresetName" maxlength="60" value="${esc(c.site.name || 'Client brand')} brand" placeholder="e.g. Northwind brand"></div>
            <button class="btn primary small" id="brandPresetSave">＋ Save current brand</button>
          </div>
          <label style="display:flex;gap:8px;align-items:flex-start;margin-top:11px;color:var(--muted);font-size:.75rem;line-height:1.45;cursor:pointer"><input type="checkbox" id="brandPresetSeo"><span><b style="color:var(--text)">Include SEO defaults</b><br>Also reuse the meta description, schema type, area served and social image. Leave this off when those details belong to each client.</span></label>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><h4 style="margin:0">Saved brand systems</h4><small style="color:var(--muted)">${brandPresets.length}/${BRAND_PRESET_LIMIT}</small></div>
        <div style="display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto">${rows}</div>`, true);
      const save = $('#brandPresetSave');
      if (save) save.onclick = () => {
        const name = ($('#brandPresetName').value || '').trim() || 'Brand system';
        const old = brandPresets.find((p) => String(p.name || '').toLowerCase() === name.toLowerCase());
        const next = brandPresetFromProject(c, name, $('#brandPresetSeo').checked);
        if (!next) return toast('Could not capture the current brand system.', false);
        if (old) {
          next.id = old.id;
          next.createdAt = old.createdAt || next.createdAt;
          brandPresets = brandPresets.map((p) => p.id === old.id ? next : p);
        } else {
          brandPresets.unshift(next);
          if (brandPresets.length > BRAND_PRESET_LIMIT) brandPresets.pop();
        }
        persistBrandPresets();
        toast(old ? 'Brand preset updated 🎨' : 'Brand preset saved 🎨', true);
        render();
      };
      $$('[data-brand-apply]').forEach((b) => b.onclick = () => {
        const preset = brandPresets.find((p) => p.id === b.dataset.brandApply);
        if (!preset) return;
        histCapture();
        applyBrandPreset(preset, c);
        touch(c);
        renderDesigner();
        closeModal();
        toast('“' + (preset.name || 'Brand system') + '” applied — your site copy and sections stayed intact', true);
      });
      $$('[data-brand-delete]').forEach((b) => b.onclick = () => {
        const preset = brandPresets.find((p) => p.id === b.dataset.brandDelete);
        brandPresets = brandPresets.filter((p) => p.id !== b.dataset.brandDelete);
        persistBrandPresets();
        render();
        toast('“' + (preset ? preset.name : 'Brand preset') + '” deleted');
      });
    };
    render();
  }

  // ============================================================
  // AI style packs — one-click full-look transformations
  // ============================================================
  function openPacks() {
    const c = current();
    if (!c) return toast('Open a project first', false);
    const active = c.site.stylePack ? c.site.stylePack.id : null;
    const cards = AI.stylePacks.map((pk) => {
      const pal = DB.getPalette(pk.palette);
      const f = DB.getFont(pk.font);
      const isAct = active === pk.id;
      return `
      <div class="pack-card ${isAct ? 'active' : ''}">
        <div class="pack-top"><div class="pack-ico">${pk.icon}</div><h4>${esc(pk.name)}</h4></div>
        <div class="pack-tag">${esc(pk.tagline)}</div>
        <div class="pack-swatches">${['bg', 'surface', 'primary', 'accent'].map((k) => `<span class="sw" style="background:${pal[k]}"></span>`).join('')}</div>
        <div class="pack-meta"><span class="chip">${esc(pal.name)}</span><span class="chip">${esc(f.name)}</span><span class="chip">radius ${pk.radius}px</span></div>
        ${isAct ? '<button class="btn ghost small" disabled>✓ Active</button>' : `<button class="btn primary small" data-pack="${pk.id}">Apply${isPro() ? '' : ' · 1 credit'}</button>`}
      </div>`;
    }).join('');
    openModal('🎨 AI style packs', `
      <p style="color:var(--muted);margin-bottom:12px">One click reimagines the whole site — palette, typography, spacing, radius and signature styling. ${active ? 'Currently active: <b style="color:var(--ok)">' + esc(c.site.stylePack.name) + '</b>' : 'Preview updates instantly and everything is undoable with ${KBD}Z.'}</p>
      <div class="packs-grid">${cards}</div>
      <div style="display:flex;gap:14px;margin-top:14px;flex-wrap:wrap;align-items:center">
        ${active ? `<button class="btn danger small" id="clearPack">✕ Clear “${esc(c.site.stylePack.name)}” styling</button>` : ''}
        <span class="pack-note">Free: 1 AI credit per look · Pro: unlimited. Clearing the styling keeps your palette & fonts.</span>
      </div>`, true);
    $$('[data-pack]').forEach((b) => b.onclick = () => {
      if (!spendCredit()) return;
      histCapture();
      AI.applyStylePack(c, b.dataset.pack);
      touch(c);
      renderDesigner();
      renderPlanPill();
      closeModal();
      const pk = AI.stylePacks.find((p) => p.id === b.dataset.pack);
      toast(pk.icon + ' ' + pk.name + ' applied — undo with ${KBD}Z', true);
    });
    const cl = $('#clearPack');
    if (cl) cl.onclick = () => {
      histCapture();
      AI.clearStylePack(c);
      touch(c);
      renderDesigner();
      closeModal();
      toast('Style-pack styling cleared — palette & fonts kept');
    };
  }

  // ---------------- guided onboarding tour ----------------
  const TOUR_KEY = 'pallettai.tour.seen.v1';
  const TOUR_STEPS = [
    {
      sel: null, icon: '◆',
      title: 'Welcome to PallettAI Studio',
      body: 'Design fully functioning, animated websites for your clients — from blank idea to a live link on the internet. Everything here is free to explore; Pro unlocks premium fonts, layouts, live-data widgets and unlimited projects.'
    },
    {
      sel: '#tplGrid', icon: '🏠',
      title: 'Start from a template',
      body: '17 client-ready templates — startups, weddings, cafés, law firms, podcasts, real estate and more. Hit ＋ Start to open one in the Designer, or 👁 Preview to see it live first.'
    },
    {
      sel: '[data-view="designer"]', icon: '🎨',
      title: 'Designer — every pixel, your call',
      body: 'Edit text, swap palettes & fonts, reorder sections with drag & drop, tune spacing and radius, upload a logo — and add whole extra pages with ＋ Page. Changes preview live on the right.'
    },
    {
      sel: '[data-view="ai"]', icon: '✦',
      title: 'AI Studio',
      body: 'Describe a site in plain English — “a modern bakery in Paris” — and the AI builds it: name, palette, fonts, copy and a full layout. It can also restyle, generate images, write alt text and make logos.'
    },
    {
      sel: '[data-view="suites"]', icon: '🧩',
      title: 'Upgrade suites',
      body: 'Sites are never finished — install the Animation Pack, Blog, Shop, SEO, Gallery Pro or live Data Widgets after the fact, without touching your design. The Copilot ✦ button edits everything in plain English too.'
    },
    {
      sel: '[data-view="database"]', icon: '🗄️',
      title: 'Database',
      body: 'The local library holds every section, palette, font and layout — plus live online sources: photos, people, quotes, Wikipedia summaries, and Pro widgets for crypto, GitHub and FX rates.'
    },
    {
      sel: '#planPill', icon: '💎',
      title: 'Plans & referrals',
      body: 'Free keeps the core tools. Pro (£9/mo) unlocks premium fonts, 6 extra layouts, 3 more databases, Data Widgets and unbranded exports. Pro+ (£19/mo) adds white-label client handoff documents. Refer a friend to earn 7 free Pro days — your code lives in Settings.'
    },
    {
      sel: null, icon: '🚀',
      title: 'Ready to build?',
      body: 'Head to the AI Studio and describe your first client site — or pick a template on the Dashboard. Export, hand off or publish whenever you like from the Designer toolbar.'
    }
  ];
  function startTour() {
    if ($('#tourRoot')) return;
    let step = 0;
    const root = document.createElement('div');
    root.id = 'tourRoot';
    root.innerHTML = '<div class="tour-spot"></div><div class="tour-card"></div>';
    document.body.appendChild(root);
    const card = root.querySelector('.tour-card');
    const spot = root.querySelector('.tour-spot');
    let moving = false;
    const show = () => {
      const st = TOUR_STEPS[step];
      if (!st) return finish(true);
      const target = st.sel ? document.querySelector(st.sel) : null;
      let rect = null;
      if (target) {
        rect = target.getBoundingClientRect();
        if (rect.width || rect.height) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      moving = true;
      setTimeout(() => {
        const r = target ? target.getBoundingClientRect() : null;
        if (r && (r.width || r.height)) {
          spot.style.display = '';
          const pad = 6;
          const rr = Math.min(r.width / 2, 24) + 6;
          spot.style.left = Math.max(6, r.left - pad) + 'px';
          spot.style.top = Math.max(6, r.top - pad) + 'px';
          spot.style.width = (r.width + pad * 2) + 'px';
          spot.style.height = (r.height + pad * 2) + 'px';
          spot.style.borderRadius = rr + 'px';
        } else {
          spot.style.display = 'none';
        }
        placeCard(r);
        moving = false;
      }, target ? 420 : 0);
      const dots = TOUR_STEPS.map((_, i) => `<span class="tour-dot ${i === step ? 'on' : ''}"></span>`).join('');
      card.innerHTML = `
        <div class="tour-ico">${st.icon || '◆'}</div>
        <h4>${esc(st.title)}</h4>
        <p>${esc(st.body)}</p>
        <div class="tour-foot">
          <div class="tour-dots">${dots}</div>
          <div style="display:flex;gap:8px">
            ${step > 0 ? '<button class="btn ghost small" id="tourPrev">‹ Back</button>' : ''}
            <button class="btn ghost small" id="tourSkip">Skip</button>
            ${step < TOUR_STEPS.length - 1
              ? '<button class="btn primary small" id="tourNext">Next ›</button>'
              : '<button class="btn primary small" id="tourDone">🚀 Let’s go</button>'}
          </div>
        </div>`;
      const prev = $('#tourPrev'); if (prev) prev.onclick = () => { step--; show(); };
      $('#tourSkip').onclick = () => finish(true); // skipping counts as seen — don't re-offer on every launch
      const next = $('#tourNext'); if (next) next.onclick = () => { step++; show(); };
      const done = $('#tourDone');
      if (done) done.onclick = () => { finish(true); switchView('ai'); };
    };
    const placeCard = (r) => {
      const pad = 14;
      let left = 24, top = 24, maxW = 420;
      if (r && (r.width || r.height)) {
        left = Math.max(pad, Math.min(r.left, innerWidth - maxW - pad));
        top = r.bottom + 18;
        if (top + 240 > innerHeight) top = Math.max(pad, r.top - 250);
      } else {
        left = Math.max(pad, (innerWidth - maxW) / 2);
        top = Math.max(pad, innerHeight - 260);
      }
      card.style.left = left + 'px';
      card.style.top = top + 'px';
      card.style.width = maxW + 'px';
    };
    let finish = (seen) => {
      root.remove();
      if (seen || step === TOUR_STEPS.length - 1) {
        try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) {}
      }
    };
    const reposition = () => { if (!moving) show(); };
    addEventListener('resize', reposition);
    root.addEventListener('scroll', reposition, true);
    root.addEventListener('click', (e) => { if (e.target === root) e.stopPropagation(); });
    const prevFinish = finish;
    finish = (seen) => { removeEventListener('resize', reposition); prevFinish(seen); };
    show();
  }

  // ---------------- boot ----------------
  async function init() {
    if (initialized) return;
    initialized = true;
    // Boot against IndexedDB; falls back to localStorage if unavailable.
    bootStoreOK = (typeof AppStore !== 'undefined') ? await AppStore.init() : false;
    await loadProjects();
    await hydrateRevs();
    loadSettings();
    loadCustomPalettes();
    await hydrateBrandPresets();
    seed();
    $('#btnNewProject').onclick = () => { switchView('dashboard'); $('#tplGrid').scrollIntoView({ behavior: 'smooth' }); };
    $('#btnAiGo').onclick = () => switchView('ai');
    $('#btnUpgrade').onclick = openPricing;
    const btnTour = $('#btnTour');
    if (btnTour) btnTour.onclick = startTour;
    renderPlanPill();
    $$('.nav-item').forEach((b) => b.onclick = () => switchView(b.dataset.view));
    $('#modalClose').onclick = closeModal;
    $('#modalBackdrop').onclick = (e) => { if (e.target === $('#modalBackdrop')) closeModal(); };
    // ---- copilot chat bindings ----
    $('#chatClose').onclick = () => chatOpenPanel(false);
    $('#chatSend').onclick = chatSend;
    $('#chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); chatSend(); } });
    $('#chatList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-chat-undo]');
      if (b) histUndo();
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeModal(); chatOpenPanel(false); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && current()) {
        e.preventDefault();
        if (e.shiftKey) histRedo(); else histUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && current()) { e.preventDefault(); histRedo(); }
    });
    $('#dbTabs').addEventListener('click', (e) => {
      const t = e.target.closest('.db-tab');
      if (!t) return;
      dbTab = t.dataset.tab;
      $$('.db-tab').forEach((x) => x.classList.toggle('active', x === t));
      renderDbList();
    });
    $('#dbSearch').oninput = renderDbList;
    switchView('dashboard');
    // first visit: offer the 2-minute guided tour after the UI settles
    try { if (!localStorage.getItem(TOUR_KEY)) setTimeout(startTour, 700); } catch (e) {}
    // restore a persisted cloud session (if configured) and sync account
    // state (stable code + server-granted trial + streak) in the background
    SUPABASE.restoreSession().then((ok) => {
      if (ok) return syncCloud();
      renderStreakWidget();
      return null;
    }).catch((e) => {
      // Cloud restore is background work; a registry outage must never reject
      // the boot promise or prevent the local studio from remaining usable.
      console.warn('Cloud session restore failed:', e);
      renderStreakWidget();
    });
    console.log('%c◆ PallettAI Studio', 'color:#7c5cff;font-weight:bold;font-size:14px');
    // Best-effort flush of debounced IndexedDB writes when the window closes.
    window.addEventListener('pagehide', () => { try { AppStore.flush().catch(() => {}); } catch (e) {} });

    // ---- native desktop (Electron) menu bridge ----
    if (window.pallettai && typeof window.pallettai.onMenu === 'function') {
      window.pallettai.onMenu((action) => {
        if (action === 'save') { saveProjects(); try { AppStore.flush(); } catch (e) {} return; }
        if (action === 'new-project') {
          switchView('dashboard');
          const g = $('#tplGrid');
          if (g) setTimeout(() => g.scrollIntoView({ behavior: 'smooth' }), 60);
          return;
        }
        const nav = $$('.nav-item').find((b) => b.dataset.view === action);
        if (nav) nav.click();
      });
      console.log('◆ Desktop menu bridge ready (' + window.pallettai.platform + ')');
    }
  }

  return { init, go: switchView };
})();document.addEventListener('DOMContentLoaded', () => {
  Promise.resolve(App.init()).catch((e) => {
    console.error('Studio initialization failed:', e);
    const title = document.querySelector('#viewTitle');
    const dashboard = document.querySelector('#view-dashboard');
    if (title) title.textContent = 'Studio unavailable';
    if (dashboard) dashboard.innerHTML = '<div class="empty-state"><h2>Studio could not start</h2><p>Reload the app to try again. Your saved projects were not changed.</p></div>';
  });
});

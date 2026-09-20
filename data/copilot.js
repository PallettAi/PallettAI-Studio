'use strict';

/*
  data/copilot.js — the reasoning half of the Copilot.

  ai.js already turns a sentence into a list of executable actions. That is the
  parsing half. This module is the half that decides WHAT TO SAY:

    1. review()          — audit the open site and return a ranked fix list
                           where every entry carries an action the copilot can
                           actually execute, so advice and repair cannot drift
                           apart.
    2. interpret()       — turn an ambiguous request into one clear question
                           with tappable answers, instead of a shrug.
    3. metaDescription() — compose SEO copy from the client's own stated facts,
                           because "add a meta description" was advice the
                           copilot could not previously take.

  WHY IT IS SEPARATE
  ------------------
  These three all need to know what the copilot is *for*, not how a sentence
  parses. Keeping them here means they are testable without a DOM, a project
  store or a network call — every function is pure, deterministic and reads
  only the project it is handed.

  app.js owns rendering, undo and credits. ai.js owns command parsing.
*/

const Copilot = (() => {
  const trim = (s) => String(s == null ? '' : s).trim();
  const has = (v) => trim(v).length > 0;

  // Resolve the database the same way revdiff.js does: the browser global when
  // it exists, a require() when running under Node, and null rather than a
  // throw when neither is available.
  function db() {
    try { if (typeof DB !== 'undefined' && DB) return DB; } catch (e) { /* fall through */ }
    try { return (typeof require === 'function') ? require('./db.js') : null; } catch (e) { return null; }
  }

  // ============================================================
  // 1. review — audit, rank, and attach a real fix to every finding
  // ============================================================

  /*
    Impact order. The quality gate reports *validity* — it has to name every
    wrong thing. The copilot reports *what to do next*, so a missing contact
    method outranks a cosmetic heading even though both are warnings: one loses
    the enquiry, the other is polish.

    Matched top to bottom against the gate's issue id, so a more specific
    pattern must come first.
  */
  const IMPACT = [
    [/^no-sections$/, 98],
    [/^site-name$/, 96],
    [/^bad-section|^unknown-section|^page-bad-section|^page-unknown-section/, 94],
    [/^no-hero$|^page-no-hero/, 92],
    // A form that accepts a message and delivers nothing outranks everything
    // cosmetic: the visitor believes they got in touch, and the client never
    // learns they did. It is the most expensive defect a small site can have.
    [/^html-form-action$|^form-endpoint$/, 91],
    [/^html-title$|^html-page-\d+-title$/, 90],
    [/^no-contact$/, 88],
    [/^html-h1$|^html-page-\d+-h1$/, 86],
    [/^missing-photos$/, 82],
    [/^html-image-src$|^html-page-\d+-image-src$/, 80],
    [/^contrast$/, 74],
    [/^meta-description$|^meta-description-length$|^html-meta-length$/, 72],
    [/^page-empty|^empty-section|^empty-items/, 68],
    [/^page-repeated-heading/, 64],
    [/^placeholder/, 62],
    [/^(item-)?image-alt|^html-alt$|^html-page-\d+-alt$/, 58],
    [/^section-items|^section-title|^section-id|^section-layout/, 54],
    [/^booking-/, 52],
    [/^table-/, 50],
    [/^contact-section$/, 46],
    [/^page-no-contact/, 44],
    [/^cta-text$/, 42],
    [/^cta-section$/, 34],
    [/^unsafe-cta$/, 32],
    // The visual audit's findings sit next to their model counterparts but are
    // ranked slightly above them, because these are not inferences about the
    // project — they are what the rendered page does. A palette the model calls
    // fine outranks nothing if the browser measured the text at 2:1.
    [/^visual-contrast/, 78],
    [/^visual-overflow/, 76],
    [/^visual-hero/, 70],
    [/^site-url/, 28],
    [/^palette$/, 24],
    [/^visual-lines/, 23],
    [/^html-/, 22],
    [/^visual-spacing/, 16],
    [/^visual-tap|^visual-tiny/, 14]
  ];
  const DEFAULT_IMPACT = 20;
  const BAND = { error: 300, warn: 200, info: 100 };

  function impactOf(id) {
    const key = String(id || '');
    for (let i = 0; i < IMPACT.length; i++) if (IMPACT[i][0].test(key)) return IMPACT[i][1];
    return DEFAULT_IMPACT;
  }

  /*
    The gate iterates the HOME page's sections. app.js mutates whatever page is
    active. Those are the same array most of the time — normalizePages() aliases
    the active page onto site.sections — but not when a client is editing page
    three of a multi-page site. An index-based fix is only attached when the two
    arrays really are the same object; otherwise the finding stays advisory
    rather than silently rewriting the wrong page.
  */
  function homeSections(project) {
    const s = (project && project.site) || {};
    const pages = Array.isArray(s.pages) ? s.pages.filter((p) => p && typeof p === 'object') : [];
    if (!pages.length) return Array.isArray(s.sections) ? s.sections : [];
    const home = pages.find((p) => p.slug === 'index') || pages[0];
    return Array.isArray(home.sections) ? home.sections : [];
  }
  function indexIsSafe(project) {
    const s = (project && project.site) || {};
    return homeSections(project) === (Array.isArray(s.sections) ? s.sections : []);
  }

  /*
    The page list, resolved the same way app.js resolves it: Builder.pages() in
    the app, site.pages under a test harness, and the bare section list for the
    oldest single-page projects. A finding has to be attributable to a page, or
    a client looking at page three is told to fix something on page one.
  */
  function pages(project) {
    try {
      if (typeof Builder !== 'undefined' && Builder && typeof Builder.pages === 'function') {
        const built = Builder.pages(project);
        if (Array.isArray(built) && built.length) return built;
      }
    } catch (e) { /* fall through to the raw model */ }
    const s = (project && project.site) || {};
    const list = Array.isArray(s.pages) ? s.pages.filter((p) => p && typeof p === 'object') : [];
    if (list.length) return list;
    return [{ id: 'pg-home', name: 'Home', slug: 'index', sections: Array.isArray(s.sections) ? s.sections : [] }];
  }

  function homeName(project) {
    const list = pages(project);
    const home = list.find((p) => p && p.slug === 'index') || list[0];
    return String((home && (home.name || home.slug)) || 'Home');
  }

  /*
    The gate numbers pages two different ways, and guessing between them would
    silently attribute a finding to the wrong page:
      html-page-<n>-*  indexes the full document list (the home export is
                       skipped, but the index still counts it)
      page-<kind>-<n>  indexes the pages OTHER than home
  Both are resolved against the same page list app.js renders from.
  */
  const PAGE_TWO_NUMBERS = /^page-(?:bad-section|unknown-section|section-id)-(\d+)-\d+$/;
  const PAGE_ONE_NUMBER = /^page-(?:empty|no-hero|no-contact)-(\d+)$/;

  function secondaryName(project, i) {
    const list = pages(project);
    const home = list.find((p) => p && p.slug === 'index') || list[0];
    const rest = list.filter((p) => p !== home);
    const p = rest[i];
    return String((p && (p.name || p.slug)) || 'Page ' + (i + 2));
  }

  function pageNameFromId(project, id) {
    const key = String(id || '');
    const html = key.match(/^html-page-(\d+)-/);
    if (html) {
      const list = pages(project);
      const p = list[+html[1]];
      return String((p && (p.name || p.slug)) || 'Page ' + (+html[1] + 1));
    }
    const two = key.match(PAGE_TWO_NUMBERS) || key.match(PAGE_ONE_NUMBER);
    if (two) return secondaryName(project, +two[1]);
    return '';
  }

  /*
    Which page a finding belongs to. Page-scoped ids name it directly; the
    remaining page findings quote the page in their own sentence (“Services is
    empty”), which is a more reliable source than re-deriving an index for the
    repeated-heading counter. Everything else is the home page.
  */
  function pageForIssue(project, issue) {
    const id = String((issue && issue.id) || '');
    const named = pageNameFromId(project, id);
    if (named) return named;
    if (/^page-/.test(id)) {
      const m = String((issue && issue.msg) || '').match(/[“"]([^”"]{2,60})[”"]/);
      if (m) return m[1];
    }
    return homeName(project);
  }

  // The address a site's forms can genuinely deliver to. The builder posts this
  // to FormSubmit over HTTPS with no signup and no key, which is what makes a
  // one-tap repair honest here instead of a placeholder.
  function formEmail(site) {
    const email = trim((site || {}).email);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
  }

  // The page a page-scoped finding is about, as an addressable target. Both the
  // id and the slug travel with an action, so the app can resolve it without
  // re-deriving an index that a previous edit may have moved.
  function pageTarget(project, id, secondaryIndex) {
    const list = pages(project);
    const m = String(id == null ? '' : id).match(/^html-page-(\d+)-/);
    const page = m ? list[+m[1]] : secondaryPageOf(list, secondaryIndex);
    if (!page) return null;
    return {
      pageId: String(page.id || ''),
      pageSlug: String(page.slug || ''),
      name: String(page.name || page.slug || 'the page')
    };
  }

  function secondaryPageOf(list, i) {
    const arr = Array.isArray(list) ? list : [];
    const home = arr.find((p) => p && p.slug === 'index') || arr[0];
    return arr.filter((p) => p !== home)[i];
  }

  /*
    Headings already published anywhere on the site. A new section needs a
    heading nobody else is using: the gate reports a repeated heading across
    pages as a warning, so "fixing" a page by adding a block called the same
    thing as the block above it would lower the site's own score.
  */
  function headingsInUse(project) {
    const used = new Set();
    pages(project).forEach((pg) => (pg.sections || []).forEach((sec) => {
      [sec && sec.title, sec && sec.subtitle].filter(Boolean).forEach((v) => {
        const k = trim(v).toLowerCase();
        if (k) used.add(k);
      });
    }));
    return used;
  }

  /*
    Last-resort lines, for when the copy engine's register pool for a section
    type has nothing left that the site is not already saying. A hero's tagline
    is checked by the same repeated-heading rule as a title, so it needs a pool
    of its own.

    These are deep on purpose. The pool a client actually draws on is the copy
    engine's — four lines for a contact heading — and a five-page site all of
    whose pages need an opening exhausts it, at which point a shallower fallback
    would have started repeating itself and the "fix" would have been a
    downgrade. When even these run out, settleLines() says so and the insert is
    refused rather than duplicated.
  */
  const FALLBACK_LINES = {
    'contact:title': [
      'Get in touch', 'Talk to us', 'Start a conversation', 'Say hello', 'Reach us',
      'Send us a note', 'Tell us more', 'Ask us anything', 'Drop us a line',
      'Speak to the team', 'Make an enquiry', 'Get a reply', 'Keep in touch', 'Start here'
    ],
    'contact:subtitle': [
      'We read everything and reply personally.',
      'We reply within one business day.',
      'Tell us a little about the project and we will take it from there.',
      'A short note is plenty to get started.',
      'Tell us what you need and we will come back to you.',
      'We answer every message ourselves.',
      'Say what you are after and we will take it from there.',
      'One message is all it takes to start.'
    ],
    'hero:title': [
      'Welcome', 'Where to start', 'The short version', 'Begin here', 'Start here',
      'What we do', 'The essentials', 'A quick introduction', 'How we work',
      'Our approach', 'What matters most', 'A little about us', 'In short', 'The details'
    ],
    'hero:subtitle': [
      'A quick look at who we are',
      'The essentials, without the waffle',
      'What we do, in one line',
      'The short version, if you are in a hurry',
      'A few words before you scroll',
      'What we are about',
      'A little context first',
      'How we think about it'
    ]
  };

  /*
    A line for a field that nothing else on the site is already saying. The
    repeated-heading rule counts a hero's tagline as well as its heading, so a
    page insert has to be allocated rather than generated independently: three
    pages each handed "Welcome" look like three fixes and collide the moment
    they are applied together.
  */
  function unusedLine(project, type, field, deps) {
    const D = deps || {};
    const used = headingsInUse(project);
    const candidates = [];
    try {
      if (typeof D.copyOptions === 'function') {
        (D.copyOptions(type) || []).forEach((group) => {
          if (group && group.field === field) (group.options || []).forEach((o) => candidates.push(trim(o)));
        });
      }
    } catch (e) { /* the copy pool is optional; the fallback list still works */ }
    (FALLBACK_LINES[type + ':' + field] || []).forEach((h) => candidates.push(h));
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c && !used.has(c.toLowerCase())) return c;
    }
    return '';
  }

  function unusedHeading(project, type, deps) { return unusedLine(project, type, 'title', deps); }

  // ============================================================
  // The write surface — what the copilot is allowed to change
  // ============================================================

  /*
    An action that can write an arbitrary key can write __proto__, and that is
    the whole of prototype pollution. These are the only site fields the
    copilot ever writes (every key the planner and the reviewer produce), each
    with the shape its value has to satisfy. Anything else is refused rather
    than assigned, so a new action cannot quietly widen what the product can be
    made to write.
  */
  const SITE_FIELDS = Object.freeze({
    name: 'text', tagline: 'text', description: 'text', metaDescription: 'text',
    ctaText: 'text', favicon: 'text', area: 'text',
    email: 'email', ctaLink: 'link', url: 'url', formEndpoint: 'destination',
    // Contact details are checked for shape, not just for length. "address" is
    // an ordinary verb as well as a field, so a planner slip could store the
    // tail of a sentence where the client's address belongs — and a wrong
    // address is a perfectly valid string, so nothing downstream would notice.
    address: 'postal', phone: 'phone'
  });

  // The section fields a generated line can be written into. Not id and not
  // type: an action that can rename a section can break the renderer.
  const SECTION_FIELDS = Object.freeze(['title', 'subtitle', 'text', 'extra']);

  const UNSAFE_KEY = /^(?:__proto__|prototype|constructor)$/;

  function clean(value, max) {
    // Control characters would travel into an exported document; a hard length
    // cap stops one action from writing a megabyte into the project store.
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 400);
  }

  function looksLikeEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  // The tail of a sentence that merely mentioned the word "address" begins with
  // a determiner, a preposition or one of the words this product uses for its
  // own parts. A real address begins with a number or a name.
  const PROSE_HEAD = /^(?:the|a|an|in|on|at|to|of|for|is|are|was|with|near|by|from|and|or|but|field|fields|section|sections|footer|header|page|pages|form|forms|line|box|area|map|label|button|text|not|its|that|this|my|our|your|their)\b/i;

  function looksPostal(v) {
    if (!v) return true;
    const t = String(v).trim();
    if (t.length > 80) return false;
    // "The Old Mill, Bakewell" — a name and a place needs no number
    if (/^[A-Z][\w'’-]*(?:\s+[\w'’-]+){0,3},\s*[A-Z]/.test(t)) return true;
    if (!/\d/.test(t)) return false;
    return !PROSE_HEAD.test(t);
  }

  function looksLikePhone(v) {
    if (!v) return true;
    return /^[+(]?[\d][\d\s().+-]{5,24}$/.test(String(v).trim());
  }

  // Only the link shapes the builder's own safeHref() will render, and only over
  // TLS. No javascript:, no data:, no protocol-relative host. Mirrored here so a
  // copilot action cannot write a link the compiler would then refuse.
  function looksLikeLink(v) {
    if (!v) return true;
    if (v.charAt(0) === '#') return true;
    if (/^[a-z0-9][\w./-]*\.html(?:#.*)?$/i.test(v)) return true;
    if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return true;
    if (/^tel:[+\d\s()-]{4,24}$/i.test(v)) return true;
    return /^https:\/\/\S+$/i.test(v);
  }

  // A form destination is an https endpoint, a bare business email, or a
  // provider access key — the three shapes the builder's deliveryFor() accepts.
  function looksLikeDestination(v) {
    if (!v) return true;
    if (/^https:\/\/\S+$/i.test(v)) return true;
    if (looksLikeEmail(v)) return true;
    return /^[A-Za-z0-9_-]{8,64}$/.test(v);
  }

  // A typed domain without a scheme is what a client writes, and it is safe
  // once it is upgraded over TLS — so it is normalised rather than refused.
  // The builder's safeHref() refuses a schemeless link outright, which would
  // turn the CTA into a dead link, so this cannot be left to the compiler.
  function bareDomain(v) {
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/\S*)?$/i.test(v);
  }

  /*
    sanitiseSiteField(key, value) -> { ok, value, reason }

    Returns the value the action may write, cleaned to its shape. ok:false means
    the write is refused, and the caller must skip the action and say so rather
    than storing it.
  */
  function sanitiseSiteField(key, value) {
    const k = String(key == null ? '' : key);
    if (UNSAFE_KEY.test(k)) return { ok: false, value: '', reason: 'that field cannot be written' };
    const shape = SITE_FIELDS[k];
    if (!shape) return { ok: false, value: '', reason: 'the copilot cannot write that field' };
    const max = k === 'metaDescription' ? 200 : 300;
    const v = clean(value, max);
    if (shape === 'email' && v && !looksLikeEmail(v)) return { ok: false, value: '', reason: 'that is not an email address' };
    if (shape === 'url' && v) {
      if (/^https:\/\/\S+$/i.test(v)) return { ok: true, value: v, reason: '' };
      if (bareDomain(v)) return { ok: true, value: 'https://' + v, reason: '' };
      return { ok: false, value: '', reason: 'a public address must be a domain or start with https://' };
    }
    if (shape === 'link' && !looksLikeLink(v)) {
      if (bareDomain(v)) return { ok: true, value: 'https://' + v, reason: '' };
      return { ok: false, value: '', reason: 'that link is not safe to publish' };
    }
    if (shape === 'destination' && !looksLikeDestination(v)) return { ok: false, value: '', reason: 'that form destination is not usable' };
    if (shape === 'postal' && !looksPostal(v)) return { ok: false, value: '', reason: 'that does not read as a postal address' };
    if (shape === 'phone' && !looksLikePhone(v)) return { ok: false, value: '', reason: 'that does not read as a phone number' };
    return { ok: true, value: v, reason: '' };
  }

  function sanitiseSectionField(field, value) {
    const f = String(field == null ? '' : field);
    if (UNSAFE_KEY.test(f) || SECTION_FIELDS.indexOf(f) === -1) {
      return { ok: false, value: '', reason: 'that section field cannot be written' };
    }
    return { ok: true, value: clean(value, 600), reason: '' };
  }

  /*
    settleLines(project, spec, deps) -> { title, subtitle }

    Settle the lines a new section will carry, against the site as it is at this
    moment. A batch plans its fixes independently, so three page fixes arrive
    with the same heading — and applying all three would then trip the
    repeated-heading rule three times, turning three "fixes" into a measured
    downgrade (79 → 58 on a real generated site before this existed). The insert
    is the only moment that can see the whole site, so it is where the lines are
    settled. Pure, so the collision is testable without a UI.
  */
  function settleLines(project, spec, deps) {
    const s0 = spec || {};
    const type = String(s0.type || '');
    const out = { title: clean(s0.title, 160), subtitle: clean(s0.subtitle, 240), ok: true };
    const inUse = headingsInUse(project);
    const taken = (v) => !!v && inUse.has(v.toLowerCase());
    if (taken(out.title)) {
      const fresh = unusedLine(project, type, 'title', deps);
      if (fresh) out.title = fresh;
      // Nothing left that the site is not already saying. Duplicating it would
      // add the very warning the fix was meant to clear, so the caller is told
      // the insert cannot be offered honestly.
      else out.ok = false;
    }
    // A second line has no such requirement: dropping an eyebrow line is normal
    // and always available, while repeating one is a graded warning.
    if (taken(out.subtitle)) {
      const fresh = unusedLine(project, type, 'subtitle', deps);
      out.subtitle = fresh || '';
    }
    return out;
  }

  /*
    Catalogue ids an action may switch to, checked against the same catalogue the
    renderer looks them up in. A palette or font id that does not exist renders
    as an unstyled fallback, so it is refused at the write rather than applied
    and then reported as a palette the product could not score.
  */
  // The hero layout ids the app's own normalizer and panel accept.
  const HERO_LAYOUTS = Object.freeze(['centered', 'split', 'minimal', 'terminal', 'aurora']);

  function sanitiseChoice(kind, id) {
    const D = db();
    const v = String(id == null ? '' : id);
    if (UNSAFE_KEY.test(v)) return '';
    const listed = (list) => Array.isArray(list) && list.some((x) => x && x.id === v);
    // `layout:<section type>` asks for the catalogue that section renders from.
    const parts = String(kind == null ? '' : kind).split(':');
    const base = parts[0];
    const sectionType = parts[1] || 'hero';
    try {
      if (base === 'palette') return listed(D && D.palettes) ? v : '';
      if (base === 'font') return listed(D && D.fonts) ? v : '';
      if (base === 'navStyle') return (v === '' || v === 'transparent') ? v : '';
      if (base === 'layout' || base === 'hero') {
        if (!v || !D || typeof D.layoutsFor !== 'function') return '';
        if (listed(D.layoutsFor(sectionType))) return v;
        /*
          The hero's own layout list is not the section catalogue's: the panel
          and the project normalizer both use 'centered' (the image-background
          layout) while layoutsFor('hero') lists '' for the same thing. Both are
          accepted rather than refused, because refusing one would break the
          "make the hero centered" suggestion the product already ships.
        */
        if (base === 'hero' && HERO_LAYOUTS.indexOf(v) !== -1) return v;
        return '';
      }
    } catch (e) { return ''; }
    return '';
  }

  function sanitiseSectionType(type) {
    const t = String(type == null ? '' : type);
    if (UNSAFE_KEY.test(t) || !/^[a-z][a-z0-9]{0,23}$/.test(t)) return '';
    const D = db();
    if (D && D.sectionTypes && typeof D.sectionTypes === 'object' && !D.sectionTypes[t]) return '';
    return t;
  }

  /*
    verifyFor(act) -> a descriptor of what the client can check afterwards.

    The review attaches a fix the engine can run; this says how to confirm it
    landed. Verifying by re-reading the same gate finding would be unreliable —
    findings are numbered by position, and an earlier fix can move those
    numbers. These check the concrete thing the action promised instead.
  */
  const SITE_KEY_FOR_OP = Object.freeze({
    palette: 'palette', font: 'font', hero: 'heroLayout', navStyle: 'navStyle',
    navSticky: 'navSticky', navCta: 'navCta', themeToggle: 'themeToggle', suite: null
  });

  function verifyFor(act) {
    const a = act || {};
    switch (a.op) {
      case 'setField':
        if (UNSAFE_KEY.test(String(a.key || '')) || !SITE_FIELDS[String(a.key || '')]) return { kind: 'none' };
        return { kind: 'site', key: String(a.key || ''), value: a.value };
      case 'copyOption':
        // Only an action that names the section by id can be checked by value.
        // One that names it by index cannot: the index may already have moved.
        if (!a.sectionId) return { kind: 'none' };
        return { kind: 'section', sectionId: String(a.sectionId || ''), field: String(a.field || ''), value: a.value };
      case 'addSection':
        return { kind: 'pageSection', pageSlug: String(a.pageSlug || ''), type: String(a.type || '') };
      case 'design':
        return { kind: 'design', key: String(a.key || '') };
      case 'repair':
        return { kind: 'anyChange' };
      default: {
        const key = SITE_KEY_FOR_OP[a.op];
        if (typeof key === 'string' && key) return { kind: 'site', key: key, value: a.op === 'palette' ? a.palette : a.op === 'font' ? a.font : a.style != null ? a.style : a.text != null ? a.text : a.on };
        return { kind: 'none' };
      }
    }
  }

  // Which section does a gate id point at? Only the families that carry an
  // index, because those are the ones a fix can name precisely.
  const INDEXED = /^(?:section-title|section-items|empty-items|empty-section|unknown-section|bad-section|section-id|section-layout|image-alt|placeholder|booking-url|booking-https|table-cols|table-rows|table-shape)-(\d+)$/;
  const ITEM_IMAGE = /^item-image-alt-(\d+)-(\d+)$/;

  function sectionFromId(project, id) {
    const key = String(id || '');
    let m = key.match(ITEM_IMAGE) || key.match(INDEXED);
    if (!m) return null;
    const arr = homeSections(project);
    const sec = arr[+m[1]];
    return sec && typeof sec === 'object' ? { section: sec, index: +m[1] } : null;
  }

  // Section types whose content the copilot can refill from the copy engine.
  // Anything else is handled per finding rather than guessed at.
  const REFILLABLE = new Set(['features', 'stats', 'pricing', 'testimonials', 'faq', 'blog', 'shop', 'gallery', 'logos']);

  /*
    One finding -> one action. The shape is deliberately the same act objects
    ai.js already executes, so review() cannot invent a capability the copilot
    does not have.

    Returns { label, credit, act } or null. A null action is honest: it tells
    app.js to show the gate's advice as text instead of a button that would do
    nothing.
  */
  function actionFor(issue, project, deps) {
    const id = String((issue && issue.id) || '');
    const site = (project && project.site) || {};
    const D = deps || {};
    const safeIdx = indexIsSafe(project);
    const hit = sectionFromId(project, id);
    const sec = hit && hit.section;

    if (id === 'no-sections' || id === 'no-hero') {
      return { label: 'Add a hero section', act: { op: 'addSection', type: 'hero' } };
    }
    /*
      A page's own shape. These are the findings a multi-page site generates
      most, and until now every one of them was advice, because an insert could
      only reach the page the designer had open. The action carries the page's
      id and slug so the app resolves the real page instead of an index that an
      earlier fix may have moved, and the heading is chosen from the copy engine
      with a check that no other page already uses it — adding a block called the
      same thing as the block above it would trip the repeated-heading warning
      and make the "fix" a downgrade.
    */
    const pageScoped = String(id).match(/^page-(?:no-hero|no-contact|empty)-(\d+)$/);
    if (pageScoped) {
      const target = pageTarget(project, id, +pageScoped[1]);
      if (!target) return null;
      // The page that *is* the contact route does not need a second one. Without
      // this the Contact page — whose own opening already says "Get in touch" —
      // was handed a contact block that repeated its own heading.
      if (/no-contact/.test(id) && /^contact$/i.test(target.pageSlug)) return null;
      const type = /no-contact/.test(id) ? 'contact' : 'hero';
      const heading = unusedHeading(project, type, deps);
      const label = type === 'contact'
        ? 'Add a contact block to ' + target.name
        : (/^page-empty/.test(id) ? 'Give ' + target.name + ' a first section' : 'Add an opening to ' + target.name);
      const act = { op: 'addSection', type: type, pageId: target.pageId, pageSlug: target.pageSlug, label: label };
      if (heading) act.title = heading;
      return { label: label, act: act };
    }

    if (id === 'missing-photos') {
      return { label: 'Find photos that match', credit: true, act: { op: 'images', credit: true } };
    }

    if (id === 'meta-description' || id === 'meta-description-length') {
      const value = metaDescription(project);
      if (!value) return null;
      return { label: 'Write one from my copy', act: { op: 'setField', key: 'metaDescription', value } };
    }

    if (id === 'cta-text') {
      const brief = site.brief || {};
      const value = trim(brief.cta) || 'Get started';
      return { label: 'Use “' + value + '”', act: { op: 'setField', key: 'ctaText', value } };
    }

    if (id === 'contact-section') {
      return { label: 'Add a contact section', act: { op: 'addSection', type: 'contact' } };
    }
    if (id === 'cta-section') {
      return { label: 'Add a call to action', act: { op: 'addSection', type: 'cta' } };
    }

    if (id === 'site-url' && has(site.url) && !/^https?:\/\//i.test(trim(site.url))) {
      return { label: 'Use https://', act: { op: 'setField', key: 'url', value: 'https://' + trim(site.url) } };
    }

    /*
      Export-level findings. The copilot now audits the document the visitor
      actually receives, so these arrive alongside the model findings. Only the
      ones the model can genuinely change get a button: the rest are emitted by
      the builder, and a chat message cannot change them, so they stay advice.
    */
    if (id === 'html-form-action' || id === 'form-endpoint') {
      const email = formEmail(site);
      if (!email) return null;
      return {
        label: 'Deliver messages to ' + email,
        act: { op: 'setField', key: 'formEndpoint', value: email }
      };
    }
    if (/^html(?:-page-\d+)?-alt$/.test(id)) {
      return { label: 'Write the alt text', act: { op: 'alt' } };
    }
    if (id === 'html-meta-length') {
      const value = metaDescription(project);
      if (!value) return null;
      return { label: 'Write one that fits', act: { op: 'setField', key: 'metaDescription', value } };
    }
    if (id === 'html-ids') {
      return { label: 'Regenerate the duplicate IDs', act: { op: 'repair' } };
    }
    if (id === 'html-image-src') {
      return { label: 'Find photos that match', credit: true, act: { op: 'images', credit: true } };
    }

    if (id === 'contrast') {
      // Offer the palettes that pass the same audit, rather than telling the
      // client to go and find one.
      const D0 = db();
      if (!D0 || !Array.isArray(D0.palettes) || typeof D0.paletteChecks !== 'function') return null;
      const options = [];
      for (const pal of D0.palettes) {
        if (!pal || !pal.id || pal.id === site.palette) continue;
        let checks = [];
        try { checks = D0.paletteChecks(pal) || []; } catch (e) { checks = []; }
        if (!checks.length || checks.some((c) => !c || c.ratio < c.need)) continue;
        options.push({ label: pal.name || pal.id, act: { op: 'palette', palette: pal.id } });
        if (options.length >= 3) break;
      }
      if (!options.length) return null;
      return { label: 'Use ' + options[0].label, act: options[0].act, choices: options, choicesLabel: 'AA-safe palettes' };
    }

    if (id === 'image-alt' || /^item-image-alt-/.test(id)) {
      return { label: 'Write the alt text', act: { op: 'alt' } };
    }

    if (/^placeholder-/.test(id) && hit && safeIdx) {
      return {
        label: 'Rewrite it properly',
        credit: true,
        act: { op: 'rewrite', idx: hit.index, prompt: 'replace the placeholder copy', credit: true }
      };
    }

    if (/^(empty-items|section-items|section-title|empty-section)-/.test(id) && sec && safeIdx) {
      if (REFILLABLE.has(sec.type)) {
        return {
          label: 'Fill it with copy',
          credit: true,
          act: { op: 'rewriteItems', type: sec.type, idx: hit.index, credit: true }
        };
      }
      if (sec.type === 'hero' && id.indexOf('section-title') !== 0) {
        return { label: 'Rewrite the hero copy', credit: true, act: { op: 'rewrite', idx: hit.index, prompt: 'shorten and sharpen the hero copy', credit: true } };
      }
    }

    if (/^page-repeated-heading/.test(id)) {
      // A heading already published elsewhere. If the copy engine can offer
      // alternatives for that section, this becomes a choice instead of advice.
      const pageSecs = [];
      const s = (project && project.site) || {};
      (Array.isArray(s.pages) ? s.pages : []).forEach((pg) => (pg.sections || []).forEach((x) => pageSecs.push(x)));
      const dupes = {};
      pageSecs.forEach((x) => {
        [x && x.title, x && x.subtitle].filter(Boolean).forEach((v) => {
          const k = trim(v).toLowerCase();
          if (k.length > 3) dupes[k] = (dupes[k] || 0) + 1;
        });
      });
      const repeated = Object.keys(dupes).filter((k) => dupes[k] > 1);
      const target = repeated.length ? pageSecs.find((x) => x && trim(x.title).toLowerCase() === repeated[0]) : null;
      const alts = (target && typeof D.copyOptions === 'function') ? D.copyOptions(target.type) : null;
      const list = (alts || []).flatMap((group) => (group.options || []).map((o) => ({ label: o, group })));
      if (list.length >= 2) {
        const choices = list.slice(0, 3).map((o) => ({
          label: o.label,
          act: { op: 'copyOption', sectionId: target.id, field: o.group.field, value: o.label }
        }));
        return { label: 'Give it its own heading', act: choices[0].act, choices, choicesLabel: 'Other headings' };
      }
      return null;
    }

    /*
      The visual findings. These arrive already measured — the browser read the
      computed colour and the real line boxes — so the only thing decided here is
      whether the fix they carry can actually deliver what it promises. Each
      branch is deliberately narrow: if the arithmetic behind an action is not in
      the finding, the finding stays advice rather than growing a button that
      would change the wrong thing.
    */
    if (/^visual-contrast-/.test(id)) {
      const v = issue.visual || {};
      /*
        A report is data, and it is also cached across edits and across builds.
        So every palette is put through the same guard the write uses before it
        is offered: an id this build no longer ships would otherwise become a
        button the engine refuses, which is a dead button — the one thing a fix
        offered to a client must never be.
      */
      const list = (Array.isArray(v.palettes) ? v.palettes : [])
        .filter((p) => p && p.name && sanitiseChoice('palette', p.id));
      if (!list.length) return null;
      // Every candidate was checked against DB.paletteChecks — the product's own
      // AA definition — so switching to one removes the failing pair.
      const choices = list.slice(0, 3).map((p) => ({ label: p.name, act: { op: 'palette', palette: sanitiseChoice('palette', p.id) } }));
      return { label: 'Use ' + choices[0].label, act: choices[0].act, choices, choicesLabel: 'Palettes measured AA-safe' };
    }

    if (/^visual-overflow-/.test(id)) {
      const v = issue.visual || {};
      const a = v.alternative;
      if (!v.sectionId || !a || !a.value) return null;
      const opts = (a.alts || [a]).filter((x) => x && x.value).slice(0, 3)
        .map((x) => ({ label: x.value, act: { op: 'copyOption', sectionId: v.sectionId, field: x.field, value: x.value } }));
      if (!opts.length) return null;
      return { label: 'Use wording that fits', act: opts[0].act, choices: opts, choicesLabel: 'Shorter wording' };
    }

    if (/^visual-hero-/.test(id)) {
      const v = issue.visual || {};
      const alts = Array.isArray(v.alternatives) ? v.alternatives : [];
      if (!v.sectionId || !alts.length) return null;
      const opts = alts.filter((x) => x && x.value).slice(0, 3)
        .map((x) => ({ label: x.value, act: { op: 'copyOption', sectionId: v.sectionId, field: x.field, value: x.value } }));
      if (!opts.length) return null;
      return { label: 'Shorten the opening', act: opts[0].act, choices: opts, choicesLabel: 'Shorter openings' };
    }

    if (/^visual-lines-/.test(id)) {
      const v = issue.visual || {};
      // newWidth is blank unless narrowing the column actually lands the line
      // length inside the comfortable range, so this is never an empty gesture.
      if (!v.newWidth) return null;
      return { label: 'Narrow the text column', act: { op: 'design', key: 'containerWidth', to: v.newWidth } };
    }

    if (/^visual-spacing-/.test(id)) {
      const v = issue.visual || {};
      if (!v.to || !v.current || v.to <= v.current) return null;
      return { label: 'Give the sections room', act: { op: 'design', key: 'spacing', to: v.to } };
    }

    return null;
  }

  /*
    review() -> { score, letter, ready, total, counts, items }

    items are ranked so the most consequential thing is the one a client reads
    first. Anything the copilot can repair carries `action`; anything it cannot
    carries only the gate's advice, which the UI must render as text.
  */
  function review(project, gate, deps) {
    const g = gate || null;
    if (!g || !Array.isArray(g.issues)) {
      return { score: 100, letter: 'A+', ready: true, total: 0, counts: { error: 0, warn: 0, info: 0 }, items: [] };
    }
    // A page badge is only useful when there is more than one page to confuse.
    const multiPage = pages(project).length > 1;
    const shape = (issue) => {
      const level = issue.level === 'error' || issue.level === 'warn' ? issue.level : 'info';
      const action = actionFor(issue, project, deps);
      return {
        id: String(issue.id || ''),
        level,
        title: fixTitleFor(issue, project),
        detail: trim(issue.msg),
        advice: trim(issue.fix),
        impact: impactOf(issue.id),
        page: multiPage ? pageForIssue(project, issue) : '',
        visual: !!issue.visual,
        action: action || null
      };
    };
    /*
      The visual findings are appended to the model's, not merged with them.
      They come from a different audit — the rendered page — and they carry their
      own page attribution, so routing them through the gate's numbering would
      attribute them to the wrong page on a multi-page site.
    */
    const visual = Array.isArray((deps || {}).visual) ? deps.visual : [];
    const items = g.issues.map(shape).concat(visual.map((v) => {
      const item = shape(v);
      // A render finding carries its own page attribution, so the gate's
      // numbering (which counts two different ways) never has to be second-
      // guessed for it. The badge still only appears on a multi-page site.
      item.page = multiPage ? (item.page || trim((v.visual || {}).pageName) || '') : '';
      item.visual = true;
      return item;
    })).filter((it) => it.id)
      .sort((a, b) => (BAND[b.level] + b.impact) - (BAND[a.level] + a.impact));
    const counts = { error: 0, warn: 0, info: 0 };
    const byPage = {};
    items.forEach((it) => {
      counts[it.level]++;
      if (it.page) byPage[it.page] = (byPage[it.page] || 0) + 1;
    });
    return {
      score: Number(g.score) || 0,
      letter: g.letter || '',
      ready: !!g.ready,
      total: items.length,
      counts,
      byPage,
      pageCount: pages(project).length,
      actionable: items.filter((it) => it.action).length,
      visual: items.filter((it) => it.visual).length,
      items
    };
  }

  /*
    simulate(project, deps) -> { changed, before, after, gained, remaining } | null

    A promised score is only worth showing if it was measured, so this does not
    estimate anything: it deep-clones the project, applies the caller's repair,
    and runs the SAME audit again on the clone. deps.gate must be the render
    audit app.js uses, because comparing an export-aware score with a model-only
    one would invent the very number it is reporting.
  */
  function simulate(project, deps) {
    const D = deps || {};
    if (!project || typeof D.gate !== 'function' || typeof D.apply !== 'function') return null;
    // A deep copy of an enormous project is a stall, not a measurement, so a
    // project past any plausible size is left unmeasured rather than cloned.
    const sections = sectionsOf(project).length;
    if (sections > 600) return null;
    let clone;
    try { clone = JSON.parse(JSON.stringify(project)); } catch (e) { return null; }
    if (!clone || !clone.site) return null;
    const before = D.gate(project);
    if (!before) return null;
    let changed = 0;
    try { changed = Number((D.apply(clone) || {}).changed) || 0; } catch (e) { return null; }
    if (!changed) return null;
    const after = D.gate(clone);
    if (!after) return null;
    const from = Number(before.score) || 0;
    const to = Number(after.score) || 0;
    return {
      changed,
      before: from,
      after: to,
      gained: to - from,
      remaining: Array.isArray(after.issues) ? after.issues.length : 0,
      beforeIssues: Array.isArray(before.issues) ? before.issues.length : 0,
      letter: after.letter || ''
    };
  }

  /*
    A finding's own headline. The gate's msg is a full sentence aimed at a
    developer ("The home page has no hero section."); a review card needs a
    scannable label above it.
  */
  function fixTitleFor(issue, project) {
    const id = String((issue && issue.id) || '');
    // Name the section a finding is about. Without this, a site with three
    // empty sections produces three identical-looking cards and the client has
    // no way to tell which one to open.
    const hit = project ? sectionFromId(project, id) : null;
    const typeName = (hit && hit.section && hit.section.type) ? niceType(hit.section.type) : '';
    const the = typeName ? 'The ' + typeName + ' section' : 'A section';
    if (id === 'no-sections') return 'The site has no content yet';
    if (id === 'site-name') return 'No business name';
    if (id === 'no-hero') return 'No hero section';
    if (/^page-no-hero/.test(id)) return 'A page opens with no heading';
    if (id === 'no-contact') return 'No way to get in touch';
    if (id === 'contact-section') return 'No contact section';
    if (id === 'cta-section') return 'No call to action';
    if (id === 'cta-text') return 'The main button has no label';
    if (id === 'missing-photos') return 'No photo in the hero';
    if (id === 'meta-description') return 'No search description';
    if (id === 'meta-description-length') return 'Search description is the wrong length';
    if (id === 'site-url-missing') return 'No public web address';
    if (id === 'site-url') return 'Web address is missing https://';
    if (id === 'unsafe-cta') return 'An unsafe link on the main button';
    if (id === 'form-endpoint') return 'The form destination is not usable';
    if (id === 'contrast') return 'Text contrast below WCAG AA';
    if (/^placeholder-/.test(id)) return 'Placeholder copy in ' + (typeName ? 'the ' + typeName + ' section' : 'a section');
    if (/^(empty-items|section-items)-/.test(id)) return the + ' has no content';
    if (/^empty-section-/.test(id)) return the + ' is empty';
    if (/^section-title-/.test(id)) return the + ' has no heading';
    if (/^section-id-/.test(id)) return the + ' has a duplicate ID';
    if (/^section-layout-/.test(id)) return the + ' uses an unknown layout';
    if (/^image-alt-/.test(id)) return 'An image in ' + (typeName ? 'the ' + typeName + ' section' : 'a section') + ' has no alt text';
    if (/^item-image-alt-/.test(id)) return 'A card image in ' + (typeName ? 'the ' + typeName + ' section' : 'a section') + ' has no alt text';
    if (/^booking-/.test(id)) return 'The booking block is not usable yet';
    if (/^table-/.test(id)) return 'The table is malformed';
    if (/^page-repeated-heading/.test(id)) return 'Two pages share a heading';
    if (/^page-empty-/.test(id)) return 'A page is empty';
    if (/^page-no-contact/.test(id)) return 'A page has no contact route';
    if (/^unknown-section-|^bad-section/.test(id)) return 'A section cannot be rendered';
    if (/^page-unknown-section|^page-bad-section/.test(id)) return 'A page contains a section that cannot be rendered';
    if (/^html-h1/.test(id)) return 'Heading structure problem';
    if (/^html-title$/.test(id)) return 'The page has no title';
    if (/^html-viewport/.test(id)) return 'No mobile viewport declared';
    if (/^html-alt$|^html-page-\d+-alt$/.test(id)) return 'Images without alt text';
    if (id === 'html-form-action') return 'Enquiries from your contact form are lost';
    if (id === 'html-meta-length') return 'The search description is the wrong length';
    if (id === 'html-ids') return 'The page has duplicate element IDs';
    if (/^html-image-src$/.test(id)) return 'An image has no source';
    if (/^html-/.test(id)) return 'Export markup problem';
    if (/^visual-contrast/.test(id)) return 'Text is hard to read';
    if (/^visual-overflow/.test(id)) return 'A phone scrolls sideways';
    if (/^visual-hero/.test(id)) return 'The opening does not get to the point';
    if (/^visual-lines/.test(id)) return 'Lines of text run too long';
    if (/^visual-tiny/.test(id)) return 'Some text is too small to read';
    if (/^visual-tap/.test(id)) return 'Buttons are too small to tap';
    if (/^visual-spacing/.test(id)) return 'Sections are crowded together';
    if (/^palette$/.test(id)) return 'The palette could not be scored';
    // fall back to the gate's own sentence, clipped at a word boundary
    const msg = trim(issue && issue.msg);
    return msg ? msg.replace(/^(The|A|An) /, '').replace(/\.$/, '') : 'Something to fix';
  }

  // ============================================================
  // 2. metaDescription — say it in the client's own words
  // ============================================================

  /*
    The gate has always warned about a missing meta description with the advice
    "generate a concise description from the site copy" — advice the product
    then did not take. This composes one, but only from facts the client has
    actually given us: their name, their offer, their area, their own about
    text. Nothing is invented, and when there is nothing to work with it returns
    an empty string so the finding stays advisory.

    Target range is 60–155 characters: long enough for the job, short enough
    that search engines do not truncate mid-thought.
  */
  function metaDescription(project) {
    const s = (project && project.site) || {};
    const brand = trim(s.name || (project && project.name));
    const brief = s.brief || {};
    const rawOffer = trim(brief.offer) || trim(s.tagline);
    const rawCta = trim(s.ctaText) || trim(brief.cta);
    const area = trim(s.area);
    const about = firstSentence(aboutText(project));
    if (!brand && !rawOffer && !about) return '';

    const inArea = area ? ' in ' + area : '';
    // Whether the client's own pitch is already a whole sentence decides how it
    // may be used: a full sentence stands alone, a short phrase joins the name
    // with a dash. Mixing the two produced lines like
    //   "Rivet & Sons — A leak at 11pm should not be a lottery. in Leeds."
    const sentence = (t) => { const x = trim(t).replace(/\s+/g, ' '); return x && !/[.!?]$/.test(x) ? x + '.' : x; };
    const phrase = (t) => trim(t).replace(/\s+/g, ' ').replace(/[.!?,;:]+$/, '');
    const offer = phrase(rawOffer);
    const cta = phrase(rawCta);
    const offerIsSentence = /[.!?]/.test(rawOffer) || offer.split(/\s+/).filter(Boolean).length > 7;
    const namesBrand = !!(offer && brand && offer.toLowerCase().indexOf(brand.toLowerCase()) !== -1);
    const led = (mid) => (brand ? brand + ' — ' + mid : mid);

    const candidates = [];
    if (offer) {
      if (offerIsSentence || namesBrand) {
        // the pitch is a sentence of its own; keep the brand out of the way
        candidates.push([sentence(rawOffer), sentence('Based' + inArea), sentence(cta)].join(' '));
        candidates.push([sentence(rawOffer), sentence('Based' + inArea)].join(' '));
        candidates.push([sentence(rawOffer), sentence(cta)].join(' '));
        candidates.push(sentence(rawOffer));
      } else {
        candidates.push(sentence(led(offer + inArea)));
        candidates.push([sentence(led(offer + inArea)), sentence(cta)].join(' ').trim());
        candidates.push(sentence(brand + ': ' + offer + inArea));
      }
    }
    if (about) {
      // The about paragraph is generated prose, so a blind character cut leaves
      // a dangling clause — "...stone-milled local flour, French in York." Cut
      // it back to a boundary that still reads as a thought, and only add the
      // area when the sentence actually finished.
      const complete = /[.!?]$/.test(about);
      const says = clipClause(about, complete ? 120 : 120);
      const names = brand && says.toLowerCase().indexOf(brand.toLowerCase()) !== -1;
      const body = names ? says : led(says);
      candidates.push(sentence(body + (complete ? inArea : '')));
      if (complete) candidates.push(sentence(says + ' Based' + inArea));
    }
    if (cta) candidates.push(sentence(led(lowerFirst(cta) + inArea)));
    if (area) candidates.push(sentence(led('a local business based' + inArea)));

    const inRange = candidates.map(tidy).filter((c) => c.length >= 60 && c.length <= 155);
    if (inRange.length) return inRange[0];
    // Nothing landed in range. Take the fullest candidate and trim it rather
    // than padding it out with words we have no facts for.
    // Below the range's floor there is no point returning anything: the gate
    // would only flag the exchange as a wrong-length description, so a client
    // would trade one warning for another. Empty keeps the finding advisory.
    const best = candidates.map(tidy).filter((c) => c.length >= 50).sort((a, b) => b.length - a.length)[0];
    return best ? clip(best, 155) : '';
  }

  // The client's own about paragraph, wherever it lives.
  function aboutText(project) {
    const sec = sectionsOf(project).find((x) => x && x.type === 'about' && has(x.text));
    return sec ? sec.text : '';
  }

  // "features" -> "features" (the DB's own label, lowercased). Falls back to the
  // raw id so a new section type degrades to something readable.
  /*
    The product's own name for a section, in the case a sentence needs.
    "FAQ" is an acronym and stays capitalised; "Features" becomes "features"
    mid-sentence. Falls back to the raw id so a brand-new section type still
    produces a readable sentence.
  */
  function niceType(type) {
    const t = String(type || '');
    const D = db();
    if (D && D.sectionTypes && D.sectionTypes[t] && D.sectionTypes[t].name) {
      const name = String(D.sectionTypes[t].name);
      return /^[A-Z]{2,}/.test(name) ? name : lowerFirst(name);
    }
    return t;
  }

  // "an FAQ", "a Features" — a label the product chose must not make the
  // copilot's own sentence ungrammatical.
  // Letters whose *names* start with a vowel sound. "an FAQ", "an HTML block",
  // but "a CTA" and "a UK site".
  const VOWEL_SOUND_LETTERS = new Set(['A', 'E', 'F', 'H', 'I', 'L', 'M', 'N', 'O', 'R', 'S', 'X']);
  function articleFor(word) {
    const w = trim(word);
    if (!w) return 'a';
    if (/^[A-Z]{2,}/.test(w)) return VOWEL_SOUND_LETTERS.has(w.charAt(0)) ? 'an' : 'a';
    return /^[aeiou]/i.test(w) ? 'an' : 'a';
  }

  function sectionsOf(project) {
    const s = (project && project.site) || {};
    const pages = Array.isArray(s.pages) ? s.pages : [];
    const all = [];
    if (Array.isArray(s.sections)) all.push.apply(all, s.sections);
    pages.forEach((pg) => { if (pg && Array.isArray(pg.sections)) all.push.apply(all, pg.sections); });
    return all;
  }
  function firstSentence(text) {
    const t = trim(text).replace(/\s+/g, ' ');
    if (!t) return '';
    const m = t.match(/^(.{20,160}?[.!?])(\s|$)/);
    return m ? m[1] : clip(t, 150);
  }
  function lowerFirst(s) {
    const t = trim(s);
    return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
  }
  function clip(s, max) {
    const t = trim(s).replace(/\s+/g, ' ');
    if (t.length <= max) return t;
    return t.slice(0, max).replace(/\s+\S*$/, '').replace(/[,;:.—–-]$/, '');
  }
  /*
    Clip prose to the last boundary that still reads as a complete thought.
    A meta description that ends mid-clause looks like a mistake in a search
    result, so prefer the last sentence, then the last dash or colon, then the
    last comma — and only fall back to a plain word cut when nothing shorter
    would leave enough words behind to say anything.
  */
  function clipClause(s, max) {
    const t = trim(s).replace(/\s+/g, ' ');
    if (t.length <= max) return t.replace(/[.!?]+$/, '');
    const head = t.slice(0, max);
    for (const re of [/[.!?](?=\s)/g, /[:—–](?=\s)/g, /[,;](?=\s)/g]) {
      let last = -1;
      let m;
      const rx = new RegExp(re.source, 'g');
      while ((m = rx.exec(head)) !== null) last = m.index;
      if (last > 24) {
        const cut = head.slice(0, last).replace(/[,;:—–]+$/, '');
        if (cut.split(/\s+/).filter(Boolean).length >= 5) return cut;
      }
    }
    return clip(head, max);
  }
  function tidy(s) {
    return trim(s).replace(/\s+/g, ' ').replace(/\s+([.,;])/g, '$1').replace(/,\s*$/, '').replace(/\.{2,}$/, '.');
  }

  // ============================================================
  // 3. interpret — name the ambiguity instead of guessing
  // ============================================================

  /*
    A pattern engine cannot tell whether "make it warmer" means the colour or
    the writing. Guessing wrong is worse than asking: the client sees their site
    change into something they did not ask for, and stops trusting the button.

    So interpret() only fires on shapes that are genuinely two-way, and always
    answers with options the copilot can execute — never with a clarification
    that leads nowhere.
  */

  // Words that describe both a LOOK and a VOICE. `look` is a style-pack id,
  // `palette` a palette id, `tone` a word the copy rewriter understands.
  const DUAL = {
    premium: { look: 'lux', palette: 'pack_lux', tone: 'premium' },
    luxurious: { look: 'lux', palette: 'pack_lux', tone: 'premium' },
    elegant: { look: 'lux', palette: 'pack_lux', tone: 'premium' },
    luxury: { look: 'lux', palette: 'pack_lux', tone: 'premium' },
    warm: { look: 'sunset', palette: 'sunset', tone: 'warm' },
    warmer: { look: 'sunset', palette: 'sunset', tone: 'warm' },
    cosy: { look: 'zen', palette: 'sage', tone: 'warm' },
    cozy: { look: 'zen', palette: 'sage', tone: 'warm' },
    bold: { look: 'brutal', palette: 'noir', tone: 'bold' },
    bolder: { look: 'brutal', palette: 'noir', tone: 'bold' },
    playful: { look: 'playful', palette: 'candy', tone: 'playful' },
    fun: { look: 'playful', palette: 'candy', tone: 'playful' },
    minimal: { look: 'zen', palette: 'stone', tone: 'concise' },
    clean: { look: 'zen', palette: 'stone', tone: 'concise' },
    cleaner: { look: 'zen', palette: 'stone', tone: 'concise' },
    modern: { look: 'editorial', palette: 'cobalt', tone: 'refined' },
    editorial: { look: 'editorial', palette: 'ink', tone: 'refined' }
  };

  // Words that carry no intent on their own. A message is only "just an
  // adjective" if this is all that is left once they are removed.
  const FILLER = new Set(['a', 'an', 'the', 'it', 'this', 'that', 'to', 'please', 'me', 'my', 'our', 'and', 'bit', 'slightly', 'really', 'very', 'just', 'more', 'some', 'kind', 'of', 'can', 'you', 'could', 'would', 'i', 'we', 's', 'feel', 'feels', 'look', 'looks', 'looking']);
  const GENERIC_VERB = new Set(['make', 'give', 'go', 'turn', 'set', 'use', 'try', 'want', 'like', 'do', 'get', 'have', 'need']);
  const VAGUE_WORDS = new Set(['better', 'nicer', 'different', 'fancier', 'pop', 'wow', 'amazing', 'standout', 'interesting', 'appealing', 'something', 'special', 'great', 'good', 'anything', 'fresh', 'new', 'cool']);

  // The words a mention was recognised by, so "the FAQ" can lose "faq" and be
  // seen for what it is: a section name and nothing else.
  function mentionWords(hit) {
    const out = new Set();
    String((hit && hit.word) || '').split(/\s+/).forEach((w) => { if (w) out.add(w); });
    String((hit && hit.type) || '').split(/\s+/).forEach((w) => { if (w) out.add(w); });
    out.add('section'); out.add('sections');
    return out;
  }
  // Everything a message says once filler, generic verbs and the mentioned
  // section's own words are removed.
  function remainder(norm, mentions) {
    const drop = new Set();
    (Array.isArray(mentions) ? mentions : []).forEach((h) => mentionWords(h).forEach((w) => drop.add(w)));
    return norm.trim().split(/\s+/).filter((w) => w && !FILLER.has(w) && !GENERIC_VERB.has(w) && !drop.has(w));
  }

  /*
    interpret(raw, opts) -> { kind: 'ask', question, options } | { kind: 'none' }

    opts.mentions — section mentions already found by ai.js (type + the word the
                    client used), so this module does not re-implement parsing.
    opts.hasTarget — whether a previous edit gives something to follow up on.
    opts.site      — the site, for questions that name the client's own words.
  */
  const START_HERE = [
    { label: 'Review the site and tell me what is wrong', act: { op: 'review', label: '' }, note: 'a ranked list of fixes' },
    { label: 'Make the copy sharper', act: { op: 'rewriteAll', prompt: 'sharpen the copy: shorter sentences, less hedging', credit: true, label: 'Sharpened the site copy' }, note: 'uses 1 credit' },
    { label: 'Show me the site with a different look', act: { op: 'pack', pack: 'editorial', credit: true, label: 'Applied the Editorial look' }, note: 'restyles the whole site' }
  ];

  function interpret(raw, opts) {
    const o = opts || {};
    const text = trim(raw);
    if (!text) return { kind: 'none' };
    const n = text.toLowerCase().replace(/[’‘“”]/g, "'").replace(/[^a-z0-9+@.']+/g, ' ').trim();
    const words = n.split(/\s+/).filter(Boolean);
    const mentions = Array.isArray(o.mentions) ? o.mentions : [];
    const left = remainder(n, mentions);
    // A follow-up with a target is handled by the caller: it has context we do
    // not, so asking here would throw that away.
    if (o.hasTarget) return { kind: 'none' };

    // --- (a) one adjective that means two different things ---------------
    // Only when it is genuinely the whole message. "make it premium and
    // warmer" has two readings each, so it is not one question.
    if (!mentions.length && left.length === 1) {
      const key = left[0];
      const d = DUAL[key];
      if (d) {
        const options = [];
        if (d.look) {
          options.push({
            label: 'A ' + key + ' restyle — the whole look',
            act: { op: 'pack', pack: d.look, credit: true, label: 'Applied the ' + key + ' look' },
            note: 'palette, type and spacing together'
          });
        }
        if (d.palette) {
          options.push({
            label: 'Just the colours',
            act: { op: 'palette', palette: d.palette, label: 'Switched the palette' },
            note: 'keeps your type and layout'
          });
        }
        if (d.tone) {
          options.push({
            label: 'The writing — a ' + key + ' tone',
            act: { op: 'rewriteAll', prompt: text, credit: true, label: 'Rewrote the copy in a ' + key + ' tone' },
            note: 'uses 1 credit'
          });
        }
        if (options.length >= 2) {
          return { kind: 'ask', question: '“' + key + '” could mean two things here — which did you mean?', options };
        }
      }
      if (key === 'dark' || key === 'darker' || key === 'night') {
        return {
          kind: 'ask',
          question: 'Dark how? I can do either.',
          options: [
            { label: 'A dark palette for the whole site', act: { op: 'palette', palette: 'midnight', label: 'Switched to the Midnight palette' }, note: 'no credits used' },
            { label: 'A light/dark toggle for visitors', act: { op: 'themeToggle', on: true, label: 'Added a visitor theme toggle' }, note: 'each visitor chooses' }
          ]
        };
      }
      if (key === 'light' || key === 'lighter' || key === 'brighter') {
        return {
          kind: 'ask',
          question: 'Lighter how?',
          options: [
            { label: 'A lighter palette', act: { op: 'palette', palette: 'paper', label: 'Switched to the Paper palette' }, note: 'colours only' },
            { label: 'More space between sections', act: { op: 'design', key: 'spacing', delta: 24, label: 'More space between sections' }, note: 'keeps the colours as they are' }
          ]
        };
      }
    }

    // --- (b) a section named, and nothing else said about it -------------
    if (mentions.length && !left.length) {
      const hit = mentions[0];
      // Ask about the section the way the product names it, not the way the
      // matcher happens to spell it — the panel says "FAQ", not "faq", and the
      // article has to agree with it ("an FAQ", "a Features").
      const name = niceType(hit.type) || lowerFirst(trim(hit.word || '')) || hit.type;
      const art = articleFor(name);
      const options = [
        { label: 'Add ' + art + ' ' + name + ' section', act: { op: 'addSection', type: hit.type, label: 'Added ' + art + ' ' + name + ' section' }, note: 'a new block, with copy filled in' },
        { label: 'Restyle the one you have', act: { op: 'layout', type: hit.type, layout: defaultLayout(hit.type), label: 'Changed the ' + name + ' layout' }, note: 'keeps your content' },
        { label: 'Remove it', act: { op: 'removeSection', type: hit.type, label: 'Removed the ' + name + ' section' }, note: 'undoable with ⌘Z' }
      ];
      return { kind: 'ask', question: 'What would you like me to do with the ' + name + '?', options };
    }

    // --- (c) a wish with no object: "make it better" ----------------------
    const allVague = left.length > 0 && left.every((w) => VAGUE_WORDS.has(w));
    if (!mentions.length && allVague && left.length <= 3) {
      return {
        kind: 'ask',
        question: 'Happy to help — which of these is closest to what you want?',
        options: [
          { label: 'Sharper copy', act: { op: 'rewriteAll', prompt: 'sharpen the copy: shorter sentences, less hedging', credit: true, label: 'Sharpened the site copy' }, note: 'uses 1 credit' },
          { label: 'A bolder look', act: { op: 'pack', pack: 'brutal', credit: true, label: 'Applied the Brutalist look' }, note: 'restyles the whole site' },
          { label: 'More room to breathe', act: { op: 'design', key: 'spacing', delta: 24, label: 'More space between sections' }, note: 'no credits used' }
        ]
      };
    }

    // --- (d) a short message with no recognisable intent at all -----------
    if (!mentions.length && !left.length && words.length && words.length <= 3) {
      return { kind: 'ask', question: 'I did not quite catch that. Tell me what you would like, or start with one of these:', options: START_HERE.slice() };
    }

    return { kind: 'none' };
  }

  // Layout variants that are safe to offer by default per section type. They
  // come from the DB layout catalogue, so an option is only offered when the
  // renderer already knows how to draw it.
  const PREFERRED_LAYOUT = {
    features: 'bento', testimonials: 'masonry', gallery: 'mosaic',
    stats: 'band', pricing: 'stacked', about: 'floating', cta: 'splash', hero: 'split'
  };
  function defaultLayout(type) {
    const want = PREFERRED_LAYOUT[String(type || '')] || '';
    const D = db();
    if (!want || !D || typeof D.layoutsFor !== 'function') return want;
    try {
      const list = D.layoutsFor(type) || [];
      return list.some((l) => l && l.id === want) ? want : '';
    } catch (e) { return want; }
  }

  // ============================================================
  // 4. the slash catalogue
  // ============================================================

  /*
    Commands a client can be taught once. Each `send` is the sentence the
    copilot already understands, so the menu is a shortcut, not a second
    command language.
  */
  const SLASH = [
    { name: 'director', args: '', help: 'Choose and explain a visual strategy', send: 'try a dark blue palette' },
    { name: 'critique', args: '', help: 'Audit the site without changing it', send: 'review my site' },
    { name: 'repair', args: '', help: 'Prepare safe fixes for your approval', send: 'fix everything you can' },
    { name: 'review', args: '', help: 'Audit the site and list what to fix', send: 'review my site' },
    { name: 'fix', args: '', help: 'Repair everything the copilot safely can', send: 'fix everything you can' },
    { name: 'fixall', args: '', help: 'Apply every fix that needs no credits, in one step', send: 'apply every fix you can' },
    { name: 'options', args: '', help: 'Show other wording for the selected section', send: 'show me other options' },
    { name: 'photo', args: '', help: 'Find topic-matched photos', send: 'generate AI images' },
    {
      name: 'palette', args: '[colour]', help: 'Switch the colour palette', send: 'try a dark blue palette',
      // With an argument the shortcut has to become the sentence the client
      // would have written: /palette emerald reads as "try a emerald palette",
      // so the article is fixed up here rather than guessed at in the parser.
      withArgs: (a) => 'try ' + (/^[aeiou]/i.test(a) ? 'an ' : 'a ') + a + ' palette'
    },
    { name: 'font', args: '[name]', help: 'Change the typeface', send: 'use a serif font', withArgs: (a) => 'use a ' + a + ' font' },
    { name: 'undo', args: '', help: 'Undo the last change', send: 'undo that' },
    { name: 'preview', args: '', help: 'Open the live preview', send: 'preview' },
    { name: 'export', args: '', help: 'Download the finished site', send: 'export' },
    { name: 'help', args: '', help: 'What the copilot can do', send: 'what can you do' }
  ];

  function slashMatches(input) {
    const raw = trim(input);
    if (raw.charAt(0) !== '/') return [];
    const q = raw.slice(1).toLowerCase().split(/\s+/)[0];
    if (!q) return SLASH.slice();
    return SLASH.filter((c) => c.name.indexOf(q) === 0);
  }

  /*
    The ops that are safe to run as a batch, in any order. "Safe" here means the
    action names its target by value: an earlier fix in the same batch can move
    a section index, and an index-based fix would then land on its neighbour.
    Structural ops (adding or removing a section) are excluded for the same
    reason, and because a plan limit can refuse them halfway through.
  */
  /*
    addSection is in the list now that an insert names its page by value: the
    reason it was excluded — an earlier fix moving a target out from under a
    later one — no longer applies to a page-targeted insert, and the two page
    findings it resolves are the ones a multi-page site produces most.
  */
  const BATCH_OPS = new Set([
    'setField', 'palette', 'font', 'alt', 'repair', 'copyOption', 'suite',
    'navStyle', 'navSticky', 'navCta', 'themeToggle', 'design', 'hero', 'addSection'
  ]);

  function batchable(item) {
    return !!(item && item.action && item.action.act && BATCH_OPS.has(item.action.act.op));
  }

  function slashLookup(input) {
    const raw = trim(input);
    if (raw.charAt(0) !== '/') return null;
    const name = raw.slice(1).toLowerCase().split(/\s+/)[0];
    return SLASH.find((c) => c.name === name) || null;
  }

  return {
    review, actionFor, metaDescription, interpret, impactOf, fixTitleFor, simulate,
    sectionsOf, homeSections, indexIsSafe, pages, pageForIssue, pageTarget, formEmail,
    batchable, verifyFor, sanitiseSiteField, sanitiseSectionField, sanitiseSectionType, sanitiseChoice,
    SITE_FIELDS, SECTION_FIELDS, unusedHeading, unusedLine, headingsInUse, settleLines,
    SLASH, slashMatches, slashLookup, defaultLayout, DUAL, IMPACT, REFILLABLE
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Copilot;

// ============================================================
// PallettAI Studio — site builder
// Turns a project's state into a fully functional, self-contained
// HTML site (inline CSS + JS): responsive, animated, interactive.
// ============================================================

const Builder = (() => {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const picsum = (seed, w, h) => `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;

  function isAiDraft(p) {
    return !!(p && (p.aiType || String(p.templateId || '').indexOf('ai:') === 0));
  }
  function photoHole(ratio, label) {
    return `<div class="photo-hole" style="aspect-ratio:${ratio}" data-photo-hole="${esc(label || 'Photo')}"><span>${esc(label || 'Drop a photo here')}</span></div>`;
  }

  function photoGradeOn(p) {
    return !!(p && p.site && p.site.photoGrade && p.site.photoGrade.on);
  }
  function gradeWrap(p, html) {
    return photoGradeOn(p) ? `<span class="media-grade">${html}</span>` : html;
  }
  function faviconLink(p) {
    const emoji = String((p.site && p.site.favicon) || '').trim();
    const logo = String((p.site && p.site.logo) || '').trim();
    const logoOk = /^(data:image\/|https?:)/i.test(logo) || /\.(svg|png|webp|ico|gif|jpe?g)(\?|$)/i.test(logo);
    if (emoji && emoji !== '◆') {
      return `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${esc(emoji)}</text></svg>">`;
    }
    if (logoOk) return `<link rel="icon" href="${esc(logo)}">`;
    return `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>◆</text></svg>">`;
  }
  function photoGradeCSS(p) {
    if (!photoGradeOn(p)) return '';
    const g = p.site.photoGrade || {};
    const strength = Math.min(0.18, Math.max(0.1, Number(g.strength) || 0.14));
    return `
body.photo-grade{
  --grade-map:color-mix(in srgb,var(--primary) 58%,var(--accent));
  --grade-strength:${strength};
}
.media-grade{position:relative;display:block;isolation:isolate;overflow:hidden;border-radius:inherit}
.media-grade>img{width:100%;height:100%;object-fit:cover;display:block}
.hero-bg.media-grade{isolation:isolate}
.hero-split-media .media-grade{border-radius:var(--radius)}
.about-media .media-grade{border-radius:var(--radius);min-height:380px}
.gal-item .media-grade,.gal-m .media-grade{position:absolute;inset:0;z-index:0;border-radius:inherit}
.gal-item figcaption,.gal-m figcaption{z-index:2}
.coll-media{position:relative}
.coll-media .media-grade{position:absolute;inset:0}
@supports (mix-blend-mode: color){
  .media-grade::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:1;background:var(--grade-map);mix-blend-mode: color;opacity:var(--grade-strength,.14)}
  .media-grade::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:1;background:linear-gradient(165deg,color-mix(in srgb,var(--bg) 18%,transparent),color-mix(in srgb,var(--primary) 9%,transparent) 48%,transparent 82%);mix-blend-mode: soft-light;opacity:.22}
  body.photo-grade-soft .media-grade::after{mix-blend-mode: soft-light}
  body.photo-grade-soft .media-grade::before{display:none}
}
@media (prefers-contrast: more){
  .media-grade::before,.media-grade::after{display:none}
}`;
  }

  // A deterministic, on-theme hero placeholder used when a project has no hero
  // image of its own. It keeps a free user's first export from shipping a random
  // stock photo as the hero background by surprise — instead the hero shows the site
  // name on a subtle gradient that reacts to the chosen palette (dark sites get a
  // dark gradient, light sites get a light one).
  function heroPlaceholder(p, s, i, kind) {
    if (isAiDraft(p)) return photoHole(kind === 'about' ? '4/3' : '16/9', kind === 'about' ? 'About photo' : 'Hero photo');
    const pal = (p.site || {}).palette || 'midnight';
    const isDark = /^(ink|cobalt|grape|pine|roast|paper|lagoon|pack_|midnight|dark)/i.test(String(pal));
    const name = (p.site && p.site.name) || 'Site';
    const bg = isDark
      ? 'linear-gradient(135deg,#0b1020 0%,#161c33 55%,#1d2447 100%)'
      : 'linear-gradient(135deg,#f6f1e7 0%,#efe6d6 55%,#e7dccd 100%)';
    const fg = isDark ? '#eef0ff' : '#2a2318';
    return `<div class="hero-placeholder" style="background:${bg};color:${fg};width:100%;height:100%;min-height:380px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;font-family:inherit">
        <span style="font-size:3rem;letter-spacing:.02em;opacity:.5;display:block;margin-bottom:14px">◆</span>
        <h1 style="font-size:clamp(1.8rem,4.5vw,3rem);font-weight:700;margin:0 0 10px;line-height:1.1">${esc(name)}</h1>
        <p style="color:${isDark ? 'rgba(238,240,255,.7)' : 'rgba(42,35,24,.6)'};max-width:520px">Built with PallettAI Studio</p>
      </div>`;
  }

  // ---------------- multi-page model ----------------
  // site.pages = [{id, name, slug, sections}] — the FULL page list. The page the
  // studio is currently editing keeps `site.sections` pointing at its own array
  // (legacy code paths mutate site.sections), so on load / save we re-alias the
  // active page record to that same array. Builder calls are the authoritative
  // normalizer; app.js uses Builder.pages() so both sides stay in sync.
  const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
  const HOME_ID = 'pg-home';

  function normalizePages(project) {
    if (!project || !project.site) return [];
    let pages = project.site.pages;
    if (!Array.isArray(pages) || !pages.length) {
      pages = [{ id: HOME_ID, name: 'Home', slug: 'index', sections: Array.isArray(project.site.sections) ? project.site.sections : [] }];
      project.site.pages = pages;
    }
    pages.forEach((pg) => { if (!Array.isArray(pg.sections)) pg.sections = []; });
    let active = pages.find((pg) => pg.id === project.site.activePageId) || pages.find((pg) => pg.slug === 'index') || pages[0];
    if (!active) { active = { id: HOME_ID, name: 'Home', slug: 'index', sections: [] }; pages.push(active); }
    if (!pages.some((pg) => pg.slug === 'index')) pages[0].slug = 'index'; // an index.html must always exist
    if (!Array.isArray(project.site.sections)) project.site.sections = active.sections;
    active.sections = project.site.sections;   // keep the alias
    project.site.activePageId = active.id;
    return pages;
  }
  function pagesOf(project) { return normalizePages(project); }
  function pageHref(pg) { return (String(pg.slug || slugify(pg.name)) + '.html').replace(/^index\.html$/, 'index.html'); }

  // Current build context (set while a page is being rendered).
  let _ctx = { pages: [], page: null };

  // A working link to a contact form: this page's own contact section when it
  // has one, else the first other page that does (multi-page sites), else the
  // legacy anchor fallback.
  function contactRef(p) {
    const arr = Array.isArray(p.site.sections) ? p.site.sections : [];
    const local = arr.findIndex((x) => x.type === 'contact');
    if (local !== -1) return '#sec-contact-' + local;
    if (_ctx.pages.length > 1) {
      for (const pg of _ctx.pages) {
        if (pg === _ctx.page || !Array.isArray(pg.sections)) continue;
        const i = pg.sections.findIndex((x) => x.type === 'contact');
        if (i !== -1) return pageHref(pg) + '#sec-contact-' + i;
      }
    }
    return '#sec-contact-' + contactIndex(p);
  }

  // ---------------- form delivery ----------------
  // The site owner pastes a third-party endpoint in the studio (Settings ▸ site
  // Design & branding). Forms on the exported site POST straight to that service
  // (Formspree / Web3Forms / any JSON-capable endpoint) — no PallettAI servers.
  // Accepted input:
  //   https://formspree.io/f/…            → Formspree AJAX (FormData + Accept json)
  //   https://api.web3forms.com/submit    → full URL is fine too (generic)
  //   REF-style bare access key           → Web3Forms (https://api.web3forms.com/submit)
  //   empty                               → demo mode (no real delivery)
  function deliveryFor(site) {
    const raw = String((site && site.formEndpoint) || '').trim();
    if (!raw) return { mode: 'demo', endpoint: '', key: '' };
    // Bare email → FormSubmit.co (zero setup, free, no key, no monthly cap —
    // first submission confirms the address by email, then it's automatic).
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      return { mode: 'formsubmit', endpoint: 'https://formsubmit.co/' + raw, key: raw };
    }
    if (/^https?:\/\//i.test(raw)) {
      return { mode: /formspree\.io/i.test(raw) ? 'formspree' : 'generic', endpoint: raw, key: '' };
    }
    return { mode: 'web3forms', endpoint: 'https://api.web3forms.com/submit', key: raw };
  }

  // Booking providers are rendered as plain HTTPS iframes so the exported site
  // stays portable and clients can change their scheduler without an SDK or
  // PallettAI account. Invalid/non-HTTPS values intentionally render the setup
  // state rather than becoming an executable iframe source.
  function safeHref(value, fallback) {
    const fallbackHref = fallback == null ? '' : String(fallback);
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return fallbackHref;
    if (raw.charAt(0) === '#' || raw.startsWith('mailto:') || raw.startsWith('tel:')) return raw;
    if (/^[a-z0-9][\w./-]*\.html(?:#.*)?$/i.test(raw)) return raw;
    if (!/^https:\/\//i.test(raw)) return fallbackHref;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' ? url.href : fallbackHref;
    } catch (e) {
      return fallbackHref;
    }
  }

  function safeEmbedUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw || !/^https:\/\//i.test(raw)) return '';
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' ? url.href : '';
    } catch (e) {
      return '';
    }
  }

  function safeBookingUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || !/^https:\/\//i.test(raw)) return '';
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' ? url.href : '';
    } catch (e) {
      return '';
    }
  }

  function bookingProviderInfo(section) {
    const providers = DB.bookingProviders || [];
    return providers.find((item) => item.id === section.bookingProvider) || providers[0] || { id: 'custom', name: 'booking provider', hint: 'Paste a public HTTPS booking page.' };
  }

  // ---------------- helpers ----------------

  function sectionShell(section, index, inner) {
    const anim = section.animation || 'fade-up';
    const animCss = (DB.getAnimation(anim) || {}).css || '';
    const cls = anim === 'none' ? '' : 'reveal';
    return `
    <section id="sec-${section.type}-${index}" class="section sec-${section.type}">
      <div class="container ${cls}" data-anim-css="${esc(animCss)}">
        ${inner}
      </div>
    </section>`;
  }

  function head(section, eyebrow) {
    const e = eyebrow || {
      features: 'What you get', stats: 'By the numbers', about: 'Our story',
      gallery: 'Selected work', pricing: 'Simple pricing', testimonials: 'Kind words',
      faq: 'Questions, answered', blog: 'From the blog', shop: 'Best sellers',
      contact: 'Say hello', booking: 'Book online', cta: '', hero: ''
    }[section.type] || '';
    return `
      <div class="sec-head">
        ${section.emblem ? `<img class="sec-emblem" src="${esc(section.emblem)}" alt="">` : ''}
        ${e ? `<p class="eyebrow">${esc(e)}</p>` : ''}
        ${section.title ? `<h2>${esc(section.title)}</h2>` : ''}
        ${section.subtitle ? `<p class="sub">${esc(section.subtitle)}</p>` : ''}
      </div>`;
  }

  function itemsField(section, defs) {
    // section.items rows: {icon, title, text, extra, tag, image}
    return (section.items && section.items.length ? section.items : defs || []);
  }

  // ---------------- section renderers ----------------

  const contactIndex = (p) => {
    let idx = Math.max(0, p.site.sections.length - 1);
    p.site.sections.forEach((s, i) => { if (s.type === 'contact') idx = i; });
    return idx;
  };

  function renderHero(p, s, i) {
    const hasImg = !!(s.image || '').trim();
    const bg = s.image || '';
    const placeholder = hasImg ? '' : heroPlaceholder(p, s, i);
    const pro = (p.suites || []).includes('animation');
    const glow = pro ? '<span class="orb orb-a"></span><span class="orb orb-b"></span>' : '';
    const desc = s.text || p.site.description;
    const cta2 = `<a class="btn ghost" href="${contactRef(p)}">Get in touch</a>`;
    const cta1 = `<a class="btn solid" href="${esc(safeHref(s.extra || p.site.ctaLink, contactRef(p)))}">${esc(p.site.ctaText || 'Get started')}</a>`;
    const badge = p.site.eyebrow ? `<p class="hero-badge">${esc(p.site.eyebrow)}</p>` : '';
    const title = `<h1>${esc(s.title || p.site.name)}</h1>`;
    const tag = `<p class="hero-tag">${esc(s.subtitle || p.site.tagline)}</p>`;
    const d = desc ? `<p class="hero-desc">${esc(desc)}</p>` : '';
    const cta = `<div class="hero-cta">${cta1} ${cta2}</div>`;
    const layout = s.layout || p.site.heroLayout || 'centered';
    const anim = s.animation === 'none' ? '' : 'reveal';
    const animCss = esc((DB.getAnimation(s.animation) || {}).css || '');
    const scrollHint = `<a class="scroll-hint" href="#sec-${(p.site.sections[1] || p.site.sections[0] || { type: 'features', id: 'x' }).type}-${Math.min(1, Math.max(0, p.site.sections.length - 1))}"><span></span></a>`;
    if (layout === 'terminal') {
      const slug = (s.title || p.site.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
      const pal = (p.site.palette || 'midnight').replace(/^custom_/, '');
      return `
    <section id="sec-hero-${i}" class="section sec-hero layout-terminal">
      ${glow}
      <div class="container hero-inner term ${anim}" data-anim-css="${animCss}">
        ${badge}${title}${tag}
        <div class="term-window">
          <div class="term-head"><span></span><span></span><span></span><b>palletcli — build</b></div>
          <div class="term-body">
            <p class="term-line"><i class="term-p">$</i> palletcli build --site ${esc(slug)} --style ${esc(pal)}</p>
            <p class="term-line term-typing">▸ scaffolding sections… palette applied · font loaded · animations ready<span class="term-cursor"></span></p>
            <p class="term-line term-ok">✔ build complete in 0.4s — site is live ✨</p>
          </div>
        </div>
        ${cta}
      </div>
      ${scrollHint}
    </section>`;
    }
    if (layout === 'split') {
      return `
    <section id="sec-hero-${i}" class="section sec-hero layout-split">
      ${glow}
      <div class="container hero-split">
        <div class="hero-split-body ${anim}" data-anim-css="${animCss}">
          ${badge}${title}${tag}${d}${cta}
        </div>         <div class="hero-split-media ${anim}" data-anim-css="${animCss}">${hasImg
           ? gradeWrap(p, `<img class="hero-img" src="${esc(bg)}" alt="${esc(s.alt || s.title || p.site.name)}" loading="lazy" decoding="async">`)
           : placeholder}</div>
      </div>
      ${scrollHint}
    </section>`;
    }
    if (layout === 'minimal') {
      return `
    <section id="sec-hero-${i}" class="section sec-hero layout-minimal">
      ${glow}
      <div class="container hero-inner minimal ${anim}" data-anim-css="${animCss}">
        ${badge}${title}${tag}${d}${cta}
      </div>
      ${scrollHint}
    </section>`;
    }
    if (layout === 'aurora') {
      return `
    <section id="sec-hero-${i}" class="section sec-hero layout-aurora">
      <span class="aurora-blob ab-1"></span><span class="aurora-blob ab-2"></span><span class="aurora-blob ab-3"></span>
      <div class="container hero-inner ${anim}" data-anim-css="${animCss}">
        ${badge}${title}${tag}${d}${cta}
      </div>
      ${scrollHint}
    </section>`;
    }
    return `
    <section id="sec-hero-${i}" class="section sec-hero layout-centered">
      ${hasImg
        ? `<div class="hero-bg${photoGradeOn(p) ? ' media-grade' : ''}" style="background-image:url('${esc(bg)}');background-size:cover;background-position:center;background-repeat:no-repeat"></div>
      <div class="hero-shade"></div>`
        : placeholder}
      ${glow}
      <div class="container hero-inner ${anim}" data-anim-css="${animCss}">
        ${badge}${title}${tag}${d}${cta}
      </div>
      ${scrollHint}
    </section>`;
  }

  function renderFeatures(p, s, i) {
    const defs = [
      { icon: '⚡', title: 'Fast', text: 'Loads instantly on any device.' },
      { icon: '🔒', title: 'Secure', text: 'Built to modern standards.' },
      { icon: '🎨', title: 'Beautiful', text: 'Designed to be remembered.' }
    ];
    if (s.layout === 'bento') {
      const spec = [[4, 1], [2, 2], [2, 1], [2, 1], [2, 1]];
      const cards = itemsField(s, defs).slice(0, 5).map((it, j) => `
        <div class="bento-card ${j === 1 ? 'bento-hot' : ''}" style="grid-column:span ${spec[j][0]};grid-row:span ${spec[j][1]}">
          <div class="feat-icon">${esc(it.icon || '✦')}</div>
          <h3>${esc(it.title)}</h3>
          <p>${esc(it.text)}</p>
        </div>`).join('');
      return sectionShell(s, i, `${head(s)}<div class="bento-grid">${cards}</div>`);
    }
    if (s.layout === 'numbered') {
      const rows = itemsField(s, defs).map((it, j) => `
        <div class="num-row">
          <div class="num-idx">${String(j + 1).padStart(2, '0')}</div>
          <div class="num-body"><h3>${esc(it.title)}</h3><p>${esc(it.text)}</p></div>
          ${it.extra ? `<div class="num-extra">${esc(it.extra)}</div>` : ''}
        </div>`).join('');
      return sectionShell(s, i, `${head(s)}<div class="num-rows">${rows}</div>`);
    }
    if (s.layout === 'strip') {
      const cols = itemsField(s, defs).map((it) => `
        <div class="strip-col">
          <div class="strip-icon">${esc(it.icon || '✦')}</div>
          <h3>${esc(it.title)}</h3>
          <p>${esc(it.text)}</p>
        </div>`).join('');
      return sectionShell(s, i, `${head(s)}<div class="strip-grid">${cols}</div>`);
    }
    const cards = itemsField(s, defs).map((it, j) => `
      <div class="card feat" style="animation-delay:${j * 90}ms">
        <div class="feat-icon">${esc(it.icon || '✦')}</div>
        <h3>${esc(it.title)}</h3>
        <p>${esc(it.text)}</p>
      </div>`).join('');
    return sectionShell(s, i, `${head(s)}<div class="grid3">${cards}</div>`);
  }

  function renderStats(p, s, i) {
    const defs = [
      { title: 'Customers', text: '1K+' }, { title: 'Rating', text: '4.9★' },
      { title: 'Support', text: '24/7' }, { title: 'Launched', text: '2019' }
    ];
    if (s.layout === 'band') {
      const rows = itemsField(s, defs).map((it) => `
        <div class="sb-stat">
          <div class="stat-num sb-num" data-count="${esc(it.text.replace(/[^0-9.]/g, ''))}" data-suffix="${esc(it.text.replace(/[0-9.]/g, ''))}">0</div>
          <div class="sb-label">${esc(it.title)}</div>
        </div>`).join('');
      return sectionShell(s, i, `${head(s)}<div class="stats-band">${rows}</div>`);
    }
    if (s.layout === 'ticker') {
      const cells = itemsField(s, defs).map((it) => `
        <span class="tk-stat"><b>${esc(it.text)}</b><i>${esc(it.title)}</i></span>`).join('');
      return sectionShell(s, i, `${head(s)}<div class="stats-ticker"><div class="tk-track">${cells}${cells}</div></div>`);
    }
    const rows = itemsField(s, defs).map((it) => `
      <div class="stat">
        <div class="stat-num" data-count="${esc(it.text.replace(/[^0-9.]/g, ''))}" data-suffix="${esc(it.text.replace(/[0-9.]/g, ''))}">0</div>
        <div class="stat-label">${esc(it.title)}</div>
      </div>`).join('');
    return sectionShell(s, i, `${head(s)}<div class="grid4">${rows}</div>`);
  }

  function renderAbout(p, s, i) {
    const hasImg = !!(s.image || '').trim();
    const img = hasImg ? s.image : '';
    const ph = hasImg ? '' : heroPlaceholder(p, s, i, 'about');
    const checks = itemsField(s).map((it) => `<li>${esc(it.icon || '✓')} ${esc(it.title || it.text || '')}</li>`).join('');
    const side = s.layout === 'left';
    if (s.layout === 'timeline') {
      const entries = itemsField(s, []).map((it) => `
        <div class="tl-item">
          <div class="tl-dot"></div>
          <div class="tl-body">
            <h3>${esc(it.title || '')}</h3>
            <p>${esc(it.text || '')}</p>
          </div>
        </div>`).join('');
      return sectionShell(s, i, `${head(s)}<div class="tl-wrap">${entries}</div>`);
    }
    if (s.layout === 'floating') {
      const all = itemsField(s, []);
      const chips = all.slice(0, 2).map((it, j) => `
        <div class="float-chip fc-${j + 1}"><strong>${esc(it.title || '')}</strong><span>${esc(it.text || '')}</span></div>`).join('');
      const fchecks = all.slice(2).map((it) => `<li>${esc(it.icon || '✓')} ${esc(it.title || '')}</li>`).join('');
      return sectionShell(s, i, `
        <div class="about-grid">
          <div class="about-media about-float">
            ${hasImg
              ? gradeWrap(p, `<img src="${esc(img)}" alt="${esc(s.alt || s.title || 'About')}" loading="lazy" decoding="async" style="aspect-ratio:4/3;object-fit:cover;width:100%;height:auto;display:block">`)
              : ph}
            ${chips}
          </div>
          <div class="about-body">
            ${head(s)}
            ${s.text ? `<p class="about-text">${esc(s.text)}</p>` : ''}
            ${fchecks ? `<ul class="checks">${fchecks}</ul>` : ''}
          </div>
        </div>`);
    }
    return sectionShell(s, i, `
      <div class="about-grid">
        <div class="about-media ${side ? 'order-2' : ''}">
          ${hasImg
            ? gradeWrap(p, `<img src="${esc(img)}" alt="${esc(s.alt || s.title || 'About')}" loading="lazy" decoding="async" style="aspect-ratio:4/3;object-fit:cover;width:100%;height:auto;display:block">`)
            : ph}
        </div>
        <div class="about-body ${side ? 'order-1' : ''}">
          ${head(s)}
          ${s.text ? `<p class="about-text">${esc(s.text)}</p>` : ''}
          ${checks ? `<ul class="checks">${checks}</ul>` : ''}
        </div>
      </div>`);
  }

  function renderGallery(p, s, i) {
    const pro = (p.suites || []).includes('gallerypro');
    const items = itemsField(s, Array.from({ length: 6 }, (_, j) => ({ title: `Work ${j + 1}`, extra: 'Project' })));
    const cards = items.map((it, j) => {
      const img = it.image || (isAiDraft(p) ? '' : picsum(`${p.id}-gal-${i}-${j}`, 640, pro ? 640 : 480));
      const media = img
        ? gradeWrap(p, `<img src="${esc(img)}" alt="${esc(it.alt || it.title || '')}" loading="lazy" decoding="async" style="aspect-ratio:1/1;object-fit:cover;width:100%;height:auto;display:block">`)
        : photoHole('1/1', 'Gallery photo');
      return `
      <figure class="gal-item ${pro ? 'masonry' : ''}" data-cap="${esc(it.title || '')}" data-extra="${esc(it.extra || '')}">        ${media}
        <figcaption><span>${esc(it.title || '')}</span><small>${esc(it.extra || '')}</small></figcaption>
       </figure>`;
    }).join('');
    if (s.layout === 'mosaic') {
      const mosaic = itemsField(s, Array.from({ length: 7 }, (_, j) => ({ title: `Work ${j + 1}`, extra: 'Project' }))).map((it, j) => {
        const img = it.image || (isAiDraft(p) ? '' : picsum(`${p.id}-gal-${i}-${j}`, 640, 480));
        const media = img
          ? gradeWrap(p, `<img src="${esc(img)}" alt="${esc(it.alt || it.title || '')}" loading="lazy" decoding="async" style="aspect-ratio:1/1;object-fit:cover;width:100%;height:auto;display:block">`)
          : photoHole('1/1', 'Gallery photo');
        return `
        <figure class="gal-m mos-${j + 1}" data-cap="${esc(it.title || '')}" data-extra="${esc(it.extra || '')}">
          ${media}
           <figcaption><strong>${esc(it.title || '')}</strong> <small>${esc(it.extra || '')}</small></figcaption>
         </figure>`;
      }).join('');
      return sectionShell(s, i, `${head(s)}<div class="gal-mosaic">${mosaic}</div>`);
    }
    const lightbox = pro ? `
      <div class="lb" id="lightbox" aria-hidden="true">
        <button class="lb-close" data-lb="close">✕</button>
        <button class="lb-nav prev" data-lb="prev">‹</button>
        <figure class="lb-stage"><img alt=""><figcaption></figcaption></figure>
        <button class="lb-nav next" data-lb="next">›</button>
      </div>` : '';
    return sectionShell(s, i, `${head(s)}<div class="gallery ${pro ? 'masonry-wrap' : ''}">${cards}</div>${lightbox}`);
  }

  function renderPricing(p, s, i) {
    const defs = [
      { icon: '🌱', title: 'Starter', text: '£9', extra: '1 project · Basic support', tag: '' },
      { icon: '⚡', title: 'Pro', text: '£29', extra: 'Unlimited · Priority support', tag: 'Popular' },
      { icon: '🏢', title: 'Scale', text: '£79', extra: 'Everything · Dedicated team', tag: '' }
    ];
    if (s.layout === 'toggle') {
      const cards = itemsField(s, defs).map((it, j) => `
      <div class="card price ${it.tag ? 'hot' : ''}">
        ${it.tag ? `<span class="price-tag">${esc(it.tag)}</span>` : ''}
        <div class="price-emoji">${esc(it.icon || '💎')}</div>
        <h3>${esc(it.title)}</h3>
        <div class="price-amt"><span class="pt-amt" data-mo="${esc(it.mo || it.text)}" data-yr="${esc(it.yr || it.text)}">${esc(it.mo || it.text)}</span><span>/mo</span></div>
        <p>${esc(it.extra)}</p>          <a class="btn ${it.tag ? 'solid' : 'ghost'}" href="${contactRef(p)}">Choose ${esc(it.title)}</a>
      </div>`).join('');
      const toggle = `<div class="pt-toggle" role="group" aria-label="Billing period">
        <button class="pt-btn active" data-pt="mo" type="button">Monthly</button><button class="pt-btn" data-pt="yr" type="button">Yearly <em>−20%</em></button>
      </div>`;
      return sectionShell(s, i, `${head(s)}${toggle}<div class="grid3">${cards}</div>`);
    }
    if (s.layout === 'stacked') {
      const rows = itemsField(s, defs).map((it, j) => `
        <div class="pstack-row ${it.tag ? 'hot' : ''}">
          ${it.tag ? `<span class="price-tag">${esc(it.tag)}</span>` : ''}
          <div class="ps-name"><h3>${esc(it.title)}</h3><p>${esc(it.extra)}</p></div>
          <div class="ps-price">${esc(it.text)}<small>/mo</small></div>
          <a class="btn ${it.tag ? 'solid' : 'ghost'} small" href="${contactRef(p)}">Choose</a>
        </div>`).join('');
      return sectionShell(s, i, `${head(s)}<div class="price-stack">${rows}</div>`);
    }
    const rows = itemsField(s, defs).map((it, j) => `
      <div class="card price ${it.tag ? 'hot' : ''}">
        ${it.tag ? `<span class="price-tag">${esc(it.tag)}</span>` : ''}
        <div class="price-emoji">${esc(it.icon || '💎')}</div>
        <h3>${esc(it.title)}</h3>
        <div class="price-amt">${esc(it.text)}<span>/mo</span></div>
        <p>${esc(it.extra)}</p>          <a class="btn ${it.tag ? 'solid' : 'ghost'}" href="${contactRef(p)}">Choose ${esc(it.title)}</a>
      </div>`).join('');
    return sectionShell(s, i, `${head(s)}<div class="grid3">${rows}</div>`);
  }

  function renderTestimonials(p, s, i) {
    const defs = [
      { title: 'Alex Rivera', text: 'Outstanding experience from start to finish.', extra: 'Founder, Brightline' },
      { title: 'Mina Park', text: 'They understood the vision immediately.', extra: 'CMO, Verdant' },
      { title: 'Sam Oduya', text: 'The results speak for themselves. Highly recommended.', extra: 'Director, Fieldwork' }
    ];
    const who = (it, j) => {
      if (it && it.image) return `<img src="${esc(it.image)}" alt="">`;
      if (isAiDraft(p)) {
        const t = String((it && it.title) || '?').trim();
        const parts = t.split(/\s+/);
        const ini = ((parts[0] && parts[0][0]) || '?') + (parts[1] && parts[1][0] ? parts[1][0] : '');
        return `<span class="who-ini" aria-hidden="true">${esc(ini.toUpperCase())}</span>`;
      }
      return `<img src="${esc(`https://i.pravatar.cc/96?img=${(j * 13) % 70 + 1}`)}" alt="">`;
    };
    const card = (it, j) => `
      <div class="card quote">
        <div class="quote-mark">“</div>
        <p>${esc(it.text)}</p>
        <div class="quote-who">
          ${who(it, j)}
          <div><strong>${esc(it.title)}</strong><small>${esc(it.extra || '')}</small></div>
        </div>
      </div>`;
    if (s.layout === 'masonry') {
      const cards = itemsField(s, defs).map(card).join('');
      return sectionShell(s, i, `${head(s)}<div class="quote-masonry">${cards}</div>`);
    }
    if (s.layout === 'featured') {
      const all = itemsField(s, defs);
      const main = all[0] || defs[0];
      const rest = all.slice(1, 4);
      const big = `
      <div class="t-featured">
        <div class="quote-mark">“</div>
        <p>${esc(main.text)}</p>
        <div class="quote-who">${who(main, 0)}<div><strong>${esc(main.title)}</strong><small>${esc(main.extra || '')}</small></div></div>
      </div>`;
      const stack = rest.map((it, j) => `
      <div class="card quote t-stack-item">
        <p>${esc(it.text)}</p>
        <div class="quote-who">${who(it, j)}<div><strong>${esc(it.title)}</strong><small>${esc(it.extra || '')}</small></div></div>
      </div>`).join('');
      return sectionShell(s, i, `${head(s)}<div class="t-feat-grid">${big}<div class="t-stack">${stack}</div></div>`);
    }
    const rows = itemsField(s, defs).map(card).join('');
    return sectionShell(s, i, `${head(s)}<div class="grid3">${rows}</div>`);
  }

  function renderFaq(p, s, i) {
    const rows = itemsField(s, [
      { title: 'Question one?', text: 'A clear, helpful answer goes here.' },
      { title: 'Question two?', text: 'Another clear, helpful answer.' }
    ]).map((it, j) => `
      <details class="faq-item" ${j === 0 ? 'open' : ''}>
        <summary>${esc(it.title)}<span class="chev">▾</span></summary>
        <p>${esc(it.text)}</p>
      </details>`).join('');
    if (s.layout === 'columns') {
      return sectionShell(s, i, `${head(s)}<div class="faq-list faq-cols">${rows}</div>`);
    }
    return sectionShell(s, i, `${head(s)}<div class="faq-list">${rows}</div>`);
  }

  function renderBlog(p, s, i) {
    const defs = [
      { icon: 'News', title: 'Hello world', text: 'Welcome to our first post.', extra: 'News · 2 min read' },
      { icon: 'Tips', title: 'Getting started', text: 'Everything you need to begin.', extra: 'Guide · 5 min read' },
      { icon: 'Story', title: 'Behind the scenes', text: 'How we work and why.', extra: 'Story · 4 min read' }
    ];
    const all = itemsField(s, defs);
    const small = (it, j) => `
      <article class="card post" data-full="${esc(it.text)}" data-meta="${esc(it.extra || '')}" style="animation-delay:${j * 90}ms">
        <div class="post-icon">${esc(it.icon || '📝')}</div>
        <h3>${esc(it.title)}</h3>
        <p>${esc(it.text.split(/[.\n]/)[0])}…</p>
        <div class="post-foot"><small>${esc(it.extra || '')}</small><button class="linkish" data-post="${j}">Read →</button></div>
      </article>`;
    const posts = s.layout === 'featured' && all.length > 1
      ? `
      <article class="card post post-featured" data-full="${esc(all[0].text)}" data-meta="${esc(all[0].extra || '')}">
        <div class="post-icon">${esc(all[0].icon || '📝')}</div>
        <h3>${esc(all[0].title)}</h3>
        <p>${esc(all[0].text)}</p>
        <div class="post-foot"><small>${esc(all[0].extra || '')}</small><button class="linkish" data-post="0">Read →</button></div>
      </article>
      <div class="grid3">${all.slice(1).map(small).join('')}</div>`
      : `<div class="grid3">${all.map(small).join('')}</div>`;
    return sectionShell(s, i, `
      ${head(s)}
      ${posts}
      <div class="newsletter">
        <div><strong>Never miss a post</strong><p>One email a month, no spam, ever.</p></div>
        <form class="nl-form" data-form="Newsletter subscription"><input type="email" name="email" placeholder="you@email.com" required><button class="btn solid" type="submit">Subscribe</button></form>
      </div>
      <div class="modal" id="postModal" aria-hidden="true">
        <div class="modal-card"><button class="modal-x" data-modal="close">✕</button>
          <h3 id="postTitle"></h3><small id="postMeta"></small><div id="postBody"></div>
        </div>
      </div>`);
  }

  function renderShop(p, s, i) {
    const rows = itemsField(s, [
      { icon: '🌿', title: 'Everyday Bundle', text: '£24', extra: 'Starter kit for daily essentials' },
      { icon: '⚡', title: 'Pro Kit', text: '£49', extra: 'Everything to go all-in' },
      { icon: '🎁', title: 'Gift Edition', text: '£39', extra: 'Beautifully boxed' }
    ]).map((it, j) => `
      <div class="card product">
        <div class="product-emoji">${esc(it.icon || '🛍️')}</div>
        <h3>${esc(it.title)}</h3>
        <p>${esc(it.extra || '')}</p>
        <div class="product-row"><span class="product-price">${esc(it.text)}</span>
        <button class="btn solid small" data-add="${j}" data-name="${esc(it.title)}" data-price="${esc(it.text)}">Add</button></div>
      </div>`).join('');
    return sectionShell(s, i, `
      ${head(s)}
      <div class="grid4">${rows}</div>
      <aside class="cart" id="cart" aria-hidden="true">
        <div class="cart-head"><strong>Your cart</strong><button class="linkish" data-cart="close">✕</button></div>
        <div class="cart-items"></div>
        <div class="cart-foot"><span>Total</span><strong class="cart-total">$0</strong></div>
        <button class="btn solid" data-checkout>Checkout</button>
      </aside>`);
  }

  function renderContact(p, s, i) {
    const pro = (p.suites || []).includes('contactpro');
    const info = [
      p.site.email ? `<li>✉️ <a href="mailto:${esc(p.site.email)}">${esc(p.site.email)}</a></li>` : '',
      p.site.phone ? `<li>📞 <a href="tel:${esc(p.site.phone.replace(/[^0-9+]/g, ''))}">${esc(p.site.phone)}</a></li>` : '',
      p.site.address ? `<li>📍 ${esc(p.site.address)}</li>` : ''
    ].filter(Boolean).join('');
    const whatsapp = pro && p.site.phone
      ? `<a class="btn ghost wa" href="https://wa.me/${esc(p.site.phone.replace(/[^0-9]/g, ''))}" target="_blank" rel="noopener">💬 WhatsApp us</a>` : '';
    const map = pro && p.site.address
      ? `<iframe class="map" src="https://maps.google.com/maps?q=${encodeURIComponent(p.site.address)}&output=embed" loading="lazy" title="Map"></iframe>` : '';
    const cSplit = s.layout === 'split';
    return sectionShell(s, i, `
      <div class="contact-grid ${cSplit ? 'c-split' : ''}">
        <div class="contact-info ${cSplit ? 'c-panel' : ''}">
          ${head(s)}
          ${s.text ? `<p>${esc(s.text)}</p>` : ''}
          <ul class="contact-list">${info}</ul>
          ${whatsapp}
        </div>
        <form class="contact-form card" data-contact data-form="Contact message">
          <input name="name" placeholder="Your name" required>
          <input name="email" type="email" placeholder="Your email" required>
          <textarea name="message" rows="5" placeholder="Tell us about your project…" required></textarea>
          <button class="btn solid" type="submit">Send message</button>
          <p class="form-note">${esc(s.extra || 'We reply within one business day.')}</p>
        </form>
      </div>
      ${map}`);
  }

  function renderCta(p, s, i) {
    if (s.layout === 'splash') {
      return sectionShell(s, i, `
        <div class="cta-splash">
          <span class="splash-blob sb-1"></span><span class="splash-blob sb-2"></span><span class="splash-blob sb-3"></span>
          <h2>${esc(s.title || 'Let’s work together')}</h2>
          <p>${esc(s.text || '')}</p>
          <a class="btn solid" href="${esc(safeHref(s.extra || p.site.ctaLink, contactRef(p)))}">${esc(p.site.ctaText || 'Get started')}</a>
        </div>`);
    }
    if (s.layout === 'email') {
      return sectionShell(s, i, `
        <div class="cta-banner cta-email">
          <div>
            <h2>${esc(s.title || 'Stay in the loop')}</h2>
            <p>${esc(s.text || '')}</p>
          </div>
          <form class="nl-form cta-nl" data-form="Email capture"><input type="email" name="email" placeholder="you@email.com" required><button class="btn solid" type="submit">Subscribe</button></form>
        </div>`);
    }
    return sectionShell(s, i, `
      <div class="cta-banner">
        <h2>${esc(s.title || 'Let’s work together')}</h2>
        <p>${esc(s.text || '')}</p>
        <a class="btn solid" href="${esc(safeHref(s.extra || p.site.ctaLink, contactRef(p)))}">${esc(p.site.ctaText || 'Get started')}</a>
      </div>`);
  }

  function renderLogos(p, s, i) {
    const items = itemsField(s, [
      { title: 'Northwind' }, { title: 'Solace' }, { title: 'Drift' },
      { title: 'Kite' }, { title: 'Terra' }, { title: 'Wildfire' }
    ]);
    const marks = items.map((it) => `<span class="logo-mark">${esc(it.icon || '◆')} ${esc(it.title)}</span>`).join('');
    if (s.layout === 'grid') {
      return sectionShell(s, i, `${head(s)}<div class="logos-grid">${marks}</div>`);
    }
    return sectionShell(s, i, `${head(s)}<div class="logos-marquee"><div class="logos-track">${marks}${marks}</div></div>`);
  }

  function videoEmbedUrl(url) {
    const u = String(url || '').trim();
    const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
    if (yt) return 'https://www.youtube.com/embed/' + yt[1];
    const vm = u.match(/vimeo\.com\/(\d+)/);
    if (vm) return 'https://player.vimeo.com/video/' + vm[1];
    return '';
  }

  function renderVideo(p, s, i) {
    const embed = videoEmbedUrl(s.extra || s.image);
    const raw = (s.extra || s.image || '').trim();
    const isCoverrClipPage = /^https:\/\/coverr\.co\/s\//i.test(raw) && !raw.includes('/s3/mp4/');
    const isCoverrVideoUrl = /^https:\/\/coverr\.co\/s3\/mp4\//i.test(raw) && /\.mp4(\?|$)/i.test(raw);
    const stage = s.layout === 'full' ? 'video-wrap video-full' : 'video-wrap';
    if (isCoverrClipPage) {
      return sectionShell(s, i, `
        ${head(s)}
        <div class="${stage}">
          <iframe src="${esc(raw)}?embed" title="${esc(s.title || 'Coverr video')}" loading="lazy" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" style="border:0;border-radius:12px;width:100%;height:${s.layout === 'full' ? '100%' : '320px'};background:#0b1020"></iframe>
          <p class="sub" style="margin-top:10px;text-align:center;color:var(--muted);font-size:.78rem">Coverr clip — plays in browser, CC0, no attribution. License &amp; download details: <a href="${esc(raw)}" target="_blank" rel="noopener">${esc(raw)}</a>.</p>
        </div>`);
    }
    return sectionShell(s, i, `
      ${head(s)}
      ${isCoverrVideoUrl
        ? `<div class="${stage} video-native"><video src="${esc(raw)}" autoplay muted loop playsinline preload="metadata" title="${esc(s.title || 'Coverr video')}"></video></div>`
        : embed
          ? `<div class="${stage}"><iframe src="${esc(embed)}" title="${esc(s.title || 'Video')}" loading="lazy" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>`
          : `<p class="sub" style="text-align:center">Paste a YouTube/Vimeo link, or a Coverr stock video URL, in the section editor (\u201cextra\u201d field) to embed it here.</p>`}`);
  }

  function renderCountdown(p, s, i) {
    const cells = [
      { label: 'Days', u: 'd' }, { label: 'Hours', u: 'h' },
      { label: 'Minutes', u: 'm' }, { label: 'Seconds', u: 's' }
    ];
    if (s.layout === 'panel') {
      return sectionShell(s, i, `
        ${head(s)}
        ${s.extra
          ? `<div class="countdown-panel"><div class="countdown cd-panel" data-target="${esc(s.extra)}">${cells.map((c) => `<div class="cd-cell"><span class="cd-num" data-unit="${c.u}">00</span><small>${c.label}</small></div>`).join('')}</div></div>`
          : `<p class="sub" style="text-align:center">Set an ISO launch date (e.g. 2026-06-01T09:00:00) in the section editor to start the countdown.</p>`}`);
    }
    return sectionShell(s, i, `
      ${head(s)}
      ${s.extra
        ? `<div class="countdown" data-target="${esc(s.extra)}">${cells.map((c) => `<div class="cd-cell"><span class="cd-num" data-unit="${c.u}">00</span><small>${c.label}</small></div>`).join('')}</div>`
        : `<p class="sub" style="text-align:center">Set an ISO launch date (e.g. 2026-06-01T09:00:00) in the section editor to start the countdown.</p>`}`);
  }

  function renderMap(p, s, i) {
    const addr = (s.extra || '').trim();
    return sectionShell(s, i, `
      ${head(s)}
      ${addr
        ? `<div class="map-wrap"><iframe src="https://www.google.com/maps?q=${encodeURIComponent(addr)}&output=embed" title="Map: ${esc(addr)}" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe></div>`
        : `<p class="sub" style="text-align:center">Type an address in the section editor (“extra” field) to embed the map.</p>`}`);
  }

  function renderWeather(p, s, i) {
    const city = (s.extra || '').trim();
    return sectionShell(s, i, `
      ${head(s)}
      <div class="weather" data-city="${esc(city)}"><div class="weather-box">${city
        ? '<span class="weather-loading">Loading forecast…</span>'
        : '<span class="sub">Type a city in the section editor (“extra” field) to show its live forecast.</span>'}</div></div>`);
  }

  function renderEmbed(p, s, i) {
    const url = safeEmbedUrl(s.extra);
    return sectionShell(s, i, `
      ${head(s)}
      ${url
        ? `<div class="embed-wrap"><iframe src="${esc(url)}" title="${esc(s.title || 'Embed')}" loading="lazy" allowfullscreen allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"></iframe></div>`
        : `<p class="sub" style="text-align:center">Paste an embed URL (Spotify playlist, Calendly, Typeform…) in the section editor (“extra” field).</p>`}`);
  }

  // ----- dedicated booking block -----
  // Booking pages are intentionally provider-neutral. The iframe gives visitors
  // an in-page scheduling experience when the provider permits embedding, while
  // the visible fallback link still works for providers that send X-Frame-Options.
  function renderBooking(p, s, i) {
    const provider = bookingProviderInfo(s);
    const url = safeBookingUrl(s.bookingUrl || s.extra);
    const button = String(s.bookingButton || 'Book an appointment').trim() || 'Book an appointment';
    const duration = String(s.bookingDuration || '').trim();
    const location = String(s.bookingLocation || '').trim();
    const details = [
      duration ? `<span>⏱ ${esc(duration)}</span>` : '',
      location ? `<span>📍 ${esc(location)}</span>` : ''
    ].filter(Boolean).join('');
    const copy = s.text || 'Choose a time that works for you and book in a few clicks.';
    const bookingBody = url
      ? `<div class="booking-frame">
          <iframe src="${esc(url)}" title="${esc(s.title || 'Book an appointment')} with ${esc(provider.name)}" loading="lazy" allow="payment; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
          <div class="booking-fallback"><span>Having trouble loading the calendar?</span><a class="btn ghost small" href="${esc(url)}" target="_blank" rel="noopener">${esc(button)} ↗</a></div>
        </div>`
      : `<div class="booking-setup"><strong>Online booking is almost ready.</strong><p>Paste a public HTTPS ${esc(provider.name)} booking link in the section editor to show the calendar here.</p></div>`;
    const panel = `<div class="booking-panel">
      <div class="booking-copy">
        <p>${esc(copy)}</p>
        ${details ? `<div class="booking-meta">${details}</div>` : ''}
        ${url ? `<a class="btn solid booking-cta" href="${esc(url)}" target="_blank" rel="noopener">${esc(button)} ↗</a>` : ''}
      </div>
      ${bookingBody}
    </div>`;
    if (s.layout === 'compact') {
      return sectionShell(s, i, `${head(s)}<div class="booking-compact">${panel}</div>`);
    }
    return sectionShell(s, i, `${head(s)}${panel}`);
  }

  // ----- live data widgets (keyless public APIs) -----
  function renderCrypto(p, s, i) {
    const coins = (s.extra || '').trim() || 'bitcoin,ethereum,solana';
    const ids = coins.split(',').map((c) => c.trim()).filter(Boolean);
    const cells = ids.map((c) => `<div class="crypto-card" data-id="${esc(c)}"><span class="cr-loading">${esc(c)}…</span></div>`).join('');
    return sectionShell(s, i, `${head(s)}<div class="crypto" data-coins="${esc(coins)}"><div class="crypto-grid">${cells}</div></div>`);
  }

  function renderGithub(p, s, i) {
    const user = (s.extra || '').trim();
    return sectionShell(s, i, `${head(s)}
      <div class="github" data-user="${esc(user)}"><div class="github-box">${user
        ? '<span class="weather-loading">Loading GitHub stats…</span>'
        : '<span class="sub">Type a GitHub username in the section editor (“extra” field) to show live stats.</span>'}</div></div>`);
  }

  function renderFx(p, s, i) {
    const base = (s.extra || '').trim() || 'GBP';
    return sectionShell(s, i, `${head(s)}
      <div class="fx" data-base="${esc(base)}"><div class="fx-box">${base
        ? '<span class="weather-loading">Loading exchange rates…</span>'
        : '<span class="sub">Type a base currency (e.g. GBP) in the section editor (“extra” field).</span>'}</div></div>`);
  }

  // ----- native Table section (comparisons, menus, schedules, specs) -----
  function renderTable(p, s, i) {
    const cols = (Array.isArray(s.cols) ? s.cols : []).map((c) => String(c == null ? '' : c));
    const rows = (Array.isArray(s.rows) ? s.rows : [])
      .filter((r) => Array.isArray(r))
      .map((r) => r.map((c) => String(c == null ? '' : c)));
    let n = Math.max(1, cols.length);
    rows.forEach((r) => { if (r.length > n) n = r.length; });
    if (!cols.length && rows.length) rows.forEach((r, j) => { if (j < n || r[0] !== '') n = Math.max(n, 1); });
    const pad = (arr, len) => { const out = [...arr]; while (out.length < len) out.push(''); return out; };
    const lead = s.layout === 'compare';
    const thead = cols.length
      ? `<thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>` : '';
    const tbody = rows.length
      ? `<tbody>${rows.map((r) => `<tr>${pad(r, n).map((c, ci) => (lead && ci === 0
        ? `<th scope="row" class="tbl-lead">${esc(c)}</th>`
        : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody>` : '';
    if (!cols.length && !rows.length) {
      return sectionShell(s, i, `${head(s)}<p class="sub" style="text-align:center">Edit this section to add column headings and rows — perfect for price comparisons, opening hours or menus.</p>`);
    }
    return sectionShell(s, i, `${head(s)}<div class="tbl-wrap${lead ? ' tbl-compare' : ''}"><table>${thead}${tbody}</table></div>`);
  }

  // ----- Collection section: a faceted card gallery that works on ANY static host.
  // Category chips + live search + sort are pure client-side (a few lines of JS
  // in the exported page) — no server, no account, no lock-in. -----
  function renderCollection(p, s, i) {
    const fallback = [
      { title: 'First entry', text: 'Type “icon|title|text|category|tag|image” per line to fill this collection.', extra: 'Example' },
      { title: 'Add categories', text: 'Give every entry a category — visitors can then filter the grid in one click.', extra: 'Example' },
      { title: 'Search & sort live', text: 'Search and sort controls appear automatically on the exported site.', extra: 'Example' },
      { title: 'Swap the layout', text: 'Grid, slider or auto-scrolling marquee — pick a design variant in the editor.', extra: 'Example' }
    ];
    const items = (s.items && s.items.length ? s.items : fallback);
    const layout = s.layout || '';
    const seedBase = (s.title || p.site.name || 'collection').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'collection';
    const card = (it, j) => {
      const title = String(it.title || '');
      const cat = String((it.extra || '').trim());
      const img = (it.image || '').trim() || picsum(seedBase + '-' + (title || 'item') + '-' + j, 800, 600);
      return `
      <article class="coll-item" data-cat="${esc(cat || 'all')}" data-name="${esc(title.toLowerCase())}" data-search="${esc((title + ' ' + (it.text || '') + ' ' + (it.tag || '') + ' ' + cat).toLowerCase())}">
        <div class="coll-media">${gradeWrap(p, `<img src="${esc(img)}" alt="${esc(title || 'Collection item')}">`)}<span class="coll-cat">${esc(cat || '•')}</span>${it.tag ? `<span class="coll-tag">${esc(it.tag)}</span>` : ''}</div>
        <div class="coll-body"><h3>${esc(title || 'Untitled')}</h3><p>${esc(it.text || '')}</p></div>
      </article>`;
    };
    const cats = [];
    const seen = {};
    items.forEach((it) => { const c = String((it.extra || '').trim()); if (c && !seen[c]) { seen[c] = true; cats.push(c); } });
    cats.sort();
    const chips = s.filter !== false && cats.length
      ? `<div class="coll-chips" role="group" aria-label="Filter by category"><button class="coll-chip active" data-cat="all">All</button>${cats.map((c) => `<button class="coll-chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '';
    const searchBox = s.search !== false
      ? `<div class="coll-search"><input type="search" placeholder="Search…" aria-label="Search this collection"></div>` : '';
    const sortBox = s.sort !== false
      ? `<div class="coll-sort"><select aria-label="Sort"><option value="none">Sort</option><option value="az">A → Z</option><option value="za">Z → A</option></select></div>` : '';
    const tools = (searchBox || sortBox)
      ? `<div class="coll-tools">${searchBox}${sortBox}<span class="coll-count"></span></div>` : '';
    if (layout === 'slider') {
      const slides = items.map(card).join('');
      return sectionShell(s, i, `
      ${head(s)}
      <div class="coll" data-coll>
        ${chips ? `<div class="coll-controls">${chips}</div>` : ''}
        <div class="coll-nav"><button class="coll-prev" aria-label="Previous">←</button><button class="coll-next" aria-label="Next">→</button></div>
        <div class="coll-slider"><div class="coll-track">${slides}</div></div>
      </div>`);
    }
    if (layout === 'marquee') {
      const set = (ariaHidden) => `<div class="coll-set"${ariaHidden ? ' aria-hidden="true"' : ''}>${items.map(card).join('')}</div>`;
      return sectionShell(s, i, `
      ${head(s)}
      <div class="coll-marquee"><div class="coll-track">${set(false)}${set(true)}</div></div>`);
    }
    const controls = layout !== 'plain' && (chips || tools)
      ? `<div class="coll-controls">${chips}${tools}</div>` : '';
    return sectionShell(s, i, `
      ${head(s)}
      <div class="coll${controls ? '' : ' coll-static'}" data-coll>
        ${controls}
        <div class="coll-grid">${items.map(card).join('')}<p class="coll-empty">Nothing matches — try a different category or search.</p></div>
      </div>`);
  }

  const renderers = {
    hero: renderHero, features: renderFeatures, stats: renderStats, about: renderAbout,
    gallery: renderGallery, pricing: renderPricing, testimonials: renderTestimonials,
    faq: renderFaq, blog: renderBlog, shop: renderShop, logos: renderLogos,
    video: renderVideo, countdown: renderCountdown, contact: renderContact, cta: renderCta,
    map: renderMap, weather: renderWeather, embed: renderEmbed, booking: renderBooking,
    crypto: renderCrypto, github: renderGithub, fx: renderFx,
    table: renderTable, collection: renderCollection
  };

  // ---------------- nav ----------------
  function buildNav(p) {
    const s = p.site;
    const multi = _ctx.pages.length > 1;
    const page = _ctx.page;
    const links = [];
    if (multi) {
      // multi-page sites navigate between pages
      _ctx.pages.forEach((pg) => {
        const here = pg === page;
        links.push(`<a href="${here ? '#top' : pageHref(pg)}"${here ? '' : ' class="page-link" data-page="' + esc(pg.id) + '"'}>${esc(pg.name)}</a>`);
      });
    } else {
      const seen = {};
      s.sections.forEach((sec, i) => {
        if (!seen[sec.type] && ['features', 'pricing', 'gallery', 'about', 'blog', 'shop', 'faq', 'testimonials', 'booking'].includes(sec.type)) {
          seen[sec.type] = true;
          links.push(`<a href="#sec-${sec.type}-${i}">${esc(DB.sectionTypes[sec.type].name)}</a>`);
        }
      });
      links.push(`<a href="${contactRef(p)}">Contact</a>`);
    }
    const cart = (p.suites || []).includes('shop') ? `<button class="cart-btn" data-cart="open">🛒<span class="cart-count" hidden>0</span></button>` : '';
    const themeBtn = s.themeToggle === false ? '' : `<button class="theme-btn" aria-label="Toggle dark or light theme">🌙</button>`;
    const cta = s.navCta ? `<a class="btn solid small nav-cta" href="${esc(safeHref(s.ctaLink, contactRef(p)))}">${esc(s.navCta)}</a>` : '';
    const cls = (s.navSticky === false ? ' static' : '') + (s.navStyle === 'transparent' ? ' transparent' : '');
    const mark = s.logo
      ? `<span class="brand-mark"><img src="${esc(s.logo)}" alt=""></span>`
      : `<span class="brand-mark">◆</span>`;
    return `
    <nav class="nav${cls}">
      <div class="nav-inner container">
        <a class="brand" href="#top">${mark}${esc(s.name || 'My Site')}</a>
        <div class="nav-links">${links.join('')}</div>
        ${cart}
        ${themeBtn}
        ${cta}
        <button class="burger" aria-label="Menu"><span></span><span></span><span></span></button>
      </div>
    </nav>`;
  }

  // ---------------- footer ----------------
  // Licence-aware photo credits. Sources like Openverse and Wikimedia Commons
  // return CC-BY/CC-BY-SA images whose creator and licence travel in the
  // project model (imageMeta) — the exported site must keep that attribution
  // visible, so every photo that requires it earns a compact credit line here.
  // CC0/PD photos and the creator's own uploads carry no meta and add nothing.
  function imageCreditsHTML(p) {
    const rows = [];
    const seen = new Set();
    const walk = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) { obj.forEach(walk); return; }
      const meta = obj.imageMeta;
      if (typeof meta === 'object' && meta && meta.requiresAttribution !== false && obj.image && !seen.has(obj.image)) {
        const raw = String(meta.attribution || '').trim();
        const label = raw || [String(meta.title || '').trim(), meta.creator ? 'by ' + String(meta.creator).trim() : '', String(meta.license || '').trim()].filter(Boolean).join(' — ');
        const href = String(meta.sourceUrl || meta.licenseUrl || '').trim();
        if (label && (href || meta.license)) {
          seen.add(obj.image);
          rows.push({ label, href });
        }
      }
      ['items', 'sections', 'posts', 'products', 'tiers'].forEach((k) => { if (Array.isArray(obj[k])) obj[k].forEach(walk); });
    };
    walk(Array.isArray(p.site.sections) ? p.site.sections : []);
    if (!rows.length) return '';
    const links = rows.slice(0, 40).map((r) => {
      const label = esc(r.label);
      return (safeHref(r.href) ? `<a href="${esc(safeHref(r.href))}" target="_blank" rel="noopener nofollow">${label}</a>` : label);
    }).join(' · ');
    return `
      <div class="foot-credits"><b>Photos</b>${links}</div>`;
  }

  function translationCredit(p) {
    const t = p && p.site && p.site.translation;
    if (!t || !t.provider) return '';
    const label = t.provider === 'deepl'
      ? 'Translations powered by DeepL'
      : t.provider === 'mymemory'
        ? 'Translations powered by MyMemory'
        : '';
    if (!label) return '';
    return `<p class="translate-credit">${esc(label)}</p>`;
  }

  function buildFooter(p, settings) {
    const year = new Date().getFullYear();
    const made = settings.brandFooter !== false
      ? `<p class="made-by">${esc(settings.brandFooterText || 'Made by PallettAI')}${safeHref(settings.brandLink) ? ` · <a href="${esc(safeHref(settings.brandLink))}" target="_blank" rel="noopener">${esc(String(settings.brandLink).replace(/^https?:\/\//, ''))}</a>` : ''}</p>`
      : '';
    const socials = (Array.isArray(p.site.socials) && p.site.socials.length
      ? p.site.socials.map((so) => `<a class="social" href="${esc(safeHref(so.url, '#'))}" target="_blank" rel="noopener" aria-label="Social">${esc(so.icon || '•')}</a>`).join('')
      : ['𝕏', 'in', 'ig', '▶'].map((s2) => `<a class="social" href="#" aria-label="Social">${s2}</a>`).join(''));
    const mark = p.site.logo ? `<img src="${esc(p.site.logo)}" alt="">` : '◆ ';
    return `
    <footer class="footer">
      <div class="container foot-grid">
        <div>
          <strong class="brand"><span class="brand-mark">${mark}</span>${esc(p.site.name || 'My Site')}</strong>
          <p>${esc(p.site.tagline || '')}</p>
          ${socials}
        </div>
        <div>
          <strong>Contact</strong>
          <p>${esc(p.site.email || '')}</p>
          <p>${esc(p.site.phone || '')}</p>
          <p>${esc(p.site.address || '')}</p>
        </div>
        <div>
          <strong>Explore</strong>
          ${_ctx.pages.length > 1
            ? _ctx.pages.map((pg) => {
                const here = pg === _ctx.page;
                return `<p><a href="${here ? '#top' : pageHref(pg)}"${here ? '' : ' class="page-link" data-page="' + esc(pg.id) + '"'}>${esc(pg.name)}</a></p>`;
              }).join('')
            : `<p><a href="#top">Home</a></p><p><a href="${contactRef(p)}">Contact</a></p>`}
        </div>
      </div>
      ${imageCreditsHTML(p)}
      ${translationCredit(p)}
      <div class="container foot-end">
        <p>© ${year} ${esc(p.site.name || 'My Site')}. All rights reserved.</p>
        ${made}
      </div>
      ${settings.proExport === true ? '' : `
      <a class="pallettai-badge" href="https://pallettai.org" target="_blank" rel="noopener" title="Built with PallettAI Studio">
        ◆ Made with PallettAI Studio
      </a>`}
    </footer>`;
  }

  // ---------------- generated site CSS ----------------
  const design = (p) => {
    const raw = p && p.site && p.site.design && typeof p.site.design === 'object' ? p.site.design : {};
    const number = (value, fallback, min) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= min ? n : fallback;
    };
    return {
      containerWidth: number(raw.containerWidth, 1140, 1),
      radius: number(raw.radius, 20, 0),
      spacing: number(raw.spacing, 96, 1),
      customCss: String(raw.customCss || ''),
      customJs: String(raw.customJs || ''),
      styleCss: String(raw.styleCss || '')
    };
  };

  // Resolve an uploaded font before falling back to the catalog. Brand presets
  // can carry custom font files between projects, so the generated site's CSS
  // must use the matching @font-face family instead of silently reverting to Inter.
  const cssFontName = (value) => String(value || '').replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 120) || 'Custom Font';
  const siteFont = (site, id) => {
    const custom = Array.isArray(site && site.customFonts)
      ? site.customFonts.find((f) => f && f.name === id && f.data)
      : null;
    return custom ? { name: cssFontName(custom.name), id: '' } : DB.getFont(id);
  };

  const siteCSS = (p, settings) => {
    const pal = DB.getPalette(p.site.palette);
    const isDark = pal.dark;
    const f = siteFont(p.site, p.site.font);
    // optional display/heading family (AI Studio design DNA) — falls back to body
    const fd = (p.site.fontDisplay && p.site.fontDisplay !== p.site.font) ? siteFont(p.site, p.site.fontDisplay) : null;
    const d = design(p);
    return `
:root{
  --bg:${pal.bg}; --surface:${pal.surface}; --primary:${pal.primary}; --accent:${pal.accent};
  --text:${pal.text}; --muted:${pal.muted};
  --radius:${d.radius}px; --shadow:0 20px 60px rgba(0,0,0,${isDark ? 0.45 : 0.10});
  --font:'${f.name}',system-ui,sans-serif;
  --fontd:${fd ? `'${fd.name}',Georgia,'Times New Roman',serif` : 'var(--font)'};
  --grad:linear-gradient(135deg,${pal.primary},${pal.accent});
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.65;overflow-x:hidden;overflow-wrap:break-word}
h1,h2,h3,h4{font-family:var(--fontd);line-height:1.18;letter-spacing:-.012em;text-wrap:balance}
h1,h2,h3,h4,p,li{overflow-wrap:break-word}
img{max-width:100%;display:block}
a{color:inherit;text-decoration:none}
.container{max-width:${d.containerWidth}px;margin:0 auto;padding:0 24px}
.section{padding:${d.spacing}px 0;position:relative}
/* client theme toggle */
body.theme-light{--bg:#f6f7fb;--surface:#ffffff;--text:#151827;--muted:#5d6487;--shadow:0 20px 60px rgba(20,30,70,.10)}
body.theme-light .hero-shade{background:linear-gradient(180deg,rgba(15,18,40,.30),rgba(15,18,40,.12) 60%,var(--bg))}
body.theme-light .sec-hero h1{background:linear-gradient(120deg,#14172b 25%,color-mix(in srgb,var(--primary) 60%,#14172b));-webkit-background-clip:text;background-clip:text}
body.theme-light .hero-tag{color:#343a52}
body.theme-dark{--bg:#0b0e1c;--surface:#161a30;--text:#eef0ff;--muted:#9aa1c4;--shadow:0 20px 60px rgba(0,0,0,.45)}
body.theme-dark .hero-shade{background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,.35) 60%,var(--bg))}
body.theme-dark .sec-hero h1{background:linear-gradient(120deg,#fff 20%,color-mix(in srgb,var(--accent) 70%,#fff));-webkit-background-clip:text;background-clip:text}
body.theme-dark .hero-tag{color:#e8eaf2}
.eyebrow{color:var(--primary);font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:.8rem;margin-bottom:10px}
.sec-head{max-width:640px;margin-bottom:48px}
.sec-head h2{font-size:clamp(1.8rem,4vw,2.6rem);line-height:1.15;letter-spacing:-.02em}
.sub{color:var(--muted);margin-top:10px;font-size:1.05rem}
.btn{display:inline-block;padding:13px 28px;border-radius:999px;font-weight:700;font-size:.95rem;border:2px solid transparent;cursor:pointer;transition:.25s;font-family:var(--font)}
.btn.solid{background:var(--grad);color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25)}
.btn.solid:hover{transform:translateY(-2px);filter:brightness(1.08)}
.btn.ghost{border-color:color-mix(in srgb,var(--text) 35%,transparent);background:transparent}
.btn.ghost:hover{border-color:var(--primary);color:var(--primary)}
.btn.small{padding:9px 18px;font-size:.85rem}
.card{background:var(--surface);border-radius:var(--radius);padding:32px;box-shadow:var(--shadow);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);transition:.3s}
.card:hover{transform:translateY(-6px)}
.grid3,.grid4{display:grid;gap:24px}
.grid3{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.grid4{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
/* tables (native Table section) */
.tbl-wrap{overflow-x:auto;border:1px solid color-mix(in srgb,var(--text) 10%,transparent);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}
.tbl-wrap table{width:100%;border-collapse:collapse;min-width:520px}
.tbl-wrap th,.tbl-wrap td{text-align:left;padding:14px 18px;border-bottom:1px solid color-mix(in srgb,var(--text) 8%,transparent);font-size:.95rem;line-height:1.5}
.tbl-wrap thead th{background:color-mix(in srgb,var(--primary) 9%,transparent);font-weight:700;letter-spacing:.02em}
.tbl-wrap tbody tr:last-child th,.tbl-wrap tbody tr:last-child td{border-bottom:0}
.tbl-compare tbody tr:nth-child(even){background:color-mix(in srgb,var(--text) 3%,transparent)}
.tbl-lead{font-weight:700}
/* collections — faceted galleries that work on any static host */
.coll-controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:28px}
.coll-chips{display:flex;gap:6px;flex-wrap:wrap}
.coll-chip{border:1px solid color-mix(in srgb,var(--text) 20%,transparent);background:transparent;color:var(--muted);padding:7px 16px;border-radius:999px;cursor:pointer;font:inherit;font-size:.85rem;transition:.2s}
.coll-chip:hover{border-color:var(--primary);color:var(--primary)}
.coll-chip.active{background:var(--grad);border-color:transparent;color:#fff;font-weight:700}
.coll-tools{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.coll-search{position:relative}
.coll-search input{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 16%,transparent);border-radius:999px;padding:8px 14px 8px 32px;color:var(--text);font:inherit;font-size:.85rem;min-width:190px;outline:none}
.coll-search input:focus{border-color:var(--primary)}
.coll-search:before{content:'🔍';position:absolute;left:10px;top:50%;transform:translateY(-52%);font-size:.75rem;opacity:.7}
.coll-sort select{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 16%,transparent);border-radius:999px;padding:8px 12px;color:var(--text);font:inherit;font-size:.85rem;outline:none;cursor:pointer}
.coll-count{color:var(--muted);font-size:.82rem;margin-left:2px}
.coll-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:24px}
.coll-item{position:relative;display:flex;flex-direction:column;background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 9%,transparent);border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);transition:transform .25s,box-shadow .25s}
.coll-grid .coll-item:hover{transform:translateY(-5px)}
.coll-media{position:relative;aspect-ratio:4/3;overflow:hidden;background:var(--grad)}
.coll-media img{width:100%;height:100%;object-fit:cover;transition:transform .5s}
.coll-item:hover .coll-media img{transform:scale(1.05)}
.coll-cat{position:absolute;left:12px;bottom:12px;background:rgba(10,10,18,.6);color:#fff;backdrop-filter:blur(6px);padding:4px 11px;border-radius:999px;font-size:.72rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.coll-body{padding:18px 20px 20px;display:flex;flex-direction:column;gap:6px;flex:1}
.coll-body h3{font-size:1.05rem;letter-spacing:-.01em}
.coll-body p{color:var(--muted);font-size:.9rem;margin-top:auto;padding-top:8px}
.coll-tag{position:absolute;right:12px;top:12px;background:rgba(10,10,18,.55);color:#fff;backdrop-filter:blur(6px);padding:3px 10px;border-radius:999px;font-size:.72rem;font-weight:700}
.coll-empty{display:none;text-align:center;color:var(--muted);padding:36px 0;grid-column:1/-1}
/* collection slider variant */
.coll-slider{position:relative}
.coll-track{display:grid;grid-auto-flow:column;grid-auto-columns:min(80%,330px);gap:20px;overflow-x:auto;scroll-snap-type:x mandatory;padding:8px 2px 16px;scrollbar-width:none}
.coll-track::-webkit-scrollbar{display:none}
.coll-track .coll-item{scroll-snap-align:start;min-height:100%}
.coll-nav{display:flex;gap:8px;justify-content:flex-end;margin:-8px 0 18px}
.coll-nav button{width:42px;height:42px;border-radius:50%;border:1px solid color-mix(in srgb,var(--text) 20%,transparent);background:var(--surface);color:var(--text);cursor:pointer;font-size:1rem;transition:.2s}
.coll-nav button:hover{border-color:var(--primary);color:var(--primary)}
/* collection marquee variant */
.coll-marquee{overflow:hidden;padding:6px 0}
.coll-marquee .coll-track{display:flex;gap:0;width:max-content;animation:coll-scroll 30s linear infinite;overflow:visible;padding:0}
.coll-marquee:hover .coll-track{animation-play-state:paused}
.coll-marquee .coll-set{display:flex;gap:20px;padding-right:20px}
.coll-marquee .coll-item{width:300px}
@keyframes coll-scroll{to{transform:translateX(-50%)}}
/* reveal animations */
.reveal{opacity:0;transition:opacity .8s ease,transform .8s cubic-bezier(.2,.7,.2,1)}
.reveal.in{opacity:1;transform:none !important}
/* nav */
.nav{position:fixed;top:0;left:0;right:0;z-index:50;background:color-mix(in srgb,var(--bg) 72%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid color-mix(in srgb,var(--text) 8%,transparent)}
.nav-inner{display:flex;align-items:center;gap:24px;height:68px}
.brand{font-weight:800;font-size:1.15rem;letter-spacing:-.01em;display:inline-flex;align-items:center;gap:8px}
.brand-mark{color:var(--primary);display:inline-flex}
.brand-mark img{width:28px;height:28px;object-fit:contain;border-radius:8px}
.nav.static{position:absolute}
.nav.transparent{background:transparent;backdrop-filter:none;border-bottom-color:transparent}
.nav-links{display:flex;gap:22px;margin-left:auto}
.theme-btn{background:none;border:1px solid color-mix(in srgb,var(--text) 22%,transparent);border-radius:99px;width:38px;height:38px;cursor:pointer;font-size:1rem;color:var(--text);transition:.2s;flex-shrink:0}
.theme-btn:hover{border-color:var(--primary)}
.nav-cta{margin-left:4px}
.nav-links a{color:var(--muted);font-weight:600;font-size:.92rem;transition:.2s}
.nav-links a:hover{color:var(--text)}
.cart-btn{background:none;border:none;font-size:1.25rem;cursor:pointer;position:relative}
.cart-count{position:absolute;top:-6px;right:-8px;background:var(--accent);color:#000;font-size:.65rem;font-weight:800;border-radius:99px;min-width:18px;height:18px;display:grid;place-items:center;padding:0 4px}
.burger{display:none;flex-direction:column;gap:5px;background:none;border:none;cursor:pointer;padding:6px}
.burger span{width:24px;height:2px;background:var(--text);border-radius:2px;transition:.3s}
/* hero */
.sec-hero{min-height:100vh;display:grid;place-items:center;text-align:center;padding-top:120px;overflow:hidden}
.hero-bg{position:absolute;inset:0;background-size:cover;background-position:center;transform:scale(1.06)}
.hero-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,.35) 60%,var(--bg))}
.sec-hero .container{position:relative;z-index:2}
.hero-badge{display:inline-block;background:color-mix(in srgb,var(--primary) 25%,transparent);color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);padding:7px 18px;border-radius:999px;font-size:.8rem;font-weight:700;letter-spacing:.08em;margin-bottom:22px}
.sec-hero h1{font-size:clamp(2.6rem,7vw,4.8rem);line-height:1.05;letter-spacing:-.03em;background:linear-gradient(120deg,#fff 20%,color-mix(in srgb,var(--accent) 70%,#fff));-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 20px 60px rgba(0,0,0,.4)}
.hero-tag{font-size:clamp(1.15rem,2.6vw,1.6rem);color:#e8eaf2;margin-top:14px;font-weight:500}
.hero-desc{color:color-mix(in srgb,#fff 75%,transparent);max-width:620px;margin:18px auto 0}
.hero-cta{display:flex;gap:14px;justify-content:center;margin-top:34px;flex-wrap:wrap}
.sec-hero .btn.ghost{color:#fff;border-color:rgba(255,255,255,.4)}
.orb{position:absolute;border-radius:50%;filter:blur(90px);opacity:.5;z-index:1}
.orb-a{width:420px;height:420px;background:var(--primary);top:-120px;left:-120px;animation:drift 14s ease-in-out infinite alternate}
.orb-b{width:360px;height:360px;background:var(--accent);bottom:-100px;right:-100px;animation:drift 18s ease-in-out infinite alternate-reverse}
@keyframes drift{to{transform:translate(70px,50px) scale(1.15)}}
.scroll-hint{position:absolute;bottom:28px;left:50%;transform:translateX(-50%);z-index:3;width:26px;height:42px;border:2px solid rgba(255,255,255,.5);border-radius:14px}
.scroll-hint span{position:absolute;top:7px;left:50%;width:4px;height:8px;margin-left:-2px;background:#fff;border-radius:4px;animation:wheel 1.6s infinite}
@keyframes wheel{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(14px)}}
/* features */
.feat-icon{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;font-size:1.6rem;background:color-mix(in srgb,var(--primary) 16%,transparent);margin-bottom:18px}
.feat h3{margin-bottom:8px;font-size:1.12rem}
.feat p{color:var(--muted);font-size:.95rem}
/* stats */
.stat{text-align:center;padding:28px 12px}
.stat-num{font-size:clamp(2rem,5vw,3.2rem);font-weight:800;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.stat-label{color:var(--muted);font-weight:600;margin-top:4px}
/* about */
.about-grid{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
.about-media img{border-radius:var(--radius);box-shadow:var(--shadow);width:100%;height:100%;object-fit:cover;min-height:380px}
.checks{list-style:none;margin-top:18px;display:grid;gap:10px}
.checks li{display:flex;gap:10px;align-items:center;font-weight:500}
/* gallery */
.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.gal-item{position:relative;border-radius:16px;overflow:hidden;cursor:zoom-in;aspect-ratio:4/3}
.gal-item img{width:100%;height:100%;object-fit:cover;transition:.5s}
.gal-item:hover img{transform:scale(1.07)}
.gal-item figcaption{position:absolute;inset:auto 0 0 0;padding:34px 18px 14px;background:linear-gradient(transparent,rgba(0,0,0,.75));color:#fff;display:flex;flex-direction:column}
.gal-item figcaption small{opacity:.75}
.masonry-wrap{columns:3;gap:20px}
.masonry{break-inside:avoid;margin-bottom:20px;aspect-ratio:auto}
/* lightbox */
.lb{position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:100;display:none;place-items:center}
.lb.open{display:grid}
.lb-stage{max-width:86vw;max-height:82vh;text-align:center}
.lb-stage img{max-width:86vw;max-height:74vh;object-fit:contain;border-radius:12px}
.lb-stage figcaption{color:#ccc;margin-top:10px}
.lb-close,.lb-nav{position:absolute;background:rgba(255,255,255,.12);border:none;color:#fff;border-radius:50%;cursor:pointer;font-size:1.2rem}
.lb-close{top:22px;right:26px;width:44px;height:44px}
.lb-nav{top:50%;transform:translateY(-50%);width:52px;height:52px;font-size:1.8rem}
.lb-nav.prev{left:18px}.lb-nav.next{right:18px}
/* pricing */
.price{position:relative;text-align:center}
.price.hot{border:2px solid var(--accent)}
.price-tag{position:absolute;top:-13px;left:50%;transform:translateX(-50%);background:var(--accent);color:#000;font-size:.7rem;font-weight:800;letter-spacing:.08em;padding:5px 14px;border-radius:99px;text-transform:uppercase}
.price-emoji{font-size:2rem;margin-bottom:10px}
.price-amt{font-size:2.2rem;font-weight:800;margin:6px 0}
.price-amt span{font-size:.9rem;color:var(--muted);font-weight:500}
.price p{color:var(--muted);margin-bottom:18px;font-size:.95rem}
/* testimonials */
.quote{position:relative;padding-top:44px}
.quote-mark{position:absolute;top:6px;left:22px;font-size:4rem;line-height:1;color:var(--primary);opacity:.5;font-family:Georgia,serif}
.quote p{color:var(--muted);font-style:italic;margin-bottom:20px}
.quote-who{display:flex;gap:12px;align-items:center}
.quote-who img{width:46px;height:46px;border-radius:50%;object-fit:cover}
.quote-who small{display:block;color:var(--muted)}
.who-ini{width:46px;height:46px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:800;letter-spacing:.04em;background:color-mix(in srgb,var(--accent) 22%,var(--surface));color:var(--text);flex:0 0 46px}
.photo-hole{width:100%;min-height:160px;display:flex;align-items:center;justify-content:center;text-align:center;border:1px dashed color-mix(in srgb,var(--text) 22%,transparent);border-radius:16px;background:color-mix(in srgb,var(--surface) 80%,transparent);color:var(--muted);font-size:.85rem;font-weight:700;letter-spacing:.02em}
/* faq */
.faq-list{max-width:760px;margin:0 auto;display:grid;gap:14px}
.faq-item{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:14px;padding:0 22px;box-shadow:var(--shadow)}
.faq-item summary{list-style:none;cursor:pointer;padding:20px 0;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:12px}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item[open] summary{color:var(--primary)}
.chev{transition:.3s;color:var(--muted)}
.faq-item[open] .chev{transform:rotate(180deg)}
.faq-item p{padding-bottom:20px;color:var(--muted)}
/* blog */
.post-icon{font-size:1.8rem;margin-bottom:14px}
.post h3{margin-bottom:8px;font-size:1.1rem}
.post p{color:var(--muted);font-size:.95rem}
.post-foot{display:flex;justify-content:space-between;align-items:center;margin-top:16px}
.linkish{background:none;border:none;color:var(--primary);font-weight:700;cursor:pointer;font-family:var(--font);font-size:.9rem}
.newsletter{margin-top:44px;background:var(--grad);border-radius:var(--radius);padding:34px;display:flex;gap:24px;align-items:center;justify-content:space-between;color:#fff;flex-wrap:wrap}
.newsletter p{opacity:.85;font-size:.9rem}
.nl-form{display:flex;gap:10px;flex-wrap:wrap}
.nl-form input{border:none;border-radius:99px;padding:13px 20px;min-width:240px;font-family:var(--font)}
/* modal */
.modal{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:90;display:none;place-items:center;padding:20px}
.modal.open{display:grid}
.modal-card{background:var(--surface);max-width:640px;width:100%;border-radius:var(--radius);padding:36px;position:relative;max-height:80vh;overflow:auto;box-shadow:var(--shadow)}
.modal-x{position:absolute;top:16px;right:18px;background:none;border:none;font-size:1.1rem;cursor:pointer;color:var(--muted)}
.modal-card small{color:var(--primary)}
.modal-card h3{margin:10px 0 14px;font-size:1.5rem}
#postBody{color:var(--muted);white-space:pre-line;margin-top:12px}
/* shop */
.product{text-align:center;display:flex;flex-direction:column;gap:8px}
.product-emoji{font-size:2.4rem;background:color-mix(in srgb,var(--primary) 14%,transparent);width:72px;height:72px;border-radius:20px;display:grid;place-items:center;margin:0 auto 6px}
.product h3{font-size:1.05rem}
.product p{color:var(--muted);font-size:.88rem;flex:1}
.product-row{display:flex;justify-content:space-between;align-items:center;margin-top:14px}
.product-price{font-weight:800;font-size:1.15rem}
.cart{position:fixed;top:0;right:0;bottom:0;width:min(380px,100%);background:var(--surface);z-index:95;box-shadow:-20px 0 60px rgba(0,0,0,.3);transform:translateX(105%);transition:.35s;display:flex;flex-direction:column;padding:26px}
.cart.open{transform:none}
.cart-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.cart-items{flex:1;overflow:auto;display:grid;gap:12px;align-content:start}
.cart-row{display:flex;gap:10px;align-items:center;justify-content:space-between;background:color-mix(in srgb,var(--text) 5%,transparent);padding:12px 14px;border-radius:12px}
.cart-row small{color:var(--muted)}
.cart-qty{display:flex;gap:8px;align-items:center}
.cart-qty button{width:26px;height:26px;border-radius:8px;border:1px solid color-mix(in srgb,var(--text) 20%,transparent);background:none;cursor:pointer;color:var(--text)}
.cart-foot{display:flex;justify-content:space-between;margin:16px 0;font-size:1.1rem}
/* contact */
.contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start}
.contact-list{list-style:none;margin-top:16px;display:grid;gap:10px}
.wa{margin-top:18px}
.contact-form{display:grid;gap:14px}
.contact-form input,.contact-form textarea{background:color-mix(in srgb,var(--text) 6%,transparent);border:1px solid color-mix(in srgb,var(--text) 12%,transparent);border-radius:12px;padding:14px 16px;font-family:var(--font);color:var(--text);font-size:.95rem;transition:.2s}
.contact-form input:focus,.contact-form textarea:focus{outline:none;border-color:var(--primary)}
.form-note{color:var(--muted);font-size:.82rem;text-align:center}
.map{width:100%;height:300px;border:0;border-radius:var(--radius);margin-top:40px;filter:saturate(.9)}
/* cta */
.cta-banner{background:var(--grad);border-radius:28px;padding:64px 40px;text-align:center;color:#fff;position:relative;overflow:hidden}
.cta-banner h2{font-size:clamp(1.7rem,4vw,2.4rem);margin-bottom:10px}
.cta-banner p{opacity:.9;margin-bottom:24px}
.cta-banner .btn.solid{background:#fff;color:#111}
/* hero layouts */
.sec-hero.layout-split{min-height:92vh;place-items:center;text-align:left;padding:140px 0 90px}
.hero-split{display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center;width:100%}
.hero-split h1{font-size:clamp(2.2rem,5vw,3.8rem)}
.hero-split .hero-desc{color:var(--muted);font-size:1.08rem;margin-top:18px;max-width:520px}
.hero-split-media img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius);box-shadow:var(--shadow)}
.sec-hero.layout-minimal{min-height:78vh;padding:150px 0 100px}
.hero-inner.minimal .hero-desc{color:var(--muted);max-width:640px;margin:18px auto 0}
/* --- layout catalog variants --- */
/* hero: code terminal */
.sec-hero.layout-terminal{min-height:88vh;padding:150px 0 90px}
.term-window{max-width:760px;margin:36px auto 0;background:#0c1022;border:1px solid rgba(255,255,255,.09);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.45);text-align:left;overflow:hidden}
.term-head{display:flex;align-items:center;gap:8px;padding:13px 18px;border-bottom:1px solid rgba(255,255,255,.08);font-size:.72rem;color:#8b93b8;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.term-head span{width:11px;height:11px;border-radius:50%}
.term-head span:nth-child(1){background:#ff5f57}.term-head span:nth-child(2){background:#febc2e}.term-head span:nth-child(3){background:#28c840}
.term-head b{margin-left:8px;font-weight:600;letter-spacing:.04em}
.term-body{padding:22px 24px 26px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:clamp(.78rem,1.5vw,.98rem);line-height:1.9;color:#d9e1f7}
.term-line{margin:0;white-space:nowrap;overflow:hidden}
.term-p{color:var(--accent);font-style:normal;font-weight:700;margin-right:8px}
.term-ok{color:#34d399}
.term-typing{white-space:nowrap;overflow:hidden;width:0;animation:term-type 3.2s steps(58,end) 1.1s forwards}
@keyframes term-type{to{width:100%}}
.term-cursor{display:inline-block;width:.6em;height:1.05em;background:var(--accent);vertical-align:middle;margin-left:4px;animation:term-blink 1s steps(1) infinite}
@keyframes term-blink{50%{opacity:0}}
@media (max-width:640px){.term-line{white-space:normal}.term-typing{animation:none;width:auto}}
/* features: bento grid */
.bento-grid{display:grid;grid-template-columns:repeat(6,1fr);grid-auto-rows:minmax(96px,auto);gap:18px}
.bento-card{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:var(--radius);padding:26px;box-shadow:var(--shadow);transition:.3s;display:flex;flex-direction:column;gap:8px;min-height:96px}
.bento-card:hover{transform:translateY(-5px)}
.bento-card .feat-icon{font-size:1.7rem}
.bento-card h3{font-size:1.05rem}
.bento-card p{color:var(--muted);font-size:.85rem}
.bento-card.bento-hot{background:linear-gradient(150deg,color-mix(in srgb,var(--primary) 85%,var(--surface)),color-mix(in srgb,var(--accent) 55%,var(--surface)));border-color:transparent;color:#fff}
.bento-card.bento-hot p{color:rgba(255,255,255,.82)}
@media (max-width:860px){.bento-grid{grid-template-columns:repeat(2,1fr)}.bento-card[style*="grid-column:span 4"]{grid-column:span 2}}
@media (max-width:560px){.bento-grid{grid-template-columns:1fr}.bento-card[style*="grid-column"],.bento-card[style*="grid-row"]{grid-column:span 1;grid-row:span 1}}
/* features: editorial numbered */
.num-rows{display:flex;flex-direction:column}
.num-row{display:grid;grid-template-columns:130px 1fr auto;gap:28px;align-items:center;padding:30px 0;border-bottom:1px solid color-mix(in srgb,var(--text) 10%,transparent);transition:.25s}
.num-row:hover .num-idx{transform:translateX(6px)}
.num-idx{font-size:clamp(2.2rem,5vw,3.4rem);font-weight:800;line-height:1;color:transparent;-webkit-text-stroke:1.5px color-mix(in srgb,var(--primary) 60%,transparent);transition:.25s}
.num-body h3{font-size:clamp(1.1rem,2.4vw,1.5rem);margin-bottom:6px}
.num-body p{color:var(--muted);max-width:560px}
.num-extra{color:var(--primary);font-weight:700;font-size:.9rem}
@media (max-width:720px){.num-row{grid-template-columns:64px 1fr;gap:14px}.num-extra{grid-column:2}}
/* stats: gradient band */
.stats-band{background:var(--grad);border-radius:28px;padding:52px 44px;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;box-shadow:0 24px 60px color-mix(in srgb,var(--primary) 30%,transparent)}
.sb-stat{text-align:center;padding:0 18px}
.sb-stat+.sb-stat{border-left:1px solid rgba(255,255,255,.22)}
.sb-num{font-size:clamp(1.9rem,4.5vw,3rem);font-weight:800;background:#fff;-webkit-background-clip:text;background-clip:text;color:transparent}
.sb-label{color:rgba(255,255,255,.85);font-size:.9rem;margin-top:6px}
@media (max-width:760px){.sb-stat+.sb-stat{border-left:0}}
/* pricing: stacked tier rows */
.price-stack{display:flex;flex-direction:column;gap:14px}
.pstack-row{position:relative;display:grid;grid-template-columns:1.5fr 1fr auto;gap:22px;align-items:center;background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:18px;padding:22px 26px;box-shadow:var(--shadow);transition:.25s}
.pstack-row:hover{transform:translateX(6px)}
.pstack-row.hot{border-color:var(--primary);background:linear-gradient(160deg,var(--surface),color-mix(in srgb,var(--primary) 14%,var(--surface)));box-shadow:0 14px 40px color-mix(in srgb,var(--primary) 25%,transparent)}
.pstack-row .price-tag{top:-11px;right:22px}
.ps-name h3{font-size:1.1rem;margin-bottom:3px}
.ps-name p{color:var(--muted);font-size:.82rem}
.ps-price{font-size:1.6rem;font-weight:800;letter-spacing:-.02em;text-align:right}
.ps-price small{font-size:.72rem;color:var(--muted);font-weight:600}
@media (max-width:700px){.pstack-row{grid-template-columns:1fr auto;padding:18px}.ps-price{text-align:left}.pstack-row .btn{grid-column:1/-1}}
/* testimonials: masonry wall */
.quote-masonry{columns:3;column-gap:20px}
.quote-masonry .card{break-inside:avoid;display:inline-block;width:100%;margin-bottom:20px}
@media (max-width:900px){.quote-masonry{columns:2}}
@media (max-width:560px){.quote-masonry{columns:1}}
/* gallery: mosaic wall */
.gal-mosaic{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:150px;gap:12px}
.gal-m{position:relative;overflow:hidden;border-radius:16px;margin:0;cursor:pointer}
.gal-m img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:.5s}
.gal-m:hover img{transform:scale(1.06)}
.gal-m figcaption{position:absolute;left:0;right:0;bottom:0;padding:34px 16px 12px;background:linear-gradient(transparent,rgba(0,0,0,.74));color:#fff;font-size:.8rem;opacity:0;transform:translateY(8px);transition:.3s}
.gal-m:hover figcaption{opacity:1;transform:none}
.gal-m figcaption small{opacity:.75}
.gal-m.mos-1{grid-column:span 2;grid-row:span 2}
.gal-m.mos-2{grid-row:span 2}
.gal-m.mos-6{grid-column:span 2}
@media (max-width:800px){.gal-mosaic{grid-auto-rows:110px}.gal-m.mos-1{grid-column:span 2;grid-row:span 1}.gal-m.mos-2{grid-row:span 1}}
/* about: floating chips */
.about-float{position:relative}
.about-float img{border-radius:26px}
.about-float::after{content:'';position:absolute;inset:18px -18px -18px 18px;border:2px solid var(--primary);border-radius:30px;opacity:.35;z-index:0;pointer-events:none}
.about-float img{position:relative;z-index:1}
.float-chip{position:absolute;z-index:2;background:color-mix(in srgb,var(--surface) 82%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid color-mix(in srgb,var(--text) 14%,transparent);border-radius:14px;padding:10px 16px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:2px;animation:floaty 5.5s ease-in-out infinite}
.float-chip strong{font-size:.88rem}
.float-chip span{font-size:.7rem;color:var(--muted)}
.float-chip.fc-1{top:-18px;left:-14px}
.float-chip.fc-2{bottom:-16px;right:-10px;animation-delay:1.4s}
@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
/* cta: gradient splash */
.cta-splash{position:relative;background:var(--grad);border-radius:32px;padding:84px 44px;text-align:center;color:#fff;overflow:hidden}
.cta-splash h2{font-size:clamp(1.9rem,4.5vw,3rem);position:relative;z-index:1;margin-bottom:12px}
.cta-splash p{opacity:.92;max-width:520px;margin:0 auto 28px;position:relative;z-index:1}
.cta-splash .btn.solid{background:#fff;color:#111;position:relative;z-index:1}
.splash-blob{position:absolute;border-radius:50%;background:rgba(255,255,255,.16);filter:blur(46px);animation:blob-drift 11s ease-in-out infinite}
.splash-blob.sb-1{width:240px;height:240px;top:-90px;left:-70px}
.splash-blob.sb-2{width:200px;height:200px;bottom:-80px;right:-60px;animation-delay:2.6s}
.splash-blob.sb-3{width:130px;height:130px;top:40%;right:16%;animation-delay:5.2s}
@keyframes blob-drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(26px,-22px) scale(1.12)}}
/* logos marquee */
.logos-marquee{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent);mask-image:linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)}
.logos-track{display:flex;gap:64px;align-items:center;width:max-content;animation:marquee 28s linear infinite}
.logos-marquee:hover .logos-track{animation-play-state:paused}
@keyframes marquee{to{transform:translateX(-50%)}}
.logo-mark{font-size:1.3rem;font-weight:800;color:var(--muted);opacity:.72;white-space:nowrap;letter-spacing:-.01em;transition:.2s;display:inline-flex;align-items:center;gap:8px}
.logo-mark:hover{opacity:1;color:var(--text)}
/* video embed */
.video-wrap{position:relative;padding-top:56.25%;border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);background:var(--surface)}
.video-wrap iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
/* countdown */
.countdown{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
.cd-cell{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:var(--radius);padding:22px 30px;min-width:112px;text-align:center;box-shadow:var(--shadow)}
.cd-num{display:block;font-size:2.4rem;font-weight:800;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;font-variant-numeric:tabular-nums}
.cd-cell small{color:var(--muted);letter-spacing:.12em;text-transform:uppercase;font-size:.7rem;font-weight:700}
/* map embed */
.map-wrap{position:relative;border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow)}
.map-wrap iframe{width:100%;height:420px;border:0;display:block}
/* weather */
.weather-box{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:var(--radius);padding:22px;box-shadow:var(--shadow)}
.w-now{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.w-now .w-emoji{font-size:2rem}
.w-now b{font-size:1.6rem}
.w-now .w-city{color:var(--muted);font-size:.9rem;margin-left:auto}
.w-days{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.w-day{display:flex;flex-direction:column;align-items:center;gap:4px;background:var(--surface2);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:10px;padding:10px 6px;font-size:.8rem;text-align:center}
.w-day b{color:var(--muted);font-weight:600}
.w-emoji{font-size:1.25rem}
.weather-loading{color:var(--muted)}
/* generic embed */
.embed-wrap iframe{width:100%;height:460px;border:0;border-radius:var(--radius);box-shadow:var(--shadow)}
/* dedicated booking */
.booking-panel{display:grid;grid-template-columns:minmax(190px,.72fr) minmax(0,1.65fr);gap:22px;align-items:stretch}
.booking-copy{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 9%,transparent);border-radius:var(--radius);padding:28px;box-shadow:var(--shadow);display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:18px}
.booking-copy p{color:var(--muted);margin:0;line-height:1.7}
.booking-meta{display:flex;flex-wrap:wrap;gap:8px;color:var(--muted);font-size:.8rem}
.booking-meta span{border:1px solid color-mix(in srgb,var(--text) 10%,transparent);border-radius:99px;padding:7px 10px;background:color-mix(in srgb,var(--text) 4%,transparent)}
.booking-cta{white-space:nowrap}
.booking-frame{min-width:0;background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 9%,transparent);border-radius:var(--radius);padding:10px;box-shadow:var(--shadow)}
.booking-frame iframe{display:block;width:100%;height:620px;border:0;border-radius:calc(var(--radius) - 6px);background:var(--bg)}
.booking-fallback{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:10px 4px 2px;color:var(--muted);font-size:.78rem}
.booking-setup{background:var(--surface);border:1px dashed color-mix(in srgb,var(--primary) 45%,var(--text));border-radius:var(--radius);padding:36px;text-align:center;color:var(--muted);box-shadow:var(--shadow)}
.booking-setup strong{display:block;color:var(--text);font-size:1.05rem;margin-bottom:6px}
.booking-setup p{margin:0}
.booking-compact .booking-panel{grid-template-columns:1fr}
.booking-compact .booking-copy{display:grid;grid-template-columns:1fr auto;align-items:center}
.booking-compact .booking-copy p{max-width:680px}
.booking-compact .booking-frame iframe{height:500px}
@media(max-width:820px){.booking-panel{grid-template-columns:1fr}.booking-copy{padding:22px}.booking-compact .booking-copy{display:flex;align-items:flex-start}}
@media(max-width:640px){.map-wrap iframe{height:300px}.embed-wrap iframe{height:340px}.w-days{grid-template-columns:repeat(2,1fr)}.booking-frame iframe{height:470px}.booking-compact .booking-frame iframe{height:420px}.booking-fallback{align-items:flex-start;flex-direction:column}}

/* section emblem */
.sec-emblem{width:56px;height:56px;object-fit:contain;margin-bottom:14px}
/* cookie banner */
.cookie-banner{position:fixed;left:20px;bottom:20px;z-index:110;background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 14%,transparent);border-radius:16px;padding:16px 18px;display:flex;gap:14px;align-items:center;max-width:380px;box-shadow:var(--shadow);font-size:.88rem}
.cookie-banner .btn{flex-shrink:0}
@media(max-width:860px){.cookie-banner{left:12px;right:12px;max-width:none;flex-wrap:wrap}}
/* footer */
.footer{margin-top:40px;border-top:1px solid color-mix(in srgb,var(--text) 10%,transparent);padding:56px 0 0;background:color-mix(in srgb,var(--surface) 55%,var(--bg))}
.foot-grid{display:grid;grid-template-columns:2fr 1fr 1fr;gap:32px;padding-bottom:40px}
.foot-grid p{color:var(--muted);font-size:.92rem;margin-top:8px}
.foot-grid strong{display:block;margin-bottom:8px}
.socials,.social{display:inline-block;margin:14px 8px 0 0;width:38px;height:38px;border-radius:10px;background:color-mix(in srgb,var(--text) 8%,transparent);display:grid;place-items:center;font-size:.85rem;font-weight:700}
.foot-end{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:20px 24px;border-top:1px solid color-mix(in srgb,var(--text) 8%,transparent);color:var(--muted);font-size:.85rem;flex-wrap:wrap}
.foot-credits{border-top:1px solid color-mix(in srgb,var(--text) 6%,transparent);padding:16px 24px;color:var(--muted);font-size:.76rem;line-height:1.9}
.foot-credits b{color:var(--text);font-weight:700;margin-right:8px}
.foot-credits a{color:var(--muted);text-decoration:underline;text-decoration-color:color-mix(in srgb,var(--text) 28%,transparent);text-underline-offset:2px}
.foot-credits a:hover{color:var(--primary)}
.made-by a{color:var(--primary);font-weight:600}
.pallettai-badge{position:fixed;right:16px;bottom:16px;z-index:70;background:rgba(12,13,28,.85);color:#cfc6ff;border:1px solid rgba(124,92,255,.45);backdrop-filter:blur(8px);padding:8px 14px;border-radius:99px;font-size:.72rem;font-weight:700;letter-spacing:.03em;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.35);transition:.2s}
.pallettai-badge:hover{border-color:var(--primary);color:#fff}
@media(max-width:520px){.pallettai-badge{font-size:.62rem;padding:6px 10px}}
/* toast + back-to-top + progress */
.toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%) translateY(120px);background:var(--surface);color:var(--text);padding:13px 22px;border-radius:99px;box-shadow:var(--shadow);border:1px solid color-mix(in srgb,var(--text) 12%,transparent);z-index:120;transition:.4s;font-weight:600;font-size:.92rem}
.toast.show{transform:translateX(-50%) translateY(0)}
.toast.ok{border-color:var(--accent)}
.backtop{position:fixed;right:22px;bottom:22px;width:44px;height:44px;border-radius:12px;background:var(--grad);color:#fff;border:none;cursor:pointer;opacity:0;pointer-events:none;transition:.3s;font-size:1.1rem;z-index:80}
.backtop.show{opacity:1;pointer-events:auto}
.progress{position:fixed;top:0;left:0;height:3px;background:var(--grad);z-index:60;width:0}
/* --- layout catalog v2 variants --- */
/* hero: aurora mesh */
.sec-hero.layout-aurora{min-height:92vh;padding:150px 0 90px;background:color-mix(in srgb,var(--bg) 92%,#05060f)}
.aurora-blob{position:absolute;border-radius:50%;filter:blur(110px);opacity:.5;z-index:1}
.aurora-blob.ab-1{width:540px;height:540px;background:var(--primary);top:-170px;left:-150px;animation:drift 16s ease-in-out infinite alternate}
.aurora-blob.ab-2{width:470px;height:470px;background:var(--accent);bottom:-150px;right:-130px;animation:drift 20s ease-in-out infinite alternate-reverse}
.aurora-blob.ab-3{width:380px;height:380px;background:#ec4899;top:38%;left:58%;opacity:.28;animation:drift 26s ease-in-out infinite alternate}
/* features: strip */
.strip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0}
.strip-col{padding:10px 30px;border-right:1px solid color-mix(in srgb,var(--text) 10%,transparent)}
.strip-col:last-child{border-right:none}
.strip-icon{font-size:1.5rem;margin-bottom:12px}
.strip-col h3{font-size:1.05rem;margin-bottom:6px}
.strip-col p{color:var(--muted);font-size:.93rem}
@media(max-width:860px){.strip-col{border-right:none;border-bottom:1px solid color-mix(in srgb,var(--text) 10%,transparent);padding:20px 4px}.strip-col:last-child{border-bottom:none}}
/* stats: ticker */
.stats-ticker{overflow:hidden;border-block:1px solid color-mix(in srgb,var(--text) 10%,transparent);padding:26px 0;position:relative}
.stats-ticker::before,.stats-ticker::after{content:'';position:absolute;top:0;bottom:0;width:80px;z-index:2;pointer-events:none}
.stats-ticker::before{left:0;background:linear-gradient(90deg,var(--bg),transparent)}
.stats-ticker::after{right:0;background:linear-gradient(-90deg,var(--bg),transparent)}
.tk-track{display:flex;gap:64px;width:max-content;animation:tk-scroll 28s linear infinite}
.tk-stat{display:flex;align-items:baseline;gap:10px;white-space:nowrap}
.tk-stat b{font-size:clamp(1.6rem,4vw,2.4rem);font-weight:800;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.tk-stat i{color:var(--muted);font-style:normal;font-weight:600}
@keyframes tk-scroll{to{transform:translateX(-50%)}}
/* pricing: monthly/yearly toggle */
.pt-toggle{display:inline-flex;gap:4px;background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 12%,transparent);padding:4px;border-radius:99px;margin:0 0 34px;box-shadow:var(--shadow)}
.pt-btn{border:none;background:none;font-family:var(--font);font-weight:700;font-size:.9rem;color:var(--muted);padding:9px 20px;border-radius:99px;cursor:pointer;transition:.2s}
.pt-btn em{font-style:normal;font-size:.72rem;opacity:.8;margin-left:2px}
.pt-btn.active{background:var(--grad);color:#fff}
/* testimonials: featured + stack */
.t-feat-grid{display:grid;grid-template-columns:1.3fr 1fr;gap:24px;align-items:stretch}
.t-featured{background:var(--grad);border-radius:var(--radius);padding:42px;color:#fff;position:relative;display:flex;flex-direction:column;justify-content:center;box-shadow:var(--shadow)}
.t-featured .quote-mark{color:rgba(255,255,255,.35)}
.t-featured p{font-size:1.25rem;font-style:italic;color:#fff;margin-bottom:26px}
.t-featured .quote-who img{border:2px solid rgba(255,255,255,.6)}
.t-featured .quote-who small{color:rgba(255,255,255,.85)}
.t-stack{display:grid;gap:16px;align-content:center}
.t-stack-item{padding:22px}
@media(max-width:900px){.t-feat-grid{grid-template-columns:1fr}}
/* about: timeline */
.tl-wrap{position:relative;max-width:760px;margin:0 auto}
.tl-wrap::before{content:'';position:absolute;left:7px;top:8px;bottom:8px;width:2px;background:linear-gradient(var(--primary),var(--accent));opacity:.45}
.tl-item{display:grid;grid-template-columns:16px 1fr;gap:22px;padding-bottom:34px}
.tl-item:last-child{padding-bottom:0}
.tl-dot{width:16px;height:16px;border-radius:50%;background:var(--surface);border:3px solid var(--primary);box-shadow:0 0 0 4px color-mix(in srgb,var(--primary) 25%,transparent);margin-top:4px}
.tl-body h3{font-size:1.15rem;margin-bottom:6px}
.tl-body p{color:var(--muted)}
/* faq: two columns */
.faq-cols{max-width:1080px;grid-template-columns:1fr 1fr;gap:14px 20px;align-items:start}
@media(max-width:760px){.faq-cols{grid-template-columns:1fr}}
/* logos: static grid */
.logos-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}
.logos-grid .logo-mark{width:100%;justify-content:center;border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:14px;padding:20px 10px;opacity:.75;white-space:nowrap;font-size:1.05rem}
.logos-grid .logo-mark:hover{opacity:1}
/* contact: gradient info panel */
.contact-grid.c-split .c-panel{background:var(--grad);border-radius:var(--radius);padding:38px;color:#fff;box-shadow:var(--shadow)}
.contact-grid.c-split .c-panel .eyebrow{color:rgba(255,255,255,.85)}
.contact-grid.c-split .c-panel .sub{color:rgba(255,255,255,.8)}
.contact-grid.c-split .c-panel .contact-list a{color:#fff;text-decoration:underline;text-underline-offset:3px}
.contact-grid.c-split .contact-form{box-shadow:var(--shadow)}
/* cta: email capture */
.cta-email{display:flex;align-items:center;justify-content:space-between;gap:28px;text-align:left;flex-wrap:wrap}
.cta-email .nl-form input{background:rgba(255,255,255,.92);color:#111}
/* blog: featured post */
.post-featured{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:center;margin-bottom:26px}
.post-featured h3{font-size:1.5rem;margin-bottom:8px}
.post-featured p{margin-bottom:0}
@media(max-width:720px){.post-featured{grid-template-columns:1fr}}
/* video: cinema */
.video-full{border-radius:6px}
.video-full iframe{filter:saturate(1.05)}
/* countdown: launch panel */
.countdown-panel{background:var(--grad);border-radius:28px;padding:46px 26px;box-shadow:0 24px 60px color-mix(in srgb,var(--primary) 30%,transparent)}
.cd-panel .cd-cell{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);box-shadow:none}
.cd-panel .cd-num{background:none;color:#fff;-webkit-background-clip:initial;background-clip:initial}
.cd-panel small{color:rgba(255,255,255,.85)}
/* --- live data widgets (keyless) --- */
.crypto-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:18px}
.crypto-card{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:var(--radius);padding:22px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:6px}
.cr-loading{color:var(--muted);font-size:.9rem}
.cr-name{display:flex;align-items:center;justify-content:space-between;gap:10px}
.cr-price{font-size:1.55rem;font-weight:800;font-variant-numeric:tabular-nums}
.cr-up{color:#10b981;font-weight:700;font-size:.82rem}
.cr-down{color:#ef4444;font-weight:700;font-size:.82rem}
.github-box{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:var(--radius);padding:28px;box-shadow:var(--shadow);display:grid;gap:20px}
.gh-head{display:flex;gap:16px;align-items:center}
.gh-head img{width:64px;height:64px;border-radius:50%;border:2px solid color-mix(in srgb,var(--primary) 45%,transparent)}
.gh-head small{color:var(--muted)}
.gh-stats{display:flex;gap:12px;flex-wrap:wrap}
.gh-stat{background:color-mix(in srgb,var(--primary) 12%,transparent);border-radius:12px;padding:10px 18px}
.gh-stat b{display:block;font-size:1.25rem}
.gh-stat small{color:var(--muted)}
.gh-repos{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.gh-repo{display:flex;flex-direction:column;gap:4px;background:color-mix(in srgb,var(--text) 5%,transparent);border:1px solid color-mix(in srgb,var(--text) 10%,transparent);border-radius:12px;padding:14px 16px}
.gh-repo b{font-size:.98rem}
.gh-repo small{color:var(--muted)}
.gh-repo .gh-star{font-size:.82rem;color:var(--accent);font-weight:700}
.fx-box{background:var(--surface);border:1px solid color-mix(in srgb,var(--text) 8%,transparent);border-radius:var(--radius);padding:26px;box-shadow:var(--shadow)}
.fx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.fx-rate{background:color-mix(in srgb,var(--text) 5%,transparent);border-radius:12px;padding:16px 12px;text-align:center}
.fx-flag{font-size:1.4rem}
.fx-rate b{display:block;font-size:1.02rem;margin-top:6px;font-variant-numeric:tabular-nums}
.fx-rate small{color:var(--muted)}
/* responsive */
@media(max-width:860px){
  .nav-links{position:fixed;top:68px;left:0;right:0;background:var(--bg);flex-direction:column;padding:20px 24px;gap:16px;display:none;border-bottom:1px solid color-mix(in srgb,var(--text) 8%,transparent)}
  .nav-links.open{display:flex}
  .burger{display:flex}
  .section{padding:70px 0}
  .about-grid,.contact-grid{grid-template-columns:1fr;gap:32px}
  .gallery,.masonry-wrap{grid-template-columns:1fr 1fr;columns:2}
  .foot-grid{grid-template-columns:1fr}
  .newsletter{flex-direction:column;align-items:flex-start}
  .hero-split{grid-template-columns:1fr;gap:32px}
  .sec-hero.layout-split{text-align:center}
  .hero-split .hero-desc{margin-left:auto;margin-right:auto}
}
@media(max-width:520px){
  .gallery,.masonry-wrap{grid-template-columns:1fr;columns:1}
  .hero-cta{flex-direction:column;align-items:center}
  .btn{width:100%;text-align:center}
}
@media(prefers-reduced-motion:reduce){
  *{animation:none !important;transition:none !important}
  .reveal{opacity:1 !important;transform:none !important}
  html{scroll-behavior:auto}
}` + photoGradeCSS(p);
  };

  // ---------------- generated site JS (stringified, runs in the page) ----------------
  function siteScript() {
    /* runs inside the generated page; CFG injected before this script */
    const CFG = window.__CFG__ || {};
    const $ = (sel, root) => (root || document).querySelector(sel);
    // All generated-site network calls use one bounded request path so a
    // third-party service cannot leave a form or widget waiting forever.
    function request(url, init, ms) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timer = null;
      const requestInit = Object.assign({}, init || {});
      if (controller) {
        requestInit.signal = controller.signal;
        timer = setTimeout(() => controller.abort(), ms || 9000);
      }
      return fetch(url, requestInit).then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res;
      }).finally(() => { if (timer) clearTimeout(timer); });
    }
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

    // mobile nav
    const burger = $('.burger'), links = $('.nav-links');
    if (burger) burger.addEventListener('click', () => links.classList.toggle('open'));

    // client dark/light theme toggle
    const themeBtn = $('.theme-btn');
    if (themeBtn) {
      const KEY = 'pallettai_theme_' + (CFG.projectName || 'site');
      const apply = (mode) => {
        document.body.classList.toggle('theme-light', mode === 'light');
        document.body.classList.toggle('theme-dark', mode === 'dark');
        themeBtn.textContent = mode === 'light' ? '☀️' : '🌙';
        themeBtn.setAttribute('aria-label', 'Switch to ' + (mode === 'light' ? 'dark' : 'light') + ' theme');
      };
      let saved = null;
      try { saved = localStorage.getItem(KEY); } catch (err) { saved = null; }
      apply(saved || (CFG.darkSite ? 'dark' : 'light'));
      themeBtn.addEventListener('click', () => {
        const next = document.body.classList.contains('theme-light') ? 'dark' : 'light';
        try { localStorage.setItem(KEY, next); } catch (err) {}
        apply(next);
      });
    }

    // cookie banner
    if (CFG.cookieBanner) {
      let accepted = null;
      try { accepted = localStorage.getItem('pallettai_cookies_ok'); } catch (err) { accepted = null; }
      if (!accepted) {
        const b = document.createElement('div');
        b.className = 'cookie-banner';
        b.innerHTML = '<span>🍪 This site uses cookies to improve your experience.</span>';
        const ok = document.createElement('button');
        ok.className = 'btn solid small'; ok.textContent = 'Accept';
        ok.addEventListener('click', () => { try { localStorage.setItem('pallettai_cookies_ok', '1'); } catch (err) {} b.remove(); });
        b.appendChild(ok);
        document.body.appendChild(b);
      }
    }

    // scroll reveal + counters
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const el = e.target;
        el.classList.add('in');
        // clear the inline pre-animation state so the .in class can win
        el.style.removeProperty('opacity');
        el.style.removeProperty('transform');
        $$('.stat-num', el).forEach(count);
        io.unobserve(el);
      });
    }, { threshold: 0.15 });
    $$('.reveal').forEach((el) => {
      const css = el.getAttribute('data-anim-css') || '';
      if (css) { const parts = css.split(';').filter(Boolean); parts.forEach((p) => { const [k, v] = p.split(':'); el.style[k.trim()] = (v || '').trim(); }); }
      io.observe(el);
    });

    function count(el) {
      const target = parseFloat(el.dataset.count || '0');
      const suffix = el.dataset.suffix || '';
      const dur = 1400, t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - k, 3);
        const val = Math.round(target * eased);
        el.textContent = (Number.isInteger(target) ? val : (target * eased).toFixed(1)) + suffix;
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    // pro animations: scroll progress + hero parallax + back-to-top
    const prog = document.createElement('div');
    prog.className = 'progress';
    document.body.appendChild(prog);
    const heroBg = $('.hero-bg');
    const backTop = document.createElement('button');
    backTop.className = 'backtop'; backTop.textContent = '↑'; backTop.setAttribute('aria-label', 'Back to top');
    document.body.appendChild(backTop);
    addEventListener('scroll', () => {
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      prog.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
      backTop.classList.toggle('show', h.scrollTop > 600);
      if (heroBg && CFG.proAnimations) heroBg.style.transform = 'scale(1.06) translateY(' + Math.min(0, h.scrollTop * 0.25) + 'px)';
    }, { passive: true });
    backTop.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

    // countdown timer
    const cd = $('.countdown');
    if (cd) {
      const target = new Date(cd.dataset.target || '').getTime();
      const set = (unit, v) => { const el = $('[data-unit="' + unit + '"]', cd); if (el) el.textContent = String(v).padStart(2, '0'); };
      const tick = () => {
        const diff = Math.max(0, target - Date.now());
        set('d', Math.floor(diff / 864e5));
        set('h', Math.floor(diff % 864e5 / 36e5));
        set('m', Math.floor(diff % 36e5 / 6e4));
        set('s', Math.floor(diff % 6e4 / 1e3));
      };
      if (!isNaN(target)) { tick(); setInterval(tick, 1000); }
    }

    // accordion is native <details> — nothing needed

    // pricing monthly/yearly toggle
    const pt = $('.pt-toggle');
    if (pt) {
      const set = (mode) => {
        $$('.pt-btn', pt).forEach((b) => b.classList.toggle('active', b.dataset.pt === mode));
        $$('.pt-amt').forEach((el) => { el.textContent = el.dataset[mode] || el.textContent; });
      };
      $$('.pt-btn', pt).forEach((b) => b.addEventListener('click', () => set(b.dataset.pt)));
    }

    // toast helper
    let toastTimer;
    function toast(msg, ok) {
      let t = $('.toast');
      if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
      t.textContent = msg; t.classList.toggle('ok', !!ok); t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
    }

    // form delivery — real third-party endpoint (Formspree/Web3Forms/…) or demo
    const FD = CFG.forms || { mode: 'demo' };
    async function deliver(form) {
      const label = form.getAttribute('data-form') || 'New message';
      const btn = form.querySelector('[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        let res;
        if (FD.mode === 'formsubmit') {
          const body = new FormData(form);
          body.append('_subject', label + ' — ' + (location.hostname || 'site'));
          body.append('_next', 'https://' + (location.hostname || 'site') + '/thanks');
          res = await request(FD.endpoint, { method: 'POST', body }, 12000);
          return { ok: res.ok || res.status === 200 };
        }
        if (FD.mode === 'web3forms') {
          const body = { access_key: FD.key, subject: label + ' — ' + (location.hostname || 'site') };
          new FormData(form).forEach((v, k) => { body[k] = v; });
          res = await request(FD.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body)
          }, 12000);
          const j = await res.json().catch(() => ({}));
          if (j && j.success) return { ok: true };
          return { ok: false, err: (j && (j.message || j.error)) || 'Delivery failed (HTTP ' + res.status + ').' };
        }
        // Generic JSON-capable endpoint (any HTTPS URL / Formspree AJAX-style).
        // POST the form as JSON so the service can accept structured submissions
        // without depending on multipart / FieldData semantics it may not want.
        res = await request(FD.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form)))
        }, 12000);
        if (res.ok) return { ok: true };
        const j = await res.json().catch(() => ({}));
        const err = j && (j.errors || j.error || j.message);
        return { ok: false, err: (Array.isArray(err) ? err.join(' ') : err) || 'Delivery failed (HTTP ' + res.status + ').' };
      } catch (err) {
        return { ok: false, err: 'Could not reach the form service — check the endpoint and your connection.' };
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    const form = $('[data-contact]');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (FD.mode === 'demo') { form.reset(); toast('Message sent! We’ll reply soon. ✨', true); return; }
      const r = await deliver(form);
      if (r.ok) { form.reset(); toast('Message sent — thanks! We’ll be in touch. ✨', true); }
      else toast(r.err || 'Could not send the message.', false);
    });

    // newsletter (all .nl-form instances — blog & any future ones)
    $$('.nl-form').forEach((nl) => nl.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (FD.mode === 'demo') { nl.reset(); toast('Subscribed! Welcome aboard. 💌', true); return; }
      const r = await deliver(nl);
      if (r.ok) { nl.reset(); toast('Subscribed — check your inbox to confirm. 💌', true); }
      else toast(r.err || 'Could not subscribe you right now.', false);
    }));

    // blog modal
    const modal = $('#postModal');
    if (modal) {
      const open = (btn) => {
        const card = btn.closest('.post');
        $('#postTitle').textContent = $('h3', card).textContent;
        $('#postMeta').textContent = card.dataset.meta || '';
        $('#postBody').textContent = card.dataset.full || '';
        modal.classList.add('open');
      };
      $$('[data-post]').forEach((b) => b.addEventListener('click', () => open(b)));
      $('[data-modal="close"]').addEventListener('click', () => modal.classList.remove('open'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
      addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.remove('open'); });
    }

    // gallery lightbox
    const lb = $('#lightbox');
    if (lb) {
      let idx = 0; const items = $$('.gal-item');
      const show = (i) => {
        idx = (i + items.length) % items.length;
        const it = items[idx];
        $('.lb-stage img').src = $('img', it).src;
        $('.lb-stage figcaption').textContent = (it.dataset.cap || '') + (it.dataset.extra ? ' — ' + it.dataset.extra : '');
        lb.classList.add('open');
      };
      items.forEach((it, i) => it.addEventListener('click', () => show(i)));
      lb.addEventListener('click', (e) => {
        if (e.target.dataset.lb === 'close') lb.classList.remove('open');
        else if (e.target.dataset.lb === 'prev') show(idx - 1);
        else if (e.target.dataset.lb === 'next') show(idx + 1);
        else if (e.target === lb) lb.classList.remove('open');
      });
      addEventListener('keydown', (e) => {
        if (!lb.classList.contains('open')) return;
        if (e.key === 'Escape') lb.classList.remove('open');
        if (e.key === 'ArrowLeft') show(idx - 1);
        if (e.key === 'ArrowRight') show(idx + 1);
      });
    }

    // collections — category chips, live search & sort (faceted, no server)
    $$('.coll[data-coll]').forEach(function (coll) {
      if (coll.classList.contains('coll-static')) return;
      var chips = $$('.coll-chip', coll);
      var items = $$('.coll-item', coll);
      var search = $('.coll-search input', coll);
      var sortSel = $('.coll-sort select', coll);
      var count = $('.coll-count', coll);
      var empty = $('.coll-empty', coll);
      var state = { cat: 'all', q: '' };
      function visible() {
        var n = 0;
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var cat = it.getAttribute('data-cat') || 'all';
          var okCat = state.cat === 'all' || cat === state.cat || cat === 'all';
          var okQ = !state.q || (it.getAttribute('data-search') || '').indexOf(state.q) !== -1;
          it.style.display = okCat && okQ ? '' : 'none';
          if (okCat && okQ) n++;
        }
        if (count) count.textContent = n + ' of ' + items.length + ' shown';
        if (empty) empty.style.display = n ? 'none' : '';
      }
      chips.forEach(function (c) {
        c.addEventListener('click', function () {
          chips.forEach(function (x) { x.classList.toggle('active', x === c); });
          state.cat = c.getAttribute('data-cat') || 'all';
          visible();
        });
      });
      if (search) search.addEventListener('input', function () { state.q = (search.value || '').trim().toLowerCase(); visible(); });
      if (sortSel) sortSel.addEventListener('change', function () {
        var mode = sortSel.value;
        if (!mode || mode === 'none' || !items.length) return;
        var parent = items[0].parentNode;
        items.slice().sort(function (a, b) {
          var x = a.getAttribute('data-name') || '', y = b.getAttribute('data-name') || '';
          return mode === 'az' ? (x < y ? -1 : x > y ? 1 : 0) : (x > y ? -1 : x < y ? 1 : 0);
        }).forEach(function (el) { parent.appendChild(el); });
        visible();
      });
      visible();
    });
    // collection slider arrows
    $$('.coll-prev, .coll-next').forEach(function (b) {
      b.addEventListener('click', function () {
        var host = b.closest('.coll');
        var track = host ? $('.coll-track', host) : null;
        if (!track) return;
        track.scrollBy({ left: (b.classList.contains('coll-next') ? 1 : -1) * Math.max(240, track.clientWidth * 0.7), behavior: 'smooth' });
      });
    });

    // shop cart
    const cart = $('#cart');
    if (cart) {
      const KEY = 'pallettai_cart_' + (CFG.projectName || 'site');
      let items = [];
      try { items = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (err) { items = []; }
      const save = () => localStorage.setItem(KEY, JSON.stringify(items));
      const render = () => {
        const wrap = $('.cart-items', cart);
        const total = items.reduce((s, it) => s + it.qty * parseFloat(String(it.price).replace(/[^0-9.]/g, '') || 0), 0);
        const count = items.reduce((s, it) => s + it.qty, 0);
        const badge = $('.cart-count');
        if (badge) { badge.hidden = count === 0; badge.textContent = count; }
        $('.cart-total', cart).textContent = '£' + total.toFixed(2);
        wrap.innerHTML = items.length ? '' : '<p style="color:var(--muted);text-align:center">Your cart is empty.</p>';
        items.forEach((it, i) => {
          const row = document.createElement('div');
          row.className = 'cart-row';
          row.innerHTML = '<div><strong></strong><br><small></small></div>';
          row.querySelector('strong').textContent = it.name;
          row.querySelector('small').textContent = it.price;
          const q = document.createElement('div'); q.className = 'cart-qty';
          const minus = document.createElement('button'); minus.textContent = '−';
          const plus = document.createElement('button'); plus.textContent = '+';
          const n = document.createElement('span'); n.textContent = it.qty;
          minus.addEventListener('click', () => { it.qty--; if (it.qty <= 0) items.splice(i, 1); save(); render(); });
          plus.addEventListener('click', () => { it.qty++; save(); render(); });
          q.append(minus, n, plus); row.appendChild(q);
          wrap.appendChild(row);
        });
      };
      $$('[data-add]').forEach((b) => b.addEventListener('click', () => {
        const name = b.dataset.name, price = b.dataset.price;
        const found = items.find((it) => it.name === name);
        if (found) found.qty++; else items.push({ name, price, qty: 1 });
        save(); render(); toast(name + ' added to cart 🛒', true);
      }));
      $('[data-cart="open"]').addEventListener('click', () => { render(); cart.classList.add('open'); });
      $('[data-cart="close"]').addEventListener('click', () => cart.classList.remove('open'));
      cart.addEventListener('click', (e) => { if (e.target === cart) cart.classList.remove('open'); });
      $('[data-checkout]').addEventListener('click', () => { items = []; save(); render(); toast('Order placed! (demo checkout) 🎉', true); cart.classList.remove('open'); });
      render();
    }
  }

  // ---------------- full page assembly ----------------
  // Runtime integrations: weather widgets (Open-Meteo, keyless) + live chat (Tawk.to).
  // Injected into every exported/previewed site; only acts when the site uses them.
  function siteIntegrations() {
    var cfg = window.__CFG__ || {};
    // Exported sites run without the Studio, so bound every external request
    // locally and abort slow connections instead of leaving widgets spinning.
    function request(url, init, ms) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = null;
      var requestInit = Object.assign({}, init || {});
      if (controller) {
        requestInit.signal = controller.signal;
        timer = setTimeout(function () { controller.abort(); }, ms || 9000);
      }
      return fetch(url, requestInit).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r;
      }).finally(function () { if (timer) clearTimeout(timer); });
    }
    function json(url, init, ms) { return request(url, init, ms).then(function (r) { return r.json(); }); }
    function escHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function safeHttps(u) {
      try {
        var x = new URL(String(u || ''));
        return x.protocol === 'https:' ? x.href : '';
      } catch (e) { return ''; }
    }
    var emoji = { 0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️', 51: '🌦️', 53: '🌦️', 55: '🌦️', 61: '🌧️', 63: '🌧️', 65: '🌧️', 71: '🌨️', 73: '🌨️', 75: '🌨️', 80: '🌧️', 81: '🌧️', 82: '🌧️', 95: '⛈️', 96: '⛈️', 99: '⛈️' };
    document.querySelectorAll('.weather[data-city]').forEach(function (w) {
      var city = (w.getAttribute('data-city') || '').trim();
      if (!city) return;
      json('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1&language=en', undefined, 7000)
        .then(function (g) {
          var loc = g && g.results && g.results[0];
          if (!loc) throw new Error('no-city');
          return json('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5', undefined, 9000);
        })
        .then(function (f) {
          var cur = f.current || {}, daily = f.daily || {};
          var times = daily.time || [], codes = daily.weather_code || [], mx = daily.temperature_2m_max || [], mn = daily.temperature_2m_min || [];
          var rows = times.slice(0, 5).map(function (t, j) {
            return '<div class="w-day"><b>' + new Date(t + 'T00:00:00').toLocaleDateString([], { weekday: 'short' }) + '</b><span class="w-emoji">' + (emoji[codes[j]] || '🌡️') + '</span><span>' + Math.round(mx[j]) + '° / ' + Math.round(mn[j]) + '°</span></div>';
          }).join('');
          w.innerHTML = '<div class="w-now"><span class="w-emoji">' + (emoji[cur.weather_code] || '🌡️') + '</span><b>' + Math.round(cur.temperature_2m) + '°C</b><span class="w-city">' + escHtml(city) + '</span></div><div class="w-days">' + rows + '</div>';
        })
        .catch(function () {
          w.innerHTML = '<span class="sub">Weather unavailable — check the city name.</span>';
        });
    });
    // live crypto prices (CoinGecko — free, keyless)
    var cryptoWidgets = document.querySelectorAll('.crypto[data-coins]');
    function loadCrypto(w) {
      var ids = (w.getAttribute('data-coins') || '').trim();
      if (!ids) return;
      json('https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(ids) + '&vs_currencies=gbp&include_24hr_change=true&precision=2', undefined, 9000)
        .then(function (d) {
          var names = { bitcoin: '₿ Bitcoin', ethereum: 'Ξ Ethereum', solana: '◎ Solana', cardano: '₳ Cardano', ripple: '✕ XRP', dogecoin: 'Ð Dogecoin', polkadot: '● Polkadot', litecoin: 'Ł Litecoin', chainlink: '🔗 Chainlink', avalanche: '▲ Avalanche' };
          w.querySelectorAll('.crypto-card').forEach(function (card) {
            var id = card.getAttribute('data-id');
            var c = d[id] || {};
            if (c.gbp == null) { card.innerHTML = '<b>' + (names[id] || id) + '</b><span class="sub">unavailable</span>'; return; }
            var up = (c.gbp_24h_change || 0) >= 0;
            card.innerHTML = '<div class="cr-name"><b>' + (names[id] || id) + '</b><span class="' + (up ? 'cr-up' : 'cr-down') + '">' + (up ? '▲' : '▼') + ' ' + Math.abs(c.gbp_24h_change || 0).toFixed(1) + '%</span></div><div class="cr-price">£' + Number(c.gbp).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</div>';
          });
        })
        .catch(function () {
          w.innerHTML = '<span class="sub">Crypto prices unavailable right now.</span>';
        });
    }
    cryptoWidgets.forEach(loadCrypto);
    if (cfg.widgetRefresh > 0) setInterval(function () { cryptoWidgets.forEach(loadCrypto); }, cfg.widgetRefresh * 1000);
    // GitHub profile stats (public API — keyless, 60 req/hr per IP)
    document.querySelectorAll('.github[data-user]').forEach(function (w) {
      var user = (w.getAttribute('data-user') || '').trim();
      if (!user) return;
      var out = w.querySelector('.github-box');
      Promise.all([
        json('https://api.github.com/users/' + encodeURIComponent(user), undefined, 9000),
        json('https://api.github.com/users/' + encodeURIComponent(user) + '/repos?per_page=5&sort=updated', undefined, 9000).catch(function () { return []; })
      ]).then(function (a) {
        var u = a[0], repos = a[1] || [];
        var avatar = safeHttps(u.avatar_url);
        out.innerHTML =
          '<div class="gh-head">' + (avatar ? '<img src="' + escHtml(avatar) + '" alt="">' : '') + '<div><b>' + escHtml(u.name || u.login) + '</b><br><small>' + escHtml(u.bio || '') + '</small></div></div>' +
          '<div class="gh-stats"><span class="gh-stat"><b>' + escHtml(u.public_repos || 0) + '</b><small>repos</small></span><span class="gh-stat"><b>' + escHtml(u.followers || 0) + '</b><small>followers</small></span><span class="gh-stat"><b>' + escHtml(u.following || 0) + '</b><small>following</small></span></div>' +
          (repos.length ? '<div class="gh-repos">' + repos.map(function (r) { return '<div class="gh-repo"><span class="gh-star">★ ' + escHtml(r.stargazers_count || 0) + '</span><b>' + escHtml(r.name) + '</b><small>' + escHtml(r.description || r.language || '') + '</small></div>'; }).join('') + '</div>' : '');
      }).catch(function () {
        out.innerHTML = '<span class="sub">GitHub profile unavailable — check the username.</span>';
      });
    });
    // FX rates (ECB via Frankfurter — free, keyless)
    var fxWidgets = document.querySelectorAll('.fx[data-base]');
    function loadFx(w) {
      var base = (w.getAttribute('data-base') || 'GBP').trim().toUpperCase();
      var out = w.querySelector('.fx-box');
      json('https://api.frankfurter.app/latest?from=' + encodeURIComponent(base) + '&to=EUR,USD,GBP,JPY,CHF,CAD,AUD', undefined, 9000)
        .then(function (d) {
          var flags = { EUR: '🇪🇺', USD: '🇺🇸', GBP: '🇬🇧', JPY: '🇯🇵', CHF: '🇨🇭', CAD: '🇨🇦', AUD: '🇦🇺' };
          var rates = Object.keys(d.rates || {}).map(function (code) {
            return '<div class="fx-rate"><span class="fx-flag">' + (flags[code] || '💱') + '</span><b>1 ' + base + ' = ' + Number(d.rates[code]).toFixed(2) + ' ' + code + '</b><small>' + (d.date || '') + '</small></div>';
          }).join('');
          out.innerHTML = '<div class="fx-grid">' + rates + '</div>';
        })
        .catch(function () {
          out.innerHTML = '<span class="sub">Rates unavailable — check the base currency code.</span>';
        });
    }
    fxWidgets.forEach(loadFx);
    if (cfg.widgetRefresh > 0) setInterval(function () { fxWidgets.forEach(loadFx); }, cfg.widgetRefresh * 1000);
    var tw = cfg.chat;
    if (tw && tw.id) {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://embed.tawk.to/' + tw.id + '/default';
      document.body.appendChild(s);
    }
  }

  // ---------------- structured data (JSON-LD) ----------------
  // Always-on, schema.org-rich: business type from the designer (auto-detects
  // LocalBusiness when an address/area is set), plus FAQ rich results lifted
  // straight from the site's FAQ sections. Works on any static host.
  const SCHEMA_TYPES = ['WebSite', 'LocalBusiness', 'Restaurant', 'CafeOrCoffeeShop', 'ProfessionalService', 'HealthAndBeautyBusiness', 'SportsActivityLocation', 'TravelAgency', 'RealEstateAgent', 'Event', 'Organization'];
  function ldScript(p, page, metaDesc) {
    const s = p.site || {};
    const graph = [];
    let type = String(s.schemaType || '').trim();
    if (!SCHEMA_TYPES.includes(type)) {
      type = (s.address && String(s.address).trim()) || (s.area && String(s.area).trim()) ? 'LocalBusiness' : 'WebSite';
    }
    const base = String(s.url || '').trim().replace(/\/+$/, '');
    const seg = (pg) => { const sl = String(pg.slug || '').trim() || slugify(pg.name || 'page'); return sl === 'index' ? '' : '/' + sl + '.html'; };
    const socials = (Array.isArray(s.socials) ? s.socials : []).map((x) => (x.url || '')).filter((u) => /^https?:\/\//i.test(u));
    const main = {
      '@type': type,
      name: s.name,
      description: metaDesc || s.tagline || undefined,
      url: (base ? base + (page ? seg(page) : '/') : undefined)
    };
    if (type === 'WebSite') {
      main.publisher = { '@type': 'Organization', name: s.name, url: base || undefined };
      if (socials.length) main.sameAs = socials;
    } else {
      if (s.email) main.email = s.email;
      if (s.phone) main.telephone = s.phone;
      if (s.address) main.address = { '@type': 'PostalAddress', streetAddress: s.address };
      if (s.area) main.areaServed = s.area;
      if (s.logo && /^https?:\/\//i.test(s.logo)) main.logo = { '@type': 'ImageObject', url: s.logo };
      if (socials.length) main.sameAs = socials;
    }
    if (s.ogImage) main.image = s.ogImage;
    if (main.name) graph.push(main);
    // FAQPage rich results from every FAQ section on this page
    const faqs = [];
    (page && Array.isArray(page.sections) ? page.sections : []).forEach((sec) => {
      if (sec.type === 'faq' && Array.isArray(sec.items)) {
        sec.items.forEach((it) => {
          const q = String(it.title || '').trim();
          const a = String(it.text || '').trim();
          if (q && a) faqs.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
        });
      }
    });
    if (faqs.length) graph.push({ '@type': 'FAQPage', mainEntity: faqs });
    if (!graph.length) return '';
    const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
    return `\n    <script type="application/ld+json">${json}</script>`;
  }

  function pageRender(project, settings, targetPage) {
    const pages = normalizePages(project);
    const page = targetPage || pages.find((pg) => pg.id === project.site.activePageId) || pages[0];
    if (!page) return '';
    _ctx = { pages, page };
    try {
      return pageHTML(project, settings, page, pages);
    } finally {
      _ctx = { pages: [], page: null };
    }
  }

  function pageHTML(project, settings, page, pages) {
    const multi = pages.length > 1;
    const p = { ...project, site: { ...project.site, sections: page.sections } };
    const pal = DB.getPalette(p.site.palette);
    const font = siteFont(p.site, p.site.font);
    const dispFont = (p.site.fontDisplay && p.site.fontDisplay !== p.site.font) ? siteFont(p.site, p.site.fontDisplay) : null;
    const metaDesc = p.site.metaDescription || p.site.tagline || '';
    const ogImg = p.site.ogImage ? `<meta property="og:image" content="${esc(p.site.ogImage)}">` : '';
    const favicon = faviconLink(p);
    const liveUrl = String(p.site.url || '').trim().replace(/\/+$/, '');
    const slugSeg = (pg) => { const sl = String(pg.slug || '').trim() || slugify(pg.name || 'page'); return sl === 'index' ? '' : sl + '.html'; };
    const canonical = liveUrl
      ? `<link rel="canonical" href="${esc(liveUrl + '/' + slugSeg(page))}">\n    <meta property="og:url" content="${esc(liveUrl + '/' + slugSeg(page))}">`
      : '';
    const meta = settings.exportMeta !== false ? `
    <meta name="description" content="${esc(metaDesc)}">
    <meta property="og:title" content="${esc(p.site.name || '')}">
    <meta property="og:description" content="${esc(metaDesc)}">
    <meta property="og:type" content="website">
    ${canonical}
    ${ogImg}
    <meta name="theme-color" content="${pal.bg}">` : '';
    const schema = ldScript(p, page, metaDesc);
    const fontFaces = [font, dispFont].filter((x) => x && x.id).map((fo) => `<link href="${esc(ONLINE.fontCssUrl(fo.id))}" rel="stylesheet">`).join('');
    // Self-hosted @font-face for the active body font — exported sites keep their
    // typeface available offline and reduce per-visitor hits to Google's CDN. The
    // Google CSS link stays as the authoritative source; this style is an enhancement
    // that points at the same OFL-allowed woff2 assets on fonts.gstatic.com.
    const selfHostedFontFace = (() => {
      if (settings.onlineEnabled === false || !font || !font.id) return '';
      const param = ONLINE._fontFamilyParam(font.id);
      if (!param) return '';
      const fam = ONLINE.fontCssUrl(font.id);
      if (!fam) return '';
      return `<style>@font-face{font-family:'${esc(font.name)}';src:url('https://fonts.gstatic.com/css2?family=${esc(param)}&display=swap');font-display:swap}</style>`;
    })();
    const fontLink = settings.onlineEnabled !== false
      ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>${fontFaces}${selfHostedFontFace}`
      : '';

    const body = p.site.sections.map((s, i) => {
      const fn = renderers[s.type];
      return fn ? fn(p, s, i) : '';
    }).join('');

    const pal2 = DB.getPalette(p.site.palette);
    const cfg = {
      proAnimations: (p.suites || []).includes('animation'),
      projectName: (p.site.name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      darkSite: pal2.dark === true,
      cookieBanner: settings.cookieBanner === true,
      forms: deliveryFor(p.site),
      chat: p.site.chatWidget || null,
      widgetRefresh: settings.widgetRefreshSec || 0 // seconds between live-widget refetches (0 = never)
    };

    // custom fonts (uploaded by the user, inlined as base64 woff2)
    const customFonts = (Array.isArray(p.site.customFonts) ? p.site.customFonts : [])
      .filter((f) => f && f.name && f.data)
      .map((f) => `@font-face{font-family:'${cssFontName(f.name)}';src:url(data:font/woff2;base64,${f.data}) format('woff2');font-display:swap}`).join('\n');
    const customFontStyle = customFonts ? `<style>${customFonts}</style>` : '';
    // design panel: custom css + js
    const d2 = design(p);
    const cssSafe = (s) => String(s || '').replace(/<\/style/gi, '<\\/style');
    const jsSafe = (s) => String(s || '').replace(/<\/script/gi, '<\\/script');
    const styleCss = d2.styleCss ? `<style>${cssSafe(d2.styleCss)}</style>` : ''; // AI style-pack look (before user CSS so custom CSS wins)
    const customCss = d2.customCss ? `<style>${cssSafe(d2.customCss)}</style>` : '';
    const customJs = d2.customJs ? `<script>${jsSafe(d2.customJs)}<\/script>` : '';

    // analytics
    const analytics = settings.analyticsId
      ? (settings.analyticsProvider === 'plausible'
        ? `<script defer data-domain="${esc(settings.analyticsId)}" src="https://plausible.io/js/script.js"><\/script>`
        : `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(settings.analyticsId)}"><\/script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(settings.analyticsId)}');<\/script>`)
      : '';

    // Security hardening starter: exported sites are fully self-contained (inline
    // CSS/JS, no server), so a strict meta CSP would break the inline scripts the
    // builder itself emits. Instead we leave a commented template the host can turn
    // into real response headers (recommended over meta CSP) once the site is on a
    // server that supports them. This documents the safe baseline without breaking
    // anything at export time.
    const cspStarter = `<!--
    Security hardening (optional): serve these as HTTP response headers from your
    host for a strict baseline. A meta CSP is intentionally NOT emitted because this
    page uses inline scripts/styles, which a strict policy would block.

    Content-Security-Policy: default-src 'self'; img-src * data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline'${settings.analyticsId ? (settings.analyticsProvider === 'plausible' ? ' https://plausible.io' : ' https://www.googletagmanager.com') : ''}; frame-src https://www.google.com https://www.youtube.com https://player.vimeo.com https://coverr.co https://open.spotify.com https://calendly.com; connect-src *;
    X-Content-Type-Options: nosniff
    Referrer-Policy: strict-origin-when-cross-origin
    -->`;

    const lang = String((p.site && p.site.lang) || 'en').toLowerCase().replace(/[^a-z-]/g, '') || 'en';
    const grade = p.site.photoGrade || {};
    const bodyClass = grade.on ? ('photo-grade' + (grade.blend === 'soft-light' ? ' photo-grade-soft' : '')) : '';
    let html = `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${multi ? esc(page.name) + ' — ' + esc(p.site.name || 'My Site') : esc(p.site.name || 'My Site') + (p.site.tagline ? ' — ' + esc(p.site.tagline) : '')}</title>
${favicon}
${meta}${schema}
${fontLink}
${customFontStyle}
${analytics}
<style>${siteCSS(p, settings)}</style>
${styleCss}
${customCss}
${cspStarter}
</head>
<body id="top"${bodyClass ? ' class="' + bodyClass + '"' : ''}>
${buildNav(p)}
<main>
${body}
</main>
${buildFooter(p, settings)}
<script>window.__CFG__=${JSON.stringify(cfg)};(${siteScript.toString()})();</script>
<script>(${siteIntegrations.toString()})();</script>
${customJs}
</body>
</html>`;
    // performance diet: async decoding everywhere + lazy loading below the hero
    // (the split-hero image keeps an eager load; hero backgrounds are CSS).
    html = html.replace(/<img /g, '<img loading="lazy" decoding="async" ');
    html = html.replace(/<img loading="lazy" decoding="async" class="hero-img"/g, '<img decoding="async" class="hero-img"');
    if (settings.minify) {
      html = html.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    }
    return html;
  }

  // ---------------- public page builders ----------------
  function buildSiteHTML(project, settings = {}) {
    return pageRender(project, settings, null);
  }

  // Build every page as a separate standalone HTML file (multi-page export).
  function buildSitePages(project, settings = {}) {
    const pages = normalizePages(project);
    return pages.map((pg) => ({ page: pg, html: pageRender(project, settings, pg) }));
  }

  // robots.txt + sitemap.xml — added to folder / zip / publish exports.
  // robots.txt ships always; sitemap needs the live URL set in the designer.
  function seoExtras(project, settings = {}) {
    const pages = normalizePages(project);
    const base = String((project.site && project.site.url) || '').trim().replace(/\/+$/, '');
    const xml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const files = [{ name: 'robots.txt', content: 'User-agent: *\nAllow: /\n' + (base ? 'Sitemap: ' + base + '/sitemap.xml\n' : '') }];
    if (base) {
      const today = new Date().toISOString().slice(0, 10);
      const seg = (pg) => { const sl = String(pg.slug || '').trim() || slugify(pg.name || 'page'); return sl === 'index' ? '' : sl + '.html'; };
      const urls = pages.map((pg) => `  <url>\n    <loc>${xml(base + '/' + seg(pg))}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join('\n');
      files.push({ name: 'sitemap.xml', content: '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n' });
    }
    return files;
  }

  // ---------------- suite application ----------------
  function applySuite(project, suiteId) {
    const suite = DB.getSuite(suiteId);
    if (!suite || (project.suites || []).includes(suiteId)) return { ok: false, reason: 'already' };
    project.suites.push(suiteId);
    // suite sections land on the Home page (site-wide features); the Home array
    // is aliased to site.sections while Home is the active page, so single-page
    // sites behave exactly as before.
    const pages = normalizePages(project);
    const target = pages.find((pg) => pg.slug === 'index') || pages[0];
    for (const preset of suite.sections) {
      target.sections.push(DB.newSection(preset.type, preset));
    }
    return { ok: true, suite };
  }

  function removeSuite(project, suiteId) {
    const suite = DB.getSuite(suiteId);
    if (!suite) return false;
    project.suites = project.suites.filter((s) => s !== suiteId);
    const types = (suite.sections || []).map((preset) => preset.type);
    const pages = normalizePages(project);
    for (const pg of pages) {
      if (!types.length) continue;
      pg.sections = pg.sections.filter((s) => !types.includes(s.type));
    }
    // keep the alias in place after filtering
    const active = pages.find((pg) => pg.id === project.site.activePageId) || pages[0];
    project.site.sections = active.sections;
    return true;
  }

  return { buildSiteHTML, buildSitePages, seoExtras, applySuite, removeSuite, esc, picsum, pages: pagesOf, slugify, pageHref, safeHref, safeEmbedUrl, safeBookingUrl };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Builder;
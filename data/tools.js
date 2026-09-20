/* PallettAI Studio — practical toolkit
   Local-first, dependency-free utilities for creators and client work. */
(function (root) {
  'use strict';

  var KEY = 'pallettai.toolkit.v1';
  var CHECK_ROWS = [
    ['content', 'Client facts confirmed — names, prices, hours and claims'],
    ['forms', 'Forms tested and recipient confirmed'],
    ['mobile', 'Phone and tablet preview checked'],
    ['access', 'Headings, labels, focus and contrast checked'],
    ['domain', 'Domain, HTTPS and redirects verified'],
    ['backup', 'Export, assets and handoff backup delivered']
  ];
  var GUIDE_DATA = [
    { id:'brief', icon:'✦', title:'Write a brief that generates a better site', tag:'AI Studio', body:'Name the audience, the first action you want, your proof, location, tone and any facts that must not be invented. The more concrete the brief, the less generic the first draft.' },
    { id:'supabase', icon:'◎', title:'Connect Supabase without exposing secrets', tag:'Guides', body:'Use the project URL and publishable anon key only. Never paste a service-role key into Studio, an exported site or a public repository. Turn on Row Level Security before adding tables.' },
    { id:'launch', icon:'↗', title:'Launch a client site safely', tag:'Site Care', body:'Preview every page, test forms, check mobile widths, verify the domain, confirm the privacy notice and send the client a handoff copy before publishing.' },
    { id:'accessibility', icon:'◌', title:'Make a site easier for everyone', tag:'Quality', body:'Use one clear H1, visible focus states, descriptive link text, labelled form fields, useful image descriptions and colour combinations that pass WCAG contrast guidance.' },
    { id:'marketing', icon:'◇', title:'Turn a finished site into a campaign', tag:'Growth', body:'Create one useful landing page, one tracked campaign link and one clear action. Measure clicks before adding more channels. A smaller campaign with a clear promise beats a noisy one.' },
    { id:'handoff', icon:'□', title:'Give clients an independent handoff', tag:'Client care', body:'Deliver the exported files, login instructions for their hosting and forms, a short edit guide, an asset folder and a dated backup. The client should know what they own.' },
    { id:'payments', icon:'£', title:'Keep payment links clear and safe', tag:'Guides', body:'Use one named product per offer, explain whether it is a one-time payment or subscription, and test the success and cancelled return paths before sending a client the link.' },
    { id:'privacy', icon:'⌁', title:'Keep AI work privacy-first', tag:'Quality', body:'Do not paste passwords, private customer records or payment details into a prompt. Use placeholders while drafting and replace them locally with confirmed facts.' }
  ];
  var DEFAULT_HANDOFF = {
    project: '', client: '', site: '', support: '', host: '', launch: '', notes: ''
  };
  var DEFAULT_BRAND = {
    name: 'Your brand', primary: '#7cc0f8', accent: '#9fd4ff', surface: '#08203c',
    bodyFont: 'plex', headingFont: 'space', tone: 'Clear, confident and human'
  };
  var raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  var state = {
    checks: {},
    guides: raw.guides === 'all' ? 'all' : (typeof raw.guides === 'string' ? raw.guides : 'all'),
    handoff: normalizeFields(raw.handoff, DEFAULT_HANDOFF),
    brand: normalizeFields(raw.brand, DEFAULT_BRAND)
  };
  CHECK_ROWS.forEach(function (row) { state.checks[row[0]] = !!(raw.checks && raw.checks[row[0]]); });

  function normalizeFields(source, defaults) {
    var out = {};
    source = source && typeof source === 'object' ? source : {};
    Object.keys(defaults).forEach(function (key) {
      out[key] = typeof source[key] === 'string' ? source[key].slice(0, 500) : defaults[key];
    });
    return out;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ checks: state.checks, guides: state.guides, handoff: state.handoff, brand: state.brand })); } catch (e) {}
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function val(id) { var element = document.getElementById(id); return element ? element.value.trim() : ''; }
  function setResult(id, text, good) {
    var element = document.getElementById(id);
    if (element) { element.textContent = text; element.className = 'tool-result' + (good ? ' good' : ''); }
  }
  function hex(value) {
    var clean = String(value || '').replace('#', '').trim();
    if (/^[0-9a-f]{3}$/i.test(clean)) clean = clean.split('').map(function (c) { return c + c; }).join('');
    return /^[0-9a-f]{6}$/i.test(clean) ? clean : null;
  }
  function safeHex(value, fallback) { return '#' + (hex(value) || hex(fallback) || '08203c'); }
  function luminance(value) {
    var clean = hex(value); if (!clean) return null;
    var rgb = [0, 2, 4].map(function (i) {
      var n = parseInt(clean.slice(i, i + 2), 16) / 255;
      return n <= .03928 ? n / 12.92 : Math.pow((n + .055) / 1.055, 2.4);
    });
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  }
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return x == null || y == null ? null : (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
  }
  function cleanLine(value, fallback) {
    var text = String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    return (text || fallback || '').slice(0, 280);
  }
  function downloadText(filename, text, type) {
    try {
      var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a'); link.href = url; link.download = filename; link.rel = 'noopener';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 500);
      return true;
    } catch (e) { return false; }
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    try {
      var area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', '');
      area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area); area.select();
      var ok = document.execCommand('copy'); area.remove();
      return ok ? Promise.resolve() : Promise.reject(new Error('copy unavailable'));
    } catch (e) { return Promise.reject(e); }
  }

  function pulseData() {
    var done = CHECK_ROWS.filter(function (row) { return state.checks[row[0]]; }).length;
    var percent = Math.round(done / CHECK_ROWS.length * 100);
    return { done: done, total: CHECK_ROWS.length, percent: percent, ready: percent === 100,
      missing: CHECK_ROWS.filter(function (row) { return !state.checks[row[0]]; }).map(function (row) { return row[1]; }) };
  }
  function renderPulse() {
    var p = pulseData();
    var title = p.ready ? 'Ready to hand over' : p.percent >= 67 ? 'Final checks in sight' : 'Build confidence before launch';
    var note = p.ready ? 'Every launch gate is marked complete. Keep the snapshot below with the client handoff.' : p.missing[0] + (p.missing.length > 1 ? ' is the next useful check.' : '.');
    var missing = p.missing.length ? '<ul class="pulse-missing">' + p.missing.slice(0, 3).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + (p.missing.length > 3 ? '<li>+' + (p.missing.length - 3) + ' more</li>' : '') + '</ul>' : '<div class="pulse-complete">✓ Nothing left on the runway</div>';
    return '<div class="pulse-visual" style="--pulse:' + p.percent + '%"><div class="pulse-ring"><strong>' + p.percent + '</strong><span>/100</span></div></div><div class="pulse-copy"><span class="tools-kicker">LAUNCH PULSE</span><h3>' + title + '</h3><p>' + esc(note) + '</p>' + missing + '<button class="btn secondary small" data-pulse-open>Open checklist <span aria-hidden="true">↘</span></button></div>';
  }
  function renderChecklist() {
    var p = pulseData();
    return '<div class="tool-checklist"><div class="tool-progress"><span style="width:' + p.percent + '%"></span></div><div class="tool-progress-label">' + p.done + ' of ' + p.total + ' ready</div>' + CHECK_ROWS.map(function (row) {
      return '<label class="tool-check"><input type="checkbox" data-check="' + row[0] + '" ' + (state.checks[row[0]] ? 'checked' : '') + '><span>' + esc(row[1]) + '</span></label>';
    }).join('') + '</div>';
  }

  function handoffMarkdown() {
    var h = state.handoff;
    var project = cleanLine(h.project, 'Untitled project');
    var client = cleanLine(h.client, 'Client team');
    var checks = CHECK_ROWS.map(function (row) { return '- [' + (state.checks[row[0]] ? 'x' : ' ') + '] ' + row[1]; }).join('\n');
    return '# ' + project + ' — client handoff\n\n' +
      '> Prepared for ' + client + (h.launch ? ' · launch ' + cleanLine(h.launch, '') : '') + '\n\n' +
      '## What is included\n\n- Exported website files\n- Brand and media assets supplied for the project\n- This handoff note and the launch checklist\n\n' +
      '## Site details\n\n- Live site: ' + (cleanLine(h.site, 'Add the live URL') || 'Add the live URL') + '\n- Hosting: ' + (cleanLine(h.host, 'Confirm with the client') || 'Confirm with the client') + '\n- Support: ' + (cleanLine(h.support, 'Add the support contact') || 'Add the support contact') + '\n\n' +
      '## Launch checklist\n\n' + checks + '\n\n' +
      '## Client notes\n\n' + (String(h.notes || '').trim().slice(0, 1200) || 'Add any edit instructions, renewal dates or agreed next steps here.') + '\n\n' +
      '## Ownership\n\nThe exported files are yours to host, edit and back up. Keep a copy of this handoff with the project archive.\n';
  }
  function updateHandoffPreview() {
    var preview = document.getElementById('handoffPreview');
    if (preview) preview.textContent = handoffMarkdown();
  }
  function handoffFilename() {
    var name = cleanLine(state.handoff.project, 'pallettai-handoff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56);
    return (name || 'pallettai-handoff') + '-handoff.md';
  }

  var FONT_OPTIONS = {
    plex: "'IBM Plex Sans', system-ui, sans-serif", space: "'Space Grotesk', system-ui, sans-serif",
    manrope: "'Manrope', system-ui, sans-serif", poppins: "'Poppins', system-ui, sans-serif",
    playfair: "'Playfair Display', Georgia, serif", serif: "'DM Serif Display', Georgia, serif",
    mono: "'IBM Plex Mono', ui-monospace, monospace"
  };
  function fontStack(key) { return FONT_OPTIONS[key] || FONT_OPTIONS.plex; }
  function brandStyle() {
    var b = state.brand;
    return '--brand-primary:' + safeHex(b.primary, DEFAULT_BRAND.primary) + ';--brand-accent:' + safeHex(b.accent, DEFAULT_BRAND.accent) + ';--brand-surface:' + safeHex(b.surface, DEFAULT_BRAND.surface) + ';--brand-body:' + fontStack(b.bodyFont) + ';--brand-heading:' + fontStack(b.headingFont) + ';';
  }
  function brandCss() {
    var b = state.brand;
    return ':root {\n  --brand-primary: ' + safeHex(b.primary, DEFAULT_BRAND.primary) + ';\n  --brand-accent: ' + safeHex(b.accent, DEFAULT_BRAND.accent) + ';\n  --brand-surface: ' + safeHex(b.surface, DEFAULT_BRAND.surface) + ';\n  --brand-body: ' + fontStack(b.bodyFont) + ';\n  --brand-heading: ' + fontStack(b.headingFont) + ';\n}\n\nbody { font-family: var(--brand-body); color: var(--brand-surface); }\nh1, h2, h3 { font-family: var(--brand-heading); color: var(--brand-primary); }\na, .button { color: var(--brand-accent); }';
  }
  function brandFontOptions(selected) {
    return [['plex','IBM Plex Sans'],['space','Space Grotesk'],['manrope','Manrope'],['poppins','Poppins'],['playfair','Playfair Display'],['serif','DM Serif Display'],['mono','IBM Plex Mono']].map(function (item) { return '<option value="' + item[0] + '" ' + (selected === item[0] ? 'selected' : '') + '>' + item[1] + '</option>'; }).join('');
  }
  function renderBrandBoard() {
    var b = state.brand;
    return '<article class="utility-card brand-card"><div class="utility-head"><span class="utility-icon">◈</span><div><h3>Brand snapshot</h3><p>Capture a usable mini style guide before the first edit.</p></div></div><div class="brand-fields"><label>Brand name<input data-brand-field="name" value="' + esc(b.name) + '" maxlength="80"></label><label>Tone of voice<input data-brand-field="tone" value="' + esc(b.tone) + '" maxlength="120"></label><label>Body type<select data-brand-field="bodyFont">' + brandFontOptions(b.bodyFont) + '</select></label><label>Heading type<select data-brand-field="headingFont">' + brandFontOptions(b.headingFont) + '</select></label><label>Primary<input data-brand-field="primary" value="' + esc(b.primary) + '" maxlength="7" inputmode="text"></label><label>Accent<input data-brand-field="accent" value="' + esc(b.accent) + '" maxlength="7" inputmode="text"></label><label>Surface<input data-brand-field="surface" value="' + esc(b.surface) + '" maxlength="7" inputmode="text"></label></div><div class="brand-demo" id="brandDemo" style="' + brandStyle() + '"><span class="brand-demo-kicker">' + esc(b.tone || 'Your tone') + '</span><strong id="brandDemoName">' + esc(b.name || 'Your brand') + '</strong><p>One clear idea, made recognisable.</p><button type="button">Primary action</button><div class="brand-swatches"><i data-brand-swatch="primary"></i><i data-brand-swatch="accent"></i><i data-brand-swatch="surface"></i></div></div><div class="brand-output"><code id="brandCssPreview">' + esc(brandCss()) + '</code><div><button class="btn ghost small" data-tool-action="brand-copy">Copy CSS</button><button class="btn secondary small" data-tool-action="brand-download">Download snapshot</button></div></div></article>';
  }
  function updateBrandPreview() {
    var b = state.brand, demo = document.getElementById('brandDemo');
    if (demo) { demo.style.cssText = brandStyle(); demo.querySelector('.brand-demo-kicker').textContent = b.tone || 'Your tone'; demo.querySelector('#brandDemoName').textContent = b.name || 'Your brand'; }
    var css = document.getElementById('brandCssPreview'); if (css) css.textContent = brandCss();
    ['primary','accent','surface'].forEach(function (key) { var sw = document.querySelector('[data-brand-swatch="' + key + '"]'); if (sw) sw.style.background = safeHex(b[key], DEFAULT_BRAND[key]); });
  }

  function renderGuides(filter) {
    var list = GUIDE_DATA.filter(function (g) { return filter === 'all' || g.tag === filter; });
    return '<div class="guide-filter"><button class="tool-filter ' + (filter === 'all' ? 'active' : '') + '" data-guide-filter="all">All</button>' + ['AI Studio','Guides','Quality','Growth','Client care'].map(function (tag) { return '<button class="tool-filter ' + (filter === tag ? 'active' : '') + '" data-guide-filter="' + esc(tag) + '">' + esc(tag) + '</button>'; }).join('') + '</div><div class="guide-list">' + list.map(function (g) { return '<details class="guide-card"><summary><span class="guide-icon">' + g.icon + '</span><span><b>' + esc(g.title) + '</b><small>' + esc(g.tag) + '</small></span><i>+</i></summary><p>' + esc(g.body) + '</p></details>'; }).join('') + '</div>';
  }

  function render() {
    var root = document.getElementById('toolsRoot'); if (!root) return;
    root.innerHTML = '<div class="tools-hero"><div><span class="tools-kicker">PRACTICAL TOOLKIT · 08 LOCAL TOOLS</span><h2>The quiet advantage behind a great client launch.</h2><p>Plan the work, sharpen the brand, hand it over beautifully. Everything stays on this device until you choose to export it.</p><div class="hero-proof"><span><b>0</b> API keys</span><span><b>1</b> focused workspace</span><span><b>∞</b> better handoffs</span></div></div><div class="tools-orbit" aria-hidden="true"><span>✦</span><i></i><b></b></div></div>' +
      '<section class="command-centre"><div class="command-heading"><div><span class="tools-kicker">CLIENT COMMAND CENTRE</span><h3>From “almost ready” to confidently delivered.</h3></div><span class="command-badge">LOCAL · PRIVATE · USEFUL</span></div><div class="command-grid"><article class="pulse-card">' + renderPulse() + '</article>' +
      '<article class="utility-card handoff-card"><div class="utility-head"><span class="utility-icon">□</span><div><h3>Client handoff studio</h3><p>Generate a polished delivery note in under a minute.</p></div></div><div class="handoff-fields"><label>Project<input data-handoff-field="project" value="' + esc(state.handoff.project) + '" placeholder="Northside Bakery"></label><label>Client<input data-handoff-field="client" value="' + esc(state.handoff.client) + '" placeholder="Ava and the team"></label><label>Live site<input data-handoff-field="site" value="' + esc(state.handoff.site) + '" placeholder="https://…"></label><label>Support contact<input data-handoff-field="support" value="' + esc(state.handoff.support) + '" placeholder="hello@example.com"></label><label>Hosting<input data-handoff-field="host" value="' + esc(state.handoff.host) + '" placeholder="Hosting provider / login note"></label><label>Launch date<input data-handoff-field="launch" type="date" value="' + esc(state.handoff.launch) + '"></label></div><label class="brief-label">Notes for the client<textarea data-handoff-field="notes" rows="3" placeholder="Editing notes, renewal dates, next steps…">' + esc(state.handoff.notes) + '</textarea></label><div class="handoff-actions"><button class="btn primary small" data-tool-action="handoff-copy">Copy handoff</button><button class="btn secondary small" data-tool-action="handoff-download">Download .md</button><span class="handoff-saved" id="handoffSaved">Saved locally</span></div><pre class="handoff-preview" id="handoffPreview" aria-label="Handoff preview"></pre></article>' +
      '<div class="brand-wrap">' + renderBrandBoard() + '</div></div></section>' +
      '<div class="tool-grid"><article class="utility-card"><div class="utility-head"><span class="utility-icon">✓</span><div><h3>Launch runway</h3><p>A calm, repeatable pre-flight checklist.</p></div></div><div id="launchChecklist">' + renderChecklist() + '</div><button class="btn ghost small" data-tool-reset="checks">Reset checklist</button></article>' +
      '<article class="utility-card"><div class="utility-head"><span class="utility-icon">↗</span><div><h3>Campaign link builder</h3><p>Create a clean UTM link for a post or advert.</p></div></div><div class="tool-fields"><label>Destination URL<input id="utmUrl" type="url" placeholder="https://example.com/offer"></label><label>Source<input id="utmSource" placeholder="x, newsletter, instagram"></label><label>Campaign<input id="utmCampaign" placeholder="spring-launch"></label><label>Medium<input id="utmMedium" placeholder="social, email, cpc"></label></div><button class="btn primary small" data-tool-action="utm">Build link</button><output id="utmResult" class="tool-result" aria-live="polite"></output></article>' +
      '<article class="utility-card"><div class="utility-head"><span class="utility-icon">Aa</span><div><h3>Contrast lens</h3><p>Check readable text before it reaches a client.</p></div></div><div class="contrast-fields"><label>Text<input id="contrastText" value="#08203c" maxlength="7"></label><label>Background<input id="contrastBg" value="#eaf5ff" maxlength="7"></label></div><div id="contrastSwatch" class="contrast-swatch">Aa <span>Preview text</span></div><output id="contrastResult" class="tool-result" aria-live="polite">Enter two hex colours.</output></article>' +
      '<article class="utility-card"><div class="utility-head"><span class="utility-icon">£</span><div><h3>Project quote helper</h3><p>Get a transparent starting estimate, not a hidden price.</p></div></div><div class="tool-fields"><label>Build hours<input id="quoteBuild" type="number" min="0" value="12"></label><label>Hourly rate (£)<input id="quoteRate" type="number" min="0" value="35"></label><label>Care / month (£)<input id="quoteCare" type="number" min="0" value="25"></label></div><div class="quote-total" id="quoteTotal">£445 <small>build + first month care</small></div><p class="tool-note">Use it as a conversation starter. Confirm scope before promising a fixed fee.</p></article>' +
      '<article class="utility-card wide-tool"><div class="utility-head"><span class="utility-icon">✦</span><div><h3>Brief distiller</h3><p>Turn a messy client message into five useful inputs for AI Studio.</p></div></div><label class="brief-label">Paste the client’s rough message<textarea id="briefInput" rows="4" placeholder="We need a site for our bakery…"></textarea></label><button class="btn primary small" data-tool-action="distill">Distil brief</button><output id="briefResult" class="tool-result tool-output" aria-live="polite"></output></article></div>' +
      '<section class="guides-panel"><div class="guides-heading"><div><span class="tools-kicker">FIELD NOTES</span><h3>Guides that save you a mistake</h3></div><span class="guide-count">' + GUIDE_DATA.length + ' short guides</span></div><div id="guideRoot">' + renderGuides(state.guides || 'all') + '</div></section>';
    bind(); updateContrast(); updateQuote(); updateBrandPreview(); updateHandoffPreview();
  }
  function updateContrast() {
    var a = val('contrastText'), b = val('contrastBg'), ratio = contrast(a, b), sw = document.getElementById('contrastSwatch');
    if (sw) { sw.style.color = hex(a) ? '#' + hex(a) : 'transparent'; sw.style.background = hex(b) ? '#' + hex(b) : 'transparent'; }
    setResult('contrastResult', ratio == null ? 'Use valid 6 or 3 digit hex colours.' : 'Ratio ' + ratio.toFixed(2) + ':1 · ' + (ratio >= 7 ? 'AAA body text' : ratio >= 4.5 ? 'AA body text' : ratio >= 3 ? 'Large text only' : 'Needs more contrast'), ratio != null && ratio >= 4.5);
  }
  function updateQuote() { var h = Number(val('quoteBuild')) || 0, rate = Number(val('quoteRate')) || 0, care = Number(val('quoteCare')) || 0, e = document.getElementById('quoteTotal'); if (e) e.innerHTML = '£' + (h * rate + care).toFixed(0) + ' <small>build + first month care</small>'; }
  function updateChecklist() { var c = document.getElementById('launchChecklist'); if (c) c.innerHTML = renderChecklist(); var pulse = document.querySelector('.pulse-card'); if (pulse) pulse.innerHTML = renderPulse(); }
  function bind() {
    var root = document.getElementById('toolsRoot'); if (!root || root.dataset.bound) return;
    root.dataset.bound = '1';
    root.addEventListener('input', function (event) {
      var target = event.target;
      if (target.matches('#contrastText,#contrastBg')) updateContrast();
      if (target.matches('#quoteBuild,#quoteRate,#quoteCare')) updateQuote();
      var handoff = target.closest('[data-handoff-field]');
      if (handoff) { state.handoff[handoff.dataset.handoffField] = target.value.slice(0, 1200); save(); updateHandoffPreview(); }
      var brand = target.closest('[data-brand-field]');
      if (brand) { state.brand[brand.dataset.brandField] = target.value.slice(0, 140); save(); updateBrandPreview(); }
    });
    root.addEventListener('change', function (event) {
      var target = event.target;
      if (target.matches('[data-check]')) { state.checks[target.dataset.check] = target.checked; save(); updateChecklist(); }
      var brand = target.closest('[data-brand-field]');
      if (brand) { state.brand[brand.dataset.brandField] = target.value.slice(0, 140); save(); updateBrandPreview(); }
    });
    root.addEventListener('click', function (event) {
      var filter = event.target.closest('[data-guide-filter]');
      if (filter) { state.guides = filter.dataset.guideFilter; save(); var guideRoot = document.getElementById('guideRoot'); if (guideRoot) guideRoot.innerHTML = renderGuides(state.guides); return; }
      var reset = event.target.closest('[data-tool-reset]');
      if (reset) { state.checks = {}; save(); updateChecklist(); return; }
      var open = event.target.closest('[data-pulse-open]');
      if (open) { var checklist = document.getElementById('launchChecklist'); if (checklist) checklist.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      var action = event.target.closest('[data-tool-action]'); if (!action) return;
      var kind = action.dataset.toolAction;
      if (kind === 'utm') {
        var destination = val('utmUrl'), parsed;
        try { parsed = new URL(destination); } catch (e) { parsed = null; }
        if (!parsed || parsed.protocol !== 'https:') { setResult('utmResult', 'Enter a full HTTPS destination URL.'); return; }
        var params = new URLSearchParams({ utm_source: val('utmSource') || 'pallettai', utm_campaign: val('utmCampaign') || 'campaign' });
        if (val('utmMedium')) params.set('utm_medium', val('utmMedium'));
        setResult('utmResult', parsed.href + (parsed.href.indexOf('?') >= 0 ? '&' : '?') + params.toString(), true);
      }
      if (kind === 'distill') {
        var text = val('briefInput');
        if (!text) { setResult('briefResult', 'Paste a client message first.'); return; }
        var words = text.toLowerCase();
        var intent = /book|appointment|reserve|order|buy|shop/.test(words) ? 'Book or buy' : /learn|read|guide|information/.test(words) ? 'Learn' : 'Enquire or understand';
        var audience = /family|families|parent|children/.test(words) ? 'Families and local customers' : /business|team|client|company/.test(words) ? 'Businesses and teams' : 'The people the client serves';
        var proof = /review|award|years|trusted|certif/.test(words) ? 'Use the proof mentioned in the message' : 'Ask for reviews, results or a differentiator';
        var tone = /luxury|premium|elegant/.test(words) ? 'Premium and considered' : /fun|playful|bright/.test(words) ? 'Warm and energetic' : 'Clear, human and confident';
        var facts = /price|cost|£|hour|open|location|address/.test(words) ? 'Confirm every price, hour and location before publishing' : 'Confirm facts before publishing';
        setResult('briefResult', 'Primary action: ' + intent + '\nAudience: ' + audience + '\nProof: ' + proof + '\nTone: ' + tone + '\nFact check: ' + facts, true);
      }
      if (kind === 'handoff-copy' || kind === 'handoff-download') {
        var markdown = handoffMarkdown();
        if (kind === 'handoff-download') { if (downloadText(handoffFilename(), markdown, 'text/markdown;charset=utf-8')) { var saved = document.getElementById('handoffSaved'); if (saved) saved.textContent = 'Downloaded just now'; } }
        else copyText(markdown).then(function () { var saved = document.getElementById('handoffSaved'); if (saved) saved.textContent = 'Copied to clipboard'; }).catch(function () { var saved = document.getElementById('handoffSaved'); if (saved) saved.textContent = 'Select the preview to copy manually'; });
      }
      if (kind === 'brand-copy' || kind === 'brand-download') {
        var css = brandCss();
        if (kind === 'brand-download') downloadText('brand-snapshot.json', JSON.stringify(state.brand, null, 2), 'application/json;charset=utf-8');
        else copyText(css).then(function () { var result = document.getElementById('brandCssPreview'); if (result) result.dataset.copied = '1'; }).catch(function () {});
      }
    });
  }
  function init() { render(); }
  root.PallettAITools = { init: init, render: render, guides: GUIDE_DATA, pulse: pulseData };
})(typeof window !== 'undefined' ? window : this);

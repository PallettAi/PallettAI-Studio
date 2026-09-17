'use strict';

// ============================================================
// 404 page + host files — the export needs a graceful edge.
// ------------------------------------------------------------
// Two things every exported site was missing:
//
//   1. A 404. A mistyped or stale link dropped a visitor on the host's own
//      error page — no navigation, no branding, no way back. On Netlify and
//      Cloudflare Pages a file named `404.html` is served automatically, and
//      on Apache/GitHub Pages it is what most setups look for, so one file
//      covers the common hosts.
//   2. Host-native policy files. The site ships without any security headers
//      because there is no server config in a folder of HTML. Netlify and
//      Cloudflare Pages both read `_headers`, so the export can carry the
//      same hardening the Studio itself uses — as a file, not a promise.
//
// The 404 is rendered through the *live builder* rather than hand-written
// HTML, so it inherits the site's palette, fonts, navigation and footer, and
// can never drift from the rest of the export.
//
// Pure and offline (the caller passes the renderer in).
// ============================================================

const NotFound = (() => {

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // A single-purpose page: one heading, one sentence, and real ways out.
  // Built as a project-shaped object so the builder can render it with the
  // site's own navigation, footer, palette and CSS.
  function pageProject(project, opts) {
    const o = opts || {};
    const site = (project && project.site) || {};
    const name = String(site.name || (project && project.name) || 'this site').trim();
    const pages = Array.isArray(site.pages) ? site.pages : [];
    // Offer the pages a visitor is most likely to have wanted.
    const links = (o.links || pages.map((p) => ({ name: p.name || 'Page', href: (String(p.slug || 'index') === 'index' ? 'index.html' : p.slug + '.html') })))
      .filter((l) => l && l.name && l.href)
      .slice(0, 4);
    const list = links.length
      ? links.map((l) => '• ' + l.name + ' — ' + l.href).join('\n')
      : '• Home — index.html';

    return {
      id: ((project && project.id) || 'site') + '-404',
      name: name + ' — page not found',
      suites: (project && project.suites) || [],
      site: Object.assign({}, site, {
        name: name,
        // A 404 should never be indexed, and never be presented as the home
        // page's social card.
        metaDescription: 'That page could not be found on ' + name + '.',
        sections: [
          {
            type: 'hero',
            layout: 'splash',
            title: 'That page has moved, or never existed.',
            subtitle: 'Sorry about that — the link you followed is out of date.',
            ctaText: 'Back to the home page',
            ctaLink: 'index.html',
            animation: 'fade-up'
          },
          {
            type: 'features',
            title: 'Where you probably wanted to go',
            text: '',
            items: links.slice(0, 3).map((l) => ({ title: l.name, text: l.href })),
            extra: list
          }
        ],
        pages: []
      })
    };
  }

  // `render` is Builder.buildSiteHTML — passed in so this module stays pure
  // and testable without the builder loaded.
  function html(project, render, opts) {
    if (typeof render !== 'function') return '';
    const built = render(pageProject(project, opts), Object.assign({ exportMeta: false, cookieBanner: false }, (opts && opts.settings) || {}));
    // noindex on the error page specifically: it must never compete with the
    // real pages in a search result.
    return String(built).replace(/<head([^>]*)>/i, '<head$1>\n<meta name="robots" content="noindex, follow">');
  }

  // ---- host files -----------------------------------------------------------
  // Netlify and Cloudflare Pages read `_headers`. The policy is deliberately
  // compatible with the export as it is built: styles and scripts are inline,
  // images come from the project's own URLs, and nothing the site does needs
  // an eval — so no `unsafe-eval`, and no `unsafe-inline` for scripts.
  // The policy has to permit what the export actually tells the browser to do.
  // It previously did not: analytics was blocked outright (the hosts were never
  // allowed, so enabling Analytics in the Studio produced silence), and so were
  // the form services and booking embeds the app offers. An allow-list that
  // omits a configured feature is not "hardening", it is a broken site with a
  // security label on it. Only hosts the Studio itself configures are added.
  function headers(project, settings) {
    const site = (project && project.site) || {};
    const s = settings || {};
    const external = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
    const imgHosts = ['https:', 'data:'];
    const analyticsId = String(s.analyticsId || '').trim();
    const plausible = s.analyticsProvider === 'plausible';
    const scriptHosts = analyticsId ? [plausible ? 'https://plausible.io' : 'https://www.googletagmanager.com'] : [];
    const connectHosts = analyticsId
      ? (plausible ? ['https://plausible.io'] : ['https://www.google-analytics.com', 'https://www.googletagmanager.com'])
      : [];
    const scriptSrc = ["'self'", "'unsafe-inline'"].concat(scriptHosts).join(' ');
    const connectSrc = ["'self'"].concat(connectHosts).join(' ');
    const csp = [
      "default-src 'self'",
      'script-src ' + scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src " + imgHosts.join(' '),
      "font-src 'self' " + external.join(' '),
      'connect-src ' + connectSrc,
      "frame-src https://www.youtube.com https://player.vimeo.com https://www.google.com https://maps.google.com https://open.spotify.com https://calendly.com https://cal.com https://tidycal.com https://coverr.co",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://formspree.io https://api.web3forms.com https://formsubmit.co",
      "frame-ancestors 'self'"
    ].join('; ');

    const lines = [
      '/*',
      '  Content-Security-Policy: ' + csp,
      '  X-Content-Type-Options: nosniff',
      '  Referrer-Policy: strict-origin-when-cross-origin',
      '  Permissions-Policy: geolocation=(), microphone=(), camera=()',
      '  X-Frame-Options: SAMEORIGIN',
      '',
      '# Generated by PallettAi Studio. Netlify and Cloudflare Pages read this',
      '# file directly; other hosts need the same headers in their own config.',
      ''
    ];
    return lines.join('\n');
  }

  // Netlify/Cloudflare redirect rules. The 404 rule is explicit so a host
  // that does not auto-detect 404.html still serves it.
  function redirects() {
    return [
      '# Generated by PallettAi Studio.',
      '/*    /404.html   404',
      ''
    ].join('\n');
  }

  // GitHub Pages runs Jekyll unless told not to, which silently drops files
  // beginning with an underscore.
  function nojekyll() {
    return '';
  }

  function files(project, render, opts) {
    const out = [];
    const page = html(project, render, opts);
    if (page) out.push({ name: '404.html', content: page });
    out.push({ name: '_headers', content: headers(project, (opts && opts.settings) || {}) });
    out.push({ name: '_redirects', content: redirects() });
    out.push({ name: '.nojekyll', content: nojekyll() });
    return out;
  }

  return { pageProject, html, headers, redirects, nojekyll, files, esc };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NotFound;

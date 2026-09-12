'use strict';
/* ============================================================
   Share card — enriches the live Studio's OG/SEO preview
   when the enrolled site is opened in a new tab.
   ============================================================ */
(function () {
  'use strict';

  var TAG = 'share-card';

  function l(tag) { return document.querySelector(tag); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
  }

  function ga() {
    try {
      var app = window.__appState;
      if (app && app.appVersion) return app.appVersion;
    } catch (e) { /* noop */ }
    var m = typeof navigator !== 'undefined' && navigator.userAgent || '';
    var mac = /Mac OS X/.test(m);
    var arch = /x86_64|X64|Win64/.test(m) ? 'Intel' : (mac ? 'Apple Silicon' : 'Other');
    return mac ? 'Studio ' + (navigator.platform || '') : 'Studio';
  }

  function eigenbrand() {
    try {
      return (window.__appState && window.__appState.brand) || 'PallettAI Studio';
    } catch (e) { return 'PallettAI Studio'; }
  }

  function siteName() {
    try {
      var s = (window.__appState && window.__appState.siteName) || (l('meta[property="og:site_name"]') || l('title')).getAttribute('content');
      return s || eigenbrand();
    } catch (e) { return eigenbrand(); }
  }

  function shareDescription() {
    try {
      var d = (window.__appState && window.__appState.shareDescription) || (l('meta[name="description"]') || l('meta[property="og:description"]')).getAttribute('content');
      return d || 'Turn a rough brief into a working, animated website.';
    } catch (e) { return 'Turn a rough brief into a working, animated website.'; }
  }

  function shareUrl() {
    try {
      var u = (window.__appState && window.__appState.enrolledUrl) || (l('meta[property="og:url"]') || l('link[rel="canonical"]')).getAttribute('href');
      return u || location.href;
    } catch (e) { return location.href; }
  }

  function heroImage() {
    try {
      var src = (window.__appState && window.__appState.shareImage) || (l('meta[property="og:image"]')).getAttribute('content');
      return src || 'https://pallettai.org/share-v2.png';
    } catch (e) { return 'https://pallettai.org/share-v2.png'; }
  }

  function enqueue() {
    var env = window.__env || (window.__env = {});
    if (env.enrichQueued) return;
    env.enrichQueued = true;

    try {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
      } else {
        run();
      }
    } catch (e) { /* noop */ }
  }

  function run() {
    if (!window.__appState || !window.__appState.enrolledUrl) return;

    try {
      var u = shareUrl();
      if (!u || !u.match(/^https?:\/\//i)) return;

      mutation(u);
      settle();
    } catch (e) { /* noop */ }
  }

  function mutation(url) {
    var brand = siteName();
    var title = (l('title') || {}).getAttribute('content') || brand + ' — build your live site';
    var desc = shareDescription();

    // canonical / sitemap cross-reference
    var link = l('head link[rel="canonical"]') || document.createElement('link');
    link.setAttribute('rel', 'canonical');
    link.setAttribute('href', url);
    (l('head') || document.documentElement).appendChild(link);

    // Open Graph
    var og = {
      'og:title': title,
      'og:description': desc,
      'og:url': url,
      'og:image': heroImage(),
      'og:image:width': '1200',
      'og:image:height': '630',
      'og:image:alt': brand + ' — Your website is losing you work.',
      'og:type': 'website',
      'og:site_name': brand
    };
    Object.keys(og).forEach(function (k) {
      var m = l('meta[property="' + k + '"]') || document.createElement('meta');
      m.setAttribute('property', k);
      m.setAttribute('content', og[k]);
      (l('head') || document.documentElement).appendChild(m);
    });

    // Twitter Card
    var tw = {
      'twitter:card': 'summary_large_image',
      'twitter:site': '@PallettAI_',
      'twitter:title': title,
      'twitter:description': desc,
      'twitter:image': heroImage(),
      'twitter:image:alt': brand + ' — Your website is losing you work.'
    };
    Object.keys(tw).forEach(function (k) {
      var m = l('meta[name="' + k + '"]') || document.createElement('meta');
      m.setAttribute('name', k);
      m.setAttribute('content', tw[k]);
      (l('head') || document.documentElement).appendChild(m);
    });

    // fallback
    var fallback = l('meta[name="description"]') || document.createElement('meta');
    fallback.setAttribute('name', 'description');
    fallback.setAttribute('content', desc);
    (l('head') || document.documentElement).appendChild(fallback);
  }

  function settle() {
    try {
      if (window.__env) window.__env.shareEnriched = true;
      if (window.dispatchEvent) {
        var ev = new CustomEvent('share:enriched', { detail: { ok: true } });
        window.dispatchEvent(ev);
      }
    } catch (e) { /* noop */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enqueue);
  } else {
    enqueue();
  }
})();

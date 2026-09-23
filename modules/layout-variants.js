// ============================================================
// PallettAI Studio — LayoutVariants
// Structural layout alternatives per section type.
//
// Every section type ships three structural variants:
//
//   A  centered  — single column, measure-capped, minimal
//   B  split     — asymmetric 2-column (media + content), swaps
//                  sides per archetype
//   C  bento     — multi-card bento grid matrix, span patterns
//                  keyed to the archetype's density
//
// compileSectionVariant(sectionType, variantId, contentData,
// archetypeTokens) returns { id, sectionType, variant, html, css }
// — a structural HTML tree plus archetype-specific utility CSS
// (grid/flex/gap/radius/glass overlays), all classnames namespaced
// `pv-` so nothing collides with site styles.
//
// CommonJS + browser global, like the rest of modules/.
// ============================================================
(function () {
  'use strict';

  const LayoutVariants = {};

  /* ---------------- archetypes ---------------- */

  // Design DNA archetypes → layout personality. 'side' controls
  // which column leads the split variant; density controls bento
  // column counts and glass treatment.
  var ARCHETYPES = {
    'bento-glass': {
      label: 'Bento Glass', side: 'left', columns: { bento: 3 },
      radius: '20px', gap: '20px',
      surface: 'rgba(255,255,255,0.06)',
      glass: 'backdrop-filter: blur(14px) saturate(1.2); background: var(--pv-glass, rgba(255,255,255,0.06)); border: 1px solid var(--pv-glass-line, rgba(255,255,255,0.14));'
    },
    'brutalist-kinetic': {
      label: 'Brutalist Kinetic', side: 'right', columns: { bento: 2 },
      radius: '0px', gap: '0px',
      surface: 'var(--pv-surface, #fff)',
      glass: 'border: 3px solid var(--pv-line, currentColor); box-shadow: 6px 6px 0 var(--pv-shadow, currentColor);'
    },
    'editorial-magazine': {
      label: 'Editorial Magazine', side: 'right', columns: { bento: 2 },
      radius: '4px', gap: '24px',
      surface: 'var(--pv-surface, #faf7f2)',
      glass: 'border: 1px solid var(--pv-line, rgba(0,0,0,0.12));'
    },
    'retro-cyberpunk': {
      label: 'Retro Cyberpunk', side: 'left', columns: { bento: 3 },
      radius: '2px', gap: '14px',
      surface: 'rgba(0,20,30,0.55)',
      glass: 'border: 1px solid color-mix(in oklch, var(--pv-accent, currentColor) 60%, transparent); box-shadow: 0 0 18px color-mix(in oklch, var(--pv-accent, currentColor) 35%, transparent), inset 0 0 12px color-mix(in oklch, var(--pv-accent, currentColor) 12%, transparent);'
    },
    'organic-clay': {
      label: 'Organic Clay', side: 'left', columns: { bento: 2 },
      radius: '26px', gap: '22px',
      surface: 'color-mix(in oklch, var(--pv-surface, #fdf6ee) 88%, var(--pv-accent, #b4552d) 12%)',
      glass: 'border: none; box-shadow: 0 18px 40px -18px color-mix(in oklch, var(--pv-shadow, #3a2c22) 45%, transparent);'
    },
    'neo-minimalist': {
      label: 'Neo-Minimalist', side: 'right', columns: { bento: 2 },
      radius: '8px', gap: '18px',
      surface: 'var(--pv-surface, #fff)',
      glass: 'border: 1px solid var(--pv-line, rgba(0,0,0,0.08));'
    }
  };

  var SECTION_TYPES = ['hero', 'features', 'testimonials', 'pricing', 'faq', 'footer'];
  var VARIANTS = { A: 'centered', B: 'split', C: 'bento' };

  LayoutVariants.ARCHETYPES = ARCHETYPES;
  LayoutVariants.SECTION_TYPES = SECTION_TYPES;
  LayoutVariants.VARIANTS = VARIANTS;

  function resolveArchetype(tokens) {
    var key = typeof tokens === 'string' ? tokens : (tokens && tokens.archetype) || (tokens && tokens.archetypeKey) || 'bento-glass';
    key = String(key).toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
    return ARCHETYPES[key] || ARCHETYPES['bento-glass'];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function arr(v) { return Array.isArray(v) ? v : []; }

  function firstText(v, dflt) {
    var s = String(v == null ? '' : v).trim();
    return s || dflt || '';
  }

  /* ============================================================
     HTML trees — one builder per (sectionType × variant)
     ============================================================ */

  var TREES = {

    /* ---------------- hero ---------------- */
    'hero:A': function (d, a) {
      return '<section class="pv-hero pv-hero--a">' +
        '<div class="pv-inner pv-centered">' +
        (firstText(d.kicker) ? '<p class="pv-kicker">' + esc(d.kicker) + '</p>' : '') +
        '<h1 class="pv-title">' + esc(firstText(d.title, 'Headline')) + '</h1>' +
        (firstText(d.body) ? '<p class="pv-body">' + esc(d.body) + '</p>' : '') +
        (d.cta ? '<a class="pv-cta" href="' + esc(d.cta.href || '#') + '">' + esc(firstText(d.cta.label, 'Get started')) + '</a>' : '') +
        '</div></section>';
    },
    'hero:B': function (d, a) {
      var media = '<div class="pv-media pv-media--lead">' +
        (d.image ? '<img src="' + esc(d.image) + '" alt="' + esc(firstText(d.imageAlt, d.title || 'Hero image')) + '" width="1280" height="960" loading="eager">' : '<div class="pv-media-fallback" role="img" aria-label="' + esc(firstText(d.imageAlt, 'Hero visual')) + '"></div>') +
        '</div>';
      var copy = '<div class="pv-copy">' +
        (firstText(d.kicker) ? '<p class="pv-kicker">' + esc(d.kicker) + '</p>' : '') +
        '<h1 class="pv-title">' + esc(firstText(d.title, 'Headline')) + '</h1>' +
        (firstText(d.body) ? '<p class="pv-body">' + esc(d.body) + '</p>' : '') +
        (d.cta ? '<a class="pv-cta" href="' + esc(d.cta.href || '#') + '">' + esc(firstText(d.cta.label, 'Get started')) + '</a>' : '') +
        '</div>';
      // Asymmetry: the archetype's lead column gets the wider track.
      return a.side === 'left'
        ? '<section class="pv-hero pv-hero--b">' + media + copy + '</section>'
        : '<section class="pv-hero pv-hero--b pv-split--flip">' + copy + media + '</section>';
    },
    'hero:C': function (d, a) {
      var cards = arr(d.cards).slice(0, 3).map(function (c, i) {
        return '<article class="pv-card pv-span-' + (i === 0 ? '2' : '1') + '">' +
          '<h2 class="pv-card-title">' + esc(firstText(c.title, 'Highlight')) + '</h2>' +
          (firstText(c.body) ? '<p class="pv-body">' + esc(c.body) + '</p>' : '') +
          '</article>';
      }).join('');
      return '<section class="pv-hero pv-hero--c">' +
        '<div class="pv-bento pv-bento--hero">' +
        '<div class="pv-card pv-card--head pv-span-2">' +
        '<h1 class="pv-title">' + esc(firstText(d.title, 'Headline')) + '</h1>' +
        (firstText(d.body) ? '<p class="pv-body">' + esc(d.body) + '</p>' : '') +
        (d.cta ? '<a class="pv-cta" href="' + esc(d.cta.href || '#') + '">' + esc(firstText(d.cta.label, 'Get started')) + '</a>' : '') +
        '</div>' + cards + '</div></section>';
    },

    /* ---------------- features ---------------- */
    'features:A': function (d, a) {
      var items = arr(d.items).slice(0, 9).map(function (it) {
        return '<li class="pv-feature"><h3 class="pv-card-title">' + esc(firstText(it.title, 'Feature')) + '</h3>' +
          (firstText(it.body) ? '<p class="pv-body">' + esc(it.body) + '</p>' : '') + '</li>';
      }).join('');
      return '<section class="pv-features pv-features--a"><div class="pv-inner pv-centered">' +
        '<h2 class="pv-title">' + esc(firstText(d.title, 'What you get')) + '</h2>' +
        '<ul class="pv-stack">' + items + '</ul></div></section>';
    },
    'features:B': function (d, a) {
      var items = arr(d.items).slice(0, 4);
      var lead = items[0] || {};
      var rest = items.slice(1).map(function (it) {
        return '<li class="pv-feature"><h3 class="pv-card-title">' + esc(firstText(it.title, 'Feature')) + '</h3>' +
          (firstText(it.body) ? '<p class="pv-body">' + esc(it.body) + '</p>' : '') + '</li>';
      }).join('');
      var media = '<div class="pv-media pv-media--lead">' +
        (d.image ? '<img src="' + esc(d.image) + '" alt="' + esc(firstText(d.imageAlt, d.title || 'Feature visual')) + '" width="1024" height="768" loading="lazy">' : '<div class="pv-media-fallback" role="img" aria-label="' + esc(firstText(d.imageAlt, 'Feature visual')) + '"></div>') +
        '</div>';
      var copy = '<div class="pv-copy"><h2 class="pv-title">' + esc(firstText(d.title, 'What you get')) + '</h2>' +
        (firstText(lead.body) ? '<p class="pv-body">' + esc(lead.body) + '</p>' : '') +
        '<ul class="pv-stack pv-stack--tight">' + rest + '</ul></div>';
      return a.side === 'left'
        ? '<section class="pv-features pv-features--b">' + media + copy + '</section>'
        : '<section class="pv-features pv-features--b pv-split--flip">' + copy + media + '</section>';
    },
    'features:C': function (d, a) {
      var items = arr(d.items).slice(0, 6).map(function (it, i) {
        return '<article class="pv-card' + (i === 0 ? ' pv-span-2' : '') + '">' +
          '<h3 class="pv-card-title">' + esc(firstText(it.title, 'Feature')) + '</h3>' +
          (firstText(it.body) ? '<p class="pv-body">' + esc(it.body) + '</p>' : '') + '</article>';
      }).join('');
      return '<section class="pv-features pv-features--c"><div class="pv-inner">' +
        '<h2 class="pv-title">' + esc(firstText(d.title, 'What you get')) + '</h2>' +
        '<div class="pv-bento">' + items + '</div></div></section>';
    },

    /* ---------------- testimonials ---------------- */
    'testimonials:A': function (d, a) {
      var items = arr(d.items).slice(0, 5).map(function (it) {
        return '<figure class="pv-quote"><blockquote class="pv-quote-text">&ldquo;' + esc(firstText(it.title || it.quote, 'A fine experience.')) + '&rdquo;</blockquote>' +
          '<figcaption class="pv-caption">' + esc(firstText(it.body || it.name, 'A client')) + '</figcaption></figure>';
      }).join('');
      return '<section class="pv-testimonials pv-testimonials--a"><div class="pv-inner pv-centered">' +
        '<h2 class="pv-title">' + esc(firstText(d.title, 'What clients say')) + '</h2>' +
        items + '</div></section>';
    },
    'testimonials:B': function (d, a) {
      var items = arr(d.items).slice(0, 3);
      var lead = items[0] || {};
      var quotes = items.slice(1).map(function (it) {
        return '<figure class="pv-quote"><blockquote class="pv-quote-text">&ldquo;' + esc(firstText(it.title || it.quote, '')) + '&rdquo;</blockquote>' +
          '<figcaption class="pv-caption">' + esc(firstText(it.body || it.name, '')) + '</figcaption></figure>';
      }).join('');
      var copy = '<div class="pv-copy">' +
        '<figure class="pv-quote pv-quote--lead"><blockquote class="pv-quote-text">&ldquo;' + esc(firstText(lead.title || lead.quote, d.title || 'What clients say')) + '&rdquo;</blockquote>' +
        '<figcaption class="pv-caption">' + esc(firstText(lead.body || lead.name, '')) + '</figcaption></figure>' +
        quotes + '</div>';
      var media = '<div class="pv-media pv-media--lead">' +
        (d.image ? '<img src="' + esc(d.image) + '" alt="' + esc(firstText(d.imageAlt, 'Client portrait')) + '" width="800" height="1000" loading="lazy">' : '<div class="pv-media-fallback" role="img" aria-label="' + esc(firstText(d.imageAlt, 'Client visual')) + '"></div>') +
        '</div>';
      return a.side === 'left'
        ? '<section class="pv-testimonials pv-testimonials--b">' + media + copy + '</section>'
        : '<section class="pv-testimonials pv-testimonials--b pv-split--flip">' + copy + media + '</section>';
    },
    'testimonials:C': function (d, a) {
      var items = arr(d.items).slice(0, 6).map(function (it, i) {
        return '<figure class="pv-card' + (i === 0 ? ' pv-span-2' : '') + '"><blockquote class="pv-quote-text">&ldquo;' + esc(firstText(it.title || it.quote, '')) + '&rdquo;</blockquote>' +
          '<figcaption class="pv-caption">' + esc(firstText(it.body || it.name, '')) + '</figcaption></figure>';
      }).join('');
      return '<section class="pv-testimonials pv-testimonials--c"><div class="pv-inner">' +
        '<h2 class="pv-title">' + esc(firstText(d.title, 'What clients say')) + '</h2>' +
        '<div class="pv-bento">' + items + '</div></div></section>';
    },

    /* ---------------- pricing ---------------- */
    'pricing:A': function (d, a) {
      var plans = arr(d.items).slice(0, 3).map(function (p) {
        return '<article class="pv-plan' + (p.featured ? ' pv-plan--featured' : '') + '">' +
          '<h3 class="pv-card-title">' + esc(firstText(p.title, 'Plan')) + '</h3>' +
          '<p class="pv-price">' + esc(firstText(p.price, '')) + '</p>' +
          (firstText(p.body) ? '<p class="pv-body">' + esc(p.body) + '</p>' : '') +
          (p.cta ? '<a class="pv-cta" href="' + esc(p.cta.href || '#') + '">' + esc(firstText(p.cta.label, 'Choose')) + '</a>' : '') +
          '</article>';
      }).join('');
      return '<section class="pv-pricing pv-pricing--a"><div class="pv-inner pv-centered">' +
        '<h2 class="pv-title">' + esc(firstText(d.title, 'Pricing')) + '</h2>' +
        '<div class="pv-plans pv-plans--row">' + plans + '</div></div></section>';
    },
    'pricing:B': function (d, a) {
      var plans = arr(d.items);
      var lead = plans[0] || {};
      var copy = '<div class="pv-copy"><h2 class="pv-title">' + esc(firstText(d.title, 'Pricing')) + '</h2>' +
        (firstText(d.body) ? '<p class="pv-body">' + esc(d.body) + '</p>' : '') +
        '<article class="pv-plan pv-plan--featured">' +
        '<h3 class="pv-card-title">' + esc(firstText(lead.title, 'Plan')) + '</h3>' +
        '<p class="pv-price">' + esc(firstText(lead.price, '')) + '</p>' +
        (firstText(lead.body) ? '<p class="pv-body">' + esc(lead.body) + '</p>' : '') +
        (lead.cta ? '<a class="pv-cta" href="' + esc(lead.cta.href || '#') + '">' + esc(firstText(lead.cta.label, 'Choose')) + '</a>' : '') +
        '</article></div>';
      var side = '<div class="pv-stack pv-stack--tight">' + plans.slice(1, 4).map(function (p) {
        return '<article class="pv-plan pv-plan--mini"><h3 class="pv-card-title">' + esc(firstText(p.title, 'Plan')) + '</h3>' +
          '<p class="pv-price">' + esc(firstText(p.price, '')) + '</p></article>';
      }).join('') + '</div>';
      var media = d.image ? '<div class="pv-media"><img src="' + esc(d.image) + '" alt="' + esc(firstText(d.imageAlt, 'Product context')) + '" width="800" height="600" loading="lazy"></div>' : side;
      return a.side === 'left'
        ? '<section class="pv-pricing pv-pricing--b">' + media + copy + '</section>'
        : '<section class="pv-pricing pv-pricing--b pv-split--flip">' + copy + media + '</section>';
    },
    'pricing:C': function (d, a) {
      var plans = arr(d.items).slice(0, 6).map(function (p, i) {
        return '<article class="pv-card pv-plan' + (i === 0 ? ' pv-span-2' : '') + (p.featured ? ' pv-plan--featured' : '') + '">' +
          '<h3 class="pv-card-title">' + esc(firstText(p.title, 'Plan')) + '</h3>' +
          '<p class="pv-price">' + esc(firstText(p.price, '')) + '</p>' +
          (firstText(p.body) ? '<p class="pv-body">' + esc(p.body) + '</p>' : '') +
          (p.cta ? '<a class="pv-cta" href="' + esc(p.cta.href || '#') + '">' + esc(firstText(p.cta.label, 'Choose')) + '</a>' : '') +
          '</article>';
      }).join('');
      return '<section class="pv-pricing pv-pricing--c"><div class="pv-inner">' +
        '<h2 class="pv-title">' + esc(firstText(d.title, 'Pricing')) + '</h2>' +
        '<div class="pv-bento">' + plans + '</div></div></section>';
    },

    /* ---------------- faq ---------------- */
    'faq:A': function (d, a) {
      var items = arr(d.items).slice(0, 10).map(function (it) {
        return '<details class="pv-faq"><summary class="pv-card-title">' + esc(firstText(it.title || it.q, 'Question')) + '</summary>' +
          '<div class="pv-body">' + esc(firstText(it.body || it.a, '')) + '</div></details>';
      }).join('');
      return '<section class="pv-faq-sec pv-faq--a"><div class="pv-inner pv-centered pv-measure">' +
        '<h2 class="pv-title">' + esc(firstText(d.title, 'FAQ')) + '</h2>' + items + '</div></section>';
    },
    'faq:B': function (d, a) {
      var items = arr(d.items).slice(0, 8);
      var copy = '<div class="pv-copy"><h2 class="pv-title">' + esc(firstText(d.title, 'FAQ')) + '</h2>' +
        (firstText(d.body) ? '<p class="pv-body">' + esc(d.body) + '</p>' : '') +
        (d.cta ? '<a class="pv-cta" href="' + esc(d.cta.href || '#') + '">' + esc(firstText(d.cta.label, 'Ask us')) + '</a>' : '') +
        '</div>';
      var list = '<div class="pv-stack">' + items.map(function (it) {
        return '<details class="pv-faq"><summary class="pv-card-title">' + esc(firstText(it.title || it.q, 'Question')) + '</summary>' +
          '<div class="pv-body">' + esc(firstText(it.body || it.a, '')) + '</div></details>';
      }).join('') + '</div>';
      return a.side === 'left'
        ? '<section class="pv-faq-sec pv-faq--b">' + list + copy + '</section>'
        : '<section class="pv-faq-sec pv-faq--b pv-split--flip">' + copy + list + '</section>';
    },
    'faq:C': function (d, a) {
      var items = arr(d.items).slice(0, 8).map(function (it, i) {
        return '<details class="pv-card pv-faq' + (i === 0 ? ' pv-span-2' : '') + '"><summary class="pv-card-title">' + esc(firstText(it.title || it.q, 'Question')) + '</summary>' +
          '<div class="pv-body">' + esc(firstText(it.body || it.a, '')) + '</div></details>';
      }).join('');
      return '<section class="pv-faq-sec pv-faq--c"><div class="pv-inner">' +
        '<h2 class="pv-title">' + esc(firstText(d.title, 'FAQ')) + '</h2>' +
        '<div class="pv-bento">' + items + '</div></div></section>';
    },

    /* ---------------- footer ---------------- */
    'footer:A': function (d, a) {
      return '<footer class="pv-footer pv-footer--a"><div class="pv-inner pv-centered">' +
        '<p class="pv-title">&copy; ' + esc(firstText(d.title, 'Studio')) + ' ' + new Date().getFullYear() + '</p>' +
        (firstText(d.body) ? '<p class="pv-caption">' + esc(d.body) + '</p>' : '') +
        '<nav class="pv-nav" aria-label="Footer">' +
        arr(d.links).slice(0, 6).map(function (l) {
          return '<a href="' + esc(l.href || '#') + '">' + esc(firstText(l.label || l.title, 'Link')) + '</a>';
        }).join('') +
        '</nav></div></footer>';
    },
    'footer:B': function (d, a) {
      var copy = '<div class="pv-copy"><p class="pv-title">&copy; ' + esc(firstText(d.title, 'Studio')) + ' ' + new Date().getFullYear() + '</p>' +
        (firstText(d.body) ? '<p class="pv-caption">' + esc(d.body) + '</p>' : '') + '</div>';
      var nav = '<nav class="pv-nav pv-nav--cols" aria-label="Footer">' +
        arr(d.links).slice(0, 8).map(function (l) {
          return '<a href="' + esc(l.href || '#') + '">' + esc(firstText(l.label || l.title, 'Link')) + '</a>';
        }).join('') + '</nav>';
      return a.side === 'left'
        ? '<footer class="pv-footer pv-footer--b">' + nav + copy + '</footer>'
        : '<footer class="pv-footer pv-footer--b pv-split--flip">' + copy + nav + '</footer>';
    },
    'footer:C': function (d, a) {
      return '<footer class="pv-footer pv-footer--c"><div class="pv-bento pv-bento--footer">' +
        '<div class="pv-card pv-card--head pv-span-2"><p class="pv-title">' + esc(firstText(d.title, 'Studio')) + '</p>' +
        (firstText(d.body) ? '<p class="pv-caption">' + esc(d.body) + '</p>' : '') + '</div>' +
        arr(d.links).slice(0, 4).map(function (l) {
          return '<div class="pv-card"><a href="' + esc(l.href || '#') + '">' + esc(firstText(l.label || l.title, 'Link')) + '</a></div>';
        }).join('') +
        '</div></footer>';
    }
  };

  /* ============================================================
     CSS — archetype-specific utilities per (sectionType × variant)
     ============================================================ */

  function baseCss(a) {
    return [
      '.pv-inner{width:100%;max-width:1140px;margin-inline:auto;padding-inline:clamp(20px,4vw,48px)}',
      '.pv-centered{text-align:center;display:flex;flex-direction:column;align-items:center;gap:16px}',
      '.pv-measure{max-width:68ch}',
      '.pv-title{font-family:var(--font-heading,system-ui);font-size:var(--type-h2,2rem);line-height:var(--leading-h2,1.15);letter-spacing:var(--tracking-h2,normal);font-weight:var(--weight-h2,700);margin:0}',
      '.pv-card-title{font-family:var(--font-heading,system-ui);font-size:var(--type-h4,1.1rem);line-height:var(--leading-h4,1.25);font-weight:var(--weight-h4,600);margin:0}',
      '.pv-body{font-family:var(--font-body,system-ui);font-size:var(--type-body,1rem);line-height:var(--leading-body,1.6);margin:0;max-width:68ch}',
      '.pv-centered .pv-body{max-width:52ch}',
      '.pv-kicker{font-size:var(--type-small,.85rem);letter-spacing:.12em;text-transform:uppercase;margin:0}',
      '.pv-cta{display:inline-flex;align-items:center;justify-content:center;padding:.7em 1.4em;border-radius:var(--radius-control,8px);background:var(--pv-accent,#7c5cff);color:var(--pv-on-accent,#fff);text-decoration:none;font-weight:600}',
      '.pv-card,.pv-plan,.pv-quote,.pv-faq{border-radius:var(--pv-radius,' + a.radius + ');background:' + a.surface + ';' + a.glass + '}',
      '.pv-card,.pv-plan,.pv-quote,.pv-faq{padding:clamp(16px,2vw,28px);margin:0}',
      '.pv-stack{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:12px}',
      '.pv-stack--tight{gap:8px}',
      '.pv-caption{font-size:var(--type-small,.85rem);margin:0}',
      '@media(prefers-reduced-motion:reduce){.pv-card,.pv-plan,.pv-quote,.pv-faq{transition:none}}'
    ].join('');
  }

  function variantCss(sectionType, variant, a) {
    var css = [];
    if (variant === 'A') {
      // Centered single column: everything stacks, plans sit in a
      // narrow row, bento never appears.
      css.push('.pv-' + sectionType + '--a .pv-plans--row{display:flex;flex-wrap:wrap;gap:' + a.gap + ';justify-content:center;width:100%}');
      css.push('.pv-' + sectionType + '--a .pv-plan{flex:0 1 280px}');
    } else if (variant === 'B') {
      // Asymmetric split: 'split:1.4fr 1fr' — lead column wider;
      // flipped when the archetype leads with copy.
      css.push('.pv-' + sectionType + '--b{display:grid;align-items:center;gap:clamp(20px,4vw,48px);padding:clamp(32px,6vw,80px) clamp(20px,4vw,48px)}');
      css.push('.pv-' + sectionType + '--b{grid-template-columns:1.4fr 1fr}');
      css.push('.pv-' + sectionType + '--b.pv-split--flip{grid-template-columns:1fr 1.4fr}');
      css.push('.pv-media{min-height:280px;border-radius:var(--pv-radius,' + a.radius + ');overflow:hidden}');
      css.push('.pv-media--lead{aspect-ratio:4/3;background:color-mix(in oklch,var(--pv-accent,#7c5cff) 14%,transparent)}');
      css.push('.pv-media img{width:100%;height:100%;object-fit:cover;display:block}');
      css.push('.pv-media-fallback{width:100%;height:100%;min-height:inherit;background:color-mix(in oklch,var(--pv-accent,#7c5cff) 18%,transparent)}');
      css.push('@media(max-width:860px){.pv-' + sectionType + '--b,.pv-' + sectionType + '--b.pv-split--flip{grid-template-columns:1fr}}');
    } else {
      // Bento matrix: archetype density drives the column count;
      // cards flow with span utilities on the lead card.
      var cols = a.columns.bento;
      css.push('.pv-' + sectionType + '--c .pv-bento{display:grid;grid-template-columns:repeat(' + cols + ',minmax(0,1fr));gap:' + a.gap + ';align-items:stretch}');
      css.push('.pv-span-1{grid-column:span 1}.pv-span-2{grid-column:span 2}');
      css.push('@media(max-width:860px){.pv-' + sectionType + '--c .pv-bento{grid-template-columns:1fr 1fr}}');
      css.push('@media(max-width:560px){.pv-' + sectionType + '--c .pv-bento{grid-template-columns:1fr}.pv-span-2{grid-column:auto}}');
    }
    if (sectionType === 'footer') {
      css.push('.pv-footer{padding:clamp(24px,4vw,48px) 0;margin-top:auto}');
      css.push('.pv-nav{display:flex;flex-wrap:wrap;gap:16px;justify-content:center}');
      css.push('.pv-nav--cols{flex-direction:column;align-items:flex-start;gap:10px}');
      css.push('.pv-nav a{color:inherit;text-decoration:none;opacity:.85}');
      css.push('.pv-nav a:hover{opacity:1}');
    }
    if (sectionType === 'pricing') {
      css.push('.pv-price{font-family:var(--font-heading,system-ui);font-size:var(--type-h3,1.6rem);font-weight:var(--weight-h3,700);margin:.4em 0}');
      css.push('.pv-plan--featured{outline:2px solid var(--pv-accent,#7c5cff);outline-offset:2px}');
    }
    return css.join('');
  }

  /* ============================================================
     compiler
     ============================================================ */

  /**
   * compileSectionVariant(sectionType, variantId, contentData, archetypeTokens)
   * @param {string} sectionType   hero|features|testimonials|pricing|faq|footer
   * @param {string} variantId     'A'|'B'|'C' (or 'centered'|'split'|'bento')
   * @param {object} contentData   { title, body, kicker, items[], cards[], links[], cta, image, imageAlt }
   * @param {string|object} archetypeTokens  archetype key or { archetype, ...vars }
   * @returns {{ ok, id, sectionType, variant, archetype, html, css, bytes } |
   *           { ok: false, error }}
   */
  LayoutVariants.compileSectionVariant = function (sectionType, variantId, contentData, archetypeTokens) {
    var st = String(sectionType || '').toLowerCase();
    if (SECTION_TYPES.indexOf(st) === -1) {
      return { ok: false, error: 'Unknown section type: ' + sectionType };
    }
    var vKey = String(variantId || 'A').toUpperCase().charAt(0);
    if (vKey === 'C') vKey = 'C';
    var vName = VARIANTS[vKey];
    if (!vName) {
      // Accept full names too.
      var norm = String(variantId || '').toLowerCase();
      vKey = norm.indexOf('bento') === 0 ? 'C' : norm.indexOf('split') === 0 ? 'B' : 'A';
      vName = VARIANTS[vKey];
    }
    var a = resolveArchetype(archetypeTokens);
    var treeKey = st + ':' + vKey;
    var tree = TREES[treeKey];
    if (!tree) return { ok: false, error: 'No layout tree for ' + treeKey };

    var data = contentData || {};
    var vars = [];
    if (archetypeTokens && typeof archetypeTokens === 'object') {
      if (archetypeTokens.accent) vars.push('--pv-accent:' + archetypeTokens.accent);
      if (archetypeTokens.surface) vars.push('--pv-surface:' + archetypeTokens.surface);
      if (archetypeTokens.onAccent) vars.push('--pv-on-accent:' + archetypeTokens.onAccent);
    }
    var html = tree(data, a);
    var css = '<style>:root{' + vars.join(';') + ';' + (vars.length ? '' : '') + '}' +
      '.pv-scope{' + (vars.length ? vars.join(';') + ';' : '') + '}' +
      baseCss(a) + variantCss(st, vKey, a) + '</style>';

    return {
      ok: true,
      id: st + '-' + vKey.toLowerCase(),
      sectionType: st,
      variant: vName,
      archetype: a.label,
      html: html,
      css: css,
      bytes: html.length + css.length
    };
  };

  /* ---------------- exports ---------------- */

  if (typeof module !== 'undefined' && module.exports) module.exports = LayoutVariants;
})();

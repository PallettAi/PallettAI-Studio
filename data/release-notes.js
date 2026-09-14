'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.1',
  date: 'September 14, 2026',
  tagline: 'Every site now draws artwork of its own',
  highlights: [
    {
      icon: 'swatch',
      title: 'Your brand, drawn',
      desc: 'Every hero now carries artwork generated from your own palette — a glowing dial with signal waves, or a print-shop dot field. It is seeded from the brand name, so a site looks identical every time you open or export it, and no two clients get the same piece.'
    },
    {
      icon: 'eye',
      title: 'Light palettes read properly',
      desc: 'Hero headline, tagline, copy and buttons now follow your palette instead of assuming a dark background. Light-palette sites were rendering a white headline on a near-white hero whenever the theme toggle was switched off.'
    },
    {
      icon: 'spark',
      title: 'Lighter, smoother pages',
      desc: 'The old glow circles were 540px blurred elements animating forever. The new artwork is a few KB of flat SVG drawn once — no filters, no animation loop, no per-frame rasterisation, and nothing to download.'
    },
    {
      icon: 'shield',
      title: 'Motion preferences respected',
      desc: 'Sites now honour your visitor\u2019s reduced-motion setting for the number counters, hero parallax and smooth scrolling — not just the CSS animations, which were the only part that switched off before.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.15',
  date: 'September 25, 2026',
  tagline: 'More ways to build, stronger export controls, and artwork that survives offline',
  highlights: [
    {
      icon: 'spark',
      title: 'Widget Studio turns a sentence into a working tool',
      desc: 'Describe a quote estimator, mortgage calculator or booking step, preview the result, and add it to the project. It compiles to a dependency-free custom element that travels in the static export. Generated widgets are refused if they try to reach the network, browser storage, another frame or another page.'
    },
    {
      icon: 'shield',
      title: 'Safer pages, from Studio all the way to the host',
      desc: 'Opt-in strict export now gives every inline script a SHA-256 policy hash and derives the external origins the finished page actually uses. Network fetches reject private IPv4 and IPv6 targets through redirects, signed hotfixes are verified before use, and secrets no longer fall back to plaintext storage by default.'
    },
    {
      icon: 'download',
      title: 'A verified folder export, with more ways to present it',
      desc: 'Write a complete site directly to a chosen folder, verify every delivered file against its SHA-256 manifest, and keep optional visitor dark mode, print styles, branded 404 and web-app launch files. Three reduced-motion-safe scroll effects — reveal, parallax and kinetic type — are also available as reusable classes.'
    },
    {
      icon: 'layers',
      title: 'Offline image slots now finish with real local artwork',
      desc: 'When networking is off, every empty hero, about and gallery slot is filled with deterministic, clearly labelled SVG artwork embedded in the project. Your own uploads still win, every filled image receives alt text, and a remote image URL can no longer survive into an offline export.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

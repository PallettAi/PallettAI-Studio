'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.3',
  date: 'September 14, 2026',
  tagline: 'Every export now arrives with the evidence to back it up',
  highlights: [
    {
      icon: 'check',
      title: 'The export argues for itself',
      desc: 'Every export carries a delivery report and a manifest: what was measured, what is worth fixing, and a SHA-256 for every file. Anyone you send the folder to can confirm it is unaltered rather than taking your word for it \u2014 and the report is written for the client, not for you, so it can be forwarded as it is.'
    },
    {
      icon: 'globe',
      title: 'A finished site, right to its edges',
      desc: 'Each page gets its own share image drawn from your palette, so a link unfurls as the page it points at instead of a bare title. A mistyped URL now lands on a 404 that wears the site\u2019s own navigation, and the export ships the host policy files \u2014 security headers included \u2014 so what you hand over is hardened from the first upload.'
    },
    {
      icon: 'gauge',
      title: 'Faster for visitors, kinder to keyboards',
      desc: 'Images now offer the browser a smaller file wherever the host can resize, so a phone stops downloading a desktop-sized picture. Keyboard visitors get a skip link, a focus ring the site\u2019s own styles cannot remove, and navigation that tells them which page they are on.'
    },
    {
      icon: 'handoff',
      title: 'Hand over the system, not just the pixels',
      desc: 'The export includes your design tokens as CSS, JSON and a working Tailwind config, with the contrast of each text pairing stated. Copy is read for clarity \u2014 the longest sentence, the filler, the page that never asks for the work \u2014 and every link, anchor and asset is resolved before you send it.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.3.12',
  date: 'September 8, 2026',
  tagline: 'A cleaner studio and a faster first draft',
  highlights: [
    {
      icon: 'spark',
      title: 'AI first drafts, rebuilt',
      desc: 'One prompt now returns a complete draft — logo, ranked photos, and a layout that fits the business. Drop your own photos straight onto the preview to swap them.'
    },
    {
      icon: 'swatch',
      title: 'New Color Lab design',
      desc: 'IBM Plex typography, a hairline interface, and per-view color chips. Everything is calmer, tighter, and easier to scan.'
    },
    {
      icon: 'qr',
      title: 'QR Codes area',
      desc: 'Generate link, Wi-Fi, email, SMS, vCard and text QR codes offline — free, with one-click PNG download.'
    },
    {
      icon: 'download',
      title: 'Local photos in the Designer',
      fromDisk: true,
      desc: 'Replace any section image with a photo from your machine; it embeds right into the export.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

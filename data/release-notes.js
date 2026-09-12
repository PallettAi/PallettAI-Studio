'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.0',
  date: 'September 12, 2026',
  tagline: 'Cloud backup, client handoff, and a smarter AI Studio',
  highlights: [
    {
      icon: 'cloud',
      title: 'Cloud project vault',
      desc: 'Sign in and every project backs itself up — restore on a new machine, merge edits across devices, and delete with confidence. Settings ▸ Cloud backup.'
    },
    {
      icon: 'swatch',
      title: 'Palette from any image',
      desc: 'Drop a client photo or logo into the Database ▸ Palettes and the Color Lab extracts a guaranteed-accessible palette in one click — all offline.'
    },
    {
      icon: 'spark',
      title: 'Saved client briefs',
      desc: 'Save any prompt and brief, then reload it in one click for repeat clients and seasonal rebuilds.'
    },
    {
      icon: 'handoff',
      title: 'Clients can edit their own site',
      desc: 'The Client handoff ZIP now includes a built-in content editor — clients click Edit text on their live site, save, and re-upload. No studio required.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

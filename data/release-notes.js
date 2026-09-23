'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.11',
  date: 'September 23, 2026',
  tagline: 'Six visual directions, a toolbar for the section you are looking at, and tokens you can measure',
  highlights: [
    {
      icon: 'spark',
      title: 'Different sites, not different colours',
      desc: 'Generation now commits to one of six named visual archetypes — editorial magazine, bento glass, brutalist kinetic, neo-minimalist, organic clay or retro cyberpunk. Type, rhythm, borders, button shape and motion move together, and the archetype’s own tokens are written into the export.'
    },
    {
      icon: 'layers',
      title: 'Work on the section you clicked',
      desc: 'Selecting a section in the preview raises a toolbar: rewrite its copy, change its layout, or open a prompt that already names that section. Every button becomes a Copilot request, so it costs the credit it should, undoes in one step, and says why when it cannot help.'
    },
    {
      icon: 'shield',
      title: 'Design Tokens with a contrast reading you can trust',
      desc: 'Brand colour, surface, section rhythm, button radius and button shadow, edited against the open project. The badge measures body text on surface to WCAG AA — the pair a reader actually meets — and each change survives a reopen and lands in the exported files.'
    },
    {
      icon: 'gauge',
      title: 'Studio Guides, and fixes you can feel',
      desc: 'A searchable offline knowledge base covers design DNA, contrast, SEO launch checks and prompt craft. Layout commands now change the section you pointed at rather than the last one of its kind, and the feature screens that were missing from installed builds now ship with the app.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

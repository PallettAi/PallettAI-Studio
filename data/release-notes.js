'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.10',
  date: 'September 21, 2026',
  tagline: 'Studio is ready for a more reliable launch, safer updates and a lighter, faster workspace',
  highlights: [
    {
      icon: 'shield',
      title: 'A safer, more reliable launch',
      desc: 'The workspace now opens reliably on older Macs and Windows PCs, even when graphics acceleration is unavailable. Optional visual-editor packages stay out of startup until you open Advanced Canvas.'
    },
    {
      icon: 'spark',
      title: 'Shape the brief before Studio builds',
      desc: 'A short adaptive interview captures the visitor goal, audience, visual personality and proof available. Studio then presents contrasting creative routes before generation, so the direction is chosen rather than guessed.'
    },
    {
      icon: 'gauge',
      title: 'The AI now explains the structure it chose',
      desc: 'Every generated project receives a conversion strategy, signature visual moment, proof approach and section plan. The receipt shows the reasoning, and you can refine the visitor action or signature before generating another direction.'
    },
    {
      icon: 'layers',
      title: 'Start from your own proven systems',
      desc: 'Pro users can save a finished project as a personal starter. It preserves the pages, sections and design while safely leaving behind the previous client’s details, copy and imagery unless you explicitly choose to keep them.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

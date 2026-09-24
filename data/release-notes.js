'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.13',
  date: 'September 24, 2026',
  tagline: 'Manual updates now show their work, and keep their promises',
  highlights: [
    {
      icon: 'spark',
      title: 'Restart now shows what it is doing',
      desc: 'Checking for updates from the menu and choosing "Restart now" used to hand over to a step that takes minutes on an older machine with no window at all — which looked exactly like a crash. Studio now shows the same progress screen the launch check uses, with Skip still clickable, and gives your window straight back if you change your mind.'
    },
    {
      icon: 'shield',
      title: 'Choosing "Later" now actually means later',
      desc: 'The prompt has always said a deferred update would install when you quit, but Studio had deliberately switched that off to stop the installer racing its own safe hand-off. That contradiction is gone: pick Later and the downloaded update is genuinely armed for your next quit.'
    },
    {
      icon: 'download',
      title: 'Skip tells you the truth about your update',
      desc: 'Skipping before the download finishes loses the work, and skipping after it keeps it for your next quit. The message under the button now says which of the two is true instead of always claiming the update will be offered again.'
    },
    {
      icon: 'layers',
      title: 'Six visual directions, from 0.4.11',
      desc: 'Generation commits to one of six named archetypes — editorial magazine, bento glass, brutalist kinetic, neo-minimalist, organic clay or retro cyberpunk — and the preview gained a toolbar for the section you clicked, Design Tokens with a measured contrast reading, and a searchable Studio Guides tab.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.14',
  date: 'September 24, 2026',
  tagline: 'The generator works again — and the reason it broke is now impossible to repeat',
  highlights: [
    {
      icon: 'spark',
      title: 'Site generation works again',
      desc: 'Every generation was failing immediately and refunding the credit you had just spent. A leftover debug line read a setting that only exists when Studio runs outside its own window, so the generator threw before it built anything. It now runs, opens your new project and keeps the credit — and this is also the first real test of the update flow fixed in 0.4.13.'
    },
    {
      icon: 'shield',
      title: 'A fault like that can no longer reach a release',
      desc: 'Studio’s own checks all run in a test environment that has things the real app does not, so a mistake invisible to every test could still break the app itself. That is now checked directly: a release is refused if any file Studio loads in its window quietly depends on something that is not there.'
    },
    {
      icon: 'download',
      title: 'A manual update you can see, from 0.4.13',
      desc: 'Choosing "Restart now" now shows what it is doing instead of going quiet for minutes, choosing "Later" genuinely installs the update when you next quit, and the Skip button tells you the truth about what happens to a downloaded update.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

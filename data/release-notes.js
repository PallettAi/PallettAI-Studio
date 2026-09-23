'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.12',
  date: 'September 23, 2026',
  tagline: 'Updates that finish, and Studio that comes back when they do',
  highlights: [
    {
      icon: 'download',
      title: 'The update leaves only when the installer is ready',
      desc: 'Studio used to quit the moment the download finished — but the installer still had to expand the archive after that, and quitting cut it in half. The update was then discarded without a word, which is why Studio closed and came back on the old version. It now waits until the installer is genuinely ready, and the Skip button stays live for the whole wait.'
    },
    {
      icon: 'spark',
      title: 'Studio reopens after the update',
      desc: 'The installer was being told not to relaunch the app, so a completed update left you with a closed Studio and nothing to open. That instruction is corrected, and the update now ends where it should — with the new version running.'
    },
    {
      icon: 'shield',
      title: 'A slow install can no longer lose your update',
      desc: 'Expanding a 240 MB build takes minutes on an older machine. If that cannot be confirmed within ten minutes, Studio opens anyway, keeps the downloaded update and installs it the next time you quit — instead of disappearing and leaving you to wonder.'
    },
    {
      icon: 'layers',
      title: 'Six visual directions, from 0.4.11',
      desc: 'Generation commits to one of six named archetypes — editorial magazine, bento glass, brutalist kinetic, neo-minimalist, organic clay or retro cyberpunk — and the preview gained a toolbar for the section you clicked, Design Tokens with a measured contrast reading, and a searchable Studio Guides tab.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

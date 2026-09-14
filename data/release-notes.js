'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.2',
  date: 'September 14, 2026',
  tagline: 'Client feedback now edits the site, and proves what changed',
  highlights: [
    {
      icon: 'chat',
      title: 'Feedback that makes the edit',
      desc: 'Import a client\u2019s notes and Studio tells you what it can do about each one before you click. \u201cDrop to two features\u201d becomes a real change to that section; \u201cremove this section\u201d, a rename, a reorder or a corrected email all land in one click \u2014 and anything it is not sure about is handed to the Copilot with the section already attached, rather than guessed at.'
    },
    {
      icon: 'clock',
      title: 'What changed since they reviewed',
      desc: 'Importing feedback sets a baseline. From then on one button writes the note every agency ends up writing by hand: what changed, grouped into structure, wording and look \u2014 in plain language, with nothing internal and no edit left out. Copy it, save it as a page, or open it in your email client.'
    },
    {
      icon: 'gauge',
      title: 'Performance you can prove',
      desc: 'The publish gate now measures the export rather than estimating it: the exact transfer size of each page after a real compression pass, plus what it found. A typical site comes in well under 30 KB. It caught four real defects in our own export while being built \u2014 including a hero image that was loading lazily, and a type stylesheet that blocked first paint.'
    },
    {
      icon: 'globe',
      title: 'Publish to Vercel and Cloudflare',
      desc: 'One-click publishing now covers Vercel and Cloudflare Pages alongside Netlify and Neocities \u2014 for when a client wants the site on their own account and their own domain. Tokens stay on your machine, and a deploy .zip is always one click away.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

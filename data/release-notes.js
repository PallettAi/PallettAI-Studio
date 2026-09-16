'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.4',
  date: 'September 16, 2026',
  tagline: 'The copilot reads what you actually asked for \u2014 and stops acting on what you did not',
  highlights: [
    {
      icon: 'chat',
      title: 'It reads the sentence, not just the words',
      desc: '\u201cDo not make it dark\u201d used to switch your site to Midnight. \u201cI don\u2019t like the editorial look\u201d used to apply it. A message is now read for what it is \u2014 a request, a refusal, a question, praise \u2014 before anything is planned, so a design change happens only when you asked for one, and a refusal is answered with alternatives rather than the thing you just turned down. Scope works the same way: two named sections are both handled, \u201cevery section\u201d means every section, and \u201cbut keep the words\u201d is honoured instead of quietly dropped.'
    },
    {
      icon: 'undo',
      title: 'Undo one change, and keep everything after it',
      desc: '\u2318Z walks backwards a step at a time, but the sentence you actually type is \u201cput the colours back\u201d \u2014 and answering that with \u201cI undid your last change\u201d asks you to remember what order you did things in. It now finds your most recent change to the colours and restores only that, leaving the work you did afterwards untouched. Because it works in paths rather than steps, either half of \u201cmake the hero punchier and switch to ocean\u201d can be put back on its own.'
    },
    {
      icon: 'shield',
      title: 'Publish is a decision, not a button',
      desc: 'Six failures only exist once a site is live, and every one of them is invisible until a visitor finds it: two pages exporting to the same file, a menu link to a page that was never made, an enquiry with nowhere to go, an insecure destination, a blank description, nothing to publish at all. The publish button now stops on them and says which one, rather than letting a stranger discover it first.'
    },
    {
      icon: 'pulse',
      title: 'Sites that keep working once you have moved on',
      desc: 'A new audit asks the question no other one asks \u2014 is this still true? Placeholder copy never filled in, our own template\u2019s sample address and phone number, an event date that has passed, last year\u2019s price sitting beside your money, # links, images with no alt text. Alongside it: animated backgrounds that bind to your own palette and honour motion settings, a free-tier badge carrying your referral link so every site you sell recruits for you, and 7 free AI credits instead of 3.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

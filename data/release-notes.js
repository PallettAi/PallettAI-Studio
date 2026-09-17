'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.6',
  date: 'September 17, 2026',
  tagline: 'Your site can now answer a visitor, and change on a date \u2014 with no server behind it',
  highlights: [
    {
      icon: 'chat',
      title: 'Your site can answer questions on its own',
      desc: 'Concierge puts an Ask us panel on the site itself. You fill in your hours, prices, services, the area you cover and any questions you get asked, and it answers visitors from that \u2014 in the page, with no server, no API key and nothing sent anywhere until someone presses send. It is built to refuse rather than guess: a question it cannot place is offered to you as an enquiry through the same form your contact section already uses. Turn it on in the Designer and it goes out with the next export.'
    },
    {
      icon: 'clock',
      title: 'And the site changes itself on the day you say',
      desc: 'A dated strip above the navigation that you write once and then forget. Put an offer up with an end date and it takes itself down after midnight; add Christmas hours and they appear on the day. Anything already expired when you export is dropped from the file entirely, and end dates are inclusive and read in the visitor\u2019s own timezone, so nothing vanishes a day early for anyone abroad.'
    },
    {
      icon: 'globe',
      title: 'Shared links now unfurl with a picture',
      desc: 'Every site has been generating a share card, but it was being handed over as an SVG \u2014 and X, WhatsApp and LinkedIn ignore SVG share images, so most shared links showed a bare title. The card is now rasterised to a PNG at export, so a link to your site shows the artwork. The same export pass also declares each image\u2019s dimensions, which stops photos shoving the page around while they load.'
    },
    {
      icon: 'pulse',
      title: 'Site Care \u2014 for the sites you have already shipped',
      desc: 'A new view in the rail, and it is about a different job from building. It sweeps every project you have handed over and reports what has quietly stopped being true: a date that has passed, a price still sitting beside last year, placeholder or sample text nobody replaced, a section left empty that the next export will fill with stock photos, images with no alt text, and links that point at nothing. Building a site and keeping one true are two jobs, and this is the second one.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

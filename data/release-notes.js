'use strict';

// What's New registry — the top entry drives the once-per-version modal.
// Bump `version` when you ship. Each entry: version, date, tagline, highlights[].
// Keep highlights to 3-4 items, written as user-facing wins (not commit logs).
const RELEASE_NOTES = {
  version: '0.4.7',
  date: 'September 17, 2026',
  tagline: 'Updates install themselves again \u2014 and a stalled one can no longer lock you out of Studio',
  highlights: [
    {
      icon: 'download',
      title: 'Restarting to update now actually restarts',
      desc: 'Installing an update was handing the job to macOS and then waiting to be replaced by a process that never left \u2014 so the updater window sat on \u201cInstalling update\u2026\u201d indefinitely, and the only way through was to force-quit the app. It now says goodbye properly: the updater window goes, the process exits, and macOS swaps the app in the few seconds it always should have taken.'
    },
    {
      icon: 'lock',
      title: 'Nothing can lock you out of your own work',
      desc: 'The update check runs before your workspace appears, so anything that stalls there used to mean a window you could not dismiss and no way into your projects. A few seconds in, that window now offers \u201cSkip the update and open Studio\u201d. Take it and the version you already have opens with everything where you left it; the update is offered again next time you open Studio, so a bad connection costs you a restart rather than access.'
    },
    {
      icon: 'info',
      title: 'An update tells you which version it is',
      desc: 'The prompt that asks you to restart now names the version waiting to be installed, instead of asking about \u201ca new version\u201d. If you would rather know what you are getting before you interrupt yourself, it is on the prompt.'
    }
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = RELEASE_NOTES;

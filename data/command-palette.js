'use strict';

const COMMANDS = [
  { id: 'dashboard', title: 'Dashboard', hint: 'Current job and recent work', group: 'Go', view: 'dashboard', keywords: 'home start' },
  { id: 'templates', title: 'Templates', hint: 'Start from a layout', group: 'Go', view: 'templates', keywords: 'new project' },
  { id: 'designer', title: 'Designer', hint: 'Edit the open site', group: 'Go', view: 'designer', keywords: 'edit preview' },
  { id: 'ai', title: 'AI Studio', hint: 'Generate a first draft', group: 'Go', view: 'ai', keywords: 'generate prompt' },
  { id: 'suites', title: 'Upgrade Suites', hint: 'Blog, shop, SEO, motion', group: 'Go', view: 'suites', keywords: 'blog shop seo' },
  { id: 'database', title: 'Database', hint: 'Library and live sources', group: 'Go', view: 'database', keywords: 'photos fonts' },
  { id: 'settings', title: 'Settings', hint: 'Account and studio defaults', group: 'Go', view: 'settings', keywords: 'prefs' },
  { id: 'qr', title: 'QR Codes', hint: 'Link, Wi-Fi, vCard', group: 'Go', view: 'qr', keywords: 'qr qrcode wifi email vcard url' },
  { id: 'account', title: 'Account & billing', hint: 'Plan and login', group: 'Settings', view: 'settings', tab: 'account', keywords: 'billing plan sign in' },
  { id: 'appearance', title: 'Appearance', hint: 'Theme and accent', group: 'Settings', view: 'settings', tab: 'appearance', keywords: 'dark light system' },
  { id: 'upgrade', title: 'Upgrade plan', hint: 'Free, Pro, Pro+', group: 'Account', action: 'upgrade', keywords: 'pricing dodo pay' },
  { id: 'copilot', title: 'Open Copilot', hint: 'Edit in plain English', group: 'AI', action: 'copilot', keywords: 'chat' },
  { id: 'export', title: 'Export & hand off', hint: 'Download or publish', group: 'Project', action: 'export', keywords: 'zip publish' },
  { id: 'tour', title: 'Tour', hint: 'Studio walkthrough', group: 'Help', action: 'tour', keywords: 'help onboard' },
  { id: 'whatsnew', title: "What's new", hint: 'Latest changes and fixes', group: 'Help', action: 'whatsnew', keywords: 'release notes changelog update version' }
];

/* Matching is tiered rather than yes/no, because where a query hits says how
   good the hit is: a title that starts with it beats a title that contains it,
   which beats a keyword, which beats letters picked out of order. The old
   filter was one flat substring test, so it could not rank and could not
   highlight — 'ua' found nothing, and 'ai' returned everything in file order. */
function normalizeQuery(query) {
  return String(query == null ? '' : query).trim().toLowerCase();
}

function wordStartIndex(hay, q) {
  let i = hay.indexOf(q);
  while (i !== -1) {
    if (i === 0 || /[^a-z0-9]/.test(hay.charAt(i - 1))) return i;
    i = hay.indexOf(q, i + 1);
  }
  return -1;
}

/* Every query letter in order, allowing gaps: 'dsh' finds 'Dashboard'. */
function subsequenceIndexes(hay, q) {
  const out = [];
  let at = 0;
  for (let i = 0; i < q.length; i++) {
    const found = hay.indexOf(q.charAt(i), at);
    if (found === -1) return null;
    out.push(found);
    at = found + 1;
  }
  return out;
}

/* Character ranges to mark in a title. Adjacent letters merge, so a direct hit
   highlights as one phrase and a scattered one highlights per letter. */
function matchRanges(query, text) {
  const q = normalizeQuery(query);
  const hay = String(text == null ? '' : text).toLowerCase();
  if (!q || !hay) return [];
  const direct = hay.indexOf(q);
  if (direct !== -1) return [[direct, direct + q.length]];
  const idx = subsequenceIndexes(hay, q);
  if (!idx) return [];
  const out = [];
  idx.forEach((i) => {
    const last = out[out.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else out.push([i, i + 1]);
  });
  return out;
}

function scoreCommand(query, cmd) {
  const q = normalizeQuery(query);
  if (!q) return { score: 0, ranges: [] };
  if (!cmd) return null;
  const title = String(cmd.title || '').toLowerCase();
  const rest = [cmd.hint, cmd.group, cmd.keywords].join(' ').toLowerCase();
  if (title === q) return { score: 6, ranges: [[0, title.length]] };
  if (title.indexOf(q) === 0) return { score: 5, ranges: [[0, q.length]] };
  if (wordStartIndex(title, q) !== -1) return { score: 4, ranges: matchRanges(q, title) };
  if (title.indexOf(q) !== -1) return { score: 3, ranges: matchRanges(q, title) };
  if (rest.indexOf(q) !== -1) return { score: 2, ranges: [] };
  /* Loose matching earns its keep on three letters or more. Below that it stops
     discriminating and every two-letter query matches half the list. */
  if (q.length >= 3 && subsequenceIndexes(title, q)) return { score: 1, ranges: matchRanges(q, title) };
  return null;
}

function filterCommands(query, commands) {
  const list = commands || COMMANDS;
  const q = normalizeQuery(query);
  // Copies, so a ranked result can carry its highlight ranges without writing
  // onto the shared command list.
  if (!q) return list.map((c) => Object.assign({}, c, { match: [] }));
  const scored = [];
  list.forEach((c, i) => {
    const hit = scoreCommand(q, c);
    if (hit) scored.push({ cmd: c, score: hit.score, ranges: hit.ranges, i });
  });
  /* Best tier wins; anything tied keeps the order the list shipped in. Ranking
     further than that would mean arguing that 'Database' beats 'Dashboard' for
     'da' on title length, which is not a reason a creator can see. Ties on
     quality should look like the palette they already know. */
  scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));
  return scored.map((s) => Object.assign({}, s.cmd, { match: s.ranges }));
}

function nextIndex(current, length, delta) {
  if (!length) return -1;
  const n = ((Number(current) || 0) + Number(delta || 0)) % length;
  return n < 0 ? n + length : n;
}

const CommandPalette = { COMMANDS, filterCommands, nextIndex, scoreCommand, matchRanges, normalizeQuery };
if (typeof module !== 'undefined' && module.exports) module.exports = CommandPalette;

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
  { id: 'upgrade', title: 'Upgrade plan', hint: 'Free, Pro, Pro+', group: 'Account', action: 'upgrade', keywords: 'pricing stripe pay' },
  { id: 'copilot', title: 'Open Copilot', hint: 'Edit in plain English', group: 'AI', action: 'copilot', keywords: 'chat' },
  { id: 'export', title: 'Export & hand off', hint: 'Download or publish', group: 'Project', action: 'export', keywords: 'zip publish' },
  { id: 'tour', title: 'Tour', hint: 'Studio walkthrough', group: 'Help', action: 'tour', keywords: 'help onboard' },
  { id: 'whatsnew', title: "What's new", hint: 'Latest changes and fixes', group: 'Help', action: 'whatsnew', keywords: 'release notes changelog update version' }
];

function filterCommands(query, commands) {
  const list = commands || COMMANDS;
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((c) => {
    const hay = [c.title, c.hint, c.group, c.keywords].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  });
}

function nextIndex(current, length, delta) {
  if (!length) return -1;
  const n = ((Number(current) || 0) + Number(delta || 0)) % length;
  return n < 0 ? n + length : n;
}

const CommandPalette = { COMMANDS, filterCommands, nextIndex };
if (typeof module !== 'undefined' && module.exports) module.exports = CommandPalette;

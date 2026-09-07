'use strict';

const COMMANDS = [
  { id: 'dashboard', title: 'Dashboard', hint: 'Home', group: 'Go', view: 'dashboard', keywords: 'home start' },
  { id: 'templates', title: 'Templates', hint: 'Start a site', group: 'Go', view: 'templates', keywords: 'new project' },
  { id: 'designer', title: 'Designer', hint: 'Edit the open site', group: 'Go', view: 'designer', keywords: 'edit preview' },
  { id: 'ai', title: 'AI Studio', hint: 'Generate a site', group: 'Go', view: 'ai', keywords: 'generate prompt' },
  { id: 'suites', title: 'Upgrade Suites', hint: 'Feature packs', group: 'Go', view: 'suites', keywords: 'blog shop seo' },
  { id: 'database', title: 'Database', hint: 'Library and live data', group: 'Go', view: 'database', keywords: 'photos fonts' },
  { id: 'settings', title: 'Settings', hint: 'Studio options', group: 'Go', view: 'settings', keywords: 'prefs' },
  { id: 'account', title: 'Account & billing', hint: 'Plan and login', group: 'Settings', view: 'settings', tab: 'account', keywords: 'billing plan sign in' },
  { id: 'appearance', title: 'Appearance', hint: 'Theme and accent', group: 'Settings', view: 'settings', tab: 'appearance', keywords: 'dark light system' },
  { id: 'upgrade', title: 'Upgrade plan', hint: 'Free · Pro · Pro+', group: 'Account', action: 'upgrade', keywords: 'pricing stripe pay' },
  { id: 'copilot', title: 'Open Copilot', hint: 'Edit in plain English', group: 'AI', action: 'copilot', keywords: 'chat' },
  { id: 'export', title: 'Export & hand off', hint: 'Download or publish', group: 'Project', action: 'export', keywords: 'zip publish' },
  { id: 'tour', title: 'Quick tour', hint: 'Two-minute walkthrough', group: 'Help', action: 'tour', keywords: 'help onboard' }
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

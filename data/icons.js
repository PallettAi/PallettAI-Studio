'use strict';

// One stroke set for Studio chrome. Add a key here, then reference it
// from data/chrome.js or ICONS.svg('name') in a view.
const ICON_PATHS = {
  home: '<path d="M3.4 9.2 10 3.6l6.6 5.6V16a1 1 0 0 1-1 1h-3.5v-4.3H7.9V17H4.4a1 1 0 0 1-1-1V9.2z"/>',
  grid: '<rect x="3.2" y="3.2" width="5.6" height="5.6" rx="1"/><rect x="11.2" y="3.2" width="5.6" height="5.6" rx="1"/><rect x="3.2" y="11.2" width="5.6" height="5.6" rx="1"/><rect x="11.2" y="11.2" width="5.6" height="5.6" rx="1"/>',
  pen: '<path d="M4 14.8 13.2 5.6a1.5 1.5 0 0 1 2.1 0l.1.1a1.5 1.5 0 0 1 0 2.1L6.2 17H4v-2.2z"/><path d="M12.2 6.6l2.2 2.2"/>',
  spark: '<path d="M10 2.8l.85 3.7 3.7.85-3.7.85L10 11.9l-.85-3.7-3.7-.85 3.7-.85L10 2.8z"/><path d="M15.2 12.2l.45 1.7 1.7.45-1.7.45-.45 1.7-.45-1.7-1.7-.45 1.7-.45.45-1.7z"/>',
  layers: '<path d="M11.6 3.6 16 6.2v5.2l-4.4 2.6L7.2 11.4V6.2L11.6 3.6z"/><path d="M7.2 6.2 4 8.1v5.1l4.3 2.6 3.3-1.9"/><path d="M16 6.2 12.8 8"/>',
  cylinder: '<ellipse cx="10" cy="5.2" rx="6.2" ry="2.4"/><path d="M3.8 5.2v9.6c0 1.3 2.8 2.4 6.2 2.4s6.2-1.1 6.2-2.4V5.2"/><path d="M3.8 10c0 1.3 2.8 2.4 6.2 2.4s6.2-1.1 6.2-2.4"/>',
  gear: '<circle cx="10" cy="10" r="2.2"/><path d="M10 3.2v1.6M10 15.2v1.6M3.2 10h1.6M15.2 10h1.6M5.2 5.2l1.1 1.1M13.7 13.7l1.1 1.1M14.8 5.2l-1.1 1.1M6.3 13.7l-1.1 1.1"/>',
  qr: '<rect x="3.2" y="3.2" width="5.2" height="5.2" rx="1"/><rect x="11.6" y="3.2" width="5.2" height="5.2" rx="1"/><rect x="3.2" y="11.6" width="5.2" height="5.2" rx="1"/><path d="M12.2 12.2h2.2v2.2H12.2zM15.2 15.2h1.2M12.2 16.4h1.4M15.8 12.2v1.4"/>',
  plus: '<path d="M10 4.2v11.6M4.2 10h11.6"/>',
  minus: '<path d="M4.2 10h11.6"/>',
  check: '<path d="M4.4 10.4 8.2 14.2 15.6 5.8"/>',
  close: '<path d="M5 5l10 10M15 5 5 15"/>',
  search: '<circle cx="9" cy="9" r="4.4"/><path d="M12.4 12.4 16.2 16.2"/>',
  eye: '<path d="M2.8 10s2.6-5.2 7.2-5.2S17.2 10 17.2 10 14.6 15.2 10 15.2 2.8 10 2.8 10z"/><circle cx="10" cy="10" r="2.1"/>',
  download: '<path d="M10 3.4v9.2"/><path d="M6.4 9.2 10 12.8l3.6-3.6"/><path d="M4 16.4h12"/>',
  upload: '<path d="M10 16.6V7.4"/><path d="M6.4 10.8 10 7.2l3.6 3.6"/><path d="M4 3.6h12"/>',
  copy: '<rect x="6.2" y="6.2" width="9.2" height="10" rx="1.2"/><path d="M4.6 13.6V4.8A1.2 1.2 0 0 1 5.8 3.6h8"/>',
  trash: '<path d="M4.4 6.2h11.2M8 6.2V4.6h4v1.6M6.2 6.2l.6 9.2h6.4l.6-9.2"/>',
  dup: '<rect x="6.6" y="6.6" width="9" height="9" rx="1.2"/><path d="M4.4 13.4V4.8A1.2 1.2 0 0 1 5.6 3.6h8.2"/>',
  save: '<path d="M4.4 4.4h9.2L15.6 6.4v9.2H4.4V4.4z"/><path d="M7 4.4v3.6h6V4.4M7 15.6v-4h6v4"/>',
  undo: '<path d="M7.2 7.2H4.4V4.4"/><path d="M4.4 7.2A6 6 0 1 1 6.2 15"/>',
  redo: '<path d="M12.8 7.2h2.8V4.4"/><path d="M15.6 7.2A6 6 0 1 0 13.8 15"/>',
  history: '<circle cx="10" cy="10" r="6.4"/><path d="M10 6.4V10l2.6 1.6"/>',
  chat: '<path d="M4.2 4.6h11.6v8.2H9.2L5.4 15.6V12.8H4.2V4.6z"/>',
  swatch: '<rect x="3.4" y="6.2" width="5.2" height="9.2" rx="1"/><rect x="7.6" y="4.6" width="5.2" height="9.2" rx="1"/><rect x="11.6" y="6.8" width="5.2" height="9.2" rx="1"/>',
  cloud: '<path d="M6.2 14.8a3.4 3.4 0 0 1-.4-6.8 4.6 4.6 0 0 1 9-.9 3.1 3.1 0 0 1 1 6.1c-.3.1-.7.1-1 .1H6.2z"/><path d="M10 16.6v-4.2"/><path d="M7.8 14.2 10 16.4l2.2-2.2"/>',
  handoff: '<rect x="3.4" y="4.4" width="8" height="11" rx="1.2"/><rect x="8.6" y="9.2" width="8" height="6.4" rx="1.2"/><path d="M11.4 12.4h2.4"/>',
  shield: '<path d="M10 3.2 16.2 5.4v5.2c0 3.4-2.6 5.6-6.2 6.4-3.6-.8-6.2-3-6.2-6.4V5.4L10 3.2z"/>',
  pulse: '<path d="M3.2 10h3l1.6-4.2L10.8 15l2-5h4"/>',
  gift: '<path d="M4.4 8.8h11.2v7.4H4.4zM4.4 8.8h11.2V6.2H4.4zM10 6.2v10"/><path d="M10 6.2c0-1.6-1.4-2.6-2.6-1.6S8.4 7.4 10 6.2c1.6 1.2 2.8-.4 1.6-1.6S10 4.6 10 6.2z"/>',
  globe: '<circle cx="10" cy="10" r="6.4"/><path d="M3.6 10h12.8M10 3.6c2 2.2 3 4.2 3 6.4s-1 4.2-3 6.4c-2-2.2-3-4.2-3-6.4s1-4.2 3-6.4z"/>',
  lock: '<rect x="5" y="8.6" width="10" height="7.2" rx="1.2"/><path d="M7.2 8.6V6.6a2.8 2.8 0 0 1 5.6 0v2"/>',
  user: '<circle cx="10" cy="7.2" r="2.6"/><path d="M4.6 16.2c.8-3 2.6-4.4 5.4-4.4s4.6 1.4 5.4 4.4"/>',
  sliders: '<path d="M4 6.2h12M4 13.8h12"/><circle cx="8" cy="6.2" r="1.5"/><circle cx="12.4" cy="13.8" r="1.5"/>',
  info: '<circle cx="10" cy="10" r="6.4"/><path d="M10 9v4.4M10 6.4h.01"/>',
  send: '<path d="M3.4 10 16.4 4.6 12.2 16.4 10 11.2 3.4 10z"/>',
  external: '<path d="M8.4 5.2H4.8v10h10V11.6"/><path d="M11.2 4.4h4.4V8.8M15.6 4.4 10 10"/>',
  play: '<path d="M7.2 4.8v10.4L15.2 10 7.2 4.8z"/>',
  map: '<path d="M3.6 5.4 8 3.8l4 1.6 4.4-1.6v11.2L12 16.6l-4-1.6-4.4 1.6V5.4z"/><path d="M8 3.8v11.2M12 5.4v11.2"/>',
  link: '<path d="M8.2 11.8a3.2 3.2 0 0 1 0-4.5l2-2a3.2 3.2 0 0 1 4.5 4.5l-1 1"/><path d="M11.8 8.2a3.2 3.2 0 0 1 0 4.5l-2 2a3.2 3.2 0 1 1-4.5-4.5l1-1"/>',
  wifi: '<path d="M3.4 8.2a9.4 9.4 0 0 1 13.2 0M5.6 10.6a6.2 6.2 0 0 1 8.8 0M7.8 13a3.2 3.2 0 0 1 4.4 0"/><circle cx="10" cy="16" r="1" fill="currentColor" stroke="none"/>',
  mail: '<rect x="3.2" y="5.2" width="13.6" height="9.6" rx="1.2"/><path d="M3.6 6.4 10 11.2 16.4 6.4"/>',
  phone: '<path d="M6.4 3.8h2.2l1 3-1.5 1.1a9.2 9.2 0 0 0 4.6 4.6l1.1-1.5 3 1v2.2A1.4 1.4 0 0 1 15.4 16C8.2 16 4 11.8 4 4.6A1.4 1.4 0 0 1 5.4 3.2h1z"/>',
  lines: '<path d="M4.4 5.6h11.2M4.4 10h11.2M4.4 14.4h7.6"/>'
};

function iconSvg(name) {
  const inner = ICON_PATHS[name];
  if (!inner) return '';
  return '<svg class="ui-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
}

function iconHas(name) {
  return Object.prototype.hasOwnProperty.call(ICON_PATHS, name);
}

const ICONS = { paths: ICON_PATHS, svg: iconSvg, has: iconHas };
if (typeof module !== 'undefined' && module.exports) module.exports = ICONS;
if (typeof window !== 'undefined') window.ICONS = ICONS;

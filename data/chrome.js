'use strict';

// Studio chrome registry. Add a view here, add an icon key in icons.js,
// add a #view-{id} section, and the rail / titles / dashboard tiles follow.

const CHROME_VIEWS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    blurb: 'Current job, recent work, and next actions.',
    icon: 'home',
    group: 'work',
    chip: ['#7c5cff', '#22d3ee', '#9d6bff', '#34d399']
  },
  {
    id: 'templates',
    label: 'Templates',
    blurb: 'Start a site from a finished layout.',
    icon: 'grid',
    group: 'work',
    chip: ['#22d3ee', '#7c5cff', '#cdb4ff', '#181a33'],
    tile: { title: 'Templates', blurb: 'Browse the catalog.', view: 'templates' }
  },
  {
    id: 'designer',
    label: 'Designer',
    blurb: 'Edit the open project on the canvas.',
    icon: 'pen',
    group: 'work',
    chip: ['#7c5cff', '#cdb4ff', '#22d3ee', '#9d6bff']
  },
  {
    id: 'ai',
    label: 'AI Studio',
    blurb: 'Generate a complete first draft from a brief.',
    icon: 'spark',
    group: 'make',
    chip: ['#9d6bff', '#c296ff', '#7c5cff', '#22d3ee'],
    tile: { title: 'Generate', blurb: 'Describe the site you need.', view: 'ai' }
  },
  {
    id: 'suites',
    label: 'Upgrade Suites',
    blurb: 'Add blog, shop, SEO, or motion after the build.',
    icon: 'layers',
    group: 'make',
    chip: ['#22d3ee', '#34d399', '#7c5cff', '#9d6bff']
  },
  {
    id: 'database',
    label: 'Database',
    blurb: 'Local library and live source feeds.',
    icon: 'cylinder',
    group: 'library',
    chip: ['#34d399', '#22d3ee', '#7c5cff', '#181a33']
  },
  {
    id: 'qr',
    label: 'QR Codes',
    blurb: 'Make a code for a URL, Wi-Fi network, or card.',
    icon: 'qr',
    group: 'library',
    chip: ['#22d3ee', '#181a33', '#7c5cff', '#9d6bff']
  },
  {
    id: 'settings',
    label: 'Settings',
    blurb: 'Account, appearance, and studio defaults.',
    icon: 'gear',
    group: 'studio',
    chip: ['#9aa1c4', '#7c5cff', '#22d3ee', '#181a33']
  }
];

const CHROME_TILES = [
  { id: 'new', title: 'New project', blurb: 'Start from a template.', view: 'templates', icon: 'plus' },
  { id: 'generate', title: 'Generate', blurb: 'Build a first draft from a brief.', view: 'ai', icon: 'spark' },
  { id: 'templates', title: 'Templates', blurb: 'Open the catalog.', view: 'templates', icon: 'grid' }
];

function chromeView(id) {
  for (let i = 0; i < CHROME_VIEWS.length; i++) {
    if (CHROME_VIEWS[i].id === id) return CHROME_VIEWS[i];
  }
  return null;
}

function chromeViewTitle(id) {
  const v = chromeView(id);
  return v ? v.label : id;
}

function chromeTiles() {
  return CHROME_TILES.slice();
}

function chromeChip(colors) {
  const list = colors || [];
  return '<span class="nav-chip" aria-hidden="true">' + list.map((c) => '<i style="background:' + c + '"></i>').join('') + '</span>';
}

const CHROME = {
  views: CHROME_VIEWS,
  tiles: chromeTiles,
  view: chromeView,
  viewTitle: chromeViewTitle,
  chip: chromeChip
};

if (typeof module !== 'undefined' && module.exports) module.exports = CHROME;
if (typeof window !== 'undefined') window.CHROME = CHROME;

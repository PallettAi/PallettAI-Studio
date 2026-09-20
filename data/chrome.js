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
    chip: ['#7cc0f8', '#9fd4ff', '#8fcaf9', '#34d399']
  },
  {
    id: 'templates',
    label: 'Templates',
    blurb: 'Start a site from a finished layout.',
    icon: 'grid',
    group: 'work',
    chip: ['#9fd4ff', '#7cc0f8', '#c9e7ff', '#08203c'],
    tile: { title: 'Templates', blurb: 'Browse the catalog.', view: 'templates' }
  },
  {
    id: 'designer',
    label: 'Designer',
    blurb: 'Edit the open project on the canvas.',
    icon: 'pen',
    group: 'work',
    chip: ['#7cc0f8', '#c9e7ff', '#9fd4ff', '#8fcaf9']
  },
  {
    id: 'ai',
    label: 'AI Studio',
    blurb: 'Generate a complete first draft from a brief.',
    icon: 'spark',
    group: 'make',
    chip: ['#8fcaf9', '#b3dcff', '#7cc0f8', '#9fd4ff'],
    tile: { title: 'Generate', blurb: 'Describe the site you need.', view: 'ai' }
  },
  {
    id: 'suites',
    label: 'Upgrade Suites',
    blurb: 'Add blog, shop, SEO, or motion after the build.',
    icon: 'layers',
    group: 'make',
    chip: ['#9fd4ff', '#34d399', '#7cc0f8', '#8fcaf9']
  },
  // Site Care is about sites that are already DELIVERED, which is a different job
  // from building one: nothing here is broken, it has just stopped being true.
  // It earns a rail entry because the creator with ten client sites is the one
  // who needs it, and they are the least likely to go looking inside a report.
  {
    id: 'care',
    label: 'Site Care',
    blurb: 'Check what has stopped being true across every site you have shipped.',
    icon: 'pulse',
    group: 'work',
    chip: ['#7cc0f8', '#34d399', '#9fd4ff', '#08203c']
  },
  {
    id: 'database',
    label: 'Database',
    blurb: 'Local library and live source feeds.',
    icon: 'cylinder',
    group: 'library',
    chip: ['#34d399', '#9fd4ff', '#7cc0f8', '#08203c']
  },
  {
    id: 'qr',
    label: 'QR Codes',
    blurb: 'Make a code for a URL, Wi-Fi network, or card.',
    icon: 'qr',
    group: 'library',
    chip: ['#9fd4ff', '#08203c', '#7cc0f8', '#8fcaf9']
  },
  {
    id: 'tools',
    label: 'Toolkit',
    blurb: 'Practical tools, launch checks and field guides.',
    icon: 'spark',
    group: 'library',
    chip: ['#34d399', '#9fd4ff', '#c9e7ff', '#7cc0f8']
  },
  {
    id: 'settings',
    label: 'Settings',
    blurb: 'Account, appearance, and studio defaults.',
    icon: 'gear',
    group: 'studio',
    chip: ['#9fb8d6', '#7cc0f8', '#9fd4ff', '#08203c']
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

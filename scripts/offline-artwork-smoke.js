#!/usr/bin/env node
'use strict';

// An offline export must not merely say it has a fallback: every image slot the
// builder can emit has to contain artwork that travels inside the exported
// file. This also pins the dangerous boundary -- a remote URL learned from a
// site must never survive when the workspace is explicitly offline.

const { loadAI } = require('./load-ai.js');

const AI = loadAI();
let passed = 0;
let failed = 0;

function ok(condition, label) {
  if (condition) {
    passed++;
    console.log('  ✓ ' + label);
  } else {
    failed++;
    console.error('  ✗ ' + label);
  }
}

function svgText(url) {
  const marker = ',';
  const comma = String(url).indexOf(marker);
  return decodeURIComponent(String(url).slice(comma + 1));
}

(async () => {
  const upload = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const project = {
    site: {
      name: 'North & Studio',
      fingerprint: { seed: 41 },
      photoPass: { status: 'pending' },
      sections: [
        { type: 'hero', title: 'A useful <site>', image: 'https://images.example/old-hero.jpg' },
        { type: 'about', title: 'About the studio', image: 'https://images.example/old-about.jpg' },
        {
          type: 'gallery',
          title: 'Selected work',
          items: [
            { title: 'First project' },
            { title: 'Second project', image: 'https://images.example/old-gallery.jpg' }
          ]
        }
      ]
    }
  };

  const out = await AI.generateImages(project, 'offline portfolio\nstudio', {
    source: 'none',
    online: false,
    photos: [upload],
    siteImages: ['https://images.example/remote.jpg']
  });

  const hero = project.site.sections.find((section) => section.type === 'hero');
  const about = project.site.sections.find((section) => section.type === 'about');
  const gallery = project.site.sections.find((section) => section.type === 'gallery');
  const illustrated = [about, ...(gallery ? gallery.items : [])];
  const imageValues = [hero, about, ...(gallery ? gallery.items : [])]
    .map((section) => section.image)
    .filter(Boolean);

  ok(out.source === 'offline', 'the result reports that its missing images came from offline artwork');
  ok(out.hero === true && hero.image === upload && hero.imageSource === 'Your photo', 'a creator data upload still wins the first slot');
  ok(out.about === true && about.imageSource === 'Offline artwork', 'the about slot receives local artwork');
  ok(out.gallery === 2 && gallery.items.every((item) => item.imageSource === 'Offline artwork'), 'every gallery slot receives local artwork');
  ok(illustrated.every((section) => String(section.image || '').startsWith('data:image/svg+xml;charset=utf-8,')), 'all generated artwork is a self-contained SVG data URL');
  ok(imageValues.every((url) => !/^https?:/i.test(url)), 'no remote image URL survives an offline run');
  ok([hero, about, ...(gallery ? gallery.items : [])].every((section) => typeof section.alt === 'string' && section.alt.trim()), 'every filled image has alt text');
  ok(project.site.photoPass.status === 'done' && project.site.photoPass.placed.gallery === 2, 'the photo receipt records the completed offline pass');

  const first = AI.offlineImageData('Portrait\nstudio', '<script>alert("x")</script> & work', 1, 99999, -19);
  const second = AI.offlineImageData('Portrait\nstudio', '<script>alert("x")</script> & work', 1, 99999, -19);
  const decoded = svgText(first);
  ok(first === second, 'the same project seed produces the same offline artwork');
  ok(first.startsWith('data:image/svg+xml;charset=utf-8,'), 'the standalone artwork helper returns an SVG data URL');
  ok(decoded.includes('viewBox="0 0 320 1800"'), 'artwork dimensions are clamped to a safe export range');
  ok(decoded.includes('&lt;script&gt;') && !decoded.includes('<script>'), 'labels are XML-escaped and cannot add script to the SVG');
  const remoteResource = /<(?:image|use|script|iframe|link)\b[^>]*(?:href|src)\s*=\s*["']https?:|\burl\(\s*["']?https?:/i;
  ok(!remoteResource.test(decoded), 'the generated SVG contains no remote resource reference');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

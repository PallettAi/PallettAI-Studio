// ============================================================
// PallettAI Studio — Extended SEO & Syndication V6 Smoke Tests
// Tests rich-snippets.js, internal-linker.js, audio-syndication.js,
// and geo-hreflang.js modules
// ============================================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ============================================================
// Test Configuration
// ============================================================

const TEST_DIR = path.join(__dirname, '..', '.test-output');
const COLORS = {
  pass: '\x1b[32m',
  fail: '\x1b[31m',
  info: '\x1b[34m',
  bold: '\x1b[1m',
  reset: '\x1b[0m'
};

// ============================================================
// Test Utilities
// ============================================================

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function log(msg, color = '') {
  console.log(COLORS[color] || '', msg, COLORS.reset);
}

function pass(testName, details = '') {
  testsRun++;
  testsPassed++;
  log(`✓ ${testName}`, 'pass');
  if (details) console.log('  ', details);
}

function fail(testName, error, details = '') {
  testsRun++;
  testsFailed++;
  log(`✗ ${testName}`, 'fail');
  log(`  Error: ${error.message || error}`, 'fail');
  if (details) console.log('  ', details);
}

function assertPass(condition, testName, message = '') {
  if (condition) {
    pass(testName);
  } else {
    fail(testName, new Error(message || 'Assertion failed'));
  }
}

function ensureTestDir() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
  return TEST_DIR;
}

// ============================================================
// Test: modules/rich-snippets.js
// ============================================================

async function testRichSnippets() {
  log('\n' + COLORS.bold + '=== Testing modules/rich-snippets.js ===' + COLORS.reset);

  const richSnippets = require('../modules/rich-snippets');

  // Test 1: FAQPage JSON-LD generation
  try {
    const faqData = {
      name: 'FAQ',
      questions: [
        { question: 'What is PallettAI?', answer: 'PallettAI is an AI-powered design studio.' },
        { question: 'How much does it cost?', answer: 'Pricing starts at $29/month.' }
      ]
    };

    const faqJson = richSnippets.generateFAQPageJSONLD(faqData);

    assertPass(
      faqJson['@type'] === 'FAQPage' &&
      faqJson.mainEntity && faqJson.mainEntity.length === 2,
      'generateFAQPageJSONLD() generates valid FAQPage schema',
      `Questions: ${faqJson.mainEntity.length}`
    );

    assertPass(
      faqJson.mainEntity[0].name === 'What is PallettAI?' &&
      faqJson.mainEntity[0].acceptedAnswer.text === 'PallettAI is an AI-powered design studio.',
      'FAQPage includes question and answer correctly'
    );
  } catch (e) {
    fail('generateFAQPageJSONLD()', e);
  }

  // Test 2: HowTo JSON-LD generation
  try {
    const howToData = {
      name: 'How to Build a Website',
      description: 'Step-by-step guide',
      steps: [
        { title: 'Plan', description: 'Define your goals and requirements.' },
        { title: 'Design', description: 'Create wireframes and mockups.', tool: 'Figma' },
        { title: 'Develop', description: 'Write the code.' }
      ],
      totalTime: 'PT2H'
    };

    const howToJson = richSnippets.generateHowToJSONLD(howToData);

    assertPass(
      howToJson['@type'] === 'HowTo' &&
      howToJson.step && howToJson.step.length === 3,
      'generateHowToJSONLD() generates valid HowTo schema',
      `Steps: ${howToJson.step.length}`
    );

    assertPass(
      howToJson.step[0].position === 1 &&
      howToJson.step[1].tool && howToJson.step[1].tool.name === 'Figma',
      'HowTo steps have correct position and tool properties'
    );
  } catch (e) {
    fail('generateHowToJSONLD()', e);
  }

  // Test 3: Event JSON-LD generation
  try {
    const eventData = {
      name: 'Tech Conference 2024',
      description: 'Annual tech conference',
      startDateISO: '2024-06-15T09:00:00-05:00',
      endDateISO: '2024-06-17T18:00:00-05:00',
      location: {
        name: 'Convention Center',
        address: {
          streetAddress: '123 Main St',
          addressLocality: 'San Francisco',
          addressRegion: 'CA',
          postalCode: '94105',
          addressCountry: 'US'
        }
      },
      offers: [
        { name: 'Early Bird', price: 299, currency: 'USD', availability: 'InStock' }
      ]
    };

    const eventJson = richSnippets.generateEventJSONLD(eventData);

    assertPass(
      eventJson['@type'] === 'Event' &&
      eventJson.name === 'Tech Conference 2024' &&
      eventJson.startDate === '2024-06-15T09:00:00-05:00',
      'generateEventJSONLD() generates valid Event schema'
    );

    assertPass(
      eventJson.location &&
      eventJson.location['@type'] === 'Place' &&
      eventJson.location.address &&
      eventJson.location.address['@type'] === 'PostalAddress',
      'Event includes location with address'
    );

    assertPass(
      eventJson.offers && eventJson.offers.length === 1 &&
      eventJson.offers[0].price === 299,
      'Event includes offers'
    );
  } catch (e) {
    fail('generateEventJSONLD()', e);
  }

  // Test 4: LocalBusiness JSON-LD generation
  try {
    const businessData = {
      '@type': 'Restaurant',
      name: 'The Italian Place',
      description: 'Authentic Italian cuisine',
      url: 'https://example.com',
      telephone: '+1-555-123-4567',
      address: {
        streetAddress: '456 Oak Ave',
        addressLocality: 'New York',
        addressRegion: 'NY',
        postalCode: '10001',
        addressCountry: 'US'
      },
      geo: {
        lat: 40.7128,
        lng: -74.006
      },
      openingHoursSpecification: [
        {
          dayOfWeek: 'Monday',
          opens: '09:00',
          closes: '22:00'
        }
      ],
      priceRange: '$$'
    };

    const businessJson = richSnippets.generateLocalBusinessJSONLD(businessData);

    assertPass(
      businessJson['@type'] === 'Restaurant' &&
      businessJson.name === 'The Italian Place' &&
      businessJson.address &&
      businessJson.address.streetAddress === '456 Oak Ave',
      'generateLocalBusinessJSONLD() generates valid LocalBusiness schema'
    );

    assertPass(
      businessJson.geo &&
      businessJson.geo.latitude === 40.7128 &&
      businessJson.geo.longitude === -74.006,
      'LocalBusiness includes geo coordinates'
    );

    assertPass(
      businessJson.openingHoursSpecification &&
      businessJson.openingHoursSpecification.length === 1 &&
      businessJson.openingHoursSpecification[0].dayOfWeek === 'Monday',
      'LocalBusiness includes opening hours specification'
    );
  } catch (e) {
    fail('generateLocalBusinessJSONLD()', e);
  }

  // Test 5: JSON-LD injection into HTML
  try {
    const html = '<html><head><title>Test</title></head><body></body></html>';
    const jsonLd = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Test' };

    const result = richSnippets.injectJSONLDIntoDOM(html, jsonLd);

    assertPass(
      result.includes('<script type="application/ld+json">') &&
      result.includes('"@type":"WebSite"') &&
      result.includes('Test'),
      'injectJSONLDIntoDOM() injects JSON-LD into HTML head'
    );
  } catch (e) {
    fail('injectJSONLDIntoDOM()', e);
  }

  // Test 6: JSON-LD validation
  try {
    const validFaq = richSnippets.generateFAQPageJSONLD({
      questions: [{ question: 'Q?', answer: 'A' }]
    });

    const validation = richSnippets.validateJSONLD(validFaq);

    assertPass(
      validation.valid === true &&
      validation.issues.filter(i => i.severity === 'error').length === 0,
      'validateJSONLD() validates valid FAQPage schema'
    );
  } catch (e) {
    fail('validateJSONLD()', e);
  }

  // Test 7: BreadcrumbList JSON-LD
  try {
    const breadcrumbData = {
      items: [
        { name: 'Home', url: '/' },
        { name: 'Blog', url: '/blog' },
        { name: 'Post', url: '/blog/post' }
      ]
    };

    const breadcrumbJson = richSnippets.generateBreadcrumbJSONLD(breadcrumbData);

    assertPass(
      breadcrumbJson['@type'] === 'BreadcrumbList' &&
      breadcrumbJson.itemListElement &&
      breadcrumbJson.itemListElement.length === 3,
      'generateBreadcrumbJSONLD() generates valid BreadcrumbList schema'
    );

    assertPass(
      breadcrumbJson.itemListElement[0].position === 1 &&
      breadcrumbJson.itemListElement[0].name === 'Home',
      'BreadcrumbList has correct item positions'
    );
  } catch (e) {
    fail('generateBreadcrumbJSONLD()', e);
  }

  // Test 8: JSON-LD injection is safe inside <script> blocks
  try {
    const hostile = richSnippets.generateFAQPageJSONLD({
      questions: [{
        question: 'Can I use </script> in an answer?',
        answer: 'Yes, use <script>alert(1)</script> carefully.'
      }]
    });

    const injected = richSnippets.injectJSONLDIntoDOM(
      '<html><head></head><body></body></html>',
      hostile
    );

    // The payload must not be able to close the surrounding script element
    const blocks = injected.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    assertPass(
      blocks.length === 1,
      'injectJSONLDIntoDOM() emits exactly one JSON-LD block',
      `blocks: ${blocks.length}`
    );

    const payload = blocks[0]
      .replace(/^<script type="application\/ld\+json">/, '')
      .replace(/<\/script>$/, '');

    assertPass(
      !/<\/script/i.test(payload),
      'JSON-LD payload cannot terminate its own <script> block'
    );

    // ...while still being valid JSON that round-trips the original text
    const parsed = JSON.parse(payload);
    assertPass(
      parsed.mainEntity[0].name === 'Can I use </script> in an answer?' &&
      parsed.mainEntity[0].acceptedAnswer.text === 'Yes, use <script>alert(1)</script> carefully.',
      'JSON-LD payload round-trips original content intact'
    );
  } catch (e) {
    fail('JSON-LD script-escaping', e);
  }

  // Test 8b: Course JSON-LD generation
  try {
    const courseData = {
      name: 'JavaScript Masterclass',
      description: 'Learn JavaScript from scratch',
      provider: { name: 'PallettAI', url: 'https://example.com' },
      instructor: { name: 'John Doe', role: 'Senior Instructor' },
      courseCode: 'JS101',
      offers: [
        { price: 99, currency: 'USD', availability: 'InStock' }
      ]
    };

    const courseJson = richSnippets.generateCourseJSONLD(courseData);

    assertPass(
      courseJson['@type'] === 'Course' &&
      courseJson.name === 'JavaScript Masterclass' &&
      courseJson.provider && courseJson.provider.name === 'PallettAI',
      'generateCourseJSONLD() generates valid Course schema'
    );

    assertPass(
      courseJson.courseCode === 'JS101' &&
      courseJson.offers && courseJson.offers.length === 1 &&
      courseJson.offers[0].price === 99,
      'Course includes course code and offers'
    );
  } catch (e) {
    fail('generateCourseJSONLD()', e);
  }

  // Test 9: generateRichSnippetJSONLD() dispatcher
  try {
    const sectionPage = {
      title: 'Pricing',
      sections: [
        { type: 'hero', title: 'Pricing' },
        { type: 'faq', items: [
          { title: 'Do you offer refunds?', content: '<p>Yes, within <strong>30 days</strong>.</p>' },
          { question: 'Is there a free tier?', answer: 'Yes, up to 3 projects.' }
        ]},
        { type: 'accordion', blocks: [
          { title: 'Do you offer refunds?', content: 'Duplicate entry' },
          { name: 'Can I cancel anytime?', text: ['Yes.', 'No contract.'] }
        ]}
      ]
    };

    const faqFromSections = richSnippets.generateRichSnippetJSONLD('FAQPage', sectionPage);

    assertPass(
      faqFromSections['@type'] === 'FAQPage' && faqFromSections.mainEntity.length === 3,
      'generateRichSnippetJSONLD() extracts FAQPage from section schemas',
      `questions: ${faqFromSections.mainEntity.length}`
    );

    assertPass(
      faqFromSections.mainEntity[0].acceptedAnswer.text === 'Yes, within 30 days.',
      'FAQ answers are HTML-stripped for valid snippet text',
      `got: "${faqFromSections.mainEntity[0].acceptedAnswer.text}"`
    );

    assertPass(
      faqFromSections.mainEntity[2].acceptedAnswer.text === 'Yes. No contract.',
      'FAQ answers supplied as arrays are joined into a single string'
    );

    const howToFromSections = richSnippets.generateRichSnippetJSONLD('how-to', {
      title: 'Deploy a Static Site',
      description: 'Ship it fast',
      duration: 'PT15M',
      tools: ['Node.js'],
      sections: [{
        type: 'steps',
        items: [
          { title: 'Build', content: '<p>Run <code>npm run build</code></p>', tool: 'Node.js' },
          { title: 'Publish', description: 'Upload the dist folder.' }
        ]
      }]
    });

    assertPass(
      howToFromSections['@type'] === 'HowTo' && howToFromSections.step.length === 2,
      'generateRichSnippetJSONLD() maps <Step> trees into HowTo instructions',
      `steps: ${howToFromSections.step.length}`
    );

    assertPass(
      howToFromSections.totalTime === 'PT15M' &&
      howToFromSections.step[0].tool && howToFromSections.step[0].tool.name === 'Node.js',
      'HowTo carries duration and per-step tool requirements'
    );

    assertPass(
      !/<code>/.test(howToFromSections.step[0].text),
      'HowTo step text has embedded markup stripped'
    );

    assertPass(
      richSnippets.generateRichSnippetJSONLD('faq', sectionPage)['@type'] === 'FAQPage' &&
      richSnippets.generateRichSnippetJSONLD('restaurant', { name: 'Cafe' })['@type'] === 'LocalBusiness',
      'generateRichSnippetJSONLD() resolves type aliases case-insensitively'
    );

    const unknown = richSnippets.generateRichSnippetJSONLD('NotAType', {});
    assertPass(
      Array.isArray(unknown._errors) && unknown._errors.length > 0,
      'generateRichSnippetJSONLD() flags unsupported schema types'
    );

    const emptyFaq = richSnippets.generateRichSnippetJSONLD('FAQPage', { sections: [{ type: 'hero' }] });
    assertPass(
      Array.isArray(emptyFaq._errors) && emptyFaq.mainEntity.length === 0,
      'generateRichSnippetJSONLD() flags FAQ pages with no Q&A pairs'
    );
  } catch (e) {
    fail('generateRichSnippetJSONLD()', e);
  }
}

// ============================================================
// Test: modules/internal-linker.js
// ============================================================

async function testInternalLinker() {
  log('\n' + COLORS.bold + '=== Testing modules/internal-linker.js ===' + COLORS.reset);

  const internalLinker = require('../modules/internal-linker');

  // Test 1: Keyword extraction
  try {
    const keywords = internalLinker.extractKeywords('Learn JavaScript and React for web development');

    assertPass(
      keywords.length >= 2 &&
      keywords.includes('javascript') &&
      keywords.includes('react'),
      'extractKeywords() extracts meaningful keywords',
      `Keywords: ${keywords.join(', ')}`
    );
  } catch (e) {
    fail('extractKeywords()', e);
  }

  // Test 2: Build page keyword map
  try {
    const projectSchema = {
      pages: [
        {
          slug: 'home',
          title: 'Home Page',
          content: '<p>Welcome to our homepage</p>',
          tags: ['homepage', 'landing']
        },
        {
          slug: 'about',
          title: 'About Us',
          content: '<p>Learn about our company history</p>'
        },
        {
          slug: 'contact',
          title: 'Contact Us',
          content: '<p>Get in touch with our team</p>'
        }
      ]
    };

    const keywordMap = internalLinker.buildPageKeywordMap(projectSchema);

    assertPass(
      keywordMap instanceof Map && keywordMap.size > 0,
      'buildPageKeywordMap() builds keyword map from project schema',
      `Keywords mapped: ${keywordMap.size}`
    );

    // Check that 'contact' keyword maps to contact page
    if (keywordMap.has('contact')) {
      const matches = keywordMap.get('contact');
      assertPass(
        matches.some(m => m.slug === 'contact'),
        'Keyword map includes contact keyword for contact page'
      );
    }
  } catch (e) {
    fail('buildPageKeywordMap()', e);
  }

  // Test 3: Smart internal link injection
  try {
    const projectSchema = {
      pages: [
        { slug: 'home', title: 'Home', content: '<p>Welcome</p>' },
        { slug: 'about', title: 'About Us', content: '<p>Learn about our company</p>' },
        { slug: 'services', title: 'Our Services', content: '<p>We offer web development services</p>' }
      ]
    };

    const keywordMap = internalLinker.buildPageKeywordMap(projectSchema);

    const htmlContent = `
      <html>
        <body>
          <h1>Welcome to Our Website</h1>
          <p>We offer excellent web development services for our clients.</p>
          <p>Learn more about our company and what we do.</p>
        </body>
      </html>
    `;

    const result = internalLinker.injectSmartInternalLinks(htmlContent, 'home', keywordMap, {
      maxLinksPerPage: 2,
      linkClass: 'internal-link',
      relAttribute: 'bookmark'
    });

    assertPass(
      result.stats.linked >= 1,
      'injectSmartInternalLinks() injects internal links',
      `Links added: ${result.stats.linked}`
    );

    // Should have injected link with rel="bookmark"
    const hasBookmarkLink = result.html.match(/<a[^>]*rel="bookmark"[^>]*>/i);
    assertPass(
      hasBookmarkLink,
      'Injected links include rel="bookmark" attribute'
    );
  } catch (e) {
    fail('injectSmartInternalLinks()', e);
  }

  // Test 4: Self-reference prevention
  try {
    const projectSchema = {
      pages: [
        { slug: 'blog', title: 'Blog', content: '<p>Check out our blog posts</p>' },
        { slug: 'blog-post-1', title: 'First Post', content: '<p>This is our first blog post about web development</p>' }
      ]
    };

    const keywordMap = internalLinker.buildPageKeywordMap(projectSchema);

    const htmlContent = '<p>Check out our latest blog post about web development</p>';

    const result = internalLinker.injectSmartInternalLinks(htmlContent, 'blog-post-1', keywordMap, {
      maxLinksPerPage: 5
    });

    // The word "blog" should not link to blog-post-1 (self-reference)
    // It should either link to the blog page or not link at all
    const blogLinkPattern = /<a[^>]*href="\/blog"[^>]*>blog<\/a>/i;
    const hasCorrectBlogLink = blogLinkPattern.test(result.html);

    // Either no link or correct link to /blog (not self)
    assertPass(
      !result.html.match(/<a[^>]*href="\/blog-post-1"[^>]*>blog<\/a>/i) ||
      hasCorrectBlogLink,
      'Self-referential linking is prevented'
    );
  } catch (e) {
    fail('Self-reference prevention', e);
  }

  // Test 5: Unlinked keywords detection
  try {
    const projectSchema = {
      pages: [
        { slug: 'home', title: 'Home Page', content: '<p>Welcome</p>' },
        { slug: 'services', title: 'Web Services', content: '<p>We provide web development</p>' }
      ]
    };

    const keywordMap = internalLinker.buildPageKeywordMap(projectSchema);

    const htmlContent = '<p>We offer great web development services for everyone</p>';

    const unlinked = internalLinker.getUnlinkedKeywords(htmlContent, keywordMap, 'home');

    assertPass(
      Array.isArray(unlinked) && unlinked.length >= 1,
      'getUnlinkedKeywords() identifies unlinked keywords',
      `Unlinked keywords: ${unlinked.map(u => u.keyword).join(', ')}`
    );
  } catch (e) {
    fail('getUnlinkedKeywords()', e);
  }

  // Test 6: Link density calculation
  try {
    const projectSchema = {
      pages: [
        { slug: 'home', title: 'Home', content: '<p>Welcome to our home page</p>' },
        { slug: 'about', title: 'About', content: '<p>Learn about our company</p>' }
      ]
    };

    const keywordMap = internalLinker.buildPageKeywordMap(projectSchema);

    const htmlWithLinks = '<p>Welcome to our <a href="/about">home</a> page</p>';
    const density = internalLinker.calculateLinkDensity(htmlWithLinks, keywordMap, 'home');

    assertPass(
      typeof density.density === 'number' &&
      typeof density.totalLinks === 'number' &&
      typeof density.keywordMatches === 'number',
      'calculateLinkDensity() returns valid density metrics'
    );
  } catch (e) {
    fail('calculateLinkDensity()', e);
  }

  // Test 7: Duplicate link removal
  try {
    const htmlWithDuplicates = `
      <p>
        <a href="/about">About</a>
        <a href="/about">About Us</a>
        <a href="/contact">Contact</a>
      </p>
    `;

    const cleaned = internalLinker.removeDuplicateInternalLinks(htmlWithDuplicates);

    const aboutLinks = (cleaned.match(/href="\/about"/gi) || []).length;

    assertPass(
      aboutLinks === 1,
      'removeDuplicateInternalLinks() removes duplicate href links',
      `About links remaining: ${aboutLinks}`
    );
  } catch (e) {
    fail('removeDuplicateInternalLinks()', e);
  }

  // Test 8: escapeRegExp utility
  try {
    const escaped = internalLinker.escapeRegExp('test.subject[keyword]');
    assertPass(
      escaped === 'test\\.subject\\[keyword\\]' || !escaped.includes('[') || !escaped.includes(']'),
      'escapeRegExp() escapes special regex characters'
    );
  } catch (e) {
    fail('escapeRegExp()', e);
  }

  // Test 9: Protected regions survive intact alongside existing anchors.
  // Regression: the anchor pattern <a[^>]*> also matches <article>/<aside>,
  // which previously swallowed and stranded the code-block placeholder.
  try {
    const projectSchema = {
      pages: [
        { slug: 'services', title: 'Web Development Services', content: '<p>web development services</p>' },
        { slug: 'about', title: 'About Our Company', content: '<p>about our company</p>' }
      ]
    };

    const keywordMap = internalLinker.buildPageKeywordMap(projectSchema);

    const source = [
      '<article>',
      '  <h1>Web Development Services</h1>',
      '  <pre><code>npm install web development services</code></pre>',
      '  <p>Already linked: <a href="/contact" rel="bookmark">contact</a> team.</p>',
      '  <h2>About</h2>',
      '  <p>Read about our company.</p>',
      '  <aside><p>Read about our company too.</p></aside>',
      '</article>'
    ].join('\n');

    const result = internalLinker.injectSmartInternalLinks(source, 'services', keywordMap, {
      maxLinksPerPage: 3,
      relAttribute: 'bookmark'
    });

    assertPass(
      !/__CODE_BLOCK_|__ANCHOR_|__HEADING_/.test(result.html),
      'Placeholder markers are fully restored (no leaked sentinels)'
    );

    assertPass(
      result.html.includes('<code>npm install web development services</code>'),
      'Code blocks are left untouched by link injection'
    );

    assertPass(
      result.html.includes('<a href="/contact" rel="bookmark">contact</a>'),
      'Pre-existing anchor tags are preserved verbatim'
    );

    assertPass(
      result.html.includes('<article>') && result.html.includes('<aside>'),
      '<article>/<aside> containers are not consumed as anchors'
    );
  } catch (e) {
    fail('Protected region + anchor regression', e);
  }
}

// ============================================================
// Test: modules/audio-syndication.js
// ============================================================

async function testAudioSyndication() {
  log('\n' + COLORS.bold + '=== Testing modules/audio-syndication.js ===' + COLORS.reset);

  const audioSyndication = require('../modules/audio-syndication');

  // Test 1: Podcast RSS generation
  try {
    const podcastMeta = {
      title: 'Tech Talk Podcast',
      description: 'Weekly tech discussions',
      author: 'John Doe',
      owner: 'John Doe',
      ownerEmail: 'john@example.com',
      website: 'https://example.com/podcast',
      coverArt: 'https://example.com/cover.jpg',
      language: 'en-us',
      categories: ['Technology', 'Business'],
      explicit: false
    };

    const episodes = [
      {
        title: 'Episode 1: Getting Started',
        description: 'Introduction to the podcast',
        audioUrl: 'https://example.com/episode1.mp3',
        duration: '00:30:00',
        publishedDate: '2024-01-15T10:00:00Z',
        guid: 'episode-1'
      },
      {
        title: 'Episode 2: Advanced Topics',
        description: 'Deep dive into advanced topics',
        audioUrl: 'https://example.com/episode2.mp3',
        duration: '00:45:00',
        publishedDate: '2024-01-22T10:00:00Z',
        guid: 'episode-2'
      }
    ];

    const rss = audioSyndication.generatePodcastRSS(podcastMeta, episodes);

    assertPass(
      rss.includes('<?xml version="1.0" encoding="UTF-8"?>') &&
      rss.includes('<rss version="2.0"') &&
      rss.includes('xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"'),
      'generatePodcastRSS() generates valid RSS with iTunes namespace',
      `RSS length: ${rss.length} chars`
    );

    assertPass(
      rss.includes('<title>Tech Talk Podcast</title>') &&
      rss.includes('<description>Weekly tech discussions</description>'),
      'Podcast RSS includes episode title and description'
    );

    assertPass(
      rss.includes('<itunes:author>John Doe</itunes:author>') &&
      rss.includes('<itunes:explicit>no</itunes:explicit>') &&
      rss.includes('<itunes:type>episodic</itunes:type>'),
      'Podcast RSS includes iTunes-specific tags'
    );
  } catch (e) {
    fail('generatePodcastRSS()', e);
  }

  // Test 2: iTunes enclosure tags
  try {
    const podcastMeta = {
      title: 'Test Podcast',
      description: 'Test',
      author: 'Test Author'
    };

    const episodes = [
      {
        title: 'Test Episode',
        audioUrl: 'https://example.com/audio.mp3',
        duration: '00:15:30',
        size: 1024000,
        mimeType: 'audio/mpeg',
        publishedDate: '2024-02-01T10:00:00Z'
      }
    ];

    const rss = audioSyndication.generatePodcastRSS(podcastMeta, episodes);

    assertPass(
      rss.includes('<enclosure url="https://example.com/audio.mp3"') &&
      rss.includes('length="1024000"') &&
      rss.includes('type="audio/mpeg"'),
      'Podcast RSS includes iTunes enclosure tags'
    );

    assertPass(
      rss.includes('<itunes:duration>00:15:30</itunes:duration>'),
      'Podcast RSS includes iTunes duration'
    );
  } catch (e) {
    fail('iTunes enclosure tags', e);
  }

  // Test 3: Podcast categories
  try {
    const podcastMeta = {
      title: 'Category Test',
      description: 'Test categories',
      author: 'Test',
      categories: [
        { text: 'Technology', subcategory: ['Software', 'Web'] },
        'Business'
      ]
    };

    const episodes = [];
    const rss = audioSyndication.generatePodcastRSS(podcastMeta, episodes);

    assertPass(
      rss.includes('<itunes:category text="Technology">') &&
      rss.includes('<itunes:category text="Software" />') &&
      rss.includes('<itunes:category text="Web" />') &&
      rss.includes('<itunes:category text="Business" />'),
      'Podcast RSS includes nested iTunes categories'
    );
  } catch (e) {
    fail('Podcast categories', e);
  }

  // Test 4: RFC 822 date formatting
  try {
    const date = new Date('2024-03-15T14:30:00Z');
    const formatted = audioSyndication.formatRFC822(date);

    assertPass(
      formatted.includes('Mar') &&
      formatted.includes('15') &&
      formatted.includes('2024') &&
      formatted.includes('+0000'),
      'formatRFC822() formats date correctly',
      `Formatted: ${formatted}`
    );
  } catch (e) {
    fail('formatRFC822()', e);
  }

  // Test 5: WebVTT generation from plain text
  try {
    const plainText = 'Hello and welcome to this podcast.\nToday we will discuss web development.';

    const vtt = audioSyndication.generateWebVTTFromTranscript(plainText);

    assertPass(
      vtt.startsWith('WEBVTT') &&
      vtt.includes('-->') &&
      vtt.includes('Hello and welcome'),
      'generateWebVTTFromTranscript() generates valid WebVTT from plain text',
      `VTT length: ${vtt.length} chars`
    );
  } catch (e) {
    fail('generateWebVTTFromTranscript() plain text', e);
  }

  // Test 6: WebVTT generation from timestamped text
  try {
    const timestampedText = `
[00:00:00.000] Hello and welcome to this podcast.
[00:00:03.500] Today we will discuss web development.
[00:00:07.000] Let's get started.
    `.trim();

    const vtt = audioSyndication.generateWebVTTFromTranscript(timestampedText);

    assertPass(
      vtt.includes('-->') &&
      vtt.includes('Hello and welcome'),
      'generateWebVTTFromTranscript() handles timestamped transcripts'
    );
  } catch (e) {
    fail('generateWebVTTFromTranscript() timestamped', e);
  }

  // Test 7: WebVTT structure validation
  try {
    const text = 'First line.\nSecond line.';

    const vtt = audioSyndication.generateWebVTTFromTranscript(text);

    // Check for proper VTT structure
    const lines = vtt.split('\n');
    assertPass(
      lines[0] === 'WEBVTT' &&
      lines[1] === '',
      'WebVTT has correct header structure'
    );

    // Check that timestamps are in proper format
    const timestampLines = lines.filter(l => l.includes('-->'));
    assertPass(
      timestampLines.length >= 2,
      'WebVTT has multiple timestamp lines',
      `Timestamp lines: ${timestampLines.length}`
    );
  } catch (e) {
    fail('WebVTT structure', e);
  }

  // Test 8: WebVTT parsing
  try {
    const vttContent = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello and welcome

00:00:05.000 --> 00:00:08.000
This is the second cue`;

    const cues = audioSyndication.parseWebVTT(vttContent);

    assertPass(
      Array.isArray(cues) && cues.length === 2,
      'parseWebVTT() parses WebVTT into cue objects',
      `Cues: ${cues.length}`
    );

    assertPass(
      cues[0].start === '00:00:01.000' &&
      cues[0].text === 'Hello and welcome',
      'Parsed cues contain correct start times and text'
    );
  } catch (e) {
    fail('parseWebVTT()', e);
  }

  // Test 9: Timestamped transcript detection
  try {
    const plain = 'Just plain text';
    const timestamped = '[00:00:01.000] Has timestamp';

    assertPass(
      !audioSyndication.isTimestampedTranscript(plain) &&
      audioSyndication.isTimestampedTranscript(timestamped),
      'isTimestampedTranscript() correctly detects timestamped text'
    );
  } catch (e) {
    fail('isTimestampedTranscript()', e);
  }

  // Test 10: WebVTT requires the timestamp line to precede cue text
  try {
    const vtt = audioSyndication.generateWebVTTFromTranscript('First cue here.\nSecond cue here.');

    const blocks = vtt.replace(/^WEBVTT\s*/, '').split(/\n\s*\n/).filter(b => b.trim());
    const timestampFirst = blocks.every(block => {
      const firstLine = block.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
      return /^\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}$/.test(firstLine);
    });

    assertPass(
      blocks.length >= 2 && timestampFirst,
      'WebVTT cues place the timestamp line before cue text',
      `cues: ${blocks.length}`
    );
  } catch (e) {
    fail('WebVTT cue ordering', e);
  }

  // Test 10b: RSS emits exactly one <guid> per <item>
  try {
    const rss = audioSyndication.generatePodcastRSS(
      { title: 'Guid Test', description: 'desc', author: 'Author' },
      [
        { title: 'Ep 1', audioUrl: 'https://ex.com/1.mp3', guid: 'g1', episodeType: 'full', publishedDate: '2024-01-01T00:00:00Z' },
        { title: 'Ep 2', audioUrl: 'https://ex.com/2.mp3', guid: 'g2', episodeType: 'trailer', publishedDate: '2024-01-02T00:00:00Z' }
      ]
    );

    const guidCount = (rss.match(/<guid /g) || []).length;
    const itemCount = (rss.match(/<item>/g) || []).length;

    assertPass(
      guidCount === itemCount && itemCount === 2,
      'Podcast RSS emits exactly one <guid> per episode',
      `guids: ${guidCount}, items: ${itemCount}`
    );

    assertPass(
      /xmlns:content="http:\/\/purl\.org\/rss\/1\.0\/modules\/content\/"/.test(rss),
      'Podcast RSS declares the content: namespace it uses'
    );

    assertPass(
      !/< description >/.test(rss) &&
      rss.includes('<itunes:episodeType>full</itunes:episodeType>'),
      'Podcast RSS uses well-formed element names and episodeType values'
    );
  } catch (e) {
    fail('RSS guid/namespace integrity', e);
  }

  // Test 11: XML escaping
  try {
    const escaped = audioSyndication.escapeXml('Test & <tag> "quoted" \'single\'');

    assertPass(
      escaped.includes('&amp;') &&
      escaped.includes('&lt;') &&
      escaped.includes('&gt;') &&
      escaped.includes('&quot;') &&
      escaped.includes('&apos;'),
      'escapeXml() escapes all XML special characters'
    );
  } catch (e) {
    fail('escapeXml()', e);
  }
}

// ============================================================
// Test: modules/geo-hreflang.js
// ============================================================

async function testGeoHreflang() {
  log('\n' + COLORS.bold + '=== Testing modules/geo-hreflang.js ===' + COLORS.reset);

  const geoHreflang = require('../modules/geo-hreflang');

  // Test 1: Hreflang matrix generation
  try {
    const siteUrl = 'https://example.com';
    const pageMatrix = {
      'en-US': '/en/',
      'en-GB': '/en-gb/',
      'fr-FR': '/fr/',
      'de-DE': '/de/',
      'x-default': '/'
    };

    const matrix = geoHreflang.generateHreflangMatrix(siteUrl, pageMatrix, 'en-US');

    assertPass(
      matrix.siteUrl === 'https://example.com' &&
      matrix.defaultLocale === 'en-US' &&
      matrix.locales && Object.keys(matrix.locales).length >= 4,
      'generateHreflangMatrix() generates matrix with locales',
      `Locales: ${Object.keys(matrix.locales).length}`
    );

    assertPass(
      matrix.locales['en-US'].url === 'https://example.com/en/' &&
      matrix.locales['fr-FR'].url === 'https://example.com/fr/',
      'Hreflang matrix has correct URLs for each locale'
    );
  } catch (e) {
    fail('generateHreflangMatrix()', e);
  }

  // Test 2: Locale code validation
  try {
    assertPass(
      geoHreflang.isValidLocaleCode('en-US') === true &&
      geoHreflang.isValidLocaleCode('fr-FR') === true &&
      geoHreflang.isValidLocaleCode('de-DE') === true,
      'isValidLocaleCode() validates correct locale codes'
    );

    assertPass(
      geoHreflang.isValidLocaleCode('invalid') === false &&
      geoHreflang.isValidLocaleCode('') === false &&
      geoHreflang.isValidLocaleCode(null) === false,
      'isValidLocaleCode() rejects invalid locale codes'
    );

    assertPass(
      geoHreflang.isValidLocaleCode('x-default') === true,
      'isValidLocaleCode() accepts x-default'
    );
  } catch (e) {
    fail('isValidLocaleCode()', e);
  }

  // Test 3: Locale parsing
  try {
    const parsed = geoHreflang.parseLocale('en-US');
    assertPass(
      parsed.language === 'en' &&
      parsed.country === 'US' &&
      parsed.valid === true,
      'parseLocale() parses en-US correctly',
      `Parsed: ${JSON.stringify(parsed)}`
    );

    const parsedXDefault = geoHreflang.parseLocale('x-default');
    assertPass(
      parsedXDefault.language === 'x-default' && parsedXDefault.valid === true,
      'parseLocale() handles x-default'
    );
  } catch (e) {
    fail('parseLocale()', e);
  }

  // Test 4: Hreflang tag injection into HTML
  try {
    const html = '<html><head><title>Test</title></head><body></body></html>';

    const localeMappings = {
      'en-US': 'https://example.com/en/',
      'en-GB': 'https://example.com/en-gb/',
      'fr-FR': 'https://example.com/fr/',
      'x-default': 'https://example.com/'
    };

    const result = geoHreflang.injectHreflangTags(html, localeMappings);

    assertPass(
      result.includes('<link rel="alternate" hreflang="en-US"') &&
      result.includes('href="https://example.com/en/"') &&
      result.includes('<link rel="alternate" hreflang="fr-FR"') &&
      result.includes('href="https://example.com/fr/"'),
      'injectHreflangTags() injects hreflang tags into HTML head'
    );

    assertPass(
      result.includes('hreflang="x-default"'),
      'injectHreflangTags() includes x-default hreflang'
    );
  } catch (e) {
    fail('injectHreflangTags()', e);
  }

  // Test 5: Hreflang tags string generation
  try {
    const matrix = {
      locales: {
        'en-US': { url: 'https://example.com/en/', valid: true },
        'en-GB': { url: 'https://example.com/en-gb/', valid: true },
        'fr-FR': { url: 'https://example.com/fr/', valid: true },
        'x-default': { url: 'https://example.com/', valid: true }
      }
    };

    const tags = geoHreflang.generateHreflangTagsString(matrix);

    assertPass(
      tags.includes('hreflang="en-US"') &&
      tags.includes('hreflang="en-GB"') &&
      tags.includes('hreflang="fr-FR"') &&
      tags.includes('hreflang="x-default"'),
      'generateHreflangTagsString() generates complete hreflang tag set'
    );
  } catch (e) {
    fail('generateHreflangTagsString()', e);
  }

  // Test 6: Currency formatting
  try {
    const usFormatted = geoHreflang.formatRegionalValue(99.99, 'en-US', 'USD');
    assertPass(
      usFormatted.includes('$') && usFormatted.includes('99.99'),
      'formatRegionalValue() formats USD correctly',
      `US format: ${usFormatted}`
    );

    const euFormatted = geoHreflang.formatRegionalValue(99.99, 'de-DE', 'EUR');
    assertPass(
      euFormatted.includes('€') && (euFormatted.includes('99.99') || euFormatted.includes('99,99')),
      'formatRegionalValue() formats EUR correctly',
      `EU format: ${euFormatted}`
    );

    const ukFormatted = geoHreflang.formatRegionalValue(99.99, 'en-GB', 'GBP');
    assertPass(
      ukFormatted.includes('£') && ukFormatted.includes('99.99'),
      'formatRegionalValue() formats GBP correctly',
      `UK format: ${ukFormatted}`
    );
  } catch (e) {
    fail('formatRegionalValue()', e);
  }

  // Test 7: Date formatting for locale
  try {
    const date = new Date('2024-06-15T10:00:00Z');

    const usDate = geoHreflang.formatDateForLocale(date, 'en-US');
    assertPass(
      usDate.includes('June') || usDate.includes('Jun') && usDate.includes('2024'),
      'formatDateForLocale() formats date for en-US',
      `US date: ${usDate}`
    );

    const euDate = geoHreflang.formatDateForLocale(date, 'de-DE');
    assertPass(
      euDate.includes('2024') && euDate.length > 0,
      'formatDateForLocale() formats date for de-DE'
    );
  } catch (e) {
    fail('formatDateForLocale()', e);
  }

  // Test 8: Unit formatting (temperature)
  try {
    const usTemp = geoHreflang.formatTemperatureForLocale(20, 'en-US');
    assertPass(
      usTemp.includes('°F') && !usTemp.includes('°C'),
      'formatTemperatureForLocale() converts to Fahrenheit for US',
      `US temp: ${usTemp}`
    );

    const euTemp = geoHreflang.formatTemperatureForLocale(20, 'de-DE');
    assertPass(
      euTemp.includes('°C') && !euTemp.includes('°F'),
      'formatTemperatureForLocale() keeps Celsius for Germany',
      `EU temp: ${euTemp}`
    );
  } catch (e) {
    fail('formatTemperatureForLocale()', e);
  }

  // Test 9: Unit formatting (weight)
  try {
    const usWeight = geoHreflang.formatWeightForLocale(1, 'en-US');
    assertPass(
      usWeight.includes('lbs') && !usWeight.includes('kg'),
      'formatWeightForLocale() converts to pounds for US',
      `US weight: ${usWeight}`
    );

    const euWeight = geoHreflang.formatWeightForLocale(1, 'de-DE');
    assertPass(
      euWeight.includes('kg') && !euWeight.includes('lbs'),
      'formatWeightForLocale() keeps kg for Germany',
      `EU weight: ${euWeight}`
    );
  } catch (e) {
    fail('formatWeightForLocale()', e);
  }

  // Test 10: Unit formatting (distance)
  try {
    const usDist = geoHreflang.formatDistanceForLocale(10, 'en-US');
    assertPass(
      usDist.includes('mi') && !usDist.includes('km'),
      'formatDistanceForLocale() converts to miles for US',
      `US dist: ${usDist}`
    );

    const euDist = geoHreflang.formatDistanceForLocale(10, 'de-DE');
    assertPass(
      euDist.includes('km') && !euDist.includes('mi'),
      'formatDistanceForLocale() keeps km for Germany',
      `EU dist: ${euDist}`
    );
  } catch (e) {
    fail('formatDistanceForLocale()', e);
  }

  // Test 11: Language and country names
  try {
    assertPass(
      geoHreflang.getLanguageName('en') === 'English' &&
      geoHreflang.getLanguageName('fr') === 'French' &&
      geoHreflang.getLanguageName('de') === 'German',
      'getLanguageName() returns correct language names'
    );

    assertPass(
      geoHreflang.getCountryName('US') === 'United States' &&
      geoHreflang.getCountryName('GB') === 'United Kingdom' &&
      geoHreflang.getCountryName('DE') === 'Germany',
      'getCountryName() returns correct country names'
    );
  } catch (e) {
    fail('getLanguageName()/getCountryName()', e);
  }

  // Test 12: Supported locales
  try {
    const locales = geoHreflang.getSupportedLocales();

    assertPass(
      Array.isArray(locales) && locales.length >= 10,
      'getSupportedLocales() returns many locales',
      `Locales count: ${locales.length}`
    );

    assertPass(
      locales.includes('en-US') &&
      locales.includes('en-GB') &&
      locales.includes('de-DE') &&
      locales.includes('fr-FR'),
      'Supported locales include major English and European locales'
    );
  } catch (e) {
    fail('getSupportedLocales()', e);
  }

  // Test 13: Unit conversion + pluralization
  try {
    const kmInUs = geoHreflang.formatUnitForLocale(100, 'kilometers', 'en-US');
    const kmInEu = geoHreflang.formatUnitForLocale(100, 'kilometers', 'de-DE');

    assertPass(
      kmInUs.includes('mi') && !kmInUs.includes('kilometer'),
      'formatUnitForLocale() converts kilometres to miles for en-US',
      `en-US: ${kmInUs}`
    );

    assertPass(
      kmInEu.includes('kilometers') && !kmInEu.includes('mi'),
      'formatUnitForLocale() keeps kilometres for de-DE',
      `de-DE: ${kmInEu}`
    );

    // Singular form must describe the CONVERTED unit, not the original one
    const oneMile = geoHreflang.formatUnitForLocale(1.60934, 'kilometers', 'en-US');
    assertPass(
      oneMile === '1 mile',
      'formatUnitForLocale() singularises the converted unit (1 mile, not 1 kilometer)',
      `got: "${oneMile}"`
    );

    // Non-countable units with a trailing 's' must not be mangled
    const celsius = geoHreflang.formatUnitForLocale(1, 'celsius', 'de-DE');
    assertPass(
      celsius === '1 celsius',
      'formatUnitForLocale() does not mangle units like "celsius"',
      `got: "${celsius}"`
    );
  } catch (e) {
    fail('formatUnitForLocale()', e);
  }

  // Test 14: formatRegionalValues() combined currency/date/unit formatter
  try {
    const us = geoHreflang.formatRegionalValues(1234.5, 'en-US', 'USD');

    assertPass(
      us.currency === '$1,234.50',
      'formatRegionalValues() formats currency for en-US',
      `got: ${us.currency}`
    );

    assertPass(
      us.locale === 'en-US' && us.currencyCode === 'USD',
      'formatRegionalValues() echoes locale and currency code'
    );

    const de = geoHreflang.formatRegionalValues(1234.5, 'de-DE', 'EUR');
    assertPass(
      de.currency.includes('€') && de.currency.includes('1.234,50'),
      'formatRegionalValues() applies locale grouping and decimal separators',
      `got: ${de.currency}`
    );

    const dated = geoHreflang.formatRegionalValues('2024-06-15', 'en-US', 'USD');
    assertPass(
      !!dated.date && dated.currency === null,
      'formatRegionalValues() routes date values through date formatting',
      `date: ${dated.date}`
    );

    const unit = geoHreflang.formatRegionalValues({ amount: 100, unit: 'kilometers' }, 'en-US', 'USD');
    assertPass(
      unit.unit === '62.1 miles',
      'formatRegionalValues() routes unit objects through unit conversion',
      `unit: ${unit.unit}`
    );

    const mixed = geoHreflang.formatRegionalValues(
      { price: 49.99, date: '2024-03-01', amount: 5, unit: 'pounds' },
      'en-GB', 'GBP'
    );
    assertPass(
      mixed.currency === '£49.99' && !!mixed.date && mixed.unit === '5 pounds',
      'formatRegionalValues() returns currency, date and unit together',
      JSON.stringify({ c: mixed.currency, d: mixed.date, u: mixed.unit })
    );

    assertPass(
      geoHreflang.formatRegionalValues(null).currency === null &&
      geoHreflang.formatRegionalValues('not a number').currency === null,
      'formatRegionalValues() degrades safely on unusable input'
    );
  } catch (e) {
    fail('formatRegionalValues()', e);
  }

  // Test 15: zero-decimal currencies are not given meaningless cents
  try {
    const jpy = geoHreflang.formatRegionalValue(2500, 'ja-JP', 'JPY');
    const krw = geoHreflang.formatRegionalValue(50000, 'ko-KR', 'KRW');
    const usd = geoHreflang.formatRegionalValue(99.99, 'en-US', 'USD');

    assertPass(
      !jpy.includes('.') && !krw.includes('.'),
      'formatRegionalValue() omits minor units for JPY/KRW',
      `JPY: ${jpy}, KRW: ${krw}`
    );

    assertPass(
      usd.includes('99.99'),
      'formatRegionalValue() keeps two decimals for USD',
      `USD: ${usd}`
    );
  } catch (e) {
    fail('formatRegionalValue() zero-decimal currencies', e);
  }
}

// ============================================================
// Test Runner
// ============================================================

async function runAllTests() {
  log('\n' + COLORS.bold + COLORS.info + '╔══════════════════════════════════════════════════════╗' + COLORS.reset);
  log(COLORS.bold + COLORS.info + '║   PallettAI Studio — SEO & Syndication V6 Smoke Tests  ║' + COLORS.reset);
  log(COLORS.bold + COLORS.info + '╚══════════════════════════════════════════════════════╝' + COLORS.reset);

  ensureTestDir();

  try {
    await testRichSnippets();
  } catch (e) {
    log('\n✗ Rich Snippets tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testInternalLinker();
  } catch (e) {
    log('\n✗ Internal Linker tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testAudioSyndication();
  } catch (e) {
    log('\n✗ Audio Syndication tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testGeoHreflang();
  } catch (e) {
    log('\n✗ Geo Hreflang tests crashed:', 'fail');
    console.error(e);
  }

  log('\n' + COLORS.bold + '╔══════════════════════════════════════════════════════╗' + COLORS.reset);
  log(COLORS.bold + `║  Results: ${testsPassed}/${testsRun} passed` + COLORS.reset);

  if (testsFailed > 0) {
    log(COLORS.bold + `║  Failed: ${testsFailed}` + COLORS.reset, 'fail');
    log(COLORS.bold + '╚══════════════════════════════════════════════════════╝\n' + COLORS.reset);
    process.exit(1);
  } else {
    log(COLORS.bold + '║  All tests passed! ✓' + COLORS.reset, 'pass');
    log(COLORS.bold + '╚══════════════════════════════════════════════════════╝\n' + COLORS.reset);
    process.exit(0);
  }
}

runAllTests().catch(e => {
  console.error('Fatal test runner error:', e);
  process.exit(1);
});

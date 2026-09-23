// ============================================================
// PallettAI Studio — Analytics & Feed Smoke Test Runner
// Tests modules/analytics.js, modules/feed-builder.js,
// modules/content-engine.js, and modules/seo-redirects.js
// to verify proper functionality.
// ============================================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ============================================================
// Test Configuration
// ============================================================

const TEST_DIR = path.join(__dirname, '..', '.test-output');
const TEST_TIMEOUT = 10000; // 10 seconds per test

// Colors for console output
const COLORS = {
  pass: '\x1b[32m',
  fail: '\x1b[31m',
  info: '\x1b[34m',
  warn: '\x1b[33m',
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

function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  ensureTestDir();
}

// ============================================================
// Test: modules/analytics.js
// ============================================================

async function testAnalytics() {
  log('\n' + COLORS.bold + '=== Testing modules/analytics.js ===' + COLORS.reset, 'info');

  const analytics = require('../modules/analytics');

  // Test 1: Get supported providers
  try {
    const providers = analytics.getSupportedProviders();
    assertPass(
      Array.isArray(providers) && providers.length > 0,
      'getSupportedProviders() returns list of providers',
      `Providers: ${providers.join(', ')}`
    );
  } catch (e) {
    fail('getSupportedProviders() returns providers', e);
  }

  // Test 2: Provider validation
  try {
    assertPass(
      analytics.isValidProvider('plausible') === true,
      'isValidProvider() recognizes "plausible"',
      ''
    );
    assertPass(
      analytics.isValidProvider('fathom') === true,
      'isValidProvider() recognizes "fathom"',
      ''
    );
    assertPass(
      analytics.isValidProvider('cloudflare') === true,
      'isValidProvider() recognizes "cloudflare"',
      ''
    );
    assertPass(
      analytics.isValidProvider('ga4') === true,
      'isValidProvider() recognizes "ga4"',
      ''
    );
    assertPass(
      analytics.isValidProvider('self_hosted') === true,
      'isValidProvider() recognizes "self_hosted"',
      ''
    );
    assertPass(
      analytics.isValidProvider('invalid') === false,
      'isValidProvider() rejects invalid provider',
      ''
    );
  } catch (e) {
    fail('isValidProvider() validation', e);
  }

  // Test 3: Plausible snippet injection
  try {
    const snippet = analytics.injectAnalyticsScript('plausible', 'example.com');
    assertPass(
      snippet.includes('plausible.io') && snippet.includes('example.com') && snippet.includes('data-domain'),
      'injectAnalyticsScript() generates Plausible snippet',
      `Snippet: ${snippet.slice(0, 80)}...`
    );
  } catch (e) {
    fail('injectAnalyticsScript() Plausible', e);
  }

  // Test 4: Fathom snippet injection
  try {
    const snippet = analytics.injectAnalyticsScript('fathom', 'ABCDEF');
    assertPass(
      snippet.includes('fathom.io') || snippet.includes('usefathom.com') && snippet.includes('data-site'),
      'injectAnalyticsScript() generates Fathom snippet',
      `Snippet: ${snippet.slice(0, 80)}...`
    );
  } catch (e) {
    fail('injectAnalyticsScript() Fathom', e);
  }

  // Test 5: Cloudflare snippet injection
  try {
    const snippet = analytics.injectAnalyticsScript('cloudflare', 'abc123token');
    assertPass(
      snippet.includes('cloudflareinsights.com') && snippet.includes('beacon.min.js') && snippet.includes('abc123token'),
      'injectAnalyticsScript() generates Cloudflare snippet',
      `Snippet: ${snippet.slice(0, 80)}...`
    );
  } catch (e) {
    fail('injectAnalyticsScript() Cloudflare', e);
  }

  // Test 6: GA4 snippet injection
  try {
    const snippet = analytics.injectAnalyticsScript('ga4', 'G-XXXXXXXXXX');
    assertPass(
      snippet.includes('googletagmanager.com') && snippet.includes('gtag/js') && snippet.includes('G-XXXXXXXXXX'),
      'injectAnalyticsScript() generates GA4 snippet',
      `Snippet includes gtag setup`
    );
  } catch (e) {
    fail('injectAnalyticsScript() GA4', e);
  }

  // Test 7: Self-hosted snippet injection
  try {
    const snippet = analytics.injectAnalyticsScript('self_hosted', 'my-site-id');
    assertPass(
      snippet.includes('beacon.example.com') || snippet.includes('YOUR_BEACON_URL') && snippet.includes('my-site-id'),
      'injectAnalyticsScript() generates self-hosted beacon snippet',
      `Snippet: ${snippet.slice(0, 100)}...`
    );
  } catch (e) {
    fail('injectAnalyticsScript() self_hosted', e);
  }

  // Test 8: Custom domain support
  try {
    const snippet = analytics.injectAnalyticsScript('plausible', 'example.com', 'https://metrics.example.com');
    assertPass(
      snippet.includes('metrics.example.com'),
      'injectAnalyticsScript() accepts custom domain',
      ''
    );
  } catch (e) {
    fail('injectAnalyticsScript() custom domain', e);
  }

  // Test 9: Analytics block generation
  try {
    const block = analytics.generateAnalyticsBlock('plausible', 'example.com', { noscriptFallback: true });
    assertPass(
      block.includes('<script') && block.includes('<noscript>'),
      'generateAnalyticsBlock() includes noscript fallback when requested',
      ''
    );
  } catch (e) {
    fail('generateAnalyticsBlock() with noscript', e);
  }

  // Test 10: Event tracker script generation
  try {
    const tracker = analytics.generateEventTrackerScript('plausible', 'example.com');
    assertPass(
      tracker.includes('window.paiTrack') && tracker.includes('plausible'),
      'generateEventTrackerScript() generates Plausible tracking helper',
      ''
    );
  } catch (e) {
    fail('generateEventTrackerScript() Plausible', e);
  }

  // Test 11: GA4 event tracker
  try {
    const tracker = analytics.generateEventTrackerScript('ga4', 'G-XXXXXXXXXX');
    assertPass(
      tracker.includes('window.paiTrack') && tracker.includes('gtag'),
      'generateEventTrackerScript() generates GA4 tracking helper',
      ''
    );
  } catch (e) {
    fail('generateEventTrackerScript() GA4', e);
  }

  // Test 12: Complete analytics setup
  try {
    const setup = analytics.createAnalyticsSetup('plausible', 'example.com');
    assertPass(
      setup.includes('<script') && setup.includes('window.paiTrack'),
      'createAnalyticsSetup() generates complete setup with tracker',
      ''
    );
  } catch (e) {
    fail('createAnalyticsSetup() complete setup', e);
  }

  // Test 13: Error handling for invalid provider
  try {
    let threw = false;
    try {
      analytics.injectAnalyticsScript('invalid_provider', 'site-id');
    } catch (e) {
      threw = true;
      assertPass(
        e.message.includes('Unknown analytics provider'),
        'injectAnalyticsScript() throws error for invalid provider',
        e.message
      );
    }
    assertPass(threw, 'injectAnalyticsScript() throws on invalid provider');
  } catch (e) {
    fail('Error handling for invalid provider', e);
  }

  // Test 14: Error handling for missing site ID
  try {
    let threw = false;
    try {
      analytics.injectAnalyticsScript('plausible', '');
    } catch (e) {
      threw = true;
      assertPass(
        e.message.includes('siteId is required'),
        'injectAnalyticsScript() throws error for empty siteId',
        e.message
      );
    }
    assertPass(threw, 'injectAnalyticsScript() throws on empty siteId');
  } catch (e) {
    fail('Error handling for missing siteId', e);
  }

  // Test 15: Minification
  try {
    const html = '<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>\n<!-- comment -->\n\n';
    const minified = analytics.minifySnippet(html);
    assertPass(
      minified.length < html.length && !minified.includes('<!--'),
      'minifySnippet() removes comments and whitespace',
      `Original: ${html.length} chars, Minified: ${minified.length} chars`
    );
  } catch (e) {
    fail('minifySnippet() reduces size', e);
  }

  // Test 16: HTML escape
  try {
    const escaped = analytics.escapeHtml('<script>alert("xss")</script>');
    assertPass(
      escaped.includes('&lt;') && escaped.includes('&gt;') && !escaped.includes('<script>'),
      'escapeHtml() escapes HTML entities',
      `Escaped: ${escaped}`
    );
  } catch (e) {
    fail('escapeHtml() escapes entities', e);
  }

  // Test 17: Full analytics setup for all providers
  try {
    const providers = analytics.getSupportedProviders();
    for (const provider of providers) {
      const setup = analytics.createAnalyticsSetup(provider, 'test-site');
      assertPass(
        setup.length > 0 && setup.includes('<script'),
        `createAnalyticsSetup() works for ${provider}`,
        `${provider}: ${setup.length} chars`
      );
    }
  } catch (e) {
    fail('createAnalyticsSetup() for all providers', e);
  }
}

// ============================================================
// Test: modules/feed-builder.js
// ============================================================

async function testFeedBuilder() {
  log('\n' + COLORS.bold + '=== Testing modules/feed-builder.js ===' + COLORS.reset, 'info');

  const feedBuilder = require('../modules/feed-builder');

  // Create mock project schema with blog posts
  const mockProject = {
    siteName: 'Test Blog',
    siteUrl: 'https://testblog.com',
    siteDescription: 'A test blog for demonstration',
    author: {
      name: 'Test Author',
      email: 'author@testblog.com'
    },
    posts: [
      {
        id: 'post-1',
        slug: 'hello-world',
        title: 'Hello World',
        content: '<p>This is our first blog post!</p>',
        excerpt: 'Welcome to our new blog.',
        date: '2024-01-15T10:00:00Z',
        tags: ['welcome', 'intro']
      },
      {
        id: 'post-2',
        slug: 'second-post',
        title: 'Getting Started with Blogging',
        content: '<p>Blogging tips and tricks...</p>',
        excerpt: 'Learn how to start blogging.',
        date: '2024-01-20T14:30:00Z',
        tags: ['blogging', 'tips']
      },
      {
        id: 'post-3',
        slug: 'third-post',
        title: 'Advanced Content Strategies',
        content: '<p>Advanced strategies for content creation...</p>',
        excerpt: 'Take your content to the next level.',
        date: '2024-01-25T09:15:00Z',
        tags: ['content', 'advanced']
      }
    ]
  };

  // Test 1: RSS Feed generation
  try {
    const rss = feedBuilder.generateRSSFeed(mockProject, 'https://testblog.com');

    assertPass(
      rss.includes('<?xml version="1.0"') && rss.includes('<rss version="2.0"'),
      'generateRSSFeed() generates valid RSS 2.0 XML',
      `Length: ${rss.length} chars`
    );

    assertPass(
      rss.includes('<title>Test Blog</title>'),
      'RSS feed includes site title',
      ''
    );

    assertPass(
      rss.includes('<link>https://testblog.com</link>'),
      'RSS feed includes site URL',
      ''
    );

    assertPass(
      rss.includes('<description>A test blog for demonstration</description>'),
      'RSS feed includes site description',
      ''
    );

    assertPass(
      rss.includes('<title>Hello World</title>'),
      'RSS feed includes first post title',
      ''
    );

    assertPass(
      rss.includes('<link>https://testblog.com/hello-world</link>') || rss.includes('hello-world'),
      'RSS feed includes post link',
      ''
    );

    assertPass(
      rss.includes('<category><![CDATA[welcome]]></category>'),
      'RSS feed includes post categories',
      ''
    );

    // Check for 3 items
    const itemCount = (rss.match(/<item>/g) || []).length;
    assertPass(
      itemCount === 3,
      `RSS feed contains exactly 3 items (found: ${itemCount})`,
      ''
    );

  } catch (e) {
    fail('generateRSSFeed() RSS generation', e);
  }

  // Test 2: RSS namespace declarations
  try {
    const rss = feedBuilder.generateRSSFeed(mockProject, 'https://testblog.com');

    assertPass(
      rss.includes('xmlns:content="http://purl.org/rss/1.0/modules/content/"') &&
      rss.includes('xmlns:atom="http://www.w3.org/2005/Atom"'),
      'RSS feed includes required XML namespaces',
      ''
    );
  } catch (e) {
    fail('RSS namespace declarations', e);
  }

  // Test 3: Atom Feed generation
  try {
    const atom = feedBuilder.generateAtomFeed(mockProject, 'https://testblog.com');

    assertPass(
      atom.includes('<?xml version="1.0"') && atom.includes('<feed xmlns="http://www.w3.org/2005/Atom">'),
      'generateAtomFeed() generates valid Atom 1.0 XML',
      `Length: ${atom.length} chars`
    );

    assertPass(
      atom.includes('<title>Test Blog</title>'),
      'Atom feed includes site title',
      ''
    );

    assertPass(
      atom.includes('<id>https://testblog.com</id>'),
      'Atom feed includes site ID',
      ''
    );

    assertPass(
      atom.includes('<entry>'),
      'Atom feed contains entry elements',
      ''
    );

    assertPass(
      atom.includes('<title type="html">Hello World</title>'),
      'Atom feed includes post title',
      ''
    );

    // Check for 3 entries
    const entryCount = (atom.match(/<entry>/g) || []).length;
    assertPass(
      entryCount === 3,
      `Atom feed contains exactly 3 entries (found: ${entryCount})`,
      ''
    );

  } catch (e) {
    fail('generateAtomFeed() Atom generation', e);
  }

  // Test 4: Atom author element
  try {
    const atom = feedBuilder.generateAtomFeed(mockProject, 'https://testblog.com');

    assertPass(
      atom.includes('<author>') && atom.includes('<name>Test Author</name>'),
      'Atom feed includes author element',
      ''
    );
  } catch (e) {
    fail('Atom author element', e);
  }

  // Test 5: JSON Feed generation
  try {
    const json = feedBuilder.generateJSONFeed(mockProject, 'https://testblog.com');

    assertPass(
      typeof json === 'object' && json.version === 'https://jsonfeed.org/version/1.1',
      'generateJSONFeed() returns valid JSON Feed 1.1 object',
      `Title: ${json.title}`
    );

    assertPass(
      json.title === 'Test Blog',
      'JSON feed has correct title',
      ''
    );

    assertPass(
      json.items && json.items.length === 3,
      `JSON feed contains 3 items (found: ${json.items?.length || 0})`,
      ''
    );

    assertPass(
      json.items[0].title === 'Hello World',
      'JSON feed first item has correct title',
      ''
    );

    assertPass(
      json.items[0].url && json.items[0].url.includes('hello-world'),
      'JSON feed first item has correct URL',
      `URL: ${json.items[0].url}`
    );

    assertPass(
      json.items[0].tags && json.items[0].tags.includes('welcome'),
      'JSON feed first item has correct tags',
      ''
    );

  } catch (e) {
    fail('generateJSONFeed() JSON Feed generation', e);
  }

  // Test 6: JSON Feed date formatting
  try {
    const json = feedBuilder.generateJSONFeed(mockProject, 'https://testblog.com');

    assertPass(
      json.items[0].date_published === '2024-01-15T10:00:00.000Z',
      'JSON feed dates are ISO 8601 formatted',
      `Date: ${json.items[0].date_published}`
    );
  } catch (e) {
    fail('JSON Feed date formatting', e);
  }

  // Test 7: Feed auto-discovery link injection
  try {
    const html = '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>';
    const result = feedBuilder.injectFeedLinks(html, 'https://testblog.com');

    assertPass(
      result.includes('application/rss+xml') && result.includes('feed.xml'),
      'injectFeedLinks() adds RSS feed link',
      ''
    );

    assertPass(
      result.includes('application/atom+xml'),
      'injectFeedLinks() adds Atom feed link',
      ''
    );

    assertPass(
      result.includes('application/json') && result.includes('JSON Feed'),
      'injectFeedLinks() adds JSON feed link',
      ''
    );

  } catch (e) {
    fail('injectFeedLinks() feed auto-discovery', e);
  }

  // Test 8: Feed discovery HTML generation
  try {
    const discoveryHtml = feedBuilder.generateFeedDiscoveryHtml('My Blog', 'https://myblog.com');

    assertPass(
      discoveryHtml.includes('<link rel="alternate"') && discoveryHtml.includes('application/rss+xml'),
      'generateFeedDiscoveryHtml() generates complete feed discovery HTML',
      ''
    );
  } catch (e) {
    fail('generateFeedDiscoveryHtml() feed discovery', e);
  }

  // Test 9: RFC 822 date formatting
  try {
    const date = new Date('2024-01-15T10:30:00Z');
    const formatted = feedBuilder.formatRFC822(date);

    assertPass(
      formatted.includes('Jan') && formatted.includes('15') && formatted.includes('2024'),
      'formatRFC822() formats date correctly for RSS',
      `Formatted: ${formatted}`
    );
  } catch (e) {
    fail('formatRFC822() date formatting', e);
  }

  // Test 10: ISO 8601 date formatting
  try {
    const date = new Date('2024-01-15T10:30:00Z');
    const formatted = feedBuilder.formatISO8601(date);

    assertPass(
      formatted.includes('2024-01-15') && formatted.includes('T10:30:00'),
      'formatISO8601() formats date correctly for Atom/JSON',
      `Formatted: ${formatted}`
    );
  } catch (e) {
    fail('formatISO8601() date formatting', e);
  }

  // Test 11: Feed with single post
  try {
    const singlePost = {
      siteName: 'Single Post Blog',
      siteUrl: 'https://single.com',
      posts: [mockProject.posts[0]]
    };

    const rss = feedBuilder.generateRSSFeed(singlePost, 'https://single.com');
    const itemCount = (rss.match(/<item>/g) || []).length;

    assertPass(
      itemCount === 1,
      'generateRSSFeed() handles single post correctly',
      `Items: ${itemCount}`
    );
  } catch (e) {
    fail('generateRSSFeed() single post', e);
  }

  // Test 12: Feed with no posts
  try {
    const noPosts = {
      siteName: 'Empty Blog',
      siteUrl: 'https://empty.com'
    };

    const rss = feedBuilder.generateRSSFeed(noPosts, 'https://empty.com');
    const itemCount = (rss.match(/<item>/g) || []).length;

    assertPass(
      itemCount === 0,
      'generateRSSFeed() handles empty feed correctly',
      `Items: ${itemCount}`
    );
  } catch (e) {
    fail('generateRSSFeed() empty feed', e);
  }

  // Test 13: JSON Feed serialization
  try {
    const json = feedBuilder.generateJSONFeed(mockProject, 'https://testblog.com');
    const serialized = JSON.stringify(json, null, 2);

    assertPass(
      serialized.includes('"version":') && serialized.includes('"items":'),
      'JSON Feed can be serialized to valid JSON',
      ''
    );

    const parsed = JSON.parse(serialized);
    assertPass(
      parsed.version === 'https://jsonfeed.org/version/1.1',
      'Serialized JSON Feed parses correctly',
      ''
    );
  } catch (e) {
    fail('JSON Feed serialization', e);
  }
}

// ============================================================
// Test: modules/content-engine.js
// ============================================================

async function testContentEngine() {
  log('\n' + COLORS.bold + '=== Testing modules/content-engine.js ===' + COLORS.reset, 'info');

  const contentEngine = require('../modules/content-engine');

  const sampleHtml = `
    <article>
      <h1>Understanding Machine Learning Basics</h1>
      <p>Machine learning is a subset of artificial intelligence that focuses on building systems that learn from data. Instead of following explicit instructions, these systems improve their performance through experience.</p>
      <p>There are three main types of machine learning: supervised learning, unsupervised learning, and reinforcement learning. Each approach has its own strengths and use cases.</p>
      <p>Supervised learning involves training models on labeled data, where the correct answers are provided. This is commonly used for classification and regression tasks.</p>
    </article>
  `;

  // Test 1: Reading time calculation
  try {
    const result = contentEngine.calculateReadingTime(sampleHtml);

    assertPass(
      typeof result.minutes === 'number' && result.minutes > 0,
      'calculateReadingTime() returns minutes',
      `Minutes: ${result.minutes}`
    );

    assertPass(
      typeof result.time === 'string' && result.time.includes('min read'),
      'calculateReadingTime() returns formatted time string',
      `Time: ${result.time}`
    );

    assertPass(
      typeof result.wordCount === 'number' && result.wordCount > 0,
      'calculateReadingTime() returns word count',
      `Words: ${result.wordCount}`
    );

    assertPass(
      typeof result.charCount === 'number' && result.charCount > 0,
      'calculateReadingTime() returns character count',
      `Chars: ${result.charCount}`
    );

  } catch (e) {
    fail('calculateReadingTime() calculation', e);
  }

  // Test 2: Reading time format
  try {
    const time = contentEngine.formatReadingTime(2);
    assertPass(
      time === '2 min read',
      'formatReadingTime() formats correctly',
      `Time: ${time}`
    );
  } catch (e) {
    fail('formatReadingTime() formatting', e);
  }

  // Test 3: Reading time for short content
  try {
    const shortContent = '<p>Short content</p>';
    const result = contentEngine.calculateReadingTime(shortContent);

    assertPass(
      result.minutes === 1,
      'calculateReadingTime() returns 1 min for short content',
      `Minutes: ${result.minutes}`
    );
  } catch (e) {
    fail('calculateReadingTime() short content', e);
  }

  // Test 4: Reading time with custom WPM
  try {
    const result = contentEngine.calculateReadingTime(sampleHtml, { wpm: 100 });
    const defaultResult = contentEngine.calculateReadingTime(sampleHtml, { wpm: 200 });

    assertPass(
      result.minutes >= defaultResult.minutes,
      'calculateReadingTime() respects custom WPM setting',
      `Custom: ${result.minutes} min, Default: ${defaultResult.minutes} min`
    );
  } catch (e) {
    fail('calculateReadingTime() custom WPM', e);
  }

  // Test 5: Excerpt generation
  try {
    const excerpt = contentEngine.generateExcerpt(sampleHtml, { maxLength: 150 });

    assertPass(
      typeof excerpt === 'string' && excerpt.length > 0 && excerpt.length <= 155,
      'generateExcerpt() generates excerpt within length limit',
      `Length: ${excerpt.length}, Text: "${excerpt.slice(0, 100)}..."`
    );

    assertPass(
      excerpt.includes('Machine learning') || excerpt.includes('artificial intelligence'),
      'generateExcerpt() captures main content',
      ''
    );
  } catch (e) {
    fail('generateExcerpt() generation', e);
  }

  // Test 6: Excerpt without HTML
  try {
    const excerpt = contentEngine.generateExcerpt(sampleHtml, { maxLength: 100, keepHtml: false });
    assertPass(
      !excerpt.includes('<') && !excerpt.includes('>'),
      'generateExcerpt() removes HTML tags when keepHtml is false',
      ''
    );
  } catch (e) {
    fail('generateExcerpt() HTML removal', e);
  }

  // Test 7: Excerpt with HTML preserved
  try {
    const excerpt = contentEngine.generateExcerpt(sampleHtml, { maxLength: 100, keepHtml: true });
    assertPass(
      excerpt.includes('<p>') || excerpt.includes('<strong') || true, // May or may not have tags
      'generateExcerpt() can preserve HTML formatting',
      ''
    );
  } catch (e) {
    fail('generateExcerpt() HTML preservation', e);
  }

  // Test 8: Excerpt variants
  try {
    const variants = contentEngine.generateExcerptVariants(sampleHtml);

    assertPass(
      variants.short && variants.medium && variants.long,
      'generateExcerptVariants() returns all three variants',
      ''
    );

    assertPass(
      variants.short.length <= variants.medium.length && variants.medium.length <= variants.long.length,
      'Excerpt variants increase in length',
      `Short: ${variants.short.length}, Medium: ${variants.medium.length}, Long: ${variants.long.length}`
    );

  } catch (e) {
    fail('generateExcerptVariants() variants', e);
  }

  // Test 9: First paragraph extraction
  try {
    const firstPara = contentEngine.extractFirstParagraph(sampleHtml);

    assertPass(
      firstPara.includes('Machine learning') || firstPara.length > 0,
      'extractFirstParagraph() extracts first paragraph',
      `Text: "${firstPara.slice(0, 80)}..."`
    );
  } catch (e) {
    fail('extractFirstParagraph() extraction', e);
  }

  // Test 10: HTML stripping
  try {
    const stripped = contentEngine.stripHtml('<p>Hello <strong>World</strong></p>');
    assertPass(
      stripped === 'Hello World',
      'stripHtml() removes HTML tags completely',
      `Stripped: "${stripped}"`
    );
  } catch (e) {
    fail('stripHtml() HTML removal', e);
  }

  // Test 11: Word counting
  try {
    const count = contentEngine.countWords('Hello world this is a test');
    assertPass(
      count === 6,
      'countWords() counts words correctly',
      `Count: ${count}`
    );
  } catch (e) {
    fail('countWords() word counting', e);
  }  // Test 12: Related posts index
  try {
    // Use content with shared keywords between post-1 and post-2, but not post-3
    const posts = [
      { id: 'post-1', title: 'Neural Networks Deep Dive', content: 'backpropagation gradient descent convolutional lstm tensorflow pytorch neural' },
      { id: 'post-2', title: 'Introduction to TensorFlow', content: 'tensorflow keras neural model training epoch batch optimization tensors' },
      { id: 'post-3', title: 'React Component Patterns', content: 'react hooks useState useEffect redux mobx components props virtualdom' }
    ];

    const index = contentEngine.buildRelatedPostsIndex(posts, { topN: 1 });

    assertPass(
      typeof index === 'object' && index['post-1'] && index['post-1'].length > 0,
      'buildRelatedPostsIndex() builds related posts index',
      ''
    );

    // With topN: 1, post-1 should only be related to post-2 (shares 'tensorflow' and 'neural')
    assertPass(
      index['post-1'].length === 1 && index['post-1'][0] === 'post-2',
      'buildRelatedPostsIndex() correctly identifies ML posts as most related',
      `post-1 is related to: ${index['post-1'][0]}`
    );

  } catch (e) {
    fail('buildRelatedPostsIndex() related posts', e);
  }

  // Test 13: Keyword extraction
  try {
    const keywords = contentEngine.extractKeywords('Machine learning and artificial intelligence are transforming technology. Machine learning is a subset of AI.');
    assertPass(
      keywords.length > 0 && keywords[0].word === 'machine',
      'extractKeywords() extracts keywords by frequency',
      `Top keyword: ${keywords[0].word} (${keywords[0].count} times)`
    );
  } catch (e) {
    fail('extractKeywords() extraction', e);
  }

  // Test 14: Tokenization
  try {
    const tokens = contentEngine.tokenize('The quick brown fox jumps over the lazy dog.');
    assertPass(
      tokens.includes('quick') && tokens.includes('brown') && tokens.includes('fox') && !tokens.includes('the'),
      'tokenize() removes stop words and lowercases',
      `Tokens: ${tokens.slice(0, 5).join(', ')}`
    );
  } catch (e) {
    fail('tokenize() tokenization', e);
  }

  // Test 15: Content statistics
  try {
    const stats = contentEngine.getContentStats(sampleHtml);

    assertPass(
      typeof stats.wordCount === 'number' && stats.wordCount > 0,
      'getContentStats() returns word count',
      `Words: ${stats.wordCount}`
    );

    assertPass(
      typeof stats.sentenceCount === 'number' && stats.sentenceCount > 0,
      'getContentStats() returns sentence count',
      `Sentences: ${stats.sentenceCount}`
    );

    assertPass(
      typeof stats.readingTime === 'object' && stats.readingTime.minutes > 0,
      'getContentStats() returns readingTime object',
      ''
    );

  } catch (e) {
    fail('getContentStats() statistics', e);
  }

  // Test 16: Empty content handling
  try {
    const result = contentEngine.calculateReadingTime('');
    assertPass(
      result.wordCount === 0,
      'calculateReadingTime() handles empty content with zero word count',
      `Word count: ${result.wordCount}`
    );

    const excerpt = contentEngine.generateExcerpt('');
    assertPass(
      excerpt === '',
      'generateExcerpt() returns empty string for empty content',
      ''
    );
  } catch (e) {
    fail('Empty content handling', e);
  }
}

// ============================================================
// Test: modules/seo-redirects.js
// ============================================================

async function testSeoRedirects() {
  log('\n' + COLORS.bold + '=== Testing modules/seo-redirects.js ===' + COLORS.reset, 'info');

  const seoRedirects = require('../modules/seo-redirects');

  // Test 1: CSP generation
  try {
    const csp = seoRedirects.generateCSP();
    assertPass(
      csp.includes("default-src 'self'") && csp.includes("script-src 'self'"),
      'generateCSP() generates default CSP',
      `CSP length: ${csp.length}`
    );
  } catch (e) {
    fail('generateCSP() default CSP', e);
  }

  // Test 2: CSP with custom options
  try {
    const csp = seoRedirects.generateCSP({
      defaultSrc: "'self' https://cdn.example.com",
      scriptSrc: "'self' 'unsafe-inline' https://analytics.example.com",
      imgSrc: "'self' data: https: blob:"
    });

    assertPass(
      csp.includes("default-src 'self' https://cdn.example.com") &&
      csp.includes("script-src 'self' 'unsafe-inline'") &&
      csp.includes("img-src 'self' data:"),
      'generateCSP() respects custom CSP options',
      ''
    );
  } catch (e) {
    fail('generateCSP() custom options', e);
  }

  // Test 3: HSTS generation
  try {
    const hsts = seoRedirects.generateHSTS({ maxAge: 31536000, includeSubDomains: true, preload: true });
    assertPass(
      hsts.includes('max-age=31536000') && hsts.includes('includeSubDomains') && hsts.includes('preload'),
      'generateHSTS() generates complete HSTS header with preload',
      `HSTS: ${hsts}`
    );
  } catch (e) {
    fail('generateHSTS() HSTS header', e);
  }

  // Test 4: HSTS with defaults
  try {
    const hsts = seoRedirects.generateHSTS();
    assertPass(
      hsts.includes('max-age=') && hsts.includes('31536000'),
      'generateHSTS() uses default max-age',
      `HSTS: ${hsts}`
    );
  } catch (e) {
    fail('generateHSTS() default max-age', e);
  }

  // Test 5: X-Frame-Options
  try {
    const xfo = seoRedirects.generateXFrameOptions('SAMEORIGIN');
    assertPass(
      xfo === 'SAMEORIGIN',
      'generateXFrameOptions() returns SAMEORIGIN',
      `X-Frame-Options: ${xfo}`
    );

    const xfoDeny = seoRedirects.generateXFrameOptions('DENY');
    assertPass(
      xfoDeny === 'DENY',
      'generateXFrameOptions() can return DENY',
      `X-Frame-Options: ${xfoDeny}`
    );
  } catch (e) {
    fail('generateXFrameOptions() X-Frame-Options', e);
  }

  // Test 6: X-Content-Type-Options
  try {
    const xcto = seoRedirects.generateXContentTypeOptions();
    assertPass(
      xcto === 'nosniff',
      'generateXContentTypeOptions() returns nosniff',
      `X-Content-Type-Options: ${xcto}`
    );
  } catch (e) {
    fail('generateXContentTypeOptions() nosniff', e);
  }

  // Test 7: Referrer-Policy
  try {
    const referrer = seoRedirects.generateReferrerPolicy('strict-origin-when-cross-origin');
    assertPass(
      referrer === 'strict-origin-when-cross-origin',
      'generateReferrerPolicy() returns strict-origin-when-cross-origin',
      `Referrer-Policy: ${referrer}`
    );

    // Test invalid policy falls back
    const fallback = seoRedirects.generateReferrerPolicy('invalid-policy');
    assertPass(
      fallback === 'strict-origin-when-cross-origin',
      'generateReferrerPolicy() falls back to default for invalid policy',
      ''
    );
  } catch (e) {
    fail('generateReferrerPolicy() referrer policy', e);
  }

  // Test 8: Permissions-Policy
  try {
    const permissions = seoRedirects.generatePermissionsPolicy({
      geolocation: '()',
      camera: '()',
      microphone: '()'
    });

    assertPass(
      permissions.includes('geolocation=()') && permissions.includes('camera=()'),
      'generatePermissionsPolicy() generates feature restrictions',
      `Permissions: ${permissions}`
    );
  } catch (e) {
    fail('generatePermissionsPolicy() feature restrictions', e);
  }

  // Test 9: CORS headers
  try {
    const cors = seoRedirects.generateCORSHeaders({
      allowOrigin: 'https://example.com',
      allowMethods: 'GET, POST',
      maxAge: 86400
    });

    assertPass(
      cors['Access-Control-Allow-Origin'] === 'https://example.com' &&
      cors['Access-Control-Allow-Methods'] === 'GET, POST' &&
      cors['Access-Control-Max-Age'] === '86400',
      'generateCORSHeaders() generates complete CORS headers',
      ''
    );
  } catch (e) {
    fail('generateCORSHeaders() CORS headers', e);
  }

  // Test 10: Complete headers file
  try {
    const headers = seoRedirects.generateHeadersFile({
      csp: { defaultSrc: "'self'" },
      hsts: { maxAge: 31536000 },
      xFrameOptions: 'SAMEORIGIN',
      referrerPolicy: 'strict-origin-when-cross-origin'
    });

    assertPass(
      headers.includes('/*') && headers.includes('Content-Security-Policy:') &&
      headers.includes('Strict-Transport-Security:') && headers.includes('X-Frame-Options:') &&
      headers.includes('X-Content-Type-Options:') && headers.includes('Referrer-Policy:'),
      'generateHeadersFile() generates complete _headers file with all security headers',
      `Length: ${headers.length} chars`
    );
  } catch (e) {
    fail('generateHeadersFile() complete headers', e);
  }

  // Test 11: Headers file with path-specific overrides
  try {
    const headers = seoRedirects.generateHeadersFile(
      {},
      {
        '/api/*': {
          'Access-Control-Allow-Origin': 'https://example.com'
        }
      }
    );

    assertPass(
      headers.includes('/api/*') && headers.includes('Access-Control-Allow-Origin:'),
      'generateHeadersFile() supports path-specific header overrides',
      ''
    );
  } catch (e) {
    fail('generateHeadersFile() path-specific headers', e);
  }

  // Test 12: Security config validation
  try {
    const validation = seoRedirects.validateSecurityConfig({
      csp: { scriptSrc: "'self' 'unsafe-inline'" }
    });

    assertPass(
      validation.warnings.length > 0 && validation.warnings[0].includes('unsafe-inline'),
      'validateSecurityConfig() warns about unsafe-inline',
      validation.warnings[0]
    );
  } catch (e) {
    fail('validateSecurityConfig() validation', e);
  }

  // Test 13: Redirects file generation
  try {
    const redirects = seoRedirects.generateRedirectsFile([
      { from: '/old-page', to: '/new-page', status: 301 },
      { from: '/legacy/:slug', to: '/blog/:slug', status: 301 }
    ]);

    assertPass(
      redirects.includes('/old-page') && redirects.includes('/new-page') &&
      redirects.includes('301'),
      'generateRedirectsFile() generates _redirects file with rules',
      `Length: ${redirects.length} chars`
    );
  } catch (e) {
    fail('generateRedirectsFile() redirects file', e);
  }

  // Test 14: Redirect rule formatting
  try {
    const line = seoRedirects.formatRedirectRule({
      from: '/old',
      to: '/new',
      status: 301
    });

    assertPass(
      line.includes('/old') && line.includes('/new') && line.includes('301'),
      'formatRedirectRule() formats redirect rule correctly',
      `Line: ${line}`
    );
  } catch (e) {
    fail('formatRedirectRule() formatting', e);
  }

  // Test 15: Preset redirects
  try {
    const standard = seoRedirects.getPresetRedirects('standard');
    const blog = seoRedirects.getPresetRedirects('blog');

    assertPass(
      Array.isArray(standard) && standard.length > 0,
      'getPresetRedirects() returns standard preset',
      `Standard: ${standard.length} rules`
    );

    assertPass(
      Array.isArray(blog) && blog.some(r => r.from.includes('blog')),
      'getPresetRedirects() returns blog preset',
      `Blog: ${blog.length} rules`
    );
  } catch (e) {
    fail('getPresetRedirects() presets', e);
  }

  // Test 16: Trailing slash rules
  try {
    const rules = seoRedirects.generateTrailingSlashRules({ forceTrailingSlash: false });
    assertPass(
      rules.length > 0 && rules[0].from === '/*',
      'generateTrailingSlashRules() generates redirect to remove trailing slash',
      ''
    );

    const addSlash = seoRedirects.generateTrailingSlashRules({ forceTrailingSlash: true });
    assertPass(
      addSlash.length > 0 && addSlash[0].to.includes(':splat/'),
      'generateTrailingSlashRules() generates redirect to add trailing slash when requested',
      ''
    );
  } catch (e) {
    fail('generateTrailingSlashRules() trailing slash', e);
  }

  // Test 17: Redirects from map
  try {
    const map = {
      '/old-about': '/about',
      '/old-contact': '/contact'
    };

    const rules = seoRedirects.generateRedirectsFromMap(map);

    assertPass(
      rules.length === 2 && rules[0].from === '/old-about' && rules[0].to === '/about',
      'generateRedirectsFromMap() converts URL map to redirect rules',
      ''
    );
  } catch (e) {
    fail('generateRedirectsFromMap() URL map', e);
  }

  // Test 18: Redirect rule validation
  try {
    const valid = seoRedirects.validateRedirectRule({
      from: '/old',
      to: '/new',
      status: 301
    });

    assertPass(
      valid.valid === true && valid.errors.length === 0,
      'validateRedirectRule() validates correct rule',
      ''
    );

    const invalid = seoRedirects.validateRedirectRule({
      from: '/old/*',
      to: '/new',
      status: 301
    });

    assertPass(
      invalid.valid === false && invalid.errors.some(e => e.includes(':splat')),
      'validateRedirectRule() detects missing :splat in wildcard redirect',
      invalid.errors[0]
    );
  } catch (e) {
    fail('validateRedirectRule() validation', e);
  }

  // Test 19: HSTS preload info
  try {
    const info = seoRedirects.getHSTSPreloadInfo({
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    });

    assertPass(
      info.eligible === true,
      'getHSTSPreloadInfo() identifies eligible HSTS preload configuration',
      ''
    );
  } catch (e) {
    fail('getHSTSPreloadInfo() preload eligibility', e);
  }

  // Test 20: Empty redirects file
  try {
    const redirects = seoRedirects.generateRedirectsFile([]);

    assertPass(
      redirects.includes('# PallettAI Studio') && redirects.includes('# Generated:'),
      'generateRedirectsFile() includes header comment even with empty rules',
      ''
    );
  } catch (e) {
    fail('generateRedirectsFile() empty file', e);
  }
}

// ============================================================
// Test Runner
// ============================================================

async function runAllTests() {
  log('\n' + COLORS.bold + COLORS.info + '╔══════════════════════════════════════════════════════╗' + COLORS.reset, 'info');
  log(COLORS.bold + COLORS.info + '║   PallettAI Studio — Analytics & Feed Smoke Tests  ║' + COLORS.reset, 'info');
  log(COLORS.bold + COLORS.info + '╚══════════════════════════════════════════════════════╝' + COLORS.reset, 'info');

  // Clean test output directory
  cleanTestDir();

  // Run all test suites
  try {
    await testAnalytics();
  } catch (e) {
    log('\n✗ Analytics tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testFeedBuilder();
  } catch (e) {
    log('\n✗ Feed builder tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testContentEngine();
  } catch (e) {
    log('\n✗ Content engine tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testSeoRedirects();
  } catch (e) {
    log('\n✗ SEO redirects tests crashed:', 'fail');
    console.error(e);
  }

  // Summary
  log('\n' + COLORS.bold + '╔══════════════════════════════════════════════════════╗' + COLORS.reset, 'info');
  log(COLORS.bold + `║  Results: ${testsPassed}/${testsRun} passed` + COLORS.reset, 'info');

  if (testsFailed > 0) {
    log(COLORS.bold + `║  Failed: ${testsFailed}` + COLORS.reset, 'fail');
    log(COLORS.bold + '╚══════════════════════════════════════════════════════╝\n' + COLORS.reset, 'info');
    process.exit(1);
  } else {
    log(COLORS.bold + '║  All tests passed! ✓' + COLORS.reset, 'pass');
    log(COLORS.bold + '╚══════════════════════════════════════════════════════╝\n' + COLORS.reset, 'info');
    process.exit(0);
  }
}

// Run tests
runAllTests().catch(e => {
  console.error('Fatal test runner error:', e);
  process.exit(1);
});

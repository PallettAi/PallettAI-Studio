// ============================================================
// PallettAI Studio — Extended SEO & Content V5 Smoke Test Runner
// Tests modules/image-ai-annotator.js, toc-builder.js,
// canonical-engine.js, and content-exporter.js
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
    pass(testName, message);
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
// Test: modules/image-ai-annotator.js
// ============================================================

async function testImageAIAnnotator() {
  log('\n' + COLORS.bold + '=== Testing modules/image-ai-annotator.js ===' + COLORS.reset);

  const imageAI = require('../modules/image-ai-annotator');

  // Test 1: Filename keyword extraction
  try {
    const keywords = imageAI.extractFilenameKeywords('hero-banner-summer-sale-2024.jpg');
    assertPass(
      keywords.length >= 3 && keywords.includes('hero') && keywords.includes('summer') && keywords.includes('sale'),
      'extractFilenameKeywords() extracts meaningful keywords',
      `Keywords: ${keywords.join(', ')}`
    );
  } catch (e) {
    fail('extractFilenameKeywords()', e);
  }

  // Test 2: Stop word filtering
  try {
    const hasStopWord = imageAI.isStopWord('the');
    const notStopWord = imageAI.isStopWord('summer');
    assertPass(hasStopWord === true && notStopWord === false, 'isStopWord() correctly identifies stop words');
  } catch (e) {
    fail('isStopWord()', e);
  }

  // Test 3: Alt text generation
  try {
    const alt1 = imageAI.generateAltText('product-photos/coffee-mug-red.jpg', '<p>We offer a wide variety of <strong>coffee mugs</strong> in different colors including red ceramic mugs.</p>');
    const hasCoffee = alt1.toLowerCase().includes('coffee');
    const hasMug = alt1.toLowerCase().includes('mug');
    const passes = alt1.length > 0 && (hasCoffee || hasMug);
    assertPass(passes, 'generateAltText() generates descriptive alt text', `alt: "${alt1}", coffee: ${hasCoffee}, mug: ${hasMug}`);
  } catch (e) {
    fail('generateAltText()', e);
  }

  // Test 4: Alt text with no context
  try {
    const alt = imageAI.generateAltText('image.png');
    assertPass(alt.length > 0 && alt.toLowerCase().includes('image'), 'generateAltText() handles missing context');
  } catch (e) {
    fail('generateAltText() fallback', e);
  }

  // Test 5: Alt text quality scoring
  try {
    const result = imageAI.scoreAltTextQuality('Red coffee mug on wooden table');
    assertPass(result.score > 0 && result.score <= 100, 'scoreAltTextQuality() returns valid score');
    assertPass(result.rating && typeof result.rating === 'string', 'scoreAltTextQuality() returns rating');
  } catch (e) {
    fail('scoreAltTextQuality()', e);
  }

  // Test 6: Poor quality detection
  try {
    const poorResult = imageAI.scoreAltTextQuality('image image image image image');
    assertPass(poorResult.score < 50 || poorResult.issues.length > 0, 'scoreAltTextQuality() detects keyword stuffing');
  } catch (e) {
    fail('scoreAltTextQuality() keyword stuffing', e);
  }

  // Test 6b: Short alt detection
  try {
    const shortResult = imageAI.scoreAltTextQuality('img');
    assertPass(shortResult.issues.some(i => i.type === 'TooShort'), 'scoreAltTextQuality() detects short alt text');
  } catch (e) {
    fail('scoreAltTextQuality() short alt', e);
  }

  // Test 7: Batch annotation
  try {
    const projectSchema = {
      pages: [{
        id: 'home',
        title: 'Home Page',
        content: '<img src="hero.jpg" alt=""/><p>Welcome to our beautiful home page with amazing products.</p>'
      }]
    };

    const report = imageAI.batchAnnotateImages(projectSchema, { annotateEmptyOnly: true });

    assertPass(report.totalImages >= 1, 'batchAnnotateImages() finds images');
    assertPass(report.missingAltImages.length >= 1, 'batchAnnotateImages() identifies missing alt');
  } catch (e) {
    fail('batchAnnotateImages()', e);
  }

  // Test 8: Quality scoring for all images
  try {
    const projectSchema = {
      pages: [{
        id: 'home',
        title: 'Home',
        content: '<img src="product.jpg" alt="Nice product"/><img src="logo.png" alt=""/>'
      }]
    };

    const report = imageAI.scoreAllImages(projectSchema);

    assertPass(report.totalImages === 2, 'scoreAllImages() counts all images');
    assertPass(report.scoredImages.length === 2, 'scoreAllImages() scores all images');
    assertPass(report.summary && typeof report.summary.averageScore === 'number', 'scoreAllImages() provides summary');
  } catch (e) {
    fail('scoreAllImages()', e);
  }

  // Test 9: Strip HTML utility
  try {
    const stripped = imageAI.stripHtml('<p>Hello <strong>World</strong></p>');
    assertPass(stripped === 'Hello World', 'stripHtml() removes HTML tags');
  } catch (e) {
    fail('stripHtml()', e);
  }

  // Test 10: Caption generation
  try {
    const image = { src: 'blog-post-images/summer-sale-2024.jpg' };
    const caption = imageAI.generateImageCaption(image, { captionPrefix: 'Figure' });
    assertPass(caption.length > 0 && caption.toLowerCase().includes('figure'), 'generateImageCaption() generates captions');
  } catch (e) {
    fail('generateImageCaption()', e);
  }

  // Test 11: Context extraction
  try {
    const keywords = imageAI.extractContextKeywords('We sell beautiful <strong>coffee mugs</strong> and tea cups.');
    assertPass(keywords.length >= 2 && keywords.includes('coffee'), 'extractContextKeywords() extracts context keywords');
  } catch (e) {
    fail('extractContextKeywords()', e);
  }
}

// ============================================================
// Test: modules/toc-builder.js
// ============================================================

async function testTocBuilder() {
  log('\n' + COLORS.bold + '=== Testing modules/toc-builder.js ===' + COLORS.reset);

  const tocBuilder = require('../modules/toc-builder');

  const testHtml = `
    <article>
      <h1>Main Title</h1>
      <p>Introduction text.</p>
      <h2>Section One</h2>
      <p>Content for section one.</p>
      <h3>Subsection A</h3>
      <p>Details for subsection A.</p>
      <h3>Subsection B</h3>
      <p>Details for subsection B.</p>
      <h2>Section Two</h2>
      <p>Content for section two.</p>
      <h4>Minor Section</h4>
      <p>Minor details.</p>
    </article>
  `;

  // Test 1: ToC generation
  try {
    const result = tocBuilder.generateTableOfContents(testHtml, 3, true);

    assertPass(result.headings && result.headings.length >= 2, 'generateTableOfContents() returns headings');
    assertPass(result.html && result.html.includes('id='), 'generateTableOfContents() injects IDs');
    assertPass(result.tree && result.tree.children, 'generateTableOfContents() builds tree');
  } catch (e) {
    fail('generateTableOfContents()', e);
  }

  // Test 2: Heading ID injection
  try {
    const result = tocBuilder.generateTableOfContents(testHtml, 3, true);
    const h1Match = result.html.match(/<h1[^>]*id="([^"]*)"[^>]*>/);
    assertPass(h1Match && h1Match[1], 'ToC builder injects IDs into HTML');
  } catch (e) {
    fail('ToC ID injection', e);
  }

  // Test 3: Slugify function
  try {
    assertPass(tocBuilder.slugify('Hello World!') === 'hello-world', 'slugify() converts to slug');
    assertPass(tocBuilder.slugify('Special &Chars/Here').includes('special') && tocBuilder.slugify('Special &Chars/Here').includes('chars'), 'slugify() handles special chars');
  } catch (e) {
    fail('slugify()', e);
  }

  // Test 4: Unique ID generation
  try {
    const ids = new Set();
    const id1 = tocBuilder.ensureUniqueId('test', ids);
    const id2 = tocBuilder.ensureUniqueId('test', ids);
    assertPass(id1 === 'test' && id2 === 'test-1', 'ensureUniqueId() generates unique IDs');
  } catch (e) {
    fail('ensureUniqueId()', e);
  }

  // Test 5: ToC tree building
  try {
    const headings = [
      { id: 'h1', level: 1, text: 'Main' },
      { id: 'h2a', level: 2, text: 'Sub1' },
      { id: 'h2b', level: 2, text: 'Sub2' }
    ];
    const tree = tocBuilder.buildTocTree(headings);
    const rootChild = tree.children[0]; // h1: Main
    assertPass(rootChild && rootChild.children && rootChild.children.length === 2, 'buildTocTree() builds nested tree correctly');
  } catch (e) {
    fail('buildTocTree()', e);
  }

  // Test 6: ToC HTML generation
  try {
    const headings = [
      { id: 'intro', level: 1, text: 'Introduction' },
      { id: 'details', level: 2, text: 'Details' }
    ];
    const tree = tocBuilder.buildTocTree(headings);
    const html = tocBuilder.generateTocHtml(tree);
    assertPass(html.includes('toc-container') && html.includes('<a href="#intro">'), 'generateTocHtml() generates HTML');
  } catch (e) {
    fail('generateTocHtml()', e);
  }

  // Test 7: Scroll margin styles
  try {
    const css = tocBuilder.injectScrollMarginStyles({ headerHeight: 80 });
    assertPass(css.includes('scroll-margin-top: 80px'), 'injectScrollMarginStyles() generates scroll-margin CSS');
    assertPass(css.includes('scroll-behavior: smooth'), 'injectScrollMarginStyles() includes smooth scroll');
  } catch (e) {
    fail('injectScrollMarginStyles()', e);
  }

  // Test 8: Scroll margin injection into HTML
  try {
    const html = '<html><head></head><body></body></html>';
    const result = tocBuilder.injectScrollMarginStylesIntoHtml(html, { headerHeight: 100 });
    assertPass(result.includes('scroll-margin-top: 100px') && result.includes('<style>'), 'injectScrollMarginStylesIntoHtml() injects CSS');
  } catch (e) {
    fail('injectScrollMarginStylesIntoHtml()', e);
  }

  // Test 9: Scroll spy script
  try {
    const script = tocBuilder.generateScrollSpyScript({ offset: 200 });
    assertPass(script.includes('CONFIG') && script.includes('offset') && script.includes('activeHeading'), 'generateScrollSpyScript() generates scroll spy');
    assertPass(script.includes('toc-active'), 'generateScrollSpyScript() includes active class logic');
  } catch (e) {
    fail('generateScrollSpyScript()', e);
  }

  // Test 10: Scroll spy injection
  try {
    const html = '<html><head></head><body></body></html>';
    const result = tocBuilder.injectScrollSpyIntoHtml(html);
    assertPass(result.includes('<script>') && result.includes('scroll-spy') || (result.includes('<script>') && result.includes('Scroll Spy')), 'injectScrollSpyIntoHtml() injects script');
  } catch (e) {
    fail('injectScrollSpyIntoHtml()', e);
  }

  // Test 11: Max depth filtering
  try {
    const result = tocBuilder.generateTableOfContents(testHtml, 2, true);
    const h4Headings = result.headings.filter(h => h.level === 4);
    assertPass(h4Headings.length === 0, 'ToC builder respects maxDepth (h4 excluded)');
  } catch (e) {
    fail('maxDepth filtering', e);
  }

  // Test 12: HTML escaping
  try {
    const escaped = tocBuilder.escapeHtml('<script>alert("xss")</script>');
    assertPass(escaped.includes('&lt;') && !escaped.includes('<script>'), 'escapeHtml() prevents XSS');
  } catch (e) {
    fail('escapeHtml()', e);
  }
}

// ============================================================
// Test: modules/canonical-engine.js
// ============================================================

async function testCanonicalEngine() {
  log('\n' + COLORS.bold + '=== Testing modules/canonical-engine.js ===' + COLORS.reset);

  const canonicalEngine = require('../modules/canonical-engine');

  // Test 1: URL normalization
  try {
    const normalized = canonicalEngine.normalizeUrl('https://example.com/page/', { enforceHttps: true, removeTrailingSlash: true });
    assertPass(normalized === 'https://example.com/page', 'normalizeUrl() removes trailing slash');
  } catch (e) {
    fail('normalizeUrl()', e);
  }

  // Test 2: HTTPS enforcement
  try {
    const normalized = canonicalEngine.normalizeUrl('http://example.com/page', { enforceHttps: true });
    assertPass(normalized.startsWith('https://'), 'normalizeUrl() enforces HTTPS');
  } catch (e) {
    fail('HTTPS enforcement', e);
  }

  // Test 3: Tracking parameter stripping
  try {
    const clean = canonicalEngine.stripTrackingParams('https://example.com/page?utm_source=twitter&utm_campaign=test');
    assertPass(!clean.includes('utm_'), 'stripTrackingParams() removes UTM parameters');
  } catch (e) {
    fail('stripTrackingParams()', e);
  }

  // Test 4: Canonical URL building
  try {
    const canonical = canonicalEngine.buildCanonicalUrl('/about', 'https://example.com', { enforceHttps: true });
    assertPass(canonical === 'https://example.com/about', 'buildCanonicalUrl() builds correct canonical');
  } catch (e) {
    fail('buildCanonicalUrl()', e);
  }

  // Test 5: Canonical tag generation
  try {
    const tag = canonicalEngine.generateCanonicalTag('https://example.com/page');
    assertPass(tag.includes('rel="canonical"') && tag.includes('href="https://example.com/page"'), 'generateCanonicalTag() generates tag');
  } catch (e) {
    fail('generateCanonicalTag()', e);
  }

  // Test 6: Canonical tag injection
  try {
    const html = '<html><head><title>Test</title></head><body></body></html>';
    const result = canonicalEngine.injectCanonicalTag(html, 'https://example.com/page');
    assertPass(result.includes('rel="canonical"') && result.includes('https://example.com/page'), 'injectCanonicalTag() adds canonical');
  } catch (e) {
    fail('injectCanonicalTag()', e);
  }

  // Test 7: Duplicate canonical removal
  try {
    const html = '<html><head><link rel="canonical" href="http://old.com"/><link rel="canonical" href="http://duplicate.com"/></head></html>';
    const result = canonicalEngine.removeDuplicateCanonicals(html);
    const matches = result.match(/rel="canonical"/g);
    assertPass(matches && matches.length <= 1, 'removeDuplicateCanonicals() removes duplicates');
  } catch (e) {
    fail('removeDuplicateCanonicals()', e);
  }

  // Test 8: Robots directives - production
  try {
    const directives = canonicalEngine.generateRobotsDirectives({}, 'production');
    assertPass(directives === 'index, follow', 'generateRobotsDirectives() allows indexing in production');
  } catch (e) {
    fail('generateRobotsDirectives() production', e);
  }

  // Test 9: Robots directives - staging
  try {
    const directives = canonicalEngine.generateRobotsDirectives({}, 'staging');
    assertPass(directives.includes('noindex') && directives.includes('nofollow'), 'generateRobotsDirectives() blocks staging');
  } catch (e) {
    fail('generateRobotsDirectives() staging', e);
  }

  // Test 10: Robots directives - draft
  try {
    const directives = canonicalEngine.generateRobotsDirectives({ isDraft: true }, 'production');
    assertPass(directives.includes('noindex'), 'generateRobotsDirectives() blocks drafts');
  } catch (e) {
    fail('generateRobotsDirectives() draft', e);
  }

  // Test 11: Robots meta tag generation
  try {
    const tag = canonicalEngine.generateRobotsMetaTag({ isDraft: true }, 'production');
    assertPass(tag.includes('name="robots"') && tag.includes('noindex'), 'generateRobotsMetaTag() generates tag');
  } catch (e) {
    fail('generateRobotsMetaTag()', e);
  }

  // Test 12: Robots meta injection
  try {
    const html = '<html><head></head><body></body></html>';
    const result = canonicalEngine.injectRobotsMetaTag(html, { isDraft: true }, 'production');
    assertPass(result.includes('name="robots"') && result.includes('noindex'), 'injectRobotsMetaTag() injects tag');
  } catch (e) {
    fail('injectRobotsMetaTag()', e);
  }

  // Test 13: Noindex meta tag
  try {
    const tag = canonicalEngine.generateNoIndexMetaTag({ noindex: true, nofollow: true });
    assertPass(tag.includes('noindex') && tag.includes('nofollow'), 'generateNoIndexMetaTag() generates proper directives');
  } catch (e) {
    fail('generateNoIndexMetaTag()', e);
  }

  // Test 14: Hreflang tags
  try {
    const tags = canonicalEngine.generateHreflangTags(['en', 'es', 'fr'], 'en', 'https://example.com');
    assertPass(tags.includes('hreflang="es"') && tags.includes('hreflang="fr"'), 'generateHreflangTags() generates all locales');
    assertPass(tags.includes('hreflang="x-default"'), 'generateHreflangTags() includes x-default');
  } catch (e) {
    fail('generateHreflangTags()', e);
  }

  // Test 15: URL parsing
  try {
    const parsed = canonicalEngine.parseUrl('https://example.com/path?query=1');
    assertPass(parsed && parsed.hostname === 'example.com', 'parseUrl() parses URL correctly');
  } catch (e) {
    fail('parseUrl()', e);
  }
}

// ============================================================
// Test: modules/content-exporter.js
// ============================================================

async function testContentExporter() {
  log('\n' + COLORS.bold + '=== Testing modules/content-exporter.js ===' + COLORS.reset);

  const contentExporter = require('../modules/content-exporter');

  // Test 1: EPUB structure generation
  try {
    const posts = [
      { id: 'post1', title: 'First Post', date: '2024-01-01', content: '<p>Content</p>' }
    ];
    const epub = contentExporter.generateEPUB(posts, { title: 'Test Book', author: 'Test Author' });

    assertPass(epub && epub['OEBPS/content.opf'], 'generateEPUB() creates structure with content.opf');
    assertPass(epub['OEBPS/styles.css'], 'generateEPUB() includes styles');
    assertPass(epub['OEBPS/toc.xhtml'], 'generateEPUB() includes TOC');
  } catch (e) {
    fail('generateEPUB()', e);
  }

  // Test 2: Mimetype generation
  try {
    const mime = contentExporter.generateMimeType();
    assertPass(mime === 'application/epub+zip', 'generateMimeType() returns correct MIME type');
  } catch (e) {
    fail('generateMimeType()', e);
  }

  // Test 3: Container XML
  try {
    const container = contentExporter.generateContainerXml();
    assertPass(container.includes('<container') && container.includes('content.opf'), 'generateContainerXml() generates valid container');
  } catch (e) {
    fail('generateContainerXml()', e);
  }

  // Test 4: Content OPF
  try {
    const opf = contentExporter.generateContentOpf(
      'Test Book',
      'Test Author',
      'Test Publisher',
      [{ id: 'p1', title: 'Chapter 1' }],
      'en'
    );
    assertPass(opf.includes('<dc:title>Test Book</dc:title>') && opf.includes('<dc:creator>Test Author</dc:creator>'), 'generateContentOpf() includes metadata');
  } catch (e) {
    fail('generateContentOpf()', e);
  }

  // Test 5: EPUB styles
  try {
    const styles = contentExporter.generateEpubStyles();
    assertPass(styles.includes('body {') && styles.includes('font-family: serif'), 'generateEpubStyles() generates base styles');
    assertPass(styles.includes('@page') || styles.includes('page-break'), 'generateEpubStyles() includes page settings');
  } catch (e) {
    fail('generateEpubStyles()', e);
  }

  // Test 6: TOC XHTML
  try {
    const posts = [{ title: 'First' }, { title: 'Second' }];
    const toc = contentExporter.generateTocXhtml(posts);
    assertPass(toc.includes('<title>Table of Contents</title>') && toc.includes('First') && toc.includes('Second'), 'generateTocXhtml() generates TOC');
  } catch (e) {
    fail('generateTocXhtml()', e);
  }

  // Test 7: Nav XHTML
  try {
    const posts = [{ title: 'Chapter 1' }];
    const nav = contentExporter.generateNavXhtml(posts);
    assertPass(nav.includes('<nav>') && nav.includes('Chapter 1'), 'generateNavXhtml() generates navigation');
  } catch (e) {
    fail('generateNavXhtml()', e);
  }

  // Test 8: Cover XHTML
  try {
    const cover = contentExporter.generateCoverXhtml('My Book', 'John Doe');
    assertPass(cover.includes('<h1>My Book</h1>') && cover.includes('John Doe'), 'generateCoverXhtml() generates cover');
  } catch (e) {
    fail('generateCoverXhtml()', e);
  }

  // Test 9: Content XHTML
  try {
    const content = contentExporter.generateContentXhtml({ title: 'Test', content: '<p>Hello</p>' }, 1);
    assertPass(content.includes('<title>Test</title>') && content.includes('<p>Hello</p>'), 'generateContentXhtml() generates content page');
  } catch (e) {
    fail('generateContentXhtml()', e);
  }

  // Test 10: Print styles
  try {
    const printStyles = contentExporter.generatePrintStyles({ showLinkUrls: true });
    assertPass(printStyles.includes('@media print') && printStyles.includes('font-family'), 'generatePrintStyles() generates print CSS');
    assertPass(printStyles.includes('a[href]::after') && printStyles.includes('attr(href)'), 'generatePrintStyles() includes link URLs');
  } catch (e) {
    fail('generatePrintStyles()', e);
  }

  // Test 11: Print styles with custom options
  try {
    const printStyles = contentExporter.generatePrintStyles({
      bodyFont: 'Arial',
      showLinkUrls: false
    });
    assertPass(printStyles.includes('font-family: Arial') && !printStyles.includes('attr(href)'), 'generatePrintStyles() respects custom options');
  } catch (e) {
    fail('generatePrintStyles() custom options', e);
  }

  // Test 12: Print styles injection
  try {
    const html = '<html><head></head><body><p>Test</p></body></html>';
    const result = contentExporter.injectPrintStyles(html);
    assertPass(result.includes('<style>') && result.includes('@media print'), 'injectPrintStyles() injects print CSS into HTML');
  } catch (e) {
    fail('injectPrintStyles()', e);
  }

  // Test 13: XML escaping
  try {
    const escaped = contentExporter.escapeXml('<test>&"\'</test>');
    assertPass(escaped.includes('&lt;') && escaped.includes('&gt;') && escaped.includes('&amp;'), 'escapeXml() escapes XML entities');
  } catch (e) {
    fail('escapeXml()', e);
  }

  // Test 14: EPUB with no posts
  try {
    const epub = contentExporter.generateEPUB([], { title: 'Empty Book' });
    assertPass(epub && epub['OEBPS/content.opf'], 'generateEPUB() handles empty posts');
  } catch (e) {
    fail('generateEPUB() empty', e);
  }

  // Test 15: EPUB with cover image
  try {
    const epub = contentExporter.generateEPUB([], {
      title: 'Book',
      coverImage: 'cover.jpg'
    });
    assertPass(epub['OEBPS/cover.xhtml'] && epub['OEBPS/cover.xhtml'].includes('cover.jpg'), 'generateEPUB() includes cover when provided');
  } catch (e) {
    fail('generateEPUB() cover', e);
  }
}

// ============================================================
// Test Runner
// ============================================================

async function runAllTests() {
  log('\n' + COLORS.bold + COLORS.info + '╔══════════════════════════════════════════════════════╗' + COLORS.reset);
  log(COLORS.bold + COLORS.info + '║   PallettAI Studio — SEO & Content V5 Smoke Tests  ║' + COLORS.reset);
  log(COLORS.bold + COLORS.info + '╚══════════════════════════════════════════════════════╝' + COLORS.reset);

  ensureTestDir();

  try {
    await testImageAIAnnotator();
  } catch (e) {
    log('\n✗ Image AI Annotator tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testTocBuilder();
  } catch (e) {
    log('\n✗ ToC Builder tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testCanonicalEngine();
  } catch (e) {
    log('\n✗ Canonical Engine tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testContentExporter();
  } catch (e) {
    log('\n✗ Content Exporter tests crashed:', 'fail');
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

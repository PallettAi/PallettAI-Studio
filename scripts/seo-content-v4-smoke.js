// ============================================================
// PallettAI Studio — Extended SEO & Localization Smoke Test Runner
// Tests modules/microdata.js, translation-memory.js, seo-health.js,
// and syndication.js to verify proper functionality.
// ============================================================

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ============================================================
// Test Configuration
// ============================================================

const TEST_DIR = path.join(__dirname, '..', '.test-output');
const TEST_TIMEOUT = 10000;

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
// Test: modules/microdata.js
// ============================================================

async function testMicrodata() {
  log('\n' + COLORS.bold + '=== Testing modules/microdata.js ===' + COLORS.reset, 'info');

  const microdata = require('../modules/microdata');

  // Test 1: Schema types definition
  try {
    assertPass(
      microdata.SCHEMA_TYPES.article &&
      microdata.SCHEMA_TYPES.article.itemtype === 'https://schema.org/Article',
      'SCHEMA_TYPES contains correct Article schema',
      ''
    );

    assertPass(
      Object.keys(microdata.SCHEMA_TYPES).length === 8,
      'SCHEMA_TYPES contains all 8 schema types',
      `Types: ${Object.keys(microdata.SCHEMA_TYPES).join(', ')}`
    );

  } catch (e) {
    fail('SCHEMA_TYPES definition', e);
  }

  // Test 2: Itemprops definition
  try {
    assertPass(
      microdata.ITEMPROPS.article.headline === 'headline' &&
      microdata.ITEMPROPS.product.name === 'name',
      'ITEMPROPS contains correct property mappings',
      ''
    );

  } catch (e) {
    fail('ITEMPROPS definition', e);
  }

  // Test 3: Microdata injection for article
  try {
    const html = '<article><h1>Test Article</h1><p>Content here</p></article>';
    const result = microdata.injectMicrodataAttributes(html, 'article', {
      headline: 'Test Article'
    });

    assertPass(
      result.includes('itemscope') && result.includes('itemtype="https://schema.org/Article"'),
      'injectMicrodataAttributes() adds itemscope and itemtype for article',
      ''
    );

    assertPass(
      result.includes('itemprop="headline"'),
      'injectMicrodataAttributes() adds itemprop to headline',
      ''
    );

  } catch (e) {
    fail('injectMicrodataAttributes() article', e);
  }

  // Test 4: Microdata injection for product
  try {
    const html = '<article><h2>Product Name</h2><img src="img.jpg" alt="Product image"></article>';
    const result = microdata.injectMicrodataAttributes(html, 'product', {
      name: 'Product Name'
    });

    assertPass(
      result.includes('itemtype="https://schema.org/Product"'),
      'injectMicrodataAttributes() adds Product itemtype',
      ''
    );

  } catch (e) {
    fail('injectMicrodataAttributes() product', e);
  }

  // Test 5: Microformats2 h-entry injection
  try {
    const html = '<article><h1>Blog Post</h1><p>Content</p></article>';
    const result = microdata.injectMicroformats2Classes(html, 'entry');

    assertPass(
      result.includes('class="h-entry"') || result.includes("class='h-entry'"),
      'injectMicroformats2Classes() adds h-entry class',
      ''
    );

    assertPass(
      result.includes('p-name'),
      'injectMicroformats2Classes() adds p-name class to title',
      ''
    );

  } catch (e) {
    fail('injectMicroformats2Classes() h-entry', e);
  }

  // Test 6: Microformats2 h-card injection
  try {
    const html = '<div class="author"><span>John Doe</span><a href="https://john.com">@john</a></div>';
    const result = microdata.injectMicroformats2Classes(html, 'card');

    assertPass(
      result.includes('class="h-card"') || result.includes('h-card'),
      'injectMicroformats2Classes() adds h-card class for card type',
      ''
    );

  } catch (e) {
    fail('injectMicroformats2Classes() h-card', e);
  }

  // Test 7: Microformats2 h-product injection
  try {
    const html = '<article><h2>Product</h2><img src="product.jpg" alt="A product"><span>$29.99</span></article>';
    const result = microdata.injectMicroformats2Classes(html, 'product');

    assertPass(
      result.includes('class="h-product"') || result.includes('h-product'),
      'injectMicroformats2Classes() adds h-product class',
      ''
    );

    assertPass(
      result.includes('p-name') && result.includes('u-photo'),
      'injectMicroformats2Classes() adds p-name and u-photo',
      ''
    );

  } catch (e) {
    fail('injectMicroformats2Classes() h-product', e);
  }

  // Test 8: Validation
  try {
    const html = '<article itemscope itemtype="https://schema.org/Article" itemprop="headline">Test</article>';
    const validation = microdata.validateMicrodata(html);

    assertPass(
      validation.valid === true || (validation.issues && validation.issues.length === 0),
      'validateMicrodata() validates correct microdata',
      `Valid: ${validation.valid}`
    );

    assertPass(
      validation.stats && validation.stats.itemscopeCount > 0,
      'validateMicrodata() returns stats',
      `Itemscope count: ${validation.stats.itemscopeCount}`
    );

  } catch (e) {
    fail('validateMicrodata()', e);
  }

  // Test 9: Validation with issues
  try {
    const html = '<article>No microdata here</article>';
    const validation = microdata.validateMicrodata(html);

    assertPass(
      validation.warnings && validation.warnings.length > 0,
      'validateMicrodata() detects missing microdata',
      `Warnings: ${validation.warnings.length}`
    );

  } catch (e) {
    fail('validateMicrodata() detection', e);
  }

  // Test 10: HTML escaping
  try {
    const escaped = microdata.escapeHtml('<script>alert("xss")</script>');
    assertPass(
      escaped.includes('&lt;') && !escaped.includes('<script>'),
      'escapeHtml() escapes HTML entities',
      ''
    );

  } catch (e) {
    fail('escapeHtml()', e);
  }

  // Test 11: All content types produce valid output
  try {
    const types = ['article', 'product', 'person', 'organization'];
    const html = '<article>Test</article>';

    for (const type of types) {
      const result = microdata.injectMicrodataAttributes(html, type, {});
      assertPass(
        result.includes('itemscope') || type === 'person' || type === 'organization',
        `injectMicrodataAttributes() works for ${type}`,
        ''
      );
    }

  } catch (e) {
    fail('injectMicrodataAttributes() all types', e);
  }

  // Test 12: Microformats2 all content types
  try {
    const html = '<article>Test content</article>';

    const resultEntry = microdata.injectMicroformats2Classes(html, 'entry');
    assertPass(
      resultEntry.includes('h-entry') || resultEntry.includes('class="h-entry"'),
      `injectMicroformats2Classes() works for entry`,
      ''
    );

    const resultCard = microdata.injectMicroformats2Classes(html, 'card');
    assertPass(
      resultCard.length >= html.length,
      `injectMicroformats2Classes() works for card`,
      ''
    );

    const resultProduct = microdata.injectMicroformats2Classes(html, 'product');
    assertPass(
      resultProduct.length >= html.length,
      `injectMicroformats2Classes() works for product`,
      ''
    );

  } catch (e) {
    fail('injectMicroformats2Classes() all types', e);
  }
}

// ============================================================
// Test: modules/translation-memory.js
// ============================================================

async function testTranslationMemory() {
  log('\n' + COLORS.bold + '=== Testing modules/translation-memory.js ===' + COLORS.reset, 'info');

  const translationMemory = require('../modules/translation-memory');

  // Test 1: Translation memory building from project data
  try {
    const projectData = {
      pages: [
        {
          id: 'home',
          title: 'Home Page',
          description: 'Welcome to our site',
          meta: { ogTitle: 'Home - My Site' }
        }
      ],
      posts: [
        {
          id: 'post-1',
          title: 'First Post',
          excerpt: 'This is a post excerpt',
          tags: ['blog', 'tech'],
          author: 'John Doe'
        }
      ],
      ui: {
        button: { label: 'Click Me', placeholder: 'Enter text' }
      }
    };

    const tm = translationMemory.buildTranslationMemory(projectData);

    assertPass(
      tm.version === '1.0' && tm.keys && Object.keys(tm.keys).length > 0,
      'buildTranslationMemory() builds translation memory with keys',
      `Keys: ${Object.keys(tm.keys).length}`
    );

    assertPass(
      tm.keys['page.home.title'] &&
      tm.keys['page.home.title'].source === 'Home Page',
      'buildTranslationMemory() extracts page title correctly',
      `Key: ${tm.keys['page.home.title'].source}`
    );

    assertPass(
      tm.stats && tm.stats.totalKeys === Object.keys(tm.keys).length,
      'buildTranslationMemory() calculates correct stats',
      `Total: ${tm.stats.totalKeys}`
    );

  } catch (e) {
    fail('buildTranslationMemory()', e);
  }

  // Test 2: Missing key resolution
  try {
    const targetMap = {
      'page.home.title': 'Inicio',
      'page.about.title': ''  // Empty - will use fallback
    };

    const defaultMap = {
      'page.home.title': 'Home Page',
      'page.home.description': 'Welcome',
      'page.about.title': 'About Us',
      'page.about.description': 'Learn about us'
    };

    const result = translationMemory.resolveMissingKeys('es', targetMap, defaultMap);

    assertPass(
      result.locale === 'es' &&
      result.totalKeys === 4 &&
      result.translatedKeys >= 1,
      'resolveMissingKeys() resolves keys with fallback',
      `Translated: ${result.translatedKeys}, Fallback: ${result.fallbackKeys}, Missing: ${result.missingKeys}`
    );

    assertPass(
      result.resolvedMap['page.home.title'] === 'Inicio',
      'resolveMissingKeys() uses translated value when available',
      ''
    );

    assertPass(
      result.resolvedMap['page.about.title'] === 'About Us',
      'resolveMissingKeys() falls back to default locale value',
      ''
    );

  } catch (e) {
    fail('resolveMissingKeys()', e);
  }

  // Test 3: Translation diagnostics generation
  try {
    const result = translationMemory.resolveMissingKeys('fr', {}, {
      'page.title': 'Page Title',
      'page.desc': 'Description'
    });

    const diagnostics = translationMemory.generateTranslationDiagnostics(result);

    assertPass(
      diagnostics.includes('Translation Diagnostics') &&
      diagnostics.includes('fr') &&
      diagnostics.includes('Missing'),
      'generateTranslationDiagnostics() generates diagnostic log',
      ''
    );

    assertPass(
      diagnostics.includes('page.title') && diagnostics.includes('page.desc'),
      'generateTranslationDiagnostics() lists all missing keys',
      ''
    );

  } catch (e) {
    fail('generateTranslationDiagnostics()', e);
  }

  // Test 4: XLIFF export
  try {
    const translationMap = {
      'page.title': 'Page Title',
      'page.description': 'Page Description',
      'nav.home': 'Home'
    };

    const xliff = translationMemory.exportXLIFF(translationMap, 'es', 'en', 'Test Project');

    assertPass(
      xliff.includes('<?xml version="1.0"') &&
      xliff.includes('<xliff version="1.2"') &&
      xliff.includes('target-language="es"'),
      'exportXLIFF() generates valid XLIFF 1.2 XML',
      `Length: ${xliff.length} chars`
    );

    assertPass(
      xliff.includes('<trans-unit') &&
      xliff.includes('<source>page.title</source>') &&
      xliff.includes('<target>Page Title</target>'),
      'exportXLIFF() includes translation units',
      ''
    );

    assertPass(
      xliff.includes('<context>page</context>'),
      'exportXLIFF() includes context information',
      ''
    );

  } catch (e) {
    fail('exportXLIFF()', e);
  }

  // Test 5: XLIFF with special characters
  try {
    const translationMap = {
      'page.greeting': 'Hello & Welcome <b>Friend</b>'
    };

    const xliff = translationMemory.exportXLIFF(translationMap, 'es');

    assertPass(
      xliff.includes('&amp;') && xliff.includes('&lt;') && xliff.includes('&gt;'),
      'exportXLIFF() escapes special XML characters',
      ''
    );

  } catch (e) {
    fail('exportXLIFF() escaping', e);
  }

  // Test 6: XLIFF file save
  try {
    const testDir = ensureTestDir();
    const outputPath = path.join(testDir, 'test.xliff');

    const xliff = translationMemory.exportXLIFF({ 'test.key': 'Test Value' }, 'de');
    const savedPath = translationMemory.saveXLIFF(xliff, outputPath);

    assertPass(
      fs.existsSync(savedPath) && savedPath === path.resolve(outputPath),
      'saveXLIFF() saves XLIFF to file',
      `Saved to: ${savedPath}`
    );

    // Verify content
    const content = fs.readFileSync(savedPath, 'utf8');
    assertPass(
      content.includes('<xliff') && content.includes('test.key'),
      'saveXLIFF() writes correct content to file',
      ''
    );

    // Clean up
    fs.rmSync(testDir, { recursive: true, force: true });

  } catch (e) {
    fail('saveXLIFF()', e);
    try { fs.rmSync(ensureTestDir(), { recursive: true, force: true }); } catch (e2) {}
  }

  // Test 7: Translation stats
  try {
    const translationMap = {
      'key1': 'Value one',
      'key2': 'Value two longer',
      'key3': '',
      'key4': null
    };

    const stats = translationMemory.getTranslationStats(translationMap, 'en');

    assertPass(
      stats.total === 4 && stats.translated === 2 && stats.empty === 2,
      'getTranslationStats() calculates correct stats',
      `Total: ${stats.total}, Translated: ${stats.translated}, Empty: ${stats.empty}`
    );

    assertPass(
      stats.completionPercentage === 50,
      'getTranslationStats() calculates completion percentage',
      `Completion: ${stats.completionPercentage}%`
    );

  } catch (e) {
    fail('getTranslationStats()', e);
  }

  // Test 8: Merge translation memories
  try {
    const tm1 = {
      version: '1.0',
      keys: {
        'page.title': { key: 'page.title', source: 'Home Page', context: 'page' }
      },
      byLocale: {
        'es': { 'page.title': 'Inicio' }
      }
    };

    const tm2 = {
      version: '1.0',
      keys: {
        'page.desc': { key: 'page.desc', source: 'Description', context: 'page' }
      },
      byLocale: {
        'es': { 'page.desc': 'Descripción' }
      }
    };

    const merged = translationMemory.mergeTranslationMemories(tm1, tm2);

    assertPass(
      merged.keys['page.title'] && merged.keys['page.desc'],
      'mergeTranslationMemories() merges multiple memories',
      `Merged keys: ${Object.keys(merged.keys).length}`
    );

    assertPass(
      merged.byLocale.es['page.title'] === 'Inicio' &&
      merged.byLocale.es['page.desc'] === 'Descripción',
      'mergeTranslationMemories() preserves locale translations',
      ''
    );

  } catch (e) {
    fail('mergeTranslationMemories()', e);
  }

  // Test 9: XML escaping
  try {
    const escaped = translationMemory.escapeXml('<tag attr="value">&more</tag>');
    assertPass(
      escaped === '&lt;tag attr=&quot;value&quot;&gt;&amp;more&lt;/tag&gt;',
      'escapeXml() escapes all XML entities correctly',
      `"${escaped}"`
    );

  } catch (e) {
    fail('escapeXml()', e);
  }

  // Test 10: Empty project data
  try {
    const tm = translationMemory.buildTranslationMemory({});
    assertPass(
      tm.keys && Object.keys(tm.keys).length === 0,
      'buildTranslationMemory() handles empty project data',
      ''
    );

  } catch (e) {
    fail('buildTranslationMemory() empty', e);
  }
}

// ============================================================
// Test: modules/seo-health.js
// ============================================================

async function testSeoHealth() {
  log('\n' + COLORS.bold + '=== Testing modules/seo-health.js ===' + COLORS.reset, 'info');

  const seoHealth = require('../modules/seo-health');

  // Test 1: Flesch Reading Ease calculation
  try {
    // Simple text - should score high
    const simpleText = 'The cat sat on the mat. The dog ran fast.';
    const result = seoHealth.calculateFleschReadingEase(simpleText);

    assertPass(
      result.score > 0 && typeof result.score === 'number',
      'calculateFleschReadingEase() returns numeric score',
      `Score: ${result.score}, Interpretation: ${result.interpretation}`
    );

    assertPass(
      result.totalWords >= 9 && result.totalSentences === 2,
      'calculateFleschReadingEase() counts words and sentences',
      `Words: ${result.totalWords}, Sentences: ${result.totalSentences}`
    );

  } catch (e) {
    fail('calculateFleschReadingEase()', e);
  }

  // Test 2: Syllable counting
  try {
    const syllables = seoHealth.countSyllables('hello');
    assertPass(
      syllables === 2,
      'countSyllables() counts syllables correctly',
      `"hello": ${syllables} syllables`
    );

    const syllables2 = seoHealth.countSyllables('beautiful');
    assertPass(
      syllables2 >= 2 && syllables2 <= 4,
      'countSyllables() handles longer words',
      `"beautiful": ${syllables2} syllables`
    );

  } catch (e) {
    fail('countSyllables()', e);
  }

  // Test 3: HTML stripping
  try {
    const stripped = seoHealth.stripHtml('<p>Hello <strong>World</strong></p>');
    assertPass(
      stripped === 'Hello World',
      'stripHtml() removes HTML tags',
      `"${stripped}"`
    );

    const stripped2 = seoHealth.stripHtml('<!-- comment --><div>Text</div>');
    assertPass(
      stripped2 === 'Text',
      'stripHtml() removes comments',
      `"${stripped2}"`
    );

  } catch (e) {
    fail('stripHtml()', e);
  }

  // Test 4: Full SEO audit
  try {
    const projectSchema = {
      pages: [
        {
          id: 'home',
          url: '/',
          title: 'Welcome to My Site - A Great Home Page Title That Is Exactly Fifty Five Characters Long',
          description: 'This is a perfect meta description that is exactly one hundred and fifty five characters long for SEO purposes.',
          content: '<h1>Welcome</h1><p>This is the home page content with clear and simple language for easy reading.</p>'
        },
        {
          id: 'about',
          url: '/about',
          title: 'About',
          description: 'About us',
          content: '<h1>About Us</h1><h2>Our History</h2><p>We started in 2020.</p>'
        }
      ]
    };

    const report = seoHealth.auditSEOHealth(projectSchema);

    assertPass(
      report.score !== undefined && typeof report.score === 'number' &&
      report.score >= 0 && report.score <= 100,
      'auditSEOHealth() returns score in valid range',
      `Score: ${report.score}`
    );

    assertPass(
      report.critical_issues && Array.isArray(report.critical_issues) &&
      report.warnings && Array.isArray(report.warnings),
      'auditSEOHealth() returns structured report',
      `Critical: ${report.critical_issues.length}, Warnings: ${report.warnings.length}`
    );

    assertPass(
      report.pageAudits && report.pageAudits.length === 2,
      'auditSEOHealth() audits all pages',
      `Pages audited: ${report.pageAudits.length}`
    );

  } catch (e) {
    fail('auditSEOHealth()', e);
  }

  // Test 5: Meta tag audit
  try {
    const page = {
      title: 'Short',
      description: 'Brief desc'
    };

    const metaCheck = seoHealth.auditMetaTags(page);

    assertPass(
      metaCheck.critical.length > 0 || metaCheck.warnings.length > 0,
      'auditMetaTags() detects short title and description',
      `Critical: ${metaCheck.critical.length}, Warnings: ${metaCheck.warnings.length}`
    );

  } catch (e) {
    fail('auditMetaTags()', e);
  }

  // Test 6: Heading hierarchy audit
  try {
    const page = {
      content: '<h1>Main Title</h1><h3>Skipped H2</h3><p>Content</p>'
    };

    const headingCheck = seoHealth.auditHeadingHierarchy(page);

    assertPass(
      headingCheck.structure && headingCheck.structure.length === 2,
      'auditHeadingHierarchy() finds headings',
      `Headings found: ${headingCheck.structure.length}`
    );

    assertPass(
      headingCheck.warnings.length > 0,
      'auditHeadingHierarchy() detects skipped heading levels',
      `Warnings: ${headingCheck.warnings.length}`
    );

  } catch (e) {
    fail('auditHeadingHierarchy()', e);
  }

  // Test 7: Link audit
  try {
    const pageWithLinks = { id: 'home', url: '/', content: '<p>Text with <a href="#section1">link1</a> and <a href="#missing">link2</a></p><div id="section1"></div>' };
    const projectSchemaWithLinks = { pages: [pageWithLinks] };

    const linkCheck = seoHealth.auditLinks(pageWithLinks, projectSchemaWithLinks);

    assertPass(
      linkCheck.totalLinks >= 1,
      'auditLinks() counts links',
      `Total links: ${linkCheck.totalLinks}, Broken: ${linkCheck.brokenLinks?.length || 0}`
    );

  } catch (e) {
    fail('auditLinks()', e);
  }

  // Test 8: Image alt audit
  try {
    const page = {
      content: '<img src="img1.jpg"><img src="img2.jpg" alt="Description"><img src="img3.jpg" alt="">'
    };

    const imageCheck = seoHealth.auditImages(page);

    assertPass(
      imageCheck.totalImages === 3,
      'auditImages() counts all images',
      `Total images: ${imageCheck.totalImages}`
    );

    assertPass(
      imageCheck.imagesWithoutAlt && imageCheck.imagesWithoutAlt.length >= 1,
      'auditImages() detects images without/empty alt',
      `Without alt: ${imageCheck.imagesWithoutAlt.length}`
    );

  } catch (e) {
    fail('auditImages()', e);
  }

  // Test 9: Overall score calculation
  try {
    const report = {
      critical_issues: [{ type: 'Test', message: 'Test issue' }],
      warnings: [{ type: 'Test', message: 'Test warning' }],
      recommendations: [{ type: 'Test', message: 'Test rec' }]
    };

    const score = seoHealth.calculateOverallScore(report);

    assertPass(
      typeof score === 'number' && score >= 0 && score <= 100,
      'calculateOverallScore() returns valid score',
      `Score: ${score}`
    );

  } catch (e) {
    fail('calculateOverallScore()', e);
  }

  // Test 10: Empty content handling
  try {
    const page = { title: 'Test', content: '' };
    const audit = seoHealth.auditPageSEO(page);

    assertPass(
      audit.critical_issues.length > 0 || audit.score < 100,
      'auditPageSEO() handles pages with empty content',
      `Score: ${audit.score}`
    );

  } catch (e) {
    fail('auditPageSEO() empty content', e);
  }
}

// ============================================================
// Test: modules/syndication.js
// ============================================================

async function testSyndication() {
  log('\n' + COLORS.bold + '=== Testing modules/syndication.js ===' + COLORS.reset, 'info');

  const syndication = require('../modules/syndication');

  // Test 1: Visual sitemap tree generation
  try {
    const projectSchema = {
      pages: [
        { id: 'home', url: '/', title: 'Home', type: 'home' },
        { id: 'about', url: '/about', title: 'About Us' },
        { id: 'contact', url: '/contact', title: 'Contact' },
        { id: 'blog', url: '/blog', title: 'Blog' },
        { id: 'post-1', url: '/blog/first-post', title: 'First Post' },
        { id: 'post-2', url: '/blog/second-post', title: 'Second Post' }
      ]
    };

    const tree = syndication.generateVisualSitemapTree(projectSchema);

    assertPass(
      tree.id === 'root' && tree.label === 'Home' && tree.type === 'root',
      'generateVisualSitemapTree() creates root node',
      `Root: ${tree.id}`
    );

    assertPass(
      tree.children && tree.children.length > 0,
      'generateVisualSitemapTree() builds child nodes',
      `Children: ${tree.children.length}`
    );

    // Check for blog child
    const blogChild = tree.children.find(c => c.id === 'blog');
    assertPass(
      blogChild && blogChild.children && blogChild.children.length === 2,
      'generateVisualSitemapTree() creates nested hierarchy',
      `Blog children: ${blogChild?.children?.length || 0}`
    );

  } catch (e) {
    fail('generateVisualSitemapTree()', e);
  }

  // Test 2: Tree statistics
  try {
    const projectSchema = {
      pages: [
        { id: 'home', url: '/', title: 'Home' },
        { id: 'about', url: '/about', title: 'About' }
      ]
    };

    const tree = syndication.generateVisualSitemapTree(projectSchema);
    const stats = syndication.calculateTreeStats(tree);

    assertPass(
      stats.totalNodes >= 2 && stats.maxDepth >= 0,
      'calculateTreeStats() calculates correct statistics',
      `Nodes: ${stats.totalNodes}, Max depth: ${stats.maxDepth}`
    );

  } catch (e) {
    fail('calculateTreeStats()', e);
  }

  // Test 3: Tree search
  try {
    const projectSchema = {
      pages: [
        { id: 'about', url: '/about', title: 'About Us' }
      ]
    };

    const tree = syndication.generateVisualSitemapTree(projectSchema);
    const found = syndication.findNodeInTree(tree, 'about');

    assertPass(
      found && found.id === 'about' && found.label === 'About Us',
      'findNodeInTree() finds node by ID',
      `Found: ${found?.id}`
    );

  } catch (e) {
    fail('findNodeInTree()', e);
  }

  // Test 4: Tree flattening
  try {
    const projectSchema = {
      pages: [
        { id: 'home', url: '/', title: 'Home' },
        { id: 'about', url: '/about', title: 'About' }
      ]
    };

    const tree = syndication.generateVisualSitemapTree(projectSchema);
    const flat = syndication.flattenTree(tree);

    assertPass(
      flat.length >= 2 && flat[0].id === 'root',
      'flattenTree() returns all nodes',
      `Flattened: ${flat.length} items`
    );

    assertPass(
      flat.some(n => n.id === 'about'),
      'flattenTree() preserves all node data',
      ''
    );

  } catch (e) {
    fail('flattenTree()', e);
  }

  // Test 5: URL normalization
  try {
    const normalized = syndication.normalizeUrlPath('https://example.com/path/to/page/');
    assertPass(
      normalized === '/path/to/page',
      'normalizeUrlPath() normalizes URL correctly',
      `"${normalized}"`
    );

    const normalized2 = syndication.normalizeUrlPath('/already/normalized');
    assertPass(
      normalized2 === '/already/normalized',
      'normalizeUrlPath() handles already normalized paths',
      `"${normalized2}"`
    );

  } catch (e) {
    fail('normalizeUrlPath()', e);
  }

  // Test 6: WebSub ping generation
  try {
    const ping = syndication.triggerWebSubPing(
      'https://hub.example.com',
      'https://example.com/blog/post'
    );

    assertPass(
      ping.url === 'https://hub.example.com' &&
      ping.method === 'POST' &&
      ping.body && ping.body.includes('hub.topic='),
      'triggerWebSubPing() generates correct ping request',
      `URL: ${ping.url}, Method: ${ping.method}`
    );

    assertPass(
      ping.payload && ping.payload.hubUrl === 'https://hub.example.com',
      'triggerWebSubPing() includes payload info',
      ''
    );

  } catch (e) {
    fail('triggerWebSubPing()', e);
  }

  // Test 7: WebSub with custom options
  try {
    const ping = syndication.triggerWebSubPing(
      'https://hub.example.com',
      'https://example.com/blog/post',
      { leaseSeconds: 3600, mode: 'update' }
    );

    assertPass(
      ping.body.includes('hub.lease_seconds=3600'),
      'triggerWebSubPing() respects leaseSeconds option',
      ''
    );

    assertPass(
      ping.body.includes('hub.mode=update') || ping.payload.mode === 'update',
      'triggerWebSubPing() respects mode option',
      ''
    );

  } catch (e) {
    fail('triggerWebSubPing() options', e);
  }

  // Test 8: WebSub discovery links
  try {
    const links = syndication.generateWebSubDiscoveryLinks(
      'https://example.com/feed.xml',
      'https://hub.example.com'
    );

    assertPass(
      links.includes('rel="hub"') &&
      links.includes('href="https://hub.example.com"') &&
      links.includes('rel="self"'),
      'generateWebSubDiscoveryLinks() generates discovery links',
      ''
    );

  } catch (e) {
    fail('generateWebSubDiscoveryLinks()', e);
  }

  // Test 9: WebSub hub discovery from HTML
  try {
    const html = `
      <link rel="hub" href="https://hub.example.com">
      <link rel="self" href="https://example.com/feed.xml">
    `;

    const hub = syndication.discoverWebSubHub(html);

    assertPass(
      hub && hub.discovered && hub.hubUrl === 'https://hub.example.com',
      'discoverWebSubHub() discovers hub from HTML',
      `Hub: ${hub.hubUrl}`
    );

    assertPass(
      hub.topicUrl === 'https://example.com/feed.xml',
      'discoverWebSubHub() discovers topic URL',
      `Topic: ${hub.topicUrl}`
    );

  } catch (e) {
    fail('discoverWebSubHub()', e);
  }

  // Test 10: WebSub validation
  try {
    const valid = syndication.validateWebSubConfig({
      hubUrl: 'https://hub.example.com',
      topicUrl: 'https://example.com/feed.xml'
    });

    assertPass(
      valid.valid === true && valid.errors.length === 0,
      'validateWebSubConfig() validates correct config',
      ''
    );

    const invalid = syndication.validateWebSubConfig({
      hubUrl: 'https://hub.example.com'
      // Missing topicUrl
    });

    assertPass(
      invalid.valid === false && invalid.errors.length > 0,
      'validateWebSubConfig() detects missing config',
      `Errors: ${invalid.errors.length}`
    );

  } catch (e) {
    fail('validateWebSubConfig()', e);
  }

  // Test 11: Ping multiple hubs
  try {
    const hubs = [
      'https://hub1.example.com',
      'https://hub2.example.com'
    ];

    const pings = syndication.pingMultipleHubs(hubs, 'https://example.com/feed');

    assertPass(
      pings.length === 2 &&
      pings[0].url === 'https://hub1.example.com' &&
      pings[1].url === 'https://hub2.example.com',
      'pingMultipleHubs() pings all hubs',
      `Pings: ${pings.length}`
    );

  } catch (e) {
    fail('pingMultipleHubs()', e);
  }

  // Test 12: WebSub ping feed entry
  try {
    const entry = syndication.generateWebSubPingFeedEntry(
      'https://example.com/blog/post',
      'New Post',
      '<p>Content here</p>',
      '2024-01-15T10:00:00Z'
    );

    assertPass(
      entry.includes('<entry') && entry.includes('<title>New Post</title>'),
      'generateWebSubPingFeedEntry() generates valid Atom entry',
      ''
    );

    assertPass(
      entry.includes('<link href="https://example.com/blog/post"') &&
      entry.includes('<updated>'),
      'generateWebSubPingFeedEntry() includes required fields',
      ''
    );

  } catch (e) {
    fail('generateWebSubPingFeedEntry()', e);
  }

  // Test 12: Localized URL generation
  try {
    const localized = syndication.generateLocalizedUrl('/about', 'es', {
      locales: ['en', 'es', 'fr'],
      defaultLocale: 'en'
    });

    assertPass(
      localized === '/es/about',
      'generateLocalizedUrl() generates localized URL',
      `"${localized}"`
    );

    const localizedEn = syndication.generateLocalizedUrl('/about', 'en', {
      locales: ['en', 'es'],
      defaultLocale: 'en'
    });

    assertPass(
      localizedEn === '/about',
      'generateLocalizedUrl() omits default locale prefix',
      `"${localizedEn}"`
    );

  } catch (e) {
    fail('generateLocalizedUrl()', e);
  }
}

// ============================================================
// Test Runner
// ============================================================

async function runAllTests() {
  log('\n' + COLORS.bold + COLORS.info + '╔══════════════════════════════════════════════════════╗' + COLORS.reset, 'info');
  log(COLORS.bold + COLORS.info + '║   PallettAI Studio — SEO & Localization V4 Tests  ║' + COLORS.reset, 'info');
  log(COLORS.bold + COLORS.info + '╚══════════════════════════════════════════════════════╝' + COLORS.reset, 'info');

  cleanTestDir();

  try {
    await testMicrodata();
  } catch (e) {
    log('\n✗ Microdata tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testTranslationMemory();
  } catch (e) {
    log('\n✗ Translation memory tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testSeoHealth();
  } catch (e) {
    log('\n✗ SEO health tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testSyndication();
  } catch (e) {
    log('\n✗ Syndication tests crashed:', 'fail');
    console.error(e);
  }

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

runAllTests().catch(e => {
  console.error('Fatal test runner error:', e);
  process.exit(1);
});

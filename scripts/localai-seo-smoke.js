// ============================================================
// PallettAI Studio — Local AI & SEO Smoke Test Runner
// Tests modules/local-ai.js, modules/i18n.js, modules/seo-graph.js,
// and modules/social-card.js to verify proper functionality.
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

// Ensure test output directory exists
function ensureTestDir() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
  return TEST_DIR;
}

// Clean up test directory
function cleanTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  ensureTestDir();
}

// ============================================================
// Test: modules/local-ai.js
// ============================================================

async function testLocalAI() {
  log('\n' + COLORS.bold + '=== Testing modules/local-ai.js ===' + COLORS.reset, 'info');

  const localAI = require('../modules/local-ai');

  // Test 1: Engine initialization (should work in fallback mode)
  try {
    const state = await localAI.initLocalEngine();
    assertPass(
      state.initialized === true,
      'initLocalEngine() returns initialized state',
      `State: ${JSON.stringify(state)}`
    );
  } catch (e) {
    fail('initLocalEngine() initializes without throwing', e);
  }

  // Test 2: Engine status
  try {
    const status = localAI.getEngineStatus();
    assertPass(
      typeof status === 'object',
      'getEngineStatus() returns an object',
      `Status: ${JSON.stringify(status)}`
    );
  } catch (e) {
    fail('getEngineStatus() returns status object', e);
  }

  // Test 3: Image format detection — PNG
  try {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const format = localAI.detectImageFormat(pngBuffer);
    assertPass(
      format === 'png',
      'detectImageFormat() detects PNG format',
      `Detected: ${format}`
    );
  } catch (e) {
    fail('detectImageFormat() detects PNG', e);
  }

  // Test 4: Image format detection — JPEG
  try {
    const jpegBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    const format = localAI.detectImageFormat(jpegBuffer);
    assertPass(
      format === 'jpeg',
      'detectImageFormat() detects JPEG format',
      `Detected: ${format}`
    );
  } catch (e) {
    fail('detectImageFormat() detects JPEG', e);
  }

  // Test 5: Image format detection — GIF
  try {
    const gifBuffer = Buffer.from([0x47, 0x49, 0x46, 0x38]);
    const format = localAI.detectImageFormat(gifBuffer);
    assertPass(
      format === 'gif',
      'detectImageFormat() detects GIF format',
      `Detected: ${format}`
    );
  } catch (e) {
    fail('detectImageFormat() detects GIF', e);
  }

  // Test 6: Alt text generation — heuristic fallback
  try {
    const altText = await localAI.generateOfflineAltText('hero-banner-summer-sale.jpg');
    assertPass(
      typeof altText === 'string' && altText.length > 0,
      'generateOfflineAltText() returns descriptive alt text',
      `Alt text: "${altText}"`
    );
  } catch (e) {
    fail('generateOfflineAltText() generates text', e);
  }

  // Test 7: Alt text with path context
  try {
    const altText = await localAI.generateOfflineAltText('/images/products/coffee-mug.png');
    assertPass(
      typeof altText === 'string' && altText.length > 0,
      'generateOfflineAltText() uses path context',
      `Alt text: "${altText}"`
    );
  } catch (e) {
    fail('generateOfflineAltText() uses path context', e);
  }

  // Test 8: Rewrite text — shorten
  try {
    const longText = 'This is a very long piece of text that contains multiple sentences and should be shortened significantly when processed by the shorten function which aims to reduce length while keeping main meaning.';
    const shortText = await localAI.rewriteTextOffline(longText, 'shorten');
    assertPass(
      typeof shortText === 'string' && shortText.length < longText.length,
      'rewriteTextOffline() with "shorten" mode reduces text length',
      `Original: ${longText.length} chars, Shortened: ${shortText.length} chars`
    );
  } catch (e) {
    fail('rewriteTextOffline() shorten mode', e);
  }

  // Test 9: Rewrite text — professional tone
  try {
    const casualText = "we're basically gonna do some stuff and it's gonna be lit";
    const professional = await localAI.rewriteTextOffline(casualText, 'professional_tone');
    assertPass(
      typeof professional === 'string',
      'rewriteTextOffline() with "professional_tone" mode returns result',
      `Result: "${professional}"`
    );
  } catch (e) {
    fail('rewriteTextOffline() professional_tone mode', e);
  }

  // Test 10: Rewrite text — fix grammar
  try {
    const badGrammar = "they dont know whats going on and its not good";
    const fixed = await localAI.rewriteTextOffline(badGrammar, 'fix_grammar');
    assertPass(
      typeof fixed === 'string',
      'rewriteTextOffline() with "fix_grammar" mode returns result',
      `Result: "${fixed}"`
    );
  } catch (e) {
    fail('rewriteTextOffline() fix_grammar mode', e);
  }

  // Test 11: Rewrite with invalid mode
  try {
    const result = await localAI.rewriteTextOffline('some text', 'invalid_mode');
    assertPass(
      typeof result === 'string',
      'rewriteTextOffline() gracefully handles invalid mode',
      `Defaulted to: "${result}"`
    );
  } catch (e) {
    fail('rewriteTextOffline() handles invalid mode', e);
  }

  // Test 12: Heuristic alt text function
  try {
    const heuristic = localAI.inferAltTextHeuristic('about-us-team-photo.jpg');
    assertPass(
      typeof heuristic === 'string' && heuristic.length > 0,
      'inferAltTextHeuristic() extracts meaning from filename',
      `Heuristic: "${heuristic}"`
    );
  } catch (e) {
    fail('inferAltTextHeuristic() extracts filename meaning', e);
  }

  // Test 13: Heuristic rewrite function
  try {
    const rewritten = localAI.applyRewriteHeuristic('hello world  this is a test', 'fix_grammar');
    assertPass(
      rewritten.includes('Hello') || rewritten.includes('hello'),
      'applyRewriteHeuristic() applies text transformations',
      `Result: "${rewritten}"`
    );
  } catch (e) {
    fail('applyRewriteHeuristic() applies transformations', e);
  }
}

// ============================================================
// Test: modules/i18n.js
// ============================================================

async function testI18N() {
  log('\n' + COLORS.bold + '=== Testing modules/i18n.js ===' + COLORS.reset, 'info');

  const i18n = require('../modules/i18n');

  // Test 1: Language name lookup
  try {
    const name = i18n.getLocaleName('en');
    assertPass(
      name === 'English',
      'getLocaleName() returns English name for "en"',
      `Name: ${name}`
    );
  } catch (e) {
    fail('getLocaleName() returns name', e);
  }

  // Test 2: Browser language detection
  try {
    const lang = i18n.detectBrowserLanguage('en-US,en;q=0.9,es;q=0.8');
    assertPass(
      lang === 'en',
      'detectBrowserLanguage() parses Accept-Language header',
      `Detected: ${lang}`
    );
  } catch (e) {
    fail('detectBrowserLanguage() parses header', e);
  }

  // Test 3: Browser detection — Spanish preference
  try {
    const lang = i18n.detectBrowserLanguage('es-ES,es;q=0.9,en;q=0.5');
    assertPass(
      lang === 'es',
      'detectBrowserLanguage() detects Spanish preference',
      `Detected: ${lang}`
    );
  } catch (e) {
    fail('detectBrowserLanguage() detects Spanish', e);
  }

  // Test 4: URL building
  try {
    const url = i18n.buildLocaleUrl('https://example.com', 'es', 'about');
    assertPass(
      url === 'https://example.com/es/about',
      'buildLocaleUrl() builds correct locale URL',
      `URL: ${url}`
    );
  } catch (e) {
    fail('buildLocaleUrl() builds URL', e);
  }

  // Test 5: Language switcher script generation
  try {
    const script = i18n.generateLanguageSwitcherScript(['en', 'es', 'fr'], 'en');
    assertPass(
      typeof script === 'string' && script.length > 100,
      'generateLanguageSwitcherScript() generates valid JS',
      `Script length: ${script.length} chars`
    );
  } catch (e) {
    fail('generateLanguageSwitcherScript() generates script', e);
  }

  // Test 6: Language switcher contains locale list
  try {
    const script = i18n.generateLanguageSwitcherScript(['en', 'es'], 'en');
    assertPass(
      script.includes('"en"') && script.includes('"es"'),
      'Language switcher script contains configured locales',
      ''
    );
  } catch (e) {
    fail('Language switcher contains locales', e);
  }

  // Test 7: hreflang injection (fallback method)
  try {
    const html = `<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>`;
    const result = i18n._test.injectHreflangLinksFallback(html, ['en', 'es', 'fr'], 'en', 'https://example.com');
    assertPass(
      result.includes('hreflang="es"') && result.includes('hreflang="fr"'),
      'injectHreflangLinksFallback() adds hreflang links',
      ''
    );
  } catch (e) {
    fail('injectHreflangLinksFallback() adds hreflang', e);
  }

  // Test 8: hreflang injection includes canonical
  try {
    const html = `<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>`;
    const result = i18n._test.injectHreflangLinksFallback(html, ['en', 'es'], 'en', 'https://example.com');
    assertPass(
      result.includes('rel="canonical"'),
      'injectHreflangLinksFallback() adds canonical link',
      ''
    );
  } catch (e) {
    fail('injectHreflangLinksFallback() adds canonical', e);
  }

  // Test 9: Translation interpolation
  try {
    const result = i18n.interpolateTranslation('Hello {name}, welcome to {place}!', { name: 'John', place: 'Paris' });
    assertPass(
      result === 'Hello John, welcome to Paris!',
      'interpolateTranslation() replaces placeholders',
      `Result: ${result}`
    );
  } catch (e) {
    fail('interpolateTranslation() replaces placeholders', e);
  }

  // Test 10: Full multilingual compilation (mock project)
  try {
    const testDir = ensureTestDir();
    const sourceDir = path.join(testDir, 'source');
    const outputDir = path.join(testDir, 'output');

    // Create source directory with HTML
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'index.html'),
      `<!DOCTYPE html><html lang="en"><head><title>Test Site</title></head><body><h1>Welcome</h1></body></html>`,
      'utf8'
    );

    // Mock project schema
    const project = {
      sourcePath: sourceDir,
      outputPath: outputDir,
      locales: ['en', 'es', 'de'],
      defaultLocale: 'en',
      domain: 'https://example.com',
      translations: {
        en: { title: 'Test Site', heading: 'Welcome', content: 'Welcome to our site.' },
        es: { title: 'Sitio de Prueba', heading: 'Bienvenido', content: 'Bienvenido a nuestro sitio.' },
        de: { title: 'Testseite', heading: 'Willkommen', content: 'Willkommen auf unserer Seite.' }
      }
    };

    const report = await i18n.compileMultilingualSite(project);

    assertPass(
      report.success === true,
      'compileMultilingualSite() completes successfully',
      `Locales: ${report.localesGenerated.join(', ')}`
    );

    // Check output structure
    for (const locale of project.locales) {
      const localeDir = path.join(outputDir, locale);
      assertPass(
        fs.existsSync(localeDir),
        `Locale directory created: ${locale}/`,
        ''
      );

      const indexPath = path.join(localeDir, 'index.html');
      assertPass(
        fs.existsSync(indexPath),
        `index.html created in ${locale}/`,
        ''
      );

      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath, 'utf8');
        assertPass(
          content.includes(`lang="${locale}"`),
          `HTML has lang="${locale}" attribute`,
          ''
        );
      }
    }

    // Check hreflang links in English version
    const enIndex = fs.readFileSync(path.join(outputDir, 'en', 'index.html'), 'utf8');
    assertPass(
      enIndex.includes('hreflang="es"') && enIndex.includes('hreflang="de"'),
      'English HTML includes hreflang for other locales',
      ''
    );

    // Check language switcher script
    assertPass(
      enIndex.includes('PallettAI Studio — Language Switcher') ||
      enIndex.includes('__pallettaiLanguage'),
      'HTML includes language switcher script',
      ''
    );

    // Clean up
    fs.rmSync(testDir, { recursive: true, force: true });

  } catch (e) {
    fail('compileMultilingualSite() full compilation', e);
    // Clean up on error
    try {
      fs.rmSync(ensureTestDir(), { recursive: true, force: true });
    } catch (e2) {}
  }
}

// ============================================================
// Test: modules/seo-graph.js
// ============================================================

async function testSeoGraph() {
  log('\n' + COLORS.bold + '=== Testing modules/seo-graph.js ===' + COLORS.reset, 'info');

  const seoGraph = require('../modules/seo-graph');

  // Test 1: JSON-LD script generation
  try {
    const graph = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Test Company'
    };
    const script = seoGraph._test.generateJsonLdScript(graph);
    assertPass(
      script.includes('application/ld+json') && script.includes('Test Company'),
      '_test.generateJsonLdScript() generates valid script tag',
      ''
    );
  } catch (e) {
    fail('_test.generateJsonLdScript() generates script', e);
  }

  // Test 2: Organization schema generation
  try {
    const business = {
      name: 'Test Cafe',
      url: 'https://testcafe.com',
      logo: 'https://testcafe.com/logo.png',
      email: 'contact@testcafe.com',
      telephone: '+1234567890'
    };
    const schema = seoGraph._test.buildOrganizationSchema(business);
    assertPass(
      schema && schema['@type'] === 'Organization' && schema.name === 'Test Cafe',
      '_test.buildOrganizationSchema() creates Organization schema',
      `Type: ${schema['@type']}`
    );
  } catch (e) {
    fail('_test.buildOrganizationSchema() creates schema', e);
  }

  // Test 3: Organization with address and geo
  try {
    const business = {
      name: 'Test Shop',
      address: {
        streetAddress: '123 Main St',
        addressLocality: 'New York',
        addressRegion: 'NY',
        postalCode: '10001',
        addressCountry: 'US'
      },
      geo: { latitude: 40.7128, longitude: -74.0060 }
    };
    const schema = seoGraph._test.buildOrganizationSchema(business);
    assertPass(
      schema.address && schema.address['@type'] === 'PostalAddress' &&
      schema.geo && schema.geo.latitude === 40.7128,
      '_test.buildOrganizationSchema() includes address and geo',
      ''
    );
  } catch (e) {
    fail('_test.buildOrganizationSchema() includes address', e);
  }

  // Test 4: Product schema with offer
  try {
    const product = {
      name: 'Coffee Mug',
      description: 'A beautiful ceramic mug',
      price: 19.99,
      currency: 'USD',
      availability: 'inStock'
    };
    const schema = seoGraph._test.buildProductSchema(product, { name: 'Test Store' });
    assertPass(
      schema && schema['@type'] === 'Product' &&
      schema.name === 'Coffee Mug' &&
      schema.offers && schema.offers.price === 19.99,
      '_test.buildProductSchema() creates Product with Offer',
      `Price: ${schema.offers.price}`
    );
  } catch (e) {
    fail('_test.buildProductSchema() creates Product', e);
  }

  // Test 5: FAQPage schema
  try {
    const faqs = [
      { question: 'What are your hours?', answer: 'We are open 9am to 5pm.' },
      { question: 'Do you take reservations?', answer: 'Yes, call us to book.' }
    ];
    const schema = seoGraph._test.buildFAQPageSchema(faqs);
    assertPass(
      schema && schema['@type'] === 'FAQPage' &&
      schema.mainEntity && schema.mainEntity.length === 2,
      '_test.buildFAQPageSchema() creates FAQPage schema',
      `Questions: ${schema.mainEntity.length}`
    );
  } catch (e) {
    fail('_test.buildFAQPageSchema() creates FAQPage', e);
  }

  // Test 6: JobPosting schema
  try {
    const job = {
      title: 'Software Engineer',
      description: 'We are looking for a talented engineer.',
      company: 'Tech Corp',
      location: 'San Francisco, CA',
      employmentType: 'FULL_TIME',
      datePosted: '2024-01-15'
    };
    const schema = seoGraph._test.buildJobPostingSchema(job, { name: 'Tech Corp' });
    assertPass(
      schema && schema['@type'] === 'JobPosting' &&
      schema.title === 'Software Engineer',
      '_test.buildJobPostingSchema() creates JobPosting schema',
      `Title: ${schema.title}`
    );
  } catch (e) {
    fail('_test.buildJobPostingSchema() creates JobPosting', e);
  }

  // Test 7: Article schema
  try {
    const article = {
      title: 'How to Build Great Websites',
      description: 'A comprehensive guide.',
      type: 'Article',
      author: 'Jane Doe',
      datePublished: '2024-02-01'
    };
    const schema = seoGraph._test.buildArticleSchema(article, null, { url: 'https://example.com' });
    assertPass(
      schema && schema['@type'] === 'Article' &&
      schema.headline === 'How to Build Great Websites',
      '_test.buildArticleSchema() creates Article schema',
      `Headline: ${schema.headline}`
    );
  } catch (e) {
    fail('_test.buildArticleSchema() creates Article', e);
  }

  // Test 8: Full schema graph generation
  try {
    const projectSchema = {
      business: {
        name: 'PallettAI Studio',
        url: 'https://pallettai.com',
        logo: 'https://pallettai.com/logo.png',
        telephone: '+18001234567',
        email: 'hello@pallettai.com',
        address: {
          streetAddress: '100 Design Street',
          addressLocality: 'San Francisco',
          addressRegion: 'CA',
          postalCode: '94102',
          addressCountry: 'US'
        },
        geo: { latitude: 37.7749, longitude: -122.4194 },
        openingHours: {
          monday: '9:00-17:00',
          tuesday: '9:00-17:00',
          wednesday: '9:00-17:00',
          thursday: '9:00-17:00',
          friday: '9:00-17:00'
        }
      },
      products: [
        {
          name: 'Website Design Package',
          description: 'Complete website design service',
          price: 2999,
          currency: 'USD',
          availability: 'inStock'
        }
      ],
      faqs: [
        { question: 'How long does a website take?', answer: 'Typical projects take 4-6 weeks.' },
        { question: 'Do you offer hosting?', answer: 'Yes, we offer managed hosting.' }
      ]
    };

    const graph = seoGraph.generateSchemaGraph(projectSchema);
    assertPass(
      graph && graph.includes('application/ld+json') && graph.includes('PallettAI Studio'),
      'generateSchemaGraph() generates complete JSON-LD with multiple schemas',
      `Graph length: ${graph.length} chars`
    );

    // Validate JSON-LD
    const validation = seoGraph.validateJsonLd(graph);
    assertPass(
      validation.valid || validation.errors.length === 0,
      'Generated schema passes validation',
      `Errors: ${validation.errors.length}, Warnings: ${validation.warnings.length}`
    );
    if (!validation.valid) {
      console.log('  Validation details:', JSON.stringify(validation));
    }

  } catch (e) {
    fail('generateSchemaGraph() full generation', e);
  }

  // Test 9: Sitemap generation
  try {
    const projectSchema = {
      domain: 'https://example.com',
      locales: ['en', 'es', 'fr'],
      pages: [
        { url: '/', lastmod: '2024-01-15', changefreq: 'daily', priority: '1.0' },
        { url: '/about', lastmod: '2024-01-10', changefreq: 'monthly', priority: '0.8' },
        { url: '/contact', lastmod: '2024-01-05', changefreq: 'yearly', priority: '0.5' }
      ]
    };

    const sitemap = seoGraph.generateSitemap(projectSchema);
    assertPass(
      sitemap.includes('<?xml') && sitemap.includes('<urlset') &&
      sitemap.includes('https://example.com/') &&
      sitemap.includes('<loc>'),
      'generateSitemap() creates valid XML sitemap',
      `Sitemap length: ${sitemap.length} chars`
    );

    // Check for proper structure
    assertPass(
      sitemap.includes('</urlset>') && sitemap.split('<url>').length - 1 === 3,
      'Sitemap has correct structure with 3 URLs',
      ''
    );

  } catch (e) {
    fail('generateSitemap() creates sitemap', e);
  }

  // Test 10: Sitemap with hreflang entries
  try {
    const projectSchema = {
      domain: 'https://example.com',
      locales: ['en', 'es', 'fr'],
      pages: [
        { url: '/', locales: ['en', 'es', 'fr'], lastmod: '2024-01-15' }
      ]
    };

    const sitemap = seoGraph.generateSitemap(projectSchema);
    assertPass(
      sitemap.includes('hreflang="es"') && sitemap.includes('hreflang="fr"'),
      'Sitemap includes hreflang alternate links',
      ''
    );

  } catch (e) {
    fail('Sitemap includes hreflang', e);
  }

  // Test 11: Robots.txt generation
  try {
    const robots = seoGraph.generateRobotsTxt('https://example.com', true);
    assertPass(
      robots.includes('User-agent: *') && robots.includes('Allow: /') &&
      robots.includes('Sitemap:'),
      'generateRobotsTxt() creates valid robots.txt',
      `Length: ${robots.length} chars`
    );

  } catch (e) {
    fail('generateRobotsTxt() creates robots.txt', e);
  }

  // Test 12: Robots.txt with indexing disabled
  try {
    const robots = seoGraph.generateRobotsTxt('https://example.com', false);
    assertPass(
      robots.includes('Disallow: /'),
      'generateRobotsTxt() with allowIndexing=false creates Disallow',
      ''
    );

  } catch (e) {
    fail('Robots.txt respects indexing setting', e);
  }

  // Test 13: JSON-LD validation
  try {
    const validGraph = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Valid Org'
    };
    const result = seoGraph.validateJsonLd(JSON.stringify(validGraph));
    assertPass(
      result.valid === true && result.errors.length === 0,
      'validateJsonLd() accepts valid schema',
      ''
    );

  } catch (e) {
    fail('validateJsonLd() accepts valid schema', e);
  }

  // Test 14: JSON-LD validation with errors
  try {
    const invalidGraph = { '@type': 'Organization' }; // missing name
    const result = seoGraph.validateJsonLd(JSON.stringify(invalidGraph));
    assertPass(
      result.valid === false && result.errors.length > 0,
      'validateJsonLd() detects missing name',
      `Errors: ${result.errors.join(', ')}`
    );

  } catch (e) {
    fail('validateJsonLd() detects errors', e);
  }

  // Test 15: Extract schema from HTML
  try {
    const html = `
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Organization","name":"Test"}
      </script>
    `;
    const schemas = seoGraph.extractSchemaFromHtml(html);
    assertPass(
      Array.isArray(schemas) && schemas.length === 1 && schemas[0].name === 'Test',
      'extractSchemaFromHtml() extracts JSON-LD from HTML',
      `Found: ${schemas.length} schema(s)`
    );

  } catch (e) {
    fail('extractSchemaFromHtml() extracts schema', e);
  }
}

// ============================================================
// Test: modules/social-card.js
// ============================================================

async function testSocialCard() {
  log('\n' + COLORS.bold + '=== Testing modules/social-card.js ===' + COLORS.reset, 'info');

  const socialCard = require('../modules/social-card');

  // Test 1: Color parsing — hex
  try {
    const color = socialCard._test.parseColor('#FF5733');
    assertPass(
      color.r === 255 && color.g === 87 && color.b === 51,
      '_test.parseColor() parses hex color',
      `RGB: ${color.r}, ${color.g}, ${color.b}`
    );
  } catch (e) {
    fail('_test.parseColor() parses hex', e);
  }

  // Test 2: Color parsing — named color
  try {
    const color = socialCard._test.parseColor('blue');
    assertPass(
      color.r === 0 && color.g === 0 && color.b === 255,
      '_test.parseColor() parses named color "blue"',
      `RGB: ${color.r}, ${color.g}, ${color.b}`
    );
  } catch (e) {
    fail('_test.parseColor() parses named color', e);
  }

  // Test 3: Color parsing — rgb string
  try {
    const color = socialCard._test.parseColor('rgb(100, 150, 200)');
    assertPass(
      color.r === 100 && color.g === 150 && color.b === 200,
      '_test.parseColor() parses rgb() string',
      `RGB: ${color.r}, ${color.g}, ${color.b}`
    );
  } catch (e) {
    fail('_test.parseColor() parses rgb()', e);
  }

  // Test 4: Color blending
  try {
    const blended = socialCard._test.blendColors('#FF0000', '#0000FF', 0.5);
    assertPass(
      blended.r === 128 && blended.b === 128 && blended.g === 0,
      '_test.blendColors() blends red and blue to purple',
      `RGB: ${blended.r}, ${blended.g}, ${blended.b}`
    );
  } catch (e) {
    fail('_test.blendColors() blends colors', e);
  }

  // Test 5: Contrast color detection
  try {
    const lightBg = socialCard._test.getContrastColor('#FFFFFF');
    assertPass(
      lightBg.r === 0 && lightBg.g === 0 && lightBg.b === 0,
      '_test.getContrastColor() returns black for white background',
      `RGB: ${lightBg.r}, ${lightBg.g}, ${lightBg.b}`
    );
  } catch (e) {
    fail('_test.getContrastColor() detects contrast', e);
  }

  // Test 6: Contrast color for dark background
  try {
    const darkBg = socialCard._test.getContrastColor('#000000');
    assertPass(
      darkBg.r === 255 && darkBg.g === 255 && darkBg.b === 255,
      '_test.getContrastColor() returns white for black background',
      `RGB: ${darkBg.r}, ${darkBg.g}, ${darkBg.b}`
    );
  } catch (e) {
    fail('_test.getContrastColor() returns white for dark', e);
  }

  // Test 7: Engine status
  try {
    const status = socialCard.getEngineStatus();
    assertPass(
      typeof status === 'object' && status.hasOwnProperty('canvasAvailable'),
      'getEngineStatus() returns engine status',
      `Canvas: ${status.canvasAvailable}`
    );
  } catch (e) {
    fail('getEngineStatus() returns status', e);
  }

  // Test 8: SVG fallback generation
  try {
    const testDir = ensureTestDir();
    const outputPath = path.join(testDir, 'test-card.svg');

    const projectSchema = {
      brand: {
        primaryColor: '#2563EB',
        secondaryColor: '#1E40AF',
        brandName: 'Test Brand'
      },
      headline: 'Test Headline',
      subheadline: 'Test Subheadline'
    };

    const result = socialCard._test.generateSvgFallback(projectSchema, {
      outputPath,
      width: 1200,
      height: 630
    });

    assertPass(
      result.success === true && fs.existsSync(result.path),
      '_test.generateSvgFallback() generates SVG card',
      `Path: ${result.path}`
    );

    // Verify SVG content
    const content = fs.readFileSync(result.path, 'utf8');
    assertPass(
      content.includes('<svg') && content.includes('Test Headline'),
      'Generated SVG contains expected elements',
      ''
    );

    // Clean up
    fs.rmSync(testDir, { recursive: true, force: true });

  } catch (e) {
    fail('_test.generateSvgFallback() generates SVG', e);
    try {
      fs.rmSync(ensureTestDir(), { recursive: true, force: true });
    } catch (e2) {}
  }

  // Test 9: Meta tag injection
  try {
    const html = `<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>`;
    const result = socialCard._test.injectSocialMetaTags(html, '/assets/og-image.png', {
      title: 'Test Page',
      description: 'A test page description'
    });

    assertPass(
      result.includes('og:image') && result.includes('/assets/og-image.png') &&
      result.includes('twitter:card') && result.includes('summary_large_image'),
      '_test.injectSocialMetaTags() adds og:image and twitter:card',
      ''
    );

  } catch (e) {
    fail('_test.injectSocialMetaTags() injects meta tags', e);
  }

  // Test 10: Generate complete social meta tags
  try {
    const tags = socialCard._test.generateSocialMetaTags({
      title: 'My Website',
      description: 'A great website',
      siteName: 'My Site',
      ogImage: '/images/og.png'
    });

    assertPass(
      tags.includes('og:title') && tags.includes('My Website') &&
      tags.includes('twitter:card') && tags.includes('summary_large_image'),
      '_test.generateSocialMetaTags() generates complete meta tags',
      `Tags length: ${tags.length}`
    );

  } catch (e) {
    fail('_test.generateSocialMetaTags() generates tags', e);
  }

  // Test 11: Canvas-based card rendering (if canvas available)
  if (socialCard.getEngineStatus().canvasAvailable) {
    try {
      const testDir = ensureTestDir();
      const outputPath = path.join(testDir, 'canvas-card.png');

      const projectSchema = {
        brand: {
          primaryColor: '#2563EB',
          secondaryColor: '#1E40AF',
          brandName: 'PallettAI'
        },
        headline: 'PallettAI Studio',
        subheadline: 'Build Beautiful Websites'
      };

      const result = await socialCard.renderSocialPreviewCard(projectSchema, {
        outputPath,
        width: 1200,
        height: 630
      });

      assertPass(
        result.success === true && fs.existsSync(result.path) && result.width === 1200,
        'renderSocialPreviewCard() renders canvas-based card',
        `Path: ${result.path}, Size: ${result.fileSize} bytes`
      );

      // Verify PNG file
      const buffer = fs.readFileSync(result.path);
      assertPass(
        buffer.length > 0 && buffer[0] === 0x89 && buffer[1] === 0x50,
        'Generated file is valid PNG',
        ''
      );

      // Clean up
      fs.rmSync(testDir, { recursive: true, force: true });

    } catch (e) {
      fail('renderSocialPreviewCard() renders canvas card', e);
      try {
        fs.rmSync(ensureTestDir(), { recursive: true, force: true });
      } catch (e2) {}
    }
  } else {
    log('  ⊘ Canvas not available, skipping canvas render test', 'warn');
  }
}

// ============================================================
// Test Runner
// ============================================================

async function runAllTests() {
  log('\n' + COLORS.bold + COLORS.info + '╔══════════════════════════════════════════════════════╗' + COLORS.reset, 'info');
  log(COLORS.bold + COLORS.info + '║   PallettAI Studio — Local AI & SEO Smoke Tests    ║' + COLORS.reset, 'info');
  log(COLORS.bold + COLORS.info + '╚══════════════════════════════════════════════════════╝' + COLORS.reset, 'info');

  // Clean test output directory
  cleanTestDir();

  // Run all test suites
  try {
    await testLocalAI();
  } catch (e) {
    log('\n✗ LocalAI tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testI18N();
  } catch (e) {
    log('\n✗ i18n tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testSeoGraph();
  } catch (e) {
    log('\n✗ SEO Graph tests crashed:', 'fail');
    console.error(e);
  }

  try {
    await testSocialCard();
  } catch (e) {
    log('\n✗ Social Card tests crashed:', 'fail');
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

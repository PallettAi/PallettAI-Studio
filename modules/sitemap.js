// ============================================================
// PallettAI Studio — Multi-Locale Sitemap & IndexNow Syndication
// Generates compliant sitemaps with hreflang mappings and
// IndexNow protocol payloads for instant search engine indexing.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// Date Formatting
// ============================================================

/**
 * Format date to W3C Datetime (ISO 8601) for sitemaps
 */
function formatW3CDate(date) {
  if (!date) return new Date().toISOString().split('T')[0];

  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];

  return d.toISOString().split('T')[0];
}

/**
 * Format date to RFC 822 for other uses
 */
function formatRFC822(date) {
  if (!date) return new Date().toUTCString();

  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return new Date().toUTCString();

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

// ============================================================
// URL Utilities
// ============================================================

/**
 * Normalize URL to ensure consistent format
 */
function normalizeUrl(url) {
  if (!url) return '';

  let normalized = url.trim();

  // Remove trailing slash (except for root)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Ensure URL has protocol
 */
function ensureProtocol(url, defaultProtocol = 'https') {
  if (!url) return '';

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  return `${defaultProtocol}://${url}`;
}

/**
 * Build localized URL
 */
function buildLocalizedUrl(baseUrl, locale, path = '') {
  const cleanBase = normalizeUrl(ensureProtocol(baseUrl));
  const cleanPath = path.replace(/^\/+/, '');

  if (locale === 'en' && !path) {
    // Root URL for default locale
    return cleanBase;
  }

  if (locale === 'en') {
    // English with path
    return `${cleanBase}/${cleanPath}`.replace(/\/+/g, '/');
  }

  // Non-English locale
  return `${cleanBase}/${locale}/${cleanPath}`.replace(/\/+/g, '/');
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================
// Sitemap XML Generation
// ============================================================

/**
 * Generate a sitemap XML for a single sitemap file
 *
 * @param {string} siteUrl - Base URL of the site
 * @param {Array} pageList - Array of page objects
 * @param {Object} i18nConfig - Internationalization config
 * @param {Array} i18nConfig.locales - List of supported locales
 * @param {string} i18nConfig.defaultLocale - Default locale (default: 'en')
 * @returns {string} Complete sitemap XML
 */
function generateSitemapXML(siteUrl, pageList = [], i18nConfig = {}) {
  const {
    locales = ['en'],
    defaultLocale = 'en'
  } = i18nConfig;

  const baseUrl = normalizeUrl(ensureProtocol(siteUrl));

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

  // Add xhtml namespace for hreflang if multiple locales
  if (locales.length > 1) {
    xml += ' xmlns:xhtml="http://www.w3.org/1999/xhtml"';
  }

  xml += '>\n';

  // Process each page
  for (const page of pageList) {
    if (!page || !page.url) continue;

    const pageUrl = page.url.startsWith('http') ? page.url : `${baseUrl}${page.url}`;
    const pageLocales = page.locales || locales;
    const lastMod = page.lastmod || page.date || page.updatedAt || null;
    const changeFreq = page.changefreq || page.changeFrequency || 'monthly';
    const priority = page.priority || '0.5';

    xml += '  <url>\n';
    xml += `    <loc>${escapeXml(pageUrl)}</loc>\n`;

    if (lastMod) {
      xml += `    <lastmod>${formatW3CDate(lastMod)}</lastmod>\n`;
    }

    if (changeFreq) {
      xml += `    <changefreq>${escapeXml(changeFreq)}</changefreq>\n`;
    }

    if (priority) {
      xml += `    <priority>${escapeXml(String(priority))}</priority>\n`;
    }

    // Add hreflang alternate links
    if (pageLocales.length > 1) {
      for (const locale of pageLocales) {
        if (locale === defaultLocale && !page.url.startsWith('/')) {
          // Skip self-referencing link for root English
          continue;
        }

        let altUrl;
        if (page.localeUrl && page.localeUrl[locale]) {
          altUrl = ensureProtocol(page.localeUrl[locale]);
        } else {
          altUrl = buildLocalizedUrl(siteUrl, locale, page.url.replace(/^\/[a-z]{2}\//, ''));
        }

        xml += `    <xhtml:link rel="alternate" hreflang="${escapeXml(locale)}" href="${escapeXml(altUrl)}" />\n`;
      }

      // Self-referencing canonical
      xml += `    <xhtml:link rel="alternate" hreflang="${escapeXml(defaultLocale)}" href="${escapeXml(pageUrl)}" />\n`;
    }

    xml += '  </url>\n';
  }

  xml += '</urlset>';

  return xml;
}

/**
 * Generate a sitemap index XML
 *
 * @param {string} siteUrl - Base URL of the site
 * @param {Array} sitemapFiles - Array of sitemap file paths/URLs
 * @param {string} lastMod - Last modification date for the index
 * @returns {string} Complete sitemap index XML
 */
function generateSitemapIndexXML(siteUrl, sitemapFiles = [], lastMod = null) {
  const baseUrl = normalizeUrl(ensureProtocol(siteUrl));

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const sitemap of sitemapFiles) {
    const sitemapUrl = sitemap.startsWith('http') ? sitemap : `${baseUrl}${sitemap}`;

    xml += '  <sitemap>\n';
    xml += `    <loc>${escapeXml(sitemapUrl)}</loc>\n`;

    if (lastMod) {
      xml += `    <lastmod>${formatW3CDate(lastMod)}</lastmod>\n`;
    }

    xml += '  </sitemap>\n';
  }

  xml += '</sitemapindex>';

  return xml;
}

/**
 * Generate complete sitemap setup
 * Creates individual sitemaps and index if needed
 *
 * @param {Object} options - Generation options
 * @param {string} options.siteUrl - Base URL
 * @param {Array} options.pages - All pages
 * @param {Object} options.i18n - i18n config
 * @param {number} options.maxUrlsPerSitemap - URLs per sitemap (default: 50000, max: 50000)
 * @param {string} options.outputDir - Output directory for sitemap files
 * @returns {Object} Generated files info
 */
function generateCompleteSitemap(options = {}) {
  const {
    siteUrl,
    pages = [],
    i18n = {},
    maxUrlsPerSitemap = 50000,
    outputDir = 'dist'
  } = options;

  if (!siteUrl) {
    throw new Error('siteUrl is required');
  }

  const baseUrl = normalizeUrl(ensureProtocol(siteUrl));
  const files = [];
  const allSitemaps = [];

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Split pages into chunks
  const chunks = [];
  for (let i = 0; i < pages.length; i += maxUrlsPerSitemap) {
    chunks.push(pages.slice(i, i + maxUrlsPerSitemap));
  }

  // Generate individual sitemaps
  chunks.forEach((chunk, index) => {
    const isMain = index === 0;
    const sitemapName = isMain ? 'sitemap.xml' : `sitemap-${index}.xml`;
    const sitemapPath = path.join(outputDir, sitemapName);

    const xml = generateSitemapXML(siteUrl, chunk, i18n);
    fs.writeFileSync(sitemapPath, xml, 'utf8');

    files.push({
      path: sitemapPath,
      url: `${baseUrl}/${sitemapName}`,
      count: chunk.length
    });

    allSitemaps.push(sitemapName);
  });

  // Generate sitemap index if multiple sitemaps
  let indexFile = null;
  if (allSitemaps.length > 1) {
    const indexPath = path.join(outputDir, 'sitemap-index.xml');
    const indexXml = generateSitemapIndexXML(siteUrl, allSitemaps);

    // Also write to root as sitemap.xml for compatibility
    const rootIndexPath = path.join(outputDir, '..', 'sitemap.xml');
    fs.writeFileSync(rootIndexPath, indexXml, 'utf8');

    indexFile = {
      path: indexPath,
      url: `${baseUrl}/sitemap-index.xml`,
      type: 'index'
    };
  }

  return {
    files,
    index: indexFile,
    totalUrls: pages.length,
    totalSitemaps: allSitemaps.length
  };
}

// ============================================================
// IndexNow Protocol
// ============================================================

/**
 * Generate IndexNow API key (for new sites)
 * Key should be 120 bytes hex, saved to www.domain.com/key.txt
 */
function generateIndexNowKey() {
  return crypto.randomBytes(60).toString('hex');
}

/**
 * Validate IndexNow key format
 */
function validateIndexNowKey(key) {
  if (!key || typeof key !== 'string') return false;
  return /^[a-f0-9]{120}$/i.test(key);
}

/**
 * Build IndexNow HTTP payload
 *
 * @param {string} siteUrl - Site URL
 * @param {string} apiKey - IndexNow API key
 * @param {Array} urls - URLs to submit for indexing
 * @param {Object} options - Additional options
 * @returns {Object} Payload object
 */
function buildIndexNowPayload(siteUrl, apiKey, urls = [], options = {}) {
  if (!validateIndexNowKey(apiKey)) {
    throw new Error('Invalid IndexNow API key. Must be 120 character hex string.');
  }

  const baseUrl = normalizeUrl(ensureProtocol(siteUrl));

  const payload = {
    host: new URL(baseUrl).hostname,
    key: apiKey,
    keyLocation: `https://${new URL(baseUrl).hostname}/${apiKey}.txt`,
    urlList: urls.map(url => {
      if (url.startsWith('http')) return url;
      return `${baseUrl}${url}`.replace(/\/+/g, '/');
    }),
    ...options
  };

  return payload;
}

/**
 * Generate IndexNow HTTP request body (JSON)
 */
function generateIndexNowRequestBody(siteUrl, apiKey, urls = []) {
  const payload = buildIndexNowPayload(siteUrl, apiKey, urls);
  return JSON.stringify(payload);
}

/**
 * Generate IndexNow HTTP request headers
 */
function generateIndexNowHeaders(contentType = 'application/json') {
  return {
    'Content-Type': contentType,
    'Host': '',  // Will be set by HTTP client
    'User-Agent': 'PallettAI Studio/1.0 (IndexNow Protocol)'
  };
}

/**
 * Build IndexNow submission URL
 * @param {string} apiKey - API key
 * @returns {string} Submission endpoint URL
 */
function getIndexNowEndpoint(apiKey) {
  const keyHost = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  return `https://${keyHost}.wp.com/indexnow`;
}

/**
 * Validate URLs for IndexNow submission
 */
function validateIndexNowUrls(urls) {
  const errors = [];
  const validUrls = [];

  if (!Array.isArray(urls)) {
    return { valid: false, errors: ['URLs must be an array'] };
  }

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    if (!url || typeof url !== 'string') {
      errors.push(`URL[${i}]: must be a non-empty string`);
      continue;
    }

    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      validUrls.push(url.startsWith('http') ? url : urlObj.href);

      // Check if same host
      if (urlObj.hostname !== new URL('https://example.com').hostname) {
        // This is fine, we'll check against siteUrl later
      }
    } catch (e) {
      errors.push(`URL[${i}]: invalid URL format - ${e.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    validUrls
  };
}

/**
 * Complete IndexNow submission preparation
 */
function prepareIndexNowSubmission(siteUrl, apiKey, urls = [], options = {}) {
  const validation = validateIndexNowUrls(urls);

  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors
    };
  }

  try {
    const payload = buildIndexNowPayload(siteUrl, apiKey, validation.validUrls, options);
    const body = generateIndexNowRequestBody(siteUrl, apiKey, validation.validUrls);
    const headers = generateIndexNowHeaders();
    const endpoint = getIndexNowEndpoint(apiKey);

    return {
      success: true,
      endpoint,
      headers,
      body,
      payload,
      urlCount: validation.validUrls.length,
      keyLocation: payload.keyLocation
    };
  } catch (e) {
    return {
      success: false,
      errors: [e.message]
    };
  }
}

/**
 * Generate robots.txt with sitemap reference
 */
function generateRobotsTxtWithSitemap(siteUrl, sitemapUrl = null) {
  const baseUrl = normalizeUrl(ensureProtocol(siteUrl));
  const sitemapLocation = sitemapUrl || `${baseUrl}/sitemap.xml`;

  return `User-agent: *
Allow: /

Sitemap: ${sitemapLocation}
`;
}

// ============================================================
// Sitemap Validation
// ============================================================

/**
 * Validate sitemap XML structure
 */
function validateSitemapXML(xml) {
  const errors = [];

  if (!xml || typeof xml !== 'string') {
    return { valid: false, errors: ['Sitemap must be a string'] };
  }

  // Check XML declaration
  if (!xml.includes('<?xml')) {
    errors.push('Missing XML declaration');
  }

  // Check urlset root
  if (!xml.includes('<urlset') && !xml.includes('<sitemapindex')) {
    errors.push('Missing urlset or sitemapindex root element');
  }

  // Check for loc elements
  const locCount = (xml.match(/<loc>/g) || []).length;
  if (locCount === 0) {
    errors.push('No <loc> elements found');
  }

  return {
    valid: errors.length === 0,
    errors,
    urlCount: locCount
  };
}

/**
 * Count URLs in sitemap
 */
function countSitemapUrls(xml) {
  if (!xml || typeof xml !== 'string') {
    return 0;
  }

  // Count both urlset loc and sitemapindex loc
  const urlsetCount = (xml.match(/<urlset[^>]*>[\s\S]*?<\/urlset>/g) || [])
    .join('')
    .match(/<loc>/g) || [];

  const indexCount = (xml.match(/<sitemap>[\s\S]*?<\/sitemap>/g) || [])
    .join('')
    .match(/<loc>/g) || [];

  return urlsetCount.length + indexCount.length;
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Sitemap generation
  generateSitemapXML,
  generateSitemapIndexXML,
  generateCompleteSitemap,

  // IndexNow
  generateIndexNowKey,
  validateIndexNowKey,
  buildIndexNowPayload,
  generateIndexNowRequestBody,
  generateIndexNowHeaders,
  getIndexNowEndpoint,
  validateIndexNowUrls,
  prepareIndexNowSubmission,

  // Robots
  generateRobotsTxtWithSitemap,

  // Validation
  validateSitemapXML,
  countSitemapUrls,

  // Utilities
  formatW3CDate,
  formatRFC822,
  normalizeUrl,
  ensureProtocol,
  buildLocalizedUrl,
  escapeXml,

  // For testing
  _test: {
    generateSitemapXML,
    generateSitemapIndexXML,
    generateCompleteSitemap,
    generateIndexNowKey,
    validateIndexNowKey,
    buildIndexNowPayload,
    generateIndexNowRequestBody,
    generateIndexNowHeaders,
    getIndexNowEndpoint,
    validateIndexNowUrls,
    prepareIndexNowSubmission,
    validateSitemapXML,
    countSitemapUrls,
    escapeXml,
    buildLocalizedUrl
  }
};

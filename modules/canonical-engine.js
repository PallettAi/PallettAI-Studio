// ============================================================
// PallettAI Studio — Canonical URL & Duplicate Content Protector
// Manages canonical URL resolution, robots directives, and
// SEO indexing rules for static site exports.
// ============================================================

const url = require('url');

// ============================================================
// URL Parsing & Normalization
// ============================================================

/**
 * Parse URL and extract components
 */
function parseUrl(urlString) {
  if (!urlString) return null;

  try {
    // Add protocol if missing
    const withProtocol = urlString.startsWith('http://') || urlString.startsWith('https://')
      ? urlString
      : 'https://' + urlString;

    return new URL(withProtocol);
  } catch (e) {
    return null;
  }
}

/**
 * Normalize URL - remove trailing slash, normalize protocol
 */
function normalizeUrl(urlString, options = {}) {
  const {
    enforceHttps = true,
    removeTrailingSlash = true,
    removeWww = false,
    keepPathSlash = false
  } = options;

  if (!urlString) return '';

  let normalized = urlString.trim();

  // Parse URL
  let parsed;
  try {
    parsed = new URL(normalized.startsWith('http') ? normalized : 'https://' + normalized);
  } catch (e) {
    return normalized;
  }

  // Enforce HTTPS
  if (enforceHttps && parsed.protocol === 'http:') {
    parsed.protocol = 'https:';
  }

  // Remove www subdomain
  if (removeWww) {
    let hostname = parsed.hostname;
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
      parsed.hostname = hostname;
    }
  }

  // Remove trailing slash from path (except root)
  if (removeTrailingSlash && parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  // Keep path slash if requested
  if (keepPathSlash && parsed.pathname === '/') {
    // Keep as is
  }

  // Remove default ports
  if (parsed.port === '80' && parsed.protocol === 'http:') {
    parsed.port = '';
  }
  if (parsed.port === '443' && parsed.protocol === 'https:') {
    parsed.port = '';
  }

  return parsed.toString();
}

/**
 * Strip UTM and tracking parameters from URL
 */
function stripTrackingParams(urlString) {
  if (!urlString) return '';

  try {
    const parsed = new URL(urlString.startsWith('http') ? urlString : 'https://' + urlString);

    // Parameters to strip
    const trackingParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'gclid',
      'fbclid',
      'mc_cid',
      'mc_eid',
      'ref',
      'source',
      'igshid'
    ];

    // Remove tracking parameters
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }

    // Also remove any empty search
    if (parsed.search === '') {
      parsed.search = '';
    }

    return parsed.toString();
  } catch (e) {
    return urlString;
  }
}

/**
 * Build canonical URL
 */
function buildCanonicalUrl(pagePath, siteUrl, options = {}) {
  const {
    enforceHttps = true,
    stripParams = true,
    normalizeSlash = true,
    addTrailingSlash = false
  } = options;

  if (!siteUrl) {
    return pagePath;
  }

  // Parse site URL
  let baseUrl;
  try {
    baseUrl = new URL(siteUrl.startsWith('http') ? siteUrl : 'https://' + siteUrl);
  } catch (e) {
    baseUrl = new URL('https://example.com');
  }

  // Normalize page path
  let path = pagePath || '/';

  // Remove leading slash for joining
  if (path.startsWith('/')) {
    path = path.slice(1);
  }

  // Build full URL
  const canonical = new URL(path, baseUrl);

  // Apply options
  if (enforceHttps && canonical.protocol === 'http:') {
    canonical.protocol = 'https:';
  }

  if (stripParams) {
    canonical.search = '';
  }

  if (normalizeSlash) {
    if (canonical.pathname.length > 1 && canonical.pathname.endsWith('/')) {
      canonical.pathname = canonical.pathname.slice(0, -1);
    }
  }

  if (addTrailingSlash && canonical.pathname !== '/') {
    if (!canonical.pathname.endsWith('/')) {
      canonical.pathname += '/';
    }
  }

  // Remove default ports
  if (canonical.port === '80' || canonical.port === '443') {
    canonical.port = '';
  }

  return canonical.toString();
}

// ============================================================
// Canonical Tag Generation
// ============================================================

/**
 * Generate canonical link tag
 */
function generateCanonicalTag(canonicalUrl) {
  if (!canonicalUrl) return '';

  return `<link rel="canonical" href="${escapeHtmlAttribute(canonicalUrl)}">`;
}

/**
 * Inject canonical tag into HTML
 */
function injectCanonicalTag(html, canonicalUrl) {
  if (!canonicalUrl) return html;

  const canonicalTag = generateCanonicalTag(canonicalUrl);

  // Check if canonical already exists
  if (html.includes('rel="canonical"')) {
    // Replace existing canonical
    const canonicalRegex = /<link[^>]*rel=["']canonical["'][^>]*>/gi;
    return html.replace(canonicalRegex, canonicalTag);
  }

  // Find head and insert before closing
  const headEndIndex = html.toLowerCase().lastIndexOf('</head>');

  if (headEndIndex !== -1) {
    return html.slice(0, headEndIndex) + '\n  ' + canonicalTag + html.slice(headEndIndex);
  }

  // Fallback: append to end
  return html + '\n' + canonicalTag;
}

/**
 * Remove duplicate canonical tags
 */
function removeDuplicateCanonicals(html) {
  const canonicalRegex = /<link[^>]*rel=["']canonical["'][^>]*>\s*/gi;
  const matches = html.match(canonicalRegex);

  if (!matches || matches.length <= 1) {
    return html;
  }

  // Keep only the first canonical tag
  const firstMatch = matches[0];
  let result = html.replace(canonicalRegex, '');
  result = result.replace(firstMatch, ''); // Remove the first one too
  result = result.trim() +
    '\n<link rel="canonical" href="' + extractCanonicalFromTag(firstMatch) + '">';

  return result;
}

/**
 * Extract canonical URL from existing tag
 */
function extractCanonicalFromTag(tag) {
  const match = tag.match(/href=["']([^"']*)["']/i);
  return match ? match[1] : '';
}

// ============================================================
// Robots Meta Directives
// ============================================================

/**
 * Generate robots meta tag content
 */
function generateRobotsDirectives(pageMeta, environment = 'production') {
  const {
    isDraft = false,
    isStaging = false,
    isPasswordProtected = false,
    isPrivate = false,
    allowIndexing = true,
    allowFollowing = true
  } = pageMeta || {};

  // Determine if page should be indexed
  let shouldIndex = allowIndexing;
  let shouldFollow = allowFollowing;

  // Environment-based rules
  if (environment === 'staging' || environment === 'development' || isStaging) {
    shouldIndex = false;
    shouldFollow = false;
  }

  // Page-based rules
  if (isDraft) {
    shouldIndex = false;
  }

  if (isPasswordProtected || isPrivate) {
    shouldIndex = false;
  }

  // Build content
  const directives = [];

  if (shouldIndex) {
    directives.push('index');
  } else {
    directives.push('noindex');
  }

  if (shouldFollow) {
    directives.push('follow');
  } else {
    directives.push('nofollow');
  }

  // Add nosnippet if not indexing
  if (!shouldIndex) {
    directives.push('nosnippet');
  }

  return directives.join(', ');
}

/**
 * Generate robots meta tag
 */
function generateRobotsMetaTag(pageMeta, environment = 'production') {
  const content = generateRobotsDirectives(pageMeta, environment);

  if (!content) {
    return '';
  }

  return `<meta name="robots" content="${escapeHtmlAttribute(content)}">`;
}

/**
 * Inject robots meta tag into HTML
 */
function injectRobotsMetaTag(html, pageMeta, environment = 'production') {
  const robotsTag = generateRobotsMetaTag(pageMeta, environment);

  if (!robotsTag) {
    return html;
  }

  // Check if robots meta already exists
  if (html.includes('name="robots"')) {
    // Replace existing
    const robotsRegex = /<meta[^>]*name=["']robots["'][^>]*>/gi;
    return html.replace(robotsRegex, robotsTag);
  }

  // Find head and insert before closing
  const headEndIndex = html.toLowerCase().lastIndexOf('</head>');

  if (headEndIndex !== -1) {
    return html.slice(0, headEndIndex) + '\n  ' + robotsTag + html.slice(headEndIndex);
  }

  // Fallback: append to end
  return html + '\n' + robotsTag;
}

// ============================================================
// Additional SEO Meta Tags
// ============================================================

/**
 * Generate noindex/nofollow meta tag for specific pages
 */
function generateNoIndexMetaTag(options = {}) {
  const {
    noindex = true,
    nofollow = false,
    noarchive = false,
    nosnippet = false
  } = options;

  const directives = [];

  if (noindex) directives.push('noindex');
  if (nofollow) directives.push('nofollow');
  if (noarchive) directives.push('noarchive');
  if (nosnippet) directives.push('nosnippet');

  if (directives.length === 0) return '';

  return `<meta name="robots" content="${escapeHtmlAttribute(directives.join(', '))}">`;
}

/**
 * Generate hreflang tags for multilingual sites
 */
function generateHreflangTags(locales, defaultLocale = 'en', baseUrl = '') {
  if (!locales || locales.length === 0) return '';

  const tags = [];

  // Self-referencing canonical for default locale
  if (baseUrl) {
    tags.push(`<link rel="canonical" href="${escapeHtmlAttribute(baseUrl)}">`);
  }

  for (const locale of locales) {
    // Build locale-specific URL
    let localeUrl = baseUrl;
    if (locale !== defaultLocale) {
      // Add locale prefix
      if (localeUrl.endsWith('/')) {
        localeUrl = localeUrl.slice(0, -1);
      }
      localeUrl = `${localeUrl}/${locale}/`;
    }

    tags.push(
      `<link rel="alternate" hreflang="${locale}" href="${escapeHtmlAttribute(localeUrl)}">`
    );
  }

  // X-default for language negotiation
  tags.push(
    `<link rel="alternate" hreflang="x-default" href="${escapeHtmlAttribute(baseUrl || '/')}">`
  );

  return tags.join('\n  ');
}

/**
 * Escape HTML attribute value
 */
function escapeHtmlAttribute(value) {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // URL handling
  parseUrl,
  normalizeUrl,
  stripTrackingParams,
  buildCanonicalUrl,

  // Canonical tags
  generateCanonicalTag,
  injectCanonicalTag,
  removeDuplicateCanonicals,
  extractCanonicalFromTag,

  // Robots directives
  generateRobotsDirectives,
  generateRobotsMetaTag,
  injectRobotsMetaTag,
  generateNoIndexMetaTag,

  // Hreflang
  generateHreflangTags,

  // Utilities
  escapeHtmlAttribute,
  escapeHtml,

  // For testing
  _test: {
    parseUrl,
    normalizeUrl,
    stripTrackingParams,
    buildCanonicalUrl,
    generateCanonicalTag,
    injectCanonicalTag,
    removeDuplicateCanonicals,
    extractCanonicalFromTag,
    generateRobotsDirectives,
    generateRobotsMetaTag,
    injectRobotsMetaTag,
    generateNoIndexMetaTag,
    generateHreflangTags,
    escapeHtmlAttribute,
    escapeHtml
  }
};

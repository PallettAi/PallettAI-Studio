// ============================================================
// PallettAI Studio — Edge Security Headers & Redirect Mapper
// Generates production-grade _headers and _redirects files for
// Cloudflare Pages, Netlify, and similar edge platforms.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Security Headers Generator
// ============================================================

/**
 * Generate a comprehensive Content-Security-Policy header
 *
 * @param {Object} options - CSP configuration
 * @param {string} options.defaultSrc - Default source policy (default: 'self')
 * @param {string} options.scriptSrc - Script sources (default: 'self')
 * @param {string} options.styleSrc - Style sources (default: 'self')
 * @param {string} options.imgSrc - Image sources (default: 'self data:')
 * @param {string} options.connectSrc - Connect sources (default: 'self')
 * @param {string} options.fontSrc - Font sources (default: 'self')
 * @param {string} options.objectSrc - Object sources (default: 'none')
 * @param {string} options.mediaSrc - Media sources (default: 'self')
 * @param {string} options.frameSrc - Frame sources (default: 'self')
 * @param {string} options.workerSrc - Worker sources (default: 'self')
 * @param {string} options.formAction - Form action sources (default: 'self')
 * @param {string} options.frameAncestors - Frame ancestors (default: 'self')
 * @param {string} options.baseUri - Base URI (default: 'self')
 * @param {string} options.reportUri - Report URI endpoint
 * @param {boolean} options.reportOnly - Generate report-only header
 * @returns {string} CSP header value
 */
function generateCSP(options = {}) {
  const {
    defaultSrc = "'self'",
    scriptSrc = "'self'",
    styleSrc = "'self' 'unsafe-inline'",
    imgSrc = "'self' data: https:",
    connectSrc = "'self'",
    fontSrc = "'self'",
    objectSrc = "'none'",
    mediaSrc = "'self'",
    frameSrc = "'self'",
    workerSrc = "'self'",
    formAction = "'self'",
    frameAncestors = "'self'",
    baseUri = "'self'",
    reportUri,
    reportOnly = false
  } = options;

  const directives = [
    `default-src ${defaultSrc}`,
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src ${imgSrc}`,
    `connect-src ${connectSrc}`,
    `font-src ${fontSrc}`,
    `object-src ${objectSrc}`,
    `media-src ${mediaSrc}`,
    `frame-src ${frameSrc}`,
    `worker-src ${workerSrc}`,
    `form-action ${formAction}`,
    `frame-ancestors ${frameAncestors}`,
    `base-uri ${baseUri}`
  ];

  // Add report URI if specified
  if (reportUri) {
    const cspDirective = reportOnly ? 'report-sample' : 'report-uri';
    directives.push(`${cspDirective} ${reportUri}`);
  }

  // Add strict-dynamic if using nonce-based approach
  if (options.strictDynamic) {
    directives.splice(directives.findIndex(d => d.startsWith('script-src')), 0, "script-src 'strict-dynamic'");
  }

  // Add upgrade-insecure-requests
  if (options.upgradeInsecureRequests !== false) {
    directives.push('upgrade-insecure-requests');
  }

  // Add block-all-mixed-content for HTTPS enforcement
  if (options.blockAllMixedContent !== false) {
    directives.push('block-all-mixed-content');
  }

  const headerValue = directives.join('; ');

  return headerValue;
}

/**
 * Generate strict-transport-security (HSTS) header
 *
 * @param {Object} options - HSTS configuration
 * @param {number} options.maxAge - Max age in seconds (default: 31536000 = 1 year)
 * @param {boolean} options.includeSubDomains - Include subdomains (default: true)
 * @param {boolean} options.preload - Enable preload (default: false)
 * @returns {string} HSTS header value
 */
function generateHSTS(options = {}) {
  const {
    maxAge = 31536000,
    includeSubDomains = true,
    preload = false
  } = options;

  const parts = [`max-age=${maxAge}`];

  if (includeSubDomains) {
    parts.push('includeSubDomains');
  }

  if (preload) {
    parts.push('preload');
  }

  return parts.join('; ');
}

/**
 * Generate X-Frame-Options header
 *
 * @param {string} option - DENY, SAMEORIGIN, or ALLOW-FROM uri
 * @returns {string} Header value
 */
function generateXFrameOptions(option = 'SAMEORIGIN') {
  return option.toUpperCase();
}

/**
 * Generate X-Content-Type-Options header
 *
 * @returns {string} Header value (always 'nosniff')
 */
function generateXContentTypeOptions() {
  return 'nosniff';
}

/**
 * Generate Referrer-Policy header
 *
 * @param {string} policy - Referrer policy (default: 'strict-origin-when-cross-origin')
 * @returns {string} Header value
 */
function generateReferrerPolicy(policy = 'strict-origin-when-cross-origin') {
  const validPolicies = [
    'no-referrer',
    'no-referrer-when-downgrade',
    'origin',
    'origin-when-cross-origin',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
    'unsafe-url'
  ];

  if (!validPolicies.includes(policy)) {
    console.warn(`Invalid referrer policy "${policy}", using default`);
    policy = 'strict-origin-when-cross-origin';
  }

  return policy;
}

/**
 * Generate Permissions-Policy header (formerly Feature-Policy)
 *
 * @param {Object} permissions - Permissions to configure
 * @returns {string} Header value
 */
function generatePermissionsPolicy(permissions = {}) {
  const defaults = {
    geolocation: '()',
    microphone: '()',
    camera: '()',
    payment: '()',
    usb: '()',
    bluetooth: '()',
    wakeLock: '()'
  };

  const merged = { ...defaults, ...permissions };
  const directives = [];

  for (const [feature, allowList] of Object.entries(merged)) {
    // Include even '()' restrictions (they are valid and important for security)
    if (allowList !== false) {
      directives.push(`${feature}=${allowList}`);
    }
  }

  return directives.length > 0 ? directives.join(', ') : '';
}

/**
 * Generate Access-Control headers for API endpoints
 *
 * @param {Object} options - CORS configuration
 * @param {string} options.allowOrigin - Allowed origin (default: '*')
 * @param {string} options.allowMethods - Allowed methods (default: 'GET, POST, OPTIONS')
 * @param {string} options.allowHeaders - Allowed headers
 * @param {number} options.maxAge - Preflight cache max age in seconds
 * @returns {Object} CORS headers object
 */
function generateCORSHeaders(options = {}) {
  const {
    allowOrigin = '*',
    allowMethods = 'GET, POST, OPTIONS',
    allowHeaders,
    maxAge
  } = options;

  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': allowMethods
  };

  if (allowHeaders) {
    headers['Access-Control-Allow-Headers'] = allowHeaders;
  }

  if (maxAge) {
    headers['Access-Control-Max-Age'] = String(maxAge);
  }

  return headers;
}

/**
 * Generate a complete _headers file for edge platforms
 *
 * @param {Object} securityOptions - Security configuration
 * @param {Object} paths - Path-specific header overrides
 * @returns {string} Complete _headers file content
 */
function generateHeadersFile(securityOptions = {}, paths = {}) {
  const {
    csp = {},
    hsts = {},
    xFrameOptions = 'SAMEORIGIN',
    referrerPolicy = 'strict-origin-when-cross-origin',
    permissionsPolicy = {},
    cors = null,
    contentTypeOptions = true
  } = securityOptions;

  const lines = [];
  let currentPath = '';

  // Helper to add headers for a path
  function addHeaders(path, headers) {
    if (currentPath && currentPath !== path) {
      lines.push('');
    }
    currentPath = path;

    if (path) {
      lines.push(path);
    }

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null && value !== false) {
        lines.push(`  ${key}: ${value}`);
      }
    }
  }

  // Global security headers
  const globalHeaders = {};

  // CSP
  if (Object.keys(csp).length > 0 || csp.defaultSrc) {
    globalHeaders['Content-Security-Policy'] = generateCSP(csp);
  }

  // HSTS
  if (Object.keys(hsts).length > 0 || hsts.maxAge) {
    globalHeaders['Strict-Transport-Security'] = generateHSTS(hsts);
  }

  // X-Frame-Options
  if (xFrameOptions) {
    globalHeaders['X-Frame-Options'] = generateXFrameOptions(xFrameOptions);
  }

  // X-Content-Type-Options
  if (contentTypeOptions !== false) {
    globalHeaders['X-Content-Type-Options'] = generateXContentTypeOptions();
  }

  // Referrer-Policy
  if (referrerPolicy) {
    globalHeaders['Referrer-Policy'] = generateReferrerPolicy(referrerPolicy);
  }

  // Permissions-Policy
  if (Object.keys(permissionsPolicy).length > 0) {
    globalHeaders['Permissions-Policy'] = generatePermissionsPolicy(permissionsPolicy);
  }

  // Add global headers for all paths
  addHeaders('/*', globalHeaders);

  // CORS headers if specified
  if (cors) {
    addHeaders('/api/*', generateCORSHeaders(cors));
  }

  // Path-specific overrides
  for (const [pathPattern, pathHeaders] of Object.entries(paths)) {
    if (pathHeaders && typeof pathHeaders === 'object') {
      addHeaders(pathPattern, pathHeaders);
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Generate HSTS preload information
 *
 * @param {Object} options - HSTS options
 * @returns {Object} Preload info
 */
function getHSTSPreloadInfo(options = {}) {
  const { maxAge, includeSubDomains, preload } = options;

  const info = {
    eligible: false,
    requirements: [],
    status: 'not_configured'
  };

  // Check if eligible for preload
  if (maxAge && maxAge >= 31536000 && includeSubDomains && preload) {
    info.eligible = true;
    info.requirements = [
      'max-age must be at least 31536000 (1 year)',
      'includeSubDomains must be present',
      'preload token must be present',
      'HTTPS must be deployed on all subdomains'
    ];
    info.status = 'eligible';
  }

  return info;
}

/**
 * Validate security headers configuration
 *
 * @param {Object} config - Configuration to validate
 * @returns {Object} Validation result
 */
function validateSecurityConfig(config = {}) {
  const warnings = [];
  const errors = [];

  // Validate CSP
  if (config.csp) {
    if (config.csp.scriptSrc && config.csp.scriptSrc.includes("'unsafe-inline'")) {
      warnings.push('CSP includes "unsafe-inline" for scripts - consider using nonces or hashes');
    }

    if (config.csp.imgSrc && config.csp.imgSrc.includes('data:')) {
      warnings.push('CSP allows data: URIs for images - may enable data exfiltration');
    }
  }

  // Validate HSTS
  if (config.hsts) {
    if (!config.hsts.maxAge || config.hsts.maxAge < 31536000) {
      warnings.push('HSTS max-age less than 1 year - preload eligibility requires 1+ year');
    }

    if (config.hsts.preload && !config.hsts.includeSubDomains) {
      errors.push('HSTS preload requires includeSubDomains');
    }
  }

  // Validate referrer policy
  if (config.referrerPolicy === 'unsafe-url') {
    warnings.push('Referrer-Policy set to unsafe-url - leaks full URL to all destinations');
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors
  };
}

// ============================================================
// Redirects File Generator
// ============================================================

/**
 * Generate a _redirects file for edge platforms
 *
 * @param {Array} redirectRules - Array of redirect rule objects
 * @param {Object} options - Redirect options
 * @param {boolean} options.trailingSlash - Auto-redirect trailing slash variants (default: true)
 * @returns {string} Complete _redirects file content
 */
function generateRedirectsFile(redirectRules = [], options = {}) {
  const {
    trailingSlash = true
  } = options;

  const lines = [];

  // Add header comment
  lines.push('# PallettAI Studio — URL Redirects');
  lines.push('# Generated: ' + new Date().toISOString());
  lines.push('# Format: FROM TO STATUS [CONDITION]');
  lines.push('');

  // Add redirect rules
  for (const rule of redirectRules) {
    const line = formatRedirectRule(rule);
    if (line) {
      lines.push(line);
    }
  }

  // Add trailing slash normalization rules if enabled
  if (trailingSlash) {
    lines.push('');
    lines.push('# Trailing slash normalization');
    lines.push('# Remove trailing slash (except for root)');
    lines.push('/*      /:splat    301     !regex:^.*/$');
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

/**
 * Format a single redirect rule
 *
 * @param {Object} rule - Redirect rule object
 * @param {string} rule.from - Source URL pattern
 * @param {string} rule.to - Destination URL
 * @param {number|string} rule.status - HTTP status code (301, 302, 307, 308)
 * @param {Object} rule.conditions - Optional conditions (country, role, etc.)
 * @param {boolean} rule.force - Force redirect even if file exists
 * @param {boolean} rule.sparce - Sparse redirect (no implicit scope)
 * @returns {string} Formatted redirect line
 */
function formatRedirectRule(rule) {
  if (!rule || !rule.from || !rule.to) {
    return null;
  }

  const from = rule.from;
  const to = rule.to;
  const status = rule.status || 301;
  const force = rule.force ? ' !' : '';
  const sparce = rule.sparce ? ' ' : ' /*';

  let line = `${from}\t${to}\t${status}${force}${sparce}`;

  // Add conditions if specified
  if (rule.conditions && typeof rule.conditions === 'object') {
    const conditionParts = [];

    if (rule.conditions.country) {
      conditionParts.push(`country=${rule.conditions.country}`);
    }

    if (rule.conditions.role) {
      conditionParts.push(`role=${rule.conditions.role}`);
    }

    if (rule.conditions.language) {
      conditionParts.push(`language=${rule.conditions.language}`);
    }

    if (rule.conditions.header) {
      conditionParts.push(`header=${rule.conditions.header}`);
    }

    if (conditionParts.length > 0) {
      line += '\t' + conditionParts.join(', ');
    }
  }

  return line;
}

/**
 * Common redirect rule presets
 */
function getPresetRedirects(preset = 'standard') {
  const presets = {
    standard: [
      // Old to new URL structure
      { from: '/old-page', to: '/new-page', status: 301 },
      { from: '/legacy/blog/:slug', to: '/blog/:slug', status: 301 },

      // WWW to non-WWW (enforce canonical domain)
      { from: 'www.example.com/*', to: 'https://example.com/:splat', status: 301, force: true },

      // HTTP to HTTPS
      { from: 'http://example.com/*', to: 'https://example.com/:splat', status: 301, force: true },

      // Trailing slash redirect
      { from: '/blog/', to: '/blog', status: 301 },

      // Case-insensitive redirect (if supported)
      { from: '/About', to: '/about', status: 301 }
    ],

    blog: [
      { from: '/blog/:slug', to: '/posts/:slug', status: 301 },
      { from: '/feed', to: '/feed.xml', status: 301 },
      { from: '/subscribe', to: '/subscribe', status: 301 }
    ],

    shop: [
      { from: '/products/:id', to: '/product/:id', status: 301 },
      { from: '/cart', to: '/checkout', status: 302 },
      { from: '/old-checkout', to: '/checkout', status: 301 }
    ],

    api: [
      { from: '/api/v1/*', to: '/api/v2/:splat', status: 301 },
      { from: '/api/old-endpoint', to: '/api/new-endpoint', status: 301 }
    ],

    maintenance: [
      { from: '/*', to: '/maintenance.html', status: 302, conditions: { role: 'maintenance' } }
    ]
  };

  return presets[preset] || presets.standard;
}

/**
 * Generate canonical trailing slash rules
 *
 * @param {Object} options - Options
 * @param {boolean} options.forceTrailingSlash - Add trailing slash (default: false, remove)
 * @returns {Array} Redirect rules
 */
function generateTrailingSlashRules(options = {}) {
  const { forceTrailingSlash = false } = options;

  if (forceTrailingSlash) {
    return [
      { from: '/*', to: '/:splat/', status: 301, force: true }
    ];
  }

  return [
    { from: '/*', to: '/:splat', status: 301, force: true, sparce: true }
  ];
}

/**
 * Generate redirect rules from URL mappings
 *
 * @param {Object} urlMap - Map of old URLs to new URLs
 * @param {number} defaultStatus - Default status code (default: 301)
 * @returns {Array} Redirect rules
 */
function generateRedirectsFromMap(urlMap, defaultStatus = 301) {
  const rules = [];

  for (const [from, to] of Object.entries(urlMap)) {
    rules.push({
      from: from,
      to: to,
      status: defaultStatus
    });
  }

  return rules;
}

/**
 * Validate redirect rule
 *
 * @param {Object} rule - Rule to validate
 * @returns {Object} Validation result
 */
function validateRedirectRule(rule) {
  const errors = [];

  if (!rule.from) {
    errors.push('Missing "from" pattern');
  }

  if (!rule.to) {
    errors.push('Missing "to" destination');
  }

  const validStatuses = [301, 302, 307, 308];
  if (rule.status && !validStatuses.includes(rule.status)) {
    errors.push(`Invalid status code: ${rule.status}. Must be one of: ${validStatuses.join(', ')}`);
  }

  if (rule.from.endsWith('/*') && !rule.to.includes(':splat')) {
    errors.push('Wildcard redirect must use :splat in destination');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Security headers
  generateHeadersFile,
  generateCSP,
  generateHSTS,
  generateXFrameOptions,
  generateXContentTypeOptions,
  generateReferrerPolicy,
  generatePermissionsPolicy,
  generateCORSHeaders,
  getHSTSPreloadInfo,
  validateSecurityConfig,

  // Redirects
  generateRedirectsFile,
  formatRedirectRule,
  getPresetRedirects,
  generateTrailingSlashRules,
  generateRedirectsFromMap,
  validateRedirectRule,

  // For testing
  _test: {
    generateHeadersFile,
    generateCSP,
    generateHSTS,
    generateXFrameOptions,
    generateXContentTypeOptions,
    generateReferrerPolicy,
    generatePermissionsPolicy,
    generateCORSHeaders,
    generateRedirectsFile,
    formatRedirectRule,
    getPresetRedirects,
    generateTrailingSlashRules,
    generateRedirectsFromMap,
    validateRedirectRule,
    validateSecurityConfig
  }
};

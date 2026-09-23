// ============================================================
// PallettAI Studio — Visual Sitemap Matrix & WebSub Syndication
// Generates hierarchical sitemap trees for UI previewing and
// WebSub (PubSubHubbub) ping payloads for content syndication.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Visual Sitemap Tree Generation
// ============================================================

/**
 * Generate a visual sitemap tree structure for UI previewing
 *
 * @param {Object} projectSchema - Project schema with pages
 * @param {Object} options - Generation options
 * @returns {Object} Hierarchical tree structure
 */
function generateVisualSitemapTree(projectSchema, options = {}) {
  const {
    rootUrl = '/',
    locale = 'en',
    maxDepth = 5,
    includeLocalizedUrls = true
  } = options;

  const pages = projectSchema.pages || [];
  const rootNode = {
    id: 'root',
    label: 'Home',
    url: rootUrl,
    path: '/',
    depth: 0,
    type: 'root',
    children: [],
    localizedUrls: includeLocalizedUrls ? {} : null
  };

  // Build page lookup by URL path
  const pageLookup = new Map();
  for (const page of pages) {
    if (page.url) {
      const normalizedUrl = normalizeUrlPath(page.url);
      pageLookup.set(normalizedUrl, page);
    }
  }

  // Build tree structure
  const tree = buildTreeFromPages(pages, rootNode, pageLookup, locale, maxDepth, 1);

  // Add localized URL variants
  if (includeLocalizedUrls && projectSchema.i18n) {
    addLocalizedUrlsToTree(tree, projectSchema.i18n, locale);
  }

  return tree;
}

/**
 * Normalize URL path for comparison
 */
function normalizeUrlPath(url) {
  if (!url) return '';

  let path = url.trim();

  // Remove protocol and domain
  if (path.includes('://')) {
    const parts = path.split('/');
    path = parts.slice(3).join('/');
  }

  // Remove trailing slash (except root)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // Ensure leading slash
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  return path.toLowerCase();
}

/**
 * Build tree structure from pages
 */
function buildTreeFromPages(pages, rootNode, pageLookup, locale, maxDepth, currentDepth) {
  if (currentDepth > maxDepth) {
    return rootNode;
  }

  // Group pages by parent path
  const childrenByParent = new Map();

  for (const page of pages) {
    if (!page.url) continue;

    const pagePath = normalizeUrlPath(page.url);
    if (pagePath === '/' || pagePath === rootNode.path) {
      continue; // Skip root
    }

    // Find parent path
    const pathParts = pagePath.split('/').filter(Boolean);
    if (pathParts.length === 0) continue;

    const parentPath = '/' + pathParts.slice(0, -1).join('/');
    if (pathParts.length === 1) {
      // Direct child of root
      if (!childrenByParent.has('/')) {
        childrenByParent.set('/', []);
      }
      childrenByParent.get('/').push(page);
    } else {
      // Child of another page
      if (!childrenByParent.has(parentPath)) {
        childrenByParent.set(parentPath, []);
      }
      childrenByParent.get(parentPath).push(page);
    }
  }

  // Recursively build tree
  const rootPath = normalizeUrlPath(rootNode.url);
  const rootChildren = childrenByParent.get(rootPath) || [];

  for (const childPage of rootChildren) {
    const childPath = normalizeUrlPath(childPage.url);
    const childNode = {
      id: childPage.id || childPage.slug || childPath.slice(1),
      label: childPage.title || extractPageLabel(childPage),
      url: childPage.url,
      path: childPath,
      depth: currentDepth,
      type: inferPageType(childPage),
      children: [],
      localizedUrls: {}
    };

    // Recursively add children
    const grandChildren = childrenByParent.get(childPath) || [];
    for (const grandChild of grandChildren) {
      if (currentDepth + 1 <= maxDepth) {
        const grandChildPath = normalizeUrlPath(grandChild.url);
        const grandChildNode = {
          id: grandChild.id || grandChild.slug || grandChildPath.slice(1),
          label: grandChild.title || extractPageLabel(grandChild),
          url: grandChild.url,
          path: grandChildPath,
          depth: currentDepth + 1,
          type: inferPageType(grandChild),
          children: [],
          localizedUrls: {}
        };

        childNode.children.push(grandChildNode);
      }
    }

    rootNode.children.push(childNode);
  }

  return rootNode;
}

/**
 * Extract label from page
 */
function extractPageLabel(page) {
  if (page.title) return page.title;
  if (page.heading) return page.heading;
  if (page.name) return page.name;

  // Extract from URL
  const path = page.url || '';
  const parts = path.split('/').filter(Boolean);
  if (parts.length > 0) {
    return decodeURIComponent(parts[parts.length - 1].replace(/[-]/g, ' '));
  }

  return 'Untitled';
}

/**
 * Infer page type from page data
 */
function inferPageType(page) {
  if (!page) return 'page';

  const type = page.type || page.pageType || page.layout || '';

  if (type.includes('blog') || type.includes('post') || type.includes('article')) {
    return 'post';
  }

  if (type.includes('product') || type.includes('shop') || type.includes('item')) {
    return 'product';
  }

  if (type.includes('about') || type.includes('contact')) {
    return 'page';
  }

  if (type.includes('home') || type.includes('landing')) {
    return 'landing';
  }

  return 'page';
}

/**
 * Add localized URL variants to tree nodes
 */
function addLocalizedUrlsToTree(tree, i18nConfig, currentLocale) {
  if (!i18nConfig || !i18nConfig.locales || !Array.isArray(i18nConfig.locales)) {
    return;
  }

  const locales = i18nConfig.locales;
  const defaultLocale = i18nConfig.defaultLocale || 'en';

  function traverse(node) {
    if (!node) return;

    // Generate localized URLs for this node
    if (node.url) {
      for (const locale of locales) {
        if (locale === currentLocale) continue;

        const localizedUrl = generateLocalizedUrl(node.url, locale, i18nConfig);
        if (localizedUrl) {
          node.localizedUrls = node.localizedUrls || {};
          node.localizedUrls[locale] = localizedUrl;
        }
      }
    }

    // Recurse into children
    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  traverse(tree);
}

/**
 * Generate localized URL for a page
 */
function generateLocalizedUrl(originalUrl, locale, i18nConfig) {
  if (!originalUrl || !locale) return null;

  const config = i18nConfig || {};
  const locales = config.locales || ['en', 'es', 'fr', 'de', 'it', 'pt'];
  const defaultLocale = config.defaultLocale || 'en';

  // Remove existing locale prefix if present
  let path = originalUrl;
  const localePattern = new RegExp(`^/(${locales.join('|')})${defaultLocale ? '|' + defaultLocale : ''}`);
  path = path.replace(localePattern, '/');

  // Ensure leading slash
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  // Add locale prefix (unless it's the default locale)
  if (locale !== defaultLocale) {
    path = `/${locale}${path}`;
  }

  return path;
}

/**
 * Calculate tree statistics
 */
function calculateTreeStats(tree) {
  if (!tree) {
    return { totalNodes: 0, maxDepth: 0, types: {} };
  }

  const stats = {
    totalNodes: 0,
    maxDepth: 0,
    types: {}
  };

  function traverse(node, depth) {
    if (!node) return;

    stats.totalNodes++;
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    const type = node.type || 'unknown';
    stats.types[type] = (stats.types[type] || 0) + 1;

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child, depth + 1);
      }
    }
  }

  traverse(tree, 0);

  return stats;
}

/**
 * Search tree for a node by ID or URL
 */
function findNodeInTree(tree, searchId) {
  if (!tree) return null;

  if (tree.id === searchId || tree.url === searchId || normalizeUrlPath(tree.url) === normalizeUrlPath(searchId)) {
    return tree;
  }

  if (tree.children && Array.isArray(tree.children)) {
    for (const child of tree.children) {
      const found = findNodeInTree(child, searchId);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Flatten tree to list
 */
function flattenTree(tree) {
  const items = [];

  function traverse(node, parentPath = '') {
    if (!node) return;

    items.push({
      id: node.id,
      label: node.label,
      url: node.url,
      path: node.path,
      depth: node.depth,
      type: node.type,
      localizedUrls: node.localizedUrls,
      parentPath
    });

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child, node.path);
      }
    }
  }

  traverse(tree);

  return items;
}

// ============================================================
// WebSub (PubSubHubbub) Syndication
// ============================================================

/**
 * WebSub hub discovery link
 */
const WEBSUB_HUB_LINK = '<link rel="hub" href="https://hub.example.com/">';
const WEBSUB_SELF_LINK = '<link rel="self" href="https://example.com/feed.xml">';

/**
 * Build WebSub ping request payload
 *
 * @param {string} hubUrl - URL of the PubSubHubbub hub
 * @param {string} topicUrl - URL of the content/feed that was updated
 * @param {Object} options - Additional options
 * @returns {Object} Ping request configuration
 */
function triggerWebSubPing(hubUrl, topicUrl, options = {}) {
  if (!hubUrl || !topicUrl) {
    throw new Error('hubUrl and topicUrl are required for WebSub ping');
  }

  const {
   leaseSeconds = 86400, // 24 hours default
    secret = null,
    content = null,
    contentType = 'application/xml',
    mode = 'ping'
  } = options;

  const payload = {
    hubUrl: hubUrl,
    topicUrl: topicUrl,
    leaseSeconds,
    mode,
    ...options
  };

  // Build HTTP request configuration
  const requestConfig = {
    url: hubUrl,
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'User-Agent': 'PallettAI Studio/1.0 (WebSub/PubSubHubbub)'
    },
    body: buildWebSubPingBody(topicUrl, leaseSeconds, secret, content),
    timeout: 10000
  };

  // Add hub signature if secret provided
  if (secret) {
    const signature = generateHubSignature(topicUrl, secret);
    requestConfig.headers['X-Hub-Signature'] = signature;
  }

  return {
    ...requestConfig,
    payload
  };
}

/**
 * Build WebSub ping body (hub disco style)
 */
function buildWebSubPingBody(topicUrl, leaseSeconds, secret, content) {
  // For simple ping mode, can use form-encoded
  const formData = new URLSearchParams();
  formData.append('hub.mode', 'ping');
  formData.append('hub.topic', topicUrl);
  formData.append('hub.signature', secret ? generateHubSignature(topicUrl, secret) : '');
  formData.append('hub.lease_seconds', String(leaseSeconds || 86400));

  if (content) {
    formData.append('content', content);
  }

  return formData.toString();
}

/**
 * Generate HMAC-SHA1 signature for WebSub
 */
function generateHubSignature(topicUrl, secret) {
  const crypto = require('crypto');

  if (!secret) return '';

  const signature = crypto
    .createHmac('sha1', secret)
    .update(topicUrl)
    .digest('base64');

  return `sha1=${signature}`;
}

/**
 * Generate WebSub discovery headers for a page
 *
 * @param {string} topicUrl - URL of the content
 * @param {string} hubUrl - URL of the hub
 * @returns {string} HTML with discovery links
 */
function generateWebSubDiscoveryLinks(topicUrl, hubUrl) {
  if (!topicUrl || !hubUrl) {
    throw new Error('topicUrl and hubUrl are required for WebSub discovery');
  }

  return `
<!-- WebSub / PubSubHubbub Discovery -->
<link rel="hub" href="${escapeHtmlAttribute(hubUrl)}">
<link rel="self" href="${escapeHtmlAttribute(topicUrl)}">
<!-- End WebSub Discovery -->
`.trim();
}

/**
 * Discover WebSub hub from a page
 *
 * @param {string} html - HTML content to search
 * @returns {Object|null} Hub info or null if not found
 */
function discoverWebSubHub(html) {
  if (!html || typeof html !== 'string') {
    return null;
  }

  // Look for hub link
  const hubRegex = /<link[^>]*rel=["']hub["'][^>]*href=["']([^"']+)["'][^>]*>/i;
  const selfRegex = /<link[^>]*rel=["']self["'][^>]*href=["']([^"']+)["'][^>]*>/i;

  const hubMatch = html.match(hubRegex);
  const selfMatch = html.match(selfRegex);

  if (!hubMatch) {
    return null;
  }

  return {
    hubUrl: hubMatch[1],
    topicUrl: selfMatch ? selfMatch[1] : null,
    discovered: true
  };
}

/**
 * Ping multiple hubs for a topic
 *
 * @param {Array} hubUrls - Array of hub URLs
 * @param {string} topicUrl - Topic URL to ping
 * @param {Object} options - Ping options
 * @returns {Array} Array of ping configurations
 */
function pingMultipleHubs(hubUrls, topicUrl, options = {}) {
  if (!Array.isArray(hubUrls) || hubUrls.length === 0) {
    return [];
  }

  return hubUrls.map(hubUrl => {
    try {
      return triggerWebSubPing(hubUrl, topicUrl, options);
    } catch (e) {
      return {
        error: e.message,
        hubUrl,
        topicUrl
      };
    }
  });
}

/**
 * Validate WebSub configuration
 */
function validateWebSubConfig(config) {
  const errors = [];

  if (!config.hubUrl || typeof config.hubUrl !== 'string') {
    errors.push('hubUrl is required and must be a string');
  }

  if (!config.topicUrl || typeof config.topicUrl !== 'string') {
    errors.push('topicUrl is required and must be a string');
  }

  if (config.leaseSeconds !== undefined && (isNaN(config.leaseSeconds) || config.leaseSeconds < 0)) {
    errors.push('leaseSeconds must be a non-negative number');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Generate WebSub ping feed entry (XML format)
 */
function generateWebSubPingFeedEntry(topicUrl, title, content, updatedDate) {
  const now = updatedDate ? new Date(updatedDate) : new Date();

  const entry = `<?xml version="1.0" encoding="UTF-8"?>
<entry xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(title || 'Content Updated')}</title>
  <link href="${escapeXml(topicUrl)}" rel="alternate"></link>
  <id>${escapeXml(topicUrl)}</id>
  <updated>${now.toISOString()}</updated>
  <content type="html">${escapeXml(content || '')}</content>
</entry>`.trim();

  return entry;
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
 * Escape XML
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
// Export
// ============================================================

module.exports = {
  // Visual sitemap
  generateVisualSitemapTree,
  buildTreeFromPages,
  normalizeUrlPath,
  calculateTreeStats,
  findNodeInTree,
  flattenTree,
  generateLocalizedUrl,

  // WebSub
  triggerWebSubPing,
  buildWebSubPingBody,
  generateHubSignature,
  generateWebSubDiscoveryLinks,
  discoverWebSubHub,
  pingMultipleHubs,
  validateWebSubConfig,
  generateWebSubPingFeedEntry,

  // Utilities
  escapeHtmlAttribute,
  escapeXml,

  // For testing
  _test: {
    generateVisualSitemapTree,
    buildTreeFromPages,
    normalizeUrlPath,
    calculateTreeStats,
    findNodeInTree,
    flattenTree,
    generateLocalizedUrl,
    triggerWebSubPing,
    buildWebSubPingBody,
    generateHubSignature,
    generateWebSubDiscoveryLinks,
    discoverWebSubHub,
    pingMultipleHubs,
    validateWebSubConfig,
    generateWebSubPingFeedEntry,
    escapeHtmlAttribute,
    escapeXml
  }
};

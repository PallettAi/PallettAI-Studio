// ============================================================
// PallettAI Studio — Automated RSS, Atom & JSON Feed Builder
// Generates valid RSS 2.0, Atom 1.0, and JSON Feed 1.1 feeds
// from project content with auto-discovery link injection.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Date Formatting Utilities
// ============================================================

/**
 * Format date to RFC 822 format (for RSS)
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

/**
 * Format date for ISO 8601 / RFC 3339 (for Atom and JSON Feed)
 */
function formatISO8601(date) {
  if (!date) return new Date().toISOString();

  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return new Date().toISOString();

  return d.toISOString();
}

/**
 * Pad number with leading zero
 */
function pad(n) {
  return n < 10 ? '0' + n : '' + n;
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

/**
 * Escape HTML for JSON feed
 */
function escapeHtmlForJson(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// Feed Building Utilities
// ============================================================

/**
 * Normalize a URL to ensure it has a protocol
 */
function normalizeUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return 'https://' + url;
}

/**
 * Build the full URL for a feed item
 */
function buildItemUrl(siteUrl, item) {
  if (!siteUrl || !item) return '';
  const base = normalizeUrl(siteUrl);
  const path = item.slug || item.id || '';
  return `${base}/${path}`.replace(/\/+/g, '/');
}

/**
 * Default feed metadata from site settings
 */
function getFeedDefaults(projectSchema) {
  const {
    siteName = 'PallettAI Studio Site',
    siteUrl = '',
    siteDescription = '',
    author = {},
    feed = {}
  } = projectSchema || {};

  return {
    title: siteName,
    description: siteDescription || 'Welcome to our site',
    siteUrl: normalizeUrl(siteUrl),
    author: {
      name: author.name || author.name || '',
      email: author.email || '',
      url: author.url ? normalizeUrl(author.url) : ''
    },
    feed: {
      url: feed.url || (normalizeUrl(siteUrl) + '/feed.xml'),
      title: feed.title || siteName,
      description: feed.description || siteDescription,
      language: feed.language || 'en',
      copyright: feed.copyright || ''
    }
  };
}

/**
 * Process a single content item for feed inclusion
 */
function processFeedItem(item, siteUrl, feedDefaults) {
  if (!item || !item.title) return null;

  const url = buildItemUrl(siteUrl, item);
  const date = item.date || item.pubDate || item.createdAt || item.datePublished;

  return {
    title: item.title,
    url: url,
    link: url,
    date: date,
    author: item.author || feedDefaults.author,
    categories: item.tags || item.categories || item.tags || [],
    content: item.content || item.description || item.excerpt || '',
    excerpt: item.excerpt || item.description || '',
    image: item.image || item.imageUrl || item.thumbnail || '',
    guid: item.guid || item.id || url,
    enclosure: item.enclosure || null
  };
}

// ============================================================
// RSS 2.0 Feed Generation
// ============================================================

/**
 * Generate a valid RSS 2.0 feed XML
 *
 * @param {Object} projectSchema - Project schema with feed items
 * @param {string} siteUrl - Base URL of the site
 * @returns {string} Complete RSS 2.0 XML
 */
function generateRSSFeed(projectSchema, siteUrl) {
  const defaults = getFeedDefaults(projectSchema);
  const siteUrlFinal = normalizeUrl(siteUrl || defaults.siteUrl);

  // Collect posts/articles from various possible locations
  let items = [];

  // Try multiple possible locations for content
  const contentSources = [
    projectSchema.posts,
    projectSchema.articles,
    projectSchema.blogPosts,
    projectSchema.content,
    projectSchema.pagination?.items
  ];

  for (const source of contentSources) {
    if (Array.isArray(source)) {
      for (const item of source) {
        const processed = processFeedItem(item, siteUrlFinal, defaults);
        if (processed) items.push(processed);
      }
    }
  }

  // Limit to most recent 20 items
  items = items.slice(0, 20);

  // Build XML
  const xml = buildRSS2Xml(defaults, items, siteUrlFinal);

  return xml;
}

/**
 * Build RSS 2.0 XML string
 */
function buildRSS2Xml(defaults, items, siteUrl) {
  const now = new Date();

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" ';
  xml += 'xmlns:content="http://purl.org/rss/1.0/modules/content/" ';
  xml += 'xmlns:wfw="http://wellformedweb.org/CommentAPI/" ';
  xml += 'xmlns:dc="http://purl.org/dc/elements/1.1/" ';
  xml += 'xmlns:sy="http://purl.org/rss/1.0/modules/syndication/" ';
  xml += 'xmlns:atom="http://www.w3.org/2005/Atom">\n';
  xml += '  <channel>\n';

  // Channel metadata
  xml += `    <title>${escapeXml(defaults.title)}</title>\n`;
  xml += `    <link>${escapeXml(siteUrl)}</link>\n`;
  xml += `    <description>${escapeXml(defaults.description)}</description>\n`;
  xml += `    <language>${escapeXml(defaults.feed.language || 'en')}</language>\n`;
  xml += `    <pubDate>${formatRFC822(now)}</pubDate>\n`;
  xml += `    <lastBuildDate>${formatRFC822(now)}</lastBuildDate>\n`;

  if (defaults.author.name) {
    xml += `    <managingEditor>${escapeXml(defaults.author.name)} (${escapeXml(defaults.author.email || '')})</managingEditor>\n`;
  }

  if (defaults.feed.copyright) {
    xml += `    <copyright>${escapeXml(defaults.feed.copyright)}</copyright>\n`;
  }

  if (siteUrl) {
    xml += `    <atom:link href="${escapeXml(siteUrl + '/feed.xml')}" rel="self" type="application/rss+xml"/>\n`;
  }

  xml += `    <ttl>60</ttl>\n`;

  // Items
  for (const item of items) {
    xml += '    <item>\n';
    xml += `      <title>${escapeXml(item.title)}</title>\n`;
    xml += `      <link>${escapeXml(item.link)}</link>\n`;
    xml += `      <guid isPermaLink="true">${escapeXml(item.guid || item.link)}</guid>\n`;

    if (item.date) {
      xml += `      <pubDate>${formatRFC822(item.date)}</pubDate>\n`;
    }

    if (item.author && item.author.name) {
      xml += `      <author>${escapeXml(item.author.name)}</author>\n`;
    }

    if (item.categories && item.categories.length > 0) {
      for (const cat of item.categories) {
        xml += `      <category><![CDATA[${escapeXml(cat)}]]></category>\n`;
      }
    }

    if (item.description) {
      xml += `      <description><![CDATA[${escapeXml(item.description)}]]></description>\n`;
    }

    if (item.content) {
      xml += `      <content:encoded><![CDATA[${escapeXml(item.content)}]]></content:encoded>\n`;
    }

    if (item.enclosure) {
      xml += `      <enclosure url="${escapeXml(item.enclosure.url)}" length="${item.enclosure.length || 0}" type="${escapeXml(item.enclosure.type || 'application/octet-stream')}"/>\n`;
    }

    xml += '    </item>\n';
  }

  xml += '  </channel>\n';
  xml += '</rss>';

  return xml;
}

// ============================================================
// Atom 1.0 Feed Generation
// ============================================================

/**
 * Generate a valid Atom 1.0 feed XML
 *
 * @param {Object} projectSchema - Project schema with feed items
 * @param {string} siteUrl - Base URL of the site
 * @returns {string} Complete Atom 1.0 XML
 */
function generateAtomFeed(projectSchema, siteUrl) {
  const defaults = getFeedDefaults(projectSchema);
  const siteUrlFinal = normalizeUrl(siteUrl || defaults.siteUrl);

  // Collect posts/articles
  let items = [];
  const contentSources = [
    projectSchema.posts,
    projectSchema.articles,
    projectSchema.blogPosts,
    projectSchema.content,
    projectSchema.pagination?.items
  ];

  for (const source of contentSources) {
    if (Array.isArray(source)) {
      for (const item of source) {
        const processed = processFeedItem(item, siteUrlFinal, defaults);
        if (processed) items.push(processed);
      }
    }
  }

  items = items.slice(0, 20);

  const xml = buildAtom1Xml(defaults, items, siteUrlFinal);

  return xml;
}

/**
 * Build Atom 1.0 XML string
 */
function buildAtom1Xml(defaults, items, siteUrl) {
  const now = new Date();
  const feedId = siteUrl || 'https://example.com';

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<feed xmlns="http://www.w3.org/2005/Atom">\n';

  // Feed metadata
  xml += `  <title>${escapeXml(defaults.title)}</title>\n`;
  xml += `  <id>${escapeXml(feedId)}</id>\n`;
  xml += `  <updated>${formatISO8601(now)}</updated>\n`;
  xml += `  <published>${formatISO8601(now)}</published>\n`;
  xml += `  <link href="${escapeXml(siteUrl)}" rel="alternate" type="text/html"/>\n`;
  xml += `  <link href="${escapeXml(siteUrl + '/feed.xml')}" rel="self" type="application/atom+xml"/>\n`;
  xml += `  <generator uri="https://pallettai.com" version="1.0">PallettAI Studio</generator>\n`;

  if (defaults.description) {
    xml += `  <subtitle>${escapeXml(defaults.description)}</subtitle>\n`;
  }

  // Authors
  if (defaults.author.name) {
    xml += '  <author>\n';
    xml += `    <name>${escapeXml(defaults.author.name)}</name>\n`;
    if (defaults.author.email) {
      xml += `    <email>${escapeXml(defaults.author.email)}</email>\n`;
    }
    if (defaults.author.url) {
      xml += `    <uri>${escapeXml(defaults.author.url)}</uri>\n`;
    }
    xml += '  </author>\n';
  }

  // Contributors (if specified)
  if (defaults.feed.contributors && defaults.feed.contributors.length > 0) {
    for (const contributor of defaults.feed.contributors) {
      xml += '  <contributor>\n';
      xml += `    <name>${escapeXml(contributor.name || '')}</name>\n`;
      xml += '  </contributor>\n';
    }
  }

  if (defaults.feed.copyright) {
    xml += `  <rights>${escapeXml(defaults.feed.copyright)}</rights>\n`;
  }

  // Entries
  for (const item of items) {
    xml += '  <entry>\n';
    xml += `    <title type="html">${escapeXml(item.title)}</title>\n`;
    xml += `    <id>${escapeXml(item.guid || item.link)}</id>\n`;
    xml += `    <link href="${escapeXml(item.link)}" rel="alternate" type="text/html"/>\n`;

    if (item.date) {
      xml += `    <published>${formatISO8601(item.date)}</published>\n`;
      xml += `    <updated>${formatISO8601(item.date)}</updated>\n`;
    } else {
      xml += `    <published>${formatISO8601(now)}</published>\n`;
      xml += `    <updated>${formatISO8601(now)}</updated>\n`;
    }

    if (item.author && item.author.name) {
      xml += '    <author>\n';
      xml += `      <name>${escapeXml(item.author.name)}</name>\n`;
      if (item.author.email) {
        xml += `      <email>${escapeXml(item.author.email)}</email>\n`;
      }
      xml += '    </author>\n';
    }

    if (item.categories && item.categories.length > 0) {
      for (const cat of item.categories) {
        xml += `    <category term="${escapeXml(cat)}" label="${escapeXml(cat)}"/>\n`;
      }
    }

    if (item.content) {
      xml += `    <content type="html"><![CDATA[${escapeXml(item.content)}]]></content>\n`;
    } else if (item.excerpt) {
      xml += `    <content type="html"><![CDATA[${escapeXml(item.excerpt)}]]></content>\n`;
    }

    if (item.summary) {
      xml += `    <summary>${escapeXml(item.summary)}</summary>\n`;
    }

    if (item.image) {
      xml += `    <link href="${escapeXml(item.image)}" rel="enclosure" type="image/jpeg"/>\n`;
    }

    xml += '  </entry>\n';
  }

  xml += '</feed>';

  return xml;
}

// ============================================================
// JSON Feed 1.1 Generation
// ============================================================

/**
 * Generate a valid JSON Feed 1.1 feed
 *
 * @param {Object} projectSchema - Project schema with feed items
 * @param {string} siteUrl - Base URL of the site
 * @returns {Object} JSON Feed object (can be stringified)
 */
function generateJSONFeed(projectSchema, siteUrl) {
  const defaults = getFeedDefaults(projectSchema);
  const siteUrlFinal = normalizeUrl(siteUrl || defaults.siteUrl);

  // Collect posts/articles
  let items = [];
  const contentSources = [
    projectSchema.posts,
    projectSchema.articles,
    projectSchema.blogPosts,
    projectSchema.content,
    projectSchema.pagination?.items
  ];

  for (const source of contentSources) {
    if (Array.isArray(source)) {
      for (const item of source) {
        const processed = processFeedItem(item, siteUrlFinal, defaults);
        if (processed) items.push(processed);
      }
    }
  }

  items = items.slice(0, 20);

  const feed = buildJSONFeedObject(defaults, items, siteUrlFinal);

  return feed;
}

/**
 * Build JSON Feed 1.1 object
 */
function buildJSONFeedObject(defaults, items, siteUrl) {
  const now = new Date();

  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: defaults.title,
    home_page_url: siteUrl,
    feed_url: siteUrl + '/feed.json',
    description: defaults.description,
    language: defaults.feed.language || 'en',
    authors: [{
      name: defaults.author.name || '',
      url: defaults.author.url || undefined
    }],
    published: formatISO8601(now),
    updated: formatISO8601(now),
    items: items.map(item => ({
      id: item.guid || item.link,
      url: item.link,
      title: item.title,
      summary: item.excerpt || undefined,
      content_html: item.content || undefined,
      image: item.image || undefined,
      date_published: item.date ? formatISO8601(item.date) : undefined,
      date_modified: item.date ? formatISO8601(item.date) : undefined,
      authors: item.author ? [{
        name: item.author.name || '',
        email: item.author.email || undefined,
        url: item.author.url || undefined
      }] : undefined,
      tags: (item.categories || []).filter(Boolean)
    }))
  };

  // Clean up empty values
  if (!feed.authors[0].name) {
    feed.authors = undefined;
  }
  if (feed.language === 'en') {
    feed.language = undefined;
  }

  // Remove empty optional fields
  Object.keys(feed).forEach(key => {
    if (feed[key] === undefined || feed[key] === '' || (Array.isArray(feed[key]) && feed[key].length === 0)) {
      delete feed[key];
    }
  });

  // Clean up item fields
  feed.items = feed.items.map(item => {
    Object.keys(item).forEach(key => {
      if (item[key] === undefined || item[key] === '' || (Array.isArray(item[key]) && item[key].length === 0)) {
        delete item[key];
      }
    });
    return item;
  }).filter(item => Object.keys(item).length > 0);

  return feed;
}

// ============================================================
// Auto-Discovery Link Injection
// ============================================================

/**
 * Inject feed auto-discovery links into HTML <head>
 *
 * @param {string} html - HTML content
 * @param {string} siteUrl - Base URL of the site
 * @param {string} feedUrl - Optional custom feed URL
 * @returns {string} HTML with feed links injected
 */
function injectFeedLinks(html, siteUrl, feedUrl) {
  const baseUrl = normalizeUrl(siteUrl);
  const feedPath = feedUrl || (baseUrl + '/feed.xml');
  const jsonFeedPath = feedUrl ? feedUrl.replace(/\.xml$/, '.json') : (baseUrl + '/feed.json');

  const rssLink = `<link rel="alternate" type="application/rss+xml" title="${escapeXml('RSS Feed')}" href="${escapeXml(feedPath)}">`;
  const atomLink = `<link rel="alternate" type="application/atom+xml" title="${escapeXml('Atom Feed')}" href="${escapeXml(feedPath.replace(/\.xml$/, '.atom.xml') || feedPath)}">`;
  const jsonLink = `<link rel="alternate" type="application/json" title="${escapeXml('JSON Feed')}" href="${escapeXml(jsonFeedPath)}">`;

  // Check if links already exist
  const hasRss = html.includes('application/rss+xml');
  const hasAtom = html.includes('application/atom+xml');
  const hasJson = html.includes('application/json') && html.includes('Feed');

  let result = html;

  // Find </head> and insert before it
  const headEnd = result.toLowerCase().lastIndexOf('</head>');

  if (headEnd !== -1) {
    let links = '';
    if (!hasRss) links += rssLink;
    if (!hasAtom) links += atomLink;
    if (!hasJson) links += jsonLink;

    if (links) {
      result = result.slice(0, headEnd) + '\n  ' + links + result.slice(headEnd);
    }
  } else {
    // Fallback: append to end
    result += '\n' + rssLink + '\n' + atomLink + '\n' + jsonLink;
  }

  return result;
}

/**
 * Generate minimal HTML head with feed auto-discovery links
 *
 * @param {string} title - Page title
 * @param {string} siteUrl - Base URL
 * @returns {string} HTML with feed links
 */
function generateFeedDiscoveryHtml(title, siteUrl) {
  const baseUrl = normalizeUrl(siteUrl);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeXml(title || 'Feed')}</title>
  <link rel="alternate" type="application/rss+xml" title="RSS" href="${escapeXml(baseUrl + '/feed.xml')}">
  <link rel="alternate" type="application/atom+xml" title="Atom" href="${escapeXml(baseUrl + '/feed.atom.xml')}">
  <link rel="alternate" type="application/json" title="JSON Feed" href="${escapeXml(baseUrl + '/feed.json')}">
</head>
<body>
  <h1>${escapeXml(title || 'Feed')}</h1>
  <p>Subscribe via RSS, Atom, or JSON Feed.</p>
</body>
</html>`;
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Core generation functions
  generateRSSFeed,
  generateAtomFeed,
  generateJSONFeed,

  // Auto-discovery
  injectFeedLinks,
  generateFeedDiscoveryHtml,

  // Utilities
  formatRFC822,
  formatISO8601,
  escapeXml,
  escapeHtmlForJson,
  normalizeUrl,

  // For testing
  _test: {
    generateRSSFeed,
    generateAtomFeed,
    generateJSONFeed,
    injectFeedLinks,
    formatRFC822,
    formatISO8601,
    escapeXml,
    buildRSS2Xml,
    buildAtom1Xml,
    buildJSONFeedObject
  }
};

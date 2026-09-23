// ============================================================
// PallettAI Studio — Smart Internal Link Graph & Anchor Optimizer
// Builds keyword-to-URL mapping, injects contextual internal links,
// prevents self-referential loops, and enforces semantic attributes.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Keyword Mapping & Page Analysis
// ============================================================

/**
 * Extract keywords from text content
 * Filters stop words and extracts meaningful terms
 */
function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];

  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
    'this', 'that', 'these', 'those', 'it', 'its', 'i', 'you', 'he', 'she',
    'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when',
    'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
    'some', 'any', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
    'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once', 'if',
    'because', 'while', 'though', 'about', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'under', 'again',
    'further', 'anyone', 'anything', 'anywhere', 'everyone', 'everything',
    'everywhere', 'none', 'nothing', 'nobody', 'someone', 'something',
    'somewhere', 'another', 'enough', 'whatever', 'whenever', 'wherever',
    'however', 'whosever', 'whomever'
  ]);

  // Extract words (3+ chars, no special chars)
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopWords.has(w));

  // Deduplicate and count
  const wordCount = {};
  words.forEach(w => {
    wordCount[w] = (wordCount[w] || 0) + 1;
  });

  // Return keywords sorted by frequency
  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);
}

/**
 * Build keyword-to-URL mapping from project schema
 * Scans titles, headers, and tags across all pages
 */
function buildPageKeywordMap(projectSchema) {
  const keywordMap = new Map();

  if (!projectSchema || typeof projectSchema !== 'object') {
    return keywordMap;
  }

  const pages = projectSchema.pages || [];
  const posts = projectSchema.posts || [];

  // Process pages
  pages.forEach(page => {
    if (!page || typeof page !== 'object') return;

    const slug = page.slug || page.id || page.url || '';
    if (!slug) return;

    const keywords = new Set();

    // Title
    if (page.title) {
      const titleKeywords = extractKeywords(page.title);
      titleKeywords.forEach(kw => keywords.add(kw));
    }

    // Headers from content
    if (page.content) {
      const headers = page.content.match(/<h[1-6][^>]*>([^<]*)<\/h[1-6]>/gi);
      if (headers) {
        headers.forEach(h => {
          const match = h.match(/>([^<]*)</);
          if (match) {
            const headerKeywords = extractKeywords(match[1]);
            headerKeywords.forEach(kw => keywords.add(kw));
          }
        });
      }
    }

    // Tags
    if (page.tags && Array.isArray(page.tags)) {
      page.tags.forEach(tag => {
        const tagKeywords = extractKeywords(tag);
        tagKeywords.forEach(kw => keywords.add(kw));
      });
    }

    // URL path segments
    const pathSegments = slug.split('/').filter(s => s.length >= 3);
    pathSegments.forEach(seg => {
      const segKeywords = extractKeywords(seg);
      segKeywords.forEach(kw => keywords.add(kw));
    });

    // Add to map
    keywords.forEach(kw => {
      if (!keywordMap.has(kw)) {
        keywordMap.set(kw, []);
      }
      keywordMap.get(kw).push({
        slug,
        title: page.title || '',
        url: page.url || `/${slug}/`
      });
    });
  });

  // Process posts
  posts.forEach(post => {
    if (!post || typeof post !== 'object') return;

    const slug = post.slug || post.id || post.url || '';
    if (!slug) return;

    const keywords = new Set();

    // Title
    if (post.title) {
      const titleKeywords = extractKeywords(post.title);
      titleKeywords.forEach(kw => keywords.add(kw));
    }

    // Content
    if (post.content) {
      const contentKeywords = extractKeywords(post.content);
      contentKeywords.slice(0, 20).forEach(kw => keywords.add(kw));
    }

    // Tags
    if (post.tags && Array.isArray(post.tags)) {
      post.tags.forEach(tag => {
        const tagKeywords = extractKeywords(tag);
        tagKeywords.forEach(kw => keywords.add(kw));
      });
    }

    // Category
    if (post.category) {
      const catKeywords = extractKeywords(post.category);
      catKeywords.forEach(kw => keywords.add(kw));
    }

    // Add to map
    keywords.forEach(kw => {
      if (!keywordMap.has(kw)) {
        keywordMap.set(kw, []);
      }
      keywordMap.get(kw).push({
        slug,
        title: post.title || '',
        url: post.url || `/${slug}/`
      });
    });
  });

  return keywordMap;
}

/**
 * Find best matching URL for a keyword
 */
function findBestMatch(keyword, keywordMap, currentSlug) {
  const matches = keywordMap.get(keyword);
  if (!matches || matches.length === 0) return null;

  // Filter out self-references
  const filtered = matches.filter(m => m.slug !== currentSlug);

  if (filtered.length === 0) return null;

  // Return first match (could be enhanced with ranking)
  return filtered[0];
}

/**
 * Check if a keyword is already linked in the content
 */
function isKeywordAlreadyLinked(htmlContent, keyword) {
  if (!htmlContent || !keyword) return false;

  const pattern = new RegExp(
    `<a[^>]*href=[\\"']([^\"']*)['\"][^>]*>[^<]*${escapeRegExp(keyword)}[^<]*<\\/a>`,
    'i'
  );

  return pattern.test(htmlContent);
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string) {
  if (!string) return '';
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// Smart Internal Link Injection
// ============================================================

/**
 * Inject smart internal links into HTML content
 *
 * @param {string} htmlContent - HTML content to process
 * @param {string} currentSlug - Current page slug (to avoid self-linking)
 * @param {Map} keywordMap - Keyword-to-URL mapping
 * @param {number|Object} options - Max links (number) or an options object
 * @returns {Object} Modified HTML and link stats
 */
function injectSmartInternalLinks(htmlContent, currentSlug, keywordMap, options = {}) {
  // Accept either a bare link budget, as specified by the public contract
  // signature, or a full options object for finer control.
  if (typeof options === 'number') {
    options = { maxLinksPerPage: options };
  }
  if (!options || typeof options !== 'object') {
    options = {};
  }

  const {
    maxLinksPerPage = 3,
    minKeywordLength = 4,
    excludeSelectors = [],
    linkClass = 'internal-link',
    relAttribute = 'bookmark',
    targetBlank = false
  } = options;

  if (!htmlContent || typeof htmlContent !== 'string') {
    return { html: htmlContent, stats: { linked: 0, attempted: 0 } };
  }

  if (!keywordMap || !(keywordMap instanceof Map)) {
    return { html: htmlContent, stats: { linked: 0, attempted: 0 } };
  }

  let remainingLinks = maxLinksPerPage;
  let linkedCount = 0;
  let attemptedCount = 0;

  // Track which keywords we've already linked
  const linkedKeywords = new Set();

  // Process content paragraph by paragraph to avoid code blocks
  const processedHtml = processContentForLinks(
    htmlContent,
    currentSlug,
    keywordMap,
    { remainingLinks, linkedCount, attemptedCount, linkedKeywords, minKeywordLength, linkClass, relAttribute, targetBlank }
  );

  return {
    html: processedHtml.html,
    stats: {
      linked: processedHtml.stats.linked,
      attempted: processedHtml.stats.attempted,
      externalLinks: processedHtml.stats.linked
    }
  };
}

/**
 * Process content for internal link injection
 */
function processContentForLinks(html, currentSlug, keywordMap, state) {
  const {
    remainingLinks,
    linkedKeywords,
    minKeywordLength,
    linkClass,
    relAttribute,
    targetBlank
  } = state;

  let result = html;
  let currentRemaining = remainingLinks;
  let currentLinked = state.linkedCount;
  let currentAttempted = state.attemptedCount;

  // Skip content inside code blocks, pre tags, etc.
  const protectedBlocks = [];

  // Find and protect code blocks
  // Tag-name boundary [(?=[\s>/])] prevents <pre> or <codebase> style collisions.
  const codeBlockRegex = /(<pre(?=[\s>\/])[^>]*>[\s\S]*?<\/pre>|<code(?=[\s>\/])[^>]*>[\s\S]*?<\/code>)/gi;
  let match;

  while ((match = codeBlockRegex.exec(html)) !== null) {
    protectedBlocks.push({
      index: match.index,
      length: match[0].length,
      content: match[0]
    });
    result = result.replace(match[0], `__CODE_BLOCK_${protectedBlocks.length - 1}__`);
  }

  // Find and protect existing anchor tags
  // The (?=[\s>\/]) lookahead is essential: without it, <a[^>]*> also matches
  // <article>, <aside>, <abbr>, etc., which would swallow surrounding markup.
  const anchorRegex = /<a(?=[\s>\/])[^>]*>[\s\S]*?<\/a>/gi;
  const anchors = [];

  while ((match = anchorRegex.exec(result)) !== null) {
    anchors.push({
      index: match.index,
      length: match[0].length,
      content: match[0]
    });
    result = result.replace(match[0], `__ANCHOR_${anchors.length - 1}__`);
  }

  // Find and protect headings (don't link inside headings)
  const headingRegex = /<h[1-6](?=[\s>\/])[^>]*>[\s\S]*?<\/h[1-6]>/gi;
  const headings = [];

  while ((match = headingRegex.exec(result)) !== null) {
    headings.push({
      index: match.index,
      length: match[0].length,
      content: match[0]
    });
    result = result.replace(match[0], `__HEADING_${headings.length - 1}__`);
  }

  // Now process paragraphs for keywords
  // Boundary lookahead stops <pre> from being treated as a <p> element.
  const paragraphRegex = /<p(?=[\s>\/])[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch;

  while ((pMatch = paragraphRegex.exec(result)) !== null) {
    if (currentRemaining <= 0) break;

    const paragraphContent = pMatch[1];

    // Get keywords from this paragraph
    const keywords = extractKeywords(paragraphContent);

    // Try to link each keyword
    for (const keyword of keywords) {
      if (currentRemaining <= 0) break;
      if (keyword.length < minKeywordLength) continue;
      if (linkedKeywords.has(keyword)) continue;
      if (isKeywordAlreadyLinked(paragraphContent, keyword)) continue;

      const match = findBestMatch(keyword, keywordMap, currentSlug);
      if (!match) continue;

      // Create the link
      const linkHref = match.url;
      const linkClassAttr = linkClass ? ` class="${linkClass}"` : '';
      const relAttr = relAttribute ? ` rel="${relAttribute}"` : '';
      const targetAttr = targetBlank ? ' target="_blank"' : '';
      const titleAttr = match.title ? ` title="${match.title}"` : '';

      const linkHtml = `<a href="${linkHref}"${linkClassAttr}${relAttr}${targetAttr}${titleAttr}>${keyword}</a>`;

      // Replace first occurrence of keyword in paragraph (not inside other tags)
      const keywordRegex = new RegExp(`\\b${escapeRegExp(keyword)}\\b(?!</a>)`, 'i');
      const newParagraph = paragraphContent.replace(keywordRegex, linkHtml);

      if (newParagraph !== paragraphContent) {
        // Update result
        result = result.replace(paragraphContent, newParagraph);

        // Update state
        currentRemaining--;
        currentLinked++;
        currentAttempted++;
        linkedKeywords.add(keyword);

        // Re-extract paragraph content for next iteration
        break; // Only link one keyword per paragraph for quality
      }
    }
  }

  // Restore protected blocks
  protectedBlocks.forEach((block, i) => {
    result = result.replace(`__CODE_BLOCK_${i}__`, block.content);
  });

  // Restore anchors
  anchors.forEach((anchor, i) => {
    result = result.replace(`__ANCHOR_${i}__`, anchor.content);
  });

  // Restore headings
  headings.forEach((heading, i) => {
    result = result.replace(`__HEADING_${i}__`, heading.content);
  });

  return {
    html: result,
    stats: {
      linked: currentLinked,
      attempted: currentAttempted,
      remaining: currentRemaining
    }
  };
}

/**
 * Get unlinked keywords in content
 */
function getUnlinkedKeywords(htmlContent, keywordMap, currentSlug) {
  if (!htmlContent || !keywordMap) return [];

  const contentKeywords = extractKeywords(htmlContent);
  const unlinked = [];

  contentKeywords.forEach(kw => {
    if (kw.length < 4) return;
    if (isKeywordAlreadyLinked(htmlContent, kw)) return;

    const match = findBestMatch(kw, keywordMap, currentSlug);
    if (match) {
      unlinked.push({
        keyword: kw,
        targetUrl: match.url,
        targetTitle: match.title
      });
    }
  });

  return unlinked;
}

/**
 * Calculate internal link density score
 */
function calculateLinkDensity(htmlContent, keywordMap, currentSlug) {
  if (!htmlContent) return { density: 0, totalLinks: 0, keywordMatches: 0 };

  const totalLinks = (htmlContent.match(/<a[^>]*>/gi) || []).length;
  const contentKeywords = extractKeywords(htmlContent);
  const keywordMatches = contentKeywords.filter(kw =>
    keywordMap.has(kw) && findBestMatch(kw, keywordMap, currentSlug)
  ).length;

  const density = keywordMatches > 0 ? totalLinks / keywordMatches : 0;

  return {
    density,
    totalLinks,
    keywordMatches,
    recommendation: density < 0.3 ? 'Consider adding more internal links' :
                   density > 0.7 ? 'Too many internal links, reduce for readability' :
                   'Internal link density is optimal'
  };
}

/**
 * Remove duplicate internal links
 */
function removeDuplicateInternalLinks(htmlContent) {
  if (!htmlContent) return htmlContent;

  const links = [];

  const linkRegex = /<a(?=[\s>\/])([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(htmlContent)) !== null) {
    links.push({
      fullTag: match[0],
      attributes: match[1],
      content: match[2],
      index: match.index
    });
  }

  // Find duplicates by href
  const seenHrefs = new Set();
  const toRemove = [];

  links.forEach(link => {
    const hrefMatch = link.attributes.match(/href=["']([^"']*)["']/i);
    if (hrefMatch) {
      const href = hrefMatch[1];
      if (seenHrefs.has(href)) {
        toRemove.push(link);
      } else {
        seenHrefs.add(href);
      }
    }
  });

  // Remove duplicates
  toRemove.forEach(link => {
    htmlContent = htmlContent.replace(link.fullTag, link.content);
  });

  return htmlContent;
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Keyword mapping
  buildPageKeywordMap,
  extractKeywords,
  findBestMatch,

  // Internal linking
  injectSmartInternalLinks,
  getUnlinkedKeywords,
  calculateLinkDensity,
  removeDuplicateInternalLinks,

  // Utilities
  isKeywordAlreadyLinked,
  escapeRegExp,

  // For testing
  _test: {
    buildPageKeywordMap,
    extractKeywords,
    findBestMatch,
    injectSmartInternalLinks,
    getUnlinkedKeywords,
    calculateLinkDensity,
    removeDuplicateInternalLinks,
    isKeywordAlreadyLinked,
    escapeRegExp
  }
};

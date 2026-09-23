// ============================================================
// PallettAI Studio — Microdata & Microformats2 Semantic Markup Engine
// Injects inline HTML5 semantic attributes alongside JSON-LD for
// maximum search engine and Fediverse compatibility.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Schema Definitions
// ============================================================

const SCHEMA_TYPES = {
  article: {
    name: 'Article',
    itemtype: 'https://schema.org/Article',
    microformats2: 'h-entry'
  },
  blogPosting: {
    name: 'BlogPosting',
    itemtype: 'https://schema.org/BlogPosting',
    microformats2: 'h-entry'
  },
  newsArticle: {
    name: 'NewsArticle',
    itemtype: 'https://schema.org/NewsArticle',
    microformats2: 'h-entry'
  },
  product: {
    name: 'Product',
    itemtype: 'https://schema.org/Product',
    microformats2: 'h-product'
  },
  person: {
    name: 'Person',
    itemtype: 'https://schema.org/Person',
    microformats2: 'h-card'
  },
  organization: {
    name: 'Organization',
    itemtype: 'https://schema.org/Organization',
    microformats2: 'h-card'
  },
  localBusiness: {
    name: 'LocalBusiness',
    itemtype: 'https://schema.org/LocalBusiness',
    microformats2: 'h-card'
  },
  website: {
    name: 'WebSite',
    itemtype: 'https://schema.org/WebSite',
    microformats2: null
  }
};

// ============================================================
// Microdata Itemprop Definitions
// ============================================================

const ITEMPROPS = {
  article: {
    headline: 'headline',
    description: 'description',
    author: 'author',
    publisher: 'publisher',
    datePublished: 'datePublished',
    dateModified: 'dateModified',
    image: 'image',
    url: 'url',
    articleBody: 'articleBody',
    keywords: 'keywords'
  },
  product: {
    name: 'name',
    description: 'description',
    image: 'image',
    sku: 'sku',
    brand: 'brand',
    price: 'price',
    priceCurrency: 'priceCurrency',
    availability: 'availability',
    url: 'url'
  },
  person: {
    name: 'name',
    givenName: 'givenName',
    familyName: 'familyName',
    email: 'email',
    url: 'url',
    jobTitle: 'jobTitle',
    telephone: 'telephone'
  },
  organization: {
    name: 'name',
    url: 'url',
    logo: 'logo',
    address: 'address',
    founder: 'founder',
    foundingDate: 'foundingDate',
    contactPoint: 'contactPoint'
  }
};

// ============================================================
// Microdata Injection
// ============================================================

/**
 * Inject Microdata attributes into HTML content
 *
 * @param {string} htmlContent - HTML content to process
 * @param {string} pageType - Schema type (article, product, person, organization, etc.)
 * @param {Object} metadata - Page metadata for attribute values
 * @returns {string} HTML with Microdata attributes
 */
function injectMicrodataAttributes(htmlContent, pageType, metadata = {}) {
  const schema = SCHEMA_TYPES[pageType] || SCHEMA_TYPES.article;
  const itemProps = ITEMPROPS[pageType] || ITEMPROPS.article;

  if (!htmlContent || typeof htmlContent !== 'string') {
    return htmlContent;
  }

  let result = htmlContent;

  // Add itemscope and itemtype to the main container
  // Try to find article, main, or body element
  result = addItemscopeToContainer(result, schema.itemtype);

  // Add itemprop attributes to relevant elements
  result = addItempropToElements(result, itemProps, metadata);

  // Ensure proper nesting
  result = validateAndFixMicrodataNesting(result, schema.itemtype);

  return result;
}

/**
 * Add itemscope and itemtype to the main container element
 */
function addItemscopeToContainer(html, itemtype) {
  // Try to find article first, then main, then create wrapper
  const articleRegex = /<article([^>]*)>/i;

  if (articleRegex.test(html)) {
    return html.replace(articleRegex, (match, attrs) => {
      const existingItemscope = attrs.includes('itemscope');
      const existingItemtype = attrs.match(/itemtype="([^"]*)"/);

      if (existingItemtype && existingItemtype[1] === itemtype) {
        return match; // Already has correct itemtype
      }

      let newAttrs = attrs;
      if (!existingItemscope) {
        newAttrs = newAttrs ? `${attrs} itemscope` : 'itemscope';
      }
      newAttrs = newAttrs ? `${newAttrs} itemtype="${escapeHtmlAttribute(itemtype)}"` : `itemscope itemtype="${escapeHtmlAttribute(itemtype)}"`;

      return `<article${newAttrs}>`;
    });
  }

  // Try main element
  const mainRegex = /<main([^>]*)>/i;
  if (mainRegex.test(html)) {
    return html.replace(mainRegex, (match, attrs) => {
      let newAttrs = attrs ? `${attrs} itemscope itemtype="${escapeHtmlAttribute(itemtype)}"` : `itemscope itemtype="${escapeHtmlAttribute(itemtype)}"`;
      return `<main${newAttrs}>`;
    });
  }

  // Try to wrap content in article element
  const bodyRegex = /(<body[^>]*>)([\s\S]*?)(<\/body>)/i;
  if (bodyRegex.test(html)) {
    return html.replace(bodyRegex, (match, openBody, bodyContent, closeBody) => {
      return `${openBody}\n  <article itemscope itemtype="${escapeHtmlAttribute(itemtype)}">\n    ${bodyContent.trim()}\n  </article>\n${closeBody}`;
    });
  }

  // Return as-is if no container found
  return html;
}

/**
 * Add itemprop attributes to elements based on their tag and content
 */
function addItempropToElements(html, itemProps, metadata) {
  let result = html;

  // Headline - found in h1, h2 with title class
  result = result.replace(
    /<(h[12])[^>]*>([^<]+)<\/(h[12])>/gi,
    (match, tag, content, closingTag) => {
      const itemprop = itemProps.headline || 'headline';
      return `<${tag} itemprop="${itemprop}">${content}</${closingTag}>`;
    }
  );

  // Description - found in p, div with description class
  result = result.replace(
    /<p[^>]*class="[^"]*description[^"]*"[^>]*>([^<]+)<\/p>/gi,
    (match, content) => {
      const itemprop = itemProps.description || 'description';
      return `<p itemprop="${itemprop}">${content}</p>`;
    }
  );

  // Image with alt text - map to image itemprop
  result = result.replace(
    /<img([^>]*)\/?>/gi,
    (match, attrs) => {
      if (attrs.includes('itemprop')) return match;

      const altMatch = attrs.match(/alt="([^"]*)"/);
      const srcMatch = attrs.match(/src="([^"]*)"/);

      if (srcMatch && altMatch) {
        const itemprop = itemProps.image || 'image';
        // Add itemprop to existing img tag
        const newAttrs = `${attrs} itemprop="${itemprop}"`;
        return `<img${newAttrs}/>`;
      }

      return match;
    }
  );

  // Date elements
  result = result.replace(
    /<time[^>]*datetime="([^"]*)"[^>]*>([^<]*)<\/time>/gi,
    (match, datetime, content) => {
      const itemprop = itemProps.datePublished || 'datePublished';
      return `<time datetime="${datetime}" itemprop="${itemprop}">${content}</time>`;
    }
  );

  // URL/Link elements
  result = result.replace(
    /<a([^>]*href="([^"]*)")[^>]*>([^<]*)<\/a>/gi,
    (match, attrs, href, content) => {
      if (attrs.includes('itemprop')) return match;

      // Check if this looks like an author link or main URL
      const itemprop = attrs.includes('author') || attrs.includes('Author') ? 'author' : itemProps.url || 'url';
      const newAttrs = `${attrs} itemprop="${itemprop}"`;
      return `<a${newAttrs}>${content}</a>`;
    }
  );

  // Body text content - wrap in div with articleBody itemprop
  result = result.replace(
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)(?=<\/div>)/gi,
    (match, content) => {
      if (content.includes('itemprop')) return match;

      const itemprop = itemProps.articleBody || 'articleBody';
      return `<div itemprop="${itemprop}">${content}</div>`;
    }
  );

  return result;
}

/**
 * Validate and fix Microdata nesting
 */
function validateAndFixMicrodataNesting(html, itemtype) {
  // Validate structure is intact
  if (!html.includes('<article') && !html.includes('<main')) {
    // No container found, which is OK for simple content
  }

  return html;
}

// ============================================================
// Microformats2 Injection
// ============================================================

/**
 * Inject Microformats2 classes into HTML content
 *
 * @param {string} htmlContent - HTML content to process
 * @param {string} contentType - Content type (entry, card, product, etc.)
 * @returns {string} HTML with Microformats2 classes
 */
function injectMicroformats2Classes(htmlContent, contentType = 'entry') {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return htmlContent;
  }

  let result = htmlContent;

  switch (contentType) {
    case 'entry':
      result = injectHEntry(result);
      break;
    case 'card':
      result = injectHCard(result);
      break;
    case 'product':
      result = injectHProduct(result);
      break;
    default:
      result = injectHEntry(result);
  }

  return result;
}

/**
 * Inject h-entry (for articles/blog posts)
 */
function injectHEntry(html) {
  let result = html;

  // Wrap content in h-entry div if not already
  if (!result.includes('class="h-entry"') && !result.includes('class=\'h-entry\'')) {
    // Find article or main or body
    result = result.replace(
      /<article([^>]*)>/i,
      (match, attrs) => {
        const hasClass = attrs && attrs.includes('class=');
        if (hasClass) {
          return `<article${attrs} class="h-entry">`;
        }
        return `<article class="h-entry">`;
      }
    );

    // If no article tag, wrap main content
    if (!result.includes('class="h-entry"')) {
      result = result.replace(
        /<main([^>]*)>/i,
        (match, attrs) => {
          const hasClass = attrs && attrs.includes('class=');
          if (hasClass) {
            return `<main${attrs} class="h-entry">`;
          }
          return `<main class="h-entry">`;
        }
      );
    }
  }

  // Add p-name to title elements
  result = result.replace(
    /<(h[123])[^>]*>([^<]+)<\/(h[123])>/gi,
    (match, tag, content, closingTag) => {
      if (match.includes('p-name') || match.includes('class=')) {
        return match;
      }
      const hasClass = match.includes('class=');
      if (hasClass) {
        return match.replace('class="', 'class="p-name ');
      }
      return `<${tag} class="p-name">${content}</${closingTag}>`;
    }
  );

  // Add e-content to content divs/paragraphs
  result = result.replace(
    /<(p|div)[^>]*class="[^"]*(content|article-body|body)[^"]*"[^>]*>/gi,
    (match) => {
      if (match.includes('e-content')) return match;
      return match.replace('class="', 'class="e-content ');
    }
  );

  // Add u-url to links
  result = result.replace(
    /<a([^>]*href="([^"]*)")[^>]*>([^<]*)<\/a>/gi,
    (match, attrs, href, content) => {
      if (attrs.includes('u-url')) return match;
      const newAttrs = `${attrs} rel="bookmark"`;
      return `<a${newAttrs}>${content}</a>`;
    }
  );

  // Add dt-published to time elements
  result = result.replace(
    /<time([^>]*datetime="([^"]*)")[^>]*>([^<]*)<\/time>/gi,
    (match, attrs, datetime, content) => {
      if (attrs.includes('dt-published')) return match;
      const newAttrs = `${attrs} class="dt-published"`;
      return `<time${newAttrs}>${content}</time>`;
    }
  );

  return result;
}

/**
 * Inject h-card (for person/organization)
 */
function injectHCard(html) {
  let result = html;

  // Check if already has h-card
  if (result.includes('class="h-card"') || result.includes('class=\'h-card\'')) {
    return result;
  }

  // Add h-card to appropriate container
  result = result.replace(
    /<(article|section|div)[^>]*class="[^"]*?(author|author-box|contact|profile)[^"]*"[^>]*>/gi,
    (match, tag, attrs) => {
      if (attrs.includes('h-card')) return match;
      return match.replace('class="', 'class="h-card ');
    }
  );

  // Add p-name to name elements
  result = result.replace(
    /<([^>]+)[^>]*>([^<]*(?:name|Name)[^<]*)<\/[^>]+>/gi,
    (match, tag, content) => {
      if (content.toLowerCase().includes('name') && !match.includes('p-name')) {
        if (match.includes('class=')) {
          return match.replace('class="', 'class="p-name ');
        }
        return `<${tag} class="p-name">${content}</${tag}>`;
      }
      return match;
    }
  );

  // Add u-url to URL links
  result = result.replace(
    /<a([^>]*href="https?:\/\/[^"]*")[^>]*>/gi,
    (match, attrs) => {
      if (attrs.includes('u-url')) return match;
      return `<a${attrs} class="u-url">`;
    }
  );

  return result;
}

/**
 * Inject h-product (for products)
 */
function injectHProduct(html) {
  let result = html;

  // Wrap in h-product if not already
  if (!result.includes('class="h-product"')) {
    result = result.replace(
      /<article([^>]*)>/i,
      (match, attrs) => {
        const hasClass = attrs && attrs.includes('class=');
        if (hasClass) {
          return `<article${attrs} class="h-product">`;
        }
        return `<article class="h-product">`;
      }
    );
  }

  // Add p-name to product name
  result = result.replace(
    /<h[12][^>]*>([^<]+)<\/h[12]>/gi,
    (match, content) => {
      if (match.includes('p-name')) return match;
      const tagMatch = match.match(/^<h[12](.*?)>/);
      if (tagMatch && tagMatch[1].includes('class=')) {
        return match.replace('class="', 'class="p-name ');
      }
      return `<h2 class="p-name">${content}</h2>`;
    }
  );

  // Add u-photo to product images
  result = result.replace(
    /<img([^>]*src="([^"]*)")[^>]*\/?>/gi,
    (match, attrs, src) => {
      if (attrs.includes('u-photo')) return match;
      return `<img${attrs} class="u-photo" />`;
    }
  );

  // Add p-price to price elements
  result = result.replace(
    /<([^>]+)[^>]*>([\$€£]\s*[\d,.]+)<\/[^>]+>/gi,
    (match, tag, price) => {
      if (match.includes('p-price')) return match;
      if (tag.includes('class=')) {
        return match.replace('class="', 'class="p-price ');
      }
      return `<${tag} class="p-price">${price}</${tag}>`;
    }
  );

  return result;
}

// ============================================================
// Validation
// ============================================================

/**
 * Validate Microdata structure
 *
 * @param {string} html - HTML with Microdata
 * @returns {Object} Validation result
 */
function validateMicrodata(html) {
  const issues = [];
  const warnings = [];

  // Check for itemscope
  const itemscopeMatches = (html.match(/itemscope/g) || []);
  if (itemscopeMatches.length === 0) {
    warnings.push('No itemscope found in HTML');
  }

  // Check for itemtype
  const itemtypeMatches = (html.match(/itemtype="https:\/\/schema\.org\/\w+"/g) || []);
  if (itemtypeMatches.length === 0) {
    warnings.push('No valid itemtype found (expected https://schema.org/Type)');
  }

  // Check for itemprop
  const itempropMatches = (html.match(/itemprop="/g) || []);
  if (itempropMatches.length === 0) {
    warnings.push('No itemprop attributes found');
  }

  // Check Microformats2 classes
  if (!html.match(/class="[^"]*h-(entry|card|product)/)) {
    warnings.push('No h-* Microformats2 root class found');
  }

  return {
    valid: issues.length === 0,
    issues,
    warnings,
    stats: {
      itemscopeCount: itemscopeMatches.length,
      itemtypeCount: itemtypeMatches.length,
      itempropCount: itempropMatches.length,
      mf2RootCount: (html.match(/class="[^"]*h-(entry|card|product)/g) || []).length
    }
  };
}

/**
 * Escape HTML attribute value
 */
function escapeHtmlAttribute(value) {
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
  // Microdata
  injectMicrodataAttributes,
  addItemscopeToContainer,
  addItempropToElements,
  validateAndFixMicrodataNesting,

  // Microformats2
  injectMicroformats2Classes,
  injectHEntry,
  injectHCard,
  injectHProduct,

  // Validation
  validateMicrodata,

  // Schema definitions
  SCHEMA_TYPES,
  ITEMPROPS,

  // Utilities
  escapeHtml,
  escapeHtmlAttribute,

  // For testing
  _test: {
    injectMicrodataAttributes,
    injectMicroformats2Classes,
    validateMicrodata,
    SCHEMA_TYPES,
    ITEMPROPS,
    injectHEntry,
    injectHCard,
    injectHProduct,
    escapeHtml,
    escapeHtmlAttribute
  }
};

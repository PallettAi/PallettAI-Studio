// ============================================================
// PallettAI Studio — Automated Table of Contents & Anchor Linker
// Parses heading tags, generates ToC trees, injects anchor IDs,
// scroll-margin styles, and scroll-spy JavaScript.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Heading Parsing & ID Injection
// ============================================================

/**
 * Slugify text for use as HTML ID
 */
function slugify(text) {
  if (!text) return '';

  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word characters
    .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Ensure unique ID by appending suffix if duplicate exists
 */
function ensureUniqueId(id, existingIds) {
  if (!existingIds.has(id)) {
    existingIds.add(id);
    return id;
  }

  let counter = 1;
  let newId = `${id}-${counter}`;
  while (existingIds.has(newId)) {
    counter++;
    newId = `${id}-${counter}`;
  }

  existingIds.add(newId);
  return newId;
}

/**
 * Parse headings from HTML and inject IDs
 *
 * @param {string} htmlContent - HTML content to process
 * @param {number} maxDepth - Maximum heading depth to include (default: 3)
 * @param {boolean} injectIds - Whether to inject IDs into HTML (default: true)
 * @returns {Object} Parsed headings and modified HTML
 */
function generateTableOfContents(htmlContent, maxDepth = 3, injectIds = true) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return { headings: [], html: htmlContent, tree: null };
  }

  const headings = [];
  const existingIds = new Set();
  let modifiedHtml = htmlContent;

  // Match h1-h6 tags with their content
  const headingRegex = /<(h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  let idCounter = 0;

  while ((match = headingRegex.exec(modifiedHtml)) !== null) {
    const tag = match[1];
    const attributes = match[2];
    const content = match[3];
    const depth = parseInt(tag.charAt(1));

    // Skip if beyond max depth
    if (depth > maxDepth) continue;

    // Extract text content (strip HTML)
    const textContent = stripHtml(content).trim();

    // Skip empty headings
    if (!textContent) continue;

    // Determine if heading already has an ID
    const existingIdMatch = attributes.match(/id=["']([^"']*)["']/i);
    let headingId;

    if (existingIdMatch) {
      headingId = existingIdMatch[1];
    } else {
      // Generate ID from text content
      const baseId = slugify(textContent);
      headingId = ensureUniqueId(baseId || `heading-${idCounter++}`, existingIds);
    }

    existingIds.add(headingId);

    headings.push({
      id: headingId,
      tag,
      level: depth,
      text: textContent,
      content: content,
      attributes: attributes
    });
  }

  // Inject IDs into HTML if requested
  if (injectIds) {
    modifiedHtml = injectHeadingIds(modifiedHtml, headings, existingIds);
  }

  // Build tree structure
  const tree = buildTocTree(headings);

  return {
    headings,
    html: modifiedHtml,
    tree,
    count: headings.length
  };
}

/**
 * Inject IDs into heading tags in HTML
 */
function injectHeadingIds(html, headings, existingIds) {
  if (!headings || headings.length === 0) return html;

  let result = html;

  for (const heading of headings) {
    // Find the heading tag in HTML
    const tag = heading.tag;
    const textContent = heading.text;

    // Create regex to find this specific heading
    // Escape special regex characters in text
    const escapedText = textContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Match the heading tag with its content
    const headingRegex = new RegExp(
      `<${tag}([^>]*)>(${escapedText})<\/\\${tag}>`,
      'i'
    );

    // Check if ID already exists
    const hasIdMatch = heading.attributes.match(/id=["']([^"']*)["']/i);
    const headingId = hasIdMatch ? hasIdMatch[1] : heading.id;

    if (!hasIdMatch) {
      // Inject ID attribute
      result = result.replace(
        headingRegex,
        (match, attrs, content) => {
          // Check if this heading already has an ID in the attributes
          if (attrs.includes('id=')) {
            return match;
          }
          return `<${tag} id="${headingId}"${attrs}>${content}</${tag}>`;
        }
      );
    }
  }

  return result;
}

/**
 * Build nested ToC tree from flat heading list
 */
function buildTocTree(headings) {
  if (!headings || headings.length === 0) {
    return { id: 'toc-root', label: 'Table of Contents', children: [], level: 0 };
  }

  const root = {
    id: 'toc-root',
    label: 'Table of Contents',
    children: [],
    level: 0,
    url: null
  };

  const stack = [root];

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const node = {
      id: heading.id,
      label: heading.text,
      level: heading.level,
      children: [],
      url: `#${heading.id}`
    };

    // Find parent by walking up the stack
    let parent = stack[stack.length - 1];
    while (parent && parent.level >= heading.level) {
      stack.pop();
      parent = stack[stack.length - 1];
    }
    
    // If no parent found (stack empty), use root
    if (!parent) {
      parent = root;
    }
    
    // Add node to parent's children
    parent.children.push(node);
    
    // Push this node onto stack for its children
    stack.push(node);
  }

  return root;
}

/**
 * Generate HTML ToC from tree structure
 */
function generateTocHtml(tree, options = {}) {
  const {
    listType = 'ul',
    showNumbers = false,
    containerClass = 'toc-container',
    listClass = 'toc-list'
  } = options;

  if (!tree) return '';

  let html = `<div class="${containerClass}">\n`;
  html += generateListHtml(tree, listType, 0, showNumbers, listClass);
  html += '\n</div>';

  return html;
}

/**
 * Generate list HTML recursively
 */
function generateListHtml(node, listType, depth, showNumbers, listClass) {
  if (!node || !node.children || node.children.length === 0) {
    if (node.level > 0) {
      return `<li><a href="#${escapeHtml(String(node.id))}">${escapeHtml(node.label)}</a></li>\n`;
    }
    return '';
  }

  const isOrdered = listType === 'ol';
  const indentStyle = ` style="padding-left: ${depth * 20}px"`;
  // Always add indent for proper tree structure
  const listClassAttr = depth > 0 ? ` class="${listClass}"` : '';

  let html = '';
  if (isOrdered) {
    html += `<ol${listClassAttr}${indentStyle}>\n`;
  } else {
    html += `<ul${listClassAttr}${indentStyle}>\n`;
  }

  let itemNumber = 0;
  for (const child of node.children) {
    if (child.level === 0) continue;

    itemNumber++;
    const itemNumberHtml = showNumbers ? `<span class="toc-number">${itemNumber}.</span> ` : '';
    // The id goes into an href attribute, so it is escaped too — a tree built
    // by hand (rather than by slugify) can otherwise close the attribute.
    const linkHtml = `<a href="#${escapeHtml(String(child.id))}">${itemNumberHtml}${escapeHtml(child.label)}</a>`;

    if (child.children && child.children.length > 0) {
      html += `<li>${linkHtml}\n`;
      html += generateListHtml(child, listType, depth + 1, showNumbers, listClass);
      html += '</li>\n';
    } else {
      html += `<li>${linkHtml}</li>\n`;
    }
  }

  html += `${isOrdered ? '</ol>' : '</ul>'}\n`;

  return html;
}

/**
 * Strip HTML tags
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escape HTML entities
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
// Scroll Margin Styles
// ============================================================

/**
 * Generate CSS for scroll-margin-top to handle sticky headers
 */
function injectScrollMarginStyles(options = {}) {
  const {
    headerHeight = 80,
    selector = 'h1, h2, h3, h4, h5, h6',
    additionalSelectors = '',
    className = 'scroll-target'
  } = options;

  const css = `
/* Scroll-margin for anchor links - handles sticky headers */
${selector},
${selector} a,
${selector} ${className},
${additionalSelectors} {
  scroll-margin-top: ${headerHeight}px;
  scroll-behavior: smooth;
}

/* Smooth scrolling for entire page */
html {
  scroll-behavior: smooth;
}

/* Optional: highlight active heading */
.toc-active {
  position: relative;
}

.toc-active::after {
  content: '';
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 100%;
  height: 3px;
  background-color: currentColor;
  opacity: 0.3;
}
`.trim();

  return css;
}

/**
 * Inject scroll margin styles into HTML
 */
function injectScrollMarginStylesIntoHtml(html, options = {}) {
  const css = injectScrollMarginStyles(options);

  // Find head and inject before closing
  const headEndIndex = html.toLowerCase().lastIndexOf('</head>');

  if (headEndIndex !== -1) {
    const styleTag = `<style>\n${css}\n</style>`;
    return html.slice(0, headEndIndex) + '\n  ' + styleTag + html.slice(headEndIndex);
  }

  // Fallback: append before body
  const bodyStartIndex = html.toLowerCase().indexOf('<body');
  if (bodyStartIndex !== -1) {
    const styleTag = `<style>\n${css}\n</style>`;
    return html.slice(0, bodyStartIndex) + styleTag + html.slice(bodyStartIndex);
  }

  // Last resort: append to end
  return html + '\n<style>\n' + css + '\n</style>';
}

// ============================================================
// Scroll Spy JavaScript
// ============================================================

/**
 * Generate client-side scroll spy script
 */
function generateScrollSpyScript(options = {}) {
  const {
    headingSelector = 'h1, h2, h3, h4, h5, h6',
    offset = 100,
    activeClass = 'toc-active',
    highlightContainerSelector = '.toc-container',
    highlightLinkSelector = '.toc-container a'
  } = options;

  const script = `
/**
 * PallettAI Studio — Scroll Spy
 * Highlights active heading as user scrolls through content
 */
(function() {
  'use strict';

  var CONFIG = {
    headingSelector: '${headingSelector}',
    offset: ${offset},
    activeClass: '${activeClass}',
    highlightContainerSelector: '${highlightContainerSelector}',
    highlightLinkSelector: '${highlightLinkSelector}'
  };

  var headings = [];
  var currentActive = null;
  var isScrolling = false;
  var scrollTimeout = null;

  // Get all headings
  function getHeadings() {
    return Array.prototype.slice.call(document.querySelectorAll(CONFIG.headingSelector));
  }

  // Check which heading is currently active
  function updateActiveHeading() {
    var scrollPosition = window.scrollY + CONFIG.offset + 100; // Add buffer

    var activeHeading = null;
    for (var i = 0; i < headings.length; i++) {
      var heading = headings[i];
      var headingTop = heading.offsetTop;
      var headingHeight = heading.offsetHeight;

      if (scrollPosition >= headingTop && scrollPosition < headingTop + headingHeight) {
        activeHeading = heading;
        break;
      }
    }

    // If no heading found, use last heading if scrolled near bottom
    if (!activeHeading && headings.length > 0) {
      var lastHeading = headings[headings.length - 1];
      if (scrollPosition >= lastHeading.offsetTop + lastHeading.offsetHeight / 2) {
        activeHeading = lastHeading;
      }
    }

    // Apply active class
    if (currentActive !== activeHeading) {
      if (currentActive) {
        currentActive.classList.remove(CONFIG.activeClass);
      }

      currentActive = activeHeading;

      if (currentActive) {
        currentActive.classList.add(CONFIG.activeClass);

        // Update ToC link highlighting
        var links = document.querySelectorAll(CONFIG.highlightLinkSelector);
        for (var j = 0; j < links.length; j++) {
          var link = links[j];
          var href = link.getAttribute('href') || '';
          if (href === '#' + currentActive.id) {
            link.classList.add('active');
          } else {
            link.classList.remove('active');
          }
        }
      }
    }
  }

  // Debounced scroll handler
  function handleScroll() {
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }

    scrollTimeout = setTimeout(function() {
      updateActiveHeading();
    }, 100);
  }

  // Initialize
  function init() {
    headings = getHeadings();

    if (headings.length === 0) {
      return;
    }

    // Initial update
    updateActiveHeading();

    // Event listeners
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
  }

  // Start when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`.trim();

  return script;
}

/**
 * Inject scroll spy script into HTML
 */
function injectScrollSpyIntoHtml(html, options = {}) {
  const script = generateScrollSpyScript(options);

  // Find head and inject before closing
  const headEndIndex = html.toLowerCase().lastIndexOf('</head>');

  if (headEndIndex !== -1) {
    return html.slice(0, headEndIndex) + '\n  <script>\n' + script + '\n  </script>' + html.slice(headEndIndex);
  }

  // Fallback: append before body
  const bodyStartIndex = html.toLowerCase().indexOf('<body');
  if (bodyStartIndex !== -1) {
    return html.slice(0, bodyStartIndex) + '<script>\n' + script + '\n</script>' + html.slice(bodyStartIndex);
  }

  // Last resort: append to end
  return html + '\n<script>\n' + script + '\n</script>';
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // ToC generation
  generateTableOfContents,
  buildTocTree,
  generateTocHtml,
  slugify,
  ensureUniqueId,

  // Scroll margin
  injectScrollMarginStyles,
  injectScrollMarginStylesIntoHtml,

  // Scroll spy
  generateScrollSpyScript,
  injectScrollSpyIntoHtml,

  // Utilities
  stripHtml,
  escapeHtml,

  // For testing
  _test: {
    generateTableOfContents,
    buildTocTree,
    generateTocHtml,
    slugify,
    ensureUniqueId,
    injectScrollMarginStyles,
    injectScrollMarginStylesIntoHtml,
    generateScrollSpyScript,
    injectScrollSpyIntoHtml,
    stripHtml,
    escapeHtml,
    injectHeadingIds
  }
};

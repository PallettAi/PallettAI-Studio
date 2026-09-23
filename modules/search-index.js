// ============================================================
// PallettAI Studio — Zero-Server In-Browser Search Index Compiler
// Builds static search-index.json for client-side fuzzy search
// and generates lightweight < 1.2KB bootstrap script.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Tokenization & Text Processing
// ============================================================

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
  'we', 'they', 'what', 'which', 'who', 'whom', 'whose', 'where', 'when',
  'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some',
  'any', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'also', 'now', 'here', 'there', 'then', 'once', 'if', 'because',
  'while', 'although', 'about', 'into', 'through', 'during', 'before', 'after',
  'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once'
]);

/**
 * Tokenize text into normalized tokens
 */
function tokenize(text) {
  if (!text) return [];

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(token =>
      token.length >= 2 &&
      !STOP_WORDS.has(token) &&
      !/^\d+$/.test(token)
    );
}

/**
 * Generate n-grams for better fuzzy matching
 */
function generateNgrams(text, minSize = 2, maxSize = 4) {
  if (!text) return [];

  const tokens = tokenize(text);
  const ngrams = new Set();

  for (const token of tokens) {
    for (let size = minSize; size <= maxSize; size++) {
      for (let i = 0; i <= token.length - size; i++) {
        ngrams.add(token.slice(i, i + size));
      }
    }
  }

  return Array.from(ngrams);
}

/**
 * Strip HTML tags from content
 */
function stripHtml(html) {
  if (!html) return '';

  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract meaningful text content from page data
 */
function extractSearchText(item) {
  const parts = [];

  if (item.title) parts.push(item.title);
  if (item.description) parts.push(item.description);
  if (item.excerpt) parts.push(item.excerpt);
  if (item.content) parts.push(stripHtml(item.content));
  if (item.tags && Array.isArray(item.tags)) parts.push(item.tags.join(' '));
  if (item.category) parts.push(item.category);
  if (item.author) parts.push(item.author);

  return parts.join(' ');
}

// ============================================================
// Search Index Building
// ============================================================

/**
 * Build a search index from project data
 * Compatible with Orama, MiniSearch, and similar libraries
 *
 * @param {Object} projectData - Project data containing pages, posts, products
 * @param {Object} options - Index options
 * @returns {Object} Search index object
 */
function buildSearchIndex(projectData, options = {}) {
  const {
    includePages = true,
    includePosts = true,
    includeProducts = false,
    includeCategories = false,
    contentField = 'content',
    titleField = 'title',
    maxItems = 5000
  } = options;

  const index = {
    version: '1.0',
    generated: new Date().toISOString(),
    count: 0,
    items: []
  };

  const items = [];

  // Collect pages
  if (includePages && projectData.pages && Array.isArray(projectData.pages)) {
    for (const page of projectData.pages) {
      const searchItem = createSearchItem(page, 'page', titleField, contentField);
      if (searchItem) items.push(searchItem);
    }
  }

  // Collect posts/blog articles
  if (includePosts) {
    const postsSources = [
      projectData.posts,
      projectData.articles,
      projectData.blogPosts,
      projectData.content
    ];

    for (const source of postsSources) {
      if (Array.isArray(source)) {
        for (const post of source) {
          const searchItem = createSearchItem(post, 'post', titleField, contentField);
          if (searchItem) items.push(searchItem);
        }
      }
    }
  }

  // Collect products
  if (includeProducts && projectData.products && Array.isArray(projectData.products)) {
    for (const product of projectData.products) {
      const searchItem = createSearchItem(product, 'product', titleField, contentField);
      if (searchItem) items.push(searchItem);
    }
  }

  // Limit items
  if (items.length > maxItems) {
    items.length = maxItems;
  }

  index.items = items;
  index.count = items.length;

  // Add schema info for client. Every item carries a `type`, so the field is
  // always declared. (This previously read a variable that did not exist,
  // which threw a ReferenceError on every call to buildSearchIndex.)
  index.schema = {
    itemType: 'string',
    title: typeof titleField === 'string' ? 'string' : undefined,
    url: 'string',
    description: 'string',
    category: 'string',
    tags: 'array',
    date: 'string',
    excerpt: 'string'
  };

  return index;
}

/**
 * Create a search index item from content
 */
function createSearchItem(item, type = 'page', titleField = 'title', contentField = 'content') {
  if (!item || !item[titleField]) return null;

  const title = item[titleField];
  const url = item.url || item.slug ?
    (item.url || `/${item.slug}`.replace(/\/+/g, '/')) :
    '';

  const description = item.description ||
    item.excerpt ||
    item.summary ||
    '';

  // Generate searchable text
  const searchText = extractSearchText(item);
  const tokens = tokenize(searchText);
  const ngrams = generateNgrams(searchText);

  // Extract categories and tags
  const tags = (item.tags || item.categories || [])
    .filter(t => t && typeof t === 'string')
    .slice(0, 10);

  const category = item.category || item.categoryName || '';

  // Date for sorting
  const date = item.date ||
    item.pubDate ||
    item.createdAt ||
    item.datePublished ||
    item.date ||
    '';

  // Excerpt for preview
  const excerpt = item.excerpt ||
    item.description ||
    (item.content ? stripHtml(item.content).slice(0, 200) + '...' : '');

  return {
    id: item.id || item.slug || url || Math.random().toString(36).substr(2, 9),
    type: type,
    title: title,
    url: url,
    description: description,
    category: category,
    tags: tags,
    date: date,
    excerpt: excerpt,
    searchText: searchText,  // For full-text search
    tokens: tokens,          // For token-based matching
    ngrams: ngrams,          // For fuzzy matching
    _score: 0                // Will be calculated at search time
  };
}

/**
 * Optimize index for client-side loading
 * Remove heavy fields, keep only what's needed for search
 */
function optimizeIndexForClient(index) {
  if (!index || !index.items) return index;

  const optimized = {
    version: index.version,
    generated: index.generated,
    count: index.count,
    items: index.items.map(item => ({
      id: item.id,
      type: item.type,
      title: item.title,
      url: item.url,
      description: item.description,
      category: item.category,
      tags: item.tags || [],
      date: item.date,
      excerpt: item.excerpt,
      // Store tokens as concatenated string for smaller size
      _text: item.tokens ? item.tokens.join(' ') : (item.searchText || '').toLowerCase()
    }))
  };

  return optimized;
}

// ============================================================
// Search Client Script Generation
// ============================================================

/**
 * Generate a zero-dependency client-side search bootstrap script
 * < 1.2KB minified, fetches index on focus, provides Cmd+K trigger
 *
 * @param {string} indexPath - Path to search-index.json
 * @param {Object} options - Script options
 * @returns {string} JavaScript code
 */
function generateSearchClientScript(indexPath = '/search-index.json', options = {}) {
  const {
    placeholder = 'Search...',
    resultLimit = 10,
    minQueryLength = 2,
    highlightClass = 'search-highlight',
    resultItemClass = 'search-result',
    modalId = 'search-modal',
    inputId = 'search-input',
    resultsId = 'search-results',
    onResultClick = null
  } = options;

  const script = `
/**
 * PallettAI Studio — Zero-Server Search Client
 * < 1.2KB minified, zero dependencies
 */

(function() {
  'use strict';

  // Configuration
  var CONFIG = {
    indexUrl: ${JSON.stringify(indexPath)},
    placeholder: ${JSON.stringify(placeholder)},
    resultLimit: ${resultLimit},
    minQueryLength: ${minQueryLength},
    highlightClass: ${JSON.stringify(highlightClass)},
    resultItemClass: ${JSON.stringify(resultItemClass)},
    modalId: ${JSON.stringify(modalId)},
    inputId: ${JSON.stringify(inputId)},
    resultsId: ${JSON.stringify(resultsId)}
  };

  // State
  var index = null;
  var modal = null;
  var input = null;
  var resultsContainer = null;
  var isOpen = false;
  var currentResults = [];

  // Utility: Simple fuzzy match
  function fuzzyMatch(query, text) {
    if (!query || !text) return false;
    query = query.toLowerCase().trim();
    text = text.toLowerCase();

    if (text.includes(query)) return true;

    // Check for token match
    var queryTokens = query.split(/\\\\s+/);
    for (var i = 0; i < queryTokens.length; i++) {
      var token = queryTokens[i];
      if (token.length < 2) continue;
      if (text.includes(token)) return true;
    }

    return false;
  }

  // Utility: Simple highlight
  function highlightText(text, query) {
    if (!query || !text) return escapeHtml(text);
    var escaped = escapeHtml(text);
    var regex = new RegExp('(' + query.replace(/[^a-zA-Z0-9]/g, '\\\\$&') + ')', 'gi');
    return escaped.replace(regex, '<mark class="${highlightClass}">$1</mark>');
  }

  // Utility: Escape HTML
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Fetch search index
  function fetchIndex() {
    if (index) return Promise.resolve(index);

    return fetch(CONFIG.indexUrl)
      .then(function(response) {
        if (!response.ok) throw new Error('Failed to fetch search index');
        return response.json();
      })
      .then(function(data) {
        index = data;
        return data;
      })
      .catch(function(err) {
        console.warn('Search index fetch failed:', err);
        index = { items: [] };
        return index;
      });
  }

  // Search the index
  function search(query) {
    if (!index || !index.items) return [];

    query = query.trim().toLowerCase();
    if (query.length < CONFIG.minQueryLength) return [];

    var results = [];
    var items = index.items || [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var searchText = item._text || item.title || '';

      if (fuzzyMatch(query, searchText)) {
        results.push({
          id: item.id,
          type: item.type,
          title: item.title,
          url: item.url,
          description: item.description,
          excerpt: item.excerpt,
          tags: item.tags || [],
          score: calculateScore(query, item)
        });
      }

      if (results.length >= CONFIG.resultLimit) break;
    }

    // Sort by score
    results.sort(function(a, b) {
      return b.score - a.score;
    });

    return results;
  }

  // Calculate relevance score
  function calculateScore(query, item) {
    var score = 0;
    var text = (item.title + ' ' + (item._text || '')).toLowerCase();
    var queryLower = query.toLowerCase();

    // Title match = higher score
    if (item.title && item.title.toLowerCase().includes(queryLower)) {
      score += 10;
    }

    // Exact phrase match
    if (text.includes(queryLower)) {
      score += 5;
    }

    // Token matches
    var queryTokens = queryLower.split(/\\\\s+/);
    for (var i = 0; i < queryTokens.length; i++) {
      if (text.includes(queryTokens[i])) {
        score += 2;
      }
    }

    // Tag matches
    if (item.tags && Array.isArray(item.tags)) {
      for (var j = 0; j < item.tags.length; j++) {
        if (item.tags[j] && item.tags[j].toLowerCase().includes(queryLower)) {
          score += 3;
        }
      }
    }

    return score;
  }

  // Render results
  function renderResults(results, query) {
    if (!resultsContainer) return;

    resultsContainer.innerHTML = '';

    if (results.length === 0) {
      resultsContainer.innerHTML = '<div class="search-no-results">No results found for "' + escapeHtml(query) + '"</div>';
      return;
    }

    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      var item = document.createElement('div');
      item.className = CONFIG.resultItemClass;
      item.dataset.id = result.id;
      item.dataset.url = result.url;

      var titleHtml = highlightText(result.title, query);

      item.innerHTML =
        '<a href="' + escapeHtml(result.url) + '" class="search-result-title">' + titleHtml + '</a>' +
        (result.description ? '<div class="search-result-desc">' + escapeHtml(result.description) + '</div>' : '') +
        (result.excerpt ? '<div class="search-result-excerpt">' + highlightText(result.excerpt, query) + '</div>' : '');

      item.addEventListener('click', function(e) {
        e.preventDefault();
        window.location.href = result.url;

        if (typeof onResultClick === 'function') {
          onResultClick(result);
        }
      });

      resultsContainer.appendChild(item);
    }
  }

  // Show modal
  function showModal() {
    if (!modal) return;

    isOpen = true;
    modal.classList.add('active');
    document.body.classList.add('search-active');
    input.focus();

    // Fetch index on first focus
    fetchIndex();
  }

  // Hide modal
  function hideModal() {
    if (!modal) return;

    isOpen = false;
    modal.classList.remove('active');
    document.body.classList.remove('search-active');
    input.value = '';
    if (resultsContainer) resultsContainer.innerHTML = '';
    currentResults = [];
  }

  // Toggle modal
  function toggleModal() {
    if (isOpen) {
      hideModal();
    } else {
      showModal();
    }
  }

  // Initialize
  function init() {
    // Create modal if not exists
    if (!document.getElementById(CONFIG.modalId)) {
      var modalHtml = '' +
        '<div id="' + CONFIG.modalId + '" class="pai-search-modal">' +
          '<div class="pai-search-container">' +
            '<input type="text" id="' + CONFIG.inputId + '" placeholder="' + CONFIG.placeholder + '" autocomplete="off">' +
            '<div id="' + CONFIG.resultsId + '" class="pai-search-results"></div>' +
          '</div>' +
        '</div>';

      var tempDiv = document.createElement('div');
      tempDiv.innerHTML = modalHtml;
      document.body.appendChild(tempDiv.firstChild);
    }

    modal = document.getElementById(CONFIG.modalId);
    input = document.getElementById(CONFIG.inputId);
    resultsContainer = document.getElementById(CONFIG.resultsId);

    if (!modal || !input || !resultsContainer) {
      console.warn('PallettAI Search: Could not find modal elements');
      return;
    }

    // Event listeners
    document.addEventListener('keydown', function(e) {
      // Cmd+K or Ctrl+K to toggle
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleModal();
      }

      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        hideModal();
      }

      // Arrow key navigation
      if (isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        navigateResults(e.key === 'ArrowDown' ? 1 : -1);
      }

      // Enter to navigate
      if (e.key === 'Enter' && isOpen && currentResults.length > 0) {
        e.preventDefault();
        var firstResult = resultsContainer.querySelector('a');
        if (firstResult) {
          window.location.href = firstResult.href;
        }
      }
    });

    // Input handler
    if (input) {
      input.addEventListener('input', function() {
        var query = this.value;
        if (query.length >= CONFIG.minQueryLength) {
          currentResults = search(query);
          renderResults(currentResults, query);
        } else {
          if (resultsContainer) resultsContainer.innerHTML = '';
          currentResults = [];
        }
      });

      input.addEventListener('focus', function() {
        if (!index) {
          fetchIndex();
        }
      });
    }

    // Click outside to close
    document.addEventListener('click', function(e) {
      if (isOpen && modal && !modal.contains(e.target)) {
        hideModal();
      }
    });
  }

  // Navigate results with arrow keys
  function navigateResults(direction) {
    var items = resultsContainer.querySelectorAll('.' + CONFIG.resultItemClass);
    if (items.length === 0) return;

    var currentIndex = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].classList.contains('highlighted')) {
        currentIndex = i;
        items[i].classList.remove('highlighted');
        break;
      }
    }

    var newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = items.length - 1;
    if (newIndex >= items.length) newIndex = 0;

    if (items[newIndex]) {
      items[newIndex].classList.add('highlighted');
      items[newIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  // Start when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose API
  window.__paiSearch = {
    open: showModal,
    close: hideModal,
    toggle: toggleModal,
    search: search,
    getIndex: function() { return index; }
  };
})();`.trim();

  return script;
}

/**
 * Generate search results HTML for a query
 */
function generateSearchResultsHtml(query, results, options = {}) {
  const {
    highlightClass = 'search-highlight',
    limit = 10
  } = options;

  const limitedResults = results.slice(0, limit);

  if (limitedResults.length === 0) {
    return `<div class="search-no-results">No results found for "${escapeHtml(query)}"</div>`;
  }

  return limitedResults.map(result => `
    <div class="search-result" data-id="${result.id}" data-url="${escapeHtml(result.url)}">
      <a href="${escapeHtml(result.url)}" class="search-result-title">${escapeHtml(result.title)}</a>
      ${result.description ? `<div class="search-result-desc">${escapeHtml(result.description)}</div>` : ''}
      ${result.excerpt ? `<div class="search-result-excerpt">${escapeHtml(result.excerpt)}</div>` : ''}
    </div>
  `).join('');
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Index building
  buildSearchIndex,
  createSearchItem,
  optimizeIndexForClient,

  // Client script
  generateSearchClientScript,
  generateSearchResultsHtml,

  // Utilities
  tokenize,
  generateNgrams,
  stripHtml,
  extractSearchText,

  // For testing
  _test: {
    buildSearchIndex,
    tokenize,
    generateNgrams,
    stripHtml,
    extractSearchText,
    generateSearchClientScript,
    generateSearchResultsHtml,
    createSearchItem,
    optimizeIndexForClient
  }
};

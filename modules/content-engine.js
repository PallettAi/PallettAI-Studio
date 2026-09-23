// ============================================================
// PallettAI Studio — On-Device Content Intelligence & Metrics
// Provides reading time calculation, excerpt generation, and
// related posts indexing using local keyword frequency analysis.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Reading Time Calculator
// ============================================================

const DEFAULT_WORDS_PER_MINUTE = 200;

/**
 * Strip HTML tags and extract plain text
 */
function stripHtml(html) {
  if (!html) return '';

  // Remove script and style elements
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Replace br tags with newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Replace block-level elements with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|nav|aside)>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'");

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Count words in text
 */
function countWords(text) {
  if (!text) return 0;

  // Split by whitespace and filter empty strings
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  return words.length;
}

/**
 * Calculate reading time for content
 *
 * @param {string} htmlContent - HTML content to analyze
 * @param {Object} options - Calculation options
 * @param {number} options.wpm - Words per minute (default: 200)
 * @returns {Object} Reading time info
 */
function calculateReadingTime(htmlContent, options = {}) {
  const wpm = options.wpm || DEFAULT_WORDS_PER_MINUTE;
  const text = stripHtml(htmlContent);
  const wordCount = countWords(text);
  const minutes = Math.ceil(wordCount / wpm);

  return {
    minutes: minutes,
    time: minutes === 1 ? '1 min read' : `${minutes} min read`,
    wordCount: wordCount,
    charCount: text.length,
    text: text
  };
}

/**
 * Format reading time as a string
 *
 * @param {number} minutes - Reading time in minutes
 * @returns {string} Formatted string
 */
function formatReadingTime(minutes) {
  if (minutes < 1) return '< 1 min read';
  if (minutes === 1) return '1 min read';
  return `${minutes} min read`;
}

/**
 * Get quick reading time estimate from a string
 *
 * @param {string} text - Plain text content
 * @param {number} wpm - Words per minute
 * @returns {string} Formatted reading time
 */
function getReadingTime(text, wpm = DEFAULT_WORDS_PER_MINUTE) {
  const words = countWords(text);
  const minutes = Math.ceil(words / wpm);
  return formatReadingTime(minutes);
}

// ============================================================
// Excerpt Generator
// ============================================================

/**
 * Generate a smart excerpt from HTML content
 *
 * @param {string} htmlContent - HTML content to excerpt
 * @param {Object} options - Excerpt options
 * @param {number} options.maxLength - Maximum character length (default: 160)
 * @param {boolean} options.keepHtml - Keep HTML formatting (default: false)
 * @param {string} options.ellipsis - Ellipsis to append (default: '…')
 * @param {boolean} options.sentenceWise - Try to end at sentence boundary (default: true)
 * @returns {string} Generated excerpt
 */
function generateExcerpt(htmlContent, options = {}) {
  const {
    maxLength = 160,
    keepHtml = false,
    ellipsis = '…',
    sentenceWise = true
  } = options;

  if (!htmlContent) return '';

  // Strip HTML if not keeping it
  let text = keepHtml ? htmlContent : stripHtml(htmlContent);

  if (!text || text.length === 0) return '';

  // If text is already short enough, return it
  if (text.length <= maxLength) {
    return text.trim();
  }

  if (sentenceWise) {
    // Try to find a good sentence boundary
    const truncated = text.slice(0, maxLength);

    // Look for sentence endings (., !, ?) followed by space or end
    const sentenceEndings = [
      { pattern: /\.(\s|$)/, position: truncated.lastIndexOf('. ') },
      { pattern: /\.$/, position: truncated.lastIndexOf('.') },
      { pattern: /!(\s|$)/, position: truncated.lastIndexOf('! ') },
      { pattern: /!$/, position: truncated.lastIndexOf('!') },
      { pattern: /\?(\s|$)/, position: truncated.lastIndexOf('? ') },
      { pattern: /\?$/, position: truncated.lastIndexOf('?') }
    ];

    // Find the best sentence ending near the end
    let bestEnd = 0;
    for (const { position } of sentenceEndings) {
      if (position > maxLength * 0.7 && position > bestEnd) {
        bestEnd = position + 1; // Include the period
      }
    }

    if (bestEnd > 0 && bestEnd < text.length) {
      text = text.slice(0, bestEnd).trim();
    } else {
      // No good sentence boundary, just truncate
      text = truncated;
    }
  } else {
    // Simple truncation
    text = text.slice(0, maxLength);
  }

  // Add ellipsis if truncated
  if (text.length < stripHtml(htmlContent).length) {
    text = text + ellipsis;
  }

  return text.trim();
}

/**
 * Generate multiple excerpt variations
 *
 * @param {string} htmlContent - HTML content
 * @param {Object} options - Excerpt options
 * @returns {Object} Multiple excerpt variants
 */
function generateExcerptVariants(htmlContent, options = {}) {
  const {
    maxLength = 160,
    sentenceWise = true
  } = options;

  const text = stripHtml(htmlContent);

  if (!text) return { short: '', medium: '', long: '' };

  return {
    short: generateExcerpt(htmlContent, { maxLength: 100, sentenceWise, ellipsis: '…' }),
    medium: generateExcerpt(htmlContent, { maxLength: maxLength, sentenceWise, ellipsis: '…' }),
    long: generateExcerpt(htmlContent, { maxLength: 300, sentenceWise, ellipsis: '…' })
  };
}

/**
 * Extract first paragraph or sentence as excerpt
 *
 * @param {string} htmlContent - HTML content
 * @returns {string} First meaningful excerpt
 */
function extractFirstParagraph(htmlContent) {
  if (!htmlContent) return '';

  // Try to get first <p> content
  const pMatch = htmlContent.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  if (pMatch) {
    return stripHtml(pMatch[1]).trim();
  }

  // Fallback: first line of text
  const text = stripHtml(htmlContent);
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  return lines[0] || text.slice(0, 160);
}

// ============================================================
// Related Posts Index Builder (TF-IDF based)
// ============================================================

/**
 * Tokenize text into words (lowercase, remove stop words)
 */
function tokenize(text) {
  if (!text) return [];

  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
    'need', 'dare', 'ought', 'used', 'this', 'that', 'these', 'those',
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who',
    'whom', 'whose', 'where', 'when', 'why', 'how', 'all', 'each', 'every',
    'both', 'few', 'more', 'most', 'some', 'any', 'no', 'not', 'only',
    'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now',
    'here', 'there', 'then', 'once', 'if', 'because', 'while', 'although'
  ]);

  // Extract words (alphanumeric, 2+ chars)
  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !stopWords.has(w));

  return words;
}

/**
 * Calculate term frequency for a document
 */
function calculateTermFrequency(words) {
  const tf = {};
  const total = words.length;

  if (total === 0) return tf;

  for (const word of words) {
    tf[word] = (tf[word] || 0) + 1;
  }

  // Normalize by document length
  for (const word in tf) {
    tf[word] = tf[word] / total;
  }

  return tf;
}

/**
 * Calculate inverse document frequency across corpus
 */
function calculateIDF(documents) {
  const idf = {};
  const N = documents.length;

  if (N === 0) return idf;

  // Count documents containing each term
  for (const words of documents) {
    const uniqueWords = new Set(words);
    for (const word of uniqueWords) {
      idf[word] = (idf[word] || 0) + 1;
    }
  }

  // Calculate IDF
  for (const word in idf) {
    idf[word] = Math.log(N / (1 + idf[word]));
  }

  return idf;
}

/**
 * Calculate TF-IDF score for a document given corpus IDF
 */
function calculateTFIDF(tf, idf) {
  const scores = {};

  for (const word in tf) {
    if (idf[word] !== undefined) {
      scores[word] = tf[word] * idf[word];
    }
  }

  // Sort by score descending
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .reduce((acc, [word, score]) => {
      acc[word] = score;
      return acc;
    }, {});
}

/**
 * Calculate similarity score between two documents using TF-IDF
 */
function calculateSimilarity(tf1, tf2, idf) {
  let score = 0;

  // Common words weighted by IDF
  for (const word in tf1) {
    if (tf2[word] !== undefined && idf[word] !== undefined) {
      score += tf1[word] * tf2[word] * idf[word];
    }
  }

  return score;
}

/**
 * Build related posts index for an array of posts
 *
 * @param {Array} postsArray - Array of post objects with title/content
 * @param {Object} options - Index options
 * @param {number} options.topN - Number of related posts to return (default: 3)
 * @param {string} options.contentField - Field to analyze (default: 'content')
 * @param {string} options.titleField - Field for title (default: 'title')
 * @returns {Object} Related posts mapping { postId: [relatedPostIds] }
 */
function buildRelatedPostsIndex(postsArray, options = {}) {
  const {
    topN = 3,
    contentField = 'content',
    titleField = 'title'
  } = options;

  if (!Array.isArray(postsArray) || postsArray.length < 2) {
    return {};
  }

  // Extract document content for each post
  const documents = postsArray.map(post => {
    const title = post[titleField] || '';
    const content = post[contentField] || '';
    return tokenize(title + ' ' + content);
  });

  // Calculate document frequencies and IDF
  const idf = calculateIDF(documents);

  // Calculate term frequencies for each document
  const tfs = documents.map(doc => calculateTermFrequency(doc));

  // Build related posts index
  const relatedIndex = {};

  for (let i = 0; i < postsArray.length; i++) {
    const post = postsArray[i];
    const postId = post.id || post.slug || post.url || i;

    // Calculate similarity with all other posts
    const similarities = [];

    for (let j = 0; j < postsArray.length; j++) {
      if (i === j) continue;

      const otherPost = postsArray[j];
      const otherId = otherPost.id || otherPost.slug || otherPost.url || j;

      const similarity = calculateSimilarity(tfs[i], tfs[j], idf);
      similarities.push({ id: otherId, score: similarity, index: j });
    }

    // Sort by similarity score descending
    similarities.sort((a, b) => b.score - a.score);

    // Take top N
    relatedIndex[postId] = similarities
      .slice(0, topN)
      .map(s => s.id)
      .filter(id => id != null);
  }

  return relatedIndex;
}

/**
 * Calculate keyword frequency for content analysis
 *
 * @param {string} text - Text content
 * @param {number} options.minLength - Minimum word length (default: 3)
 * @param {number} options.maxWords - Maximum keywords to return (default: 20)
 * @returns {Array} Array of { word, count, frequency }
 */
function extractKeywords(text, options = {}) {
  const {
    minLength = 3,
    maxWords = 20
  } = options;

  const words = tokenize(text);

  // Count word frequency
  const frequency = {};
  for (const word of words) {
    frequency[word] = (frequency[word] || 0) + 1;
  }

  // Sort by frequency
  const sorted = Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxWords)
    .map(([word, count]) => ({
      word,
      count,
      frequency: count / words.length
    }));

  return sorted;
}

/**
 * Get content summary stats
 *
 * @param {string} htmlContent - HTML content
 * @returns {Object} Summary statistics
 */
function getContentStats(htmlContent) {
  const text = stripHtml(htmlContent);
  const words = text.split(/\s+/).filter(w => w.length > 0);

  // Calculate basic stats
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    charCount: text.length,
    readingTime: calculateReadingTime(htmlContent),
    averageWordLength: words.length > 0
      ? (words.reduce((sum, w) => sum + w.length, 0) / words.length).toFixed(2)
      : '0',
    averageSentenceLength: sentences.length > 0
      ? (words.length / sentences.length).toFixed(1)
      : '0'
  };
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Reading time
  calculateReadingTime,
  formatReadingTime,
  getReadingTime,
  countWords,
  stripHtml,

  // Excerpts
  generateExcerpt,
  generateExcerptVariants,
  extractFirstParagraph,

  // Related posts
  buildRelatedPostsIndex,
  extractKeywords,
  calculateTermFrequency,
  calculateIDF,
  calculateTFIDF,
  calculateSimilarity,
  tokenize,

  // Stats
  getContentStats,

  // For testing
  _test: {
    calculateReadingTime,
    formatReadingTime,
    getReadingTime,
    stripHtml,
    countWords,
    generateExcerpt,
    generateExcerptVariants,
    extractFirstParagraph,
    buildRelatedPostsIndex,
    extractKeywords,
    tokenize,
    calculateTermFrequency,
    calculateIDF,
    calculateTFIDF,
    calculateSimilarity,
    getContentStats
  }
};

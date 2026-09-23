// ============================================================
// PallettAI Studio — Local AI Alt-Text & Caption Generator
// Provides offline image accessibility and SEO metadata generation
// using filename analysis, context extraction, and heuristic scoring.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Image Analysis & Alt Text Generation
// ============================================================

/**
 * Extract keywords from image filename
 */
function extractFilenameKeywords(imagePath) {
  if (!imagePath) return [];

  const fileName = path.basename(imagePath, path.extname(imagePath));
  const lowerName = fileName.toLowerCase();

  // Split on common separators
  const words = lowerName
    .split(/[-_.\s]+/)
    .filter(w => w.length > 1 && !isStopWord(w));

  return words;
}

/**
 * Filter out stop words
 */
function isStopWord(word) {
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
    'further', 'img', 'image', 'photo', 'pic', 'picture', 'graphic', 'logo'
  ]);
  return stopWords.has(word);
}

/**
 * Extract keywords from surrounding context text
 */
function extractContextKeywords(contextText) {
  if (!contextText) return [];

  // Remove HTML tags
  const cleanText = contextText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Extract significant words (longer words, more meaningful)
  const words = cleanText
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= 4 && !isStopWord(w));

  return [...new Set(words)]; // Deduplicate
}

/**
 * Generate descriptive alt text for an image
 *
 * @param {string} imagePath - Path to the image file
 * @param {string} surroundingContextText - Text from surrounding content/section
 * @param {Object} options - Generation options
 * @returns {string} Generated alt text
 */
function generateAltText(imagePath, surroundingContextText = '', options = {}) {
  const {
    maxLength = 125,
    includeFilename = true,
    includeContext = true,
    prefix = 'Image'
  } = options;

  if (!imagePath) {
    return `${prefix} content`;
  }

  const filenameKeywords = extractFilenameKeywords(imagePath);
  const contextKeywords = includeContext ? extractContextKeywords(surroundingContextText) : [];
  
  // Also extract words from surrounding text directly (not just keywords)
  let surroundingTextWords = [];
  if (includeContext && surroundingContextText) {
    const cleanText = surroundingContextText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    surroundingTextWords = cleanText.split(/\s+/).filter(w => w.length >= 4 && !isStopWord(w));
  }

  // Combine keywords, prioritizing context over filename
  const allKeywords = [
    ...contextKeywords,
    ...filenameKeywords
  ].filter((kw, i, arr) => arr.indexOf(kw) === i); // Deduplicate

  // Build alt text based on available information
  let altText = '';

  // Build alt text based on available information
  // Combine filename keywords with surrounding text words for better context
  const allWords = [...new Set([...filenameKeywords, ...surroundingTextWords])];
  
  if (allWords.length >= 2) {
    // Use combined words for meaningful description
    const meaningful = allWords.filter(w => w.length >= 3);
    if (meaningful.length >= 2) {
      altText = `Image of ${meaningful.slice(0, 2).join(' ')}`;
    } else {
      altText = `Image of ${allWords.slice(0, 2).join(' ')}`;
    }
  } else if (filenameKeywords.length >= 2) {
    // Use filename keywords
    altText = `Image of ${filenameKeywords.slice(0, 3).join(' ')}`;
  } else if (filenameKeywords.length === 1) {
    // Single keyword
    altText = `Image showing ${filenameKeywords[0]}`;
  } else {
    // Fallback
    altText = `Image content related to ${path.basename(imagePath, path.extname(imagePath))}`;
  }

  // Ensure it doesn't exceed max length
  if (altText.length > maxLength) {
    altText = altText.slice(0, maxLength - 3) + '...';
  }

  // Clean up the text
  altText = altText
    .replace(/\s+/g, ' ')
    .trim();

  return altText;
}

/**
 * Batch annotate all images in project schema
 *
 * @param {Object} projectSchema - Project schema with pages and content
 * @param {Object} options - Annotation options
 * @returns {Object} Annotation report
 */
function batchAnnotateImages(projectSchema, options = {}) {
  const {
    includeContext = true,
    annotateEmptyOnly = false,
    generateCaptions = true
  } = options;

  const report = {
    totalImages: 0,
    annotatedImages: [],
    missingAltImages: [],
    updatedCount: 0,
    stats: {
      total: 0,
      withAlt: 0,
      withoutAlt: 0,
      generatedAlt: 0,
      generatedCaption: 0
    }
  };

  if (!projectSchema || typeof projectSchema !== 'object') {
    return report;
  }

  // Collect all images from pages
  const pages = projectSchema.pages || [];
  const posts = projectSchema.posts || [];

  const allImages = [];

  // Scan pages
  for (const page of pages) {
    if (!page || typeof page !== 'object') continue;

    const pageImages = extractImagesFromContent(page.content || page.body || '', page);
    allImages.push(...pageImages);
  }

  // Scan posts
  for (const post of posts) {
    if (!post || typeof post !== 'object') continue;

    const postImages = extractImagesFromContent(post.content || post.body || '', post);
    allImages.push(...postImages);
  }

  report.totalImages = allImages.length;

  // Process each image
  for (const image of allImages) {
    report.stats.total++;

    if (!image.alt || image.alt.trim() === '') {
      report.stats.withoutAlt++;

      if (!annotateEmptyOnly) {
        // Generate alt text
        const contextText = includeContext ? image.surroundingText || '' : '';
        const newAlt = generateAltText(image.src, contextText, {
          maxLength: options.maxLength || 125
        });

        image.alt = newAlt;
        image.generatedAlt = true;
        report.stats.generatedAlt++;
        report.annotatedImages.push(image);
      }

      report.missingAltImages.push(image);
    } else {
      report.stats.withAlt++;
    }

  // Generate caption if requested
  if (generateCaptions) {
    if (!image.caption || !image.alt) {
      const caption = generateImageCaption(image, options);
      if (caption) {
        image.caption = caption;
        report.stats.generatedCaption++;
      }
    }
  }
  }

  report.stats.generatedCaption = report.stats.generatedCaption || 0;

  return report;
}

/**
 * Extract images from HTML content
 */
function extractImagesFromContent(htmlContent, contextInfo = {}) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return [];
  }

  const images = [];
  const imgRegex = /<img\s+[^>]*?src=["']([^"']*)["'][^>]*?\/?>/gi;
  let match;

  while ((match = imgRegex.exec(htmlContent)) !== null) {
    const src = match[1];
    const fullTag = match[0];

    // Extract alt attribute if present
    const altMatch = fullTag.match(/alt=["']([^"']*)["']/i);
    const alt = altMatch ? altMatch[1] : '';

    // Extract surrounding context (text before and after the img tag)
    const beforeMatch = htmlContent.slice(0, match.index);
    const afterMatch = htmlContent.slice(match.index + match[0].length);
    const surroundingText = extractSurroundingText(beforeMatch, afterMatch);

    images.push({
      src,
      alt,
      hasAlt: alt && alt.trim() !== '',
      context: contextInfo,
      surroundingText: surroundingText,
      fullTag
    });
  }

  return images;
}

/**
 * Extract surrounding text context from before/after HTML
 */
function extractSurroundingText(beforeHtml, afterHtml) {
  // Get text from before and after, limited to reasonable length
  const beforeText = stripHtml(beforeHtml).slice(-100);
  const afterText = stripHtml(afterHtml).slice(0, 100);

  return (beforeText + ' ' + afterText).trim();
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
 * Generate image caption
 */
function generateImageCaption(image, options = {}) {
  if (!image || !image.src) return '';

  const captionPrefix = options.captionPrefix || 'Figure';
  const captionNumber = options.captionNumber || '';

  const filename = path.basename(image.src, path.extname(image.src));
  const keywords = extractFilenameKeywords(image.src).slice(0, 4);

  if (keywords.length > 0) {
    return `${captionPrefix}${captionNumber ? ' ' + captionNumber : ''}: ${keywords.join(' ').replace(/-/g, ' ')}`;
  }

  return `${captionPrefix}${captionNumber ? ' ' + captionNumber : ''}: Image content`;
}

// ============================================================
// Alt Text Quality Scoring
// ============================================================

/**
 * Score alt text quality
 *
 * @param {string} altText - Alt text to evaluate
 * @param {Object} imageInfo - Image information for context
 * @returns {Object} Quality score and issues
 */
function scoreAltTextQuality(altText, imageInfo = {}) {
  const issues = [];
  let score = 100;

  if (!altText || typeof altText !== 'string') {
    return {
      score: 0,
      issues: [{ type: 'Missing', message: 'Alt text is empty or missing', severity: 'critical' }],
      recommendations: ['Add descriptive alt text to improve accessibility and SEO']
    };
  }

  const trimmedAlt = altText.trim();

  // Check for empty alt
  if (trimmedAlt === '') {
    score -= 40;
    issues.push({
      type: 'EmptyAlt',
      message: 'Alt text is empty',
      severity: 'critical'
    });
    return { score: Math.max(0, score), issues, recommendations: ['Add descriptive alt text'] };
  }

  // Check length
  if (trimmedAlt.length < 5) {
    score -= 15;
    issues.push({
      type: 'TooShort',
      message: `Alt text is too short (${trimmedAlt.length} chars). Minimum recommended: 5 characters.`,
      severity: 'warning'
    });
  }

  if (trimmedAlt.length > 125) {
    score -= 10;
    issues.push({
      type: 'TooLong',
      message: `Alt text is too long (${trimmedAlt.length} chars). Recommended: under 125 characters.`,
      severity: 'warning'
    });
  }

  // Check for "image of" repetition
  const lowerAlt = trimmedAlt.toLowerCase();
  if (lowerAlt.startsWith('image of') || lowerAlt.startsWith('picture of')) {
    score -= 5;
    issues.push({
      type: 'RedundantPrefix',
      message: 'Alt text begins with "image of" or "picture of" which is redundant.',
      severity: 'info'
    });
  }

  // Check for keyword stuffing
  const words = trimmedAlt.split(/\s+/).filter(w => w.length > 0);
  const wordSet = new Set(words);
  const stuffingRatio = words.length > 0 ? wordSet.size / words.length : 1;

  if (words.length >= 4 && words.length <= 12 && stuffingRatio < 0.7) {
    score -= 15;
    issues.push({
      type: 'KeywordStuffing',
      message: 'Alt text appears to have keyword stuffing (low word diversity).',
      severity: 'warning'
    });
  }

  // Check for generic descriptions
  const genericPatterns = [
    /^image of .*$/i,
    /^picture of .*$/i,
    /^graphic of .*$/i,
    /^photo of .*$/i
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(trimmedAlt)) {
      score -= 3;
      issues.push({
        type: 'GenericDescription',
        message: 'Alt text uses generic "image of/picture of" pattern. Try to be more specific.',
        severity: 'info'
      });
      break;
    }
  }

  // Check for filename in alt (if image info provided)
  if (imageInfo?.src) {
    const filename = path.basename(imageInfo.src, path.extname(imageInfo.src));
    if (filename && trimmedAlt.toLowerCase().includes(filename.toLowerCase())) {
      // This can be OK but also indicate poor alt text
      if (trimmedAlt.toLowerCase() === filename.toLowerCase()) {
        score -= 10;
        issues.push({
          type: 'FilenameOnly',
          message: 'Alt text is same as filename. Add more descriptive content.',
          severity: 'warning'
        });
      }
    }
  }

  // Check for proper noun usage (good for SEO)
  const properNounCount = (trimmedAlt.match(/[A-Z][a-z]+/g) || []).length;
  if (properNounCount > 0 && words.length <= 15) {
    // Proper nouns are good for specific content
    score = Math.min(100, score + 2);
  }

  // Score interpretation
  let rating;
  if (score >= 90) rating = 'Excellent';
  else if (score >= 75) rating = 'Good';
  else if (score >= 60) rating = 'Fair';
  else if (score >= 40) rating = 'Poor';
  else rating = 'Needs Improvement';

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    rating,
    issues,
    recommendations: generateRecommendations(issues, trimmedAlt)
  };
}

/**
 * Generate recommendations based on issues
 */
function generateRecommendations(issues, altText) {
  const recommendations = [];

  for (const issue of issues) {
    if (issue.severity === 'critical') {
      recommendations.push(`Fix critical issue: ${issue.message}`);
    } else if (issue.severity === 'warning') {
      recommendations.push(`Improve: ${issue.message}`);
    }
  }

  if (recommendations.length === 0) {
    if (altText.length < 20) {
      recommendations.push('Consider adding more descriptive detail to alt text.');
    }
    if (altText.length > 100) {
      recommendations.push('Consider shortening alt text for better accessibility.');
    }
  }

  if (recommendations.length === 0) {
    recommendations.push('Alt text quality is good. Maintain current standards.');
  }

  return recommendations;
}

/**
 * Score all images in project
 */
function scoreAllImages(projectSchema) {
  const pages = projectSchema.pages || [];
  const posts = projectSchema.posts || [];

  const allImages = [];

  for (const page of pages) {
    if (!page || typeof page !== 'object') continue;
    const content = page.content || page.body || '';
    const imgRegex = /<img\s+[^>]*?src=["']([^"']*)["'][^>]*?\/?>/gi;
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
      const src = match[1];
      const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
      allImages.push({
        src,
        alt: altMatch ? altMatch[1] : '',
        pageId: page.id || page.slug
      });
    }
  }

  for (const post of posts) {
    if (!post || typeof post !== 'object') continue;
    const content = post.content || post.body || '';
    const imgRegex = /<img\s+[^>]*?src=["']([^"']*)["'][^>]*?\/?>/gi;
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
      const src = match[1];
      const altMatch = match[0].match(/alt=["']([^"']*)["']/i);
      allImages.push({
        src,
        alt: altMatch ? altMatch[1] : '',
        pageId: post.id || post.slug
      });
    }
  }

  const scoredImages = allImages.map(img => ({
    ...img,
    qualityScore: scoreAltTextQuality(img.alt, { src: img.src })
  }));

  return {
    totalImages: scoredImages.length,
    scoredImages,
    summary: {
      averageScore: scoredImages.length > 0
        ? Math.round(scoredImages.reduce((sum, img) => sum + img.qualityScore.score, 0) / scoredImages.length)
        : 0,
      excellent: scoredImages.filter(img => img.qualityScore.score >= 90).length,
      good: scoredImages.filter(img => img.qualityScore.score >= 75 && img.qualityScore.score < 90).length,
      fair: scoredImages.filter(img => img.qualityScore.score >= 60 && img.qualityScore.score < 75).length,
      poor: scoredImages.filter(img => img.qualityScore.score < 60).length
    }
  };
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Alt text generation
  generateAltText,
  batchAnnotateImages,
  extractFilenameKeywords,
  extractContextKeywords,
  extractImagesFromContent,

  // Quality scoring
  scoreAltTextQuality,
  scoreAllImages,
  generateRecommendations,

  // Caption generation
  generateImageCaption,

  // Utilities
  stripHtml,
  isStopWord,

  // For testing
  _test: {
    generateAltText,
    batchAnnotateImages,
    extractFilenameKeywords,
    extractContextKeywords,
    extractImagesFromContent,
    scoreAltTextQuality,
    scoreAllImages,
    generateImageCaption,
    stripHtml,
    isStopWord
  }
};

// ============================================================
// PallettAI Studio — Automated Content & SEO Health Scorer
// Grades site content with a 0-100 SEO health score based on
// heading hierarchy, meta length compliance, link/image audits,
// and readability scoring.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Readability Scoring (Flesch-Kincaid)
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
  'while', 'although', 'about', 'into', 'through', 'during', 'before', 'after'
]);

/**
 * Calculate Flesch Reading Ease score (0-100, higher = easier)
 *
 * Formula: 206.835 - 1.015(total words / total sentences) - 84.6(total syllables / total words)
 */
function calculateFleschReadingEase(text) {
  if (!text || typeof text !== 'string') {
    return { score: 0, interpretation: 'No content' };
  }

  const cleanText = stripHtml(text);
  if (cleanText.trim().length === 0) {
    return { score: 0, interpretation: 'Empty content' };
  }

  // Count words
  const words = cleanText
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);

  const totalWords = words.length;
  if (totalWords === 0) {
    return { score: 0, interpretation: 'No words found' };
  }

  // Count sentences (split by . ! ?)
  const sentences = cleanText
    .split(/[.!?]+/)
    .filter(s => s.trim().length > 0);

  const totalSentences = Math.max(sentences.length, 1);

  // Count syllables
  let totalSyllables = 0;
  for (const word of words) {
    totalSyllables += countSyllables(word);
  }

  // Calculate Flesch Reading Ease
  const avgWordsPerSentence = totalWords / totalSentences;
  const avgSyllablesPerWord = totalSyllables / totalWords;

  const score = Math.max(0, Math.min(100,
    206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord
  ));

  return {
    score: Math.round(score),
    interpretation: interpretReadingEase(score),
    avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
    avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100,
    totalWords,
    totalSentences,
    totalSyllables
  };
}

/**
 * Count syllables in a word (simplified algorithm)
 */
function countSyllables(word) {
  if (!word || word.length === 0) return 0;

  word = word.toLowerCase().replace(/[^a-z]/g, '');

  if (word.length <= 3) return 1;

  // Count vowel groups
  const vowels = 'aeiouy';
  let syllableCount = 0;
  let prevWasVowel = false;

  for (let i = 0; i < word.length; i++) {
    const isVowel = vowels.includes(word[i]);

    if (isVowel && !prevWasVowel) {
      syllableCount++;
    }

    prevWasVowel = isVowel;
  }

  // Adjust for silent e at end
  if (word.endsWith('e') && syllableCount > 1) {
    syllableCount--;
  }

  // Ensure at least 1 syllable
  return Math.max(1, syllableCount);
}

/**
 * Interpret Flesch Reading Ease score
 */
function interpretReadingEase(score) {
  if (score >= 90) return 'Very Easy (5th grade)';
  if (score >= 80) return 'Easy (6th grade)';
  if (score >= 70) return 'Fairly Easy (7th grade)';
  if (score >= 60) return 'Standard (8th-9th grade)';
  if (score >= 50) return 'Fairly Difficult (10th-12th grade)';
  if (score >= 30) return 'Difficult (College)';
  return 'Very Difficult (College Graduate)';
}

/**
 * Strip HTML tags
 */
function stripHtml(html) {
  if (!html) return '';

  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// SEO Health Audit
// ============================================================

/**
 * Audit SEO health of a project/schema
 *
 * @param {Object} projectSchema - Project schema with pages and content
 * @returns {Object} Structured audit report
 */
function auditSEOHealth(projectSchema) {
  const report = {
    score: 100,
    maxScore: 100,
    critical_issues: [],
    warnings: [],
    recommendations: [],
    pageAudits: [],
    summary: {
      totalPages: 0,
      pagesWithIssues: 0,
      averageReadability: 0
    }
  };

  if (!projectSchema || typeof projectSchema !== 'object') {
    report.critical_issues.push({
      type: 'ConfigError',
      message: 'Invalid project schema provided',
      severity: 'critical'
    });
    report.score = 0;
    return report;
  }

  // Audit each page
  const pages = projectSchema.pages || [];

  if (pages.length === 0) {
    report.critical_issues.push({
      type: 'MissingContent',
      message: 'No pages found in project schema',
      severity: 'critical'
    });
    report.score -= 20;
  }

  report.summary.totalPages = pages.length;

  let totalReadability = 0;
  let readabilityCount = 0;

  for (const page of pages) {
    const pageAudit = auditPageSEO(page, projectSchema);
    report.pageAudits.push(pageAudit);

    // Aggregate scores
    if (pageAudit.readability && pageAudit.readability.score > 0) {
      totalReadability += pageAudit.readability.score;
      readabilityCount++;
    }

    // Collect issues
    for (const issue of pageAudit.critical_issues) {
      report.critical_issues.push({
        ...issue,
        page: page.id || page.slug || 'unknown'
      });
    }

    for (const warning of pageAudit.warnings) {
      report.warnings.push({
        ...warning,
        page: page.id || page.slug || 'unknown'
      });
    }

    for (const rec of pageAudit.recommendations) {
      report.recommendations.push({
        ...rec,
        page: page.id || page.slug || 'unknown'
      });
    }

    if (pageAudit.critical_issues.length > 0 || pageAudit.warnings.length > 0) {
      report.summary.pagesWithIssues++;
    }
  }

  // Calculate average readability
  if (readabilityCount > 0) {
    report.summary.averageReadability = Math.round(totalReadability / readabilityCount);
  }

  // Apply global deductions
  if (report.critical_issues.length > 0) {
    report.score -= Math.min(30, report.critical_issues.length * 5);
  }

  if (report.warnings.length > 0) {
    report.score -= Math.min(20, report.warnings.length * 2);
  }

  // Clamp score
  report.score = Math.max(0, Math.min(100, Math.round(report.score)));

  // Add overall recommendations
  if (report.score < 50) {
    report.recommendations.push({
      type: 'Critical',
      message: 'Overall SEO health score is below 50. Immediate attention required.',
      priority: 'high'
    });
  } else if (report.score < 75) {
    report.recommendations.push({
      type: 'Warning',
      message: 'Overall SEO health score is below 75. Consider addressing warnings.',
      priority: 'medium'
    });
  }

  return report;
}

/**
 * Audit individual page SEO
 */
function auditPageSEO(page, projectSchema) {
  const audit = {
    pageId: page.id || page.slug || 'unknown',
    pageUrl: page.url || '',
    score: 100,
    critical_issues: [],
    warnings: [],
    recommendations: [],
    checks: {
      meta: null,
      headings: null,
      links: null,
      images: null,
      readability: null
    }
  };

  // 1. Meta title & description checks
  const metaCheck = auditMetaTags(page);
  audit.checks.meta = metaCheck;
  audit.critical_issues.push(...metaCheck.critical);
  audit.warnings.push(...metaCheck.warnings);
  audit.recommendations.push(...metaCheck.recommendations);

  // 2. Heading hierarchy check
  const headingCheck = auditHeadingHierarchy(page);
  audit.checks.headings = headingCheck;
  audit.critical_issues.push(...headingCheck.critical);
  audit.warnings.push(...headingCheck.warnings);
  audit.recommendations.push(...headingCheck.recommendations);

  // 3. Link checks (broken internal anchors)
  const linkCheck = auditLinks(page, projectSchema);
  audit.checks.links = linkCheck;
  audit.critical_issues.push(...linkCheck.critical);
  audit.warnings.push(...linkCheck.warnings);
  audit.recommendations.push(...linkCheck.recommendations);

  // 4. Image alt attribute check
  const imageCheck = auditImages(page);
  audit.checks.images = imageCheck;
  audit.critical_issues.push(...imageCheck.critical);
  audit.warnings.push(...imageCheck.warnings);
  audit.recommendations.push(...imageCheck.recommendations);

  // 5. Readability score
  const content = page.content || page.body || page.description || '';
  const readabilityCheck = calculateFleschReadingEase(content);
  audit.checks.readability = readabilityCheck;

  // Score calculation
  let pageScore = 100;

  // Meta deductions
  pageScore -= metaCheck.deductions;

  // Heading deductions
  pageScore -= headingCheck.deductions;

  // Link deductions
  pageScore -= linkCheck.deductions;

  // Image deductions
  pageScore -= imageCheck.deductions;

  // Readability penalties (only if content exists)
  if (content && content.trim().length > 50) {
    if (readabilityCheck.score < 30) {
      pageScore -= 15;
      audit.warnings.push({
        type: 'Readability',
        message: `Readability score is very low (${readabilityCheck.score}). Target: 60+ for general audience.`,
        severity: 'warning'
      });
    } else if (readabilityCheck.score < 50) {
      pageScore -= 10;
    } else if (readabilityCheck.score < 60) {
      pageScore -= 5;
    }
  }

  audit.score = Math.max(0, Math.min(100, Math.round(pageScore)));

  return audit;
}

/**
 * Audit meta tags for a page
 */
function auditMetaTags(page) {
  const result = {
    critical: [],
    warnings: [],
    recommendations: [],
    deductions: 0
  };

  // Title check
  const title = page.title || '';
  if (!title || title.trim() === '') {
    result.critical.push({
      type: 'MetaTitle',
      message: 'Page is missing a title',
      severity: 'critical'
    });
    result.deductions += 15;
  } else if (title.length < 30) {
    result.warnings.push({
      type: 'MetaTitle',
      message: `Title is too short (${title.length} chars). Recommended: 50-60 characters.`,
      severity: 'warning'
    });
    result.deductions += 3;
  } else if (title.length > 70) {
    result.warnings.push({
      type: 'MetaTitle',
      message: `Title is too long (${title.length} chars). Recommended: 50-60 characters. Will be truncated in search results.`,
      severity: 'warning'
    });
    result.deductions += 3;
  } else if (title.length >= 50 && title.length <= 60) {
    // Perfect length
    result.recommendations.push({
      type: 'MetaTitle',
      message: 'Title length is optimal (50-60 characters)',
      severity: 'info'
    });
  }

  // Description check
  const description = page.description || page.meta?.description || '';
  if (!description || description.trim() === '') {
    result.critical.push({
      type: 'MetaDescription',
      message: 'Page is missing a meta description',
      severity: 'critical'
    });
    result.deductions += 10;
  } else if (description.length < 120) {
    result.warnings.push({
      type: 'MetaDescription',
      message: `Description is too short (${description.length} chars). Recommended: 150-160 characters.`,
      severity: 'warning'
    });
    result.deductions += 2;
  } else if (description.length > 180) {
    result.warnings.push({
      type: 'MetaDescription',
      message: `Description is too long (${description.length} chars). Recommended: 150-160 characters. Will be truncated.`,
      severity: 'warning'
    });
    result.deductions += 2;
  } else if (description.length >= 150 && description.length <= 160) {
    result.recommendations.push({
      type: 'MetaDescription',
      message: 'Description length is optimal (150-160 characters)',
      severity: 'info'
    });
  }

  return result;
}

/**
 * Audit heading hierarchy for a page
 */
function auditHeadingHierarchy(page) {
  const result = {
    critical: [],
    warnings: [],
    recommendations: [],
    deductions: 0,
    structure: []
  };

  // Extract content to check headings
  const content = page.content || page.body || '';

  // Parse HTML to find headings
  const headingRegex = /<h([1-6])([^>]*)>([^<]*)<\/h\1>/gi;
  const headings = [];
  let match;

  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: parseInt(match[1]),
      text: match[3].trim(),
      attributes: match[2]
    });
  }

  result.structure = headings;

  if (headings.length === 0) {
    if (content && content.trim().length > 50) {
      result.warnings.push({
        type: 'Headings',
        message: 'No headings found in content, but content exists. Consider adding headings for structure.',
        severity: 'warning'
      });
      result.deductions += 5;
    }
    return result;
  }

  // Check for single H1
  const h1Count = headings.filter(h => h.level === 1).length;

  if (h1Count === 0) {
    result.critical.push({
      type: 'Headings',
      message: 'No H1 heading found. Every page should have exactly one H1.',
      severity: 'critical'
    });
    result.deductions += 15;
  } else if (h1Count > 1) {
    result.critical.push({
      type: 'Headings',
      message: `Found ${h1Count} H1 headings. Should have exactly one H1 per page.`,
      severity: 'critical'
    });
    result.deductions += 10;
  }

  // Check heading hierarchy progression
  let lastLevel = 0;
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];

    if (lastLevel > 0 && heading.level > lastLevel + 1) {
      result.warnings.push({
        type: 'Headings',
        message: `Heading hierarchy skipped from H${lastLevel} to H${heading.level}. Consider using H${lastLevel + 1} instead.`,
        severity: 'warning'
      });
      result.deductions += 2;
    }

    lastLevel = heading.level;
  }

  // Check for empty headings
  const emptyHeadings = headings.filter(h => !h.text);
  if (emptyHeadings.length > 0) {
    result.warnings.push({
      type: 'Headings',
      message: `${emptyHeadings.length} empty heading(s) found. Headings should contain descriptive text.`,
      severity: 'warning'
    });
    result.deductions += 3;
  }

  return result;
}

/**
 * Audit links for a page
 */
function auditLinks(page, projectSchema) {
  const result = {
    critical: [],
    warnings: [],
    recommendations: [],
    deductions: 0,
    totalLinks: 0,
    brokenLinks: []
  };

  const content = page.content || page.body || '';

  // Find all internal links - handle both single and double quotes, with optional whitespace
  const internalLinkRegex = /<a\s*([^>]*?)href=["']([^"']*)["'][^>]*>/gi;
  let match;
  const links = [];

  while ((match = internalLinkRegex.exec(content)) !== null) {
    const href = match[1];
    if (href.startsWith('/') || (!href.startsWith('http') && !href.startsWith('#'))) {
      links.push({
        href,
        isInternal: href.startsWith('/') && !href.startsWith('//')
      });
    }
  }

  result.totalLinks = links.length;

  // Check for broken internal anchors (links to #id that don't exist)
  const anchorLinks = links.filter(l => l.href.startsWith('#'));
  const anchorIds = new Set();

  // Extract all IDs from content
  const idRegex = /(?:id|name)=["']([^"']+)["']/g;
  let idMatch;
  while ((idMatch = idRegex.exec(content)) !== null) {
    anchorIds.add(idMatch[1]);
  }

  // Check for broken anchors
  for (const link of anchorLinks) {
    const targetId = link.href.slice(1);
    if (!anchorIds.has(targetId) && targetId !== '') {
      result.brokenLinks.push({
        href: link.href,
        targetId
      });
    }
  }

  if (result.brokenLinks.length > 0) {
    result.critical.push({
      type: 'BrokenLinks',
      message: `Found ${result.brokenLinks.length} broken internal anchor link(s).`,
      severity: 'critical'
    });
    result.deductions += 5 * result.brokenLinks.length;
  }

  // Check for missing title attributes on links
  const linksWithoutTitle = content.match(/<a\s+[^>]*href=["'][^"']*["'][^>]*>/gi) || [];
  const linksWithTitle = content.match(/<a\s+[^>]*title=["'][^"']*["'][^>]*>/gi) || [];

  if (linksWithoutTitle.length > linksWithTitle.length && links.length > 0) {
    result.warnings.push({
      type: 'Links',
      message: `Some links are missing title attributes. Add descriptive titles for accessibility and SEO.`,
      severity: 'warning'
    });
    result.deductions += 2;
  }

  return result;
}

/**
 * Audit images for alt attributes
 */
function auditImages(page) {
  const result = {
    critical: [],
    warnings: [],
    recommendations: [],
    deductions: 0,
    totalImages: 0,
    imagesWithoutAlt: []
  };

  const content = page.content || page.body || '';

  // Find all images
  const imgRegex = /<img([^>]*)\/?>/gi;
  let match;
  const images = [];

  while ((match = imgRegex.exec(content)) !== null) {
    const attrs = match[1];
    const srcMatch = attrs.match(/src="([^"]*)"/);
    const altMatch = attrs.match(/alt="([^"]*)"/);

    images.push({
      src: srcMatch ? srcMatch[1] : '',
      alt: altMatch ? altMatch[1] : null,
      hasAlt: !!altMatch,
      altEmpty: altMatch && altMatch[1].trim() === ''
    });
  }

  result.totalImages = images.length;

  // Check for missing alt attributes
  const imagesMissingAlt = images.filter(img => !img.hasAlt);
  result.imagesWithoutAlt = imagesMissingAlt;

  if (imagesMissingAlt.length > 0) {
    result.critical.push({
      type: 'ImageAlt',
      message: `Found ${imagesMissingAlt.length} image(s) without alt attributes. All images must have alt text for accessibility and SEO.`,
      severity: 'critical'
    });
    result.deductions += 5 * imagesMissingAlt.length;
  }

  // Check for empty alt attributes (decorative images are OK, but should be intentional)
  const imagesWithEmptyAlt = images.filter(img => img.altEmpty);
  if (imagesWithEmptyAlt.length > 0) {
    result.warnings.push({
      type: 'ImageAlt',
      message: `${imagesWithEmptyAlt.length} image(s) have empty alt attributes. If decorative, this is OK, but if meaningful, add descriptive alt text.`,
      severity: 'warning'
    });
  }

  // Check for repetitive alt text
  const altTexts = images
    .filter(img => img.hasAlt && img.alt)
    .map(img => img.alt.toLowerCase());

  const altCounts = {};
  for (const alt of altTexts) {
    altCounts[alt] = (altCounts[alt] || 0) + 1;
  }

  const duplicateAlts = Object.entries(altCounts).filter(([_, count]) => count > 1);
  if (duplicateAlts.length > 0) {
    result.warnings.push({
      type: 'ImageAlt',
      message: `Found ${duplicateAlts.length} duplicate alt text(s). Each image should have unique, descriptive alt text.`,
      severity: 'warning'
    });
    result.deductions += 1 * duplicateAlts.length;
  }

  return result;
}

/**
 * Calculate overall SEO health score
 */
function calculateOverallScore(auditReport) {
  let score = 100;

  // Deductions for critical issues
  score -= (auditReport.critical_issues || []).length * 4;

  // Deductions for warnings
  score -= (auditReport.warnings || []).length * 1.5;

  // Deductions for recommendations (minor)
  score -= (auditReport.recommendations || []).length * 0.5;

  // Score based on average readability
  const avgReadability = auditReport.summary?.averageReadability;
  if (avgReadability !== undefined && avgReadability > 0) {
    if (avgReadability < 30) {
      score -= 10;
    } else if (avgReadability < 60) {
      score -= 5;
    }
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Readability
  calculateFleschReadingEase,
  countSyllables,
  interpretReadingEase,
  stripHtml,

  // SEO Audit
  auditSEOHealth,
  auditPageSEO,
  auditMetaTags,
  auditHeadingHierarchy,
  auditLinks,
  auditImages,
  calculateOverallScore,

  // Export
  _test: {
    calculateFleschReadingEase,
    countSyllables,
    interpretReadingEase,
    stripHtml,
    auditSEOHealth,
    auditPageSEO,
    auditMetaTags,
    auditHeadingHierarchy,
    auditLinks,
    auditImages,
    calculateOverallScore
  }
};

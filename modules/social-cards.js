// ============================================================
// PallettAI Studio — Dynamic OpenGraph Social Card Renderer
// Generates 1200x630 SVG social preview images and injects
// complete Twitter Card + OpenGraph meta tags.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Design DNA Archetype Tokens
// ============================================================

const DESIGN_DNA_ARCHETYPES = {
  brutalist: {
    name: 'Brutalist',
    primaryColor: '#1a1a1a',
    secondaryColor: '#ffffff',
    accentColor: '#ff3333',
    borderStyle: 'thick',
    borderColor: '#000000',
    backgroundStyle: 'solid',
    typography: 'monospace',
    decorativeElements: 'halftone'
  },
  'bento-glass': {
    name: 'Bento Glass',
    primaryColor: '#1e1e2e',
    secondaryColor: 'rgba(255,255,255,0.1)',
    accentColor: '#7c3aed',
    borderStyle: 'glass',
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundStyle: 'gradient',
    typography: 'sans-serif',
    decorativeElements: 'glass-borders'
  },
  editorial: {
    name: 'Editorial',
    primaryColor: '#fafafa',
    secondaryColor: '#1a1a1a',
    accentColor: '#c9a227',
    borderStyle: 'thin',
    borderColor: '#1a1a1a',
    backgroundStyle: 'solid',
    typography: 'serif',
    decorativeElements: 'lines'
  },
  vibrant: {
    name: 'Vibrant',
    primaryColor: '#0d0d0d',
    secondaryColor: '#ff6b35',
    accentColor: '#00d4ff',
    borderStyle: 'gradient',
    borderColor: 'linear-gradient',
    backgroundStyle: 'gradient',
    typography: 'sans-serif-bold',
    decorativeElements: 'geometric'
  },
  minimal: {
    name: 'Minimal',
    primaryColor: '#ffffff',
    secondaryColor: '#f5f5f5',
    accentColor: '#333333',
    borderStyle: 'none',
    borderColor: 'transparent',
    backgroundStyle: 'solid',
    typography: 'sans-serif-light',
    decorativeElements: 'none'
  },
  retro: {
    name: 'Retro',
    primaryColor: '#f4a460',
    secondaryColor: '#2d1810',
    accentColor: '#ff6b6b',
    borderStyle: 'dashed',
    borderColor: '#2d1810',
    backgroundStyle: 'pattern',
    typography: 'display',
    decorativeElements: 'dots'
  }
};

// ============================================================
// SVG Generation Utilities
// ============================================================

/**
 * Escape string for SVG text content
 */
function escapeSvgText(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Truncate text with ellipsis if too long
 */
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Get typography style for archetype
 */
function getTypographyStyle(archetype) {
  const dna = DESIGN_DNA_ARCHETYPES[archetype] || DESIGN_DNA_ARCHETYPES.minimal;
  const typography = dna.typography || 'sans-serif';

  switch (typography) {
    case 'monospace':
      return {
        fontFamily: 'monospace',
        fontWeight: '400',
        fontSizeRatio: 1
      };
    case 'serif':
      return {
        fontFamily: 'Georgia, serif',
        fontWeight: '400',
        fontSizeRatio: 1
      };
    case 'sans-serif-bold':
      return {
        fontFamily: 'Arial, sans-serif',
        fontWeight: '700',
        fontSizeRatio: 1
      };
    case 'sans-serif-light':
      return {
        fontFamily: 'Arial, sans-serif',
        fontWeight: '300',
        fontSizeRatio: 1
      };
    case 'display':
      return {
        fontFamily: 'Georgia, serif',
        fontWeight: '700',
        fontSizeRatio: 1.1
      };
    default:
      return {
        fontFamily: 'Arial, sans-serif',
        fontWeight: '400',
        fontSizeRatio: 1
      };
  }
}

/**
 * Generate SVG background based on archetype
 */
function generateSvgBackground(archetype, width = 1200, height = 630) {
  const dna = DESIGN_DNA_ARCHETYPES[archetype] || DESIGN_DNA_ARCHETYPES.minimal;
  const { primaryColor, secondaryColor, backgroundStyle } = dna;

  let background = '';

  switch (backgroundStyle) {
    case 'gradient':
      background = `
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${secondaryColor};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bgGrad)" />`;
      break;

    case 'pattern':
      // Retro dotted pattern
      background = `
  <rect width="${width}" height="${height}" fill="${primaryColor}" />
  <g fill="${secondaryColor}" opacity="0.3">
    ${generateDotPattern(width, height, 40)}
  </g>`;
      break;

    default:
      // Solid background
      background = `<rect width="${width}" height="${height}" fill="${primaryColor}" />`;
  }

  return background;
}

/**
 * Generate dot pattern for retro style
 */
function generateDotPattern(width, height, spacing) {
  let dots = '';
  for (let x = 0; x < width; x += spacing) {
    for (let y = 0; y < height; y += spacing) {
      dots += `<circle cx="${x}" cy="${y}" r="2" />`;
    }
  }
  return dots;
}

/**
 * A single horizontal band of dots, used by the Retro archetype.
 */
function generateDotBand(width, y, spacing) {
  let dots = '';
  for (let x = spacing; x < width - spacing; x += spacing) {
    dots += `    <circle cx="${x}" cy="${y}" r="2.5" />\n`;
  }
  return dots;
}

/**
 * Generate halftone pattern for brutalist style
 */
function generateHalftonePattern(x, y, width, height, density = 20) {
  let dots = '';
  const spacing = width / density;
  for (let i = 0; i < density; i++) {
    for (let j = 0; j < density; j++) {
      const cx = x + (i * spacing) + (spacing / 2);
      const cy = y + (j * spacing) + (spacing / 2);
      const radius = (spacing / 4) * (0.3 + Math.random() * 0.7);
      dots += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${radius.toFixed(1)}" fill="rgba(255,255,255,0.15)" />`;
    }
  }
  return dots;
}

/**
 * Generate decorative elements for archetype
 */
function generateDecorativeElements(archetype, width = 1200, height = 630) {
  const dna = DESIGN_DNA_ARCHETYPES[archetype] || DESIGN_DNA_ARCHETYPES.minimal;
  // secondaryColor is needed by the 'dots' (Retro) branch below; omitting it
  // from this destructure is what threw "secondaryColor is not defined".
  const { decorativeElements, accentColor, secondaryColor } = dna;
  let elements = '';

  switch (decorativeElements) {
    case 'halftone':
      elements = generateHalftonePattern(width - 200, 0, 200, height, 12);
      break;

    case 'glass-borders':
      // Glassmorphism border effect
      elements = `
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1" rx="12" />
  <rect x="30" y="30" width="${width - 60}" height="${height - 60}" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1" rx="8" />`;
      break;

    case 'lines':
      // Editorial horizontal lines
      elements = `
  <line x1="100" y1="580" x2="${width - 100}" y2="580" stroke="${accentColor}" stroke-width="2" />
  <line x1="100" y1="585" x2="${width - 100}" y2="585" stroke="${accentColor}" stroke-width="1" />`;
      break;

    case 'geometric':
      // Vibrant geometric shapes
      elements = `
  <polygon points="0,${height} ${width * 0.3},${height * 0.3} ${width * 0.5},${height}" fill="${accentColor}" opacity="0.2" />
  <circle cx="${width - 150}" cy="150" r="80" fill="${accentColor}" opacity="0.15" />
  <rect x="50" y="${height - 100}" width="80" height="80" fill="${accentColor}" opacity="0.1" transform="rotate(45 ${50 + 40} ${height - 100 + 40})" />`;
      break;

    case 'dots':
      // Retro: a band of dots along the top and bottom edges. The previous
      // call passed five arguments to a three-parameter helper, so the bands
      // rendered as nothing at all.
      elements = `
  <g fill="${secondaryColor}">
${generateDotBand(width, 22, 18)}
${generateDotBand(width, height - 22, 18)}
  </g>`;
      break;

    default:
      // Minimal - no decorations
      break;
  }

  return elements;
}

/**
 * Generate border based on archetype
 */
function generateBorder(archetype, width = 1200, height = 630) {
  const dna = DESIGN_DNA_ARCHETYPES[archetype] || DESIGN_DNA_ARCHETYPES.minimal;
  // The 'gradient' border (Vibrant) needs secondaryColor; omitting it from this
  // destructure is what threw "secondaryColor is not defined".
  const { borderStyle, borderColor, accentColor, secondaryColor } = dna;

  if (borderStyle === 'none') return '';

  let border = '';

  switch (borderStyle) {
    case 'thick':
      border = `<rect x="30" y="30" width="${width - 60}" height="${height - 60}" fill="none" stroke="${borderColor}" stroke-width="8" />`;
      break;

    case 'thin':
      border = `<rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none" stroke="${borderColor}" stroke-width="2" />`;
      break;

    case 'dashed':
      border = `<rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none" stroke="${borderColor}" stroke-width="3" stroke-dasharray="15,10" />`;
      break;

    case 'glass':
      border = `
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" rx="16" />
  <rect x="28" y="28" width="${width - 56}" height="${height - 56}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1" rx="12" />`;
      break;

    case 'gradient':
      border = `
  <defs>
    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${accentColor};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${secondaryColor};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none" stroke="url(#borderGrad)" stroke-width="4" />`;
      break;

    default:
      border = '';
  }

  return border;
}

/**
 * Calculate font size based on available width and text length
 */
function calculateFontSize(text, maxWidth, fontFamily, minSize = 24, maxSize = 72) {
  // Approximate character width factor for different font types
  const widthFactor = fontFamily.includes('serif') ? 0.6 : fontFamily.includes('monospace') ? 0.7 : 0.55;

  // Estimate needed size
  const avgCharWidth = maxWidth / text.length * widthFactor;
  let size = Math.min(maxSize, Math.max(minSize, avgCharWidth * 1.8));

  // Adjust based on text length
  if (text.length > 40) {
    size = Math.max(minSize, size * 0.7);
  } else if (text.length > 25) {
    size = Math.max(minSize, size * 0.85);
  }

  return Math.round(size);
}

/**
 * Wrap text into multiple lines for SVG
 */
function wrapText(text, maxCharsPerLine) {
  if (!text) return [''];

  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);

  return lines.length > 0 ? lines : [text];
}

// ============================================================
// OG Image SVG Generation
// ============================================================

/**
 * Generate an OG image as SVG string
 *
 * @param {Object} pageMeta - Page metadata
 * @param {string} pageMeta.title - Page title
 * @param {string} pageMeta.siteName - Site name
 * @param {string} pageMeta.author - Author name (optional)
 * @param {string} pageMeta.readingTime - Reading time (optional)
 * @param {string} pageMeta.description - Description (optional)
 * @param {string} [archetype='minimal'] - Design DNA archetype
 * @param {Object} options - Generation options
 * @param {number} options.width - Card width (default: 1200)
 * @param {number} options.height - Card height (default: 630)
 * @returns {string} Complete SVG document
 */
function generateOGImageSVG(pageMeta, archetype = 'minimal', options = {}) {
  const {
    title = 'Untitled Page',
    siteName = 'PallettAI Studio',
    author,
    readingTime,
    description
  } = pageMeta || {};

  const {
    width = 1200,
    height = 630
  } = options;

  // Resolve the archetype once. The helpers below look it up themselves, so
  // passing an unknown name straight through made them dereference undefined
  // tokens and throw instead of falling back.
  const resolvedArchetype = DESIGN_DNA_ARCHETYPES[archetype] ? archetype : 'minimal';
  const dna = DESIGN_DNA_ARCHETYPES[resolvedArchetype];
  const typography = getTypographyStyle(resolvedArchetype);

  // Calculate text sizes
  const titleFontSize = calculateFontSize(title, width * 0.75, typography.fontFamily, 24, 64);
  const siteNameFontSize = Math.max(18, titleFontSize * 0.45);
  const authorFontSize = Math.max(16, titleFontSize * 0.35);
  const descriptionFontSize = Math.max(14, titleFontSize * 0.3);

  // Wrap title text
  const titleLines = wrapText(title, Math.floor((width * 0.75) / (titleFontSize * 0.6)));
  const titleLineHeight = titleFontSize * 1.2;

  // Calculate positions
  const padding = 80;
  const contentWidth = width - (padding * 2);
  const titleStartY = 280;
  const siteNameY = titleStartY + (titleLines.length * titleLineHeight) + 40;
  const authorY = siteNameY + 45;
  const descriptionY = author ? authorY + 45 : siteNameY + 55;

  // Build SVG
  const svg = `
<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="rgba(0,0,0,0.2)" />
    </filter>
${generateGradientDefs(resolvedArchetype)}
  </defs>

  ${generateSvgBackground(resolvedArchetype, width, height)}

  ${generateDecorativeElements(resolvedArchetype, width, height)}

  ${generateBorder(resolvedArchetype, width, height)}

  <g filter="url(#shadow)">
    <rect x="${padding}" y="${padding}" width="${contentWidth}" height="${height - padding * 2}" rx="${resolvedArchetype === 'bento-glass' ? 16 : 8}" fill="${getCardBackground(resolvedArchetype)}" opacity="0.95" />
  </g>

  <!-- Site Name -->
  <text x="${width / 2}" y="${siteNameY}" text-anchor="middle" font-family="${typography.fontFamily}" font-size="${siteNameFontSize}" font-weight="${typography.fontWeight}" fill="${getTextColor(resolvedArchetype, 'secondary')}">
    ${escapeSvgText(siteName.toUpperCase())}
  </text>

  <!-- Title Lines -->
${titleLines.map((line, i) => `
  <text x="${width / 2}" y="${titleStartY + (i * titleLineHeight)}" text-anchor="middle" font-family="${typography.fontFamily}" font-size="${titleFontSize}" font-weight="${typography.fontWeight}" fill="${getTextColor(resolvedArchetype, 'primary')}">
    ${escapeSvgText(line)}
  </text>
`).join('')}

  <!-- Author -->
${author ? `
  <text x="${width / 2}" y="${authorY}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${authorFontSize}" fill="${getTextColor(resolvedArchetype, 'accent')}">
    ${escapeSvgText(`By ${author}`)}
  </text>
` : ''}

  <!-- Reading Time -->
${readingTime ? `
  <text x="${width / 2}" y="${author ? authorY + 25 : descriptionY - 10}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${descriptionFontSize}" fill="${getTextColor(resolvedArchetype, 'muted')}">
    ${escapeSvgText(readingTime)}
  </text>
` : ''}

  <!-- Description -->
${description ? `
  <text x="${width / 2}" y="${descriptionY + (author ? 25 : 20)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${descriptionFontSize}" fill="${getTextColor(resolvedArchetype, 'muted')}">
    ${escapeSvgText(truncateText(description, 120))}
  </text>
` : ''}

  <!-- Bottom accent bar -->
  <rect x="${padding}" y="${height - padding + 20}" width="${contentWidth}" height="4" fill="${dna.accentColor}" rx="2" />
</svg>`.trim();

  return svg;
}

/**
 * Generate gradient definitions for archetypes
 */
function generateGradientDefs(archetype) {
  const dna = DESIGN_DNA_ARCHETYPES[archetype];

  if (dna.backgroundStyle === 'gradient') {
    return `
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${dna.primaryColor};stop-opacity:0.9" />
      <stop offset="100%" style="stop-color:${dna.secondaryColor};stop-opacity:0.8" />
    </linearGradient>`;
  }

  return '';
}

/**
 * Get card background color/gradient
 */
function getCardBackground(archetype) {
  const dna = DESIGN_DNA_ARCHETYPES[archetype];

  switch (dna.backgroundStyle) {
    case 'gradient':
      return 'url(#cardGrad)';
    case 'pattern':
      return dna.primaryColor;
    default:
      // Calculate based on primary/secondary
      if (dna.primaryColor === '#ffffff' || dna.primaryColor === '#fafafa') {
        return '#ffffff';
      }
      return dna.primaryColor;
  }
}

/**
 * Get text color based on archetype and text type
 */
function getTextColor(resolvedArchetype, type = 'primary') {
  const dna = DESIGN_DNA_ARCHETYPES[archetype];
  const isDark = isDarkColor(dna.primaryColor);

  switch (type) {
    case 'primary':
      return isDark ? '#ffffff' : '#1a1a1a';
    case 'secondary':
      return isDark ? 'rgba(255,255,255,0.7)' : '#666666';
    case 'accent':
      return dna.accentColor;
    case 'muted':
      return isDark ? 'rgba(255,255,255,0.5)' : '#999999';
    default:
      return isDark ? '#ffffff' : '#1a1a1a';
  }
}

/**
 * Simple dark color detection
 */
function isDarkColor(hex) {
  if (!hex || hex.startsWith('rgba')) return true;

  const c = hex.replace('#', '');
  if (c.length === 3) {
    const r = parseInt(c[0] + c[0], 16);
    const g = parseInt(c[1] + c[1], 16);
    const b = parseInt(c[2] + c[2], 16);
    return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
  }

  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
}

/**
 * Save SVG to file
 */
function saveOGImageSVG(svgContent, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, svgContent, 'utf8');
  return path.resolve(outputPath);
}

// ============================================================
// Social Meta Tag Injection
// ============================================================

/**
 * Inject social media meta tags into HTML
 *
 * @param {string} html - HTML content
 * @param {Object} pageMeta - Page metadata
 * @param {string} ogImageUrl - URL to the OG image
 * @returns {string} HTML with meta tags injected
 */
function injectSocialMetaTags(html, pageMeta, ogImageUrl) {
  const {
    title = '',
    description = '',
    siteName = '',
    type = 'website'
  } = pageMeta || {};

  if (!ogImageUrl) {
    throw new Error('ogImageUrl is required for social meta tag injection');
  }

  // Build meta tags
  const metaTags = [];

  // OpenGraph
  metaTags.push(`<meta property="og:title" content="${escapeHtml(title)}">`);
  metaTags.push(`<meta property="og:description" content="${escapeHtml(description)}">`);
  metaTags.push(`<meta property="og:site_name" content="${escapeHtml(siteName)}">`);
  metaTags.push(`<meta property="og:type" content="${escapeHtml(type)}">`);
  metaTags.push(`<meta property="og:image" content="${escapeHtml(ogImageUrl)}">`);
  metaTags.push(`<meta property="og:image:width" content="1200">`);
  metaTags.push(`<meta property="og:image:height" content="630">`);
  metaTags.push(`<meta property="og:image:alt" content="${escapeHtml(title || siteName)}">`);

  // Twitter Card
  metaTags.push(`<meta name="twitter:card" content="summary_large_image">`);
  metaTags.push(`<meta name="twitter:title" content="${escapeHtml(title)}">`);
  metaTags.push(`<meta name="twitter:description" content="${escapeHtml(description)}">`);
  metaTags.push(`<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">`);
  metaTags.push(`<meta name="twitter:image:alt" content="${escapeHtml(title || siteName)}">`);

  // Combine all tags
  const metaBlock = metaTags.join('\n  ');

  // Find </head> and insert before it
  const headEndIndex = html.toLowerCase().lastIndexOf('</head>');

  if (headEndIndex !== -1) {
    // Check if we already have og:image
    if (html.includes('og:image') || html.includes('twitter:card')) {
      // Update existing tags
      return updateExistingSocialTags(html, metaTags);
    }

    return html.slice(0, headEndIndex) + '\n  ' + metaBlock + html.slice(headEndIndex);
  }

  // Fallback: append to end
  return html + '\n' + metaBlock;
}

/**
 * Update existing social tags in HTML
 */
function updateExistingSocialTags(html, newTags) {
  let result = html;

  for (const tag of newTags) {
    const matcher = tag.match(/<meta ([^>]+)>/);
    if (!matcher) continue;

    const attrs = matcher[1];
    const propertyMatch = attrs.match(/property="([^"]+)"/);
    const nameMatch = attrs.match(/name="([^"]+)"/);

    if (propertyMatch) {
      const property = propertyMatch[1];
      const regex = new RegExp(`<meta property="${property}"[^>]*>`, 'gi');
      result = result.replace(regex, tag);
    } else if (nameMatch) {
      const name = nameMatch[1];
      const regex = new RegExp(`<meta name="${name}"[^>]*>`, 'gi');
      result = result.replace(regex, tag);
    }
  }

  return result;
}

/**
 * Escape HTML special characters
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

/**
 * Generate complete social meta tags block
 */
function generateSocialMetaTags(pageMeta, ogImageUrl) {
  const {
    title = '',
    description = '',
    siteName = '',
    type = 'website'
  } = pageMeta || {};

  if (!ogImageUrl) {
    throw new Error('ogImageUrl is required');
  }

  return [
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}">`,
    `<meta property="og:type" content="${escapeHtml(type)}">`,
    `<meta property="og:image" content="${escapeHtml(ogImageUrl)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${escapeHtml(title || siteName)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">`,
    `<meta name="twitter:image:alt" content="${escapeHtml(title || siteName)}">`
  ].join('\n  ');
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // OG Image generation
  generateOGImageSVG,
  saveOGImageSVG,

  // Meta tags
  injectSocialMetaTags,
  generateSocialMetaTags,

  // Archetypes
  DESIGN_DNA_ARCHETYPES,
  getTypographyStyle,
  getTextColor,

  // Utilities
  escapeSvgText,
  escapeHtml,
  truncateText,
  wrapText,
  calculateFontSize,

  // For testing
  _test: {
    generateOGImageSVG,
    injectSocialMetaTags,
    generateSocialMetaTags,
    DESIGN_DNA_ARCHETYPES,
    escapeSvgText,
    escapeHtml,
    getTypographyStyle,
    getTextColor,
    generateSvgBackground,
    generateDecorativeElements,
    generateBorder
  }
};

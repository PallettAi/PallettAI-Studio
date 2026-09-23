// ============================================================
// PallettAI Studio — Dynamic OpenGraph Social Card Generator
// Renders branded 1200x630 og-image.png cards using Node Canvas
// or SVG-to-PNG fallback, matching the project's Design DNA.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// Helpers
// ============================================================

/**
 * Escape string for XML/HTML output
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

// Try to load Node Canvas
let canvas = null;
let loadError = null;

try {
  // eslint-disable-next-line global-require
  canvas = require('canvas');
} catch (e) {
  loadError = e;
}

// ============================================================
// Color Utilities
// ============================================================

/**
 * Parse CSS color string to RGB object
 */
function parseColor(color) {
  if (!color) return { r: 0, g: 0, b: 0 };

  // Handle named colors (basic set for common brand colors)
  const namedColors = {
    white: { r: 255, g: 255, b: 255 },
    black: { r: 0, g: 0, b: 0 },
    red: { r: 255, g: 0, b: 0 },
    green: { r: 0, g: 128, b: 0 },
    blue: { r: 0, g: 0, b: 255 },
    yellow: { r: 255, g: 255, b: 0 },
    orange: { r: 255, g: 165, b: 0 },
    purple: { r: 128, g: 0, b: 128 },
    pink: { r: 255, g: 192, b: 203 },
    gray: { r: 128, g: 128, b: 128 },
    grey: { r: 128, g: 128, b: 128 },
    silver: { r: 192, g: 192, b: 192 },
    maroon: { r: 128, g: 0, b: 0 },
    navy: { r: 0, g: 0, b: 128 },
    teal: { r: 0, g: 128, b: 128 },
    olive: { r: 128, g: 128, b: 0 },
    lime: { r: 0, g: 255, b: 0 },
    aqua: { r: 0, g: 255, b: 255 },
    fuchsia: { r: 255, g: 0, b: 255 },
    transparent: { r: 0, g: 0, b: 0, a: 0 }
  };

  const lowerColor = color.toLowerCase().trim();

  // Check named colors
  if (namedColors[lowerColor]) {
    return namedColors[lowerColor];
  }

  // Parse hex colors
  const hexMatch = lowerColor.match(/^#?([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16)
    };
  }

  // Parse hex with alpha
  const hexAlphaMatch = lowerColor.match(/^#?([0-9a-f]{8})$/i);
  if (hexAlphaMatch) {
    const hex = hexAlphaMatch[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255
    };
  }

  // Parse rgba/rgb
  const rgbaMatch = lowerColor.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3])
    };
  }

  // Default to black
  return { r: 0, g: 0, b: 0 };
}

/**
 * Blend two colors
 */
function blendColors(color1, color2, ratio = 0.5) {
  const c1 = parseColor(color1);
  const c2 = parseColor(color2);

  return {
    r: Math.round(c1.r * (1 - ratio) + c2.r * ratio),
    g: Math.round(c1.g * (1 - ratio) + c2.g * ratio),
    b: Math.round(c1.b * (1 - ratio) + c2.b * ratio)
  };
}

/**
 * Get contrasting text color (black or white based on luminance)
 */
function getContrastColor(backgroundColor) {
  const bg = parseColor(backgroundColor);
  // Calculate luminance (perceived brightness)
  const luminance = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255;

  // Return black for light backgrounds, white for dark backgrounds
  return luminance > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
}

/**
 * Create a color gradient string (for canvas)
 */
function createGradient(ctx, color1, color2, vertical = true) {
  if (!canvas) return null;

  const grad = vertical
    ? ctx.createLinearGradient(0, 0, 0, 630)
    : ctx.createLinearGradient(0, 0, 1200, 0);

  grad.addColorStop(0, typeof color1 === 'string' ? color1 : `rgb(${color1.r},${color1.g},${color1.b})`);
  grad.addColorStop(1, typeof color2 === 'string' ? color2 : `rgb(${color2.r},${color2.g},${color2.b})`);

  return grad;
}

// ============================================================
// Text Rendering Utilities
// ============================================================

/**
 * Calculate font size to fit text within bounds
 */
function calculateFontSize(text, maxWidth, maxHeight, fontFamily = 'Arial', minFontSize = 12, maxFontSize = 120, lineHeight = 1.2) {
  if (!canvas) return { fontSize: 24, lines: [text], height: 48 };

  // Start with a large font and reduce until it fits
  let fontSize = maxFontSize;

  while (fontSize > minFontSize) {
    const ctx = canvas.createCanvas(1, 1).getContext('2d');
    ctx.font = `${fontSize}px ${fontFamily}`;

    // Measure text
    const metrics = ctx.measureText(text);

    // Calculate number of lines needed
    const charWidth = metrics.width / text.length || fontSize * 0.5;
    const charsPerLine = Math.floor(maxWidth / charWidth);
    const lines = Math.ceil(text.length / charsPerLine);

    const totalHeight = lines * fontSize * lineHeight;

    if (totalHeight <= maxHeight && metrics.width <= maxWidth) {
      return { fontSize, lines: splitTextToLines(text, charsPerLine, fontFamily, fontSize), height: totalHeight, charsPerLine };
    }

    fontSize -= 2;
  }

  // Fallback: fit with minimum size
  const ctx = canvas.createCanvas(1, 1).getContext('2d');
  ctx.font = `${minFontSize}px ${fontFamily}`;
  const metrics = ctx.measureText(text);
  const charWidth = metrics.width / text.length || minFontSize * 0.5;
  const charsPerLine = Math.floor(maxWidth / charWidth);
  const lines = Math.ceil(text.length / charsPerLine);

  return {
    fontSize: minFontSize,
    lines: splitTextToLines(text, charsPerLine || 1, fontFamily, minFontSize),
    height: lines * minFontSize * lineHeight,
    charsPerLine
  };
}

/**
 * Split text into lines that fit within character limit
 */
function splitTextToLines(text, maxCharsPerLine, fontFamily, fontSize) {
  if (!maxCharsPerLine || maxCharsPerLine < 1) return [text];

  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      // If a single word is longer than maxCharsPerLine, split it
      if (word.length > maxCharsPerLine) {
        for (let i = 0; i < word.length; i += maxCharsPerLine) {
          lines.push(word.slice(i, i + maxCharsPerLine));
        }
        currentLine = '';
      } else {
        currentLine = word;
      }
    }
  }

  if (currentLine) lines.push(currentLine);

  return lines;
}

// ============================================================
// Drawing Functions
// ============================================================

/**
 * Draw a rounded rectangle on canvas
 */
function drawRoundRect(ctx, x, y, width, height, radius) {
  if (!canvas) return;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Draw text with optional drop shadow
 */
function drawText(ctx, text, x, y, options = {}) {
  const {
    fontSize = 24,
    fontFamily = 'Arial',
    color = '#000000',
    align = 'center',
    baseline = 'middle',
    shadow = false,
    shadowColor = 'rgba(0,0,0,0.3)',
    shadowBlur = 4,
    shadowOffsetX = 2,
    shadowOffsetY = 2
  } = options;

  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.font = `${fontSize}px ${fontFamily}`;

  if (shadow) {
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = shadowOffsetX;
    ctx.shadowOffsetY = shadowOffsetY;
  }

  ctx.fillStyle = color;
  ctx.fillText(text, x, y);

  // Reset shadow
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * Draw a logo image or create a placeholder
 */
function drawLogo(ctx, logoPath, x, y, width, height, fallbackColor = '#333333') {
  if (!canvas) return null;

  try {
    // Try to load the image
    if (logoPath && fs.existsSync(logoPath)) {
      const image = canvas.loadImage(logoPath);
      ctx.drawImage(image, x, y, width, height);
      return true;
    }
  } catch (e) {
    // Fall back to placeholder
    console.warn('[SocialCard] Could not load logo:', e.message);
  }

  // Draw a stylized placeholder logo
  const padding = 4;
  const text = 'P'; // Initial or brand letter

  // Background circle
  ctx.beginPath();
  ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2 - padding, 0, Math.PI * 2);
  ctx.fillStyle = fallbackColor;
  ctx.fill();

  // Letter
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${height * 0.6}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + width / 2, y + height / 2);

  return false;
}

// ============================================================
// Social Card Rendering
// ============================================================

/**
 * Main function to render a social preview card
 *
 * @param {Object} projectSchema - Project schema with branding info
 * @param {Object} projectSchema.brand - Brand configuration
 * @param {Object} projectSchema.brand.primaryColor - Primary brand color
 * @param {Object} projectSchema.brand.secondaryColor - Secondary brand color
 * @param {Object} projectSchema.brand.textColor - Text color
 * @param {Object} projectSchema.brand.logo - Logo image path or URL
 * @param {Object} projectSchema.brand.font - Font family
 * @param {string} projectSchema.headline - Main headline for card
 * @param {string} projectSchema.subheadline - Subheadline/supporting text
 * @param {string} projectSchema.tagline - Tagline
 * @param {Object} options - Rendering options
 * @param {string} options.outputPath - Path to save the image
 * @param {number} options.width - Card width (default: 1200)
 * @param {number} options.height - Card height (default: 630)
 * @param {string} options.cardStyle - Visual style preset
 * @returns {Promise<Object>} Rendering result
 */
async function renderSocialPreviewCard(projectSchema, options = {}) {
  const {
    brand = {},
    headline = 'PallettAI Studio',
    subheadline = '',
    tagline = '',
    description = ''
  } = projectSchema;

  const {
    outputPath = 'assets/og-image.png',
    width = 1200,
    height = 630,
    cardStyle = 'modern'
  } = options;

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    try {
      fs.mkdirSync(outputDir, { recursive: true });
    } catch (e) {
      return {
        success: false,
        error: `Failed to create output directory: ${e.message}`,
        path: null
      };
    }
  }

  // Check if canvas is available
  if (!canvas) {
    // Fall back to SVG generation
    return generateSvgFallback(projectSchema, options);
  }

  try {
    // Create canvas
    const img = canvas.createCanvas(width, height);
    const ctx = img.getContext('2d');

    // Parse colors
    const primaryColor = parseColor(brand.primaryColor || '#2563EB'); // Default blue
    const secondaryColor = parseColor(brand.secondaryColor || '#1E40AF'); // Darker blue
    const textColor = parseColor(brand.textColor || getContrastColor(brand.primaryColor));
    const backgroundColor = parseColor(brand.backgroundColor || '#FFFFFF');

    // Apply card style
    applyCardStyle(ctx, cardStyle, width, height, primaryColor, secondaryColor, backgroundColor);

    // Draw background
    drawBackground(ctx, width, height, brand, cardStyle);

    // Draw decorative elements
    drawDecorativeElements(ctx, width, height, brand, cardStyle);

    // Draw logo
    const logoSize = Math.min(height * 0.2, 180);
    const logoX = Math.min(80, width * 0.07);
    const logoY = Math.min(60, height * 0.1);

    if (brand.logo) {
      drawLogo(ctx, brand.logo, logoX, logoY, logoSize, logoSize, brand.primaryColor || '#333333');
    } else {
      // Draw text-based logo/brand mark
      drawBrandMark(ctx, brand.brandName || headline, logoX, logoY, logoSize, logoSize, textColor, brand);
    }

    // Calculate text positions
    const textAreaTop = Math.min(logoSize + 60, height * 0.35);
    const textAreaLeft = Math.min(80, width * 0.07);
    const textAreaWidth = width - textAreaLeft * 2;
    const textAreaHeight = height - textAreaTop - Math.min(80, height * 0.13);

    // Draw headline
    const headlineResult = calculateFontSize(
      headline,
      textAreaWidth,
      textAreaHeight * 0.5,
      brand.font || 'Arial',
      24,
      72,
      1.1
    );

    drawTextWithGradient(ctx, headlineResult.lines.join('\n'),
      width / 2,
      textAreaTop + (textAreaHeight * 0.5 * headlineResult.height / textAreaHeight) / 2,
      {
        fontSize: headlineResult.fontSize,
        fontFamily: brand.font || 'Arial',
        color: typeof textColor === 'string' ? textColor : `rgb(${textColor.r},${textColor.g},${textColor.b})`,
        align: 'center',
        shadow: true,
        shadowColor: 'rgba(0,0,0,0.4)'
      }
    );

    // Draw subheadline
    if (subheadline || tagline || description) {
      const subText = subheadline || tagline || description;
      const subFontSize = Math.min(28, headlineResult.fontSize * 0.5);
      const subColor = blendColors(primaryColor, textColor, 0.5);

      drawText(ctx, subText,
        width / 2,
        textAreaTop + headlineResult.height / 2 + 40,
        {
          fontSize: subFontSize,
          fontFamily: (brand.font || 'Arial').replace(/Bold|Black/i, '') + ' Italic',
          color: typeof subColor === 'string' ? subColor : `rgb(${subColor.r},${subColor.g},${subColor.b})`,
          align: 'center',
          shadow: true
        }
      );
    }

    // Draw bottom branding bar
    drawBottomBar(ctx, width, height, brand, primaryColor);

    // Draw subtle border
    drawBorder(ctx, width, height, primaryColor, 6);

    // Save the image
    const buffer = img.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);

    return {
      success: true,
      path: path.resolve(outputPath),
      width,
      height,
      fileSize: buffer.length
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      path: null
    };
  }
}

/**
 * Apply card style preset
 */
function applyCardStyle(ctx, style, width, height, primary, secondary, background) {
  // Styles can be extended - this is a base implementation
  switch (style) {
    case 'minimal':
      // Clean, simple background
      break;
    case 'vibrant':
      // More dynamic with gradients
      break;
    case 'dark':
      // Dark theme
      break;
    case 'modern':
    default:
      // Default modern style - handled in drawBackground
      break;
  }
}

/**
 * Draw background based on brand and style
 */
function drawBackground(ctx, width, height, brand, style) {
  const primaryColor = brand.primaryColor || '#2563EB';

  // Solid background or gradient
  if (brand.useGradient && brand.secondaryColor) {
    const gradient = ctx.createLinearGradient(0, 0, width * 0.4, height);
    gradient.addColorStop(0, primaryColor);
    gradient.addColorStop(1, brand.secondaryColor);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = primaryColor;
  }

  ctx.fillRect(0, 0, width, height);
}

/**
 * Draw decorative elements (geometric shapes, patterns)
 */
function drawDecorativeElements(ctx, width, height, brand, style) {
  const primaryColor = parseColor(brand.primaryColor || '#2563EB');
  const secondaryColor = parseColor(brand.secondaryColor || '#1E40AF');

  // Draw subtle geometric accent in top-right corner
  ctx.globalAlpha = 0.15;

  // Circle
  ctx.beginPath();
  ctx.arc(width - 200, 150, 120, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${secondaryColor.r},${secondaryColor.g},${secondaryColor.b})`;
  ctx.fill();

  // Small squares pattern
  const squareSize = 30;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 3; j++) {
      const x = width - 250 + i * (squareSize + 15);
      const y = 280 + j * (squareSize + 15);
      ctx.fillRect(x, y, squareSize, squareSize);
    }
  }

  ctx.globalAlpha = 1.0;

  // Draw an accent line
  ctx.strokeStyle = `rgb(${primaryColor.r},${primaryColor.g},${primaryColor.b})`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(80, height - 100);
  ctx.lineTo(width - 80, height - 100);
  ctx.stroke();
}

/**
 * Draw brand mark (text-based logo when no image available)
 */
function drawBrandMark(ctx, brandName, x, y, width, height, color, brand) {
  const fontSize = Math.min(height * 0.5, 60);
  const primaryColor = parseColor(brand.primaryColor || '#2563EB');

  // Background circle
  ctx.beginPath();
  ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
  ctx.fillStyle = `rgb(${primaryColor.r},${primaryColor.g},${primaryColor.b})`;
  ctx.fill();

  // Brand initial or name
  ctx.fillStyle = color ? `rgb(${color.r},${color.g},${color.b})` : '#FFFFFF';
  ctx.font = `bold ${fontSize}px ${brand.font || 'Arial'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Use first letter or brand name
  const displayText = brandName.substring(0, 2).toUpperCase();
  ctx.fillText(displayText, x + width / 2, y + height / 2 + 2);
}

/**
 * Draw text with gradient overlay
 */
function drawTextWithGradient(ctx, text, x, y, options) {
  if (!canvas) return;

  const {
    fontSize = 32,
    fontFamily = 'Arial',
    color = '#000000',
    gradientColors = null,
    align = 'center'
  } = options;

  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.font = `${fontSize}px ${fontFamily}`;

  if (gradientColors) {
    // Create gradient for text
    const gradient = ctx.createLinearGradient(0, y - fontSize, 0, y + fontSize);
    gradient.addColorStop(0, gradientColors[0]);
    gradient.addColorStop(1, gradientColors[1]);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = color;
  }

  ctx.fillText(text, x, y);
}

/**
 * Draw bottom branding bar
 */
function drawBottomBar(ctx, width, height, brand, primaryColor) {
  // Semi-transparent bar at bottom
  const barHeight = Math.min(80, height * 0.13);
  const barY = height - barHeight;

  ctx.globalAlpha = 0.9;
  ctx.fillStyle = `rgb(${primaryColor.r},${primaryColor.g},${primaryColor.b})`;
  ctx.fillRect(0, barY, width, barHeight);

  ctx.globalAlpha = 1.0;

  // Text in the bar
  const text = brand.brandName || 'PallettAI Studio';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${barHeight * 0.4}px ${brand.font || 'Arial'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, barY + barHeight / 2);
}

/**
 * Draw border around card
 */
function drawBorder(ctx, width, height, color, borderWidth = 4) {
  const parsedColor = parseColor(color);

  ctx.strokeStyle = `rgb(${parsedColor.r},${parsedColor.g},${parsedColor.b})`;
  ctx.lineWidth = borderWidth;
  ctx.strokeRect(
    borderWidth / 2,
    borderWidth / 2,
    width - borderWidth,
    height - borderWidth
  );
}

/**
 * SVG fallback for card generation
 * Creates a stand-alone SVG and returns it or converts to PNG
 */
function generateSvgFallback(projectSchema, options = {}) {
  const {
    brand = {},
    headline = 'PallettAI Studio',
    subheadline = '',
    tagline = ''
  } = projectSchema;

  const {
    width = 1200,
    height = 630,
    outputPath = 'assets/og-image.svg'
  } = options;

  const primaryColor = brand.primaryColor || '#2563EB';
  const textColor = '#FFFFFF';

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Build SVG content
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="40%" y2="100%">
      <stop offset="0%" style="stop-color:${primaryColor};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${brand.secondaryColor || primaryColor};stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#bgGradient)" />

  <!-- Decorative circles -->
  <circle cx="${width - 200}" cy="150" r="120" fill="${brand.secondaryColor || primaryColor}" opacity="0.2" />

  <!-- Accent line -->
  <line x1="80" y1="${height - 100}" x2="${width - 80}" y2="${height - 100}" stroke="${primaryColor}" stroke-width="4" />

  <!-- Logo placeholder -->
  <circle cx="120" cy="100" r="50" fill="${primaryColor}" />
  <text x="120" y="105" font-family="Arial" font-size="32" font-weight="bold" fill="${textColor}" text-anchor="middle">${brand.brandName ? brand.brandName.charAt(0).toUpperCase() : 'P'}</text>

  <!-- Headline -->
  <text x="${width / 2}" y="${height * 0.4}" font-family="${brand.font || 'Arial'}" font-size="48" font-weight="bold" fill="${textColor}" text-anchor="middle">${escapeXml(headline)}</text>

  <!-- Subheadline -->
  ${subheadline || tagline ? `<text x="${width / 2}" y="${height * 0.5}" font-family="${brand.font || 'Arial'}" font-size="24" font-style="italic" fill="${textColor}" text-anchor="middle" opacity="0.9">${escapeXml(subheadline || tagline)}</text>` : ''}

  <!-- Bottom bar -->
  <rect y="${height - 80}" width="${width}" height="80" fill="${primaryColor}" opacity="0.9" />
  <text x="${width / 2}" y="${height - 40}" font-family="${brand.font || 'Arial'}" font-size="28" font-weight="bold" fill="${textColor}" text-anchor="middle">${escapeXml(brand.brandName || 'PallettAI Studio')}</text>
</svg>`;

  // Write SVG file
  fs.writeFileSync(outputPath, svg, 'utf8');

  // Try to convert to PNG if canvas is available (for a real fallback)
  if (canvas) {
    try {
      const pngPath = outputPath.replace(/\.svg$/, '.png');
      const img = canvas.loadImage(outputPath);
      const pngCanvas = canvas.createCanvas(width, height);
      const ctx = pngCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      fs.writeFileSync(pngPath, pngCanvas.toBuffer('image/png'));
      return {
        success: true,
        path: path.resolve(pngPath),
        format: 'png',
        fromSvg: true
      };
    } catch (e) {
      // Return SVG path if PNG conversion fails
      return {
        success: true,
        path: path.resolve(outputPath),
        format: 'svg',
        fromSvg: true
      };
    }
  }

  return {
    success: true,
    path: path.resolve(outputPath),
    format: 'svg',
    fromSvg: true
  };
}

// ============================================================
// Meta Tag Injection
// ============================================================

/**
 * Inject og:image and twitter:card meta tags into HTML
 *
 * @param {string} html - HTML content
 * @param {string} ogImagePath - Path to the og-image.png (relative to HTML file)
 * @param {Object} projectSchema - Schema with site info for additional meta
 * @returns {string} HTML with meta tags injected
 */
function injectSocialMetaTags(html, ogImagePath, projectSchema = {}) {
  const {
    title = '',
    description = '',
    siteName = 'PallettAI Studio'
  } = projectSchema;

  // Check if og:image already exists
  if (html.includes('property="og:image"')) {
    // Update existing og:image
    html = html.replace(
      /<meta property="og:image" content="[^"]*"/i,
      `<meta property="og:image" content="${escapeXml(ogImagePath)}"`
    );
  } else {
    // Add new og:image tag
    html = injectMetaTag(html, 'og:image', ogImagePath);
  }

  // Inject/Update twitter:card
  if (html.includes('name="twitter:card"')) {
    html = html.replace(
      /<meta name="twitter:card" content="[^"]*"/i,
      '<meta name="twitter:card" content="summary_large_image"'
    );
  } else {
    html = injectMetaTag(html, 'twitter:card', 'summary_large_image');
  }

  // Add other OpenGraph meta if not present
  if (title && !html.includes('property="og:title"')) {
    html = injectMetaTag(html, 'og:title', title);
  }

  if (description && !html.includes('property="og:description"')) {
    html = injectMetaTag(html, 'og:description', description);
  }

  if (siteName && !html.includes('property="og:site_name"')) {
    html = injectMetaTag(html, 'og:site_name', siteName);
  }

  if (!html.includes('name="twitter:title"') && title) {
    html = injectMetaTag(html, 'twitter:title', title);
  }

  if (!html.includes('name="twitter:description"') && description) {
    html = injectMetaTag(html, 'twitter:description', description);
  }

  return html;
}

/**
 * Inject a single meta tag into HTML head
 */
function injectMetaTag(html, property, content) {
  // Look for closing </head> tag
  const headEnd = html.toLowerCase().lastIndexOf('</head>');

  if (headEnd === -1) {
    // No head tag found, append to end
    return `${html}\n<meta property="${property}" content="${escapeXml(content)}">`;
  }

  const metaTag = `<meta property="${property}" content="${escapeXml(content)}">`;

  // Insert before </head>
  return `${html.slice(0, headEnd)}\n  ${metaTag}${html.slice(headEnd)}`;
}

/**
 * Generate complete set of social meta tags
 */
function generateSocialMetaTags(projectSchema) {
  const {
    title = '',
    description = '',
    siteName = 'PallettAI Studio',
    ogImage = '',
    imageWidth = 1200,
    imageHeight = 630
  } = projectSchema;

  const tags = [];

  // OpenGraph
  tags.push(`<meta property="og:title" content="${escapeXml(title)}">`);
  tags.push(`<meta property="og:description" content="${escapeXml(description)}">`);
  tags.push(`<meta property="og:site_name" content="${escapeXml(siteName)}">`);
  tags.push(`<meta property="og:image" content="${escapeXml(ogImage)}">`);
  tags.push(`<meta property="og:image:width" content="${imageWidth}">`);
  tags.push(`<meta property="og:image:height" content="${imageHeight}">`);
  tags.push(`<meta property="og:image:alt" content="${escapeXml(title || siteName)}">`);
  tags.push(`<meta property="og:type" content="website">`);

  // Twitter Card
  tags.push(`<meta name="twitter:card" content="summary_large_image">`);
  tags.push(`<meta name="twitter:title" content="${escapeXml(title)}">`);
  tags.push(`<meta name="twitter:description" content="${escapeXml(description)}">`);
  tags.push(`<meta name="twitter:image" content="${escapeXml(ogImage)}">`);

  return tags.join('\n  ');
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Core rendering
  renderSocialPreviewCard,

  // Meta tag injection
  injectSocialMetaTags,
  generateSocialMetaTags,

  // Utility
  getEngineStatus: () => ({
    canvasAvailable: !!canvas,
    error: loadError ? loadError.message : null
  }),

  parseColor,
  blendColors,
  getContrastColor,
  calculateFontSize,

  // For testing
  _test: {
    parseColor,
    blendColors,
    getContrastColor,
    generateSvgFallback,
    injectSocialMetaTags,
    generateSocialMetaTags
  }
};

// ============================================================
// PallettAI Studio — EPUB & Print-Accessible Content Exporter
// Packages content into EPUB ebook format and generates
// print-optimized CSS for paper/PDF output.
// ============================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ============================================================
// EPUB Generation
// ============================================================

/**
 * Generate a minimal EPUB 3.0 file structure
 *
 * EPUB structure:
 * - mimetype (application/epub+zip)
 * - META-INF/container.xml
 * - OEBPS/content.opf
 * - OEBPS/styles.css
 * - OEBPS/cover.xhtml (optional)
 * - OEBPS/*.xhtml (content files)
 */
function generateEPUB(blogPosts, siteMeta = {}, options = {}) {
  const {
    title = 'Untitled Publication',
    author = '',
    publisher = '',
    coverImage = null,
    includeToc = true,
    language = 'en'
  } = { ...siteMeta, ...options };

  // Sort posts by date (newest first for blog, or by order)
  const sortedPosts = [...blogPosts].sort((a, b) => {
    const dateA = new Date(a.date || a.pubDate || a.createdAt || 0);
    const dateB = new Date(b.date || b.pubDate || b.createdAt || 0);
    return dateB - dateA; // Newest first
  });

  // Build EPUB structure
  const epub = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': generateContainerXml(),
    'OEBPS/content.opf': generateContentOpf(title, author, publisher, sortedPosts, language),
    'OEBPS/styles.css': generateEpubStyles(),
    'OEBPS/toc.xhtml': includeToc ? generateTocXhtml(sortedPosts) : '',
    'OEBPS/cover.xhtml': coverImage ? generateCoverXhtml(title, author, coverImage) : '',
    'OEBPS/nav.xhtml': generateNavXhtml(sortedPosts)
  };

  // Add content files for each post
  sortedPosts.forEach((post, index) => {
    const fileName = `content-${index + 1}.xhtml`;
    epub[`OEBPS/${fileName}`] = generateContentXhtml(post, index + 1);
  });

  return epub;
}

/**
 * Generate mimetype file content
 */
function generateMimeType() {
  return 'application/epub+zip';
}

/**
 * Generate META-INF/container.xml
 */
function generateContainerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

/**
 * Generate content.opf metadata
 */
function generateContentOpf(title, author, publisher, posts, language) {
  const now = new Date().toISOString();

  let metadataXml = '';
  metadataXml += `<meta title="${escapeXmlAttribute(title)}" />`;
  if (author) {
    metadataXml += `<meta author="${escapeXmlAttribute(author)}" />`;
  }
  if (publisher) {
    metadataXml += `<meta publisher="${escapeXmlAttribute(publisher)}" />`;
  }
  metadataXml += `<meta date="${now}" />`;

  // Build item references
  let manifestItems = '';
  let spineItems = '';

  // Cover image if present
  manifestItems += `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`;

  // CSS
  manifestItems += `<item id="styles" href="styles.css" media-type="text/css"/>`;

  // Table of contents
  manifestItems += `<item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="title-type" />`;

  // Navigation
  manifestItems += `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />`;

  let itemIndex = 1;
  const contentHrefs = [];

  for (const post of posts) {
    const fileName = `content-${itemIndex}.xhtml`;
    contentHrefs.push(fileName);

    manifestItems += `<item id="content-${itemIndex}" href="${fileName}" media-type="application/xhtml+xml"/>`;

    // Add to spine
    spineItems += `<itemref idref="content-${itemIndex}"/>\n`;

    itemIndex++;
  }

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(title)}</dc:title>
    ${author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : ''}
    ${publisher ? `<dc:publisher>${escapeXml(publisher)}</dc:publisher>` : ''}
    <dc:date>${now}</dc:date>
    <dc:language>${language}</dc:language>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifestItems}
  </manifest>
  <spine toc="ncx">
    ${spineItems}
  </spine>
</package>`;

  return opf;
}

/**
 * Generate EPUB stylesheet
 */
function generateEpubStyles() {
  return `/* EPUB Stylesheet */
body {
  font-family: serif;
  font-size: 12pt;
  line-height: 1.6;
  color: #000;
  background-color: #fff;
  margin: 0;
  padding: 20pt;
}

h1, h2, h3, h4, h5, h6 {
  font-family: sans-serif;
  color: #333;
  margin-top: 24pt;
  margin-bottom: 12pt;
  page-break-after: avoid;
}

p {
  margin-bottom: 12pt;
  text-align: justify;
}

a {
  color: #0066cc;
  text-decoration: underline;
}

img {
  max-width: 100%;
  height: auto;
}

blockquote {
  margin-left: 20pt;
  margin-right: 20pt;
  font-style: italic;
  color: #666;
}

pre {
  font-family: monospace;
  background-color: #f5f5f5;
  padding: 10pt;
  white-space: pre-wrap;
  word-wrap: break-word;
}

code {
  font-family: monospace;
  font-size: 10pt;
  background-color: #f5f5f5;
  padding: 2pt 4pt;
}

hr {
  border: none;
  border-top: 1px solid #ccc;
  margin: 24pt 0;
}

/* Page breaks */
.page-break {
  page-break-before: always;
}

/* Cover page styling */
.cover {
  text-align: center;
  padding-top: 30%;
}

.cover h1 {
  font-size: 28pt;
  margin-bottom: 20pt;
}

.cover .author {
  font-size: 16pt;
  color: #666;
}
`;
}

/**
 * Generate TOC XHTML
 */
function generateTocXhtml(posts) {
  let html = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Table of Contents</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <h1>Table of Contents</h1>
  <nav>
    <ol>
`;

  posts.forEach((post, index) => {
    const title = post.title || `Post ${index + 1}`;
    const id = `post-${index + 1}`;
    html += `      <li><a href="content-${index + 1}.xhtml#${id}">${escapeXml(title)}</a></li>\n`;
  });

  html += `
    </ol>
  </nav>
</body>
</html>`;

  return html;
}

/**
 * Generate navigation XHTML (for EPUB 3)
 */
function generateNavXhtml(posts) {
  let html = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8">
  <title>Navigation</title>
</head>
<body>
  <nav>
    <ol>
`;

  posts.forEach((post, index) => {
    const title = post.title || `Post ${index + 1}`;
    const id = `post-${index + 1}`;
    html += `      <li><a href="content-${index + 1}.xhtml#${id}">${escapeXml(title)}</a></li>\n`;
  });

  html += `
    </ol>
  </nav>
</body>
</html>`;

  return html;
}

/**
 * Generate cover XHTML
 */
function generateCoverXhtml(title, author, coverImage) {
  let coverContent = `<div class="cover">
  <h1>${escapeXml(title)}</h1>
  ${author ? `<p class="author">${escapeXml(author)}</p>` : ''}
</div>`;

  if (coverImage) {
    coverContent = `<div class="cover">
  <img src="${escapeXmlAttribute(coverImage)}" alt="Cover Image" style="max-width: 100%; height: auto;"/>
  <h1>${escapeXml(title)}</h1>
  ${author ? `<p class="author">${escapeXml(author)}</p>` : ''}
</div>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>Cover</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
  <meta name="cover" content="cover"/>
</head>
<body>
  ${coverContent}
</body>
</html>`;
}

/**
 * Generate content XHTML for a single post
 */
function generateContentXhtml(post, chapterNumber = 1) {
  const {
    title = 'Untitled',
    content = '',
    author = '',
    date = '',
    excerpt = ''
  } = post;

  const id = `post-${chapterNumber}`;

  let contentBody = '';

  if (content) {
    // Convert basic markdown-like formatting to HTML if needed
    contentBody = content;
  } else if (excerpt) {
    contentBody = `<p>${escapeXml(excerpt)}</p>`;
  } else {
    contentBody = '<p>No content available.</p>';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section id="${id}" class="chapter">
    <h1>${escapeXml(title)}</h1>
    ${author ? `<p class="author">By ${escapeXml(author)}</p>` : ''}
    ${date ? `<p class="date">${escapeXml(date)}</p>` : ''}
    <div class="content">
      ${contentBody}
    </div>
  </section>
</body>
</html>`;
}

/**
 * Create EPUB file from structure
 */
function createEpubFile(epubStructure, outputPath) {
  // EPUB is a ZIP file with specific structure
  const zip = require('adm-zip') || require('yazl') || null;

  if (!zip) {
    throw new Error('No ZIP library available. Install adm-zip or yazl.');
  }

  // Create zip file
  const archive = new zip.ZipFile();

  // Add mimetype first (must be first and uncompressed)
  archive.addBuffer(Buffer.from(epubStructure.mimetype), 'mimetype', { compress: false });

  // Add other files
  for (const [filePath, content] of Object.entries(epubStructure)) {
    if (filePath === 'mimetype' || !content) continue;

    archive.addBuffer(Buffer.from(content, 'utf8'), filePath);
  }

  // Write to file
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  archive.writeToFile(outputPath);

  return outputPath;
}

// ============================================================
// Print Styles Generation
// ============================================================

/**
 * Generate print-optimized CSS
 */
function generatePrintStyles(options = {}) {
  const {
    bodyFont = 'Georgia, serif',
    headingFont = 'Arial, sans-serif',
    baseFontSize = '12pt',
    lineHeight = '1.6',
    backgroundColor = '#ffffff',
    textColor = '#000000',
    linkColor = '#000000',
    removeElements = ['nav', 'header', 'footer', 'aside', '.no-print', '.social-share', '.comments'],
    showLinkUrls = true,
    pageBreakBefore = 'h1, h2'
  } = options;

  const css = `/* ============================================================
 * PallettAI Studio — Print Styles
 * Optimized for paper/PDF output
 * ============================================================ */

@media print {
  /* Page setup */
  @page {
    size: A4;
    margin: 2cm;
    margin-top: 2.5cm;
  }

  /* base styles */
  body {
    font-family: ${bodyFont};
    font-size: ${baseFontSize};
    line-height: ${lineHeight};
    color: ${textColor};
    background-color: ${backgroundColor};
    margin: 0;
    padding: 0;
  }

  /* Headings */
  h1, h2, h3, h4, h5, h6 {
    font-family: ${headingFont};
    color: ${textColor};
    page-break-after: avoid;
    page-break-inside: avoid;
  }

  h1 {
    font-size: 18pt;
    margin-top: 24pt;
    margin-bottom: 12pt;
    border-bottom: 2px solid ${textColor};
    padding-bottom: 6pt;
  }

  h2 {
    font-size: 14pt;
    margin-top: 18pt;
    margin-bottom: 10pt;
  }

  h3 {
    font-size: 12pt;
    margin-top: 14pt;
    margin-bottom: 8pt;
  }

  /* Paragraphs */
  p {
    margin-bottom: 10pt;
    text-align: justify;
    orphans: 3;
    widows: 3;
  }

  /* Links - show URLs when printing */
  ${showLinkUrls ? `a[href] {
    color: ${linkColor};
    text-decoration: none;
  }

  a[href]::after {
    content: " (" attr(href) ")";
    font-size: 9pt;
    color: #666;
  }

  a[href^="#"]::after,
  a[href^="mailto:"]::after,
  a[href^="tel:"]::after {
    content: "";
  }` : ''}

  /* Images */
  img {
    max-width: 100%;
    max-height: 400px;
    page-break-inside: avoid;
  }

  /* Remove elements */
  ${removeElements.map(el => `${el} { display: none !important; }`).join('\n  ')}

  /* Lists */
  ul, ol {
    margin-bottom: 10pt;
    padding-left: 20pt;
    page-break-inside: avoid;
  }

  li {
    margin-bottom: 4pt;
  }

  /* Tables */
  table {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 12pt;
    page-break-inside: avoid;
  }

  th, td {
    border: 1px solid #666;
    padding: 6pt;
    text-align: left;
  }

  th {
    background-color: #f0f0f0;
    font-weight: bold;
  }

  /* Quotes */
  blockquote {
    margin-left: 20pt;
    margin-right: 20pt;
    padding-left: 10pt;
    border-left: 3px solid #ccc;
    font-style: italic;
    color: #444;
  }

  /* Code */
  pre, code {
    font-family: 'Courier New', monospace;
    font-size: 9pt;
    background-color: #f5f5f5;
    page-break-inside: avoid;
  }

  pre {
    padding: 8pt;
    white-space: pre-wrap;
    word-wrap: break-word;
    border: 1px solid #ccc;
  }

  /* Horizontal rules */
  hr {
    border: none;
    border-top: 1px solid #999;
    margin: 18pt 0;
  }

  /* Force page breaks */
  ${pageBreakBefore} {
    page-break-before: always;
  }

  /* Avoid breaks inside content */
  .avoid-break {
    page-break-inside: avoid;
  }

  /* Cover page */
  .cover-page {
    page-break-after: always;
    text-align: center;
    padding-top: 30%;
  }

  .cover-page h1 {
    font-size: 24pt;
    margin-bottom: 20pt;
  }

  .cover-page .author {
    font-size: 14pt;
    color: #666;
  }

  /* Print-specific fixes */
  a {
    color: ${linkColor};
  }

  /* Hide elements that don't make sense in print */
  button, input, select, textarea {
    display: none !important;
  }

  /* Footnotes */
  .footnote {
    font-size: 9pt;
    color: #666;
  }
}
`.trim();

  return css;
}

/**
 * Inject print styles into HTML
 */
function injectPrintStyles(html, options = {}) {
  const css = generatePrintStyles(options);

  // Find head and inject before closing
  const headEndIndex = html.toLowerCase().lastIndexOf('</head>');

  if (headEndIndex !== -1) {
    return html.slice(0, headEndIndex) + '\n  <style>\n' + css + '\n  </style>' + html.slice(headEndIndex);
  }

  // Fallback: append before body
  const bodyStartIndex = html.toLowerCase().indexOf('<body');
  if (bodyStartIndex !== -1) {
    return html.slice(0, bodyStartIndex) + '<style>\n' + css + '\n</style>' + html.slice(bodyStartIndex);
  }

  // Last resort: append to end
  return html + '\n<style>\n' + css + '\n</style>';
}

/**
 * Escape XML attribute value
 */
function escapeXmlAttribute(value) {
  if (!value) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Escape XML
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

// ============================================================
// Export
// ============================================================

module.exports = {
  // EPUB generation
  generateEPUB,
  generateMimeType,
  generateContainerXml,
  generateContentOpf,
  generateEpubStyles,
  generateTocXhtml,
  generateNavXhtml,
  generateCoverXhtml,
  generateContentXhtml,
  createEpubFile,

  // Print styles
  generatePrintStyles,
  injectPrintStyles,

  // Utilities
  escapeXmlAttribute,
  escapeXml,

  // For testing
  _test: {
    generateEPUB,
    generateMimeType,
    generateContainerXml,
    generateContentOpf,
    generateEpubStyles,
    generateTocXhtml,
    generateNavXhtml,
    generateCoverXhtml,
    generateContentXhtml,
    generatePrintStyles,
    injectPrintStyles,
    escapeXmlAttribute,
    escapeXml
  }
};

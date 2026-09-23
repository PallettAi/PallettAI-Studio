// ============================================================
// PallettAI Studio — Markdown & Frontmatter Content Importer
// Parses .md/.mdx files with YAML frontmatter and converts
// to native PallettAI Studio layout section schemas.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// YAML Frontmatter Parsing (Simple, no external deps)
// ============================================================

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n/;

// Keys that would rewrite an object's prototype instead of adding a property.
// Frontmatter is untrusted input — an imported .md can come from anywhere — so
// a `__proto__:` line must never be able to reach Object.prototype. Without
// this guard, `result['__proto__']` read back as Object.prototype and the
// nested branch wrote straight into it, polluting every object in the process.
const UNSAFE_YAML_KEYS = ['__proto__', 'constructor', 'prototype'];

function isUnsafeYamlKey(key) {
  return UNSAFE_YAML_KEYS.indexOf(String(key).trim().toLowerCase()) !== -1;
}

/** Add an own property to a plain object without ever touching a prototype. */
function safeAssign(target, key, value) {
  const name = String(key).trim();
  if (!name || !target || isUnsafeYamlKey(name)) return target;
  Object.defineProperty(target, name, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
  return target;
}

/**
 * Read an own property that holds a plain object. A value inherited from the
 * prototype chain is never a valid container to write into.
 */
function ownObject(target, key) {
  if (!target || !Object.prototype.hasOwnProperty.call(target, key)) return null;
  const value = target[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * Parse YAML frontmatter from a string (basic implementation)
 * Supports simple key: value pairs and arrays
 */
function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterStr = match[1];
  const body = content.slice(match[0].length);

  const frontmatter = parseYamlFrontmatter(frontmatterStr);

  return { frontmatter, body };
}

/**
 * Basic YAML parser for frontmatter
 * Handles: key: value, key: value with colons, arrays (- item), nested objects
 */
function parseYamlFrontmatter(yamlStr) {
  if (!yamlStr || typeof yamlStr !== 'string') {
    return {};
  }

  const result = {};
  const lines = yamlStr.split('\n');
  let currentKey = null;
  let currentList = null;
  let inNestedObject = false;
  let nestedIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Detect indent level
    const indent = line.search(/\S/);

    // Handle list items
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();

      if (currentKey) {
        if (!Array.isArray(result[currentKey])) {
          result[currentKey] = [];
        }
        result[currentKey].push(parseYamlValue(value));
      }
      continue;
    }

    // Handle nested objects (indented key: value)
    if (indent > 0 && currentKey && !isUnsafeYamlKey(currentKey) && trimmed.includes(':')) {
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim();

      // currentKey is guaranteed safe by the guard below, and safeAssign
      // refuses a dangerous inner key, so neither step can reach a prototype.
      if (!ownObject(result, currentKey)) safeAssign(result, currentKey, {});
      safeAssign(result[currentKey], key, parseYamlValue(value));
      continue;
    }

    // Handle key: value
    if (line.includes(':')) {
      const colonIndex = line.indexOf(':');
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();

      // Check if value is a multi-line string (|- or >)
      if (value === '|-' || value === '>') {
        currentKey = key;
        currentList = null;
        inNestedObject = false;
        i++;
        let multiLineValue = '';

        while (i < lines.length) {
          const nextLine = lines[i];
          const nextTrimmed = nextLine.trim();

          if (!nextTrimmed || nextTrimmed.startsWith('#')) {
            i++;
            continue;
          }

          const nextIndent = nextLine.search(/\S/);
          if (nextIndent <= indent) {
            break;
          }

          multiLineValue += nextTrimmed + '\n';
          i++;
        }

        value = multiLineValue.trim();
        if (value.endsWith('\n')) {
          value = value.slice(0, -1);
        }
      }

      // Drop prototype-rewriting keys outright and stop treating them as the
      // container for the indented lines that follow.
      if (isUnsafeYamlKey(key)) {
        currentKey = null;
        currentList = null;
        inNestedObject = false;
        continue;
      }

      result[key] = parseYamlValue(value);
      currentKey = key;
      currentList = null;
      inNestedObject = false;
      continue;
    }

    // Handle array without dash (inline array [item1, item2])
    if (trimmed.startsWith('[') && trimmed.endsWith(']') && currentKey) {
      const arrayStr = trimmed.slice(1, -1);
      result[currentKey] = arrayStr.split(',').map(v => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      continue;
    }
  }

  return result;
}

/**
 * Parse YAML value to appropriate JavaScript type
 */
function parseYamlValue(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();

  // Boolean
  if (trimmed === 'true' || trimmed === 'yes') return true;
  if (trimmed === 'false' || trimmed === 'no') return false;

  // Null
  if (trimmed === 'null' || trimmed === '~') return null;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  // String (remove quotes if present)
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

// ============================================================
// Markdown to PallettAI Section Conversion
// ============================================================

/**
 * Convert markdown content to PallettAI Studio section schemas
 */
function convertMarkdownToSections(parsedData, options = {}) {
  const {
    basePath = '',
    imagePathMapper = null
  } = options;

  const { frontmatter, body } = parsedData;

  const sections = [];

  // Extract metadata from frontmatter
  const metadata = {
    title: frontmatter.title || frontmatter.Title || '',
    slug: frontmatter.slug || frontmatter.Slug ||
      frontmatter.path || frontmatter.url ||
      frontmatter.id ||
      body.slice(0, 50).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    date: frontmatter.date || frontmatter.Date || frontmatter.pubDate || frontmatter.published_at || '',
    author: frontmatter.author || frontmatter.Author || frontmatter.by || '',
    tags: frontmatter.tags || frontmatter.Tags || frontmatter.categories || frontmatter.Categories || [],
    description: frontmatter.description || frontmatter.Description || frontmatter.excerpt || frontmatter.Excerpt || '',
    image: frontmatter.image || frontmatter.Image || frontmatter.thumbnail || frontmatter.hero_image || '',
    readingTime: frontmatter.reading_time || frontmatter.readingTime || '',
    draft: frontmatter.draft || frontmatter.Draft || false
  };

  // Normalize tags to array
  if (!Array.isArray(metadata.tags) && metadata.tags) {
    metadata.tags = [metadata.tags];
  }

  // Create header section from frontmatter
  if (metadata.title) {
    sections.push(createHeaderSection(metadata, options));
  }

  // Parse markdown body into sections
  const parsedBlocks = parseMarkdownBody(body, options);

  for (const block of parsedBlocks) {
    const section = convertToPallettAISection(block, metadata, options);
    if (section) {
      sections.push(section);
    }
  }

  return {
    metadata,
    sections
  };
}

/**
 * Create header section from frontmatter metadata
 */
function createHeaderSection(metadata, options = {}) {
  const {
    title,
    author,
    description,
    image,
    date,
    readingTime
  } = metadata;

  return {
    type: 'header',
    variation: 'blog-hero',
    content: {
      title: title,
      subtitle: description,
      author: author,
      date: date,
      readingTime: readingTime,
      heroImage: image,
      showAuthor: !!author,
      showDate: !!date,
      showReadingTime: !!readingTime
    },
    settings: {
      backgroundColor: 'transparent',
      textAlign: 'center',
      padding: 'large'
    }
  };
}

/**
 * Parse markdown body into blocks
 */
function parseMarkdownBody(markdown, options = {}) {
  const blocks = [];
  const lines = markdown.split('\n');
  let currentBlock = null;
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines = [];
  let inList = false;
  let listItems = [];
  let inBlockquote = false;
  let blockquoteLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code block
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        // End of code block
        blocks.push({
          type: 'code',
          language: codeBlockLang,
          content: codeBlockLines.join('\n')
        });
        codeBlockLines = [];
        codeBlockLang = '';
        inCodeBlock = false;
      } else {
        // Start of code block
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      if (!inBlockquote) {
        inBlockquote = true;
        blockquoteLines = [];
      }
      blockquoteLines.push(trimmed.slice(1).trim());
      continue;
    }

    if (inBlockquote && !trimmed.startsWith('>')) {
      // End of blockquote
      if (blockquoteLines.length > 0) {
        blocks.push({
          type: 'blockquote',
          content: blockquoteLines.join('\n')
        });
      }
      blockquoteLines = [];
      inBlockquote = false;
    }

    // List items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
      if (!inList) {
        inList = true;
        listItems = [];
      }

      const listItem = {
        content: trimmed.replace(/^[-*]\s|^\d+\.\s/, ''),
        level: (line.match(/^(\s*)/)[1].length / 2)
      };

      // Check for nested content
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const nextTrimmed = nextLine.trim();

        if (nextTrimmed && !nextTrimmed.startsWith('-') &&
            !nextTrimmed.startsWith('*') && !/^\d+\.\s/.test(nextTrimmed) &&
            !nextTrimmed.startsWith('#') && !nextTrimmed.startsWith('```') &&
            !nextTrimmed.startsWith('>')) {
          listItem.content += ' ' + nextTrimmed;
          i = j;
          j++;
        } else {
          break;
        }
      }

      listItems.push(listItem);
      continue;
    }

    if (inList && trimmed) {
      // End of list
      blocks.push({
        type: 'list',
        ordered: /^\d+\.\s/.test(lines.find(l => l.includes(listItems[0]?.content))),
        items: listItems
      });
      listItems = [];
      inList = false;
    }

    // Headings
    if (trimmed.startsWith('#')) {
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const content = headingMatch[2].trim();

        // End any open blocks
        if (listItems.length > 0) {
          blocks.push({
            type: 'list',
            ordered: false,
            items: listItems
          });
          listItems = [];
          inList = false;
        }

        blocks.push({
          type: 'heading',
          level: level,
          content: content,
          id: slugify(content)
        });
      }
      continue;
    }

    // Paragraphs
    if (trimmed && !trimmed.startsWith('---') && !trimmed.startsWith('|')) {
      if (listItems.length > 0) {
        blocks.push({
          type: 'list',
          ordered: false,
          items: listItems
        });
        listItems = [];
        inList = false;
      }

      if (!currentBlock || currentBlock.type !== 'paragraph') {
        if (currentBlock) {
          blocks.push(currentBlock);
        }
        currentBlock = {
          type: 'paragraph',
          content: trimmed
        };
      } else {
        currentBlock.content += ' ' + trimmed;
      }
      continue;
    }

    // Empty line - end current block
    if (!trimmed && currentBlock) {
      blocks.push(currentBlock);
      currentBlock = null;
    }
  }

  // Push any remaining blocks
  if (currentBlock) {
    blocks.push(currentBlock);
  }

  if (listItems.length > 0) {
    blocks.push({
      type: 'list',
      ordered: false,
      items: listItems
    });
  }

  if (blockquoteLines.length > 0) {
    blocks.push({
      type: 'blockquote',
      content: blockquoteLines.join('\n')
    });
  }

  return blocks;
}

/**
 * Convert a parsed markdown block to a PallettAI section
 */
function convertToPallettAISection(block, metadata, options = {}) {
  const { basePath, imagePathMapper } = options;

  switch (block.type) {
    case 'heading':
      return {
        type: 'heading',
        variation: `h${block.level}`,
        content: {
          text: block.content,
          level: block.level,
          headingId: block.id
        },
        settings: {
          color: 'primary',
          spacing: 'medium'
        }
      };

    case 'paragraph':
      return {
        type: 'text',
        variation: 'paragraph',
        content: {
          text: formatInlineMarkdown(block.content),
          align: 'left'
        },
        settings: {
          backgroundColor: 'transparent',
          padding: 'small'
        }
      };

    case 'list':
      return {
        type: 'list',
        variation: block.ordered ? 'ordered' : 'unordered',
        content: {
          items: block.items.map(item => ({
            text: formatInlineMarkdown(item.content),
            level: item.level || 0
          }))
        },
        settings: {
          backgroundColor: 'transparent',
          padding: 'medium',
          listStyle: block.ordered ? 'decimal' : 'disc'
        }
      };

    case 'blockquote':
      return {
        type: 'quote',
        variation: 'blockquote',
        content: {
          text: formatInlineMarkdown(block.content),
          attribution: metadata.author || ''
        },
        settings: {
          backgroundColor: '#f8f8f8',
          borderColor: '#ddd',
          padding: 'medium'
        }
      };

    case 'code':
      return {
        type: 'code',
        variation: 'code-block',
        content: {
          code: block.content,
          language: block.language || 'text',
          filename: block.filename || ''
        },
        settings: {
          theme: 'dark',
          showLineNumbers: false,
          padding: 'medium'
        }
      };

    case 'image':
      // Handle images (could be from markdown ![alt](src) parsing)
      return {
        type: 'image',
        variation: 'full-width',
        content: {
          src: block.src || metadata.image,
          alt: block.alt || metadata.title,
          caption: block.caption || ''
        },
        settings: {
          backgroundColor: '#f5f5f5',
          padding: 'medium'
        }
      };

    default:
      return null;
  }
}

/**
 * Escape text destined for HTML element content.
 */
function escapeMarkdownHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate a URL taken from markdown before it becomes an href or src.
 *
 * Returns null for anything that is not a plain link, which matters most for
 * `javascript:`, `vbscript:` and non-image `data:` URIs: an imported .md is
 * untrusted input, and letting one of those through would turn a markdown file
 * into stored XSS on the built site.
 */
function safeMarkdownUrl(rawUrl) {
  const url = String(rawUrl === null || rawUrl === undefined ? '' : rawUrl).trim();
  if (!url) return null;

  // Browsers ignore control characters and whitespace when resolving a
  // scheme, so "java\tscript:" must be normalised before the scheme check.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(/[\u0000-\u0020\u007F]/g, ''));

  if (scheme) {
    const name = scheme[1].toLowerCase();
    const allowed = ['http', 'https', 'mailto', 'tel', 'ftp'];

    if (allowed.indexOf(name) === -1) {
      const isInlineImage = name === 'data' &&
        /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/i.test(url);
      if (!isInlineImage) return null;
    }
  }

  return url;
}

/**
 * Format inline markdown (bold, italic, code, links, images).
 *
 * Every captured fragment is escaped before it reaches the output, because
 * markdown is text, not HTML.
 */
function formatInlineMarkdown(text) {
  if (!text) return '';

  // Escape FIRST, then pattern-match.
  //
  // This is what makes the whole function safe rather than only the parts a
  // pattern happens to catch. Every markdown metacharacter this parser cares
  // about — [ ] ( ) * _ ` — survives HTML escaping untouched, so the patterns
  // still match, but raw HTML anywhere in the source is now inert. Escaping
  // per-match afterwards left anything the patterns did NOT match (and any
  // remainder after a URL like `](a)b)` stopped early) passing through raw.
  let out = escapeMarkdownHtml(text);

  // Images first: the link pattern below also matches the [alt](src) half of
  // ![alt](src), so running links first left a stray "!" and no <img> at all.
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    const safe = safeMarkdownUrl(url);
    if (!safe) return alt;
    return '<img src="' + safe + '" alt="' + alt + '" loading="lazy">';
  });

  // Links
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, url) => {
    const safe = safeMarkdownUrl(url);
    // A rejected URL degrades to plain text rather than a dead or hostile link.
    if (!safe) return label + ' (' + url + ')';
    return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  });

  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Inline code
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

  return out;
}

/**
 * Slugify text for IDs
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Remap image paths relative to base path
 */
function remapImagePath(src, basePath, mapper = null) {
  if (!src) return src;

  // If custom mapper provided, use it
  if (typeof mapper === 'function') {
    return mapper(src, basePath);
  }

  // Default: prepend base path
  if (basePath && !src.startsWith('http') && !src.startsWith('//')) {
    return `${basePath}/${src}`.replace(/\/+/g, '/');
  }

  return src;
}

// ============================================================
// File Parsing
// ============================================================

/**
 * Parse a markdown file (string content)
 */
function parseMarkdownFile(fileContent) {
  if (!fileContent || typeof fileContent !== 'string') {
    throw new Error('fileContent must be a string');
  }

  return parseFrontmatter(fileContent);
}

/**
 * Parse a markdown file from disk
 */
function parseMarkdownFileFromPath(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return parseMarkdownFile(content);
}

/**
 * Convert markdown file to PallettAI sections
 */
function importMarkdownAsSections(filePathOrContent, options = {}) {
  let parsedData;

  if (typeof filePathOrContent === 'string' && filePathOrContent.trim().startsWith('<')) {
    // It's content
    parsedData = parseMarkdownFile(filePathOrContent);
  } else if (typeof filePathOrContent === 'string') {
    // Assume it's a file path
    parsedData = parseMarkdownFileFromPath(filePathOrContent);

    // Set base path for image remapping
    if (!options.basePath && filePathOrContent) {
      options.basePath = path.dirname(filePathOrContent);
    }
  } else {
    throw new Error('Invalid input: expected markdown string or file path');
  }

  return convertMarkdownToSections(parsedData, options);
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Frontmatter parsing
  parseFrontmatter,
  parseYamlFrontmatter,
  parseMarkdownFile,

  // Markdown to sections
  convertMarkdownToSections,
  parseMarkdownBody,
  convertToPallettAISection,
  formatInlineMarkdown,

  // File operations
  parseMarkdownFileFromPath,
  importMarkdownAsSections,

  // Utilities
  slugify,
  remapImagePath,
  parseYamlValue,

  // For testing
  _test: {
    parseFrontmatter,
    parseYamlFrontmatter,
    parseYamlValue,
    convertMarkdownToSections,
    parseMarkdownBody,
    convertToPallettAISection,
    formatInlineMarkdown,
    slugify,
    importMarkdownAsSections
  }
};

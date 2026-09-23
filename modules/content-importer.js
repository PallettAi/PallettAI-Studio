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
    if (indent > 0 && currentKey && trimmed.includes(':')) {
      const [key, ...valueParts] = trimmed.split(':');
      const value = valueParts.join(':').trim();

      if (!result[currentKey]) {
        result[currentKey] = {};
      }

      result[currentKey][key.trim()] = parseYamlValue(value);
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
 * Format inline markdown (bold, italic, links, code)
 */
function formatInlineMarkdown(text) {
  if (!text) return '';

  // Bold
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Images (inline)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');

  return text;
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

// ============================================================
// PallettAI Studio — On-Device Local AI Engine
// Provides offline micro-task capabilities using @huggingface/transformers
// with graceful fallback to local rule-based heuristics.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Lazy-load transformers only when needed (avoids startup cost)
let transformers = null;
let pipeline = null;
let modelLoaded = false;
let modelLoadError = null;

// Content-type detection by magic bytes
const IMAGE_MAGIC = {
  jpeg: { offset: 0, bytes: [0xFF, 0xD8, 0xFF], test: 'jpeg' },
  png: { offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47], test: 'png' },
  gif: { offset: 0, bytes: [0x47, 0x49, 0x46], test: 'gif' },
  webp: { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46], test: 'webp' }, // RIFF...WEBP
  svg: { offset: 0, bytes: null, test: 'svg' } // Text-based detection
};

function matchesMagicBytes(buffer, magic) {
  if (!magic.bytes || magic.bytes.length === 0) return false;
  
  // Use absolute offset for magic byte detection
  if (buffer.length < magic.bytes.length) return false;
  
  for (let i = 0; i < magic.bytes.length; i++) {
    if (buffer[i] !== magic.bytes[i]) {
      return false;
    }
  }
  return true;
}

function matchesSvgText(buffer) {
  if (buffer.length < 4) return false;
  const start = buffer.toString('utf8', 0, 4);
  return start === '<svg' || start === '<?xm';
}

function detectImageFormat(bufferOrPath) {
  try {
    let buffer;
    if (typeof bufferOrPath === 'string') {
      // Assume it's a path
      if (!fs.existsSync(bufferOrPath)) return null;
      buffer = fs.readFileSync(bufferOrPath);
    } else {
      buffer = Buffer.isBuffer(bufferOrPath) ? bufferOrPath : Buffer.from(bufferOrPath);
    }

    if (buffer.length < 4) return null;

    // Check magic bytes for binary formats (JPEG, PNG, GIF, WebP)
    for (const [format, magic] of Object.entries(IMAGE_MAGIC)) {
      if (magic.bytes) {
        // For binary formats, check magic bytes from offset 0
        if (matchesMagicBytes(buffer, magic)) {
          return format;
        }
      } else if (format === 'svg') {
        // SVG detection: check for <svg or <?xml with svg reference
        if (matchesSvgText(buffer)) return 'svg';
      }
    }

    // Special case: check for WEBP (RIFF....WEBP)
    if (buffer.length >= 12) {
      const riff = buffer.toString('ascii', 0, 4);
      if (riff === 'RIFF') {
        const webpMarker = buffer.toString('ascii', 8, 12);
        if (webpMarker === 'WEBP') return 'webp';
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

// Semantic keyword inference from image format + basic naming heuristics
// (used when ML model is unavailable)
const SEMANTIC_HINTS = {
  png: 'digital graphic',
  jpeg: 'photograph',
  jpg: 'photograph',
  gif: 'animated graphic',
  webp: 'modern web image',
  svg: 'vector graphic',
  logo: 'brand logo',
  hero: 'hero banner',
  gallery: 'image gallery',
  product: 'product photograph',
  team: 'team photograph',
  office: 'office interior',
  food: 'food presentation',
  restaurant: 'restaurant scene',
  coffee: 'coffee or cafe scene',
  architecture: 'architectural photograph',
  nature: 'natural landscape',
  abstract: 'abstract visual art'
};

function inferAltTextHeuristic(imagePathOrBuffer, options = {}) {
  const defaults = {
    fallbackPrefix: 'An image of',
    maxLength: 120
  };
  const opts = { ...defaults, ...options };

  let context = 'content';

  if (typeof imagePathOrBuffer === 'string') {
    const lower = imagePathOrBuffer.toLowerCase();

    // Detect context from path segments
    for (const [key, hint] of Object.entries(SEMANTIC_HINTS)) {
      if (lower.includes(key)) {
        context = hint;
        break;
      }
    }

    // Extract meaningful filename parts
    const baseName = path.basename(imagePathOrBuffer, path.extname(imagePathOrBuffer));
    const words = baseName
      .split(/[-_]/)
      .map(w => w.trim())
      .filter(w => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()));

    if (words.length > 0) {
      return `${opts.fallbackPrefix} ${words.slice(0, 3).join(' ').toLowerCase()}, ${context}.`.slice(0, opts.maxLength);
    }
  }

  return `${opts.fallbackPrefix} ${context}, generated for accessibility.`.slice(0, opts.maxLength);
}

// Stop words for filename parsing
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'with',
  'by', 'my', 'our', 'we', 'i', 'it', 'is', 'are', 'was', 'were', 'this', 'that',
  'image', 'img', 'pic', 'photo', 'pict'
]);

// Text rewriting heuristics — rule-based fallback when model is unavailable
function applyRewriteHeuristic(text, mode) {
  if (!text || typeof text !== 'string') return text;
  if (text.length < 10) return text; // Too short to meaningfully rewrite

  const modes = {
    shorten: () => shortenText(text),
    professional_tone: () => setProfessionalTone(text),
    fix_grammar: () => fixGrammarBasic(text),
    simplify: () => simplifyText(text),
    expand: () => expandText(text)
  };

  const fn = modes[mode];
  if (!fn) return text;

  try {
    return fn();
  } catch (e) {
    return text; // Fail gracefully
  }
}

// Basic language utilities for heuristics
const ABBREVIATIONS = {
  'you are': 'you\'re',
  'they are': 'they\'re',
  'we are': 'we\'re',
  'it is': 'it\'s',
  'cannot': 'can\'t',
  'do not': 'don\'t',
  'does not': 'doesn\'t',
  'is not': 'isn\'t',
  'are not': 'aren\'t',
  'was not': 'wasn\'t',
  'were not': 'weren\'t',
  'have not': 'haven\'t',
  'has not': 'hasn\'t',
  'will not': 'won\'t',
  'would not': 'wouldn\'t',
  'could not': 'couldn\'t',
  'should not': 'shouldn\'t',
  'i am': 'i\'m',
  'you have': 'you\'ve',
  'we have': 'we\'ve',
  'they have': 'they\'ve',
  'i have': 'i\'ve',
  'that is': 'that\'s',
  'there is': 'there\'s',
  'here is': 'here\'s'
};

const CONTRACTION_REVERSALS = Object.fromEntries(
  Object.entries(ABBREVIATIONS).map(([k, v]) => [v, k])
);

function shortenText(text) {
  // Strategy: trim redundant words, remove filler, tighten phrasing
  let result = text
    // Remove common filler phrases
    .replace(/\b(it is important to note that|it is worth noting that|i would like to|i want to|in order to|the fact that|due to the fact that|in the event that|in the case that)\b/gi,
      m => ({ // Shorten these phrases
        'it is important to note that': 'note that',
        'it is worth noting that': 'note that',
        'i would like to': 'I want to',
        'i want to': 'I want to',
        'in order to': 'to',
        'the fact that': 'that',
        'due to the fact that': 'because',
        'in the event that': 'if',
        'in the case that': 'if'
      }[m.toLowerCase()] || m))

    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();

  // If text is longer than 150 chars, trim to ~70% and add ellipsis
  if (result.length > 150) {
    const targetLen = Math.floor(result.length * 0.7);
    // Find sentence boundary near target
    const slice = result.slice(0, targetLen);
    const lastPeriod = Math.max(
      slice.lastIndexOf('. '),
      slice.lastIndexOf('? '),
      slice.lastIndexOf('! ')
    );
    if (lastPeriod > targetLen * 0.6) {
      result = result.slice(0, lastPeriod + 1).trim();
    } else {
      result = slice.trim() + '…';
    }
  }

  return result;
}

function setProfessionalTone(text) {
  // Strategy: remove casual phrasing, use more formal constructions
  let result = text
    // Expand contractions
    .replace(/\b(can\'t|don\'t|isn\'t|aren\'t|won\'t|wouldn\'t|couldn\'t|shouldn\'t|hasn\'t|haven\'t|wasn\'t|weren\'t)\b/gi,
      m => CONTRACTION_REVERSALS[m.toLowerCase()] || m)

    // Replace casual connectors with formal ones
    .replace(/\b(plus|also|so|but|then)\s+/gi,
      (m, offset) => {
        // Only replace if it's a sentence connector (not universal replacement)
        const prevChar = result[offset - 1];
        if (prevChar && prevChar.match(/[.!?]/)) {
          return { 'plus': 'furthermore,', 'also': 'furthermore,', 'so': 'therefore,', 'but': 'however,', 'then': 'subsequently,' }[m.toLowerCase()] || m;
        }
        return m;
      })

    // Remove casual filler
    .replace(/\b(like|you know|sort of|kinda|kinda|kind of|basically|literally|honestly)\b/gi, '')

    // Capitalize first letter
    .replace(/^([a-z])/, (_, c) => c.toUpperCase())

    // Clean up spaces
    .replace(/\s+/g, ' ')
    .trim();

  return result;
}

function fixGrammarBasic(text) {
  let result = text;

  // Capitalize sentence starts
  result = result.replace(/(^|\.\s+)([a-z])/g, (_, separator, letter) =>
    separator + letter.toUpperCase());

  // Fix common "I" capitalization
  result = result.replace(/\bi\b/g, 'I');

  // Fix double spaces
  result = result.replace(/  +/g, ' ');

  // Ensure proper spacing after punctuation
  result = result.replace(/\s*([.,!?;:])\s*/g, (m, p1) => p1 + ' ');

  // Remove space before punctuation that shouldn't have it
  result = result.replace(/\s+([.,!?;:])/g, '$1');

  // Add space after punctuation if missing
  result = result.replace(/([.,!?;:])([A-Z])/g, '$1 $2');

  // Trim
  result = result.trim();

  return result;
}

function simplifyText(text) {
  // Strategy: replace long words with shorter equivalents, shorten sentences
  let result = text;

  // Replace complex words (basic substitution)
  const SIMPLIFICATIONS = {
    'approximately': 'about',
    'additional': 'added',
    'utilize': 'use',
    'implement': 'use',
    'demonstrate': 'show',
    'numerous': 'many',
    'several': 'some',
    'purchase': 'buy',
    'obtain': 'get',
    'require': 'need',
    'assist': 'help',
    'regarding': 'about',
    'concerning': 'about',
    'commence': 'start',
    'terminate': 'end',
    'subsequently': 'then',
    'nevertheless': 'but',
    'furthermore': 'also',
    'moreover': 'also',
    'consequently': 'so',
    'therefore': 'so',
    'however': 'but',
    'although': 'though',
    'despite': 'even with',
    'consideration': 'thought',
    'modification': 'change',
    'obligation': 'duty',
    'recommendation': 'suggestion',
    'requirement': 'need',
    'significant': 'big',
    'substantial': 'big',
    'appropriate': 'right',
    'preference': 'choice',
    'possibility': 'chance',
    'probability': 'chance',
    'capability': 'ability',
    'capacity': 'ability',
    'previously': 'before',
    'currently': 'now',
    'immediately': 'right away'
  };

  Object.entries(SIMPLIFICATIONS).forEach(([complex, simple]) => {
    const re = new RegExp(`\\b${complex}\\b`, 'gi');
    result = result.replace(re, simple);
  });

  // Shorten sentences to ~20 words max
  const sentences = result.split(/(?<=[.!?])\s+/);
  result = sentences
    .map(s => {
      const words = s.split(/\s+/);
      if (words.length > 20) {
        // Try to split at a natural break point
        const mid = Math.floor(words.length / 2);
        for (let i = mid; i > 5; i--) {
          if (['and', 'but', 'so', 'or', 'yet', 'while', 'because', 'although', ','].includes(words[i].toLowerCase().replace(/[^a-z]/g, ''))) {
            return words.slice(0, i + 1).join(' ') + ' ' + words.slice(i + 1).join(' ');
          }
        }
        // Just break at midpoint if no natural break
        return words.slice(0, 20).join(' ') + ' ' + words.slice(20).join(' ');
      }
      return s;
    })
    .join(' ');

  return result.trim();
}

function expandText(text) {
  // Strategy: add explanatory content, expand abbreviations, add context
  let result = text;

  // Expand common abbreviations
  const EXPANSIONS = {
    'approx.': 'approximately',
    'esp.': 'especially',
    'vs.': 'versus',
    'etc.': 'and so on',
    'e.g.': 'for example',
    'i.e.': 'that is',
    "don't": 'do not',
    "can't": 'cannot',
    "won't": 'will not',
    "it's": 'it is',
    "that's": 'that is',
    "here's": 'here is',
    "there's": 'there is'
  };

  Object.entries(EXPANSIONS).forEach(([abbr, full]) => {
    const re = new RegExp(`\\b${abbr}\\b`, 'gi');
    result = result.replace(re, full);
  });

  // Add transitional phrases to explain content
  if (result.length > 100 && !result.includes('In other words')) {
    // Find a logical place to add explanation
    const firstSentenceEnd = result.search(/[.!?]\s/);
    if (firstSentenceEnd > 0 && firstSentenceEnd < 200) {
      result = result.slice(0, firstSentenceEnd + 1) +
        ' In other words, ' + result.slice(firstSentenceEnd + 1).trim().toLowerCase();
    }
  }

  return result;
}

// ML-powered rewriting using transformers pipeline
async function rewriteTextWithML(text, mode) {
  // modes supported by the text2text pipeline
  const promptMap = {
    shorten: `Rewrite the following text to be more concise and shorter, keeping the main meaning:\n\nOriginal text:\n${text}\n\nShortened:`,
    professional_tone: `Rewrite the following text in a professional, formal business tone:\n\nOriginal text:\n${text}\n\nProfessional version:`,
    fix_grammar: `Fix any grammar, spelling, and punctuation errors in the following text, but keep the same meaning and style:\n\nOriginal text:\n${text}\n\nCorrected text:`,
    simplify: `Rewrite the following text in simpler, easier-to-understand language without losing the main meaning:\n\nOriginal text:\n${text}\n\nSimplified:`,
    expand: `Expand the following text with more detail and context while keeping the same topic:\n\nOriginal text:\n${text}\n\nExpanded:`
  };

  const prompt = promptMap[mode];
  if (!prompt) return null;

  try {
    // Use a lightweight summarization or text2text model
    const generator = await pipeline('text2text-generation', {
      model: 'Xenova/t5-small',
      quantized: true,
      device: 'webgpu' // Try WebGPU first
    });

    const output = await generator(prompt, {
      max_new_tokens: 256,
      temperature: 0.3,
      no_repeat_ngram_size: 3,
      do_sample: false
    });

    return output[0].generated_text.trim();
  } catch (e) {
    // If webgpu fails, try CPU
    try {
      const generator = await pipeline('text2text-generation', {
        model: 'Xenova/t5-small',
        quantized: true,
        device: 'cpu'
      });

      const output = await generator(prompt, {
        max_new_tokens: 256,
        temperature: 0.3,
        no_repeat_ngram_size: 3,
        do_sample: false
      });

      return output[0].generated_text.trim();
    } catch (e2) {
      throw e2;
    }
  }
}

// ML-powered alt text generation using embeddings + heuristics
async function generateAltTextWithML(imagePathOrBuffer, options = {}) {
  const opts = { maxLength: 120, ...options };

  // For real ML-powered alt text, we'd need:
  // 1. A vision-language model (ViT + LLM)
  // 2. Image processing to extract features
  // Due to transformers limitations in pure Node environment,
  // we use: semantic embedding analysis of the image path + filename + context

  try {
    // Use the sentence-transformer for semantic analysis of context
    const encoder = await pipeline('feature-extraction', {
      model: 'Xenova/all-MiniLM-L6-v2',
      quantized: true,
      device: 'webgpu'
    });

    // Extract semantic context from path/filename
    let contextText = '';

    if (typeof imagePathOrBuffer === 'string') {
      const filePath = imagePathOrBuffer;
      const fileName = path.basename(filePath, path.extname(filePath));
      const dirName = path.dirname(filePath);

      // Build context from path structure
      contextText = `${path.parse(filePath).name}`;

      // Add parent folder context
      const relativePath = path.relative(process.cwd(), dirName);
      if (relativePath) {
        contextText += ` from ${relativePath.replace(/\\/g, ' ')}`;
      }

      // If we can read EXIF or other metadata, that would go here
      // For now, use filename as context
    }

    // Generate embedding to understand semantic clustering
    // This is more useful for building a library of images
    if (contextText.length > 0) {
      const embedding = await encoder(contextText, { pooling: 'mean', normalize: true });
      // Embedding is available if we need to cluster images later
    }

    // Generate descriptive alt text from context
    const words = contextText
      .split(/[-_.\s]/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()))
      .slice(0, 5);

    if (words.length === 0) {
      return `[Image: ${(options.imageType || 'graphic')} content]`;
    }

    const altText = `An image of ${words.join(' ')}${opts.maxLength > 80 ? ', contextual visual' : ''}`.slice(0, opts.maxLength);

    return altText;
  } catch (e) {
    // If ML fails, fall back to heuristic
    return inferAltTextHeuristic(imagePathOrBuffer, options);
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Initialize the local AI engine.
 * Loads transformers library and prepares for model inference.
 * Returns state object indicating readiness.
 */
async function initLocalEngine() {
  const state = {
    initialized: false,
    usingML: false,
    modelName: null,
    device: null,
    error: null,
    fallbackMode: false
  };

  try {
    // Check platform compatibility
    const platform = process.platform;
    const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

    if (!isNode) {
      state.error = 'Local AI engine requires Node.js environment';
      state.fallbackMode = true;
      return state;
    }

    // Try to load transformers
    transformers = require('@huggingface/transformers');

    // Initialize the pipeline manager
    await transformers.pipeline;

    // Test if WebGPU is available (Electron/Node may not support it well)
    let testDevice = 'cpu'; // Default to CPU for Node.js
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      testDevice = 'webgpu';
    }

    state.device = testDevice;
    state.initialized = true;
    state.usingML = true;
    state.modelName = 'Xenova/all-MiniLM-L6-v2';

    return state;
  } catch (e) {
    state.error = `Failed to initialize ML engine: ${e.message}`;
    state.fallbackMode = true;
    state.initialized = true; // We're "initialized" but in fallback mode

    console.warn('[LocalAI] ML initialization failed, running in heuristic fallback mode:', e.message);

    return state;
  }
}

/**
 * Check if ML engine is available
 */
function isMLEngineAvailable() {
  return transformers !== null && modelLoaded;
}

/**
 * Get the current engine status
 */
function getEngineStatus() {
  return {
    initialized: transformers !== null,
    usingML: modelLoaded && !modelLoadError,
    modelName: modelLoaded ? 'Xenova/all-MiniLM-L6-v2' : null,
    device: 'cpu', // Node.js defaults to CPU
    error: modelLoadError,
    fallbackMode: !!modelLoadError
  };
}

/**
 * Generate descriptive alt text for images - completely offline.
 * Uses ML when available, falls back to smart heuristics based on
 * filename, path context, and image format analysis.
 *
 * @param {string|Buffer} imagePathOrBuffer - Path to image file or image buffer
 * @param {Object} options - Configuration options
 * @param {number} options.maxLength - Max length for generated text (default: 120)
 * @param {string} options.imageType - Known image type (auto-detected if not provided)
 * @returns {Promise<string>} Descriptive alt text
 */
async function generateOfflineAltText(imagePathOrBuffer, options = {}) {
  const opts = { maxLength: 120, ...options };

  // Detect image format
  const format = detectImageFormat(imagePathOrBuffer);
  opts.imageType = format || opts.imageType || 'unknown image';

  // If ML is available and working, use it
  if (isMLEngineAvailable()) {
    try {
      return await generateAltTextWithML(imagePathOrBuffer, opts);
    } catch (e) {
      console.warn('[LocalAI] ML alt text generation failed, using heuristic fallback:', e.message);
      // Fall through to heuristic
    }
  }

  // Fall back to heuristic-based generation
  return inferAltTextHeuristic(imagePathOrBuffer, opts);
}

/**
 * Rewrite text offline using either ML or rule-based heuristics.
 *
 * Supported modes:
 * - 'shorten': Condense text to key points
 * - 'professional_tone': Make text more formal/professional
 * - 'fix_grammar': Fix basic grammar, punctuation, casing
 * - 'simplify': Use simpler words and shorter sentences
 * - 'expand': Add detail and context
 *
 * @param {string} text - Text to rewrite
 * @param {string} mode - Rewrite mode (see above)
 * @param {Object} options - Additional options (ignored in heuristic mode)
 * @returns {Promise<string>} Rewritten text
 */
async function rewriteTextOffline(text, mode, options = {}) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Normalize mode to lowercase
  mode = mode.toLowerCase().trim();

  // Validate mode
  const validModes = ['shorten', 'professional_tone', 'fix_grammar', 'simplify', 'expand'];
  if (!validModes.includes(mode)) {
    console.warn(`[LocalAI] Unknown rewrite mode "${mode}", using 'fix_grammar' instead`);
    mode = 'fix_grammar';
  }

  // If ML is available, try it
  if (isMLEngineAvailable()) {
    try {
      const result = await rewriteTextWithML(text, mode);
      if (result && result.length > 0) {
        return result;
      }
    } catch (e) {
      console.warn(`[LocalAI] ML rewrite failed for mode "${mode}", using heuristic:`, e.message);
    }
  }

  // Fall back to heuristic-based rewriting
  return applyRewriteHeuristic(text, mode);
}

// ============================================================
// Export
// ============================================================

module.exports = {
  initLocalEngine,
  generateOfflineAltText,
  rewriteTextOffline,
  getEngineStatus,
  isMLEngineAvailable,
  // Exposed for testing
  detectImageFormat,
  inferAltTextHeuristic,
  applyRewriteHeuristic
};

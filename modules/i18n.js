// ============================================================
// PallettAI Studio — Multilingual Site Compiler
// Enables automated multi-language website generation with proper
// hreflang tags, locale-specific subfolders, and a vanilla JS
// language switcher that detects browser preferences without flashes.
// ============================================================

const fs = require('fs');
const path = require('path');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom'); // Fallback if not available

// Try to load DOM parser - in Electron environment, we can use native
let DOMParserLib = null;
let XMLParserLib = null;

try {
  // eslint-disable-next-line global-require
  DOMParserLib = require('@xmldom/xmldom').DOMParser;
} catch (e) {
  // Fall back to basic string manipulation
}

// ============================================================
// Language Detection & Support
// ============================================================

// Common language codes mapped to human-readable names
const LANGUAGE_NAMES = {
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  pt_BR: 'Português (Brasil)',
  nl: 'Nederlands',
  pl: 'Polski',
  ru: 'Русский',
  ja: '日本語',
  zh: '中文',
  zh_CN: '简体中文',
  zh_TW: '繁體中文',
  ko: '한국어',
  ar: 'العربية',
  hi: 'हिन्दी',
  tr: 'Türkçe',
  sv: 'Svenska',
  da: 'Dansk',
  fi: 'Suomi',
  no: 'Norsk',
  cs: 'Čeština',
  hu: 'Magyar',
  ro: 'Română',
  uk: 'Українська',
  el: 'Ελληνικά',
  th: 'ไทย',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu',
  tl: 'Tagalog'
};

// Browser language preference detection
function detectBrowserLanguage(httpAcceptLanguage = '') {
  if (!httpAcceptLanguage) {
    // Default to English if no header
    return 'en';
  }

  // Parse Accept-Language header (e.g., "en-US,en;q=0.9,es;q=0.8")
  const languages = httpAcceptLanguage.split(',').map(entry => {
    const parts = entry.trim().split(';');
    const lang = parts[0].toLowerCase();
    const quality = parts[1] ? parseFloat(parts[1].split('=')[1]) || 1 : 1;
    return { lang, quality };
  });

  // Sort by quality (higher first)
  languages.sort((a, b) => b.quality - a.quality);

  // Return the first language that matches our supported locales
  // Handle both primary (en) and regional (en-US) codes
  for (const { lang } of languages) {
    const primaryCode = lang.split('-')[0].split('_')[0];

    // Check if we have this exact locale or its primary code
    if (LANGUAGE_NAMES[lang]) return lang;
    if (LANGUAGE_NAMES[primaryCode]) return primaryCode;
  }

  // Fallback
  return 'en';
}

// ============================================================
// Translation Utilities
// ============================================================

/**
 * Simple string interpolation for translation templates
 * Supports {variable} style placeholders
 */
function interpolateTranslation(template, variables = {}) {
  if (!template || typeof template !== 'string') return template;

  return template.replace(/\{([^}]+)\}/g, (match, key) => {
    const value = variables[key.trim()];
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Apply pluralization rules based on count
 * Very basic implementation - can be extended per locale
 */
function pluralizeText(baseKey, count, locale = 'en', translations = {}) {
  const key = `${baseKey}_plural`;
  if (translations[key]) {
    // If translation provides plural forms, use them
    const forms = translations[key].split('|');
    if (forms.length >= 2) {
      // Simple English-like plural rule (1 vs others)
      const idx = (count === 1) ? 0 : 1;
      return forms[idx] || forms[0];
    }
  }
  return baseKey;
}

// ============================================================
// HTML Processing
// ============================================================

/**
 * Extract charset and other meta info from HTML
 */
function parseHtmlHead(html) {
  // Basic parser - extract key head elements
  const result = {
    charset: 'utf-8',
    title: '',
    metaTags: [],
    linkTags: [],
    styleTags: [],
    scriptsInHead: []
  };

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    result.title = titleMatch[1].trim();
  }

  // Extract charset
  const charsetMatch = html.match(/<meta[^>]+charset=["']?([a-zA-Z0-9-]+)["']?/i);
  if (charsetMatch) {
    result.charset = charsetMatch[1].toLowerCase();
  }

  // Extract meta tags
  const metaRegex = /<meta([^>]*)>/gi;
  let match;
  while ((match = metaRegex.exec(html)) !== null) {
    result.metaTags.push(match[0]);
  }

  // Extract link tags (for hreflang, canonical, etc.)
  const linkRegex = /<link([^>]*)>/gi;
  while ((match = linkRegex.exec(html)) !== null) {
    result.linkTags.push(match[0]);
  }

  return result;
}

/**
 * Inject hreflang alternate links into HTML head
 */
function injectHreflangLinks(html, locales, currentLocale, baseUrl) {
  const parser = DOMParserLib || createSimpleDomParser();

  if (!parser) {
    // Fallback: string manipulation
    return injectHreflangLinksFallback(html, locales, currentLocale, baseUrl);
  }

  try {
    const doc = parser.parseFromString(html, 'text/html');
    const head = doc.getElementsByTagName('head')[0];
    if (!head) return html;

    // Remove existing hreflang links to avoid duplicates
    const existingLinks = head.querySelectorAll('link[rel="alternate"]');
    existingLinks.forEach(link => {
      if (link.getAttribute('hreflang')) {
        link.parentNode.removeChild(link);
      }
    });

    // Add new hreflang links
    for (const locale of locales) {
      if (locale === currentLocale) continue;

      const link = doc.createElement('link');
      link.setAttribute('rel', 'alternate');
      link.setAttribute('hreflang', locale);
      const url = buildLocaleUrl(baseUrl, locale);
      link.setAttribute('href', url);
      head.appendChild(link);
    }

    // Add self-referencing canonical
    const canonical = doc.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    canonical.setAttribute('href', buildLocaleUrl(baseUrl, currentLocale));
    head.appendChild(canonical);

    // Serialize back to HTML
    const serializer = new (require('@xmldom/xmldom').XMLSerializer)();
    let result = serializer.serializeToString(doc);

    // Clean up XML serialization artifacts
    result = result
      .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '');

    return result;
  } catch (e) {
    // Fallback on error
    return injectHreflangLinksFallback(html, locales, currentLocale, baseUrl);
  }
}

/**
 * String-based fallback for hreflang injection
 */
function injectHreflangLinksFallback(html, locales, currentLocale, baseUrl) {
  // Remove existing hreflang links
  let result = html.replace(/<link[^>]*rel=["']alternate["'][^>]*>/gi, '');

  // Add new hreflang links before closing </head>
  const headEnd = result.toLowerCase().lastIndexOf('</head>');
  if (headEnd === -1) return html;

  const insertionPoint = headEnd;

  // Build hreflang link tags
  const links = [];
  for (const locale of locales) {
    if (locale === currentLocale) continue;
    const url = buildLocaleUrl(baseUrl, locale);
    links.push(`<link rel="alternate" hreflang="${locale}" href="${url}">`);
  }

  // Add canonical for current locale
  const canonicalUrl = buildLocaleUrl(baseUrl, currentLocale);
  links.push(`<link rel="canonical" href="${canonicalUrl}">`);

  const insertion = links.join('\n    ');
  result = result.slice(0, insertionPoint) + '\n    ' + insertion + result.slice(insertionPoint);

  return result;
}

/**
 * Build URL with locale prefix
 */
function buildLocaleUrl(baseUrl, locale, filePath = '') {
  // Ensure baseUrl has trailing slash
  const cleanBase = baseUrl.replace(/\/+$/, '');

  // Build path: /{locale}/{filePath}
  const normalizedPath = filePath.replace(/^\/+/, '');
  if (normalizedPath) {
    return `${cleanBase}/${locale}/${normalizedPath}`;
  }
  return `${cleanBase}/${locale}/`;
}

/**
 * Extract text content from HTML elements for translation
 */
function extractTranslatableText(html, selector = 'body') {
  const parser = DOMParserLib || createSimpleDomParser();

  if (!parser) {
    return extractTranslatableTextFallback(html);
  }

  try {
    const doc = parser.parseFromString(html, 'text/html');
    const elements = doc.querySelectorAll(selector + ' *[translate]');
    const texts = [];

    for (const el of elements) {
      const content = el.textContent.trim();
      if (content && content.length > 0) {
        texts.push({
          element: el.outerHTML,
          text: content,
          key: el.getAttribute('translate') || content.slice(0, 50).toLowerCase()
        });
      }
    }

    return texts;
  } catch (e) {
    return extractTranslatableTextFallback(html);
  }
}

function extractTranslatableTextFallback(html) {
  // Very basic regex-based extraction
  const texts = [];
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return texts;

  const body = bodyMatch[1];

  // Find elements with translate attribute or common translatable tags
  const translatableTags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'a', 'li', 'td', 'th', 'label', 'button', 'option'];

  for (const tag of translatableTags) {
    const regex = new RegExp(`<${tag}[^>]*>([^<]+)<\\/${tag}>`, 'gi');
    let match;
    while ((match = regex.exec(body)) !== null) {
      const content = match[1].trim();
      if (content && content.length > 0) {
        texts.push({
          text: content,
          key: content.slice(0, 50).toLowerCase().replace(/\s+/g, '_')
        });
      }
    }
  }

  return texts;
}

/**
 * Simple fallback DOM parser if xmldom is not available
 */
function createSimpleDomParser() {
  // Return null to indicate no DOM parser available
  return null;
}

// ============================================================
// Language Switcher JavaScript
// ============================================================

/**
 * Generate the vanilla JS language switcher helper
 * This script detects browser language, allows manual switching,
 * and persists choice in localStorage
 */
function generateLanguageSwitcherScript(locales, defaultLocale = 'en') {
  const localeNames = JSON.stringify(
    Object.fromEntries(
      locales.map(l => [l, LANGUAGE_NAMES[l] || l])
    )
  );

  return `/**
 * PallettAI Studio — Language Switcher
 * Detects browser language preferences, allows manual locale switching,
 * and remembers user choice. No page flash required.
 */
(function() {
  'use strict';

  // Configuration — injected by build system
  var SUPPORTED_LOCALES = ${JSON.stringify(locales)};
  var LOCALE_NAMES = ${localeNames};
  var DEFAULT_LOCALE = '${defaultLocale}';
  var BASE_URL = window.location.origin;

  // Try to detect locale from URL path first
  function detectLocaleFromUrl() {
    var path = window.location.pathname;
    var parts = path.split('/').filter(Boolean);
    if (parts.length > 0 && SUPPORTED_LOCALES.indexOf(parts[0]) !== -1) {
      return parts[0];
    }
    return null;
  }

  // Detect from browser preferences
  function detectFromBrowser() {
    var acceptLanguage = navigator.language || navigator.userLanguage || '';
    var primary = acceptLanguage.split('-')[0].split('_')[0].toLowerCase();

    // Check for exact match or primary language match
    if (SUPPORTED_LOCALES.indexOf(acceptLanguage.toLowerCase()) !== -1) {
      return acceptLanguage.toLowerCase();
    }
    if (SUPPORTED_LOCALES.indexOf(primary) !== -1) {
      return primary;
    }

    // Look for any matching language in Accept-Language header
    var languages = (navigator.languages || [acceptLanguage]).map(function(l) {
      return l.split('-')[0].split('_')[0].toLowerCase();
    });

    for (var i = 0; i < languages.length; i++) {
      if (SUPPORTED_LOCALES.indexOf(languages[i]) !== -1) {
        return languages[i];
      }
    }

    return null;
  }

  // Get stored preference
  function getStoredLocale() {
    try {
      var stored = localStorage.getItem('pallettai_locale');
      if (stored && SUPPORTED_LOCALES.indexOf(stored) !== -1) {
        return stored;
      }
    } catch (e) {
      // Storage not available
    }
    return null;
  }

  // Determine best locale
  function determineLocale() {
    // Priority: URL > stored preference > browser > default
    return detectLocaleFromUrl() ||
           getStoredLocale() ||
           detectFromBrowser() ||
           DEFAULT_LOCALE;
  }

  // Switch to a different locale
  function switchLocale(newLocale) {
    if (SUPPORTED_LOCALES.indexOf(newLocale) === -1) {
      console.warn('Unsupported locale: ' + newLocale);
      return;
    }

    // Store preference
    try {
      localStorage.setItem('pallettai_locale', newLocale);
    } catch (e) {}

    // Redirect to localized URL
    var currentPath = window.location.pathname.replace(/^\\/([a-z]{2}(-[a-zA-Z]{2})?)\\//i, '/');
    var newUrl = BASE_URL + '/' + newLocale + '/' + currentPath.replace(/^\\//, '');

    // Clean URL if same page
    if (window.location.pathname === '/' + newLocale + window.location.search) {
      return;
    }

    window.location.href = newUrl;
  }

  // Initialize switcher UI if elements exist
  function initSwitcher() {
    var locale = determineLocale();

    // If current URL doesn't match detected locale and we're not at root
    var currentLocale = detectLocaleFromUrl();
    if (!currentLocale || currentLocale !== locale) {
      // Redirect to proper locale version
      // But only if not already on a localized URL
      if (!currentLocale) {
        var pathWithoutLocale = window.location.pathname.replace(/^\\/[a-z]{2}(-[a-zA-Z]{2})?\\//, '/');
        var redirectUrl = BASE_URL + '/' + locale + pathWithoutLocale;
        if (redirectUrl !== window.location.href) {
          window.location.href = redirectUrl;
          return;
        }
      }
    }

    // Look for language switcher elements
    var switcherElements = document.querySelectorAll('[data-language-switcher]');
    for (var i = 0; i < switcherElements.length; i++) {
      var el = switcherElements[i];
      var currentLang = el.getAttribute('data-current-locale') || locale;
      var langs = el.getAttribute('data-languages') ? el.getAttribute('data-languages').split(',') : SUPPORTED_LOCALES;

      el.innerHTML = '<select data-lang-select>';
      for (var j = 0; j < langs.length; j++) {
        var lang = langs[j];
        var name = LOCALE_NAMES[lang] || lang;
        var selected = (lang === currentLang) ? ' selected' : '';
        el.innerHTML += '<option value="' + lang + '"' + selected + '>' + name + '</option>';
      }
      el.innerHTML += '</select>';

      // Add event listener
      var select = el.querySelector('[data-lang-select]');
      select.addEventListener('change', function(e) {
        switchLocale(e.target.value);
      });
    }
  }

  // Expose API for debugging/manual control
  window.__pallettaiLanguage = {
    getLocale: determineLocale,
    switchLocale: switchLocale,
    getSupported: function() { return SUPPORTED_LOCALES.slice(); },
    DEFAULT_LOCALE: DEFAULT_LOCALE
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSwitcher);
  } else {
    initSwitcher();
  }
})();`;
}

// ============================================================
// Main Compilation Functions
// ============================================================

/**
 * Compile a project into multiple language versions
 *
 * @param {Object} project - Project configuration
 * @param {string} project.sourcePath - Path to source HTML files
 * @param {string} project.outputPath - Base output directory
 * @param {Array<string>} project.locales - List of locale codes to generate
 * @param {Object} project.translations - Key-value map of translations per locale
 * @param {Object} project.defaultLocale - Default locale code
 * @param {string} project.domain - Domain for canonical URLs
 * @param {Object} options - Additional build options
 * @returns {Promise<Object>} Build report
 */
async function compileMultilingualSite(project, options = {}) {
  const {
    sourcePath,
    outputPath,
    locales = ['en'],
    translations = {},
    defaultLocale = 'en',
    domain = ''
  } = project;

  const report = {
    success: true,
    localesGenerated: [],
    errors: [],
    filesCreated: [],
    warnings: []
  };

  // Validate locales
  if (!Array.isArray(locales) || locales.length === 0) {
    report.success = false;
    report.errors.push('No locales specified for compilation');
    return report;
  }

  // Ensure all locales have translations object
  for (const locale of locales) {
    if (!translations[locale] || typeof translations[locale] !== 'object') {
      translations[locale] = {};
    }
  }

  // Create output base directory
  try {
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
  } catch (e) {
    report.success = false;
    report.errors.push(`Failed to create output directory: ${e.message}`);
    return report;
  }

  // Process each locale
  for (const locale of locales) {
    const localeOutputDir = path.join(outputPath, locale);

    try {
      // Create locale subdirectory
      if (!fs.existsSync(localeOutputDir)) {
        fs.mkdirSync(localeOutputDir, { recursive: true });
      }

      // Check if we have source files to process
      let sourceFiles = [];

      if (fs.existsSync(sourcePath)) {
        // It's a directory - scan for HTML files
        sourceFiles = fs.readdirSync(sourcePath)
          .filter(f => f.endsWith('.html') || f.endsWith('.htm'))
          .map(f => path.join(sourcePath, f));
      } else if (fs.existsSync(sourcePath + '.html')) {
        // Single file specified
        sourceFiles = [sourcePath + '.html'];
      }

      // If no source files found, create a basic index.html
      if (sourceFiles.length === 0) {
        const defaultHtml = generateDefaultIndexHtml(locale, translations[locale], defaultLocale);
        const outputFile = path.join(localeOutputDir, 'index.html');
        fs.writeFileSync(outputFile, defaultHtml, 'utf8');
        report.filesCreated.push(outputFile);

        // Inject language switcher
        const withSwitcher = injectLanguageSwitcher(defaultHtml, locales, locale);
        fs.writeFileSync(outputFile, withSwitcher, 'utf8');
        report.filesCreated.push(outputFile);

        continue;
      }

      // Process each source file
      for (const sourceFile of sourceFiles) {
        let html = fs.readFileSync(sourceFile, 'utf8');

        // Apply translations
        html = applyTranslations(html, translations[locale], locale);

        // Update lang attribute for locale
        html = html.replace(/<html[^>]*lang="[^"]*"/i, `<html lang="${locale}"`);
        if (!html.match(/<html[^>]*lang=/i)) {
          html = html.replace(/<html/i, `<html lang="${locale}"`);
        }

        // Inject hreflang and canonical links
        html = injectHreflangLinks(html, locales, locale, domain);

        // Inject language switcher script
        html = injectLanguageSwitcher(html, locales, locale);

        // Write output
        const relativePath = path.relative(sourcePath, sourceFile);
        const outputFile = path.join(localeOutputDir, relativePath);
        const outputDir = path.dirname(outputFile);

        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        fs.writeFileSync(outputFile, html, 'utf8');
        report.filesCreated.push(outputFile);
      }

      report.localesGenerated.push(locale);
    } catch (e) {
      report.errors.push(`Error processing locale ${locale}: ${e.message}`);
      report.success = false;
    }
  }

  return report;
}

/**
 * Generate a default index.html when no source files exist
 */
function generateDefaultIndexHtml(locale, translations = {}, defaultLocale) {
  const title = translations.title || getLocaleName(locale);
  const description = translations.description || `This page is available in multiple languages.`;

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
</head>
<body>
  <h1>${escapeHtml(translations.heading || title)}</h1>
  <p>${escapeHtml(translations.content || `Welcome to our site. This content is available in multiple languages.`)}</p>
</body>
</html>`;
}

/**
 * Get human-readable name for a locale
 */
function getLocaleName(locale) {
  return LANGUAGE_NAMES[locale] || locale;
}

/**
 * Apply translations to HTML content
 */
function applyTranslations(html, translationMap, locale) {
  if (!translationMap || typeof translationMap !== 'object') return html;

  // Replace translatable elements by data attributes or specific selectors
  let result = html;

  // Replace elements with data-i18n attribute
  result = result.replace(/data-i18n="([^"]+)"/g, (match, key) => {
    const translated = translationMap[key];
    if (translated) {
      return `data-i18n="translated" data-i18n-key="${key}"`;
    }
    return match;
  });

  // Replace text content in elements marked for translation
  result = result.replace(/<([a-z][a-z0-9]*)[^>]*data-translate="([^"]+)"[^>]*>([^<]*)<\/\1>/gi,
    (match, tag, key, content) => {
      const translated = translationMap[key];
      if (translated) {
        return `<${tag} data-translate="${key}">${translated}</${tag}>`;
      }
      return match;
    });

  // Replace title tag
  if (translationMap.title) {
    result = result.replace(/<title[^>]*>([^<]*)<\/title>/i,
      `<title>${translationMap.title}</title>`);
  }

  // Replace meta description
  if (translationMap.description) {
    result = result.replace(/<meta name="description" content="([^"]*)"/i,
      `<meta name="description" content="${translationMap.description}"`);
  }

  // Replace og:title
  if (translationMap['og:title']) {
    result = result.replace(/<meta property="og:title" content="([^"]*)"/i,
      `<meta property="og:title" content="${translationMap['og:title']}"`);
  }

  // Replace og:description
  if (translationMap['og:description']) {
    result = result.replace(/<meta property="og:description" content="([^"]*)"/i,
      `<meta property="og:description" content="${translationMap['og:description']}"`);
  }

  // Replace h1
  if (translationMap.heading) {
    result = result.replace(/<h1[^>]*>([^<]*)<\/h1>/i,
      `<h1>${translationMap.heading}</h1>`);
  }

  return result;
}

/**
 * Inject the language switcher script into HTML
 */
function injectLanguageSwitcher(html, locales, currentLocale) {
  // Check if script already exists
  if (html.includes('PallettAI Studio — Language Switcher')) {
    return html;
  }

  const scriptContent = generateLanguageSwitcherScript(locales, currentLocale);

  // Insert before closing </head> or </body>
  const headEnd = html.toLowerCase().lastIndexOf('</head>');
  if (headEnd !== -1) {
    const insertion = `<script>\n${scriptContent}\n<\/script>`;
    return html.slice(0, headEnd) + '\n  ' + insertion + html.slice(headEnd);
  }

  // Fallback: insert before </body>
  const bodyEnd = html.toLowerCase().lastIndexOf('</body>');
  if (bodyEnd !== -1) {
    const insertion = `<script>\n${scriptContent}\n<\/script>`;
    return html.slice(0, bodyEnd) + '\n  ' + insertion + html.slice(bodyEnd);
  }

  // If neither exists, append to end
  return html + `\n<script>\n${scriptContent}\n<\/script>`;
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

// ============================================================
// Export
// ============================================================

module.exports = {
  // Core compilation
  compileMultilingualSite,

  // Utilities
  detectBrowserLanguage,
  getLocaleName,
  buildLocaleUrl,
  interpolateTranslation,
  pluralizeText,

  // HTML processing
  injectHreflangLinks,
  injectLanguageSwitcher,
  extractTranslatableText,
  applyTranslations,

  // Script generation
  generateLanguageSwitcherScript,

  // Data
  LANGUAGE_NAMES,

  // For testing
  _test: {
    generateLanguageSwitcherScript,
    injectHreflangLinksFallback,
    detectBrowserLanguage
  }
};

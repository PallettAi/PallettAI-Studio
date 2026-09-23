// ============================================================
// PallettAI Studio — Translation Memory & Localization Fallback Engine
// Manages multi-locale string caching, builds translation dictionaries,
// resolves missing keys with fallback, and exports to XLIFF format.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Translation Memory Building
// ============================================================

/**
 * Extract all translatable strings from project data
 *
 * @param {Object} projectData - Project data with pages, components, metadata
 * @returns {Object} Translation memory object { keys: { [key]: { source: string, context: string } }, byLocale: { [locale]: { [key]: string } } }
 */
function buildTranslationMemory(projectData) {
  const tm = {
    version: '1.0',
    generated: new Date().toISOString(),
    sourceLocale: 'en',
    keys: {},
    byLocale: {},
    stats: {
      totalKeys: 0,
      locales: []
    }
  };

  if (!projectData || typeof projectData !== 'object') {
    return tm;
  }

  // Extract strings from various sources
  const extracted = new Map();

  // From pages
  if (projectData.pages && Array.isArray(projectData.pages)) {
    for (const page of projectData.pages) {
      extractStringsFromPage(page, 'page', extracted);
    }
  }

  // From posts/articles
  const contentSources = [
    projectData.posts,
    projectData.articles,
    projectData.blogPosts,
    projectData.content
  ];

  for (const source of contentSources) {
    if (Array.isArray(source)) {
      for (const item of source) {
        extractStringsFromContent(item, 'post', extracted);
      }
    }
  }

  // From metadata
  if (projectData.metadata && typeof projectData.metadata === 'object') {
    extractStringsFromObject(projectData.metadata, 'metadata', extracted);
  }

  // From UI components/config
  if (projectData.ui && typeof projectData.ui === 'object') {
    extractStringsFromObject(projectData.ui, 'ui', extracted);
  }

  if (projectData.components && Array.isArray(projectData.components)) {
    for (const component of projectData.components) {
      extractStringsFromComponent(component, extracted);
    }
  }

  // Build keys index
  for (const [key, info] of extracted.entries()) {
    tm.keys[key] = info;
  }

  tm.stats.totalKeys = tm.keys ? Object.keys(tm.keys).length : 0;
  tm.stats.locales = Object.keys(tm.byLocale);

  return tm;
}

/**
 * Extract translatable strings from a page
 */
function extractStringsFromPage(page, context, extracted) {
  if (!page || typeof page !== 'object') return;

  const prefix = `page.${page.id || page.slug || 'unknown'}`;

  // Title
  if (page.title) {
    addString(extracted, `${prefix}.title`, page.title, context);
  }

  // Description
  if (page.description) {
    addString(extracted, `${prefix}.description`, page.description, context);
  }

  // Heading
  if (page.heading) {
    addString(extracted, `${prefix}.heading`, page.heading, context);
  }

  // Meta
  if (page.meta && typeof page.meta === 'object') {
    extractStringsFromObject(page.meta, `${prefix}.meta`, extracted);
  }

  // Content excerpt
  if (page.excerpt) {
    addString(extracted, `${prefix}.excerpt`, page.excerpt, context);
  }
}

/**
 * Extract translatable strings from content item
 */
function extractStringsFromContent(item, context, extracted) {
  if (!item || typeof item !== 'object') return;

  const prefix = `${context}.${item.id || item.slug || item._id || 'unknown'}`;

  if (item.title) {
    addString(extracted, `${prefix}.title`, item.title, context);
  }

  if (item.description) {
    addString(extracted, `${prefix}.description`, item.description, context);
  }

  if (item.excerpt) {
    addString(extracted, `${prefix}.excerpt`, item.excerpt, context);
  }

  if (item.summary) {
    addString(extracted, `${prefix}.summary`, item.summary, context);
  }

  if (item.author) {
    addString(extracted, `${prefix}.author`, item.author, context);
  }

  if (item.tags && Array.isArray(item.tags)) {
    item.tags.forEach((tag, i) => {
      addString(extracted, `${prefix}.tag[${i}]`, tag, context);
    });
  }

  if (item.category) {
    addString(extracted, `${prefix}.category`, item.category, context);
  }
}

/**
 * Extract strings from generic object
 */
function extractStringsFromObject(obj, prefix, extracted) {
  if (!obj || typeof obj !== 'object') return;

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = `${prefix}.${key}`;

    if (typeof value === 'string') {
      addString(extracted, fullKey, value, prefix);
    } else if (typeof value === 'object' && value !== null) {
      extractStringsFromObject(value, fullKey, extracted);
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        const arrayKey = `${fullKey}[${i}]`;
        if (typeof item === 'string') {
          addString(extracted, arrayKey, item, prefix);
        } else if (typeof item === 'object' && item !== null) {
          extractStringsFromObject(item, arrayKey, extracted);
        }
      });
    }
  }
}

/**
 * Extract strings from component
 */
function extractStringsFromComponent(component, extracted) {
  if (!component || typeof component !== 'object') return;

  const prefix = `component.${component.type || component.name || 'unknown'}`;

  if (component.label) {
    addString(extracted, `${prefix}.label`, component.label, 'component');
  }

  if (component.placeholder) {
    addString(extracted, `${prefix}.placeholder`, component.placeholder, 'component');
  }

  if (component.hint) {
    addString(extracted, `${prefix}.hint`, component.hint, 'component');
  }

  if (component.error) {
    addString(extracted, `${prefix}.error`, component.error, 'component');
  }

  if (component.options && Array.isArray(component.options)) {
    component.options.forEach((opt, i) => {
      if (typeof opt === 'string') {
        addString(extracted, `${prefix}.option[${i}]`, opt, 'component');
      } else if (typeof opt === 'object' && opt.label) {
        addString(extracted, `${prefix}.option[${i}].label`, opt.label, 'component');
      }
    });
  }

  if (component.children && Array.isArray(component.children)) {
    component.children.forEach((child, i) => {
      extractStringsFromComponent(child, extracted);
    });
  }
}

/**
 * Add string to extraction map
 */
function addString(extracted, key, value, context) {
  if (!value || typeof value !== 'string') return;
  if (value.trim() === '') return;

  if (!extracted.has(key)) {
    extracted.set(key, {
      key,
      source: value,
      context: context || 'unknown',
      occurrences: 1
    });
  } else {
    const existing = extracted.get(key);
    existing.occurrences++;
    // Keep longer source as canonical
    if (value.length > existing.source.length) {
      existing.source = value;
    }
  }
}

// ============================================================
// Missing Key Resolution
// ============================================================

/**
 * Resolve missing translation keys with fallback
 *
 * @param {string} targetLocale - Target locale code
 * @param {Object} translationMap - Translation map for target locale
 * @param {Object} defaultLocaleMap - Translation map for default locale (fallback)
 * @param {Object} translationMemory - Optional translation memory
 * @returns {Object} Resolution result with resolved map and diagnostics
 */
function resolveMissingKeys(targetLocale, translationMap, defaultLocaleMap, translationMemory = null) {
  const result = {
    locale: targetLocale,
    totalKeys: 0,
    translatedKeys: 0,
    missingKeys: 0,
    fallbackKeys: 0,
    diagnostics: {
      missing: [],
      fallbacks: [],
      warnings: []
    },
    resolvedMap: {}
  };

  if (!translationMap || typeof translationMap !== 'object') {
    translationMap = {};
  }

  if (!defaultLocaleMap || typeof defaultLocaleMap !== 'object') {
    defaultLocaleMap = {};
  }

  // Get all known keys from both maps
  const allKeys = new Set([
    ...Object.keys(translationMap),
    ...Object.keys(defaultLocaleMap)
  ]);

  result.totalKeys = allKeys.size;

  for (const key of allKeys) {
    const targetValue = translationMap[key];
    const defaultValue = defaultLocaleMap[key];

    if (targetValue && typeof targetValue === 'string' && targetValue.trim() !== '') {
      // Key is translated
      result.translatedKeys++;
      result.resolvedMap[key] = targetValue;
    } else if (defaultValue && typeof defaultValue === 'string' && defaultValue.trim() !== '') {
      // Use fallback from default locale
      result.fallbackKeys++;
      result.resolvedMap[key] = defaultValue;
      result.diagnostics.fallbacks.push({
        key,
        fallbackFrom: 'en',
        value: defaultValue
      });
    } else {
      // Key is missing
      result.missingKeys++;
      result.resolvedMap[key] = '';
      result.diagnostics.missing.push({
        key,
        context: translationMemory?.keys?.[key]?.context || 'unknown',
        source: translationMemory?.keys?.[key]?.source || ''
      });
    }
  }

  // Generate warnings for missing keys
  if (result.missingKeys > 0) {
    result.diagnostics.warnings.push(
      `Missing ${result.missingKeys} key(s) in ${targetLocale} - using empty strings`
    );
  }

  if (result.fallbackKeys > 0) {
    result.diagnostics.warnings.push(
      `Used fallback for ${result.fallbackKeys} key(s) from default locale`
    );
  }

  result.status = result.missingKeys === 0 ? 'complete' :
                  result.fallbackKeys > 0 ? 'partial' : 'incomplete';

  return result;
}

/**
 * Generate inline diagnostic log for untranslated keys
 *
 * @param {Object} resolutionResult - Result from resolveMissingKeys
 * @returns {string} Formatted diagnostic log
 */
function generateTranslationDiagnostics(resolutionResult) {
  const lines = [
    `=== Translation Diagnostics for ${resolutionResult.locale} ===`,
    `Status: ${resolutionResult.status.toUpperCase()}`,
    `Total Keys: ${resolutionResult.totalKeys}`,
    `Translated: ${resolutionResult.translatedKeys}`,
    `Fallback Used: ${resolutionResult.fallbackKeys}`,
    `Missing: ${resolutionResult.missingKeys}`,
    ''
  ];

  if (resolutionResult.diagnostics.missing.length > 0) {
    lines.push('--- Missing Keys ---');
    for (const entry of resolutionResult.diagnostics.missing) {
      lines.push(`  [${entry.context}] ${entry.key}`);
      if (entry.source) {
        lines.push(`    Source: "${entry.source}"`);
      }
    }
    lines.push('');
  }

  if (resolutionResult.diagnostics.fallbacks.length > 0) {
    lines.push('--- Fallback Keys ---');
    for (const entry of resolutionResult.diagnostics.fallbacks) {
      lines.push(`  ${entry.key} => "${entry.value}" (from ${entry.fallbackFrom})`);
    }
    lines.push('');
  }

  if (resolutionResult.diagnostics.warnings.length > 0) {
    lines.push('--- Warnings ---');
    for (const warning of resolutionResult.diagnostics.warnings) {
      lines.push(`  ⚠️ ${warning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// XLIFF Export
// ============================================================

/**
 * Export translation map to XLIFF 1.2 format
 *
 * @param {Object} translationMap - Translation dictionary
 * @param {string} targetLocale - Target locale code
 * @param {string} sourceLocale - Source locale (default: 'en')
 * @param {string} projectName - Project name for XLIFF header
 * @returns {string} XLIFF document
 */
function exportXLIFF(translationMap, targetLocale, sourceLocale = 'en', projectName = 'PallettAI Studio') {
  if (!translationMap || typeof translationMap !== 'object') {
    translationMap = {};
  }

  const now = new Date().toISOString();
  const keys = Object.entries(translationMap).filter(([_, v]) => v && typeof v === 'string');

  // The prologue attributes carry caller-supplied strings just like the unit
  // bodies do, so they need the same escaping. Unescaped, a locale or project
  // name containing a quote or `<` corrupts the document or injects elements.
  let xliff = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xliff += `<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">\n`;
  xliff += `  <file source-language="${escapeXml(String(sourceLocale))}" target-language="${escapeXml(String(targetLocale))}" original="${escapeXml(String(projectName))}" datatype="plaintext" original-encoding="UTF-8">\n`;
  xliff += `    <header>\n`;
  xliff += `      <tool tool-id="pallettai-studio" tool-name="PallettAI Studio" tool-version="1.0" />\n`;
  xliff += `      <timestamp>${now}</timestamp>\n`;
  xliff += `    </header>\n`;
  xliff += `    <body>\n`;

  for (const [key, value] of keys) {
    // Escape for XML
    const escapedKey = escapeXml(key);
    const escapedValue = escapeXml(value);

    // Generate ID from key
    const id = key.replace(/[^a-zA-Z0-9_-]/g, '_');

    xliff += `      <trans-unit id="${id}" mem-type="translation">\n`;
    xliff += `        <source>${escapedKey}</source>\n`;
    xliff += `        <target>${escapedValue}</target>\n`;
    xliff += `        <context>${escapeXml(key.split('.')[0])}</context>\n`;
    xliff += `      </trans-unit>\n`;
  }

  xliff += `    </body>\n`;
  xliff += `  </file>\n`;
  xliff += `</xliff>`;

  return xliff;
}

/**
 * Export translation memory to XLIFF with source and target
 *
 * @param {Object} translationMemory - Translation memory object
 * @param {string} targetLocale - Target locale
 * @returns {string} Complete XLIFF with source and target
 */
function exportTranslationMemoryXLIFF(translationMemory, targetLocale) {
  const xliff = {
    version: '1.2',
    sourceLocale: translationMemory.sourceLocale || 'en',
    targetLocale,
    generated: translationMemory.generated,
    keys: []
  };

  if (!translationMemory || !translationMemory.keys) {
    return xliff;
  }

  for (const [key, info] of Object.entries(translationMemory.keys)) {
    xliff.keys.push({
      id: key.replace(/[^a-zA-Z0-9_-]/g, '_'),
      source: key,
      target: info.source,
      context: info.context || '',
      notes: ''
    });
  }

  return xliff;
}

/**
 * Escape string for XML
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

/**
 * Save XLIFF to file
 */
function saveXLIFF(xliffContent, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, xliffContent, 'utf8');
  return path.resolve(outputPath);
}

// ============================================================
// Translation Memory Utilities
// ============================================================

/**
 * Merge multiple translation memories
 */
function mergeTranslationMemories(...tms) {
  const merged = {
    version: '1.0',
    generated: new Date().toISOString(),
    sourceLocale: 'en',
    keys: {},
    byLocale: {},
    stats: { totalKeys: 0, locales: [] }
  };

  const allKeys = new Map();

  for (const tm of tms) {
    if (!tm || !tm.keys) continue;

    for (const [key, info] of Object.entries(tm.keys)) {
      if (allKeys.has(key)) {
        const existing = allKeys.get(key);
        existing.occurrences += info.occurrences || 1;
        if ((info.source || '').length > (existing.source || '').length) {
          existing.source = info.source;
        }
      } else {
        allKeys.set(key, { ...info });
      }
    }

    // Merge locale maps
    if (tm.byLocale) {
      for (const [locale, map] of Object.entries(tm.byLocale)) {
        if (!merged.byLocale[locale]) {
          merged.byLocale[locale] = {};
        }
        Object.assign(merged.byLocale[locale], map);
      }
    }
  }

  merged.keys = Object.fromEntries(allKeys);
  merged.stats.totalKeys = merged.keys ? Object.keys(merged.keys).length : 0;
  merged.stats.locales = Object.keys(merged.byLocale);

  return merged;
}

/**
 * Get translation statistics
 */
function getTranslationStats(translationMap, locale) {
  if (!translationMap || typeof translationMap !== 'object') {
    return { total: 0, translated: 0, empty: 0, averageLength: 0 };
  }

  const keys = Object.keys(translationMap);
  const total = keys.length;
  const translated = keys.filter(k => translationMap[k] && typeof translationMap[k] === 'string' && translationMap[k].trim() !== '').length;
  const empty = keys.filter(k => !translationMap[k] || translationMap[k].trim() === '').length;

  const lengths = keys
    .map(k => translationMap[k] && typeof translationMap[k] === 'string' ? translationMap[k].length : 0)
    .filter(l => l > 0);

  const averageLength = lengths.length > 0
    ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
    : 0;

  return {
    total,
    translated,
    empty,
    averageLength,
    completionPercentage: total > 0 ? Math.round((translated / total) * 100) : 0
  };
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Translation memory
  buildTranslationMemory,
  mergeTranslationMemories,

  // Key resolution
  resolveMissingKeys,
  generateTranslationDiagnostics,

  // XLIFF
  exportXLIFF,
  exportTranslationMemoryXLIFF,
  saveXLIFF,

  // Utilities
  getTranslationStats,
  escapeXml,

  // For testing
  _test: {
    buildTranslationMemory,
    resolveMissingKeys,
    generateTranslationDiagnostics,
    exportXLIFF,
    exportTranslationMemoryXLIFF,
    mergeTranslationMemories,
    getTranslationStats,
    escapeXml,
    addString,
    extractStringsFromPage,
    extractStringsFromContent,
    extractStringsFromObject
  }
};

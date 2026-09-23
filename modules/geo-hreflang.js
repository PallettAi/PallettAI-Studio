// ============================================================
// PallettAI Studio — Geo-Targeting & Multi-Region Hreflang Matrix
// Generates hreflang mappings, injects hreflang tags, and provides
// regional formatting helpers for currency, dates, and units.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Hreflang Matrix Generation
// ============================================================

/**
 * ISO 639-1 language codes mapping
 */
const LANGUAGE_CODES = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  sv: 'Swedish',
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
  pl: 'Polish',
  ru: 'Russian',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  el: 'Greek',
  tr: 'Turkish',
  cs: 'Czech',
  hu: 'Hungarian',
  ro: 'Romanian',
  uk: 'Ukrainian'
};

/**
 * ISO 3166-1 country codes mapping
 */
const COUNTRY_CODES = {
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  NZ: 'New Zealand',
  DE: 'Germany',
  FR: 'France',
  ES: 'Spain',
  IT: 'Italy',
  PT: 'Portugal',
  NL: 'Netherlands',
  BE: 'Belgium',
  CH: 'Switzerland',
  AT: 'Austria',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  PL: 'Poland',
  RU: 'Russia',
  CN: 'China',
  JP: 'Japan',
  KR: 'South Korea',
  AR: 'Argentina',
  BR: 'Brazil',
  MX: 'Mexico',
  IN: 'India',
  ZA: 'South Africa'
};

/**
 * Default language-region combinations
 */
const DEFAULT_LOCALES = [
  'en-US',
  'en-GB',
  'de-DE',
  'fr-FR',
  'es-ES',
  'it-IT',
  'pt-BR',
  'ja-JP',
  'zh-CN',
  'ko-KR',
  'ru-RU',
  'ar-SA',
  'nl-NL',
  'sv-SE',
  'pl-PL',
  'tr-TR',
  'cs-CZ',
  'da-DK',
  'fi-FI',
  'nb-NO'
];

/**
 * Generate complete hreflang matrix for a page
 *
 * @param {string} siteUrl - Base site URL
 * @param {Object} pageMatrix - Page URL mappings by locale
 * @param {string} defaultLocale - Default locale (e.g., 'en-US')
 * @returns {Object} Complete hreflang matrix
 */
function generateHreflangMatrix(siteUrl, pageMatrix, defaultLocale = 'en-US') {
  const matrix = {
    siteUrl: siteUrl.replace(/\/$/, ''),
    defaultLocale,
    locales: {},
    validLocales: [],
    invalidLocales: [],
    warnings: []
  };

  // Normalize site URL
  const baseUrl = siteUrl.replace(/\/$/, '');

  // Process each locale
  if (pageMatrix && typeof pageMatrix === 'object') {
    Object.entries(pageMatrix).forEach(([locale, pageUrl]) => {
      // Validate locale format
      const isValidLocale = isValidLocaleCode(locale);
      const isValidUrl = typeof pageUrl === 'string' && pageUrl.startsWith('http');

      if (isValidLocale) {
        matrix.locales[locale] = {
          url: pageUrl.startsWith('http') ? pageUrl : `${baseUrl}${pageUrl}`,
          valid: true
        };
        matrix.validLocales.push(locale);
      } else {
        matrix.locales[locale] = {
          url: pageUrl,
          valid: false,
          error: `Invalid locale code: ${locale}`
        };
        matrix.invalidLocales.push(locale);
        matrix.warnings.push(`Invalid locale: ${locale}`);
      }
    });
  }

  // Ensure x-default is present
  if (!matrix.locales['x-default']) {
    const defaultPage = pageMatrix[defaultLocale] || pageMatrix.en || '/';
    matrix.locales['x-default'] = {
      url: defaultPage.startsWith('http') ? defaultPage : `${baseUrl}${defaultPage}`,
      valid: true,
      isDefault: true
    };
    matrix.validLocales.push('x-default');
  }

  return matrix;
}

/**
 * Validate locale code format (e.g., en-US, fr-FR)
 */
function isValidLocaleCode(locale) {
  if (!locale || typeof locale !== 'string') return false;

  // x-default is special
  if (locale === 'x-default') return true;

  // Check format: language-COUNTRY or just language
  const localePattern = /^[a-z]{2}(-[A-Z]{2})?$/;
  return localePattern.test(locale);
}

/**
 * Parse locale into language and country
 */
function parseLocale(locale) {
  if (!locale || typeof locale !== 'string') {
    return { language: '', country: '', valid: false };
  }

  if (locale === 'x-default') {
    return { language: 'x-default', country: '', valid: true };
  }

  const parts = locale.split('-');
  const language = parts[0] || '';
  const country = parts[1] || '';

  return {
    language,
    country,
    valid: isValidLocaleCode(locale),
    raw: locale
  };
}

/**
 * Get list of supported locales
 */
function getSupportedLocales() {
  return [...DEFAULT_LOCALES];
}

/**
 * Get language name from code
 */
function getLanguageName(code) {
  return LANGUAGE_CODES[code] || code;
}

/**
 * Get country name from code
 */
function getCountryName(code) {
  return COUNTRY_CODES[code] || code;
}

// ============================================================
// Hreflang Tag Injection
// ============================================================

/**
 * Generate hreflang link tags as XML string
 *
 * @param {Object} matrix - Hreflang matrix
 * @returns {string} Complete hreflang link tags
 */
/**
 * Return a URL safe inside a quoted href, or '' to drop it.
 *
 * Sanitised by rejection rather than entity escaping, because these strings
 * are concatenated into markup directly: an escaped entity would be doubly
 * escaped by any serializer that runs afterwards.
 */
function sanitiseHref(value) {
  const url = String(value === null || value === undefined ? '' : value).trim();
  if (!url) return '';
  if (/["'<>`\\\u0000-\u001F\u007F]/.test(url)) return '';
  // Browsers ignore whitespace and control characters when resolving a
  // scheme, so "java\tscript:" must be normalised before the check.
  if (/^(javascript|vbscript|data|blob):/i.test(url.replace(/[\u0000-\u0020\u007F]/g, ''))) return '';
  return url;
}

/**
 * A locale key that may appear in an hreflang attribute.
 * `x-default` is the one non-locale value the spec allows.
 */
function sanitiseHreflangValue(locale) {
  const value = String(locale === null || locale === undefined ? '' : locale).trim();
  if (value === 'x-default') return value;
  return isValidLocaleCode(value) ? value : '';
}

function generateHreflangTagsString(matrix) {
  if (!matrix || !matrix.locales) return '';

  let tags = '';

  Object.entries(matrix.locales).forEach(([locale, data]) => {
    if (!data.valid) return;

    const hreflangValue = sanitiseHreflangValue(locale);
    const href = sanitiseHref(data.url);

    // Skip rather than emit a malformed or hostile tag.
    if (!hreflangValue || !href) return;

    tags += `  <link rel="alternate" hreflang="${hreflangValue}" href="${href}" />\n`;
  });

  return tags;
}

/**
 * Inject hreflang tags into HTML document
 *
 * @param {string} htmlContent - HTML content
 * @param {Object} localeMappings - Locale to URL mappings
 * @returns {string} HTML with hreflang tags injected
 */
function injectHreflangTags(htmlContent, localeMappings) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return htmlContent;
  }

  if (!localeMappings || typeof localeMappings !== 'object') {
    return htmlContent;
  }

  // Build hreflang tags
  let tags = '';

  Object.entries(localeMappings).forEach(([locale, url]) => {
    const rawUrl = String(url === null || url === undefined ? '' : url).trim();
    if (!locale || !rawUrl) return;

    const hreflangValue = sanitiseHreflangValue(locale);
    if (!hreflangValue) return;

    // Coerce to a string first: a non-string mapping used to throw
    // "url.startsWith is not a function" and take the whole export down.
    const href = sanitiseHref(rawUrl.indexOf('http') === 0 ? rawUrl : getBaseUrl(htmlContent) + rawUrl);
    if (!href) return;

    tags += `  <link rel="alternate" hreflang="${hreflangValue}" href="${href}" />\n`;
  });

  if (!tags) return htmlContent;

  // Inject into head
  const headEndIndex = htmlContent.toLowerCase().lastIndexOf('</head>');

  if (headEndIndex !== -1) {
    return htmlContent.slice(0, headEndIndex) + '\n' + tags + htmlContent.slice(headEndIndex);
  }

  // Fallback: before body
  const bodyStartIndex = htmlContent.toLowerCase().indexOf('<body');
  if (bodyStartIndex !== -1) {
    return htmlContent.slice(0, bodyStartIndex) + '\n' + tags + htmlContent.slice(bodyStartIndex);
  }

  // Last resort: append to end
  return htmlContent + '\n' + tags;
}

/**
 * Get base URL from HTML document
 */
function getBaseUrl(htmlContent) {
  if (!htmlContent) return '';

  // Check for <base> tag
  const baseMatch = htmlContent.match(/<base[^>]*href=["']([^"']*)["']/i);
  if (baseMatch) {
    return baseMatch[1];
  }

  // Try to extract from canonical or og:url
  const canonicalMatch = htmlContent.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  if (canonicalMatch) {
    return canonicalMatch[1].replace(/\/+$/, '');
  }

  const ogUrlMatch = htmlContent.match(/<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']*)["']/i);
  if (ogUrlMatch) {
    return ogUrlMatch[1].replace(/\/+$/, '');
  }

  return '';
}

/**
 * Generate complete hreflang tag set for HTML head
 *
 * @param {Object} options - Configuration
 * @returns {string} Complete hreflang tags
 */
function generateHreflangTagSet(options = {}) {
  const {
    siteUrl = '',
    locales = {},
    defaultLocale = 'en-US',
    includeXDefault = true
  } = options;

  const baseUrl = siteUrl.replace(/\/$/, '');
  let tags = '';

  Object.entries(locales).forEach(([locale, path]) => {
    if (!locale || !path) return;

    const href = path.startsWith('http') ? path : `${baseUrl}${path}`;
    tags += `  <link rel="alternate" hreflang="${locale}" href="${href}" />\n`;
  });

  // Add x-default
  if (includeXDefault && locales[defaultLocale]) {
    const defaultPath = locales[defaultLocale];
    const href = defaultPath.startsWith('http') ? defaultPath : `${baseUrl}${defaultPath}`;
    tags += `  <link rel="alternate" hreflang="x-default" href="${href}" />\n`;
  }

  return tags;
}

// ============================================================
// Regional Formatting Helpers
// ============================================================

/**
 * Format currency value for locale
 *
 * @param {number} amount - Amount to format
 * @param {string} locale - Locale code (e.g., 'en-US', 'de-DE')
 * @param {string} currencyCode - Currency code (e.g., 'USD', 'EUR')
 * @returns {string} Formatted currency string
 */
function formatRegionalValue(amount, locale = 'en-US', currencyCode = 'USD') {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return `${currencyCode} 0.00`;
  }

  const result = parseLocale(locale);

  // Build Intl options. Fraction digits are intentionally left to the currency
  // so zero-decimal currencies (JPY, KRW) are not given meaningless ".00".
  const options = {
    style: 'currency',
    currency: currencyCode
  };

  try {
    // Use Intl.NumberFormat for proper locale formatting
    const formatter = new Intl.NumberFormat(result.language !== 'x-default' ? result.language + (result.country ? `-${result.country}` : '') : 'en-US', options);
    return formatter.format(amount);
  } catch (e) {
    // Fallback: manual formatting
    const symbol = getCurrencySymbol(currencyCode, result.language);
    const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);
    const formatted = amount.toFixed(ZERO_DECIMAL.has(currencyCode) ? 0 : 2);

    // Add thousands separator based on locale
    const usesCommaDecimal =
      result.language === 'de' || result.language === 'fr' || result.language === 'es' ||
      result.language === 'it' || result.language === 'pt' || result.language === 'nl';

    const [intPart, decPart] = formatted.split('.');
    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g,
      usesCommaDecimal ? '.' : ',');

    if (decPart === undefined) {
      return usesCommaDecimal ? `${symbol} ${formattedInt}` : `${symbol}${formattedInt}`;
    }

    if (usesCommaDecimal) {
      return `${symbol} ${formattedInt},${decPart}`;
    }

    return `${symbol}${formattedInt}.${decPart}`;
  }
}

/**
 * Get currency symbol for locale
 */
function getCurrencySymbol(currencyCode, language = 'en') {
  const symbols = {
    USD: { en: '$', de: 'US$', fr: 'US$', es: 'US$', it: 'US$', pt: 'US$', nl: 'US$', ja: 'US$', zh: 'US$', ko: 'US$', ar: 'US$', ru: 'US$' },
    EUR: { en: '€', de: '€', fr: '€', es: '€', it: '€', pt: '€', nl: '€', ja: '€', zh: '€', ko: '€', ar: '€', ru: '€' },
    GBP: { en: '£', de: 'GB£', fr: 'GB£', es: 'GB£', it: 'GB£', pt: 'GB£', nl: 'GB£', ja: 'GB£', zh: 'GB£', ko: 'GB£', ar: 'GB£', ru: 'GB£' },
    JPY: { en: '¥', de: 'JP¥', fr: 'JP¥', es: 'JP¥', it: 'JP¥', pt: 'JP¥', nl: 'JP¥', ja: '¥', zh: '¥', ko: '¥', ar: 'JP¥', ru: 'JP¥' },
    CNY: { en: '¥', de: 'CN¥', fr: 'CN¥', es: 'CN¥', it: 'CN¥', pt: 'CN¥', nl: 'CN¥', ja: 'CN¥', zh: '¥', ko: 'CN¥', ar: 'CN¥', ru: 'CN¥' },
    KRW: { en: '₩', de: '₩', fr: '₩', es: '₩', it: '₩', pt: '₩', nl: '₩', ja: '₩', zh: '₩', ko: '₩', ar: '₩', ru: '₩' },
    INR: { en: '₹', de: '₹', fr: '₹', es: '₹', it: '₹', pt: '₹', nl: '₹', ja: '₹', zh: '₹', ko: '₹', ar: '₹', ru: '₹' },
    CAD: { en: 'CA$', de: 'CA$', fr: 'CA$', es: 'CA$', it: 'CA$', pt: 'CA$', nl: 'CA$', ja: 'CA$', zh: 'CA$', ko: 'CA$', ar: 'CA$', ru: 'CA$' },
    AUD: { en: 'A$', de: 'A$', fr: 'A$', es: 'A$', it: 'A$', pt: 'A$', nl: 'A$', ja: 'A$', zh: 'A$', ko: 'A$', ar: 'A$', ru: 'A$' },
    CHF: { en: 'CHF', de: 'CHF', fr: 'CHF', es: 'CHF', it: 'CHF', pt: 'CHF', nl: 'CHF', ja: 'CHF', zh: 'CHF', ko: 'CHF', ar: 'CHF', ru: 'CHF' }
  };

  if (symbols[currencyCode] && symbols[currencyCode][language]) {
    return symbols[currencyCode][language];
  }

  // Fallback to standard symbol
  const standardSymbols = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', KRW: '₩', INR: '₹', CAD: '$', AUD: '$', CHF: 'CHF'
  };

  return standardSymbols[currencyCode] || currencyCode;
}

/**
 * Comprehensive regional formatter for static pricing/e-commerce cards.
 *
 * Formats any of the following in one call, returning every applicable
 * representation so templates can pick what they need:
 *   - a number            -> currency + localised number
 *   - a date string/Date  -> localised long date
 *   - { amount, unit }    -> localised unit value (auto metric/imperial)
 *   - { date }            -> localised date
 *   - { price }           -> localised currency
 *
 * @param {number|string|Date|Object} value - Value to format
 * @param {string} locale - Locale code, e.g. 'en-US', 'de-DE'
 * @param {string} currencyCode - ISO 4217 code, e.g. 'USD', 'EUR'
 * @returns {Object} Formatted representations with `locale`/`currencyCode` echo
 */
function formatRegionalValues(value, locale = 'en-US', currencyCode = 'USD') {
  const result = {
    locale,
    currencyCode,
    currency: null,
    number: null,
    date: null,
    unit: null,
    raw: value
  };

  if (value === null || value === undefined) {
    return result;
  }

  // Date objects and date-like strings
  const isDateObject = value instanceof Date;
  const isDateString =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}([T\s].*)?$/.test(value.trim());

  if (isDateObject || isDateString) {
    result.date = formatDateForLocale(value, locale);
    return result;
  }

  // Plain numbers
  if (typeof value === 'number') {
    result.currency = formatRegionalValue(value, locale, currencyCode);
    result.number = formatLocalizedNumber(value, locale);
    return result;
  }

  // Structured values
  if (typeof value === 'object') {
    if (value.amount !== undefined && value.unit !== undefined) {
      result.unit = formatUnitForLocale(value.amount, value.unit, locale);
    }

    if (value.unit !== undefined && value.amount === undefined) {
      result.unit = formatUnitForLocale(value.value, value.unit, locale);
    }

    const priceSource =
      value.currency !== undefined ? value.currency
      : value.price !== undefined ? value.price
      : value.value;

    const hasMoney =
      (value.price !== undefined || value.currency !== undefined || value.currencyCode !== undefined) &&
      typeof priceSource === 'number';

    if (hasMoney) {
      result.currency = formatRegionalValue(
        priceSource,
        locale,
        value.currencyCode || currencyCode
      );
      result.number = formatLocalizedNumber(priceSource, locale);
    }

    if (value.date !== undefined) {
      result.date = formatDateForLocale(value.date, locale);
    }

    return result;
  }

  // Numeric strings
  if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
    const numeric = Number(value);
    result.currency = formatRegionalValue(numeric, locale, currencyCode);
    result.number = formatLocalizedNumber(numeric, locale);
    return result;
  }

  return result;
}

/**
 * Format a bare number using locale grouping and decimal separators.
 */
function formatLocalizedNumber(value, locale = 'en-US') {
  if (typeof value !== 'number' || isNaN(value)) return '0';

  const parsed = parseLocale(locale);
  const localeString = parsed.language !== 'x-default'
    ? parsed.language + (parsed.country ? `-${parsed.country}` : '')
    : 'en-US';

  try {
    return new Intl.NumberFormat(localeString, { maximumFractionDigits: 2 }).format(value);
  } catch (e) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
}

/**
 * Format date for locale
 *
 * @param {string|Date} dateInput - Date to format
 * @param {string} locale - Locale code
 * @param {string} currencyCode - Currency code (for context)
 * @returns {string} Formatted date string
 */
function formatDateForLocale(dateInput, locale = 'en-US', currencyCode = 'USD') {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);

  if (isNaN(date.getTime())) {
    return 'Invalid date';
  }

  const parsed = parseLocale(locale);
  const localeString = parsed.language !== 'x-default'
    ? parsed.language + (parsed.country ? `-${parsed.country}` : '')
    : 'en-US';

  try {
    const options = {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    };

    const formatter = new Intl.DateTimeFormat(localeString, options);
    return formatter.format(date);
  } catch (e) {
    // Fallback
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
}

/**
 * Singular forms for countable units (avoids naive suffix stripping).
 */
const UNIT_SINGULARS = {
  miles: 'mile',
  kilometers: 'kilometer',
  pounds: 'pound',
  kilograms: 'kilogram',
  liters: 'liter',
  gallons: 'gallon'
};

/**
 * Format units for locale
 *
 * @param {number} value - Value to format
 * @param {string} unit - Unit type (e.g., 'kilometers', 'miles', 'kilograms', 'pounds')
 * @param {string} locale - Locale code
 * @returns {string} Formatted unit string
 */
function formatUnitForLocale(value, unit = 'kilometers', locale = 'en-US') {
  if (typeof value !== 'number' || isNaN(value)) {
    return '0 ' + unit;
  }

  const parsed = parseLocale(locale);
  const language = parsed.language !== 'x-default' ? parsed.language : 'en';

  // Convert between metric and imperial based on locale
  let displayValue = value;
  let displayUnit = unit;

  const metricLocales = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ko', 'jp', 'se', 'no', 'dk', 'fi'];
  const usesMetric = metricLocales.includes(language);

  if (unit === 'miles' && usesMetric) {
    displayValue = value * 1.60934;
    displayUnit = 'kilometers';
  } else if (unit === 'kilometers' && !usesMetric) {
    displayValue = value / 1.60934;
    displayUnit = 'miles';
  } else if (unit === 'pounds' && usesMetric) {
    displayValue = value * 0.453592;
    displayUnit = 'kilograms';
  } else if (unit === 'kilograms' && !usesMetric) {
    displayValue = value / 0.453592;
    displayUnit = 'pounds';
  } else if (unit === 'celsius' && !usesMetric) {
    displayValue = (value * 9/5) + 32;
    displayUnit = 'fahrenheit';
  } else if (unit === 'fahrenheit' && usesMetric) {
    displayValue = (value - 32) * 5/9;
    displayUnit = 'celsius';
  }

  // Format the value
  const formattedValue = displayValue.toLocaleString(
    language !== 'x-default' ? language + (parsed.country ? `-${parsed.country}` : '') : 'en-US',
    { maximumFractionDigits: 1 }
  );

  // Pluralize the CONVERTED unit using an explicit singular map. Blindly
  // stripping a trailing 's' would mangle non-plural units like 'celsius'.
  const isSingular = Number(displayValue.toFixed(1)) === 1;
  const displayUnitLabel = isSingular
    ? (UNIT_SINGULARS[displayUnit] || displayUnit)
    : displayUnit;

  return `${formattedValue} ${displayUnitLabel}`;
}

/**
 * Format temperature for locale
 */
function formatTemperatureForLocale(celsius, locale = 'en-US') {
  const parsed = parseLocale(locale);
  const language = parsed.language !== 'x-default' ? parsed.language : 'en';

  const metricLocales = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ko', 'jp', 'se', 'no', 'dk', 'fi'];
  const usesMetric = metricLocales.includes(language);

  let displayValue = celsius;
  let unit = '°C';

  if (!usesMetric) {
    displayValue = (celsius * 9/5) + 32;
    unit = '°F';
  }

  return `${displayValue.toFixed(1)} ${unit}`;
}

/**
 * Format weight for locale
 */
function formatWeightForLocale(kilograms, locale = 'en-US') {
  const parsed = parseLocale(locale);
  const language = parsed.language !== 'x-default' ? parsed.language : 'en';

  const metricLocales = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ko', 'jp', 'se', 'no', 'dk', 'fi'];
  const usesMetric = metricLocales.includes(language);

  let displayValue = kilograms;
  let unit = 'kg';

  if (!usesMetric) {
    displayValue = kilograms * 2.20462;
    unit = 'lbs';
  }

  return `${displayValue.toFixed(2)} ${unit}`;
}

/**
 * Format distance for locale
 */
function formatDistanceForLocale(kilometers, locale = 'en-US') {
  const parsed = parseLocale(locale);
  const language = parsed.language !== 'x-default' ? parsed.language : 'en';

  const metricLocales = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ko', 'jp', 'se', 'no', 'dk', 'fi'];
  const usesMetric = metricLocales.includes(language);

  let displayValue = kilometers;
  let unit = 'km';

  if (!usesMetric) {
    displayValue = kilometers * 0.621371;
    unit = 'mi';
  }

  return `${displayValue.toFixed(1)} ${unit}`;
}

/**
 * Format volume for locale
 */
function formatVolumeForLocale(liters, locale = 'en-US') {
  const parsed = parseLocale(locale);
  const language = parsed.language !== 'x-default' ? parsed.language : 'en';

  const metricLocales = ['de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'zh', 'ko', 'jp', 'se', 'no', 'dk', 'fi'];
  const usesMetric = metricLocales.includes(language);

  let displayValue = liters;
  let unit = 'L';

  if (!usesMetric) {
    displayValue = liters * 0.264172;
    unit = 'gal';
  }

  return `${displayValue.toFixed(2)} ${unit}`;
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Hreflang matrix
  generateHreflangMatrix,
  isValidLocaleCode,
  parseLocale,
  getSupportedLocales,
  getLanguageName,
  getCountryName,

  // Hreflang injection
  generateHreflangTagsString,
  injectHreflangTags,
  generateHreflangTagSet,
  getBaseUrl,

  // Regional formatting
  formatRegionalValues,
  formatRegionalValue,
  formatLocalizedNumber,
  formatDateForLocale,
  formatUnitForLocale,
  formatTemperatureForLocale,
  formatWeightForLocale,
  formatDistanceForLocale,
  formatVolumeForLocale,

  // Utilities
  LANGUAGE_CODES,
  COUNTRY_CODES,
  DEFAULT_LOCALES,
  UNIT_SINGULARS,

  // For testing
  _test: {
    generateHreflangMatrix,
    isValidLocaleCode,
    parseLocale,
    getSupportedLocales,
    getLanguageName,
    getCountryName,
    generateHreflangTagsString,
    injectHreflangTags,
    generateHreflangTagSet,
    getBaseUrl,
    formatRegionalValues,
    formatRegionalValue,
    formatLocalizedNumber,
    formatDateForLocale,
    formatUnitForLocale,
    formatTemperatureForLocale,
    formatWeightForLocale,
    formatDistanceForLocale,
    formatVolumeForLocale
  }
};

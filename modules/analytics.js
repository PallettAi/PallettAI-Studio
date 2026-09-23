// ============================================================
// PallettAI Studio — Privacy-First Zero-Server Analytics Injector
// Supports Plausible, Fathom, Cloudflare Web Analytics, GA4, and
// custom self-hosted beacons with a lightweight event tracker helper.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Provider Configuration Templates
// ============================================================

const PROVIDER_CONFIGS = {
  plausible: {
    name: 'Plausible',
    defaultDomain: 'plausible.io',
    scriptUrl: (domain, siteId, customDomain) => {
      const base = customDomain || `https://${domain}`;
      return `${base}/js/script.js`;
    },
    enqueueUrl: (domain, siteId, customDomain) => {
      const base = customDomain || `https://${domain}`;
      return `${base}/js/script.js`;
    },
    injectSnippet: (siteId, customDomain) => {
      const scriptUrl = PROVIDER_CONFIGS.plausible.scriptUrl(
        PROVIDER_CONFIGS.plausible.defaultDomain,
        siteId,
        customDomain
      );
      return `<script defer data-domain="${siteId}" src="${scriptUrl}"></script>`;
    }
  },

  fathom: {
    name: 'Fathom',
    defaultDomain: 'fathom.io',
    scriptUrl: (domain, siteId, customDomain) => {
      const base = customDomain || `https://cdn.usefathom.com`;
      return `${base}/script.js`;
    },
    injectSnippet: (siteId, customDomain) => {
      const scriptUrl = PROVIDER_CONFIGS.fathom.scriptUrl(
        PROVIDER_CONFIGS.fathom.defaultDomain,
        siteId,
        customDomain
      );
      return `<script defer src="${scriptUrl}" data-site="${siteId}"></script>`;
    }
  },

  cloudflare: {
    name: 'Cloudflare Web Analytics',
    defaultDomain: 'cloudflare.com',
    injectSnippet: (siteId, customDomain) => {
      // Cloudflare uses a script with async and their beacon endpoint
      return `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${siteId}"}'></script>`;
    }
  },

  ga4: {
    name: 'Google Analytics 4',
    defaultDomain: 'google-analytics.com',
    injectSnippet: (siteId, customDomain) => {
      // GA4 uses G-XXXXXXXXXX format measurement ID
      return `
<script async src="https://www.googletagmanager.com/gtag/js?id=${siteId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${siteId}');
</script>`.trim();
    }
  },

  self_hosted: {
    name: 'Self-Hosted Beacon',
    defaultDomain: 'beacon.example.com',
    injectSnippet: (siteId, customDomain) => {
      // Custom self-hosted analytics endpoint
      const beaconUrl = customDomain || 'https://your-beacon.example.com/collect';
      return `<script>
(function() {
  var d = document, r = d.location.protocol === 'https:' ? 'https:' : 'http:',
      b = d.createElement('img');
  b.height = 1;
  b.width = 1;
  b.style.position = 'absolute';
  b.style.left = '-9999px';
  b.src = '${beaconUrl}?id=${siteId}&url=' + encodeURIComponent(d.location.href) + '&r=' + Math.random();
  d.body.appendChild(b);
})();
</script>`.trim();
    }
  }
};

// ============================================================
// Public API
// ============================================================

/**
 * Get list of supported analytics providers
 */
function getSupportedProviders() {
  return Object.keys(PROVIDER_CONFIGS);
}

/**
 * Validate provider name
 */
function isValidProvider(provider) {
  return getSupportedProviders().includes(provider);
}

/**
 * Inject analytics script snippet for a given provider
 *
 * @param {string} provider - Analytics provider name (plausible, fathom, cloudflare, ga4, self_hosted)
 * @param {string} siteId - Provider-specific site/measurement ID
 * @param {string} customDomain - Optional custom domain for self-hosted or custom endpoints
 * @returns {string} HTML snippet to inject into <head>
 */
function injectAnalyticsScript(provider, siteId, customDomain) {
  if (!isValidProvider(provider)) {
    throw new Error(`Unknown analytics provider: "${provider}". Supported: ${getSupportedProviders().join(', ')}`);
  }

  if (!siteId || typeof siteId !== 'string') {
    throw new Error('siteId is required and must be a non-empty string');
  }

  const config = PROVIDER_CONFIGS[provider];

  if (typeof config.injectSnippet !== 'function') {
    throw new Error(`Provider "${provider}" does not support snippet injection`);
  }

  try {
    return config.injectSnippet(siteId, customDomain);
  } catch (e) {
    throw new Error(`Failed to generate snippet for ${provider}: ${e.message}`);
  }
}

/**
 * Generate a complete analytics block with script and optional noscript fallback
 *
 * @param {string} provider - Analytics provider name
 * @param {string} siteId - Provider-specific site/measurement ID
 * @param {Object} options - Additional options
 * @param {string} options.customDomain - Custom domain for tracking
 * @param {boolean} options.noscriptFallback - Include noscript fallback (default: false)
 * @returns {string} Complete analytics HTML block
 */
function generateAnalyticsBlock(provider, siteId, options = {}) {
  const {
    customDomain,
    noscriptFallback = false
  } = options;

  const snippet = injectAnalyticsScript(provider, siteId, customDomain);

  if (!noscriptFallback) {
    return snippet;
  }

  // Add noscript fallback for providers that support it
  const config = PROVIDER_CONFIGS[provider];
  let noscript = '';

  switch (provider) {
    case 'plausible':
      noscript = `<noscript><img src="https://${config.defaultDomain}/api/stat?site=${siteId}" alt="" style="width:1px;height:1px" /></noscript>`;
      break;
    case 'fathom':
      noscript = `<noscript><img src="https://api.usefathom.com/track?site=${siteId}" alt="" style="width:1px;height:1px" /></noscript>`;
      break;
    default:
      noscript = '';
  }

  return `${snippet}\n${noscript}`.trim();
}

/**
 * Generate inline script for event tracking helper
 * This creates window.paiTrack() function that forwards events to the configured provider
 *
 * @param {string} provider - Analytics provider name
 * @param {string} siteId - Provider-specific site/measurement ID
 * @returns {string} JavaScript code for event tracking helper
 */
function generateEventTrackerScript(provider, siteId) {
  const config = PROVIDER_CONFIGS[provider];
  const providerName = config.name;

  // Different providers expose different APIs for events
  const eventHandlers = {
    plausible: `// Plausible event tracking
window.paiTrack = window.paiTrack || function(eventName, properties) {
  if (typeof window.plausible === 'function') {
    try {
      const dataLayer = {
        event: eventName,
        ...properties
      };
      window.plausible(eventName, {
        props: properties || {}
      });
    } catch (e) {
      // Silently fail if Plausible is blocked
    }
  }
  // Also push to dataLayer for GA4 compatibility
  if (window.dataLayer) {
    window.dataLayer.push({
      event: eventName,
      ...properties
    });
  }
};`,

    fathom: `// Fathom event tracking
window.paiTrack = window.paiTrack || function(eventName, properties) {
  if (typeof window.fathom === 'function') {
    try {
      window.fathom(trackEvent, {
        eventName: eventName,
        ...properties
      });
    } catch (e) {
      // Silently fail if Fathom is blocked
    }
  }
  // Also push to dataLayer for GA4 compatibility
  if (window.dataLayer) {
    window.dataLayer.push({
      event: eventName,
      ...properties
    });
  }
};`,

    ga4: `// Google Analytics 4 event tracking
window.paiTrack = window.paiTrack || function(eventName, properties) {
  if (window.gtag) {
    try {
      gtag('event', eventName, properties || {});
    } catch (e) {
      // Silently fail if GA is blocked
    }
  }
  // Also push to dataLayer
  if (window.dataLayer) {
    window.dataLayer.push({
      event: eventName,
      ...properties
    });
  }
};`,

    cloudflare: `// Cloudflare Web Analytics event tracking
window.paiTrack = window.paiTrack || function(eventName, properties) {
  if (window.__cf_beacon) {
    try {
      window.__cf_beacon.push({
        event: eventName,
        ...properties
      });
    } catch (e) {
      // Silently fail
    }
  }
};`,

    self_hosted: `// Self-hosted beacon event tracking
window.paiTrack = window.paiTrack || function(eventName, properties) {
  var img = new Image();
  var beaconUrl = '${provider === 'self_hosted' ? 'YOUR_BEACON_URL' : ''}';
  var data = {
    event: eventName,
    timestamp: new Date().toISOString(),
    url: window.location.href,
    referrer: document.referrer,
    ...properties
  };
  img.src = beaconUrl + '?' + encodeURIComponent(JSON.stringify(data));
  img.style.display = 'none';
};`
  };

  return eventHandlers[provider] || eventHandlers.ga4;
}

/**
 * Create a complete analytics injection with tracking helper
 *
 * @param {string} provider - Analytics provider name
 * @param {string} siteId - Provider-specific site/measurement ID
 * @param {Object} options - Additional options
 * @param {boolean} options.includeTracker - Include event tracking helper (default: true)
 * @param {string} options.trackerVarName - Variable name for tracker (default: 'paiTrack')
 * @returns {string} Complete HTML block
 */
function createAnalyticsSetup(provider, siteId, options = {}) {
  const {
    includeTracker = true,
    trackerVarName = 'paiTrack'
  } = options;

  const block = generateAnalyticsBlock(provider, siteId);

  if (!includeTracker) {
    return block;
  }

  const trackerScript = generateEventTrackerScript(provider, siteId);

  return `${block}\n\n<script>\n${trackerScript}\n</script>`.trim();
}

/**
 * Minify an HTML snippet by removing unnecessary whitespace
 * Note: This is a basic minifier - for production, consider using a proper minifier
 */
function minifySnippet(snippet) {
  return snippet
    .replace(/<!--[\s\S]*?-->/g, '') // Remove HTML comments
    .replace(/[\n\r\t]+/g, ' ') // Replace newlines, returns, tabs with spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .replace(/\s*</g, '<') // Remove space before opening tags
    .replace(/>\s*/g, '>') // Remove space after closing tags
    .replace(/>\s+</g, '><') // Remove space between tags (not self-closing)
    .trim();
}

/**
 * Escape HTML entities in a string
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
  // Core functions
  injectAnalyticsScript,
  generateAnalyticsBlock,
  createAnalyticsSetup,
  minifySnippet,

  // Event tracking
  generateEventTrackerScript,

  // Utilities
  getSupportedProviders,
  isValidProvider,
  escapeHtml,

  // For testing
  _test: {
    PROVIDER_CONFIGS,
    getSupportedProviders,
    isValidProvider,
    injectAnalyticsScript,
    generateEventTrackerScript,
    minifySnippet
  }
};

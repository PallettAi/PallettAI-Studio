// ============================================================
// PallettAI Studio — Schema.org Deep Graph & Sitemap Generator
// Generates enterprise-grade SEO markup including JSON-LD graphs,
// sitemap.xml with hreflang mappings, and robots.txt files.
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// Helpers
// ============================================================

/**
 * Escape string for XML output
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
 * Format date to ISO 8601 (W3C Datetime)
 */
function formatDate(date) {
  if (!date) return new Date().toISOString();

  if (date instanceof Date) {
    return date.toISOString();
  }

  // Try parsing various date formats
  const d = new Date(date);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }

  // Return current date if parsing fails
  return new Date().toISOString();
}

/**
 * Normalize URL
 */
function normalizeUrl(url, domain) {
  if (!url) return '';

  // If it's a full URL, return as-is
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  // If it starts with /, it's a relative URL
  if (url.startsWith('/')) {
    return `${domain}${url}`;
  }

  // Otherwise, prepend with /
  return `${domain}/${url}`;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

/**
 * Validate phone format (basic)
 */
function isValidPhone(phone) {
  if (!phone) return false;
  // Basic check for digits, spaces, dashes, plus, parentheses
  const re = /^[\d\s\-\+\(\)]{7,}$/;
  return re.test(phone);
}

// ============================================================
// Schema.org Graph Generation
// ============================================================

/**
 * Generate a JSON-LD script tag for a schema graph
 */
function generateJsonLdScript(graph) {
  const json = JSON.stringify(graph, null, 2);
  return `<script type="application/ld+json">\n${json}\n<\/script>`;
}

/**
 * Main function to generate a comprehensive Schema.org graph
 *
 * @param {Object} projectSchema - Project schema configuration
 * @param {Object} projectSchema.business - Business/organization info
 * @param {Object} projectSchema.business.name - Business name
 * @param {Object} projectSchema.business.logo - Logo URL
 * @param {Object} projectSchema.business.address - Physical address
 * @param {Object} projectSchema.business.geo - Geo coordinates {latitude, longitude}
 * @param {Object} projectSchema.business.openingHours - Opening hours spec
 * @param {Object} projectSchema.business.telephone - Phone number
 * @param {Object} projectSchema.business.email - Email address
 * @param {Object} projectSchema.products - Array of product schemas
 * @param {Object} projectSchema.faqs - FAQ items (converted to FAQPage)
 * @param {Object} projectSchema.jobs - Job postings
 * @param {Object} projectSchema.articles - Articles/content
 * @param {Object} projectSchema.website - Website metadata
 * @returns {string} JSON-LD script tags
 */
function generateSchemaGraph(projectSchema) {
  const graphs = [];

  const {
    business,
    products = [],
    faqs = [],
    jobs = [],
    articles = [],
    website = {}
  } = projectSchema;

  // 1. Organization / LocalBusiness schema
  if (business) {
    const orgGraph = buildOrganizationSchema(business);
    if (orgGraph) {
      graphs.push(orgGraph);
    }
  }

  // 2. Product & Offer schemas
  if (Array.isArray(products) && products.length > 0) {
    for (const product of products) {
      const productGraph = buildProductSchema(product, business);
      if (productGraph) {
        graphs.push(productGraph);
      }
    }
  }  // 3. FAQPage schema
  if (Array.isArray(faqs) && faqs.length > 0) {
    const faqGraph = buildFAQPageSchema(faqs);
    if (faqGraph) {
      graphs.push(faqGraph);
    }
  } else if (faqs && faqs.length === 0) {
    // Handle empty FAQs array gracefully - skip
  }

  // 4. JobPosting schemas
  if (Array.isArray(jobs) && jobs.length > 0) {
    for (const job of jobs) {
      const jobGraph = buildJobPostingSchema(job, business);
      if (jobGraph) {
        graphs.push(jobGraph);
      }
    }
  }

  // 5. Article schemas
  if (Array.isArray(articles) && articles.length > 0) {
    for (const article of articles) {
      const articleGraph = buildArticleSchema(article, business, website);
      if (articleGraph) {
        graphs.push(articleGraph);
      }
    }
  }

  // 6. Website/WebSite schema (if applicable)
  if (website.url) {
    const webGraph = buildWebSiteSchema(website, business);
    if (webGraph) {
      graphs.push(webGraph);
    }
  }

  // Combine all graphs into one JSON-LD script
  // JSON-LD allows multiple @graph entries
  if (graphs.length === 0) {
    return '';
  }

  if (graphs.length === 1) {
    return generateJsonLdScript(graphs[0]);
  }

  // Multiple graphs - wrap in @graph
  const combined = { '@graph': graphs };
  return generateJsonLdScript(combined);
}

/**
 * Build Organization schema
 */
function buildOrganizationSchema(business) {
  const org = {
    '@context': 'https://schema.org',
    '@type': 'Organization'
  };

  // Name
  if (business.name) {
    org.name = business.name;
  } else {
    return null;
  }

  // URL
  if (business.url) {
    org.url = business.url;
  }

  // Logo
  if (business.logo) {
    org.logo = business.logo;
  }

  // Description
  if (business.description) {
    org.description = business.description;
  }

  // Contact info
  if (business.email && isValidEmail(business.email)) {
    org.email = business.email;
  }

  if (business.telephone && isValidPhone(business.telephone)) {
    org.telephone = business.telephone;
  }

  // Address
  if (business.address) {
    org.address = buildPostalAddress(business.address);
  }

  // Geo coordinates
  if (business.geo && business.geo.latitude != null && business.geo.longitude != null) {
    org.geo = {
      '@type': 'GeoCoordinates',
      latitude: parseFloat(business.geo.latitude),
      longitude: parseFloat(business.geo.longitude)
    };
  }

  // Opening hours
  if (business.openingHours) {
    org.openingHoursSpecification = buildOpeningHours(business.openingHours);
  }

  // Social media profiles
  if (business.socialProfiles && Array.isArray(business.socialProfiles)) {
    org.sameAs = business.socialProfiles
      .filter(sp => sp.url)
      .map(sp => sp.url);
  }

  // Area served
  if (business.areaServed) {
    org.areaServed = business.areaServed;
  }

  // Founding date
  if (business.foundingDate) {
    org.foundingDate = business.foundingDate;
  }

  return org;
}

/**
 * Build LocalBusiness schema (more specific than Organization)
 */
function buildLocalBusinessSchema(business) {
  const localBiz = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness'
  };

  // Copy common fields from organization
  if (business.name) localBiz.name = business.name;
  if (business.url) localBiz.url = business.url;
  if (business.logo) localBiz.logo = business.logo;
  if (business.description) localBiz.description = business.description;
  if (business.email && isValidEmail(business.email)) localBiz.email = business.email;
  if (business.telephone && isValidPhone(business.telephone)) localBiz.telephone = business.telephone;
  if (business.address) localBiz.address = buildPostalAddress(business.address);
  if (business.geo && business.geo.latitude != null && business.geo.longitude != null) {
    localBiz.geo = {
      '@type': 'GeoCoordinates',
      latitude: parseFloat(business.geo.latitude),
      longitude: parseFloat(business.geo.longitude)
    };
  }

  // Business type
  if (business.businessType) {
    localBiz.department = business.businessType;
  }

  // Price range
  if (business.priceRange) {
    localBiz.priceRange = business.priceRange;
  }

  // Opening hours
  if (business.openingHours) {
    localBiz.openingHoursSpecification = buildOpeningHours(business.openingHours);
  }

  // Payment accepted
  if (business.paymentAccepted) {
    localBiz.paymentAccepted = business.paymentAccepted;
  }

  // Brands
  if (business.brands && Array.isArray(business.brands)) {
    localBiz.brand = business.brands.map(b => b.name || b);
  }

  return localBiz;
}

/**
 * Build PostalAddress schema
 */
function buildPostalAddress(address) {
  const addr = {
    '@type': 'PostalAddress'
  };

  if (address.streetAddress) addr.streetAddress = address.streetAddress;
  if (address.addressLocality) addr.addressLocality = address.addressLocality;
  if (address.addressRegion) addr.addressRegion = address.addressRegion;
  if (address.postalCode) addr.postalCode = address.postalCode;
  if (address.addressCountry) addr.addressCountry = address.addressCountry;
  if (address.addressLocality) addr.addressLocality = address.addressLocality;

  // If we have no fields set, return null
  const hasFields = address.streetAddress || address.addressLocality ||
                    address.addressRegion || address.postalCode ||
                    address.addressCountry;

  return hasFields ? addr : null;
}

/**
 * Build OpeningHoursSpecification
 */
function buildOpeningHours(hours) {
  if (!hours || typeof hours !== 'object') return null;

  const specs = [];

  // Handle simple format: { monday: "9:00-17:00", tuesday: "9:00-17:00", ... }
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  for (const day of dayNames) {
    if (hours[day]) {
      const spec = {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: day.charAt(0).toUpperCase() + day.slice(1)
      };

      const timeRange = hours[day];
      if (typeof timeRange === 'string') {
        const parts = timeRange.split('-');
        if (parts.length === 2) {
          spec.openingTime = parts[0].trim();
          spec.closingTime = parts[1].trim();
        }
      } else if (timeRange.open && timeRange.close) {
        spec.openingTime = timeRange.open;
        spec.closingTime = timeRange.close;
      }

      if (spec.openingTime || spec.closingTime) {
        specs.push(spec);
      }
    }
  }

  // Handle complex format: [{ dayOfWeek: "Monday", opens: "09:00", closes: "17:00" }, ...]
  if (Array.isArray(hours)) {
    for (const h of hours) {
      if (h.dayOfWeek && (h.opens || h.closes)) {
        specs.push({
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: h.dayOfWeek,
          opens: h.opens,
          closes: h.closes
        });
      }
    }
  }

  return specs.length > 0 ? specs : null;
}

/**
 * Build Product schema with Offer
 */
function buildProductSchema(product, business) {
  const prod = {
    '@context': 'https://schema.org',
    '@type': 'Product'
  };

  if (!product.name && !product.description) {
    return null;
  }

  prod.name = product.name || product.title;
  prod.description = product.description || product.summary || '';

  // Image
  if (product.image) {
    prod.image = Array.isArray(product.image) ? product.image : [product.image];
  }

  // SKU / GTIN
  if (product.sku) prod.sku = product.sku;
  if (product.gtin) prod.gtin = product.gtin;
  if (product.mpn) prod.mpn = product.mpn;

  // Brand
  if (product.brand) {
    prod.brand = {
      '@type': 'Brand',
      name: typeof product.brand === 'string' ? product.brand : product.brand.name || product.brand
    };
  } else if (business && business.name) {
    prod.brand = {
      '@type': 'Brand',
      name: business.name
    };
  }

  // Review/rating
  if (product.reviews && Array.isArray(product.reviews) && product.reviews.length > 0) {
    prod.review = product.reviews.map(r => buildReviewSchema(r));
  }

  // Aggregate rating
  if (product.aggregateRating) {
    prod.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.aggregateRating.ratingValue || 0,
      reviewCount: product.aggregateRating.reviewCount || 0,
      bestRating: product.aggregateRating.bestRating || 5,
      worstRating: product.aggregateRating.worstRating || 1
    };
  }

  // Offer
  if (product.offers || product.price != null) {
    prod.offers = buildOfferSchema(
      Object.assign({}, product.offers || {}, {
        price: product.price,
        priceCurrency: product.currency || 'USD',
        availability: product.availability
      }),
      business
    );
  }

  return prod;
}

/**
 * Build Offer schema
 */
function buildOfferSchema(offer, business) {
  const offerSchema = {
    '@type': 'Offer',
    priceCurrency: (offer.priceCurrency || 'USD').toUpperCase(),
    price: parseFloat(offer.price || 0),
    availability: mapAvailability(offer.availability || 'inStock')
  };

  if (offer.priceValidUntil) {
    offerSchema.priceValidUntil = formatDate(offer.priceValidUntil);
  }

  if (offer.itemCondition) {
    offerSchema.itemCondition = offer.itemCondition;
  }

  if (offer.availabilityText) {
    offerSchema.availability = offer.availabilityText;
  }

  // Seller
  if (business && business.name) {
    offerSchema.seller = {
      '@type': 'Organization',
      name: business.name
    };
  }

  if (offer.url) {
    offerSchema.url = offer.url;
  }

  return offerSchema;
}

/**
 * Map availability text to schema.org values
 */
function mapAvailability(avail) {
  const availMap = {
    'inStock': 'https://schema.org/InStock',
    'in stock': 'https://schema.org/InStock',
    'outOfStock': 'https://schema.org/OutOfStock',
    'out of stock': 'https://schema.org/OutOfStock',
    'preOrder': 'https://schema.org/PreOrder',
    'pre-order': 'https://schema.org/PreOrder',
    'backorder': 'https://schema.org/BackOrder',
    'discontinued': 'https://schema.org/Discontinued',
    'bundle': 'https://schema.org/Bundle'
  };

  const key = avail.toLowerCase().replace(/\s+/g, '');
  return availMap[key] || 'https://schema.org/InStock';
}

/**
 * Build Review schema
 */
function buildReviewSchema(review) {
  const rev = {
    '@type': 'Review'
  };

  if (review.author) {
    rev.author = {
      '@type': 'Person',
      name: review.author
    };
  }

  if (review.datePublished) {
    rev.datePublished = formatDate(review.datePublished);
  }

  if (review.reviewRating) {
    rev.reviewRating = {
      '@type': 'Rating',
      ratingValue: review.reviewRating.ratingValue || review.reviewRating.value || 0,
      bestRating: review.reviewRating.bestRating || 5,
      worstRating: review.reviewRating.worstRating || 1
    };
  }

  if (review.reviewBody) {
    rev.reviewBody = review.reviewBody;
  }

  if (review.name) {
    rev.name = review.name || review.headline;
  }

  return rev;
}

/**
 * Build FAQPage schema from FAQ items
 */
function buildFAQPageSchema(faqs) {
  if (!Array.isArray(faqs) || faqs.length === 0) return null;

  // Check if any FAQs have question/answer
  const validFaqs = faqs.filter(f => f.question || f.q);
  if (validFaqs.length === 0) return null;

  const mainEntity = validFaqs.map(faq => ({
    '@type': 'Question',
    name: faq.question || faq.q || '',
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer || faq.a || ''
    }
  }));

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: mainEntity
  };
}

/**
 * Build JobPosting schema
 */
function buildJobPostingSchema(job, business) {
  if (!job.title) return null;

  const jobSchema = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting'
  };

  jobSchema.title = job.title;
  jobSchema.description = job.description || '';
  jobSchema.hiringOrganization = {
    '@type': 'Organization',
    name: business ? business.name : (job.company || '')
  };

  if (job.url) {
    jobSchema.jobPostingUrl = job.url;
  }

  if (job.location) {
    const loc = job.location;

    // If it's a string, wrap in Place
    if (typeof loc === 'string') {
      jobSchema.jobLocation = {
        '@type': 'Place',
        address: {
          '@type': 'PostalAddress',
          addressLocality: loc
        }
      };
    } else {
      // Object format
      jobSchema.jobLocation = {
        '@type': 'Place',
        address: buildPostalAddress(loc)
      };
    }
  }

  if (job.employmentType) {
    jobSchema.employmentType = job.employmentType;
  }

  if (job.datePosted) {
    jobSchema.datePosted = formatDate(job.datePosted);
  }

  if (job.baseSalary) {
    jobSchema.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.baseSalary.currency || 'USD',
      value: job.baseSalary.value || job.baseSalary.amount
    };
  }

  if (job.requirements) {
    jobSchema.educationRequirements = job.requirements;
  }

  if (job.directApply !== undefined) {
    jobSchema.directApply = job.directApply;
  }

  return jobSchema;
}

/**
 * Build Article schema
 */
function buildArticleSchema(article, business, website) {
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': article.type || 'Article'
  };

  if (!article.headline && !article.title) {
    return null;
  }

  articleSchema.headline = article.headline || article.title;
  articleSchema.description = article.description || article.summary || '';

  if (article.datePublished) {
    articleSchema.datePublished = formatDate(article.datePublished);
  }

  if (article.dateModified) {
    articleSchema.dateModified = formatDate(article.dateModified);
  }

  if (article.author) {
    const author = article.author;

    if (typeof author === 'string') {
      articleSchema.author = {
        '@type': 'Person',
        name: author
      };
    } else if (author.name) {
      if (author.type === 'Organization') {
        articleSchema.author = {
          '@type': 'Organization',
          name: author.name
        };
      } else {
        articleSchema.author = {
          '@type': 'Person',
          name: author.name
        };
      }
    }
  }

  if (article.publisher) {
    const pub = article.publisher;

    if (typeof pub === 'string') {
      articleSchema.publisher = {
        '@type': 'Organization',
        name: pub
      };
    } else if (pub.name) {
      articleSchema.publisher = {
        '@type': 'Organization',
        name: pub.name,
        logo: pub.logo
      };
    }
  }

  // Image
  if (article.image) {
    articleSchema.image = Array.isArray(article.image) ? article.image : [article.image];
  }

  // URL
  if (article.url) {
    articleSchema.url = article.url;
  } else if (website && website.url) {
    articleSchema.url = `${website.url}/${article.slug || article.id || ''}`.replace(/\/+/g, '/');
  }

  // Article-specific fields
  if (article.type === 'NewsArticle') {
    if (article.keywords) articleSchema.keywords = article.keywords;
    if (article.articleSection) articleSchema.articleSection = article.articleSection;
  }

  if (article.type === 'BlogPosting') {
    if (article.blogPostCategory) articleSchema.blogPostCategory = article.blogPostCategory;
  }

  if (article.wordCount) {
    articleSchema.wordCount = article.wordCount;
  }

  return articleSchema;
}

/**
 * Build WebSite schema
 */
function buildWebSiteSchema(website, business) {
  const siteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    url: website.url || '',
    name: website.name || (business && business.name) || ''
  };

  if (website.description) {
    siteSchema.description = website.description;
  }

  if (website.searchUrl) {
    siteSchema.potentialAction = {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: website.searchUrl
      },
      queryInput: 'required'
    };
  }

  if (business && business.logo) {
    siteSchema.logo = business.logo;
  }

  return siteSchema;
}

// ============================================================
// Sitemap Generation
// ============================================================

/**
 * Generate a sitemap XML string
 *
 * @param {Object} projectSchema - Project schema with pages
 * @param {string} projectSchema.domain - Base domain
 * @param {Array} projectSchema.pages - Array of page objects
 * @param {Array} projectSchema.locales - Supported locales
 * @returns {string} Complete sitemap XML
 */
function generateSitemap(projectSchema) {
  const {
    domain = '',
    pages = [],
    locales = ['en'],
    lastmod: defaultLastMod
  } = projectSchema;

  const xmlns = 'http://www.sitemaps.org/schemas/sitemap/0.9';
  const xhtml = 'http://www.w3.org/1999/xhtml';

  // Build XML
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="${xmlns}"`;
  if (locales.length > 1) {
    xml += ` xmlns:xhtml="${xhtml}"`;
  }
  xml += `>\n`;

  // Track seen URLs to avoid duplicates
  const seenUrls = new Set();

  // Add pages
  for (const page of pages) {
    if (!page.url && !page.locale) continue;

    // Generate entries for each locale if page has multilingual support
    const pageLocales = page.locales || locales;

    for (const locale of pageLocales) {
      const url = normalizeUrl(page.url || (page.locale === locale ? page.url : ''), domain);

      // Skip if we've seen this URL
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      xml += '  <url>\n';

      // Standard loc
      xml += `    <loc>${escapeXml(url)}</loc>\n`;

      // Last modification date
      const lastMod = page.lastmod || defaultLastMod;
      if (lastMod) {
        xml += `    <lastmod>${formatDate(lastMod)}</lastmod>\n`;
      }

      // Change frequency
      if (page.changefreq) {
        xml += `    <changefreq>${escapeXml(page.changefreq)}</changefreq>\n`;
      }

      // Priority
      if (page.priority != null) {
        xml += `    <priority>${escapeXml(String(page.priority))}</priority>\n`;
      }

      // Alternate language links
      if (pageLocales.length > 1 && pageLocales.includes(locale)) {
        for (const altLocale of pageLocales) {
          if (altLocale === locale) continue;

          // Build alternate URL for this locale
          let altUrl = url;

          // If URL doesn't have locale prefix, add one
          if (!url.includes(`/${locale}/`) && !url.endsWith(locale)) {
            // Extract path without locale
            const pathWithoutLocale = url.replace(/\/[a-z]{2}(-[a-zA-Z]{2})?\//, '/');

            // Build alt URL with locale prefix
            const localePath = page.url ? page.url.replace(/^\/+/, '') : '';
            altUrl = `${domain}/${altLocale}/${localePath}`;
          }

          if (altUrl && altUrl !== url) {
            xml += '    <xhtml:link ';
            xml += `rel="alternate" `;
            xml += `hreflang="${altLocale}" `;
            xml += `href="${escapeXml(altUrl)}" `;
            xml += `/>\n`;
          }
        }
      }

      xml += '  </url>\n';
    }
  }

  xml += '</urlset>';

  return xml;
}

/**
 * Build sitemap index for multiple sitemaps
 */
function generateSitemapIndex(sitemaps, domain = '') {
  const xmlns = 'http://www.sitemaps.org/schemas/sitemap/0.9';

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<sitemapindex xmlns="${xmlns}">\n`;

  for (const sitemap of sitemaps) {
    xml += '  <sitemap>\n';
    xml += `    <loc>${escapeXml(sitemap.url || '')}</loc>\n`;

    if (sitemap.lastmod) {
      xml += `    <lastmod>${formatDate(sitemap.lastmod)}</lastmod>\n`;
    }

    xml += '  </sitemap>\n';
  }

  xml += '</sitemapindex>';

  return xml;
}

// ============================================================
// Robots.txt Generation
// ============================================================

/**
 * Generate a robots.txt file
 *
 * @param {string} domain - Base domain
 * @param {boolean} allowIndexing - Whether to allow indexing
 * @param {string} sitemapUrl - URL to sitemap (optional)
 * @returns {string} robots.txt content
 */
function generateRobotsTxt(domain, allowIndexing = true, sitemapUrl = '') {
  const lines = [];

  // User-agent
  lines.push('User-agent: *');
  lines.push('');

  // Allow or disallow
  if (allowIndexing) {
    lines.push('Allow: /');
  } else {
    lines.push('Disallow: /');
  }

  lines.push('');

  // Common crawl directives
  lines.push('# Common crawl directives');
  lines.push('Crawl-delay: 1');
  lines.push('');

  // Sitemap reference
  if (sitemapUrl) {
    lines.push(`Sitemap: ${sitemapUrl}`);
    lines.push('');
  } else if (domain) {
    lines.push(`Sitemap: ${domain}/sitemap.xml`);
    lines.push('');
  }

  // Commented out rules for common patterns
  lines.push('# Common patterns (uncomment as needed)');
  lines.push('# Disallow: /admin/');
  lines.push('# Disallow: /private/');
  lines.push('# Disallow: /tmp/');
  lines.push('# Disallow: /*.pdf$');
  lines.push('# Allow: /*.html$');
  lines.push('');

  // Specific user agents (optional)
  lines.push('# Googlebot specific');
  lines.push('User-agent: Googlebot');
  lines.push('Allow: /');
  lines.push('Crawl-delay: 2');
  lines.push('');

  lines.push('# Bingbot specific');
  lines.push('User-agent: Bingbot');
  lines.push('Allow: /');
  lines.push('Crawl-delay: 2');
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// Schema Validation & Utilities
// ============================================================

/**
 * Validate a generated JSON-LD graph
 */
function validateJsonLd(jsonLd) {
  const errors = [];
  const warnings = [];

  try {
    // Extract JSON from script tags if present
    let jsonStr = typeof jsonLd === 'string' ? jsonLd : JSON.stringify(jsonLd);
    
    // Remove script tags
    jsonStr = jsonStr.replace(/<script[^>]*type="application\/ld\+json"[^>]*>/gi, '').replace(/<\/script>/gi, '').trim();
    
    const parsed = JSON.parse(jsonStr);
    
    // Handle @graph wrapper - extract first item for validation
    let validateTarget = parsed;
    if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
      // For @graph, validate each item
      for (const item of parsed['@graph']) {
        const itemValidation = validateJsonLd(item);
        errors.push(...itemValidation.errors.map(e => `In @graph: ${e}`));
        warnings.push(...itemValidation.warnings.map(w => `In @graph: ${w}`));
      }
      return { valid: errors.length === 0, errors, warnings };
    }

    // Check @context
    if (!parsed['@context']) {
      warnings.push('Missing @context in JSON-LD');
    } else if (parsed['@context'] !== 'https://schema.org') {
      warnings.push('Non-standard @context: ' + parsed['@context']);
    }

    // Check @type for the main target
    if (!validateTarget['@type']) {
      errors.push('Missing @type in schema');
    }

    // Validate specific types
      if (validateTarget['@type'] === 'Organization' || validateTarget['@type'] === 'LocalBusiness') {
      if (!validateTarget.name) {
        errors.push('Organization/LocalBusiness missing name');
      }
    }

    if (validateTarget['@type'] === 'FAQPage') {
      // FAQPage must have mainEntity with Questions
      if (validateTarget.mainEntity) {
        if (!Array.isArray(validateTarget.mainEntity)) {
          errors.push('FAQPage mainEntity is not an array');
        } else {
          for (let i = 0; i < validateTarget.mainEntity.length; i++) {
            const item = validateTarget.mainEntity[i];
            if (item['@type'] !== 'Question') {
              warnings.push(`FAQPage mainEntity[${i}] is not a Question`);
            }
            if (!item.name) {
              warnings.push(`FAQPage mainEntity[${i}] missing name (question)`);
            }
            if (!item.acceptedAnswer) {
              warnings.push(`FAQPage mainEntity[${i}] missing acceptedAnswer`);
            }
          }
        }
      }
    }

    if (validateTarget['@type'] === 'Product') {
      if (!validateTarget.name) {
        errors.push('Product missing name');
      }
    }

    if (validateTarget['@type'] === 'JobPosting') {
      if (!validateTarget.title) {
        errors.push('JobPosting missing title');
      }
      if (!validateTarget.hiringOrganization) {
        errors.push('JobPosting missing hiringOrganization');
      }
    }

    if (validateTarget['@type'] === 'Article' || validateTarget['@type'] === 'NewsArticle' || validateTarget['@type'] === 'BlogPosting') {
      if (!validateTarget.headline) {
        errors.push('Article missing headline');
      }
    }

    if (validateTarget.offers) {
      if (!validateTarget.offers.price) {
        warnings.push('Product Offer missing price');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  } catch (e) {
    return {
      valid: false,
      errors: [`Invalid JSON: ${e.message}`],
      warnings: []
    };
  }
}

/**
 * Extract structured data from existing HTML for migration
 */
function extractSchemaFromHtml(html) {
  const graphs = [];

  // Find all JSON-LD script tags
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const content = match[1].trim();
      const parsed = JSON.parse(content);

      // Handle both single objects and @graph arrays
      if (Array.isArray(parsed)) {
        graphs.push(...parsed);
      } else {
        graphs.push(parsed);
      }
    } catch (e) {
      // Invalid JSON, skip
      console.warn('Could not parse JSON-LD from HTML:', e.message);
    }
  }

  return graphs;
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Core functions
  generateSchemaGraph,
  generateSitemap,
  generateRobotsTxt,

  // Validation
  validateJsonLd,

  // Extraction
  extractSchemaFromHtml,

  // Helpers (exposed for testing)
  _test: {
    escapeXml,
    formatDate,
    normalizeUrl,
    buildOrganizationSchema,
    buildLocalBusinessSchema,
    buildPostalAddress,
    buildOpeningHours,
    buildProductSchema,
    buildOfferSchema,
    buildReviewSchema,
    buildFAQPageSchema,
    buildJobPostingSchema,
    buildArticleSchema,
    buildWebSiteSchema,
    mapAvailability,
    generateJsonLdScript,
    generateSitemapIndex
  }
};

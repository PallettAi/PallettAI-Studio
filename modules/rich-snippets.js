// ============================================================
// PallettAI Studio — Advanced Schema.org Rich Snippets Builder
// Generates validated JSON-LD for FAQPage, HowTo, Event, Course,
// and LocalBusiness structured data types for SEO visibility.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// JSON-LD Generation Functions
// ============================================================

/**
 * Generate JSON-LD for FAQPage schema
 * Auto-extract questions and answers from section schemas
 *
 * @param {Object} payload - FAQ content with questions array
 * @returns {Object} JSON-LD object for FAQPage
 */
function generateFAQPageJSONLD(payload) {
  const {
    name = 'Frequently Asked Questions',
    questions = []
  } = payload;

  const mainEntity = questions.map(q => ({
    '@type': 'Question',
    name: q.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: q.answer
    }
  }));

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity
  };
}

/**
 * Generate JSON-LD for HowTo schema
 * Map sequential steps into structured instructions
 *
 * @param {Object} payload - How-to content with steps array
 * @returns {Object} JSON-LD object for HowTo
 */
function generateHowToJSONLD(payload) {
  const {
    name = '',
    description = '',
    steps = [],
    totalTime = '',
    requiredTools = [],
    requiredSupply = [],
    stepURL = ''
  } = payload;

  const howToSteps = steps.map((step, index) => ({
    '@type': 'HowToStep',
    position: index + 1,
    name: step.title || `Step ${index + 1}`,
    text: step.description || step.instructions || '',
    itemListElement: step.substeps || [],
    tool: step.tool ? {
      '@type': 'HowToTool',
      name: step.tool
    } : undefined,
    supply: step.supply ? {
      '@type': 'HowToSupply',
      name: step.supply
    } : undefined
  })).filter(s => s.text || s.name);

  const result = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name,
    description,
    step: howToSteps
  };

  if (totalTime) {
    result.totalTime = totalTime;
  }

  if (requiredTools.length > 0) {
    result.tool = requiredTools.map(t => ({
      '@type': 'HowToTool',
      name: t
    }));
  }

  if (requiredSupply.length > 0) {
    result.supply = requiredSupply.map(s => ({
      '@type': 'HowToSupply',
      name: s
    }));
  }

  if (stepURL) {
    result.url = stepURL;
  }

  return result;
}

/**
 * Generate JSON-LD for Event schema
 *
 * @param {Object} payload - Event details
 * @returns {Object} JSON-LD object for Event
 */
function generateEventJSONLD(payload) {
  const {
    name = '',
    description = '',
    startDate = '',
    endDate = '',
    startTime = '',
    endTime = '',
    location = null,
    venue = null,
    organizer = null,
    performer = null,
    image = '',
    url = '',
    endDateISO = '',
    startDateISO = '',
    offers = [],
    eventStatus = 'EventScheduled',
    eventAttendanceMode = 'OfflineEventAttendanceMode'
  } = payload;

  const eventLocation = location || venue || {};

  const event = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name,
    description
  };

  // Date handling
  if (startDateISO) {
    event.startDate = startDateISO;
  } else if (startDate || startTime) {
    event.startDate = startDate || startTime;
  }

  if (endDateISO) {
    event.endDate = endDateISO;
  } else if (endDate || endTime) {
    event.endDate = endDate || endTime;
  }

  // Location
  if (eventLocation.name || eventLocation.address) {
    event.location = {
      '@type': 'Place',
      name: eventLocation.name,
      address: eventLocation.address ? {
        '@type': 'PostalAddress',
        ...eventLocation.address
      } : undefined,
      geo: eventLocation.geo ? {
        '@type': 'GeoCoordinates',
        latitude: eventLocation.geo.lat,
        longitude: eventLocation.geo.lng
      } : undefined
    };
  }

  // Organizer
  if (organizer) {
    event.organizer = typeof organizer === 'object' ? organizer : {
      '@type': 'Person',
      name: organizer
    };
  }

  // Performer
  if (performer) {
    event.performer = Array.isArray(performer) ? performer : [{
      '@type': performer.type || 'Person',
      name: performer.name || performer
    }];
  }

  // Image
  if (image) {
    event.image = image;
  }

  // URL
  if (url) {
    event.url = url;
  }

  // Offers
  if (offers.length > 0) {
    event.offers = offers.map(o => ({
      '@type': 'Offer',
      name: o.name,
      price: o.price,
      priceCurrency: o.currency || 'USD',
      availability: o.availability || 'InStock',
      validFrom: o.validFrom,
      validThrough: o.validThrough,
      url: o.url
    }));
  }

  // Status
  if (eventStatus) {
    event.eventStatus = {
      '@type': 'EventStatusType',
      name: eventStatus
    };
  }

  // Attendance mode
  if (eventAttendanceMode) {
    event.eventAttendanceMode = {
      '@type': 'EventAttendanceModeEnumeration',
      name: eventAttendanceMode
    };
  }

  return event;
}

/**
 * Generate JSON-LD for Course schema
 *
 * @param {Object} payload - Course details
 * @returns {Object} JSON-LD object for Course
 */
function generateCourseJSONLD(payload) {
  const {
    name = '',
    description = '',
    provider = null,
    instructor = null,
    courseCode = '',
    courseURL = '',
    thumbnail = '',
    rating = null,
    reviews = [],
    offers = [],
    educationalLevel = '',
    learningResourceType = 'Course',
    timeRequired = '',
    datePublished = '',
    inLanguage = 'en'
  } = payload;

  const course = {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name,
    description,
    provider: provider ? {
      '@type': 'Organization',
      name: provider.name,
      sameAs: provider.url
    } : undefined,
    instructor: instructor ? {
      '@type': 'Person',
      name: instructor.name,
      jobTitle: instructor.role
    } : undefined
  };

  if (courseCode) {
    course.courseCode = courseCode;
  }

  if (courseURL) {
    course.url = courseURL;
  }

  if (thumbnail) {
    course.thumbnailUrl = thumbnail;
  }

  if (educationalLevel) {
    course.educationalLevel = educationalLevel;
  }

  if (learningResourceType) {
    course.learningResourceType = learningResourceType;
  }

  if (timeRequired) {
    course.timeRequired = timeRequired;
  }

  if (datePublished) {
    course.datePublished = datePublished;
  }

  if (inLanguage) {
    course.inLanguage = inLanguage;
  }

  // Aggregate rating
  if (rating) {
    course.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: rating.value,
      ratingCount: rating.count,
      bestRating: rating.best || 5,
      worstRating: rating.worst || 1
    };
  }

  // Reviews
  if (reviews.length > 0) {
    course.review = reviews.map(r => ({
      '@type': 'Review',
      author: {
        '@type': 'Person',
        name: r.author
      },
      datePublished: r.date,
      reviewBody: r.body,
      reviewRating: {
        '@type': 'Rating',
        ratingValue: r.rating
      }
    }));
  }

  // Offers
  if (offers.length > 0) {
    course.hasCourseFee = offers.some(o => o.price > 0);
    course.offers = offers.map(o => ({
      '@type': 'Offer',
      category: o.category,
      price: o.price,
      priceCurrency: o.currency || 'USD',
      availability: o.availability || 'InStock',
      url: o.url
    }));
  }

  return course;
}

/**
 * Generate JSON-LD for LocalBusiness schema
 *
 * @param {Object} payload - Business details
 * @returns {Object} JSON-LD object for LocalBusiness
 */
function generateLocalBusinessJSONLD(payload) {
  const {
    '@type': businessType = 'LocalBusiness',
    name = '',
    description = '',
    url = '',
    logo = '',
    telephone = '',
    email = '',
    address = null,
    geo = null,
    openingHoursSpecification = [],
    priceRange = '',
    image = '',
    sameAs = [],
    areaServed = [],
    servesCuisine = '',
    paymentAccepted = '',
    acceptsReservations = '',
    openingHours = ''
  } = payload;

  const business = {
    '@context': 'https://schema.org',
    '@type': businessType,
    name,
    description,
    url,
    telephone,
    priceRange
  };

  // Logo
  if (logo) {
    business.logo = {
      '@type': 'ImageObject',
      url: logo
    };
  }

  // Email
  if (email) {
    business.email = email;
  }

  // Image
  if (image) {
    business.image = image;
  }

  // SameAs (social profiles)
  if (sameAs.length > 0) {
    business.sameAs = sameAs;
  }

  // Address
  if (address) {
    business.address = {
      '@type': 'PostalAddress',
      streetAddress: address.street || address.streetAddress,
      addressLocality: address.city || address.addressLocality,
      addressRegion: address.state || address.addressRegion,
      postalCode: address.zip || address.postalCode,
      addressCountry: address.country || address.addressCountry
    };
  }

  // Geo coordinates
  if (geo) {
    business.geo = {
      '@type': 'GeoCoordinates',
      latitude: geo.lat || geo.latitude,
      longitude: geo.lng || geo.longitude
    };
  }

  // Opening hours specification (detailed)
  if (openingHoursSpecification.length > 0) {
    business.openingHoursSpecification = openingHoursSpecification.map(h => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: h.dayOfWeek,
      opens: h.opens,
      closes: h.closes,
      validFrom: h.validFrom,
      validThrough: h.validThrough
    }));
  }

  // Simple opening hours string (alternative)
  if (openingHours && openingHoursSpecification.length === 0) {
    business.openingHours = openingHours;
  }

  // Area served
  if (areaServed.length > 0) {
    business.areaServed = areaServed.map(a => ({
      '@type': 'Place',
      name: a
    }));
  }

  // Additional fields
  if (servesCuisine) {
    business.servesCuisine = servesCuisine;
  }

  if (paymentAccepted) {
    business.paymentAccepted = paymentAccepted;
  }

  if (acceptsReservations !== '') {
    business.acceptsReservations = acceptsReservations;
  }

  return business;
}

/**
 * Generate JSON-LD for a Review
 *
 * @param {Object} payload - Review details
 * @returns {Object} JSON-LD object for Review
 */
function generateReviewJSONLD(payload) {
  const {
    author = '',
    authorName = '',
    datePublished = '',
    reviewBody = '',
    reviewRating = null,
    itemReviewed = null
  } = payload;

  const review = {
    '@context': 'https://schema.org',
    '@type': 'Review',
    author: {
      '@type': 'Person',
      name: author || authorName
    },
    datePublished,
    reviewBody
  };

  if (reviewRating) {
    review.reviewRating = {
      '@type': 'Rating',
      ratingValue: reviewRating.value,
      bestRating: reviewRating.best || 5,
      worstRating: reviewRating.worst || 1
    };
  }

  if (itemReviewed) {
    review.itemReviewed = itemReviewed;
  }

  return review;
}

/**
 * Generate JSON-LD for BreadcrumbList
 *
 * @param {Object} payload - Breadcrumb items
 * @returns {Object} JSON-LD object for BreadcrumbList
 */
function generateBreadcrumbJSONLD(payload) {
  const {
    items = [],
    name = ''
  } = payload;

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url || item.item
    }))
  };

  if (name) {
    breadcrumb.name = name;
  }

  return breadcrumb;
}

// ============================================================
// Section Schema Extraction
// ============================================================

/**
 * Normalise a single Q&A pair from either explicit keys or accordion fields.
 * Accepts {question|title|name} and {answer|content|text|body}.
 */
function normaliseFaqItem(item) {
  if (!item || typeof item !== 'object') return null;

  const question = item.question || item.title || item.name;
  let answer = item.answer || item.content || item.text || item.body;

  // Answers may be nested rich-text or an array of paragraphs
  if (Array.isArray(answer)) {
    answer = answer.join(' ');
  }
  if (answer && typeof answer === 'object') {
    answer = answer.text || answer.content || answer.value || '';
  }

  if (!question || !answer) return null;

  return {
    question: String(question),
    answer: stripHtml(String(answer))
  };
}

/**
 * Strip HTML tags from a string so answers can safely become plain text.
 */
function stripHtml(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Re-join punctuation that tag stripping orphaned, e.g. "30 days ."
    .replace(/\s+([.,;:!?)])/g, '$1')
    .replace(/([(])\s+/g, '$1');
}

/**
 * Auto-extract question/answer accordions from PallettAI section schemas.
 *
 * Understands all of these shapes:
 *   { questions: [{ question, answer }] }
 *   { items: [{ question, answer }] }
 *   { sections: [{ type: 'faq', items: [...] }] }
 *   { sections: [{ type: 'accordion', blocks: [{ title, content }] }] }
 *
 * @param {Object} payload - Page or section schema
 * @returns {Array} Array of { question, answer } pairs
 */
function extractFAQsFromSections(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const collected = [];

  // Direct lists
  for (const key of ['questions', 'items', 'faqs']) {
    if (Array.isArray(payload[key])) {
      payload[key].forEach(item => {
        const pair = normaliseFaqItem(item);
        if (pair) collected.push(pair);
      });
    }
  }

  // Section trees (only FAQ/accordion-like sections)
  const SECTION_TYPES = new Set(['faq', 'faqs', 'faqpage', 'accordion', 'qa', 'q&a']);

  const walkSections = sections => {
    if (!Array.isArray(sections)) return;

    sections.forEach(section => {
      if (!section || typeof section !== 'object') return;

      const type = String(section.type || section.component || '').toLowerCase();

      if (SECTION_TYPES.has(type)) {
        const lists = [section.items, section.questions, section.blocks, section.faqs];
        lists.forEach(list => {
          if (!Array.isArray(list)) return;
          list.forEach(item => {
            const pair = normaliseFaqItem(item);
            if (pair) collected.push(pair);
          });
        });
      }

      // Recurse into nested section groups
      walkSections(section.sections || section.children);
    });
  };

  walkSections(payload.sections);

  // De-duplicate by question text, preserving order
  const seen = new Set();
  return collected.filter(pair => {
    const key = pair.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Normalise HowTo steps from either explicit steps or section schemas.
 */
function extractStepsFromSections(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const raw = [];

  if (Array.isArray(payload.steps)) {
    raw.push(...payload.steps);
  }
  if (Array.isArray(payload.items)) {
    raw.push(...payload.items);
  }

  const STEP_TYPES = new Set(['steps', 'howto', 'how-to', 'instructions']);

  const walk = sections => {
    if (!Array.isArray(sections)) return;
    sections.forEach(section => {
      if (!section || typeof section !== 'object') return;
      const type = String(section.type || section.component || '').toLowerCase();
      if (STEP_TYPES.has(type)) {
        [section.items, section.steps, section.blocks].forEach(list => {
          if (Array.isArray(list)) raw.push(...list);
        });
      }
      walk(section.sections || section.children);
    });
  };

  walk(payload.sections);

  return raw
    .map(step => {
      if (!step || typeof step !== 'object') return null;
      const title = step.title || step.name;
      const description = stripHtml(String(
        step.description || step.instructions || step.content || step.text || ''
      ));
      const tool = step.tool || (Array.isArray(step.tools) ? step.tools[0] : undefined);
      const supply = step.supply || (Array.isArray(step.supplies) ? step.supplies[0] : undefined);

      if (!title && !description) return null;
      return { title, description, tool, supply };
    })
    .filter(Boolean);
}

// ============================================================
// Unified Rich Snippet Dispatcher
// ============================================================

/**
 * Map of accepted schema type aliases to their canonical generator.
 * Keys are lower-cased for case-insensitive lookup.
 */
const SCHEMA_TYPE_ALIASES = {
  faqpage: 'FAQPage',
  faq: 'FAQPage',
  qa: 'FAQPage',
  howto: 'HowTo',
  'how-to': 'HowTo',
  tutorial: 'HowTo',
  event: 'Event',
  course: 'Course',
  localbusiness: 'LocalBusiness',
  organization: 'LocalBusiness',
  restaurant: 'LocalBusiness',
  store: 'LocalBusiness',
  review: 'Review',
  breadcrumblist: 'BreadcrumbList',
  breadcrumb: 'BreadcrumbList'
};

/**
 * Generate validated JSON-LD for a specialised structured data type.
 *
 * This is the single entry point described by the module contract; it accepts
 * a schema type name (case-insensitive, common aliases supported) and the
 * matching payload, normalises section-schema input where relevant, and
 * returns a JSON-LD object ready for injection.
 *
 * @param {string} schemaType - e.g. 'FAQPage', 'HowTo', 'Event', 'Course', 'LocalBusiness'
 * @param {Object} payload - Source data (page schema, section tree, or flat fields)
 * @returns {Object} JSON-LD object; includes a `_errors` array when input is unusable
 */
function generateRichSnippetJSONLD(schemaType, payload = {}) {
  const canonical = SCHEMA_TYPE_ALIASES[String(schemaType || '').toLowerCase()];

  if (!canonical) {
    return {
      '@context': 'https://schema.org',
      '@type': 'Thing',
      _errors: [`Unsupported schema type: ${schemaType}`]
    };
  }

  const source = payload && typeof payload === 'object' ? payload : {};

  switch (canonical) {
    case 'FAQPage': {
      const questions = extractFAQsFromSections(source);
      if (questions.length === 0) {
        return {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [],
          _errors: ['No question/answer pairs found']
        };
      }
      return generateFAQPageJSONLD({
        name: source.name || source.title,
        questions
      });
    }

    case 'HowTo': {
      const steps = extractStepsFromSections(source);
      return generateHowToJSONLD({
        name: source.name || source.title || '',
        description: source.description || source.summary || '',
        steps,
        totalTime: source.totalTime || source.duration || '',
        requiredTools: source.requiredTools || source.tools || [],
        requiredSupply: source.requiredSupply || source.supplies || [],
        stepURL: source.url || ''
      });
    }

    case 'Event':
      return generateEventJSONLD({
        ...source,
        startDateISO: source.startDateISO || source.startDate || '',
        endDateISO: source.endDateISO || source.endDate || ''
      });

    case 'Course':
      return generateCourseJSONLD(source);

    case 'LocalBusiness':
      return generateLocalBusinessJSONLD(source);

    case 'Review':
      return generateReviewJSONLD(source);

    case 'BreadcrumbList':
      return generateBreadcrumbJSONLD(source);

    default:
      return {
        '@context': 'https://schema.org',
        '@type': 'Thing',
        _errors: [`Unsupported schema type: ${schemaType}`]
      };
  }
}

// ============================================================
// JSON-LD Injection
// ============================================================

/**
 * Inject JSON-LD into HTML document
 *
 * @param {string} htmlString - HTML content
 * @param {Object} jsonLdObject - JSON-LD object to inject
 * @returns {string} HTML with injected JSON-LD
 */
function injectJSONLDIntoDOM(htmlString, jsonLdObject) {
  if (!htmlString || typeof htmlString !== 'string') {
    return htmlString;
  }

  if (!jsonLdObject || typeof jsonLdObject !== 'object') {
    return htmlString;
  }

  const scriptTag = `<script type="application/ld+json">${serializeJSONLD(jsonLdObject)}</script>`;

  // Find head end
  const headEndIndex = htmlString.toLowerCase().lastIndexOf('</head>');

  if (headEndIndex !== -1) {
    return htmlString.slice(0, headEndIndex) + '\n  ' + scriptTag + htmlString.slice(headEndIndex);
  }

  // Fallback: find body start
  const bodyStartIndex = htmlString.toLowerCase().indexOf('<body');
  if (bodyStartIndex !== -1) {
    return htmlString.slice(0, bodyStartIndex) + scriptTag + htmlString.slice(bodyStartIndex);
  }

  // Last resort: append to end
  return htmlString + '\n' + scriptTag;
}

/**
 * Serialize a JSON-LD object to a string that is safe to embed inside a
 * <script> element. HTML-significant characters are emitted as JSON unicode
 * escapes, which keeps the payload valid JSON while making it impossible for
 * content such as `</script>` to terminate the surrounding script element.
 *
 * @param {Object} jsonLdObject - JSON-LD object to serialize
 * @returns {string} Escaped JSON string
 */
function serializeJSONLD(jsonLdObject) {
  return JSON.stringify(jsonLdObject)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Inject multiple JSON-LD scripts into HTML
 *
 * @param {string} htmlString - HTML content
 * @param {Array} jsonLdObjects - Array of JSON-LD objects
 * @returns {string} HTML with injected JSON-LD scripts
 */
function injectMultipleJSONLDIntoDOM(htmlString, jsonLdObjects) {
  if (!Array.isArray(jsonLdObjects)) {
    return injectJSONLDIntoDOM(htmlString, jsonLdObjects);
  }

  let result = htmlString;
  for (const obj of jsonLdObjects) {
    result = injectJSONLDIntoDOM(result, obj);
  }
  return result;
}

/**
 * Validate JSON-LD object structure
 *
 * @param {Object} jsonLdObject - JSON-LD object to validate
 * @returns {Object} Validation result
 */
function validateJSONLD(jsonLdObject) {
  const issues = [];
  const warnings = [];

  if (!jsonLdObject || typeof jsonLdObject !== 'object') {
    return {
      valid: false,
      issues: [{ type: 'Invalid', message: 'JSON-LD object is required', severity: 'error' }]
    };
  }

  if (!jsonLdObject['@context']) {
    issues.push({
      type: 'MissingContext',
      message: 'Missing @context property',
      severity: 'error'
    });
  }

  if (!jsonLdObject['@type']) {
    issues.push({
      type: 'MissingType',
      message: 'Missing @type property',
      severity: 'error'
    });
  }

  // Type-specific validation
  const type = jsonLdObject['@type'];

  if (type === 'FAQPage') {
    if (!jsonLdObject.mainEntity || !Array.isArray(jsonLdObject.mainEntity)) {
      issues.push({
        type: 'MissingMainEntity',
        message: 'FAQPage requires mainEntity array',
        severity: 'error'
      });
    } else {
      jsonLdObject.mainEntity.forEach((q, i) => {
        if (!q.name) {
          warnings.push({
            type: 'MissingQuestionName',
            message: `Question ${i + 1} missing name`,
            severity: 'warning'
          });
        }
        if (!q.acceptedAnswer || !q.acceptedAnswer.text) {
          warnings.push({
            type: 'MissingAnswer',
            message: `Question ${i + 1} missing answer`,
            severity: 'warning'
          });
        }
      });
    }
  }

  if (type === 'HowTo') {
    if (!jsonLdObject.step || !Array.isArray(jsonLdObject.step)) {
      warnings.push({
        type: 'MissingSteps',
        message: 'HowTo should have step array',
        severity: 'warning'
      });
    }
  }

  if (type === 'Event') {
    if (!jsonLdObject.startDate) {
      warnings.push({
        type: 'MissingStartDate',
        message: 'Event should have startDate',
        severity: 'warning'
      });
    }
    if (!jsonLdObject.name) {
      issues.push({
        type: 'MissingName',
        message: 'Event requires name',
        severity: 'error'
      });
    }
  }

  if (type === 'LocalBusiness') {
    if (!jsonLdObject.name) {
      issues.push({
        type: 'MissingName',
        message: 'LocalBusiness requires name',
        severity: 'error'
      });
    }
    if (!jsonLdObject.address && !jsonLdObject.geo) {
      warnings.push({
        type: 'MissingLocation',
        message: 'LocalBusiness should have address or geo',
        severity: 'warning'
      });
    }
  }

  return {
    valid: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    warnings
  };
}

/**
 * Escape HTML entities in JSON-LD (for safe embedding)
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitize JSON-LD for safe embedding
 *
 * @param {Object} jsonLdObject - JSON-LD object
 * @returns {Object} Sanitized JSON-LD object
 */
function sanitizeJSONLD(jsonLdObject) {
  if (!jsonLdObject || typeof jsonLdObject !== 'object') {
    return jsonLdObject;
  }

  const sanitized = {};

  for (const key in jsonLdObject) {
    const value = jsonLdObject[key];

    if (typeof value === 'string') {
      sanitized[key] = escapeHtmlEntities(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item =>
        typeof item === 'object' ? sanitizeJSONLD(item) : item
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeJSONLD(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Unified dispatcher (primary entry point)
  generateRichSnippetJSONLD,
  extractFAQsFromSections,
  extractStepsFromSections,
  SCHEMA_TYPE_ALIASES,

  // JSON-LD generation
  generateFAQPageJSONLD,
  generateHowToJSONLD,
  generateEventJSONLD,
  generateCourseJSONLD,
  generateLocalBusinessJSONLD,
  generateReviewJSONLD,
  generateBreadcrumbJSONLD,

  // Injection
  injectJSONLDIntoDOM,
  injectMultipleJSONLDIntoDOM,
  serializeJSONLD,

  // Validation
  validateJSONLD,
  sanitizeJSONLD,
  escapeHtmlEntities,

  // For testing
  _test: {
    generateRichSnippetJSONLD,
    extractFAQsFromSections,
    extractStepsFromSections,
    generateFAQPageJSONLD,
    generateHowToJSONLD,
    generateEventJSONLD,
    generateCourseJSONLD,
    generateLocalBusinessJSONLD,
    generateReviewJSONLD,
    generateBreadcrumbJSONLD,
    injectJSONLDIntoDOM,
    injectMultipleJSONLDIntoDOM,
    serializeJSONLD,
    validateJSONLD,
    sanitizeJSONLD,
    escapeHtmlEntities
  }
};

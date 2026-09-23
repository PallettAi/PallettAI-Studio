// ============================================================
// PallettAI Studio — Podcast & Audio Feed Syndication
// Generates compliant podcast RSS feeds for Apple Podcasts,
// Spotify, and other platforms, plus WebVTT subtitle files.
// ============================================================

const fs = require('fs');
const path = require('path');

// ============================================================
// Podcast RSS Feed Generation
// ============================================================

/**
 * Generate podcast RSS feed XML
 * Compliant with Apple Podcasts and Spotify requirements
 *
 * @param {Object} podcastMeta - Podcast metadata
 * @param {Array} episodeList - Array of episode objects
 * @returns {string} Complete RSS XML document
 */
function generatePodcastRSS(podcastMeta, episodeList = []) {
  const {
    title = 'Untitled Podcast',
    description = '',
    author = '',
    owner = '',
    ownerEmail = '',
    website = '',
    coverArt = '',
    language = 'en-us',
    categories = [],
    explicit = false,
    feedUrl = '',
    itunesAuthor = '',
    itunesOwner = '',
    itunesCategory = '',
    itunesSubtitle = '',
    itunesSummary = '',
    itunesKeywords = [],
    itunesImage = '',
    itunesExplicit = '',
    itunesType = 'episodic'
  } = podcastMeta;

  // Build XML
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n`;
  xml += `  <channel>\n`;

  // Basic channel info
  xml += `    <title>${escapeXml(title)}</title>\n`;
  xml += `    <description>${escapeXml(description)}</description>\n`;
  xml += `    <language>${language}</language>\n`;

  if (author) {
    xml += `    <author>${escapeXml(author)}</author>\n`;
  }

  if (ownerEmail) {
    xml += `    <managingEditor>${escapeXml(ownerEmail)} (${escapeXml(owner || author)})</managingEditor>\n`;
  }

  if (website) {
    xml += `    <link>${escapeXml(website)}</link>\n`;
  }

  if (feedUrl) {
    xml += `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>\n`;
  }

  if (coverArt) {
    xml += `    <image>\n`;
    xml += `      <url>${escapeXml(coverArt)}</url>\n`;
    xml += `      <title>${escapeXml(title)}</title>\n`;
    xml += `      <link>${escapeXml(website || feedUrl || 'http://example.com')}</link>\n`;
    xml += `    </image>\n`;
  }

  // iTunes specific tags
  xml += `    <itunes:author>${escapeXml(itunesAuthor || author || '')}</itunes:author>\n`;
  xml += `    <itunes:title>${escapeXml(title)}</itunes:title>\n`;

  if (itunesSubtitle) {
    xml += `    <itunes:subtitle>${escapeXml(itunesSubtitle)}</itunes:subtitle>\n`;
  }

  if (itunesSummary) {
    xml += `    <itunes:summary>${escapeXml(itunesSummary)}</itunes:summary>\n`;
  }

  xml += `    <itunes:type>${itunesType}</itunes:type>\n`;
  xml += `    <itunes:explicit>${explicit || itunesExplicit === 'yes' ? 'yes' : 'no'}</itunes:explicit>\n`;

  if (itunesImage) {
    xml += `    <itunes:image href="${escapeXml(itunesImage)}" />\n`;
  }

  // Categories
  const cats = Array.isArray(categories) ? categories : [categories].filter(Boolean);
  cats.forEach(cat => {
    if (typeof cat === 'string') {
      xml += `    <itunes:category text="${escapeXml(cat)}" />\n`;
    } else if (cat && cat.text) {
      xml += `    <itunes:category text="${escapeXml(cat.text)}">\n`;
      if (Array.isArray(cat.subcategory)) {
        cat.subcategory.forEach(sub => {
          xml += `      <itunes:category text="${escapeXml(sub)}" />\n`;
        });
      }
      xml += `    </itunes:category>\n`;
    }
  });

  // Keywords
  if (Array.isArray(itunesKeywords) && itunesKeywords.length > 0) {
    xml += `    <itunes:keywords>${itunesKeywords.join(', ')}</itunes:keywords>\n`;
  }

  // Owner info
  if (itunesOwner) {
    xml += `    <itunes:owner>\n`;
    xml += `      <itunes:name>${escapeXml(itunesOwner.name || itunesOwner)}</itunes:name>\n`;
    xml += `      <itunes:email>${escapeXml(itunesOwner.email || ownerEmail || '')}</itunes:email>\n`;
    xml += `    </itunes:owner>\n`;
  }

  // Episodes
  episodeList.forEach((episode, index) => {
    xml += `    <item>\n`;

    // Basic item info
    xml += `      <title>${escapeXml(episode.title || `Episode ${index + 1}`)}</title>\n`;

    const episodeDescription = episode.description || episode.summary || '';
    xml += `      <description>${escapeXml(episodeDescription)}</description>\n`;

    // Episode number
    if (episode.episode || episode.episodeNumber !== undefined) {
      xml += `      <itunes:episode>${episode.episode || episode.episodeNumber}</itunes:episode>\n`;
    }

    // Episode type (Apple Podcasts uses itunes:episodeType: full | trailer | bonus)
    if (episode.episodeType) {
      xml += `      <itunes:episodeType>${escapeXml(episode.episodeType)}</itunes:episodeType>\n`;
    }

    // GUID (emitted exactly once per item for valid RSS)
    const episodeGuid =
      episode.guid || episode.id || episode.url ||
      episode.audioUrl || episode.enclosureUrl;
    if (episodeGuid) {
      xml += `      <guid isPermaLink="false">${escapeXml(episodeGuid)}</guid>\n`;
    }

    // Audio enclosure (required for podcasts)
    if (episode.audioUrl || episode.enclosureUrl) {
      const audioUrl = episode.audioUrl || episode.enclosureUrl;
      const size = episode.size || episode.fileSize || 0;
      const mimeType = episode.mimeType || episode.enclosureType || 'audio/mpeg';

      xml += `      <enclosure url="${escapeXml(audioUrl)}" length="${size}" type="${mimeType}"/>\n`;

      // URL tag for the episode
      xml += `      <link>${escapeXml(episode.url || audioUrl)}</link>\n`;
    }

    // Date
    if (episode.publishedDate || episode.publicationDate || episode.date) {
      const pubDate = episode.publishedDate || episode.publicationDate || episode.date;
      xml += `      <pubDate>${formatRFC822(pubDate)}</pubDate>\n`;
    }

    // Duration (iTunes)
    if (episode.duration || episode.itunesDuration) {
      const dur = episode.duration || episode.itunesDuration;
      xml += `      <itunes:duration>${escapeXml(dur)}</itunes:duration>\n`;
    }

    // Explicit setting
    if (episode.explicit !== undefined) {
      xml += `      <itunes:explicit>${episode.explicit ? 'yes' : 'no'}</itunes:explicit>\n`;
    }

    // Episode image
    if (episode.image || episode.coverArt || episode.thumbnail) {
      xml += `      <itunes:image href="${escapeXml(episode.image || episode.coverArt || episode.thumbnail)}" />\n`;
    }

    // Episode categories
    if (episode.category || episode.categories) {
      const epCats = Array.isArray(episode.category || episode.categories)
        ? (episode.category || episode.categories)
        : [episode.category || episode.categories].filter(Boolean);

      epCats.forEach(cat => {
        if (typeof cat === 'string') {
          xml += `      <itunes:category text="${escapeXml(cat)}" />\n`;
        } else if (cat && cat.text) {
          xml += `      <itunes:category text="${escapeXml(cat.text)}">\n`;
          if (Array.isArray(cat.subcategory)) {
            cat.subcategory.forEach(sub => {
              xml += `        <itunes:category text="${escapeXml(sub)}" />\n`;
            });
          }
          xml += `      </itunes:category>\n`;
        }
      });
    }

    // Transcript/Show notes
    if (episode.transcript || episode.showNotes) {
      xml += `      <content:encoded><![CDATA[${episode.transcript || episode.showNotes}]]></content:encoded>\n`;
    }

    xml += `    </item>\n`;
  });

  xml += `  </channel>\n`;
  xml += `</rss>`;

  return xml;
}

/**
 * Format date to RFC 822 (required for RSS pubDate)
 */
function formatRFC822(dateInput) {
  const date = new Date(dateInput);

  if (isNaN(date.getTime())) {
    return dateInput || new Date().toUTCString();
  }

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const day = days[date.getUTCDay()];
  const paddedDate = String(date.getUTCDate()).padStart(2, '0');
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');

  return `${day}, ${paddedDate} ${month} ${year} ${hours}:${minutes}:${seconds} +0000`;
}

/**
 * Escape XML special characters
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
 * Generate podcast RSS with automatic episode validation
 */
function generateValidatedPodcastRSS(podcastMeta, episodeList) {
  const warnings = [];
  const errors = [];

  // Validate podcast metadata
  if (!podcastMeta.title) {
    errors.push('Podcast title is required');
  }

  if (!podcastMeta.author) {
    warnings.push('Podcast author is recommended');
  }

  if (episodeList.length === 0) {
    warnings.push('No episodes provided in feed');
  }

  // Validate episodes
  episodeList.forEach((ep, i) => {
    if (!ep.title) {
      errors.push(`Episode ${i + 1} missing title`);
    }

    if (!ep.audioUrl && !ep.enclosureUrl) {
      errors.push(`Episode ${i + 1} missing audio URL`);
    }

    if (!ep.publishedDate && !ep.publicationDate && !ep.date) {
      warnings.push(`Episode ${i + 1} missing publication date`);
    }
  });

  const xml = generatePodcastRSS(podcastMeta, episodeList);

  return {
    xml,
    warnings,
    errors,
    valid: errors.length === 0
  };
}

// ============================================================
// WebVTT Transcript Generation
// ============================================================

/**
 * Convert transcript text to WebVTT format
 *
 * @param {string} transcriptText - Plain text or timestamped transcript
 * @param {Object} options - Conversion options
 * @returns {string} WebVTT formatted content
 */
function generateWebVTTFromTranscript(transcriptText, options = {}) {
  const {
    fileName = 'transcript',
    startTime = 0,
    timeFormat = 'hh:mm:ss.mmm',
    cuesPerLine = 2,
    speakerLabels = false
  } = options;

  if (!transcriptText) {
    return `WEBVTT\n\n`;
  }

  let vtt = 'WEBVTT\n';
  vtt += `\n`;

  // Check if input is already timestamped
  if (isTimestampedTranscript(transcriptText)) {
    vtt += convertTimestampedTranscript(transcriptText, options);
  } else {
    vtt += convertPlainTextTranscript(transcriptText, options);
  }

  return vtt;
}

/**
 * Check if transcript already has timestamps
 */
function isTimestampedTranscript(text) {
  if (!text) return false;

  // Check for common timestamp patterns
  const patterns = [
    /^\d{1,2}:\d{2}:\d{2}([.,]\d{1,3})?\s/,  // HH:MM:SS
    /^\d{1,2}:\d{2}([.,]\d{1,3})?\s/,         // MM:SS
    /\[\d{1,2}:\d{2}:\d{2}([.,]\d{1,3})?\]/,  // [HH:MM:SS]
    /^\[(\d{1,2}:)?\d{1,2}:\d{2}([.,]\d{1,3})?\]/  // [M:SS] or [H:MM:SS]
  ];

  return patterns.some(p => p.test(text.trim()));
}

/**
 * Convert timestamped transcript to WebVTT
 */
function convertTimestampedTranscript(transcriptText, options) {
  // Requires at least an MM:SS component so ordinary prose is never mistaken
  // for a timestamp. Supports: "MM:SS", "HH:MM:SS.mmm", "[MM:SS] text".
  const LINE_RE =
    /^\s*\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?\]?\s*(.*)$/;

  // First pass: collect timestamped entries
  const entries = [];
  let pending = null;

  transcriptText.split('\n').forEach(rawLine => {
    const line = rawLine.trim();
    if (!line) return;

    const match = line.match(LINE_RE);

    if (match) {
      const hours = match[1] !== undefined ? parseInt(match[1], 10) || 0 : 0;
      const minutes = parseInt(match[2], 10) || 0;
      const seconds = parseInt(match[3], 10) || 0;
      const millis = (match[4] || '0').padEnd(3, '0').slice(0, 3);
      const text = match[5] || '';

      const timeMs =
        (hours * 3600 + minutes * 60 + seconds) * 1000 +
        parseInt(millis, 10);

      pending = { timeMs, text };
      entries.push(pending);
    } else if (pending) {
      // Continuation line - append to the previous entry
      pending.text = `${pending.text} ${line}`.trim();
    }
  });

  if (entries.length === 0) {
    return convertPlainTextTranscript(transcriptText, options);
  }

  // Second pass: emit valid WebVTT cues (timestamp line, then text)
  let vtt = '';

  entries.forEach((entry, index) => {
    const nextEntry = entries[index + 1];
    const startMs = entry.timeMs;
    // Cue ends when the next cue starts; fall back to estimated speech duration
    const endMs = nextEntry
      ? nextEntry.timeMs
      : startMs + Math.max(2000, entry.text.split(/\s+/).length * 400);

    vtt += `${formatVttTimestamp(startMs)} --> ${formatVttTimestamp(endMs)}\n`;
    vtt += `<v Speaker${index + 1}>${escapeVttText(entry.text)}</v>\n\n`;
  });

  return vtt;
}

/**
 * Escape cue text for WebVTT.
 *
 * A cue body is parsed for inline tags (`<b>`, `<v>`, `<c>`, …) and for cue
 * timestamps, so a raw `<` in a transcript is markup rather than literal text —
 * including in something innocuous like "the <div> element". `&` is escaped
 * with it because these are character references, and line breaks are folded
 * because a cue body is a single line.
 */
function escapeVttText(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n]+/g, ' ');
}

/**
 * Format milliseconds as a WebVTT timestamp (HH:MM:SS.mmm)
 */
function formatVttTimestamp(ms) {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3600000);
  const minutes = Math.floor((safeMs % 3600000) / 60000);
  const seconds = Math.floor((safeMs % 60000) / 1000);
  const millis = safeMs % 1000;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad3(millis)}`;
}

/**
 * Convert plain text transcript to WebVTT with automatic timing
 */
function convertPlainTextTranscript(transcriptText, options) {
  const text = transcriptText.trim();
  if (!text) return '';

  const lines = text.split('\n').filter(l => l.trim());
  let vtt = '';
  let currentTime = options.startTime || 0;
  const wordsPerMinute = 150; // Average speaking rate
  const msPerWord = (60 * 1000) / wordsPerMinute;

  lines.forEach((line, index) => {
    if (!line.trim()) return;

    const words = line.trim().split(/\s+/);
    const durationMs = words.length * msPerWord;
    const endTime = currentTime + durationMs;

    // WebVTT requires the timestamp line first, then the cue text
    vtt += `${formatVttTimestamp(currentTime)} --> ${formatVttTimestamp(endTime)}\n`;
    vtt += `<v Speaker${index + 1}>${escapeVttText(line.trim())}</v>\n\n`;

    currentTime = endTime;
  });

  return vtt;
}

/**
 * Convert milliseconds to time object
 */
function msToTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return {
    minutes,
    seconds,
    milliseconds
  };
}

/**
 * Pad number to 2 digits
 */
function pad(num) {
  return String(num).padStart(2, '0');
}

/**
 * Pad number to 3 digits
 */
function pad3(num) {
  return String(num).padStart(3, '0');
}

/**
 * Generate simple WebVTT from text with automatic timing
 */
function generateSimpleWebVTT(text, options = {}) {
  const {
    startTime = 0,
    wordsPerMinute = 150,
    speakerName = ''
  } = options;

  if (!text) return 'WEBVTT\n\n';

  const lines = text.split('\n').filter(l => l.trim());
  let vtt = 'WEBVTT\n\n';
  let currentTime = startTime;

  lines.forEach(line => {
    const words = line.trim().split(/\s+/);
    if (words.length === 0) return;

    const durationMs = words.length * (60 * 1000) / wordsPerMinute;
    const endTime = currentTime + durationMs;

    const speakerTag = speakerName ? `<v ${speakerName}>` : '';

    // Timestamp line precedes cue text
    vtt += `${formatVttTimestamp(currentTime)} --> ${formatVttTimestamp(endTime)}\n`;
    vtt += `${speakerTag}${line.trim()}${speakerName ? '</v>' : ''}\n\n`;

    currentTime = endTime;
  });

  return vtt;
}

/**
 * Parse WebVTT file and extract transcript text
 */
function parseWebVTT(vttContent) {
  if (!vttContent) return [];

  const lines = vttContent.split('\n');
  const cues = [];
  let inCue = false;
  let currentCue = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header
    if (trimmed === 'WEBVTT' || trimmed.startsWith('WEBVTT')) continue;

    // Check for timestamp line (contains -->)
    if (trimmed.includes('-->')) {
      if (currentCue) {
        cues.push(currentCue);
      }

      const [start, end] = trimmed.split('-->').map(s => s.trim());
      currentCue = {
        start,
        end,
        text: []
      };
      inCue = true;
      continue;
    }

    // Cue text
    if (inCue && trimmed) {
      // Check for speaker tag
      const speakerMatch = trimmed.match(/^<v\s+([^>]+)>(.*)<\/v>$/);
      if (speakerMatch) {
        currentCue.speaker = speakerMatch[1];
        currentCue.text.push(speakerMatch[2]);
      } else {
        currentCue.text.push(trimmed);
      }
    }
  }

  // Don't forget last cue
  if (currentCue) {
    cues.push(currentCue);
  }

  return cues.map(cue => ({
    start: cue.start,
    end: cue.end,
    speaker: cue.speaker || '',
    text: cue.text.join(' ')
  }));
}

// ============================================================
// Export
// ============================================================

module.exports = {
  // Podcast RSS
  generatePodcastRSS,
  generateValidatedPodcastRSS,
  formatRFC822,
  escapeXml,

  // WebVTT
  generateWebVTTFromTranscript,
  generateSimpleWebVTT,
  parseWebVTT,
  isTimestampedTranscript,

  // Utilities
  msToTime,
  formatVttTimestamp,
  pad,
  pad3,

  // For testing
  _test: {
    generatePodcastRSS,
    generateValidatedPodcastRSS,
    formatRFC822,
    escapeXml,
    generateWebVTTFromTranscript,
    generateSimpleWebVTT,
    parseWebVTT,
    isTimestampedTranscript,
    msToTime,
    formatVttTimestamp,
    pad,
    pad3
  }
};

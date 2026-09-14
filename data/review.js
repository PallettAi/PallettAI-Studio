// ============================================================
// PallettAI Studio — client review loop (pure logic)
//
// The idea: the agency ships an owned static export, the client leaves
// comments on it, and the comments come back *anchored to a build* — so the
// agency can tell whether a note still applies to what they are looking at.
//
// No backend, no accounts. A review is a small JSON file that travels by
// download, email or the site's own form endpoint. That is deliberate: the
// whole point of an owned export is that neither party is locked into
// somebody else's server to have a conversation about it.
//
// Two halves:
//   * the BUILD STAMP — a hash of the project's semantic content, embedded in
//     every exported page as `data-pai-build`. Same content rebuilds to the
//     same stamp, which is what makes "is this note still valid?" answerable.
//   * the REVIEW PAYLOAD — page, section anchor, note text, and the stamp it
//     was taken against.
//
// No DOM, no storage — app.js drives it and the smoke test calls it raw.
// ============================================================

'use strict';

const Review = (() => {
  const VERSION = 1;
  const MAX_NOTES = 300;
  const MAX_TEXT = 1200;
  const MAX_ANCHOR = 160;

  // FNV-1a, base36 — short, dependency-free, and stable across runs and devices.
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }
  const stampOf = (str) => 'b' + fnv1a(str).toString(36);

  // Deterministic JSON: object keys sorted at every depth, so two runs over
  // equal content always produce equal text.
  function stable(value) {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (typeof value === 'object') {
      const keys = Object.keys(value).sort();
      return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    }
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return 'null';
  }

  // Bookkeeping that says nothing about what the client will see must not move
  // the stamp, or every autosave would invalidate an in-flight review.
  const VOLATILE = new Set([
    'id', '_id', 'rev', 'revision', 'updatedAt', 'createdAt', 'savedAt', 'lastSaved',
    'activePageId', 'selected', 'collapsed', 'open', 'scrollY', 'sigNote'
  ]);

  function scrub(value, depth) {
    if (depth > 8) return null;
    if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).sort().forEach((k) => {
        if (VOLATILE.has(k)) return;
        const v = value[k];
        if (v === undefined || v === null || v === '') return;
        out[k] = scrub(v, depth + 1);
      });
      return out;
    }
    return value;
  }

  // The reviewable content: every page and its sections, with volatile
  // bookkeeping removed. `pages` is the normalised page array (Builder.pages).
  function canonical(pages) {
    return (Array.isArray(pages) ? pages : []).map((pg) => ({
      name: String((pg && pg.name) || ''),
      slug: String((pg && pg.slug) || ''),
      sections: (pg && Array.isArray(pg.sections) ? pg.sections : [])
        .map((s) => scrub(s, 0))
    }));
  }

  function stamp(pages) {
    return stampOf(stable(canonical(pages)));
  }

  // Memoised so pageHTML can ask for the stamp on every page without walking
  // the whole project again (large sites have many sections).
  const stampCache = new WeakMap();
  function stampCached(pages) {
    if (!pages || typeof pages !== 'object') return stamp(pages);
    let hit = stampCache.get(pages);
    if (!hit) { hit = stamp(pages); stampCache.set(pages, hit); }
    return hit;
  }

  // ---- payload ------------------------------------------------------------

  const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

  function normalizeNote(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = clip(raw.text, MAX_TEXT);
    if (!text) return null;
    return {
      id: clip(raw.id, 40) || stampOf(text + '|' + clip(raw.sectionId, 64)),
      sectionId: clip(raw.sectionId, 64),
      sectionType: clip(raw.sectionType, 40),
      heading: clip(raw.heading, MAX_ANCHOR),
      text: text,
      // a client can flag something as blocking without writing an essay
      priority: raw.priority === 'blocker' ? 'blocker' : 'note',
      at: clip(raw.at, 40)
    };
  }

  function normalizePage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      name: clip(raw.name, 120) || 'Untitled page',
      slug: clip(raw.slug, 120) || 'index',
      notes: (Array.isArray(raw.notes) ? raw.notes : []).map(normalizeNote).filter(Boolean).slice(0, MAX_NOTES)
    };
  }

  // Accepts a parsed review payload. Never throws: a malformed file must
  // produce a readable reason, not a stack trace in front of a client.
  function parse(raw) {
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { return { ok: false, error: 'That file is not valid JSON.', review: null }; }
    }
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'That file does not look like a review.', review: null };
    if (raw.kind !== 'pallettai-review') return { ok: false, error: 'That JSON is not a PallettAI review file.', review: null };

    const pages = (Array.isArray(raw.pages) ? raw.pages : []).map(normalizePage).filter(Boolean);
    const notes = pages.reduce((n, p) => n + p.notes.length, 0);
    if (!notes) return { ok: false, error: 'That review contains no comments.', review: null };

    return {
      ok: true,
      error: '',
      review: {
        v: Number(raw.v) || VERSION,
        kind: 'pallettai-review',
        site: clip(raw.site, 120),
        build: clip(raw.build, 40),
        at: clip(raw.at, 40),
        pages: pages,
        count: notes
      }
    };
  }

  function create(opts) {
    const o = opts || {};
    const pages = (Array.isArray(o.pages) ? o.pages : [])
      .map(normalizePage).filter(Boolean)
      .map((p) => Object.assign({}, p, { notes: p.notes.slice(0, MAX_NOTES) }));
    return {
      v: VERSION,
      kind: 'pallettai-review',
      site: clip(o.site, 120),
      build: clip(o.build, 40),
      at: clip(o.at, 40) || new Date().toISOString(),
      pages: pages
    };
  }

  // ---- staleness ----------------------------------------------------------
  // The question the agency actually needs answered before reading a single
  // comment: does this feedback still describe the site I have open?
  //   current — same build, every note applies
  //   stale   — the site changed since; the notes still describe what the
  //             client saw, so they are worth reading but must be re-checked
  //   unknown — no stamp either side; cannot claim either way
  function staleness(review, currentStamp) {
    const mine = clip(review && review.build, 40);
    const now = clip(currentStamp, 40);
    if (!mine || !now) return 'unknown';
    return mine === now ? 'current' : 'stale';
  }

  // ---- attachment ---------------------------------------------------------
  // Map each note onto the live project so the Designer can jump to it.
  // A section that no longer exists is kept, flagged, and never silently
  // dropped — a lost comment is worse than an orphaned one.
  function attach(review, pages) {
    const live = Array.isArray(pages) ? pages : [];
    const bySlug = new Map();
    live.forEach((pg) => bySlug.set(String(pg.slug || ''), pg));

    const out = [];
    (review && Array.isArray(review.pages) ? review.pages : []).forEach((rp) => {
      const page = bySlug.get(String(rp.slug || ''));
      const sections = (page && Array.isArray(page.sections)) ? page.sections : [];
      const index = new Map();
      sections.forEach((s, i) => index.set('sec-' + s.type + '-' + i, { section: s, index: i }));

      (rp.notes || []).forEach((note) => {
        const hit = index.get(note.sectionId);
        out.push({
          pageName: rp.name,
          pageSlug: rp.slug,
          pageFound: !!page,
          note: note,
          found: !!hit,
          sectionIndex: hit ? hit.index : -1,
          sectionType: hit ? hit.section.type : note.sectionType,
          // fall back to the recorded heading so an orphaned note still reads
          // as something a human can act on
          heading: hit ? clip(hit.section.title || hit.section.heading || note.heading, MAX_ANCHOR) : note.heading
        });
      });
    });
    return out;
  }

  function summarize(review) {
    const items = (review && Array.isArray(review.pages) ? review.pages : []);
    const total = items.reduce((n, p) => n + (p.notes || []).length, 0);
    return {
      total: total,
      blockers: items.reduce((n, p) => n + (p.notes || []).filter((x) => x.priority === 'blocker').length, 0),
      pages: items.filter((p) => (p.notes || []).length).map((p) => ({ name: p.name, slug: p.slug, count: p.notes.length }))
    };
  }

  // Fold several review files into one — a client often sends notes twice, and
  // the same note id must not appear twice.
  function merge(reviews) {
    const list = (Array.isArray(reviews) ? reviews : []).filter(Boolean);
    if (!list.length) return null;
    const bySlug = new Map();
    let site = '';
    let build = '';
    let at = '';
    list.forEach((r) => {
      site = site || clip(r.site, 120);
      build = build || clip(r.build, 40);
      if (clip(r.at, 40) > at) at = clip(r.at, 40);
      (r.pages || []).forEach((p) => {
        const key = String(p.slug || '');
        if (!bySlug.has(key)) bySlug.set(key, { name: p.name, slug: p.slug, notes: [], seen: new Set() });
        const bucket = bySlug.get(key);
        (p.notes || []).forEach((n) => {
          if (bucket.seen.has(n.id)) return;
          bucket.seen.add(n.id);
          bucket.notes.push(n);
        });
      });
    });
    return create({
      site: site,
      build: build,
      at: at,
      pages: Array.from(bySlug.values()).map((b) => ({ name: b.name, slug: b.slug, notes: b.notes }))
    });
  }

  // Plain-text version for the client's own email client — no attachments, no
  // service in the middle.
  function toPlainText(review) {
    const s = summarize(review);
    const lines = [];
    lines.push('Website feedback — ' + (clip(review && review.site, 120) || 'site'));
    lines.push('Build: ' + (clip(review && review.build, 40) || 'unknown') + '   Notes: ' + s.total);
    lines.push('');
    (review && review.pages || []).forEach((p) => {
      if (!(p.notes || []).length) return;
      lines.push('== ' + p.name + ' (' + p.slug + ') ==');
      p.notes.forEach((n, i) => {
        lines.push('  ' + (i + 1) + '. ' + (n.priority === 'blocker' ? '[BLOCKING] ' : '') +
          (n.heading ? 'On "' + n.heading + '": ' : '') + n.text);
      });
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  // ---- the payload the exported page hands back ---------------------------
  const FILE_SUFFIX = '-review.json';

  function fileNameFor(siteName) {
    const slug = String(siteName || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
    return slug + FILE_SUFFIX;
  }

  return {
    VERSION, MAX_NOTES, MAX_TEXT,
    fnv1a, stable, canonical, stamp, stampCached,
    normalizeNote, parse, create, staleness, attach, summarize, merge, toPlainText, fileNameFor
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Review;

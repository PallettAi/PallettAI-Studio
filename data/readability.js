'use strict';

// ============================================================
// Readability & clarity — is the copy doing its job?
// ------------------------------------------------------------
// Every audit in Studio until now looked at the *machine*: bytes, contrast,
// schema, canonical tags. None of them looked at the sentence, which is what
// actually decides whether a visitor enquires.
//
// The score is deliberately plain arithmetic — Flesch reading ease over a
// syllabic heuristic — because a number nobody can reproduce is a number
// nobody should act on. The findings are the useful part: the longest
// sentence, the paragraph that became a wall, the hedging that makes a claim
// sound like a guess, and the page that never asks for the work.
//
// Pure, offline, and deterministic: the same copy always scores the same.
// ============================================================

const Readability = (() => {

  // ---- text collection ------------------------------------------------------
  // Walks the fields the renderers actually display. A section's `extra` is
  // included because it is usually the closing line, and item text because
  // services and features are where copy goes to hide.
  const TEXT_KEYS = ['title', 'subtitle', 'text', 'extra', 'desc', 'tagline', 'intro', 'answer', 'question', 'label', 'caption', 'quote', 'author'];
  const ITEM_KEYS = ['title', 'text', 'desc', 'label', 'caption'];

  function collect(sections) {
    const out = [];
    (Array.isArray(sections) ? sections : []).forEach((s, i) => {
      if (!s || typeof s !== 'object') return;
      const where = s.type || ('section ' + (i + 1));
      TEXT_KEYS.forEach((k) => {
        const v = s[k];
        if (typeof v === 'string' && v.trim()) out.push({ section: where, field: k, text: v.trim() });
      });
      (Array.isArray(s.items) ? s.items : []).forEach((it) => {
        if (!it || typeof it !== 'object') return;
        ITEM_KEYS.forEach((k) => {
          const v = it[k];
          if (typeof v === 'string' && v.trim()) out.push({ section: where, field: k, text: v.trim() });
        });
      });
    });
    return out;
  }

  // ---- syllables ------------------------------------------------------------
  // A heuristic, and treated as one. It is checked against known words in the
  // smoke test so a change in behaviour is visible rather than silent.
  function syllables(word) {
    let w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    // Silent endings the naive vowel-group count would over-count.
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    w = w.replace(/^y/, '');
    // One group per run of vowels, not per two characters: a triple like the
    // "eau" in "beautiful" is one syllable, and counting it as two inflated
    // every long word. Known misses remain ("create" scores 1, not 2) — the
    // heuristic is pinned in the smoke test so a change is visible rather than
    // silent, and it feeds a smoothed score rather than a verdict.
    const groups = w.match(/[aeiouy]+/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  const wordList = (text) => String(text || '').toLowerCase().match(/[a-z0-9'’-]+/g) || [];

  function splitSentences(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+(?=[^a-z])|(?<=[.!?])$/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function statsOf(text) {
    const words = wordList(text);
    const sentences = splitSentences(text);
    const syl = words.reduce((n, w) => n + syllables(w), 0);
    return {
      words: words.length,
      sentences: sentences.length || (words.length ? 1 : 0),
      syllables: syl,
      longest: sentences.reduce((max, s) => (wordList(s).length > wordList(max).length ? s : max), ''),
      avgSentence: sentences.length ? words.length / sentences.length : 0
    };
  }

  // Flesch reading ease. 60–70 is plain English; below 50 is heavy going.
  function flesch(stat) {
    if (!stat.words || !stat.sentences) return 0;
    const score = 206.835 - 1.015 * (stat.words / stat.sentences) - 84.6 * (stat.syllables / stat.words);
    return Math.max(0, Math.min(120, score));
  }

  // ---- vocabulary the copy should avoid -------------------------------------
  // Hedges make a claim sound like a guess, and a guess does not win work.
  const HEDGES = ['maybe', 'perhaps', 'possibly', 'kind of', 'sort of', 'a bit', 'somewhat', 'we think', 'we believe', 'hopefully', 'try to', 'we aim to'];
  // Words that mean nothing to a visitor and cost the agency credibility.
  const JARGON = ['synergy', 'leverage', 'best-in-class', 'world-class', 'cutting-edge', 'state-of-the-art', 'holistic', 'seamless', 'robust', 'bespoke solutions', 'value-add', 'low-hanging fruit', 'paradigm', 'disrupt', 'game-changer', 'turnkey'];
  // Signals the reader is being spoken to, rather than described at.
  const SECOND_PERSON = /\b(you|your|you're|you'll|we|our|us)\b/i;
  const PASSIVE = /\b(is|are|was|were|be|been|being)\s+([a-z]+ed|born|built|made|sent|shown|given|taken|written|drawn|held|kept)\b/i;

  const LIST_SEPARATOR = /,\s*|\band\b|\bor\b/;

  function analyzePage(page) {
    const entries = collect(page && page.sections);
    const findings = [];
    const full = entries.map((e) => e.text).join(' ');
    const stat = statsOf(full);

    // 1. One sentence carrying too much weight is the single most common
    //    readability problem in agency copy.
    const longSentences = [];
    entries.forEach((e) => {
      splitSentences(e.text).forEach((s) => {
        if (wordList(s).length > 28) longSentences.push({ section: e.section, text: s, words: wordList(s).length });
      });
    });
    longSentences.sort((a, b) => b.words - a.words);
    if (longSentences.length) {
      const worst = longSentences[0];
      findings.push({
        level: 'info',
        msg: longSentences.length + ' sentence' + (longSentences.length === 1 ? '' : 's') + ' over 28 words (longest ' + worst.words + ')',
        fix: 'Longest is in the ' + worst.section + ' section: “' + worst.text.slice(0, 90) + (worst.text.length > 90 ? '…' : '') + '”'
      });
    }

    // 2. A paragraph nobody finishes.
    entries.forEach((e) => {
      const w = wordList(e.text).length;
      if (w > 120) {
        findings.push({ level: 'warn', msg: e.section + ' has a ' + w + '-word block of text', fix: 'Break it into a list — visitors scan, they do not read.' });
      }
    });

    // 3. Hedging.
    const hedges = [];
    HEDGES.forEach((h) => { if (new RegExp('\\b' + h.replace(/ /g, '\\s+') + '\\b', 'i').test(full)) hedges.push(h); });
    if (hedges.length) {
      findings.push({ level: 'info', msg: 'Hedging language: ' + hedges.slice(0, 4).join(', '), fix: 'State what you do plainly; “we think” reads as “we are not sure”.' });
    }

    // 4. Jargon.
    const jargon = [];
    JARGON.forEach((j) => { if (new RegExp('\\b' + j.replace(/-/g, '\\-') + '\\b', 'i').test(full)) jargon.push(j); });
    if (jargon.length) {
      findings.push({ level: 'warn', msg: 'Filler buzzwords: ' + jargon.slice(0, 4).join(', '), fix: 'Say the plain-English equivalent a customer would use.' });
    }

    // 5. Is the reader being addressed?
    if (full && !SECOND_PERSON.test(full)) {
      findings.push({ level: 'info', msg: 'The copy never addresses the reader', fix: 'Words like “you” and “we” turn a description into a conversation.' });
    }

    // 6. Passive voice hides who does the work.
    const passive = entries.filter((e) => PASSIVE.test(e.text));
    if (passive.length >= 2) {
      findings.push({ level: 'info', msg: passive.length + ' passages in the passive voice', fix: '“Kitchens are built by us” → “We build kitchens”.' });
    }

    // 7. A page that never asks for the work is a page that does not convert.
    const asked = entries.some((e) => /(get|book|call|contact|request|order|buy|start|enquir|quote|talk to us|sign up)/i.test(e.text));
    if (entries.length && !asked) {
      findings.push({ level: 'warn', msg: 'No call to action anywhere in the copy', fix: 'Every page should ask for one specific next step.' });
    }

    // 8. Exclamation marks read as shouting, and they cost credibility.
    const bangs = (full.match(/!/g) || []).length;
    if (bangs > 2) findings.push({ level: 'info', msg: bangs + ' exclamation marks', fix: 'One at most — confident copy does not need them.' });

    const ease = flesch(stat);
    let score = 100;
    findings.forEach((f) => { score -= f.level === 'warn' ? 10 : 4; });
    if (ease && ease < 50) score -= 12;
    else if (ease && ease < 60) score -= 5;
    score = Math.max(0, Math.round(score));

    return {
      page: (page && page.name) || 'Untitled',
      slug: (page && page.slug) || '',
      words: stat.words,
      sentences: stat.sentences,
      avgSentence: Math.round(stat.avgSentence * 10) / 10,
      longestSentence: stat.longest ? wordList(stat.longest).length : 0,
      ease: Math.round(ease),
      entries: entries.length,
      findings: findings,
      score: score
    };
  }

  // Plain-English label for a Flesch score, so the number is not a mystery.
  function easeLabel(ease) {
    if (ease >= 80) return 'very easy';
    if (ease >= 60) return 'plain';
    if (ease >= 50) return 'fairly hard';
    if (ease >= 30) return 'hard';
    return 'very hard';
  }

  function grade(project) {
    const pages = BuilderPages(project);
    const list = pages.map(analyzePage);
    const all = [];
    list.forEach((p) => p.findings.forEach((f) => all.push(Object.assign({}, f, { page: p.page }))));
    const words = list.reduce((n, p) => n + p.words, 0);
    const score = list.length ? Math.round(list.reduce((s, p) => s + p.score, 0) / list.length) : 100;
    const letter = score >= 95 ? 'A+' : score >= 88 ? 'A' : score >= 78 ? 'B' : score >= 66 ? 'C' : score >= 50 ? 'D' : 'F';
    return {
      pages: list,
      findings: all,
      words: words,
      score: score,
      letter: letter,
      summary: words === 0
        ? 'No copy to read yet.'
        : words.toLocaleString() + ' words across ' + list.length + ' page' + (list.length === 1 ? '' : 's') + ' — ' + easeLabel(list[0].ease) + ' to read on average.'
    };
  }

  // The project's pages, in the shape the builder exposes. Kept as a tiny
  // indirection so this module can be tested with plain section arrays.
  function BuilderPages(project) {
    if (!project) return [];
    const site = project.site || {};
    if (Array.isArray(site.pages) && site.pages.length) return site.pages;
    return [{ name: site.name || 'Home', slug: 'index', sections: site.sections || [] }];
  }

  return {
    syllables, splitSentences, statsOf, flesch, easeLabel, collect,
    analyzePage, grade, BuilderPages, HEDGES, JARGON
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Readability;

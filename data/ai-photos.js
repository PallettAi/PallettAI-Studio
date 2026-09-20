'use strict';

const REJECT_RE = /\b(diagrams?|maps?|flags?|logos?|icons?|charts?|screenshots?|clipart|seals?|coat of arms|svg|vectors?|book covers?|posters?|infobox)\b/i;
const SCENE_WORDS = ['people', 'interior', 'kitchen', 'oven', 'hands', 'close', 'portrait', 'food', 'workshop', 'chef', 'barista', 'salon', 'studio'];

function asList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  const one = String(value || '').trim();
  return one ? [one] : [];
}

function titleKey(title) {
  return String(title || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40);
}

function expandScenes(scenes) {
  const src = scenes || {};
  const hero = asList(src.hero);
  const about = asList(src.about);
  const gal = asList(src.gallery);
  const base = gal[0] || hero[0] || 'photo';
  const gallery = gal.length >= 3
    ? gal
    : [base, base + ' close up', base + ' detail', base + ' in use'];
  return {
    hero: hero.length ? hero : [base],
    about: about.length ? about : [base + ' interior'],
    gallery
  };
}

function sceneQuery(scenes, key, index, seed) {
  const expanded = expandScenes(scenes);
  const list = expanded[key] || expanded.hero;
  const i = Math.abs((Number(seed) || 0) + (Number(index) || 0)) % list.length;
  return list[i] || list[0] || 'photo';
}

function isRejected(cand, slot) {
  if (!cand || !cand.url) return true;
  const blob = [cand.title, cand.url, cand.src].join(' ');
  if (REJECT_RE.test(blob)) return true;
  const w = Number(cand.w) || 0;
  if (w) {
    const floor = slot === 'hero' ? 1200 : 800;
    if (w < floor) return true;
  }
  return false;
}

function aspectBonus(slot, w, h) {
  if (!w || !h) return 0;
  const r = w / h;
  if (slot === 'hero') return r >= 1.4 ? 140 : r >= 1.1 ? 20 : -90;
  if (slot === 'about') return (r >= 0.7 && r <= 1.3) ? 35 : 0;
  return 0;
}

function sceneBonus(title) {
  const t = String(title || '').toLowerCase();
  let n = 0;
  SCENE_WORDS.forEach((word) => { if (t.indexOf(word) !== -1) n += 12; });
  return n;
}

/* ------------- meaning -------------
   Everything above this line decides which of two candidates is the better
   BITMAP: resolution, aspect for the slot, a few scene words, and a penalty for
   placeholder hosts. None of it knows what the photo is of, which is why a
   brief for "wood-fired oven" could be answered with a stock office and score
   identically — `title` was only ever scanned for the twelve words in
   SCENE_WORDS.

   data/ai-embed.js supplies the half that was missing: how close the candidate's
   own words are to the brief. It is deliberately a tiebreaker rather than a
   decider (see MEANING_WEIGHT), because the bitmap facts are hard constraints —
   a beautifully relevant photo that is 400px wide is still the wrong hero — and
   because a candidate titled nothing at all must not be able to win by scoring
   zero on a measure it has no words for. */
const MEANING_WEIGHT = 200;

function meaningLib() {
  if (typeof AiEmbed !== 'undefined') return AiEmbed;
  try { if (typeof require === 'function') return require('./ai-embed.js'); } catch (e) { /* classic script */ }
  return null;
}

function meaningOf(cand, brief) {
  const E = meaningLib();
  const text = String(brief == null ? '' : brief).trim();
  if (!E || !text) return { weight: 0, why: [] };
  const blob = [cand.title, cand.url, cand.src].filter(Boolean).join(' ');
  const s = Number(E.score(text, blob)) || 0;
  return { weight: Math.round(s * MEANING_WEIGHT), why: E.why(text, blob, 3) };
}

function rank(pool, opts) {
  const src = opts || {};
  const slot = src.slot || 'hero';
  /* The brief is whatever the studio asked for in words: the scene query for a
     slot, or the client's own description when the caller has one. With no brief
     the scoring is exactly what it was before meaning existed. */
  const brief = src.brief || '';
  const usedUrls = new Set(src.usedUrls || []);
  const usedTitles = new Set((src.usedTitles || []).map(titleKey).filter(Boolean));
  const list = Array.isArray(pool) ? pool.slice() : [];
  const sliced = list.length >= 3 ? list.slice(2) : list;
  return sliced.filter((cand) => {
    if (isRejected(cand, slot)) return false;
    if (usedUrls.has(cand.url)) return false;
    const key = titleKey(cand.title);
    if (key && usedTitles.has(key)) return false;
    return true;
  }).map((cand) => {
    const w = Number(cand.w) || 0;
    const h = Number(cand.h) || 0;
    const lorem = /loremflickr/i.test(String(cand.src || ''));
    const m = meaningOf(cand, brief);
    const score = (w * h) / 8000 + aspectBonus(slot, w, h) + sceneBonus(cand.title) + (lorem ? -1000 : 0) + m.weight;
    return Object.assign({}, cand, { score, why: m.why });
  }).sort((a, b) => b.score - a.score);
}

function pick(ranked, seed) {
  if (!ranked || !ranked.length) return null;
  const top = ranked[0].score;
  const band = ranked.filter((c) => c.score >= top - 18);
  return band[Math.abs(Number(seed) || 0) % band.length] || ranked[0];
}

const AiPhotos = { expandScenes, sceneQuery, isRejected, rank, pick, titleKey, meaningOf, MEANING_WEIGHT };
if (typeof module !== 'undefined' && module.exports) module.exports = AiPhotos;

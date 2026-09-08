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

function rank(pool, opts) {
  const src = opts || {};
  const slot = src.slot || 'hero';
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
    const score = (w * h) / 8000 + aspectBonus(slot, w, h) + sceneBonus(cand.title) + (lorem ? -1000 : 0);
    return Object.assign({}, cand, { score });
  }).sort((a, b) => b.score - a.score);
}

function pick(ranked, seed) {
  if (!ranked || !ranked.length) return null;
  const top = ranked[0].score;
  const band = ranked.filter((c) => c.score >= top - 18);
  return band[Math.abs(Number(seed) || 0) % band.length] || ranked[0];
}

const AiPhotos = { expandScenes, sceneQuery, isRejected, rank, pick, titleKey };
if (typeof module !== 'undefined' && module.exports) module.exports = AiPhotos;

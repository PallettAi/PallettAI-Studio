'use strict';

const TONES = { warm: true, premium: true, punchy: true };

function clip(s, n) {
  return String(s || '').trim().replace(/\s+/g, ' ').slice(0, n);
}

function normalizeBrief(input) {
  const src = input || {};
  const proofsIn = Array.isArray(src.proofs) ? src.proofs : [];
  const proofs = [0, 1, 2].map((i) => clip(proofsIn[i], 140));
  const voice = TONES[String(src.voice || '').toLowerCase()] ? String(src.voice).toLowerCase() : 'warm';
  return {
    name: clip(src.name, 80),
    area: clip(src.area, 80),
    offer: clip(src.offer, 160),
    proofs,
    cta: clip(src.cta, 80),
    voice
  };
}

function briefFilled(brief) {
  const b = brief || {};
  if (clip(b.name, 80) || clip(b.offer, 160) || clip(b.cta, 80)) return true;
  return (b.proofs || []).some((p) => clip(p, 140));
}

function normalizeVoice(input) {
  const src = input || {};
  const tone = TONES[String(src.tone || src.voice || '').toLowerCase()]
    ? String(src.tone || src.voice).toLowerCase()
    : 'warm';
  const banned = (Array.isArray(src.banned) ? src.banned : [])
    .map((w) => clip(w, 40))
    .filter(Boolean);
  return { tone, banned };
}

function applyVoice(text, voice) {
  let out = String(text || '').trim();
  const v = normalizeVoice(voice);
  v.banned.forEach((word) => {
    const re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    out = out.replace(re, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  });
  if (v.tone === 'punchy') {
    const cut = out.split(/(?<=[.!?])\s+/)[0] || out;
    out = cut.length > 90 ? cut.slice(0, 87).replace(/\s+\S*$/, '') + '.' : cut;
  } else if (v.tone === 'premium') {
    if (out.length && !/[.!?]$/.test(out)) out += '.';
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

const AiBrief = { normalizeBrief, briefFilled, normalizeVoice, applyVoice };
if (typeof module !== 'undefined' && module.exports) module.exports = AiBrief;

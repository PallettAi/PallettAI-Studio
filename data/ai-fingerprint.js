'use strict';

function clip(s, n) {
  return String(s || '').trim().replace(/\s+/g, ' ').slice(0, n || 200);
}

function hash(s) {
  let h = 7;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function make(input) {
  const src = input || {};
  const salt = Number(src.salt) || 0;
  const prompt = clip(src.prompt, 400);
  const key = [
    clip(src.name, 80).toLowerCase(),
    clip(src.area, 80).toLowerCase(),
    clip(src.offer, 160).toLowerCase(),
    clip(src.voice, 20).toLowerCase(),
    clip(src.nicheId, 40).toLowerCase(),
    prompt.toLowerCase(),
    String(salt)
  ].join('|');
  return { key, seed: hash(key), salt, prompt };
}

function nextSalt(salt) {
  return (Number(salt) || 0) + 1;
}

function seededShuffle(arr, seed) {
  const out = Array.isArray(arr) ? arr.slice() : [];
  let s = (Math.abs(Number(seed) || 0) || 1) >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

function orderSections(sections, seed) {
  const list = Array.isArray(sections) ? sections.slice() : [];
  const head = [];
  const mid = [];
  const tail = [];
  list.forEach((s) => {
    const t = s && s.type;
    if (t === 'hero') head.push(s);
    else if (t === 'cta' || t === 'contact') tail.push(s);
    else mid.push(s);
  });
  const rank = (t) => (t === 'cta' ? 0 : t === 'contact' ? 1 : 2);
  tail.sort((a, b) => rank(a.type) - rank(b.type));
  return head.concat(seededShuffle(mid, seed)).concat(tail);
}

function photoGradeSpec(opts) {
  const src = opts || {};
  if (!src.on) return { on: false, blend: 'color', strength: 0 };
  const typeId = String(src.typeId || '');
  const look = String(src.look || '');
  const foodish = typeId === 'food' || typeId === 'beauty';
  const dark = look === 'dark' || look === 'noir' || look === 'techy';
  if (foodish) return { on: true, blend: 'soft-light', strength: 0.12 };
  return { on: true, blend: 'color', strength: dark ? 0.16 : 0.14 };
}

const AiFingerprint = { make, nextSalt, seededShuffle, orderSections, photoGradeSpec };
if (typeof module !== 'undefined' && module.exports) module.exports = AiFingerprint;

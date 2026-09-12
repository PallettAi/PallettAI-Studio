// ============================================================
// PallettAI Studio — saved client briefs (pure logic)
// Roadmap #7: reuse a client's brief, niche pack, photo mode and
// taste settings for repeat builds. No DOM, no storage — the app
// persists via AppStore/localStorage; the smoke test drives it raw.
//
// Shape of a saved brief:
//   {
//     id, name, prompt, brief:{name, area, offer, proofs[3], cta, voice},
//     packId, photoMode, photoGrade, onePager, layouts, updatedAt
//   }
// ============================================================

'use strict';

const Briefs = (() => {
  const MAX_BRIEFS = 40;
  const MAX_NAME = 80;
  const MAX_PROMPT = 800;
  const MAX_PACK = 60;
  const VOICES = ['warm', 'premium', 'punchy'];

  const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const uid = () =>
    'brf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function looksLikeBrief(b) {
    return !!(b && typeof b === 'object' && (clip(b.prompt, 1) || (b.brief && typeof b.brief === 'object')));
  }

  // Normalize a brief record defensively — never trusts stored input.
  function normalize(input) {
    const src = input || {};
    const proofs = [0, 1, 2].map((i) => clip(
      (Array.isArray(src.proofs) ? src.proofs[i] : (src.brief && src.brief.proofs && src.brief.proofs[i])), 140));
    const vb = (src.brief && typeof src.brief === 'object' ? src.brief : {});
    const voice = VOICES.indexOf(String(vb.voice || '').toLowerCase()) !== -1
      ? String(vb.voice).toLowerCase() : 'warm';
    return {
      id: clip(src.id, 40) || uid(),
      name: clip(src.name, MAX_NAME) || 'Untitled brief',
      prompt: clip(src.prompt, MAX_PROMPT),
      brief: {
        name: clip(vb.name, 80),
        area: clip(vb.area, 80),
        offer: clip(vb.offer, 160),
        proofs,
        cta: clip(vb.cta, 80),
        voice
      },
      packId: clip(src.packId, MAX_PACK),
      photoMode: ['real', 'ai', 'none'].indexOf(src.photoMode) !== -1 ? src.photoMode : 'real',
      photoGrade: src.photoGrade === true,
      onePager: src.onePager === true,
      layouts: src.layouts === 'classic' ? 'classic' : 'auto',
      updatedAt: Number.isFinite(Number(src.updatedAt)) ? Number(src.updatedAt) : Date.now()
    };
  }

  // Merge an options object (as collected from the AI form) into the record.
  function fromOptions(opts, name) {
    const o = opts || {};
    const rec = normalize({
      name: name || o.name || (o.brief && o.brief.name) || 'Untitled brief',
      prompt: o.prompt || '',
      brief: o.brief || {},
      packId: o.packId || '',
      photoMode: o.photoMode,
      photoGrade: o.photoGrade,
      onePager: o.onePager,
      layouts: o.layouts
    });
    // keep the collection name distinct from the business name inside the brief
    if (!name && o.brief && o.brief.name) rec.name = clip(o.brief.name, MAX_NAME) || rec.name;
    return rec;
  }

  // Pure array ops on a saved-brief list (the app passes its own array).
  function upsert(list, rec) {
    if (!looksLikeBrief(rec)) return Array.isArray(list) ? list.filter(looksLikeBrief) : [];
    const clean = Array.isArray(list) ? list.filter(looksLikeBrief) : [];
    const i = clean.findIndex((x) => x && x.id === rec.id);
    if (i !== -1) clean[i] = rec;
    else clean.unshift(rec);
    return clean.slice(0, MAX_BRIEFS);
  }

  function remove(list, id) {
    return (Array.isArray(list) ? list : []).filter((x) => x && x.id !== id);
  }

  function rename(list, id, name) {
    const out = (Array.isArray(list) ? list : []).map((x) =>
      x && x.id === id ? normalize({ ...x, name }) : x);
    return out;
  }

  // Fuzzy-search saved briefs by name + prompt + business fields.
  function search(list, query) {
    const q = clip(query, 80).toLowerCase();
    const src = Array.isArray(list) ? list : [];
    if (!q) return src;
    return src.filter((b) => (
      (b.name || '') + ' ' + (b.prompt || '') + ' ' +
      (((b.brief || {}).name || '') + ' ' + ((b.brief || {}).area || '') + ' ' + ((b.brief || {}).offer || ''))
    ).toLowerCase().indexOf(q) !== -1);
  }

  return {
    MAX_BRIEFS,
    normalize,
    fromOptions,
    upsert,
    remove,
    rename,
    search,
    looksLikeBrief
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Briefs;

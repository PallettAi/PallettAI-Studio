'use strict';

// Facts are deliberately metadata, not a second copy engine. The ledger makes
// provenance visible so later Copilot passes can distinguish what the client
// actually said from what the generator suggested.
const FACT_LIMITS = { key: 60, value: 240, source: 180, max: 48 };
function clip(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }
function add(out, key, value, source, confidence, use) {
  const k = clip(key, FACT_LIMITS.key), v = clip(value, FACT_LIMITS.value);
  if (!k || !v || out.some((x) => x.key === k && x.value === v)) return;
  out.push({ key: k, value: v, source: clip(source, FACT_LIMITS.source), confidence, use });
}
function fromBrief(out, brief) {
  const b = brief || {};
  add(out, 'business name', b.name, 'client brief', 'client', 'identity');
  add(out, 'area served', b.area, 'client brief', 'client', 'copy');
  add(out, 'offer', b.offer, 'client brief', 'client', 'copy');
  add(out, 'primary call to action', b.cta, 'client brief', 'client', 'conversion');
  (Array.isArray(b.proofs) ? b.proofs : []).forEach((x, i) => add(out, 'proof ' + (i + 1), x, 'client brief', 'client', 'copy'));
}
function fromWebsite(out, site) {
  const s = site || {};
  add(out, 'business name', s.brand || s.name, 'existing website', 'extracted', 'identity');
  add(out, 'tagline', s.tagline, 'existing website', 'extracted', 'copy');
  add(out, 'email', s.email, 'existing website', 'extracted', 'contact');
  add(out, 'phone', s.phone, 'existing website', 'extracted', 'contact');
  add(out, 'address', s.address, 'existing website', 'extracted', 'contact');
  add(out, 'area served', s.area, 'existing website', 'extracted', 'copy');
  add(out, 'about text', s.about, 'existing website', 'extracted', 'review');
  (Array.isArray(s.services) ? s.services : []).slice(0, 8).forEach((x, i) => add(out, 'service ' + (i + 1), typeof x === 'string' ? x : x && x.title, 'existing website', 'extracted', 'structure'));
}
function fromReferences(out, refs) {
  (Array.isArray(refs) ? refs : []).slice(0, 3).forEach((r, i) => {
    const source = 'reference ' + (i + 1) + (r && r.url ? ' · ' + r.url : '');
    // Reference facts are explicitly marked reference-only: they may guide
    // structure, never become asserted client claims by accident.
    (Array.isArray(r && r.services) ? r.services : []).slice(0, 6).forEach((x, j) => add(out, 'reference service ' + (j + 1), typeof x === 'string' ? x : x && x.title, source, 'reference', 'inspiration-only'));
  });
}
function build(opts) {
  const o = opts || {}, entries = [];
  fromBrief(entries, o.brief);
  fromWebsite(entries, o.website);
  fromReferences(entries, o.references || o.studied);
  return {
    version: 1,
    entries: entries.slice(0, FACT_LIMITS.max),
    clientFacts: entries.filter((x) => x.confidence === 'client'),
    extractedFacts: entries.filter((x) => x.confidence === 'extracted'),
    referenceFacts: entries.filter((x) => x.confidence === 'reference'),
    policy: { client: 'may-drive-copy', extracted: 'verify-before-claim', reference: 'inspiration-only' }
  };
}
const AiFacts = { build, FACT_LIMITS };
if (typeof module !== 'undefined' && module.exports) module.exports = AiFacts;

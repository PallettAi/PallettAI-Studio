'use strict';

/*
  Originality engine
  ------------------
  Inspired by OpenPage/StyleSeed composition grammars, Dembrandt-style design
  fingerprints and visual-regression thinking. This is native Studio code: no
  hosted model, no external runtime and no copied implementation.

  A seed variation is not enough. This module measures the resulting site and
  compares it with the creator's existing projects and supplied references.
*/

const ORIGINALITY_GRAMMARS = Object.freeze([
  'editorial-cadence', 'cinematic-contrast', 'architectural-grid',
  'kinetic-ledger', 'organic-atlas', 'quiet-luxury', 'brutalist-signal',
  'gallery-journey', 'product-laboratory', 'human-documentary'
]);
const ORIGINALITY_LIMITS = Object.freeze({ peers: 32, tokens: 180 });

function text(v) { return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function words(v) { return text(v).split(/\s+/).filter((x) => x.length > 2); }
function set(v) { return new Set(words(v)); }
function overlap(a, b) {
  const aa = set(a), bb = set(b);
  if (!aa.size || !bb.size) return 0;
  let hit = 0; aa.forEach((x) => { if (bb.has(x)) hit++; });
  return hit / Math.sqrt(aa.size * bb.size);
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, Number(n) || 0)); }
function hash(v) { let h = 2166136261; for (const c of String(v || '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function pick(list, seed) { const a = Array.isArray(list) ? list : []; return a.length ? a[Math.abs(Number(seed) || 0) % a.length] : ''; }

function sectionTypes(site) {
  const s = site || {};
  const pages = Array.isArray(s.pages) && s.pages.length ? s.pages : [{ sections: s.sections || [] }];
  return pages.flatMap((p) => Array.isArray(p && p.sections) ? p.sections : []).map((x) => x && x.type).filter(Boolean);
}
function sectionSignature(site) { return sectionTypes(site).join('>'); }
function contentText(site) {
  const s = site || {}, out = [s.name, s.tagline, s.description];
  const pages = Array.isArray(s.pages) && s.pages.length ? s.pages : [{ sections: s.sections || [] }];
  pages.forEach((p) => (p.sections || []).forEach((sec) => {
    out.push(sec.title, sec.subtitle, sec.text);
    (sec.items || []).forEach((it) => out.push(it && it.title, it && it.text));
  }));
  return words(out.filter(Boolean).join(' ')).slice(0, ORIGINALITY_LIMITS.tokens).join(' ');
}
function visualSignature(site) {
  const s = site || {}, d = s.design || {};
  const sections = Array.isArray(s.pages) && s.pages.length ? s.pages.flatMap((p) => p.sections || []) : (s.sections || []);
  return [
    s.palette, s.font, s.fontDisplay, d.containerWidth, d.radius, d.spacing,
    s.navStyle, s.navSticky, s.dnaLook, s.compose && s.compose.family,
    sections.map((x) => [x.type, x.layout, x.animation].join(':')).join('|')
  ].map((x) => String(x == null ? '' : x)).join('¦');
}
function fingerprint(project) {
  const site = (project && project.site) || project || {};
  const types = sectionTypes(site);
  return {
    grammar: site.originality && site.originality.grammar || '',
    structure: sectionSignature(site),
    visual: visualSignature(site),
    copy: contentText(site),
    sectionSet: Array.from(new Set(types)).sort().join(','),
    key: hash([sectionSignature(site), visualSignature(site), contentText(site)].join('¦')).toString(16)
  };
}
function distance(a, b) {
  const aa = fingerprint(a), bb = fingerprint(b);
  const structure = aa.structure === bb.structure ? 0 : 1 - overlap(aa.structure, bb.structure);
  const visual = aa.visual === bb.visual ? 0 : 1 - overlap(aa.visual, bb.visual);
  const copy = 1 - clamp(overlap(aa.copy, bb.copy), 0, 1);
  const grammar = (!aa.grammar && !bb.grammar) || aa.grammar === bb.grammar ? 0 : 1;
  return { structure: Number(clamp(structure, 0, 1).toFixed(3)), visual: Number(clamp(visual, 0, 1).toFixed(3)), copy: Number(clamp(copy, 0, 1).toFixed(3)), grammar, score: Number((structure * 0.42 + visual * 0.38 + copy * 0.12 + grammar * 0.08).toFixed(3)) };
}
function grammarFor(seed, type, niche) {
  return pick(ORIGINALITY_GRAMMARS, hash([seed, type, niche].join(':')));
}
function referenceDistance(project, refs) {
  const site = (project && project.site) || project || {};
  const candidate = contentText(site) + ' ' + sectionSignature(site);
  const matches = (Array.isArray(refs) ? refs : []).slice(0, 3).map((ref, index) => {
    const source = [ref && ref.text, ref && ref.tagline, ref && ref.structure, ...(ref && ref.services || [])].filter(Boolean).join(' ');
    const similarity = Number(clamp(overlap(candidate, source), 0, 1).toFixed(3));
    return { index, url: String((ref && ref.url) || ''), similarity, distance: Number((1 - similarity).toFixed(3)) };
  });
  const closest = matches.reduce((best, x) => Math.max(best, x.similarity), 0);
  return { threshold: .62, closest, safe: closest < .62, matches };
}
function audit(project, peers, refs) {
  const current = fingerprint(project);
  const comparisons = (Array.isArray(peers) ? peers : []).slice(0, ORIGINALITY_LIMITS.peers).filter(Boolean).map((peer) => ({ id: peer.id || '', distance: distance(project, peer) }));
  const closest = comparisons.reduce((best, x) => Math.min(best, x.distance.score), 1);
  const reference = referenceDistance(project, refs);
  const score = Math.round(clamp(closest * 80 + (reference.safe ? 20 : reference.distance * 20), 0, 100));
  return { version: 1, fingerprint: current, score, closestPeerDistance: Number(closest.toFixed(3)), reference, comparisons: comparisons.slice(0, 8), needsRemix: score < 58 || !reference.safe, grammar: current.grammar };
}
function originalityClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
}
function firstHero(site) {
  const pages = Array.isArray(site && site.pages) && site.pages.length ? site.pages : [{ sections: site && site.sections || [] }];
  for (const page of pages) {
    const hit = (page && page.sections || []).find((sec) => sec && sec.type === 'hero');
    if (hit) return hit;
  }
  return null;
}
function candidateMemory(peers, memory) {
  const out = [];
  (Array.isArray(peers) ? peers : []).forEach((peer) => {
    const o = peer && peer.site && peer.site.originality;
    if (o && o.grammar) out.push(String(o.grammar));
    if (o && Array.isArray(o.rejectedGrammars)) o.rejectedGrammars.forEach((x) => out.push(String(x)));
  });
  if (memory && Array.isArray(memory.rejectedGrammars)) memory.rejectedGrammars.forEach((x) => out.push(String(x)));
  return Array.from(new Set(out)).slice(0, 24);
}
function mutateCandidate(project, seed, grammar) {
  const candidate = originalityClone(project);
  if (!candidate || !candidate.site) return null;
  const site = candidate.site;
  const hero = firstHero(site);
  const layouts = ['split', 'minimal', 'centered', 'terminal'];
  if (hero) hero.layout = pick(layouts, hash([seed, grammar, 'hero'].join(':')));
  const pages = Array.isArray(site.pages) && site.pages.length ? site.pages : [{ sections: site.sections || [] }];
  pages.forEach((page, pageIndex) => {
    if (!Array.isArray(page.sections)) return;
    // Preserve the first two narrative beats chosen by the composition family
    // (for example menu/gallery before features for food). Originality should
    // change the rhythm, never erase the business's signature proof block.
    const anchors = page.sections.filter((sec) => sec && !['hero', 'cta', 'contact'].includes(sec.type)).slice(0, 2);
    const anchorIds = new Set(anchors);
    const movable = page.sections.filter((sec) => sec && !['hero', 'cta', 'contact'].includes(sec.type) && !anchorIds.has(sec));
    const reordered = movable.slice().sort((a, b) => hash([seed, grammar, pageIndex, a.type].join(':')) - hash([seed, grammar, pageIndex, b.type].join(':')));
    let cursor = 0;
    page.sections = page.sections.map((sec) => {
      if (anchorIds.has(sec)) return sec;
      if (sec && !['hero', 'cta', 'contact'].includes(sec.type)) return reordered[cursor++];
      return sec;
    });
  });
  // Keep the legacy alias in sync: the renderer and older callers read
  // site.sections even when the project also has a pages array.
  site.sections = pages[0].sections;
  site.originality = Object.assign({}, site.originality, { grammar, candidateSeed: Number(seed) || 0 });
  return candidate;
}
function candidateGate(project, peers, refs, opts) {
  const o = opts || {}, source = project && project.site;
  if (!source) return { project, report: null, candidates: 0, rejectedGrammars: [] };
  const memory = candidateMemory(peers, o.memory);
  const count = Math.max(3, Math.min(7, Number(o.candidates) || 5));
  const candidates = [project];
  for (let i = 1; i < count; i++) {
    let grammar = grammarFor(Number(o.seed) + i * 7919, project.aiType, project.aiNicheId);
    if (memory.includes(grammar)) {
      const fresh = ORIGINALITY_GRAMMARS.filter((x) => !memory.includes(x));
      grammar = pick(fresh.length ? fresh : ORIGINALITY_GRAMMARS, hash([o.seed, i, 'fresh']));
    }
    const candidate = mutateCandidate(project, Number(o.seed) + i * 7919, grammar);
    if (candidate) candidates.push(candidate);
  }
  const ranked = candidates.map((candidate, index) => ({ candidate, index, report: audit(candidate, peers, refs) }))
    .sort((a, b) => b.report.score - a.report.score
      || b.report.closestPeerDistance - a.report.closestPeerDistance
      // Equal scores are common when there are no peers yet. Prefer a generated
      // alternative over the untouched starter so a fresh account still gets a
      // deliberate direction rather than a false "winner" at index zero.
      || (a.index === 0 ? 1 : b.index === 0 ? -1 : b.index - a.index));
  const winner = ranked[0] || { candidate: project, report: audit(project, peers, refs), index: 0 };
  const rejected = ranked.slice(1).map((entry) => entry.candidate.site && entry.candidate.site.originality && entry.candidate.site.originality.grammar).filter(Boolean);
  return { project: winner.candidate, report: winner.report, candidates: ranked.length, winnerIndex: winner.index, rejectedGrammars: rejected.slice(0, 8), memoryUsed: memory };
}
function repair(project, peers, seed) {
  const result = candidateGate(project, peers, [], { seed, candidates: 5 });
  if (!result.project || result.project === project) return { changed: false, reason: 'no stronger candidate', before: result.report && result.report.score, after: result.report && result.report.score };
  return { changed: true, before: audit(project, peers, []).score, after: result.report.score, candidates: result.candidates, winnerIndex: result.winnerIndex, grammar: result.project.site.originality && result.project.site.originality.grammar, project: result.project };
}
function apply(project, opts) {
  const o = opts || {}, site = project && project.site;
  if (!site) return null;
  site.originality = Object.assign({}, site.originality, {
    version: 2,
    grammar: site.originality && site.originality.grammar || grammarFor(o.seed, project.aiType, project.aiNicheId),
    signature: fingerprint(project).key,
    audited: true
  });
  const gated = candidateGate(project, o.peers || [], o.references || [], { seed: o.seed, memory: o.memory, candidates: o.candidates || 5 });
  let chosen = gated.project || project;
  let report = gated.report || audit(chosen, o.peers || [], o.references || []);
  let repairResult = null;
  if (chosen !== project) {
    repairResult = { changed: true, candidates: gated.candidates, winnerIndex: gated.winnerIndex, score: report.score };
  }
  if (report.needsRemix && o.repair !== false) {
    const repaired = repair(chosen, o.peers || [], Number(o.seed) + 31);
    if (repaired.changed && repaired.project) {
      chosen = repaired.project;
      report = audit(chosen, o.peers || [], o.references || []);
      repairResult = Object.assign({}, repaired, { project: undefined });
    }
  }
  const chosenSite = chosen.site;
  chosenSite.originality = Object.assign({}, chosenSite.originality, {
    version: 2, score: report.score, needsRemix: report.needsRemix,
    closestPeerDistance: report.closestPeerDistance, referenceSafe: report.reference.safe,
    candidates: gated.candidates, winnerIndex: gated.winnerIndex,
    rejectedGrammars: gated.rejectedGrammars, memoryUsed: gated.memoryUsed,
    repair: repairResult, signature: fingerprint(chosen).key
  });
  if (chosen !== project) {
    project.site = chosenSite;
    project.site.originality = chosenSite.originality;
  }
  return { report, repair: repairResult, candidates: gated.candidates, project: chosen };
}
function validate(report) {
  return !!(report && Number.isFinite(Number(report.score)) && report.score >= 0 && report.score <= 100 && report.fingerprint && typeof report.fingerprint.key === 'string' && report.reference && typeof report.reference.safe === 'boolean');
}
const AiOriginality = { ORIGINALITY_GRAMMARS, fingerprint, sectionSignature, visualSignature, contentText, distance, grammarFor, referenceDistance, audit, candidateGate, repair, apply, validate };
if (typeof module !== 'undefined' && module.exports) module.exports = AiOriginality;
if (typeof window !== 'undefined') window.AiOriginality = AiOriginality;

'use strict';

/*
  PallettAI Director
  ------------------
  A small, dependency-free layer inspired by OpenPage's JSON-first composition,
  SemanticFinder's private browser-side retrieval, and promptfoo's insistence
  that AI behaviour is measurable. It is deliberately not a copied framework:
  Studio remains vanilla, offline-capable and exportable as files.

  The Director turns a brief into a typed creative strategy, retrieves the most
  relevant project context for Copilot, and validates the result before it can
  influence a generation. No network, model key or telemetry is involved.
*/

const DIRECTOR_STOP = new Set([
  'a','an','the','and','or','for','to','of','in','on','with','from','we','our','my','i','is','are','be','this','that','site','website','make','build','create','please','want','need'
]);
const DIRECTOR_LIMITS = Object.freeze({ text: 320, list: 8, sections: 24 });

function directorTokens(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((x) => x.length > 2 && !DIRECTOR_STOP.has(x));
}
function directorCounts(value) {
  const out = Object.create(null);
  directorTokens(value).forEach((x) => { out[x] = (out[x] || 0) + 1; });
  return out;
}
function directorOverlap(a, b) {
  const aa = new Set(directorTokens(a)), bb = new Set(directorTokens(b));
  if (!aa.size || !bb.size) return 0;
  let hit = 0; aa.forEach((x) => { if (bb.has(x)) hit++; });
  return hit / Math.sqrt(aa.size * bb.size);
}
function clip(value, max) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || DIRECTOR_LIMITS.text); }
function unique(list, max) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((x) => { const v = clip(x, 160); if (v && out.indexOf(v) === -1) out.push(v); });
  return out.slice(0, max || DIRECTOR_LIMITS.list);
}
function pick(list, seed) {
  const arr = Array.isArray(list) ? list : [];
  return arr.length ? arr[Math.abs(Number(seed) || 0) % arr.length] : '';
}

const JOBS = [
  ['learn', ['learn','understand','discover','explain','information']],
  ['compare', ['compare','difference','options','choose','versus']],
  ['trust', ['trust','proof','reviews','results','experience','safe']],
  ['book', ['book','booking','appointment','reserve','schedule']],
  ['buy', ['buy','shop','price','pricing','cost','order']],
  ['contact', ['contact','enquire','enquiry','quote','message','call']]
];
const OBJECTIONS = [
  ['price', ['price','cost','expensive','budget','fee']],
  ['trust', ['trust','proof','review','qualified','guarantee']],
  ['time', ['quick','fast','when','duration','availability']],
  ['fit', ['fit','suitable','right','help','for me']],
  ['location', ['where','area','local','near','delivery']]
];
const SIGNATURES = [
  { id: 'menu-reveal', label: 'Menu reveal', target: 'table', layout: 'compare', jobs: ['buy','compare'] },
  { id: 'process-route', label: 'Process route', target: 'about', layout: 'timeline', jobs: ['trust','learn','contact'] },
  { id: 'proof-wall', label: 'Proof wall', target: 'testimonials', layout: 'masonry', jobs: ['trust'] },
  { id: 'case-study', label: 'Case-study gallery', target: 'gallery', layout: 'mosaic', jobs: ['learn','compare'] },
  { id: 'impact-ledger', label: 'Impact ledger', target: 'stats', layout: 'band', jobs: ['trust','buy'] },
  { id: 'story-pulse', label: 'Story pulse', target: 'about', layout: 'floating', jobs: ['learn','contact'] }
];
function signatureFor(type, niche, job, personality, seed, requested) {
  const requestedHit = SIGNATURES.find((x) => x.id === String(requested || '') && (!x.jobs.length || x.jobs.includes(job)));
  if (requestedHit) return requestedHit;
  const eligible = SIGNATURES.filter((x) => !x.jobs.length || x.jobs.includes(job));
  const preferred = personality === 'cinematic' ? eligible.filter((x) => ['case-study','story-pulse'].includes(x.id))
    : personality === 'tactile' ? eligible.filter((x) => ['process-route','story-pulse'].includes(x.id))
      : personality === 'kinetic' ? eligible.filter((x) => ['impact-ledger','proof-wall'].includes(x.id)) : eligible;
  const pool = preferred.length ? preferred : eligible.length ? eligible : SIGNATURES;
  return pool[Math.abs(Number(seed) || 0) % pool.length];
}

function inferLabels(text, table) {
  const n = String(text || '').toLowerCase();
  return table.filter((entry) => entry[1].some((word) => n.indexOf(word) !== -1)).map((entry) => entry[0]);
}
function inferAudience(brief, text) {
  const raw = [brief && brief.audience, brief && brief.area, brief && brief.offer, text].filter(Boolean).join(' ');
  const labels = inferLabels(raw, [['local',['local','nearby','area']],['professional',['business','client','team']],['consumer',['family','home','personal']],['visitor',['visitor','guest','tourist']]]);
  return labels.length ? labels.slice(0, 3) : ['prospective customer'];
}

function compile(input) {
  const o = input || {}, brief = o.brief || {}, text = clip([o.prompt, brief.offer, brief.audience, brief.cta].filter(Boolean).join(' '), 900);
  const type = clip(o.typeId || 'generic', 30);
  const niche = clip(o.nicheId || '', 40);
  const proofs = unique(brief.proofs || [], 5);
  const facts = o.factLedger && Array.isArray(o.factLedger.clientFacts) ? o.factLedger.clientFacts : [];
  const factText = facts.map((x) => x && x.value).filter(Boolean).join(' ');
  const jobs = inferLabels(text + ' ' + factText, JOBS);
  const objections = inferLabels(text + ' ' + factText, OBJECTIONS);
  const creative = o.creativeBrief && typeof o.creativeBrief === 'object' ? o.creativeBrief : {};
  const allowedJobs = new Set(JOBS.map((entry) => entry[0]));
  const primaryJob = allowedJobs.has(String(creative.goal || '')) ? String(creative.goal) : (jobs[0] || (brief.cta ? 'contact' : 'learn'));
  const pathByJob = {
    learn: ['orient','explain','prove','contact'], compare: ['orient','compare','prove','choose'],
    trust: ['orient','prove','explain','contact'], book: ['orient','availability','book','confirm'],
    buy: ['orient','value','choose','buy'], contact: ['orient','reassure','contact']
  };
  const path = pathByJob[primaryJob] || pathByJob.learn;
  const signature = signatureFor(type, niche, primaryJob, creative.personality, o.seed, creative.signature);
  const content = {
    hero: primaryJob === 'buy' ? 'value-first' : primaryJob === 'trust' ? 'proof-first' : 'clarity-first',
    firstProof: primaryJob === 'trust' || objections.indexOf('trust') !== -1,
    needsPricing: primaryJob === 'buy' || objections.indexOf('price') !== -1,
    needsFaq: objections.length > 0 || primaryJob === 'compare',
    needsBooking: primaryJob === 'book',
    needsLocalSignal: inferAudience(brief, text).indexOf('local') !== -1
  };
  const visual = {
    tension: pick(['quiet confidence','measured contrast','warm precision','editorial restraint','kinetic clarity'], (o.seed || 0) + type.length),
    imageRole: primaryJob === 'trust' ? 'evidence and people' : primaryJob === 'buy' ? 'product desire' : 'context and atmosphere',
    avoid: unique(['generic hero stock', 'repeated card grids', 'unverified claims', 'decorative text inside images'], 6),
    preferred: unique([type + '-specific detail', 'one human-scale moment', 'a clear focal point', 'visible whitespace'], 6)
  };
  return {
    version: 1,
    source: 'local-director',
    audience: inferAudience(brief, text),
    primaryJob,
    jobs: unique(jobs, 6),
    objections: unique(objections, 5),
    path,
    content,
    conversion: {
      primaryAction: primaryJob === 'book' ? 'book' : primaryJob === 'buy' ? 'buy' : primaryJob === 'contact' ? 'enquire' : 'learn',
      proofRole: content.firstProof ? 'lead with proof' : 'place proof after explanation',
      objections: objections.slice(0, 4),
      requiredSections: Array.from(new Set(['hero', signature.target, primaryJob === 'book' ? 'contact' : 'cta', content.needsFaq ? 'faq' : 'about']))
    },
    signatureMoment: { id: signature.id, label: signature.label, target: signature.target, layout: signature.layout },
    visual,
    factsUsed: facts.filter((x) => x && x.confidence === 'client').map((x) => clip(x.key, 60)).slice(0, 12),
    brief: { type, niche, offer: clip(brief.offer, 180), cta: clip(brief.cta, 160), proofs },
    confidence: Math.min(1, Number((.45 + (jobs.length * .08) + (proofs.length * .06) + (facts.length * .03)).toFixed(2)))
  };
}

function planText(plan) {
  const p = plan || {};
  return [p.primaryJob, ...(p.audience || []), ...(p.jobs || []), ...(p.objections || []), ...(p.path || []), p.visual && p.visual.tension, p.visual && p.visual.imageRole].filter(Boolean).join(' ');
}

function retrieve(query, documents, options) {
  const q = directorCounts(query), opts = options || {}, rows = [];
  (Array.isArray(documents) ? documents : []).slice(0, 120).forEach((doc, index) => {
    const text = typeof doc === 'string' ? doc : [doc && doc.title, doc && doc.subtitle, doc && doc.text, doc && doc.type, doc && doc.content].filter(Boolean).join(' ');
    const counts = directorCounts(text);
    let score = 0, matches = [];
    Object.keys(q).forEach((term) => { if (counts[term]) { score += (1 + Math.log1p(counts[term])) * (1 + Math.log1p(q[term])); matches.push(term); } });
    score += directorOverlap(query, text) * 2;
    if (opts.type && doc && doc.type === opts.type) score += 1.5;
    if (score > 0) rows.push({ doc, index, score: Number(score.toFixed(4)), matches: matches.slice(0, 8) });
  });
  return rows.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, Math.max(1, Math.min(8, Number(opts.limit) || 4)));
}

function sectionDocuments(site) {
  const s = site || {}, out = [];
  const add = (sections, page) => (Array.isArray(sections) ? sections : []).forEach((sec, index) => {
    if (!sec || typeof sec !== 'object') return;
    out.push({ id: String(sec.id || 'sec-' + index), pageId: String(page && page.id || ''), pageSlug: String(page && page.slug || 'index'), type: String(sec.type || ''), title: clip(sec.title, 120), subtitle: clip(sec.subtitle, 180), text: clip([sec.text, ...(sec.items || []).map((x) => x && (x.title + ' ' + x.text))].filter(Boolean).join(' '), 700) });
  });
  if (Array.isArray(s.pages) && s.pages.length) s.pages.forEach((p) => add(p && p.sections, p));
  else add(s.sections, { slug: 'index' });
  return out.slice(0, DIRECTOR_LIMITS.sections);
}
function route(site, message) {
  const docs = sectionDocuments(site);
  const hits = retrieve(message, docs, { limit: 3 });
  const top = hits[0];
  const second = hits[1];
  const confidence = top ? Math.min(1, Number((top.score / (top.score + (second ? second.score * .55 : 1))).toFixed(2))) : 0;
  return { confidence, ambiguous: !!(top && second && Math.abs(top.score - second.score) < .35), hits: hits.map((x) => ({ id: x.doc.id, type: x.doc.type, pageId: x.doc.pageId, pageSlug: x.doc.pageSlug, score: x.score, matches: x.matches })) };
}

function validate(plan) {
  const p = plan || {}, errors = [];
  if (p.version !== 1) errors.push('unsupported plan version');
  if (!p.primaryJob || !['learn','compare','trust','book','buy','contact'].includes(p.primaryJob)) errors.push('invalid primary job');
  ['audience','jobs','objections','path'].forEach((key) => { if (!Array.isArray(p[key]) || p[key].length > 12) errors.push(key + ' must be a bounded list'); });
  if (!p.content || typeof p.content !== 'object') errors.push('missing content strategy');
  if (!p.conversion || !Array.isArray(p.conversion.requiredSections)) errors.push('missing conversion map');
  if (!p.signatureMoment || !p.signatureMoment.id || !p.signatureMoment.target) errors.push('missing signature moment');
  if (!p.visual || !Array.isArray(p.visual.avoid) || !Array.isArray(p.visual.preferred)) errors.push('missing visual constitution');
  if (p.factsUsed && (!Array.isArray(p.factsUsed) || p.factsUsed.length > 12)) errors.push('fact list is too large');
  return { ok: errors.length === 0, errors };
}

function evaluate(project, message) {
  const site = (project && project.site) || project || {};
  const plan = site.directorPlan || null;
  const routeResult = route(site, message || '');
  const checks = {
    hasPlan: !!plan,
    planValid: !!(plan && validate(plan).ok),
    hasFacts: !!(site.factLedger && site.factLedger.policy),
    hasComposition: !!(site.composition && site.composition.contracts),
    hasArtDirection: !!(site.imageDirection && site.imageDirection.prompt)
  };
  return { checks, route: routeResult, score: Object.keys(checks).filter((key) => checks[key]).length * 20 };
}

const AiDirector = { compile, planText, retrieve, sectionDocuments, route, validate, evaluate, directorTokens, directorOverlap };
if (typeof module !== 'undefined' && module.exports) module.exports = AiDirector;
if (typeof window !== 'undefined') window.AiDirector = AiDirector;

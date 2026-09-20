'use strict';

/*
  Studio Intelligence
  -------------------
  Three premium-feeling Copilot skills with one safety boundary:

    director  -> explains the visual strategy without changing the project
    critique  -> audits a clone and reports what the rendered/model checks see
    repair     -> prepares a reversible before/after plan; it never mutates the
                 open project until the user explicitly approves it

  The module deliberately delegates facts to the existing local AI, quality gate
  and Director. It adds orchestration, bounded receipts and an approval seam —
  not a second generator or a network model.
*/
(function (root) {
  'use strict';

  var LIMIT = Object.freeze({ brief: 600, findings: 8, changes: 12, sections: 32 });
  var SKILLS = Object.freeze([
    { id: 'director', command: '/director', label: 'AI Art Director', cost: 1, mode: 'preview', help: 'Choose a visual strategy and explain why it fits.' },
    { id: 'critique', command: '/critique', label: 'Screenshot Critic', cost: 0, mode: 'audit', help: 'Audit the current site and prioritise the biggest problems.' },
    { id: 'repair', command: '/repair', label: 'Repair Planner', cost: 0, mode: 'approval', help: 'Prepare safe fixes with a before/after quality receipt.' }
  ]);

  function clip(value, max) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || LIMIT.brief);
  }
  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
  }
  function siteOf(project) { return project && project.site ? project.site : (project || {}); }
  function bounded(list, max) { return (Array.isArray(list) ? list : []).slice(0, max); }
  function ai() {
    try { return root.AI || (typeof AI !== 'undefined' ? AI : null); } catch (e) { return null; }
  }
  function director() {
    try { return root.AiDirector || (typeof AiDirector !== 'undefined' ? AiDirector : null); } catch (e) { return null; }
  }

  function skill(id) { return SKILLS.find(function (x) { return x.id === id; }) || null; }
  function matchCommand(text) {
    var raw = clip(text, 80).toLowerCase();
    var found = SKILLS.find(function (x) { return raw === x.command || raw.indexOf(x.command + ' ') === 0; });
    return found ? { skill: found.id, args: raw.slice(found.command.length).trim() } : null;
  }

  function artDirection(project, brief) {
    var D = director();
    var site = siteOf(project);
    var prompt = clip(brief || [site.name, site.tagline, site.description, site.type, site.niche].filter(Boolean).join(' '));
    var plan = D && typeof D.compile === 'function' ? D.compile({
      prompt: prompt,
      typeId: site.type || 'generic',
      nicheId: site.niche || '',
      seed: String(site.name || prompt).length,
      brief: { offer: site.description || site.tagline || '', cta: site.ctaText || '', audience: site.audience || '', proofs: site.proofs || [] },
      factLedger: site.factLedger,
      creativeBrief: site.creativeBrief
    }) : null;
    if (!plan) return { ok: false, error: 'The local art director is unavailable.' };
    return {
      ok: true,
      skill: 'director',
      version: 1,
      title: 'Art direction for ' + clip(site.name || 'this site', 80),
      strategy: plan,
      receipt: {
        job: plan.primaryJob,
        audience: bounded(plan.audience, 3),
        tension: clip(plan.visual && plan.visual.tension, 80),
        signature: plan.signatureMoment && plan.signatureMoment.label,
        path: bounded(plan.path, 5),
        avoid: bounded(plan.visual && plan.visual.avoid, 4),
        preferred: bounded(plan.visual && plan.visual.preferred, 4)
      }
    };
  }

  function critique(project) {
    var A = ai();
    var copy = clone(project);
    var site = siteOf(copy);
    if (!A || !copy || !site) return { ok: false, error: 'The local critique engine is unavailable.' };
    var review = null;
    try {
      review = typeof A.critiquePass === 'function' ? A.critiquePass(copy) : null;
      if (!review && typeof A.qualityGate === 'function') {
        var gate = A.qualityGate(copy);
        review = { before: gate, after: gate, fixes: [], advice: gate.issues || [], repair: { changed: 0, changes: [] } };
      }
    } catch (e) { return { ok: false, error: 'The critique could not finish safely.' }; }
    if (!review) return { ok: false, error: 'No critique engine is available.' };
    var before = review.before || review.after || {};
    return {
      ok: true,
      skill: 'critique',
      version: 1,
      title: 'Critique for ' + clip(site.name || 'this site', 80),
      score: Number((review.after || before).score) || 0,
      letter: (review.after || before).letter || '',
      findings: bounded((review.fixes || []).concat(review.advice || []).map(function (x) {
        return { id: clip(x.id, 80), level: clip(x.level || 'warn', 12), msg: clip(x.msg || x.fix, 220), safe: x.safe !== false };
      }), LIMIT.findings),
      changedOnClone: review.repair && Number(review.repair.changed) || 0,
      receipt: 'Audited a copy only — the open project was not changed.'
    };
  }

  function repairPlan(project) {
    var A = ai();
    var beforeCopy = clone(project);
    var candidate = clone(project);
    if (!A || !beforeCopy || !candidate) return { ok: false, error: 'This project is too large to prepare safely.' };
    var before = null;
    var after = null;
    try {
      before = typeof A.qualityGate === 'function' ? A.qualityGate(beforeCopy) : null;
      if (typeof A.critiquePass === 'function') A.critiquePass(candidate);
      after = typeof A.qualityGate === 'function' ? A.qualityGate(candidate) : null;
    } catch (e) { return { ok: false, error: 'The repair plan could not be prepared safely.' }; }
    if (!before || !after) return { ok: false, error: 'The quality gate is unavailable.' };
    if (Number(after.score) < Number(before.score)) return { ok: false, error: 'The proposed repairs lowered the quality score, so they were discarded.' };
    var changes = [];
    var repair = candidate.site && candidate.site.selfCritique;
    if (repair && Array.isArray(repair.fixes)) changes = repair.fixes.slice(0, LIMIT.changes).map(function (id) { return { id: clip(id, 80) }; });
    return {
      ok: true,
      skill: 'repair',
      version: 1,
      before: { score: Number(before.score) || 0, letter: before.letter || '', findings: bounded(before.issues, LIMIT.findings).length },
      after: { score: Number(after.score) || 0, letter: after.letter || '', findings: bounded(after.issues, LIMIT.findings).length },
      changes: changes,
      candidate: candidate,
      receipt: changes.length ? 'Ready to apply ' + changes.length + ' safe repair' + (changes.length === 1 ? '' : 's') + '. Nothing has changed yet.' : 'No safe repairs are needed. Nothing has changed.'
    };
  }

  function run(id, project, args) {
    if (id === 'director') return artDirection(project, args);
    if (id === 'critique') return critique(project);
    if (id === 'repair') return repairPlan(project);
    return { ok: false, error: 'Unknown Studio Intelligence skill.' };
  }

  root.StudioIntelligence = { LIMIT: LIMIT, SKILLS: SKILLS, skill: skill, matchCommand: matchCommand, artDirection: artDirection, critique: critique, repairPlan: repairPlan, run: run };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.StudioIntelligence;
}(typeof window !== 'undefined' ? window : globalThis));

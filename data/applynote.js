// ============================================================
// PallettAI Studio — turning a client note into an applied edit
//
// The review loop as it stood *reports*: a client comments, the agency reads it
// and edits by hand. This module closes the loop — a note becomes a specific,
// reviewable edit against the section it was written on.
//
// Design decisions worth stating, because they are the difference between a
// feature that helps and one that quietly damages a client's site:
//
//   * RESOLVE NARROWLY, FALL BACK WIDELY. Only a small vocabulary of
//     unambiguous, surgical instructions is applied by rule — trim a list,
//     rename a heading, remove or move a section, correct a contact detail.
//     Everything else is handed to the Copilot's existing planner rather than
//     guessed at. A resolver that half-understands “make it feel more premium”
//     and silently rewrites the copy is worse than one that says it cannot.
//
//   * EVERY OP IS REVERSIBLE AND SCOPED. Ops touch one section or one site
//     field. Nothing here restructures a site, and app.js wraps application in
//     the existing undo stack, so a note can be applied and taken back.
//
//   * NEGATION AND QUESTIONS ARE RESPECTED. “Don't change the title” and “could
//     the heading be shorter?” must not be read as edit commands. Both are
//     routed to the Copilot, which can answer rather than act.
//
// Pure logic — no DOM, no storage, no AI call. `plan()` decides, `apply()`
// mutates, and the smoke test drives both directly.
// ============================================================

'use strict';

const ApplyNote = (() => {
  const NUMBERS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
  };

  const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // Things a client counts. Deliberately a whitelist rather than “any plural
  // noun”, because the cost of a false positive here is deleting real content.
  const LIST_NOUN = /\b(item|items|card|cards|column|columns|feature|features|option|options|tile|tiles|slide|slides|step|steps|entry|entries|point|points|service|services|plan|plans|tier|tiers|package|packages|product|products|box|boxes|panel|panels|block|blocks|section|sections|row|rows|logo|logos|member|members|testimonial|testimonials|review|reviews|question|questions|faq|faqs|image|images|photo|photos|stat|stats|benefit|benefits|reason|reasons|stage|stages|phase|phases|category|categories|post|posts|article|articles|event|events|course|courses|class|classes|room|rooms|badge|badges)\b/i;
  const LIST_PRONOUN = /\b(these|them|those)\b/i;

  // A verb immediately preceded by a negator is not an instruction.
  function negated(text, at) {
    const before = text.slice(Math.max(0, at - 26), at).toLowerCase();
    return /(?:^|\W)(?:don'?t|do not|doesn'?t|didn'?t|never|no need to|stop|without)\s*$/.test(before);
  }

  // “the title is too long?” is a question about a heading, not an order to
  // rewrite it. Interrogatives and hedges go to the Copilot.
  function isQuestionOrHedge(text) {
    const t = text.trim().toLowerCase();
    if (/\?$/.test(t)) return true;
    return /^(?:could|can|would|should|is|are|do|does|did|any chance|maybe|perhaps|i wonder|what about|how about|might)\b/.test(t);
  }

  function toNumber(raw) {
    const s = String(raw || '').toLowerCase().trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return NUMBERS[s] || 0;
  }

  // ---- rule patterns -----------------------------------------------------
  // Each returns an op or null. Order matters: a trim is checked before a
  // removal so “drop this down to 2” is not read as “remove this section”.

  function ruleTrim(note, ctx) {
    const sec = ctx.section;
    if (!sec || !Array.isArray(sec.items) || !sec.items.length) {
      // “too many cards” on a section with no list has nothing to trim.
      if (/\b(too many|fewer|cut (?:it )?down|trim)\b/i.test(note)) return null;
      return null;
    }
    // The filler between verb and number is bounded and may not cross a clause
    // boundary or contain a digit, so "cut the items down to 3" resolves but
    // "cut the budget. We need 4" does not get read as an instruction to the
    // second sentence.
    // “only” and “just” are deliberately absent from this verb list. They read as
    // statements of fact far more often than as instructions — “we only have 2
    // members of staff” is not a request to delete rows — and a false positive
    // here deletes a client's content, while a false negative costs one click in
    // the Copilot. clear instructions (“keep 3”, “limit to 3”, “down to 3”) are
    // covered without them.
    const m = /(?:too many|fewer|reduce|cut|trim|shorten|slim|tighten|prune|whittle|drop|limit|no more than|down to|keep|max(?:imum)?(?: of)?)\b[^.!?;\d]{0,24}?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.exec(note);
    if (!m) return null;
    if (negated(note, m.index)) return null;
    const n = toNumber(m[1]);
    if (!n || n < 1) return null;
    // Only trim a list the note is plausibly about. The verb+number already rules
    // out most misfires, but not “we only have 2 staff” — so the note must also
    // name something list-shaped, or be one of the clear judgements of excess.
    //
    // A pronoun counts as naming it: notes arrive anchored to the section the
    // client clicked on, so “cut these down to 2” has an unambiguous antecedent.
    // “Plans”, “tiers”, “packages” and friends are here because they are exactly
    // how a client describes a pricing section, and leaving them out made a
    // perfectly ordinary note fall through to the Copilot.
    if (!LIST_NOUN.test(note) && !LIST_PRONOUN.test(note)) {
      if (!/\b(too many|crowded|cluttered|busy|shorter|fewer)\b/i.test(note)) return null;
    }
    // The note is a real instruction, but the section already meets it. Saying so
    // is worth a branch of its own: silently falling through to “ask the Copilot”
    // reads as if the request was not understood, when in fact it was already done.
    if (n >= sec.items.length) return { op: 'trimItems', n: n, satisfied: true };
    return { op: 'trimItems', n: n };
  }

  function ruleRemoveSection(note, ctx) {
    if (!ctx.section) return null;
    const m = /\b(?:remove|delete|drop|get rid of|take out|lose|cut)\b[^.!?]{0,20}?\b(?:this|the|that)\s+(?:section|block|panel|part)\b|\b(?:remove|delete|drop|get rid of|take out)\s+(?:this|it)\b/i.exec(note);
    if (!m) return null;
    if (negated(note, m.index)) return null;
    if (ctx.sectionType === 'hero') return null;   // a site with no hero is broken
    return { op: 'removeSection' };
  }

  function ruleSetTitle(note, ctx) {
    if (!ctx.section) return null;
    const m = /\b(?:change|rename|retitle|call|make|set)\b[^.!?]{0,24}?\b(?:title|heading|headline)\b[^.!?]{0,12}?\b(?:to|say|read|:)\s*(.+)$/i.exec(note);
    if (!m) return null;
    if (negated(note, m.index)) return null;
    const value = clip(String(m[1]).replace(/^[\s:"'“”]+|[\s"'“”]+$/g, '').replace(/[.]+$/, ''), 120);
    if (!value) return null;
    return { op: 'setTitle', value: value };
  }

  function ruleSetSubtitle(note, ctx) {
    if (!ctx.section) return null;
    const m = /\b(?:change|rewrite|set|make|update)\b[^.!?]{0,24}?\b(?:subtitle|subheading|sub-title|supporting line|strapline|intro(?:duction)?)\b[^.!?]{0,12}?\b(?:to|say|read|:)\s*(.+)$/i.exec(note);
    if (!m) return null;
    if (negated(note, m.index)) return null;
    const value = clip(String(m[1]).replace(/^[\s:"'“”]+|[\s"'“”]+$/g, '').replace(/[.]+$/, ''), 200);
    if (!value) return null;
    return { op: 'setSubtitle', value: value };
  }

  function ruleMoveSection(note, ctx) {
    if (!ctx.section) return null;
    const m = /\b(?:move|put|shift|bring|reorder)\b[^.!?]{0,28}?\b(top|first|up|higher|above|bottom|last|down|lower|below)\b/i.exec(note)
      || /\b(?:move|put)\s+this\b[^.!?]{0,16}?\b(top|first|up|higher|bottom|last|down|lower)\b/i.exec(note);
    if (!m) return null;
    if (negated(note, m.index)) return null;
    const w = m[1].toLowerCase();
    const to = /^(top|first)$/.test(w) ? 'top' : /^(bottom|last)$/.test(w) ? 'bottom' : /^(up|higher|above)$/.test(w) ? 'up' : 'down';
    return { op: 'moveSection', to: to };
  }

  // Contact details and other single site fields — the most common note of all.
  function ruleSiteField(note) {
    const email = /(?:^|[^\w.@])([\w.+-]+@[\w-]+\.[\w.-]{2,})/.exec(note);
    if (email && /\b(?:email|e-mail|mail|contact|address (?:is|should))\b/i.test(note)) {
      return { op: 'setSiteField', key: 'email', value: clip(email[1], 120) };
    }
    const m = /\b(?:phone|telephone|number|call us on|ring)\b[^0-9+]{0,14}([+()\d][\d\s().-]{6,20}\d)/i.exec(note);
    if (m) return { op: 'setSiteField', key: 'phone', value: clip(m[1], 40) };
    return null;
  }

  const RULES = [
    { name: 'trim', run: ruleTrim },
    { name: 'title', run: ruleSetTitle },
    { name: 'subtitle', run: ruleSetSubtitle },
    { name: 'remove', run: ruleRemoveSection },
    { name: 'move', run: ruleMoveSection },
    { name: 'field', run: ruleSiteField }
  ];

  // ---- planning ----------------------------------------------------------
  // ctx: { section, sectionIndex, sectionType, sectionTitle, pageSlug, pageName }
  function plan(note, ctx) {
    const text = norm(note && note.text ? note.text : note);
    const c = ctx || {};
    const target = {
      slug: clip(c.pageSlug, 120),
      pageName: clip(c.pageName, 120),
      sectionIndex: typeof c.sectionIndex === 'number' ? c.sectionIndex : -1,
      sectionType: clip(c.sectionType, 40),
      heading: clip(c.sectionTitle, 120)
    };

    if (!text) return notResolvable(text, target, 'The note is empty.');

    if (isQuestionOrHedge(text)) {
      return notResolvable(text, target, 'This reads as a question rather than an instruction, so it is handed to the Copilot.');
    }

    const ops = [];
    const satisfied = [];
    const seen = new Set();
    RULES.forEach((r) => {
      const op = r.run(text, c);
      if (!op) return;
      const key = op.op === 'setSiteField' ? op.op + ':' + op.key : op.op;
      if (seen.has(key)) return;      // one op per kind, first rule wins
      seen.add(key);
      if (op.satisfied) { satisfied.push(op); return; }
      ops.push(op);
    });

    if (!ops.length) {
      if (satisfied.length) {
        const have = (c.section && Array.isArray(c.section.items)) ? c.section.items.length : 0;
        return {
          resolvable: false,
          satisfied: true,
          method: 'none',
          target: target,
          ops: [],
          instruction: '',
          intent: '',
          confidence: 'high',
          reason: 'Already as asked \u2014 that section has ' + have + ' item' + (have === 1 ? '' : 's') + ' and the note asks for ' + satisfied[0].n + '.'
        };
      }
      return notResolvable(text, target, 'No unambiguous rule matches this note, so it is handed to the Copilot.');
    }

    return {
      resolvable: true,
      satisfied: false,
      method: 'rule',
      target: target,
      ops: ops,
      instruction: '',
      intent: summarize(ops, target, c),
      confidence: 'high',
      reason: ''
    };
  }

  function notResolvable(text, target, reason) {
    return {
      resolvable: false,
      satisfied: false,
      method: 'ai',
      target: target,
      ops: [],
      instruction: instructionFor(text, target),
      intent: '',
      confidence: 'low',
      reason: reason
    };
  }

  // Scoping the Copilot's instruction to the section the client actually
  // commented on is the whole point: “make it shorter” must not be applied to
  // the wrong section, or to the whole site.
  function instructionFor(text, target) {
    const where = target && target.heading ? 'the “' + target.heading + '” section'
      : target && target.sectionType ? 'the ' + target.sectionType + ' section'
        : 'the top of the page';
    const page = target && target.pageName && target.slug !== 'index' ? ' (on the ' + target.pageName + ' page)' : '';
    return 'In ' + where + page + ': ' + text;
  }

  function summarize(ops, target, ctx) {
    const who = target.heading ? '“' + target.heading + '”'
      : target.sectionType ? 'the ' + target.sectionType + ' section'
        : 'the site';
    return ops.map((op) => {
      switch (op.op) {
        case 'trimItems': {
          const n = (ctx && ctx.section && Array.isArray(ctx.section.items)) ? ctx.section.items.length : 0;
          return n ? 'Reduce ' + who + ' from ' + n + ' items to ' + op.n : 'Reduce ' + who + ' to ' + op.n + ' items';
        }
        case 'removeSection': return 'Remove ' + who;
        case 'moveSection': return 'Move ' + who + ' to the ' + op.to;
        case 'setTitle': return 'Rename ' + who + ' to “' + op.value + '”';
        case 'setSubtitle': return 'Rewrite the supporting line in ' + who;
        case 'setSiteField': return 'Set the site ' + op.key + ' to ' + op.value;
        default: return op.op;
      }
    }).join(' · ');
  }

  // ---- applying ----------------------------------------------------------
  // Pure mutation of one page. Returns whether anything changed plus a
  // plain-English account of each operation, so the caller can show the agency
  // exactly what happened and keep it undoable.
  function apply(page, ops, ctx) {
    const c = ctx || {};
    const out = { changed: false, notes: [], skipped: [] };
    if (!page || !Array.isArray(page.sections)) return out;

    (Array.isArray(ops) ? ops : []).forEach((op) => {
      switch (op.op) {
        case 'trimItems': {
          const s = targetSection(page, c);
          if (!s || !Array.isArray(s.items)) { out.skipped.push('trim: section not found'); break; }
          const before = s.items.length;
          if (before <= op.n) { out.skipped.push('trim: already ' + before + ' items'); break; }
          s.items = s.items.slice(0, op.n);
          out.changed = true;
          out.notes.push('Removed ' + (before - op.n) + ' item' + ((before - op.n) === 1 ? '' : 's'));
          break;
        }
        case 'setTitle': {
          const s = targetSection(page, c);
          if (!s) { out.skipped.push('title: section not found'); break; }
          if (s.title === op.value) { out.skipped.push('title: unchanged'); break; }
          s.title = op.value;
          out.changed = true;
          out.notes.push('Set the heading to “' + op.value + '”');
          break;
        }
        case 'setSubtitle': {
          const s = targetSection(page, c);
          if (!s) { out.skipped.push('subtitle: section not found'); break; }
          s.subtitle = op.value;
          out.changed = true;
          out.notes.push('Rewrote the supporting line');
          break;
        }
        case 'removeSection': {
          const i = targetIndex(page, c);
          if (i === -1) { out.skipped.push('remove: section not found'); break; }
          if (page.sections.length <= 1) { out.skipped.push('remove: it is the only section'); break; }
          const gone = page.sections[i];
          page.sections.splice(i, 1);
          out.changed = true;
          out.notes.push('Removed the ' + (gone.type || 'section') + ' section');
          break;
        }
        case 'moveSection': {
          const i = targetIndex(page, c);
          if (i === -1) { out.skipped.push('move: section not found'); break; }
          const s = page.sections[i];
          page.sections.splice(i, 1);
          if (op.to === 'top') page.sections.unshift(s);
          else if (op.to === 'bottom') page.sections.push(s);
          else if (op.to === 'up') page.sections.splice(Math.max(0, i - 1), 0, s);
          else page.sections.splice(Math.min(page.sections.length, i + 1), 0, s);
          out.changed = true;
          out.notes.push('Moved the section ' + op.to);
          break;
        }
        case 'setSiteField': {
          const site = c.site;
          if (!site) { out.skipped.push('field: no site'); break; }
          if (String(site[op.key] || '') === op.value) { out.skipped.push('field: unchanged'); break; }
          site[op.key] = op.value;
          out.changed = true;
          out.notes.push('Set ' + op.key + ' to ' + op.value);
          break;
        }
        default:
          out.skipped.push('unknown op ' + op.op);
      }
    });
    return out;
  }

  function targetIndex(page, ctx) {
    if (!page || !Array.isArray(page.sections)) return -1;
    if (ctx.section && page.sections[ctx.sectionIndex] === ctx.section) return ctx.sectionIndex;
    if (typeof ctx.sectionIndex === 'number' && page.sections[ctx.sectionIndex]) return ctx.sectionIndex;
    return -1;
  }

  function targetSection(page, ctx) {
    const i = targetIndex(page, ctx);
    return i === -1 ? null : page.sections[i];
  }

  // A stable identity for a note, so the same note is not applied twice and
  // two notes on the same section stay distinguishable.
  function keyOf(note) {
    const n = note || {};
    return [n.pageSlug || '', n.sectionId || '', n.id || clip(n.text, 60) || ''].join('|');
  }

  return { plan, apply, summarize, instructionFor, keyOf, toNumber, isQuestionOrHedge, negated, LIST_NOUN, LIST_PRONOUN };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ApplyNote;

'use strict';

const FOLLOW = [
  { id: 'shorter', re: /\b(shorter|punchier|tighter|less wordy|more concise)\b/i },
  { id: 'local', re: /\b(more local|more leeds|add the town|say the area|more specific to)\b/i },
  { id: 'salesy', re: /\b(less salesy|less sales|softer|less pushy|less hype|more honest)\b/i }
];

function isFollowUp(msg) {
  const raw = String(msg || '');
  for (let i = 0; i < FOLLOW.length; i++) {
    if (FOLLOW[i].re.test(raw)) return FOLLOW[i].id;
  }
  return '';
}

function rememberEdit(prev, next) {
  const n = next || {};
  return {
    raw: String(n.raw || ''),
    targetType: n.targetType || (prev && prev.targetType) || '',
    ops: Array.isArray(n.ops) ? n.ops : []
  };
}

function likeUrl(msg) {
  const m = String(msg || '').match(/https?:\/\/[^\s)]+/i);
  return m ? m[0].replace(/[.,;]+$/, '') : '';
}

/* ============================================================
   Repeating an edit somewhere else — "same for the FAQ"

   A client who has just watched one change land should not have to type the
   whole instruction again to get it somewhere else. Carrying the instruction
   forward is most of the difference between a command line and a
   collaborator.

   Two decisions here do the work, and both are about what NOT to repeat.
   ============================================================ */

/*
  Only ops whose effect is confined to one section, and which change its
  content, may be replayed. That is not tidiness — it is the whole safety
  argument:

    · replaying "add a pricing section" puts a SECOND one on the page
    · replaying "delete the FAQ" deletes something nobody named

  Those are the two ways a helpful-sounding feature quietly damages a site, so
  the whitelist is drawn narrowly around edits-to-a-target and nothing else.
*/
const REPEATABLE = { rewriteSection: 1, rewrite: 1 };

/*
  Ops that act on the site as a whole. Repeating these "on the footer" is not
  dangerous so much as meaningless, and saying that plainly beats doing it
  twice or claiming not to understand.
*/
const SITE_WIDE = {
  pack: 1, palette: 1, font: 1, design: 1, hero: 1, layout: 1, themeToggle: 1,
  navStyle: 1, navSticky: 1, navCta: 1, restyle: 1, brandKit: 1, fixAll: 1,
  repair: 1, review: 1, options: 1, likeUrl: 1, preview: 1, export: 1,
  nicheExtras: 1, servicesPage: 1, suite: 1, unsuite: 1, shuffleLook: 1
};

/*
  Anchored at the start, deliberately. "Add the same styling to the footer"
  and "make it the same as the hero" both contain the word "same" and neither
  is a request to repeat the last edit — one is an instruction to add
  something, the other points at a reference site. Requiring the message to
  OPEN with the repeat phrase is what separates them.
*/
const REPEAT_HEAD = /^(?:\s*(?:and|also|now|then|please|ok|okay|can you|could you|would you)\s+)*(same|do that|do it again|do the same|repeat that|repeat it|apply that|apply it|that again|same again|again)\b/i;

/*
  ...and it must not be the opening of a longer instruction that merely starts
  that way. "Same colour as the hero" is a colour request. A tail that names
  something to make, use or change means the sentence was about that, not
  about repeating.
*/
const REPEAT_TAIL_INSTRUCTION = /\b(?:make|change|use|set|add|remove|delete|switch|turn|colour|color|palette|font|bigger|smaller|lighter|darker)\b/i;

function isRepeat(msg) {
  const raw = String(msg || '');
  const m = raw.match(REPEAT_HEAD);
  if (!m) return '';
  const tail = raw.slice(m[0].length);
  if (REPEAT_TAIL_INSTRUCTION.test(tail)) return '';
  return m[1].toLowerCase();
}

/*
  What is left once the repeat phrase and its joining words are taken off —
  "same FOR THE about section" leaves "about section", and "same again" leaves
  nothing.

  This is the difference between two situations that look identical to a
  resolver that just failed:

    · "same again"          — named nothing, so repeating on the previous
                              section is the natural reading
    · "same for the sidebar" — named something real that we cannot place, so
                              repeating on the previous section would silently
                              do it in the WRONG PLACE

  Collapsing those two is how a helpful feature starts quietly editing the
  wrong part of someone's site.
*/
const REPEAT_FILLER = /^(?:\s*(?:for|to|on|onto|with|the|a|an|section|sections|block|blocks|area|part|panel|band|one|please|too|as|well|again|also|it|that)\b)+/i;

function repeatTail(msg) {
  const raw = String(msg || '');
  const m = raw.match(REPEAT_HEAD);
  if (!m) return '';
  return raw.slice(m[0].length)
    .replace(REPEAT_FILLER, '')
    .replace(/[.!?,]+\s*$/, '')
    .trim();
}

/*
  Which op "same" refers to, and whether it may be replayed at all.

  Returns the LAST repeatable op in the list, because that is the change the
  client most recently watched happen. A reason is returned rather than a bare
  false so the copilot can explain itself instead of falling back on "I didn't
  catch that" — which, when the real answer is "that one applied to the whole
  site", is a lie.
*/
function repeatableOp(ops) {
  const list = Array.isArray(ops) ? ops.filter((a) => a && a.op) : [];
  if (!list.length) return { ok: false, reason: 'none' };

  const candidate = list.filter((a) => REPEATABLE[a.op]).pop();
  if (!candidate) {
    const wide = list.filter((a) => SITE_WIDE[a.op]).pop();
    if (wide) return { ok: false, reason: 'site-wide', op: wide.op };
    return { ok: false, reason: 'not-repeatable', op: list[list.length - 1].op };
  }
  return {
    ok: true,
    op: candidate.op,
    type: String(candidate.type || ''),
    mode: String(candidate.mode || ''),
    prompt: String(candidate.prompt || '')
  };
}

const AiFollowup = { isFollowUp, rememberEdit, likeUrl, isRepeat, repeatTail, repeatableOp, REPEATABLE, SITE_WIDE };
if (typeof module !== 'undefined' && module.exports) module.exports = AiFollowup;

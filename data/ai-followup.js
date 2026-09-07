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

const AiFollowup = { isFollowUp, rememberEdit, likeUrl };
if (typeof module !== 'undefined' && module.exports) module.exports = AiFollowup;

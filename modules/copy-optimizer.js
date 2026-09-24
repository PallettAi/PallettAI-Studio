// ============================================================
// PallettAI Studio — CopyOptimizer
// Turns generic, machine-flavoured website copy into short,
// concrete, conversion-shaped marketing copy — offline.
//
// WHY THIS EXISTS. Every model, asked for marketing copy, reaches for
// the same eleven words: "unleash", "seamlessly", "cutting-edge". A
// visitor has read that sentence a thousand times, so it lands as
// noise: the page reads as generated, and generated pages do not
// convert. The fix is not a better adjective, it is a shape (a CRO
// framework) said in a locked voice with none of the tells.
//
// THREE LAYERS
//   1. deJargon()        — strips banned vocabulary and its cousins,
//                          recording every substitution it made.
//   2. framework assembly — lays the client's own claim into a CRO
//                          structure (PAS / AIDA / BAB) using a niche
//                          lexicon for the beats the copy is missing.
//   3. applyVoiceLock()  — the four Voice Lock tones (warm, premium,
//                          punchy, editorial) as measurable rules:
//                          contraction policy, sentence word ceiling,
//                          hype removal, exclamation policy.
//
// TWO ENGINES, ONE CONTRACT
//   optimizeCopy()      — pure, synchronous, deterministic, offline.
//                         This is the default and the fallback.
//   optimizeCopyAsync() — asks a model if one is configured (setCompleter
//                         / options.complete), then runs the SAME scrubber
//                         over its answer. A model that is missing,
//                         offline, slow or badly behaved degrades to the
//                         local engine rather than failing the caller.
//
// scrubAIVocabulary() is exported on its own because it is the guard the
// whole product depends on: whatever wrote the copy, this is the check
// that it does not ship with the tells in it.
//
// Zero dependencies. CommonJS + browser global.
// ============================================================

(function () {
  'use strict';

  const CopyOptimizer = {};

  /* ============================================================
     1 — the vocabulary rules
     ============================================================ */

  // Permanently eliminated. Matched case-insensitively, apostrophe- and
  // hyphen-tolerant, and as whole terms so "realm" never eats "realms of
  // possibility" mid-word and "beacon" never fires inside a URL.
  const BANNED_AI_VOCABULARY = Object.freeze([
    'unleash',
    'elevate',
    'delve',
    'tapestry',
    'game-changer',
    'seamlessly',
    'beacon',
    'testament to',
    "in today's fast-paced world",
    'cutting-edge',
    'realm'
  ]);

  // The cousins: not on the banned list, but the same failure — words that
  // signal "a machine wrote this" without saying anything. Neutralised so
  // the banned list does not have to be a mile long to be effective.
  const AI_TELLS = Object.freeze([
    'unlock the power of', 'paradigm shift', 'game changing', 'best-in-class',
    'at the end of the day', "it's important to note that", 'in the realm of',
    'in today\'s digital landscape', 'navigate the complexities', 'move the needle',
    'low-hanging fruit', 'thought leadership', 'future-proof', 'customer-centric',
    'take it to the next level', 'unlock', 'leverage', 'leveraging', 'robust',
    'synergy', 'synergies', 'paradigm', 'utilize', 'utilise', 'holistic',
    'streamline', 'empower', 'revolutionize', 'revolutionise', 'revolutionary',
    'state-of-the-art', 'world-class', 'next-level', 'effortless', 'effortlessly',
    'seamless', 'dive into', 'harness', 'foster', 'myriad of', 'plethora of',
    'navigating', 'unparalleled', 'pivotal', 'garner', 'unwavering', 'multifaceted',
    'ideate', 'actionable', 'impactful', 'synergize', 'value-add', 'deep dive',
    'touch base', 'circle back', 'bandwidth', 'unprecedented', 'transformative',
    'meticulous'
  ]);

  // Ordered rules: longest/most-specific phrase first, so "unleash the
  // power of" is handled before bare "unleash", and "seamlessly" before
  // "seamless" (which would otherwise leave "-ly" behind).
  const REPLACEMENTS = [
    ['unleash the power of', 'get real results from'],
    ['unlock the power of', 'get the most from'],
    ['in today\'s fast-paced world', 'right now'],
    ['in today\'s digital landscape', 'right now'],
    ['in the realm of', 'in'],
    ['paradigm shift', 'change'],
    ['game changing', 'important'],
    ['best-in-class', 'leading'],
    ['state-of-the-art', 'best available'],
    ['world-class', 'excellent'],
    ['next-level', 'better'],
    ['take it to the next level', 'go further'],
    ['at the end of the day', ''],
    ['it\'s important to note that', ''],
    ['navigate the complexities', 'handle'],
    ['move the needle', 'make a difference'],
    ['low-hanging fruit', 'quick wins'],
    ['thought leadership', 'expertise'],
    ['future-proof', 'ready for what comes next'],
    ['customer-centric', 'focused on customers'],
    ['deep dive', 'close look'],
    ['touch base', 'check in'],
    ['circle back', 'follow up'],
    ['myriad of', 'many'],
    ['plethora of', 'plenty of'],
    ['dive into', 'start'],
    // Plurals get their own rule BEFORE the singular: "cutting-edge realms"
    // must become "modern areas", not "modern area".
    ['game-changers', 'turning points'],
    ['tapestries', 'ranges'],
    ['beacons', 'signals'],
    ['realms', 'areas'],
    ['testament to', 'proof of'],
    ['game-changer', 'turning point'],
    ['cutting-edge', 'modern'],
    ['unleash', 'put to work'],
    ['elevate', 'improve'],
    ['delve', 'dig'],
    ['tapestry', 'range'],
    ['seamlessly', 'without friction'],
    ['seamless', 'straightforward'],
    ['beacon', 'signal'],
    ['realm', 'area'],
    ['leverage', 'use'],
    ['leveraging', 'using'],
    ['utilize', 'use'],
    ['utilise', 'use'],
    ['synergy', 'teamwork'],
    ['synergies', 'teamwork'],
    ['synergize', 'work together'],
    ['streamline', 'simplify'],
    ['empower', 'help'],
    ['revolutionize', 'change'],
    ['revolutionise', 'change'],
    ['revolutionary', 'new'],
    ['robust', 'reliable'],
    ['paradigm', 'model'],
    ['holistic', 'complete'],
    ['effortlessly', 'easily'],
    ['effortless', 'easy'],
    ['unparalleled', 'unmatched'],
    ['unprecedented', 'new'],
    ['transformative', 'significant'],
    ['meticulous', 'careful'],
    ['multifaceted', 'varied'],
    ['ideate', 'plan'],
    ['actionable', 'practical'],
    ['impactful', 'effective'],
    ['value-add', 'useful extra'],
    ['unwavering', 'steady'],
    ['pivotal', 'key'],
    ['garner', 'gather'],
    ['navigating', 'handling'],
    ['foster', 'build'],
    ['harness', 'use'],
    ['bandwidth', 'time'],
    ['unlock', 'open up']
  ];

  // Hype adjectives. A voice lock that asks for restraint removes these
  // rather than replacing them — "the ultimate guide" becomes "the guide".
  const HYPE_WORDS = Object.freeze([
    'amazing', 'incredible', 'awesome', 'unbelievable', 'stunning', 'jaw-dropping',
    'mind-blowing', 'must-have', 'ultimate', 'superb', 'fantastic', 'outstanding',
    'extraordinary', 'groundbreaking', 'one-of-a-kind', 'phenomenal', 'epic',
    'insanely', 'super', 'best-ever'
  ]);

  const HEDGES = Object.freeze([
    'very', 'really', 'quite', 'just', 'actually', 'basically', 'literally',
    'simply', 'truly', 'extremely', 'incredibly', 'somewhat', 'rather'
  ]);

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // English inflection, so "realms", "elevated" and "unleashing" are caught
  // rather than only their base form. Matching only the singular is how a
  // banned word survives a scrub and ships — the check has to see the word
  // the copywriter actually typed.
  function inflect(body) {
    if (/[^aeiou]y$/i.test(body)) return body.slice(0, -1) + '(?:y|ies)';
    if (/e$/i.test(body)) return body.slice(0, -1) + '(?:e|es|ed|ing|s)?';
    return body + '(?:s|es|ed|ing)?';
  }

  // One term -> one regex. Apostrophes tolerate the typographic form,
  // hyphens tolerate a space, and multi-word terms allow any whitespace.
  function termRegex(term, options) {
    const opts = options || {};
    const single = /^[a-z]+$/i.test(term);
    let body = escapeRe(term)
      .replace(/['\u2019]/g, "['\u2019]")
      .replace(/-/g, '[-\\s]?')
      .replace(/\s+/g, '\\s+');
    if (single && opts.inflect !== false) body = inflect(body);
    return single
      ? new RegExp('\\b' + body + '\\b', 'gi')
      : new RegExp('(?<![a-z0-9])' + body + '(?![a-z0-9])', 'gi');
  }

  const BANNED_SET = new Set(BANNED_AI_VOCABULARY.map((t) => t.toLowerCase()));
  const BANNED_REGEXES = BANNED_AI_VOCABULARY.map((term) => ({ term, re: termRegex(term) }));
  const REPLACEMENT_RULES = REPLACEMENTS.map(([term, to]) => ({ term, to, re: termRegex(term) }));

  // `RegExp.prototype.test` on a /g regex is STATEFUL: lastIndex advances on a
  // match and the next call resumes from there, so testing the same pattern
  // twice can miss. That is a silent false negative in the one function whose
  // entire job is refusing to let a banned word through — calling
  // findBannedTerms('unleash') twice returned ['unleash'] then []. Every test
  // against a shared rule goes through here, which always starts clean and
  // always leaves the rule clean for the next caller.
  function regexFires(re, text) {
    re.lastIndex = 0;
    const hit = re.test(text);
    re.lastIndex = 0;
    return hit;
  }

  /* ============================================================
     2 — the Voice Lock
     ------------------------------------------------------------
     Warm / Premium / Punchy / Editorial, expressed as measurable
     rules so a rewrite can be checked instead of argued about.
     ============================================================ */

  const VOICE_LOCKS = {
    warm: {
      label: 'Warm',
      sentenceCeiling: 18,
      contractions: true,
      exclamation: false,
      stripHype: false,
      stripHedges: false,
      directive: 'Speak like a helpful neighbour who knows the trade. Say "you" and "we". Use contractions. Plain words, no jargon, no formality. Sound glad to help without selling hard.'
    },
    premium: {
      label: 'Premium',
      sentenceCeiling: 22,
      contractions: false,
      exclamation: false,
      stripHype: true,
      stripHedges: false,
      directive: 'Calm, precise, unhurried. Full words rather than contractions. No exclamation marks, no superlatives, no urgency tricks. Confidence comes from specifics and restraint, not adjectives. One claim per sentence, then stop.'
    },
    punchy: {
      label: 'Punchy',
      sentenceCeiling: 11,
      contractions: true,
      exclamation: false,
      stripHype: false,
      stripHedges: true,
      directive: 'Short. Blunt. Every sentence under twelve words. Front-load the verb. Cut every hedge and every warm-up clause. If a word does not earn its place, delete it.'
    },
    editorial: {
      label: 'Editorial',
      sentenceCeiling: 20,
      contractions: true,
      exclamation: false,
      stripHype: true,
      stripHedges: true,
      directive: 'Write the way a good trade magazine does: observe first, then claim. Concrete nouns, active verbs, measured rhythm, no hype. Let one surprising specific detail carry the sentence.'
    }
  };
  const DEFAULT_VOICE = 'warm';

  /* ============================================================
     3 — the CRO frameworks
     ============================================================ */

  const FRAMEWORKS = {
    PAS: {
      label: 'Problem - Agitate - Solution',
      directive: 'Name a problem the reader already feels, make the cost of leaving it real, then present the fix. Do not introduce the business before the problem.',
      steps: [
        { role: 'problem', instruction: 'One short, specific sentence naming the problem. No warm-up, no "in a world where".' },
        { role: 'agitate', instruction: 'One sentence on what the problem costs — time, money, repeat visits, lost sleep. Concrete, not dramatic.' },
        { role: 'solution', instruction: 'One or two sentences: what changes, and the next step. Keep the client\'s own claim intact.' }
      ]
    },
    AIDA: {
      label: 'Attention - Interest - Desire - Action',
      directive: 'Earn the first line, give the reader a reason to keep reading, prove it, then ask for one clear action.',
      steps: [
        { role: 'attention', instruction: 'A first line a person would repeat out loud. Specific, not clever.' },
        { role: 'interest', instruction: 'One sentence on what the reader gets, in their words, not the trade\'s.' },
        { role: 'desire', instruction: 'One proof sentence. A number, a timeframe, a count — whatever the raw copy supports.' },
        { role: 'action', instruction: 'A single imperative call to action, four words or fewer if possible.' }
      ]
    },
    BAB: {
      label: 'Before - After - Bridge',
      directive: 'Show the reader where they are, where they could be, then hand them the way across. The gap between the two is the pitch.',
      steps: [
        { role: 'before', instruction: 'The situation as it is today. Plain and recognisable.' },
        { role: 'after', instruction: 'The same situation after the work is done. A different picture, not a bigger adjective.' },
        { role: 'bridge', instruction: 'One short sentence that connects the two and ends on the next step.' }
      ]
    }
  };
  const DEFAULT_FRAMEWORK = 'PAS';

  const FRAMEWORK_ALIASES = {
    PAS: 'PAS',
    'PROBLEM-AGITATE-SOLUTION': 'PAS',
    'PROBLEM-AGITATE': 'PAS',
    AIDA: 'AIDA',
    BAB: 'BAB',
    'BEFORE-AFTER-BRIDGE': 'BAB'
  };

  /* ============================================================
     4 — the niche lexicon
     ------------------------------------------------------------
     The beats a framework needs that the raw copy may not supply.
     Every line is already short, concrete and free of the banned
     vocabulary, so the local engine cannot emit a tell.
     ============================================================ */

  const NICHE_LEXICON = {
    roofing: {
      audience: 'homeowners and landlords',
      hook: 'Your roof is the one thing you never look at until it fails.',
      pain: 'A roof never fails on a convenient week.',
      agitate: 'One missed leak rots the deck, soaks the insulation, and doubles the bill by spring.',
      gain: 'A roof that holds through ten winters, fitted in two days.',
      proof: '2,400 roofs surveyed since 2009. 98% have never leaked.',
      cta: 'Book a free roof survey'
    },
    dental: {
      audience: 'families and nervous patients',
      hook: 'Most people wait for pain before they book.',
      pain: 'Toothache always arrives on a Friday night.',
      agitate: 'By Monday a small filling has become a root canal and a week of soft food.',
      gain: 'Six-month check-ups that catch problems while they are still small.',
      proof: '11,000 appointments a year. 4.9 stars from 1,800 reviews.',
      cta: 'Book a check-up'
    },
    legal: {
      audience: 'people facing a claim or a deadline',
      hook: 'Legal trouble is expensive. Silence makes it worse.',
      pain: 'Deadlines do not wait while you look for the right solicitor.',
      agitate: 'Miss one and a straightforward claim turns into a long, costly argument.',
      gain: 'Plain English advice, fixed fees, and a call back the same day.',
      proof: '900 cases resolved. 96% settled without a hearing.',
      cta: 'Book a free 15-minute call'
    },
    plumbing: {
      audience: 'homeowners',
      hook: 'Water finds the cheapest route out of a pipe.',
      pain: 'A dripping joint never fixes itself.',
      agitate: 'Leave it a week and it warps the floorboards and takes the ceiling with it.',
      gain: 'A same-day fix, priced before we start.',
      proof: '6,000 call-outs. Average arrival, 47 minutes.',
      cta: 'Call an engineer'
    },
    fitness: {
      audience: 'people starting again',
      hook: 'Motivation is a bad plan. A schedule is not.',
      pain: 'Most gym memberships die in February.',
      agitate: 'You pay all year, train four times, and start again next January.',
      gain: 'Three sessions a week, written down, with someone expecting you.',
      proof: '300 members. 82% still training after a year.',
      cta: 'Claim a free trial week'
    },
    salon: {
      audience: 'new and returning clients',
      hook: 'Good hair is a schedule, not a rescue.',
      pain: 'The wrong cut takes eight weeks to grow out.',
      agitate: 'You pay twice: once for the cut, and again to have it fixed.',
      gain: 'A stylist who learns your hair and keeps it that way.',
      proof: 'Nine stylists. 4.9 stars from 2,300 visits.',
      cta: 'Book a consultation'
    },
    cafe: {
      audience: 'locals and regulars',
      hook: 'The queue tells you everything.',
      pain: 'Bad coffee does not announce itself until the second sip.',
      agitate: 'You drink it, pay for it, and do it again tomorrow.',
      gain: 'Beans roasted this week, pulled by someone who tastes them.',
      proof: '120kg roasted weekly. Eight single origins on the bar.',
      cta: 'See the menu'
    },
    tech: {
      audience: 'buyers and product teams',
      hook: 'Buyers do not read your homepage. They scan it.',
      pain: 'Nine in ten visitors leave before they work out what you sell.',
      agitate: 'You paid for the traffic and gave them nothing to hold on to.',
      gain: 'One clear offer, three proof points, one next step.',
      proof: '14 launches. Average 38% lift in demo requests.',
      cta: 'Start a project'
    },
    generic: {
      audience: 'customers',
      hook: 'People decide in seconds.',
      pain: 'Most pages say nothing a visitor could repeat out loud.',
      agitate: 'So they leave, and the traffic you paid for buys nothing.',
      gain: 'Plain words, real proof, and one obvious next step.',
      proof: 'Three sentences. One offer. No filler.',
      cta: 'Get a straight answer'
    }
  };

  function lexiconFor(niche) {
    const key = String(niche || '').toLowerCase().trim();
    return NICHE_LEXICON[key] || NICHE_LEXICON.generic;
  }

  /* ============================================================
     5 — text utilities
     ============================================================ */

  function collapse(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  function splitSentences(text) {
    return collapse(text)
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function words(s) {
    return collapse(s).split(' ').filter(Boolean);
  }

  function upperFirst(s) {
    const t = String(s || '');
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  }

  function lowerFirst(s) {
    const t = String(s || '');
    return t ? t.charAt(0).toLowerCase() + t.slice(1) : t;
  }

  // Cut a sentence to a word ceiling. Prefer a real clause boundary below
  // the ceiling, so short copy reads short rather than truncated: clipping
  // "…soaks the insulation, and doubles the bill" at eleven words produced
  // "…and doubles.", which is not a sentence anyone would write.
  function clipSentence(sentence, ceiling) {
    const list = words(sentence);
    if (!list.length || list.length <= ceiling) return collapse(sentence);
    const floor = Math.max(4, Math.ceil(ceiling * 0.55));
    let at = -1;
    for (let i = Math.min(ceiling, list.length); i > floor; i--) {
      const raw = list[i - 1];
      const token = raw.replace(/[^a-z]/gi, '');
      if (/[,;:—–]$/.test(raw)) { at = i; break; }
      if (/^(and|but|so|or|because|while|although|which|that|then|when)$/i.test(token)) { at = i - 1; break; }
    }
    let cut = at > 3 ? list.slice(0, at) : list.slice(0, ceiling);
    // Drop trailing function words so the cut does not end on "and" / "to".
    while (cut.length > 4 && /^(and|or|but|so|that|with|for|to|of|in|on|at|the|a|an|your|our|we|is|are|it|this|they|you|as|by|from)$/i.test(cut[cut.length - 1])) {
      cut.pop();
    }
    const joined = cut.join(' ').replace(/\s*[—–]+\s*$/, '').replace(/[,;:\-]+$/, '');
    return (joined || collapse(sentence)) + '.';
  }

  // Split an over-long sentence at a REAL clause boundary (a comma,
  // semicolon or coordinating conjunction) so the voice lock never has to
  // chop it mid-phrase — breaking at the word midpoint produced sentences
  // like "…from our straightforward. Solutions to…", which is worse than
  // one long sentence trimmed at the ceiling.
  function breakLongSentences(sentences, ceiling) {
    const limit = Math.max(7, Math.round(ceiling * 1.6));
    const out = [];
    sentences.forEach((sentence) => {
      let current = collapse(sentence);
      let guard = 0;
      while (words(current).length > limit && guard < 6) {
        const list = words(current);
        let at = -1;
        for (let i = Math.min(limit, list.length - 3); i > 4; i--) {
          const raw = list[i - 1];
          const token = raw.replace(/[^a-z]/gi, '');
          if (/[,;:—–]$/.test(raw)) { at = i; break; }
          if (/^(and|but|so|or|because|while|although|which|that|then|when)$/i.test(token)) { at = i - 1; break; }
        }
        if (at < 4) break;   // no boundary: leave it whole for the clip pass
        const head = list.slice(0, at).join(' ').replace(/\s*[—–]+\s*$/, '').replace(/[,;:]+$/, '') + '.';
        const tail = upperFirst(list.slice(at).join(' ').replace(/^(and|but|so|or|then)\s+/i, ''));
        out.push(collapse(head));
        current = collapse(tail);
        guard++;
      }
      if (current) out.push(current);
    });
    return out;
  }

  const CONTRACTIONS = {
    'you are': "you're", 'we are': "we're", 'they are': "they're", 'it is': "it's",
    'that is': "that's", 'there is': "there's", 'here is': "here's",
    'do not': "don't", 'does not': "doesn't", 'did not': "didn't",
    'is not': "isn't", 'are not': "aren't", 'was not': "wasn't", 'were not': "weren't",
    'cannot': "can't", 'can not': "can't", 'will not': "won't", 'would not': "wouldn't",
    'could not': "couldn't", 'should not': "shouldn't", 'have not': "haven't",
    'has not': "hasn't", 'you have': "you've", 'we have': "we've",
    'they have': "they've", 'you will': "you'll", 'we will': "we'll"
  };
  const EXPANSIONS = (() => {
    const out = {};
    Object.keys(CONTRACTIONS).forEach((k) => {
      const v = CONTRACTIONS[k];
      if (!out[v]) out[v] = k;   // first spelling wins: "cannot" over "can not"
    });
    return out;
  })();

  // Swap one phrasing for another, keeping the original casing: "We are" ->
  // "We're", "we are" -> "we're".
  function applyMap(text, map) {
    let out = String(text || '');
    Object.keys(map).forEach((from) => {
      const to = map[from];
      const re = new RegExp('\\b' + escapeRe(from) + '\\b', 'gi');
      out = out.replace(re, (match) => (/^[A-Z]/.test(match) ? upperFirst(to) : to));
    });
    return out;
  }

  function stripWords(text, list) {
    let out = String(text || '');
    list.forEach((w) => {
      const re = new RegExp('\\b' + escapeRe(w) + '\\b', 'gi');
      out = out.replace(re, ' ');
    });
    return collapse(out);
  }

  /* ============================================================
     6 — deJargon: the de-cliché pass
     ============================================================ */

  /**
   * deJargon(text) -> { text, hits, bannedHits }
   * Applies REPLACEMENTS longest-first and records what changed, so a
   * rewrite can be reported ("3 clichés removed") rather than assumed.
   */
  // A phrase rule counts as "banned" when it swallows a banned term whole
  // ("unleash the power of" contains "unleash"), so the report does not claim
  // a cliché survived just because a longer pattern ate it first.
  function isBannedPhrase(term) {
    const t = String(term).toLowerCase();
    if (BANNED_SET.has(t)) return true;
    return BANNED_AI_VOCABULARY.some((b) => t.indexOf(b.toLowerCase()) !== -1);
  }

  function deJargon(text) {
    let out = collapse(text);
    const hits = [];
    REPLACEMENT_RULES.forEach((rule) => {
      const matches = out.match(rule.re);
      if (!matches || !matches.length) return;
      out = out.replace(rule.re, rule.to);
      hits.push({
        term: rule.term,
        replacement: rule.to,
        count: matches.length,
        banned: isBannedPhrase(rule.term)
      });
    });
    out = collapse(out).replace(/\s+([,.;:!?])/g, '$1');
    return {
      text: out,
      hits,
      bannedHits: hits.filter((h) => h.banned).map((h) => h.term)
    };
  }

  /* ============================================================
     7 — the Voice Lock pass
     ============================================================ */

  function applyVoiceLock(text, voiceLock) {
    const key = VOICE_LOCKS[String(voiceLock || '').toLowerCase()] ? String(voiceLock).toLowerCase() : DEFAULT_VOICE;
    const v = VOICE_LOCKS[key];
    let out = collapse(text);
    if (!out) return '';

    out = breakLongSentences(splitSentences(out), v.sentenceCeiling).join(' ');
    out = v.contractions ? applyMap(out, CONTRACTIONS) : applyMap(out, EXPANSIONS);
    if (v.stripHype) out = stripWords(out, HYPE_WORDS);
    if (v.stripHedges) out = stripWords(out, HEDGES);
    if (!v.exclamation) out = out.replace(/!+/g, '.');

    const sentences = splitSentences(out).map((s) => clipSentence(s, v.sentenceCeiling));
    out = polish(sentences.join(' '));
    return out;
  }

  function polish(text) {
    let out = collapse(text);
    out = out.replace(/\s+([,.;:!?])/g, '$1');          // no space before punctuation
    // One space after punctuation — but never inside a number: "2,400" is a
    // figure, not a comma followed by a phrase.
    out = out.replace(/([,;:])(?=\S)/g, (m, p, offset, whole) => {
      const before = whole[offset - 1];
      const after = whole[offset + 1];
      if (/\d/.test(before || '') && /\d/.test(after || '')) return m;
      return p + ' ';
    });
    out = out.replace(/\.{2,}/g, '.');                   // no ellipsis stacks
    out = out.replace(/\.\s*\./g, '.');
    out = out.replace(/\s+,/g, ',');
    out = out.replace(/^([,.;:!?])\s*/, '');
    out = out.replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
    if (out && !/[.!?]$/.test(out)) out += '.';
    return out.trim();
  }

  /* ============================================================
     8 — the scrubber (the guard everything else depends on)
     ============================================================ */

  /** Unique banned terms present in the text. Safe to call repeatedly. */
  function findBannedTerms(text) {
    const src = String(text == null ? '' : text);
    return BANNED_REGEXES.filter((b) => regexFires(b.re, src)).map((b) => b.term);
  }

  /**
   * scrubAIVocabulary(outputText, options) -> { ok, text, flagged, replaced, clean }
   * Strips banned vocabulary (and the AI-tell cousins) from any copy —
   * regardless of whether a model, a template or a human wrote it — and
   * reports exactly what it removed.
   *
   * options.strip   (default true)  — false only flags, leaving text alone
   * options.cousins (default true)  — also neutralise the AI-tell list
   */
  function scrubAIVocabulary(outputText, options) {
    const src = String(outputText == null ? '' : outputText);
    if (!src.trim()) return { ok: true, text: src, flagged: [], replaced: [], clean: true };
    const o = options || {};
    const strip = o.strip !== false;
    const cousins = o.cousins !== false;

    const flagged = findBannedTerms(src);
    const replaced = [];
    let out = src;

    if (strip) {
      REPLACEMENT_RULES.forEach((rule) => {
        if (!cousins && !BANNED_SET.has(rule.term.toLowerCase())) return;
        const matches = out.match(rule.re);
        if (!matches || !matches.length) return;
        out = out.replace(rule.re, rule.to);
        replaced.push({ term: rule.term, replacement: rule.to, count: matches.length });
      });
      // Anything that survived the table (e.g. a new spelling) is deleted
      // outright: zero banned vocabulary is the contract, not "mostly".
      BANNED_REGEXES.forEach((b) => {
        if (regexFires(b.re, out)) out = out.replace(b.re, ' ');
      });
      out = polish(out);
    }

    const remaining = findBannedTerms(out);
    return {
      ok: remaining.length === 0,
      text: out,
      flagged,
      replaced,
      clean: remaining.length === 0
    };
  }

  /* ============================================================
     9 — options + the strict system prompt
     ============================================================ */

  function normalizeOptions(options) {
    const o = options || {};
    const rawVoice = String(o.voiceLock != null ? o.voiceLock : (o.voice != null ? o.voice : DEFAULT_VOICE)).toLowerCase().trim();
    const voiceLock = VOICE_LOCKS[rawVoice] ? rawVoice : DEFAULT_VOICE;
    const rawFramework = String(o.framework == null ? DEFAULT_FRAMEWORK : o.framework).toUpperCase().trim();
    const framework = FRAMEWORK_ALIASES[rawFramework] || DEFAULT_FRAMEWORK;
    const niche = String(o.niche || '').toLowerCase().trim();
    return {
      voiceLock,
      framework,
      niche,
      lexicon: lexiconFor(niche),
      facts: o.facts && typeof o.facts === 'object' ? o.facts : null
    };
  }

  /**
   * buildSystemPrompt(rawText, options) -> string
   * The strict contract handed to a model. Every rule here is one the
   * local engine also enforces, so a model answer and a local answer are
   * graded by the same standard (scrubAIVocabulary).
   */
  function buildSystemPrompt(rawText, options) {
    const o = normalizeOptions(options);
    const v = VOICE_LOCKS[o.voiceLock];
    const f = FRAMEWORKS[o.framework];
    const nicheName = o.niche ? o.niche.replace(/-/g, ' ') : 'a general service business';
    const facts = o.facts ? '\n\nFACTS (immutable — never invent or alter)\n' + JSON.stringify(o.facts, null, 2) : '';
    const lines = [
      'You are a senior direct-response copywriter with twenty years of experience writing for ' + nicheName + '.',
      'You rewrite the RAW COPY the user supplies. You never invent facts, prices, names, addresses, guarantees, certifications or statistics.',
      '',
      'HARD RULES',
      '1. Never use these words or phrases, in any form: ' + BANNED_AI_VOCABULARY.join(', ') + '.',
      '2. Sentences: ' + v.sentenceCeiling + ' words or fewer. One idea per sentence. Vary the length so the rhythm is human.',
      '3. Verbs: active and concrete. Rewrite nominalisations back into verbs ("the installation of" -> "we install").',
      '4. Person: address the reader as "you"; the business speaks as "we".',
      '5. Numbers beat adjectives ("fitted in two days", not "fitted quickly"). Use only numbers present in the RAW COPY or the FACTS block.',
      '6. Cut hype adjectives (amazing, incredible, ultimate, stunning, outstanding) and filler openers ("In a world where", "We are excited to announce").',
      '7. No emoji, no ALL CAPS, no exclamation marks, no markdown, no headings, no bullet lists.',
      '8. Keep every existing fact, price, name, phone number, URL and legal claim exactly as written.',
      '9. If the RAW COPY does not support a beat, write a short generic sentence for that beat rather than inventing a specific claim.',
      '',
      'VOICE LOCK: ' + v.label.toUpperCase(),
      v.directive,
      '',
      'FRAMEWORK: ' + f.label,
      f.directive,
      f.steps.map((s, i) => '  ' + (i + 1) + '. ' + s.role.toUpperCase() + ' - ' + s.instruction).join('\n'),
      '',
      'NICHE: ' + nicheName + ' (audience: ' + o.lexicon.audience + ')',
      'Use the vocabulary of this trade, but never assume facts the RAW COPY does not state.',
      facts,
      '',
      'OUTPUT CONTRACT',
      'Return ONLY minified JSON. No prose, no explanation, no code fences.',
      'Shape: {"beats":[{"role":"' + f.steps[0].role + '","text":"..."}],"copy":"..."}',
      'Every "text" is a finished sentence. "copy" is every beat joined with a single space.',
      'If the RAW COPY is empty or unusable, return {"beats":[],"copy":""}.',
      '',
      'RAW COPY',
      '"""',
      String(rawText == null ? '' : rawText).slice(0, 4000),
      '"""'
    ];
    return lines.join('\n');
  }

  /* ============================================================
     10 — framework assembly
     ============================================================ */

  // The single most claim-like sentence: longest that still fits a
  // sentence, earliest wins ties. Falls back to the first sentence.
  function coreClaim(sentences, ceiling) {
    const usable = sentences.filter((s) => words(s).length >= 3);
    if (!usable.length) return '';
    let best = usable[0];
    let bestLen = -1;
    usable.forEach((s) => {
      const n = words(s).length;
      if (n > ceiling) return;
      if (n > bestLen) { bestLen = n; best = s; }
    });
    return collapse(best);
  }

  function buildBeats(sentences, o) {
    const lex = o.lexicon;
    const ceiling = VOICE_LOCKS[o.voiceLock].sentenceCeiling;
    const core = coreClaim(sentences, Math.max(ceiling, 16));
    const pool = sentences.filter((s) => s !== core && words(s).length >= 3);
    const claim = core || lex.gain;
    // The client's own copy always lands in the benefit beat — that is the one
    // it was written for. The problem/agitate beats come from the lexicon
    // instead, because a business blurb is almost never a statement of the
    // reader's problem, and a framework that opens on "we have traded for
    // twenty years" has not opened on a problem at all.
    const benefit = [claim, pool[0]].filter(Boolean).join(' ');

    if (o.framework === 'AIDA') {
      return [
        { role: 'attention', text: claim },
        { role: 'interest', text: pool[0] || lex.gain },
        { role: 'desire', text: lex.proof },
        { role: 'action', text: lex.cta }
      ];
    }
    if (o.framework === 'BAB') {
      return [
        { role: 'before', text: lex.pain },
        { role: 'after', text: benefit },
        { role: 'bridge', text: 'That is where we come in. ' + upperFirst(lex.cta) + '.' }
      ];
    }
    return [
      { role: 'problem', text: lex.pain },
      { role: 'agitate', text: lex.agitate },
      { role: 'solution', text: benefit }
    ];
  }

  /* ============================================================
     11 — the public engine
     ============================================================ */

  /**
   * optimizeCopy(rawText, options) -> result
   * Pure/synchronous/deterministic/offline.
   *
   * options.voiceLock  'warm' | 'premium' | 'punchy' | 'editorial'
   * options.voice      legacy alias for voiceLock (Voice Lock tones)
   * options.framework  'PAS' | 'AIDA' | 'BAB'
   * options.niche      e.g. 'roofing', 'dental', 'legal'
   * options.facts      object of immutable client facts (prompt + model path)
   */
  function optimizeCopy(rawText, options) {
    const raw = String(rawText == null ? '' : rawText);
    if (!raw.trim()) {
      return { ok: false, error: 'rawText must be a non-empty string.', text: '', raw };
    }
    const o = normalizeOptions(options);
    const dejargon = deJargon(raw);
    const sentences = splitSentences(dejargon.text);
    const beats = buildBeats(sentences, o);

    const voiced = beats
      .map((b) => ({ role: b.role, text: applyVoiceLock(b.text, o.voiceLock) }))
      .filter((b) => b.text);

    const scrub = scrubAIVocabulary(voiced.map((b) => b.text).join(' '), { cousins: true });
    const text = polish(scrub.text);

    return {
      ok: true,
      text,
      raw,
      copy: text,
      voiceLock: o.voiceLock,
      voiceLabel: VOICE_LOCKS[o.voiceLock].label,
      framework: o.framework,
      frameworkLabel: FRAMEWORKS[o.framework].label,
      niche: o.niche || 'generic',
      beats: voiced.map((b) => ({ role: b.role, text: b.text })),
      removed: dejargon.bannedHits,
      replaced: dejargon.hits,
      flagged: scrub.flagged,
      clean: scrub.clean,
      changed: text !== polish(raw),
      engine: 'local',
      systemPrompt: buildSystemPrompt(raw, options)
    };
  }

  /* ---------------- the optional model seam ---------------- */

  let registeredCompleter = null;

  /** Install a model adapter once (main process / deployment). fn({ system, prompt, rawText, options }) -> Promise<string|{beats,copy}> */
  function setCompleter(fn) {
    registeredCompleter = typeof fn === 'function' ? fn : null;
    return !!registeredCompleter;
  }

  // Tolerate a model that answers with JSON, with bare copy, or with JSON
  // wrapped in prose or a code fence. Never throw on a bad answer.
  function copyFromParsed(parsed) {
    if (!parsed || typeof parsed !== 'object') return '';
    if (typeof parsed.copy === 'string' && parsed.copy.trim()) return collapse(parsed.copy);
    if (Array.isArray(parsed.beats)) {
      const joined = collapse(parsed.beats
        .map((b) => (b && typeof b.text === 'string' ? b.text : ''))
        .join(' '));
      if (joined) return joined;
    }
    return '';
  }

  function parseModelAnswer(answer) {
    if (answer == null) return '';
    if (typeof answer === 'object') return copyFromParsed(answer);
    const text = String(answer).trim();
    if (!text) return '';
    const fenced = text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();

    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start !== -1 && end > start) {
      let parsed = null;
      try { parsed = JSON.parse(fenced.slice(start, end + 1)); } catch (_) { parsed = null; }
      if (parsed !== null) {
        // The answer WAS structured: take its copy, or reject it. Shipping the
        // raw JSON as page copy (a model that answered {"copy": 123} once
        // produced '{"copy": 123}.' on a client's hero) is worse than falling
        // back to the local engine.
        return copyFromParsed(parsed);
      }
    }
    // Brace-led text that is not usable JSON is not copy either.
    if (/^[[{]/.test(fenced)) return '';
    return collapse(fenced);
  }

  /**
   * optimizeCopyAsync(rawText, options) -> Promise<result>
   * Uses options.complete or the registered completer when one exists,
   * then runs the same voice lock + scrubber over the answer. Any failure
   * (no model, offline, timeout, unusable answer) silently falls back to
   * optimizeCopy, so the caller always gets usable copy.
   */
  async function optimizeCopyAsync(rawText, options) {
    const o = options || {};
    const completer = (typeof o.complete === 'function' ? o.complete : null) || registeredCompleter;
    const local = () => {
      const result = optimizeCopy(rawText, options);
      return result;
    };

    if (!completer) return local();

    const base = optimizeCopy(rawText, options);
    if (!base.ok) return base;

    try {
      const answer = await completer({
        system: base.systemPrompt,
        prompt: base.systemPrompt,
        rawText: String(rawText == null ? '' : rawText),
        options: o,
        framework: base.framework,
        voiceLock: base.voiceLock,
        niche: base.niche
      });
      const parsed = parseModelAnswer(answer);
      if (!parsed) throw new Error('model returned no usable copy');

      const norm = normalizeOptions(options);
      const voiced = applyVoiceLock(parsed, norm.voiceLock);
      const scrub = scrubAIVocabulary(voiced, { cousins: true });
      const text = polish(scrub.text);

      if (!text) throw new Error('model copy was empty after scrubbing');

      return Object.assign({}, base, {
        text,
        copy: text,
        beats: [{ role: 'copy', text }],
        flagged: scrub.flagged,
        clean: scrub.clean,
        changed: text !== polish(String(rawText == null ? '' : rawText)),
        engine: 'model'
      });
    } catch (error) {
      base.engine = 'local';
      base.error = 'model path failed: ' + String((error && error.message) || error);
      return base;
    }
  }

  /* ---------------- exports ---------------- */

  CopyOptimizer.BANNED_AI_VOCABULARY = BANNED_AI_VOCABULARY;
  CopyOptimizer.AI_TELLS = AI_TELLS;
  CopyOptimizer.REPLACEMENTS = REPLACEMENTS;
  CopyOptimizer.HYPE_WORDS = HYPE_WORDS;
  CopyOptimizer.VOICE_LOCKS = VOICE_LOCKS;
  CopyOptimizer.FRAMEWORKS = FRAMEWORKS;
  CopyOptimizer.NICHE_LEXICON = NICHE_LEXICON;
  CopyOptimizer.DEFAULT_VOICE = DEFAULT_VOICE;
  CopyOptimizer.DEFAULT_FRAMEWORK = DEFAULT_FRAMEWORK;

  CopyOptimizer.termRegex = termRegex;
  CopyOptimizer.normalizeOptions = normalizeOptions;
  CopyOptimizer.deJargon = deJargon;
  CopyOptimizer.applyVoiceLock = applyVoiceLock;
  CopyOptimizer.findBannedTerms = findBannedTerms;
  CopyOptimizer.scrubAIVocabulary = scrubAIVocabulary;
  CopyOptimizer.buildSystemPrompt = buildSystemPrompt;
  CopyOptimizer.optimizeCopy = optimizeCopy;
  CopyOptimizer.optimizeCopyAsync = optimizeCopyAsync;
  CopyOptimizer.setCompleter = setCompleter;

  if (typeof module !== 'undefined' && module.exports) module.exports = CopyOptimizer;
  if (typeof window !== 'undefined') window.CopyOptimizer = CopyOptimizer;
})();

'use strict';

// ============================================================
// Concierge — the Q&A widget that ships inside every export.
// ------------------------------------------------------------
// A rule-based answering widget that lives in the exported file. No server, no
// API key, no account, no per-seat pricing: the knowledge pack is a JSON object
// inlined at build time and the matcher is a few hundred bytes of vanilla JS.
// That is the whole point — every other site chatbot is a hosted SaaS, and this
// one works because a PallettAI site is a file rather than a tenant.
//
// The matcher is the part worth being careful about. A FAQ bot that answers the
// WRONG question confidently is worse than one that admits ignorance: a visitor
// asking "do you have parking?" who is told the opening hours learns the site
// does not understand them, and a visitor told the wrong price has been misled
// by the business's own website.
//
// So the design is deliberately conservative:
//
//   * Coverage and precision are scored separately. Covering the entry's own
//     question matters more than matching a lot of the visitor's words, which
//     stops a long vague question from outscoring the entry it actually names.
//   * A literal phrase match is worth more than scattered shared words.
//   * Below a threshold it refuses and offers the enquiry form.
//   * When the top two entries are too close to separate, it asks WHICH one
//     instead of picking — a clickable question rather than a confident guess.
//
// The panel is a typable FAQ as much as a chat: the input is a real input and
// the suggestions are real buttons, so it is keyboard- and screen-reader-operable
// without any chat-widget-specific affordances. That falls out of not building a
// fake chat transcript.
//
// ONE MATCHER, TWO HOMES. The export cannot see this module, so the matcher is
// emitted into the page as source (runtimeSource below) rather than copied by
// hand. The suite evaluates the emitted text and checks it agrees with this
// module verdict for verdict, so the two can never drift.
// ============================================================

const Concierge = (() => {

  // Budgets. A concierge that doubles the page weight has cost the client more
  // than it earns them, so the pack is capped and the suite has a ceiling.
  const MAX_ENTRIES = 40;
  const MAX_Q = 120;
  const MAX_A = 700;
  const MAX_FIELD = 600;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Words that carry no subject matter. Removing them is what stops "do you …"
  // matching "do you …" on the strength of the word "do". Deliberately broad:
  // over-removing costs a little recall, under-removing produces confident
  // nonsense, and only one of those is acceptable.
  const STOP = new Set([
    'a', 'about', 'after', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'before',
    'can', 'could', 'did', 'do', 'does', 'doing', 'for', 'from', 'get', 'got', 'had', 'has',
    'have', 'he', 'hello', 'her', 'hey', 'hi', 'him', 'his', 'how', 'i', 'if', 'in', 'is', 'it',
    'its', 'just', 'kindly', 'me', 'much', 'my', 'need', 'of', 'ok', 'okay', 'on', 'or', 'our',
    'please', 'she', 'should', 'so', 'some', 'such', 'than', 'thank', 'thanks', 'that', 'the',
    'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'us', 'want', 'was',
    'we', 'were', 'what', 'when', 'where', 'which', 'who', 'whom', 'why', 'will', 'with', 'would',
    'you', 'your', 'yours'
  ]);

  // Enough of a stemmer that "Sundays"/"Sunday" and "prices"/"price" agree. Not a
  // linguistics exercise: the failure it prevents is a visitor typing the plural
  // of a word the client typed in the singular.
  function stem(w) {
    if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
    if (w.length > 4 && w.endsWith('es') && !/(ss|sh|ch|x|z)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
    return w;
  }

  // Fold to plain lowercase content words, so punctuation, curly apostrophes and
  // capitalisation never decide whether a visitor gets an answer.
  function words(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map(stem);
  }

  // The same fold WITHOUT the stopword filter. Function words are noise in a
  // whole question, but they are the entire signal in a few of them: "how much
  // is a fade" contains nothing except a price intent, and 'much' is a stopword.
  // This list feeds the curated keyword layer below, which is small and chosen,
  // so it cannot suffer the noise problem the general matcher has to avoid.
  function rawWords(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .filter((w) => w.length > 1)
      .map(stem);
  }

  const phrase = (text) => String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();

  // How well one candidate question answers the visitor's, in 0..1, and WHICH
  // signal produced it. The basis matters because the signals are not equally
  // trustworthy, and only the weakest one can be talked out of answering:
  //
  //   verbatim — asked back almost word for word
  //   key      — a word the client named as meaning this entry
  //   answer   — a word the visitor used that the client's own answer uses
  //   ratio    — merely shares words with the entry's question
  //
  // Those last two are guesses dressed as matches. See the guard in ask().
  function judge(question, entry) {
    let basis = 'ratio';
    let best = 0;
    const q = phrase(question);
    const qWords = words(question);
    const keys = [entry && entry.q].concat((entry && entry.tags) || []);

    keys.forEach((key) => {
      const keyWords = words(key);
      const k = phrase(key);
      const verbatim = k.length > 3 && q.indexOf(k) !== -1;   // asked almost word for word
      // A curated phrasing can be made ONLY of function words — "what can you do"
      // is one of ours — and then it has no content words to score with. Skipping
      // it here made every such phrasing dead weight in the pack: there was
      // nothing left to match it by. The phrase comparison is the entire signal,
      // and a visitor typing the client's own wording is the strongest evidence
      // in this whole function.
      if (!keyWords.length) {
        if (verbatim) { best = 1; basis = 'verbatim'; }
        return;
      }
      let hits = 0;
      keyWords.forEach((w) => { if (qWords.indexOf(w) !== -1) hits += 1; });
      if (!hits) return;
      // Two different questions, both worth asking:
      //   cover     — how much of the entry's own question was asked?
      //   precision — how much of the visitor's question does it account for?
      // Coverage dominates, so "do you have parking?" beats a long vague question
      // that merely shares one word with it.
      const cover = hits / keyWords.length;
      const precision = hits / (qWords.length || 1);
      let s = cover * 0.7 + precision * 0.3;
      let why = 'ratio';
      if (verbatim) { s += 0.5; why = 'verbatim'; }
      if (s > best) { best = s; basis = why; }
    });

    // The curated keyword layer. A client (or one of our structured fields) can
    // name the words that mean this entry, and a hit is worth a flat score rather
    // than a ratio — because the ratio is exactly what cannot see 'much' in "how
    // much is a fade". Deliberately just over the threshold: an intent keyword is
    // good enough to answer, not good enough to beat a real question match.
    const raw = rawWords(question);
    const aliases = (entry && entry.keys) || [];
    for (let i = 0; i < aliases.length; i += 1) {
      const word = stem(String(aliases[i] || '').toLowerCase().trim());
      if (word.length > 1 && raw.indexOf(word) !== -1) {
        if (KEY_HIT > best) basis = 'key';
        best = Math.max(best, KEY_HIT);
        break;
      }
    }

    // Words the visitor used that the client's own answer also uses. Only 4+
    // letters, so "cuts" counts and "you" cannot; the answer is long, so a short
    // word would start matching by accident. TWO of them, though, not one: a
    // single shared word is a coincidence, and it was selecting wrong answers.
    // "Do you offer gluten free" reached the parking entry on "free" alone — the
    // answer says "two free spaces" — and at one hit that also applies to shop,
    // open, time, week and half the language. Two shared words is a topic.
    const answerWords = rawWords(entry && entry.a);
    let shared = 0;
    for (let i = 0; i < raw.length; i += 1) {
      if (raw[i].length > 3 && answerWords.indexOf(raw[i]) !== -1) shared += 1;
    }
    if (shared >= ANSWER_WORDS) {
      if (ANSWER_HIT > best && basis === 'ratio') basis = 'answer';
      best = Math.max(best, ANSWER_HIT);
    }

    return { score: Math.round(Math.min(1, best) * 100) / 100, basis };
  }

  // Kept as the numeric face of judge(), so anything that wants "just the score"
  // (and the emitted runtime, which carries this source verbatim) still reads it
  // as a number rather than an object.
  const scoreEntry = (question, entry) => judge(question, entry).score;

  // Every word the pack knows: each entry's own question, its aliases, the
  // alternative phrasings and its answer.
  function vocab(entries) {
    const known = new Set();
    (entries || []).forEach((e) => {
      if (!e) return;
      [e.q, (e.tags || []).join(' '), (e.keys || []).join(' '), e.a].forEach((t) => {
        words(t).forEach((w) => known.add(w));
      });
    });
    return known;
  }

  // How much of the visitor's question is about something this pack has never
  // mentioned. This exists because ratio matching cannot tell a distinctive word
  // from a generic one: "do you cut hair for weddings on a boat" reached a
  // children's-hair entry on "cut" and "hair" alone — which are the words a
  // barber's entire pack is made of — and answered it, 0.62, confidently wrong.
  // Every word in that question the pack HAS seen is generic; "weddings" and
  // "boat" appear nowhere, and that is the whole signal.
  function unfamiliarShare(question, entries) {
    const qWords = words(question);
    if (!qWords.length) return 0;
    const known = vocab(entries);
    let odd = 0;
    qWords.forEach((w) => { if (!known.has(w)) odd += 1; });
    return odd / qWords.length;
  }

  // Below this, the honest answer is "I don't know". Tuned against the suite: high
  // enough that scattered shared words refuse, low enough that a question phrased
  // differently from the client's still answers.
  const THRESHOLD = 0.5;
  // Two candidates this close are a coin toss, so the widget asks instead.
  const AMBIGUOUS_DELTA = 0.08;
  // What a curated keyword hit is worth. Above THRESHOLD so an intent word can
  // answer on its own, below a real question match so it can never outrank one.
  const KEY_HIT = 0.55;
  // A word the visitor used that also appears in the client's ANSWER. "Do you do
  // beard trims?" reaches a services answer that lists beard trims, without the
  // client having to predict the phrasing. Worth answering on, but the least
  // reliable of the three signals, so it sits just over the threshold.
  const ANSWER_HIT = 0.52;
  // How many words the visitor and the answer must share. See the comment above
  // the loop: one match is a coincidence and picks the wrong entry.
  const ANSWER_WORDS = 2;
  // Small words that are real when they ARE the question ("thank you"), which is
  // why they are listed here rather than trusted from the stopword list.
  const SMALL_TALK = [
    { kind: 'greeting', words: ['hi', 'hiya', 'hello', 'hey', 'yo', 'morning', 'afternoon', 'evening', 'there', 'good', 'greetings'] },
    { kind: 'thanks', words: ['thank', 'thanks', 'you', 'ta', 'cheers', 'thankyou', 'much', 'appreciate', 'great', 'nice', 'perfect'] }
  ];

  // Only when the whole question is small talk. "hi, do you have parking?" is a
  // parking question that happens to start politely, and must still be answered.
  function smallTalk(question) {
    const all = rawWords(question);
    if (!all.length) return null;
    for (let i = 0; i < SMALL_TALK.length; i += 1) {
      const set = SMALL_TALK[i].words;
      if (all.every((w) => set.indexOf(w) !== -1)) return SMALL_TALK[i].kind;
    }
    return null;
  }

  // The whole decision, exposed so it can be tested without a browser.
  function ask(question, pack) {
    const entries = (pack && pack.entries) || [];
    // Score 0 with the rest of them. This exit is checked before the threshold,
    // so it was never the bug — but every other verdict carries a number, and a
    // caller comparing an absent one to a threshold is exactly how the
    // `undefined < THRESHOLD` hole opened. Uniform shape, no special cases.
    if (!phrase(question)) return { kind: 'empty', score: 0 };
    // Answered before matching, because "hello" reaching the enquiry form reads
    // as a broken site rather than a careful one.
    const small = smallTalk(question);
    if (small) return { kind: small, score: 1 };
    if (!entries.length) return { kind: 'unknown', score: 0 };

    let first = null;
    let second = null;
    entries.forEach((entry) => {
      const score = scoreEntry(question, entry);
      if (!first || score > first.score) { second = first; first = { entry, score }; }
      else if (!second || score > second.score) { second = { entry, score }; }
    });

    if (!first || first.score < THRESHOLD) return { kind: 'unknown', score: first ? first.score : 0 };

    // A match made only of shared words does not survive a question that is
    // mostly about something the pack never mentions. The client's own aliases
    // and an almost-verbatim question are authoritative and skip this: a curated
    // key is the client telling us what the words mean, which is precisely what a
    // bag-of-words overlap cannot know. So "can I park my van overnight" still
    // answers on the pack's `park` alias, while the boat question is handed to a
    // human instead of being guessed at.
    const verdict = judge(question, first.entry);
    const guessy = verdict.basis === 'ratio' || verdict.basis === 'answer';
    if (guessy && unfamiliarShare(question, entries) >= 0.5) {
      return { kind: 'unknown', score: verdict.score };
    }

    if (second && second.score >= THRESHOLD && (first.score - second.score) < AMBIGUOUS_DELTA) {
      return { kind: 'ambiguous', score: first.score, options: [first.entry, second.entry] };
    }
    return { kind: 'answer', score: first.score, entry: first.entry };
  }

  // ---------------------------------------------------------------- the pack
  // Structured fields become questions. This is where a client who fills in
  // "Prices" gets "how much is it?" answered without writing a single entry.
  // `tags` are alternative phrasings (scored as questions). `keys` are single
  // words that BY THEMSELVES mean this entry — the escape hatch for questions
  // whose subject never appears in the client's wording, which is how "how much
  // is a fade" reaches a price list that never says "fade".
  //
  // Only content words here. A function word in this list would fire on almost
  // every question and poison the matcher.
  const STRUCTURED = [
    { key: 'hours', q: 'What are your opening hours?', tags: ['when are you open', 'are you open on sundays', 'opening times', 'open late'], keys: ['open', 'opening', 'hours', 'late', 'sunday', 'weekend', 'close', 'closing', 'shut', 'time', 'today'] },
    { key: 'prices', q: 'How much do you charge?', tags: ['prices', 'price list', 'how much is it', 'cost', 'what do you charge'], keys: ['price', 'cost', 'charge', 'fee', 'rate', 'quote', 'much'] },
    // 'offer' is deliberately NOT an alias here. "Do you offer X" is one of the
    // commonest shapes in English — offer finance, offer delivery, offer gluten
    // free — and as an alias it made every one of them answer with the services
    // list. The entry's own question already covers "what do you offer", which
    // scores 0.65 on shared words without needing the alias to inflate it.
    { key: 'services', q: 'What services do you offer?', tags: ['what do you do', 'what can you do', 'services list'], keys: ['service', 'specialise', 'specialize'] },
    { key: 'area', q: 'What areas do you cover?', tags: ['do you cover my area', 'where are you based', 'do you travel to me'], keys: ['area', 'cover', 'travel', 'located', 'based', 'radius', 'nearby'] },
    { key: 'booking', q: 'How do I book?', tags: ['can i book', 'book an appointment', 'make a booking', 'how do i make an appointment'], keys: ['book', 'booking', 'appointment', 'schedule', 'availability', 'slot'] }
  ];

  function packFor(site) {
    const c = (site && site.concierge) || null;
    if (!c || c.on !== true) return null;

    const entries = [];
    const cleanList = (list, max, len) => (Array.isArray(list) ? list : [])
      .map((x) => String(x == null ? '' : x).trim().slice(0, len))
      .filter(Boolean)
      .slice(0, max);
    const push = (q, a, tags, keys) => {
      const question = String(q == null ? '' : q).trim().slice(0, MAX_Q);
      const answer = String(a == null ? '' : a).trim().slice(0, MAX_A);
      if (!question || !answer) return;              // half an entry answers nothing
      entries.push({
        q: question,
        a: answer,
        tags: cleanList(tags, 8, MAX_Q),
        keys: cleanList(keys, 14, 24)
      });
    };

    STRUCTURED.forEach((f) => {
      const value = String(c[f.key] == null ? '' : c[f.key]).trim().slice(0, MAX_FIELD);
      if (value) push(f.q, value, f.tags, f.keys);
    });

    (Array.isArray(c.entries) ? c.entries : []).slice(0, MAX_ENTRIES).forEach((e) => {
      // A client's own entry may name its aliases in `keys` (single words) or
      // write whole alternative questions in `tags`. Both are additive.
      if (e) push(e.q, e.a, e.tags, e.keys);
    });

    if (!entries.length) return null;

    return {
      greeting: (String(c.greeting || '').trim() || 'Ask us anything — we usually reply the same day.').slice(0, 200),
      thanks: (String(c.thanks || '').trim() || 'Any time — anything else I can help with?').slice(0, 200),
      unknown: (String(c.unknown || '').trim() || "I don't want to guess at that one — send it over and a human will answer.").slice(0, 240),
      entries
    };
  }

  // ---------------------------------------------------------------- markup
  // The launcher is a button, not a link, and the panel is a labelled dialog.
  // Nothing needs a mouse: the input takes typing, the suggestions are buttons,
  // and Escape closes.
  function launcherHtml(pack) {
    if (!pack) return '';
    const chips = pack.entries.slice(0, 4).map((e) => e.q);
    return `
<div class="cn" data-concierge>
  <button type="button" class="cn-btn" data-cn-open aria-expanded="false" aria-controls="cnPanel">
    <span class="cn-btn-ico" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5.4A2.4 2.4 0 0 1 5.4 3h9.2A2.4 2.4 0 0 1 17 5.4v5.2a2.4 2.4 0 0 1-2.4 2.4H8.6L4.4 16v-3A2.4 2.4 0 0 1 3 10.6V5.4z"/><path d="M7 7.2h6M7 9.9h3.5"/></svg></span>
    <span class="cn-btn-label">Ask us</span>
  </button>
  <section class="cn-panel" id="cnPanel" role="dialog" aria-modal="false" aria-labelledby="cnTitle" hidden>
    <header class="cn-head">
      <b id="cnTitle">Ask us a question</b>
      <button type="button" class="cn-x" data-cn-close aria-label="Close">✕</button>
    </header>
    <div class="cn-log" data-cn-log aria-live="polite"></div>
    <div class="cn-chips" data-cn-chips>${chips.map((x) => `<button type="button" class="cn-chip" data-cn-ask="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <form class="cn-ask" data-cn-form>
      <input class="cn-in" data-cn-in type="text" autocomplete="off" aria-label="Your question" placeholder="Type your question…">
      <button type="submit" class="cn-send">Send</button>
    </form>
    <div class="cn-escalate" data-cn-escalate hidden>
      <p class="cn-esc-note" data-cn-esc-note></p>
      <form class="cn-form" data-form="Concierge question" data-cn-contact>
        <input type="text" name="name" placeholder="Your name" required autocomplete="name">
        <input type="email" name="email" placeholder="Email" required autocomplete="email">
        <input type="hidden" name="question" data-cn-q>
        <textarea name="message" rows="2" placeholder="Anything to add?" data-cn-msg></textarea>
        <button type="submit" class="cn-send">Send to the team</button>
      </form>
    </div>
    <p class="cn-note">Answered on your device. Nothing is sent anywhere until you press send.</p>
  </section>
</div>`;
  }

  // ---------------------------------------------------------------- css
  // Colours are derived from the export's own custom properties, which siteCSS
  // defines (--surface, --text, --accent, --primary). The export has no --border,
  // so the edges are mixed from --text instead of guessed at — that way the
  // widget follows the client's palette AND the dark/light theme switch with no
  // extra configuration.
  // `badge` lifts the whole widget clear of the "Made with PallettAI Studio" tag,
  // which is fixed in the same corner (right:16px, bottom:16px, z-index 70) on
  // every site that has not bought it off. Left at the default the badge painted
  // straight over the launcher — the button could not be clicked at all, so the
  // concierge was unreachable on exactly the sites most likely to be using it.
  // The height is not guessed: the badge is 37px tall, so bottom:64 leaves 11px
  // of air, and the narrower phone badge lifts by 52 to match its smaller padding.
  function css(badge) {
    return `.cn{position:fixed;right:18px;bottom:${badge ? 64 : 18}px;z-index:60;display:flex;flex-direction:column;align-items:flex-end;gap:10px;--cn-line:color-mix(in srgb,var(--text,#111) 18%,transparent);--cn-soft:color-mix(in srgb,var(--text,#111) 7%,var(--surface,#fff));--cn-accent:var(--accent,#7cc0f8);font:inherit}
.cn-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--cn-line);background:var(--surface,#fff);color:var(--text,#111);border-radius:999px;padding:10px 16px;font:inherit;font-weight:700;font-size:.9rem;cursor:pointer;box-shadow:0 12px 34px rgba(0,0,0,.18)}
.cn-btn:hover{border-color:var(--cn-accent)}
.cn-btn-ico svg{width:18px;height:18px;display:block}
.cn-panel{width:min(360px,calc(100vw - 36px));max-height:min(70vh,520px);display:flex;flex-direction:column;background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--cn-line);border-radius:18px;box-shadow:0 28px 70px rgba(0,0,0,.3);overflow:hidden}
.cn-panel[hidden]{display:none}
.cn-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--cn-line)}
.cn-head b{font-size:.92rem}
.cn-x{background:none;border:0;color:inherit;opacity:.6;font-size:1rem;cursor:pointer;padding:4px 6px;border-radius:8px}
.cn-x:hover{opacity:1}
.cn-log{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:9px;font-size:.86rem;line-height:1.55}
.cn-log:empty{display:none}
.cn-msg{max-width:92%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-break:break-word}
.cn-msg.me{align-self:flex-end;background:var(--cn-accent);color:#04122b;border-bottom-right-radius:4px}
.cn-msg.bot{align-self:flex-start;background:var(--cn-soft);border:1px solid var(--cn-line);border-bottom-left-radius:4px}
.cn-more{display:flex;flex-wrap:wrap;gap:6px}
.cn-opt{border:1px solid var(--cn-line);background:none;color:inherit;font:inherit;font-size:.78rem;padding:5px 11px;border-radius:999px;cursor:pointer}
.cn-opt:hover{border-color:var(--cn-accent)}
.cn-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 10px}
.cn-chips:empty{display:none}
.cn-chip{border:1px dashed var(--cn-line);background:none;color:inherit;font:inherit;font-size:.76rem;padding:5px 11px;border-radius:999px;cursor:pointer}
.cn-chip:hover{border-style:solid;border-color:var(--cn-accent)}
.cn-ask{display:flex;gap:7px;padding:10px 12px;border-top:1px solid var(--cn-line)}
.cn-in{flex:1;min-width:0;background:var(--cn-soft);border:1px solid var(--cn-line);color:inherit;border-radius:11px;padding:9px 11px;font:inherit;font-size:.86rem}
.cn-in:focus,.cn-chip:focus-visible,.cn-opt:focus-visible,.cn-btn:focus-visible,.cn-send:focus-visible,.cn-x:focus-visible{outline:2px solid var(--cn-accent);outline-offset:2px}
.cn-send{flex:none;border:0;border-radius:11px;padding:9px 14px;font:inherit;font-weight:700;font-size:.86rem;cursor:pointer;background:var(--cn-accent);color:#04122b}
.cn-escalate{padding:0 12px 10px}
.cn-escalate[hidden]{display:none}
.cn-esc-note{margin:0 0 8px;font-size:.78rem;opacity:.75;line-height:1.5}
.cn-form{display:flex;flex-direction:column;gap:7px}
.cn-form input,.cn-form textarea{width:100%;background:var(--cn-soft);border:1px solid var(--cn-line);color:inherit;border-radius:10px;padding:8px 10px;font:inherit;font-size:.84rem}
.cn-note{margin:0;padding:0 14px 12px;font-size:.68rem;line-height:1.5;opacity:.6}
@media (max-width:520px){.cn{right:12px;bottom:${badge ? 52 : 12}px;left:12px;align-items:stretch}.cn-panel{width:auto}}
@media print{.cn{display:none}}`;
  }

  // ---------------------------------------------------------------- script
  // The matcher, as source. Emitted rather than hand-copied so the page and this
  // module cannot disagree; the suite evaluates this exact text and compares its
  // verdicts with the module's.
  //
  // Every function goes out through slim() first. Function.toString() returns the
  // source INCLUDING its comments, so the explanation above each one was being
  // shipped to every visitor, in the page's HTML, where it helped nobody — and it
  // is why the payload budget failed the first time this was run with the
  // comments on. This strips line and block comments plus leading indentation
  // from the emitted copy only; this file keeps them.
  //
  // Conservative on purpose. It tracks quote state so a `//` inside a string is
  // left alone.
  //
  // It DOES have to understand regex literals, and the first version didn't. A
  // pattern can contain a quote — /[^a-z0-9']+/ is one of ours — which flipped
  // the string tracking, so everything after it was treated as string content
  // and every later comment survived. The strip silently did nothing, which is
  // how it was found: the payload assertion failed while the comments were
  // plainly still in the output.
  function slim(fn) {
    const src = String(fn);
    // A `/` after a value is division; after an operator, brace or comma it opens
    // a pattern. Every regex in these sources follows `(` or `=`, and divisions
    // here only ever follow an identifier — so the usual heuristic is enough.
    const opensRegex = /[([{,;:=!&|?+\-*%^~<>]|^$/;
    let out = '';
    let quote = null;
    for (let i = 0; i < src.length; i += 1) {
      const c = src[i];
      const n = src[i + 1];
      if (quote) {
        out += c;
        if (c === '\\') { out += n; i += 1; }
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
      if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; out += '\n'; continue; }
      if (c === '/' && n === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
        i += 1;
        continue;
      }
      if (c === '/' && opensRegex.test(out.replace(/\s+$/, '').slice(-1))) {
        // Copy the whole pattern through without interpreting anything in it,
        // tracking character classes: a `[` can contain a `/` that does not end
        // the literal.
        let inClass = false;
        out += c;
        for (i += 1; i < src.length; i += 1) {
          const d = src[i];
          out += d;
          if (d === '\\') { out += src[i + 1]; i += 1; continue; }
          if (d === '[') inClass = true;
          else if (d === ']') inClass = false;
          else if (d === '/' && !inClass) break;
        }
        continue;
      }
      out += c;
    }
    return out.split('\n').map((l) => l.replace(/^\s+/, '')).filter((l) => l.trim() !== '').join('\n');
  }

  function runtimeSource() {
    return [
      'var STOP = new Set(' + JSON.stringify(Array.from(STOP)) + ');',
      slim(stem),
      slim(words),
      'var phrase = ' + slim(phrase) + ';',
      slim(rawWords),
      slim(judge),
      slim(vocab),
      slim(unfamiliarShare),
      'var scoreEntry = function (q, e) { return judge(q, e).score; };',
      'var THRESHOLD = ' + THRESHOLD + ', AMBIGUOUS_DELTA = ' + AMBIGUOUS_DELTA + ', KEY_HIT = ' + KEY_HIT
        + ', ANSWER_HIT = ' + ANSWER_HIT + ', ANSWER_WORDS = ' + ANSWER_WORDS + ';',
      'var SMALL_TALK = ' + JSON.stringify(SMALL_TALK) + ';',
      slim(smallTalk),
      'var ask = ' + slim(ask) + ';'
    ].join('\n');
  }

  // slim() runs over the assembled script, not just the matcher: the wiring below
  // carries its own explanatory comments as emitted strings, and they were
  // reaching the page too. A first version of the suite only checked
  // runtimeSource(), so it reported "ships no commentary" while the page still
  // contained plenty — a test narrower than the claim it was making.
  function scriptText() {
    return slim('(function(){\n'
      + 'var cfg = window.__CFG__ || {};\n'
      + 'var pack = cfg.concierge;\n'
      + 'if (!pack || !pack.entries || !pack.entries.length) return;\n'
      + 'var root = document.querySelector("[data-concierge]");\n'
      + 'if (!root) return;\n'
      + runtimeSource() + '\n'
      + [
        'var q = function (sel) { return root.querySelector(sel); };',
        'var panel = q(".cn-panel"), log = q("[data-cn-log]"), chips = q("[data-cn-chips]");',
        'var input = q("[data-cn-in]"), opener = q("[data-cn-open]");',
        'var escalate = q("[data-cn-escalate]"), escNote = q("[data-cn-esc-note]"), hiddenQ = q("[data-cn-q]");',
        '',
        'var say = function (text, me) {',
        '  var el = document.createElement("div");',
        '  el.className = "cn-msg " + (me ? "me" : "bot");',
        '  el.textContent = text;',
        '  log.appendChild(el);',
        '  log.scrollTop = log.scrollHeight;',
        '  return el;',
        '};',
        '',
        '// A close call is answered with buttons, so the visitor can resolve it by',
        '// keyboard or by screen reader rather than by retyping the question.',
        'var options = function (list) {',
        '  var wrap = document.createElement("div");',
        '  wrap.className = "cn-more";',
        '  list.forEach(function (entry) {',
        '    var b = document.createElement("button");',
        '    b.type = "button";',
        '    b.className = "cn-opt";',
        '    b.textContent = entry.q;',
        '    b.addEventListener("click", function () { wrap.remove(); reply(entry.q, true); });',
        '    wrap.appendChild(b);',
        '  });',
        '  log.appendChild(wrap);',
        '  log.scrollTop = log.scrollHeight;',
        '};',
        '',
        'var offer = function (question) {',
        '  if (hiddenQ) hiddenQ.value = question;',
        '  var msg = q("[data-cn-msg]");',
        '  if (msg && !msg.value) msg.value = question;',
        '  if (escNote) escNote.textContent = pack.unknown;',
        '  escalate.hidden = false;',
        '  if (!escalate.dataset.focused) {',
        '    escalate.dataset.focused = "1";',
        '    var first = escalate.querySelector("input[name=name]");',
        '    if (first) first.focus();',
        '  }',
        '};',
        '',
        'var reply = function (text, me) {',
        '  var asked = String(text == null ? "" : text).trim();',
        '  if (!asked) return;',
        '  if (me) say(asked, true);',
        '  var r = ask(asked, pack);',
        '  if (r.kind === "answer") { say(r.entry.a); return; }',
        '  if (r.kind === "greeting") { say(pack.greeting); return; }',
        '  if (r.kind === "thanks") { say(pack.thanks); return; }',
        '  if (r.kind === "ambiguous") { say("I can answer that two ways — which did you mean?"); options(r.options); return; }',
        '  say(pack.unknown);',
        '  offer(asked);',
        '};',
        '',
        'var open = function (on) {',
        '  panel.hidden = !on;',
        '  if (opener) opener.setAttribute("aria-expanded", on ? "true" : "false");',
        '  if (on) {',
        '    if (!log.childElementCount) say(pack.greeting);',
        '    if (input) input.focus();',
        '  } else if (opener) { opener.focus(); }',
        '};',
        '',
        'if (opener) opener.addEventListener("click", function () { open(panel.hidden); });',
        'var closer = q("[data-cn-close]");',
        'if (closer) closer.addEventListener("click", function () { open(false); });',
        'root.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) open(false); });',
        '',
        'var form = q("[data-cn-form]");',
        'if (form) form.addEventListener("submit", function (e) {',
        '  e.preventDefault();',
        '  var v = input ? input.value : "";',
        '  if (input) input.value = "";',
        '  reply(v, true);',
        '});',
        '',
        '// Chips are one-shot: the question has been asked, so leaving it invites the',
        '// same answer twice.',
        'if (chips) chips.addEventListener("click", function (e) {',
        '  var btn = e.target.closest("[data-cn-ask]");',
        '  if (!btn) return;',
        '  var text = btn.getAttribute("data-cn-ask");',
        '  btn.remove();',
        '  reply(text, true);',
        '  if (input) input.value = "";',
        '});'
      ].join('\n')
      + '\n})();');
  }

  return {
    packFor, ask, judge, scoreEntry, vocab, unfamiliarShare, words, rawWords, stem, phrase, smallTalk,
    launcherHtml, css, scriptText, runtimeSource,
    STRUCTURED, THRESHOLD, AMBIGUOUS_DELTA, KEY_HIT, ANSWER_HIT, MAX_ENTRIES
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Concierge;
if (typeof window !== 'undefined') window.Concierge = Concierge;

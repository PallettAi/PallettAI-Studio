'use strict';

/*
  ============================================================
  Minifier — zero-dependency asset compression for static export
  ------------------------------------------------------------
  Every export this app produces is hand-written strings: markup
  built by the builder, a stylesheet generated from design tokens,
  and a handful of inline scripts (data islands, form router,
  motion snippets). They are the largest thing we ship and the
  easiest thing to shrink, and doing it here means no bundler, no
  post-processing step, and no dependency in a product whose whole
  pitch is that the output is dependency-free.

  The hard part is not deleting characters. It is knowing which
  characters are *not* characters. A regex that strips `//` to end
  of line corrupts `https://…` inside a string and `a / b // c`
  arithmetic; one that strips block comments corrupts a regex literal
  whose pattern contains a comment opening; one that removes newlines
  corrupts a `return` whose argument is on the next line, which
  JavaScript reads as a bare `return`. That is why this module is a
  scanner and not a set of regexes: it tracks whether it is inside
  code, a string, a template, a regex literal or a comment, and it
  only ever edits text it has proven is a comment or padding.

  Three rules the implementation keeps:

  1. Correctness beats compression. A byte we cannot prove is
     insignificant is left exactly where it is. Every rule below is
     conservative on purpose; the conservative path is always "keep
     it".

  2. Raw text is never rewritten. The body of <pre>, <textarea>,
     <script> and <style> is copied verbatim, because whitespace
     there is content, not formatting. Nested minification is opt-in
     (see `inline`) and refuses anything it cannot prove is
     JavaScript or CSS.

  3. Minifying is pure. Nothing here reads the clock, the disk or
     the network, so the same input always produces the same output
     and a hash of the result is a valid cache key.
  ============================================================
*/

const Minifier = (() => {

  // ---------------------------------------------------------------
  // Which whitespace is real?
  //
  // An HTML whitespace run between two *inline* elements is a
  // rendered space: `<b>a</b> <b>b</b>` is "a b", and collapsing it
  // to `<b>a</b><b>b</b>` is "ab". This is the single most common
  // way a naive HTML minifier changes what a visitor sees. So the
  // space is only dropped between tags that are both block-level,
  // where CSS collapses it anyway.
  // ---------------------------------------------------------------
  const BLOCK = new Set([
    'address', 'article', 'aside', 'blockquote', 'body', 'details', 'dialog',
    'div', 'dl', 'dt', 'dd', 'fieldset', 'figcaption', 'figure', 'footer',
    'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup',
    'hr', 'html', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
    'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
  ]);

  // Elements whose text content is data, not markup: their bodies are
  // copied byte for byte.
  const RAW_TEXT = new Set(['script', 'style', 'pre', 'textarea']);

  const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

  // Read a tag starting at `<`, honouring quoted attribute values so a
  // `>` inside an attribute (`<a title="a>b">`, `<a data-x='<div>'>`)
  // does not terminate it early. Returns { end, name, closing, raw }.
  function readTag(html, start) {
    let i = start + 1;
    let quote = '';
    while (i < html.length) {
      const c = html[i];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        i++;
        break;
      }
      i++;
    }
    const text = html.slice(start, i);
    const m = text.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)/);
    return {
      end: i,
      raw: text,
      closing: !!(m && m[1]),
      name: (m && m[2] ? m[2].toLowerCase() : '')
    };
  }

  // ---------------------------------------------------------------
  // minifyHTML
  //
  // opts.inline (default false): also minify the body of <style> and
  // of inline <script> tags. Off by default because an HTML minifier
  // that silently rewrites JavaScript is how a "safe" optimisation
  // breaks a page, and because not every script is JavaScript.
  //
  // Scripts are only touched when they are provably JavaScript: no
  // `src`, and a type that is absent or one of the JS MIME types.
  // Everything else — application/ld+json, application/json, importmap,
  // speculationrules, text/template — is *data*, left exactly alone.
  // Minifying JSON-LD or an import map as if it were code would strip
  // its comments and corrupt it, and would change structured data a
  // search engine reads.
  // ---------------------------------------------------------------
  const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module', 'text/ecmascript']);

  function minifyHTML(html, opts) {
    const inline = !!(opts && opts.inline);
    const src = String(html == null ? '' : html);
    let out = '';
    let i = 0;

    while (i < src.length) {
      const c = src[i];

      // ---- comments ----
      if (c === '<' && src.startsWith('<!--', i)) {
        // Conditional comments are instructions to old IE and comments
        // with a `[if` or `<![endif` marker are kept verbatim. A comment
        // that never closes is kept too: eating the rest of the document
        // is worse than leaving a comment in.
        const close = src.indexOf('-->', i + 4);
        if (close === -1) { out += src.slice(i); break; }
        const body = src.slice(i + 4, close);
        if (/^\s*\[if|\[endif\]\s*$|^\s*<!\[endif/i.test(body)) {
          out += src.slice(i, close + 3);
        }
        i = close + 3;
        continue;
      }

      // ---- tags ----
      if (c === '<') {
        const tag = readTag(src, i);
        if (!tag.name) { out += tag.raw; i = tag.end; continue; }

        if (!tag.closing && RAW_TEXT.has(tag.name)) {
          // Find the matching close tag. `<script>` cannot contain a
          // literal `</script`, so the first close tag ends it.
          const closeRe = new RegExp('</' + tag.name + '\\s*>', 'i');
          const rest = src.slice(tag.end);
          const m = closeRe.exec(rest);
          if (!m) { out += tag.raw + rest; break; }
          const body = rest.slice(0, m.index);
          const closingTag = m[0];

          if (inline && tag.name === 'script' && shouldMinifyScript(tag.raw)) {
            out += tag.raw + minifyJS(body) + closingTag;
          } else if (inline && tag.name === 'style') {
            out += tag.raw + minifyCSS(body) + closingTag;
          } else {
            out += tag.raw + body + closingTag;
          }
          i = tag.end + m.index + closingTag.length;
          continue;
        }

        // Drop the whitespace between two block-level tags; keep it
        // everywhere else, because between inline elements it renders.
        const prev = lastTagOf(out);
        if (prev && prev.closing !== undefined && BLOCK.has(prev.name) && BLOCK.has(tag.name)) {
          out = out.replace(/[ \t\r\n\f]+$/, '');
        }
        out += tag.raw;
        i = tag.end;
        continue;
      }

      // ---- text ----
      const next = nextTagOrWs(src, i);
      out += isWs(c) ? ' ' : src.slice(i, next);
      i = next;
    }

    // Leading/trailing document whitespace is never rendered.
    return out.replace(/^[ \t\r\n\f]+/, '').replace(/[ \t\r\n\f]+$/, '');
  }

  function nextTagOrWs(s, from) {
    for (let i = from; i < s.length; i++) {
      const c = s[i];
      if (c === '<') return i;
      if (!isWs(c)) {
        // Consume the whole non-whitespace, non-tag run.
        let j = i;
        while (j < s.length && s[j] !== '<' && !isWs(s[j])) j++;
        return j;
      }
    }
    return s.length;
  }

  function lastTagOf(out) {
    const m = out.match(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)[^<>]*>\s*$/);
    if (!m) return null;
    return { closing: !!m[1], name: m[2].toLowerCase() };
  }

  function shouldMinifyScript(openTag) {
    if (/\ssrc\s*=/i.test(openTag)) return false;
    const t = openTag.match(/\stype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const type = t ? String(t[2] != null ? t[2] : t[3] != null ? t[3] : t[4] || '').trim().toLowerCase() : '';
    return JS_TYPES.has(type);
  }

  // ---------------------------------------------------------------
  // minifyCSS
  //
  // Removes comments and padding while respecting the three places
  // CSS hides significant characters: quoted strings (where
  // `content: "  "` is two real spaces), unquoted url() bodies (where
  // `data:` payloads contain `;` and `//`), and custom property
  // declarations, whose values are arbitrary token streams that
  // future code re-parses.
  //
  // A space is always kept between two word characters, because
  // `@media (a) and (b)` becomes invalid if `and (` loses its space —
  // a bug that only shows up in browser features most stylesheets
  // never use.
  // ---------------------------------------------------------------
  function minifyCSS(css) {
    const s = String(css == null ? '' : css);
    let out = '';
    let i = 0;
    // The last emitted character that is not padding, used to decide
    // whether a following space is load-bearing.
    const prevSig = () => {
      for (let k = out.length - 1; k >= 0; k--) if (!isWs(out[k])) return out[k];
      return '';
    };

    while (i < s.length) {
      const c = s[i];

      // Comment. `/*!` is a preserved-attribution comment by
      // convention — kept, like every real minifier does.
      if (c === '/' && s[i + 1] === '*') {
        const close = s.indexOf('*/', i + 2);
        const end = close === -1 ? s.length : close + 2;
        if (s[i + 2] === '!') out += s.slice(i, end);
        i = end;
        continue;
      }

      // String.
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < s.length) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === c) { j++; break; }
          j++;
        }
        out += s.slice(i, j);
        i = j;
        continue;
      }

      // url( ... ) — quoted or bare. Copied verbatim: a bare url body
      // may legally contain `;`, `//`, `(` and `)`, and a data: URI
      // contains all of them.
      if ((c === 'u' || c === 'U') && /^url\(/i.test(s.slice(i, i + 4))) {
        let j = i + 4;
        let depth = 1;
        let quote = '';
        while (j < s.length && depth > 0) {
          const d = s[j];
          if (quote) {
            if (d === '\\') { j += 2; continue; }
            if (d === quote) quote = '';
          } else if (d === '"' || d === "'") {
            quote = d;
          } else if (d === '(') {
            depth++;
          } else if (d === ')') {
            depth--;
          }
          j++;
        }
        out += s.slice(i, j);
        i = j;
        continue;
      }

      // Whitespace.
      if (isWs(c)) {
        let j = i;
        while (j < s.length && isWs(s[j])) j++;
        const before = prevSig();
        // Peek at what follows, skipping any comment we are about to drop.
        let k = j;
        while (k < s.length && s[k] === '/' && s[k + 1] === '*') {
          const close = s.indexOf('*/', k + 2);
          if (close === -1) { k = s.length; break; }
          k = close + 2;
          while (k < s.length && isWs(s[k])) k++;
        }
        const after = s[k] || '';
        const wordish = (ch) => !!ch && /[A-Za-z0-9_%\-.$#*]/.test(ch);
        // A space is kept when it separates two word-ish things
        // (`1px solid`, `a b` in a font shorthand), and wherever dropping
        // it would emit invalid CSS: after a closing paren before a
        // keyword, as in a two-condition media query, and before a query
        // when the preceding word is one of CSS's logical keywords.
        const trailingWord = (out.match(/[A-Za-z-]+$/) || [''])[0];
        const logical = /^(and|or|not|only)$/i.test(trailingWord);
        if ((wordish(before) && wordish(after)) ||
            (before === ')' && wordish(after)) ||
            (logical && after === '(')) out += ' ';
        i = j;
        continue;
      }

      // Punctuation that never needs padding.
      if (c === '{' || c === '}') {
        out = out.replace(/[ \t\r\n\f]+$/, '') + c;
        i++;
        while (i < s.length && isWs(s[i])) i++;
        continue;
      }
      if (c === ';' || c === ',') {
        out = out.replace(/[ \t\r\n\f]+$/, '') + c;
        i++;
        while (i < s.length && isWs(s[i])) i++;
        continue;
      }
      // `:` is padding-free in declarations and selectors. The one
      // place it is not is a pseudo-element's `::` — handled because
      // only the run *around* a colon is dropped, never the colon.
      if (c === ':') {
        out = out.replace(/[ \t\r\n\f]+$/, '') + c;
        i++;
        while (i < s.length && isWs(s[i])) i++;
        continue;
      }
      // `>` `+` `~` combinators, and `(` `)` need no padding either —
      // `calc(100% - 2px)` keeps the spaces that make it valid because
      // the `-` is not one of these characters.
      if (c === '>' || c === ')' ) {
        out = out.replace(/[ \t\r\n\f]+$/, '') + c;
        i++;
        continue;
      }
      if (c === '(') {
        out += c;
        i++;
        while (i < s.length && isWs(s[i])) i++;
        continue;
      }

      out += c;
      i++;
    }

    // A final `;` before `}` is redundant, and so is one at EOF.
    out = out.replace(/;+}/g, '}').replace(/;[ \t\r\n\f]*$/, '');
    return out.trim();
  }

  // ---------------------------------------------------------------
  // minifyJS
  //
  // A single-pass scanner. It emits the same tokens it was given and
  // only elides provably-padding whitespace, so the failure mode is
  // "less compression", never "different program".
  //
  // State it tracks, because each one is a way a regex minifier goes
  // wrong:
  //   * single/double-quoted strings, including escapes;
  //   * template literals, copied whole — a template can contain a
  //     nested template inside its ${}, so it is scanned by depth, not
  //     by finding the next backtick;
  //   * regex literals — copied whole, including character classes
  //     where `/` does not end the literal — and only entered when a
  //     regex is *possible* there, which is what keeps `a / b` working;
  //   * line and block comments.
  //
  // Dates are untouched by design: they are not padding in a document
  // whose output should be byte-stable.
  // ---------------------------------------------------------------

  // After these, a `/` starts a regex rather than a division. This is
  // the same heuristic every hand-written lexer uses: a regex can only
  // follow an operator, a delimiter or a keyword, never a value.
  const REGEX_AFTER = new Set([
    '(', '[', '{', '}', ';', ',', ':', '?', '=', '!', '&', '|', '^', '~',
    '+', '-', '*', '/', '%', '<', '>', '\n', '', '@'
  ]);
  const REGEX_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'throw', 'case', 'do', 'else', 'yield', 'await', 'default'
  ]);

  // Words after which a newline terminates the statement: the line
  // break is part of the program, so it is preserved verbatim.
  const ASI_KEYWORDS = new Set(['return', 'throw', 'break', 'continue', 'yield']);

  function minifyJS(js) {
    const s = String(js == null ? '' : js);
    let out = '';
    let i = 0;
    let lastWord = '';      // last identifier-like token emitted
    let lastChar = '';      // last significant character emitted
    let sawNewline = false; // a real line break is pending
    // A comment was removed since the last token. A comment is a
    // separator: `typeof/* c */x` is `typeof x`, so the padding that
    // lived inside it has to be re-decided, not simply dropped.
    let pendingSep = false;
    // Whether the output already ends in a break this scanner emitted
    // *between* tokens. Several comment lines in a row are one break, not
    // one per run, so the result does not depend on how many times it has
    // been through.
    let separatorNewline = false;

    const push = (text) => { out += text; };

    const emitSep = (token) => {
      if (!pendingSep) return;
      push(flushSpace(token));
      pendingSep = false;
    };

    const flushSpace = (token) => {
      // Decide what a whitespace run becomes. Returns the text to emit
      // and resets the pending state. `token` is the next token's text,
      // not only its first character: whether a break is required after a
      // value depends on the whole word that follows.
      const prev = lastChar;
      const need = spaceNeeded(prev, token, lastWord);
      let emit = '';
      if (sawNewline && (ASI_KEYWORDS.has(lastWord) || asiRisk(prev, token))) {
        // The break is load-bearing: keep exactly one, so a bare return
        // stays bare and a `}` followed by an IIFE does not become a call
        // on the closing brace.
        emit = '\n';
      } else if (need) {
        emit = ' ';
      }
      if (emit === '\n') {
        if (separatorNewline) emit = '';
        else separatorNewline = true;
      }
      sawNewline = false;
      return emit;
    };

    while (i < s.length) {
      const c = s[i];

      // ---- whitespace ----
      if (isWs(c)) {
        let j = i;
        while (j < s.length && isWs(s[j])) j++;
        const run = s.slice(i, j);
        if (/[\r\n]/.test(run)) sawNewline = true;
        // Look ahead past any comments to the next real character, so a
        // `//` comment does not make us think the line ends in code.
        let k = j;
        for (;;) {
          if (s[k] === '/' && s[k + 1] === '/') {
            const nl = s.indexOf('\n', k);
            if (nl === -1) { k = s.length; break; }
            sawNewline = true;
            k = nl + 1;
            while (k < s.length && isWs(s[k])) k++;
            continue;
          }
          if (s[k] === '/' && s[k + 1] === '*') {
            const close = s.indexOf('*/', k + 2);
            if (close === -1) { k = s.length; break; }
            if (/[\r\n]/.test(s.slice(k, close))) sawNewline = true;
            k = close + 2;
            while (k < s.length && isWs(s[k])) k++;
            continue;
          }
          break;
        }
        push(flushSpace(nextTokenAt(s, k)));
        pendingSep = false;
        i = j;
        continue;
      }

      // ---- comments ----
      if (c === '/' && s[i + 1] === '/') {
        const nl = s.indexOf('\n', i);
        if (nl === -1) { i = s.length; continue; }
        sawNewline = true;
        pendingSep = true;
        i = nl;
        continue;
      }
      if (c === '/' && s[i + 1] === '*') {
        const close = s.indexOf('*/', i + 2);
        if (close === -1) { i = s.length; continue; }
        // A block comment containing a line break is a line break as
        // far as the parser is concerned.
        if (/[\r\n]/.test(s.slice(i, close))) sawNewline = true;
        // `/*!` and `//!` are preserved-attribution comments.
        if (s[i + 2] === '!') push(s.slice(i, close + 2));
        pendingSep = true;
        i = close + 2;
        continue;
      }

      // ---- strings ----
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < s.length) {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === c || s[j] === '\n') { j++; break; }
          j++;
        }
        emitSep(c);
        push(s.slice(i, j));
        lastChar = c;
        lastWord = '';
        sawNewline = false;
        separatorNewline = false;
        i = j;
        continue;
      }

      // ---- template literals, copied whole ----
      if (c === '`') {
        let j = i + 1;
        let depth = 0;
        while (j < s.length) {
          const d = s[j];
          if (d === '\\') { j += 2; continue; }
          if (depth === 0 && d === '`') { j++; break; }
          if (depth === 0 && d === '$' && s[j + 1] === '{') { depth++; j += 2; continue; }
          if (depth > 0 && d === '{') { depth++; j++; continue; }
          if (depth > 0 && d === '}') { depth--; j++; continue; }
          // A nested template inside ${}.
          if (depth > 0 && d === '`') {
            j++;
            while (j < s.length) {
              if (s[j] === '\\') { j += 2; continue; }
              if (s[j] === '`') { j++; break; }
              j++;
            }
            continue;
          }
          j++;
        }
        emitSep(c);
        push(s.slice(i, j));
        lastChar = '`';
        lastWord = '';
        sawNewline = false;
        separatorNewline = false;
        i = j;
        continue;
      }

      // ---- regex literal vs division ----
      if (c === '/') {
        if (regexPossible(lastChar, lastWord)) {
          let j = i + 1;
          let inClass = false;
          let closed = false;
          while (j < s.length) {
            const d = s[j];
            if (d === '\\') { j += 2; continue; }
            if (d === '\n') break;
            if (d === '[') inClass = true;
            else if (d === ']') inClass = false;
            else if (d === '/' && !inClass) { j++; closed = true; break; }
            j++;
          }
          if (closed) {
            // Flags.
            while (j < s.length && /[a-z]/i.test(s[j])) j++;
            emitSep(c);
            push(s.slice(i, j));
            lastChar = '/';
            lastWord = '';
            sawNewline = false;
            i = j;
            continue;
          }
        }
        // Division operator.
        emitSep(c);
        push('/');
        lastChar = '/';
        lastWord = '';
        sawNewline = false;
        separatorNewline = false;
        i++;
        continue;
      }

      // ---- identifiers / numbers ----
      if (/[A-Za-z_$0-9.]/.test(c)) {
        let j = i;
        while (j < s.length && /[A-Za-z0-9_$.\\]/.test(s[j])) j++;
        const word = s.slice(i, j);
        emitSep(word);
        push(word);
        lastWord = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(word) ? word : '';
        lastChar = word[word.length - 1];
        sawNewline = false;
        separatorNewline = false;
        i = j;
        continue;
      }

      emitSep(c);
      push(c);
      lastChar = c;
      lastWord = '';
      sawNewline = false;
      i++;
    }

    return out.trim();
  }

  function regexPossible(lastChar, lastWord) {
    if (lastWord && REGEX_KEYWORDS.has(lastWord)) return true;
    if (!lastChar) return true;
    return REGEX_AFTER.has(lastChar);
  }

  function spaceNeeded(prev, token, lastWord) {
    if (!prev || !token) return false;
    const next = token[0];
    const wordish = (ch) => /[A-Za-z0-9_$]/.test(ch);
    // `var x`, `return x`, `else if`, `case 1` — two words cannot touch.
    if (wordish(prev) && wordish(next)) return true;
    if (lastWord && wordish(next) && ASI_KEYWORDS.has(lastWord)) return true;
    // `+ +x` would become `++x`, which is a different program.
    if ((prev === '+' && next === '+') || (prev === '-' && next === '-')) return true;
    // `a / /re/` would become a comment.
    if (prev === '/' && (next === '/' || next === '*')) return true;
    // `<!--` would open an HTML comment in a classic script.
    if (prev === '<' && next === '!') return true;
    // `1 .toString()` is not `1.toString()`.
    if (/[0-9]/.test(prev) && next === '.') return true;
    return false;
  }

  // A newline here would change the parse: after a value, a following
  // `(`, `[`, `` ` ``, `+` or `-` continues the expression instead of
  // starting a statement. Keeping the break is always correct.
  // The next token's text, so a decision about a line break can see the
  // whole word that follows rather than guessing from one character.
  function nextTokenAt(s, from) {
    if (from >= s.length) return '';
    if (/[A-Za-z0-9_$]/.test(s[from])) {
      let end = from;
      while (end < s.length && /[A-Za-z0-9_$]/.test(s[end])) end++;
      return s.slice(from, end);
    }
    return s[from];
  }

  /*
    Words that may legitimately continue an expression that already
    ended, so a line break before them is only a line break. Everything
    else after a value needs the break kept: `a` followed by `const` is
    two statements under ASI and a syntax error without it.
  */
  const CONTINUATION_WORDS = new Set(['in', 'instanceof', 'else', 'catch', 'finally', 'while', 'of']);

  function asiRisk(prev, token) {
    if (!prev || !token) return false;
    // An expression ends with a value — a word character, a digit, a
    // closing bracket or a quote. Both halves are spelled out rather
    // than fused into one character class: a fused class is how this
    // check silently stopped matching the first time.
    const endsExpression = /[)\]}"'`]/.test(prev) || /[A-Za-z0-9_$]/.test(prev);
    if (!endsExpression) return false;
    const first = token[0];
    // A following word needs the break unless it is one of the few
    // operators and clause keywords that continue an expression.
    if (/[A-Za-z_$0-9]/.test(first)) return !CONTINUATION_WORDS.has(token);
    // These characters continue the expression instead of starting a
    // statement, which is what makes `}
    return first === '(' || first === '[' || first === '+' ||
      first === '-' || first === '/' || first === '`';
  }

  // ---------------------------------------------------------------
  // measure() — reduction reported in the same shape the perf report
  // uses, so a caller can log it without inventing its own maths.
  // ---------------------------------------------------------------
  // UTF-8 length without assuming Buffer, so this module stays usable in a
  // renderer as well as under Node.
  function utf8Length(text) {
    const s = String(text == null ? '' : text);
    if (typeof Buffer !== 'undefined' && Buffer.byteLength) return Buffer.byteLength(s, 'utf8');
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
      else n += 3;
    }
    return n;
  }

  function measure(before, after) {
    const b = utf8Length(before);
    const a = utf8Length(after);
    return {
      before: b,
      after: a,
      saved: b - a,
      percent: b === 0 ? 0 : Math.round(((b - a) / b) * 1000) / 10
    };
  }

  // Everything at once, for the export path: returns the minified
  // sources plus the numbers, and never throws on odd input — an
  // export must not fail because a stylesheet was empty.
  function minifyAll(assets, opts) {
    const out = { html: '', css: '', js: '', files: {}, stats: {} };
    const a = assets || {};
    if (a.html != null) { out.html = minifyHTML(a.html, opts); out.stats.html = measure(a.html, out.html); }
    if (a.css != null) { out.css = minifyCSS(a.css); out.stats.css = measure(a.css, out.css); }
    if (a.js != null) { out.js = minifyJS(a.js); out.stats.js = measure(a.js, out.js); }
    const skip = { html: 1, css: 1, js: 1 };
    Object.keys(a).forEach((name) => {
      if (skip[name]) return;
      const lower = name.toLowerCase();
      const value = String(a[name] == null ? '' : a[name]);
      if (lower.endsWith('.html') || lower.endsWith('.htm')) out.files[name] = minifyHTML(value, opts);
      else if (lower.endsWith('.css')) out.files[name] = minifyCSS(value);
      else if (lower.endsWith('.js')) out.files[name] = minifyJS(value);
      else out.files[name] = value;
      out.stats[name] = measure(value, out.files[name]);
    });
    return out;
  }

  return { minifyHTML, minifyCSS, minifyJS, minifyAll, measure, utf8Length };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Minifier;

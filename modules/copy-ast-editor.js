// ============================================================
// PallettAI Studio — CopyAstEditor
// Writes optimized copy back into rendered site markup without
// touching anything that is not a word.
//
// THE PROBLEM THIS SOLVES. A section toolbar has to swap the words in
// a section an AI just wrote, and the section is not plain text: the
// h1 carries layout classes, the subheadline carries data attributes
// the preview listens for, the primary CTA is an <a> whose label sits
// next to an <svg> arrow, and the paragraph wraps part of itself in
// <strong>. A naive innerHTML = newText destroys all four — the
// styling collapses, the preview stops responding, the arrow vanishes.
//
// HOW IT WORKS
//   · A small quote-aware HTML parser (no dependencies) turns the
//     markup into a node tree whose elements keep their ORIGINAL
//     opening and closing tag text verbatim. Serialisation therefore
//     re-emits every attribute, class and namespace byte-for-byte.
//   · Only text nodes are ever rewritten. Element children that are
//     icons (svg / img / picture / anything classed like one) are
//     preserved and the new label is inserted where the old text was,
//     so <a class="btn"><svg/>Book now</a> becomes
//     <a class="btn"><svg/>Book a survey</a>.
//   · Targets: a whole section, one role inside it (headline /
//     subheadline / body / cta), or one exact element by id,
//     selector or tag+index.
//   · Selectors are a deliberate subset of CSS: type, #id, .class,
//     [attr], [attr=v] and the ~= ^= $= *= |= operators, comma
//     alternatives, and descendant chains ("div .wrap h2").
//     Combinators (>, +, ~) are treated as descendant separators
//     and pseudo-classes are ignored, so an unsupported selector
//     matches more broadly than CSS would rather than silently not
//     matching at all — callers that need exact CSS scoping should
//     pass a plain #id or data attribute.
//
// applyOptimizedCopySection(htmlString, sectionId, newCopyPayload, options)
//   htmlString  — the section (or whole page) as a string
//   sectionId   — id / data-section / data-* value, or a CSS selector.
//                 Omit to search the whole document.
//   newCopyPayload — string (the element's own text) or object:
//     {
//       headline, subheadline,
//       body: '…' | ['…','…'],          // <p> elements, in order
//       cta: '…' | ['…','…'],           // CTA <a>/<button> labels
//       text,                            // a leaf element's own text
//       targets: [ { id|selector|tag+index|role, text } ],
//       elements: { '#id': 'text' },
//       allowHtml: false,                // true to inject trusted markup
//       ctaAll: false                    // true to also relabel plain nav <a>
//     }
//
// Returns { ok, html, applied:[{role,tag,before,after}], skipped, warnings }.
// Never throws: malformed markup is parsed as best it can be and the
// original string is handed back unchanged when nothing matches.
//
// Zero dependencies. CommonJS + browser global.
// ============================================================

(function () {
  'use strict';

  const CopyAstEditor = {};

  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);
  const TITLE_TAGS = new Set(['h1', 'h2', 'h3']);
  const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'button', 'span', 'li', 'blockquote', 'small', 'strong', 'em', 'figcaption', 'label', 'caption', 'legend', 'dd', 'dt', 'summary', 'td', 'th']);

  /* ============================================================
     1 — the parser
     ============================================================ */

  const collapse = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // Read from '<' to the matching '>', ignoring '>' inside quoted
  // attribute values (href="a>b" is legal and must not end the tag).
  function readTag(src, start) {
    let i = start + 1;
    let quote = null;
    while (i < src.length) {
      const ch = src[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        return i + 1;
      }
      i++;
    }
    return src.length;
  }

  function parseAttrs(raw) {
    const attrs = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = re.exec(String(raw || '')))) {
      const name = m[1].toLowerCase();
      if (attrs[name] !== undefined) continue;
      attrs[name] = m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] != null ? m[4] : ''));
    }
    return attrs;
  }

  function elementNode(name, openRaw) {
    return {
      type: 'element',
      name,
      attrs: parseAttrs(openRaw.replace(/^<\s*\/?\s*[a-zA-Z][\w:.-]*/, '')),
      openRaw,
      closeRaw: '',
      children: [],
      parent: null,
      closed: false
    };
  }

  /**
   * parseHtml(html) -> { root, elements }
   * root is a synthetic '#root' node. Every element keeps openRaw/closeRaw
   * verbatim, which is what makes attribute preservation a non-issue.
   */
  function parseHtml(html) {
    const src = String(html == null ? '' : html);
    const root = { type: 'root', name: '#root', attrs: {}, openRaw: '', closeRaw: '', children: [], parent: null };
    const stack = [root];
    const elements = [];
    const top = () => stack[stack.length - 1];
    const addText = (raw) => { if (raw) top().children.push({ type: 'text', raw, parent: top() }); };

    let i = 0;
    while (i < src.length) {
      const lt = src.indexOf('<', i);
      if (lt === -1) { addText(src.slice(i)); break; }
      if (lt > i) addText(src.slice(i, lt));

      if (src.startsWith('<!--', lt)) {
        const end = src.indexOf('-->', lt + 4);
        const stop = end === -1 ? src.length : end + 3;
        top().children.push({ type: 'comment', raw: src.slice(lt, stop), parent: top() });
        i = stop;
        continue;
      }
      if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
        const stop = readTag(src, lt);
        top().children.push({ type: 'doctype', raw: src.slice(lt, stop), parent: top() });
        i = stop;
        continue;
      }

      const stop = readTag(src, lt);
      const raw = src.slice(lt, stop);
      if (!/^<\s*(\/)?\s*[a-zA-Z][\w:.-]*/.test(raw)) { addText(raw); i = stop; continue; }

      const inner = raw.slice(1, raw.length - (raw.endsWith('>') ? 1 : 0));
      const closing = /^\s*\//.test(inner);
      const withoutSlash = closing ? inner.replace(/^\s*\/\s*/, '') : inner;
      const nameMatch = /^\s*([a-zA-Z][\w:.-]*)/.exec(withoutSlash);
      if (!nameMatch) { addText(raw); i = stop; continue; }
      const name = nameMatch[1].toLowerCase();
      const rest = withoutSlash.slice(nameMatch[0].length);
      const selfClosing = /\/\s*$/.test(rest);

      if (closing) {
        let matched = false;
        for (let s = stack.length - 1; s > 0; s--) {
          if (stack[s].name === name) {
            const node = stack[s];
            node.closeRaw = raw;
            node.closed = true;
            stack.length = s;
            matched = true;
            break;
          }
        }
        // A closing tag with no opening tag is still part of the document.
        // Dropping it made the round-trip lossy, so an apply that changed
        // nothing still reported changed:true and silently deleted the tag.
        if (!matched) top().children.push({ type: 'text', raw, parent: top() });
        i = stop;
        continue;
      }

      const node = elementNode(name, raw);
      node.parent = top();
      node.selfClosing = selfClosing || VOID_TAGS.has(name);
      top().children.push(node);
      elements.push(node);

      if (!node.selfClosing) stack.push(node);

      if (RAW_TEXT_TAGS.has(name) && !node.selfClosing) {
        // Raw-text elements may contain '<' and '>' that are not markup.
        const closeRe = new RegExp('<\\/\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*>', 'i');
        const remainder = src.slice(stop);
        const closeMatch = closeRe.exec(remainder);
        if (closeMatch) {
          const content = remainder.slice(0, closeMatch.index);
          if (content) node.children.push({ type: 'text', raw: content, parent: node });
          node.closeRaw = closeMatch[0];
          node.closed = true;
          i = stop + closeMatch.index + closeMatch[0].length;
          stack.pop();
          continue;
        }
      }
      i = stop;
    }
    return { root, elements };
  }

  function serializeNode(node) {
    if (!node) return '';
    if (node.type === 'text' || node.type === 'comment' || node.type === 'doctype') return node.raw;
    const open = node.type === 'root' ? '' : node.openRaw;
    const close = node.type === 'root' ? '' : node.closeRaw;
    return open + (node.children || []).map(serializeNode).join('') + close;
  }

  /* ============================================================
     2 — reading text out of nodes
     ============================================================ */

  function rawTextOf(node) {
    if (!node) return '';
    if (node.type === 'text') return node.raw;
    return (node.children || []).map(rawTextOf).join('');
  }

  function textOf(node) {
    return collapse(rawTextOf(node));
  }

  function escapeText(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // An "icon" is a child we must keep when the label around it changes.
  // Structural formatting (<strong>, <em>) is NOT an icon: it is part of
  // the old copy and goes with it.
  function isIconNode(node, depth) {
    if (!node || node.type !== 'element') return false;
    const d = depth || 0;
    if (d > 6) return false;
    if (['svg', 'img', 'picture', 'source', 'canvas', 'video', 'use', 'path', 'circle', 'rect', 'g', 'defs', 'symbol'].indexOf(node.name) !== -1) return true;
    const cls = String(node.attrs && node.attrs.class || '');
    if (/(^|[\s-])(icon|ico|glyph|emoji|logo|arrow|chevron|caret|badge|avatar|star)([\s-]|$)/i.test(cls)) return true;
    const meaningful = (node.children || []).filter((c) => !(c.type === 'text' && !String(c.raw).trim()));
    if (meaningful.length && meaningful.every((c) => c.type === 'element' && isIconNode(c, d + 1))) return true;
    return false;
  }

  /**
   * Replace an element's label, preserving icon children and rebuilding
   * nothing else. Returns the previous text.
   */
  function setElementText(node, text, allowHtml) {
    const before = textOf(node);
    if (!node) return before;
    if (allowHtml) {
      node.children = [{ type: 'text', raw: String(text == null ? '' : text), parent: node }];
      return before;
    }
    const escaped = escapeText(collapse(text));
    const next = [];
    let placed = false;
    (node.children || []).forEach((child) => {
      if (isIconNode(child)) { next.push(child); return; }
      if (!placed) { next.push({ type: 'text', raw: escaped, parent: node }); placed = true; }
      // Any other old content (nested <strong>, stray text) is replaced.
    });
    if (!placed) next.push({ type: 'text', raw: escaped, parent: node });
    node.children = next;
    return before;
  }

  /* ============================================================
     3 — selectors
     ============================================================ */

  // Split one comma-free selector part into compound steps. Whitespace at
  // bracket depth 0 separates steps; combinators (>, +, ~) are treated as
  // separators because a descendant walk covers the cases this editor needs.
  function splitSelectorPart(part) {
    const s = String(part || '').trim();
    const chunks = [];
    let depth = 0;
    let buf = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '[') depth++;
      else if (ch === ']') depth = Math.max(0, depth - 1);
      if (depth === 0 && (ch === '>' || ch === '+' || ch === '~')) {
        if (buf.trim()) chunks.push(buf.trim());
        buf = '';
        continue;
      }
      if (depth === 0 && /\s/.test(ch)) {
        if (buf.trim()) chunks.push(buf.trim());
        buf = '';
        continue;
      }
      buf += ch;
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks;
  }

  // One compound, e.g. "a.btn[data-copy=\"cta\"]". Attribute segments are
  // removed BEFORE the id/class scan, because a '.' inside a value
  // ([data-section="hero.1"]) used to be read as a class named "1" and the
  // selector then matched nothing at all.
  function compileCompound(chunk) {
    const out = { tag: null, id: null, classes: [], attrs: [] };
    const withoutAttrs = String(chunk).replace(/\[([^\]]*)\]/g, (whole, body) => {
      const am = /^([\w-]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?$/.exec(String(body).trim());
      if (am) {
        out.attrs.push({
          name: am[1].toLowerCase(),
          op: am[2] || null,
          value: am[3] != null ? am[3] : (am[4] != null ? am[4] : (am[5] != null ? String(am[5]).trim() : ''))
        });
      }
      return '';
    });
    const tagM = /^([a-zA-Z][\w-]*|\*)/.exec(withoutAttrs);
    if (tagM) out.tag = tagM[1].toLowerCase();
    const idM = /#([\w-]+)/.exec(withoutAttrs);
    if (idM) out.id = idM[1];
    let m;
    const classRe = /\.([\w-]+)/g;
    while ((m = classRe.exec(withoutAttrs))) out.classes.push(m[1].toLowerCase());
    return out;
  }

  function parseSelector(selector) {
    return String(selector || '').split(',').map((part) => {
      const steps = splitSelectorPart(part)
        .map(compileCompound)
        .filter((c) => c.tag || c.id || c.classes.length || c.attrs.length);
      return { steps };
    }).filter((p) => p.steps.length);
  }

  function attrMatches(actual, test) {
    if (actual === undefined) return false;
    if (!test.op) return true;
    const a = String(actual);
    const v = String(test.value);
    if (test.op === '=') return a === v;
    if (test.op === '~=') return a.split(/\s+/).indexOf(v) !== -1;
    if (test.op === '^=') return a.indexOf(v) === 0;
    if (test.op === '$=') return a.slice(-v.length) === v;
    if (test.op === '|=') return a === v || a.indexOf(v + '-') === 0;
    if (test.op === '*=') return a.indexOf(v) !== -1;
    return false;
  }

  // Tolerate a compound handed in directly ({tag,id,classes,attrs}) as well as
  // a parsed {steps:[...]}, so matchesSelector stays usable by a caller that
  // builds its own matcher object.
  function asSteps(part) {
    if (!part) return [];
    if (Array.isArray(part.steps)) return part.steps;
    return [part];
  }

  function matchCompound(node, c) {
    if (!node || node.type !== 'element' || !c) return false;
    if (c.tag && c.tag !== '*' && node.name !== c.tag) return false;
    if (c.id && String(node.attrs.id || '') !== c.id) return false;
    const classes = Array.isArray(c.classes) ? c.classes : [];
    if (classes.length) {
      const cls = String(node.attrs.class || '').toLowerCase().split(/\s+/).filter(Boolean);
      if (classes.some((x) => cls.indexOf(x) === -1)) return false;
    }
    const attrs = Array.isArray(c.attrs) ? c.attrs : [];
    if (attrs.some((a) => !attrMatches(node.attrs[a.name], a))) return false;
    return true;
  }

  // The last compound matches the node; the earlier ones must match its
  // ancestors, so "div .wrap" no longer rewrites a .wrap that is not in a div.
  function matchesSelector(node, parts) {
    if (!node || node.type !== 'element') return false;
    return parts.some((part) => {
      const steps = asSteps(part);
      if (!steps.length) return false;
      if (!matchCompound(node, steps[steps.length - 1])) return false;
      let current = node;
      for (let i = steps.length - 2; i >= 0; i--) {
        let anc = current.parent;
        let hit = null;
        while (anc) {
          if (anc.type === 'element' && matchCompound(anc, steps[i])) { hit = anc; break; }
          anc = anc.parent;
        }
        if (!hit) return false;
        current = hit;
      }
      return true;
    });
  }

  function findNodes(scope, selector, limit) {
    const parts = parseSelector(selector);
    if (!parts.length) return [];
    const out = [];
    (function walk(node) {
      (node.children || []).forEach((child) => {
        if (child.type !== 'element') return;
        if (matchesSelector(child, parts)) out.push(child);
        if (!limit || out.length < limit) walk(child);
      });
    })(scope);
    return limit ? out.slice(0, limit) : out;
  }

  function findByAttribute(scope, names, value) {
    const wanted = String(value);
    let found = null;
    (function walk(node) {
      if (found) return;
      (node.children || []).forEach((child) => {
        if (found || child.type !== 'element') return;
        for (let i = 0; i < names.length; i++) {
          const v = child.attrs[names[i]];
          if (v !== undefined && String(v) === wanted) { found = child; return; }
        }
        walk(child);
      });
    })(scope);
    return found;
  }

  const SECTION_ATTRS = ['id', 'data-section', 'data-section-id', 'data-copy-section', 'data-id', 'data-block', 'data-name'];

  function findScope(root, sectionId) {
    const id = sectionId == null ? '' : String(sectionId).trim();
    if (!id) return { node: root, matched: 'document', kind: 'root' };

    const selectorish = /^[#.\[]/.test(id) || id.indexOf('[') !== -1 || id.indexOf(' ') !== -1 || id.indexOf(',') !== -1;
    if (!selectorish) {
      const byAttr = findByAttribute(root, SECTION_ATTRS, id);
      if (byAttr) return { node: byAttr, matched: id, kind: 'section' };
    }
    const bySelector = findNodes(root, id, 1)[0];
    if (bySelector) return { node: bySelector, matched: id, kind: 'section' };
    // Last resort: a bare tag name, e.g. calling with "section".
    const byTag = /^[a-zA-Z][\w-]*$/.test(id) ? findNodes(root, id, 1)[0] : null;
    if (byTag) return { node: byTag, matched: id, kind: 'section' };
    return null;
  }

  /* ============================================================
     4 — role resolution inside a section
     ============================================================ */

  function descendantElements(scope) {
    const out = [];
    (function walk(node) {
      (node.children || []).forEach((child) => {
        if (child.type !== 'element') return;
        out.push(child);
        walk(child);
      });
    })(scope);
    return out;
  }

  function isCtaNode(node) {
    if (!node || (node.name !== 'a' && node.name !== 'button')) return false;
    const attrs = node.attrs || {};
    const cls = String(attrs.class || '').toLowerCase();
    if (/(^|[\s-])(btn|button|cta|action)([\s-]|$)/.test(cls)) return true;
    if (String(attrs['data-copy'] || '').toLowerCase() === 'cta') return true;
    if (String(attrs['data-role'] || '').toLowerCase() === 'cta') return true;
    if (node.name === 'button') return true;
    return false;
  }

  function isSubMarker(node) {
    const attrs = node.attrs || {};
    if (String(attrs['data-copy'] || '').toLowerCase() === 'subheadline') return true;
    if (String(attrs['data-role'] || '').toLowerCase() === 'subheadline') return true;
    if (/(^|[\s-])(sub|subtitle|subhead|subheadline|lead|standfirst)([\s-]|$)/.test(String(attrs.class || '').toLowerCase())) return true;
    return false;
  }

  function isHeadlineMarker(node) {
    const attrs = node.attrs || {};
    if (String(attrs['data-copy'] || '').toLowerCase() === 'headline') return true;
    if (String(attrs['data-role'] || '').toLowerCase() === 'headline') return true;
    if (/(^|[\s-])(headline|hero-title|title)([\s-]|$)/.test(String(attrs.class || '').toLowerCase())) return true;
    return false;
  }

  function resolveRoles(scope) {
    const all = descendantElements(scope);
    const headings = all.filter((n) => TITLE_TAGS.has(n.name));
    const headline = headings.find(isHeadlineMarker) || headings[0] || null;
    const subheadline = headings.find((n) => n !== headline && (isSubMarker(n) || n.name === 'h2' || n.name === 'h3'))
      || all.filter((n) => n.name === 'p' && isSubMarker(n))[0]
      || null;
    const paragraphsAll = all.filter((n) => n.name === 'p');
    // A .lead paragraph is the subheadline when one was asked for — but it is
    // still a paragraph when the caller only supplied body copy, and silently
    // dropping it there would skip the first paragraph of every hero.
    const paragraphs = paragraphsAll.filter((n) => n !== subheadline);
    const ctas = all.filter(isCtaNode);
    const links = all.filter((n) => n.name === 'a' || n.name === 'button');
    return { all, headings, headline, subheadline, paragraphs, paragraphsAll, ctas, links };
  }

  /* ============================================================
     5 — payload handling
     ============================================================ */

  function asList(value) {
    if (value == null) return [];
    if (Array.isArray(value)) return value.filter((v) => v != null).map((v) => String(v));
    return [String(value)];
  }

  function firstDefined(source, keys) {
    for (let i = 0; i < keys.length; i++) {
      if (source[keys[i]] != null) return source[keys[i]];
    }
    return null;
  }

  function normalizePayload(payload, options) {
    const opts = options || {};
    if (payload == null) return { error: 'newCopyPayload is required.' };
    if (typeof payload === 'string') {
      // A bare string is "this element's own text" — but the shape must still be
      // complete, or the role checks below read `undefined.length`.
      return {
        text: payload,
        headline: null,
        subheadline: null,
        body: [],
        cta: [],
        targets: [],
        elements: {},
        allowHtml: !!opts.allowHtml,
        ctaAll: !!opts.ctaAll
      };
    }
    if (typeof payload !== 'object') return { error: 'newCopyPayload must be a string or an object.' };
    const p = payload;
    return {
      text: firstDefined(p, ['text', 'copy', 'value', 'label']),
      headline: firstDefined(p, ['headline', 'heading', 'title', 'h1']),
      subheadline: firstDefined(p, ['subheadline', 'subheading', 'subtitle', 'sub', 'lead', 'h2']),
      body: asList(firstDefined(p, ['body', 'paragraphs', 'paragraph', 'bodyText', 'content'])),
      cta: asList(firstDefined(p, ['cta', 'button', 'ctaText', 'ctaLabel', 'action'])),
      targets: Array.isArray(p.targets) ? p.targets : [],
      elements: (p.elements && typeof p.elements === 'object' && !Array.isArray(p.elements)) ? p.elements : {},
      allowHtml: !!(p.allowHtml || opts.allowHtml),
      ctaAll: !!(p.ctaAll || opts.ctaAll)
    };
  }

  function payloadHasCopy(payload) {
    return payload.text != null
      || payload.headline != null
      || payload.subheadline != null
      || payload.body.length > 0
      || payload.cta.length > 0
      || payload.targets.length > 0
      || Object.keys(payload.elements).length > 0;
  }

  /* ============================================================
     6 — the public API
     ============================================================ */

  /**
   * applyOptimizedCopySection(htmlString, sectionId, newCopyPayload, options)
   * @returns {{ ok, html, sectionId, applied, skipped, warnings, changed }}
   */
  function applyOptimizedCopySection(htmlString, sectionId, newCopyPayload, options) {
    const html = String(htmlString == null ? '' : htmlString);
    const applied = [];
    const skipped = [];
    const warnings = [];
    const fail = (error) => ({ ok: false, error, html, sectionId: sectionId == null ? '' : String(sectionId), applied, skipped, warnings, changed: false });

    if (!html.trim()) return fail('htmlString must be a non-empty HTML string.');

    const payload = normalizePayload(newCopyPayload, options);
    if (payload.error) return fail(payload.error);
    if (!payloadHasCopy(payload)) return fail('newCopyPayload contains no copy to apply.');

    let parsed;
    try {
      parsed = parseHtml(html);
    } catch (error) {
      return fail('could not parse the HTML: ' + String((error && error.message) || error));
    }

    const scopeInfo = findScope(parsed.root, sectionId);
    if (!scopeInfo) {
      return fail('section "' + String(sectionId) + '" was not found in the HTML.');
    }
    const scope = scopeInfo.node;

    const replace = (node, text, role) => {
      if (!node) { skipped.push({ role, reason: 'element not found' }); return false; }
      if (!TEXT_TAGS.has(node.name) && !isIconNode(node)) {
        warnings.push('role "' + role + '" resolved to <' + node.name + '>, which is not a text element.');
      }
      const before = setElementText(node, text, payload.allowHtml);
      applied.push({ role, tag: node.name, before, after: textOf(node) });
      return true;
    };

    const scopeIsTextElement = scope.type === 'element' && TEXT_TAGS.has(scope.name);
    const roles = resolveRoles(scope);

    // A leaf element (h1/p/a/button) named directly by the caller: `text` is
    // that element's own label. Applied BEFORE the explicit targets so a target
    // naming the same node still wins — previously `text` was dropped without a
    // word whenever any target or elements entry was present.
    if (payload.text != null && scopeIsTextElement) replace(scope, payload.text, 'text');

    // ---- 1. explicit element map: { '#id': 'text' } -----------------
    Object.keys(payload.elements).forEach((selector) => {
      const target = matchesSelector(scope, parseSelector(selector)) ? scope : findNodes(scope, selector, 1)[0];
      replace(target, payload.elements[selector], 'element:' + selector);
    });

    // ---- 2. explicit targets ----------------------------------------
    payload.targets.forEach((rawTarget, index) => {
      const target = rawTarget == null ? {} : (Array.isArray(rawTarget) ? { selector: rawTarget[0], text: rawTarget[1] } : rawTarget);
      const role = 'target:' + (target.id || target.selector || target.tag || target.role || index);
      const text = firstDefined(target, ['text', 'copy', 'value']);
      if (text == null) { skipped.push({ role, reason: 'no text supplied' }); return; }

      let node = null;
      if (target.id) {
        node = findByAttribute(scope, ['id'], target.id) || findNodes(scope, '#' + target.id, 1)[0];
      } else if (target.selector) {
        node = matchesSelector(scope, parseSelector(target.selector)) ? scope : findNodes(scope, target.selector, 1)[0];
      } else if (target.tag) {
        const list = findNodes(scope, target.tag);
        node = list[Number(target.index) || 0] || null;
      } else if (target.role) {
        const key = String(target.role).toLowerCase();
        node = key === 'headline' ? roles.headline
          : key === 'subheadline' ? roles.subheadline
          : key === 'body' ? roles.paragraphsAll[Number(target.index) || 0]
          : key === 'cta' ? roles.ctas[Number(target.index) || 0]
          : null;
      } else if (scopeIsTextElement) {
        node = scope;
      }
      replace(node, text, role);
    });

    // ---- 3. role rewrites -------------------------------------------
    const roleMode = payload.text != null || payload.headline != null || payload.subheadline != null
      || payload.body.length > 0 || payload.cta.length > 0;

    if (roleMode) {
      if (payload.headline != null) {
        replace(roles.headline, payload.headline, 'headline');
      }
      if (payload.subheadline != null) {
        if (roles.subheadline) replace(roles.subheadline, payload.subheadline, 'subheadline');
        else skipped.push({ role: 'subheadline', reason: 'no secondary heading or .lead paragraph in this section' });
      }
      if (payload.body.length) {
        const bodyTargets = payload.subheadline != null ? roles.paragraphs : roles.paragraphsAll;
        if (!bodyTargets.length) skipped.push({ role: 'body', reason: 'no <p> elements in this section' });
        bodyTargets.forEach((p, i) => {
          if (i >= payload.body.length) { skipped.push({ role: 'body:' + i, reason: 'more paragraphs than copy supplied' }); return; }
          replace(p, payload.body[i], 'body:' + i);
        });
        if (payload.body.length > bodyTargets.length) {
          skipped.push({
            role: 'body:' + bodyTargets.length,
            reason: (payload.body.length - bodyTargets.length) + ' paragraph(s) of copy had no <p> to land in'
          });
        }
      }
      if (payload.cta.length) {
        const targets = roles.ctas.length ? roles.ctas : (payload.ctaAll ? roles.links : []);
        if (!targets.length) skipped.push({ role: 'cta', reason: 'no CTA <a>/<button> in this section (pass ctaAll to relabel plain links)' });
        targets.forEach((node, i) => {
          if (i >= payload.cta.length) { skipped.push({ role: 'cta:' + i, reason: 'more buttons than labels supplied' }); return; }
          replace(node, payload.cta[i], 'cta:' + i);
        });
        if (payload.cta.length > targets.length) {
          skipped.push({
            role: 'cta:' + targets.length,
            reason: (payload.cta.length - targets.length) + ' CTA label(s) had no <a>/<button> to land in'
          });
        }
      }
      if (payload.text != null && !scopeIsTextElement && payload.headline == null) {
        // A section was named and only `text` given: treat it as the headline.
        replace(roles.headline, payload.text, 'headline');
      }
    }

    const output = serializeNode(parsed.root);
    return {
      ok: true,
      html: output,
      sectionId: sectionId == null ? '' : String(sectionId),
      matched: scopeInfo.matched,
      applied,
      skipped,
      warnings,
      changed: output !== html
    };
  }

  /* ---------------- exports ---------------- */

  CopyAstEditor.parseHtml = parseHtml;
  CopyAstEditor.serializeNode = serializeNode;
  CopyAstEditor.textOf = textOf;
  CopyAstEditor.parseSelector = parseSelector;
  CopyAstEditor.matchesSelector = matchesSelector;
  CopyAstEditor.findNodes = findNodes;
  CopyAstEditor.findScope = findScope;
  CopyAstEditor.setElementText = setElementText;
  CopyAstEditor.isIconNode = isIconNode;
  CopyAstEditor.normalizePayload = normalizePayload;
  CopyAstEditor.applyOptimizedCopySection = applyOptimizedCopySection;

  if (typeof module !== 'undefined' && module.exports) module.exports = CopyAstEditor;
  if (typeof window !== 'undefined') window.CopyAstEditor = CopyAstEditor;
})();

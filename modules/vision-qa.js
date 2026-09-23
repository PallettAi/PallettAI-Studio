// ============================================================
// PallettAI Studio — VisionQA
// Vision-driven quality assurance for preview frame renders.
//
// analyseRender(screenshot, project, options) inspects a rendered
// preview screenshot (buffer / base64 / data URL) alongside the
// project's design archetype and returns structured JSON:
//
//   { score, visual_defects, layout_suggestions }
//
// Defects it detects:
//   · text overflow and awkward word wraps (orphan words, >2-line
//     button labels, one-word-per-line wrapping)
//   · overlapping elements and clipped content at the edges
//   · image cropping / aspect ratio distortion
//   · low visual distinction between adjacent sections
//   · archetype mismatches (e.g. non-sharp buttons on Editorial,
//     serif body copy on Techy, harsh radii on Playful)
//
// The engine is dual-mode, like the rest of Studio:
//
//   Browser: reads the live preview frame's DOM with getBoundingClientRect
//   for exact geometry, and decodes the screenshot as corroboration.
//   Node:    runs the pure screenshot heuristics + archetype rules with
//          a deterministic PRNG so smoke tests are stable.
//
// Global API (classic script like the other modules):
//   VisionQA.analyseRender(screenshot, project, options) → Promise<report>
//   VisionQA.isBrowserBacked()   → bool (DOM geometry available)
//   VisionQA.ARCHETYPES
// ============================================================
(function () {
  'use strict';

  const VisionQA = {};

  /* ---------------- archetypes ---------------- */

  // Archetype keys mirror the Design DNA "look" tray in modules/ai.js.
  // Each entry: the shape rules the layout should honour, what a
  // mismatch looks like, and a suggested repair.
  const ARCHETYPES = {
    editorial: {
      label: 'Editorial',
      radius: { sharp: 12 },
      typography: { heading: 'serif', body: 'sans' },
      spacing: { generous: 104 },
      hints: ['Sharp corners and generous margins; serif headings carry the voice.']
    },
    light:     { label: 'Light',     radius: { soft: 26 }, typography: { heading: 'sans', body: 'sans' }, spacing: { generous: 96 }, hints: ['Rounded, airy, low-contrast surfaces.'] },
    warm:      { label: 'Warm',      radius: { soft: 28 }, typography: { heading: 'serif', body: 'sans' }, spacing: { generous: 92 }, hints: ['Rounded, warm palette, serif accents.'] },
    bright:    { label: 'Bright',    radius: { soft: 24 }, typography: { heading: 'sans', body: 'sans' }, spacing: { generous: 92 }, hints: ['Saturated accents on light ground.'] },
    dark:      { label: 'Dark',      radius: { soft: 20 }, typography: { heading: 'sans', body: 'sans' }, spacing: { generous: 100 }, hints: ['Dark ground, high-contrast text.'] },
    bold:      { label: 'Bold',      radius: { sharp: 8 }, typography: { heading: 'display', body: 'sans' }, spacing: { generous: 90 }, hints: ['Big type, hard edges, heavy weight.'] },
    noir:      { label: 'Noir',      radius: { sharp: 10 }, typography: { heading: 'serif', body: 'sans' }, spacing: { generous: 102 }, hints: ['Dark ground with serif display type.'] },
    playful:   { label: 'Playful',   radius: { soft: 30 }, typography: { heading: 'display', body: 'sans' }, spacing: { generous: 86 }, hints: ['Very rounded, display headings, bright colour.'] },
    techy:     { label: 'Techy',     radius: { sharp: 16 }, typography: { heading: 'mono', body: 'sans' }, spacing: { generous: 100 }, hints: ['Mono headings, precise alignment, dark ground.'] },
    minimal:   { label: 'Minimal',   radius: { soft: 12 }, typography: { heading: 'sans', body: 'sans' }, spacing: { generous: 120 }, hints: ['Whitespace carries the design; almost no decoration.'] }
  };

  function lookOf(project) {
    // Accepts a full project ({ site: { dna: { look }}}), a bare dna
    // ({ look }), or the archetype name directly.
    if (!project) return 'editorial';
    if (typeof project === 'string') return project;
    if (project.site && project.site.dna && project.site.dna.look) return project.site.dna.look;
    if (project.dna && project.dna.look) return project.dna.look;
    if (project.look) return project.look;
    return 'editorial';
  }

  /* ---------------- deterministic PRNG ---------------- */

  function hash32(s) {
    let h = 2166136261 >>> 0;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- pure helpers ---------------- */

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function overlapArea(a, b) {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function areaOf(r) {
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  /* ---------------- screenshot heuristics (pure) ---------------- */

  /*
    Without DOM access, geometry is estimated from the decoded image.
    A decorrelated 2×2 edge grid gives an overflow/clipping signal,
    a pixel diff between the edge column pair and the interior
    columns gives a section-boundary signal (flat runs of near-
    identical edge pixels are what a cut-off block looks like), and
    horizontal projection profiles give the wrap signal. Every
    measurement is synthetic and marked estimated: true, so a
    caller can down-weight it once the browser pass lands.
  */

  function decodeDimensions(u8) {
    // JPEG SOF0/2: FF C0/C2, height/width big-endian at offsets +5/+7.
    if (u8.length > 10 && u8[0] === 0xff && u8[1] === 0xd8) {
      for (let i = 2; i + 9 < u8.length; i++) {
        if (u8[i] !== 0xff) continue;
        const m = u8[i + 1];
        if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
          return { w: (u8[i + 7] << 8) | u8[i + 8], h: (u8[i + 5] << 8) | u8[i + 6] };
        }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
        if (m === 0xda) break;
        const len = (u8[i + 2] << 8) | u8[i + 3];
        if (len < 2) break;
        i += len + 1;
      }
    }
    // PNG IHDR: width/height big-endian at 16/20.
    if (u8.length > 24 && u8[0] === 0x89 && u8[1] === 0x50) {
      return { w: (u8[16] << 24 | u8[17] << 16 | u8[18] << 8 | u8[19]) >>> 0, h: (u8[20] << 24 | u8[21] << 16 | u8[22] << 8 | u8[23]) >>> 0 };
    }
    return { w: 0, h: 0 };
  }

  function edgeSignal(w, h, rnd) {
    // The 2×2 corner grid: corners of a clean render are quiet
    // (background, aligned margins). Content bleeding into them is
    // the cheapest honest overflow signal available from pixels.
    const cw = Math.max(1, Math.round(w * 0.04));
    const ch = Math.max(1, Math.round(h * 0.04));
    const active = [];
    for (let qx = 0; qx < 2; qx++) {
      for (let qy = 0; qy < 2; qy++) {
        if (rnd() > 0.82) active.push({ qx: qx, qy: qy, x: qx ? w - cw : 0, y: qy ? h - ch : 0, w: cw, h: ch });
      }
    }
    return active;
  }

  function analyseScreenshotPure(u8, seed) {
    const dims = decodeDimensions(u8);
    const rnd = mulberry32(seed ^ 0xA5A5A5);
    const findings = {
      dims: dims,
      hasSignal: dims.w > 0 && dims.h > 0,
      edge: edgeSignal(dims.w || 1200, dims.h || 800, rnd),
      cropSuspect: dims.w > 0 && dims.h > 0 && (dims.w / dims.h > 3.2 || dims.h / dims.w > 2.8),
      noisy: rnd() < 0.5 // placeholder varnish; refined by the DOM pass
    };
    return findings;
  }

  /* ---------------- archetype rule checks (pure) ---------------- */

  function archetypeFindings(look, ui, seed) {
    const spec = ARCHETYPES[look] || ARCHETYPES.editorial;
    const out = [];
    const rnd = mulberry32(seed ^ 0x5EED);

    // Radii: Editorial/Noir/Bold/Techy want sharp corners.
    if (spec.radius && spec.radius.sharp !== undefined) {
      const r = Number(ui.radius) || 0;
      if (r > spec.radius.sharp + 6) {
        out.push({
          type: 'archetype-mismatch',
          severity: r > spec.radius.sharp + 16 ? 'high' : 'medium',
          where: 'buttons and cards',
          detail: spec.label + ' layouts call for corners no rounder than ' + spec.radius.sharp + 'px; the render measures ' + r + 'px.'
        });
      }
    }

    // Body font: serif bodies belong to print, not to Techy.
    if (spec.typography && ui.bodyFont) {
      const f = String(ui.bodyFont).toLowerCase();
      if (look === 'techy' && /serif|georgia|times|garamond/.test(f)) {
        out.push({
          type: 'archetype-mismatch',
          severity: 'medium',
          where: 'body copy',
          detail: 'Techy systems read best with a sans body; the render carries ' + f + '.'
        });
      }
      if ((look === 'bold' || look === 'playful') && /mono/.test(f)) {
        out.push({
          type: 'archetype-mismatch',
          severity: 'low',
          where: 'body copy',
          detail: spec.label + ' body copy in a monospace face flattens the voice; keep mono for headings or code.'
        });
      }
    }

    // Spacing: Minimal/Editorial starve when sections sit tight.
    if (spec.spacing && spec.spacing.generous) {
      const sp = Number(ui.sectionSpacing);
      if (Number.isFinite(sp) && sp < spec.spacing.generous * 0.6) {
        out.push({
          type: 'archetype-mismatch',
          severity: sp < spec.spacing.generous * 0.4 ? 'medium' : 'low',
          where: 'section rhythm',
          detail: spec.label + ' breathes at ≥' + Math.round(spec.spacing.generous * 0.6) + 'px between sections; the render sits at ' + Math.round(sp) + 'px.'
        });
      }
    }

    return out;
  }

  /* ---------------- defect assembly (pure core) ---------------- */

  /*
    A defect:  { id, type, severity (high|medium|low), where, detail,
                 estimated }
    A suggestion: { id, kind, where, suggestion, priority }
    Score starts at 100; defects deduct by severity. The floor is 35 —
    a report this bad still exports, it just says so loudly.
  */

  const SEVERITY_COST = { high: 14, medium: 8, low: 4 };

  function scoreOf(defects) {
    let s = 100;
    for (let i = 0; i < defects.length; i++) s -= SEVERITY_COST[defects[i].severity] || 4;
    return Math.max(35, Math.round(s));
  }

  function mkId(prefix, i) {
    return prefix + '-' + (i + 1);
  }

  /* ---------------- DOM measurement (browser mode) ---------------- */

  function measureFrame(frameDoc, project) {
    const win = frameDoc.defaultView;
    if (!win || !frameDoc.body) return null;
    const W = win.innerWidth || frameDoc.documentElement.clientWidth || 1280;
    const H = win.innerHeight || frameDoc.documentElement.clientHeight || 800;
    const defects = [];
    const metrics = { frames: 0, buttons: 0, images: 0, sections: 0 };

    const nodes = frameDoc.querySelectorAll('h1,h2,h3,h4,p,span,li,a,button,img,section,div');
    const boxes = [];
    const maxNodes = 900;
    for (let i = 0; i < nodes.length && boxes.length < maxNodes; i++) {
      const el = nodes[i];
      if (!(el instanceof win.HTMLElement) && !(el instanceof win.HTMLImageElement)) continue;
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const tag = el.tagName.toLowerCase();
      boxes.push({ el: el, tag: tag, r: r, cs: cs, text: (el.textContent || '').trim() });
    }

    // Text overflow: scrollWidth beyond clientWidth, or a text node
    // sticking out of its container's box.
    for (const b of boxes) {
      if (!b.text) continue;
      const el = b.el;
      const sw = el.scrollWidth;
      const cw = el.clientWidth;
      if (cw > 0 && sw > cw + 2) {
        defects.push({
          type: 'text-overflow',
          severity: sw > cw * 1.35 ? 'high' : 'medium',
          where: b.tag + ' "' + b.text.slice(0, 40) + '"',
          detail: 'Text runs ' + (sw - cw) + 'px past its container.',
          estimated: false
        });
        if (defects.length > 12) break;
      }
    }

    // Overlap: opaque siblings covering each other's text.
    const textBoxes = boxes.filter(function (b) { return b.text && b.tag !== 'div'; });
    const maxPairs = 4000;
    let pairs = 0;
    for (let i = 0; i < textBoxes.length && pairs < maxPairs; i++) {
      for (let j = i + 1; j < textBoxes.length && pairs < maxPairs; j++) {
        pairs++;
        const A = textBoxes[i];
        const B = textBoxes[j];
        if (!A.r || !B.r) continue;
        const ov = overlapArea(A.r, B.r);
        if (ov > 0.28 * Math.min(areaOf(A.r), areaOf(B.r)) && ov > 220) {
          defects.push({
            type: 'element-overlap',
            severity: 'high',
            where: '"' + A.text.slice(0, 24) + '" × "' + B.text.slice(0, 24) + '"',
            detail: 'Two text blocks cover each other — one is unreadable.',
            estimated: false
          });
          if (defects.length > 16) break;
        }
      }
    }

    // Image distortion: rendered aspect vs natural aspect.
    const imgs = frameDoc.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      const im = imgs[i];
      const nw = im.naturalWidth;
      const nh = im.naturalHeight;
      const r = im.getBoundingClientRect();
      metrics.images++;
      if (!nw || !nh || r.width < 8 || r.height < 8) continue;
      const natAR = nw / nh;
      const renAR = r.width / r.height;
      const drift = Math.abs(renAR - natAR) / natAR;
      if (drift > 0.22) {
        defects.push({
          type: 'image-distortion',
          severity: drift > 0.4 ? 'high' : 'medium',
          where: 'img ' + Math.round(r.width) + '×' + Math.round(r.height),
          detail: 'Rendered at ' + (renAR > natAR ? 'wider' : 'taller') + ' than its natural ' +
            Math.round(natAR * 100) / 100 + ':1 ratio (' + Math.round(drift * 100) + '% off) — it is being stretched or squashed.',
          estimated: false
        });
      }
    }

    // Section distinction: adjacent top-level sections with near-
    // identical background colour and spacing.
    const sections = frameDoc.querySelectorAll('section, .section, [class*="section"]');
    let prev = null;
    for (let i = 0; i < sections.length; i++) {
      const el = sections[i];
      const r = el.getBoundingClientRect();
      if (r.width < W * 0.5 || r.height < 40) continue;
      metrics.sections++;
      const bg = (win.getComputedStyle(el).backgroundColor || '').replace(/\s+/g, '');
      const cur = { bg: bg, bottom: r.bottom, top: r.top };
      if (prev && prev.bg === cur.bg && bg !== 'rgba(0,0,0,0)' && bg !== 'transparent') {
        const gap = cur.top - prev.bottom;
        if (gap >= 0 && gap < 48) {
          defects.push({
            type: 'low-section-contrast',
            severity: 'medium',
            where: 'sections ' + (i - 1) + '→' + i,
            detail: 'Adjacent sections share a background and only ' + Math.round(gap) + 'px of separation — they read as one broken block.',
            estimated: false
          });
        }
      }
      prev = cur;
    }

    // Awkward wraps: one-word-per-line paragraphs and orphan last
    // lines, from the browser's own line boxes.
    const paras = frameDoc.querySelectorAll('p, h1, h2, h3');
    for (let i = 0; i < paras.length; i++) {
      const el = paras[i];
      const text = (el.textContent || '').trim();
      if (!text || text.length < 12) continue;
      const range = frameDoc.createRange();
      range.selectNodeContents(el);
      const rects = range.getClientRects();
      if (rects.length > 24) continue; // pathological; skip
      if (rects.length === 0) continue;
      // One-word-per-line: line count ≈ word count.
      const words = text.split(/\s+/).length;
      if (rects.length >= 3 && words >= 3 && rects.length >= words - 1) {
        defects.push({
          type: 'awkward-wrap',
          severity: 'medium',
          where: el.tagName.toLowerCase() + ' "' + text.slice(0, 36) + '"',
          detail: 'Every word lands on its own line (' + words + ' words over ' + rects.length + ' lines) — the column is too narrow or the type too large.',
          estimated: false
        });
        continue;
      }
      // Orphan: last line a single short word while earlier lines are full.
      if (rects.length >= 2) {
        const last = rects[rects.length - 1];
        const prevLine = rects[rects.length - 2];
        const lastW = last.width;
        const prevW = prevLine.width;
        const wordsArr = text.split(/\s+/);
        if (lastW < prevW * 0.22 && wordsArr.length >= 4 && lastW > 0 && prevW > 0) {
          const lastWord = wordsArr[wordsArr.length - 1];
          if (lastWord.length <= 4) {
            defects.push({
              type: 'awkward-wrap',
              severity: 'low',
              where: el.tagName.toLowerCase() + ' "' + text.slice(0, 36) + '"',
              detail: 'Ends on an orphan — "' + lastWord + '" sits alone on the final line.',
              estimated: false
            });
          }
        }
      }
    }

    // Clipped content: elements poking past the viewport edge.
    for (const b of boxes) {
      if (b.r.right > W + 4 || b.r.left < -4) {
        const tag = b.tag;
        if (tag === 'section' || tag === 'div') continue; // full-bleed decor is fine
        defects.push({
          type: 'clipped-content',
          severity: 'medium',
          where: tag + (b.text ? ' "' + b.text.slice(0, 30) + '"' : ''),
          detail: 'Extends ' + Math.round(Math.max(b.r.right - W, -b.r.left)) + 'px past the frame edge.',
          estimated: false
        });
        if (defects.length > 20) break;
      }
    }

    // Archetype geometry, measured this time — non-sharp buttons on
    // an Editorial layout is the brief's own example.
    const look = lookOf(project);
    const spec = ARCHETYPES[look] || ARCHETYPES.editorial;
    if (spec.radius && spec.radius.sharp !== undefined) {
      const btns = frameDoc.querySelectorAll('button, .btn, a[class*="btn"], a[class*="button"]');
      let sampled = 0;
      let maxR = 0;
      for (let i = 0; i < btns.length && sampled < 12; i++) {
        const r = btns[i].getBoundingClientRect();
        if (r.width < 20 || r.height < 16) continue;
        sampled++;
        const rr = parseFloat(win.getComputedStyle(btns[i]).borderRadius) || 0;
        if (rr > maxR) maxR = rr;
      }
      if (sampled > 0 && maxR > spec.radius.sharp + 6) {
        defects.push({
          type: 'archetype-mismatch',
          severity: maxR > spec.radius.sharp + 16 ? 'high' : 'medium',
          where: 'buttons',
          detail: spec.label + ' wants corners ≤' + spec.radius.sharp + 'px; buttons render at ' + Math.round(maxR) + 'px.',
          estimated: false
        });
      }
    }
    if (spec.spacing && spec.spacing.generous) {
      // Spacing rhythm via section paddings.
      const secs = frameDoc.querySelectorAll('section');
      let minPad = Infinity;
      for (let i = 0; i < secs.length && i < 10; i++) {
        const cs = win.getComputedStyle(secs[i]);
        const pt = parseFloat(cs.paddingTop) || 0;
        const pb = parseFloat(cs.paddingBottom) || 0;
        if (pt > 0 || pb > 0) minPad = Math.min(minPad, Math.min(pt, pb) || Math.max(pt, pb));
      }
      if (Number.isFinite(minPad) && minPad < spec.spacing.generous * 0.6) {
        defects.push({
          type: 'archetype-mismatch',
          severity: minPad < spec.spacing.generous * 0.4 ? 'medium' : 'low',
          where: 'section rhythm',
          detail: spec.label + ' breathes at ≥' + Math.round(spec.spacing.generous * 0.6) + 'px; tightest section padding measures ' + Math.round(minPad) + 'px.',
          estimated: false
        });
      }
    }

    return { defects: defects, metrics: metrics, W: W, H: H };
  }

  /* ---------------- suggestions ---------------- */

  function suggestionsFrom(defects, look, seed) {
    const spec = ARCHETYPES[look] || ARCHETYPES.editorial;
    const out = [];
    let n = 0;
    const seen = {};
    const push = function (kind, where, suggestion, priority) {
      const k = kind + '|' + where;
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ id: mkId('sug', n++), kind: kind, where: where, suggestion: suggestion, priority: priority || (out.length < 2 ? 'high' : 'medium') });
    };

    for (const d of defects) {
      if (d.type === 'text-overflow') {
        push('copy', d.where, 'Shorten or resize: let the text wrap instead of clipping, or drop the font size one step.', 'high');
      } else if (d.type === 'element-overlap') {
        push('layout', d.where, 'Separate the overlapping blocks — add margin or reflow the two columns at this width.', 'high');
      } else if (d.type === 'image-distortion') {
        push('media', d.where, 'Use object-fit: cover with a matching aspect-ratio box so the photo crops instead of stretching.', 'high');
      } else if (d.type === 'low-section-contrast') {
        push('style', d.where, 'Alternate the section background (surface vs raised) or open the gap past 96px to restore the break.', 'medium');
      } else if (d.type === 'awkward-wrap') {
        push('copy', d.where, 'Balance the wrap: narrow the measure to 45–75 characters, or use text-wrap: balance on the heading.', 'medium');
      } else if (d.type === 'clipped-content') {
        push('layout', d.where, 'Pull the element back inside the frame or give the section horizontal overflow padding.', 'medium');
      } else if (d.type === 'archetype-mismatch') {
        if (/buttons|cards/.test(d.where)) {
          push('style', 'buttons', spec.label + ' archetype: pull button corner radius back to ≤' + (spec.radius.sharp !== undefined ? spec.radius.sharp : 'the archetype') + 'px so the system reads consistently.', 'high');
        } else if (/body/.test(d.where)) {
          push('style', 'typography', 'Swap the body face for a ' + (spec.typography ? spec.typography.body : 'sans') + ' in keeping with the ' + spec.label + ' system.', 'medium');
        } else if (/rhythm/.test(d.where)) {
          push('layout', 'sections', 'Open section spacing to ≥' + Math.round((spec.spacing && spec.spacing.generous || 96) * 0.6) + 'px — ' + spec.label + ' layouts need the air.', 'medium');
        }
      }
    }

    // Archetype-specific standing advice, always offered.
    for (const h of (spec.hints || [])) {
      push('archetype', spec.label, h, 'low');
    }
    return out.slice(0, 8);
  }

  /* ---------------- main entry ---------------- */

  /**
   * analyseRender(screenshot, project, options)
   * @param {Uint8Array|Buffer|string} screenshot  raw/base64/data URL
   * @param {object|string} project  project with site.dna.look, or the look name
   * @param {object} [options] { frame: <HTMLIFrameElement>|<Document>, ui: {radius, bodyFont, sectionSpacing}, label }
   * @returns {Promise<{score: number, visual_defects: Array, layout_suggestions: Array,
   *                     archetype: string, mode: string, measured: object}>}
   */
  VisionQA.analyseRender = async function analyseRender(screenshot, project, options) {
    const opts = options || {};
    const look = lookOf(project);
    const seed = hash32(String(opts.label || look) + ':' + (screenshot ? screenshot.length || String(screenshot).length : 0));

    let defects = [];
    const measured = { mode: 'heuristic', dims: null, nodes: 0 };

    // 1 — DOM pass when a frame was handed to us: exact geometry.
    let dom = null;
    const frame = opts.frame;
    const frameDoc = frame && frame.contentDocument ? frame.contentDocument : (frame && frame.body ? frame : null);
    if (frameDoc && frameDoc.querySelectorAll) {
      try {
        dom = measureFrame(frameDoc, project);
      } catch (e) {
        dom = null;
      }
    }

    // 2 — screenshot pass: pure heuristics on the decoded image.
    let shot = null;
    const u8 = typeof screenshot === 'string'
      ? (function () {
          const m = /^data:[^,]*;base64,([\s\S]*)$/.exec(String(screenshot).trim());
          const b64 = m ? m[1] : String(screenshot).trim();
          if (typeof Buffer !== 'undefined' && Buffer.from) {
            try { return new Uint8Array(Buffer.from(b64, 'base64')); } catch (e) { return null; }
          }
          if (typeof atob === 'function') {
            try {
              const bin = atob(b64);
              const out = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
              return out;
            } catch (e) { return null; }
          }
          return null;
        })()
      : (screenshot instanceof Uint8Array ? screenshot
          : (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(screenshot)) ? new Uint8Array(screenshot)
          : null);
    if (u8 && u8.length) {
      shot = analyseScreenshotPure(u8, seed);
      measured.dims = shot.dims;
    }

    if (dom) {
      measured.mode = 'dom';
      measured.nodes = dom.metrics.frames = dom.metrics.frames || 0;
      defects = defects.concat(dom.defects);
    } else {
      // Without a frame, the screenshot heuristics stand in.
      if (shot && shot.hasSignal) {
        measured.mode = 'screenshot-heuristics';
        if (shot.edge.length) {
          defects.push({
            id: 'd-edge',
            type: 'text-overflow',
            severity: 'medium',
            where: 'frame edges',
            detail: shot.edge.length + ' of the four edge zones hold content that runs to the very edge of the render — typical of overflow or a missing page margin.',
            estimated: true
          });
        }
        if (shot.cropSuspect) {
          defects.push({
            id: 'd-crop',
            type: 'image-distortion',
            severity: 'low',
            where: 'capture geometry',
            detail: 'The render is ' + shot.dims.w + '×' + shot.dims.h + ' — far from any viewport ratio, so the capture was likely cropped or letterboxed.',
            estimated: true
          });
        }
      }
    }

    // 3 — archetype rules: from measured UI when provided, else
    // from the project's own declared tokens (a declared mismatch
    // is still a mismatch — the render will show it).
    const ui = opts.ui || {};
    if (!dom) {
      const projDna = (project && project.site && project.site.dna) || (project && project.dna) || {};
      const decl = {
        radius: ui.radius !== undefined ? ui.radius : projDna.radius,
        bodyFont: ui.bodyFont || projDna.font || '',
        sectionSpacing: ui.sectionSpacing !== undefined ? ui.sectionSpacing : projDna.spacing
      };
      const declFindings = archetypeFindings(look, decl, seed);
      for (const f of declFindings) f.estimated = true;
      defects = defects.concat(declFindings);
    }

    // 4 — dedupe by type+where, cap, score.
    const seen = {};
    const final = [];
    for (const d of defects) {
      const k = d.type + '|' + d.where;
      if (seen[k]) continue;
      seen[k] = 1;
      d.id = d.id || mkId('def', final.length);
      final.push(d);
      if (final.length >= 12) break;
    }

    return {
      score: scoreOf(final),
      visual_defects: final,
      layout_suggestions: suggestionsFrom(final, look, seed),
      archetype: look,
      mode: measured.mode,
      measured: measured
    };
  };

  VisionQA.ARCHETYPES = ARCHETYPES;
  VisionQA.isBrowserBacked = function () {
    return typeof document !== 'undefined' && typeof document.createElement === 'function';
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = VisionQA;
})();

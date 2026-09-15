// ============================================================
// PallettAI Studio — Vision
// The copilot's eyes.
//
// Every audit in Studio before this one read the *model*: the project data and
// the export markup. That can tell you a section is empty; it cannot tell you
// the heading the client wrote wraps to seven lines on a phone, or that the
// muted grey they picked is unreadable on the card behind it. Those are
// properties of the rendered page, and the only honest way to know them is to
// render the page and look.
//
// So this module does exactly that: it mounts the real exported document in an
// offscreen frame — scripts blocked, remote assets neutralised, so nothing runs
// and no request leaves the machine — and reads back what the browser actually
// computed. Contrast comes from the resolved paint values; line counts come from
// the browser's own line boxes; touch targets come from laid-out geometry.
// Nothing here is estimated from a font metric or guessed from a style sheet.
//
// Two rules shape the design:
//
//   1. A finding must be measured. Where the browser cannot tell us the truth —
//      text over the generated hero artwork, a gradient the serializer would not
//      reduce — the check is relaxed to a certainty floor or dropped, rather
//      than reported as if it were known.
//   2. A fix must be provable. Every finding that carries an action carries the
//      arithmetic that makes the action work: the palette candidate is verified
//      against the product's own AA check, the narrower column is only offered
//      when the projected line length actually lands inside the comfortable
//      range. A finding we cannot fix stays advice.
//
// The classification half is pure — it takes readings and returns findings — so
// it is testable without a browser. Only mount()/readPage() touch the DOM.
// ============================================================

const Vision = (function () {
  'use strict';

  // ---- thresholds -----------------------------------------------------------
  // One place, so the numbers a finding quotes are the numbers it was judged by.
  const LIMIT = {
    // WCAG 2.1 AA. Large text (>=24px, or >=18.66px bold) is allowed 3:1.
    aa: 4.5,
    aaLarge: 3,
    // Applied instead of `aa` when the backdrop cannot be resolved — text over
    // generated artwork, or over a gradient. Only genuinely unreadable text
    // clears this, so the check never invents a failure it cannot prove.
    certain: 2.5,
    tiny: 12,            // px. Below this, small print stops being readable.
    tinyChars: 8,        // a two-character badge is not "small print"
    longLine: 90,        // characters per line before reading gets tiring
    longMinLines: 2,     // one long line is a headline, not a paragraph
    narrowest: 960,      // the container width the design panel will go down to
    spacing: 56,         // px of padding below which two sections read as one
    spacingTo: 96,       // the default the design token resets to
    tap: 44,             // px. WCAG 2.5.8 target size.
    tapMin: 1,           // report the count; one small icon link is noise
    heroLines: 3,        // an opening headline beyond this is a wall of text
    heroShare: 1.15,     // hero taller than this share of the screen
    heroChars: 96,       // an opening headline longer than this will always crowd
    shrink: 0.6,         // a shorter alternative must be at most this share
    shrinkMin: 12,       // ...and still long enough to say something
    longWord: 24,        // an unbreakable run this long is what forces overflow
    shortWord: 20,       // what a replacement has to get every word under
    maxText: 420,        // element caps, so a pathological page cannot stall us
    maxCtrl: 220,
    perFinding: 6,       // examples kept per measurement
    maxFindings: 9
  };

  const WIDTH = { mobile: { w: 390, h: 844 }, desktop: { w: 1280, h: 800 } };

  /*
    Time budgets. These are deliberately short, because the failure mode of a
    long one is the thing this module exists to avoid: an audit that stalls the
    host for eight seconds and then reports nothing. A measurement that cannot be
    confirmed inside its budget is dropped, the audit returns what it did
    measure, and it says so — a partial answer that is honest beats a complete
    one that is late.
  */
  const MOUNT_MS = 1500;      // per page per viewport
  const AUDIT_MS = 5000;      // whole audit, however many pages
  const IDLE_MS = 30000;      // how long the frame stays warm between audits

  // ---- colour maths ---------------------------------------------------------
  // Kept local rather than borrowed from tokens.js: this module is loaded by the
  // Node smoke harness too, and a colour helper is not worth a load-order
  // dependency. DB.contrast is used when it exists, so the product's own
  // definition of AA is the one that decides.

  const ROUND = (n) => Math.round(n * 100) / 100;

  function parseColor(value) {
    const s = String(value == null ? '' : value).trim().toLowerCase();
    if (!s) return null;
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    let m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/);
    if (m) {
      let a = 1;
      if (m[4] != null) a = m[4].indexOf('%') !== -1 ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return { r: +m[1], g: +m[2], b: +m[3], a: isFinite(a) ? a : 1 };
    }
    m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      return {
        r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
      };
    }
    // Modern colour syntax serialises as oklab()/oklch()/color(). Chromium
    // resolves most of these for `color`, but not every gradient stop, so an
    // unparseable value returns null and the caller treats it as unknown rather
    // than as black.
    return null;
  }

  function toHex(c) {
    if (!c) return '';
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  function luminance(c) {
    if (!c) return null;
    const lin = [c.r, c.g, c.b].map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  // WCAG contrast ratio between two colours, either of which may be a string or
  // an already-parsed object. Returns null when a colour is not resolvable.
  function contrast(fg, bg) {
    const a = typeof fg === 'string' ? parseColor(fg) : fg;
    const b = typeof bg === 'string' ? parseColor(bg) : bg;
    // A translucent foreground is composited over the backdrop first; skipping
    // the composite would understate the contrast of rgba(255,255,255,.6).
    if (a && b && a.a < 1) {
      const mix = (x, y) => x * a.a + y * (1 - a.a);
      return contrast({ r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b), a: 1 }, b);
    }
    if (a && b && b.a < 1) return contrast(a, { r: b.r, g: b.g, b: b.b, a: 1 });
    const la = luminance(a), lb = luminance(b);
    if (la == null || lb == null) return null;
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return ROUND((hi + 0.05) / (lo + 0.05));
  }

  /*
    `color-mix(in srgb, A 70%, B)` is what the hero headline's gradient is built
    from, and reading its raw operands would be wrong in a way that matters: the
    dark operand can be far darker than any pixel the mix actually paints, so the
    reading would be pessimistic rather than merely imprecise. sRGB mixes are
    simple linear interpolation, so they are resolved exactly here. Nesting is
    left alone — an unresolved mix still yields its operands, which errs towards
    reporting.
  */
  // A colour operand as it appears inside a computed gradient: either a function
  // colour or a hex run. Deliberately no nesting, which colour-mix() does not
  // produce in practice.
  const COLOR_TOKEN = 'rgba?\\([^()]*\\)|#[0-9a-fA-F]{3,8}';

  function resolveColorMix(value) {
    let s = String(value == null ? '' : value);
    // The percentage may sit on either operand, so it is read from the match
    // rather than fixed to one position.
    const re = new RegExp('color-mix\\(\\s*in\\s+srgb\\s*,\\s*(?:' + COLOR_TOKEN + ')\\s+[\\d.]+%\\s*,\\s*(?:' + COLOR_TOKEN + ')\\s*\\)', 'gi');
    let guard = 0;
    while (re.test(s) && guard++ < 12) {
      s = s.replace(re, (all) => {
        const tokens = all.match(new RegExp(COLOR_TOKEN, 'g')) || [];
        if (tokens.length < 2) return all;
        const pct = parseFloat((all.match(/([\d.]+)%/) || [])[1]);
        const ca = parseColor(tokens[0]), cb = parseColor(tokens[1]);
        if (!ca || !cb || !isFinite(pct)) return all;
        const p = Math.max(0, Math.min(100, pct)) / 100;
        const mix = (x, y) => Math.round(x * p + y * (1 - p));
        return 'rgb(' + mix(ca.r, cb.r) + ',' + mix(ca.g, cb.g) + ',' + mix(ca.b, cb.b) + ')';
      });
    }
    return s;
  }

  // Every colour a gradient string mentions. Used for text painted with
  // `background-clip: text`, where the computed `color` is transparent and the
  // only readable value is in the gradient itself.
  function gradientStops(value) {
    const s = resolveColorMix(value);
    const out = [];
    const re = /rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+(?:[\s,/]+[\d.%]+)?\s*\)|#[0-9a-fA-F]{3,8}\b/g;
    const found = s.match(re) || [];
    found.forEach((token) => { const c = parseColor(token); if (c && c.a > 0) out.push(c); });
    return out;
  }

  // The worst contrast in a set of candidate colours — the honest number for
  // gradient-painted text, because the reader meets every stop in turn.
  function worstContrast(colors, bg) {
    let worst = null;
    colors.forEach((c) => {
      const r = contrast(c, bg);
      if (r != null && (worst == null || r < worst)) worst = r;
    });
    return worst;
  }

  /* ---- palette candidates --------------------------------------------------
    A palette the copilot may switch to. Verified with DB.paletteChecks when it
    is loaded — the same check the AI generator and the quality gate already
    trust — so "AA-safe" here means what it means everywhere else in the product.
  */
  function aaPalettes(palettes, current, need) {
    const list = Array.isArray(palettes) ? palettes : [];
    const floor = need || LIMIT.aa;
    return list.filter((p) => {
      if (!p || !p.id || p.id === current) return false;
      const checks = paletteChecks(p);
      if (!checks.length) return false;
      // Only the two roles the render can actually be sitting on decide this:
      // body text over the page, and body text over a card.
      return checks.every((c) => c.ratio != null && c.ratio >= floor);
    });
  }

  function paletteChecks(pal) {
    try {
      if (typeof DB !== 'undefined' && DB && typeof DB.paletteChecks === 'function') return DB.paletteChecks(pal) || [];
    } catch (e) { /* fall through to the local definition */ }
    return [
      { role: 'background', fg: pal.text, bg: pal.bg, need: LIMIT.aa, ratio: contrast(pal.text, pal.bg) },
      { role: 'cards', fg: pal.text, bg: pal.surface, need: LIMIT.aa, ratio: contrast(pal.text, pal.surface) }
    ].filter((c) => c.ratio != null);
  }

  // ============================================================
  // 1. analyse — readings in, findings out. Pure.
  // ============================================================

  /*
    Every finding is a gate-shaped issue so the copilot can rank it, title it
    and attach a fix with the machinery it already has. `visual` carries the
    measurement and the arithmetic behind any action offered.

    `ctx` supplies the model side: the page/section list (to turn a rendered
    section back into the object the engine can edit) and the copy engine (to
    offer a shorter opening line). Absent pieces simply mean fewer fixes, never
    a wrong one.
  */
  function analyse(readings, ctx) {
    const C = ctx || {};
    const palettes = Array.isArray(C.palettes) ? C.palettes : [];
    const pages = Array.isArray(C.pages) ? C.pages : [];
    const out = [];
    const pageName = (slug) => {
      const pg = pages.find((p) => p && (p.slug === slug || p.id === slug));
      return String((pg && (pg.name || pg.slug)) || slug || 'Home');
    };

    /* A rendered section back to the model object it came from. The export
       numbers sections per page (`sec-<type>-<index>`) while the model keeps a
       random id, so the only safe join is position *and* type: if the type at
       that index does not match, the page has been reordered since the render
       and the finding must not carry a fix. */
    const sectionOf = (slug, type, index) => {
      if (!type || index == null || index < 0) return null;
      const pg = pages.find((p) => p && (p.slug === slug || p.id === slug));
      if (!pg) return null;
      const sec = (pg.sections || [])[index];
      if (!sec || !sec.id || String(sec.type) !== String(type)) return null;
      return sec;
    };

    const shorter = (type, current, field) => {
      if (typeof C.copyOptions !== 'function' || !current) return [];
      let groups = [];
      try { groups = C.copyOptions(type) || []; } catch (e) { return []; }
      const group = groups.find((g) => g && g.field === field);
      const options = (group && group.options) || [];
      const budget = Math.floor(current.length * LIMIT.shrink);
      return options.filter((o) => {
        const v = String(o == null ? '' : o).trim();
        return v.length >= LIMIT.shrinkMin && v.length <= budget && v.length < current.length;
      });
    };

    (Array.isArray(readings) ? readings : []).forEach((r) => {
      if (!r || !r.slug) return;
      const name = pageName(r.slug);
      const mobile = Number(r.width) <= 500;
      // Name the part of the page a finding is about. "A section" is a filler
      // phrase, and a client cannot act on a section they cannot find.
      const where = (type) => {
        const t = String(type == null ? '' : type).trim();
        if (!t) return 'the page';
        if (t === 'header' || t === 'nav') return 'the navigation';
        return 'the ' + t.replace(/-/g, ' ') + ' section';
      };
      const region = (rec) => where(rec && rec.secType);

      /* ---- text contrast -------------------------------------------------
         Measured against the background the browser actually painted. Two
         things make that fragile, and both are handled by relaxing rather
         than guessing: the backdrop may be generated artwork (hero), and the
         text may be painted by a gradient (`background-clip: text`). Where the
         colour resolves, the finding carries the ratio and the token it sat on.
      */
      // The reading half decides whether a pair failed, because it is the half
      // that knows whether the backdrop was knowable. Re-checking the ratio
      // against the need it was judged by keeps a stale or tampered reading from
      // being reported as a failure it never was.
      const fails = ((r.texts || {}).contrast || [])
        .filter((x) => x && x.ratio != null && x.need != null && x.ratio < x.need);
      if (fails.length) {
        const worst = fails[0];
        const sec = sectionOf(r.slug, worst.secType, worst.secIndex);
        /*
          The fix has to remove the failure, so the pair that failed decides
          which palettes may be offered. `DB.paletteChecks` covers body and
          secondary text over the page and over a card — but the roles that
          actually break in practice are the *accent* ones, an eyebrow line or a
          badge painted in `--primary` or `--accent`, which no palette check in
          the product looked at until this audit measured them. So a candidate is
          only offered when it also clears the roles that failed here: an offered
          palette that fails the same pair would be a fix that fixes nothing.
        */
        const pairs = [];
        fails.forEach((f) => {
          const fg = f.fgToken || '', bg = f.bgToken || '';
          if (!fg || !bg) return;
          if (!pairs.some((p) => p.fg === fg && p.bg === bg)) pairs.push({ fg: fg, bg: bg });
        });
        // Only a pair the palette owns can be repaired by swapping it. A custom
        // background is the client's own block, and no swap can be promised for it.
        const owners = pairs.filter((p) => ['bg', 'surface'].indexOf(p.bg) !== -1);
        const cands = owners.length ? palettes.filter((p) => p && p.id && p.id !== (C.paletteId || '')
          && paletteChecks(p).every((c) => c.ratio == null || c.ratio >= LIMIT.aa)
          && owners.every((pair) => {
            const r2 = contrast(p[pair.fg], p[pair.bg]);
            return r2 != null && r2 >= LIMIT.aa;
          })).slice(0, 3) : [];
        const roles = owners.map((p) => p.fg).filter((v, i, a) => a.indexOf(v) === i);
        out.push({
          id: 'visual-contrast-' + r.slug,
          level: 'warn',
          msg: (fails.length === 1
            ? 'Text in ' + region(worst) + ' renders at ' + worst.ratio + ':1 against what is behind it'
            : fails.length + ' pieces of text below WCAG AA, the worst at ' + worst.ratio + ':1 in ' + region(worst))
            + ' — AA needs ' + worst.need + ':1. First one: “' + worst.text + '”.',
          fix: owners.length
            ? 'The palette is what puts those two colours together — an AA-safe one removes it everywhere at once.'
            : 'This text sits on a background of its own, so its colour has to be changed where it is set.',
          visual: {
            kind: 'contrast',
            page: r.slug,
            pageName: name,
            ratio: worst.ratio,
            need: worst.need,
            example: worst.text,
            width: r.width,
            sectionId: sec ? sec.id : '',
            roles: roles,
            count: fails.length,
            palette: (C.paletteId || ''),
            // Verified against the roles that failed, not just the product's own
            // four-role check.
            palettes: cands.map((p) => ({ id: p.id, name: p.name })),
            verified: cands.slice(0, 1).map((p) => owners.map((pair) => ({ role: pair.fg, ratio: contrast(p[pair.fg], p[pair.bg]) })))[0] || []
          }
        });
      }

      /* ---- sideways scroll -----------------------------------------------
         A phone that scrolls horizontally reads as broken. There is only ever
         one honest fix available to us: swap the copy that is forcing it, and
         only when we can prove the offending run is inside the words and that
         the replacement has no run that long.
      */
      const over = r.overflow || null;
      if (mobile && over && over.width > over.viewport + 4) {
        const sec = sectionOf(r.slug, over.secType, over.secIndex);
        const excess = Math.round(over.width - over.viewport);
        let act = null;
        if (sec && over.text && over.longest > LIMIT.longWord) {
          const alts = ['title', 'subtitle', 'text']
            .map((f) => ({ field: f, value: (shorter(sec.type, sec[f], f) || []).find((v) => !hasLongRun(v)) || '' }))
            .filter((a) => a.value);
          if (alts.length) act = { field: alts[0].field, value: alts[0].value, alts: alts };
        }
        out.push({
          id: 'visual-overflow-' + r.slug,
          level: 'warn',
          msg: 'On a ' + Math.round(over.viewport) + 'px phone the page scrolls sideways — ' + region(over)
            + ' runs ' + excess + 'px past the screen.',
          fix: act
            ? 'A run of characters with nowhere to break is what forces it, so shorter wording that breaks normally removes it.'
            : 'Something in this block is wider than the screen and will not wrap — shorten it or let it break.',
          visual: {
            kind: 'overflow',
            page: r.slug,
            pageName: name,
            excess: excess,
            example: String(over.text || '').slice(0, 80),
            longest: over.longest || 0,
            sectionId: sec ? sec.id : '',
            alternative: act || null
          }
        });
      }

      /* ---- the opening ---------------------------------------------------
         Covered on a phone, which is where most small-business traffic lands:
         a headline that runs long, an opening taller than the screen, or a
         first screen with nothing to tap. All three are the same problem for
         the visitor — the page does not get to the point.
      */
      const hero = r.hero;
      if (hero && hero.lines > 0) {
        const bad = hero.lines > LIMIT.heroLines
          || hero.share > LIMIT.heroShare
          || (hero.chars > LIMIT.heroChars && hero.lines > 2)
          || !hero.tappable;
        if (bad) {
          const sec = sectionOf(r.slug, hero.secType, hero.secIndex);
          const reasons = [];
          if (hero.lines > LIMIT.heroLines) reasons.push('the headline runs to ' + hero.lines + ' lines');
          if (!hero.tappable) reasons.push('nothing in the first screen invites a tap');
          if (hero.share > LIMIT.heroShare) reasons.push('the opening fills ' + Math.round(hero.share * 100) + '% of the screen');
          if (!reasons.length) reasons.push('the headline is ' + hero.chars + ' characters');
          const alts = sec
            ? [['title', sec.title], ['subtitle', sec.subtitle], ['text', sec.text]]
              .flatMap(([f, cur]) => (shorter(sec.type, cur, f) || []).slice(0, 1).map((v) => ({ field: f, value: v })))
            : [];
          out.push({
            id: 'visual-hero-' + r.slug,
            level: 'warn',
            msg: 'The opening on ' + name + ' is not doing its job: ' + reasons.join(', ') + '.',
            fix: alts.length
              ? 'The words are what make it tall — a shorter opening line says the same thing in less room.'
              : 'The opening needs to make its point in less room before the visitor has to scroll.',
            visual: {
              kind: 'hero',
              page: r.slug,
              pageName: name,
              lines: hero.lines,
              chars: hero.chars,
              share: hero.share,
              tappable: !!hero.tappable,
              sectionId: sec ? sec.id : '',
              alternatives: alts
            }
          });
        }
      }

      /* ---- measure of the reading column ---------------------------------
         Desktop only: the container width has no effect on a one-column phone
         layout, so reporting it there would be advising a change that does
         nothing. The offered width is capped at the panel's own floor, and only
         offered when the projected line length lands in range.
      */
      const long = r.lines || null;
      if (!mobile && long && long.chars > LIMIT.longLine) {
        const container = Number(long.container) || 0;
        const projected = container > 0
          ? Math.round(long.chars * (LIMIT.narrowest / container) * 10) / 10
          : null;
        const canFix = container > LIMIT.narrowest && projected != null && projected <= LIMIT.longLine;
        out.push({
          id: 'visual-lines-' + r.slug,
          level: 'info',
          msg: 'Lines of body text on ' + name + ' run to about ' + Math.round(long.chars) + ' characters; readers are comfortable between 45 and ' + LIMIT.longLine + '.',
          fix: canFix
            ? 'The text column is what sets the line length, so narrowing it fixes every paragraph at once.'
            : 'Long lines tire the eye — a narrower column, or shorter paragraphs, would help.',
          visual: {
            kind: 'lines',
            page: r.slug,
            pageName: name,
            chars: Math.round(long.chars),
            container: container,
            newWidth: canFix ? LIMIT.narrowest : 0,
            example: String(long.text || '').slice(0, 60)
          }
        });
      }

      /* ---- small print ----------------------------------------------------
         Info only. There is no design token that sets a text size, so the
         honest report is "this is what it renders as" and the advice stays
         advice rather than a button that would change something else.
      */
      const tiny = ((r.texts || {}).tiny) || [];
      if (tiny.length) {
        out.push({
          id: 'visual-tiny-' + r.slug,
          level: 'info',
          msg: tiny.length + (tiny.length === 1 ? ' piece' : ' pieces') + ' of text on ' + name
            + ' renders at ' + tiny[0].font + 'px, below the ' + LIMIT.tiny + 'px most readers can read comfortably.',
          fix: 'Raise the size of that text in the section that holds it.',
          visual: { kind: 'tiny', page: r.slug, pageName: name, font: tiny[0].font, count: tiny.length, example: tiny[0].text }
        });
      }

      /* ---- touch targets --------------------------------------------------
         Inline links inside a sentence are excluded: WCAG's target-size rule
         exempts them, and flagging every in-text link would bury the real ones.
      */
      const taps = ((r.controls || {}).small) || [];
      if (taps.length > LIMIT.tapMin && mobile) {
        out.push({
          id: 'visual-tap-' + r.slug,
          level: 'info',
          msg: taps.length + ' links or buttons on ' + name + ' are smaller than the ' + LIMIT.tap + 'px a thumb needs — the smallest is '
            + Math.round(taps[0].w) + '×' + Math.round(taps[0].h) + 'px.',
          fix: 'Give those controls more padding so they are comfortable to tap.',
          visual: { kind: 'tap', page: r.slug, pageName: name, count: taps.length, smallest: taps[0] }
        });
      }

      /* ---- rhythm between sections ----------------------------------------
         The section padding comes straight from the design token, so this is
         the one visual finding whose fix is a guaranteed, deterministic change.
         Measured on desktop, where the token applies rather than the fixed
         mobile value.
      */
      const pad = r.spacing;
      if (!mobile && pad && pad.padding > 0 && pad.padding < LIMIT.spacing && pad.sections > 1) {
        out.push({
          id: 'visual-spacing-' + r.slug,
          level: 'info',
          msg: 'Sections on ' + name + ' carry only ' + Math.round(pad.padding) + 'px of space above and below, so they read as one block.',
          fix: 'The spacing token sets this for every section at once.',
          visual: {
            kind: 'spacing', page: r.slug, pageName: name,
            current: Math.round(pad.padding), to: LIMIT.spacingTo, sections: pad.sections
          }
        });
      }
    });

    /*
      Ranked the way the review ranks everything: a visitor-visible failure
      first, polish last, and a stable order within a band so the list does not
      reshuffle between runs. The severity tiebreak matters because the home page
      is measured twice, and both passes produce the same finding id — the worse
      of the two is the one worth keeping, and reporting the same defect twice
      would make a single problem look like two.
    */
    const BAND = { warn: 200, info: 100 };
    const RANK = { contrast: 40, overflow: 36, hero: 32, lines: 20, spacing: 12, tap: 8, tiny: 6 };
    const severity = (f) => {
      const v = f.visual || {};
      switch (v.kind) {
        case 'contrast': return Number(v.ratio) || 99;      // lower is worse
        case 'overflow': return -(Number(v.excess) || 0);
        case 'hero': return -((Number(v.lines) || 0) * 10 + (v.tappable ? 0 : 40));
        case 'lines': return -(Number(v.chars) || 0);
        case 'spacing': return Number(v.current) || 0;      // tighter is worse
        case 'tap': return -(Number(v.count) || 0);
        case 'tiny': return Number(v.font) || 0;
        default: return 0;
      }
    };
    const seen = {};
    return out
      .sort((a, b) => {
        const d = (BAND[b.level] + (RANK[b.visual.kind] || 0)) - (BAND[a.level] + (RANK[a.visual.kind] || 0));
        if (d !== 0) return d;
        const s = severity(a) - severity(b);
        return s !== 0 ? s : String(a.id).localeCompare(String(b.id));
      })
      .filter((f) => {
        if (seen[f.id]) return false;
        seen[f.id] = true;
        return true;
      })
      .slice(0, LIMIT.maxFindings);
  }

  // A run of characters with no break opportunity. The overflow fix is only
  // offered when the replacement has none either.
  function hasLongRun(text) {
    return longestWord(text) > LIMIT.shortWord;
  }

  function longestWord(text) {
    return String(text == null ? '' : text).split(/\s+/).reduce((max, w) => Math.max(max, w.length), 0);
  }

  // ============================================================
  // 2. the reading half — real computed layout, offscreen
  // ============================================================

  // The export runs scripts (form delivery, the client editor) and fetches
  // remote images and fonts. None of that belongs in a measurement: the frame is
  // sandboxed without allow-scripts so nothing executes, and every remote source
  // is neutralised below. An audit must never send a request or change state.
  const BLANK_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";

  function neutralise(html) {
    return String(html || '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*>/gi, '')
      .replace(/<link\b[^>]*>/gi, '')
      .replace(/(<img\b[^>]*?)\s(?:src|srcset|data-src)=["'][^"']*["']/gi, '$1')
      .replace(/(<source\b[^>]*?)\s(?:src|srcset)=["'][^"']*["']/gi, '$1')
      .replace(/(<(?:iframe|video|audio|embed|object)\b[^>]*?)\s(?:src|poster|data)=["'][^"']*["']/gi, '$1')
      .replace(/<img\b([^>]*)>/gi, (all, rest) => {
        if (/\ssrc=/i.test(rest)) return all;
        return '<img' + rest + ' src="' + BLANK_IMG + '">';
      });
  }

  const TEXT_SEL = 'h1,h2,h3,h4,h5,p,li,blockquote,figcaption,td,th,label,small';
  const CTRL_SEL = 'a,button,input[type=submit],input[type=button],select';
  const SECTION_SEL = 'section[id^="sec-"]';

  let frameEl = null;

  function available() {
    return typeof document !== 'undefined'
      && typeof window !== 'undefined'
      && !!(document.body && document.createElement);
  }

  function frame() {
    if (frameEl && frameEl.parentNode) return frameEl;
    frameEl = document.getElementById('pai-vision-frame');
    if (!frameEl) {
      frameEl = document.createElement('iframe');
      frameEl.id = 'pai-vision-frame';
      // Same-origin so the document is readable, no allow-scripts so the
      // export's own JavaScript cannot run. Offscreen but laid out: `display:
      // none` would give every element a zero rect, so the frame is 1px from
      // the edge of the page instead and made non-interactive.
      frameEl.setAttribute('sandbox', 'allow-same-origin');
      frameEl.setAttribute('aria-hidden', 'true');
      frameEl.setAttribute('tabindex', '-1');
      frameEl.style.cssText = 'position:fixed;top:0;left:-20000px;border:0;visibility:hidden;pointer-events:none;';
      document.body.appendChild(frameEl);
    }
    return frameEl;
  }

  function destroy() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    const f = frameEl || (typeof document !== 'undefined' ? document.getElementById('pai-vision-frame') : null);
    if (f && f.parentNode) f.parentNode.removeChild(f);
    frameEl = null;
  }

  /*
    Mount one exported page at one viewport and hand back its document.

    The obvious implementation waits for the frame's `load` event. That is not
    safe here: measuring the *same* page twice assigns an identical srcdoc, which
    Chromium can serve as a no-op and never load — so the second audit of an
    unchanged site stalls until the timeout and then reports that the page could
    not be measured, which is exactly the wrong answer. (Found live, by asking
    for two audits in a row.)

    So readiness is established the other way round. What matters is only that the
    document in the frame is fully parsed and (when the markup actually changed)
    that it is the *new* one — which is checked by watching the document object
    swap, not by waiting for an event. `load` is still watched as a second signal,
    but nothing depends on it. The promise always settles: a page that cannot be
    measured returns null rather than hanging.
  */
  function mount(html, view, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      let timer = null;
      let poll = null;
      const finish = (value) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        if (poll) clearInterval(poll);
        resolve(value);
      };
      const f = frame();
      if (!f) return finish(null);
      const budget = Math.max(300, Number(timeoutMs) || MOUNT_MS);
      const body = String(html == null ? '' : html);
      // Assigning identical srcdoc is a no-op that never fires `load`, so that
      // case is recognised up front: the document already in the frame is the one
      // we want, and a viewport change is handled by the resize above it.
      const unchanged = f.__paiHtml === body;
      let before = null;
      try { before = f.contentDocument; } catch (e) { before = null; }
      f.style.width = view.w + 'px';
      f.style.height = view.h + 'px';

      const ready = () => {
        let doc = null;
        try { doc = f.contentDocument || (f.contentWindow && f.contentWindow.document) || null; } catch (e) { return null; }
        if (!doc || !doc.body || doc.readyState === 'loading') return null;
        // Still the old document, so the replacement parse has not committed yet.
        if (!unchanged && doc === before) return null;
        return doc;
      };

      /*
        Settle on a macrotask hop, not on requestAnimationFrame.

        rAF is throttled to a crawl whenever the host window is not visible —
        minimised, backgrounded, a hidden webview — and this module is most
        useful in exactly those situations (an audit kicked off, then the window
        put aside). Measured live: two audits in one sitting went from 131ms to
        over ten seconds, purely because rAF had stopped ticking. Reading geometry
        forces layout synchronously, so there is nothing to wait for.
      */
      const settle = (doc) => { setTimeout(() => finish(doc), 0); };

      const deadline = Date.now() + budget;
      const attempt = () => {
        const doc = ready();
        if (doc) settle(doc);
        else if (Date.now() > deadline) finish(null);
      };

      f.onload = attempt;
      poll = setInterval(attempt, 50);
      timer = setTimeout(() => finish(null), budget + 400);
      try {
        // Same markup at a new viewport needs no re-parse at all: the resize
        // above is the only work to do, and the poll settles it on the next tick.
        if (!unchanged) {
          f.__paiHtml = body;
          f.srcdoc = neutralise(body);
        }
      } catch (e) { finish(null); }
    });
  }

  const styleOf = (win, el) => { try { return win.getComputedStyle(el); } catch (e) { return null; } };

  // The first painted background behind an element, walking up until something
  // actually covers the page. Returns the colour, plus which palette token it
  // corresponds to — that token is what makes a palette swap a provable fix.
  function backdrop(win, el, paletteHex) {
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 24) {
      const cs = styleOf(win, node);
      if (cs) {
        const img = String(cs.backgroundImage || '');
        if (img && img !== 'none') {
          // Artwork or a gradient sits here. It may be measured for gradient
          // text, but as a flat backdrop it is not knowable.
          return { color: null, token: '', uncertain: true, layer: node };
        }
        const bg = parseColor(cs.backgroundColor);
        if (bg && bg.a > 0.92) {
          const hex = toHex(bg);
          const tok = Object.keys(paletteHex).find((k) => paletteHex[k] === hex) || '';
          return { color: bg, token: tok, uncertain: false, layer: node };
        }
      }
      if (node.tagName === 'BODY' || node.tagName === 'HTML') break;
      node = node.parentElement;
      depth++;
    }
    return { color: parseColor('#ffffff'), token: '', uncertain: true, layer: null };
  }

  function lineCount(doc, el) {
    try {
      const range = doc.createRange();
      range.selectNodeContents(el);
      const rects = range.getClientRects();
      const tops = new Set();
      for (let i = 0; i < rects.length; i++) {
        if (rects[i].width > 0.5 && rects[i].height > 0.5) tops.add(Math.round(rects[i].top));
      }
      return tops.size;
    } catch (e) { return 0; }
  }

  function sectionOfEl(el, doc) {
    const sec = el.closest ? el.closest(SECTION_SEL) : null;
    if (!sec) return null;
    const m = String(sec.id || '').match(/^sec-(.+)-(\d+)$/);
    if (!m) return { type: '', index: -1 };
    return { type: m[1], index: +m[2] };
  }

  function readPage(doc, win, opts) {
    const O = opts || {};
    const view = { w: win.innerWidth, h: win.innerHeight };
    const root = doc.documentElement;
    const paletteHex = O.paletteHex || {};
    const out = {
      slug: O.slug || '',
      name: O.name || '',
      width: view.w,
      height: view.h,
      footerBelow: Math.max(0, Math.round((doc.body ? doc.body.scrollHeight : root.scrollHeight) - view.h)),
      target: O.target || null
    };

    /* ---- horizontal overflow — the widest element that breaks the screen --- */
    const scrollW = Math.max(root.scrollWidth, doc.body ? doc.body.scrollWidth : 0);
    if (scrollW > view.w + 4) {
      let worst = null;
      const all = doc.querySelectorAll('main *');
      for (let i = 0; i < all.length && i < LIMIT.maxText; i++) {
        const el = all[i];
        const rect = el.getBoundingClientRect();
        if (rect.width <= view.w + 4 || rect.height < 1) continue;
        const right = rect.left + rect.width;
        if (!worst || right > worst.right) {
          const info = sectionOfEl(el, doc) || {};
          worst = {
            right: right,
            width: Math.round(rect.width),
            viewport: view.w,
            text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
            longest: longestWord(el.textContent),
            tag: String(el.tagName || '').toLowerCase(),
            secType: info.type || '',
            secIndex: info.index
          };
        }
      }
      if (worst) out.overflow = worst;
    }

    /* ---- text: contrast, size, line length ------------------------------- */
    const texts = { contrast: [], tiny: [], count: 0 };
    const nodes = doc.querySelectorAll(TEXT_SEL);
    for (let i = 0; i < nodes.length && i < LIMIT.maxText; i++) {
      const el = nodes[i];
      const cs = styleOf(win, el);
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      texts.count++;
      const font = Math.round(parseFloat(cs.fontSize) || 0);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const info = sectionOfEl(el, doc) || {};

      if (font && font < LIMIT.tiny && text.length >= LIMIT.tinyChars) {
        texts.tiny.push({ font: font, text: text.slice(0, 60), tag: String(el.tagName || '').toLowerCase() });
      }

      const fg = parseColor(cs.color);
      const back = backdrop(win, el, paletteHex);
      const need = (font >= 24 || (font >= 18.66 && weight >= 700)) ? LIMIT.aaLarge : LIMIT.aa;
      const floor = back.uncertain ? LIMIT.certain : need;
      let ratio = null;
      let painted = false;
      if (fg && fg.a > 0 && back.color) {
        ratio = contrast(fg, back.color);
      } else if (fg && fg.a === 0) {
        // background-clip: text — the colour lives in the gradient. The worst
        // stop is the honest reading, and only when the backdrop is knowable.
        const stops = gradientStops(cs.backgroundImage);
        painted = true;
        if (stops.length && back.color) ratio = worstContrast(stops, back.color);
      }
      if (ratio != null && ratio < floor) {
        // Which palette role the text colour came from decides whether a palette
        // swap can honestly be offered for it. `muted` and `text` are covered by
        // the product's own check; `primary` and `accent` are the eyebrow and
        // badge roles, which nothing checked until this audit measured them.
        const fgToken = (fg && fg.a) ? (Object.keys(paletteHex).find((k) => paletteHex[k] === toHex(fg)) || '') : '';
        texts.contrast.push({
          ratio: ratio, need: floor, text: text.slice(0, 60), font: font, painted: painted,
          fgToken: fgToken, bgToken: back.token, certain: !back.uncertain,
          secType: info.type || '', secIndex: info.index
        });
      }

      // Reading-line length, measured from the browser's own line boxes rather
      // than estimated from an average character width.
      if (O.checkLines && !texts.lines) {
        const lines = lineCount(doc, el);
        if (lines >= LIMIT.longMinLines && rect.width >= 240) {
          const chars = text.length / lines;
          if (chars > LIMIT.longLine) {
            texts.lines = {
              chars: chars, lines: lines, text: text.slice(0, 60),
              container: Number(O.container) || 0,
              secType: info.type || '', secIndex: info.index
            };
          }
        }
      }
    }
    texts.contrast.sort((a, b) => a.ratio - b.ratio);
    texts.contrast = texts.contrast.slice(0, LIMIT.perFinding);
    texts.tiny = texts.tiny.slice(0, LIMIT.perFinding);
    out.texts = texts;
    if (texts.lines) out.lines = texts.lines;

    /* ---- controls: touch targets ----------------------------------------- */
    const small = [];
    const ctrls = doc.querySelectorAll(CTRL_SEL);
    for (let i = 0; i < ctrls.length && i < LIMIT.maxCtrl; i++) {
      const el = ctrls[i];
      const cs = styleOf(win, el);
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden') continue;
      // Inline links inside a sentence are exempt under WCAG 2.5.8, and there
      // are dozens of them on a copy-heavy page.
      if (cs.display === 'inline') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.height >= LIMIT.tap && rect.width >= LIMIT.tap) continue;
      if (rect.width > view.w || rect.bottom < 0) continue;
      small.push({
        w: Math.round(rect.width), h: Math.round(rect.height),
        text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) || String(el.tagName || '').toLowerCase(),
        top: Math.round(rect.top)
      });
    }
    small.sort((a, b) => (a.w * a.h) - (b.w * b.h));
    out.controls = { small: small.slice(0, LIMIT.perFinding), count: ctrls.length };

    /* ---- sections: spacing, and the opening --------------------------------- */
    const sections = [];
    const secEls = doc.querySelectorAll(SECTION_SEL);
    for (let i = 0; i < secEls.length && i < 60; i++) {
      const el = secEls[i];
      const cs = styleOf(win, el);
      if (!cs || cs.display === 'none') continue;
      const rect = el.getBoundingClientRect();
      const m = String(el.id || '').match(/^sec-(.+)-(\d+)$/);
      const first = doc.querySelector('main section[id^="sec-"], ' + SECTION_SEL);
      sections.push({
        type: m ? m[1] : '', index: m ? +m[2] : i,
        top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height),
        pad: Math.round(parseFloat(cs.paddingTop) || 0),
        isFirst: el === first
      });
    }
    out.sections = sections;
    if (!O.checkSpacing) out.spacing = null;
    else {
      const withPad = sections.filter((s) => s.pad > 0);
      out.spacing = withPad.length && sections.length > 1
        ? { padding: withPad.reduce((min, s) => Math.min(min, s.pad), Infinity), sections: sections.length }
        : null;
    }

    const hero = sections.find((s) => s.type === 'hero') || sections[0] || null;
    if (hero && O.checkHero) {
      const h1 = doc.querySelector('main h1, h1');
      const heading = h1 ? { lines: lineCount(doc, h1), chars: String(h1.textContent || '').replace(/\s+/g, ' ').trim().length } : { lines: 0, chars: 0 };
      // "Invites a tap" means a real control — a button or a nav call to action
      // — whose box the visitor can see without scrolling.
      let tappable = false;
      const cands = doc.querySelectorAll('a,button');
      for (let i = 0; i < cands.length && i < LIMIT.maxCtrl; i++) {
        const el = cands[i];
        const cs = styleOf(win, el);
        if (!cs || cs.display === 'inline' || cs.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.height < 24 || rect.width < 40) continue;
        if (rect.top >= 0 && rect.bottom <= view.h) { tappable = true; break; }
      }
      out.hero = {
        lines: heading.lines,
        chars: heading.chars,
        share: view.h > 0 ? ROUND(hero.height / view.h) : 0,
        tappable: tappable,
        secType: hero.type,
        secIndex: hero.index
      };
    }

    return out;
  }

  // ============================================================
  // 3. audit — the public entry point
  // ============================================================

  let inflight = null;
  let disabled = false;
  let idleTimer = null;

  // The frame stays warm between audits. Creating and discarding an iframe per
  // measurement turned out to be the slow path on this host, and a warm frame
  // makes a repeat audit of an unchanged page immediate — the srcdoc assignment
  // is a no-op, so there is nothing to wait for at all. It is released after a
  // spell of inactivity so a page's DOM is not held forever.
  function keepWarm() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { idleTimer = null; destroy(); }, IDLE_MS);
  }

  function enabled(on) {
    if (on === false) disabled = true;
    if (on === true) disabled = false;
    return !disabled;
  }

  /*
    audit(project, deps) -> Promise<report>

    deps:
      pages      [{ slug, name, html, sections }]  the rendered export
      palettes   the palette catalogue
      paletteId  the palette in use
      copyOptions(type) -> the copy engine, for shorter alternatives
      homeSlug   which page is the home page
      pagesToRead / timeoutMs  cost control

    Always resolves. `ok:false` with a reason means the page could not be
    measured — never that it was clean, which is the distinction the review has
    to be able to make.
  */
  function audit(deps) {
    const D = deps || {};
    // One shape for both outcomes, so a caller never has to guess whether a
    // clean-looking report was measured or handed back empty.
    const empty = (reason) => ({
      ok: false, reason: reason, findings: [], pages: [],
      measured: 0, expected: 0, partial: false, ms: 0, network: false
    });
    if (disabled) return Promise.resolve(empty('the visual audit is switched off'));
    if (!available()) return Promise.resolve(empty('this environment has no renderer to measure in'));
    if (!Array.isArray(D.pages) || !D.pages.length) return Promise.resolve(empty('there was no rendered page to look at'));
    if (inflight) return inflight;

    const started = Date.now();
    const cap = Math.max(1000, Number(D.auditMs) || AUDIT_MS);
    const home = String(D.homeSlug || 'index');
    const perPage = Math.max(1, Number(D.pagesToRead) || 3);
    const timeoutMs = Math.max(300, Number(D.timeoutMs) || MOUNT_MS);
    const list = D.pages.slice(0, perPage);
    const readings = [];
    let partial = false;

    // How many measurements this run intends to take: the home page is read at
    // both widths, every other page on a phone.
    const wanted = list.reduce((n, pg) => n + (String(pg.slug) === home ? 2 : 1), 0);

    const finishUp = () => {
      let findings = [];
      try {
        findings = analyse(readings, {
          palettes: D.palettes || [],
          paletteId: D.paletteId || '',
          pages: (D.pages || []).map((p) => ({ slug: p.slug, name: p.name, sections: p.sections || [] })),
          copyOptions: D.copyOptions
        });
      } catch (e) { findings = []; }
      return {
        ok: true,
        reason: '',
        findings: findings,
        pages: readings,
        measured: readings.length,
        expected: wanted,
        // Some measurements were dropped for time, so the review can say how
        // many pages it really read rather than implying it saw everything.
        partial: partial || readings.length < wanted,
        ms: Date.now() - started,
        network: false
      };
    };

    const step = (i) => {
      // Out of time: stop measuring and report what was measured. A page skipped
      // for time is never quietly counted as a page that passed.
      if (Date.now() - started > cap) {
        if (readings.length) partial = true;
        return finishUp();
      }
      if (i >= list.length) return finishUp();
      const page = list[i];
      const isHome = String(page.slug) === home;
      // The home page is measured at both widths: the opening and the sideways
      // scroll only exist on a phone, the reading column only on a desktop.
      // Secondary pages get the phone pass, which is where they break.
      const passes = isHome ? ['mobile', 'desktop'] : ['mobile'];
      const next = (j) => {
        if (j >= passes.length) return step(i + 1);
        const kind = passes[j];
        const view = WIDTH[kind];
        return mount(page.html, view, timeoutMs).then((doc) => {
          if (doc) {
            const win = doc.defaultView;
            try {
              readings.push(readPage(doc, win, {
                slug: page.slug, name: page.name,
                paletteHex: hexMap(D.paletteId, D.palettes),
                target: kind,
                checkHero: isHome && kind === 'mobile',
                checkLines: kind === 'desktop',
                checkSpacing: kind === 'desktop',
                container: D.containerWidth
              }));
            } catch (e) { /* a page that cannot be read is simply not read */ }
          }
          return next(j + 1);
        });
      };
      return next(0);
    };

    inflight = Promise.resolve()
      .then(() => step(0))
      .then((report) => { inflight = null; keepWarm(); return report; })
      .catch((e) => { inflight = null; keepWarm(); return empty('the measurement failed: ' + ((e && e.message) || 'unknown')); });
    return inflight;
  }

  // Which hex values belong to which palette token, so a painted background can
  // be attributed back to the role a palette swap would change.
  function hexMap(paletteId, palettes) {
    const list = Array.isArray(palettes) ? palettes : [];
    const pal = list.find((p) => p && p.id === paletteId) || null;
    if (!pal) return {};
    const map = {};
    // Backgrounds first, then the colour roles: a token that resolves to the
    // same hex as an earlier one keeps its first name, and the background roles
    // are the ones a fix has to reason about.
    ['bg', 'surface', 'text', 'muted', 'primary', 'accent'].forEach((k) => {
      const c = parseColor(pal[k]);
      // `text` and `muted` are the roles a palette check covers; `primary` and
      // `accent` are recorded so a failing eyebrow can be attributed to its role.
      if (c && !(toHex(c) in map)) map[k] = toHex(c);
    });
    return map;
  }

  return {
    LIMIT, WIDTH,
    contrast, parseColor, luminance, gradientStops, worstContrast, resolveColorMix,
    paletteChecks, aaPalettes, hasLongRun, longestWord,
    analyse, neutralise, audit, available, destroy, enabled,
    hexMap, readPage
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Vision;

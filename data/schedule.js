'use strict';

// ============================================================
// Self-scheduling content — the site that changes itself.
// ------------------------------------------------------------
// Dated announcements that appear and expire on their own inside a static file.
// "Offer ends 20 Dec" disappears after midnight on the 20th; "Christmas hours
// from 18 Dec" switches itself on. No cron, no CMS, no rebuild, no server — the
// date logic travels in the page it belongs to.
//
// This is the other half of Site Care. Site Care can REPORT a stale banner; this
// stops one being possible. The two are deliberately independent: Site Care
// works on sites built before this existed.
//
// WHO DECIDES, AND WHEN. The browser decides, because the file was built once
// and may be opened years later. That creates one tradeoff worth stating plainly:
//
//   * An entry whose window has ALREADY expired at build time is dropped from
//     the export entirely. Shipping dead promo copy serves nobody.
//   * Everything else ships HIDDEN and a small gate script reveals it. So with
//     JavaScript disabled a visitor sees no announcement rather than a December
//     offer in March. That is the right way round: a missed banner is a lost
//     upsell, an expired one is the business looking careless in front of its
//     own customer.
//
// The gate script sits IMMEDIATELY after the strip, not at the end of the body.
// It has to run before the rest of the page paints, or the bar appears and slides
// the page down under the reader's eyes.
// ============================================================

const Schedule = (() => {

  const MAX_ITEMS = 12;
  const MAX_TEXT = 240;
  const MAX_LABEL = 40;

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

  // A bare yyyy-mm-dd parsed by Date() is UTC midnight, which is the PREVIOUS day
  // west of Greenwich — so an "ends 20 Dec" banner would vanish on the 19th for
  // anyone in the Americas. Build it from parts instead.
  function dayStart(value) {
    const m = DATE.exec(String(value == null ? '' : value).trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // Reject a well-formed but impossible date (2026-02-31 rolls over to March).
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return null;
    return d.getTime();
  }

  const todayStart = (now) => {
    const d = now ? new Date(now) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };

  // ---------------------------------------------------------------- normalise
  // Everything the rest of the feature needs to know about one entry, decided
  // once. `ok` is false for anything unusable rather than throwing on it.
  function read(item) {
    if (!item) return null;
    const text = String(item.text == null ? '' : item.text).trim().slice(0, MAX_TEXT);
    if (!text) return null;

    const fromRaw = String(item.from == null ? '' : item.from).trim();
    const toRaw = String(item.to == null ? '' : item.to).trim();
    const from = dayStart(fromRaw);
    const to = dayStart(toRaw);
    // A date the client typed but that we cannot read is NOT the same as no date
    // at all. Treating "20/12" as an open end would ship an entry that never
    // expires, silently and forever — the exact failure this feature exists to
    // stop. So it is flagged as unusable and the studio asks for a real date.
    const unreadable = (raw, ms) => raw !== '' && ms === null;

    const link = String(item.link == null ? '' : item.link).trim();
    // Only https, or a same-site relative page. A schedule entry is authored by
    // the client, and a javascript: URL here would be a script injection on
    // every page of their site.
    const href = /^https:\/\/[^\s]+$/i.test(link) ? link : (/^[a-z0-9][\w./-]*\.html(?:#[\w-]+)?$/i.test(link) ? link : '');

    return {
      id: String(item.id == null ? '' : item.id).slice(0, 60),
      text,
      label: String(item.label == null ? '' : item.label).trim().slice(0, MAX_LABEL),
      href,
      from: fromRaw || '',
      to: toRaw || '',
      fromMs: from,
      toMs: to,
      // A window that runs backwards is a typo, not a plan. Kept, but flagged, so
      // the studio can say so instead of silently shipping nothing.
      ok: !unreadable(fromRaw, from) && !unreadable(toRaw, to)
        && !(from !== null && to !== null && to < from)
    };
  }

  function all(site) {
    return (Array.isArray(site && site.schedules) ? site.schedules : [])
      .slice(0, MAX_ITEMS)
      .map(read)
      .filter(Boolean);
  }

  function phase(item, now) {
    const today = todayStart(now);
    if (item.fromMs !== null && today < item.fromMs) return 'upcoming';
    if (item.toMs !== null && today > item.toMs) return 'expired';
    return 'active';
  }

  // Entries active at a given moment. Pure, so the studio preview and the suite
  // can ask "what would this look like on 12 December?" without a browser.
  function activeAt(site, now) {
    return all(site).filter((i) => i.ok && phase(i, now) === 'active');
  }

  function statusOf(site, now) {
    return all(site).map((i) => ({
      id: i.id,
      text: i.text,
      phase: i.ok ? phase(i, now) : 'invalid',
      from: i.from,
      to: i.to
    }));
  }

  // What actually goes into the export: everything still live or still to come.
  // Expired entries are dropped — this is the half that stops the classic
  // "Christmas offer" embarrassment, and it happens at build time even when the
  // page is never rebuilt.
  function shippable(site, now) {
    return all(site).filter((i) => i.ok && phase(i, now) !== 'expired');
  }

  // ---------------------------------------------------------------- markup
  function stripHtml(site, now) {
    const items = shippable(site, now);
    if (!items.length) return '';
    const rows = items.map((i) => {
      const body = esc(i.label ? i.label + ' ' + i.text : i.text);
      const inner = i.href
        ? `<a href="${esc(i.href)}">${body}</a>`
        : body;
      return `<p class="pai-sched-item" data-from="${esc(i.from)}" data-to="${esc(i.to)}" hidden>${inner}</p>`;
    }).join('');
    // hidden on the wrapper too: nothing here is revealed until the gate runs, so
    // a browser that never runs it shows an empty bar rather than a full one.
    return `<div class="pai-sched" data-pai-sched hidden>${rows}</div>`;
  }

  // FIXED, not in flow. The bar used to be an ordinary block sitting at the top
  // of the document, which meant the export's nav — position:fixed, top:0,
  // z-index:50 — painted straight over it. The bar was there, revealed, measured
  // and correct, and completely invisible on every site the builder produces.
  // Every test agreed because they all read the `hidden` flags rather than
  // asking whether the thing could be seen. Fixed takes it out of the nav's way,
  // and the gate publishes its measured height as --pai-sched-h so the nav,
  // the scroll-progress line and the mobile menu sit below it instead of under
  // it. The height is measured rather than assumed because the text wraps to two
  // lines on a phone.
  function css() {
    return `.pai-sched{position:fixed;top:0;left:0;right:0;z-index:51;margin:0;padding:9px 14px;text-align:center;font-size:.88rem;line-height:1.45;background:color-mix(in srgb,var(--accent,#7cc0f8) 18%,var(--surface,#fff));color:var(--text,#111);border-bottom:1px solid color-mix(in srgb,var(--text,#111) 16%,transparent)}
.pai-sched-item{margin:0}
.pai-sched-item+.pai-sched-item{margin-top:5px}
.pai-sched a{color:inherit;font-weight:700;text-decoration:underline}
/* Belt and braces: a UA [hidden] rule loses to any author display rule, and this
   bar is nothing but display rules nearby. An un-revealed promo must not be able
   to show itself through a cascade accident. */
.pai-sched[hidden],.pai-sched .pai-sched-item[hidden]{display:none}
@media print{.pai-sched{display:none}}`;
  }

  // ---------------------------------------------------------------- gate
  // Runs immediately after the strip, before the rest of the body parses, so the
  // bar is either there for the first paint or never appears at all. It does not
  // use `hidden` for the reveal decision alone: the wrapper is hidden in the
  // markup so a page that never runs this shows nothing rather than a full bar.
  //
  // A missing attribute is an OPEN end — no start date means it has always
  // applied, no end date means it never lapses. `read()` has already refused to
  // ship a date it could not parse, so an unreadable value here cannot occur; if
  // one somehow does, it reads as an open bound rather than hiding the entry.
  function gateScript() {
    return '(function(){'
      + 'function ms(v){'
      // getAttribute yields null or a string, so this is the same test as
      // `v===null||v===""` for 18 bytes less on every page in the export.
      + 'if(!v)return null;'
      + 'var m=/^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(String(v));'
      + 'if(!m)return null;'
      + 'return new Date(+m[1],+m[2]-1,+m[3]).getTime();'
      + '}'
      + 'var strip=document.querySelector("[data-pai-sched]");'
      + 'if(!strip)return;'
      + 'var day=new Date(),today=new Date(day.getFullYear(),day.getMonth(),day.getDate()).getTime();'
      + 'var items=strip.children,shown=0;'
      + 'for(var i=0;i<items.length;i++){'
      + 'var el=items[i],from=ms(el.getAttribute("data-from")),to=ms(el.getAttribute("data-to"));'
      + 'if((from===null||today>=from)&&(to===null||today<=to)){el.hidden=false;shown++;}'
      + '}'
      + 'if(shown)strip.hidden=false;'
      // Publish the measured height so everything else pinned to the top of the
      // page can move down by exactly this much. Set even when nothing is live,
      // so a previous value can never linger and leave a gap. Re-measured on
      // resize because the message wraps differently at phone widths.
      + 'var root=document.documentElement;'
      + 'function fit(){root.style.setProperty("--pai-sched-h",(strip.hidden?0:strip.offsetHeight)+"px");}'
      + 'fit();'
      + 'if(shown)addEventListener("resize",fit);'
      + '})();';
  }

  return { all, read, phase, activeAt, statusOf, shippable, stripHtml, css, gateScript, dayStart, MAX_ITEMS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Schedule;
if (typeof window !== 'undefined') window.Schedule = Schedule;

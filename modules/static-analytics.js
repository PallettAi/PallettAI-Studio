'use strict';
// ============================================================
// PallettAI Studio — cookie-less privacy analytics & conversion
// tracker. Inline event dispatchers for the privacy-first
// providers plus a direct sendBeacon path for self-hosted
// endpoints — no cookies, no identifiers, no third-party state.
// ------------------------------------------------------------
//   1. generateAnalyticsScript(provider, config) → inline JS
//        'plausible'       — plausible('Goal', {props}) behind the
//                            official queue stub
//        'fathom'          — fathom('trackEvent', name); queue stub
//                            mirrors fathom-client's pattern
//                            (trackGoal was deprecated in 2023)
//        'simpleanalytics' — sa_event(name), Simple Analytics'
//                            documented global with its placeholder
//                            queue; names sanitized to [A-Za-z0-9_]
//        'beacon'          — navigator.sendBeacon(url, JSON) to a
//                            self-hosted endpoint, fetch keepalive
//                            as the fallback; cookie-less payload
//                            {event, url, referrer, timestamp, props}
//      Triggers (auto-wired, one delegated listener each): form
//      submits, outbound link clicks, file downloads, plus any
//      element carrying the config attribute (default
//      [data-analytics-event]). A marked element fires ONLY its
//      own name, so a tagged outbound link never double-counts.
//   2. trackScrollDepthAndTime() → the milestone snippet:
//      25/50/75/100% scroll depth (each exactly once) and ACTIVE
//      time-on-page (seconds accrue only while document.hidden is
//      false) with 30/60/120/300s milestones and a final total on
//      pagehide. Dispatch rides window.paiTrack, so the snippet
//      also works standalone.
//
// ---- what this file guarantees ----------------------------------
// 1. NO COOKIES, EVER: the payload never reads document.cookie and
//    carries no user identifier — URL, referrer, timestamp and
//    event data only, which is what keeps Plausible/Fathom/SA-style
//    telemetry consent-free in most jurisdictions.
// 2. ONE DISPATCH WINDOW: window.paiTrack(name, props) is the
//    public API; every auto-trigger and the scroll/time snippet
//    route through it, so overriding it captures everything.
// 3. FAIL-SILENT TRIGGERS: a missing provider global, a blocked
//    beacon or a weird href never throws into the page's own
//    click/submit handling.
// 4. BUILD-TIME VALIDATION: unknown providers, missing beacon
//    endpoints and non-http endpoints throw typed codes here, not
//    silently in a visitor's browser.
// ============================================================

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const SCROLL_MILESTONES = [25, 50, 75, 100];
const TIME_MILESTONES = [30, 60, 120, 300];

const DOWNLOAD_EXTENSIONS = [
  'pdf', 'zip', 'rar', '7z', 'gz', 'doc', 'docx', 'xls', 'xlsx',
  'ppt', 'pptx', 'csv', 'txt', 'dmg', 'exe', 'apk', 'pkg', 'mp3',
  'wav', 'mp4', 'mov', 'webm', 'epub', 'key', 'psd', 'ai', 'sketch'
];

const PROVIDERS = {
  plausible: 'plausible',
  fathom: 'fathom',
  simpleanalytics: 'simpleanalytics',
  'simple-analytics': 'simpleanalytics',
  sa: 'simpleanalytics',
  beacon: 'beacon',
  webhook: 'beacon',
  custom: 'beacon'
};

const DEFAULT_EVENT_NAMES = {
  outbound: 'Outbound link clicked',
  download: 'File download',
  form: 'Form submitted',
  scroll: 'Scroll depth',
  time: 'Time on page'
};

function normalizeProvider(provider) {
  const key = PROVIDERS[String(provider == null ? '' : provider).toLowerCase().trim()];
  if (!key) {
    throw fail('unknown_provider', 'Unknown provider "' + String(provider)
      + '". Use plausible, fathom, simpleanalytics, or beacon.');
  }
  return key;
}

const jsonSafe = (obj) => JSON.stringify(obj)
  .replace(/<\//g, '<\\/')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

// ============================================================
// trackScrollDepthAndTime — milestones + active time snippet
// ============================================================

function trackScrollDepthAndTime(config) {
  const c = config || {};
  const names = Object.assign({}, DEFAULT_EVENT_NAMES, c.names || {});
  const cfg = {
    s: String(names.scroll),
    t: String(names.time),
    sMs: Array.isArray(c.scrollMilestones) ? c.scrollMilestones.slice() : SCROLL_MILESTONES.slice(),
    tMs: Array.isArray(c.timeMilestones) ? c.timeMilestones.slice() : TIME_MILESTONES.slice()
  };
  return '(function(){'
    + 'var C=' + jsonSafe(cfg) + ',F=window.paiTrack||function(){},'
      + 'd={},tm={},s=0,raf=0,fin=0;'
    // scroll depth: rAF-gated, each milestone fires exactly once
    + 'function depth(){raf=0;'
      + 'var h=document.documentElement,'
        + 'max=(h.scrollHeight-innerHeight)||1,'
        + 'pct=Math.min(100,Math.round(((window.scrollY||h.scrollTop)||0)/max*100));'
      + 'for(var i=0;i<C.sMs.length;i++){var v=C.sMs[i];'
        + 'if(pct>=v&&!d[v]){d[v]=1;'
          + 'F(C.s+" "+v+"%",{depth:String(v),url:location.href});}}}'
    + 'addEventListener("scroll",function(){'
      + 'if(!raf)raf=requestAnimationFrame(depth)},{passive:true});'
    // active time: 1s ticks only while the tab is visible
    + 'setInterval(function(){'
      + 'if(document.hidden)return;'
      + 's++;'
      + 'for(var i=0;i<C.tMs.length;i++){var v=C.tMs[i];'
        + 'if(s>=v&&!tm[v]){tm[v]=1;'
          + 'F(C.t+" "+v+"s",{seconds:String(v),url:location.href});}}'
      + '},1000);'
    // final total exactly once, on the last reliable lifecycle hook
    + 'addEventListener("pagehide",function(){'
      + 'if(!fin&&s>0){fin=1;'
        + 'F(C.t+" completed",{seconds:String(s),url:location.href});}});'
    + 'depth();'
    + '})();';
}

// ============================================================
// generateAnalyticsScript — provider dispatch + auto triggers
// ============================================================

function analyticsConfig(provider, config) {
  const c = config || {};
  const names = Object.assign({}, DEFAULT_EVENT_NAMES, c.names || {});
  return {
    p: provider,
    // beacon target (only meaningful for the beacon provider)
    ep: c.endpoint || '',
    f: c.fields && typeof c.fields === 'object' ? c.fields : {},
    // trigger flags
    forms: c.forms !== false,
    out: c.outbound !== false,
    dl: c.downloads !== false,
    attr: c.attribute || 'data-analytics-event',
    sc: c.scrollDepth !== false,
    tm: c.timeOnPage !== false,
    ext: Array.isArray(c.extensions)
      ? c.extensions.map((e) => String(e).toLowerCase().replace(/^\./, ''))
      : DOWNLOAD_EXTENSIONS.slice(),
    n: names
  };
}

function providerSend(p) {
  switch (p) {
    case 'plausible':
      // Official loader pattern: queue until the async script boots.
      return 'window.plausible=window.plausible||function(){'
        + '(window.plausible.q=window.plausible.q||[]).push(arguments)};'
        + 'function S(n,pr){'
        + 'window.plausible(n,pr&&Object.keys(pr).length?{props:pr}:undefined)}';
    case 'fathom':
      // fathom-client's queue stub. S re-reads window.fathom on
      // every call so the loaded tracker (which replaces the
      // stub) receives the events; trackEvent-with-object is the
      // current API, the plain call covers the stub era.
      return 'window.fathom=window.fathom||function(){'
        + '(window.fathom.q=window.fathom.q||[]).push(arguments)};'
        + 'function S(n,pr){var f=window.fathom;if(!f)return;'
        + 'f.trackEvent?f.trackEvent(n):f("trackEvent",n)}';
    case 'simpleanalytics':
      // Documented placeholder global, verbatim shape.
      return 'window.sa_event=window.sa_event||function(){'
        + 'var a=[].slice.call(arguments);'
        + 'window.sa_event.q=window.sa_event.q||[];'
        + 'window.sa_event.q.push(a)};'
        + 'function S(n){window.sa_event(String(n).replace(/[^A-Za-z0-9_]/g,"_"))}';
    default: // beacon
      return 'function S(n,pr){'
        + 'var b=JSON.stringify(Object.assign({},C.f,{'
          + 'event:n,url:location.href,'
          + 'referrer:document.referrer||"",'
          + 'timestamp:new Date().toISOString(),props:pr||{}}));'
        + 'if(!navigator.sendBeacon||!navigator.sendBeacon(C.ep,b))'
          + 'fetch(C.ep,{method:"POST",keepalive:true,'
          + 'headers:{"content-type":"application/json"},body:b})'
          + '.catch(function(){})}';
  }
}

function generateAnalyticsScript(provider, config) {
  const p = normalizeProvider(provider);
  const c = analyticsConfig(p, config);
  if (p === 'beacon') {
    if (!c.ep) {
      throw fail('missing_credential', 'The beacon provider needs config.endpoint.');
    }
    if (!/^https?:\/\//i.test(c.ep)) {
      throw fail('bad_input', 'Beacon endpoint must be an http(s) URL.');
    }
  }

  return '(function(){'
    + 'var C=' + jsonSafe(c) + ';'
    // single public dispatch window used by triggers AND the
    // scroll/time snippet
    + 'function fire(n,pr){try{S(n,pr)}catch(e){}}'
    + 'window.paiTrack=fire;'
    + providerSend(p) + ';'
    // delegated click: marked element > outbound > download
    + 'document.addEventListener("click",function(e){'
      + 'var r=e.target,x;'
      + 'if(!r||!r.closest)return;'
      + 'x=r.closest("["+C.attr+"]");'
      + 'if(x){fire(x.getAttribute(C.attr)||"Engaged element",'
        + '{href:x.href||""});return;}'
      + 'if(!C.out&&!C.dl)return;'
      + 'var a=r.closest("a[href]");if(!a)return;'
      // split instead of a regex — no escaping minefield, and
      // mailto:/tel:/javascript: (no ://) fall to the download check
      + 'var h=a.getAttribute("href")||"",seg=h.split("://");'
      + 'var host=h.replace(/^[a-z][a-z0-9+.-]*:\\/\\//i,"")'
        + '.split("/")[0].split("@").pop().split(":")[0].toLowerCase();'
      // seg.length>1: only real scheme:// URLs are outbound —
      // mailto:/tel:/javascript: fall through to the download check
      + 'if(C.out&&seg.length>1&&host&&host!==location.hostname.toLowerCase()){'
        + 'fire(C.n.outbound,{href:h,host:host});return;}'
      + 'if(!C.dl)return;'
      + 'var path=h.split("#")[0].split("?")[0],'
        + 'ext=path.slice(path.lastIndexOf(".")+1).toLowerCase();'
      + 'if(path.lastIndexOf(".")>-1&&C.ext.indexOf(ext)>-1)'
        + 'fire(C.n.download,{href:h,ext:ext});'
    + '});'
    // form submits
    + (c.forms ? 'document.addEventListener("submit",function(e){'
      + 'var f=e.target;if(!f||!f.getAttribute)return;'
      + 'fire(C.n.form,{id:f.id||"",name:f.getAttribute("name")||""});'
      + '});' : '')
    // scroll + active time milestones
    + ((c.sc || c.tm)
      ? (c.sc && c.tm ? trackScrollDepthAndTime({ names: c.n })
        : c.sc ? trackScrollDepthAndTime({ names: c.n, timeMilestones: [] })
          : trackScrollDepthAndTime({ names: c.n, scrollMilestones: [] }))
      : '')
    + '})();';
}

module.exports = {
  SCROLL_MILESTONES,
  TIME_MILESTONES,
  DOWNLOAD_EXTENSIONS,
  DEFAULT_EVENT_NAMES,
  PROVIDERS,
  normalizeProvider,
  trackScrollDepthAndTime,
  generateAnalyticsScript
};

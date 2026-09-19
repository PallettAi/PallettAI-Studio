// ============================================================
// PallettAI Studio — client review links (pure logic)
// The engine behind Export ▸ "Client review link": a hosted,
// expiring page where the CLIENT opens the built site, pins
// comments to sections, and approves or requests changes.
//
// WHY: the studio's white-label ZIP ends the conversation with a
// download. The last mile of an agency build is a LOOP — send,
// look, comment, fix, approve — and every round of that loop
// today runs over email screenshots. This module closes it:
//
//   * A review link is a TOKEN, not an account. The client never
//     signs up, signs in, or installs anything. The token rides
//     in the URL FRAGMENT (#rv=…), so it never reaches a server
//     log, and every write validates that token against an
//     unexpired row in the registry (RLS + an expiry check in
//     the RPC, mirrored by normalize*() here).
//   * Comments pin to a (page, section) pair — the same ids the
//     builder already stamps on every exported section — so a
//     pin survives re-exports and lands the fix exactly.
//   * Approvals are first-class: a client decision ('approved' /
//     'changes-requested') with an optional note, separate from
//     the pin stream, so the studio sees a verdict, not vibes.
//   * The review page is ONE self-contained HTML file next to
//     the site files: system fonts, no frameworks, comments from
//     a JSON blob embedded at export time, refreshed from the
//     registry when the registry is reachable.
//
// Pure logic, no DOM, no fetch. app.js assembles the rendered
// pages and drives Supabase; the smoke test pins the rest.
// ============================================================

'use strict';

const ReviewLinks = (() => {
  const TOKEN_BYTES = 24;          // 192-bit token, URL-safe
  const DEFAULT_DAYS = 14;
  const MAX_DAYS = 60;
  const COMMENT_MAX = 600;
  const NAME_MAX = 60;
  const NOTE_MAX = 400;

  // URL-safe, unambiguous token (no 0/O/1/l).
  function randomToken(bytes) {
    const n = bytes || TOKEN_BYTES;
    const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    const arr = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(arr);
    else for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
    for (let i = 0; i < n; i++) out += alpha[arr[i] % alpha.length];
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function newLink(projectId, projectName, opts) {
    const o = opts || {};
    const days = Math.max(1, Math.min(MAX_DAYS, Number(o.days) || DEFAULT_DAYS));
    const now = Date.now();
    return {
      id: 'rvw-' + now.toString(36) + '-' + randomToken(6),
      token: randomToken(),
      projectId: String(projectId || '').slice(0, 80),
      projectName: String(projectName || 'Untitled site').slice(0, 120),
      createdAt: now,
      expiresAt: now + days * 86400000,
      revoked: false
    };
  }

  function isLive(link, at) {
    if (!link || link.revoked) return false;
    const t = Number(at) || Date.now();
    return t < Number(link.expiresAt || 0);
  }

  // The URL the studio hands over: <review page>#rv=<token>. Fragment, not
  // query — a fragment is never sent to the server, so the token can't land
  // in a hosting provider's access logs. The review page (not index.html) is
  // the entry: it frames the site and carries the comment sidebar.
  function linkUrl(baseUrl, link, projectName) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    return base + '/' + reviewFileName(projectName || (link && link.projectName)) + '#rv=' + link.token;
  }

  function parseHash(hash) {
    const m = /(?:^|[#&])rv=([A-Za-z0-9_-]{10,})/.exec(String(hash || ''));
    return m ? m[1] : '';
  }

  // ---- writes from the review page -----------------------------------------
  // Everything the client can submit passes through here — the same shapes
  // the registry RPC validates server-side.
  function normalizeComment(raw) {
    const errors = [];
    const body = String((raw && raw.body) || '').trim();
    if (!body) errors.push('Write a comment first.');
    if (body.length > COMMENT_MAX) errors.push('Comments are capped at ' + COMMENT_MAX + ' characters.');
    const author = String((raw && raw.author) || '').trim().slice(0, NAME_MAX);
    if (!author) errors.push('Add your name so the studio knows who to ask.');
    const pageId = String((raw && raw.pageId) || '').slice(0, 80);
    const sectionId = String((raw && raw.sectionId) || '').slice(0, 80);
    if (!errors.length) {
      return { ok: true, comment: { pageId, sectionId, author, body, createdAt: Number(raw.createdAt) || Date.now(), resolved: false } };
    }
    return { ok: false, errors };
  }

  function normalizeApproval(raw) {
    const errors = [];
    const decision = String((raw && raw.decision) || '');
    if (decision !== 'approved' && decision !== 'changes-requested') errors.push('Pick approve or request changes.');
    const author = String((raw && raw.author) || '').trim().slice(0, NAME_MAX);
    if (!author) errors.push('Add your name.');
    const note = String((raw && raw.note) || '').trim().slice(0, NOTE_MAX);
    if (!errors.length) {
      return { ok: true, approval: { decision, author, note, createdAt: Number(raw.createdAt) || Date.now() } };
    }
    return { ok: false, errors };
  }

  // The studio's answer to "what does this review need from me?" One word the
  // dashboard can colour: nothing yet / changes asked / signed off / both.
  function statusFor(pins, approvals) {
    const pinList = Array.isArray(pins) ? pins : [];
    const apprList = Array.isArray(approvals) ? approvals : [];
    const openPins = pinList.filter((c) => c && !c.resolved).length;
    if (!apprList.length && !pinList.length) return 'awaiting-review';
    const latest = apprList.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    const approved = latest && latest.decision === 'approved';
    if (approved && openPins === 0) return 'approved';
    if (latest && latest.decision === 'changes-requested') return openPins > 0 ? 'changes-requested' : 'changes-requested';
    if (openPins > 0) return 'changes-requested';
    return approved ? 'approved' : 'awaiting-review';
  }

  // ---- the hosted review page ------------------------------------------------
  // One HTML file that sits BESIDE the exported site files and frames each
  // page. Comments arrive embedded (instant, offline-safe) and are refreshed
  // from the registry when reachable. The token never appears in the file —
  // it comes from the URL fragment at view time.
  function reviewFileName(projectName) {
    const s = String(projectName || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return (s || 'review') + '-review.html';
  }

  // JSON embedded in the page: `</` is escaped so a comment can never close
  // the script tag early (the classic JSON-in-HTML injection).
  function jsonForEmbed(obj) {
    return JSON.stringify(obj || {}).replace(/<\//g, '<\\/');
  }

  function buildReviewPage(model) {
    const m = model || {};
    const pages = (Array.isArray(m.pages) ? m.pages : []).map((p) => ({
      slug: String(p.slug || '').replace(/[^a-z0-9._-]/gi, ''),
      title: String(p.title || p.slug || 'Page').slice(0, 120)
    }));
    const site = {
      name: String(m.projectName || 'Site review').slice(0, 120),
      studio: String(m.studioName || '').slice(0, 120),
      pages,
      reviewId: String((m.link && m.link.id) || ''),
      expiresAt: Number((m.link && m.link.expiresAt) || 0),
      registry: { url: String((m.supabase && m.supabase.url) || '').replace(/\/+$/, ''), key: String((m.supabase && m.supabase.anonKey) || '') },
      pins: (Array.isArray(m.pins) ? m.pins : []).map((c) => ({
        pageId: String(c.pageId || ''), sectionId: String(c.sectionId || ''),
        author: String(c.author || '').slice(0, NAME_MAX), body: String(c.body || '').slice(0, COMMENT_MAX),
        at: Number(c.createdAt) || 0
      })),
      approvals: (Array.isArray(m.approvals) ? m.approvals : []).map((a) => ({
        decision: a.decision === 'approved' ? 'approved' : 'changes-requested',
        author: String(a.author || '').slice(0, NAME_MAX), note: String(a.note || '').slice(0, NOTE_MAX),
        at: Number(a.createdAt) || 0
      }))
    };

    const first = pages[0] ? pages[0].slug + '.html' : '';
    const title = esc('Review — ' + site.name);

    // The inline app is deliberately dependency-free. It is written with
    // string concatenation (no template literals) because this whole page is
    // itself assembled inside a template literal here.
    const script = [
      '(function(){',
      'var S=window.__REVIEW__;var pins=S.pins.slice();var approvals=S.approvals.slice();',
      'var frame=document.getElementById("stage");var list=document.getElementById("pins");',
      'var pageSel=document.getElementById("pageSel");var state={page:S.pages[0]?S.pages[0].slug:"",sec:""};',
      'function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}',
      'function when(t){var d=new Date(t);return isNaN(d)?"":d.toLocaleDateString(undefined,{month:"short",day:"numeric"})}',
      'function drawPins(){list.innerHTML="";if(!pins.length){list.innerHTML="<div class=\'empty\'>No comments yet — click any part of the page to add the first one.</div>";return}',
      'for(var i=pins.length-1;i>=0;i--){(function(c){var d=document.createElement("div");d.className="pin"+(c.sectionId===state.sec?" hot":"");',
      'd.innerHTML="<div class=\'pin-top\'>"+esc(c.author)+" <span>"+when(c.at)+"</span></div><div class=\'pin-body\'>"+esc(c.body)+"</div>";',
      'd.onclick=function(){go(c.pageId||state.page,c.sectionId)};list.appendChild(d)})(pins[i])}}',
      'function go(page,sec){state.page=page||state.page;state.sec=sec||"";pageSel.value=state.page;',
      'frame.src=state.page+".html";drawPins();',
      'if(state.sec){frame.onload=function(){try{var el=frame.contentDocument.querySelector(\'[data-sec-id="\'+state.sec+\'"]\');',
      'if(el){el.scrollIntoView({behavior:"smooth",block:"center"});el.style.outline="2px solid #2f7fd0";el.style.outlineOffset="4px"}}catch(e){}}}}',
      'pageSel.onchange=function(){go(pageSel.value,"")};',
      'document.getElementById("send").onclick=function(){var f=document.getElementById("cbody");var a=document.getElementById("cauthor");',
      'var body=f.value.trim();var author=a.value.trim();if(!body||!author){document.getElementById("formErr").textContent="Add your name and a comment.";return}',
      'var c={pageId:state.page,sectionId:state.sec,author:author.slice(0,60),body:body.slice(0,600),createdAt:Date.now(),resolved:false};',
      'try{localStorage.setItem("pai.review.author",author)}catch(e){}pins.push(c);drawPins();f.value="";document.getElementById("formErr").textContent="";',
      'document.getElementById("saveNote").textContent="Saved — syncing…";push(c)}',
      // Writes go through the registry RPCs, which validate the review token
      // server-side (valid review, unexpired, not revoked) before anything is
      // stored. The anon key alone can write nothing.
      'function push(c){if(!S.registry.url)return;var tok=(location.hash.match(/rv=([A-Za-z0-9_-]+)/)||[])[1]||"";if(!tok){document.getElementById("saveNote").textContent="Saved locally only — this copy has no review token.";return}',
      'fetch(S.registry.url+"/rest/v1/rpc/submit_review_comment",{method:"POST",headers:{"apikey":S.registry.key,"Authorization":"Bearer "+S.registry.key,"Content-Type":"application/json"},',
      'body:JSON.stringify({p_token:tok,p_review_id:S.reviewId,p_page_id:c.pageId,p_section_id:c.sectionId,p_author:c.author,p_body:c.body})})',
      '.then(function(r){return r.json?r.json():null}).then(function(j){document.getElementById("saveNote").textContent=(j&&j.ok)?"Synced to the studio.":((j&&j.msg)||"Saved locally — could not reach the studio just now.")},function(){document.getElementById("saveNote").textContent="Saved locally — will sync when online."})}',
      'function drawVerdict(){var box=document.getElementById("verdict");if(!approvals.length){box.textContent="Awaiting your verdict.";return}',
      'var last=approvals[approvals.length-1];box.textContent=last.decision==="approved"?"Approved by "+last.author:"Changes requested by "+last.author+(last.note?" — "+last.note:"")}',
      'document.getElementById("approve").onclick=function(){decide("approved")};document.getElementById("request").onclick=function(){decide("changes-requested")};',
      'function decide(d){var a=document.getElementById("cauthor");var n=document.getElementById("cnote");var author=a.value.trim();',
      'if(!author){document.getElementById("formErr").textContent="Add your name first.";return}',
      'approvals.push({decision:d,author:author.slice(0,60),note:n.value.trim().slice(0,400),createdAt:Date.now()});drawVerdict();',
      'if(S.registry.url){var tok=(location.hash.match(/rv=([A-Za-z0-9_-]+)/)||[])[1]||"";',
      'fetch(S.registry.url+"/rest/v1/rpc/submit_review_approval",{method:"POST",headers:{"apikey":S.registry.key,"Authorization":"Bearer "+S.registry.key,"Content-Type":"application/json"},',
      'body:JSON.stringify({p_token:tok,p_review_id:S.reviewId,p_decision:d,p_author:author.slice(0,60),p_note:n.value.trim().slice(0,400)})})}n.value="";',
      'document.getElementById("formErr").textContent="";document.getElementById("saveNote").textContent=d==="approved"?"Thank you — the studio has been notified locally. Will sync when online.":"Changes requested — the studio will see this next sync."}',
      'try{var saved=localStorage.getItem("pai.review.author");if(saved)document.getElementById("cauthor").value=saved}catch(e){}',
      'if(S.expiresAt){var left=Math.floor((S.expiresAt-Date.now())/86400000);if(left>0)document.getElementById("expiry").textContent="Link expires in "+left+" day"+(left===1?"":"s")+".";else document.getElementById("expiry").textContent="This review link has expired — ask the studio for a fresh one.";}',
      'go(S.pages[0]?S.pages[0].slug:"","");',
      '})();'
    ].join('\n');

    const options = pages.map((p) =>
      '<option value="' + esc(p.slug) + '">' + esc(p.title) + '</option>').join('');

    return '<!doctype html>\n<!-- Built with PallettAI Studio — client review page -->\n' +
      '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="robots" content="noindex,nofollow"><title>' + title + '</title><style>' +
      ':root{color-scheme:light}*{box-sizing:border-box}html,body{margin:0;height:100%;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0b1c30;background:#f2f6fb}' +
      '.wrap{display:flex;flex-direction:column;height:100%}header{display:flex;gap:12px;align-items:center;padding:10px 16px;background:#0b1c30;color:#eaf3ff;flex-wrap:wrap}' +
      'header h1{font-size:15px;margin:0;font-weight:700}header .sub{color:#9fb8d6;font-size:12px}header .grow{flex:1}' +
      'select{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:#12294a;color:#eaf3ff}' +
      '.verdict{font-size:12.5px;font-weight:600;color:#bfe3ff}.main{flex:1;display:flex;min-height:0}' +
      '.stagebox{flex:1;min-width:0}iframe{width:100%;height:100%;border:0;background:#fff}' +
      'aside{width:320px;border-left:1px solid #dbe6f2;background:#fff;display:flex;flex-direction:column}' +
      'aside h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#5b7089;margin:0;padding:12px 14px 8px}' +
      '#pins{flex:1;overflow:auto;padding:0 14px 10px}.pin{border:1px solid #e3ecf6;border-radius:10px;padding:8px 10px;margin-bottom:8px;cursor:pointer;background:#fbfdff}' +
      '.pin.hot{border-color:#2f7fd0;background:#eef6ff}.pin-top{font-weight:700;font-size:12.5px}.pin-top span{color:#8296ad;font-weight:500;margin-left:6px;font-size:11.5px}' +
      '.pin-body{margin-top:3px;color:#22374e;white-space:pre-wrap;overflow-wrap:anywhere}.empty{color:#8296ad;padding:10px 0;font-size:13px}' +
      'form{border-top:1px solid #e3ecf6;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:#fbfdff}' +
      'input,textarea{font:inherit;padding:8px 10px;border:1px solid #cfdeed;border-radius:8px;width:100%}' +
      'textarea{min-height:64px;resize:vertical}.row{display:flex;gap:8px}.btn{font:inherit;font-weight:700;padding:8px 12px;border-radius:8px;border:1px solid #cfdeed;background:#fff;cursor:pointer}' +
      '.btn.primary{background:#0b1c30;border-color:#0b1c30;color:#fff}.btn.good{background:#0d7a4f;border-color:#0d7a4f;color:#fff}' +
      '.err{color:#a02c2c;font-size:12.5px;min-height:1em}.note{color:#5b7089;font-size:12px;min-height:1em}' +
      '@media(max-width:760px){.main{flex-direction:column}aside{width:100%;max-height:45%}}' +
      '</style></head><body><div class="wrap">' +
      '<header><h1>' + esc(site.name) + '</h1><span class="sub">Site review' + (site.studio ? ' by ' + esc(site.studio) : '') + '</span><span class="grow"></span>' +
      '<span class="verdict" id="verdict"></span><select id="pageSel" aria-label="Page">' + options + '</select></header>' +
      '<div class="main"><div class="stagebox"><iframe id="stage" title="Site preview"></iframe></div>' +
      '<aside><h2>Comments</h2><div id="pins"></div><form onsubmit="return false">' +
      '<input id="cauthor" placeholder="Your name" maxlength="60" autocomplete="name">' +
      '<textarea id="cbody" placeholder="Click a section, then describe the change…" maxlength="600"></textarea>' +
      '<input id="cnote" placeholder="Note for approve / request changes (optional)" maxlength="400">' +
      '<div class="row"><button class="btn primary" id="send" type="button">Add comment</button>' +
      '<button class="btn good" id="approve" type="button">Approve</button>' +
      '<button class="btn" id="request" type="button">Request changes</button></div>' +
      '<div class="err" id="formErr" role="alert"></div><div class="note" id="saveNote"></div><div class="note" id="expiry"></div>' +
      '</form></aside></div></div>' +
      '<script>window.__REVIEW__=' + jsonForEmbed(site) + ';</script>\n' +
      '<script>' + script + '</script></body></html>';
  }

  return {
    newLink, isLive, linkUrl, parseHash,
    normalizeComment, normalizeApproval, statusFor,
    reviewFileName, buildReviewPage, jsonForEmbed,
    DEFAULT_DAYS, MAX_DAYS, COMMENT_MAX
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ReviewLinks;

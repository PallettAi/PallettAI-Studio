'use strict';

(function (root) {
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
  function island(items, id) {
    const safe = JSON.stringify(Array.isArray(items) ? items : []).replace(/</g, '\\u003c');
    return `<script type="application/json" id="${esc(id || 'pai-cms-data')}">${safe}</script>`;
  }
  function helper(opts) {
    const id = JSON.stringify((opts && opts.id) || 'pai-cms-data');
    return `<script data-pai="static-search">(function(){var d=document.getElementById(${id}),items=[];try{items=JSON.parse(d&&d.textContent||'[]')}catch(e){};window.PallettAISearch={all:function(){return items.slice()},find:function(q){q=String(q||'').toLowerCase().trim();return items.filter(function(x){return !q||JSON.stringify(x).toLowerCase().indexOf(q)>-1})}}}());</script>`;
  }
  const api = { island, helper, esc };
  if (root) root.PallettAIDataIslands = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));

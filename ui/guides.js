'use strict';
(function () {
  const guides = [
    ['Design DNA', 'Choose one archetype first. Change structure, type, rhythm and motion—not only colour.'],
    ['WCAG contrast', 'Body text should reach 4.5:1 against normal surfaces; large text should reach 3:1. Always test focus states.'],
    ['SEO launch check', 'Give every page a descriptive title, meta description, one clear H1, useful alt text and working canonical links.'],
    ['Client facts', 'Treat prices, contact details, opening hours and service names as immutable facts during copy rewrites.'],
    ['Static exports', 'Keep content portable: prefer semantic HTML, progressive enhancement and no mandatory runtime or API key.'],
    ['Prompt craft', 'Name the audience, desired action, tone, constraints and examples. Ask for a point of view, not a generic modern website.']
  ];
  function render() {
    const root = document.querySelector('#guidesRoot'); if (!root) return;
    root.innerHTML = `<div class="guides-head"><div><span class="eyebrow">OFFLINE KNOWLEDGE BASE</span><h2>Studio Guides</h2><p>Practical direction for building distinctive, accessible sites without leaving Studio.</p></div><input type="search" id="guideSearch" placeholder="Search guides…" aria-label="Search Studio guides"></div><div class="guide-grid" id="guideGrid"></div>`;
    const paint = (q) => { q = String(q || '').toLowerCase(); document.querySelector('#guideGrid').innerHTML = guides.filter(g => !q || g.join(' ').toLowerCase().includes(q)).map((g, i) => `<article class="guide-card"><span>0${i + 1}</span><h3>${g[0]}</h3><p>${g[1]}</p></article>`).join('') || '<p class="empty-state">No guide matched that search.</p>'; };
    $('#guideSearch').addEventListener('input', e => paint(e.target.value)); paint('');
  }
  const $ = (s) => document.querySelector(s);
  window.PallettAIGuides = { open: render, guides };
  document.addEventListener('click', (e) => { if (e.target.closest('[data-view="guides"]')) setTimeout(render, 0); });
})();

'use strict';

(function () {
  let selected = null;
  const frame = () => document.querySelector('#previewFrame');
  function send(action, instruction) {
    const f = frame(); if (!f || !f.contentWindow || !selected) return;
    f.contentWindow.postMessage({ channel: 'pai-preview', type: 'section-copilot', action, section: selected, instruction: instruction || '' }, '*');
    if (window.PallettAISectionCopilot && typeof window.PallettAISectionCopilot.onRequest === 'function') window.PallettAISectionCopilot.onRequest({ action, section: selected, instruction: instruction || '' });
  }
  function toolbar() {
    let bar = document.querySelector('#sectionCopilotBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'sectionCopilotBar'; bar.className = 'section-copilot-bar'; bar.setAttribute('role', 'toolbar'); document.body.appendChild(bar); }
    bar.innerHTML = `<span>Section ${selected.index + 1}</span><button data-copilot-action="mutate">Mutate section</button><button data-copilot-action="layout">Change layout</button><button data-copilot-action="copy">Rewrite copy</button>`;
    bar.hidden = false;
  }
  function select(message) { selected = { pageId: String(message.pageId || ''), index: Number(message.index) }; if (!Number.isInteger(selected.index) || selected.index < 0) return; toolbar(); }
  window.PallettAISectionCopilot = { select, clear: () => { selected = null; const b = document.querySelector('#sectionCopilotBar'); if (b) b.hidden = true; }, onRequest: null };
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-copilot-action]'); if (!b || !selected) return; const action = b.dataset.copilotAction; const instruction = action === 'layout' ? 'Change this section to a different layout variant while preserving its facts.' : action === 'copy' ? 'Rewrite only this section copy for clarity and specificity.' : 'Mutate this section into a more distinctive composition while preserving its facts.'; send(action, instruction); });
  window.addEventListener('message', (e) => { const f = frame(); if (!f || e.source !== f.contentWindow || !e.data || e.data.channel !== 'pai-preview') return; if (e.data.type === 'select-section') select(e.data); });
})();

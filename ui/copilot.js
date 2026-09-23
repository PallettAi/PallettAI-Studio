'use strict';

/*
  The section toolbar — "which section am I working on?" and the three things a
  client most often wants to do with the answer.

  It deliberately does NOT edit the project. Every action becomes a sentence in
  the Copilot chat, so the change travels the same path as a typed request: the
  same planner, the same credit accounting, the same single undo step, and the
  same honest refusal when the request makes no sense. A second, lookalike
  mutation path is exactly how an editor ends up with two behaviours for one
  sentence.

  The sentences are fixed and each is one the planner is known to understand:

    copy   — "Make the second section punchier" rewrites that exact section.
    layout — a catalog variant belonging to THIS section's own type. A variant
             phrase names its own kind (see AI.layoutOptions), so offering a
             foreign one would edit a different section.
    mutate — "Make the second section " with the caret at the end. The planner has
             no generic "make this more interesting" op, so this one is a prompt
             bar, not a claim: it hands over the sentence, the client finishes it.

  The old version posted a section-copilot message into the preview iframe. The
  exported page has no listener for that channel, so the message went nowhere
  while the button looked like it did something. Nothing here posts into the
  frame now — the frame's channel is one-way, from the exported page to Studio.
*/
(function () {
  let selected = null;
  const frame = () => document.querySelector('#previewFrame');

  function active() {
    return selected && Number.isInteger(selected.index) && selected.index >= 0;
  }

  function label() {
    const type = String((selected && selected.type) || '');
    const name = type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Section';
    return 'Section ' + (selected.index + 1) + ' \u00b7 ' + name;
  }

  function note(text) {
    const el = document.querySelector('#sectionCopilotBar [data-copilot-note]');
    if (el) el.textContent = text || '';
  }

  function toolbar() {
    let bar = document.querySelector('#sectionCopilotBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'sectionCopilotBar';
      bar.className = 'section-copilot-bar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Actions for the selected section');
      document.body.appendChild(bar);
    }
    bar.innerHTML = '<span data-copilot-label></span>'
      + '<button type="button" data-copilot-action="copy">Rewrite copy</button>'
      + '<button type="button" data-copilot-action="layout">Change layout</button>'
      + '<button type="button" data-copilot-action="mutate">Mutate section\u2026</button>'
      + '<button type="button" data-copilot-action="close" title="Clear the selection">\u00d7</button>'
      + '<span data-copilot-note class="copilot-note"></span>';
    bar.hidden = false;
    const title = bar.querySelector('[data-copilot-label]');
    if (title) title.textContent = label();
    note('');
  }

  function select(message) {
    const index = Number(message && message.index);
    if (!Number.isInteger(index) || index < 0) return;
    selected = {
      pageId: String((message && message.pageId) || ''),
      index: index,
      type: String((message && message.type) || '')
    };
    toolbar();
  }

  function clear() {
    selected = null;
    const bar = document.querySelector('#sectionCopilotBar');
    if (bar) bar.hidden = true;
  }

  function send(action) {
    if (!active()) return;
    const api = window.PallettAISectionCopilot;
    if (!api || typeof api.onRequest !== 'function') {
      note('Copilot is unavailable in this build.');
      return;
    }
    const request = { action: action, section: { pageId: selected.pageId, index: selected.index, type: selected.type } };
    const result = api.onRequest(request);
    // A handler that returns a sentence has already shown it in the chat; one
    // that cannot serve the request says why, in the bar, next to the button that
    // asked — not in a toast that has already faded by the time they look.
    if (typeof result === 'string' && result) note(result);
  }

  window.PallettAISectionCopilot = {
    select: select,
    clear: clear,
    current: () => (active() ? { pageId: selected.pageId, index: selected.index, type: selected.type } : null),
    note: note,
    onRequest: null
  };

  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-copilot-action]');
    if (!button || !active()) return;
    const action = button.dataset.copilotAction;
    if (action === 'close') { clear(); return; }
    send(action);
  });

  window.addEventListener('message', (e) => {
    const f = frame();
    if (!f || e.source !== f.contentWindow || !e.data || e.data.channel !== 'pai-preview') return;
    if (e.data.type === 'select-section') select(e.data);
  });
})();

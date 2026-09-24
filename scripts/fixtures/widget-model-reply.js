'use strict';

/*
  A canned model reply, for the real-app widget smoke.

  The smoke drives the Widget Studio for real: the panel asks the main process
  (ipcRenderer 'widget:generate'), the main process asks WidgetGenerator, and
  WidgetGenerator asks whatever completer is installed. This file is the answer
  the completer gives, so the suite can exercise the WHOLE path — prompt,
  parsing, sanitising, token resolution, injection, preview and export — with no
  API key, no network and no dependence on what a model feels like saying today.

  Everything after the reply is the real thing: the same compiler, the same
  sanitising, the same injector the export uses. Only the model's words are
  fixed, because a test that varies with a model's mood is not a test.

  The reply is the documented primary shape — one JSON envelope, no fences, no
  commentary — and it is composed here as real, readable code rather than as an
  escaped one-line string, because a fixture nobody can read is a fixture nobody
  maintains. It goes out through JSON.stringify, so what the compiler receives is
  exactly the text a model would have sent.

  The widget is a roofing quote estimator because that is the brief's own
  example, and it deliberately uses the tokens the system prompt asks for
  (var(--color-primary), var(--color-surface), …) so the suite can prove the
  visitor-facing tool was painted from the project's palette.
*/

const payload = {
  id: 'roofing-quote-estimator',
  title: 'Roofing quote estimator',
  html: `<div class="rq-card">
  <p class="rq-kicker">Roof replacement</p>
  <div class="rq-grid">
    <label class="rq-label" for="rqArea">Roof size (square metres)</label>
    <input class="rq-input" id="rqArea" type="number" min="10" max="2000" step="5" value="80" inputmode="numeric" data-pallett-field="area">
    <label class="rq-label" for="rqMaterial">Covering</label>
    <select class="rq-input" id="rqMaterial" data-pallett-field="material">
      <option value="concrete" selected>Concrete tile</option>
      <option value="clay">Clay tile</option>
      <option value="slate">Natural slate</option>
    </select>
    <label class="rq-label" for="rqPitch">Pitch</label>
    <select class="rq-input" id="rqPitch" data-pallett-field="pitch">
      <option value="low">Low (under 20 degrees)</option>
      <option value="standard" selected>Standard (20 to 40 degrees)</option>
      <option value="steep">Steep (over 40 degrees)</option>
    </select>
  </div>
  <button class="rq-go" type="button" data-pallett-go>Show my estimate</button>
  <p class="rq-out" data-pallett-out role="status" aria-live="polite">Enter the roof details for an indicative range.</p>
  <p class="rq-note">An indicative range for planning only &mdash; a survey confirms the final price.</p>
</div>`,
  css: `.rq-card{display:grid;gap:1rem;padding:1.4rem;border:1px solid var(--color-border,rgba(127,127,127,.3));border-radius:var(--color-radius,12px);background:var(--color-surface,rgba(127,127,127,.06));color:var(--color-text,inherit);}
.rq-kicker{margin:0;font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--color-muted,#8a94a6);}
.rq-grid{display:grid;gap:.4rem .9rem;grid-template-columns:1fr;}
.rq-label{font-size:.86rem;font-weight:600;}
.rq-input{width:100%;padding:.6rem .7rem;border:1px solid var(--color-border,rgba(127,127,127,.35));border-radius:calc(var(--color-radius,12px) / 1.6);background:var(--color-background,#fff);color:var(--color-text,inherit);font:inherit;}
.rq-input:focus-visible{outline:2px solid var(--color-primary,#5b8cff);outline-offset:2px;}
.rq-go{margin-top:.2rem;padding:.75rem 1rem;border:0;border-radius:calc(var(--color-radius,12px) / 1.6);background:var(--color-primary,#5b8cff);color:var(--color-on-primary,#fff);font:inherit;font-weight:650;cursor:pointer;transition:transform .15s ease;}
.rq-go:hover{transform:translateY(-1px);}
.rq-out{margin:0;font-size:1.05rem;font-weight:650;}
.rq-note{margin:0;font-size:.78rem;color:var(--color-muted,#8a94a6);}
@media (min-width:620px){.rq-grid{grid-template-columns:1fr 1fr;}}
@media (prefers-reduced-motion:reduce){.rq-go{transition:none}.rq-go:hover{transform:none}}`,
  js: `var RATE = { concrete: 62, clay: 78, slate: 138 };
var PITCH = { low: 0.93, standard: 1, steep: 1.16 };
function field(name) { return root.querySelector('[data-pallett-field="' + name + '"]'); }
function money(value) { return 'GBP ' + Math.round(value).toLocaleString('en-GB'); }
var out = root.querySelector('[data-pallett-out]');
var go = root.querySelector('[data-pallett-go]');
function range() {
  var areaEl = field('area');
  var area = Number(areaEl && areaEl.value) || 0;
  var rate = RATE[(field('material') || {}).value] || RATE.concrete;
  var factor = PITCH[(field('pitch') || {}).value] || 1;
  return { area: area, low: area * rate * factor * 0.88, high: area * rate * factor * 1.14 };
}
function paint() {
  if (!out) return;
  var r = range();
  if (!r.area || r.area < 10) { out.textContent = 'Enter a roof size of at least 10 square metres for a range.'; return; }
  var covering = (field('material') || {}).value || 'concrete';
  out.textContent = 'Indicative range: ' + money(r.low) + ' to ' + money(r.high) + ' for ' + r.area + ' square metres of ' + covering + ' covering.';
}
if (go) go.addEventListener('click', paint);
['area', 'material', 'pitch'].forEach(function (name) {
  var el = field(name);
  if (el) el.addEventListener('change', paint);
});
paint();`
};

module.exports = {
  // Exactly what a model would return: one JSON envelope, nothing else.
  reply: JSON.stringify(payload),
  id: payload.id,
  title: payload.title,
  // The values the smoke changes the form to before it presses the button.
  probe: { area: '200', material: 'slate', pitch: 'steep' }
};

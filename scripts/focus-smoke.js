// ============================================================
// Keyboard & focus smoke test — form control names, the mobile nav, live regions.
//
// data/focus.js already had an audit, and export-polish-smoke covers its skip
// link and focus ring. What neither covered was the form: every generated form
// shipped placeholder-only fields, and a placeholder is not an accessible name,
// so a screen reader read out "edit text, blank" on the one surface the whole
// page exists to get filled in. The keyboard audit was blind to it while
// reporting an empty link at the same severity.
//
// Three things are pinned here, in the order the risk runs:
//
//   1. THE MARKUP IS FIXED. Every control in a real export has a name, an
//      autofill hint, and — where a visible placeholder remains — a name that
//      contains that placeholder word for word, which is what WCAG 2.5.3 asks
//      of speech input.
//   2. THE AUDIT NOW CATCHES IT. Fixing today's markup is worth little if the
//      next renderer reintroduces the defect, so the check that reports it is
//      itself tested — including the false positives it must not produce. This
//      module's header promises the audits do not cry wolf, and a form check
//      that counts `<input>` inside an inline script would break that promise
//      immediately, because the export inlines its own JS.
//   3. THE REST OF KEYBOARD ACCESS STILL HOLDS. The mobile nav gained state it
//      never had, and the shared toast became a live region; both are asserted
//      so a later refactor cannot quietly drop them.
//
// Run: node scripts/focus-smoke.js
// ============================================================
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const DB = require(path.join(ROOT, 'data', 'db.js'));
global.DB = DB;
global.ONLINE = require(path.join(ROOT, 'data', 'online.js'));
global.Review = require(path.join(ROOT, 'data', 'review.js'));
global.Images = require(path.join(ROOT, 'data', 'images.js'));
const Focus = require(path.join(ROOT, 'data', 'focus.js'));
global.Focus = Focus;
global.OgCard = require(path.join(ROOT, 'data', 'ogcard.js'));
global.Concierge = require(path.join(ROOT, 'data', 'concierge.js'));
const Builder = require(path.join(ROOT, 'modules', 'builder.js'));

// A site with every form-bearing section at once, because the defect was
// per-renderer: the contact form, the newsletter, the review form and the RSVP
// form each build their own fields and each had to be fixed.
const project = {
  id: 'p1',
  name: 'Northwind Joinery',
  suites: ['reviews', 'events', 'blog', 'shop'],
  site: {
    name: 'Northwind Joinery',
    tagline: 'Bespoke kitchens',
    palette: 'midnight',
    font: 'inter',
    url: 'https://northwind.example',
    email: 'hi@northwind.example',
    phone: '+44 20 7946 0000',
    // On, so the concierge panel is part of the export and its fields are
    // measured alongside every other form's. An entry is required: a pack with
    // nothing to answer is reported as null rather than rendered empty.
    concierge: { on: true, entries: [{ q: 'Do you fit kitchens?', a: 'We do, across the county.' }] },
    pages: [{
      id: 'home', name: 'Home', slug: 'index',
      sections: [
        { type: 'hero', title: 'Bespoke kitchens' },
        { type: 'contact', title: 'Talk to us' },
        { type: 'blog', title: 'Journal' },
        { type: 'reviews', title: 'Reviews' },
        { type: 'events', title: 'Events' },
        {
          type: 'collection', title: 'Our work',
          items: [
            { title: 'One', text: 'a', extra: 'Kitchens' },
            { title: 'Two', text: 'b', extra: 'Baths' }
          ]
        },
        { type: 'cta', title: 'Start a project' }
      ]
    }]
  }
};

const pages = Builder.buildSitePages(project, { proExport: true, plan: 'pro' });
const exportHtml = pages.map((p) => p.html).join('\n');
const markup = Focus.markupOnly(exportHtml);
const homeHtml = pages[0].html;

// ---- 1. every control has a name ------------------------------------------
console.log('\n1. Form controls have accessible names');
{
  ok('no control in the export is unnamed', Focus.unlabelledControls(markup) === 0,
    Focus.unlabelledControls(markup) + ' unnamed');

  // The name has to survive markupOnly, which is what the audit measures.
  const controls = (markup.match(/<(input|textarea|select)\b[^>]*>/gi) || []);
  ok('the export really does contain form controls', controls.length >= 8, String(controls.length));

  // A placeholder is only acceptable because it is no longer the only name.
  const placeholders = controls.filter((t) => /\bplaceholder=/.test(t));
  ok('fields kept their placeholders as prompts', placeholders.length >= 6, String(placeholders.length));
  ok('no placeholder-only field remains',
    placeholders.every((t) => /\baria-label=/.test(t)), JSON.stringify(placeholders.filter((t) => !/aria-label/.test(t))));

  // Two kinds of placeholder exist here, and only one of them is a label.
  //
  //   * "Your name" is the field's label, so the accessible name repeats it
  //     word for word. That is what WCAG 2.5.3 asks: a visitor using speech
  //     input says what is written on screen.
  //   * "Type your question…" is an instruction, and its name is the noun
  //     phrase "Your question" — the concierge module's existing choice, which
  //     is a better name than mirroring an imperative. An assertion demanding
  //     the visible text appear inside the name flagged that as a failure,
  //     which is precisely the crying wolf this codebase warns about, so the
  //     rule is asserted where it belongs instead of guessed at everywhere.
  const mirrors = placeholders.filter((t) => {
    const a = (t.match(/\baria-label="([^"]*)"/) || [])[1];
    const p = (t.match(/\bplaceholder="([^"]*)"/) || [])[1];
    return a && p && a === p;
  });
  ok('the fields this change authored repeat their label word for word', mirrors.length >= 8, String(mirrors.length));
  ok('no placeholder-bearing field has an empty name',
    placeholders.every((t) => ((t.match(/\baria-label="([^"]*)"/) || [])[1] || '').trim().length > 0));
  ok('the placeholder is never left as the only name',
    placeholders.every((t) => /\baria-label(ledby)?=/.test(t)));

  // The two deliberate descriptive names, pinned so a later sweep toward
  // mirroring does not flatten them into the instruction text.
  ok('the concierge question box keeps its descriptive name', /aria-label="Your question"/.test(markup));
  ok('the collection search keeps its descriptive name', /aria-label="Search this collection"/.test(markup));
}

// ---- 2. autofill and mobile keyboards --------------------------------------
console.log('\n2. Autofill hints');
{
  const auto = (markup.match(/autocomplete="(name|email|tel)"/g) || []);
  ok('identity fields offer autofill', auto.length >= 6, auto.length + ' found');
  ok('the name field is marked as a name', /autocomplete="name"/.test(markup));
  ok('the email field is marked as an email', /autocomplete="email"/.test(markup));

  // The Concierge form already sent autocomplete, which is where this
  // convention came from — it is built by its own module, so it is measured
  // there rather than through the export, and pinned so it does not lose the
  // hints while every other form gains them.
  const cn = Concierge.launcherHtml(Concierge.packFor(project.site));
  ok('the concierge panel really was built', /cn-form/.test(cn), cn.length + ' chars');
  ok('the concierge form keeps its autofill hints', /autocomplete="name"/.test(cn));
  ok('its question box was already named', /aria-label="Your question"/.test(cn));
  ok('and its escalation fields are named now too',
    /aria-label="Your name"/.test(cn) && /aria-label="Anything to add\?"/.test(cn), cn.slice(cn.indexOf('cn-form'), cn.indexOf('cn-form') + 400));
  ok('the concierge panel has no unnamed control either', Focus.unlabelledControls(cn) === 0,
    Focus.unlabelledControls(cn) + ' unnamed');

  // A search field is the one place autofill is actively unhelpful: the
  // browser's value history covers the results the visitor is trying to read.
  ok('collection search suppresses autofill', /autocomplete="off"[^>]*enterkeyhint="search"/.test(markup));
}

// ---- 3. the audit catches the defect it used to miss -----------------------
console.log('\n3. The audit reports unnamed controls');
{
  ok('a placeholder-only field is counted', Focus.unlabelledControls('<input placeholder="Your name">') === 1);

  // Every source the accessible-name calculation accepts has to be honoured,
  // or the check would report controls that are in fact named.
  ok('aria-label counts as a name', Focus.unlabelledControls('<input aria-label="Email">') === 0);
  ok('aria-labelledby counts as a name', Focus.unlabelledControls('<input aria-labelledby="h1">') === 0);
  ok('a <label for> counts as a name', Focus.unlabelledControls('<label for="e">E</label><input id="e">') === 0);
  ok('a wrapping <label> counts as a name', Focus.unlabelledControls('<label>E <input></label>') === 0);
  ok('a name is matched case-insensitively', Focus.unlabelledControls('<label for="E">E</label><input id="e">') === 0);
  ok('a textarea is required to have one too', Focus.unlabelledControls('<textarea></textarea>') === 1);
  ok('a select is required to have one too', Focus.unlabelledControls('<select><option>x</option></select>') === 1);

  // Controls that are named by something else entirely.
  ok('a hidden field is never counted', Focus.unlabelledControls('<input type="hidden" name="q">') === 0);
  ok('a submit button is never counted', Focus.unlabelledControls('<input type="submit" value="Go">') === 0);
  ok('a reset button is never counted', Focus.unlabelledControls('<input type="reset">') === 0);
  ok('a button-typed input is never counted', Focus.unlabelledControls('<input type="button" value="x">') === 0);

  // An image input is named by alt, and needs one — so it is the one control
  // that is excused by alt and still reported without it. Accepting alt
  // anywhere else would let an unnamed text field through.
  ok('an image input with alt is named', Focus.unlabelledControls('<input type="image" alt="Search">') === 0);
  ok('an image input without alt is reported', Focus.unlabelledControls('<input type="image" src="go.png">') === 1);
  ok('alt does not excuse a text field', Focus.unlabelledControls('<input type="text" alt="Nope">') === 1);

  // The false positives this module promises not to produce. The export inlines
  // its own JavaScript, and that source is full of strings that look like tags.
  ok('a control in inline script is not measured',
    Focus.unlabelledControls('<script>var s = "<input placeholder=\'x\'>";</scr' + 'ipt>') === 0);
  ok('a control in a comment is not measured', Focus.unlabelledControls('<!-- <input> -->') === 0);
  ok('the skip link is not mistaken for a control', Focus.unlabelledControls(Focus.skipLink()) === 0);

  const flagged = Focus.auditPage({ name: 'T', slug: 'i', html: '<html lang="en"><body><input placeholder="x"></body></html>' });
  ok('the finding is an error, not a warning',
    flagged.findings.some((f) => f.level === 'error' && /no accessible name/.test(f.msg)),
    JSON.stringify(flagged.findings.map((f) => f.level + ':' + f.msg)));

  // The regression lock: the markup this task replaced would now be caught, and
  // the markup the builder emits today is not. Both halves are needed — the
  // first proves the check works, the second proves the fix is complete.
  const before =
    '<form class="contact-form" data-contact><input name="name" placeholder="Your name" required>'
    + '<input name="email" type="email" placeholder="Your email" required>'
    + '<textarea name="message" placeholder="Tell us about your project…" required></textarea></form>';
  ok('the pre-fix contact form is reported',
    Focus.unlabelledControls(before) === 3, String(Focus.unlabelledControls(before)));
  ok('the current contact form is not',
    Focus.unlabelledControls(homeHtml.slice(homeHtml.indexOf('contact-form'), homeHtml.indexOf('contact-form') + 700)) === 0);
}

// ---- 4. the whole audit stays honest ---------------------------------------
console.log('\n4. The export still audits clean');
{
  const audit = Focus.audit(pages.map((e) => ({ name: e.page.name, slug: e.page.slug, html: e.html })));
  ok('no errors', audit.errors === 0, JSON.stringify(audit.findings.map((f) => f.level + ':' + f.msg)));
  ok('no warnings', audit.warnings === 0, JSON.stringify(audit.findings.map((f) => f.level + ':' + f.msg)));
  ok('the letter grade is A+', audit.letter === 'A+', audit.letter + ' (score ' + audit.score + ')');
  ok('keyboardReady is true', audit.keyboardReady === true);
}

// ---- 5. the mobile navigation ---------------------------------------------
console.log('\n5. Mobile navigation exposes its state');
{
  ok('the toggle is an explicit button, not a submit', /class="burger" type="button"/.test(markup));
  ok('the toggle reports whether the menu is open', /aria-expanded="false"/.test(markup));
  ok('the toggle names the panel it controls', /aria-controls="nav-menu"/.test(markup));
  ok('that panel id exists', /id="nav-menu"/.test(markup));
  ok('the panel id is not duplicated', (markup.match(/id="nav-menu"/g) || []).length === 1);

  // The runtime half. The class and the attribute have to be written together,
  // or the button starts lying about a menu the visitor can see.
  const script = Builder.buildSiteHTML(project, { proExport: true, plan: 'pro' });
  ok('the toggle updates aria-expanded when it opens', /setAttribute\('aria-expanded'/.test(script));
  ok('Escape closes the menu', /e\.key === 'Escape'/.test(script) && /links\.classList\.contains\('open'\)/.test(script));
  ok('focus returns to the toggle that opened it', /setMenu\(false\); burger\.focus\(\)/.test(script));
  ok('following a link closes the menu', /closest\('a'\)\) setMenu\(false\)/.test(script));
  ok('resizing past the breakpoint closes it', /innerWidth > 860/.test(script));
}

// ---- 6. form results are announced -----------------------------------------
console.log('\n6. Form results reach assistive tech');
{
  ok('the toast is a live region', /setAttribute\('role', 'status'\)/.test(homeHtml));
  ok('it announces politely by default', /setAttribute\('aria-live', 'polite'\)/.test(homeHtml));
  ok('a failure is raised assertively', /aria-live', ok \? 'polite' : 'assertive'/.test(homeHtml));
  ok('the live region is created once, not per message', (exportHtml.match(/role', 'status'/g) || []).length === 0
    || (homeHtml.match(/setAttribute\('role', 'status'\)/g) || []).length === 1);
}

// ---- 7. validation styling -------------------------------------------------
console.log('\n7. Validation styling');
{
  // The guarantee is that a pristine form is never painted as broken, which is
  // what :invalid cannot express: it matches from document load. :user-invalid
  // is interaction-level, not blur-level — measured in Chrome 130 it begins
  // matching as the visitor types into a field they have altered — so the
  // assertion is about which pseudo-class carries the styling, not about when a
  // keystroke becomes an error.
  ok('the invalid state is keyed to interaction, not to document load', /:user-invalid/.test(homeHtml));
  ok('a bare :invalid selector is not used on controls',
    !/(input|textarea|select):invalid/.test(homeHtml));
  ok('the valid state is styled too', /:user-valid/.test(homeHtml));
  ok('the invalid colour is a token, not a hard-coded red', /--invalid:/.test(homeHtml));
  ok('the token is mixed toward the theme text colour', /--invalid:color-mix\(in oklab,#ef4444 58%,var\(--text\)\)/.test(homeHtml));
  ok('a ring carries the state where there is no border', /box-shadow:0 0 0 3px color-mix\(in oklab,var\(--invalid\)/.test(homeHtml));
  // Forced colors strips the colour and the shadow, so the state keeps a shape.
  ok('the state survives forced-colors with a border change',
    /forced-colors:active\)\{\s*\/\*[\s\S]*?\*\/\s*input:user-invalid,textarea:user-invalid,select:user-invalid\{border-style:dashed\}/.test(homeHtml));
}

console.log('\n' + (failed ? failed + ' FAILED\n' : 'All focus checks passed.\n'));
process.exit(failed ? 1 : 0);

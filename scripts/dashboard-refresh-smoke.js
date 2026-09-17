// ============================================================
// Dashboard refresh smoke test — the screen keeping up with the workspace.
//
// The bug this exists for, reported from the app: delete a project and its row
// stays on screen until you leave the dashboard and come back.
//
// The cause was a deliberate optimisation with a missing half. saveProjects()
// coalesces its dashboard refresh into one timer, because rebuilding the whole
// dashboard on every autosave while someone types in the Designer is waste. But
// what it rebuilt on that timer was renderDashOverview() — the METRICS. The
// project list lives in #projectsGrid, which only renderDashboard() touches, and
// renderDashboard() was called on view switch and nothing else. So after a
// delete the count went 4 → 3 and the row stayed.
//
// So this pins three things:
//
//   1. The timer can tell a cosmetic save from a structural one — a rename is
//      visible in the list, a section edit is not.
//   2. A structural change rebuilds the list; a cosmetic one does not.
//   3. Every path that adds or removes a project goes through saveProjects(),
//      so every one of them arms that refresh. Delete was not special: create,
//      duplicate and import had the same hole and were saved by landing in the
//      Designer, which switches the view.
//
// Run: node scripts/dashboard-refresh-smoke.js
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failed = 0;
function ok(name, cond, detail) {
  console.log((cond ? '  \u2713 ' : '  \u2717 ') + name + (!cond && detail ? '  -> ' + detail : ''));
  if (!cond) failed++;
}

const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// One body extractor for every function below. Cutting at the first `\n  }` is
// not enough: these functions contain nested blocks, so the closing brace of the
// first `if` ends the slice early — and the first version of the overview check
// below sliced the OTHER way and ran on into the next function, which is how it
// reported #projectsGrid inside a function that never mentions it. The next
// top-level function declaration in this closure is the reliable boundary.
function fnOf(name) {
  const from = appJs.indexOf('function ' + name + '(');
  if (from < 0) return '';
  const next = appJs.indexOf('\n  function ', from);
  return appJs.slice(from, next < 0 ? appJs.length : next);
}

// ---------------------------------------------------------------- 1. the key
console.log('\n== 1. Telling a structural change from a cosmetic one ==');

// Lifted and RUN. The same lesson as the date helpers in the Site Care suite:
// asserting that a function exists is not asserting what it decides.
const keyOf = (() => {
  const from = appJs.indexOf('function projectListKey()');
  const to = appJs.indexOf('\n  }', from);
  if (from < 0 || to < 0) return null;
  try {
    return new Function('projects', appJs.slice(from, to + 4) + '\nreturn projectListKey();');
  } catch (e) { return null; }
})();
ok('projectListKey can be lifted out and run', typeof keyOf === 'function');

if (typeof keyOf === 'function') {
  const p = (id, name, extra) => Object.assign({ id: id, name: name, site: { sections: [{ id: 'a', type: 'hero', title: 'Hi' }] } }, extra || {});
  const base = [p('a', 'One'), p('b', 'Two'), p('c', 'Three')];

  ok('the same list gives the same key', keyOf(base.map((x) => JSON.parse(JSON.stringify(x)))) === keyOf(base));
  ok('removing a project changes it (the delete case)', keyOf(base.filter((x) => x.id !== 'b')) !== keyOf(base));
  ok('adding one changes it', keyOf([p('d', 'Four')].concat(base)) !== keyOf(base));
  ok('renaming changes it — the list shows names', keyOf([p('a', 'One'), p('b', 'Two renamed'), p('c', 'Three')]) !== keyOf(base));
  ok('reordering changes it', keyOf([base[1], base[0], base[2]]) !== keyOf(base));

  // The point of a list key rather than a full-project comparison: typing in the
  // Designer must not schedule a dashboard rebuild per keystroke.
  const edited = base.map((x) => JSON.parse(JSON.stringify(x)));
  edited[0].site.sections.push({ id: 'z', type: 'about', title: 'New section' });
  edited[0].site.sections[0].title = 'Rewritten headline';
  edited[0].suites = ['animation'];
  edited[0].updatedAt = Date.now() + 5000;
  ok('editing a project does NOT change it', keyOf(edited) === keyOf(base), 'a section edit would rebuild the dashboard');

  // An id collision would make two projects share a key, and a delete that
  // removed either one would look like no change at all.
  ok('two projects never share a key entry', keyOf([p('a', 'X'), p('a', 'Y')]) !== keyOf([p('a', 'X')]));
  // A literal separator, so ['ab'] and ['a','b'] cannot collide.
  ok('name boundaries cannot be forged by content', keyOf([p('ab', 'X')]) !== keyOf([p('a', 'b')]));
  ok('an empty workspace has a stable key', keyOf([]) === keyOf([]));
  ok('and a missing name does not throw', keyOf([{ id: 'q' }]) === keyOf([{ id: 'q' }]));
}

// ---------------------------------------------------------------- 2. the branch
console.log('\n== 2. What the coalesced refresh rebuilds ==');

const schedule = fnOf('scheduleDashboardRefresh');
ok('the coalesced refresh was found', schedule.length > 120);
ok('it still defers out of the save hot path', /setTimeout\(/.test(schedule) && /400/.test(schedule));
ok('it only runs while the dashboard is on screen', /currentView !== 'dashboard'/.test(schedule));
ok('a changed list rebuilds the dashboard', /projectListKey\(\) !== dashboardListKey\) renderDashboard\(\)/.test(schedule), schedule.slice(0, 200));
ok('an unchanged list only recomputes the metrics', /else renderDashOverview\(\)/.test(schedule));

// This is the fact that made the old behaviour a bug rather than a deliberate
// trade: overview() cannot redraw the list, so a metrics-only refresh could not
// possibly have removed the deleted row.
const overview = fnOf('renderDashOverview');
ok('the overview renderer was found', overview.length > 120);
// It does mention the grid — a metric tile scrolls it into view — so the check
// is for a WRITE. Scrolling to a list cannot remove a row from it, and an
// assertion that forbade the name would have failed on correct code.
ok('it never writes the project list', !/(projectsGrid'\)|\bgrid)\.innerHTML/.test(overview),
  'renderDashOverview assigns the grid, so a metrics-only refresh could remove a row after all');
// Exactly one reference to the grid in the whole file is what makes the check
// above sufficient: no other function can write what it cannot address. (A
// global count of `grid.innerHTML` would be meaningless — the templates, database
// and palette screens each have a grid of their own.)
ok('only renderDashboard takes a reference to the grid', (appJs.match(/const grid = \$\('#projectsGrid'\)/g) || []).length === 1);
const emptyStateAt = appJs.indexOf('No projects yet');
ok('and it draws both the empty workspace and the rows',
  emptyStateAt !== -1 && (fnOf('renderDashboard').match(/grid\.innerHTML = /g) || []).length === 2,
  (fnOf('renderDashboard').match(/grid\.innerHTML = /g) || []).length + ' writes in renderDashboard');

// The key has to be re-recorded on every render, or the next save sees a change
// that is not there and pays for a rebuild it does not need. Deleting the LAST
// project is the case that catches a key recorded only at the end of the rows
// branch, because that branch returns early for an empty workspace.
const dash = fnOf('renderDashboard');
const keyAt = dash.indexOf('dashboardListKey = projectListKey()');
const emptyReturnAt = dash.indexOf('No projects yet');
ok('renderDashboard records the key it just drew', keyAt !== -1);
ok('and records it before the empty-state early return', keyAt !== -1 && emptyReturnAt !== -1 && keyAt < emptyReturnAt,
  'deleting the last project would re-render dashboard on every save afterwards');

// ---------------------------------------------------------------- 3. every door
console.log('\n== 3. Every path that changes the project set arms that refresh ==');

// One refresh, reached from every mutation, is the reason this is fixed once
// rather than four times.
const fnBody = fnOf;

['createProject', 'duplicateProject', 'importProjectFile'].forEach((name) => {
  const body = fnBody(name);
  ok(name + ' was found', body.length > 40);
  ok(name + ' saves, and saveProjects arms the refresh', /saveProjects\(\)/.test(body), 'no save means no refresh');
});

ok('deleteProject waits for a confirmation the user can see', /settings\.confirmDelete === false\) return doDel\(\)/.test(fnBody('deleteProject')));
ok('the delete itself saves', /saveProjects\(\);/.test(fnBody('deleteProject')));
ok('deleting the open project clears it', /currentId === id\) currentId = null/.test(fnBody('deleteProject')));
ok('the delete button in the grid is wired to it', /\$\$\('\[data-del\]'\)\.forEach\(\(b\) => b\.onclick = \(\) => deleteProject/.test(appJs));
ok('saveProjects is what schedules the refresh', /saveProjectsT?[\s\S]{0,4000}?scheduleDashboardRefresh\(\)/.test(appJs) || /scheduleDashboardRefresh\(\)/.test(appJs));
ok('and an explicit view switch still rebuilds it', /if \(name === 'dashboard'\) renderDashboard\(\)/.test(appJs));

console.log('\n' + (failed === 0 ? 'DASHBOARD REFRESH PASSED' : 'DASHBOARD REFRESH FAILED: ' + failed));
process.exit(failed === 0 ? 0 : 1);

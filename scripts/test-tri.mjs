#!/usr/bin/env node
// Test harness for tri.mjs. Run: node scripts/test-tri.mjs
// Builds a throwaway workspace in a temp dir, seeds defects, asserts behavior.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRI = join(dirname(fileURLToPath(import.meta.url)), 'tri.mjs');
let passed = 0, failed = 0;

function run(cwd, args, expectFail = false) {
  if (args[0] === 'init' && !args.includes('--id-strategy')) args = [...args, '--id-strategy', 'sequential'];
  if (args[0] !== 'init' && existsSync(join(cwd, 'tri.config.json')) && !existsSync(join(cwd, '.git'))) initGit(cwd);
  try {
    const out = execFileSync('node', [TRI, ...args], { cwd, encoding: 'utf8' });
    if (expectFail) throw new Error(`expected failure, got success:\n${out}`);
    return out;
  } catch (e) {
    if (expectFail) return (e.stdout ?? '') + (e.stderr ?? '');
    throw e;
  }
}

function gitRun(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function recordEvidence(cwd, id, name = 'test') {
  return run(cwd, ['evidence', id, '--name', name, '--', 'node', '-e', 'process.exit(0)']);
}

function initGit(cwd) {
  gitRun(cwd, ['init', '-b', 'main']);
  gitRun(cwd, ['config', 'user.email', 'tri-test@example.com']);
  gitRun(cwd, ['config', 'user.name', 'tri test']);
}

function addOrigin(cwd) {
  const bare = mkdtempSync(join(tmpdir(), 'tri-origin-'));
  execFileSync('git', ['init', '--bare', bare], { encoding: 'utf8' });
  gitRun(cwd, ['remote', 'add', 'origin', bare]);
  return bare;
}

function check(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}\n    ${e.message.split('\n').join('\n    ')}`); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertIncludes(hay, needle) {
  assert(hay.includes(needle), `expected output to include ${JSON.stringify(needle)}\n--- got ---\n${hay}`);
}

const ws = mkdtempSync(join(tmpdir(), 'tri-test-'));
console.log(`workspace: ${ws}`);

// --- init ---
check('init scaffolds a standard-profile workspace', () => {
  const out = run(ws, ['init', '--profile', 'standard', '--yes']);
  assertIncludes(out, 'initialized');
  for (const f of ['tri.config.json', 'tri/DECISIONS.md', 'tri/ASSUMPTIONS.md', 'tri/DOD.md', 'tri/adr', 'tri/tasks', 'tri/evidence']) {
    assert(existsSync(join(ws, f)), `missing ${f}`);
  }
  const cfg = JSON.parse(readFileSync(join(ws, 'tri.config.json'), 'utf8'));
  assert(cfg.profile === 'standard', 'profile not recorded');
});

check('init refuses to run twice without --force', () => {
  const out = run(ws, ['init', '--profile', 'lite', '--yes'], true);
  assertIncludes(out, 'already initialized');
});

// --- task creation and ID allocation ---
check('new-task allocates sequential IDs and writes template fields', () => {
  const o1 = run(ws, ['new-task', '--title', 'Set up database schema', '--phase', '01']);
  assertIncludes(o1, 'T-0001');
  const o2 = run(ws, ['new-task', '--title', 'Build auth endpoint', '--phase', '01', '--dep', 'T-0001']);
  assertIncludes(o2, 'T-0002');
  run(ws, ['new-task', '--title', 'Add profile page', '--phase', '02', '--dep', 'T-0002']);
  run(ws, ['new-task', '--title', 'Add settings page', '--phase', '02', '--dep', 'T-0002']);
  run(ws, ['new-task', '--title', 'Wire notifications', '--phase', '02', '--dep', 'T-0003']);
  const t2 = readFileSync(join(ws, 'tri/tasks/phase-01/T-0002.md'), 'utf8');
  assertIncludes(t2, '## Status');
  assertIncludes(t2, 'Planned');
  assertIncludes(t2, 'T-0001');
});

// --- validate: clean workspace passes ---
check('validate passes on a clean workspace', () => {
  const out = run(ws, ['validate']);
  assertIncludes(out, 'valid');
});

// --- validate: seeded defects fail loudly ---
check('validate rejects a dependency on a nonexistent task', () => {
  const p = join(ws, 'tri/tasks/phase-02/T-0005.md');
  const orig = readFileSync(p, 'utf8');
  writeFileSync(p, orig.replace('T-0003', 'T-9999'));
  const out = run(ws, ['validate'], true);
  assertIncludes(out, 'T-9999');
  writeFileSync(p, orig);
});

check('validate rejects an unknown status value', () => {
  const p = join(ws, 'tri/tasks/phase-01/T-0001.md');
  const orig = readFileSync(p, 'utf8');
  writeFileSync(p, orig.replace('Planned', 'Almost-Done'));
  const out = run(ws, ['validate'], true);
  assertIncludes(out, 'Almost-Done');
  writeFileSync(p, orig);
});

check('validate rejects duplicate task IDs', () => {
  const dup = join(ws, 'tri/tasks/phase-02/T-0001.md');
  writeFileSync(dup, readFileSync(join(ws, 'tri/tasks/phase-01/T-0001.md'), 'utf8'));
  const out = run(ws, ['validate'], true);
  assertIncludes(out, 'duplicate');
  rmSync(dup);
});

check('validate rejects a dependency cycle', () => {
  const p = join(ws, 'tri/tasks/phase-01/T-0001.md');
  const orig = readFileSync(p, 'utf8');
  writeFileSync(p, orig.replace('## Dependencies\n\nN/A', '## Dependencies\n\n- T-0002'));
  const out = run(ws, ['validate'], true);
  assertIncludes(out, 'cycle');
  writeFileSync(p, orig);
});

// --- frontier and claiming ---
check('next lists only ready unclaimed tasks', () => {
  const out = run(ws, ['next']);
  assertIncludes(out, 'T-0001');
  assert(!out.includes('T-0003'), 'T-0003 depends on unfinished T-0002, must not be ready');
});

check('claim marks task In Progress with assignee', () => {
  run(ws, ['claim', 'T-0001', '--by', 'dev-a']);
  const t = readFileSync(join(ws, 'tri/tasks/phase-01/T-0001.md'), 'utf8');
  assertIncludes(t, 'In Progress');
  assertIncludes(t, 'dev-a');
});

check('claim writes explicit machine-readable scope manifest', () => {
  const scope = JSON.parse(readFileSync(join(ws, '.tri/claims/T-0001.json'), 'utf8'));
  assert(scope.schemaVersion === 1, 'scope schema missing');
  assert(scope.owner === 'dev-a', 'scope owner missing');
  assert(scope.primaryTasks.includes('T-0001'), 'primary task missing');
});

check('claim refuses overlap with existing task scope', () => {
  run(ws, ['release', 'T-0001', '--by', 'dev-a']);
  run(ws, ['claim', 'T-0001', '--by', 'dev-a']);
  const scopeFile = join(ws, 'overlap.json');
  writeFileSync(scopeFile, JSON.stringify({ schemaVersion: 1, owner: 'dev-c', kind: 'task', primaryTasks: ['T-0002'], coveredTasks: ['T-0001'], mayCover: [], responsibilities: [], relatedADRs: [] }));
  const out = run(ws, ['claim', 'T-0002', '--by', 'dev-c', '--scope', 'overlap.json'], true);
  assertIncludes(out, 'claim scope overlap');
  rmSync(scopeFile);
});

check('validate rejects malformed claim scope', () => {
  const p = join(ws, '.tri/claims/bad.json');
  writeFileSync(p, '{bad');
  const out = run(ws, ['validate'], true);
  assertIncludes(out, 'not valid JSON');
  rmSync(p);
});

check('claim of a not-ready task warns but succeeds (advisory, never blocks)', () => {
  const out = run(ws, ['claim', 'T-0005', '--by', 'dev-b']);
  assertIncludes(out, 'warning');
  const t = readFileSync(join(ws, 'tri/tasks/phase-02/T-0005.md'), 'utf8');
  assertIncludes(t, 'dev-b');
});

check('release returns a task to Planned and clears assignee', () => {
  run(ws, ['release', 'T-0005', '--by', 'dev-b']);
  const t = readFileSync(join(ws, 'tri/tasks/phase-02/T-0005.md'), 'utf8');
  assertIncludes(t, 'Planned');
  assert(!t.includes('dev-b'), 'assignee not cleared');
});

// --- done gate ---
check('done refuses a task that is not In Progress', () => {
  const out = run(ws, ['done', 'T-0002'], true);
  assertIncludes(out, 'not In Progress');
});

check('done refuses under standard profile when Evidence is empty', () => {
  const out = run(ws, ['done', 'T-0001'], true);
  assertIncludes(out, 'Evidence');
});

check('done succeeds once Evidence is filled, and unblocks dependents', () => {
  const p = join(ws, 'tri/tasks/phase-01/T-0001.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace(
    '## Evidence\n\nN/A', '## Evidence\n\n- `npm test` 14/14 pass; schema migration applied and rolled back cleanly.'));
  recordEvidence(ws, 'T-0001');
  const out = run(ws, ['done', 'T-0001']);
  assertIncludes(out, 'Done');
  const next = run(ws, ['next']);
  assertIncludes(next, 'T-0002');
});

check('validate recognizes Withdrawn tasks and warns about withdrawn dependencies', () => {
  const withdrawn = join(ws, 'tri/tasks/phase-03/T-0008.md');
  mkdirSync(dirname(withdrawn), { recursive: true });
  writeFileSync(withdrawn, '# T-0008: Withdrawn work\n\n## Status\n\nWithdrawn\n\n## Dependencies\n\nN/A\n\n## Acceptance criteria\n\n- retained\n');
  const dependent = join(ws, 'tri/tasks/phase-03/T-0009.md');
  writeFileSync(dependent, '# T-0009: Follow-up\n\n## Status\n\nPlanned\n\n## Dependencies\n\n- T-0008\n\n## Acceptance criteria\n\n- follow\n');
  const out = run(ws, ['validate']);
  assertIncludes(out, 'depends on Withdrawn');
  assert(!run(ws, ['next']).includes('T-0008'), 'Withdrawn task entered frontier');
});

check('generated tasks are marked Unrevised and next flags them', () => {
  const out = run(ws, ['new-task', '--title', 'Generated specification', '--phase', '04']);
  assertIncludes(out, 'T-0010');
  const text = readFileSync(join(ws, 'tri/tasks/phase-04/T-0010.md'), 'utf8');
  assertIncludes(text, '## Specification status\n\nUnrevised');
  assertIncludes(text, 'TODO: state what is true after this task');
  assertIncludes(run(ws, ['next']), 'Unrevised');
});

check('status reports counts, frontier, and claims', () => {
  const out = run(ws, ['status']);
  assertIncludes(out, 'Done: 1');
  assertIncludes(out, 'Planned: 6');
});

check('graph reports critical path depth', () => {
  const out = run(ws, ['graph']);
  assertIncludes(out, 'critical path');
  assertIncludes(out, '3'); // T-0002 -> T-0003 -> T-0005 remaining chain
});

// --- adapter mode: foreign task formats via config (e.g. Compass TASK-NNNN) ---
const ws2 = mkdtempSync(join(tmpdir(), 'tri-adapt-'));

check('adapter: config with custom idPrefix/statuses reads a Compass-shaped tree', () => {
  writeFileSync(join(ws2, 'tri.config.json'), JSON.stringify({
    profile: 'strict', taskDir: 'tasks', idPrefix: 'TASK-', idWidth: 4,
    statuses: ['Planned', 'Ready', 'Blocked', 'In Progress', 'Done'],
    evidenceDir: 'docs/evidence',
  }));
  const dir = join(ws2, 'tasks/phase-00');
  execFileSync('mkdir', ['-p', dir, join(ws2, 'docs/evidence')]);
  // Compass style: linked deps, extra fields, Ready status, no Assignee section
  writeFileSync(join(dir, 'TASK-0001.md'),
    '# TASK-0001: Pin the sources\n\n## Status\n\nDone\n\n## Priority\n\nP0\n\n## Dependencies\n\nN/A\n\n## Acceptance criteria\n\n- pinned\n');
  writeFileSync(join(dir, 'TASK-0002.md'),
    '# TASK-0002: Build importer\n\n## Status\n\nReady\n\n## Priority\n\nP0\n\n## Dependencies\n\n- [TASK-0001](./TASK-0001.md)\n\n## Acceptance criteria\n\n- imports\n\n## Evidence\n\nN/A\n');
  const out = run(ws2, ['validate']);
  assertIncludes(out, 'valid: 2 tasks');
});

check('adapter: markdown-link dependencies parse and Ready counts as claimable frontier', () => {
  const out = run(ws2, ['next']);
  assertIncludes(out, 'TASK-0002');
});

check('adapter: claim inserts an Assignee section when the file lacks one', () => {
  run(ws2, ['claim', 'TASK-0002', '--by', 'dev-a']);
  const t = readFileSync(join(ws2, 'tasks/phase-00/TASK-0002.md'), 'utf8');
  assertIncludes(t, '## Assignee');
  assertIncludes(t, 'dev-a');
  assertIncludes(t, 'In Progress');
});

check('adapter: strict done gate honors configured evidenceDir', () => {
  const p = join(ws2, 'tasks/phase-00/TASK-0002.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace('## Evidence\n\nN/A', '## Evidence\n\n- suite 9/9 pass'));
  const refused = run(ws2, ['done', 'TASK-0002'], true);
  assertIncludes(refused, 'docs/evidence');
  recordEvidence(ws2, 'TASK-0002');
  const out = run(ws2, ['done', 'TASK-0002']);
  assertIncludes(out, 'Done');
});

check('adapter: multi-line dependency lists are fully parsed, not just the first line', () => {
  const dir = join(ws2, 'tasks/phase-01');
  execFileSync('mkdir', ['-p', dir]);
  // first dep Done, second dep NOT done — task must NOT be ready
  writeFileSync(join(dir, 'TASK-0010.md'),
    '# TASK-0010: Later work\n\n## Status\n\nPlanned\n\n## Priority\n\nP2\n\n## Dependencies\n\n- [TASK-0001](../phase-00/TASK-0001.md)\n- [TASK-0011](./TASK-0011.md)\n\n## Acceptance criteria\n\n- later\n');
  writeFileSync(join(dir, 'TASK-0011.md'),
    '# TASK-0011: Middle work\n\n## Status\n\nPlanned\n\n## Priority\n\nP2\n\n## Dependencies\n\nN/A\n\n## Acceptance criteria\n\n- mid\n');
  const out = run(ws2, ['next']);
  assert(!out.includes('TASK-0010'), `TASK-0010 listed ready despite unmet second dep TASK-0011:\n${out}`);
  assertIncludes(out, 'TASK-0011');
});

check('adapter: new-task allocates IDs with the configured prefix', () => {
  const out = run(ws2, ['new-task', '--title', 'Next thing', '--phase', '00', '--dep', 'TASK-0002']);
  assertIncludes(out, 'TASK-0012');
});

// --- visualize ---
check('visualize writes a self-contained HTML board to .tri/', () => {
  const out = run(ws2, ['visualize']);
  assertIncludes(out, '.tri/graph.html');
  const html = readFileSync(join(ws2, '.tri/graph.html'), 'utf8');
  assertIncludes(html, '<html');
  assertIncludes(html, 'TASK-0002');            // task data embedded
  assertIncludes(html, 'Build importer');       // titles embedded
  assert(!/src=["']https?:|href=["']https?:/.test(html), 'must be self-contained: no external scripts/styles');
});

check('visualize escapes hostile task titles (no XSS via task data)', () => {
  run(ws2, ['new-task', '--title', '</script><img src=x onerror=alert(1)>', '--phase', '00']);
  run(ws2, ['visualize']);
  const html = readFileSync(join(ws2, '.tri/graph.html'), 'utf8');
  assert(!html.includes('</script><img'), 'raw </script> breakout present in embedded JSON');
  assert(!/onerror=alert/.test(html) || html.includes('\\u003c'), 'hostile markup not neutralized');
});

check('visualize honors --out for a custom path', () => {
  const target = join(ws2, 'custom-board.html');
  run(ws2, ['visualize', '--out', target]);
  assert(existsSync(target), 'custom out path not written');
});

// --- machine-readable output for run loops ---
check('next --json emits parseable frontier with deps and phase', () => {
  const out = run(ws2, ['next', '--json']);
  const arr = JSON.parse(out);
  assert(Array.isArray(arr) && arr.length > 0, 'expected non-empty array');
  const t = arr[0];
  for (const k of ['id', 'title', 'status', 'phase', 'priority', 'deps', 'file']) {
    assert(k in t, `frontier entry missing "${k}": ${JSON.stringify(t)}`);
  }
});

check('status --json emits counts, ready, inProgress, blocked', () => {
  const out = run(ws2, ['status', '--json']);
  const s = JSON.parse(out);
  for (const k of ['counts', 'ready', 'inProgress', 'blocked']) {
    assert(k in s, `status json missing "${k}"`);
  }
  assert(typeof s.counts.Done === 'number', 'counts.Done not a number');
});

// --- project-owned task template and companion files ---
const ws3 = mkdtempSync(join(tmpdir(), 'tri-tpl-'));

check('new-task uses the project template when taskTemplate is configured', () => {
  writeFileSync(join(ws3, 'tri.config.json'), JSON.stringify({
    profile: 'standard', taskDir: 'tasks', idPrefix: 'TASK-', idWidth: 4,
    taskTemplate: 'tasks/TASK_TEMPLATE.md',
    companionFiles: ['tasks/README.md', 'tasks/validate-tasks.mjs'],
  }));
  execFileSync('mkdir', ['-p', join(ws3, 'tasks')]);
  writeFileSync(join(ws3, 'tasks/TASK_TEMPLATE.md'),
    '# Task Template\n\n## Task ID\n\n`TASK-NNNN`\n\n## Title\n\nOne outcome.\n\n## Status\n\nPlanned\n\n## Phase\n\nNN\n\n## Dependencies\n\nN/A\n\n## House Field\n\nProject-specific field tri knows nothing about.\n\n## Acceptance criteria\n\n- \n');
  const out = run(ws3, ['new-task', '--title', 'First real task', '--phase', '01']);
  assertIncludes(out, 'TASK-0001');
  const t = readFileSync(join(ws3, 'tasks/phase-01/TASK-0001.md'), 'utf8');
  assertIncludes(t, 'House Field');                       // project template won, not tri's
  assertIncludes(t, '# TASK-0001: First real task');      // heading still written
  assertIncludes(t, '`TASK-0001`');                       // placeholder substituted
  assert(!t.includes('TASK-NNNN'), 'template placeholder left unsubstituted');
});

check('new-task names the companion files it cannot update itself', () => {
  const out = run(ws3, ['new-task', '--title', 'Second task', '--phase', '01', '--dep', 'TASK-0001']);
  assertIncludes(out, 'tasks/README.md');
  assertIncludes(out, 'tasks/validate-tasks.mjs');
});

check('no companion warning when the project declares none', () => {
  const out = run(ws, ['new-task', '--title', 'Plain task', '--phase', '03']);
  assert(!out.toLowerCase().includes('companion'), `unexpected companion warning:\n${out}`);
});

// --- phase directory compatibility ---
const ws5 = mkdtempSync(join(tmpdir(), 'tri-phase-'));

check('new-task reuses a suffixed phase directory from an existing task tree', () => {
  run(ws5, ['init', '--profile', 'standard', '--yes']);
  execFileSync('mkdir', ['-p', join(ws5, 'tri/tasks/phase-12-mobile')]);
  const out = run(ws5, ['new-task', '--title', 'Mobile shell', '--phase', '12']);
  assertIncludes(out, 'T-0001');
  assert(existsSync(join(ws5, 'tri/tasks/phase-12-mobile/T-0001.md')), 'task was not written to suffixed phase directory');
  assert(!existsSync(join(ws5, 'tri/tasks/phase-12')), 'created parallel numeric phase directory');
});

check('new-task accepts an exact phase label for new and existing directories', () => {
  const out = run(ws5, ['new-task', '--title', 'Web shell', '--phase', '13-web']);
  assertIncludes(out, 'T-0002');
  assert(existsSync(join(ws5, 'tri/tasks/phase-13-web/T-0002.md')), 'exact phase label was not used');
});

check('new-task refuses an ambiguous numeric phase instead of choosing silently', () => {
  execFileSync('mkdir', ['-p', join(ws5, 'tri/tasks/phase-14-mobile'), join(ws5, 'tri/tasks/phase-14-web')]);
  const out = run(ws5, ['new-task', '--title', 'Ambiguous work', '--phase', '14'], true);
  assertIncludes(out, 'ambiguous');
  assert(!existsSync(join(ws5, 'tri/tasks/phase-14/T-0003.md')), 'ambiguous phase created a task');
});

check('new-task refuses a numeric phase when canonical and suffixed directories coexist', () => {
  execFileSync('mkdir', ['-p', join(ws5, 'tri/tasks/phase-15'), join(ws5, 'tri/tasks/phase-15-mobile')]);
  const out = run(ws5, ['new-task', '--title', 'Conflicting work', '--phase', '15'], true);
  assertIncludes(out, 'ambiguous');
  assert(!existsSync(join(ws5, 'tri/tasks/phase-15/T-0003.md')), 'conflicting phase created a task');
});

// --- robustness: team collisions, claim ownership, run state, bad input ---
const ws4 = mkdtempSync(join(tmpdir(), 'tri-robust-'));

check('malformed config fails with a readable message, not a stack trace', () => {
  writeFileSync(join(ws4, 'tri.config.json'), '{not json');
  const out = run(ws4, ['status'], true);
  assertIncludes(out, 'tri.config.json');
  assert(!out.includes('at JSON.parse'), `leaked a stack trace:\n${out}`);
});

check('new-task reports collision-safe remote/default-branch allocation', () => {
  writeFileSync(join(ws4, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tri/tasks' }));
  const out = run(ws4, ['new-task', '--title', 'First', '--phase', '01']);
  assertIncludes(out, 'T-0001');
  assert(/remote|default branch|next free identifier/i.test(out),
    `no collision-safe allocation notice in output:\n${out}`);
});

check('release refuses to take another developer\'s claim without --force', () => {
  run(ws4, ['claim', 'T-0001', '--by', 'dev-a']);
  assertIncludes(run(ws4, ['release', 'T-0001'], true), '--by');
  const refused = run(ws4, ['release', 'T-0001', '--by', 'dev-b'], true);
  assertIncludes(refused, 'dev-a');
  const forced = run(ws4, ['release', 'T-0001', '--by', 'dev-b', '--force']);
  assertIncludes(forced, 'released');
});

check('release by the holder needs no force', () => {
  run(ws4, ['claim', 'T-0001', '--by', 'dev-a']);
  const out = run(ws4, ['release', 'T-0001', '--by', 'dev-a']);
  assertIncludes(out, 'released');
});

check('run-state refuses Unrevised queue without explicit override', () => {
  run(ws4, ['new-task', '--title', 'Unrevised queue target', '--phase', '01']);
  const out = run(ws4, ['run-state', '--start', 'unrevised', '--mode', 'sequential', '--queue', 'T-0002'], true);
  assertIncludes(out, '--allow-unrevised');
});
check('run-state records a batch and survives to be resumed', () => {
  run(ws4, ['new-task', '--title', 'Second', '--phase', '01']);
  run(ws4, ['new-task', '--title', 'Third', '--phase', '01']);
  const started = run(ws4, ['run-state', '--start', 'phase 01', '--mode', 'sequential', '--queue', 'T-0001,T-0002,T-0003', '--allow-unrevised']);
  assertIncludes(started, 'T-0001');
  const state = JSON.parse(readFileSync(join(ws4, '.tri/run.json'), 'utf8'));
  assert(state.queue.length === 3, `queue not recorded: ${JSON.stringify(state)}`);
  assert(state.scope === 'phase 01' && state.mode === 'sequential', 'scope/mode not recorded');

  run(ws4, ['run-state', '--lease', 'worker-1']);
  const firstTask = join(ws4, 'tri/tasks/phase-01/T-0001.md');
  writeFileSync(firstTask, readFileSync(firstTask, 'utf8').replace('## Status\n\nPlanned', '## Status\n\nDone'));
  run(ws4, ['run-state', '--done', 'T-0001']);
  run(ws4, ['run-state', '--blocked', 'T-0002']);
  const resumed = run(ws4, ['run-state']);
  assertIncludes(resumed, 'remaining');
  assertIncludes(resumed, 'T-0003');
  const s2 = JSON.parse(readFileSync(join(ws4, '.tri/run.json'), 'utf8'));
  assert(s2.done.includes('T-0001'), 'done not recorded');
  assert(s2.blocked.includes('T-0002'), 'blocked not recorded');

  run(ws4, ['run-state', '--finish']);
  const after = run(ws4, ['run-state']);
  assert(/no active run|finished/i.test(after), `run not closed out:\n${after}`);
});

check('run-state reports no active run when none exists', () => {
  const out = run(ws, ['run-state']);
  assert(/no active run/i.test(out), `expected no-active-run message:\n${out}`);
});

// --- remote inventory and canonical doctor fixtures ---
check('configured remote allocation fails when default ref is missing', () => {
  const remoteWs = mkdtempSync(join(tmpdir(), 'tri-remote-missing-'));
  initGit(remoteWs);
  addOrigin(remoteWs);
  writeFileSync(join(remoteWs, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tri/tasks', requireRemoteReservations: true }));
  mkdirSync(join(remoteWs, 'tri/tasks'), { recursive: true });
  const out = run(remoteWs, ['new-task', '--title', 'Blocked allocation', '--phase', '01'], true);
  assert(/origin\/main|remote inventory/i.test(out), `missing default ref was not reported:\n${out}`);
  rmSync(remoteWs, { recursive: true, force: true });
});

check('configured remote fetch failure stops allocation', () => {
  const remoteWs = mkdtempSync(join(tmpdir(), 'tri-remote-fetch-'));
  initGit(remoteWs);
  gitRun(remoteWs, ['remote', 'add', 'origin', join(remoteWs, 'missing-origin.git')]);
  writeFileSync(join(remoteWs, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tri/tasks', requireRemoteReservations: true }));
  mkdirSync(join(remoteWs, 'tri/tasks'), { recursive: true });
  const out = run(remoteWs, ['new-task', '--title', 'Blocked fetch', '--phase', '01'], true);
  assert(/git fetch|failed/i.test(out), `fetch failure was not reported:\n${out}`);
  rmSync(remoteWs, { recursive: true, force: true });
});

check('valid empty default tree remains usable for allocation', () => {
  const remoteWs = mkdtempSync(join(tmpdir(), 'tri-remote-empty-'));
  initGit(remoteWs);
  gitRun(remoteWs, ['commit', '--allow-empty', '-m', 'empty baseline']);
  const origin = addOrigin(remoteWs);
  gitRun(remoteWs, ['push', 'origin', 'main']);
  writeFileSync(join(remoteWs, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tri/tasks' }));
  mkdirSync(join(remoteWs, 'tri/tasks'), { recursive: true });
  const out = run(remoteWs, ['new-task', '--title', 'Empty baseline allocation', '--phase', '01']);
  assertIncludes(out, 'T-0001');
  rmSync(remoteWs, { recursive: true, force: true });
  rmSync(origin, { recursive: true, force: true });
});

check('explicit baseBranch selects configured remote baseline', () => {
  const remoteWs = mkdtempSync(join(tmpdir(), 'tri-remote-base-'));
  initGit(remoteWs);
  gitRun(remoteWs, ['checkout', '-b', 'dev']);
  gitRun(remoteWs, ['commit', '--allow-empty', '-m', 'development baseline']);
  const origin = addOrigin(remoteWs);
  gitRun(remoteWs, ['push', 'origin', 'dev']);
  writeFileSync(join(remoteWs, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tri/tasks', baseBranch: 'dev' }));
  mkdirSync(join(remoteWs, 'tri/tasks'), { recursive: true });
  const out = run(remoteWs, ['new-task', '--title', 'Development allocation', '--phase', '01']);
  assertIncludes(out, 'T-0001');
  rmSync(remoteWs, { recursive: true, force: true });
  rmSync(origin, { recursive: true, force: true });
});

check('remote branches reserve identifiers and collisions fail remote validation', () => {
  const remoteWs = mkdtempSync(join(tmpdir(), 'tri-remote-reserved-'));
  initGit(remoteWs);
  run(remoteWs, ['init', '--profile', 'standard', '--yes']);
  gitRun(remoteWs, ['add', '.']);
  gitRun(remoteWs, ['commit', '-m', 'baseline']);
  const origin = addOrigin(remoteWs);
  gitRun(remoteWs, ['push', 'origin', 'main']);
  for (const [branch, id] of [['reserved-one', 'T-0001'], ['reserved-two', 'T-0002'], ['reserved-three', 'T-0002']]) {
    gitRun(remoteWs, ['checkout', '-b', branch, 'main']);
    const dir = join(remoteWs, 'tri/tasks/phase-01');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.md`), `# ${id}: reserved\n`);
    gitRun(remoteWs, ['add', '.']);
    gitRun(remoteWs, ['commit', '-m', branch]);
    gitRun(remoteWs, ['push', '-u', 'origin', branch]);
    gitRun(remoteWs, ['checkout', 'main']);
  }
  const created = run(remoteWs, ['new-task', '--title', 'After reservations', '--phase', '02']);
  assertIncludes(created, 'T-0003');
  const validation = run(remoteWs, ['validate', '--remote'], true);
  assertIncludes(validation, 'T-0002');
  rmSync(remoteWs, { recursive: true, force: true });
  rmSync(origin, { recursive: true, force: true });
});

check('doctor parses canonical ADR status and consolidates stale task citations', () => {
  const doctorWs = mkdtempSync(join(tmpdir(), 'tri-doctor-'));
  initGit(doctorWs);
  run(doctorWs, ['init', '--profile', 'standard', '--yes']);
  writeFileSync(join(doctorWs, 'tri/adr/ADR-0001.md'), '# ADR-0001: Old decision\n\n- Status: Superseded by [ADR-0002](ADR-0002.md)\n');
  writeFileSync(join(doctorWs, 'tri/adr/ADR-0002.md'), '# ADR-0002: New decision\n\n- Status: Accepted\n');
  const taskDir = join(doctorWs, 'tri/tasks/phase-01');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, 'T-0001.md'), '# T-0001: Uses old decision\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Applicable ADRs\n\n- ADR-0001\n\n## Acceptance criteria\n\n- old decision is replaced\n');
  gitRun(doctorWs, ['add', '.']);
  gitRun(doctorWs, ['commit', '-m', 'doctor fixture']);
  const origin = addOrigin(doctorWs);
  gitRun(doctorWs, ['push', 'origin', 'main']);
  const out = run(doctorWs, ['doctor']);
  assertIncludes(out, 'ADR-0001 is Superseded by ADR-0002');
  assertIncludes(out, 'T-0001');
  rmSync(doctorWs, { recursive: true, force: true });
  rmSync(origin, { recursive: true, force: true });
});

check('doctor rejects malformed ADR metadata without calling it absent', () => {
  const doctorWs = mkdtempSync(join(tmpdir(), 'tri-doctor-malformed-'));
  initGit(doctorWs);
  run(doctorWs, ['init', '--profile', 'standard', '--yes']);
  writeFileSync(join(doctorWs, 'tri/adr/ADR-0001.md'), '# ADR-0001\n\n```\n- Status: Accepted\n```\n\n- Status: Accepted\n');
  const taskDir = join(doctorWs, 'tri/tasks/phase-01');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, 'T-0001.md'), '# T-0001: Uses malformed ADR\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Applicable ADRs\n\n- ADR-0001\n\n## Acceptance criteria\n\n- detect malformed ADR\n');
  gitRun(doctorWs, ['add', '.']);
  gitRun(doctorWs, ['commit', '-m', 'malformed doctor fixture']);
  const origin = addOrigin(doctorWs);
  gitRun(doctorWs, ['push', 'origin', 'main']);
  const out = run(doctorWs, ['doctor']);
  assertIncludes(out, 'malformed ADR');
  assertIncludes(out, 'references malformed ADR-0001');
  assert(!out.includes('ADR-0001, absent from default branch'), 'malformed ADR was misreported absent');
  rmSync(doctorWs, { recursive: true, force: true });
  rmSync(origin, { recursive: true, force: true });
});

check('doctor accepts successor cited in task body outside Applicable ADRs', () => {
  const doctorWs = mkdtempSync(join(tmpdir(), 'tri-doctor-body-'));
  initGit(doctorWs);
  run(doctorWs, ['init', '--profile', 'standard', '--yes']);
  writeFileSync(join(doctorWs, 'tri/adr/ADR-0001.md'), '# ADR-0001: Old decision\n\n- Status: Superseded by ADR-0002\n');
  writeFileSync(join(doctorWs, 'tri/adr/ADR-0002.md'), '# ADR-0002: New decision\n\n- Status: Accepted\n');
  const taskDir = join(doctorWs, 'tri/tasks/phase-01');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, 'T-0001.md'), '# T-0001: Migrated\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Applicable ADRs\n\n- ADR-0001\n\n## Context\n\nMigration follows ADR-0002.\n\n## Acceptance criteria\n\n- migrated\n');
  gitRun(doctorWs, ['add', '.']);
  gitRun(doctorWs, ['commit', '-m', 'body citation fixture']);
  const origin = addOrigin(doctorWs);
  gitRun(doctorWs, ['push', 'origin', 'main']);
  const out = run(doctorWs, ['doctor']);
  assert(!out.includes('without successor'), `body successor was ignored:\n${out}`);
  rmSync(doctorWs, { recursive: true, force: true });
  rmSync(origin, { recursive: true, force: true });
});

// --- post-2.1.0 hardening regressions ---
check('a dependency on a Withdrawn task does not deadlock frontier or done', () => {
  const p = join(ws, 'tri/tasks/phase-03/T-0009.md');
  const orig = readFileSync(p, 'utf8');
  writeFileSync(p, orig.replace('## Acceptance criteria', '## Evidence\n\n- follow-up verified against retained record\n\n## Acceptance criteria'));
  assertIncludes(run(ws, ['next']), 'T-0009');
  run(ws, ['claim', 'T-0009', '--by', 'dev-a']);
  recordEvidence(ws, 'T-0009');
  const out = run(ws, ['done', 'T-0009']);
  assertIncludes(out, 'dependencies Withdrawn: T-0008');
  assertIncludes(out, 'T-0009 marked Done');
});

check('validate flags a single placeholder objective instead of waiting for a majority', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-title-'));
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tri/tasks' }));
  const dir = join(w, 'tri/tasks/phase-01');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-0001.md'), '# T-0001: Fix the login bug\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Objective\n\nDeliver one independently verifiable increment that will Fix the login bug.\n\n## Acceptance criteria\n\n- logged in\n');
  writeFileSync(join(dir, 'T-0002.md'), '# T-0002: Add regression tests\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Objective\n\nCover the login flow with regression tests.\n\n## Acceptance criteria\n\n- suite passes\n');
  writeFileSync(join(dir, 'T-0003.md'), '# T-0003: Style the header\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Objective\n\nUnify header spacing and typography.\n\n## Acceptance criteria\n\n- consistent\n');
  writeFileSync(join(dir, 'T-0004.md'), '# T-0004: Add dark mode\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Objective\n\nShip a dark colour scheme with contrast checks.\n\n## Acceptance criteria\n\n- contrast passes\n');
  const out = run(w, ['validate']);
  assertIncludes(out, 'T-0001: Objective restates the title verbatim');
  assert(!out.includes('T-0002: Objective restates'), 'legitimate objective containing its title was flagged');
});

check('evidence from a mixture of environments warns about the mismatching run', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-env-'));
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tri/tasks', expectedEnvironment: { node: 'v18' } }));
  const dir = join(w, 'tri/tasks/phase-01');
  mkdirSync(join(w, 'tri/evidence'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-0001.md'), '# T-0001: Verify build\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Evidence\n\n- suite passes\n\n## Acceptance criteria\n\n- green\n');
  writeFileSync(join(w, 'tri/evidence/T-0001-20260806.md'), '# Evidence: T-0001\n\n## Execution context (2026-08-06T00:00:00Z)\n\n```json\n{"command":["npm","test"],"exitStatus":0,"context":{"node":"v18.21.3"}}\n```\n\n## Execution context (2026-08-06T00:00:01Z)\n\n```json\n{"command":["npm","test"],"exitStatus":0,"context":{"node":"v24.0.0"}}\n```\n');
  run(w, ['claim', 'T-0001', '--by', 'dev-a']);
  const out = run(w, ['done', 'T-0001']);
  assertIncludes(out, 'Evidence runtime differs from expected environment');
  assertIncludes(out, 'T-0001 marked Done');
});

check('taskTemplate without a Phase section fails when --phase is supplied', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-tpl-phase-'));
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tasks', taskTemplate: 'tasks/TASK_TEMPLATE.md' }));
  mkdirSync(join(w, 'tasks'), { recursive: true });
  writeFileSync(join(w, 'tasks/TASK_TEMPLATE.md'), '# Task Template\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Acceptance criteria\n\n- \n');
  const out = run(w, ['new-task', '--title', 'Phaseless task', '--phase', '02'], true);
  assertIncludes(out, '## Phase');
  assert(!existsSync(join(w, 'tasks/phase-02/T-0001.md')), 'task written despite template mismatch');
});

check('rebaseline honors baseBranch when defaultBranch is unset', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-rebase-base-'));
  initGit(w);
  gitRun(w, ['checkout', '-b', 'dev']);
  gitRun(w, ['commit', '--allow-empty', '-m', 'baseline']);
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tri/tasks', baseBranch: 'dev' }));
  mkdirSync(join(w, 'tri/tasks'), { recursive: true });
  gitRun(w, ['add', '.']);
  gitRun(w, ['commit', '-m', 'config']);
  run(w, ['rebaseline', '--approve']);
  writeFileSync(join(w, 'PROJECT_CHARTER.md'), '# Charter\n\n- internal-only\n');
  gitRun(w, ['add', '.']);
  gitRun(w, ['commit', '-m', 'charter layer']);
  const out = run(w, ['rebaseline', '--complete']);
  assertIncludes(out, 'layer complete');
  rmSync(w, { recursive: true, force: true });
});

check('rebaseline layer paths follow configured adrDir', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-rebase-adrdir-'));
  initGit(w);
  gitRun(w, ['commit', '--allow-empty', '-m', 'baseline']);
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tri/tasks', adrDir: 'docs/adr', decisionFiles: ['docs/DECISIONS.md'] }));
  mkdirSync(join(w, 'tri/tasks'), { recursive: true });
  gitRun(w, ['add', '.']);
  gitRun(w, ['commit', '-m', 'config']);
  run(w, ['rebaseline', '--approve']);
  writeFileSync(join(w, 'PROJECT_CHARTER.md'), '# Charter\n\n- internal-only\n');
  gitRun(w, ['add', '.']);
  gitRun(w, ['commit', '-m', 'charter layer']);
  run(w, ['rebaseline', '--complete']);
  run(w, ['rebaseline', '--approve']);
  mkdirSync(join(w, 'docs/adr'), { recursive: true });
  writeFileSync(join(w, 'docs/adr/ADR-0001.md'), '# ADR-0001: Keep internal\n\n- Status: Accepted\n');
  gitRun(w, ['add', '.']);
  gitRun(w, ['commit', '-m', 'adr layer']);
  const out = run(w, ['rebaseline', '--complete']);
  assertIncludes(out, 'layer complete');
  rmSync(w, { recursive: true, force: true });
});

check('run-state refuses an unknown execution mode', () => {
  const out = run(ws4, ['run-state', '--start', 'phase 01', '--mode', 'spaceships', '--queue', 'T-0001', '--allow-unrevised'], true);
  assertIncludes(out, 'unknown run mode');
});

check('run-state warns on overlapping Expected files in parallel and team modes', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-overlap-'));
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ profile: 'standard', taskDir: 'tri/tasks' }));
  const dir = join(w, 'tri/tasks/phase-01');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-0001.md'), '# T-0001: Button styling\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Expected files\n\n- src/components/Button.tsx\n\n## Acceptance criteria\n\n- styled\n');
  writeFileSync(join(dir, 'T-0002.md'), '# T-0002: Button behavior\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Expected files\n\n- src/components/Button.tsx\n\n## Acceptance criteria\n\n- behaves\n');
  writeFileSync(join(dir, 'T-0003.md'), '# T-0003: Header layout\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Expected files\n\n- src/components/Header.tsx\n\n## Acceptance criteria\n\n- laid out\n');
  const parallel = run(w, ['run-state', '--start', 'phase 01', '--mode', 'parallel', '--queue', 'T-0001,T-0002,T-0003']);
  assertIncludes(parallel, 'T-0001 and T-0002 both touch src/components/Button.tsx');
  assert(!parallel.includes('Header.tsx'), 'disjoint task pair was flagged');
  run(w, ['run-state', '--finish']);
  const team = run(w, ['run-state', '--start', 'phase 01', '--mode', 'team', '--queue', 'T-0001,T-0002,T-0003']);
  assertIncludes(team, 'both touch');
  run(w, ['run-state', '--finish']);
  const sequential = run(w, ['run-state', '--start', 'phase 01', '--mode', 'sequential', '--queue', 'T-0001,T-0002,T-0003']);
  assert(!sequential.toLowerCase().includes('both touch'), 'sequential run flagged for overlap');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
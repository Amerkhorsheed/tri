#!/usr/bin/env node
// Test harness for tri.mjs. Run: node scripts/test-tri.mjs
// Builds a throwaway workspace in a temp dir, seeds defects, asserts behavior.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRI = join(dirname(fileURLToPath(import.meta.url)), 'tri.mjs');
let passed = 0, failed = 0;

function run(cwd, args, expectFail = false) {
  try {
    const out = execFileSync('node', [TRI, ...args], { cwd, encoding: 'utf8' });
    if (expectFail) throw new Error(`expected failure, got success:\n${out}`);
    return out;
  } catch (e) {
    if (expectFail) return (e.stdout ?? '') + (e.stderr ?? '');
    throw e;
  }
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

check('claiming an already-claimed task fails without --force', () => {
  const out = run(ws, ['claim', 'T-0001', '--by', 'dev-b'], true);
  assertIncludes(out, 'dev-a');
});

check('claim of a not-ready task warns but succeeds (advisory, never blocks)', () => {
  const out = run(ws, ['claim', 'T-0005', '--by', 'dev-b']);
  assertIncludes(out, 'warning');
  const t = readFileSync(join(ws, 'tri/tasks/phase-02/T-0005.md'), 'utf8');
  assertIncludes(t, 'dev-b');
});

check('release returns a task to Planned and clears assignee', () => {
  run(ws, ['release', 'T-0005']);
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
  const out = run(ws, ['done', 'T-0001']);
  assertIncludes(out, 'Done');
  const next = run(ws, ['next']);
  assertIncludes(next, 'T-0002');
});

// --- status and graph ---
check('status reports counts, frontier, and claims', () => {
  const out = run(ws, ['status']);
  assertIncludes(out, 'Done: 1');
  assertIncludes(out, 'Planned: 4');
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
  writeFileSync(join(ws2, 'docs/evidence/TASK-0002-20260805.md'), 'evidence');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

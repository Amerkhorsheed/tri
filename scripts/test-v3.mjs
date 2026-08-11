#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRI = join(dirname(fileURLToPath(import.meta.url)), 'tri.mjs');
let passed = 0, failed = 0;
function git(cwd, args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }
function ensureGit(cwd) {
  if (existsSync(join(cwd, '.git'))) return;
  git(cwd, ['init', '-b', 'main']);
  git(cwd, ['config', 'user.email', 'tri-test@example.com']);
  git(cwd, ['config', 'user.name', 'tri test']);
}
function run(cwd, args, expectFail = false) {
  if (args[0] !== 'init' && existsSync(join(cwd, 'tri.config.json'))) ensureGit(cwd);
  try {
    const output = execFileSync('node', [TRI, ...args], { cwd, encoding: 'utf8' });
    if (expectFail) throw new Error(`expected failure, got success:\n${output}`);
    return output;
  } catch (error) {
    if (expectFail) return `${error.stdout ?? ''}${error.stderr ?? ''}`;
    throw error;
  }
}
function check(name, fn) {
  try { fn(); passed++; console.log(`  ok - ${name}`); }
  catch (error) { failed++; console.log(`  FAIL - ${name}\n    ${error.message.split('\n').join('\n    ')}`); }
}
function assert(value, message) { if (!value) throw new Error(message); }
function includes(text, value) { assert(text.includes(value), `expected ${JSON.stringify(value)} in:\n${text}`); }
function task(id, dep = 'N/A', path = 'src/a.js') {
  return `# ${id}: Work\n\n## Status\n\nPlanned\n\n## Dependencies\n\n${dep}\n\n## Expected files\n\n- ${path}\n\n## Acceptance criteria\n\n- done\n`;
}

const ws = mkdtempSync(join(tmpdir(), 'tri-v3-'));
check('init defaults to decentralized IDs and ignores scratch state', () => {
  run(ws, ['init', '--profile', 'standard', '--id-strategy', 'random']);
  const cfg = JSON.parse(readFileSync(join(ws, 'tri.config.json'), 'utf8'));
  assert(cfg.version === 2 && cfg.idStrategy === 'random', `unexpected config: ${JSON.stringify(cfg)}`);
  includes(readFileSync(join(ws, '.gitignore'), 'utf8'), '.tri/');
  const created = run(ws, ['new-task', '--title', 'Random identity', '--phase', '01']);
  const id = created.match(/T-[0-9A-HJKMNP-TV-Z]{13}/)?.[0]; assert(id, 'random task ID missing');
  run(ws, ['new-task', '--title', 'Random dependency', '--phase', '01', '--dep', id]);
  assert(!run(ws, ['validate']).includes(`dependency ${id.slice(0, 3)} does not exist`), 'random dependency ID was truncated');
});

check('engine owns random ADR and register identifiers', () => {
  assert(/ADR-[0-9A-HJKMNP-TV-Z]{13}/.test(run(ws, ['new-adr', '--title', 'Keep the engine small'])), 'random ADR missing');
  assert(/D-[0-9A-HJKMNP-TV-Z]{13}/.test(run(ws, ['register', '--kind', 'decision', '--text', 'Use engine gates', '--rationale', 'One seam'])), 'random decision missing');
  includes(readFileSync(join(ws, 'tri/DECISIONS.md'), 'utf8'), 'Use engine gates');
});

check('config rejects unknown keys and paths outside the repository', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-v3-config-')); ensureGit(w);
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'standard', taskDir: '../tasks', idStrategy: 'random', workflow: 'trunk', mystery: true }));
  includes(run(w, ['status'], true), 'unknown option');
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'standard', taskDir: '../tasks', idStrategy: 'random', workflow: 'trunk' }));
  includes(run(w, ['status'], true), 'repository-relative');
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'strict', taskDir: 'tri/tasks', idStrategy: 'random', workflow: 'trunk', expectedEnvironment: 'bad' }));
  includes(run(w, ['status'], true), 'expectedEnvironment');
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'lite', taskDir: 'tri/tasks', idStrategy: 'random', idPrefix: '../../../../outside/', workflow: 'trunk' }));
  includes(run(w, ['status'], true), 'idPrefix');
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'standard', taskDir: 'tri/tasks', idStrategy: 'random', workflow: 'trunk' }));
  const dir = join(w, 'tri/tasks/phase-01'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-0001.md'), `${task('T-0001')}\n## Specification status\n\nDefinitelyMaybe\n`);
  includes(run(w, ['validate'], true), 'unknown Specification status');
});

check('adopted task prose preserves canonical specification status semantics', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-v3-spec-prose-'));
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'lite', taskDir: 'tasks', idStrategy: 'random', workflow: 'trunk' }));
  const dir = join(w, 'tasks/phase-01'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-0001.md'), `${task('T-0001')}\n## Specification status\n\n\`Specified\` — written against current decisions.\n`);
  writeFileSync(join(dir, 'T-0002.md'), `${task('T-0002')}\n## Specification status\n\n\`Unrevised\` — predates the baseline.\n\nClarify before implementation.\n`);
  writeFileSync(join(dir, 'T-0003.md'), `${task('T-0003').replace('Planned', 'Withdrawn')}\n## Specification status\n\n\`Withdrawn\` — retained as a record.\n`);
  writeFileSync(join(dir, 'T-0004.md'), `${task('T-0004').replace('Planned', 'Done')}\n## Specification status\n\n\`Implemented before the re-baseline\` — historical completed work.\n`);
  writeFileSync(join(dir, 'T-0005.md'), `${task('T-0005').replace('- src/a.js', 'Files will be selected after prerequisites land; legacy notes mention src/**/*.js.')}\n## Specification status\n\n\`Unrevised\` — exact paths are intentionally deferred.\n`);
  writeFileSync(join(dir, 'T-0006.md'), `${task('T-0006').replace('Planned', 'Done')}\n## Specification status\n\nImplemented before the re-baseline — bare historical marker.\n`);
  includes(run(w, ['validate']), 'valid: 6 tasks');
  const status = JSON.parse(run(w, ['status', '--json']));
  assert(status.ready.some((entry) => entry.id === 'T-0001' && entry.specificationStatus === 'Specified'), 'explained Specified token was not canonicalized');
});

check('adopted root decision and assumption registers are discovered by default', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-v3-root-registers-'));
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'lite', taskDir: 'tasks', idStrategy: 'random', workflow: 'trunk' }));
  mkdirSync(join(w, 'tasks'), { recursive: true });
  writeFileSync(join(w, 'DECISIONS.md'), '# Decision Register\n\n## Resolved Direction\n\n| ID | Decision | Rationale |\n|---|---|---|\n\n## Blocking Decisions\n\n| ID | Decision | Owner | Blocks |\n|---|---|---|---|\n');
  writeFileSync(join(w, 'ASSUMPTIONS.md'), '# Assumption Register\n\n| ID | Assumption | Why it matters | Invalidated by |\n|---|---|---|---|\n');
  writeFileSync(join(w, 'work.txt'), 'clean\n'); ensureGit(w); git(w, ['add', '.']); git(w, ['commit', '-m', 'baseline']);
  writeFileSync(join(w, 'work.txt'), 'active task changes\n');
  run(w, ['register', '--kind', 'decision', '--text', 'Use root registers', '--rationale', 'Adopted workspace']);
  run(w, ['register', '--kind', 'assumption', '--text', 'Root is canonical', '--why', 'Existing corpus']);
  includes(readFileSync(join(w, 'DECISIONS.md'), 'utf8'), 'Use root registers');
  includes(readFileSync(join(w, 'ASSUMPTIONS.md'), 'utf8'), 'Root is canonical');
});

check('evidence stores hashes and TRI version, not raw output', () => {
  const taskDir = join(ws, 'tri/tasks/phase-01');
  const file = readdirSync(taskDir).map((name) => join(taskDir, name)).find((path) => readFileSync(path, 'utf8').includes('## Dependencies\n\nN/A'));
  const id = basename(file, '.md');
  run(ws, ['claim', id, '--by', 'dev-v3']);
  writeFileSync(join(ws, 'emit-secret.mjs'), 'console.log("secret-output")\n');
  run(ws, ['evidence', id, '--name', 'suite', '--', 'node', 'emit-secret.mjs', '-H', 'X-API-Key: release-blocker-secret', '--cookie', 'session=cookie-secret']);
  const record = readdirSync(join(ws, 'tri/evidence')).map((name) => readFileSync(join(ws, 'tri/evidence', name), 'utf8')).join('\n');
  includes(record, 'outputSha256'); includes(record, '"tri": "3.2.0"');
  assert(!record.includes('secret-output'), 'raw command output persisted');
  assert(!record.includes('release-blocker-secret'), 'API key header persisted');
  assert(!record.includes('cookie-secret'), 'authentication cookie persisted');
  writeFileSync(file, readFileSync(file, 'utf8').replace('## Evidence\n\nN/A', '## Evidence\n\n- suite passed'));
  const scopeFile = join(ws, '.tri/claims', `${id}.json`); const scope = JSON.parse(readFileSync(scopeFile, 'utf8'));
  scope.attempt = '0'.repeat(24); writeFileSync(scopeFile, JSON.stringify(scope));
  includes(run(ws, ['done', id], true), 'successful structured evidence');
});

check('exact directory claims reject intersecting files and globs', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-v3-scope-'));
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'lite', taskDir: 'tri/tasks', idStrategy: 'random', workflow: 'trunk' }));
  const dir = join(w, 'tri/tasks/phase-01'); mkdirSync(dir, { recursive: true });
  for (const id of ['T-0001', 'T-0002', 'T-0003']) writeFileSync(join(dir, `${id}.md`), task(id, 'N/A', id === 'T-0003' ? 'src/c.js' : 'src/a.js'));
  mkdirSync(join(w, '.tri/claims'), { recursive: true });
  writeFileSync(join(w, '.tri/claims/T-0001.json'), JSON.stringify({ schemaVersion: 1, owner: 'a', kind: 'task', primaryTasks: ['T-0001'], coveredTasks: [], mayCover: [], responsibilities: [], relatedADRs: [], writePaths: ['src/admin/'] }));
  const scope = (writePaths) => ({ schemaVersion: 1, owner: 'b', kind: 'task', primaryTasks: ['T-0002'], coveredTasks: [], mayCover: [], responsibilities: [], relatedADRs: [], writePaths });
  writeFileSync(join(w, 'scope.json'), JSON.stringify(scope(['src/admin/user.js'])));
  includes(run(w, ['claim', 'T-0002', '--by', 'b', '--scope', 'scope.json'], true), 'scope overlap');
  writeFileSync(join(w, 'scope.json'), JSON.stringify(scope(['src/**/*.js'])));
  includes(run(w, ['claim', 'T-0002', '--by', 'b', '--scope', 'scope.json'], true), 'does not support globs');
  run(w, ['claim', 'T-0003', '--by', 'c']);
  assert(JSON.parse(readFileSync(join(w, '.tri/claims/T-0003.json'), 'utf8')).writePaths[0] === 'src/c.js', 'claim did not inherit Expected files');
});

check('scheduler leases safe work concurrently and respects dependencies', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-v3-run-'));
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'lite', taskDir: 'tri/tasks', idStrategy: 'random', workflow: 'trunk' }));
  const dir = join(w, 'tri/tasks/phase-01'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-0001.md'), task('T-0001', 'N/A', 'src/a.js'));
  writeFileSync(join(dir, 'T-0002.md'), task('T-0002', '- T-0001', 'src/b.js'));
  writeFileSync(join(dir, 'T-0003.md'), task('T-0003', '- T-0001', 'src/c.js'));
  includes(run(w, ['run-state', '--start', 'v3', '--mode', 'auto', '--adapter', 'pi', '--queue', 'T-0001,T-0002,T-0003']), 'actual parallel');
  const [first, waiting] = JSON.parse(run(w, ['run-state', '--lease', 'worker-1,worker-2']));
  assert(first.task === 'T-0001' && waiting.task === null, `unexpected root leases: ${JSON.stringify([first, waiting])}`);
  includes(run(w, ['run-state', '--done', 'T-0001'], true), 'status is Done');
  const firstFile = join(dir, 'T-0001.md'); writeFileSync(firstFile, readFileSync(firstFile, 'utf8').replace('## Status\n\nPlanned', '## Status\n\nDone'));
  run(w, ['run-state', '--done', 'T-0001']);
  const [second, third] = JSON.parse(run(w, ['run-state', '--lease', 'worker-1,worker-2']));
  assert(new Set([second.task, third.task]).size === 2 && [second.task, third.task].every((id) => ['T-0002', 'T-0003'].includes(id)), 'parallel dependent wave was not released');
});

check('scope verification uses the immutable base task declaration', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-v3-verify-')); ensureGit(w);
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'lite', taskDir: 'tri/tasks', idStrategy: 'random', workflow: 'trunk' }));
  const dir = join(w, 'tri/tasks/phase-01'); mkdirSync(join(w, 'src'), { recursive: true }); mkdirSync(dir, { recursive: true });
  const file = join(dir, 'T-0001.md'); writeFileSync(file, task('T-0001', 'N/A', 'src/a.js')); writeFileSync(join(w, 'src/a.js'), 'a\n'); writeFileSync(join(w, 'src/secret.js'), 'old\n');
  git(w, ['add', '.']); git(w, ['commit', '-m', 'base']); const base = git(w, ['rev-parse', 'HEAD']).trim();
  writeFileSync(file, readFileSync(file, 'utf8').replace('- src/a.js', '- src/a.js\n- src/secret.js')); writeFileSync(join(w, 'src/secret.js'), 'changed\n');
  git(w, ['add', '.']); git(w, ['commit', '-m', 'scope expansion']);
  includes(run(w, ['verify-scope', 'T-0001', '--base', base], true), 'outside Expected files');
});

check('legacy run state resumes through the v3 lease scheduler', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-v3-resume-'));
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'lite', taskDir: 'tri/tasks', idStrategy: 'random', workflow: 'trunk' }));
  const dir = join(w, 'tri/tasks/phase-01'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'T-0001.md'), task('T-0001'));
  mkdirSync(join(w, '.tri'), { recursive: true });
  writeFileSync(join(w, '.tri/run.json'), JSON.stringify({ scope: 'legacy', mode: 'parallel', queue: ['T-0001'], done: [], blocked: [], startedAt: new Date().toISOString(), finishedAt: null }));
  assert(JSON.parse(run(w, ['run-state', '--lease', 'worker-1'])).task === 'T-0001', 'legacy state did not lease');
});

check('claim tokens make same-base remote reservation first-writer-wins', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-v3-claim-')); ensureGit(w);
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'lite', taskDir: 'tri/tasks', idStrategy: 'random', workflow: 'branch-pr', defaultBranch: 'main' }));
  const dir = join(w, 'tri/tasks/phase-01'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-0001.md'), task('T-0001'));
  git(w, ['add', '.']); git(w, ['commit', '-m', 'baseline']);
  const origin = mkdtempSync(join(tmpdir(), 'tri-v3-origin-')); git(origin, ['init', '--bare']);
  git(w, ['remote', 'add', 'origin', origin]); git(w, ['push', 'origin', 'main']); git(w, ['checkout', '-b', 'work']);
  const first = JSON.parse(run(w, ['claim-token', 'T-0001', '--by', 'a']));
  const second = JSON.parse(run(w, ['claim-token', 'T-0001', '--by', 'b']));
  git(w, ['push', `--force-with-lease=${first.ref}:`, 'origin', `${first.token}:${first.ref}`]);
  let lost = false;
  try { git(w, ['push', `--force-with-lease=${second.ref}:`, 'origin', `${second.token}:${second.ref}`]); } catch { lost = true; }
  assert(lost, 'second same-base claim unexpectedly won');
  includes(run(w, ['claim', 'T-0001', '--by', 'b'], true), 'not a token');
  includes(run(w, ['claim', 'T-0001', '--by', 'a']), 'claimed by a');
  git(w, ['push', 'origin', `:${first.ref}`]);
  includes(run(w, ['done', 'T-0001'], true), 'active remote claim token');
});

check('graph excludes Withdrawn work', () => {
  const w = mkdtempSync(join(tmpdir(), 'tri-v3-withdrawn-'));
  writeFileSync(join(w, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'lite', taskDir: 'tri/tasks', idStrategy: 'random', workflow: 'trunk' }));
  const dir = join(w, 'tri/tasks/phase-01'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'T-0001.md'), task('T-0001').replace('Planned', 'Withdrawn'));
  includes(run(w, ['graph']), 'no remaining tasks');
});

check('visualization contains board and dependency graph views', () => {
  run(ws, ['visualize']);
  const html = readFileSync(join(ws, '.tri/graph.html'), 'utf8');
  includes(html, 'id="boardBtn"'); includes(html, 'id="graphBtn"'); includes(html, 'Task dependency graph');
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1]; assert(script, 'board script missing');
  const scriptFile = join(ws, '.tri/board.js'); writeFileSync(scriptFile, script); execFileSync('node', ['--check', scriptFile]);
});

check('metadata exposes the authoritative engine contract', () => {
  const meta = JSON.parse(run(ws, ['meta']));
  assert(meta.version === '3.2.0', 'wrong metadata version');
  assert(meta.commands['verify-scope'] && meta.configKeys.includes('idStrategy') && meta.hostAdapters.pi.backend === 'pi-workers', 'metadata incomplete');
  assert(meta.hostAdapters.cursor.backend === 'cursor-task-tri-worker' && meta.hostAdapters.cursor.parallel, 'Cursor adapter missing');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

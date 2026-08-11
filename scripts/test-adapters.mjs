#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWorkers } from '../extensions/pi/workers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRI = join(ROOT, 'scripts/tri.mjs');
const HOST = join(ROOT, 'scripts/tri-host.mjs');
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (error) { failed++; console.log(`  FAIL - ${name}\n    ${error.message.split('\n').join('\n    ')}`); }
}
function assert(value, message) { if (!value) throw new Error(message); }
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
function task(id, path) { return `# ${id}: Work\n\n## Status\n\nPlanned\n\n## Dependencies\n\nN/A\n\n## Expected files\n\n- ${path}\n\n## Acceptance criteria\n\n- done\n`; }
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'tri-adapter-'));
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.email', 'tri@example.com'); git(root, 'config', 'user.name', 'TRI');
  mkdirSync(join(root, 'tri/tasks/phase-01'), { recursive: true });
  writeFileSync(join(root, 'tri.config.json'), JSON.stringify({ version: 2, profile: 'lite', taskDir: 'tri/tasks', idStrategy: 'random', workflow: 'trunk' }));
  writeFileSync(join(root, 'tri/tasks/phase-01/T-0001.md'), task('T-0001', 'src/a.js'));
  writeFileSync(join(root, 'tri/tasks/phase-01/T-0002.md'), task('T-0002', 'src/b.js'));
  git(root, 'add', '.'); git(root, 'commit', '-m', 'base');
  return root;
}

await check('host probe declares only verified backends', () => {
  const pi = JSON.parse(execFileSync('node', [HOST, 'pi', '--json'], { encoding: 'utf8' }));
  const antigravity = JSON.parse(execFileSync('node', [HOST, 'antigravity', '--json'], { encoding: 'utf8' }));
  const geminiHome = mkdtempSync(join(tmpdir(), 'tri-gemini-')); writeFileSync(join(geminiHome, 'settings.json'), '{"experimental":{"enableAgents":true}}');
  const gemini = JSON.parse(execFileSync('node', [HOST, 'gemini', '--json'], { encoding: 'utf8', env: { ...process.env, GEMINI_HOME: geminiHome } }));
  const geminiOff = JSON.parse(execFileSync('node', [HOST, 'gemini', '--json'], { encoding: 'utf8', env: { ...process.env, GEMINI_HOME: join(geminiHome, 'missing') } }));
  assert(pi.parallel && pi.backend === 'pi-workers', 'Pi backend missing');
  assert(gemini.adapter === 'gemini-agents' && gemini.parallel, 'enabled Gemini agents not detected');
  assert(geminiOff.adapter === 'gemini' && !geminiOff.parallel, 'disabled Gemini claimed parallelism');
  assert(!antigravity.parallel && antigravity.backend === 'sequential', 'Antigravity must fail safe');
});

await check('scheduler records adapter, backend, and honest fallback', () => {
  const safe = workspace();
  execFileSync('node', [TRI, 'run-state', '--start', 'safe', '--queue', 'T-0001,T-0002', '--adapter', 'pi'], { cwd: safe });
  const state = JSON.parse(execFileSync('node', [TRI, 'run-state', '--json'], { cwd: safe, encoding: 'utf8' }));
  assert(state.actualMode === 'parallel' && state.backend === 'pi-workers' && state.adapter === 'pi', 'Pi mode not recorded');
  const fallback = workspace();
  execFileSync('node', [TRI, 'run-state', '--start', 'fallback', '--queue', 'T-0001,T-0002', '--adapter', 'antigravity'], { cwd: fallback });
  const fallbackState = JSON.parse(execFileSync('node', [TRI, 'run-state', '--json'], { cwd: fallback, encoding: 'utf8' }));
  assert(fallbackState.actualMode === 'sequential' && fallbackState.capacity === 1, 'fallback claimed parallel work');
});

await check('Pi worker runner proves concurrent isolated processes', async () => {
  const root = workspace();
  const parent = dirname(root); const one = join(parent, `${root.split('/').pop()}-w1`); const two = join(parent, `${root.split('/').pop()}-w2`);
  git(root, 'worktree', 'add', '-b', 'worker-one', one); git(root, 'worktree', 'add', '-b', 'worker-two', two);
  const fake = join(root, 'fake-worker.mjs');
  writeFileSync(fake, 'setTimeout(() => { console.log(JSON.stringify({type:"message_end", message:{role:"assistant", content:[{type:"text", text:"done"}]}})); }, 500);\n');
  const base = git(root, 'rev-parse', 'HEAD');
  let primaryRejected = false;
  try { await runWorkers([{ worker: 'bad', task: 'T-0001', worktree: root, base, paths: ['src/a.js'] }], { invocation: () => ({ command: process.execPath, args: [fake] }) }); }
  catch (error) { primaryRejected = error.message.includes('primary checkout'); }
  assert(primaryRejected, 'primary checkout accepted as an isolated worker');
  const started = Date.now();
  const result = await runWorkers([
    { worker: 'one', task: 'T-0001', worktree: one, base, paths: ['src/a.js'] },
    { worker: 'two', task: 'T-0002', worktree: two, base, paths: ['src/b.js'] },
  ], { invocation: () => ({ command: process.execPath, args: [fake] }) });
  assert(result.actualMode === 'parallel' && result.peakWorkers === 2 && result.results.every((worker) => worker.successful), 'runner did not observe two successful workers');
  assert(Date.now() - started < 900, 'workers did not overlap');

  const hanging = join(root, 'hanging-worker.mjs');
  writeFileSync(hanging, 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);\n');
  const controller = new AbortController(); setTimeout(() => controller.abort(), 100);
  const cancelStarted = Date.now();
  const cancelled = await runWorkers([{ worker: 'cancel', task: 'T-0001', worktree: one, base, paths: ['src/a.js'] }], {
    signal: controller.signal, invocation: () => ({ command: process.execPath, args: [hanging] }),
  });
  assert(cancelled.results[0].aborted && !cancelled.results[0].successful && Date.now() - cancelStarted < 6500, 'worker cancellation did not terminate cleanly');
});

await check('native package manifests expose every TRI command and worker', () => {
  const markdown = readdirSync(join(ROOT, 'commands')).filter((name) => name.endsWith('.md')).map((name) => name.replace('.md', ''));
  const toml = new Set(readdirSync(join(ROOT, 'commands')).filter((name) => name.endsWith('.toml')).map((name) => name.replace('.toml', '')));
  assert(markdown.every((name) => toml.has(name)), 'Codex/Gemini command adapter is incomplete');
  assert(JSON.parse(readFileSync(join(ROOT, 'package.json'))).pi.extensions.length === 1, 'Pi manifest missing extension');
  assert(JSON.parse(readFileSync(join(ROOT, '.codex-plugin/plugin.json'))).skills === './skills/', 'Codex skill missing');
  assert(readFileSync(join(ROOT, 'agents/tri-worker.md'), 'utf8').includes('kind: local'), 'Gemini worker missing');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

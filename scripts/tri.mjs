#!/usr/bin/env node
// tri — task register + evidence-gated delivery. Zero dependencies, Node >= 18.
// Commands: init, new-task, validate, next, claim, release, done, status, graph.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, appendFileSync,
} from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(SCRIPT_DIR, '..', 'templates');
const STATUSES = ['Planned', 'In Progress', 'Blocked', 'Done'];
const PROFILES = ['lite', 'standard', 'strict'];

function fail(msg) { console.error(msg); process.exit(1); }
function out(msg) { console.log(msg); }

// ---------- config ----------
function findRoot(from = process.cwd()) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'tri.config.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function loadConfig() {
  const root = findRoot();
  if (!root) fail('no tri.config.json found — run `tri init` in the project root first');
  const cfg = JSON.parse(readFileSync(join(root, 'tri.config.json'), 'utf8'));
  return { root, ...cfg };
}

// ---------- task parsing ----------
function taskFiles(cfg) {
  const dir = join(cfg.root, cfg.taskDir);
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) if (/^T-\d+\.md$/.test(f)) files.push(join(p, f));
    } else if (/^T-\d+\.md$/.test(entry)) files.push(p);
  }
  return files.sort();
}

function parseTask(file) {
  const text = readFileSync(file, 'utf8');
  const sections = {};
  const re = /^## (.+?)\n\n?([\s\S]*?)(?=\n## |\n?$)/gm;
  let m;
  while ((m = re.exec(text)) !== null) sections[m[1].trim()] = m[2].trim();
  const id = basename(file, '.md');
  const deps = (sections['Dependencies'] ?? '')
    .split('\n').join(' ').match(/T-\d+/g) ?? [];
  return {
    id, file, text, sections,
    status: sections['Status'] ?? '',
    assignee: sections['Assignee'] ?? 'N/A',
    priority: sections['Priority'] ?? 'P1',
    title: (text.match(/^# T-\d+:\s*(.+)$/m) ?? [,''])[1],
    deps: [...new Set(deps.filter((d) => d !== id))],
  };
}

function loadTasks(cfg) {
  return taskFiles(cfg).map(parseTask);
}

function setSection(task, name, value) {
  const updated = task.text.replace(
    new RegExp(`(## ${name}\\n\\n)[\\s\\S]*?(?=\\n## |\\n?$)`),
    `$1${value}\n`,
  );
  if (updated === task.text) fail(`${task.id}: could not update section "${name}"`);
  writeFileSync(task.file, updated);
}

function byId(tasks) {
  const map = new Map();
  for (const t of tasks) {
    if (map.has(t.id)) fail(`duplicate task ID ${t.id}:\n  ${map.get(t.id).file}\n  ${t.file}`);
    map.set(t.id, t);
  }
  return map;
}

function readyTasks(tasks, map) {
  return tasks.filter((t) => t.status === 'Planned'
    && t.deps.every((d) => map.get(d)?.status === 'Done'));
}

// ---------- commands ----------
function cmdInit(args) {
  const profile = argValue(args, '--profile') ?? 'standard';
  if (!PROFILES.includes(profile)) fail(`unknown profile "${profile}" (${PROFILES.join('|')})`);
  const root = process.cwd();
  if (existsSync(join(root, 'tri.config.json'))) {
    if (!args.includes('--force')) fail('already initialized (tri.config.json exists); use --force to overwrite config only');
  }
  const cfg = { profile, taskDir: 'tri/tasks', version: 1 };
  writeFileSync(join(root, 'tri.config.json'), JSON.stringify(cfg, null, 2) + '\n');
  for (const d of ['tri/tasks', 'tri/adr', 'tri/evidence']) mkdirSync(join(root, d), { recursive: true });
  const copies = [
    ['DECISIONS.md', 'tri/DECISIONS.md'],
    ['ASSUMPTIONS.md', 'tri/ASSUMPTIONS.md'],
    [`DOD-${profile}.md`, 'tri/DOD.md'],
    ['ADR-template.md', 'tri/adr/ADR-template.md'],
  ];
  for (const [src, dst] of copies) {
    if (!existsSync(join(root, dst))) writeFileSync(join(root, dst), readFileSync(join(TEMPLATES, src), 'utf8'));
  }
  // AGENTS.md section for cross-agent (Claude Code / Codex) parity
  const section = readFileSync(join(TEMPLATES, 'AGENTS-section.md'), 'utf8')
    .replaceAll('{{TRI_SCRIPTS}}', relScripts(root));
  const agents = join(root, 'AGENTS.md');
  if (!existsSync(agents)) writeFileSync(agents, section);
  else if (!readFileSync(agents, 'utf8').includes('## TRI Method')) appendFileSync(agents, '\n' + section);
  out(`initialized tri workspace (profile: ${profile}) at ${root}`);
}

function relScripts(root) {
  // Prefer a stable invocation path; plugin installs keep scripts beside this file.
  return SCRIPT_DIR.startsWith(root) ? SCRIPT_DIR.slice(root.length + 1) : SCRIPT_DIR;
}

function cmdNewTask(args) {
  const cfg = loadConfig();
  const title = argValue(args, '--title') ?? fail('--title required');
  const phase = argValue(args, '--phase') ?? '01';
  const deps = argValues(args, '--dep');
  const tasks = loadTasks(cfg);
  const maxId = tasks.reduce((n, t) => Math.max(n, parseInt(t.id.slice(2), 10)), 0);
  const id = `T-${String(maxId + 1).padStart(4, '0')}`;
  const dir = join(cfg.root, cfg.taskDir, `phase-${phase}`);
  mkdirSync(dir, { recursive: true });
  const body = readFileSync(join(TEMPLATES, `TASK-${cfg.profile}.md`), 'utf8')
    .replaceAll('{{ID}}', id)
    .replaceAll('{{TITLE}}', title)
    .replaceAll('{{PHASE}}', phase)
    .replaceAll('{{DEPS}}', deps.length ? deps.map((d) => `- ${d}`).join('\n') : 'N/A');
  const file = join(dir, `${id}.md`);
  writeFileSync(file, body);
  out(`created ${id} (${title}) at ${file}`);
}

function cmdValidate() {
  const cfg = loadConfig();
  const tasks = loadTasks(cfg);
  const map = byId(tasks); // exits on duplicate IDs
  const errors = [];
  const warnings = [];
  for (const t of tasks) {
    if (!STATUSES.includes(t.status)) errors.push(`${t.id}: unknown status "${t.status}" (allowed: ${STATUSES.join(', ')})`);
    for (const d of t.deps) if (!map.has(d)) errors.push(`${t.id}: dependency ${d} does not exist`);
    if (!t.title) errors.push(`${t.id}: missing "# ${t.id}: Title" heading`);
    for (const sec of ['Status', 'Dependencies', 'Acceptance criteria']) {
      if (!(sec in t.sections)) errors.push(`${t.id}: missing required section "## ${sec}"`);
    }
    if (t.status === 'In Progress') {
      if (t.assignee === 'N/A' || !t.assignee) warnings.push(`${t.id}: In Progress with no assignee`);
      const unmet = t.deps.filter((d) => map.get(d)?.status !== 'Done');
      if (unmet.length) warnings.push(`${t.id}: claimed by ${t.assignee} but dependencies not Done: ${unmet.join(', ')}`);
    }
  }
  // cycle detection
  const state = new Map();
  const stack = [];
  function visit(id) {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const start = stack.indexOf(id);
      fail(`dependency cycle: ${[...stack.slice(start), id].join(' -> ')}`);
    }
    state.set(id, 1); stack.push(id);
    for (const d of map.get(id)?.deps ?? []) if (map.has(d)) visit(d);
    stack.pop(); state.set(id, 2);
  }
  for (const t of tasks) visit(t.id);

  for (const w of warnings) out(`warning: ${w}`);
  if (errors.length) fail(errors.join('\n'));
  out(`valid: ${tasks.length} tasks, ${warnings.length} warning(s)`);
}

function cmdNext() {
  const cfg = loadConfig();
  const tasks = loadTasks(cfg);
  const ready = readyTasks(tasks, byId(tasks))
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id));
  if (!ready.length) { out('no ready tasks'); return; }
  for (const t of ready) out(`${t.id} [${t.priority}] ${t.title}`);
}

function cmdClaim(args) {
  const cfg = loadConfig();
  const id = args.find((a) => /^T-\d+$/.test(a)) ?? fail('usage: claim T-NNNN --by <name>');
  const by = argValue(args, '--by') ?? fail('--by <name> required');
  const tasks = loadTasks(cfg);
  const map = byId(tasks);
  const t = map.get(id) ?? fail(`${id} not found`);
  if (t.status === 'Done') fail(`${id} is already Done`);
  if (t.status === 'In Progress' && t.assignee !== 'N/A' && t.assignee !== by && !args.includes('--force')) {
    fail(`${id} is already claimed by ${t.assignee}; use --force to take it over`);
  }
  const unmet = t.deps.filter((d) => map.get(d)?.status !== 'Done');
  if (unmet.length) out(`warning: ${id} has dependencies not Done: ${unmet.join(', ')} — claim is advisory, proceeding`);
  setSection(t, 'Status', 'In Progress');
  const t2 = parseTask(t.file);
  setSection(t2, 'Assignee', by);
  out(`${id} claimed by ${by}`);
}

function cmdRelease(args) {
  const cfg = loadConfig();
  const id = args.find((a) => /^T-\d+$/.test(a)) ?? fail('usage: release T-NNNN');
  const t = byId(loadTasks(cfg)).get(id) ?? fail(`${id} not found`);
  if (t.status !== 'In Progress') fail(`${id} is not In Progress`);
  setSection(t, 'Status', 'Planned');
  setSection(parseTask(t.file), 'Assignee', 'N/A');
  out(`${id} released back to Planned`);
}

function cmdDone(args) {
  const cfg = loadConfig();
  const id = args.find((a) => /^T-\d+$/.test(a)) ?? fail('usage: done T-NNNN');
  const t = byId(loadTasks(cfg)).get(id) ?? fail(`${id} not found`);
  if (t.status !== 'In Progress') fail(`${id} is not In Progress (status: ${t.status}) — claim it first`);
  if (cfg.profile !== 'lite') {
    const ev = t.sections['Evidence'] ?? '';
    if (!ev || ev === 'N/A') fail(`${id}: Evidence section is empty — record commands and observed results before done`);
  }
  if (cfg.profile === 'strict') {
    const evDir = join(cfg.root, 'tri/evidence');
    const has = existsSync(evDir) && readdirSync(evDir).some((f) => f.startsWith(id));
    if (!has) fail(`${id}: strict profile requires an evidence record at tri/evidence/${id}-<date>.md`);
  }
  setSection(t, 'Status', 'Done');
  out(`${id} marked Done`);
}

function cmdStatus() {
  const cfg = loadConfig();
  const tasks = loadTasks(cfg);
  const map = byId(tasks);
  const counts = {};
  for (const s of STATUSES) counts[s] = tasks.filter((t) => t.status === s).length;
  out(STATUSES.map((s) => `${s}: ${counts[s]}`).join('  '));
  const inprog = tasks.filter((t) => t.status === 'In Progress');
  if (inprog.length) {
    out('\nin progress:');
    for (const t of inprog) out(`  ${t.id} (${t.assignee}) ${t.title}`);
  }
  const ready = readyTasks(tasks, map);
  if (ready.length) {
    out('\nready:');
    for (const t of ready) out(`  ${t.id} [${t.priority}] ${t.title}`);
  }
  const blocked = tasks.filter((t) => t.status === 'Blocked');
  if (blocked.length) {
    out('\nblocked:');
    for (const t of blocked) out(`  ${t.id} ${t.title}`);
  }
}

function cmdGraph() {
  const cfg = loadConfig();
  const tasks = loadTasks(cfg);
  const map = byId(tasks);
  const remaining = tasks.filter((t) => t.status !== 'Done');
  const depth = new Map();
  const path = new Map();
  function d(id) {
    if (depth.has(id)) return depth.get(id);
    const t = map.get(id);
    if (!t || t.status === 'Done') return 0;
    depth.set(id, 0); // cycle guard; validate reports cycles properly
    let best = 0; let via = null;
    for (const dep of t.deps) { const v = d(dep); if (v > best) { best = v; via = dep; } }
    depth.set(id, best + 1); path.set(id, via);
    return best + 1;
  }
  let deepest = null;
  for (const t of remaining) if (d(t.id) > (deepest ? depth.get(deepest) : 0)) deepest = t.id;
  if (!deepest) { out('no remaining tasks'); return; }
  const chain = [];
  for (let id = deepest; id; id = path.get(id)) chain.unshift(id);
  out(`remaining: ${remaining.length} tasks`);
  out(`critical path: ${depth.get(deepest)} tasks (${chain.join(' -> ')})`);
  // ideal parallel waves
  const done = new Set(tasks.filter((t) => t.status === 'Done').map((t) => t.id));
  let todo = remaining.map((t) => t.id);
  const waves = [];
  while (todo.length) {
    const wave = todo.filter((id) => map.get(id).deps.every((dep) => done.has(dep) || !map.has(dep)));
    if (!wave.length) { out('warning: remaining tasks unreachable (blocked or cyclic)'); break; }
    waves.push(wave.length);
    for (const id of wave) done.add(id);
    todo = todo.filter((id) => !done.has(id));
  }
  out(`ideal parallel waves: ${waves.length} (${waves.join(', ')})`);
}

// ---------- arg helpers ----------
function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}
function argValues(args, flag) {
  const vals = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag) vals.push(args[i + 1]);
  return vals;
}

// ---------- dispatch ----------
const [cmd, ...args] = process.argv.slice(2);
const commands = {
  init: cmdInit, 'new-task': cmdNewTask, validate: cmdValidate, next: cmdNext,
  claim: cmdClaim, release: cmdRelease, done: cmdDone, status: cmdStatus, graph: cmdGraph,
};
if (!cmd || !(cmd in commands)) {
  fail(`usage: tri.mjs <${Object.keys(commands).join('|')}> [args]
  init [--profile lite|standard|strict] [--force]
  new-task --title "..." [--phase NN] [--dep T-NNNN]...
  claim T-NNNN --by <name> [--force]     (dynamic pull-based claiming; advisory, warns but never blocks on deps)
  release T-NNNN | done T-NNNN | next | status | graph | validate`);
}
commands[cmd](args);

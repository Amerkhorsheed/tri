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
  return {
    root, idPrefix: 'T-', idWidth: 4, evidenceDir: 'tri/evidence',
    statuses: STATUSES, companionFiles: [], ...cfg,
  };
}

// ---------- task parsing ----------
function idRegex(cfg, anchored = false) {
  const esc = cfg.idPrefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return new RegExp(anchored ? `^${esc}\\d+\\.md$` : `${esc}\\d+`, anchored ? '' : 'g');
}

function taskFiles(cfg) {
  const dir = join(cfg.root, cfg.taskDir);
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const fileRe = idRegex(cfg, true);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) if (fileRe.test(f)) files.push(join(p, f));
    } else if (fileRe.test(entry)) files.push(p);
  }
  return files.sort();
}

function parseTask(file, cfg) {
  const text = readFileSync(file, 'utf8');
  const sections = {};
  // Split on H2 headings; regex lookaheads with $ and the m flag truncate
  // multi-line sections at the first line end, so split parsing is used instead.
  const parts = text.split(/^## /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    if (nl < 0) continue;
    sections[part.slice(0, nl).trim()] = part.slice(nl + 1).trim();
  }
  const id = basename(file, '.md');
  const deps = (sections['Dependencies'] ?? '')
    .split('\n').join(' ').match(idRegex(cfg)) ?? [];
  return {
    id, file, text, sections,
    status: sections['Status'] ?? '',
    assignee: sections['Assignee'] ?? 'N/A',
    priority: sections['Priority'] ?? 'P1',
    title: (text.match(new RegExp(`^# ${cfg.idPrefix.replace(/[-]/g, '\\-')}\\d+:\\s*(.+)$`, 'm')) ?? [,''])[1],
    deps: [...new Set(deps.filter((d) => d !== id))],
  };
}

function loadTasks(cfg) {
  return taskFiles(cfg).map((f) => parseTask(f, cfg));
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
  return tasks.filter((t) => (t.status === 'Planned' || t.status === 'Ready')
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
  const section = readFileSync(join(TEMPLATES, 'AGENTS-section.md'), 'utf8');
  const agents = join(root, 'AGENTS.md');
  if (!existsSync(agents)) writeFileSync(agents, section);
  else if (!readFileSync(agents, 'utf8').includes('## TRI Method')) appendFileSync(agents, '\n' + section);
  out(`initialized tri workspace (profile: ${profile}) at ${root}`);
}

function cmdNewTask(args) {
  const cfg = loadConfig();
  const title = argValue(args, '--title') ?? fail('--title required');
  const phase = argValue(args, '--phase') ?? '01';
  const deps = argValues(args, '--dep');
  const tasks = loadTasks(cfg);
  const maxId = tasks.reduce((n, t) => Math.max(n, parseInt(t.id.slice(cfg.idPrefix.length), 10)), 0);
  const id = `${cfg.idPrefix}${String(maxId + 1).padStart(cfg.idWidth, '0')}`;
  const dir = join(cfg.root, cfg.taskDir, `phase-${phase}`);
  mkdirSync(dir, { recursive: true });
  // A project may own its task template; its fields are the contract its
  // validators enforce, so tri's own template must not overwrite them.
  const depsBlock = deps.length ? deps.map((d) => `- ${d}`).join('\n') : 'N/A';
  let body;
  if (cfg.taskTemplate) {
    const tplPath = join(cfg.root, cfg.taskTemplate);
    if (!existsSync(tplPath)) fail(`taskTemplate not found: ${cfg.taskTemplate}`);
    body = readFileSync(tplPath, 'utf8');
    // Drop any leading prose above the first field so the result is a task, not a template.
    const firstField = body.indexOf('## ');
    if (firstField > 0) body = body.slice(firstField);
    body = body
      .replace(new RegExp(`${cfg.idPrefix}N+`, 'g'), id)
      .replaceAll('{{ID}}', id)
      .replaceAll('{{TITLE}}', title)
      .replaceAll('{{PHASE}}', phase)
      .replaceAll('{{DEPS}}', depsBlock);
    body = `# ${id}: ${title}\n\n${body}`;
    // A project template describes its Dependencies field rather than carrying a
    // placeholder, so write the real dependencies over whatever prose is there.
    if (!body.includes(depsBlock)) {
      body = body.replace(/(## Dependencies\n\n)[\s\S]*?(?=\n## )/, `$1${depsBlock}\n`);
    }
  } else {
    body = readFileSync(join(TEMPLATES, `TASK-${cfg.profile}.md`), 'utf8')
      .replaceAll('{{ID}}', id)
      .replaceAll('{{TITLE}}', title)
      .replaceAll('{{PHASE}}', phase)
      .replaceAll('{{DEPS}}', depsBlock);
  }
  const file = join(dir, `${id}.md`);
  writeFileSync(file, body);
  out(`created ${id} (${title}) at ${file}`);
  if (cfg.taskTemplate) out(`  template: ${cfg.taskTemplate} — fill every field the project requires before claiming`);
  if (cfg.companionFiles.length) {
    out('  companion files tri cannot update for you — update them in the same change:');
    for (const f of cfg.companionFiles) out(`    ${f}`);
  }
}

function cmdValidate() {
  const cfg = loadConfig();
  const tasks = loadTasks(cfg);
  const map = byId(tasks); // exits on duplicate IDs
  const errors = [];
  const warnings = [];
  for (const t of tasks) {
    if (!cfg.statuses.includes(t.status)) errors.push(`${t.id}: unknown status "${t.status}" (allowed: ${cfg.statuses.join(', ')})`);
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

function taskJson(t) {
  return {
    id: t.id, title: t.title, status: t.status, assignee: t.assignee,
    priority: t.priority, deps: t.deps, phase: basename(dirname(t.file)).replace(/^phase-/, ''),
    file: t.file,
  };
}

function cmdNext(args = []) {
  const cfg = loadConfig();
  const tasks = loadTasks(cfg);
  const ready = readyTasks(tasks, byId(tasks))
    .sort((a, b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id));
  if (args.includes('--json')) { out(JSON.stringify(ready.map(taskJson), null, 2)); return; }
  if (!ready.length) { out('no ready tasks'); return; }
  for (const t of ready) out(`${t.id} [${t.priority}] ${t.title}`);
}

function cmdClaim(args) {
  const cfg = loadConfig();
  const id = args.find((a) => idRegex(cfg, false).test(a)) ?? fail(`usage: claim ${cfg.idPrefix}NNNN --by <name>`);
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
  let t2 = parseTask(t.file, cfg);
  if (!('Assignee' in t2.sections)) {
    writeFileSync(t2.file, t2.text.replace(/(## Status\n\nIn Progress\n)/, `$1\n## Assignee\n\nN/A\n`));
    t2 = parseTask(t2.file, cfg);
  }
  setSection(t2, 'Assignee', by);
  out(`${id} claimed by ${by}`);
}

function cmdRelease(args) {
  const cfg = loadConfig();
  const id = args.find((a) => idRegex(cfg, false).test(a)) ?? fail(`usage: release ${cfg.idPrefix}NNNN`);
  const t = byId(loadTasks(cfg)).get(id) ?? fail(`${id} not found`);
  if (t.status !== 'In Progress') fail(`${id} is not In Progress`);
  setSection(t, 'Status', 'Planned');
  setSection(parseTask(t.file, cfg), 'Assignee', 'N/A');
  out(`${id} released back to Planned`);
}

function cmdDone(args) {
  const cfg = loadConfig();
  const id = args.find((a) => idRegex(cfg, false).test(a)) ?? fail(`usage: done ${cfg.idPrefix}NNNN`);
  const t = byId(loadTasks(cfg)).get(id) ?? fail(`${id} not found`);
  if (t.status !== 'In Progress') fail(`${id} is not In Progress (status: ${t.status}) — claim it first`);
  if (cfg.profile !== 'lite') {
    const ev = t.sections['Evidence'] ?? '';
    if (!ev || ev === 'N/A') fail(`${id}: Evidence section is empty — record commands and observed results before done`);
  }
  if (cfg.profile === 'strict') {
    const evDir = join(cfg.root, cfg.evidenceDir);
    const has = existsSync(evDir) && readdirSync(evDir).some((f) => f.startsWith(id));
    if (!has) fail(`${id}: strict profile requires an evidence record at ${cfg.evidenceDir}/${id}-<date>.md`);
  }
  setSection(t, 'Status', 'Done');
  out(`${id} marked Done`);
}

function cmdStatus(args = []) {
  const cfg = loadConfig();
  const tasks = loadTasks(cfg);
  const map = byId(tasks);
  const counts = {};
  for (const s of cfg.statuses) counts[s] = tasks.filter((t) => t.status === s).length;
  if (args.includes('--json')) {
    out(JSON.stringify({
      counts,
      ready: readyTasks(tasks, map).map(taskJson),
      inProgress: tasks.filter((t) => t.status === 'In Progress').map(taskJson),
      blocked: tasks.filter((t) => t.status === 'Blocked').map(taskJson),
    }, null, 2));
    return;
  }
  out(cfg.statuses.map((s) => `${s}: ${counts[s]}`).join('  '));
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

function cmdVisualize(args) {
  const cfg = loadConfig();
  const tasks = loadTasks(cfg);
  const map = byId(tasks);
  // critical path over remaining tasks (same walk as cmdGraph)
  const depth = new Map(); const via = new Map();
  function d(id) {
    if (depth.has(id)) return depth.get(id);
    const t = map.get(id);
    if (!t || t.status === 'Done') return 0;
    depth.set(id, 0);
    let best = 0; let b = null;
    for (const dep of t.deps) { const v = d(dep); if (v > best) { best = v; b = dep; } }
    depth.set(id, best + 1); via.set(id, b);
    return best + 1;
  }
  let deepest = null;
  for (const t of tasks) if (t.status !== 'Done' && d(t.id) > (deepest ? depth.get(deepest) : 0)) deepest = t.id;
  const critical = [];
  for (let id = deepest; id; id = via.get(id)) critical.unshift(id);
  const ready = new Set(readyTasks(tasks, map).map((t) => t.id));
  const phaseOf = (t) => basename(dirname(t.file)).replace(/^phase-/, '');
  const data = tasks.map((t) => ({
    id: t.id, title: t.title, status: t.status, assignee: t.assignee,
    priority: t.priority, deps: t.deps, phase: phaseOf(t),
    ready: ready.has(t.id), critical: critical.includes(t.id),
  }));
  const html = boardHtml(data, critical, cfg);
  const outPath = argValue(args, '--out') ?? join(cfg.root, '.tri', 'graph.html');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  out(`board written to ${outPath.startsWith(cfg.root) ? outPath.slice(cfg.root.length + 1) : outPath}`);
  out('keep .tri/ out of version control (add ".tri/" to .gitignore if not present)');
}

function boardHtml(data, critical, cfg) {
  const counts = {};
  for (const s of cfg.statuses) counts[s] = data.filter((t) => t.status === s).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>tri board</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1c2733;--mut:#68778a;--line:#dde3ea;
--planned:#8a97a6;--ready:#1273e6;--inprog:#e6900f;--blocked:#c93a3a;--done:#2e9e5b;--crit:#7b2ff2}
@media(prefers-color-scheme:dark){:root{--bg:#12161b;--card:#1b222b;--ink:#e8edf2;--mut:#8b98a7;--line:#2a3340}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:14px 20px;border-bottom:1px solid var(--line);display:flex;gap:18px;align-items:baseline;flex-wrap:wrap}
h1{font-size:16px;margin:0}.stat{color:var(--mut)}.stat b{color:var(--ink)}
#f{margin-left:auto;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);min-width:220px}
main{display:flex;gap:14px;overflow-x:auto;padding:16px 20px;align-items:flex-start}
.lane{min-width:230px;max-width:230px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px}
.lane h2{font-size:12px;margin:0 0 8px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em}
.chip{border:1px solid var(--line);border-left:4px solid var(--planned);border-radius:8px;padding:7px 9px;margin:6px 0;cursor:pointer;background:var(--bg)}
.chip:hover{filter:brightness(1.06)}.chip .id{font-weight:600;font-size:12px}.chip .t{color:var(--mut);font-size:12px}
.chip .who{font-size:11px;color:var(--inprog)}
.s-Ready,.s-Planned.ready{border-left-color:var(--ready)}
.s-InProgress{border-left-color:var(--inprog)}.s-Blocked{border-left-color:var(--blocked)}
.s-Done{border-left-color:var(--done);opacity:.55}
.crit{outline:2px dashed var(--crit);outline-offset:1px}
#panel{position:fixed;right:0;top:0;bottom:0;width:340px;background:var(--card);border-left:1px solid var(--line);
padding:18px;overflow:auto;transform:translateX(100%);transition:transform .18s}
#panel.open{transform:none}#panel h3{margin:0 0 4px}#panel .mut{color:var(--mut)}
#panel a{color:var(--ready);cursor:pointer;text-decoration:none}#panel button{float:right;border:0;background:none;color:var(--mut);font-size:18px;cursor:pointer}
.legend{display:flex;gap:12px;padding:0 20px 12px;color:var(--mut);font-size:12px;flex-wrap:wrap}
.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}
</style></head><body>
<header><h1>tri board</h1>
${cfg.statuses.map((s) => `<span class="stat">${s}: <b>${counts[s] ?? 0}</b></span>`).join('')}
<span class="stat">critical path: <b>${critical.length}</b></span>
<input id="f" placeholder="filter id / title / assignee…"></header>
<div class="legend">
<span><span class="dot" style="background:var(--ready)"></span>ready</span>
<span><span class="dot" style="background:var(--inprog)"></span>in progress</span>
<span><span class="dot" style="background:var(--blocked)"></span>blocked</span>
<span><span class="dot" style="background:var(--done)"></span>done</span>
<span><span class="dot" style="border:2px dashed var(--crit);background:none"></span>critical path</span></div>
<main id="board"></main>
<aside id="panel"></aside>
<script>
const DATA=${JSON.stringify(data).replace(/</g, '\\u003c')};
const byId=Object.fromEntries(DATA.map(t=>[t.id,t]));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const board=document.getElementById('board'),panel=document.getElementById('panel'),f=document.getElementById('f');
function render(q){q=(q||'').toLowerCase();board.innerHTML='';
const phases=[...new Set(DATA.map(t=>t.phase))].sort();
for(const p of phases){const items=DATA.filter(t=>t.phase===p&&(!q||(t.id+' '+t.title+' '+t.assignee).toLowerCase().includes(q)));
if(!items.length)continue;
const lane=document.createElement('div');lane.className='lane';
lane.innerHTML='<h2>phase '+p+' · '+items.filter(t=>t.status==='Done').length+'/'+items.length+'</h2>';
for(const t of items){const c=document.createElement('div');
c.className='chip s-'+t.status.replace(' ','')+(t.ready?' ready':'')+(t.critical?' crit':'');
c.innerHTML='<div class="id">'+esc(t.id)+' <span class="t">'+esc(t.priority)+'</span></div><div class="t">'+esc(t.title)+'</div>'+
(t.assignee&&t.assignee!=='N/A'?'<div class="who">'+esc(t.assignee)+'</div>':'');
c.onclick=()=>show(t.id);lane.appendChild(c)}
board.appendChild(lane)}}
function show(id){const t=byId[id];if(!t)return;
const dependants=DATA.filter(x=>x.deps.includes(id)).map(x=>x.id);
panel.className='open';panel.innerHTML='<button onclick="panel.className=\\'\\'">×</button>'+
'<h3>'+esc(t.id)+'</h3><div>'+esc(t.title)+'</div>'+
'<p class="mut">status: '+esc(t.status)+(t.ready?' (ready)':'')+' · '+esc(t.priority)+' · phase '+esc(t.phase)+
(t.assignee!=='N/A'?' · '+esc(t.assignee):'')+(t.critical?' · on critical path':'')+'</p>'+
'<p><b>depends on</b><br>'+(t.deps.length?t.deps.map(d=>'<a onclick="show(\\''+esc(d)+'\\')">'+esc(d)+'</a> <span class="mut">'+esc(byId[d]?byId[d].status:'?')+'</span>').join('<br>'):'—')+'</p>'+
'<p><b>unblocks</b><br>'+(dependants.length?dependants.map(d=>'<a onclick="show(\\''+esc(d)+'\\')">'+esc(d)+'</a>').join('<br>'):'—')+'</p>'}
f.oninput=()=>render(f.value);render('');
</script></body></html>`;
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
  visualize: cmdVisualize,
};
if (!cmd || !(cmd in commands)) {
  fail(`usage: tri.mjs <${Object.keys(commands).join('|')}> [args]
  init [--profile lite|standard|strict] [--force]
  new-task --title "..." [--phase NN] [--dep T-NNNN]...
  claim T-NNNN --by <name> [--force]     (dynamic pull-based claiming; advisory, warns but never blocks on deps)
  release T-NNNN | done T-NNNN | next | status | graph | validate
  visualize [--out path]                 (self-contained HTML board, default .tri/graph.html)`);
}
commands[cmd](args);

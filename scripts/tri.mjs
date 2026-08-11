#!/usr/bin/env node
// tri — task register + evidence-gated delivery. Zero dependencies, Node >= 18.
// Run `tri.mjs meta` for the authoritative command and configuration contract.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, appendFileSync, rmSync, renameSync,
} from 'node:fs';
import { join, dirname, resolve, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { HOST_ADAPTERS } from './host-capabilities.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(SCRIPT_DIR, '..', 'templates');
const STATUSES = ['Planned', 'In Progress', 'Blocked', 'Done', 'Withdrawn'];
const SPECIFICATION_STATUSES = ['Unrevised', 'Specified', 'Withdrawn'];
const RUN_MODES = ['auto', 'sequential', 'parallel', 'team'];
const PROFILES = ['lite', 'standard', 'strict'];
const ID_STRATEGIES = ['random', 'sequential'];
const CONFIG_KEYS = new Set([
  'version', 'profile', 'taskDir', 'idPrefix', 'idWidth', 'idStrategy', 'statuses', 'evidenceDir',
  'taskTemplate', 'companionFiles', 'companions', 'companionHooks', 'claimScope', 'adrDir',
  'decisionFiles', 'runtimeProbes', 'expectedEnvironment', 'requiredChecks',
  'requireRemoteReservations', 'remote', 'defaultBranch', 'baseBranch', 'workflow',
]);
const COMMAND_META = {
  init: { mutates: true, git: false }, 'new-task': { mutates: true, clean: true }, validate: {}, next: {},
  claim: { mutates: true, clean: true, claim: true }, release: { mutates: true }, done: { mutates: true },
  status: {}, graph: {}, visualize: { scratch: true }, 'run-state': { mutates: true }, sync: {},
  evidence: { mutates: true }, companions: {}, doctor: {}, rebaseline: { mutates: true },
  'new-adr': { mutates: true, clean: true }, register: { mutates: true, clean: true }, 'verify-scope': {},
  'claim-ref': {}, 'claim-token': {}, meta: {},
};
const META = {
  version: '3.1.0', profiles: PROFILES, statuses: STATUSES, specificationStatuses: SPECIFICATION_STATUSES,
  runModes: RUN_MODES, hostAdapters: HOST_ADAPTERS, idStrategies: ID_STRATEGIES,
  configKeys: [...CONFIG_KEYS].sort(), commands: COMMAND_META,
};
const REBASELINE_LAYERS = [
  { id: 'charter', label: 'charter', paths: ['PROJECT_CHARTER.md'] },
  { id: 'adrs-registers', label: 'ADRs and registers', paths: ['tri/adr/**', 'tri/DECISIONS.md', 'tri/ASSUMPTIONS.md'] },
  { id: 'policies-contracts', label: 'policies and contracts', paths: ['docs/**', 'contracts/**', 'checklists/**', 'runbooks/**'] },
  { id: 'agent-facing', label: 'agent-facing documents', paths: ['AGENTS.md', 'CONTRIBUTING.md', '.claude/rules/**', '.agents/skills/**'] },
  { id: 'tasks', label: 'tasks', paths: ['tri/tasks/**', 'tasks/**'] },
];
const ID_PART_SOURCE = '(?:[0-9A-HJKMNP-TV-Z]{13}|\\d+)';
const REGISTER_ID_RE = new RegExp(`\\b([DBA]-${ID_PART_SOURCE})\\b`, 'g');
const ADR_ID_RE = new RegExp(`\\b(ADR-${ID_PART_SOURCE})\\b`, 'gi');
const RANDOM_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;

function fail(msg) { console.error(msg); process.exit(1); }
function out(msg) { console.log(msg); }
function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

function validateArgv(value, label) {
  if (!Array.isArray(value) || !value.length || value.some((part) => typeof part !== 'string' || !part.trim())) {
    fail(`${label} must be a non-empty argv array of non-empty strings`);
  }
  return value;
}

function validateRuntimeProbes(probes) {
  if (!Array.isArray(probes)) fail('runtimeProbes must be an array of argv arrays or {command: argv} objects');
  for (let i = 0; i < probes.length; i++) {
    const probe = probes[i];
    const command = Array.isArray(probe) ? probe : probe && typeof probe === 'object' ? probe.command : null;
    validateArgv(command, `runtimeProbes[${i}]`);
  }
}

function validateRepoRelativePath(value, label) {
  if (typeof value !== 'string' || !value.trim() || isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.split(/[\\/]+/).includes('..')) {
    fail(`${label} must be a non-empty repository-relative path`);
  }
}

function validateCompanionConfig(cfg) {
  if (!Array.isArray(cfg.companionFiles)) fail('companionFiles must be an array of paths');
  cfg.companionFiles.forEach((path, i) => validateRepoRelativePath(path, `companionFiles[${i}]`));
  const raw = cfg.companions;
  if (raw !== undefined && !Array.isArray(raw) && (!raw || typeof raw !== 'object')) {
    fail('companions must be an array or object of configured companion entries');
  }
  if (Array.isArray(raw)) raw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`companions[${i}] must be an object`);
    validateRepoRelativePath(entry.path, `companions[${i}].path`);
    if (entry.strategy !== undefined && entry.strategy !== 'check') fail(`companions[${i}].strategy "${entry.strategy}" unsupported; use companionHooks for automation`);
  });
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    for (const [path, entry] of Object.entries(raw)) {
      if (path === 'hooks') continue;
      validateRepoRelativePath(path, `companions.${path}`);
      if (entry !== undefined && (typeof entry !== 'object' || Array.isArray(entry))) fail(`companions.${path} must be an object`);
      if (entry?.strategy !== undefined && entry.strategy !== 'check') fail(`companions.${path}.strategy "${entry.strategy}" unsupported; use companionHooks for automation`);
    }
  }
  const hooks = { ...(cfg.companionHooks ?? {}), ...(raw && !Array.isArray(raw) ? (raw.hooks ?? {}) : {}) };
  const events = new Set(['new-task', 'validate', 'done', 'companions-check']);
  for (const [event, command] of Object.entries(hooks)) {
    if (!events.has(event)) fail(`companion hook event "${event}" unsupported (use new-task, validate, done, companions-check)`);
    validateArgv(Array.isArray(command) ? command : command?.command, `companionHooks.${event}`);
  }
}

function findRoot(from = process.cwd()) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'tri.config.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) fail('tri.config.json must contain an object');
  for (const key of Object.keys(cfg)) {
    if (key !== 'root' && !CONFIG_KEYS.has(key) && !key.startsWith('x-')) fail(`tri.config.json: unknown option "${key}" (extensions must start with x-)`);
  }
  if (!PROFILES.includes(cfg.profile)) fail(`profile must be ${PROFILES.join('|')}`);
  if (!ID_STRATEGIES.includes(cfg.idStrategy)) fail(`idStrategy must be ${ID_STRATEGIES.join('|')}`);
  if (!['trunk', 'branch-pr'].includes(cfg.workflow)) fail('workflow must be trunk|branch-pr');
  if (!Number.isInteger(cfg.idWidth) || cfg.idWidth < 1 || cfg.idWidth > 12) fail('idWidth must be an integer from 1 to 12');
  if (typeof cfg.idPrefix !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(cfg.idPrefix)) fail('idPrefix must be 1–32 letters, digits, underscores, or hyphens and start with a letter');
  for (const [key, value] of [['taskDir', cfg.taskDir], ['evidenceDir', cfg.evidenceDir], ['adrDir', cfg.adrDir]]) {
    validateRepoRelativePath(value, key);
  }
  if (cfg.taskTemplate !== undefined) validateRepoRelativePath(cfg.taskTemplate, 'taskTemplate');
  if (!Array.isArray(cfg.decisionFiles)) fail('decisionFiles must be an array of repository-relative paths');
  cfg.decisionFiles.forEach((path, i) => validateRepoRelativePath(path, `decisionFiles[${i}]`));
  if (!Array.isArray(cfg.statuses) || cfg.statuses.some((status) => typeof status !== 'string' || !status.trim())) fail('statuses must be an array of non-empty strings');
  if (!Array.isArray(cfg.requiredChecks) || cfg.requiredChecks.some((name) => typeof name !== 'string' || !name.trim())) fail('requiredChecks must be an array of evidence check names');
  if (new Set(cfg.requiredChecks).size !== cfg.requiredChecks.length) fail('requiredChecks must not contain duplicates');
  if (cfg.expectedEnvironment !== null && (!cfg.expectedEnvironment || typeof cfg.expectedEnvironment !== 'object' || Array.isArray(cfg.expectedEnvironment))) fail('expectedEnvironment must be null or an object');
  if (!cfg.claimScope || typeof cfg.claimScope !== 'object' || Array.isArray(cfg.claimScope)) fail('claimScope must be an object');
  if (cfg.claimScope.directory !== undefined) validateRepoRelativePath(cfg.claimScope.directory, 'claimScope.directory');
}

function requireGit(root) {
  const repository = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' });
  if (repository.status !== 0) fail('TRI v3 requires a Git repository after init');
}

function loadConfig() {
  const root = findRoot();
  if (!root) fail('no tri.config.json found — run `tri init` in the project root first');
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(join(root, 'tri.config.json'), 'utf8'));
  } catch (e) {
    fail(`tri.config.json is not valid JSON: ${e.message}`);
  }
  const version = cfg.version ?? 1;
  const statuses = [...new Set([...(cfg.statuses ?? STATUSES), 'Withdrawn'])];
  const merged = {
    version, root, profile: 'standard', taskDir: 'tri/tasks', idPrefix: 'T-', idWidth: 4,
    idStrategy: version >= 2 ? 'random' : 'sequential', evidenceDir: 'tri/evidence', statuses,
    companionFiles: [], companions: [], companionHooks: {}, claimScope: {}, adrDir: 'tri/adr',
    decisionFiles: ['tri/DECISIONS.md', 'tri/ASSUMPTIONS.md'], runtimeProbes: [], expectedEnvironment: null,
    requiredChecks: [], workflow: 'trunk', ...cfg, statuses,
  };
  validateConfig(merged);
  validateRuntimeProbes(merged.runtimeProbes);
  validateCompanionConfig(merged);
  requireGit(root);
  return merged;
}

function projectPreflight(cfg, { clean = false, start = false } = {}) {
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD']) {
    const path = git(['rev-parse', '--git-path', marker], cfg.root).stdout.trim();
    if (existsSync(resolve(cfg.root, path))) fail(`Git operation in progress (${marker}); finish or abort it first`);
  }
  for (const marker of ['rebase-merge', 'rebase-apply']) {
    const path = git(['rev-parse', '--git-path', marker], cfg.root).stdout.trim();
    if (existsSync(resolve(cfg.root, path))) fail('Git rebase in progress; finish or abort it first');
  }
  const branch = git(['branch', '--show-current'], cfg.root).stdout.trim();
  if (!branch) fail('detached HEAD; move to a branch before changing TRI state');
  if (clean) {
    const dirty = git(['status', '--porcelain', '--untracked-files=no'], cfg.root).stdout.trim();
    if (dirty) fail(`tracked worktree changes must be committed or stashed before starting new TRI work:\n${dirty}`);
  }
  const defaultBranch = cfg.defaultBranch ?? cfg.baseBranch ?? 'main';
  if (start && cfg.workflow === 'branch-pr' && branch === defaultBranch) fail(`branch-pr workflow cannot start work on ${defaultBranch}; create a work branch first`);
}

function git(args, cwd, allowFailure = false) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) {
    fail(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout || 'unknown error').trim()}`);
  }
  return result;
}

function remotePolicyConfigured(cfg) {
  if (cfg.requireRemoteReservations === true || cfg.remote !== undefined || cfg.defaultBranch !== undefined || cfg.baseBranch !== undefined) return true;
  const repository = git(['rev-parse', '--git-dir'], cfg.root, true);
  if (repository.status !== 0 || repository.error) return false;
  const origin = git(['remote', 'get-url', 'origin'], cfg.root, true);
  return origin.status === 0 && !origin.error;
}

function gitRef(cfg) {
  // Identifier reservations compare against repository default branch, not PR target.
  const branch = cfg.defaultBranch ?? cfg.baseBranch ?? 'main';
  const remote = cfg.remote ?? 'origin';
  return `${remote}/${branch}`;
}

function remoteRefsResult(cfg) {
  const result = git(['for-each-ref', '--format=%(refname:short)', `refs/remotes/${cfg.remote ?? 'origin'}`], cfg.root, true);
  if (result.status !== 0 || result.error) {
    return { ok: false, refs: [], reason: `cannot list remote refs: ${(result.error?.message || result.stderr || result.stdout || 'git failed').trim()}` };
  }
  return {
    ok: true,
    refs: result.stdout.split(/\r?\n/).map((x) => x.trim())
      .filter((x) => x && x !== `${cfg.remote ?? 'origin'}/HEAD`),
  };
}

function remoteRefs(cfg) { return remoteRefsResult(cfg).refs; }

function treeFilesResult(cfg, ref) {
  const result = git(['ls-tree', '-r', '--name-only', ref], cfg.root, true);
  if (result.status !== 0 || result.error) {
    return { ok: false, files: [], reason: `cannot read ${ref}: ${(result.error?.message || result.stderr || result.stdout || 'git failed').trim()}` };
  }
  return { ok: true, files: result.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean) };
}

function showRefFileResult(cfg, ref, file) {
  const result = git(['show', `${ref}:${file}`], cfg.root, true);
  if (result.status !== 0 || result.error) {
    const missing = !result.error && result.status === 128 && /does not exist|exists on disk, but not in|path .* does not exist/i.test(result.stderr || '');
    if (missing) return { ok: true, missing: true, text: '' };
    return { ok: false, text: '', reason: `cannot read ${ref}:${file}: ${(result.error?.message || result.stderr || result.stdout || 'git failed').trim()}` };
  }
  return { ok: true, missing: false, text: result.stdout };
}

function definitionIdentifiers(cfg, file, text) {
  const ids = new Map();
  const taskName = basename(file, '.md');
  const escapedPrefix = cfg.idPrefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  if (new RegExp(`^${escapedPrefix}${ID_PART_SOURCE}$`, 'i').test(taskName)) ids.set(taskName.toUpperCase(), `${file}:name`);
  const adrName = basename(file).match(new RegExp(`^(ADR-${ID_PART_SOURCE})(?:[-_].*)?\\.md$`, 'i'));
  if (adrName) ids.set(adrName[1].toUpperCase(), `${file}:name`);
  for (const match of text.matchAll(new RegExp(`^#\\s+(ADR-${ID_PART_SOURCE})\\b`, 'gmi'))) ids.set(match[1].toUpperCase(), `${file}:${match.index}`);
  for (const match of text.matchAll(new RegExp(`^\\s*\\|\\s*((?:D|B|A)-${ID_PART_SOURCE})\\b`, 'gm'))) ids.set(match[1].toUpperCase(), `${file}:${match.index}`);
  for (const match of text.matchAll(new RegExp(`^\\s*(?:#{1,6}\\s*)?((?:D|B|A)-${ID_PART_SOURCE})\\b`, 'gm'))) ids.set(match[1].toUpperCase(), `${file}:${match.index}`);
  return ids;
}

function refreshRemote(cfg) {
  const repository = git(['rev-parse', '--git-dir'], cfg.root, true);
  if (repository.status !== 0 || repository.error) return { configured: false, ok: true };
  const remote = cfg.remote ?? 'origin';
  const configured = git(['remote', 'get-url', remote], cfg.root, true);
  if (configured.status !== 0 || configured.error) {
    if (remotePolicyConfigured(cfg)) fail(`configured remote ${remote} is unavailable`);
    return { configured: false, ok: true };
  }
  const result = git(['fetch', '--prune', remote], cfg.root, true);
  if (result.status !== 0 || result.error) {
    fail(`git fetch --prune ${remote} failed: ${(result.error?.message || result.stderr || result.stdout || 'git failed').trim()}`);
  }
  return { configured: true, ok: true };
}

function remoteIdentifierInventory(cfg) {
  const baseRef = gitRef(cfg);
  if (!remotePolicyConfigured(cfg)) return { available: false, localOnly: true, baseRef, reason: 'no configured or reachable origin remote', branches: [], reserved: new Map(), collisions: [] };
  const baseTree = treeFilesResult(cfg, baseRef);
  if (!baseTree.ok) return { available: false, baseRef, reason: baseTree.reason, branches: [], reserved: new Map(), collisions: [] };
  const refs = remoteRefsResult(cfg);
  if (!refs.ok) return { available: false, baseRef, reason: refs.reason, branches: [], reserved: new Map(), collisions: [] };
  const branches = [];
  for (const ref of refs.refs) {
    if (ref === baseRef) continue;
    const changed = git(['diff', '--name-only', `${baseRef}...${ref}`], cfg.root, true);
    if (changed.status !== 0 || changed.error) {
      return { available: false, baseRef, reason: `cannot compare ${ref} with ${baseRef}: ${(changed.error?.message || changed.stderr || changed.stdout || 'git failed').trim()}`, branches, reserved: new Map(), collisions: [] };
    }
    const files = changed.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const ids = new Map();
    for (const file of files) {
      const text = showRefFileResult(cfg, ref, file);
      const baseText = showRefFileResult(cfg, baseRef, file);
      if (!text.ok || !baseText.ok) {
        return { available: false, baseRef, reason: (!text.ok ? text.reason : baseText.reason), branches, reserved: new Map(), collisions: [] };
      }
      const baseDefinitions = baseText.missing ? new Map() : definitionIdentifiers(cfg, file, baseText.text);
      const branchDefinitions = text.missing ? new Map() : definitionIdentifiers(cfg, file, text.text);
      for (const [id, location] of branchDefinitions) {
        if (!baseDefinitions.has(id)) ids.set(id, { id, ref, branch: ref, file, location });
      }
    }
    branches.push({ ref, ids });
  }
  const reserved = new Map();
  for (const branch of branches) for (const [id, info] of branch.ids) {
    if (!reserved.has(id)) reserved.set(id, []);
    if (!reserved.get(id).some((owner) => owner.ref === info.ref)) reserved.get(id).push(info);
  }
  const collisions = [...reserved.entries()].filter(([, owners]) => owners.length > 1)
    .map(([id, owners]) => ({ id, owners }));
  return { available: true, baseRef, branches, reserved, collisions };
}

function requireRemoteInventory(cfg, purpose) {
  const inventory = remoteIdentifierInventory(cfg);
  if (!inventory.available) fail(`${purpose} requires remote identifier inventory: ${inventory.reason}`);
  return inventory;
}

function localIdentifierMap(cfg, tasks = loadTasks(cfg)) {
  const map = new Map();
  for (const task of tasks) map.set(task.id, { id: task.id, file: relative(cfg.root, task.file), branch: 'worktree' });
  const dirs = [cfg.adrDir, ...(cfg.decisionFiles ?? [])];
  for (const entry of dirs) {
    const path = join(cfg.root, entry);
    const files = existsSync(path) && statSync(path).isDirectory()
      ? readdirSync(path).filter((f) => f.endsWith('.md')).map((f) => join(path, f))
      : [path];
    for (const file of files) if (existsSync(file)) {
      const text = readFileSync(file, 'utf8');
      for (const [id, location] of definitionIdentifiers(cfg, relative(cfg.root, file), text)) {
        if (!map.has(id)) map.set(id, { id, file: relative(cfg.root, file), branch: 'worktree', location });
      }
    }
  }
  return map;
}

function numericIdSet(cfg, prefix, tasks = loadTasks(cfg)) {
  const values = new Set();
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const re = new RegExp(`^${escapedPrefix}(\\d+)$`);
  for (const id of localIdentifierMap(cfg, tasks).keys()) {
    const match = id.match(re);
    if (match) values.add(Number(match[1]));
  }
  const remote = remoteIdentifierInventory(cfg);
  if (remote.available) for (const id of remote.reserved.keys()) {
    const match = id.match(re);
    if (match) values.add(Number(match[1]));
  } else if (remotePolicyConfigured(cfg)) {
    fail(`identifier allocation requires remote inventory: ${remote.reason}`);
  }
  return values;
}

function runCompanionHook(cfg, event, details = {}) {
  const configured = cfg.companionHooks?.[event] ?? cfg.companions?.hooks?.[event];
  if (!configured) return;
  const command = Array.isArray(configured) ? configured : configured.command;
  if (!Array.isArray(command) || !command.length) fail(`companion hook ${event} must be a non-empty argv array`);
  const result = spawnSync(command[0], [...command.slice(1), event, JSON.stringify(details)], { cwd: cfg.root, encoding: 'utf8' });
  if (result.error) fail(`companion hook ${event} failed to start: ${result.error.message}`);
  if (result.status !== 0 || result.signal) fail(`companion hook ${event} failed${result.signal ? ` with signal ${result.signal}` : ''}: ${(result.stderr || result.stdout || '').trim()}`);
  if (result.stdout.trim()) out(`companion hook ${event}: ${result.stdout.trim()}`);
}

function companionEntries(cfg) {
  const raw = cfg.companions;
  const entries = Array.isArray(raw) ? raw : raw && typeof raw === 'object'
    ? Object.entries(raw).filter(([key]) => key !== 'hooks').map(([path, value]) => ({ path, ...(value ?? {}) }))
    : [];
  return [...cfg.companionFiles.map((path) => ({ path, legacy: true })), ...entries]
    .filter((entry, index, all) => entry.path && all.findIndex((x) => x.path === entry.path) === index);
}

// ---------- claim scope ----------
const CLAIM_KINDS = ['task', 'responsibility', 'architecture', 'run', 'ship'];
function globToRegExp(glob) {
  const escaped = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`);
}
function pathMatches(path, patterns) { return patterns.some((pattern) => globToRegExp(pattern).test(path)); }
function validatePathList(scope, field, file) {
  const values = scopeList(scope[field], field, file);
  for (const value of values) {
    if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.split(/[\\/]+/).includes('..')) fail(`claim scope ${file}: ${field} must use repository-relative paths`);
    if (/[*?[\]{}]/.test(value)) fail(`claim scope ${file}: ${field} does not support globs; use an exact file or a directory ending in /`);
  }
  return values;
}
function claimManifestPath(cfg, id) {
  const dir = cfg.claimScope?.directory ?? '.tri/claims';
  return join(cfg.root, dir, `${id}.json`);
}
function claimRef(id) { return `refs/heads/tri/claims/${id}`; }
function remoteClaimHead(cfg, id) {
  const remote = cfg.remote ?? 'origin';
  const result = git(['ls-remote', '--heads', remote, claimRef(id)], cfg.root, true);
  if (result.status !== 0 || result.error) fail(`cannot verify remote claim ${claimRef(id)} on ${remote}`);
  return result.stdout.trim().split(/\s+/)[0] || null;
}
function requireRemoteClaim(cfg, id, owner) {
  if (cfg.workflow !== 'branch-pr') return;
  const head = git(['rev-parse', 'HEAD'], cfg.root).stdout.trim();
  const remoteHead = remoteClaimHead(cfg, id);
  if (!remoteHead) fail(`${id} is not remotely reserved; create and push a claim token first`);
  const token = git(['cat-file', '-p', remoteHead], cfg.root, true);
  if (token.status !== 0 || !token.stdout.includes(`parent ${head}\n`) || !token.stdout.includes(`TRI claim ${id}\n`)
    || !token.stdout.includes(`owner ${owner}\n`)) {
    fail(`${id} remote claim is not a token for current HEAD ${head}`);
  }
  return { token: remoteHead, base: head };
}
function requireCompletionClaim(cfg, task) {
  if (cfg.workflow !== 'branch-pr') return;
  const scopePath = claimManifestPath(cfg, task.id);
  if (!existsSync(scopePath)) fail(`${task.id}: local claim scope is missing`);
  const scope = validateClaimScope(cfg, readClaimManifest(scopePath), loadTasks(cfg), scopePath);
  const remoteHead = remoteClaimHead(cfg, task.id);
  if (!remoteHead || remoteHead !== scope.claimToken) fail(`${task.id}: active remote claim token is missing or changed`);
  const token = git(['cat-file', '-p', remoteHead], cfg.root, true);
  if (token.status !== 0 || !token.stdout.includes(`owner ${task.assignee}\n`)) fail(`${task.id}: active remote claim owner differs from ${task.assignee}`);
}
function requireReleasedRemoteClaim(cfg, id) {
  if (cfg.workflow === 'branch-pr' && remoteClaimHead(cfg, id)) fail(`delete remote ${claimRef(id)} before releasing ${id}`);
}
function listClaimManifests(cfg) {
  const dir = join(cfg.root, cfg.claimScope?.directory ?? '.tri/claims');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)).sort();
}
function readClaimManifest(file) {
  let value;
  try { value = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { fail(`claim scope ${file} is not valid JSON: ${e.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`claim scope ${file} must be an object`);
  return value;
}
function scopeList(value, field, file) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || !x.trim())) fail(`claim scope ${file}: ${field} must be an array of non-empty strings`);
  const result = value.map((x) => x.trim());
  if (new Set(result).size !== result.length) fail(`claim scope ${file}: ${field} contains duplicates`);
  return result;
}
function validateClaimScope(cfg, scope, tasks, file = '<scope>') {
  if (scope.schemaVersion !== 1) fail(`claim scope ${file}: schemaVersion must be 1`);
  if (typeof scope.owner !== 'string' || !scope.owner.trim() || /[\r\n]/.test(scope.owner)) fail(`claim scope ${file}: owner must be one non-empty line`);
  if (scope.attempt === undefined) scope.attempt = createHash('sha256').update(`${file}:${scope.owner}`).digest('hex').slice(0, 24);
  if (typeof scope.attempt !== 'string' || !/^[a-f0-9]{24}$/.test(scope.attempt)) fail(`claim scope ${file}: attempt must be a 24-character hex identifier`);
  if (!CLAIM_KINDS.includes(scope.kind)) fail(`claim scope ${file}: kind must be ${CLAIM_KINDS.join(', ')}`);
  const primary = scopeList(scope.primaryTasks, 'primaryTasks', file);
  if (!primary.length) fail(`claim scope ${file}: primaryTasks must not be empty`);
  const covered = scopeList(scope.coveredTasks, 'coveredTasks', file);
  const mayCover = scopeList(scope.mayCover, 'mayCover', file);
  const responsibilities = scopeList(scope.responsibilities, 'responsibilities', file);
  const adrs = scopeList(scope.relatedADRs, 'relatedADRs', file);
  const writePaths = validatePathList(scope, 'writePaths', file);
  const readPaths = validatePathList(scope, 'readPaths', file);
  const forbiddenPaths = validatePathList(scope, 'forbiddenPaths', file);
  const sharedPaths = validatePathList(scope, 'sharedPaths', file);
  const known = new Set(tasks.map((t) => t.id));
  for (const id of [...primary, ...covered, ...mayCover]) if (!known.has(id)) fail(`claim scope ${file}: unknown task ${id}`);
  const labels = cfg.claimScope?.responsibilities;
  if (Array.isArray(labels)) for (const label of responsibilities) if (!labels.includes(label)) fail(`claim scope ${file}: unknown responsibility ${label}`);
  const allTasks = [...primary, ...covered, ...mayCover];
  if (new Set(allTasks).size !== allTasks.length) fail(`claim scope ${file}: task appears in multiple scope lists`);
  return { ...scope, primaryTasks: primary, coveredTasks: covered, mayCover, responsibilities, relatedADRs: adrs, writePaths, readPaths, forbiddenPaths, sharedPaths };
}
function patternsOverlap(left, right) {
  const a = left.replace(/^\.\//, '');
  const b = right.replace(/^\.\//, '');
  if (a === b) return true;
  return (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b));
}
function scopeConflicts(candidate, existing) {
  const conflicts = [];
  const candidateTasks = [...candidate.primaryTasks, ...candidate.coveredTasks, ...candidate.mayCover];
  const existingTasks = [...existing.primaryTasks, ...existing.coveredTasks, ...existing.mayCover];
  const overlap = candidateTasks.filter((x) => existingTasks.includes(x));
  if (overlap.length) conflicts.push(`tasks: ${[...new Set(overlap)].join(', ')}`);
  for (const field of ['responsibilities', 'relatedADRs']) {
    const overlap = candidate[field].filter((x) => existing[field].includes(x));
    if (overlap.length) conflicts.push(`${field}: ${overlap.join(', ')}`);
  }
  for (const candidatePath of candidate.writePaths) {
    for (const existingPath of [...existing.writePaths, ...existing.sharedPaths]) {
      if (patternsOverlap(candidatePath, existingPath)) conflicts.push(`writePaths: ${candidatePath} overlaps ${existingPath}`);
    }
  }
  for (const candidatePath of candidate.sharedPaths) {
    for (const existingPath of existing.writePaths) {
      if (patternsOverlap(candidatePath, existingPath)) conflicts.push(`sharedPaths: ${candidatePath} overlaps ${existingPath}`);
    }
  }
  return [...new Set(conflicts)];
}
function checkClaimScope(cfg, candidate, tasks, ignoreFile) {
  const manifests = [];
  for (const file of listClaimManifests(cfg)) {
    if (file === ignoreFile) continue;
    manifests.push({ file, scope: validateClaimScope(cfg, readClaimManifest(file), tasks, file) });
  }
  const conflicts = manifests.flatMap(({ file, scope }) => scopeConflicts(candidate, scope).map((c) => `${file}: ${c}`));
  if (conflicts.length) fail(`claim scope overlap; resolve before claiming:\n${conflicts.join('\n')}`);
}
function claimScopeFor(cfg, id, by, args, tasks) {
  const supplied = argValue(args, '--scope');
  const task = tasks.find((entry) => entry.id === id);
  const scope = supplied ? readClaimManifest(resolve(cfg.root, supplied)) : {
    schemaVersion: 1, owner: by, attempt: randomBytes(12).toString('hex'), branch: process.env.GIT_BRANCH ?? null,
    claimCommit: process.env.GIT_COMMIT ?? null, kind: 'task', primaryTasks: [id], coveredTasks: [], mayCover: [],
    responsibilities: [], relatedADRs: [], writePaths: taskExpectedFiles(task), readPaths: [], forbiddenPaths: [],
    sharedPaths: [], baseBranch: cfg.baseBranch ?? null,
  };
  if (!scope.primaryTasks?.length) scope.primaryTasks = [id];
  if (!scope.owner) scope.owner = by;
  if (!scope.attempt) scope.attempt = randomBytes(12).toString('hex');
  const checked = validateClaimScope(cfg, scope, tasks, supplied ?? claimManifestPath(cfg, id));
  if (checked.owner !== by && !args.includes('--force')) fail(`claim scope owner ${checked.owner} differs from --by ${by}`);
  if (!checked.primaryTasks.includes(id)) fail(`claim scope primaryTasks must include ${id}`);
  checkClaimScope(cfg, checked, tasks, claimManifestPath(cfg, id));
  return checked;
}

// ---------- task parsing ----------
function idRegex(cfg, anchored = false) {
  const esc = cfg.idPrefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return new RegExp(anchored ? `^${esc}${ID_PART_SOURCE}\\.md$` : `${esc}${ID_PART_SOURCE}(?![0-9A-Z])`, anchored ? 'i' : 'gi');
}

function isTaskId(cfg, value) {
  const escaped = cfg.idPrefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return typeof value === 'string' && new RegExp(`^${escaped}${ID_PART_SOURCE}$`, 'i').test(value);
}

function taskArgument(cfg, args, usage) {
  return args.find((value) => isTaskId(cfg, value)) ?? fail(usage);
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
    specificationStatus: sections['Specification status'] ?? 'Specified',
    assignee: sections['Assignee'] ?? 'N/A',
    priority: sections['Priority'] ?? 'P1',
    title: (text.match(new RegExp(`^# ${cfg.idPrefix.replace(/[-]/g, '\\-')}${ID_PART_SOURCE}:\\s*(.+)$`, 'mi')) ?? [,''])[1],
    deps: [...new Set(deps.filter((d) => d !== id))],
  };
}

function loadTasks(cfg) {
  return taskFiles(cfg).map((f) => parseTask(f, cfg));
}

function resolvePhaseDir(cfg, phase) {
  const value = String(phase).trim();
  if (!/^\d+(?:-[A-Za-z0-9][A-Za-z0-9-]*)?$/.test(value)) {
    fail(`invalid phase "${phase}" — use NN or NN-label`);
  }

  const taskRoot = join(cfg.root, cfg.taskDir);
  const exactName = `phase-${value}`;
  const exact = join(taskRoot, exactName);
  const suffixMatches = /^\d+$/.test(value) && existsSync(taskRoot)
    ? readdirSync(taskRoot)
      .filter((name) => name.startsWith(`${exactName}-`) && statSync(join(taskRoot, name)).isDirectory())
      .sort()
    : [];

  if (existsSync(exact)) {
    if (!statSync(exact).isDirectory()) fail(`phase path exists but is not a directory: ${exact}`);
    if (suffixMatches.length) {
      fail(`phase ${value} is ambiguous; matching directories: ${[exactName, ...suffixMatches].join(', ')}`);
    }
    return exact;
  }

  // Existing projects may name phase directories with a human-readable suffix,
  // such as phase-12-mobile. Reuse the only matching directory instead of
  // creating a parallel phase-12 tree that readers would treat as another lane.
  if (suffixMatches.length > 1) {
    fail(`phase ${value} is ambiguous; matching directories: ${suffixMatches.join(', ')}`);
  }
  return suffixMatches.length === 1 ? join(taskRoot, suffixMatches[0]) : exact;
}

function replaceSectionText(text, name, value) {
  const pattern = new RegExp(`(## ${name}\\n\\n)[\\s\\S]*?(?=\\n## |\\n?$)`);
  const updated = text.replace(pattern, `$1${value.trim()}\n`);
  return updated === text ? null : updated;
}

function updateSections(task, values) {
  let updated = task.text;
  for (const [name, value] of Object.entries(values)) {
    updated = replaceSectionText(updated, name, value);
    if (updated === null) fail(`${task.id}: could not update section "${name}"`);
  }
  atomicWrite(task.file, updated);
}

function insertSection(text, after, name, value) {
  const marker = `## ${after}\n\n`;
  const index = text.indexOf(marker);
  if (index < 0) return `${text.trimEnd()}\n\n## ${name}\n\n${value.trim()}\n`;
  const contentStart = index + marker.length;
  const next = text.indexOf('\n## ', contentStart);
  const insertAt = next < 0 ? text.length : next;
  return `${text.slice(0, insertAt).trimEnd()}\n\n## ${name}\n\n${value.trim()}\n${text.slice(insertAt)}`;
}

function setSection(task, name, value) {
  const updated = replaceSectionText(task.text, name, value);
  if (updated === null) fail(`${task.id}: could not update section "${name}"`);
  atomicWrite(task.file, updated);
}

function byId(tasks) {
  const map = new Map();
  for (const t of tasks) {
    if (map.has(t.id)) fail(`duplicate task ID ${t.id}:\n  ${map.get(t.id).file}\n  ${t.file}`);
    map.set(t.id, t);
  }
  return map;
}

function depSatisfied(dep) {
  return dep && (dep.status === 'Done' || dep.status === 'Withdrawn' || dep.specificationStatus === 'Withdrawn');
}

function readyTasks(tasks, map) {
  return tasks.filter((t) => (t.status === 'Planned' || t.status === 'Ready')
    && t.status !== 'Withdrawn' && t.specificationStatus !== 'Withdrawn'
    && t.deps.every((d) => depSatisfied(map.get(d))));
}

function randomId(prefix, used = new Set()) {
  for (;;) {
    let value = BigInt(`0x${randomBytes(8).toString('hex')}`);
    let part = '';
    for (let i = 0; i < 13; i++) { part = RANDOM_ALPHABET[Number(value & 31n)] + part; value >>= 5n; }
    const id = `${prefix}${part}`;
    if (!used.has(id)) return id;
  }
}

function nextId(cfg, prefix, tasks = loadTasks(cfg)) {
  const localIds = new Set(localIdentifierMap(cfg, tasks).keys());
  if (cfg.idStrategy === 'random') return randomId(prefix, localIds);
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const re = new RegExp(`^${escapedPrefix}(\\d+)$`);
  const local = new Set([...localIds].map((id) => id.match(re)).filter(Boolean).map((match) => Number(match[1])));
  const used = numericIdSet(cfg, prefix, tasks);
  let n = local.size ? Math.max(...local) + 1 : 1;
  while (used.has(n)) n += 1;
  return `${prefix}${String(n).padStart(cfg.idWidth, '0')}`;
}

function sectionBody(text, name) {
  const match = text.match(new RegExp(`^## ${name}\\n\\n([\\s\\S]*?)(?=\\n## |\\n?$)`, 'm'));
  return match ? match[1].trim() : '';
}

function boilerplateWarnings(tasks) {
  const warnings = [];
  const titleCopies = tasks.filter((t) => {
    const title = t.title?.trim().toLowerCase();
    if (!title || title.length < 5) return false;
    const objective = sectionBody(t.text, 'Objective').trim().replace(/[.!?]+$/, '').toLowerCase();
    return objective.endsWith(title);
  });
  for (const t of titleCopies) warnings.push(`${t.id}: Objective restates the title verbatim — replace with what is true after this task`);
  if (tasks.length < 4) return warnings;
  for (const name of ['Licensing requirements', 'Religious-data integrity requirements', 'Performance budget', 'Observability', 'Deployment', 'Rollback']) {
    const bodies = tasks.map((t) => sectionBody(t.text, name)).filter((body) => body.length >= 20);
    if (bodies.length < 4) continue;
    const counts = new Map();
    for (const body of bodies) counts.set(body, (counts.get(body) ?? 0) + 1);
    const [body, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (count / bodies.length > 0.7) warnings.push(`section "${name}" is identical across ${count}/${bodies.length} tasks (>70%)`);
  }
  return warnings;
}

function runtimeValue(command, cwd) {
  validateArgv(command, 'runtime probe command');
  let result;
  try { result = spawnSync(command[0], command.slice(1), { cwd, encoding: 'utf8' }); }
  catch (error) { fail(`runtime probe ${command.join(' ')} failed to start: ${error.message}`); }
  if (result.error) fail(`runtime probe ${command.join(' ')} failed to start: ${result.error.message}`);
  if (result.status !== 0 || result.signal) {
    fail(`runtime probe ${command.join(' ')} failed${result.signal ? ` with signal ${result.signal}` : ` with exit status ${result.status}`}: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return { command, status: result.status, output: (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] };
}

function evidenceContext(cfg, id) {
  const commit = git(['rev-parse', 'HEAD'], cfg.root, true);
  const branch = git(['branch', '--show-current'], cfg.root, true);
  const probes = (cfg.runtimeProbes ?? []).map((probe) => {
    const command = Array.isArray(probe) ? probe : probe.command;
    return runtimeValue(command, cfg.root);
  });
  let attempt = null; let claimToken = null;
  const scope = id ? claimManifestPath(cfg, id) : null;
  if (scope && existsSync(scope)) {
    const claim = validateClaimScope(cfg, readClaimManifest(scope), loadTasks(cfg), scope);
    attempt = claim.attempt; claimToken = claim.claimToken ?? null;
  }
  return {
    capturedAt: new Date().toISOString(), attempt, claimToken,
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    branch: branch.status === 0 ? branch.stdout.trim() : null,
    tri: META.version,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    probes,
  };
}

function appendEvidenceContext(cfg, id, command, result, context = evidenceContext(cfg, id)) {
  const evDir = join(cfg.root, cfg.evidenceDir);
  mkdirSync(evDir, { recursive: true });
  const date = context.capturedAt.slice(0, 10).replaceAll('-', '');
  const path = join(evDir, `${id}-${date}.md`);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : `# Evidence: ${id}\n\n`;
  const fence = '```';
  const block = `## Execution context (${context.capturedAt})\n\n${fence}json\n${JSON.stringify({ command, ...result, context }, null, 2)}\n${fence}\n`;
  atomicWrite(path, existing.includes('## Execution context') ? `${existing}\n${block}` : `${existing.trimEnd()}\n\n${block}`);
  return path;
}

function evidenceRecords(text) {
  const records = [];
  const pattern = /## Execution context[^\n]*\n\n```json\n([\s\S]*?)\n```/g;
  for (const match of text.matchAll(pattern)) {
    try {
      const record = JSON.parse(match[1]);
      if (record.context && typeof record.context === 'object') records.push(record);
    } catch {
      // Legacy prose remains readable but cannot satisfy a v3 evidence gate.
    }
  }
  return records;
}
function expectedEnvironmentMismatches(expected, actual) {
  if (!expected || typeof expected !== 'object') return [];
  const mismatches = [];
  for (const [key, wanted] of Object.entries(expected)) {
    const got = actual?.[key];
    const matches = typeof wanted === 'string' && typeof got === 'string'
      ? got.startsWith(wanted)
      : JSON.stringify(got) === JSON.stringify(wanted);
    if (!matches) mismatches.push(`${key} expected ${JSON.stringify(wanted)}, got ${JSON.stringify(got)}`);
  }
  return mismatches;
}

function taskEvidenceRecords(cfg, task) {
  const evDir = join(cfg.root, cfg.evidenceDir);
  const prefix = `${task.id}-`;
  const files = existsSync(evDir) ? readdirSync(evDir).filter((f) => f.startsWith(prefix) && f.endsWith('.md')) : [];
  return files.flatMap((f) => evidenceRecords(readFileSync(join(evDir, f), 'utf8')));
}

function evidenceGateErrors(cfg, task) {
  if (cfg.profile === 'lite') return [];
  const records = taskEvidenceRecords(cfg, task);
  const scope = claimManifestPath(cfg, task.id);
  const attempt = existsSync(scope) ? validateClaimScope(cfg, readClaimManifest(scope), loadTasks(cfg), scope).attempt : null;
  const successful = records.filter((record) => record.exitStatus === 0 && !record.signal && !record.error
    && (record.context?.attempt === attempt || (cfg.version < 2 && !record.context?.attempt)));
  const errors = [];
  if (!successful.length) errors.push(`requires at least one successful structured evidence record at ${cfg.evidenceDir}/${task.id}-<date>.md from \`tri evidence\``);
  for (const name of cfg.requiredChecks) {
    if (!successful.some((record) => record.check === name)) errors.push(`required evidence check "${name}" has no successful record`);
  }
  if (cfg.profile === 'strict' && cfg.expectedEnvironment) {
    const mismatches = successful.flatMap((record) => expectedEnvironmentMismatches(cfg.expectedEnvironment, record.context));
    if (mismatches.length) errors.push(`evidence runtime differs from expected environment: ${[...new Set(mismatches)].join('; ')}`);
  }
  return errors;
}

function integratedEvidenceGateErrors(cfg, task) {
  if (cfg.profile === 'lite' || cfg.version < 2) return [];
  const claimToken = cfg.workflow === 'branch-pr' ? remoteClaimHead(cfg, task.id) : null;
  const records = taskEvidenceRecords(cfg, task).filter((record) => record.exitStatus === 0 && !record.signal && !record.error
    && (!claimToken || record.context?.claimToken === claimToken));
  const errors = [];
  if (!records.length) errors.push(`${task.id}: integrated task lacks successful evidence for its active claim`);
  for (const name of cfg.requiredChecks) if (!records.some((record) => record.check === name)) errors.push(`${task.id}: integrated task lacks required check "${name}"`);
  if (cfg.profile === 'strict' && cfg.expectedEnvironment) {
    const mismatches = records.flatMap((record) => expectedEnvironmentMismatches(cfg.expectedEnvironment, record.context));
    if (mismatches.length) errors.push(`${task.id}: integrated evidence environment mismatch: ${[...new Set(mismatches)].join('; ')}`);
  }
  return errors;
}

function evidenceWarnings(cfg, task) {
  const records = taskEvidenceRecords(cfg, task);
  if (!records.length) return ['Evidence record lacks structured execution context'];
  if (!cfg.expectedEnvironment || cfg.profile === 'strict') return [];
  const mismatches = records.flatMap((record) => expectedEnvironmentMismatches(cfg.expectedEnvironment, record.context));
  return mismatches.length ? [`Evidence runtime differs from expected environment: ${[...new Set(mismatches)].join('; ')}`] : [];
}

function cmdInit(args) {
  const profile = argValue(args, '--profile') ?? 'standard';
  const idStrategy = argValue(args, '--id-strategy') ?? 'random';
  if (!PROFILES.includes(profile)) fail(`unknown profile "${profile}" (${PROFILES.join('|')})`);
  if (!ID_STRATEGIES.includes(idStrategy)) fail(`unknown id strategy "${idStrategy}" (${ID_STRATEGIES.join('|')})`);
  const root = process.cwd();
  if (existsSync(join(root, 'tri.config.json'))) {
    if (!args.includes('--force')) fail('already initialized (tri.config.json exists); use --force to overwrite config only');
  }
  const cfg = { version: 2, profile, taskDir: 'tri/tasks', idStrategy, workflow: 'trunk' };
  atomicWrite(join(root, 'tri.config.json'), JSON.stringify(cfg, null, 2) + '\n');
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
  const ignore = join(root, '.gitignore');
  const ignoreText = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
  if (!ignoreText.split(/\r?\n/).includes('.tri/')) appendFileSync(ignore, `${ignoreText && !ignoreText.endsWith('\n') ? '\n' : ''}.tri/\n`);
  out(`initialized tri workspace (profile: ${profile}, ids: ${idStrategy}) at ${root}`);
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'record';
}

function cmdNewAdr(args) {
  const cfg = loadConfig();
  projectPreflight(cfg, { clean: true, start: true });
  if (cfg.idStrategy === 'sequential') refreshRemote(cfg);
  const title = argValue(args, '--title') ?? fail('--title required');
  const id = nextId(cfg, 'ADR-');
  const dir = join(cfg.root, cfg.adrDir);
  mkdirSync(dir, { recursive: true });
  const projectTemplate = join(cfg.root, cfg.adrDir, 'ADR-template.md');
  const body = readFileSync(existsSync(projectTemplate) ? projectTemplate : join(TEMPLATES, 'ADR-template.md'), 'utf8')
    .replaceAll('ADR-NNNN', id).replace('Title', title)
    .replace(/^- Status:.*$/m, '- Status: Proposed').replace('YYYY-MM-DD', new Date().toISOString().slice(0, 10));
  if (!body.includes(`# ${id}:`) || !body.includes('- Status: Proposed')) fail('ADR template must contain an ADR-NNNN heading and Status field');
  const file = join(dir, `${id}-${slug(title)}.md`);
  atomicWrite(file, body);
  out(`created ${id} at ${relative(cfg.root, file)}`);
}

function tableCell(value) { return String(value ?? '').replaceAll('|', '\\|').replace(/\s*\n\s*/g, ' ').trim(); }
function appendTableRow(text, heading, row) {
  const start = text.indexOf(`## ${heading}`);
  if (start < 0) return null;
  const next = text.indexOf('\n## ', start + 3);
  const end = next < 0 ? text.length : next;
  return `${text.slice(0, end).trimEnd()}\n${row}\n${text.slice(end).replace(/^\n*/, '\n')}`;
}

function cmdRegister(args) {
  const cfg = loadConfig();
  projectPreflight(cfg, { clean: true, start: true });
  if (cfg.idStrategy === 'sequential') refreshRemote(cfg);
  const kind = argValue(args, '--kind') ?? fail('--kind decision|blocker|assumption required');
  const text = argValue(args, '--text') ?? fail('--text required');
  const entries = cfg.decisionFiles.map((path) => join(cfg.root, path)).filter(existsSync);
  let prefix; let heading; let row; let file;
  if (kind === 'assumption') {
    prefix = 'A-'; heading = 'Assumption Register';
    file = entries.find((path) => readFileSync(path, 'utf8').includes('# Assumption Register')) ?? fail('assumption register not found');
    const id = nextId(cfg, prefix);
    row = `| ${id} | ${tableCell(text)} | ${tableCell(argValue(args, '--why') ?? 'N/A')} | ${tableCell(argValue(args, '--invalidated-by') ?? 'N/A')} |`;
    const current = readFileSync(file, 'utf8').trimEnd();
    atomicWrite(file, `${current}\n${row}\n`);
    out(`recorded ${id} in ${relative(cfg.root, file)}`); return;
  }
  if (!['decision', 'blocker'].includes(kind)) fail('--kind must be decision|blocker|assumption');
  file = entries.find((path) => readFileSync(path, 'utf8').includes('# Decision Register')) ?? fail('decision register not found');
  prefix = kind === 'decision' ? 'D-' : 'B-';
  heading = kind === 'decision' ? 'Resolved Direction' : 'Blocking Decisions';
  const id = nextId(cfg, prefix);
  row = kind === 'decision'
    ? `| ${id} | ${tableCell(text)} | ${tableCell(argValue(args, '--rationale') ?? 'N/A')} |`
    : `| ${id} | ${tableCell(text)} | ${tableCell(argValue(args, '--owner') ?? 'N/A')} | ${tableCell(argValue(args, '--blocks') ?? 'N/A')} |`;
  const updated = appendTableRow(readFileSync(file, 'utf8'), heading, row);
  if (updated === null) fail(`${relative(cfg.root, file)} is missing ## ${heading}`);
  atomicWrite(file, updated);
  out(`recorded ${id} in ${relative(cfg.root, file)}`);
}

function cmdNewTask(args) {
  const cfg = loadConfig();
  projectPreflight(cfg, { clean: true, start: true });
  if (cfg.idStrategy === 'sequential') refreshRemote(cfg);
  const title = argValue(args, '--title') ?? fail('--title required');
  const phaseArg = argValue(args, '--phase');
  const phase = phaseArg ?? '01';
  const deps = argValues(args, '--dep');
  const tasks = loadTasks(cfg);
  const id = nextId(cfg, cfg.idPrefix, tasks);
  const dir = resolvePhaseDir(cfg, phase);
  mkdirSync(dir, { recursive: true });
  const depsBlock = deps.length ? deps.map((d) => `- ${d}`).join('\n') : 'N/A';
  let body;
  if (cfg.taskTemplate) {
    const tplPath = join(cfg.root, cfg.taskTemplate);
    if (!existsSync(tplPath)) fail(`taskTemplate not found: ${cfg.taskTemplate}`);
    body = readFileSync(tplPath, 'utf8');
    body = body
      .replace(new RegExp(`${cfg.idPrefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}N+`, 'g'), id)
      .replaceAll('{{ID}}', id)
      .replaceAll('{{TITLE}}', title)
      .replaceAll('{{PHASE}}', phase)
      .replaceAll('{{DEPS}}', depsBlock);
    if (!/^#\s+/.test(body)) body = `# ${id}: ${title}\n\n${body}`;
    else body = body.replace(/^#\s+.*$/m, `# ${id}: ${title}`);
    if (!body.includes('## Status')) fail(`taskTemplate must contain a ## Status section: ${cfg.taskTemplate}`);
    if (!body.includes('## Dependencies')) fail(`taskTemplate must contain a ## Dependencies section: ${cfg.taskTemplate}`);
    if (!body.includes('## Acceptance criteria')) fail(`taskTemplate must contain a ## Acceptance criteria section: ${cfg.taskTemplate}`);
    if (phaseArg !== undefined) {
      const updated = replaceSectionText(body, 'Phase', phase);
      if (updated === null) fail(`taskTemplate must contain a ## Phase section when --phase is supplied: ${cfg.taskTemplate}`);
      body = updated;
    }
    if (deps.length) {
      const updated = replaceSectionText(body, 'Dependencies', depsBlock);
      if (updated === null) fail(`taskTemplate must contain a ## Dependencies section when --dep is supplied: ${cfg.taskTemplate}`);
      body = updated;
    }
  } else {
    body = readFileSync(join(TEMPLATES, `TASK-${cfg.profile}.md`), 'utf8')
      .replaceAll('{{ID}}', id)
      .replaceAll('{{TITLE}}', title)
      .replaceAll('{{PHASE}}', phase)
      .replaceAll('{{DEPS}}', depsBlock);
    body = body.replace(/^## Objective\n\n.*?(?=\n## |\n?$)/ms, `## Objective\n\nTODO: state what is true after this task that was not true before.\n`);
    body = body.replace(/^## Specification status\n\n.*?(?=\n## |\n?$)/ms, '## Specification status\n\nUnrevised\n');
  }
  if (!body.includes('## Specification status')) body = insertSection(body, 'Status', 'Specification status', 'Unrevised');
  const file = join(dir, `${id}.md`);
  atomicWrite(file, body);
  out(`created ${id} (${title}) at ${file}`);
  out(cfg.idStrategy === 'random'
    ? '  decentralized id allocated; no global sequence or remote reservation required'
    : '  sequential id reserved against remote branches and configured default branch');
  if (cfg.taskTemplate) out(`  template: ${cfg.taskTemplate} — fill every field the project requires before claiming`);
  if (companionEntries(cfg).length) {
    out('  companion files need configured maintenance or same-change updates:');
    for (const entry of companionEntries(cfg)) out(`    ${entry.path}${entry.legacy ? ' (legacy check-only)' : ''}`);
  }
  runCompanionHook(cfg, 'new-task', { id, title, phase, dependencies: deps });
}

function cmdValidate(args = []) {
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
  for (const file of listClaimManifests(cfg)) validateClaimScope(cfg, readClaimManifest(file), tasks, file);
  const claimed = listClaimManifests(cfg);
  for (const file of claimed) {
    const scope = validateClaimScope(cfg, readClaimManifest(file), tasks, file);
    for (const path of scope.forbiddenPaths) if (scope.writePaths.some((p) => patternsOverlap(p, path))) fail(`claim scope ${file}: writePaths includes forbidden path ${path}`);
  }
  const inventory = cfg.idStrategy === 'sequential' || args.includes('--remote')
    ? remoteIdentifierInventory(cfg) : { available: false, collisions: [] };
  if (args.includes('--remote') && !inventory.available) errors.push(`remote validation unavailable: ${inventory.reason}`);
  if (inventory.available && inventory.collisions.length) {
    const message = `remote identifier collisions: ${inventory.collisions.map((c) => c.id).join(', ')}; keep both entries and renumber incoming entries to next free identifiers during resolution`;
    (args.includes('--remote') ? errors : warnings).push(message);
  }
  warnings.push(...boilerplateWarnings(tasks));
  for (const t of tasks) {
    if (!SPECIFICATION_STATUSES.includes(t.specificationStatus)) errors.push(`${t.id}: unknown Specification status "${t.specificationStatus}" (expected ${SPECIFICATION_STATUSES.join(', ')})`);
    if (t.specificationStatus === 'Unrevised') warnings.push(`${t.id}: specification is Unrevised; run clarify before claiming`);
    const withdrawnDeps = t.deps.filter((d) => map.get(d)?.status === 'Withdrawn' || map.get(d)?.specificationStatus === 'Withdrawn');
    if (withdrawnDeps.length) warnings.push(`${t.id}: depends on Withdrawn task(s): ${withdrawnDeps.join(', ')}`);
    if (t.sections['Expected files'] && /[*?[\]{}]/.test(t.sections['Expected files'])) errors.push(`${t.id}: Expected files does not support globs`);
    if (t.sections['Expected files'] && t.sections['Expected files'] !== 'N/A' && !taskExpectedFiles(t).length) errors.push(`${t.id}: Expected files must contain exact repository-relative files or directories`);
    if (cfg.profile !== 'lite' && t.specificationStatus === 'Specified' && !taskExpectedFiles(t).length) warnings.push(`${t.id}: no exact Expected files; parallel execution will serialize it`);
  }
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

  runCompanionHook(cfg, 'validate', { tasks: tasks.length, warnings: warnings.length });
  for (const w of warnings) out(`warning: ${w}`);
  if (errors.length) fail(errors.join('\n'));
  out(`valid: ${tasks.length} tasks, ${warnings.length} warning(s)`);
}

function taskJson(t) {
  return {
    id: t.id, title: t.title, status: t.status, specificationStatus: t.specificationStatus, assignee: t.assignee,
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
  for (const t of ready) {
    const specification = t.specificationStatus === 'Unrevised' ? ' — Unrevised; run clarify before implementation' : '';
    out(`${t.id} [${t.priority}] ${t.title}${specification}`);
  }
}

function cmdClaim(args) {
  const cfg = loadConfig();
  projectPreflight(cfg, { clean: true, start: true });
  const id = taskArgument(cfg, args, `usage: claim ${cfg.idPrefix}NNNN --by <name>`);
  const by = argValue(args, '--by') ?? fail('--by <name> required');
  const tasks = loadTasks(cfg);
  const map = byId(tasks);
  const t = map.get(id) ?? fail(`${id} not found`);
  if (t.status === 'Done') fail(`${id} is already Done`);
  if (t.specificationStatus === 'Unrevised' && !args.includes('--force')) {
    out(`warning: ${id} specification is Unrevised — clarify before claiming (use --force only deliberately)`);
  }
  if (t.status === 'Withdrawn' || t.specificationStatus === 'Withdrawn') fail(`${id} is Withdrawn and cannot be claimed`);
  if (t.status === 'In Progress' && t.assignee !== 'N/A' && t.assignee !== by && !args.includes('--force')) {
    fail(`${id} is already claimed by ${t.assignee}; use --force to take it over`);
  }
  const remoteClaim = requireRemoteClaim(cfg, id, by);
  const scope = claimScopeFor(cfg, id, by, args, tasks);
  if (remoteClaim) { scope.claimToken = remoteClaim.token; scope.claimBase = remoteClaim.base; }
  const scopePath = claimManifestPath(cfg, id);
  mkdirSync(dirname(scopePath), { recursive: true });
  atomicWrite(scopePath, JSON.stringify(scope, null, 2) + '\n');
  const unmet = t.deps.filter((d) => map.get(d)?.status !== 'Done');
  if (unmet.length) out(`warning: ${id} has dependencies not Done: ${unmet.join(', ')} — claim is advisory, proceeding`);
  setSection(t, 'Status', 'In Progress');
  let t2 = parseTask(t.file, cfg);
  if (!('Assignee' in t2.sections)) {
    atomicWrite(t2.file, t2.text.replace(/(## Status\n\nIn Progress\n)/, `$1\n## Assignee\n\nN/A\n`));
    t2 = parseTask(t2.file, cfg);
  }
  setSection(t2, 'Assignee', by);
  out(`${id} claimed by ${by}`);
}

function cmdRelease(args) {
  const cfg = loadConfig();
  projectPreflight(cfg);
  const id = taskArgument(cfg, args, `usage: release ${cfg.idPrefix}<ID> --by <name> [--force]`);
  const t = byId(loadTasks(cfg)).get(id) ?? fail(`${id} not found`);
  if (t.status !== 'In Progress') fail(`${id} is not In Progress`);
  requireReleasedRemoteClaim(cfg, id);
  // Releasing is as consequential as claiming: it drops someone else's work in progress.
  const by = argValue(args, '--by') ?? fail('--by <name> required to release a claim');
  if (t.assignee !== 'N/A' && t.assignee !== by && !args.includes('--force')) {
    fail(`${id} is claimed by ${t.assignee}, not ${by}; use --force to release it anyway`);
  }
  setSection(t, 'Status', 'Planned');
  setSection(parseTask(t.file, cfg), 'Assignee', 'N/A');
  const scopePath = claimManifestPath(cfg, id);
  if (existsSync(scopePath)) rmSync(scopePath);
  out(`${id} released back to Planned`);
}

function cmdDone(args) {
  const cfg = loadConfig();
  projectPreflight(cfg);
  const id = taskArgument(cfg, args, `usage: done ${cfg.idPrefix}NNNN`);
  const map = byId(loadTasks(cfg));
  const t = map.get(id) ?? fail(`${id} not found`);
  if (t.status !== 'In Progress') fail(`${id} is not In Progress (status: ${t.status}) — claim it first`);
  requireCompletionClaim(cfg, t);
  const unmet = t.deps.filter((d) => !depSatisfied(map.get(d)));
  if (unmet.length) fail(`${id}: dependencies not Done: ${unmet.join(', ')}`);
  const withdrawnDeps = t.deps.filter((d) => map.get(d)?.status === 'Withdrawn' || map.get(d)?.specificationStatus === 'Withdrawn');
  if (withdrawnDeps.length) out(`warning: ${id}: dependencies Withdrawn: ${withdrawnDeps.join(', ')}`);
  if (cfg.profile !== 'lite') {
    const ev = t.sections['Evidence'] ?? '';
    if (!ev || ev === 'N/A') fail(`${id}: Evidence section is empty — summarize commands and observed results before done`);
    const evidenceErrors = evidenceGateErrors(cfg, t);
    if (evidenceErrors.length) fail(`${id}: ${evidenceErrors.join('; ')}`);
    for (const warning of evidenceWarnings(cfg, t)) out(`warning: ${id}: ${warning}`);
  }
  cmdValidate([]);
  runCompanionHook(cfg, 'done', { id, nextStatus: 'Done' });
  setSection(t, 'Status', 'Done');
  const scopePath = claimManifestPath(cfg, id);
  if (existsSync(scopePath)) rmSync(scopePath);
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
  const remaining = tasks.filter((t) => !depSatisfied(t));
  const depth = new Map();
  const path = new Map();
  function d(id) {
    if (depth.has(id)) return depth.get(id);
    const t = map.get(id);
    if (!t || depSatisfied(t)) return 0;
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
  const done = new Set(tasks.filter(depSatisfied).map((t) => t.id));
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
    if (!t || depSatisfied(t)) return 0;
    depth.set(id, 0);
    let best = 0; let b = null;
    for (const dep of t.deps) { const v = d(dep); if (v > best) { best = v; b = dep; } }
    depth.set(id, best + 1); via.set(id, b);
    return best + 1;
  }
  let deepest = null;
  for (const t of tasks) if (!depSatisfied(t) && d(t.id) > (deepest ? depth.get(deepest) : 0)) deepest = t.id;
  const critical = [];
  for (let id = deepest; id; id = via.get(id)) critical.unshift(id);
  const ready = new Set(readyTasks(tasks, map).map((t) => t.id));
  let run = null;
  try { run = existsSync(runStatePath(cfg)) ? JSON.parse(readFileSync(runStatePath(cfg), 'utf8')) : null; } catch { /* board remains usable if scratch state is corrupt */ }
  const workerByTask = new Map(Object.entries(run?.active ?? {}).map(([worker, assignment]) => [assignment.task, worker]));
  const phaseOf = (t) => basename(dirname(t.file)).replace(/^phase-/, '');
  const data = tasks.map((t) => ({
    id: t.id, title: t.title, status: t.status, assignee: t.assignee,
    priority: t.priority, deps: t.deps, phase: phaseOf(t), worker: workerByTask.get(t.id) ?? null,
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
.view{padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink);cursor:pointer}.view.on{border-color:var(--ready)}
main{display:flex;gap:14px;overflow-x:auto;padding:16px 20px;align-items:flex-start}
#graph{display:none;width:100%;min-height:650px;padding:16px 20px}#graph svg{width:100%;height:auto;min-height:620px}.edge{stroke:var(--line);stroke-width:2}.node{fill:var(--card);stroke:var(--line);stroke-width:2}.node.ready{stroke:var(--ready)}.node.critical{stroke:var(--crit);stroke-dasharray:5}.node-title{fill:var(--ink);font-size:12px}.node-id{fill:var(--mut);font-size:10px}
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
<input id="f" placeholder="filter id / title / assignee…"><button class="view on" id="boardBtn">Board</button><button class="view" id="graphBtn">Graph</button></header>
<div class="legend">
<span><span class="dot" style="background:var(--ready)"></span>ready</span>
<span><span class="dot" style="background:var(--inprog)"></span>in progress</span>
<span><span class="dot" style="background:var(--blocked)"></span>blocked</span>
<span><span class="dot" style="background:var(--done)"></span>done</span>
<span><span class="dot" style="border:2px dashed var(--crit);background:none"></span>critical path</span></div>
<main id="board"></main><section id="graph"></section>
<aside id="panel"></aside>
<script>
const DATA=${JSON.stringify(data).replace(/</g, '\\u003c')};
const byId=Object.fromEntries(DATA.map(t=>[t.id,t]));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const board=document.getElementById('board'),graph=document.getElementById('graph'),panel=document.getElementById('panel'),f=document.getElementById('f'),boardBtn=document.getElementById('boardBtn'),graphBtn=document.getElementById('graphBtn');
function render(q){q=(q||'').toLowerCase();board.innerHTML='';
const phases=[...new Set(DATA.map(t=>t.phase))].sort();
for(const p of phases){const items=DATA.filter(t=>t.phase===p&&(!q||(t.id+' '+t.title+' '+t.assignee).toLowerCase().includes(q))).sort((a,b)=>a.priority.localeCompare(b.priority)||a.title.localeCompare(b.title));
if(!items.length)continue;
const lane=document.createElement('div');lane.className='lane';
lane.innerHTML='<h2>phase '+p+' · '+items.filter(t=>t.status==='Done').length+'/'+items.length+'</h2>';
for(const t of items){const c=document.createElement('div');
c.className='chip s-'+t.status.replace(' ','')+(t.ready?' ready':'')+(t.critical?' crit':'');
c.innerHTML='<div class="id">'+esc(t.id)+' <span class="t">'+esc(t.priority)+'</span></div><div class="t">'+esc(t.title)+'</div>'+
(t.worker?'<div class="who">worker: '+esc(t.worker)+'</div>':t.assignee&&t.assignee!=='N/A'?'<div class="who">'+esc(t.assignee)+'</div>':'');
c.onclick=()=>show(t.id);lane.appendChild(c)}
board.appendChild(lane)}}
function show(id){const t=byId[id];if(!t)return;
const dependants=DATA.filter(x=>x.deps.includes(id)).map(x=>x.id);
panel.className='open';panel.innerHTML='<button onclick="panel.className=\\'\\'">×</button>'+
'<h3>'+esc(t.id)+'</h3><div>'+esc(t.title)+'</div>'+
'<p class="mut">status: '+esc(t.status)+(t.ready?' (ready)':'')+' · '+esc(t.priority)+' · phase '+esc(t.phase)+
(t.worker?' · worker '+esc(t.worker):t.assignee!=='N/A'?' · '+esc(t.assignee):'')+(t.critical?' · on critical path':'')+'</p>'+
'<p><b>depends on</b><br>'+(t.deps.length?t.deps.map(d=>'<a onclick="show(\\''+esc(d)+'\\')">'+esc(d)+'</a> <span class="mut">'+esc(byId[d]?byId[d].status:'?')+'</span>').join('<br>'):'—')+'</p>'+
'<p><b>unblocks</b><br>'+(dependants.length?dependants.map(d=>'<a onclick="show(\\''+esc(d)+'\\')">'+esc(d)+'</a>').join('<br>'):'—')+'</p>'}
function renderGraph(){const level={},visiting=new Set();function depth(t){if(level[t.id]!=null)return level[t.id];if(visiting.has(t.id))return 0;visiting.add(t.id);level[t.id]=t.deps.length?1+Math.max(...t.deps.map(d=>byId[d]?depth(byId[d]):0)):0;visiting.delete(t.id);return level[t.id]}
DATA.forEach(depth);const rows={};DATA.forEach(t=>(rows[level[t.id]]??=[]).push(t));const pos={};Object.entries(rows).forEach(([l,items])=>items.sort((a,b)=>a.phase.localeCompare(b.phase)||a.priority.localeCompare(b.priority)||a.title.localeCompare(b.title)).forEach((t,i)=>pos[t.id]={x:40+Number(l)*250,y:40+i*90}));
const width=Math.max(700,100+250*(1+Math.max(0,...Object.values(level)))),height=Math.max(620,100+90*Math.max(1,...Object.values(rows).map(x=>x.length)));let body='';for(const t of DATA)for(const d of t.deps)if(pos[d])body+='<line class="edge" x1="'+(pos[d].x+180)+'" y1="'+(pos[d].y+28)+'" x2="'+pos[t.id].x+'" y2="'+(pos[t.id].y+28)+'"/>';
for(const t of DATA){const p=pos[t.id];body+='<g data-id="'+esc(t.id)+'" style="cursor:pointer"><rect class="node'+(t.ready?' ready':'')+(t.critical?' critical':'')+'" x="'+p.x+'" y="'+p.y+'" width="180" height="56" rx="8"/><text class="node-id" x="'+(p.x+10)+'" y="'+(p.y+18)+'">'+esc(t.id)+'</text><text class="node-title" x="'+(p.x+10)+'" y="'+(p.y+39)+'">'+esc(t.title.slice(0,24))+'</text></g>'}graph.innerHTML='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Task dependency graph">'+body+'</svg>';graph.querySelectorAll('[data-id]').forEach(node=>node.onclick=()=>show(node.dataset.id))}
boardBtn.onclick=()=>{board.style.display='flex';graph.style.display='none';boardBtn.classList.add('on');graphBtn.classList.remove('on')};graphBtn.onclick=()=>{board.style.display='none';graph.style.display='block';graphBtn.classList.add('on');boardBtn.classList.remove('on');renderGraph()};
f.oninput=()=>render(f.value);render('');
</script></body></html>`;
}

function runStatePath(cfg) { return join(cfg.root, '.tri', 'run.json'); }
function withRunLock(cfg, fn) {
  const lock = join(cfg.root, '.tri', 'run.lock');
  mkdirSync(dirname(lock), { recursive: true });
  try { mkdirSync(lock); } catch { fail('run scheduler is busy; retry the lease request'); }
  try { return fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

function taskExpectedFiles(t) {
  const paths = new Set();
  for (const raw of (t?.sections['Expected files'] ?? '').split('\n')) {
    const value = raw.replace(/^\s*[-*]\s*/, '').replaceAll('`', '').trim().replace(/^\.\//, '');
    if (!value || value === 'N/A' || /\s|[*?[\]{}]/.test(value) || !/^[A-Za-z0-9._/-]+$/.test(value) || value.split(/[\\/]+/).includes('..')) continue;
    paths.add(value);
  }
  return [...paths];
}

function taskScopesConflict(left, right) {
  const a = taskExpectedFiles(left); const b = taskExpectedFiles(right);
  if (!a.length || !b.length) return true;
  return a.some((x) => b.some((y) => patternsOverlap(x, y)));
}

function runOverlapWarnings(queue, map) {
  const warnings = [];
  for (let i = 0; i < queue.length; i++) for (let j = i + 1; j < queue.length; j++) {
    const a = map.get(queue[i]); const b = map.get(queue[j]);
    const left = taskExpectedFiles(a); const right = taskExpectedFiles(b);
    const overlap = left.find((x) => right.some((y) => patternsOverlap(x, y)));
    if (overlap) warnings.push(`${a.id} and ${b.id} both touch ${overlap}`);
    else if (!left.length || !right.length) warnings.push(`${a.id} and ${b.id} have undeclared Expected files`);
  }
  return warnings;
}

function runTaskReady(id, state, tasks) {
  const task = tasks.get(id);
  return task && ['Planned', 'Ready'].includes(task.status) && !state.done.includes(id) && !state.blocked.includes(id)
    && !Object.values(state.active ?? {}).some((entry) => entry.task === id)
    && task.deps.every((dep) => state.queue.includes(dep) ? state.done.includes(dep) || depSatisfied(tasks.get(dep)) : depSatisfied(tasks.get(dep)));
}

function leasableTasks(state, tasks) {
  const active = Object.values(state.active ?? {}).map((entry) => tasks.get(entry.task));
  return state.queue.filter((id) => runTaskReady(id, state, tasks))
    .filter((id) => active.every((task) => !taskScopesConflict(tasks.get(id), task)));
}

function declaredParallelism(queue, tasks) {
  const remaining = new Set(queue);
  const complete = new Set([...tasks.values()].filter(depSatisfied).map((task) => task.id));
  let maximum = 1;
  while (remaining.size) {
    const ready = [...remaining].filter((id) => tasks.get(id).deps.every((dep) => complete.has(dep) || !tasks.has(dep)));
    if (!ready.length) break;
    const selected = [];
    for (const id of ready) if (selected.every((other) => !taskScopesConflict(tasks.get(id), tasks.get(other)))) selected.push(id);
    maximum = Math.max(maximum, selected.length);
    for (const id of ready) { remaining.delete(id); complete.add(id); }
  }
  return maximum;
}

function cmdRunState(args) {
  const cfg = loadConfig();
  if (args.length && !args.includes('--json') && argValue(args, '--start') === undefined) projectPreflight(cfg);
  const p = runStatePath(cfg);
  const load = () => {
    if (!existsSync(p)) return null;
    try {
      const state = JSON.parse(readFileSync(p, 'utf8'));
      state.requestedMode ??= state.mode ?? 'sequential'; state.actualMode ??= state.mode ?? 'sequential';
      state.adapter ??= 'legacy'; state.backend ??= state.actualMode === 'sequential' ? 'sequential' : 'legacy-host';
      state.capacity ??= state.actualMode === 'sequential' ? 1 : 4; state.active ??= {}; state.workers ??= {};
      return state;
    } catch (error) { fail(`run state is not valid JSON: ${error.message}`); }
  };
  const save = (state) => atomicWrite(p, JSON.stringify(state, null, 2) + '\n');

  const scope = argValue(args, '--start');
  if (scope !== undefined) {
    projectPreflight(cfg, { clean: true, start: true });
    const existing = load();
    if (existing && !existing.finishedAt) fail(`active run already exists: ${existing.scope}; finish or resume it before starting another`);
    const queue = (argValue(args, '--queue') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!queue.length) fail('--queue <ID,ID,...> required with --start');
    if (new Set(queue).size !== queue.length) fail('run queue contains duplicate task IDs');
    const requestedMode = argValue(args, '--mode') ?? 'auto';
    if (!RUN_MODES.includes(requestedMode)) fail(`unknown run mode "${requestedMode}" (${RUN_MODES.join('|')})`);
    const tasks = byId(loadTasks(cfg));
    const unknown = queue.filter((id) => !tasks.has(id));
    if (unknown.length) fail(`run queue contains unknown task(s): ${unknown.join(', ')}`);
    const unavailable = queue.filter((id) => !['Planned', 'Ready'].includes(tasks.get(id).status) || depSatisfied(tasks.get(id)));
    if (unavailable.length) fail(`run queue contains unavailable task(s): ${unavailable.join(', ')}`);
    const unrevised = queue.filter((id) => tasks.get(id)?.specificationStatus === 'Unrevised');
    if (unrevised.length && !args.includes('--allow-unrevised')) fail(`run includes Unrevised tasks: ${unrevised.join(', ')} — clarify first or pass --allow-unrevised deliberately`);
    const capacity = Number(argValue(args, '--capacity') ?? 4);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 16) fail('run capacity must be an integer from 1 to 16');
    const parallelism = Math.min(capacity, declaredParallelism(queue, tasks));
    const adapter = argValue(args, '--adapter') ?? 'generic';
    if (!HOST_ADAPTERS[adapter]) fail(`unknown host adapter "${adapter}" (${Object.keys(HOST_ADAPTERS).join('|')})`);
    const capabilities = HOST_ADAPTERS[adapter];
    const parallelCapable = capabilities.parallel;
    const teamCapable = capabilities.team && args.includes('--team-capable');
    const phases = new Set(queue.map((id) => basename(dirname(tasks.get(id).file))));
    const teamRelated = phases.size === 1;
    let actualMode = requestedMode;
    if (requestedMode === 'auto') actualMode = teamCapable && teamRelated && parallelism >= 4 ? 'team' : parallelCapable && parallelism >= 2 ? 'parallel' : 'sequential';
    if (requestedMode === 'team' && !teamCapable) actualMode = parallelCapable && parallelism >= 2 ? 'parallel' : 'sequential';
    if (requestedMode === 'parallel' && (!parallelCapable || parallelism < 2)) actualMode = 'sequential';
    const backend = actualMode === 'sequential' ? 'sequential' : actualMode === 'team' ? 'claude-team' : capabilities.backend;
    if (actualMode !== 'sequential') for (const warning of runOverlapWarnings(queue, tasks)) out(`warning: ${warning}; those tasks will serialize`);
    const state = {
      version: 3, scope, adapter, backend, mode: actualMode, requestedMode, actualMode,
      capacity: actualMode === 'sequential' ? 1 : capacity, queue, done: [], blocked: [], active: {}, workers: {},
      startedAt: new Date().toISOString(), finishedAt: null,
    };
    save(state);
    out(`run started: ${scope} (adapter ${adapter}, backend ${backend}, requested ${requestedMode}, actual ${actualMode}, capacity ${state.capacity}), ${queue.length} queued — ${queue.join(', ')}`);
    return;
  }

  const state = load();
  const workerArg = argValue(args, '--lease');
  if (workerArg !== undefined) {
    if (!state || state.finishedAt) fail('no active run');
    const names = workerArg.split(',').map((name) => name.trim()).filter(Boolean);
    if (!names.length || new Set(names).size !== names.length) fail('--lease requires unique comma-separated worker names');
    const assignments = withRunLock(cfg, () => {
      const current = load();
      const tasks = byId(loadTasks(cfg));
      const result = [];
      for (const worker of names) {
        if (current.active[worker]) { result.push(current.active[worker]); continue; }
        if (Object.keys(current.active).length >= current.capacity) { result.push({ task: null, reason: 'capacity' }); continue; }
        const id = leasableTasks(current, tasks)[0];
        if (!id) { result.push({ task: null, reason: 'no-declared-safe-ready-task' }); continue; }
        const assignment = { task: id, paths: taskExpectedFiles(tasks.get(id)), startedAt: new Date().toISOString() };
        current.active[worker] = assignment;
        current.workers[worker] = { ...(current.workers[worker] ?? {}), lastTask: id, lastSeenAt: assignment.startedAt };
        result.push(assignment);
      }
      save(current); return result;
    });
    out(JSON.stringify(names.length === 1 ? assignments[0] : assignments)); return;
  }

  for (const [flag, key] of [['--done', 'done'], ['--blocked', 'blocked']]) {
    const id = argValue(args, flag);
    if (id === undefined) continue;
    if (!state) fail('no active run — start one with --start');
    if (state.finishedAt) fail('run is already finished');
    if (!state.queue.includes(id)) fail(`${id} is not in active run queue`);
    if (key === 'done') {
      if (!Object.values(state.active ?? {}).some((assignment) => assignment.task === id)) fail(`${id} has no active worker lease`);
      const task = byId(loadTasks(cfg)).get(id);
      if (task?.status !== 'Done') fail(`${id} cannot enter run-state done until its integrated task status is Done`);
      const evidenceErrors = integratedEvidenceGateErrors(cfg, task);
      if (evidenceErrors.length) fail(evidenceErrors.join('\n'));
    }
    const other = key === 'done' ? 'blocked' : 'done';
    if (state[other].includes(id)) fail(`${id} is already recorded as ${other}`);
    if (!state[key].includes(id)) state[key].push(id);
    for (const [name, assignment] of Object.entries(state.active ?? {})) if (assignment.task === id) {
      delete state.active[name]; state.workers[name].lastSeenAt = new Date().toISOString();
    }
    save(state);
    out(`${id} recorded as ${key}; ${state.queue.filter((q) => !state.done.includes(q) && !state.blocked.includes(q)).length} remaining`);
    return;
  }

  if (args.includes('--finish')) {
    if (!state) fail('no active run to finish');
    if (state.finishedAt) fail('run is already finished');
    if (Object.keys(state.active ?? {}).length) fail('cannot finish while workers still have active assignments');
    state.finishedAt = new Date().toISOString(); save(state);
    out(`run finished: ${state.done.length} done, ${state.blocked.length} blocked, ${state.queue.length - state.done.length - state.blocked.length} not reached`); return;
  }

  if (!state || state.finishedAt) { out('no active run'); return; }
  if (args.includes('--json')) { out(JSON.stringify(state, null, 2)); return; }
  const remaining = state.queue.filter((id) => !state.done.includes(id) && !state.blocked.includes(id));
  out(`run: ${state.scope} (${state.actualMode}, requested ${state.requestedMode}, adapter ${state.adapter}, backend ${state.backend}), started ${state.startedAt}`);
  out(`  active: ${Object.entries(state.active ?? {}).map(([name, item]) => `${name}:${item.task}`).join(', ') || 'none'}`);
  out(`  done: ${state.done.join(', ') || 'none'}`);
  out(`  blocked: ${state.blocked.join(', ') || 'none'}`);
  out(`  remaining: ${remaining.join(', ') || 'none'}`);
}

function cmdVerifyScope(args) {
  const cfg = loadConfig();
  const id = taskArgument(cfg, args, `usage: verify-scope ${cfg.idPrefix}<ID> --base <commit>`);
  const base = argValue(args, '--base') ?? fail('--base <commit> required');
  const task = byId(loadTasks(cfg)).get(id) ?? fail(`${id} not found`);
  const taskPath = relative(cfg.root, task.file);
  const baseTask = git(['show', `${base}:${taskPath}`], cfg.root, true);
  if (baseTask.status !== 0 || baseTask.error) fail(`${id}: task does not exist at scope base ${base}`);
  const scopes = taskExpectedFiles({ sections: { 'Expected files': sectionBody(baseTask.stdout, 'Expected files') } });
  if (!scopes.length) fail(`${id}: base task must declare exact Expected files before parallel execution`);
  const diff = git(['diff', '--name-only', `${base}..HEAD`], cfg.root).stdout.split(/\r?\n/).filter(Boolean);
  const allowedState = [taskPath, `${cfg.evidenceDir}/${id}-`];
  const outside = diff.filter((path) => !scopes.some((scope) => scope.endsWith('/') ? path.startsWith(scope) : path === scope)
    && path !== allowedState[0] && !path.startsWith(allowedState[1]));
  if (outside.length) fail(`${id}: worker changed paths outside Expected files:\n${outside.join('\n')}`);
  out(`${id}: scope verified (${diff.length} changed path(s))`);
}

function cmdClaimRef(args) {
  const cfg = loadConfig();
  const id = taskArgument(cfg, args, `usage: claim-ref ${cfg.idPrefix}<ID>`);
  if (!byId(loadTasks(cfg)).has(id)) fail(`${id} not found`);
  out(claimRef(id));
}

function cmdClaimToken(args) {
  const cfg = loadConfig();
  projectPreflight(cfg, { clean: true, start: true });
  const id = taskArgument(cfg, args, `usage: claim-token ${cfg.idPrefix}<ID> --by <owner>`);
  const owner = argValue(args, '--by') ?? fail('--by <owner> required');
  if (!owner.trim() || /[\r\n]/.test(owner)) fail('--by owner must be one non-empty line');
  if (!byId(loadTasks(cfg)).has(id)) fail(`${id} not found`);
  const head = git(['rev-parse', 'HEAD'], cfg.root).stdout.trim();
  const tree = git(['rev-parse', 'HEAD^{tree}'], cfg.root).stdout.trim();
  const message = `TRI claim ${id}\nowner ${owner}\nnonce ${randomBytes(12).toString('hex')}\n`;
  const token = spawnSync('git', ['commit-tree', tree, '-p', head], { cwd: cfg.root, encoding: 'utf8', input: message });
  if (token.status !== 0 || token.error) fail(`cannot create claim token: ${(token.error?.message || token.stderr || 'git failed').trim()}`);
  out(JSON.stringify({ id, ref: claimRef(id), token: token.stdout.trim(), base: head }));
}

function cmdSync() {
  const cfg = loadConfig();
  refreshRemote(cfg);
  const remote = cfg.remote ?? 'origin';
  if (cfg.idStrategy === 'random') {
    const claims = git(['ls-remote', '--heads', remote, 'refs/heads/tri/claims/*'], cfg.root, true);
    if (claims.status !== 0 || claims.error) fail(`cannot read remote claim refs from ${remote}`);
    const refs = claims.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/)[1]);
    out(`synced ${remote}; ${refs.length} active claim(s)`);
    for (const ref of refs) out(`  ${ref}`);
    return;
  }
  const inventory = requireRemoteInventory(cfg, 'sync');
  out(`synced ${remote}; scanned ${inventory.branches.length} remote branch(es), ${inventory.reserved.size} allocated identifier(s)`);
  if (inventory.collisions.length) out(`warning: collisions: ${inventory.collisions.map((c) => c.id).join(', ')}`);
}

function safeEvidenceCommand(command) {
  const secretFlag = /^(?:--?(?:api[-_]?key|token|password|secret|authorization|cookie)|-u|--user|-b|--proxy-user)$/i;
  return command.map((part, index) => {
    const previous = command[index - 1] ?? '';
    if (index && secretFlag.test(previous)) return '<redacted>';
    if (index && /^(?:-H|--header)$/i.test(previous) && /^(?:authorization|cookie|set-cookie|(?:x-)?api[-_]?key|token|secret|password):/i.test(part)) {
      return `${part.split(':', 1)[0]}: <redacted>`;
    }
    return part
      .replace(/((?:api[-_]?key|token|password|secret|authorization|cookie|session)=)[^\s]+/ig, '$1<redacted>')
      .replace(/(authorization:\s*(?:bearer|basic)\s+)\S+/ig, '$1<redacted>')
      .replace(/:\/\/([^:/\s]+):([^@/\s]+)@/g, '://$1:<redacted>@');
  });
}

function cmdEvidence(args) {
  const cfg = loadConfig();
  projectPreflight(cfg);
  const id = taskArgument(cfg, args, `usage: evidence ${cfg.idPrefix}<ID> [--name check] -- command [args...]`);
  const task = byId(loadTasks(cfg)).get(id) ?? fail(`${id} not found`);
  if (task.status !== 'In Progress') fail(`${id} is not In Progress`);
  const separator = args.indexOf('--');
  if (separator < 0 || separator === args.length - 1) fail('usage: evidence ID [--name check] -- command [args...]');
  const command = args.slice(separator + 1);
  const check = argValue(args.slice(0, separator), '--name') ?? basename(command[0]);
  validateArgv(command, 'evidence command');
  const started = Date.now();
  let result;
  try { result = spawnSync(command[0], command.slice(1), { cwd: cfg.root, encoding: 'utf8', maxBuffer: EVIDENCE_MAX_BYTES }); }
  catch (error) { fail(`evidence command failed to start: ${error.message}`); }
  if (result.error?.code === 'ENOBUFS') fail(`evidence output exceeded ${EVIDENCE_MAX_BYTES} bytes; rerun a quieter command`);
  if (result.error) fail(`evidence command failed to start: ${result.error.message}`);
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const observed = {
    check, exitStatus: result.status, signal: result.signal ?? null, error: null,
    outputBytes: Buffer.byteLength(output), outputSha256: createHash('sha256').update(output).digest('hex'),
    durationMs: Date.now() - started,
  };
  const path = appendEvidenceContext(cfg, id, safeEvidenceCommand(command), observed);
  out(`evidence captured for ${id} (${check}): ${path}`);
  if (output.trim()) out(output.trim());
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

function cmdCompanions(args) {
  const cfg = loadConfig();
  if (args.includes('--check')) projectPreflight(cfg);
  const entries = companionEntries(cfg);
  if (!entries.length) { out('no companions configured'); return; }
  if (args.includes('--check')) {
    const missing = entries.filter((entry) => !existsSync(join(cfg.root, entry.path)));
    for (const entry of entries) out(`${entry.path}: ${missing.includes(entry) ? 'missing' : 'present'}${entry.strategy ? ` (${entry.strategy})` : ''}`);
    if (missing.length) fail(`companions missing: ${missing.map((entry) => entry.path).join(', ')}`);
    runCompanionHook(cfg, 'companions-check', { paths: entries.map((entry) => entry.path) });
    out(`companions ok: ${entries.length}`);
    return;
  }
  for (const entry of entries) out(`${entry.path}${entry.legacy ? ' (legacy check-only)' : ''}`);
}

function registerFiles(cfg) {
  const files = [];
  for (const entry of cfg.decisionFiles ?? []) {
    const path = join(cfg.root, entry);
    if (!existsSync(path)) continue;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) if (name.endsWith('.md')) files.push(join(path, name));
    } else files.push(path);
  }
  return files;
}

function parseAdrDocument(file, text) {
  const fileMatch = basename(file).match(new RegExp(`^(ADR-${ID_PART_SOURCE})(?:[-_].*)?\\.md$`, 'i'));
  if (!fileMatch || /ADR-template\.md$/i.test(file)) return { ok: false, reason: 'not a canonical ADR file' };
  const id = fileMatch[1].toUpperCase();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let fenced = false;
  let frontmatter = false;
  const content = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (index === 0 && /^---[ \t]*$/.test(line)) { frontmatter = true; continue; }
    if (frontmatter) { if (/^---[ \t]*$/.test(line)) frontmatter = false; continue; }
    if (/^[ \t]*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (!fenced) content.push(line);
  }
  const headings = content.filter((line) => new RegExp(`^#[ \\t]+ADR-${ID_PART_SOURCE}[ \\t]*:[ \\t]*\\S`, 'i').test(line));
  const allH1 = content.filter((line) => /^#[ \t]+/.test(line));
  if (allH1.length !== 1 || headings.length !== 1 || !new RegExp(`^#[ \\t]+${id.replace('-', '\\-')}[ \\t]*:[ \\t]*\\S`, 'i').test(headings[0])) {
    return { ok: false, id, reason: `filename/header mismatch (expected exactly one # ${id}: heading)` };
  }
  const statusLines = content.filter((line) => /^-[ \t]+Status:[ \t]*\S/.test(line));
  if (statusLines.length !== 1) return { ok: false, id, reason: statusLines.length ? 'duplicate Status fields' : 'missing Status field' };
  const statusText = statusLines[0].replace(/^[ \t]*-[ \t]+Status:[ \t]*/, '').trim();
  if (/^(?:Proposed|Accepted)$/i.test(statusText)) {
    return { ok: true, id, file, text, status: statusText, successor: null };
  }
  const superseded = statusText.match(new RegExp(`^Superseded[ \\t]+by[ \\t]+(?:(ADR-${ID_PART_SOURCE})|\\[(ADR-${ID_PART_SOURCE})\\]\\([^)]*\\))$`, 'i'));
  if (!superseded) return { ok: false, id, reason: `unsupported Status value "${statusText}"` };
  return { ok: true, id, file, text, status: 'Superseded', successor: (superseded[1] ?? superseded[2]).toUpperCase() };
}

function adrDirectoryPrefix(cfg) {
  const path = cfg.adrDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return path ? `${path}/` : '';
}

function isAdrPath(cfg, file) {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized.startsWith(adrDirectoryPrefix(cfg)) && new RegExp(`(?:^|/)ADR-${ID_PART_SOURCE}(?:[-_].*)?\\.md$`, 'i').test(normalized);
}

function adrMap(cfg, base, files, warnings = []) {
  const map = new Map();
  const malformed = new Map();
  for (const file of files) {
    const content = showRefFileResult(cfg, base, file);
    if (!content.ok) { warnings.push(`cannot inspect ADR ${file} on ${base}: ${content.reason}`); continue; }
    const parsed = parseAdrDocument(file, content.text);
    if (!parsed.ok) {
      const id = parsed.id ?? basename(file).match(new RegExp(`^(ADR-${ID_PART_SOURCE})`, 'i'))?.[1]?.toUpperCase();
      if (id) malformed.set(id, { file, reason: parsed.reason });
      warnings.push(`${file}: malformed ADR: ${parsed.reason}`);
      continue;
    }
    if (map.has(parsed.id) || malformed.has(parsed.id)) {
      const prior = map.get(parsed.id)?.file ?? malformed.get(parsed.id)?.file;
      map.delete(parsed.id);
      malformed.set(parsed.id, { file: `${prior}, ${file}`, reason: 'duplicate ADR definition' });
      warnings.push(`duplicate ADR definition ${parsed.id}: ${prior} and ${file}`);
    } else map.set(parsed.id, parsed);
  }
  return { map, malformed };
}

function taskAdrCitations(task) {
  const lines = task.text.replace(/\r\n?/g, '\n').split('\n');
  let fenced = false;
  const visible = [];
  for (const line of lines) {
    if (/^[ \t]*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (!fenced) visible.push(line.replace(/`[^`]*`/g, ''));
  }
  return [...new Set([...visible.join('\n').matchAll(ADR_ID_RE)].map((match) => match[1].toUpperCase()))];
}

function cmdDoctor() {
  const cfg = loadConfig();
  const warnings = [];
  const base = gitRef(cfg);
  const baseTree = treeFilesResult(cfg, base);
  const remote = remoteIdentifierInventory(cfg);
  let adrs = new Map();
  let malformedAdrs = new Map();
  let authoritativeAdrs = false;
  if (!baseTree.ok) {
    warnings.push(`default branch ${base} unavailable; skipped authoritative ADR checks: ${baseTree.reason}`);
  } else {
    authoritativeAdrs = true;
    const knownAdrs = baseTree.files.filter((p) => isAdrPath(cfg, p));
    const parsedAdrs = adrMap(cfg, base, knownAdrs, warnings);
    adrs = parsedAdrs.map;
    malformedAdrs = parsedAdrs.malformed;
  }
  const tasks = loadTasks(cfg);

  if (authoritativeAdrs) {
    const stale = new Map();
    const graphWarnings = new Set();
    for (const [id, adr] of adrs) {
      if (!adr.successor) continue;
      if (adr.successor === id) graphWarnings.add(`${id}: supersession points to itself`);
      else if (!adrs.has(adr.successor)) graphWarnings.add(`${id}: supersedes missing or malformed ${adr.successor}`);
      else if (adrs.get(adr.successor).status === 'Superseded' && adrs.get(adr.successor).successor === id) graphWarnings.add(`${id}: supersession cycle with ${adr.successor}`);
    }
    for (const warning of graphWarnings) warnings.push(warning);
    for (const task of tasks) {
      const citations = taskAdrCitations(task);
      for (const id of citations) {
        const adr = adrs.get(id);
        if (!adr) {
          if (malformedAdrs.has(id)) {
            warnings.push(`${task.id}: references malformed ${id}`);
          } else {
            const remoteOwner = remote.reserved.get(id)?.[0];
            warnings.push(`${task.id}: references ${id}, absent from default branch${remoteOwner ? ` (present on ${remoteOwner.ref})` : ''}`);
          }
          continue;
        }
        if (adr.successor && !citations.includes(adr.successor)) {
          if (!stale.has(id)) stale.set(id, { successor: adr.successor, tasks: [] });
          stale.get(id).tasks.push(task.id);
        }
      }
    }
    for (const [id, entry] of stale) {
      warnings.push(`${id} is Superseded by ${entry.successor}; tasks still cite it without successor: ${[...new Set(entry.tasks)].join(', ')}`);
    }
  }

  const definedRegisters = new Set();
  const registerTexts = [];
  for (const file of registerFiles(cfg)) {
    const text = readFileSync(file, 'utf8');
    registerTexts.push({ file: relative(cfg.root, file), text });
    for (const [id] of definitionIdentifiers(cfg, relative(cfg.root, file), text)) {
      if (new RegExp(`^[DBA]-${ID_PART_SOURCE}$`, 'i').test(id)) definedRegisters.add(id.toUpperCase());
    }
  }
  for (const { file, text } of registerTexts) {
    for (const match of text.matchAll(REGISTER_ID_RE)) {
      const id = match[1];
      if (!definedRegisters.has(id)) warnings.push(`${file}: references undefined register identifier ${id}`);
    }
    for (const line of text.split(/\r?\n/)) {
      if (/\b(?:contradict|conflict|supersed|override|overrule)\w*\b/i.test(line) && new RegExp(`\\bADR-${ID_PART_SOURCE}\\b`, 'i').test(line)) {
        warnings.push(`${file}: explicit decision/ADR conflict language requires review: ${line.trim()}`);
      }
    }
  }

  for (const collision of remote.collisions) {
    warnings.push(`identifier ${collision.id} allocated by ${collision.owners.map((o) => `${o.ref}:${o.file}`).join(', ')}; renumber incoming entry to next free identifier during resolution`);
  }
  for (const warning of warnings) out(`warning: ${warning}`);
  out(`doctor complete: ${warnings.length} warning(s)`);
}

function rebaselinePath(cfg) { return join(cfg.root, '.tri', 'rebaseline.json'); }
function gitHead(cfg) {
  const head = git(['rev-parse', 'HEAD'], cfg.root, true);
  return head.status === 0 ? head.stdout.trim() : null;
}
function gitBranch(cfg) {
  const branch = git(['branch', '--show-current'], cfg.root, true);
  return branch.status === 0 ? branch.stdout.trim() : null;
}
function defaultBranchRef(cfg) {
  const branch = cfg.defaultBranch ?? cfg.baseBranch ?? 'main';
  const remote = cfg.remote ?? 'origin';
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/${remote}/${branch}`]) {
    if (git(['show-ref', '--verify', '--quiet', ref], cfg.root, true).status === 0) return ref;
  }
  return null;
}
function changedLayerPaths(cfg, from, to) {
  const diff = git(['diff', '--name-only', `${from}..${to}`], cfg.root, true);
  if (diff.status !== 0) return [];
  return diff.stdout.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}
function layerPathMatches(layer, files) {
  return files.some((file) => layer.paths.some((pattern) => globToRegExp(pattern).test(file)));
}
function rebaselineLayers(cfg) {
  return REBASELINE_LAYERS.map((layer) => {
    if (layer.id !== 'adrs-registers') return layer;
    const adr = `${adrDirectoryPrefix(cfg)}**`;
    const registers = (cfg.decisionFiles ?? ['tri/DECISIONS.md', 'tri/ASSUMPTIONS.md'])
      .map((file) => { const p = file.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, ''); return /\.md$/i.test(p) ? p : `${p}/**`; });
    return { ...layer, paths: [adr, ...registers] };
  });
}
function cmdRebaseline(args) {
  const cfg = loadConfig();
  projectPreflight(cfg);
  const path = rebaselinePath(cfg);
  let state;
  try {
    state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 1, layer: 0, approvals: [], completed: [] };
  } catch (e) {
    fail(`rebaseline state is not valid JSON: ${e.message}`);
  }
  if (args.includes('--reset')) { rmSync(path, { force: true }); out('re-baseline reset'); return; }
  const layers = rebaselineLayers(cfg);
  const layer = layers[state.layer];
  if (!layer) { out('re-baseline complete'); return; }
  const existingApproval = state.approvals.find((a) => a.layer === layer.id);
  if (args.includes('--approve')) {
    if (existingApproval) fail(`approval already recorded for ${layer.label}`);
    const commit = gitHead(cfg);
    if (!commit) fail('rebaseline approval requires a git repository and commit');
    state.approvals.push({ layer: layer.id, approvedAt: new Date().toISOString(), commit, branch: gitBranch(cfg) });
    mkdirSync(dirname(path), { recursive: true });
    atomicWrite(path, JSON.stringify(state, null, 2) + '\n');
    out(`approval recorded for ${layer.label}; edit this layer, commit on default branch, then run rebaseline --complete`); return;
  }
  if (args.includes('--complete')) {
    if (!existingApproval) fail(`approval required before ${layer.label}`);
    const commit = gitHead(cfg);
    if (!commit) fail('rebaseline completion requires a git repository and commit');
    const dirty = git(['status', '--porcelain'], cfg.root, true);
    if (dirty.status !== 0 || dirty.stdout.trim()) fail('rebaseline completion requires a clean worktree after the layer commit');
    if (commit === existingApproval.commit) fail(`${layer.label} has no commit after approval`);
    const defaultRef = defaultBranchRef(cfg);
    if (!defaultRef) fail(`configured default branch ${cfg.defaultBranch ?? 'main'} is not available`);
    if (git(['merge-base', '--is-ancestor', commit, defaultRef], cfg.root, true).status !== 0) {
      fail(`${layer.label} commit ${commit} is not reachable from default branch ${defaultRef}`);
    }
    const changed = changedLayerPaths(cfg, existingApproval.commit, commit);
    if (!layerPathMatches(layer, changed)) fail(`${layer.label} completion changed no configured layer paths (${layer.paths.join(', ')})`);
    state.completed.push({ layer: layer.id, commit, changed });
    state.layer += 1;
    atomicWrite(path, JSON.stringify(state, null, 2) + '\n');
    out(`re-baseline layer complete: ${layer.label}; next layer: ${layers[state.layer]?.label ?? 'none'}`); return;
  }
  out(`re-baseline layer ${state.layer + 1}/${layers.length}: ${layer.label}`);
  out(`paths: ${layer.paths.join(', ')}`);
  out('approve layer before editing; complete only after a clean commit reaches the configured default branch');
}

function cmdMeta() { out(JSON.stringify(META, null, 2)); }

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
  visualize: cmdVisualize, 'run-state': cmdRunState, sync: cmdSync, evidence: cmdEvidence, companions: cmdCompanions,
  doctor: cmdDoctor, rebaseline: cmdRebaseline, 'new-adr': cmdNewAdr, register: cmdRegister,
  'verify-scope': cmdVerifyScope, 'claim-ref': cmdClaimRef, 'claim-token': cmdClaimToken, meta: cmdMeta,
};
const metadataDrift = [...new Set([...Object.keys(commands), ...Object.keys(COMMAND_META)])]
  .filter((name) => !(name in commands) || !(name in COMMAND_META));
if (metadataDrift.length) fail(`internal command metadata drift: ${metadataDrift.join(', ')}`);
if (!cmd || !(cmd in commands)) {
  fail(`usage: tri.mjs <${Object.keys(commands).join('|')}> [args]
  init [--profile lite|standard|strict] [--id-strategy random|sequential] [--force]
  new-task --title "..." [--phase NN] [--dep T-NNNN]...
  claim T-NNNN --by <name> [--force]     (dynamic pull-based claiming; advisory, warns but never blocks on deps)
  release T-NNNN | done T-NNNN | next | status | graph | validate
  visualize [--out path]                 (self-contained HTML board, default .tri/graph.html)
  run-state [--start <scope> --queue <ID,..> [--mode m] [--adapter host]] [--done ID] [--blocked ID] [--finish]
  new-adr --title "..." | register --kind decision|blocker|assumption --text "..."
  sync | evidence ID [--name check] -- command [args...] | companions [--check] | doctor
  claim-token ID --by owner | claim-ref ID | verify-scope ID --base commit
  rebaseline [--approve|--complete] | meta`);
}
commands[cmd](args);

#!/usr/bin/env node
// Fails when a change lands in one tri artifact but not its companions.
// The repository practises what it asks of projects: a change propagates or CI stops it.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

// --- 1. every command is documented everywhere a user looks ---
const commands = readdirSync(join(ROOT, 'commands'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace('.md', ''));

const readme = read('README.md');
const guide = read('docs/guide.html');
const skill = read('skills/tri-method/SKILL.md');
const meta = JSON.parse(execFileSync('node', [join(ROOT, 'scripts/tri.mjs'), 'meta'], { encoding: 'utf8' }));

for (const cmd of commands) {
  check(readme.includes(`/tri:${cmd}`), `README.md does not document /tri:${cmd}`);
  check(guide.includes(`/tri:${cmd}`), `docs/guide.html does not document /tri:${cmd}`);
}

// --- 2. every command file is well formed ---
for (const cmd of commands) {
  const body = read(`commands/${cmd}.md`);
  check(body.startsWith('---\n'), `commands/${cmd}.md is missing YAML frontmatter`);
  check(/^description:/m.test(body), `commands/${cmd}.md frontmatter has no description`);
  check(body.includes('tri-method'), `commands/${cmd}.md never loads the tri-method skill`);
}

// --- 2b. every mutating command declares its preflight tier ---
// A command that writes to the repository without declaring a tier is the
// failure this file exists to catch: the rule lands in the skill and never
// reaches the command that must obey it.
const READ_ONLY = new Set(['status', 'visualize', 'go']);
for (const cmd of commands) {
  if (READ_ONLY.has(cmd)) continue;
  const body = read(`commands/${cmd}.md`);
  check(/tier\s+[123]/i.test(body),
    `commands/${cmd}.md changes the repository but declares no preflight tier`);
}

// --- 2c. no governing document references a command that no longer exists ---
for (const [file, body] of [['README.md', readme], ['docs/guide.html', guide], ['skills/tri-method/SKILL.md', skill],
  ...commands.map((cmd) => [`commands/${cmd}.md`, read(`commands/${cmd}.md`)])]) {
  for (const m of body.matchAll(/\`?\/tri:([a-z-]+)/g)) {
    check(commands.includes(m[1]), `${file} references /tri:${m[1]}, which is not a command`);
  }
}

// --- 3. engine metadata is documented ---
const configKeys = meta.configKeys;
for (const key of configKeys) check(readme.includes(key), `README.md does not document the "${key}" config option`);
for (const command of Object.keys(meta.commands)) check(readme.includes(command), `README.md does not name engine command "${command}"`);

// --- 4. every host package has the same released version and a changelog entry ---
const version = JSON.parse(read('.claude-plugin/plugin.json')).version;
for (const file of ['.codex-plugin/plugin.json', 'gemini-extension.json', 'package.json']) {
  check(JSON.parse(read(file)).version === version, `${file} version differs from Claude plugin ${version}`);
}
check(read('CHANGELOG.md').includes(`## ${version}`), `CHANGELOG.md has no section for version ${version}`);

// --- 5. claimed test count matches reality ---
const testFiles = ['scripts/test-tri.mjs', 'scripts/test-v3.mjs', 'scripts/test-adapters.mjs'];
const actualTests = testFiles.reduce((count, file) => count + (read(file).match(/^(?:await )?check\(/gm) ?? []).length, 0);
const claimed = readme.match(/(\d+) behavioral tests/);
check(claimed, 'README.md makes no test-count claim');
if (claimed) {
  check(Number(claimed[1]) === actualTests,
    `README.md claims ${claimed[1]} behavioral tests, scripts/test-tri.mjs defines ${actualTests}`);
}

// --- 6. the cross-agent template stays in step with the skill ---
const agentsSection = read('templates/AGENTS-section.md');
check(agentsSection.includes('~/.tri/scripts'), 'templates/AGENTS-section.md does not use the ~/.tri convention');
for (const f of ['DECISIONS', 'ASSUMPTIONS']) {
  check(agentsSection.includes(f), `templates/AGENTS-section.md never mentions ${f}`);
}

// --- 7. native command adapters and package workers are complete ---
for (const cmd of commands) {
  check(existsSync(join(ROOT, 'commands', `${cmd}.toml`)), `commands/${cmd}.toml is missing for Codex/Gemini`);
}
check(read('agents/tri-worker.md').includes('kind: local'), 'Gemini tri-worker is not a local agent');
check(read('agents/tri-worker.toml').includes('name = "tri_worker"'), 'Codex tri_worker profile is missing');
check(read('package.json').includes('extensions/pi/index.ts'), 'Pi package does not expose its extension');

// --- 8. referenced files exist ---
for (const m of readme.matchAll(/\]\((docs\/[^)]+|scripts\/[^)]+)\)/g)) {
  check(existsSync(join(ROOT, m[1])), `README.md links a missing file: ${m[1]}`);
}
for (const m of guide.matchAll(/src="([^"]+\.svg)"/g)) {
  check(existsSync(join(ROOT, 'docs', m[1])), `docs/guide.html references a missing image: ${m[1]}`);
}

if (errors.length) {
  console.error(`consistency check failed (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`consistency ok: ${commands.length} prompt commands, ${Object.keys(meta.commands).length} engine commands, ${configKeys.length} config keys, ${actualTests} tests, v${version}`);

#!/usr/bin/env node
// Fails when a change lands in one tri artifact but not its companions.
// The repository practises what it asks of projects: a change propagates or CI stops it.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

// --- 3. every config key the script reads is documented ---
const script = read('scripts/tri.mjs');
const configKeys = [...new Set([...script.matchAll(/\bcfg\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]))]
  .filter((k) => !['root'].includes(k)); // root is derived, not user-set
for (const key of configKeys) {
  check(readme.includes(key), `README.md does not document the "${key}" config option`);
}

// --- 4. the version has a changelog entry ---
const version = JSON.parse(read('.claude-plugin/plugin.json')).version;
check(read('CHANGELOG.md').includes(`## ${version}`), `CHANGELOG.md has no section for version ${version}`);

// --- 5. claimed test count matches reality ---
const testFile = read('scripts/test-tri.mjs');
const actualTests = (testFile.match(/^check\(/gm) ?? []).length;
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

// --- 7. referenced files exist ---
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
console.log(`consistency ok: ${commands.length} commands, ${configKeys.length} config keys, ${actualTests} tests, v${version}`);

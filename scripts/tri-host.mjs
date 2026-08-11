#!/usr/bin/env node
// Host capability probe for TRI adapters. No capability is inferred from an installed binary alone.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { HOST_ADAPTERS } from './host-capabilities.mjs';

function detectedHost() {
  if (process.env.TRI_HOST) return process.env.TRI_HOST;
  if (process.env.PI_CODING_AGENT === 'true') return 'pi';
  if (process.env.CODEX_THREAD_ID || process.env.CODEX_HOME) return 'codex';
  // Cursor may export Claude-adjacent vars; prefer CURSOR_AGENT before CLAUDECODE.
  if (process.env.CURSOR_AGENT === '1') return 'cursor';
  if (process.env.CLAUDECODE === '1') return 'claude';
  if (process.env.GEMINI_CLI === '1') return 'gemini';
  if (process.env.ANTIGRAVITY_AGENT === '1') return 'antigravity';
  return 'generic';
}

function geminiAgentsEnabled() {
  try {
    const settings = JSON.parse(readFileSync(join(process.env.GEMINI_HOME ?? join(homedir(), '.gemini'), 'settings.json'), 'utf8'));
    return settings.experimental?.enableAgents === true;
  } catch { return false; }
}

const explicit = process.argv[2] && process.argv[2] !== '--json' ? process.argv[2] : null;
const host = explicit ?? detectedHost();
if (!HOST_ADAPTERS[host] || host === 'gemini-agents') {
  console.error(`unknown TRI host "${host}" (${Object.keys(HOST_ADAPTERS).filter((name) => name !== 'gemini-agents').join('|')})`);
  process.exit(1);
}
const adapter = host === 'gemini' && geminiAgentsEnabled() ? 'gemini-agents' : host;
const capabilities = HOST_ADAPTERS[adapter];
const result = {
  host, adapter, ...capabilities,
  team: adapter === 'claude' && process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1',
};
if (host === 'gemini' && adapter === 'gemini') result.reason = 'experimental.enableAgents is not true';
if (host === 'antigravity') result.reason = 'no verified programmable worker interface';
result.runStateArgs = ['--adapter', adapter, ...(result.team ? ['--team-capable'] : [])];
if (process.argv.includes('--json')) console.log(JSON.stringify(result));
else console.log(`${host}: adapter ${adapter}, backend ${result.backend}, parallel ${result.parallel ? 'yes' : 'no'}, team ${result.team ? 'yes' : 'no'}${result.reason ? ` (${result.reason})` : ''}`);

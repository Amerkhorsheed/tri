export const HOST_ADAPTERS = {
  generic: { parallel: false, team: false, backend: 'sequential' },
  claude: { parallel: true, team: true, backend: 'claude-agent' },
  codex: { parallel: true, team: false, backend: 'codex-spawn-agent' },
  cursor: { parallel: true, team: false, backend: 'cursor-task-tri-worker' },
  pi: { parallel: true, team: false, backend: 'pi-workers' },
  gemini: { parallel: false, team: false, backend: 'sequential' },
  'gemini-agents': { parallel: true, team: false, backend: 'gemini-subagent' },
  antigravity: { parallel: false, team: false, backend: 'sequential' },
};

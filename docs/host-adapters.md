# Host adapters

The engine owns task state, claims, scopes, evidence, leases, and completion gates. A host adapter owns only command presentation and worker launch. This seam has one contract:

1. Detect or explicitly name the host before `run-state --start`.
2. Declare only a worker interface the current host can actually launch.
3. Give every lease a distinct Git worktree, base commit, worker name, and exact paths.
4. Launch one declared-safe batch together; cancellation must stop children while leaving `.tri/run.json` resumable.
5. Return observed backend, actual mode, peak workers, task result, and exit status.
6. The orchestrator alone verifies and integrates; workers never lease, push, or merge.

| Adapter | Command surface | Worker backend | Parallel status |
|---|---|---|---|
| Claude Code | plugin `/tri:*` | `tri-worker` Agent; optional native team | Native |
| Codex | plugin `/tri:*` + `tri_worker` profile | stable `spawn_agent` | Native |
| Cursor | skill + `~/.cursor/agents/tri-worker` | Task `subagent_type: tri-worker` | Native |
| Pi | package `/tri:*` + `tri_workers` tool | cancellable Pi child processes | Native |
| Gemini CLI | extension commands + bundled `tri-worker` | `gemini-agents` experimental local subagent | Native when explicitly enabled; otherwise sequential; YOLO child tools |
| Antigravity | `AGENTS.md` + Agent Skills | none verified | Sequential, fail-safe |
| Generic | project `AGENTS.md` | none | Sequential |

Probe the current session:

```bash
node ~/.tri/scripts/tri-host.mjs --json
```

Pass the returned `runStateArgs` to `run-state --start`; Gemini uses `gemini-agents` only when its settings prove agents are enabled. Cursor is detected from `CURSOR_AGENT=1` and wins over Claude-adjacent environment variables. Set `TRI_HOST` only when automatic environment detection returns `generic`. The engine rejects unknown adapters and records the backend in `.tri/run.json`; a host cannot claim parallel work merely because multiple tasks exist.

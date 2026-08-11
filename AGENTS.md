# TRI host instructions

When a project contains `tri.config.json` or `tri/`, load the `tri-method` skill before acting. Run mechanics through `node ~/.tri/scripts/tri.mjs`; never hand-edit task Status or Assignee fields. Use the installed `/tri:*` command surface when available.

For batch work, run `node ~/.tri/scripts/tri-host.mjs --json`, pass its `runStateArgs` to `tri.mjs run-state --start`, and report the recorded adapter, backend, and actual mode. Never call sequential work parallel. Every concurrent worker gets a distinct Git worktree and the bundled `tri-worker` role (Claude Agent, Codex `spawn_agent`, Cursor Task, Pi workers, or Gemini subagent); the orchestrator alone leases, verifies, cherry-picks, and cleans up.

## TRI Method

This project uses the TRI delivery method (task register + decision registers + evidence gates). Any agent working here — Claude Code, Codex, Cursor, Pi, Gemini/Antigravity, or other — follows this loop:

1. Run `node ~/.tri/scripts/tri.mjs next` to see ready tasks; pick one (or the one you were told to do).
2. Before `claim`, create a unique `claim-token <ID> --by <name>` and atomically push its token to its exact ref with an empty force-with-lease expectation. Then run `claim <ID> --by <name>`. Branch names are not ownership evidence.
3. TRI v3 engine preflight requires Git and refuses detached/conflicted state, unsafe branch starts, malformed config, and dirty tracked state before new work. Create tasks, ADRs, decisions, blockers, and assumptions through engine commands; native v3 IDs are decentralized, while explicit sequential adapters still require `sync`.
4. Read the task file completely, plus every linked ADR and context document, before editing.
5. Implement exactly that one task. No unrelated refactoring.
6. Record consequential assumptions in `tri/ASSUMPTIONS.md`. Record decisions you are not authorized to make in `tri/DECISIONS.md` as blocking entries — never choose silently.
7. Architectural decisions (new dependency, new service, new boundary, changed contract) require an ADR in `tri/adr/` before implementation.
8. Run checks through `tri.mjs evidence <ID> --name <check> -- <command>` and summarize observed results in the task Evidence section. Standard requires successful structured evidence; strict also enforces configured check names and environment.
9. Run `node ~/.tri/scripts/tri.mjs validate` — must pass.
10. Run `node ~/.tri/scripts/tri.mjs done <ID>`, commit, push, and verify. Delete the exact claim ref after integration (or before `release`). Ask before opening or merging a PR; never merge silently.

New work discovered mid-task: create it with `node ~/.tri/scripts/tri.mjs new-task --title "..." --phase NN [--dep ID]`, don't fold it into the current task. Use `NN-label` for an exact named phase. When an existing tree has one suffixed directory such as `phase-12-mobile`, numeric phase creation reuses it; multiple matches fail rather than choosing silently. If the project sets `taskTemplate`, the new file uses the project's own template and every one of its fields must be filled before the task is claimed. If the project sets `companionFiles`, `new-task` names files it will not edit for you — task indexes and pinned inventory counts — and those must move in the same change or the project's own validator fails. `companions` can add maintenance strategies and argv-array hooks; `node ~/.tri/scripts/tri.mjs companions --check` checks them.

Batch mode first runs `node ~/.tri/scripts/tri-host.mjs --json`, then passes the probe's `runStateArgs` to `run-state --start ... --mode auto`, dynamic `--lease <worker>`, `--done`/`--blocked`, and `--finish`. Exact `Expected files` determine declared-safe concurrency; missing/overlapping scopes serialize. Every independent chain gets an isolated Git worktree. Claude uses Agents/teams, Codex uses native `spawn_agent`, Cursor uses Task `tri-worker` subagents, Pi uses `tri_workers`, Gemini uses its explicitly enabled experimental subagent, and Antigravity/generic hosts fail safe to sequential. The orchestrator verifies `verify-scope`, structured Evidence, project checks, and `validate` before cherry-picking each worker commit. Adapter, backend, requested mode, and actual mode must be reported honestly.

Stop and report instead of proceeding when: a dependency is not actually met, an owner decision is missing, the task would require weakening a validation gate, or scope exceeds the task.

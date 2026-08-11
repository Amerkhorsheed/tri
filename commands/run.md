---
description: Execute TRI tasks with automatic declared-safe parallelism, isolated workers, and resumable run state
argument-hint: "[phase NN | N | task IDs | resume]"
---
Load the tri-method skill first.

## 0. Preflight and recovery

Run TRI tier 1–3 preflight. In `branch-pr`, create and push one integration branch `run/<date>-<scope>` from the configured default branch. Run `tri.mjs run-state`; resume an active run unless the user explicitly chose a different scope.

## 1. Resolve scope

Read `status --json`, `next --json`, and `graph`. Resolve `$ARGUMENTS`; ask only when multiple scopes are equally defensible. Do not ask for an execution model: automatic declared-safe parallelism is the default, and `--mode` is an explicit override only.

Every parallel candidate needs exact repository-relative `Expected files` entries. No globs. For missing scopes, issue read-only Explore/Agent calls in parallel, inspect likely files, and write the smallest exact files/directories back to the task. If a scope cannot be established, that task serializes.

## 2. Start scheduler and reserve claims

Detect the active host, then start with the adapter arguments it reports:

```bash
node ~/.tri/scripts/tri-host.mjs --json
node ~/.tri/scripts/tri.mjs run-state --start "<scope>" --mode auto --capacity 4 --queue <IDs> --adapter <adapter> [--team-capable]
```

Use an explicit host probe when auto-detection returns `generic`. Pass its `adapter` and optional team argument exactly. Gemini's bundled subagent is experimental: the probe selects `gemini-agents` only when settings prove it is enabled, otherwise it selects sequential `gemini`. Antigravity currently declares sequential because it has no verified programmable worker interface. Read the reported **adapter**, **backend**, and **actual** mode. Never describe a fallback as parallel.

Lease the next worker batch, then create a unique token for each active task with `tri.mjs claim-token <ID> --by <worker>`. Atomically push each returned token to its returned ref with an empty lease expectation:

```bash
git push --atomic --force-with-lease=<ref>: origin <token>:<ref> [...]
```

Tokens have the integration HEAD as parent, so same-base contenders still produce different objects and only one empty-lease push wins. Claim only active work, not the future queue.

## 3. Lease and isolate

Request a worker batch atomically with `run-state --lease worker-1,worker-2,...`. For each non-null assignment, create one disposable Git worktree and branch from the integration HEAD, then run `claim <ID> --by <worker>` inside it before implementation. Never let workers share a checkout or call lease concurrently from worker processes.

- **Claude / `claude-agent`:** issue all `Agent` calls in one assistant turn with `tri-worker`, one per leased chain.
- **Codex / `codex-spawn-agent`:** issue native `spawn_agent` calls together with `agent_type: tri_worker`; install it once with `~/.tri/scripts/install-codex-agent.sh` if absent.
- **Pi / `pi-workers`:** call `tri_workers` once with the whole leased batch; it rejects duplicate worktrees, runs child Pi processes concurrently, propagates cancellation, and reports observed peak workers.
- **Gemini / `gemini-subagent`:** invoke the bundled `tri-worker` subagent once per lease in one parallel tool batch. Require `experimental.enableAgents`; these workers run in YOLO mode, so distinct worktrees and exact scopes are mandatory.
- **team / `claude-team`:** create one native Claude Code team only when TRI selected `team`.
- **sequential:** one lease and one worker at a time.

Do not implement tasks in the orchestrator while workers are active. The orchestrator alone calls `run-state --lease`; workers never lease their own work.

If the host cannot launch the reported backend, stop and restart state with the backend it can actually run. No silent fallback.

## 4. Gate and integrate continuously

As each worker returns:

1. In its worktree, verify commit ancestry and run `tri.mjs verify-scope <ID> --base <base>`.
2. Inspect structured Evidence and rerun `validate` plus the required project checks.
3. Reject the result on any gate failure or undeclared path; never auto-resolve a cherry-pick conflict.
4. Cherry-pick the accepted atomic commit onto the integration branch.
5. Run integration checks, then `run-state --done <ID>` (or `--blocked`).
6. Immediately lease the next newly-ready task so worker slots stay full.

Contract/shared-interface work remains a separate review PR. Everything else stays as atomic commits on the integration branch, normally one PR per phase/run; per-task PR is an explicit override.

## 5. Finish

When no lease remains, run `run-state --finish`, remove disposable worktrees, and delete completed remote claim refs. For an abandoned task, delete its exact remote claim ref before `release`. Push and verify the integration branch. Ask before opening or merging a PR.

Report requested/actual mode, peak workers, tasks and commits, blocked entries, elapsed time, open PRs, and the new frontier. Stop only for owner decisions, failed gates after a real fix attempt, irreversible actions, or exhausted scope.

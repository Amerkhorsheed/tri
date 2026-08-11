# Changelog

## 3.1.0 — 2026-08-11

- Added native Codex plugin commands and a `tri_worker` profile for stable `spawn_agent` execution.
- Added a Pi package with `/tri:*` commands, selectable owner questions, and cancellable concurrent workers that enforce distinct Git worktrees.
- Added Gemini/Antigravity extension surfaces and a cross-compatible bundled Gemini subagent; Gemini parallelism is explicit and experimental, while Antigravity fails safe to sequential until its worker interface is verifiable.
- Added the shared host adapter contract and capability probe. Run state now records adapter, backend, requested mode, and actual mode instead of assuming every host can launch parallel workers.
- Added adapter smoke tests, including two observed overlapping Pi worker processes, and cross-host package consistency checks.

## 3.0.0 — 2026-08-11

- Moved safety guarantees into the Node engine: Git/config preflight, repository-contained paths, exact claim scopes, and authoritative command/config metadata.
- Replaced global counters in new TRI workspaces with decentralized random task, ADR, decision, blocker, and assumption IDs while preserving legacy numeric readers and sequential adapter mode.
- Added exact remote claim refs (`refs/heads/tri/claims/<ID>`), engine-owned ADR/register creation, atomic state writes, and scope verification against worker commits.
- Made standard/strict completion require successful structured evidence. Evidence records engine/runtime context and output hashes rather than raw output; strict enforces required checks and expected environment.
- Replaced passive run modes with dynamic leasing: automatic declared-safe concurrency, requested/actual mode, worker assignments, dependency release, isolated `tri-worker` worktrees, and gated integration commits.
- Expanded visualization with a native dependency graph alongside the phase board, worker display, topology-based ordering, and mixed legacy/random ID support.
- Added v3 regression coverage and minimum/current Node CI; fixed Withdrawn work appearing on the critical path and stale method documentation referencing removed commands.

## 2.5.0 — 2026-08-06

- `/tri:run` and `/tri:ship` now choose an execution model — sequential, parallel subagents, or a team of agents — recommended by batch shape instead of a one-line heuristic: sequential for ≤ 3 tasks, chains deeper than 2, or overlapping files; parallel subagents for ≥ 4 file-disjoint tasks; a team (Claude Code only, experimental) for ≥ 8 substantial disjoint tasks, degrading to parallel subagents anywhere else.
- The three models are documented as distinct contracts, not one knob: subagents stay isolated with zero shared context, a team shares a plan and can re-plan mid-run, and the main thread stays the gate-keeper (run-state, `validate`, Evidence, `done`) in both.
- `run-state --start` validates the mode (`sequential|parallel|team`) and warns when a non-sequential mode queues tasks that declare overlapping `Expected files`.

## 2.4.0 — 2026-08-06

- A dependency on a `Withdrawn` task no longer deadlocks: it warns in `done` and does not block the frontier, matching what `validate` already reported.
- Evidence runtime checks warn when **any** recorded run came from outside the expected environment, not only when every run did — the mixed host/container case from the field report can no longer pass silently.
- `new-task` with a project `taskTemplate` now fails instead of silently dropping a `--phase` or `--dep` the template cannot express.
- `validate` flags a single task whose Objective restates its title verbatim instead of waiting for a majority of tasks to share the defect.
- `/tri:clarify`, `plan`, and `ship` now document the promotion rule: `Unrevised` becomes `Specified` only when the run actually edited Objective and Acceptance criteria.
- `rebaseline` layer paths follow configured `adrDir` and `decisionFiles` instead of hardcoded `tri/adr`, and honor `baseBranch` when `defaultBranch` is unset.
- `done` in lite profile no longer warns about evidence execution context the profile does not require; removed dead identifier-map code.

## 2.3.0 — 2026-08-06

- Hardened remote identifier inventory to fail closed when configured refs, fetches, or branch comparisons are unavailable.
- Preserved configured task-template fields unless explicit CLI options own them; malformed runtime probes and unsupported companion strategies now fail clearly.
- Hardened evidence and companion subprocess failure reporting.
- Added Git-backed regression coverage for remote reservation failures/collisions and canonical doctor ADR checks.
- Hardened doctor against malformed/fenced ADR metadata, duplicate definitions, out-of-scope ADR paths, and incomplete task citations.

## 2.2.0 — 2026-08-06

- Added collision-safe remote identifier reservations, `sync`, and `validate --remote` for task, ADR, and register identifiers.
- Added structured evidence execution context, expected-environment warnings, and the `evidence` command while preserving legacy evidence records.
- Added configured task-template validation, companion strategies/hooks and `companions --check`.
- Added first-class `Withdrawn` lifecycle status, specification status (`Unrevised`/`Specified`/`Withdrawn`), boilerplate warnings, and TODO objectives for generated tasks.
- Added `doctor` governing-document warnings and ordered `rebaseline` state machine.
- Added command, skill, template, and cross-agent documentation for new safeguards.

## 2.1.0 — 2026-08-05

- Added explicit claim-scope manifests with task, responsibility, ADR, owner, and future-coverage fields. Claims validate and refuse overlapping local scopes instead of inferring ownership from branch names.

## 2.0.3 — 2026-08-05

- Numeric phase creation now refuses when canonical and suffixed directories coexist, preventing a silent split even when both names already exist.

## 2.0.2 — 2026-08-05

- Fixed `new-task --phase NN` for existing task trees with named phase directories. When exactly one `phase-NN-*` directory exists, tri reuses it instead of creating a parallel `phase-NN` tree; exact `NN-label` input is supported and ambiguous matches fail closed.
- Follow-up hardening: numeric phase creation now refuses when canonical and suffixed directories coexist, preventing a silent split even when both names already exist.

## 2.0.1 — 2026-08-05

- Fixed dangling references left by the 2.0.0 removals: /tri:go still routed
  unsettled architectural changes to the removed /tri:grill, and still ended by
  naming a command despite the continuation rule. The consistency check now
  fails on any reference to a command that does not exist.

## 2.0.0 — 2026-08-05

Breaking: two commands removed.

- **Commands continue instead of handing off.** The old rule — "route, run,
  report, the user re-invokes" — turned every workflow into a sequence the user
  had to remember and type. A command that finishes with exactly one sensible
  next step now takes it, announcing each hop. It stops only at a real gate: the
  ship specification gate, an owner decision, a red validator after a genuine
  fix attempt, or anything irreversible. Ambiguity gets a question, not a halt.
- **`/tri:decide` removed.** Writing register entries is a capability every
  command already had; nobody has a reason to invoke it directly. Decisions are
  now recorded in the command where they arise.
- **`/tri:grill` merged into `/tri:clarify`**, which adapts depth: batched
  questions for vague specifications, one question at a time when interrogating
  a decision or a direction the user doubts.
- `/tri:adr` continues into re-specifying the tasks its decision unblocks.

## 1.7.1 — 2026-08-05

- `/tri:ship` kept the older two-check preflight: the 1.7.0 edit targeted
  wording that had already changed, so the tier upgrade silently missed it.
  The consistency check now fails when any mutating command declares no
  preflight tier, so the same miss cannot recur.

## 1.7.0 — 2026-08-05

- Preflight is now tiered and applies to **every** mutating command, not only
  the three that claim work. Six commands — `decide`, `adr`, `plan`, `grill`,
  `clarify`, `done` — committed to the repository with no checks at all.
- Tier 1 (all mutating commands) adds mid-rebase/merge and detached-HEAD stops
  alongside the dirty-worktree and branch checks.
- Tier 2 (anything allocating a shared identifier — a decision number, an ADR
  number, a task id) requires a fetch first. Allocating from a stale ref is how
  two developers pick the same number, and the collision is invisible until
  merge.
- Tier 3 (anything claiming work) checks remote branches, since a pushed branch
  is the claim.

## 1.6.0 — 2026-08-05

- Preflight before any work command commits: stop on a dirty worktree, and in
  `branch-pr` workflow cut the work branch from the default branch first.
  `/tri:ship` had no branch instruction at all, so a specification commit would
  have landed on the default branch; nothing anywhere checked for uncommitted
  work, so a new task could be started on top of a half-finished edit.
- `/tri:ship` cuts `ship/<date>-<slug>` in a new stage 0, keeps the
  specification commit and implementation commits on it, and can PR the
  specification alone when the user chooses to review before implementing.

## 1.5.0 — 2026-08-05

Found by adversarial probing of concurrency, recovery, and malformed input.

- `run-state` command: batch progress is now recorded by the script rather than
  by prose instruction. `--start`/`--done`/`--blocked`/`--finish`, and bare
  `run-state` prints what remains. Recovery from a killed session no longer
  depends on the agent having written the file correctly.
- `release` now requires `--force` to drop a claim held by someone else, the
  same protection `claim` already had. The asymmetry let one developer silently
  release another's in-progress work.
- `new-task` warns that ids come from the local tree only: two developers
  creating a task from the same base were both silently given the same id.
- A malformed `tri.config.json` reports the file and the parse error instead of
  printing a raw stack trace.

## 1.4.1 — 2026-08-05

- `/tri:go` routing fix: an architectural ask that is proposed rather than
  decided ("should we switch to X") now routes to `/tri:grill` before
  `/tri:adr`. The previous table sent any architectural ask straight to the
  ADR, which would have written a decision record for a choice the user had
  not made — and skipped the stress-test that surfaces blocking constraints.

## 1.4.0 — 2026-08-05

- `/tri:ship <area>`: the whole pipeline in one command — scope, interview,
  finalize specifications, then implement. Exactly one gate, between
  specification and implementation, because a spec error caught there costs
  seconds and the same error caught mid-batch costs the batch. Stages before
  the gate are interactive; stage 4 hands off to the `/tri:run` loop unattended.
- `/tri:go` routes an unspecified feature area to `/tri:ship` and keeps
  `/tri:run` for work that is already specified, so there is still one front door.

## 1.3.0 — 2026-08-05

- `scripts/check-consistency.mjs`: fails when a change lands in one artifact but
  not its companions — an undocumented command, an undocumented config key, a
  version without a changelog entry, a stale test-count claim, a broken link.
  Caught real drift on its first run: `/tri:go` was missing from the guide, and
  `commands/status.md` never loaded the tri-method skill.
- `CONTRIBUTING.md`: the propagation table stating what must move together for
  each kind of change, and why the version bump is not optional.
- Guide documents `/tri:go`, structured questions, and the adapter config;
  the AGENTS.md template tells agents about `taskTemplate` and `companionFiles`.

## 1.2.0 — 2026-08-05

- `taskTemplate` config: when a project owns its task template, `new-task` uses
  it instead of tri's. A project's fields are the contract its own validators
  enforce; writing tri's template into such a repo produced files that failed
  those validators on creation.
- `companionFiles` config: `new-task` names the files it cannot update itself
  (task indexes, pinned inventory counts) instead of silently leaving them
  stale. Pinned counts are a deliberate anti-drift control in some repos, so
  tri reports rather than edits them.

## 1.1.0 — 2026-08-05

- Structured questions are now the default way every command asks for a decision.
  Options are selectable, the recommended one comes first and is marked, each
  carries its tradeoff, and up to four independent questions batch into one turn.
  Prose is reserved for genuinely open-ended answers. `/tri:run` asks scope and
  mode this way; `/tri:grill` stays deliberately one question at a time because
  each answer shapes the next.

## 1.0.0 — 2026-08-05

First version adopted as a team baseline. Verified against a production
workspace of 338 governed task files (validate clean; frontier and
critical path reconciled against an independent analysis).

- `/tri:go` — state-aware router; reads status, frontier, graph, and any
  interrupted run state, then runs the one command that fits the stated focus.
- `/tri:run` — autonomous batch execution. Scope and mode chosen once, then
  no checkpoints between tasks; resumable via `.tri/run.json`. A task needing
  an owner decision is recorded and parked while the run continues.
- `/tri:visualize` — self-contained interactive HTML board (phase lanes,
  status colors, ready and critical-path highlighting, dependency panel)
  written to gitignored `.tri/`.
- `/tri:grill`, `/tri:clarify` — requirement stress-testing and refinement
  that write outcomes back into task files and registers, not into chat.
- Branch and PR workflows: `"workflow": "trunk" | "branch-pr"`. In branch-pr
  the pushed branch is the visible claim; sequential batch runs use one run
  branch with a PR per phase boundary.
- Adapter mode: `idPrefix`, `idWidth`, `statuses`, `evidenceDir`, `taskDir`
  let tri drive an existing task tree without rewriting a single file.
- `next --json`, `status --json` for machine consumption.
- 29 behavioral tests.

## 0.1.0 — 2026-08-05

Initial extraction: task register, decision/assumption registers, ADR
templates, three rigor profiles, dynamic pull-based claiming, evidence-gated
done, and the AGENTS.md section for cross-agent parity.

---
description: Autonomous batch execution of TRI tasks — scoped interactively, gated mechanically, resumable via run state
argument-hint: "[phase NN | N | T-NNNN T-NNNN... | resume]"
---
Load the tri-method skill first (its Batch runs section defines the state file and stop conditions).

**0. Preflight.** Run the tri-method **tier 1, 2 and 3** preflight: worktree and branch state, `git fetch` so the frontier and any allocated identifiers are current, and `git ls-remote --heads origin` so a task already claimed by a pushed branch is not claimed twice. In `branch-pr` workflow create the run branch (`run/<date>-<scope>`) from the default branch before any commit, and **push it immediately; verify the remote ref**. Any push failure stops the run.

**1. Resume check.** Run `node ~/.tri/scripts/tri.mjs run-state`. If it reports an active run, summarize it and ask via AskUserQuestion: resume or start fresh. `$ARGUMENTS` = `resume` skips the question.

**2. Scope.** If $ARGUMENTS names a scope (phase, count, task list), use it. Otherwise research first: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs status --json`, `next --json`, and `graph`, then present the real options with numbers — e.g. "frontier: 4 ready; phase 09 has 6 workable; until-blocked reaches ~14 tasks" — then **ask scope and execution model together in one AskUserQuestion call** (two questions, four options each at most): scope — *until natural stop* / *one phase* / *N tasks* / *named tasks*, with the real counts in each description; execution model — *sequential* / *parallel subagents* / *team* (team only offered when running in Claude Code). Recommend by the shape of the ready work, and put the numbers in the recommended option's description:

| Batch shape | Recommend |
|---|---|
| ≤ 3 tasks, or dependency chains deeper than 2, or overlapping/shared files | **Sequential** — tasks stack on one run branch; shared-file tasks are extracted to their own PR |
| ≥ 4 ready tasks, shallow chains, disjoint Expected files | **Parallel subagents** — one subagent per independent chain, not one per task; isolation is a feature |
| Claude Code, ≥ 8 substantial tasks, disjoint files, tasks sharing conventions or likely to need mid-run re-planning | **Team** (experimental, Claude Code only) — leader with shared context; degrade to parallel subagents anywhere else |

Check `Expected files` / module paths in the task files for overlap before recommending anything but sequential; `run-state --start` repeats this check mechanically and warns when a non-sequential mode queues tasks declaring the same Expected files.

**4. Record the run** with `run-state --start "<scope>" --mode <sequential|parallel|team> --queue <ID,ID,...>`. After every task, record the outcome with `run-state --done <ID>` or `run-state --blocked <ID>` — never hand-edit `.tri/run.json`. The run must survive a session restart, and these commands are what make that true rather than hoped.

**5. Loop — branching depends on mode.** Sequential run in branch-pr workflow: create ONE run branch (`run/<date>-<scope>`) from the default branch; its first commit claims the whole queue (push immediately, verify the remote ref — push failure stops). Before starting, `run-state --start` refuses any `Unrevised` task unless the explicit `--allow-unrevised` override is passed. Then per task: read the task file fully plus linked ADRs/Skills → implement → run its required tests → fill Evidence → `validate` → `done` → one atomic commit with the task ID → push and verify the remote ref → update state → next task **without asking the user anything**. Tasks stack on the run branch, so intra-run dependency chains work. At each phase boundary (or run end) ask before opening or merging one PR listing the tasks and their evidence; merge only after explicit approval. A task touching contract/shared files is extracted to its own branch/PR for the other dev's review while the run continues. Trunk workflow: same loop, commits straight to the shared branch.

**6. Stop conditions — the only reasons to pause or halt:**
- Owner decision needed → write the B- entry, mark that task Blocked, and **continue with other independent tasks in scope**; halt only when nothing runnable remains.
- Genuine requirement ambiguity → same: record it, park the task, continue elsewhere; batch the questions for the end unless nothing else is runnable.
- `validate` or tests red after a real fix attempt → halt; never weaken a gate to keep the loop moving.
- Scope exhausted or frontier empty → normal finish.

**7. Parallel subagents.** Dispatch one subagent per independent chain of ready tasks (M = min(chains, 4), not one per task); each subagent claims its own task and — unlike the sequential run — uses a per-task branch and PR (simultaneous workers cannot share a branch). The orchestrator re-runs `validate` and inspects Evidence before accepting any subagent's `done` — reject and redo work that fails the gate. Subagents get **no shared context by design**: each reads its task, its linked ADRs, and nothing else. That isolation is the point — no cross-task contamination — and it is the fallback execution model on any host agent, not just Claude Code.

**7b. Team of agents (Claude Code only, experimental).** A team is **not** parallel subagents. One team session runs a leader plus workers that **share the plan and context**: the leader assigns tasks from the queue, workers report back, and the leader can re-plan mid-run — re-assign a failed task, split work, or route a discovered sub-problem — without the orchestrator. The main thread remains the gate-keeper either way: it records `run-state`, re-runs `validate`, inspects Evidence, and accepts `done` exactly as in parallel mode. Teams do not remove what tri's gates already require: dependency chains still serialize, and tasks touching shared/contract files are still extracted to their own PR (a team shares context, not file writes). On any host without Claude Code teams, degrade to parallel subagents — same queue, same gates.

**8. Finish.** Run `run-state --finish`. Report: tasks done (with commits), tasks blocked (with B- entries), open questions batched for the user, and the new frontier from `status`.

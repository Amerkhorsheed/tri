---
description: Autonomous batch execution of TRI tasks — scoped interactively, gated mechanically, resumable via run state
argument-hint: "[phase NN | N | T-NNNN T-NNNN... | resume]"
---
Load the tri-method skill first (its Batch runs section defines the state file and stop conditions).

**1. Resume check.** If `.tri/run.json` exists with unfinished queue entries, summarize it (scope, done, remaining) and ask via AskUserQuestion: resume or start fresh. `$ARGUMENTS` = `resume` skips the question.

**2. Scope.** If $ARGUMENTS names a scope (phase, count, task list), use it. Otherwise research first: run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs status --json`, `next --json`, and `graph`, then present the real options with numbers — e.g. "frontier: 4 ready; phase 09 has 6 workable; until-blocked reaches ~14 tasks" — then **ask scope and execution mode together in one AskUserQuestion call** (two questions, four options each at most): scope — *until natural stop* / *one phase* / *N tasks* / *named tasks*, with the real counts in each description; mode — *sequential* / *parallel with M subagents*. Recommend parallel only when the ready tasks in scope touch disjoint files (check Expected files / module paths); otherwise recommend sequential and say why in the option description.

**4. Write state** to `.tri/run.json`: `{scope, mode, queue, done, blocked, startedAt}`. Update it after every task — the run must survive a session restart.

**5. Loop — branching depends on mode.** Sequential run in branch-pr workflow: create ONE run branch (`run/<date>-<scope>`) from the default branch; its first commit claims the whole queue (push immediately — the pushed run branch claims those tasks). Then per task: read the task file fully plus linked ADRs/Skills → implement → run its required tests → fill Evidence → `validate` → `done` → one atomic commit with the task ID → update state → next task **without asking the user anything**. Tasks stack on the run branch, so intra-run dependency chains work. At each phase boundary (or run end) open one PR listing the tasks and their evidence; merge on green. A task touching contract/shared files is extracted to its own branch/PR for the other dev's review while the run continues. Trunk workflow: same loop, commits straight to the shared branch.

**6. Stop conditions — the only reasons to pause or halt:**
- Owner decision needed → write the B- entry, mark that task Blocked, and **continue with other independent tasks in scope**; halt only when nothing runnable remains.
- Genuine requirement ambiguity → same: record it, park the task, continue elsewhere; batch the questions for the end unless nothing else is runnable.
- `validate` or tests red after a real fix attempt → halt; never weaken a gate to keep the loop moving.
- Scope exhausted or frontier empty → normal finish.

**7. Parallel mode.** Dispatch one subagent per ready file-disjoint task; each subagent claims its own task and — unlike the sequential run — uses a per-task branch and PR (simultaneous workers cannot share a branch). The orchestrator re-runs `validate` and inspects Evidence before accepting any subagent's `done` — reject and redo work that fails the gate.

**8. Finish.** Mark state finished. Report: tasks done (with commits), tasks blocked (with B- entries), open questions batched for the user, and the new frontier from `status`.

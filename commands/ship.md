---
description: Take a feature area from unclear to built — scope, interview, finalize specs, then implement unattended after one go-ahead
argument-hint: "<a feature, area, phase, or goal — e.g. \"the admin surface\" or \"phase 10\">"
---
Load the tri-method skill first. This command runs four stages in order. Stages 1-3 are interactive by nature. Stage 4 runs unattended. **There is exactly one pause between them, and it is not optional** — a specification error costs seconds to fix before implementation and days after.

## Stage 0 — Preflight

Run the **tier 1, 2 and 3** preflight from the tri-method skill: worktree and branch state (stop on a dirty tree, a rebase or merge in progress, or a detached HEAD), `git fetch` so the scope is judged against the current default branch and any identifier this run allocates is not already taken, and `git ls-remote --heads origin` so no task in scope is already claimed by someone's pushed branch.

In `branch-pr` workflow, **create the run branch now** — `ship/<date>-<slug>` from the default branch — so that neither the specification commit nor any implementation commit can land on the default branch. Push it immediately: the pushed branch is the claim on this scope.

## Stage 1 — Scope

Read `node ~/.tri/scripts/tri.mjs status --json`, `next --json`, and `graph`. Resolve $ARGUMENTS against the real task tree. If `.tri/run.json` holds an unfinished queue, resume that instead of starting fresh.

Present the resolved scope with real numbers — which tasks, which are ready, which are blocked and by what, how deep the chain runs — and confirm it with AskUserQuestion if more than one reading is defensible. Bound it: a scope larger than a phase should be cut down before proceeding, and say why.

## Stage 2 — Interview

For every task in scope, read the file completely plus its linked ADRs, skills, and context documents. Then find what is genuinely undecided:

- Objectives that restate the title instead of naming an outcome.
- Acceptance criteria that are not binary or not testable.
- Boilerplate shared across many tasks — check whether the wording is templated rather than specific.
- Dependencies that look ceremonial, and missing dependencies that are real.
- Choices the task assumes but never records: a stack, a boundary, a protocol, a storage location.

Put every real decision to the user with AskUserQuestion — recommended option first and marked, the actual tradeoff in each description, up to four independent questions per call. Ask sequentially only where a later question depends on an earlier answer. **Never ask what the repository can answer**: read the files and run the script first, then ask only what is genuinely the user's to decide.

If a decision is not the user's to make either — legal, licensing, an appointment, an external approval — record it as a `B-` entry, mark the task Blocked, and continue with the rest of the scope.

## Stage 3 — Finalize specifications

Write the answers into the artifacts, not into the conversation:

- Task files: Objective, In/Out of scope, functional requirements, and **binary acceptance criteria**. If the project sets `taskTemplate`, every field that template requires must be filled.
- `DECISIONS.md`: a `D-` entry for each resolved choice with its reasoning; a `B-` entry for each open one.
- `ASSUMPTIONS.md`: consequential assumptions with what would invalidate them.
- An ADR for any architectural decision — new dependency, service, boundary, or changed contract — **before** it can be implemented. If a task in scope needs one, it stays Blocked until that ADR is Accepted, and the run continues with the others.
- New work discovered: `new-task`, never folded into an existing task. Honor `companionFiles` — update the indexes and pinned counts the script names.

Run the project's validators. Commit the specifications as their own commit on the branch created in stage 0 — separate from any implementation commit, so the specification is revertable and reviewable on its own.

## The gate

Report what was specified, what was decided, what is blocked and by whom, and exactly which tasks are about to be implemented. Then ask, with AskUserQuestion:

- **Proceed** — implement the queue now.
- **Review first** — stop here and open a PR for the specification commit alone. It stands on its own; the user resumes later with `/tri:ship resume` or `/tri:run`.
- **Adjust** — return to stage 2 for the tasks the user names.

Do not proceed without an explicit answer. This is the only pause; make it count by reporting honestly rather than optimistically.

## Stage 4 — Implement

Hand off to the `/tri:run` loop with the queue from stage 3, and follow its rules exactly: ask the scope-and-mode question once (sequential, or parallel subagents when the tasks touch disjoint files), record the queue with `run-state --start`, then run task after task — claim, implement, test, evidence, `validate`, `done`, commit — **with no further questions**. A task needing an owner decision gets its `B-` entry and is parked while the run continues. Halt only on a red gate after a real fix attempt, or when nothing runnable remains.

Stay on the stage-0 branch: implementation commits stack on top of the specification commit, one atomic commit per task, and the PR at the end (or per phase boundary) carries both. Parallel subagent runs still use per-task branches, since simultaneous workers cannot share one.

## Finish

Report: tasks specified, tasks implemented with their commits, tasks blocked with their register entries, open PRs, questions batched during the run, and the new frontier. Name the next command.

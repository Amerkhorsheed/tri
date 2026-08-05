---
name: tri-method
description: Use when a project contains tri.config.json or a tri/ workspace, when the user invokes any /tri command, or when the user asks to plan work as tasks, claim tasks for parallel developers, record a decision or assumption, write an ADR, or mark work done with evidence.
---

# TRI Method

## Overview

TRI = Task register + Registers (decisions/assumptions/ADRs) + Increment evidence. One task per change, decisions recorded not assumed, done means evidenced. State lives in plain markdown under `tri/` and merges through git — no server, no lock service.

All mechanics go through one script: `node <plugin>/scripts/tri.mjs` (run with no args for usage). Never hand-edit Status/Assignee fields — the script keeps them parseable.

## Routing

`/tri:go [focus]` is the entry point when the right command isn't obvious: it reads state, matches intent to exactly one command, runs it, and reports. Its rules live in the command file. Everything below is what it routes *to* — and what an experienced user invokes directly.

## The loop

1. `tri.mjs next` — ready tasks (dependencies Done, unclaimed).
2. `tri.mjs claim T-NNNN --by <name>` — commit the claim immediately; the commit is the lock.
3. Read the task file fully, plus its linked ADRs and context docs, before editing.
4. Implement exactly that task. New work discovered → `tri.mjs new-task`, never scope-fold.
5. Record assumptions in `tri/ASSUMPTIONS.md`; unresolved choices in `tri/DECISIONS.md` as blocking entries. **Never choose silently.**
6. Fill the task's Evidence section (commands + observed results). Strict profile: also `tri/evidence/<ID>-<date>.md`.
7. `tri.mjs validate` must pass, then `tri.mjs done T-NNNN`, commit, push.

## Parallel work (dynamic claiming)

Claiming is pull-based and dynamic: claim when you start, claim more when you finish, any dev any day. No pre-assigned ranges. Rules that keep it consistent:

- A claim is real only once committed/pushed. Two devs claiming the same task = push conflict; first push wins, second runs `next` and picks another.
- Claims are **advisory**: the script warns (never blocks) when claiming a task with unmet dependencies — the dev is trusted to know why.
- Cross-cutting files (API contracts, shared schemas) get changed in their own small PR reviewed by the other dev *before* dependent implementation. Everything else merges on green `validate` + project tests.
- Registers (DECISIONS/ASSUMPTIONS) are append-only; merge conflicts resolve by keeping both entries.

## Batch runs (/tri:run)

Autonomous multi-task execution. Scope and mode are chosen interactively at start; the loop then runs without human checkpoints — the gates are the brakes. State lives in `.tri/run.json` (local scratch, survives restarts): `{scope, mode, queue, done, blocked, startedAt}`; update it after every task. In `branch-pr` workflow a sequential run uses ONE run branch (`run/<date>-<scope>`, first commit claims the queue, pushed immediately) with one atomic commit per task and one PR per phase boundary — tasks stack, so intra-run dependency chains work; per-task branches from the default branch would silently drop the previous task's unmerged code. Parallel subagent runs keep per-task branches/PRs. Contract/shared-file tasks are extracted to their own PR for review while the run continues. Open PRs go in the final report; the frontier is read from the default branch only.

Mid-run rules: never ask the user between tasks. A task needing an owner decision or clarification gets its B-/register entry, goes Blocked, and the run continues with other runnable tasks; questions batch to the end. Halt outright only for a red gate after a real fix attempt, or an empty runnable set. Machine-readable feeds: `next --json`, `status --json`.

## Branches and PRs

`tri.config.json` sets `"workflow"`: `"trunk"` (default) or `"branch-pr"`. The script never runs git — branch/PR discipline is yours, per this section.

**trunk:** work on the shared branch; the pushed claim commit is the lock.

**branch-pr:** one branch per task, named `<task-id-lowercase>-<slug>` (e.g. `task-0261-endpoint-enforcement`). Rules that keep claims and status truthful:

- Before claiming, check remote branches (`git ls-remote --heads origin`): a branch named for the task ID is a claim, and a pushed `run/*` branch claims every task in its first (claim) commit.
- The claim commit is the branch's first commit; push the branch immediately — the pushed branch is the visible lock.
- `done` flips status inside the same branch; the PR merge lands the flip. **The frontier is only ever read from the default branch** — status on an unmerged branch is a proposal, not truth.
- One task per branch per PR, no batching. PRs merge on green `validate` + project tests; changes touching contract/shared files wait for the other dev's review per the parallel-work rules.

## Decisions and ADRs

- Choice you're not authorized to make → `B-` entry in DECISIONS.md, task goes Blocked. Owner resolves with a `D-` entry.
- Architectural decision (new dependency, service, boundary, changed contract) → ADR in `tri/adr/` from the template, **before** implementing.
- Entries are never rewritten; supersede with a new entry that references the old ID.

## Profiles

| Profile | Task template | Done gate |
|---|---|---|
| lite | ~8 fields | validate passes |
| standard (default) | ~18 fields | + Evidence section non-empty |
| strict | ~28 fields | + evidence record file in `tri/evidence/` |

Set at `tri.mjs init --profile <p>`; recorded in `tri.config.json`.

## Red flags — stop and correct

- Implementing without a claim, or claiming without committing the claim.
- Editing another dev's In Progress task file.
- Marking done with an empty Evidence section ("tests pass" is a claim; paste the command and result).
- Resolving an owner-level choice inline "to keep moving" — that's a B- entry, not your call.
- Weakening `validate` or a test to get to Done.
- Bundling a second task's work "while I'm here".

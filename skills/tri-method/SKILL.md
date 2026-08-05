---
name: tri-method
description: Use when a project contains tri.config.json or a tri/ workspace, when the user invokes any /tri command, or when the user asks to plan work as tasks, claim tasks for parallel developers, record a decision or assumption, write an ADR, or mark work done with evidence.
---

# TRI Method

## Overview

TRI = Task register + Registers (decisions/assumptions/ADRs) + Increment evidence. One task per change, decisions recorded not assumed, done means evidenced. State lives in plain markdown under `tri/` and merges through git — no server, no lock service.

All mechanics go through one script: `node <plugin>/scripts/tri.mjs` (run with no args for usage). Never hand-edit Status/Assignee fields — the script keeps them parseable.

## Routing and continuation

`/tri:go [focus]` is the entry point when the right command isn't obvious: it reads state, matches intent to exactly one command, runs it, and continues.

**Continue by default.** When a command finishes and exactly one sensible next step exists, take it — do not end by naming a command for the user to type. An ADR that lands re-specifies the tasks that were waiting on it. A clarification that resolves claims the task and starts work. A batch that empties reports and stops. Announce each continuation in one line as you take it, so the user can see the chain and interrupt it.

**Stop only at a real gate.** These are the whole list:

- The `/tri:ship` gate between specification and implementation.
- A decision that is the user's or an owner's to make — record the `B-` entry, then stop or continue elsewhere per the command.
- A red validator or failing test after a genuine fix attempt.
- Anything irreversible or outward-facing: force-push, merging a PR that touches contracts or shared files, deleting work.
- The user asked for one specific thing and the continuation would exceed it.

Ambiguity is not a gate — resolve it with a question and keep going. Ceremony is not a gate either: never stop merely to confirm that the obvious next step is the obvious next step.

## Asking the user

When a command needs a decision from the user, **present it with the structured question tool (AskUserQuestion), not as prose.** It renders selectable options, batches up to four independent questions in one turn, always allows free-text "Other", and produces an answer you can write straight into a task file or register.

- Put your recommended option **first** and mark it `(Recommended)`. State the tradeoff in each option's description — the user is choosing, not guessing.
- Batch independent decisions into one call (max four). Ask sequentially only when a later question depends on an earlier answer — `/tri:clarify` goes one at a time when the target is a decision, for that reason.
- Use prose instead only when the answer is genuinely open-ended (wording an Objective, naming a thing) or when nothing is actually being decided.
- Never ask what the repository can answer. Read the files, run the script, then ask only the decisions.

## Preflight — before any command changes anything

Nine commands write to the repository: `next`, `ship`, `run`, `done`, `clarify`, `grill`, `decide`, `adr`, `plan`, `init`. Each runs the tier below that matches what it is about to change. `status`, `visualize`, and the read phase of `go` change nothing and skip this.

### Tier 1 — every mutating command

```
git rev-parse --git-dir && git status --porcelain=v1 --branch && git branch --show-current
```

| Condition | Action |
|---|---|
| Not a git repository | Proceed, but say once that no branch or claim protection exists here |
| `MERGE_HEAD`, `CHERRY_PICK_HEAD`, or a rebase in progress | **Stop.** Finish or abort the operation first; committing into it corrupts the history |
| Detached HEAD | **Stop.** Commits would be unreachable. Ask which branch to move to |
| Tracked files modified or staged | **Stop.** Report exactly what is dirty and ask: commit, stash, or proceed deliberately. Never build new work on a half-finished edit |
| Untracked files only | Proceed, but list them — they are often the previous session's unfinished work |
| `branch-pr` and on the default branch | Create the work branch **before** the first commit |
| `branch-pr` and on an unrelated task's branch | Say so; branch from the default branch instead. Stacking unrelated work makes that PR unreviewable |
| `trunk` workflow | Dirty and mid-operation checks still apply; branch checks do not |

### Tier 2 — commands that allocate a shared identifier

`decide` (D-/B- numbers), `adr` (ADR numbers), `plan` and `new-task` (task ids), and `clarify`/`grill` when they write register entries.

```
git fetch --quiet && git log --oneline HEAD..@{upstream}
```

Identifiers are allocated from what you can see. A stale ref means allocating a number someone else already used — the failure is silent locally and only surfaces at merge.

| Condition | Action |
|---|---|
| Default branch has moved | Pull or rebase **before** allocating; re-read the register afterwards |
| Local and remote diverged | **Stop.** Resolve the divergence first |
| No remote configured | Proceed and say that identifier collision cannot be detected |
| Remote unreachable | Warn, name the risk (a duplicate D-, ADR, or task id), and let the user decide whether to proceed |

### Tier 3 — commands that claim work

`next`, `ship`, `run`.

```
git ls-remote --heads origin
```

| Condition | Action |
|---|---|
| A remote branch is named for this task id | It is already claimed. **Stop** and report who, unless the user explicitly takes it over |
| A pushed `run/*` or `ship/*` branch covers this scope | Same — its first commit claims the whole queue |
| Local work branch exists but is unpushed | The claim is invisible to everyone else. Push it before working |
| Task status differs between your ref and the default branch | Trust the default branch; status on an unmerged branch is a proposal |

Push the claim commit immediately. A claim that only exists locally protects nobody.

### Branch naming

One task → `<task-id-lowercase>-<slug>`. A ship run → `ship/<date>-<slug>`. A batch → `run/<date>-<scope>`.

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
- `release` on a task held by someone else requires `--force`, the same protection `claim` has. Pass `--by <name>` so the check can fire.
- `new-task` allocates the next id from the **local** tree. Two developers creating a task from the same base get the same id; pull before pushing, and `validate` catches the duplicate if you don't.
- Claims are **advisory**: the script warns (never blocks) when claiming a task with unmet dependencies — the dev is trusted to know why.
- Cross-cutting files (API contracts, shared schemas) get changed in their own small PR reviewed by the other dev *before* dependent implementation. Everything else merges on green `validate` + project tests.
- Registers (DECISIONS/ASSUMPTIONS) are append-only; merge conflicts resolve by keeping both entries.

## Feature pipeline (/tri:ship)

Takes an area from unclear to built in one command: scope → interview → finalize specifications → **one gate** → implement. Stages 1-3 are interactive because specification needs the user; stage 4 hands off to the `/tri:run` loop and runs unattended.

The gate between specification and implementation is not optional. Specifications land as their own commit, reviewable before any code exists — a wrong spec answer caught there costs seconds, and caught after a batch run costs the whole batch. Everything before the gate asks; nothing after it does.

## Batch runs (/tri:run)

Autonomous multi-task execution. Scope and mode are chosen interactively at start; the loop then runs without human checkpoints — the gates are the brakes. State lives in `.tri/run.json` (local scratch, survives restarts) and is written **only** through the script: `run-state --start "<scope>" --mode <m> --queue <IDs>`, then `--done <ID>` / `--blocked <ID>` after each task, then `--finish`. Bare `run-state` prints what remains, which is how a killed session resumes. Never hand-edit the file. In `branch-pr` workflow a sequential run uses ONE run branch (`run/<date>-<scope>`, first commit claims the queue, pushed immediately) with one atomic commit per task and one PR per phase boundary — tasks stack, so intra-run dependency chains work; per-task branches from the default branch would silently drop the previous task's unmerged code. Parallel subagent runs keep per-task branches/PRs. Contract/shared-file tasks are extracted to their own PR for review while the run continues. Open PRs go in the final report; the frontier is read from the default branch only.

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

Writing the registers is a **capability every command has**, not a step the user invokes. Whenever a decision is resolved or blocked during any command — planning, clarifying, shipping, running, implementing — record it there and then, in the same change as the work it affects.

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

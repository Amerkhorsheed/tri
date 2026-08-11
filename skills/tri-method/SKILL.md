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

TRI v3 requires Git after `init`. The engine metadata (`tri.mjs meta`) is authoritative for which commands mutate state and which preflight they require. Prompt commands may orchestrate Git, but engine commands refuse detached/conflicted state, unsafe branch starts, malformed configuration, and dirty tracked state when beginning new work. `status`, `graph`, `next`, and `meta` are read-only; visualization writes only ignored `.tri/` scratch state.

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

### Tier 2 — commands that create identity-bearing records

Tasks, ADRs, decisions, blockers, and assumptions are created through engine commands. TRI-native v3 workspaces use decentralized random IDs, so concurrent branches do not coordinate on a global counter. Legacy numeric IDs remain readable; adapted workspaces may explicitly retain `idStrategy: "sequential"`, in which case remote sync remains mandatory and fails closed.

### Tier 3 — commands that claim work

`next`, `ship`, `run`.

```
git ls-remote --heads origin
```

| Condition | Action |
|---|---|
| Exact `refs/heads/tri/claims/<ID>` exists | It is already claimed. **Stop** unless explicitly released |
| Claim ref is absent | Atomically push it before `claim`; check-then-push is not a lock |
| Local work branch exists but is unpushed | The work is invisible. Push and verify before review |
| Task status differs between your ref and the default branch | Trust the default branch; status on an unmerged branch is a proposal |

- Push the claim commit immediately. A claim that only exists locally protects nobody. After every claim or task commit, verify the remote branch/ref equals the local commit; a failed push stops the workflow. After evidence completion, ask before opening a PR against the configured development base and ask separately before merging; never assume or merge silently.

### Branch naming

One task → `<task-id-lowercase>-<slug>`. A ship run → `ship/<date>-<slug>`. A batch → `run/<date>-<scope>`.

## The loop

1. `tri.mjs next` — ready tasks (dependencies Done, unclaimed).
2. Create a unique `claim-token <ID> --by <name>`, atomically push its token to its exact ref with an empty force-with-lease expectation, then `claim <ID> --by <name>`; the token ref is the distributed lock.
3. Read the task file fully, plus its linked ADRs and context docs, before editing.
4. Implement exactly that task. New work discovered → `tri.mjs new-task`, never scope-fold.
5. Record assumptions in `tri/ASSUMPTIONS.md`; unresolved choices in `tri/DECISIONS.md` as blocking entries. **Never choose silently.**
6. Run checks through `tri.mjs evidence <ID> --name <check> -- <command>` and summarize observed results in the task Evidence section. Raw output is not persisted; TRI stores status, byte count, hash, runtime, and engine version.
7. `tri.mjs validate` must pass, then `tri.mjs done <ID>`, commit, push, and verify. Standard requires successful structured evidence; strict also enforces required check names and the declared environment. Legacy prose remains readable but does not satisfy v3 gates.

## Parallel work (dynamic claiming)

Claiming is pull-based and dynamic: claim when you start, claim more when you finish, any dev any day. No pre-assigned ranges. Rules that keep it consistent:

- A claim is real only when its exact remote ref contains a `claim-token` whose parent is the worker base. Create active claims with one atomic push and one empty `--force-with-lease=<ref>:` per token/ref; delete refs before release or after integration.
- `release` on a task held by someone else requires `--force`, the same protection `claim` has. Pass `--by <name>` so the check can fire.
- Random v3 IDs require no remote allocation scan. Legacy sequential adapters keep `sync` and remote collision validation until migrated.
- Generated tasks start with `Specification status: Unrevised` and a TODO Objective. `next` flags them, `claim` warns, and batch runs warn unless explicitly passed `--allow-unrevised`; old tasks without the field default to `Specified`. `/tri:clarify` promotes a task to `Specified`, and only when the run actually edited its Objective and Acceptance criteria — the promotion is a claim the spec is written, never a ceremony. `Withdrawn` tasks remain recorded but never enter the frontier; dependencies on them produce warnings and do not block `done` or the frontier.
- Cross-cutting files (API contracts, shared schemas) get changed in their own small PR reviewed by the other dev *before* dependent implementation. Everything else merges on green `validate` + project tests.
- Registers (DECISIONS/ASSUMPTIONS) are append-only; merge conflicts resolve by keeping both entries.

## Feature pipeline (/tri:ship)

Takes an area from unclear to built in one command: scope → interview → finalize specifications → **one gate** → implement. Stages 1-3 are interactive because specification needs the user; stage 4 hands off to the `/tri:run` loop and runs unattended.

The gate between specification and implementation is not optional. Specifications land as their own commit, reviewable before any code exists — a wrong spec answer caught there costs seconds, and caught after a batch run costs the whole batch. Everything before the gate asks; nothing after it does.

## Batch runs (/tri:run)

Autonomous multi-task execution uses a host-neutral scheduler in `.tri/run.json`. Probe with `tri-host.mjs`, then start with `--mode auto` plus the probe's `runStateArgs`; TRI computes maximal **declared-safe** concurrency from dependencies and exact `Expected files`, records adapter/backend/requested/actual mode, and leases work dynamically with `run-state --lease <worker>`. Unknown hosts, Antigravity, and Gemini without explicitly enabled agents fail safe to sequential. Missing or overlapping scopes serialize. The default capacity is four.

- **Sequential** — one lease at a time when the adapter cannot prove a parallel worker interface or no safe parallel frontier exists.
- **Claude Code** — bundled `tri-worker` Agent calls; native teams only when explicitly available.
- **Codex** — native stable multi-agent `spawn_agent` calls with the installed `tri_worker` profile.
- **Pi** — the packaged `tri_workers` extension tool spawns cancellable child Pi processes concurrently in supplied worktrees.
- **Gemini CLI** — bundled experimental `tri-worker` subagent; enable agents explicitly and remember that child tools run in YOLO mode.

Every parallel worker receives one disposable Git worktree and exact paths. The orchestrator launches a leased batch together, keeps slots full, and alone owns leasing and integration. It verifies ancestry, `verify-scope`, structured Evidence, project checks, and `validate` before cherry-picking each atomic commit. Contract/shared-interface work remains a separate review PR. A backend fallback is always reported as the actual mode, never silently called parallel. `run-state --start` refuses Unrevised queues without explicit override.

## Branches and PRs

`tri.config.json` sets `"workflow"`: `"trunk"` (default) or `"branch-pr"`. TRI runs read-only Git inspection for remote reservations and default-branch checks; branch/PR discipline remains in this command/skill layer.

**trunk:** work on the shared branch; the pushed claim commit is the lock.

**branch-pr:** one branch per task, named `<task-id-lowercase>-<slug>` (e.g. `task-0261-endpoint-enforcement`). Rules that keep claims and status truthful:

- Before claiming, atomically create the exact remote `refs/heads/tri/claims/<ID>` ref. Branch names are not ownership evidence.
- The claim commit is the branch's first commit; push the branch immediately, verify the remote ref, and stop on push failure — the pushed branch is the visible lock.
- `done` flips status inside the same branch; the PR merge lands the flip. **The frontier is only ever read from the default branch** — status on an unmerged branch is a proposal, not truth.
- One task per branch per PR, no batching. Ask before opening or merging a PR into the configured development base; merge only on green `validate` + project tests, and changes touching contract/shared files wait for the other dev's review per the parallel-work rules.

## Decisions and ADRs

Writing the registers is a **capability every command has**, not a step the user invokes. Whenever a decision is resolved or blocked during any command — planning, clarifying, shipping, running, implementing — record it there and then, in the same change as the work it affects.

- Choice you're not authorized to make → `B-` entry in DECISIONS.md, task goes Blocked. Owner resolves with a `D-` entry.
- Architectural decision (new dependency, service, boundary, changed contract) → ADR in `tri/adr/` from the template, **before** implementing.
- Entries are never rewritten; supersede with a new entry that references the old ID.

## Profiles

| Profile | Task template | Done gate |
|---|---|---|
| lite | ~8 fields | validate and dependency state pass |
| standard (default) | ~18 fields | + successful structured evidence and Evidence summary |
| strict | ~28 fields | + every required check and expected environment match |

Set at `tri.mjs init --profile <p>`; recorded in `tri.config.json`.

## Red flags — stop and correct

- Implementing without a claim, or claiming without committing the claim.
- Editing another dev's In Progress task file.
- Marking done with an empty Evidence section ("tests pass" is a claim; paste the command and result).
- Resolving an owner-level choice inline "to keep moving" — that's a B- entry, not your call.
- Weakening `validate` or a test to get to Done.
- Bundling a second task's work "while I'm here".

# tri

Delivery method plugin: **T**ask register + **R**egisters (decisions, assumptions, ADRs) + **I**ncrement evidence. Extracted from a production architecture workspace; in the family of GSD and spec-kit, with two differences: an append-only decision/assumption register ("never choose silently") and an evidence-gated definition of done.

State is plain markdown under `tri/` in your project, merged through git. No server, no daemon. One zero-dependency Node script does all mechanics.

## Install

**Standard setup (every developer, once):**

```bash
git clone git@github.com:Amerkhorsheed/tri.git ~/.tri
```

Claude Code — register the marketplace and install:

```bash
claude plugin marketplace add Amerkhorsheed/tri
claude plugin install tri@tri
```

(or ad hoc: `claude --plugin-dir ~/.tri`)

The `~/.tri` clone is the shared convention: project docs and AGENTS.md sections reference `node ~/.tri/scripts/tri.mjs`, so every developer and CI job resolves the same path. Update with `git -C ~/.tri pull`.

Codex / any other agent: works through the project's `AGENTS.md` — `/tri:init` appends a "TRI Method" section that instructs any agent to follow the same loop and run the same script from `~/.tri`. No Claude-specific machinery required.

**Per project:** new project → `/tri:init [profile]`. Existing task tree → write a `tri.config.json` adapter (see "Adopting an existing task tree") and add the AGENTS.md section by hand or via init.

## How it works, visually

![The single-task loop](docs/tri-loop.svg)

![Parallel work and dynamic claims](docs/tri-team.svg)

Full walkthrough with commands, batch runs, and profiles: [docs/guide.html](docs/guide.html) (self-contained — open in any browser).

## Commands

| Command | Does |
|---|---|
| `/tri:go [focus]` | **Start here.** Say what you want to work on; reads state, picks the right command below, runs it |
| `/tri:ship <area>` | Whole pipeline: scope → interview → write specs → one go-ahead → implement unattended |
| `/tri:init [profile]` | Scaffold `tri/` workspace + `tri.config.json` + AGENTS.md section. Profiles: `lite`, `standard` (default), `strict` |
| `/tri:plan <spec>` | Decompose a spec into tasks with real (not ceremonial) dependency edges |
| `/tri:next [T-NNNN]` | Show ready tasks; claim and start one |
| `/tri:done <T-NNNN>` | Evidence-gated completion |
| `/tri:status` | Counts, claims, ready frontier, critical path |
| `/tri:decide <text>` | Append a D- (resolved) or B- (blocking) entry to the decision register |
| `/tri:adr <text>` | Write an ADR from the template |
| `/tri:run [scope]` | Autonomous batch execution — asks scope (phase/N/until-blocked) and mode (sequential/parallel subagents) once, then runs task after task through the gates without checkpoints; resumable via `.tri/run.json` |
| `/tri:grill <target>` | Stress-test a task/phase/plan — one question at a time, answers captured into registers and task files |
| `/tri:clarify [target]` | Discuss upcoming work, refine ambiguous requirements, write clarifications back into task files |
| `/tri:visualize [target]` | Interactive HTML board (phase lanes, dependencies, critical path) written to gitignored `.tri/`, opened for discussion |

Direct script use (what agents and CI run):

```bash
node scripts/tri.mjs <init|new-task|validate|next|claim|release|done|status|graph|visualize|run-state>
```

## Branch and PR workflows

`"workflow": "trunk"` (default) or `"branch-pr"` in `tri.config.json`. Trunk: pushed claim commit = the lock. Branch-pr: one branch per task (`task-0261-endpoint-enforcement`), the pushed branch is the lock (checked before claiming), `done` flips status inside the branch and becomes truth when the PR merges, and the frontier is only read from the default branch. The script itself never runs git — an autonomous bookkeeping tool that silently pushes is a failure mode, so branch/PR mechanics stay in the command/skill layer where they're visible.

## Batch execution vs the gates

Like GSD's execute-phase or spec-kit's implement, `/tri:run` chews through many tasks in one go. In branch-pr workflow a sequential run uses one run branch with an atomic commit per task and one PR per phase boundary (per-task PRs would break intra-run dependency chains — the next task needs the previous one's unmerged code); parallel subagent runs keep per-task PRs; contract-touching tasks get extracted to their own PR for review. The loop's safety is mechanical, not vigilance-based: a task can't pass `done` with empty Evidence, `validate` failure halts the run, and a missing owner decision becomes a Blocked task plus register entry while the run continues elsewhere. Speed comes from never pausing between good tasks; safety from being unable to coast past a bad one.

## Parallel developers

Claiming is **dynamic and pull-based** — no pre-assigned ranges. Claim when you start, claim more when you finish; a fast day means more claims, and adding tasks mid-flight is normal (`new-task`). Consistency comes from git: a claim is a commit; simultaneous claims resolve at push (first wins, second picks the next ready task). Dependency warnings on claims are advisory — the tool never blocks a split you chose deliberately.

## Before work starts

Every work command runs a preflight first: stop on a dirty worktree, and in `branch-pr` workflow cut the work branch from the default branch before the first commit. This is what keeps two features from landing in one branch, and keeps specifications and code off `main`.

## Batch state and recovery

`run-state` is the mechanical record of a batch: `--start` with a scope, mode and queue; `--done`/`--blocked` after each task; `--finish` at the end. Bare `run-state` prints what remains, so a session killed mid-batch resumes exactly where it stopped rather than relying on the agent having remembered. The file lives in gitignored `.tri/` and is never hand-edited.

## Profiles

| | lite | standard | strict |
|---|---|---|---|
| Task fields | ~8 | ~18 | ~28 |
| Done gate | `validate` passes | + Evidence section filled | + evidence record file in `tri/evidence/` |

## Adopting an existing task tree

tri reads foreign task formats through config instead of rewriting files. Example — a repo with `tasks/phase-*/TASK-NNNN.md`, five statuses, and evidence records elsewhere:

```json
{
  "profile": "strict",
  "taskDir": "tasks",
  "idPrefix": "TASK-",
  "idWidth": 4,
  "statuses": ["Planned", "Ready", "Blocked", "In Progress", "Done"],
  "evidenceDir": "docs/testing/evidence",
  "taskTemplate": "tasks/TASK_TEMPLATE.md",
  "companionFiles": ["tasks/README.md", "tasks/validate-tasks.mjs"]
}
```

`taskTemplate` makes `new-task` write the project's own template rather than tri's — the project's fields are what its validators enforce. `companionFiles` are files tri deliberately does not edit (task indexes, pinned inventory counts) but names on every creation so they move in the same change.

Drop that in as `tri.config.json` and every command works against the existing tree byte-for-byte unchanged (claims add an `## Assignee` section on first claim; nothing else is rewritten). Verified against a production workspace of 338 governed task files: `validate` clean, frontier and critical-path output matching an independent analysis.

## Tests and consistency

```bash
node scripts/test-tri.mjs && node scripts/check-consistency.mjs
```

The consistency check fails when a change reaches one artifact but not its companions — an undocumented command or config key, a version without a changelog entry, a stale test count, a broken link. See [CONTRIBUTING.md](CONTRIBUTING.md) for what must move together.

38 behavioral tests covering init, ID allocation, validation defects (missing deps, bad status, duplicate IDs, cycles), frontier computation, claim/release/force, evidence gates per profile, and graph metrics.

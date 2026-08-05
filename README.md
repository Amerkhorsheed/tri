# tri

Delivery method plugin: **T**ask register + **R**egisters (decisions, assumptions, ADRs) + **I**ncrement evidence. Extracted from a production architecture workspace; in the family of GSD and spec-kit, with two differences: an append-only decision/assumption register ("never choose silently") and an evidence-gated definition of done.

State is plain markdown under `tri/` in your project, merged through git. No server, no daemon. One zero-dependency Node script does all mechanics.

## Install

Claude Code (as a plugin):

```bash
claude --plugin-dir /path/to/tri
```

or add the repo to your plugin marketplace and install `tri`.

Codex / any other agent: works through the project's `AGENTS.md` — `/tri:init` appends a "TRI Method" section that instructs any agent to follow the same loop and run the same script. No Claude-specific machinery required.

## Commands

| Command | Does |
|---|---|
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
node scripts/tri.mjs <init|new-task|validate|next|claim|release|done|status|graph|visualize>
```

## Batch execution vs the gates

Like GSD's execute-phase or spec-kit's implement, `/tri:run` chews through many tasks in one go — but the loop's safety is mechanical, not vigilance-based: a task can't pass `done` with empty Evidence, `validate` failure halts the run, and a missing owner decision becomes a Blocked task plus register entry while the run continues elsewhere. Speed comes from never pausing between good tasks; safety from being unable to coast past a bad one.

## Parallel developers

Claiming is **dynamic and pull-based** — no pre-assigned ranges. Claim when you start, claim more when you finish; a fast day means more claims, and adding tasks mid-flight is normal (`new-task`). Consistency comes from git: a claim is a commit; simultaneous claims resolve at push (first wins, second picks the next ready task). Dependency warnings on claims are advisory — the tool never blocks a split you chose deliberately.

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
  "evidenceDir": "docs/testing/evidence"
}
```

Drop that in as `tri.config.json` and every command works against the existing tree byte-for-byte unchanged (claims add an `## Assignee` section on first claim; nothing else is rewritten). Verified against a production workspace of 338 governed task files: `validate` clean, frontier and critical-path output matching an independent analysis.

## Tests

```bash
node scripts/test-tri.mjs
```

29 behavioral tests covering init, ID allocation, validation defects (missing deps, bad status, duplicate IDs, cycles), frontier computation, claim/release/force, evidence gates per profile, and graph metrics.

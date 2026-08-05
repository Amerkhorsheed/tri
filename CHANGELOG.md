# Changelog

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

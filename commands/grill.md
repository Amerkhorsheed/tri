---
description: Relentlessly stress-test a task, phase, or plan before implementation — one question at a time, decisions captured into the registers
argument-hint: "<T-NNNN | phase NN | a plan/idea to interrogate>"
---
**Preflight first — tier 1 and 2 in the tri-method skill.** This command writes register entries, so run the checks before changing anything: a dirty worktree, a rebase in progress, or the default branch under `branch-pr` all stop the work, and a stale ref means the identifier you allocate may already be taken.

Load the tri-method skill first. Read the target named in $ARGUMENTS (task file, every task in the phase, or the stated plan) plus its linked ADRs and context docs. Then interrogate the user about it: **one question per turn via AskUserQuestion**, hardest assumptions first, your recommended option first and marked, each option carrying its real consequence. One at a time is deliberate here — each answer shapes the next question. Look up facts yourself (files, script output, git) — only put *decisions* to the user. Walk dependencies between decisions in order; a later question should build on the earlier answer.

Capture outcomes as you go, not at the end: a resolved choice → D- entry via the decision register; an open question the user can't answer → B- entry and the affected task goes Blocked; a clarified requirement → edit the task's Objective/scope/Acceptance criteria directly; a new consequential assumption → ASSUMPTIONS entry. Finish with `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs validate` and a short summary of what changed and what remains open.

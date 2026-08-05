---
description: Evidence-gated completion of the current TRI task
argument-hint: "<T-NNNN>"
---
**Preflight first — tier 1 in the tri-method skill.** This command writes a commit and a PR, so run the checks before changing anything: a dirty worktree, a rebase in progress, or the default branch under `branch-pr` all stop the work.

Load the tri-method skill first. Before running anything: verify the task's acceptance criteria are actually met, run the project's tests, and fill the task's Evidence section with the exact commands and observed results (strict profile: also write tri/evidence/<ID>-<date>.md). Then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs validate` and `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs done $1`. If either fails, fix the cause — never weaken a gate. Commit with the task ID in the message. In branch-pr workflow, open the PR (gh pr create) titled with the task ID; merge on green when it touches no contract/shared files, otherwise request the other dev's review — the status flip becomes truth only when the PR merges.

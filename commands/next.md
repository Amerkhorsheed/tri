---
description: Show ready TRI tasks, or claim and start one
argument-hint: "[T-NNNN] [--by name]"
---
Load the tri-method skill first and run its **tier 1, 2 and 3 preflight** before anything else — dirty worktree, mid-rebase, detached HEAD, default branch under `branch-pr`, a stale ref, and a remote branch that already claims this task each stop or redirect the work. Then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs next`. If $ARGUMENTS names a task, claim it respecting the configured workflow (tri.config.json "workflow"): in branch-pr mode first check remote branches for the task ID (an existing branch is a claim), create the task branch from the default branch, then `claim <ID> --by <name>` (default: git user.name), commit, and push the branch immediately; in trunk mode commit and push the claim on the shared branch. Then read the task file completely plus its linked ADRs/context before implementing. If no task named, present the ready list and ask which to start.

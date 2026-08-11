---
description: Initialize a TRI workspace in the current project (task register, decision/assumption registers, ADR dir, DoD, AGENTS.md section)
argument-hint: "[lite|standard|strict]"
---
**Preflight first — tier 1 in the tri-method skill.** This command writes config, directories, and AGENTS.md, so run the checks before changing anything: a dirty worktree, a rebase in progress, or the default branch under `branch-pr` all stop the work.

Load the tri-method skill first. Then run `node ~/.tri/scripts/tri.mjs init --profile ${1:-standard}` from the project root. New workspaces use decentralized random IDs and automatically ignore `.tri/` scratch state. Use `--id-strategy sequential` only for an existing foreign validator that requires numeric IDs. Show what was created and explain the profile's evidence gate. Do not re-run on an initialized project without asking.

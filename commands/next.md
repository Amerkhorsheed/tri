---
description: Show ready TRI tasks, or claim and start one
argument-hint: "[T-NNNN] [--by name]"
---
Load the tri-method skill first. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs next`. If $ARGUMENTS names a task, claim it with `claim <ID> --by <name>` (default name: the git user.name), commit the claim, then read the task file completely plus its linked ADRs/context before implementing. If no task named, present the ready list and ask which to start.

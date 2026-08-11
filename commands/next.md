---
description: Show ready TRI tasks, or claim and start one
argument-hint: "[T-NNNN] [--by name]"
---
Load the tri-method skill and run tier 1–3 preflight, then `tri.mjs next`. Generated Unrevised tasks must be clarified before implementation. For a named task under branch-pr: create the work branch, create `claim-token <ID> --by <name>`, atomically push its unique token to its returned ref with an empty `--force-with-lease=<ref>:`, verify it, then run `claim <ID> --by <name>`; branch names alone are not claims. In trunk, the shared-branch push remains the serialization point. Read the full task and linked context before implementation. Run structured evidence and completion gates, push, then ask before opening or merging a PR. With no task named, present the frontier and ask which to start.

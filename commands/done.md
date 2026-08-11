---
description: Evidence-gated completion of the current TRI task
argument-hint: "<T-NNNN>"
---
**Preflight first — tier 1 in the tri-method skill.** This command writes a commit and a PR, so run the checks before changing anything: a dirty worktree, a rebase in progress, or the default branch under `branch-pr` all stop the work.

Load the tri-method skill first. Verify acceptance criteria, run every required check through `tri.mjs evidence <ID> --name <check> -- <command>`, and summarize observed results in the task Evidence section. Then run `validate` and `done`. Standard requires successful structured evidence; strict also requires every configured check and expected environment. Fix failures—never weaken a gate. Commit with the task ID, push, and verify. In branch-pr workflow ask separately before opening or merging a PR; contract/shared changes require another reviewer.

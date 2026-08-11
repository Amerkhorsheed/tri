---
description: Drive ordered charter-to-task re-baselining
argument-hint: "[--approve|--complete|--reset]"
---
Load the tri-method skill first and run the tier 1 preflight. Run `node ~/.tri/scripts/tri.mjs rebaseline` to inspect the current layer. Layers must complete in order: charter; ADRs/registers; policies/contracts; agent-facing rules, skills, contributor docs, checklists, and runbooks; tasks. Record approval with `--approve`, then complete only after that layer's reviewable commit lands on the configured default branch with `--complete`. TRI refuses completion without approval and never permits downstream task work before upstream layers complete. Use `--reset` only to discard the local state machine record after confirming no review is in progress.

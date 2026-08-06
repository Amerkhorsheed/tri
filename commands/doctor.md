---
description: Diagnose governing-document and remote identifier drift
argument-hint: ""
---
Load the tri-method skill first and run the tier 1 preflight. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs doctor`. Doctor reports warnings, not hard failures, for ADR references absent from the configured default branch and remote identifier collisions. Keep both colliding entries; resolve by renumbering incoming entries to the next free identifier when resolving, never by publishing fixed target numbers.

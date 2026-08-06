---
description: Capture structured execution evidence for a TRI task
argument-hint: "<T-NNNN> -- command [args...]"
---
Load the tri-method skill first and run the tier 1 preflight. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs evidence $ARGUMENTS`. TRI executes the command in the workspace and writes an evidence record containing command output, exit status, commit, branch, timestamp, hostname/container marker, Node version, platform, and configured runtime probes. Existing task Evidence text remains valid; this command adds reproducible context. Inspect expected-environment warnings during `done`.

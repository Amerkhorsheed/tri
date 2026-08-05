---
description: Visualize the task graph, a phase, or upcoming work for discussion
argument-hint: "[phase NN | T-NNNN... | 'frontier' | 'critical-path'] "
---
Load the tri-method skill first. Gather data with `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs status` and `graph`, plus the task files in scope ($ARGUMENTS; default: ready frontier + the next wave behind it). Render an in-conversation visualization the user can discuss against — dependency graph with status/assignee coloring, phase swimlanes, or critical-path highlight, whichever fits the question. Use the richest in-chat medium available (visualization widget, artifact, or mermaid in chat).

Hard rule: render in conversation only — never write diagram files or diagram syntax into the repository (some governed repos explicitly prohibit them). After showing it, ask what the user wants to change; loop edits through the same flow as /tri:clarify.

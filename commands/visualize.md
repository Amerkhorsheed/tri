---
description: Visualize the task graph, a phase, or upcoming work for discussion
argument-hint: "[phase NN | T-NNNN... | 'frontier' | 'critical-path'] "
---
Load the tri-method skill first. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs visualize` — it writes a self-contained interactive HTML board (phase lanes, status colors, ready/critical-path highlighting, dependency panel, filter) to `.tri/graph.html`. Open it for the user (browser preview, or send the file rendered). Ensure `.tri/` is gitignored; if the project's .gitignore lacks it, add the entry.

If $ARGUMENTS asks for a view the board doesn't cover (a single component, an idea, a flow), build a one-off in-chat visualization instead (widget/artifact/mermaid in conversation). Hard rule either way: visualization outputs stay out of version control — never commit diagram files or diagram syntax into governed repos. After showing it, ask what the user wants to change; loop edits through the same flow as /tri:clarify.

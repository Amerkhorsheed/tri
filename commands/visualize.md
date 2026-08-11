---
description: Visualize the task graph, a phase, or upcoming work for discussion
argument-hint: "[phase NN | T-NNNN... | 'frontier' | 'critical-path'] "
---
Load the tri-method skill first. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs visualize` — it writes one self-contained HTML file with switchable phase-board and native dependency-graph views, ready/critical-path highlighting, active workers, filters, and dependency details to `.tri/graph.html`. `init` ignores `.tri/`; adopted projects should add that ignore once. Open the file for discussion.

If $ARGUMENTS asks for a view the board doesn't cover (a single component, an idea, a flow), build a one-off in-chat visualization instead (widget/artifact/mermaid in conversation). Hard rule either way: visualization outputs stay out of version control — never commit diagram files or diagram syntax into governed repos. After showing it, ask what the user wants to change; loop edits through the same flow as /tri:clarify.

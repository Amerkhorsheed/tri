---
description: Break a spec or feature request into TRI tasks with dependencies and phases
argument-hint: "<spec, feature description, or path to a doc>"
---
Load the tri-method skill first. Read the spec/description given in $ARGUMENTS (read the file if it is a path). Decompose into independently verifiable tasks — one bounded increment each, no bundling. For each: pick phase, priority, dependencies (only real technical prerequisites — do not add ceremonial edges; unnecessary dependency edges are what serialize parallel work). Create them with `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs new-task --title "..." --phase NN [--dep T-NNNN]...`, then open each created file and fill Objective, In/Out of scope, Acceptance criteria, and Required tests properly. Finish with `validate` and `graph`, and show the user the wave structure so they can see the parallelism available.

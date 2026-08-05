---
description: Initialize a TRI workspace in the current project (task register, decision/assumption registers, ADR dir, DoD, AGENTS.md section)
argument-hint: "[lite|standard|strict]"
---
Load the tri-method skill first. Then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs init --profile ${1:-standard}` from the project root. Show the user what was created and explain the chosen profile's done gate. If AGENTS.md already existed, show the appended TRI Method section. Do not re-run on an initialized project without asking.

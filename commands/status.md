---
description: TRI workspace status — counts, claims, ready frontier, critical path
---
Load the tri-method skill first. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs status` and `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs graph`, then summarize for the user: who holds what, what is ready, where the critical path runs, and whether any claims carry warnings (run `validate` if claims look stale).

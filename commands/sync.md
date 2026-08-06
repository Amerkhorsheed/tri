---
description: Fetch remote branches and scan identifier reservations
argument-hint: ""
---
Load the tri-method skill first. Run **tier 1 and tier 2 preflight** before allocating identifiers: stop on dirty/rebase/detached state, then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs sync` before allocating tasks or register identifiers. TRI fetches the configured remote with prune, compares every remote branch against the configured default branch, and reports task, ADR, and D-/B-/A- identifiers introduced outside the default branch. Never publish predetermined renumbering targets; resolve collisions by keeping both entries and assigning the incoming entry the next free identifier at resolution time.

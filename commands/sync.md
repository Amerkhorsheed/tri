---
description: Fetch remote state, active claim refs, and legacy sequential reservations
argument-hint: ""
---
Load the tri-method skill and run tier 1 preflight. Run `node ~/.tri/scripts/tri.mjs sync`.

Random-ID v3 workspaces report exact active `refs/heads/tri/claims/*` refs; no identifier reservation scan is needed. Explicit `idStrategy: "sequential"` adapters retain the legacy all-branch reservation/collision scan and fail closed when the authoritative remote cannot be read.

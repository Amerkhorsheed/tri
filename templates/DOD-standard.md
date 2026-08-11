# Definition Of Done

A task is done only when all applicable conditions are evidenced:

- Scope and acceptance criteria are satisfied without unrelated changes.
- Applicable ADRs and recorded decisions were followed; conflicts were recorded, not silently resolved.
- Tests required by the task pass, including failure paths.
- Every required check has a successful structured `tri evidence` record; the Evidence section summarizes observed results.
- `node <tri>/scripts/tri.mjs validate` passes.

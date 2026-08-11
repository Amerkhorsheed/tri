# Definition Of Done

A task is done only when all applicable conditions are evidenced:

- Scope and acceptance criteria are satisfied without unrelated changes.
- Applicable ADRs, policies, and recorded decisions were followed; conflicts were recorded, not silently resolved.
- Authorization is deny-by-default with actor, object, and state tests where the task touches protected behavior.
- Database changes include integration tests against the production engine and migration safety analysis.
- API changes update and validate the versioned contract.
- Unit, integration, contract, and failure-path tests required by the task pass.
- Performance claims include benchmark context and actual results; no unsupported claim.
- Every configured required check has a successful structured record in the declared environment; the Evidence section records residual risks and rollback.
- `node <tri>/scripts/tri.mjs validate` passes.

---
description: Write an ADR in tri/adr/ from the template
argument-hint: "<the architectural decision to record>"
---
**Preflight first — tier 1 and 2 in the tri-method skill.** This command writes an ADR number, so run the checks before changing anything: a dirty worktree, a rebase in progress, or the default branch under `branch-pr` all stop the work, and a stale ref means the identifier you allocate may already be taken.

Load the tri-method skill first. Copy tri/adr/ADR-template.md to the next ADR-NNNN-<slug>.md. Fill Context (forces, constraints), Decision (enforceable rules, not aspirations), Alternatives (what was rejected and why), Consequences (including what must now be maintained), and Reconsideration (the measured evidence that would reopen it). Status starts Proposed unless the user says it is already accepted. An ADR describing unresolved work grants no approval — say so if the user treats it otherwise.

Then **continue**: an Accepted ADR usually unblocks or invalidates task specifications. Re-specify the tasks it affects, record the `D-` entry that accompanies it, update any task left Blocked on it, and say what changed. If the ADR stays Proposed, say plainly which tasks remain blocked and stop there.

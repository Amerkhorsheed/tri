---
description: Create and complete an ADR with a decentralized TRI identifier
argument-hint: "<the architectural decision to record>"
---
Load the tri-method skill and run tier 1 preflight. Create the file through the engine:

```bash
node ~/.tri/scripts/tri.mjs new-adr --title "<title>"
```

Fill Context, Decision, Alternatives, Consequences, and Reconsideration. Keep Status `Proposed` unless the owner already accepted it. Record the accompanying direction through `tri.mjs register --kind decision`; never allocate an ADR or D- identifier manually.

Then re-specify affected tasks. Accepted ADRs may unblock them; Proposed ADRs do not. Continue only where the decision genuinely permits work.

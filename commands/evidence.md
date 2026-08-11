---
description: Capture structured execution evidence for a TRI task
argument-hint: "<ID> --name <check> -- command [args...]"
---
Load the tri-method skill first and run tier 1 preflight. Run `node ~/.tri/scripts/tri.mjs evidence <ID> --name <check> -- <command>`. TRI records the redacted command, check name, exit status, output byte count/hash, commit, branch, timestamp, TRI/Node versions, platform, and configured probes. Raw output and hostname are not persisted. Standard completion requires a successful structured record; strict also requires every configured check name and expected environment.

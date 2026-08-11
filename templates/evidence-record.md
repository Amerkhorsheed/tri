# Evidence: {{ID}}

## Summary

Commands run and observed behavior.

## Residual risks

Known limits after verification.

## Rollback

Tested reversal or containment.

Use `node ~/.tri/scripts/tri.mjs evidence <ID> --name <check> -- <command>` to append structured JSON containing check name, capture time, commit, branch, TRI/Node/platform versions, configured probes, exit status, output byte count/hash, and duration. Raw output and hostname are not persisted. Legacy prose remains readable but does not satisfy v3 standard/strict completion gates.

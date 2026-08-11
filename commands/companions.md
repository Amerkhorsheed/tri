---
description: Check configured companion files and maintenance hooks
argument-hint: "[--check]"
---
Load the tri-method skill first and run the tier 1 preflight. Run `node ~/.tri/scripts/tri.mjs companions --check` to verify every configured companion path exists and invoke its check hook. `companionFiles` remains legacy check-only configuration. `companions` may add per-file strategies, and `companionHooks` may run argv-array hooks after `new-task`, `validate`, `done`, or companion checks. Hooks receive the event name and a JSON details argument; failures stop the command.

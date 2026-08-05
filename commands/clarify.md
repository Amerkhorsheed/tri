---
description: Discuss and refine requirements of upcoming work, then write the clarifications back into the task files
argument-hint: "[T-NNNN | phase NN] (default: the ready frontier)"
---
Load the tri-method skill first. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/tri.mjs next` and `status`; if $ARGUMENTS names a task or phase, focus there, otherwise present the ready frontier and upcoming phases so the user sees exactly what's next. Then surface what is ambiguous, underspecified, or contradictory — scope edges, acceptance criteria that aren't binary, missing dependencies, dependencies that look ceremonial. **Put each real decision to the user with AskUserQuestion** (recommended option first, marked; tradeoff in every description; batch up to four independent ones per call). Reserve prose for genuinely open-ended wording.

When the user answers, apply the edits to the task files (Objective, In/Out of scope, Acceptance criteria, Dependencies — use `new-task` for work that turns out to be separate, never scope-fold). Record decisions/assumptions in the registers as in the tri-method skill. Finish with `validate` and show a diff-style summary of every task changed.

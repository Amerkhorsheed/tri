## TRI Method

This project uses the TRI delivery method (task register + decision registers + evidence gates). Any agent working here — Claude Code, Codex, or other — follows this loop:

1. Run `node {{TRI_SCRIPTS}}/tri.mjs next` to see ready tasks; pick one (or the one you were told to do).
2. Run `node {{TRI_SCRIPTS}}/tri.mjs claim <ID> --by <name>` before starting. Claims are dynamic and pull-based: claim when you start, not in advance; claim more whenever you finish. Commit the claim immediately so others see it.
3. Read the task file completely, plus every linked ADR and context document, before editing.
4. Implement exactly that one task. No unrelated refactoring.
5. Record consequential assumptions in `tri/ASSUMPTIONS.md`. Record decisions you are not authorized to make in `tri/DECISIONS.md` as blocking entries — never choose silently.
6. Architectural decisions (new dependency, new service, new boundary, changed contract) require an ADR in `tri/adr/` before implementation.
7. Fill the task's Evidence section with commands run and observed results. Strict profile: also write `tri/evidence/<ID>-<date>.md`.
8. Run `node {{TRI_SCRIPTS}}/tri.mjs validate` — must pass.
9. Run `node {{TRI_SCRIPTS}}/tri.mjs done <ID>`, commit, push.

New work discovered mid-task: create it with `node {{TRI_SCRIPTS}}/tri.mjs new-task --title "..." --phase NN [--dep ID]`, don't fold it into the current task.

Batch mode: an agent may execute several tasks in one run. Loop step 1-9 per task without pausing between tasks; track progress in `.tri/run.json` ({scope, mode, queue, done, blocked}); a task needing an owner decision gets a B- entry and Blocked status while the run continues with other runnable tasks; halt only on a red gate after a real fix attempt or when nothing runnable remains. `next --json` and `status --json` provide machine-readable state.

Stop and report instead of proceeding when: a dependency is not actually met, an owner decision is missing, the task would require weakening a validation gate, or scope exceeds the task.

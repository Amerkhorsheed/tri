# Field report: eight failure classes a real TRI workspace produced

Source: the Compass workspace — an Arabic-first internal platform, 346 tasks across 22 phases, two developers plus several concurrent agent sessions. Audited and re-baselined 2026-08-05/06.

Everything here is a defect that workspace actually produced, with the measurement that found it. Nothing is speculative. Written to be pasted as an instruction to an agent working on TRI, or read directly.

## What made it a stress test

The re-baseline changed the product's founding premise — public consumer platform to internal-only, employees, no public surface — and had to propagate that through a charter, 7 ADRs, 4 policy documents, 12 agent rule files, a skills corpus, and 346 task bodies. Two branches and three agent sessions were live at once.

**The headline: four duplicate-identifier allocations happened, and all four were found by accident.** One by a developer noticing a merge oddity, three by an agent looking for something else. Zero were caught by `validate`.

---

## 1. Identifier allocation is not collision-safe

This is the top defect and the cheapest to fix.

`new-task` and the decision registers allocate the next id **from the local tree**. A sibling branch is invisible. The Tier 2 preflight says to fetch and check the default branch has not moved — necessary, and insufficient, because the collision comes from a branch that has not merged yet.

| # | Collision | How it surfaced |
|---|---|---|
| 1 | Two branches both allocated `TASK-0340` and `D-129` | A developer reconciling by hand; recorded as that branch's own `D-132` |
| 2 | Two branches both allocated `D-130`, `D-131`, `D-132` | An agent checking the ADR index for an unrelated item |
| 3 | A third session allocated `D-145` — reserved **one hour earlier** as a renumbering target | An agent inspecting that session's worktree on a hunch |
| 4 | Two branches both allocated `TASK-0343` | The merge itself, after both were pushed |

**Fix**

- `tri sync`, or fold it into the preflight: `git fetch`, then scan **all remote branches** for task ids and `D-`/`B-`/`A-` identifiers absent from the default branch. Report them as allocated. This one check catches all four cases above.
- `new-task` and every register write consults that set before allocating.
- `validate --remote` runs the cross-branch check in CI, so a collision fails a PR instead of surfacing at merge.

**Do not ship fixed renumbering targets as the resolution advice.** Compass reserved `D-145`–`D-147` for an incoming branch and a concurrent session consumed `D-145` within the hour. The rule that survives contact is **"renumber the incoming entry to the next free identifier, keep both sides"** — computed at resolution time, never named in advance.

## 2. Evidence does not record where it was produced

This is the one that let a false claim reach a green gate.

Compass pins its runtime in a container. An agent ran the validators and both suites **on the host**, got failures caused by version drift (PHP `8.5.9` against a pinned `8.5.8`, Node 22 against 24, no Python `jsonschema`), wrote them into an evidence file as **"environmental"**, and moved on. Re-run in the container, every one passed.

`tri done` accepted it. The Evidence section was non-empty, so the gate was green.

The owner caught it by reading the evidence and asking *"environment cascades lol? not behind docker and thus reproducible?"*

**Fix**

- Capture execution context automatically into the evidence record — hostname or container id, plus the versions of the runtimes the workspace declares. Not as policy, as a field, so a reader can see where a result came from.
- Let `tri.config.json` declare an expected environment; `done` **warns loudly** when evidence came from elsewhere.
- Ship the guard pattern as a documented recipe. Compass now refuses to run its validators or suites outside a declared environment, with **no override flag** — an override is how a control decays back into a convention. Two environments are declared there: the container, and CI (whose failures are real results on a declared matrix, not host noise).

## 3. `new-task` ignores the configured task template

`tri.config.json` declares `"taskTemplate": "tasks/TASK_TEMPLATE.md"`. `new-task` generated from TRI's own template instead. The result failed the project validator on four counts at once: wrong Phase label format, invalid Status line, zero Applicable Skills, one missing required field.

Every generated task needed manual repair before it could pass.

**Fix:** honour `taskTemplate` when set. If it cannot be parsed, say so and stop — never silently fall back.

## 4. Companion files are named but not maintained

`new-task` prints:

```
companion files tri cannot update for you — update them in the same change:
  tasks/README.md
  tasks/validate-tasks.mjs
```

Adding one task in Compass required four manual edits: a file-count pin, a per-phase count, a README index row, and a README status-summary line. **An agent got them wrong four times in a row**, discovering each only by re-running the validator.

TRI already knows these files exist. Knowing and not helping is the worst of both.

**Fix:** a `companions` config with a declared update strategy — at minimum `tri companions --check` naming the exact edit each file needs, ideally a hook TRI invokes after `new-task`, `done`, and status changes.

## 5. `Withdrawn` is missing from the status vocabulary

The re-baseline removed controls that eight tasks existed to build. No status meant *"retained as a record, not implementable"*. The options were leaving them in the frontier forever, or deleting the files and losing the reasoning.

Compass added `Withdrawn` to `tri.config.json` **and** to its own validator — status vocabulary, index regex, and summary counts, three separate edits.

**Fix:** ship `Withdrawn` first-class. Excluded from the frontier and from ready arithmetic, retained with its reason. Also settle what a dependency on a `Withdrawn` task means — Compass has several and nothing flags them.

## 6. Generated tasks are indistinguishable from specified ones

Measured before the re-baseline:

- **342/342** tasks carried a stamped `## Licensing requirements` **and** `## Religious-data integrity requirements` section — including admin screens, mobile widgets, and CI tasks.
- **251/342** opened with the identical Objective: *"Deliver one independently verifiable increment that will &lt;title&gt;."* The title restated.
- **342/342** carried `## Performance budget`, `## Observability`, `## Deployment`, `## Rollback`.
- Yet only **26** referenced the review ceremony that was the actual subject of the complaint.

`next` reported all of them ready, because ready meant *dependencies are Done* and nothing else. An agent claiming one would have implemented a placeholder with conviction.

**Fix**

- A **specification-status** field: `Unrevised` / `Specified` / `Withdrawn`. `plan` and `new-task` create `Unrevised` — a task TRI generated names a topic, it does not specify work. `clarify` promotes to `Specified`, and only when the Objective and Acceptance criteria were actually edited in that run.
- `next` returns `Unrevised` tasks **flagged, not hidden**. Claiming one warns and points at `clarify`.
- `run` refuses to batch `Unrevised` tasks without an explicit override. Batch mode is exactly where a placeholder gets implemented at speed.
- Emit `TODO: state what is true after this task that was not true before` rather than a title-derived sentence, and have `validate` **warn** when an Objective contains the task title verbatim. A placeholder that announces itself beats prose that merely looks finished.
- **Stamp detection** in `validate`: if a section's body is byte-identical across more than ~70% of tasks, it is boilerplate carrying no information. Report it with the count. That single check would have found the whole problem in seconds.

## 7. Nothing checks that the governing documents still agree

The expensive failure was never a bad task. It was an `Accepted` ADR asserting *"No public Hadith publication is permitted"* while a ratified owner decision released those rights — **both live in the repository at once**, for weeks, with hundreds of tasks generated from the losing side. An agent reading the repo followed whichever it hit first.

Related: `ADR-0042` was cited by two files and by the decision register while existing only on an unmerged branch, so anyone reading the default branch found a dangling citation to an authoritative document.

**Fix — `tri doctor`, or checks inside `validate`:**

- An `Accepted` ADR that a later `D-` entry contradicts by explicit reference → warn.
- A task citing an ADR that does not exist **on the default branch** → warn, and say if it exists on another branch.
- A task citing a `Superseded` ADR without also citing its successor → warn.
- A register entry referencing a `B-`/`D-`/`A-` identifier never defined → warn.
- When an ADR becomes `Superseded`, **emit the list of tasks still pointing at it.** A supersession that does not say what it invalidated is half a decision.

Warnings, not errors, for all of these. A contradiction is a judgement call, and a validator that blocks on judgement calls gets disabled.

## 8. There is no re-baseline path, and the order is not obvious

Compass needed: amend the charter → supersede the ADRs → rewrite the policy documents → re-specify the tasks. In that order, one reviewable commit per layer, with an approval gate between.

The order matters and is not intuitive. The charter was the root — it asserted *"No actor can author and approve the same revision"* as a Phase 1 **success measure**, and every downstream gate cited up to it. Rewriting 342 task bodies first would have meant rewriting them again.

Two layers were still missed on the first pass and found by reading rather than by any check: the 12 agent rule files under `.claude/rules/`, and the skills corpus under `.agents/skills/`. Those matter *more* than the policy documents, because `AGENTS.md` **obliges** an agent to read them before implementing — the repository was instructing the next agent to rebuild what had just been deleted.

**Fix:** ship `tri re-baseline`. Its most valuable behaviour is refusing to touch the task layer until the layers above have landed. Its second most valuable is enumerating every agent-facing document — rules, skills, contributor docs, checklists, runbooks — as an explicit layer, because those instruct the next agent and everybody forgets them.

---

## Constraints on any fix

- Do not break existing workspaces. New fields need a migration path that defaults sensibly for tasks predating them.
- Keep the registers append-only. That property is the only reason Compass's history was reconstructable, and it is what made "keep both sides, renumber the incoming one" a safe resolution.
- Resist adding a second place to state any fact. Compass measured its own most common defect as one fact restated in up to five files — a PHP version in five places, a module count in three — and the enforcement guard written during this work deliberately asserts **no** version string for that reason.

## Suggested order

1, 2, 3 first — they let wrong things through a green gate. Then 5 and 4, small and high-friction-removal. Then 6 and 7, the largest and most valuable long-term. 8 last, since it composes the rest.

---
description: Say what you want to work on; tri reads the state, picks the right command, and runs it
argument-hint: "[what you want to focus on — a task, a phase, an area, a goal, or nothing]"
---
Load the tri-method skill first. This command is a router: read the workspace state, interpret $ARGUMENTS, choose the one command that actually fits, say in a sentence which you chose and why, then **run it** — do not stop at a recommendation. If two routes are genuinely equal, put the choice to the user with AskUserQuestion (recommended first, consequence in each description) rather than describing the options in prose.

**1. Read state before deciding** (always, even for an explicit-sounding request):
`git status --porcelain`, `git branch --show-current`, then `node ~/.tri/scripts/tri.mjs status --json`, `next --json`, and `graph`. A dirty worktree or an unexpected current branch is reported to the user before routing anywhere — the routed command will need it resolved regardless. If `.tri/run.json` exists with unfinished queue entries, an interrupted batch outranks everything — resume it via /tri:run unless $ARGUMENTS clearly asks for something else.

**2. Match intent to command.** In priority order — first match wins:

| What the state or the ask looks like | Route to |
|---|---|
| Unfinished `.tri/run.json` | `/tri:run` (resume) |
| No `tri.config.json` in the project | `/tri:init` |
| Ask describes a spec, feature, or goal with no tasks behind it yet | `/tri:plan` |
| Ask **proposes or questions** an architectural change the user has not settled — "should we switch to X", "I'm considering Y", or anything contradicting an Accepted ADR without stating the decision as made | `/tri:grill` first. An ADR records a decision; writing one for an unsettled choice manufactures a conclusion the user never reached |
| Ask states a **settled** architectural decision — new dependency, service, boundary, changed contract | `/tri:adr` (and say plainly that implementation is blocked until it lands) |
| Ask states a resolved choice, or names an open question nobody present can answer | `/tri:decide` |
| Ask expresses doubt, risk, "is this right", "stress test", "poke holes" | `/tri:grill` |
| Target task exists but its Objective/Acceptance criteria are vague, contradictory, or its deps look ceremonial | `/tri:clarify` (do this **before** claiming — clarifying after implementation starts wastes the work) |
| Ask names a feature **area** whose tasks are not yet specified — vague objectives, templated acceptance criteria, undecided stack or boundary | `/tri:ship` (scope, interview, specify, one gate, then implement) |
| Ask implies volume on **already-specified** tasks: "a bunch", "keep going", "batch", "all of phase N", "overnight" | `/tri:run` |
| Ask names one ready, well-specified task or area | `/tri:next <ID>` |
| Ask is about seeing, comparing, or understanding the shape of work | `/tri:visualize` |
| Frontier is empty and everything runnable is Blocked | Do not route. Report the blockers with their register entries and name who must decide what. |
| No arguments at all | `/tri:status`, then recommend the single best next action from the frontier and run it if it is unambiguous |

**3. Rules that override a naive match:**
- An area name ("admin", "mobile", "search") is not a task. Resolve it against the frontier first; if several tasks match, pick the highest-priority ready one and say what you skipped.
- If the named task is not ready, say which dependencies are unmet before claiming. Claiming anyway is allowed — it warns, never blocks — but the user must see the warning.
- If the named task is already claimed by someone else, stop and say so. Do not take it over.
- Never chain more than one routed command per invocation. Route, run, report — the user re-invokes for the next step.

**4. Report** in two or three sentences: what you read, what you chose, what happened. Then name the natural next command so the user can keep moving.

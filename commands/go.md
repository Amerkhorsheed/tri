---
description: Say what you want to work on; tri reads the state, picks the right command, and runs it
argument-hint: "[what you want to focus on — a task, a phase, an area, a goal, or nothing]"
---
Load the tri-method skill first. This command is a router: read the workspace state, interpret $ARGUMENTS, choose the one command that actually fits, say in a sentence which you chose and why, then **run it, and continue into what follows** — do not stop at a recommendation, and do not end by telling the user which command to type next. If two routes are genuinely equal, put the choice to the user with AskUserQuestion (recommended first, consequence in each description) rather than describing the options in prose.

**1. Read state before deciding** (always, even for an explicit-sounding request):
`git status --porcelain=v1 --branch`, `git branch --show-current`, `git fetch --quiet`, then `node ~/.tri/scripts/tri.mjs status --json`, `next --json`, and `graph`. Report a dirty worktree, a mid-rebase, a detached HEAD, or a stale ref **before** routing — every mutating command it could route to would stop on them anyway, and the fetch means the frontier you route against is current rather than yesterday's. If `.tri/run.json` exists with unfinished queue entries, an interrupted batch outranks everything — resume it via /tri:run unless $ARGUMENTS clearly asks for something else.

**2. Match intent to command.** In priority order — first match wins:

| What the state or the ask looks like | Route to |
|---|---|
| Unfinished `.tri/run.json` | `/tri:run` (resume) |
| No `tri.config.json` in the project | `/tri:init` |
| Ask describes a spec, feature, or goal with no tasks behind it yet | `/tri:plan` |
| Ask **proposes or questions** an architectural change the user has not settled — "should we switch to X", "I'm considering Y", or anything contradicting an Accepted ADR without stating the decision as made | `/tri:grill` first. An ADR records a decision; writing one for an unsettled choice manufactures a conclusion the user never reached |
| Ask states a **settled** architectural decision — new dependency, service, boundary, changed contract | `/tri:adr` (and say plainly that implementation is blocked until it lands) |
| Ask states a resolved choice, or names an open question nobody present can answer | Record it in the register directly — a `D-` entry if resolved, a `B-` entry plus Blocked status if not — then continue with whatever it unblocks |
| Ask expresses doubt, risk, "is this right", "stress test", "poke holes" | `/tri:clarify` (it interrogates one question at a time when the target is a decision rather than a spec) |
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
- Continue into the next step rather than naming it: routing to `/tri:adr` then re-specifying the tasks that ADR unblocks is one invocation, not two. Announce each hop in a line. Stop only at the gates the tri-method skill lists.

**4. Report** in two or three sentences: what you read, what you chose, what happened. Then name the natural next command so the user can keep moving.

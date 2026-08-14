# Agent Workflow

This document formalizes `SPEC.md`'s goal #2 ("deliberate practice ground for multi-agent development workflows — spec-first, parallel agents, documented review") as an actual operational process, not just tribal chat history. It's the "how to run a session" counterpart to `AGENT_LOG.md` (which records what happened once a session is done).

## Claude Code's agent primitives (2026)

Claude Code has three ways to run multiple agents:

- **Subagents** (`.claude/agents/*.md`, invoked via the Task tool) — run inside the same top-level session, get their own context window and tool scope, but **share the parent session's working directory**. There is no filesystem boundary stopping one subagent from reading what another subagent (or the orchestrator) wrote.
- **Agent teams** (across separate sessions) — genuinely separate processes; can be paired with separate `git worktree`s for real filesystem isolation.
- **Background agents** — long-running, monitored separately; not relevant to this project's phase structure.

## When to use which

**Sequential, single-agent — the default for Phases 1, 2, 3, 5, 6.** Most checklist items in these phases have real dependencies (schema before repository before service before controller; scaffolding before the thing that uses it). A dispatcher fanning out parallel subagents here adds orchestration overhead without real parallelism to exploit — just run one Claude Code session per phase, working the checklist in `PROJECT_TODO.md` in order.

**Dispatcher/orchestrator via Task-tool subagents** — fine for genuinely independent sub-tasks inside a single phase, if any come up. This is **not** a substitute for the Phase 7 isolation test below: because subagents share the working directory, a "frontend subagent" dispatched this way can still technically read backend source, even if its system prompt tells it not to. Prompt-level discipline isn't the same as a real boundary.

**True isolation — Phase 7 only.** The backend-agent/frontend-agent contract-isolation test (originally scoped for Phase 4, moved to Phase 7 — see `docs/AUTONOMOUS_WORKFLOW.md`'s Phase 4 adaptation note and the corresponding ADR in `docs/DECISIONS.md`) is only meaningful if each side genuinely cannot see the other's implementation, only `docs/openapi.yaml` plus, per the Phase 3 correction, a mock server generated from the relevant contract addition rather than the live backend. That requires separate `git worktree`s and separately launched Claude Code sessions, not Task-tool subagents in one session. See commands below.

**Do not use a dispatcher to parallelize Phase 7.** `PROJECT_TODO.md` already rejected building the four extension features (7a–7d) in parallel — see "Scoping note on extension features" — specifically because shallow implementations you can't defend in depth beat one you understand fully. A dispatcher fanning these four out at once would silently reintroduce a risk the project already decided against. Keep Phase 7's four extensions sequential no matter how tempting parallel fan-out looks once the tooling makes it easy — the isolation *technique* (worktrees) is reused for 7a's contract test, but the four extensions themselves still ship one at a time.

## Subagent role definitions

`.claude/agents/backend-agent.md` and `.claude/agents/frontend-agent.md` define each side's scope and constraints. They double as plain documentation of what each side owns, and as literal subagent definitions if you use the Task tool for smaller in-phase delegation.

## Checkout inventory — a snapshot, expected to go stale (2026-08-09)

`CLAUDE.md`'s "Never quote a working tree without naming its branch" states the durable rule. These are the specific conditions that prompted it, recorded here rather than there because they expire. **Re-derive before relying on any of it** — `git worktree list`, `git rev-list --left-right --count <branch>...<remote>/<branch>`.

- **`D:\repos\My_Site` is the main checkout and the most obvious place to run a command.** It sat on `phase1/review-followups`, 58 commits behind the remote `main`, with uncommitted edits to `CLAUDE.md` and `docs/DECISIONS.md` on top. Reading a file there could match neither the branch nor `main`.
- **Local `main` was 85 commits behind `My_Site/main`** — further behind than the "stale" branch above. `git checkout main` would have made the situation worse, and `.claude/hooks/block-protected-branch-ops.sh` denies that command anyway. The correct move is to fast-forward the local ref (`git fetch` then `git switch main && git merge --ff-only My_Site/main`), not to assume the branch name means current.
- **Roughly half the checkouts are detached** — every `My_Site-review-NN` worktree created for a PR review, which is exactly where evidence gets quoted into review comments. `git rev-parse --abbrev-ref HEAD` returns the literal string `HEAD` in those, which is why the provenance rule uses the SHA.
- **`git cherry` and patch-ids can disagree with content.** Two commits on `phase3/frontend-foundation` looked absent from `main` (`git cherry` marked one `+`), but their patch-ids differed only because of surrounding context — the `+`/`-` lines were byte-identical to commits already merged. Confirm with the actual added lines before concluding work is stranded, and beware that a `grep` of lines beginning with `-` will be parsed as options unless you use `grep -e` or `--`.
- **Worth considering:** a non-blocking `SessionStart` hook emitting branch, SHA, dirty-file count and behind-count would supply this provenance automatically and keep perishable numbers out of prose entirely. Suggested during the PR #95 review; not built.

## Preventing repo-access race conditions (added 2026-08-05)

The rule that actually matters, independent of which of the three primitives above you're using: **one task, one `git worktree`, one branch, one session.** Two sessions must never share a working directory. A worktree gives each concurrent task its own `.git/index` and `HEAD` while all worktrees share one underlying object database — that's what makes simultaneous commits across worktrees safe, since they're never contending for the same index/HEAD lock file. Two sessions committing inside the *same* directory at the same time is what produces stuck `.git/index.lock`/`.git/HEAD.lock` files — this happened for real during this project's own Phase-1-era session work (a sandboxed `git status` call collided with a real git client against the same live-mounted folder; see `AGENT_LOG.md`), and worktrees are the structural fix, not just a convention to remember.

Practical guidance for this project's scale (solo maintainer, occasional parallel work):

- Create one worktree per task you're actively driving in parallel: `git worktree add ../My_Site-<task-slug> <branch-name>`.
- Point the session's working directory at that worktree, not the main checkout — `--worktree` when starting a top-level CLI session directly, or an explicit working directory pointing at a worktree you created yourself with `git worktree add`. **Don't reach for the dispatch-time `isolation: "worktree"` option when the branch has to outlive the task** (updated 2026-08-07, after trying it): it auto-generates its own branch name and auto-cleans the worktree once the agent finishes, and neither of those survives into a branch you still need to open a PR from, review, and merge. Fine for throwaway exploration; wrong tool for phase work. Phase 4's dispatch used manual `git worktree add` for exactly this reason — see `AGENT_LOG.md`'s 2026-08-07 Senior Dev session entry.
- Remove the worktree as soon as its branch is merged: `git worktree remove ../My_Site-<task-slug>`. Stale worktrees left lying around are the most common reason this pattern gets abandoned over time — run `git worktree prune` periodically (e.g., at the start of each work session) to catch any that were removed on disk but not unregistered.
- **Treat `git worktree remove` as something that can half-succeed** (added 2026-08-07, after it did). On Windows especially it can fail with `Permission denied` — a file still locked by a live process — while having *already* deregistered the worktree, leaving a directory on disk whose `.git` link now dangles. The failure mode is quiet and nasty: `git status` inside that directory doesn't error, it silently resolves to the **main checkout** instead, so a session sitting there believes it's isolated while operating on the shared repo — the exact collision worktrees exist to prevent. So: check the command's exit status instead of assuming a clean `git status` beforehand meant removal was safe, and if it fails, confirm the real state with `git worktree list` plus `git -C <dir> rev-parse --show-toplevel` before letting any session run there. A file lock is evidence of a live process, not an obstacle to route around — resolve it rather than force-deleting the directory.
  - **How it presents to a human, which is worse than the mechanism** (added 2026-08-09, after it cost a real investigation). `git worktree remove` deletes every file *first*, then fails on the now-empty directory, so the leftover is an **empty husk** with no `.git` entry of any kind. What you then see depends entirely on *where the husk sits*, and the difference matters:
    - **Nested inside the repo** (this project's `.claude/worktrees/<slug>` layout): git finds no `.git` in the directory, walks **up** to the enclosing repo, and reports the *main checkout's* branch and uncommitted files. No error. That reads exactly like stranded work in the removed worktree. It happened here — an apparently-abandoned change was "found" in the deleted Phase 3 worktree and turned out to be the main checkout's own uncommitted files, the same ones already found elsewhere, appearing to exist in two places at once.
    - **A sibling of the repo** (the `../My_Site-<task-slug>` layout this list recommends above): parent-directory discovery finds nothing, and you get a plain `fatal: not a git repository`. Loud, and much easier to diagnose.
    Note this is ordinary parent-directory discovery, **not** a dangling gitfile — a husk that still contained its `.git` file would error loudly and name the missing admin directory. The silent case requires the `.git` to be gone entirely, which is what `git worktree remove` leaves behind. **Before hunting for work you think is stranded, check whether the directory has any files at all** (`find <dir> -type f | wc -l`) and whether git still knows about it (`git worktree list`).
  - **Read a foreign-work-tree diff carefully rather than dismissing it.** `git --git-dir=<main>/.git --work-tree=<husk> diff <branch>` reported "193 files changed" for the empty directory above, which looked like noise. It wasn't: the output was `193 files changed, 21298 deletions(-)` — **pure deletions, one per tracked file**, and `git ls-tree -r --name-only <branch> | wc -l` is exactly 193. The command was correctly reporting that every tracked file was missing, which was true and was the answer. Prefer extracting the branch tip somewhere clean (`git archive <branch> | tar -x -C "$TMP"`) and comparing contents — it is unambiguous — but do not assume a large diff here is meaningless. *(Corrected 2026-08-09: an earlier version of this bullet claimed the number was meaningless because the command used the main repo's index. That explanation was invented, not verified, and the review of PR #94 disproved it.)*
- Don't over-parallelize: realistic capacity for a solo maintainer is roughly 4–8 concurrent worktrees before you're bottlenecked on reviewing the resulting PRs rather than on agent throughput. This project's Phase 7 sequencing (one extension at a time) stays well under that ceiling on purpose — see the scoping note in `PROJECT_TODO.md`.

## Automatic enforcement via hooks (added 2026-08-05)

The worktree rule above is easy to state and easy to violate by accident (a session given the wrong `cwd`, a copy-pasted command that targets the main checkout). Claude Code's `PreToolUse` hook fires before every tool call and can deny it outright, which turns "stay in your assigned worktree" from a convention into something enforced at the tool-call level rather than hoped for.

Two starter hooks are wired up via `.claude/settings.json`:

- **`.claude/hooks/check-worktree-scope.sh`** — denies any `Edit`/`Write` call targeting a file outside the session's assigned worktree. Opt a session into this check by exporting `CLAUDE_WORKTREE_ROOT` (its worktree's absolute path) before launching it; if unset, the hook is a no-op, so it doesn't restrict ordinary single-session work on the main checkout.
- **`.claude/hooks/block-protected-branch-ops.sh`** — always active. Denies force-pushes, `git checkout main`/`master`, and `git reset --hard` from any `Bash` tool call, regardless of worktree. Defense in depth: a task session should never need to touch the shared main branch directly, worktree or not.

Both hooks return a structured `permissionDecision: "deny"` with a human-readable reason on the offending call, rather than silently failing — see the scripts themselves for the exact contract. Extend this pattern (rather than replacing it) if more automatic guardrails come up; it's cheaper to add a new `PreToolUse` matcher than to keep re-explaining a rule in every session's prompt.

## Task distribution (added 2026-08-05)

This is the mechanical counterpart to `docs/AUTONOMOUS_WORKFLOW.md`'s Senior Dev / junior / independent-reviewer model: the Senior Dev session uses the native `TaskCreate`/`TaskList`/`TaskUpdate` tools as the shared task board, breaking phase work from `PROJECT_TODO.md` into discrete tasks with real `addBlockedBy`/`addBlocks` dependencies (not a flat list), then for each independently-startable task creates a worktree and dispatches a fresh session scoped to just that one task. Once that task's branch is pushed and a PR opened, review happens in a genuinely separate session with no shared context (a new session/process, not a continuation of the implementing one) — per `docs/AUTONOMOUS_WORKFLOW.md`'s PR review protocol — with the automated gate (`mvn test`, including the Modulith `ApplicationModules.verify()` check) run first as a cheap filter before spending a fresh session's attention on it.

## Dispatch cost: model choice and brief scope (added 2026-08-10)

`CLAUDE.md`'s "Choosing a model when dispatching" holds the operative rule. This is the evidence behind it, kept here rather than in a file loaded into every session.

**What prompted it.** The owner noticed unusually high usage. The cause was that **no dispatch had ever passed `model`**, so every agent inherited the Senior Dev's own. Per-agent totals reported in completion notifications ran mostly between 100k and 285k tokens, and the largest were not the hardest — a prose reflow that replaced newlines with spaces, and a round applying a list of six already-specified fixes, were both near the top.

**Be precise about what model choice does and does not fix.** It changes price per token, not the number of tokens. The measurable share of the fixed overhead — instructing every agent to read `CLAUDE.md`, `SPEC.md`, `PROJECT_TODO.md` and `docs/DECISIONS.md` in full — is on the order of 30k tokens against a 220k run, so roughly 15%. The rest is the work itself. Both levers are worth pulling; neither alone explains the total.

**Why cold reviews stay expensive.** Independent review has repeatedly found defects that self-review and green suites did not: a credential leak where `fetch` followed a redirect and forwarded an admin password past the locality guard (reproduced on Node 24.14.0); a `-webkit-box-orient` declaration no test asserted, whose deletion left every test passing and the feature completely inert in a browser; and, more than once, false claims in the Senior Dev's own documentation. That is the layer to protect, and this policy leans harder on it.

**Note what is *not* in that list.** An earlier draft cited a `CHECK` constraint that three-valued logic would have made permissive. That was a *prevented* defect — flagged in the dispatch brief and reasoned through by the implementer — not a review catch, and this project had already retracted it from a near-identical list on PR #98 for exactly that reason. It went back in anyway. Near-miss stories are the most quotable material here and the easiest to misattribute; check who actually caught a thing before crediting a layer with it.

**Where the cheaper rows carry real risk, and it is not hypothetical.**

- *Fix rounds.* `CLAUDE.md`'s "Review-fix scrutiny" bullet exists because this project shipped a defect **in a review response** — adding login rate limiting reused a shared limiter with an unnamespaced key and broke password reset. A fix round is not automatically mechanical, which is why the security/concurrency/migration row overrides the specification test.
- *Verification runs.* The whole thesis of `AGENT_LOG.md` is that tooling reports success without having performed the check. The seed-verification agent refused to claim an unmet gate when Docker was broken, labelled which demonstrations were stub-backed, and audited its own cleanup for a gap it could not close. That is judgement. Verification is deliberately **not** on the cheapest row.

**Why there is an allowlist instead of a test.** Two attempts at a clean boundary have now failed against this project's own examples. "Is the contract settled" failed because the date-snapping refusal happened against a settled ADR. Its replacement — "can you write the acceptance criteria in advance" — failed on the *same* example: `AGENT_LOG.md` records that the agent refused because snapping "would rewrite a stored `2024-03-17` … directly contradicting the round-trip requirement **in the same brief**". The criteria were written; the agent had to notice two written requirements conflicted. The other two flagship cases fail the test the same way: issue #86 specified a mechanism (`line-clamp`) that turned out to be half a fix, and the `NgOptimizedImage` rejection came from reading library source nobody had asked to be read. What unites all three is an agent judging whether doing what was asked would achieve what was wanted — which is not predictable in advance, because a specifier able to predict it would have written a better brief. So `CLAUDE.md` errs expensive and lists the cheap cases explicitly rather than pretending a criterion exists.

**The resume interaction.** `SendMessage` takes no model parameter, so a resumed agent keeps whatever it started on and in-flight work cannot be made cheaper. Where the cost policy and the resume rule conflict, resume wins — a cheap restart discards the context that rule exists to preserve.

**Known risk, stated rather than discovered later.** A cheaper fix round will sometimes miss what an expensive one would have caught, which then lands on the cold review or ships. Revisit if review rounds start finding defects a fix round plainly should have.

## When a dispatched agent dies mid-task (added 2026-08-08)

The operative rule lives in `CLAUDE.md` ("When a dispatched agent dies mid-task"): **resume the agent via `SendMessage` with its ID rather than salvaging its work by hand**, and treat a dying agent's final message as a fragment rather than a status report. `AGENT_LOG.md`'s 2026-08-08 entry has the full account of why.

The part that belongs here, because it interacts with the worktree rules above: **a dead agent's worktree is not automatically free.** Do not remove or reassign it while a resume is still possible — resuming a session whose working directory has been deleted or checked out to a different branch defeats the point. If you do decide to salvage instead, the worktree stays assigned to that task until its branch merges, and the deletion-before-prune ordering in the cleanup guidance above still applies (a half-removed worktree leaves a directory whose git commands silently resolve to the main checkout).

## Git worktree pattern (Phase 7 isolation exercise)

```
git worktree add ../My_Site-backend-agent phase7/backend-agent
git worktree add ../My_Site-frontend-agent phase7/frontend-agent
```

Launch a separate Claude Code session in each directory:

- **Backend-agent session:** give it `CLAUDE.md`, `SPEC.md`, `docs/DECISIONS.md`, `docs/DATA_MODEL.md`, `docs/openapi.yaml`. Don't reference frontend requirements beyond what's already in `SPEC.md`'s user stories.
- **Frontend-agent session:** give it only `docs/openapi.yaml` and `SPEC.md`'s user stories, developing against a mock server generated from the relevant contract addition — not the live backend (the correction from Phase 3's mistake; see `docs/AUTONOMOUS_WORKFLOW.md`). Don't explain backend implementation details you happen to know from watching it get built — that's the most likely way this test gets silently invalidated.

Clean up once the isolation exercise's integration is done:

```
git worktree remove ../My_Site-backend-agent
git worktree remove ../My_Site-frontend-agent
```

## AGENT_LOG.md discipline

Log every session, start to finish, for the whole project — not just Phase 4/7 (see `AGENT_LOG.md`'s own header note). During the Phase 7 isolation exercise specifically, flag contract mismatches (endpoint doesn't match the OpenAPI schema, an assumed enum value the backend never validates, pagination shape drift) as their own category, separate from ordinary bugs — that's the actual differentiation artifact `PROJECT_TODO.md` calls out.

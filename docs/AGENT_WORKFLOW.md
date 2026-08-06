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

## Preventing repo-access race conditions (added 2026-08-05)

The rule that actually matters, independent of which of the three primitives above you're using: **one task, one `git worktree`, one branch, one session.** Two sessions must never share a working directory. A worktree gives each concurrent task its own `.git/index` and `HEAD` while all worktrees share one underlying object database — that's what makes simultaneous commits across worktrees safe, since they're never contending for the same index/HEAD lock file. Two sessions committing inside the *same* directory at the same time is what produces stuck `.git/index.lock`/`.git/HEAD.lock` files — this happened for real during this project's own Phase-1-era session work (a sandboxed `git status` call collided with a real git client against the same live-mounted folder; see `AGENT_LOG.md`), and worktrees are the structural fix, not just a convention to remember.

Practical guidance for this project's scale (solo maintainer, occasional parallel work):

- Create one worktree per task you're actively driving in parallel: `git worktree add ../My_Site-<task-slug> <branch-name>`.
- Point the session's working directory at that worktree, not the main checkout — either via `isolation: "worktree"` when dispatching from an orchestrating session, or `--worktree` when starting a top-level CLI session directly.
- Remove the worktree as soon as its branch is merged: `git worktree remove ../My_Site-<task-slug>`. Stale worktrees left lying around are the most common reason this pattern gets abandoned over time — run `git worktree prune` periodically (e.g., at the start of each work session) to catch any that were removed on disk but not unregistered.
- Don't over-parallelize: realistic capacity for a solo maintainer is roughly 4–8 concurrent worktrees before you're bottlenecked on reviewing the resulting PRs rather than on agent throughput. This project's Phase 7 sequencing (one extension at a time) stays well under that ceiling on purpose — see the scoping note in `PROJECT_TODO.md`.

## Automatic enforcement via hooks (added 2026-08-05)

The worktree rule above is easy to state and easy to violate by accident (a session given the wrong `cwd`, a copy-pasted command that targets the main checkout). Claude Code's `PreToolUse` hook fires before every tool call and can deny it outright, which turns "stay in your assigned worktree" from a convention into something enforced at the tool-call level rather than hoped for.

Two starter hooks are wired up via `.claude/settings.json`:

- **`.claude/hooks/check-worktree-scope.sh`** — denies any `Edit`/`Write` call targeting a file outside the session's assigned worktree. Opt a session into this check by exporting `CLAUDE_WORKTREE_ROOT` (its worktree's absolute path) before launching it; if unset, the hook is a no-op, so it doesn't restrict ordinary single-session work on the main checkout.
- **`.claude/hooks/block-protected-branch-ops.sh`** — always active. Denies force-pushes, `git checkout main`/`master`, and `git reset --hard` from any `Bash` tool call, regardless of worktree. Defense in depth: a task session should never need to touch the shared main branch directly, worktree or not.

Both hooks return a structured `permissionDecision: "deny"` with a human-readable reason on the offending call, rather than silently failing — see the scripts themselves for the exact contract. Extend this pattern (rather than replacing it) if more automatic guardrails come up; it's cheaper to add a new `PreToolUse` matcher than to keep re-explaining a rule in every session's prompt.

## Task distribution (added 2026-08-05)

This is the mechanical counterpart to `docs/AUTONOMOUS_WORKFLOW.md`'s Senior Dev / junior / independent-reviewer model: the Senior Dev session uses the native `TaskCreate`/`TaskList`/`TaskUpdate` tools as the shared task board, breaking phase work from `PROJECT_TODO.md` into discrete tasks with real `addBlockedBy`/`addBlocks` dependencies (not a flat list), then for each independently-startable task creates a worktree and dispatches a fresh session scoped to just that one task. Once that task's branch is pushed and a PR opened, review happens in a genuinely separate session with no shared context (a new session/process, not a continuation of the implementing one) — per `docs/AUTONOMOUS_WORKFLOW.md`'s PR review protocol — with the automated gate (`mvn test`, including the Modulith `ApplicationModules.verify()` check) run first as a cheap filter before spending a fresh session's attention on it.

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

# Agent Workflow

This document formalizes `SPEC.md`'s goal #2 ("deliberate practice ground for multi-agent development workflows — spec-first, parallel agents, documented review") as an actual operational process, not just tribal chat history. It's the "how to run a session" counterpart to `AGENT_LOG.md` (which records what happened once a session is done).

## Claude Code's agent primitives (2026)

Claude Code has three ways to run multiple agents:

- **Subagents** (`.claude/agents/*.md`, invoked via the Task tool) — run inside the same top-level session, get their own context window and tool scope, but **share the parent session's working directory**. There is no filesystem boundary stopping one subagent from reading what another subagent (or the orchestrator) wrote.
- **Agent teams** (across separate sessions) — genuinely separate processes; can be paired with separate `git worktree`s for real filesystem isolation.
- **Background agents** — long-running, monitored separately; not relevant to this project's phase structure.

## When to use which

**Sequential, single-agent — the default for Phases 1, 2, 3, 5, 6.** Most checklist items in these phases have real dependencies (schema before repository before service before controller; scaffolding before the thing that uses it). A dispatcher fanning out parallel subagents here adds orchestration overhead without real parallelism to exploit — just run one Claude Code session per phase, working the checklist in `PROJECT_TODO.md` in order.

**Dispatcher/orchestrator via Task-tool subagents** — fine for genuinely independent sub-tasks inside a single phase, if any come up. This is **not** a substitute for the Phase 4 isolation test below: because subagents share the working directory, a "frontend subagent" dispatched this way can still technically read backend source, even if its system prompt tells it not to. Prompt-level discipline isn't the same as a real boundary.

**True isolation — Phase 4 only.** The backend-agent/frontend-agent test is only meaningful if each side genuinely cannot see the other's implementation, only `docs/openapi.yaml`. That requires separate `git worktree`s and separately launched Claude Code sessions, not Task-tool subagents in one session. See commands below.

**Do not use a dispatcher to parallelize Phase 7.** `PROJECT_TODO.md` already rejected building the four extension features (7a–7d) in parallel — see "Scoping note on extension features" — specifically because shallow implementations you can't defend in depth beat one you understand fully. A dispatcher fanning these four out at once would silently reintroduce a risk the project already decided against. Keep Phase 7 sequential no matter how tempting parallel fan-out looks once the tooling makes it easy.

## Subagent role definitions

`.claude/agents/backend-agent.md` and `.claude/agents/frontend-agent.md` define each side's scope and constraints. They double as plain documentation of what each side owns, and as literal subagent definitions if you use the Task tool for smaller in-phase delegation.

## Git worktree pattern (Phase 4)

```
git worktree add ../My_Site-backend-agent phase4/backend-agent
git worktree add ../My_Site-frontend-agent phase4/frontend-agent
```

Launch a separate Claude Code session in each directory:

- **Backend-agent session:** give it `CLAUDE.md`, `SPEC.md`, `docs/DECISIONS.md`, `docs/DATA_MODEL.md`, `docs/openapi.yaml`. Don't reference frontend requirements beyond what's already in `SPEC.md`'s user stories.
- **Frontend-agent session:** give it only `docs/openapi.yaml` and `SPEC.md`'s user stories. Don't explain backend implementation details you happen to know from watching it get built — that's the most likely way this test gets silently invalidated.

Clean up once Phase 4 integration is done:

```
git worktree remove ../My_Site-backend-agent
git worktree remove ../My_Site-frontend-agent
```

## AGENT_LOG.md discipline

Log every session, start to finish, for the whole project — not just Phase 4 (see `AGENT_LOG.md`'s own header note). During Phase 4 integration specifically, flag contract mismatches (endpoint doesn't match the OpenAPI schema, an assumed enum value the backend never validates, pagination shape drift) as their own category, separate from ordinary bugs — that's the actual differentiation artifact `PROJECT_TODO.md` calls out.

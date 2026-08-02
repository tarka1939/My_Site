# Autonomous Workflow (Phase 4 tail through Phase 6)

This document specifies how the project runs from this point through the end of Phase 6: one persistent "Senior Dev" session the user (product owner) talks to directly, which plans and executes work against `PROJECT_TODO.md`, dispatches PR review to independent sessions, and escalates only on genuine blockers. This supersedes the per-phase kickoff-prompt workflow used for Phases 1-3 — those worked, but required the user to hand-write a new prompt every phase. This is the standing replacement.

Confirmed 2026-08-02. See `docs/DECISIONS.md` for the ADR.

## Roles

**Senior Dev (the session the user talks to).** Reads `PROJECT_TODO.md` as the source of truth for what's left, plans and implements phase work directly (the pattern from Phases 1-3, which worked well), opens PRs, and reports status back in digestible form rather than a wall of diffs. Does not merge its own PRs without an independent review passing first (see below).

**Independent reviewer (fresh session, per PR).** For every PR, a brand-new Claude Code session — no shared conversation history with the Senior Dev session, no knowledge of *why* a given approach was taken, only the diff plus the standing docs (`CLAUDE.md`, `docs/openapi.yaml`, `docs/DECISIONS.md`, `docs/DATA_MODEL.md`). This mirrors a cold human reviewer, not a rubber stamp from someone who already agrees with their own reasoning. Runs alongside GitHub Copilot's automated review, not instead of it — Copilot has independently caught real defects (missing validation, a race condition, an exception-naming collision) across Phases 1-3, so both layers stay.

**The user (product owner).** Answers genuine spec-ambiguity questions when they come up, approves anything in the escalation list below, and does the one-time Phase 5 pre-flight setup that only a human can do (account creation, payment, credentials).

## Task dependency and ambiguity handling

The Senior Dev tracks tasks with explicit dependencies, not a flat checklist. When a genuine spec ambiguity comes up — something `docs/DECISIONS.md` doesn't already answer — it posts the question and marks *only the task(s) that depend on the answer* as blocked. Everything else in the phase keeps moving. It checks back for the answer rather than stalling the whole phase on one open question.

## Escalation triggers ("large problems")

These always stop and wait for the user — they are not treated as "keep working on other things while blocked," because the blast radius is qualitatively different from an ordinary spec question:

- Needing a new real account, credential, or payment method (VPS signup, domain registration, a new SaaS account) — account creation and payment are always off-limits for Claude to perform, in any session, regardless of autonomy level.
- A schema migration that could be destructive (drops, irreversible data transforms) — even if it looks correct, it gets flagged before running against anything but a throwaway local DB.
- Repeated failed attempts (3+) to fix the same failing test or the same class of bug — a sign the underlying approach needs human judgment, not another retry.
- Anything touching production secrets, DNS, or billing directly, outside the one-time Phase 5 setup the user already did.
- A decision `docs/DECISIONS.md` doesn't cover and that would be expensive to reverse later (the same "patch magnet" criterion `PROJECT_TODO.md` was built around from the start).

## PR review protocol

1. Senior Dev opens a PR, following `CLAUDE.md`'s PR conventions (closing keywords, correct milestone, project board status).
2. A fresh Claude Code session reviews the diff cold — no context beyond the PR itself and the standing docs. Findings get posted as PR review comments, same shape as the Copilot review pattern already established.
3. GitHub Copilot's automated review also runs (unchanged from Phases 1-3).
4. Senior Dev addresses valid findings, verifying each one rather than accepting or rejecting on the spot (per the pattern in `AGENT_LOG.md`'s Copilot-review entries — one finding across the project so far has turned out to be factually wrong, and blind acceptance would have made the code worse, not better).
5. Only merges once both reviews are addressed.

## Reporting

Status updates should read like a senior dev's standup to a product owner, not a commit log: what shipped, what's in progress, what's blocked and on whom, and any open questions — see the `engineering:standup` skill for the format if useful. Prefer this over silently working through the whole remaining scope and surfacing one giant diff at the end.

## Phase 5 pre-flight checklist (human-only setup)

Phase 5 touches real infrastructure — the risk profile is different from Phases 1-3, which were pure code. Before Phase 5 can run with the same autonomy as earlier phases, the user needs to provide:

- A Netlify account with the site already created (gives the `*.netlify.app` subdomain needed for CORS config and `FRONTEND_URL`).
- A VPS provider chosen, account created, and a server provisioned, with SSH access set up as a deploy key.
- A decision on whether the "no custom domain" plan (see `docs/DECISIONS.md`) still holds — affects the TLS approach.
- The following added to GitHub Actions secrets once the above exist: `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID`, the VPS SSH deploy key, `RESEND_API_KEY` (prod-scoped, or confirm reusing the dev-tested key from Phase 2), a prod JWT signing secret (Claude can generate the random value; the user places it in the secret store), and prod DB credentials for the VPS's self-hosted Postgres.
- A budget ceiling for the VPS, since it affects provider/tier choice.

**Even with all of the above in place:** the first real end-to-end deploy (first time secrets, DNS, and TLS all go live together) is a manual checkpoint regardless — it's the single highest-blast-radius event in the plan. Once that one deploy is verified working, subsequent deploys through the same pipeline can run unattended.

## Phase 4 adaptation

Phase 4's original premise — build backend and frontend blind to each other, then integrate for the first time — didn't hold in practice: Phase 3 was built and smoke-tested against the real, running backend from the start (see `AGENT_LOG.md`'s Phase 3 entries, including a real CORS gap caught only by that live integration). Phase 4 is adapted to what's actually left worth doing: formally documenting the mismatches already caught across Phases 2-3 as the "3+ concrete cases" deliverable `PROJECT_TODO.md` calls for, and building the Playwright E2E tests. The genuine backend-agent/frontend-agent isolation exercise (`docs/AGENT_WORKFLOW.md`'s git worktree pattern) moves to Phase 7, where each of the four extensions is new, not-yet-built, and gives a real contract-first venue for it — with one correction from Phase 3's mistake: the frontend side should develop against a mock server generated from the new contract addition, not the live backend, until an explicit integration step.

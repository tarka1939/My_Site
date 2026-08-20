# Autonomous Workflow (Phase 4 tail through Phase 6)

This document specifies how the project runs from this point through the end of Phase 6: one persistent "Senior Dev" session the user (product owner) talks to directly, which coordinates and dispatches phase work to fresh implementation agents against `PROJECT_TODO.md`, dispatches PR review to independent sessions, and escalates only on genuine blockers. This supersedes the per-phase kickoff-prompt workflow used for Phases 1-3 — those worked, but required the user to hand-write a new prompt every phase. This is the standing replacement.

Confirmed 2026-08-02. See `docs/DECISIONS.md` for the ADR.

## Roles

**Senior Dev (the session the user talks to).** Coordinator and task dispatcher, not an implementer — it does not write phase implementation code directly (a deliberate change from Phases 1-3, where the same session did both). Reads `PROJECT_TODO.md` as the source of truth for what's left, breaks phase work into discrete tasks, and spins up a new agent session (a "junior") scoped to each task to do the actual implementation. Once a junior's work is done, the Senior Dev checks it against spec (`docs/openapi.yaml`, `docs/DECISIONS.md`, `SPEC.md`, `docs/DATA_MODEL.md`) before accepting it, opens the PR, and keeps `AGENT_LOG.md`, `CHANGELOG.md`, `PROJECT_TODO.md`, and READMEs updated itself — that bookkeeping is the Senior Dev's own job, not delegated to juniors. Reports status back to the user in digestible form rather than a wall of diffs. Does not merge its own PRs without an independent review passing first (see below).

**Junior (fresh session, per implementation task).** A new Claude Code session dispatched by the Senior Dev for one discrete task from `PROJECT_TODO.md` — writes the actual code/config/tests. Scoped narrowly to that task, not the whole phase, so a wrong turn stays contained and easy for the Senior Dev to catch on review.

**Independent reviewer (fresh session, per PR).** For every PR, a brand-new Claude Code session — no shared conversation history with the Senior Dev session, no knowledge of *why* a given approach was taken, only the diff plus the standing docs (`CLAUDE.md`, `docs/openapi.yaml`, `docs/DECISIONS.md`, `docs/DATA_MODEL.md`). This mirrors a cold human reviewer, not a rubber stamp from someone who already agrees with their own reasoning.

**Who launches it (clarified 2026-08-08):** the Senior Dev launches the reviewer itself, in its own detached `git worktree`. This has been this document's position since it was written — see "dispatches PR review to independent sessions" in the opening paragraph — and is spelled out here only because a session kickoff prompt on 2026-08-07 instructed otherwise (hand a neutral prompt to the user, who starts the session themselves), out of a concern that the Senior Dev would leak implementation framing into a review meant to be blind. That concern is legitimate, but the leak risk lives in the *prompt text*, not in who presses go: a dispatched agent starts with a fresh context window and inherits nothing else. So the neutrality constraint sits on the prompt — PR pointer plus the standing docs, and nothing about why an approach was taken.

**On Copilot (deviated 2026-08-07):** Copilot's review was originally a required second layer alongside this one, and it earned that place — it independently caught real defects (missing validation, a race condition, an exception-naming collision) across Phases 1-3. It is currently **unavailable**: its quota is exhausted until 2026-08-25, and it responds to review requests with a quota error rather than a review. PRs #81, #82 and #83 were merged on the independent review alone. This is a deliberate deviation, not an oversight — stalling the project for two and a half weeks was the worse trade. Restore Copilot as a required layer once quota returns; a quota error is emphatically **not** the same claim as "the automated reviewer found nothing."

**The user (product owner).** Answers genuine spec-ambiguity questions when they come up, approves anything in the escalation list below, and does the one-time Phase 5 pre-flight setup that only a human can do (account creation, payment, credentials).

## Dispatch constraints (added 2026-08-10)

**Model comes from the agent definition, not from remembering an argument.** `.claude/agents/*.md` frontmatter now sets a default per role — Opus for `backend-agent`, Sonnet for `frontend-agent` — and a `model` argument on a dispatch overrides it when the work genuinely fits a different row. This replaces the earlier framing of "every dispatch must specify a model": the diagnosed cause was a silent default, and a rule requiring a parameter to be remembered every time would have shared that failure mode. `CLAUDE.md`'s "Choosing a model when dispatching" holds the allowlist; `docs/AGENT_WORKFLOW.md` holds the evidence.

Three obligations this places on the Senior Dev specifically, since they are the reason the cheaper rows are safe:

1. **Treat the cheap rows as an allowlist, not a judgement call.** `CLAUDE.md` deliberately stopped trying to state a test for this: two attempts failed against the project's own examples, most pointedly the date-snapping refusal, whose criteria *were* written into the brief the agent was arguing with. Anything writing application code defaults to Opus; the cheaper rows are a short, explicit list. Reaching for a cheap row on work that is not on that list is the live risk of this policy.
2. **Keep the escalation channel open, and mean it.** If a cheaper agent says the approach looks wrong, that is the signal the policy depends on — re-dispatch on Opus rather than restating the brief. The most valuable implementation outcomes on this project came from agents contradicting their instructions, and a cost policy that suppresses that has bought nothing. Note this is *doubt*, not *failure*: repeated failure at the same thing is already covered below and still stops for the user rather than escalating to a bigger model.
3. **Scope the brief.** Model comes from the agent definition, so it is set once rather than remembered. (The tooling states reasoning effort is configurable there too, but no key name is documented in anything available here and neither definition sets one — so treat effort as *not currently controlled*, rather than claiming a lever this project does not actually pull.) Brief scope is the part that is genuinely per-task. Name the sections that bear on the task rather than instructing a full read of documents that now run to thousands of lines, and scope a review to the diff's risk rather than a standing-doc sweep. The role definitions now carry this instruction themselves, so it holds whether or not a brief repeats it.
4. **A resume cannot be re-priced.** `SendMessage` takes no model parameter, so continuing a terminated agent keeps whatever it started on. Where this policy and the resume rule conflict, resume wins — a cheap restart discards the context that rule exists to preserve.

The independent review layer stays on the expensive model unconditionally. It is the layer with the best demonstrated hit rate, this policy leans harder on it, and cutting it would remove the check that makes everything else affordable.

## Task dependency and ambiguity handling

The Senior Dev tracks tasks with explicit dependencies, not a flat checklist. When a genuine spec ambiguity comes up — something `docs/DECISIONS.md` doesn't already answer — it posts the question and marks *only the task(s) that depend on the answer* as blocked. Everything else in the phase keeps moving. It checks back for the answer rather than stalling the whole phase on one open question.

## Escalation triggers ("large problems")

These always stop and wait for the user — they are not treated as "keep working on other things while blocked," because the blast radius is qualitatively different from an ordinary spec question:

- Needing a new real account, credential, or payment method (VPS signup, domain registration, a new SaaS account) — account creation and payment are always off-limits for Claude to perform, in any session, regardless of autonomy level.
- A schema migration that could be destructive (drops, irreversible data transforms) — even if it looks correct, it gets flagged before running against anything but a throwaway local DB.
- Repeated failed attempts (3+) to fix the same failing test or the same class of bug — a sign the underlying approach needs human judgment, not another retry.
- Anything touching production secrets, DNS, or billing directly, outside the one-time Phase 5 setup the user already did.
- A decision `docs/DECISIONS.md` doesn't cover and that would be expensive to reverse later (the same "patch magnet" criterion `PROJECT_TODO.md` was built around from the start).

## Render it before believing it (added 2026-08-17)

**Dispatched agents have no browser. The Senior Dev does.** That asymmetry is not incidental — it is
the only reason three defects were found at all, and it makes rendering a Senior Dev responsibility
rather than something to delegate or skip.

**The rule: when a change affects what a person sees, open it and measure. Do not accept a DOM
assertion as evidence of appearance.** If in doubt, render — the check costs a minute and the class
of bug it catches is invisible to every other gate in this project.

Three found this way, all with the suite green:

- **An error colour at 2.87:1 on the dark canvas** (#116). Every error message on the site, including
  the public contact form. The DOM was correct throughout; only the colour was wrong, so no test
  could have failed. Found by resolving the computed colour against the real canvas and calculating
  the ratio.
- **Developer-facing strings on a public page** (fixed in PR #113). `Your message was not sent:
  honeypot must not be blank` — a raw backend field key shown to a visitor. Every test asserted the
  text was *present*; none could judge whether it should be.
- **E2E scaffolding on the landing page** (#124). `e2e-alpha`, `e2e-beta` and four other tags with
  zero projects, listed in the public tag filter. Visible instantly on screen, invisible to a
  suite that only ever asserted the filter renders.

What to check when the change is visual: colour and contrast **computed against the resolved canvas**
rather than eyeballed; copy read as its actual audience would read it; empty, error and loading states,
not just the happy path; and anything a test asserts via `textContent`, which cannot distinguish what
is displayed from what merely exists in the tree.

Two practical notes. `textContent` concatenates `aria-hidden` and `visually-hidden` siblings, so it
can show text no user ever perceives — a period rendering as `November 2025 – , ongoing` in
`textContent` was correct on screen and correct to a screen reader, and was nearly reported as a bug.
And when stopping a dev server, **check the port, not the process**: both `mvn spring-boot:run` and
`ng serve` fork children that outlive their wrapper, and a stop that returns success has twice left a
server listening.

## PR review protocol

1. Senior Dev opens a PR, following `CLAUDE.md`'s PR conventions (closing keywords, correct milestone, project board status).
2. The Senior Dev dispatches a fresh session to review the diff cold, in its own detached worktree — no context beyond the PR itself and the standing docs. Findings get posted as PR review comments, same shape as the Copilot review pattern already established.
3. GitHub Copilot's automated review also runs — **suspended until 2026-08-25 while its quota is exhausted; see the note above.**
4. Senior Dev addresses valid findings, verifying each one rather than accepting or rejecting on the spot (per the pattern in `AGENT_LOG.md`'s Copilot-review entries — one finding across the project so far has turned out to be factually wrong, and blind acceptance would have made the code worse, not better).
5. Only merges once **the independent review has actually run and its findings are addressed** — that layer is mandatory and has no "unavailable" fallback. Copilot's review is additionally required whenever Copilot is able to run; its suspension above is a named, dated exception, not a general licence. Note the phrasing deliberately: an earlier draft of this line said "every *available* layer", which fails open — if nothing is available, nothing is addressed, and the gate passes. A merge gate has to fail closed for the same reason `CLAUDE.md`'s security-defaults bullet and the Definition of Done require it of security config: absence of a check is not a passing check.

## When a dispatched agent dies mid-task

See `CLAUDE.md`'s "When a dispatched agent dies mid-task" for the operative rule. In short: **resume the agent via `SendMessage` with its ID rather than salvaging its work by hand** — its context survives, and a dying agent's final message is a fragment, not a status report. Three agents were lost to API/session limits on 2026-08-07 and all three were salvaged manually when a resume would have been correct; one of them had died mid-mutation-test and left a deliberate defect in the working tree. `AGENT_LOG.md`'s 2026-08-08 entry has the full account.

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

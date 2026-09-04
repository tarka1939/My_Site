# Finishing Phase 5 — the automated half

**Written 2026-09-04.** Phase 5's manual half is done: both halves live, CORS and forwarded headers
verified against the running host, TLS clean on both, the admin password set, the SPA fallback
confirmed on the deployed artifact. What does not exist is any automation at all —
`.github/workflows/` holds a placeholder README, every deploy has been `mvn package` + `scp` +
`systemctl restart` by hand, and **no pull request in this repository has ever had its gates run by
anything but a person remembering to run them.**

This is the plan for the six issues that close that gap. The decisions behind it are an ADR in
`docs/DECISIONS.md`, 2026-09-04; this file is the execution order and the acceptance criteria, and
does not re-argue them.

The order below is not issue order. Two of the issues bundle "run the tests" with "build and
deploy", which have completely different risk profiles, and two assume a containerised production
this project deliberately does not have.

---

## 0. Prerequisite — SSH hardening ✅ done 2026-09-04

`PermitRootLogin no`, verified with a second session open before the first was closed. This had to
come first: adding a machine credential to a host while root-over-SSH was open would have been the
wrong order.

Two things learned doing it, worth keeping:

- **`sshd_config` is first-occurrence-wins, and `Include` sits at line 12.** The cloud-image drop-in
  `/etc/ssh/sshd_config.d/60-cloudimg-settings.conf` sets `PasswordAuthentication no`, so an edit
  further down the main file does nothing. Confirm effective config with `sudo sshd -T`, never by
  reading `sshd_config` alone.
- **Root was the only door.** `deploy` existed but the owner's key was on root only, so hardening
  locked them out completely. Both accounts now have keys.

---

## 1. CI — run the gates on every pull request

**No issue exists for this yet; file one.** It is currently a clause buried inside #38 and #45, and
it is the single highest-value item here: no secrets, no deploy target, cannot break production.

**What it does.** On every PR targeting `dev`: the backend suite and the frontend suite.

**What it needs.** JDK 25 and Node 24 on the runner. `ubuntu-latest` ships Docker, which the
Testcontainers integration tests need — verify that rather than assuming, because a silently skipped
Testcontainers suite looks identical to a passing one.

**Acceptance:** open a PR with a deliberately failing test and watch it go red. A CI job that has
never failed has not been shown to work.

**Traps specific to this repo:**

- `mvn -q` suppresses the `Tests run:` summary line. Do not use it in CI — the log is the record,
  and a derived count has already been wrong here once.
- The frontend needs `npm ci` before `npm test`. A fresh checkout has no `node_modules`, and the
  resulting failure looks like a broken test rather than a missing install — that exact confusion
  has cost time in this project twice.
- Consider adding the API-client regenerate check: run the generator, then
  `git add -A && git diff --cached --numstat` must come back empty. That rule exists because a
  description-only contract edit still produces a real client diff (PR #129), and it is the kind of
  thing a person forgets and a machine never does. It needs Java, which CI has anyway.

---

## 2. #46 — secrets in the Actions store

Comes before #45 because #45 cannot work without it.

**What goes in:**

| Secret | For | Notes |
|---|---|---|
| `DEPLOY_SSH_KEY` | #45 | private half of a **new, third** key — see below |
| `NETLIFY_AUTH_TOKEN` | #38 | |
| `NETLIFY_SITE_ID` | #38 | not secret, but belongs with its token |

**A third key, not the existing one.** The `deploy` key currently in use grants a general shell and
is shared. GitHub gets its own, restricted (see #45), so a compromised workflow cannot do whatever a
person can.

**The rule that now has to hold in YAML.** `docs/DECISIONS.md`'s 2026-09-03 security posture,
clause 3: no secret in shell history, process arguments, log files, or a pasted scrollback. In a
workflow the failure mode is echoing a secret into a build log — and on a public repository that log
is public. GitHub masks known secret values, but only exact matches: a secret that is base64-decoded,
split, or interpolated into a larger string is no longer masked.

**Acceptance:** a workflow run whose log is readable by a stranger and contains nothing you would not
paste into an issue.

---

## 3. #45 — deploy the backend on merge to `main`

**Rewrite the issue first.** Its title says "build Docker image", which the ADR defers. What it
actually does now: build the jar, ship it, restart, verify, roll back on failure.

**The restricted key is the point of this issue.** In `deploy`'s `authorized_keys`:

```
command="/home/deploy/deploy.sh",restrict ssh-ed25519 AAAA... github-actions
```

`restrict` disables port and agent forwarding, X11, and PTY allocation. `command=` means that key
runs one script and nothing else, whatever the client asks for. Possession of it becomes "can
trigger a deploy" rather than "owns the host".

**`/home/deploy/deploy.sh` is part of the security boundary**, not a convenience. It is what the key
can run, so it deserves the same review as the workflow calling it — including what it does when
invoked with arguments the workflow never sends. `SSH_ORIGINAL_COMMAND` is attacker-controlled if
the key ever leaks: ignore it, or validate it.

**Reuse §7a's chain rather than reimplementing it.** `docs/DEPLOYMENT.md` §7a already has the
staged-swap-and-verify sequence, including the two things that were wrong about it and got fixed:
the health check must stay inside the `&&` chain, and it must fail loudly rather than exiting 0 when
the app never comes up.

**Sudo.** The restart needs root. Give `deploy` a `NOPASSWD` sudoers entry scoped to exactly the
`systemctl restart mysite` command — not blanket sudo. That is a real decision and belongs recorded,
not slipped in as an implementation detail.

**Acceptance:** a merge to `main` deploys, and a deliberately broken jar rolls back and leaves the
site up. **Exercise the rollback path** — it is the half nobody tests.

---

## 4. #38 — deploy the frontend from Actions

**Only worth doing if it replaces Netlify's native build.** Running both means two builds racing for
one site, possibly from different commits. Switch the Netlify git integration off as part of this,
or do not do it at all.

**Known cost, accepted:** per-PR deploy previews stop existing. The backend deliberately does not
allowlist their origins anyway — see the reasoning on `SecurityConfig`'s CORS bean — so nothing else
breaks.

**What it buys beyond the exercise:** the SPA fallback verified in the CI build, which is an unticked
Phase 5 checklist item, and the artifact that was tested being the artifact that ships.

**Acceptance:** a merge to `main` publishes, a deep link to a non-existent project returns 200 rather
than 404, and the Netlify UI shows exactly one deploy per merge.

---

## 5. #42 — `docker-compose.yml` for local dev

**Independent of everything above.** Backend plus Postgres for local development, whether or not
production is ever containerised.

Removes `CLAUDE.md`'s "point the `DB_*` variables at whatever Postgres you have locally, or run one
yourself" step, which is currently a paragraph of instructions where a file would do.

**Acceptance:** bring the compose stack up, run the backend against it, and connect with no further
setup. Update `CLAUDE.md`'s Commands section in the same change.

---

## 6. #41 — multi-stage Dockerfile

**Deferred, deliberately.** The ADR's reasoning: containerising changes what is deployed at the same
moment the pipeline changes who deploys it, so a failure would have two candidate causes. Production
is a plain jar under systemd on purpose.

**Revisit when** automated jar deploys are boring. Two things to know at that point:

- It may **fix** the JVM believing it has 120 GiB. A Docker container usually gets a real memory
  cgroup where this LXC container does not — see §4.7a. That is an argument *for* it.
- It invalidates §4.7a's measurements, which would need redoing against the containerised host.

Keep the issue open carrying this note. The decision is "not yet", not "no".

---

## 7. #48 — structured logging

**Independent, any time.** Nothing above waits on it and it waits on nothing.

Worth pairing with a look at what is already logged rather than treating it as a formatter swap: the
contact and reset paths deliberately log only a message UUID and never visitor data, and
`ResendEmailClient` logs a reset link at DEBUG under a comment explaining why that is safe.
Structured logging should preserve both properties.

---

## What "Phase 5 complete" means

All of the above except #41, plus the checklist in `PROJECT_TODO.md` ticked honestly.

The phase is not done when the site works — it has worked since 2026-09-03. It is done when a merge
deploys it without anyone remembering to do anything.

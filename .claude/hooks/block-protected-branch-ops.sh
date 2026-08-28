#!/bin/bash
# PreToolUse hook (matcher: Bash) — see docs/AGENT_WORKFLOW.md
#
# Always active, regardless of worktree. Blocks destructive or protected-branch
# git operations from any Bash tool call: force-push, checking out a shared
# integration branch directly, and hard resets. Defense in depth on top of
# worktree isolation — a task session should never need to touch a shared
# branch directly.
#
# `dev` joined main/master on 2026-08-27, when `dev` became the branch feature
# work is cut from and merged into and `main` became production-only. `dev` is
# now the branch a session is most likely to check out by reflex, so it is the
# one that most needs the guard.
#
# ---------------------------------------------------------------------------
# Why this no longer uses jq (2026-08-27)
#
# It used to. `jq` is not installed on this machine and never has been, so
# `COMMAND` came back empty on every invocation and the hook fell through to an
# explicit `exit 0` — permitting every command it was written to deny. It had
# been dead for the whole of Phases 1-8 while `README.md` and
# `docs/AGENT_WORKFLOW.md` both described it as always active and
# unconditional. Confirmed by running `git checkout main --help`, which matches
# the deny pattern and executed anyway.
#
# That is the failure mode CLAUDE.md's "fails closed, never open" rule exists
# for, occurring in the hook meant to enforce the branch rules. So: one parser,
# chosen because it is actually present, and no path through this script
# permits a command it could not inspect. If nothing can parse the input, the
# answer is deny.
# ---------------------------------------------------------------------------
#
# Deliberately NOT blocked: `git switch`. docs/AGENT_WORKFLOW.md documents
# `git switch <branch> && git merge --ff-only My_Site/<branch>` as the correct
# way to fast-forward a stale local integration branch, so blocking it would
# forbid the sanctioned procedure. `checkout` is the reflex worth catching;
# `switch` is the deliberate act.
#
# Known false positive: the patterns match the whole command string, so a shell
# heredoc writing documentation that contains "git checkout main" is denied
# too. Write files with the Write/Edit tools rather than heredocs and it does
# not arise.

INPUT=$(cat)

for PY in python python3; do
  if command -v "$PY" >/dev/null 2>&1; then
    printf '%s' "$INPUT" | "$PY" -c '
import json, re, sys

DENY = (
    (r"git\s+push\s+(?:[^;&|]*\s)?(?:--force\b|-f\b)", "force-push"),
    (r"git\s+checkout\s+(?:main|master|dev)\b", "checking out a shared branch (main/master/dev) directly"),
    (r"git\s+reset\s+--hard\b", "hard reset"),
)

try:
    command = json.load(sys.stdin).get("tool_input", {}).get("command", "")
except Exception:
    # Unreadable input is not permission to proceed.
    command, matched = "<unparseable>", "unreadable hook input"
else:
    matched = next((label for pattern, label in DENY if re.search(pattern, command)), None)

if not matched:
    sys.exit(0)

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            "Blocked: " + matched + ". Force-push, hard reset, and checking out "
            "main/master/dev directly are off-limits from an automated session. "
            "Cut a worktree off My_Site/dev instead; see docs/AGENT_WORKFLOW.md. "
            "Command was: " + command
        ),
    }
}))
'
    exit 0
  fi
done

# No interpreter at all. Fail closed rather than silently waving everything
# through, which is exactly how this hook spent Phases 1-8.
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"block-protected-branch-ops.sh found no Python interpreter, so it cannot tell whether this command is a force-push, a hard reset, or a checkout of a shared branch. Denying rather than guessing. Install Python, or run the command yourself once you have checked it."}}'

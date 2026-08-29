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
# now the branch a session is most likely to reach for by reflex.
#
# ---------------------------------------------------------------------------
# History, because it is the reason for the shape of this file
#
# This hook was added 2026-08-07 (commit 7bd9b86) and was **inert from then
# until 2026-08-27** — Phase 4 through Phase 8. It parsed with `jq`, which is
# not installed on the machine this repo is developed on, so the command came
# back empty and an explicit `exit 0` permitted everything it was written to
# deny. Meanwhile README.md called it unconditional and docs/AGENT_WORKFLOW.md
# called it always active. Confirmed by running `git checkout main --help`,
# which matched the deny pattern and executed.
#
# The first rewrite (same day) swapped jq for Python and **was still wrong**,
# found by review before merge. `command -v` tests whether an interpreter
# exists, not whether it ran, and the `exit 0` after the pipeline fired
# unconditionally — so a Python that crashed, or that was the Windows Store
# app-execution stub (which is what `python` resolves to on this machine),
# produced empty stdout and an allow. A `null` command crashed `re.search`
# outside the try block and did the same. That is the identical fail-open
# class, inside the fix for it.
#
# So the rules this file now holds itself to:
#   1. Deny is the default. Allow is only reached by an interpreter that ran
#      to completion and said so.
#   2. The interpreter's **exit status** is checked, not its existence.
#   3. Every exception inside the Python denies, not just JSON parse errors.
#   4. The last line needs nothing installed at all.
# ---------------------------------------------------------------------------
#
# Deliberately NOT blocked: `git switch`. docs/AGENT_WORKFLOW.md documents
# `git switch <b> && git merge --ff-only My_Site/<b>` as the sanctioned way to
# refresh a stale integration branch, so blocking it would forbid the only
# procedure the docs offer. `checkout` is the reflex worth catching; `switch`
# is the deliberate act.
#
# Known false positive, wider than it looks: the patterns scan the whole
# command string, so **any** command containing the text — including a
# read-only `grep -rn "git checkout main" docs/` or a `git log --grep` — is
# denied. Writing files with Write/Edit instead of heredocs avoids the common
# case but not this one. Searching for these strings needs a different spelling
# (a character class, or `git' 'checkout`).
#
# Deliberate-effort bypasses, documented rather than chased, because this is a
# guard against reflex and not against an adversary: `git push My_Site +dev:dev`
# and `+refs/heads/dev:refs/heads/dev` force-push via refspec, `git push
# My_Site :dev` deletes a remote branch, and `git branch -f` / `git update-ref`
# move a ref without any of the three verbs below. The first three are caught;
# the last two are not.

INPUT=$(cat)

for PY in python python3; do
  command -v "$PY" >/dev/null 2>&1 || continue

  # Capture separately from printing, so a non-zero exit means "this
  # interpreter did not answer" and falls through to the next one, then to the
  # hardcoded deny. This is the line the first rewrite got wrong.
  if OUTPUT=$(printf '%s' "$INPUT" | "$PY" -c '
import json, re, sys

# Branch names are matched as whole tokens: not preceded or followed by a word
# character, dot, slash or hyphen. That keeps "main.ts", "dev-notes" and
# "My_Site/dev" (a detach, not a branch move) out, while catching the reflex
# spellings the old anchored patterns missed -- "git -C <path> checkout dev"
# and "git checkout -q dev" both sailed through until 2026-08-27.
BRANCH = r"(?<![\w./-])(?:main|master|dev)(?![\w./-])"

# [^;&|\n]* rather than .* so a match cannot run across a command separator or
# a newline. The newline mattered: without it, "git push My_Site x" on one line
# and "rm -f scratch" on the next was denied as a force-push.
SPAN = r"[^;&|\n]*?"

DENY = (
    (r"\bgit\b" + SPAN + r"\bpush\b" + SPAN + r"(?:--force\b|--force-with-lease\b|-f\b)", "force-push"),
    (r"\bgit\b" + SPAN + r"\bpush\b[^;&|\n]*\s\+\S*:", "force-push via a + refspec"),
    (r"\bgit\b" + SPAN + r"\bpush\b[^;&|\n]*(?:\s--delete\s+|\s:)" + BRANCH, "deleting a shared branch"),
    (r"\bgit\b" + SPAN + r"\bcheckout\b" + SPAN + BRANCH, "checking out a shared branch (main/master/dev) directly"),
    (r"\bgit\b" + SPAN + r"\breset\b" + SPAN + r"--hard\b", "hard reset"),
)

def emit(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))

# One try around everything. The first rewrite guarded only json.load, so a
# null command reached re.search and crashed into an allow.
try:
    command = json.load(sys.stdin).get("tool_input", {}).get("command")
    if not isinstance(command, str):
        # A Bash tool call always carries a string command. Anything else is a
        # payload this hook does not understand, and coercing it with str() --
        # which the first rewrite did -- turns "I cannot read this" into an
        # allow, which is the whole defect being fixed.
        emit("block-protected-branch-ops.sh got a " + type(command).__name__ +
             " where the command should be, so it cannot inspect it. "
             "Denying rather than guessing.")
        sys.exit(0)
    matched = next((label for pattern, label in DENY if re.search(pattern, command)), None)
except Exception as error:
    emit("block-protected-branch-ops.sh could not inspect this command (" +
         type(error).__name__ + "). Denying rather than guessing.")
    sys.exit(0)

if matched:
    emit("Blocked: " + matched + ". Force-push, hard reset, and checking out "
         "main/master/dev directly are off-limits from an automated session. "
         "Cut a worktree off My_Site/dev instead; see docs/AGENT_WORKFLOW.md. "
         "Command was: " + command)

sys.exit(0)
' 2>/dev/null); then
    printf '%s' "$OUTPUT"
    exit 0
  fi
done

# Either no interpreter exists, or every one of them failed to run. Deny.
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"block-protected-branch-ops.sh could not run an interpreter to inspect this command, so it cannot tell whether it is a force-push, a hard reset, or a checkout of a shared branch. Denying rather than guessing. Check that python is on PATH and actually runs."}}'

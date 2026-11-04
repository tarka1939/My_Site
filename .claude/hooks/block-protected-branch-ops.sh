#!/bin/bash
# PreToolUse hook (matcher: Bash|PowerShell) — see docs/AGENT_WORKFLOW.md
#
# Always active, regardless of worktree. Blocks destructive or protected-branch
# git operations from any Bash or PowerShell tool call: force-push, checking out
# a shared integration branch directly, and hard resets. Defense in depth on top
# of worktree isolation — a task session should never need to touch a shared
# branch directly.
#
# PowerShell joined on 2026-10-09 (#283). Claude Code on Windows has a
# PowerShell tool, the primary shell in the desktop app, and until then its
# calls never reached this file: `git checkout dev` typed there just ran. Its
# payload carries `tool_input.command` like Bash's, and the patterns below hold
# there too: `;` separates commands in both shells, Windows PowerShell 5.1 has
# no `&&`, and a backslash counts as a path separator, so `src\main\java` is a
# path rather than a checkout of `main`. Every PowerShell call now pays for this
# hook as well: about half a second with a working `python`, 1 to 1.3 s while
# two Store stubs sit ahead of `py` (two measurements, 2026-10-09).
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
# (a character class, or `git' 'checkout`). Since #283 that includes a commit
# message or PR body passed inline from PowerShell: pass them as files
# (`git commit -F`, `gh ... --body-file`). PowerShell has one false positive of
# its own: the `-f` format operator on a push line, as in
# `git push My_Site ("feat/{0}" -f $name)`, reads as a force flag.
#
# Known gap: a line continuation (`\` in bash, a backtick in PowerShell) puts a
# flag on the next line, and a match stops at a newline, so a `--force` there is
# not seen. Nobody types a force-push that way by reflex.
#
# Deliberate-effort bypasses, documented rather than chased, because this is a
# guard against reflex and not against an adversary: `git push My_Site +dev:dev`
# and `+refs/heads/dev:refs/heads/dev` force-push via refspec, `git push
# My_Site :dev` deletes a remote branch, and `git branch -f` / `git update-ref`
# move a ref without any of the three verbs below. The first three are caught;
# the last two are not.

INPUT=$(cat)

# `py`, the launcher name on Windows, is tried last. On 2026-10-09 the Store's
# app-execution aliases came back for both `python` and `python3`, ahead of the
# real interpreter on PATH, and this hook denied every Bash call until it
# learned a third name (#282). On that machine `py` is itself an alias, the
# Python install manager's, and it still ran. Rule 2 above is what makes adding
# a name safe: one that does not run still falls through to the deny. Where
# there is no `py`, as on Linux, `command -v` skips it.
for PY in python python3 py; do
  command -v "$PY" >/dev/null 2>&1 || continue

  # Capture separately from printing, so a non-zero exit means "this
  # interpreter did not answer" and falls through to the next one, then to the
  # hardcoded deny. This is the line the first rewrite got wrong.
  if OUTPUT=$(printf '%s' "$INPUT" | "$PY" -c '
import json, re, sys

# Branch names are matched as whole tokens: not preceded or followed by a word
# character, dot, slash, backslash or hyphen. That keeps "main.ts", "dev-notes"
# and "My_Site/dev" (a detach, not a branch move) out, while catching the reflex
# spellings the old anchored patterns missed -- "git -C <path> checkout dev"
# and "git checkout -q dev" both sailed through until 2026-08-27. The backslash
# joined with PowerShell (#283): "git checkout -- backend\src\main\X.java"
# restores a file, and the Maven layout puts a main directory in most paths.
BRANCH = r"(?<![\w./\\-])(?:main|master|dev)(?![\w./\\-])"

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
        # A Bash or PowerShell call always carries a string command. Anything else is a
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
    # Exit 0 is not an answer on its own. Claude Code reads stdout that does not
    # start with `{` as plain text, and plain text on exit 0 is a success, which
    # is an allow. So an interpreter that printed a notice ahead of a deny would
    # turn it into an allow. Only nothing, or this script's own JSON, counts;
    # anything else moves on to the next name (#284 review).
    case "$OUTPUT" in
      '' | '{"hookSpecificOutput"'*) printf '%s' "$OUTPUT"; exit 0 ;;
    esac
  fi
done

# Either no interpreter exists, or none of them ran and answered. Deny.
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"block-protected-branch-ops.sh could not run an interpreter to inspect this command, so it cannot tell whether it is a force-push, a hard reset, or a checkout of a shared branch. Denying rather than guessing. Check that python, python3 or py is on PATH and actually runs. On Windows, the App Installer aliases for python.exe and python3.exe (Settings > Apps > Advanced app settings > App execution aliases) can shadow a real install, see #282."}}'

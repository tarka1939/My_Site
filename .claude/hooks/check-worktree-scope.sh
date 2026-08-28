#!/bin/bash
# PreToolUse hook (matcher: Edit|Write) — see docs/AGENT_WORKFLOW.md
#
# Refuses Edit/Write calls that target a file outside this session's assigned
# git worktree. This is the automatic enforcement of the "one task, one
# worktree, one session" rule: it stops a worktree-scoped session from
# accidentally touching a shared checkout, which is the actual mechanism that
# causes .git/index.lock races between sessions.
#
# Opt-in only: set CLAUDE_WORKTREE_ROOT to this session's worktree's absolute
# path before launching it. If unset, this hook is a no-op and does not
# restrict ordinary single-session work. That part is deliberate and unchanged.
#
# ---------------------------------------------------------------------------
# Two defects fixed 2026-08-27, both found while adding `dev` to the sibling
# hook:
#
# 1. **It used jq, which is not installed on this machine and never has been.**
#    `FILE_PATH` came back empty on every call and the script exited 0 —
#    permitting every write it was written to refuse. Opting a session in did
#    nothing at all. Same root cause as block-protected-branch-ops.sh, and the
#    same violation of CLAUDE.md's "fails closed, never open".
#
# 2. **The containment test was a string prefix match.** `case "$FILE_PATH" in
#    "$CLAUDE_WORKTREE_ROOT"/*)` accepts anything that merely starts with the
#    root, so `<root>/../My_Site/CLAUDE.md` passed while pointing squarely at
#    the shared checkout — and on Windows a drive-letter or separator
#    difference (`D:\repos\x` vs `D:/repos/x`) failed the match the other way,
#    denying a legitimate write. Both paths are now normalised and compared as
#    paths rather than as strings.
#
# When opted in, no path through this script permits a write it could not
# check. If nothing can parse the input, the answer is deny.
# ---------------------------------------------------------------------------

INPUT=$(cat)

# Not opted in: this hook has nothing to say.
if [ -z "$CLAUDE_WORKTREE_ROOT" ]; then
  exit 0
fi

for PY in python python3; do
  if command -v "$PY" >/dev/null 2>&1; then
    printf '%s' "$INPUT" | "$PY" -c '
import json, os, sys

root = os.environ.get("CLAUDE_WORKTREE_ROOT", "")

def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)

try:
    path = json.load(sys.stdin).get("tool_input", {}).get("file_path", "")
except Exception:
    deny("check-worktree-scope.sh could not parse this tool call, so it cannot "
         "tell whether the target file is inside this session assigned worktree "
         "(" + root + "). Denying rather than guessing.")

# A call with no file_path is not an Edit/Write this hook governs.
if not path:
    sys.exit(0)

def canonical(p):
    # realpath resolves symlinks and "..", and works on paths that do not exist
    # yet -- which every Write of a new file is. normcase folds case and
    # separators on Windows, where D:\repos\x and D:/repos/X are one location.
    return os.path.normcase(os.path.realpath(os.path.abspath(p)))

target, base = canonical(path), canonical(root)

# commonpath, not startswith: "<root>-other/f" starts with the root string but
# is a different directory.
try:
    inside = os.path.commonpath([target, base]) == base
except ValueError:
    inside = False  # different drives

if inside:
    sys.exit(0)

deny("Blocked: " + path + " is outside this session assigned worktree (" + root +
     "). Each task must stay inside its own worktree to avoid racing another "
     "session on the shared repo. See docs/AGENT_WORKFLOW.md.")
'
    exit 0
  fi
done

# Opted in, but nothing can read the input. Fail closed.
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"check-worktree-scope.sh found no Python interpreter, so it cannot tell whether this file is inside the session assigned worktree. Denying rather than guessing. Install Python, or unset CLAUDE_WORKTREE_ROOT if this session does not need worktree scoping."}}'

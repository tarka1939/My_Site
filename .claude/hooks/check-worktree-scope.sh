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
# Three defects fixed 2026-08-27, the third only after review
#
# 1. **It parsed with jq, which is not installed here and never has been.** The
#    path came back empty and the script exited 0, so opting a session in did
#    nothing at all — from 2026-08-07, when this hook was added (7bd9b86),
#    until now. Phase 4 through Phase 8.
#
# 2. **The containment test was a string prefix match.** `case "$FILE_PATH" in
#    "$CLAUDE_WORKTREE_ROOT"/*)` accepted `<root>/../My_Site/CLAUDE.md` —
#    straight back into the shared checkout — and rejected a legitimate write
#    whose separators or drive-letter case differed.
#
# 3. **The first rewrite still failed open.** `command -v` tests whether an
#    interpreter exists, not whether it ran, and the `exit 0` after the
#    pipeline fired regardless — so a crashed Python, or the Windows Store
#    app-execution stub, meant allow. A list-valued file_path crashed
#    os.path.abspath outside the try block and did the same. Found by review
#    before merge, in the commit that was fixing exactly this class.
#
# When opted in: deny is the default, allow is reached only by an interpreter
# that ran to completion, every exception denies, and the last line needs
# nothing installed.
# ---------------------------------------------------------------------------
#
# Known gap: the matcher `Edit|Write` also matches NotebookEdit, whose argument
# is `notebook_path` rather than `file_path`. Such a call is allowed through.
# There are no notebooks in this repo; noted so the claim of containment stays
# honest.

INPUT=$(cat)

# Not opted in: this hook has nothing to say.
if [ -z "$CLAUDE_WORKTREE_ROOT" ]; then
  exit 0
fi

for PY in python python3; do
  command -v "$PY" >/dev/null 2>&1 || continue

  if OUTPUT=$(printf '%s' "$INPUT" | "$PY" -c '
import json, os, sys

root = os.environ.get("CLAUDE_WORKTREE_ROOT", "")

def emit(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))

def canonical(p):
    # realpath resolves symlinks and "..", and works on paths that do not exist
    # yet -- which every Write of a new file is. It is applied to both sides, so
    # a junctioned or symlinked worktree resolves consistently whichever form
    # the root is given in. normcase folds case and separators on Windows and
    # is a no-op on POSIX, so a Linux clone still compares case-sensitively.
    return os.path.normcase(os.path.realpath(os.path.abspath(p)))

# One try around everything, including the path handling. The first rewrite
# guarded only json.load, so a non-string file_path crashed into an allow.
try:
    path = json.load(sys.stdin).get("tool_input", {}).get("file_path")

    # No file_path at all: not an Edit/Write this hook governs.
    if path is None or path == "":
        sys.exit(0)

    if not isinstance(path, str):
        emit("check-worktree-scope.sh got a non-string file_path (" +
             type(path).__name__ + "), so it cannot tell where the write lands. "
             "Denying rather than guessing.")
        sys.exit(0)

    if not os.path.isabs(path):
        # A relative path resolves against whatever the hook process cwd
        # happens to be, so the same string can be inside the worktree or
        # outside it depending on where the tool call was made. Claude Code
        # passes absolute paths; anything else is unresolvable here.
        emit("check-worktree-scope.sh got a relative file_path (" + path +
             "), whose meaning depends on the working directory, so it cannot "
             "tell where the write lands. Denying rather than guessing.")
        sys.exit(0)

    target, base = canonical(path), canonical(root)

    # commonpath, not startswith: "<root>-other/f" starts with the root string
    # but is a different directory. Raises ValueError across drives, which is
    # itself a clear "outside".
    try:
        inside = os.path.commonpath([target, base]) == base
    except ValueError:
        inside = False
except Exception as error:
    emit("check-worktree-scope.sh could not inspect this call (" +
         type(error).__name__ + "). Denying rather than guessing.")
    sys.exit(0)

if inside:
    sys.exit(0)

emit("Blocked: " + path + " is outside this session assigned worktree (" + root +
     "). Each task must stay inside its own worktree to avoid racing another "
     "session on the shared repo. See docs/AGENT_WORKFLOW.md.")
sys.exit(0)
' 2>/dev/null); then
    printf '%s' "$OUTPUT"
    exit 0
  fi
done

# Opted in, but no interpreter ran. Fail closed.
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"check-worktree-scope.sh could not run an interpreter to inspect this call, so it cannot tell whether the file is inside the session assigned worktree. Denying rather than guessing. Check that python is on PATH and actually runs, or unset CLAUDE_WORKTREE_ROOT if this session does not need worktree scoping."}}'

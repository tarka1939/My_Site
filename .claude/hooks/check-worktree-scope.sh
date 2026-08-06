#!/bin/bash
# PreToolUse hook (matcher: Edit|Write) — see docs/AGENT_WORKFLOW.md
#
# Refuses Edit/Write calls that target a file outside this session's
# assigned git worktree. This is the automatic enforcement of the
# "one task, one worktree, one session" rule: it stops a worktree-scoped
# session from accidentally touching the shared main checkout, which is
# the actual mechanism that causes .git/index.lock races between sessions.
#
# Opt-in only: set CLAUDE_WORKTREE_ROOT to this session's worktree's
# absolute path before launching it. If unset, this hook is a no-op and
# does not restrict ordinary single-session work on the main checkout.

INPUT=$(cat)

if [ -z "$CLAUDE_WORKTREE_ROOT" ]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

case "$FILE_PATH" in
  "$CLAUDE_WORKTREE_ROOT"/*)
    exit 0
    ;;
  *)
    jq -n --arg path "$FILE_PATH" --arg root "$CLAUDE_WORKTREE_ROOT" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: ("Blocked: " + $path + " is outside this session assigned worktree (" + $root + "). Each task must stay inside its own worktree to avoid racing another session on the shared repo. See docs/AGENT_WORKFLOW.md.")
      }
    }'
    ;;
esac

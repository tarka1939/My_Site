#!/bin/bash
# PreToolUse hook (matcher: Bash) — see docs/AGENT_WORKFLOW.md
#
# Always active, regardless of worktree. Blocks destructive or
# protected-branch git operations from any Bash tool call: force-push,
# checking out main/master directly, and hard resets. Defense in depth
# on top of worktree isolation — a task session should never need to
# touch the shared main branch directly.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

if echo "$COMMAND" | grep -qE 'git +push +(--force|-f)\b' \
   || echo "$COMMAND" | grep -qE 'git +checkout +(main|master)\b' \
   || echo "$COMMAND" | grep -qE 'git +reset +--hard'; then
  jq -n --arg cmd "$COMMAND" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: ("Blocked destructive or protected-branch git command: " + $cmd + ". Force-push, hard reset, and checking out main/master directly are off-limits from an automated session. See docs/AGENT_WORKFLOW.md.")
    }
  }'
else
  exit 0
fi

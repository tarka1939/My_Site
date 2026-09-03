#!/bin/bash
# Runnable cases for the two PreToolUse hooks.  bash .claude/hooks/hooks.test.sh
#
# This exists because both hooks were inert for five phases and nobody noticed,
# and because the first rewrite of them was *also* fail-open and was caught only
# by review. docs/AGENT_WORKFLOW.md now tells the reader "if you add a hook,
# first make it deny something and watch it happen" — this is that, made
# repeatable, so the next person editing a regex finds out immediately.
#
# Exits non-zero if any case is wrong. No arguments, no network, no writes.

cd "$(dirname "$0")/../.." || exit 2
GUARD=.claude/hooks/block-protected-branch-ops.sh
SCOPE=.claude/hooks/check-worktree-scope.sh
PASS=0
FAIL=0

# Reads a hook's stdout and prints "deny" or "allow". Empty output is allow,
# which is what Claude Code itself does with it.
verdict() {
  python -c '
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    print("allow")
else:
    try:
        print(json.loads(raw)["hookSpecificOutput"]["permissionDecision"])
    except Exception:
        print("malformed")
' 2>/dev/null || echo "no-python"
}

check() { # check <expected> <label> <hook> [env assignment]
  local expected="$1" label="$2" hook="$3" got
  got=$(printf '%s' "$STDIN" | env $4 bash "$hook" 2>/dev/null | verdict)
  if [ "$got" = "$expected" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL  expected %-5s got %-9s  %s\n' "$expected" "$got" "$label"
  fi
}

cmd() { # build a Bash-tool payload with the given command string
  STDIN=$(python -c 'import json,sys; print(json.dumps({"tool_input":{"command":sys.argv[1]}}))' "$1")
}

raw() { STDIN="$1"; }

echo "block-protected-branch-ops.sh"

# --- must deny -------------------------------------------------------------
for c in \
  "git checkout main" \
  "git checkout dev" \
  "git checkout master" \
  "git checkout -q dev" \
  "git checkout --quiet dev" \
  "git checkout -B dev My_Site/dev" \
  "git -C /d/repos/My_Site checkout dev" \
  "cd x && git checkout main" \
  "git push --force My_Site main" \
  "git push My_Site dev -f" \
  "git push --force-with-lease My_Site dev" \
  "git push My_Site +dev:dev" \
  "git push My_Site --delete dev" \
  "git reset --hard HEAD~3" \
  "git reset -q --hard HEAD~1" \
  "git -C /d/repos/My_Site reset --hard HEAD~1" \
  ; do cmd "$c"; check deny "$c" "$GUARD"; done

# Malformed or hostile payloads must fail CLOSED. These are the regressions:
# every one of them was an *allow* in at least one earlier version of the hook.
raw 'not json at all';                       check deny "unparseable input"        "$GUARD"
raw '{"tool_input":{"command":null}}';       check deny "null command"             "$GUARD"
raw '{"tool_input":{"command":["a","b"]}}';  check deny "list command"             "$GUARD"
raw '{"tool_input":null}';                   check deny "null tool_input"          "$GUARD"
raw '';                                      check deny "empty stdin"              "$GUARD"

# --- must allow ------------------------------------------------------------
for c in \
  "git checkout -b feat/x My_Site/dev" \
  "git checkout -- README.md" \
  "git checkout -- main.ts" \
  "git switch main" \
  "git switch dev && git merge --ff-only My_Site/dev" \
  "git push -u My_Site feat/x" \
  "git log --oneline main" \
  "git merge --ff-only My_Site/dev" \
  "git worktree add --detach ../wt My_Site/dev" \
  ; do cmd "$c"; check allow "$c" "$GUARD"; done

# A push on one line and an unrelated -f flag on the next is not a force-push.
# It was denied as one until the newline was excluded from the scan.
cmd "$(printf 'git push My_Site feat/x\nrm -f /tmp/scratch\n')"
check allow "multi-line push followed by rm -f" "$GUARD"

echo "check-worktree-scope.sh"
R="$(pwd)"

scope() { STDIN=$(python -c 'import json,sys; print(json.dumps({"tool_input":{"file_path":sys.argv[1]}}))' "$1"); }

scope "$R/CLAUDE.md";                       check allow "inside the worktree"            "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R"
scope "$R/docs/../CLAUDE.md";               check allow "inside, via .."                 "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R"
scope "$R/../My_Site/CLAUDE.md";            check deny  "traversal to a sibling checkout" "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R"
scope "${R}-other/f.md";                    check deny  "sibling sharing the root prefix" "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R"
scope "C:/Users/x/.claude/settings.json";   check deny  "another drive"                   "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R"
scope "CLAUDE.md";                          check deny  "bare relative path"              "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R"
raw '{"tool_input":{"file_path":["a"]}}';   check deny  "list file_path"                  "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R"
raw 'not json';                             check deny  "unparseable while opted in"      "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R"
raw '{"tool_input":{"command":"ls"}}';      check allow "no file_path at all"             "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R"
scope "$R/../My_Site/CLAUDE.md";            check allow "not opted in: a no-op"           "$SCOPE"

# --- the fail-open regression, tested directly -----------------------------
# An interpreter that exists but cannot run must not become an allow. This is
# the exact shape of the Windows Store python.exe app-execution alias, which is
# what `python` resolves to on the machine this repo is developed on.
echo "interpreter failure"
STUB=$(mktemp -d) || exit 2
printf '#!/bin/bash\nexit 9009\n' > "$STUB/python"
printf '#!/bin/bash\nexit 9009\n' > "$STUB/python3"
chmod +x "$STUB/python" "$STUB/python3"
# Prepended, not replaced: replacing PATH removes `cat` and `bash` too, which
# breaks the hook for a reason that has nothing to do with the interpreter and
# makes the case prove nothing. A broken python *earlier on the path* than the
# real one is the situation being modelled.
cmd "git checkout main"
got=$(printf '%s' "$STDIN" | PATH="$STUB:$PATH" bash "$GUARD" 2>/dev/null | verdict)
if [ "$got" = "deny" ]; then PASS=$((PASS + 1)); else
  FAIL=$((FAIL + 1)); printf '  FAIL  expected deny got %-9s  broken interpreter on PATH\n' "$got"; fi
rm -rf "$STUB"

echo
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]

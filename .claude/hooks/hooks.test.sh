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

# The helpers below need a Python of their own: the first name that actually
# runs, in the hooks' own order. They called `python` directly until 2026-10-09,
# when that name and `python3` were both the Store's stub, and every case read
# "no-python" (#282).
PY=
for p in python python3 py; do
  if "$p" -c '' >/dev/null 2>&1; then PY=$p; break; fi
done
if [ -z "$PY" ]; then
  echo "None of python, python3 or py runs here, so no hook verdict can be read."
  exit 2
fi

# Reads a hook's stdout and prints "deny" or "allow". Empty output is allow,
# which is what Claude Code itself does with it.
verdict() {
  "$PY" -c '
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

check() { # check <expected> <label> <hook> [env assignment...]
  local expected="$1" label="$2" hook="$3" got
  got=$(printf '%s' "$STDIN" | env "${@:4}" bash "$hook" 2>/dev/null | verdict)
  if [ "$got" = "$expected" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    printf '  FAIL  expected %-5s got %-9s  %s\n' "$expected" "$got" "$label"
  fi
}

cmd() { # build a Bash-tool payload with the given command string
  STDIN=$("$PY" -c 'import json,sys; print(json.dumps({"tool_input":{"command":sys.argv[1]}}))' "$1")
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

# --- PowerShell spellings (#283) -------------------------------------------
# The same payload arrives from the PowerShell tool, so these are the reflexes
# as a Windows session types them: `;` and `if ($?)` rather than `&&`,
# backslashed paths, and `-Force` on a cmdlet after a separator.
for c in \
  "git checkout dev; if (\$?) { git status }" \
  "Set-Location D:\\repos\\My_Site; git checkout main" \
  "git -C D:\\repos\\My_Site checkout dev" \
  "git -C \"D:\\repos\\My_Site\" reset --hard HEAD~1" \
  "git push --force My_Site main 2>&1 | Out-Null" \
  ; do cmd "$c"; check deny "PowerShell: $c" "$GUARD"; done

for c in \
  "git switch dev; if (\$?) { git merge --ff-only My_Site/dev }" \
  "git log --oneline main | Select-Object -First 5" \
  "git push -u My_Site feat/x; Remove-Item -Recurse -Force \$env:TEMP\\scratch" \
  "git worktree remove D:\\repos\\My_Site\\.claude\\worktrees\\x" \
  ; do cmd "$c"; check allow "PowerShell: $c" "$GUARD"; done

echo "check-worktree-scope.sh"
R="$(pwd)"

scope() { STDIN=$("$PY" -c 'import json,sys; print(json.dumps({"tool_input":{"file_path":sys.argv[1]}}))' "$1"); }

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
# the exact shape of the Windows Store app-execution aliases, which on
# 2026-10-09 shadowed both `python` and `python3` on the machine this repo is
# developed on (#282).
echo "interpreter failure"
STUB=$(mktemp -d) || exit 2
REAL=$(command -v "$PY")
for p in python python3 py; do printf '#!/bin/bash\nexit 9009\n' > "$STUB/$p"; done
chmod +x "$STUB/python" "$STUB/python3" "$STUB/py"
# Prepended, not replaced: replacing PATH removes `cat` and `bash` too, which
# breaks the hook for a reason that has nothing to do with the interpreter and
# makes the case prove nothing. A broken python *earlier on the path* than the
# real one is the situation being modelled.
#
# `git status` and a file inside the worktree are allowed by a working hook, so
# a deny here can only come from the hard-coded line each hook ends with. This
# case used `git checkout main` until #282, which any interpreter slipping past
# the stubs would also have denied.
cmd "git status"
check deny "no interpreter runs"                  "$GUARD" "PATH=$STUB:$PATH"
scope "$R/CLAUDE.md"
check deny "no interpreter runs, opted in"        "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R" "PATH=$STUB:$PATH"

# Now `py` alone works, and the hooks must reach it rather than stop at the two
# broken names before it. REAL is an absolute path, so the shim cannot find
# itself on PATH and loop.
printf '#!/bin/bash\nexec %q "$@"\n' "$REAL" > "$STUB/py"
cmd "git status"
check allow "python and python3 broken, py runs"  "$GUARD" "PATH=$STUB:$PATH"
cmd "git checkout main"
check deny  "python and python3 broken, py runs, and denies" "$GUARD" "PATH=$STUB:$PATH"
scope "$R/CLAUDE.md"
check allow "python and python3 broken, py runs, opted in" "$SCOPE" "CLAUDE_WORKTREE_ROOT=$R" "PATH=$STUB:$PATH"
rm -rf "$STUB"

# --- wiring -----------------------------------------------------------------
# Every case above calls a hook directly, so none of them can tell whether
# Claude Code ever sends it a call. The matchers in .claude/settings.json decide
# that, and until #283 the branch guard's was `Bash` alone, so PowerShell calls
# never reached it. fullmatch is at least as strict as Claude Code's matching:
# a "yes" here is a yes there.
echo "settings.json wiring"
wired() { # wired <hook script> <tool name>: "yes" if a PreToolUse matcher sends that tool to it
  "$PY" -c '
import json, re, sys
script, tool = sys.argv[1], sys.argv[2]
try:
    with open(".claude/settings.json", encoding="utf-8") as f:
        entries = json.load(f)["hooks"]["PreToolUse"]
    print("yes" if any(
        re.fullmatch(e["matcher"], tool)
        and any(script in h.get("command", "") for h in e.get("hooks", []))
        for e in entries) else "no")
except Exception as error:
    print("unreadable:" + type(error).__name__)
' "$1" "$2" 2>/dev/null || echo "no-python"
}
for pair in \
  "block-protected-branch-ops.sh Bash" \
  "block-protected-branch-ops.sh PowerShell" \
  "check-worktree-scope.sh Edit" \
  "check-worktree-scope.sh Write" \
  ; do
  set -- $pair
  got=$(wired "$1" "$2")
  if [ "$got" = "yes" ]; then PASS=$((PASS + 1)); else
    FAIL=$((FAIL + 1)); printf '  FAIL  expected yes   got %-9s  %s calls reach %s\n' "$got" "$2" "$1"; fi
done

echo
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]

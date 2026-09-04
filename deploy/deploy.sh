#!/usr/bin/env bash
#
# deploy.sh -- the only thing GitHub Actions' key is permitted to run.
#
# Installed at /home/deploy/deploy.sh on the VPS and pinned in ~/.ssh/authorized_keys as:
#
#   command="/home/deploy/deploy.sh",restrict ssh-ed25519 AAAA... github-actions
#
# `command=` forces this script for EVERY use of that key, whatever the client asks for. That is
# what makes possession of the key "can trigger a deploy" rather than "owns the host" -- and it is
# also why the jar arrives on **stdin** rather than by scp: with a forced command there is no
# second channel to copy a file over.
#
# This file is part of the security boundary, not a convenience wrapper. It gets the same review as
# the workflow that calls it. See docs/CI_PLAN.md item 3 and issue #45.
#
# Mirrors docs/DEPLOYMENT.md section 7a, which is the manual version of the same sequence, including
# the two defects found there by review: the health check must stay inside the && chain, and it must
# fail loudly rather than exiting 0 when the application never comes up.

set -euo pipefail

JAR=/home/deploy/mysite.jar
NEW=/home/deploy/mysite-new.jar
PREV=/home/deploy/mysite-prev.jar
BAD=/home/deploy/mysite-bad.jar
HEALTH=http://localhost:8080/actuator/health
ATTEMPTS=45          # x2s = 90s. A cold start measured ~26s; this is generous without being unbounded.

log() { printf '[deploy] %s\n' "$1"; }
die() { printf '[deploy] FAILED: %s\n' "$1" >&2; exit 1; }

# SSH_ORIGINAL_COMMAND is whatever the client asked for before `command=` overrode it. It is
# attacker-controlled if this key ever leaks, so it is ignored rather than inspected -- there is no
# argument this script accepts, and accepting one later would be a change to the security boundary.
if [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  log "ignoring client-supplied command: ${SSH_ORIGINAL_COMMAND}"
fi

# --- Receive the jar on stdin ------------------------------------------------------------------
log "receiving jar on stdin"
cat > "$NEW"

# Refuse anything that is not plausibly a jar BEFORE touching the running one. A truncated upload,
# an empty stream, or an error page piped in by mistake all land here rather than replacing a
# working deployment with rubbish. `PK\x03\x04` is the zip local-file header; a jar is a zip.
[ -s "$NEW" ] || die "received an empty stream. The running jar has not been touched."
head -c 4 "$NEW" | od -An -tx1 | tr -d ' \n' | grep -q '^504b0304' \
  || die "received data is not a zip/jar (bad magic). The running jar has not been touched."
log "received $(stat -c %s "$NEW") bytes"

# --- Stage, then swap ---------------------------------------------------------------------------
# Neither mv needs sudo, and replacing an open file does not disturb the running JVM: it keeps its
# own inode until it restarts.
mv "$JAR" "$PREV"
mv "$NEW" "$JAR"
log "swapped in the new jar; previous kept at $PREV"

# --- Restart and verify ---------------------------------------------------------------------------
# The sudoers entry permits exactly this command and nothing else.
sudo /usr/bin/systemctl restart mysite

ok=
for _ in $(seq "$ATTEMPTS"); do
  if curl -sf --max-time 3 "$HEALTH" > /dev/null 2>&1; then ok=1; break; fi
  sleep 2
done

if [ -n "$ok" ]; then
  log "healthy. Deploy complete."
  exit 0
fi

# --- Roll back, keeping the failed build ---------------------------------------------------------
# Rolling straight over the bad jar destroys the thing you were about to diagnose.
log "health check never passed after $((ATTEMPTS * 2))s -- rolling back"
mv "$JAR" "$BAD"
mv "$PREV" "$JAR"
sudo /usr/bin/systemctl restart mysite

rolled_back=
for _ in $(seq "$ATTEMPTS"); do
  if curl -sf --max-time 3 "$HEALTH" > /dev/null 2>&1; then rolled_back=1; break; fi
  sleep 2
done

[ -n "$rolled_back" ] \
  || die "rollback ALSO failed to come up. The site is down. Failed build kept at $BAD; previous at $JAR. Check: journalctl -u mysite -n 50"

die "new build never became healthy; rolled back and the site is up. Failed build kept at $BAD for diagnosis."

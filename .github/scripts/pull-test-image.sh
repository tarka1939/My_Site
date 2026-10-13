#!/usr/bin/env bash
# Pulls the Postgres image the backend's Testcontainers suite runs on, before Maven starts.
#
# Both workflows that run the suite call this: ci.yml on every pull request (#285), and
# deploy-backend.yml before it builds a release (#287). So the release path runs the same file
# every pull request has already run.
#
# Why a step of its own: on 2026-10-09 Docker Hub refused this pull. Testcontainers retried for
# about 45 minutes, and Maven then reported 9 errors on a PR that changed no backend code, which
# read as 9 broken tests. Here a refusal fails in under a minute, at a step named for the pull.
#
# This is not a second pull: Testcontainers pulls only an image that is not already local, and
# nothing in backend/ changes that policy. If Testcontainers is ever pointed at a mirror
# (TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX, an option on #285), pull through the same mirror here,
# or this fails on the refusal the mirror exists to avoid.
#
# The name is read from TestPostgres.java rather than written again here, because that class is
# the one place it is kept, and its javadoc explains why a second copy is the defect. The pattern
# is anchored to the declaration, so a javadoc line quoting it cannot match as well. The path is
# resolved from this file's location, so the caller's working directory does not matter.
set -e

root=$(cd "$(dirname "$0")/../.." && pwd)
image=$(sed -n 's/^[[:space:]]*public static final String IMAGE = "\([^"]*\)";.*/\1/p' \
  "$root/backend/src/test/java/io/github/tarka1939/mysite/TestPostgres.java")
if [ -z "$image" ]; then
  echo "::error::Could not read IMAGE from TestPostgres.java. If the constant moved, update .github/scripts/pull-test-image.sh."
  exit 1
fi
for attempt in 1 2 3; do
  docker pull "$image" && exit 0
  echo "Pull $attempt of 3 failed." >&2
  [ "$attempt" -lt 3 ] && sleep 20
done
echo "::error::Could not pull $image in three attempts; docker's own error is above. The backend suite cannot start a database without it. See #285."
exit 1

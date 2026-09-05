#!/usr/bin/env bash
# Regenerate the v2 visual baselines on Linux, matching CI.
#
# Playwright names a snapshot after the platform it was taken on, because a
# screenshot from Windows and one from Linux differ in font rasterisation and
# scrollbar width — they are genuinely different images of the same page. CI
# runs on Linux, so Linux is the only platform whose baselines gate anything,
# and it is the only set this repo keeps.
#
# Run this from the repo root after changing anything a snapshot covers:
#
#   bash scripts/snapshots-linux.sh
#
# It needs Docker. The image is the official Playwright one, pinned to the
# version in package-lock — a mismatched browser build produces diffs that look
# like real regressions and are not.
#
# The repo is COPIED into the container rather than mounted for writing, so the
# host's Windows-built node_modules is never touched by a Linux `npm ci`. Only
# the generated PNGs come back.
set -euo pipefail

# MUST match the `container.image` of the `visual` job in
# .github/workflows/ci.yml. That job is what these baselines are compared
# against; a different image has different fonts, and the diff then looks like
# a regression that is really just a different machine.
IMAGE="mcr.microsoft.com/playwright:v1.61.1-noble"
# Every `*-snapshots` directory under e2e/v2, not just the foundation's own.
# Each screen stream keeps its baselines beside its spec — `home.spec.ts` has
# `home.spec.ts-snapshots` — and an earlier version of this script copied out of
# one hardcoded directory, so it generated every stream's Linux baselines inside
# the container and then threw all but one set away.
OUT="e2e/v2"

INSTALLED="$(node -p "require('./node_modules/@playwright/test/package.json').version")"
if [[ "$IMAGE" != *"v${INSTALLED}-"* ]]; then
  echo "WARNING: image is $IMAGE but @playwright/test is $INSTALLED." >&2
  echo "         Update the tag here AND in .github/workflows/ci.yml." >&2
fi

echo "==> image: $IMAGE"
docker pull -q "$IMAGE"

mkdir -p "$OUT"

docker run --rm \
  -v "$(pwd)":/host:ro \
  -v "$(pwd)/$OUT":/out \
  -w /build \
  "$IMAGE" \
  bash -eu -c '
    echo "==> copying repo (without node_modules)"
    mkdir -p /build
    tar -C /host --exclude=./node_modules --exclude=./dist --exclude=./.git -cf - . | tar -C /build -xf -

    echo "==> installing"
    npm ci --no-audit --no-fund --silent

    echo "==> generating snapshots"
    # Same selection the CI job runs, so there is one definition of "the visual
    # specs" rather than two that drift.
    npm run snapshots --silent

    echo "==> exporting linux baselines"
    found=0
    for dir in /build/e2e/v2/*-snapshots; do
      [ -d "$dir" ] || continue
      name=$(basename "$dir")
      ls "$dir"/*-linux.png >/dev/null 2>&1 || continue
      mkdir -p "/out/$name"
      cp -v "$dir"/*-linux.png "/out/$name/"
      found=1
    done
    [ "$found" = 1 ] || { echo "no -linux.png produced — did the specs run?" >&2; exit 1; }
  '

echo "==> done. Linux baselines:"
ls -1 "$OUT"/*-snapshots/*-linux.png | sed 's/^/    /'

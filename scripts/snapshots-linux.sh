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

VERSION="$(node -p "require('./node_modules/@playwright/test/package.json').version")"
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"
OUT="e2e/v2/visual.spec.ts-snapshots"

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
    # Not CI=true: that turns a missing snapshot into a hard failure, and
    # generating them is the entire point of this run.
    npx playwright test \
      --project=v2-phone --project=v2-desktop \
      e2e/v2/visual.spec.ts --update-snapshots

    echo "==> exporting linux baselines"
    cp -v /build/e2e/v2/visual.spec.ts-snapshots/*-linux.png /out/
  '

echo "==> done. Linux baselines in $OUT:"
ls -1 "$OUT" | sed 's/^/    /'

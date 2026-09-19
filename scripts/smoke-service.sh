#!/bin/bash
# Manual smoke test: keep the feature service's parent pipe open, verify that
# it publishes startup frames, then terminate it through its signal path.
set -u
BIN=$(swift build --package-path native/moirasia-runtime -c debug --show-bin-path)
TMPD=$(mktemp -d)
FIFO="$TMPD/parent.pipe"
OUT="$TMPD/service.out"
ERR="$TMPD/service.err"
mkfifo "$FIFO"
cleanup() { exec 3>&- 2>/dev/null || true; rm -rf "$TMPD"; }
trap cleanup EXIT
"$BIN/MoirasiaFeatureService" --stdio --user-data "$TMPD" --bonded-helper native/staged/features/bonded/native/BondedFirewallHelper < "$FIFO" > "$OUT" 2> "$ERR" &
SVCPID=$!
# Opening a writer keeps stdin alive after the service installs its EOF handler.
exec 3>"$FIFO"
sleep 2
kill -TERM "$SVCPID" 2>/dev/null || true
wait "$SVCPID" 2>/dev/null || true
head -c 3000 "$OUT"
echo
echo "---stderr---"
head -c 500 "$ERR"

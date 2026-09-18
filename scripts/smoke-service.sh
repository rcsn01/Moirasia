#!/bin/bash
# Manual smoke test: run the feature service, capture its startup output, then stop it.
set -u
BIN=$(swift build --package-path native/moirasia-runtime -c debug --show-bin-path)
TMPD=$(mktemp -d)
"$BIN/MoirasiaFeatureService" --stdio --user-data "$TMPD" --bonded-helper native/staged/features/bonded/native/BondedFirewallHelper < /dev/null > native/staged/smoke-service.out 2> native/staged/smoke-service.err &
SVCPID=$!
sleep 2
kill -TERM "$SVCPID" 2>/dev/null
wait "$SVCPID" 2>/dev/null
head -c 3000 native/staged/smoke-service.out
echo
echo "---stderr---"
head -c 500 native/staged/smoke-service.err
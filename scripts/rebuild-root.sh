#!/bin/bash
set -euo pipefail
cd /Users/mac/Syncthing/Projects/Moirasia
find out -user root -delete 2>/dev/null || true
find out -depth -user root -exec rm -rf {} + 2>/dev/null || true
find out -user root | head -3
echo CLEANED
pnpm build
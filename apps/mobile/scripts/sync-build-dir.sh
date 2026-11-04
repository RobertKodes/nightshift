#!/bin/bash
# Copies the app to the short build folder (NIGHTSHIFT_BUILD_DIR, default C:\m) and installs its packages
# there when the lockfile changed. Windows' 260-character path limit breaks the C++ builds from the repo's deep path;
# the copy builds from a short real path. Source stays in the repo: edit there, run this, then build.
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST="${NIGHTSHIFT_BUILD_DIR:-/c/m}"
mkdir -p "$DST"
W="$(cygpath -w "$SRC")"
WD="$(cygpath -w "$DST")"
# Mirror the sources. Only the top-level node_modules, android and .expo are left out (full paths, on both sides),
# so modules/device-key/android comes along; build outputs anywhere are skipped.
MSYS2_ARG_CONV_EXCL="*" MSYS_NO_PATHCONV=1 robocopy "$W" "$WD" /MIR /NFL /NDL /NJH /NJS /NP \
  /XD "$W\node_modules" "$W\android" "$W\.expo" "$WD\node_modules" "$WD\android" "$WD\.expo" .kotlin build .cxx > /dev/null || [ $? -lt 8 ]
if [ ! -d "$DST/node_modules" ] || ! cmp -s "$DST/package-lock.json" "$DST/node_modules/.installed-lock.json"; then
  (cd "$DST" && npm ci --no-audit --no-fund && cp package-lock.json node_modules/.installed-lock.json)
fi
echo "synced to $DST"

#!/usr/bin/env bash
# NIGHT WATCH, one command:  curl -fsSL https://getnightshift.tech/nightwatch/install.sh | bash
# Downloads the bot into ~/nightwatch (or $NIGHTWATCH_DIR), installs it, makes a fresh keeper wallet and
# prints the link that pairs it to your seat. Nothing is sent onchain; the bot runs report-only until --execute.
set -euo pipefail
SITE="${NIGHTWATCH_SITE:-https://getnightshift.tech}"
DIR="${NIGHTWATCH_DIR:-$HOME/nightwatch}"
FILES="bot.mjs lib/chain.mjs lib/coordinator.mjs lib/plan.mjs package.json package-lock.json .env.example nightwatch.service README.md test/plan.test.mjs"

command -v node >/dev/null 2>&1 || { echo "Install Node.js 20 or newer first: https://nodejs.org"; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || { echo "Node.js 20 or newer is needed (this is $(node -v))."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is missing: it comes with Node.js."; exit 1; }

echo "Installing the Night Watch bot into $DIR"
mkdir -p "$DIR/lib" "$DIR/test" "$DIR/state"
for f in $FILES; do curl -fsSL "$SITE/nightwatch/$f" -o "$DIR/$f"; done
cd "$DIR"
npm install --omit=dev --no-audit --no-fund --loglevel=error
echo
# reads the keeper from .env, or makes one; prints the pairing link and waits for the signature
exec node bot.mjs start

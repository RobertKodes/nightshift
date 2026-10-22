#!/usr/bin/env bash
# NIGHT WATCH on a fresh Ubuntu/Debian server (VPS). Run as root, once. Cloud-init runs it for you at first boot
# (see cloud-init.yaml), or:  curl -fsSL https://getnightshift.tech/nightwatch/vps-setup.sh | sudo bash
#
# What it does: installs Node.js 22, makes an unprivileged user "nightwatch", downloads the bot, makes a fresh keeper
# wallet ON THIS SERVER (its key stays in /home/nightwatch/nightwatch/.env, mode 600), starts the bot as a systemd
# service in REPORT-ONLY mode (it sends nothing onchain), and writes your pairing link where you can read it:
# the provider's console log, the login banner, /home/nightwatch/PAIR-LINK.txt, and the command: nightwatch-link
# NIGHTSHIFT never sees the key. Turn live mode on yourself later: nightwatch-live
set -euo pipefail
SITE="${NIGHTWATCH_SITE:-https://getnightshift.tech}"
U=nightwatch
HOME_DIR="/home/$U"
DIR="$HOME_DIR/nightwatch"
FILES="bot.mjs lib/chain.mjs lib/coordinator.mjs lib/plan.mjs package.json package-lock.json .env.example README.md test/plan.test.mjs"

[ "$(id -u)" = 0 ] || { echo "Run this as root (use sudo)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive
say() { echo "[nightwatch] $*"; }

command -v curl >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq curl ca-certificates >/dev/null; }
command -v openssl >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq openssl >/dev/null; }
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  say "installing Node.js 22"
  apt-get update -qq
  apt-get install -y -qq gnupg >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

id "$U" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$U"

say "downloading the bot into $DIR"
install -d -o "$U" -g "$U" "$DIR" "$DIR/lib" "$DIR/test" "$DIR/state"
for f in $FILES; do curl -fsSL "$SITE/nightwatch/$f" -o "$DIR/$f"; done
chown -R "$U:$U" "$DIR"
su - "$U" -c "cd '$DIR' && npm install --omit=dev --no-audit --no-fund --loglevel=error"

# the keeper wallet is made here, on this server, and never leaves it
if ! grep -qs '^KEEPER_PRIVATE_KEY=\|^KEEPER_MNEMONIC=' "$DIR/.env"; then
  ( umask 077
    printf '# The keeper wallet of this Night Watch bot. It never leaves this server: back it up, never share it.\nKEEPER_PRIVATE_KEY=0x%s\n' "$(openssl rand -hex 32)" > "$DIR/.env" )
fi
chown "$U:$U" "$DIR/.env"; chmod 600 "$DIR/.env"

cat > /etc/systemd/system/nightwatch.service <<UNIT
[Unit]
Description=NIGHT WATCH keeper (Night Watcher seat)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$U
WorkingDirectory=$DIR
# REPORT-ONLY: nightwatch-live adds --execute, only after you have watched it and funded the keeper
ExecStart=/usr/bin/env node bot.mjs
Restart=always
RestartSec=30
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$DIR/state
MemoryMax=450M

[Install]
WantedBy=multi-user.target
UNIT

# helper commands
cat > /usr/local/bin/nightwatch-link <<HELP
#!/bin/sh
# prints the keeper address and the pairing link
cat $HOME_DIR/PAIR-LINK.txt
HELP
cat > /usr/local/bin/nightwatch-live <<'HELP'
#!/bin/sh
# switches the bot from report-only to live: it will send transactions with the keeper wallet
[ "$(id -u)" = 0 ] || exec sudo "$0" "$@"
sed -i 's|^ExecStart=.*|ExecStart=/usr/bin/env node bot.mjs --execute|' /etc/systemd/system/nightwatch.service
systemctl daemon-reload && systemctl restart nightwatch && echo "Live mode is ON. Back to watching only: nightwatch-report-only"
HELP
cat > /usr/local/bin/nightwatch-report-only <<'HELP'
#!/bin/sh
[ "$(id -u)" = 0 ] || exec sudo "$0" "$@"
sed -i 's|^ExecStart=.*|ExecStart=/usr/bin/env node bot.mjs|' /etc/systemd/system/nightwatch.service
systemctl daemon-reload && systemctl restart nightwatch && echo "Report-only mode: nothing is sent."
HELP
cat > /usr/local/bin/nightwatch-check <<HELP
#!/bin/sh
# the bot's own health check: gas, imdUSD, pairing, seat
cd $DIR && exec sudo -u $U node bot.mjs doctor
HELP
chmod 755 /usr/local/bin/nightwatch-link /usr/local/bin/nightwatch-live /usr/local/bin/nightwatch-report-only /usr/local/bin/nightwatch-check

systemctl daemon-reload
systemctl enable --now nightwatch >/dev/null 2>&1

# the pairing link, where you can find it
KEEPER="$(cd "$DIR" && su "$U" -c "node bot.mjs pair" 2>/dev/null | sed -n 's/^Keeper wallet: //p' | head -1)"
{
  echo "NIGHT WATCH keeper wallet: $KEEPER"
  echo "Send it about 0.03 ETH for gas (Ethereum mainnet), then pair it: open this link, connect the wallet that holds your Night Watcher, sign."
  echo
  echo "  $SITE/watch?pair=$KEEPER"
  echo
  echo "The bot is running in REPORT-ONLY mode: it sends nothing. Show this again any time: nightwatch-link"
} > "$HOME_DIR/PAIR-LINK.txt"
chown "$U:$U" "$HOME_DIR/PAIR-LINK.txt"
cp "$HOME_DIR/PAIR-LINK.txt" /etc/motd
{ echo; echo "=========== NIGHT WATCH ==========="; cat "$HOME_DIR/PAIR-LINK.txt"; echo "==================================="; } | tee /dev/console 2>/dev/null || cat "$HOME_DIR/PAIR-LINK.txt"
say "done"

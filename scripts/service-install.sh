#!/bin/bash

set -euo pipefail

NODE_PATH="${NODE_PATH:-$(command -v node || true)}"

if [ -z "$NODE_PATH" ]; then
  echo "error: node binary not found (set NODE_PATH to override)" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "error: writing the unit file needs root - re-run with sudo" >&2
  exit 1
fi

SERVICE_NAME="nura-swap"

# The repo root, and the server half inside it. The server IS the service: it runs the API, the
# indexer, and in production serves the built client itself, so there is only ever one unit.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_PATH="$ROOT/server"

# No build step for the server - Node >= 24 runs the TypeScript source directly, exactly as the
# Dockerfile does. WorkingDirectory is the SERVER directory, not the repo root: main.ts reads
# `.env` from the working directory, and CLIENT_DIR/SSR_ENTRY are written relative to it.
SERVICE_PATH_APP="src/main.ts"

# ProtectHome= hides /home and /root from the service. That is free hardening for a
# deployment under /srv or /opt, and a service that cannot start anywhere else: the
# WorkingDirectory below would vanish from the unit's own view and systemd fails it
# with 200/CHDIR before it runs a line. This installer follows the repo wherever it
# sits, so the directive is emitted only where it cannot bite.
case "$ROOT" in
    /home/*|/root/*|/home|/root) PROTECT_HOME="# ProtectHome is unset: this repo lives under $ROOT, which it would hide." ;;
    *) PROTECT_HOME="ProtectHome=true" ;;
esac

SERVICE_DIR="${SERVICE_DIR:-/etc/systemd/system}"
SERVICE_FILE="$SERVICE_DIR/${SERVICE_NAME}.service"

# The CLIENT half does have a build step, and production imports the SSR bundle at boot - a
# missing one is a service that restart-loops. Say so here rather than in the log at 3am.
if [ ! -f "$ROOT/application/dist-server/entry.server.js" ]; then
  echo "warning: application/dist-server/entry.server.js is missing - run 'npm run build' before starting" >&2
fi

if [ ! -f "$SERVICE_PATH/.env" ]; then
  echo "warning: server/.env is missing - the service would boot against the defaults, not your chain" >&2
fi

# systemd does not create the directory it is told to log into.
mkdir -p "$SERVICE_PATH/logs"

echo "> Installing systemd service (${SERVICE_FILE})..."

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Nura Swap
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Restart=always
RestartSec=5
# The floor, so a box with no .env still runs the PRODUCTION path - without it the
# server serves no SSR and attaches the devtools bridge. The file below overrides.
Environment=NODE_ENV=production
# Optional (the leading '-'): this installer only warns about a missing .env,
# where the checked-in unit assumes one and would refuse to start without it.
EnvironmentFile=-$SERVICE_PATH/.env
WorkingDirectory=$SERVICE_PATH
# Quoted: systemd splits ExecStart on whitespace, and an interpreter installed under a path with
# a space in it (nvm on some setups, /opt installs) would otherwise be read as two arguments.
ExecStart="$NODE_PATH" $SERVICE_PATH_APP

StandardOutput=file:$SERVICE_PATH/logs/service_output.log
StandardError=file:$SERVICE_PATH/logs/service_error.log

# The path-independent half of deploy/nuraswap.service. Its User=, ProtectSystem=strict
# and ReadWritePaths= are deliberately NOT copied: they are written against the fixed
# /srv/nuraswap layout, and this installer runs against whatever directory it is in -
# a strict sandbox with the wrong ReadWritePaths is a service that cannot open its
# database. Use the checked-in unit for the hardened, fixed-path deployment.
NoNewPrivileges=true
PrivateTmp=true
$PROTECT_HOME

LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

systemctl enable "$SERVICE_NAME"

echo "> Service Installed."

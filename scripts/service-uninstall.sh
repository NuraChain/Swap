#!/bin/bash

set -euo pipefail

SERVICE_NAME="nura-swap"

SERVICE_DIR="${SERVICE_DIR:-/etc/systemd/system}"
SERVICE_FILE="$SERVICE_DIR/${SERVICE_NAME}.service"

echo "> Removing Service (${SERVICE_FILE})..."

systemctl stop "$SERVICE_NAME" || true

systemctl disable "$SERVICE_NAME" || true

rm -f "$SERVICE_FILE"

systemctl daemon-reload

echo "> Service Removed."

#!/usr/bin/env bash
# Build locally, ship, restart. Run from the repository root:
#   ./deploy/deploy.sh user@host
#
# What ships: the built client, the SSR bundle, the server sources (Node runs the
# TypeScript directly), the shared workspace, and the deployment artifacts. What
# does not: node_modules (installed on the host), .env (lives on the host only),
# and the sqlite database (host state).
set -euo pipefail

TARGET="${1:?usage: deploy.sh user@host}"
REMOTE_DIR="${REMOTE_DIR:-/srv/nuraswap}"

echo "==> gates"
npx azeroth check
npx azeroth test
npm test --workspace shared

echo "==> build"
npx azeroth build

echo "==> ship to ${TARGET}:${REMOTE_DIR}"
rsync -az --delete \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude 'logs' \
    application/dist application/dist-server \
    "${TARGET}:${REMOTE_DIR}/application/"
rsync -az --delete --exclude 'node_modules' --exclude '.env' --exclude 'logs' \
    server/src server/package.json "${TARGET}:${REMOTE_DIR}/server/"
rsync -az --delete --exclude 'node_modules' \
    shared/src shared/deployments shared/package.json "${TARGET}:${REMOTE_DIR}/shared/"
rsync -az package.json package-lock.json "${TARGET}:${REMOTE_DIR}/"

echo "==> install and restart"
ssh "${TARGET}" "cd ${REMOTE_DIR} && npm ci --omit=dev && sudo systemctl restart nuraswap"

echo "==> health"
ssh "${TARGET}" "curl -fsS http://127.0.0.1:3000/api/healthz" && echo

echo "Deployed. Rollback: redeploy the previous commit - the database and .env are untouched by this script."

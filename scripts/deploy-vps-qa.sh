#!/usr/bin/env bash
# Deploy do Nevo QA no VPS (pasta /opt/nevo-qa, PM2 nevo-qa).
# Uso: no VPS, na pasta do projeto QA: ./scripts/deploy-vps-qa.sh
# Ou: PROJECT_DIR=/opt/nevo-qa ./scripts/deploy-vps-qa.sh

set -e

PROJECT_DIR="${PROJECT_DIR:-/opt/nevo-qa}"
RESTART_CMD="${RESTART_CMD:-pm2 restart nevo-qa}"
BRANCH="${BRANCH:-feature/assistente-pessoal-orcamento}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [ -n "${PROJECT_DIR}" ] && [ -d "${PROJECT_DIR}" ]; then
  ROOT_DIR="$(cd "${PROJECT_DIR}" && pwd)"
fi

cd "${ROOT_DIR}"
echo "[deploy-vps-qa] Pasta: ${ROOT_DIR} | Branch: ${BRANCH}"
echo ""

echo "[deploy-vps-qa] 1/4 Git fetch e pull..."
git fetch origin
git pull origin "${BRANCH}"
echo ""

echo "[deploy-vps-qa] 2/4 npm ci..."
npm ci
echo ""

echo "[deploy-vps-qa] 3/4 npm run build..."
export CI=1
export NEXT_TELEMETRY_DISABLED=1
# Reduz picos de memoria no build do Next em VPS menores.
export NEXT_PRIVATE_BUILD_WORKER=1
NODE_MAX_OLD_SPACE_SIZE="${NODE_MAX_OLD_SPACE_SIZE:-2048}"
export NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE}"
npx next build --no-lint
echo ""

echo "[deploy-vps-qa] 4/4 Reiniciando: ${RESTART_CMD}"
eval "${RESTART_CMD}"
echo ""

echo "[deploy-vps-qa] Concluído. App QA: https://nevoqa.pratikapp.com.br"

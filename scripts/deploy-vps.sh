#!/usr/bin/env bash
# Deploy no VPS: pull, build e restart.
# Uso: no VPS, dentro da pasta do projeto: ./scripts/deploy-vps.sh
# Ou: bash /caminho/do/nevo/scripts/deploy-vps.sh

set -e

# --- Configure aqui (ou exporte antes de rodar) ---
# Pasta do projeto no VPS (padrão: /opt/nevo)
PROJECT_DIR="${PROJECT_DIR:-/opt/nevo}"
# Comando para reiniciar o app (no seu VPS o Nevo está no PM2 com id 0; use sudo se precisar)
# Ex.: "sudo pm2 restart 0" ou "pm2 restart nevo" ou "sudo systemctl restart nevo"
RESTART_CMD="${RESTART_CMD:-sudo pm2 restart 0}"
# Branch para dar pull
BRANCH="${BRANCH:-master}"
# --- Fim da configuração ---

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# Se rodar por SSH remoto (ex.: ssh user@vps "bash -s" < deploy-vps.sh), pode não ter scripts/ no path; usa PROJECT_DIR
if [ -n "${PROJECT_DIR}" ] && [ -d "${PROJECT_DIR}" ]; then
  ROOT_DIR="$(cd "${PROJECT_DIR}" && pwd)"
fi

cd "${ROOT_DIR}"
echo "[deploy-vps] Pasta do projeto: ${ROOT_DIR}"
echo "[deploy-vps] Branch: ${BRANCH}"
echo ""

echo "[deploy-vps] 1/4 Git fetch e pull..."
git fetch origin
git pull origin "${BRANCH}"
echo ""

echo "[deploy-vps] 2/4 npm ci..."
npm ci
echo ""

echo "[deploy-vps] 3/4 npm run build..."
npm run build
echo ""

echo "[deploy-vps] 4/4 Reiniciando app: ${RESTART_CMD}"
eval "${RESTART_CMD}"
echo ""

echo "[deploy-vps] Concluído."

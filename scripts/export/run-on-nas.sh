#!/bin/sh
# 喺 NAS（Synology／QNAP／任何有 Docker 嘅機）每日行一次，將屋企通資料匯出去 NAS。
# 用法：sh run-on-nas.sh <repo 資料夾> <service-account.json> <輸出資料夾>
# 例如：sh /volume1/homes/me/family-shoppinglist/scripts/export/run-on-nas.sh \
#         /volume1/homes/me/family-shoppinglist /volume1/homes/me/home-hub-sa.json /volume1/backup/home-hub
set -eu
REPO="${1:?repo 資料夾}"
SA="${2:?service account .json}"
OUT="${3:?輸出資料夾}"
mkdir -p "$OUT"

if command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "$REPO":/repo:ro \
    -v "$SA":/secrets/sa.json:ro \
    -v "$OUT":/out \
    -e FIREBASE_SERVICE_ACCOUNT_FILE=/secrets/sa.json \
    -e OUT_DIR=/out \
    node:22-alpine sh -c 'mkdir -p /tmp/app/scripts && cp -r /repo/scripts/export /tmp/app/scripts/ && cp -r /repo/public /tmp/app/ && cd /tmp/app/scripts/export && rm -rf node_modules && npm ci --omit=dev --silent && node export.mjs'
else
  # 冇 Docker：用 NAS 上面嘅 Node.js（要 18 或以上）
  cd "$REPO/scripts/export"
  npm ci --omit=dev --silent
  FIREBASE_SERVICE_ACCOUNT_FILE="$SA" OUT_DIR="$OUT" node export.mjs
fi

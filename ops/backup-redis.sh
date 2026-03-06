#!/usr/bin/env bash
set -euo pipefail

: "${REDIS_URL:?REDIS_URL is required}"

BACKUP_DIR="${BACKUP_DIR:-./backups/redis}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/redis-${TS}.rdb"

mkdir -p "${BACKUP_DIR}"

echo "[backup-redis] writing ${OUT_FILE}"
redis-cli --tls -u "${REDIS_URL}" --rdb "${OUT_FILE}" >/dev/null 2>&1 || redis-cli -u "${REDIS_URL}" --rdb "${OUT_FILE}"

echo "[backup-redis] done"

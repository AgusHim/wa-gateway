#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="${1:-}"
REDIS_DATA_DIR="${REDIS_DATA_DIR:-./data/redis}"

if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Usage: $0 <backup-file.rdb>"
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

mkdir -p "${REDIS_DATA_DIR}"
cp "${BACKUP_FILE}" "${REDIS_DATA_DIR}/dump.rdb"

echo "[restore-redis] dump copied to ${REDIS_DATA_DIR}/dump.rdb"
echo "[restore-redis] restart Redis service to apply restore"

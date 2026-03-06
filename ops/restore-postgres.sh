#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_FILE="${1:-}"
if [[ -z "${BACKUP_FILE}" ]]; then
  echo "Usage: $0 <backup-file.dump>"
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

echo "[restore-postgres] restoring ${BACKUP_FILE}"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "${DATABASE_URL}" "${BACKUP_FILE}"

echo "[restore-postgres] done"

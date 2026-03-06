#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

BACKUP_DIR="${BACKUP_DIR:-./backups/postgres}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/pg-${TS}.dump"

mkdir -p "${BACKUP_DIR}"

echo "[backup-postgres] writing ${OUT_FILE}"
pg_dump "${DATABASE_URL}" --format=custom --no-owner --no-privileges --file "${OUT_FILE}"

echo "[backup-postgres] done"

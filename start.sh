#!/bin/sh
set -e

if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "[start] Running prisma migrate deploy"
  npx prisma migrate deploy
else
  echo "[start] No migrations found, running prisma db push"
  npx prisma db push
fi

if [ "${SKIP_DB_SEED}" != "true" ]; then
  echo "[start] Running database seed"
  if ! npm run db:seed; then
    echo "[start] Seed failed, continuing startup (non-blocking)"
  fi
fi

echo "[start] Starting Next.js server"
exec npm run start

#!/bin/sh
set -e

echo "[start] Running prisma migrate deploy"
npx prisma migrate deploy

if [ "${SKIP_DB_SEED}" != "true" ]; then
  echo "[start] Running database seed"
  npm run db:seed
fi

echo "[start] Starting Next.js server"
exec npm run start

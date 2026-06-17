#!/bin/sh
set -e

# --- Wait for database to be truly ready ---
MAX_RETRIES=30
RETRY_INTERVAL=2
attempt=0

echo "[start] Waiting for database connection..."
until npx prisma db execute --stdin <<< "SELECT 1" > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$MAX_RETRIES" ]; then
    echo "[start] ERROR: Database not reachable after $MAX_RETRIES attempts. Exiting."
    exit 1
  fi
  echo "[start] Database not ready yet (attempt $attempt/$MAX_RETRIES). Retrying in ${RETRY_INTERVAL}s..."
  sleep "$RETRY_INTERVAL"
done
echo "[start] Database connection established."

# --- Run migrations ---
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "[start] Running prisma migrate deploy"
  npx prisma migrate deploy
else
  echo "[start] No migrations found, running prisma db push"
  npx prisma db push
fi

echo "[start] Starting Next.js server"
exec npm run start

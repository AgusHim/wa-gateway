# WhatsApp AI Gateway

## Development

1. Copy env file:
   ```bash
   cp .env.example .env
   ```
2. Start infra only:
   ```bash
   docker compose up -d postgres redis
   ```
3. Run Prisma generate and migrate:
   ```bash
   npx prisma generate
   npx prisma migrate dev
   npm run db:seed
   ```
4. Start app:
   ```bash
   npm run dev
   ```

## Production with Docker Compose

Run all services (Postgres, Redis, App):

```bash
docker compose up -d --build
```

The app container startup flow (`start.sh`):
1. `prisma migrate deploy`
2. Optional seed (skip when `SKIP_DB_SEED=true`)
3. `next start`

## Important Environment Variables

- `DATABASE_URL`
- `REDIS_URL`
- `GOOGLE_API_KEY`
- `NEXTAUTH_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

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

Data persistence:
- Postgres data is stored in `./.docker-data/postgres`
- Redis data is stored in `./.docker-data/redis`
- `docker compose down` will not remove this data
- To reset data intentionally, remove `./.docker-data`

### VPS Production (pull image from Docker Hub)

1. Build and push image from local:
   ```bash
   docker build -t gushim/wa-buzzerp:latest .
   docker push gushim/wa-buzzerp:latest
   ```
2. In VPS, prepare env:
   ```bash
   cp .env.production.example .env.production
   ```
3. Deploy on VPS:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d
   ```
4. Update release on VPS:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml pull app
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d app
   ```

The app container startup flow:
1. `next start` only (no automatic Prisma migration/seed)

Manual migration via SQL (example):
```bash
docker exec -i wa-gateway-postgres psql -U postgres -d wa_gateway < prisma/migrations/<timestamp>/migration.sql
```

## Important Environment Variables

- `DATABASE_URL`
- `REDIS_URL`
- `GOOGLE_API_KEY`
- `NEXTAUTH_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

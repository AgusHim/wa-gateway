# Domain 8 - Observability, Analytics, dan Billing (Instagram)

Dokumen ini merangkum implementasi Domain 8 pada integrasi Instagram CRM.

## 8.1 Observability

### Metric Instagram
- Tambah metrik ingest webhook Instagram di `src/lib/observability/metrics.ts`:
  - `instagram_webhook_ingest_total`
  - `instagram_webhook_ingest_accepted`
  - `instagram_webhook_ingest_duplicate`
  - `instagram_webhook_ingest_skipped`
- Tambah dimensi provider untuk metrik latency dan delivery:
  - `provider:instagram:ai_latency_*`
  - `provider:instagram:delivery_*`
- Worker Instagram sekarang mencatat:
  - queue lag (`recordQueueLag`)
  - throughput processed/failed (`recordWorkerThroughput`)

### Correlation ID end-to-end
- Webhook ingestion menggunakan `eventId` sebagai `correlationId` dan `ig-uuid` sebagai `traceId` di job queue.
- Worker Instagram menjalankan `withObservationContext` dengan context dari job sehingga trace/correlation diteruskan ke `runAgent` dan outbound client.
- Outbound Graph API menulis structured log request/retry/failure/success dengan context aktif.

### Structured logging dimensions
- Observation context diperluas dengan:
  - `provider`, `igUserId`, `threadId`, `eventId`, `eventType`.
- Worker dan ingestion log menambahkan dimensi:
  - `workspaceId`, `channelId`, `igUserId`, `threadId`, `eventId`, `eventType`.

## 8.2 Analytics

### Dashboard summary
- `GET /api/analytics/summary` sekarang mengembalikan KPI Instagram:
  - `dmCount`
  - `commentCount`
  - `avgResponseTimeMs`
  - `autoReplyCount`
  - `humanHandledCount`
  - `autoReplyRatio`
- `src/app/(dashboard)/analytics/page.tsx` menampilkan kartu KPI baru.

### Content insight
- Summary analytics menambahkan `instagramContentInsights` (top media):
  - `mediaId`
  - `inboundCommentCount`
  - `botReplyCount`
- Ditampilkan sebagai tabel “Instagram Content Insight (Top Media)”.

### Export CSV
- Tambah endpoint:
  - `GET /api/analytics/instagram/export`
- Mendukung query:
  - `dateFrom`, `dateTo`, `channelId` (opsional)
- Format CSV mencakup metadata Instagram utama (`threadId`, `igUserId`, `commentId`, `mediaId`, status outbound).
- UI analytics menyediakan tombol download CSV dengan date range.

## 8.3 Billing metering

### Usage metric baru
- Prisma `UsageMetric` ditambah:
  - `IG_INBOUND`
  - `IG_OUTBOUND`
  - `IG_COMMENT_REPLY`
- Migrasi: `prisma/migrations/20260314223000_domain8_instagram_usage_metrics/migration.sql`.

### Integrasi plan limits existing
- `billingService` menggabungkan usage pesan total lintas WA+IG:
  - `INBOUND_MESSAGE`, `OUTBOUND_MESSAGE`, `MEDIA_IN`, `MEDIA_OUT`, `IG_INBOUND`, `IG_OUTBOUND`, `IG_COMMENT_REPLY`.
- Limit yang dipakai tetap `messageLimit` plan existing.
- Snapshot billing menampilkan usage IG terpisah:
  - `instagramInbound`, `instagramOutbound`, `instagramCommentReplies`.

### Soft-limit warning dan hard-limit block (Instagram)
- Inbound IG di worker:
  - `consumeUsage(IG_INBOUND)`
  - hard limit: auto-reply dihentikan + audit `instagram_inbound_billing_blocked`
  - soft limit: audit warning `instagram_inbound_soft_limit_warning`
- Outbound IG:
  - DM memakai `IG_OUTBOUND`
  - Reply comment memakai `IG_COMMENT_REPLY`
  - hard limit: outbound ditandai gagal `billing_limit_reached`
  - soft limit: audit warning `instagram_outbound_soft_limit_warning`


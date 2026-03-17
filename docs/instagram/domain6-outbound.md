# Domain 6 - Instagram Outbound Reply API

## Ringkasan
Domain 6 menambahkan jalur outbound Instagram untuk DM dan reply komentar, dengan fokus ke reliability, compliance, dan observability.

## Implementasi Utama

- Client outbound baru: `src/lib/integrations/instagram/client.ts`
  - Kirim DM ke endpoint `/{instagramAccountId}/messages`
  - Reply komentar ke endpoint `/{commentId}/replies`
  - Retry policy (exponential backoff + jitter)
  - Circuit breaker per `workspaceId + channelId + target`
  - Klasifikasi error (`rate_limit`, `server_error`, `auth_error`, `invalid_request`, dll)
  - Optional `appsecret_proof` via `INSTAGRAM_APPSECRET_PROOF_ENABLED`

- Compliance outbound: `src/lib/integrations/instagram/compliance.ts`
  - Policy window untuk DM/comment (configurable via env)
  - Limit panjang balasan (DM/comment)
  - Rate limit per tenant + per channel berbasis Redis

- Worker outbound flow: `src/lib/integrations/instagram/webhookWorker.ts`
  - Setelah `runAgent`, worker mengirim balasan ke Meta API
  - Fallback policy:
    - Error retryable -> throw agar BullMQ retry
    - Error non-retryable -> mark failed tanpa retry
  - Notify operator saat final failure (configurable)

- Delivery tracking:
  - Simpan hasil outbound ke metadata message assistant via `messageRepo.attachInstagramOutboundResultByEventId`
  - Simpan `externalId` message/reply jika sukses
  - Catat `reasonCode` saat gagal

- Webhook outbound event:
  - Emit `MESSAGE_SENT` dengan payload `status: sent|failed`

- Dashboard analytics:
  - `GET /api/analytics/summary` menambahkan metrik `instagramDelivery`
    - `successCount`, `failedCount`, `successRate`
    - `topFailReasons`
  - Halaman analytics menampilkan ringkasan success rate dan top fail reasons

## Environment Variables Tambahan

- `INSTAGRAM_OUTBOUND_MAX_RETRIES` (default `2`)
- `INSTAGRAM_OUTBOUND_RETRY_BASE_MS` (default `600`)
- `INSTAGRAM_OUTBOUND_RETRY_JITTER_MS` (default `200`)
- `INSTAGRAM_OUTBOUND_REQUEST_TIMEOUT_MS` (default `12000`)
- `INSTAGRAM_OUTBOUND_CIRCUIT_FAILURE_THRESHOLD` (default `4`)
- `INSTAGRAM_OUTBOUND_CIRCUIT_RESET_MS` (default `30000`)
- `INSTAGRAM_OUTBOUND_CIRCUIT_SUCCESS_THRESHOLD` (default `1`)
- `INSTAGRAM_APPSECRET_PROOF_ENABLED` (default `false`)
- `INSTAGRAM_DM_POLICY_WINDOW_HOURS` (default `24`)
- `INSTAGRAM_COMMENT_POLICY_WINDOW_HOURS` (default `168`)
- `INSTAGRAM_DM_MAX_REPLY_CHARS` (default `1000`)
- `INSTAGRAM_COMMENT_MAX_REPLY_CHARS` (default `300`)
- `INSTAGRAM_TENANT_RATE_LIMIT_PER_SEC` (default `15`)
- `INSTAGRAM_OUTBOUND_NOTIFY_OPERATOR_ON_FAILURE` (default `true`)


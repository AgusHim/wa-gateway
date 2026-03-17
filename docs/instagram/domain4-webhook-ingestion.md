# Domain 4 - Webhook Ingestion (DM & Comment)

Implementasi Domain 4 untuk Instagram webhook ingestion sudah mencakup verifikasi challenge, validasi signature, normalisasi event, idempotency, queue async, DLQ, dan replay internal.

## Endpoint Webhook

Path publik:

- `GET /api/instagram/webhook`
- `POST /api/instagram/webhook`

### GET verification challenge

Mendukung parameter standar Meta:

- `hub.mode`
- `hub.verify_token`
- `hub.challenge`

Validasi token menggunakan env:

- `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`

Jika valid, endpoint mengembalikan `hub.challenge` (plain text).

### POST receiver + signature

- Signature diverifikasi via header `X-Hub-Signature-256`.
- HMAC SHA-256 dihitung dari raw body menggunakan `INSTAGRAM_APP_SECRET`.
- Jika signature invalid, response `401`.

## Normalisasi Event

Modul: `src/lib/integrations/instagram/webhook.ts`

Normalisasi event didukung untuk:

- DM (`entry.messaging[]`) -> `eventType: instagram-dm`
- Komentar/mention (`entry.changes[]` field `comments|mentions`) -> `eventType: instagram-comment`

Output normalisasi memuat metadata internal standar:

- `eventId`, `eventKey`, `eventType`, `occurredAt`
- `pageId`, `instagramAccountId`
- `igUserId`, `igUsername`
- `threadId`, `commentId`, `mediaId`, `messageId`
- `messageText`, `rawEvent`

## Routing Workspace/Channel

Ingestion service (`webhookIngestion.ts`) melakukan mapping event ke tenant channel berdasarkan:

- `InstagramChannelConfig.pageId`
- `InstagramChannelConfig.instagramAccountId`

Hanya channel aktif (`providerType=INSTAGRAM`, `isEnabled=true`, `status!=removed`) yang diproses.

## Idempotency

Setiap event memiliki kunci unik (`eventKey`) dan dicek via Redis `SET NX` dengan TTL 7 hari:

- key format: `ig:webhook:dedupe:{workspaceId}:{channelId}:{eventKey}`

Event duplikat tidak diproses ulang.

## Async Queue + DLQ

Queue per partition workspace/channel:

- `instagram-webhook-inbound--{workspace}--{channel}`

Dead-letter queue per partition:

- `instagram-webhook-inbound-dlq--{workspace}--{channel}`

Worker:

- `src/lib/integrations/instagram/webhookWorker.ts`
- update `lastWebhookAt` di `InstagramChannelConfig`
- tulis audit event channel untuk observability

Jika job gagal permanen, payload dipindahkan ke DLQ.

## Replay Tool Internal

Endpoint internal replay (butuh session + permission `manage_channel`):

- `POST /api/instagram/webhook/replay`

Body:

```json
{
  "eventId": "igw_xxx"
}
```

Mekanisme:

- Snapshot event disimpan di Redis (`ig:webhook:event:{eventId}`) saat ingest.
- Replay akan mengantrikan ulang payload ke queue Instagram webhook.

## Runtime Bootstrap

Bootstrap sekarang juga menyalakan worker Instagram webhook untuk channel Instagram aktif, selain worker WhatsApp yang sudah ada.

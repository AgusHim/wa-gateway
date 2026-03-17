# Domain 5 - Queue, Worker, dan Orchestration Agent (Instagram)

Implementasi Domain 5 menghubungkan event webhook Instagram ke pipeline agent existing, termasuk batching DM, prioritas event, metadata storage, dan guard human handover.

## 1) Queue Partition Instagram

Queue inbound Instagram dipartisi per tenant channel:

- `instagram-webhook-inbound--{workspaceId}--{channelId}`

DLQ juga dipartisi per tenant channel:

- `instagram-webhook-inbound-dlq--{workspaceId}--{channelId}`

Referensi:

- `src/lib/integrations/instagram/webhookQueue.ts`

## 2) Debounce/Batching untuk DM Burst

DM Instagram menggunakan debounce agar burst pesan dari thread yang sama diproses sebagai satu batch.

File:

- `src/lib/integrations/instagram/inboundDebounce.ts`

Perilaku:

- Hanya event `instagram-dm` yang di-debounce.
- Key debounce: `workspaceId + channelId + threadId/igUserId`.
- Pesan DM dalam window debounce digabung (`\n`) sebelum diproses agent.

Env config:

- `INSTAGRAM_INBOUND_DEBOUNCE_MS` (default `4000`)
- `INSTAGRAM_INBOUND_DEBOUNCE_BUFFER_TTL_MS`

## 3) Prioritization DM > Comment (Configurable)

Prioritas queue diterapkan saat enqueue:

- DM lebih tinggi dari komentar secara default.
- Bisa diatur via env:
  - `INSTAGRAM_DM_PRIORITY_ENABLED` (default `true`)
  - `INSTAGRAM_DM_QUEUE_PRIORITY` (default `1`)
  - `INSTAGRAM_COMMENT_QUEUE_PRIORITY` (default `8`)

Implementasi di:

- `src/lib/integrations/instagram/webhookIngestion.ts`

## 4) Runner Adaptation untuk Source Instagram

`runAgent` sekarang mendukung source:

- `wa-inbound`
- `instagram-dm`
- `instagram-comment`

Perubahan:

- Upsert user via identity channel (`igUserId/username`) untuk Instagram.
- Simpan inbound `Message` dengan metadata event lengkap (`source`, `eventType`, `threadId`, `commentId`, `mediaId`, dll).
- Template context prompt berbeda untuk IG DM vs IG comment saat invoke graph.

Implementasi di:

- `src/agent/runner.ts`
- `src/lib/integrations/instagram/messageMetadata.ts`

## 5) Human Handover Guard per Thread

Sebelum auto-reply, worker mengecek apakah operator manusia sudah membalas thread IG yang sama.

Jika sudah:

- AI auto-reply dihentikan.
- Inbound event tetap disimpan sebagai `Message` (dengan reason skip).
- Handover ticket ditandai pending (sinkron lintas inbox/dashboard).
- Audit log dibuat dengan event skip human override.

Implementasi di:

- `src/lib/integrations/instagram/webhookWorker.ts`
- `src/lib/db/messageRepo.ts` (`hasHumanOperatorReplyInInstagramThreadSince`)

## 6) Bootstrap Runtime

Saat bootstrap, worker Instagram untuk channel aktif ikut dinyalakan bersama worker WA.

Implementasi di:

- `src/agent/bootstrap.ts`

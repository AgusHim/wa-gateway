# Task Breakdown: Instagram CRM + Auto Reply (Comment & DM)

> **Gaya:** Per Domain Produk SaaS | **Level:** Implementasi + Operasional
> **Total Domain:** 11 | Status: `[ ]` todo | `[~]` in progress | `[x]` done
> **Arah:** Extend `wa-gateway` menjadi **omnichannel CRM** dengan integrasi Instagram via **Meta Developer API** untuk auto-reply comment & DM berbasis AI.

---

## Sasaran Produk

- Menghubungkan akun Instagram Business/Creator ke workspace SaaS.
- Menerima event **comment** dan **direct message (DM)** via webhook Meta.
- Memproses pesan/event melalui pipeline queue + AI agent yang sudah ada.
- Mengirim balasan otomatis ke komentar/DM dengan kontrol kebijakan dan human handover.
- Menyediakan inbox dan observability Instagram di dashboard tenant.

---

## Domain 1 - Product Scope & Channel Strategy

### 1.1 Definisi Scope v1
- [x] Scope minimum: auto-reply DM masuk, auto-reply komentar baru, dan escalation ke operator.
- [x] Definisikan non-goal v1 (contoh: no scheduled post publishing, no ads management).
- [x] Definisikan SLA target: webhook ingestion latency, response latency, dan success rate.

### 1.2 Channel Model
- [x] Tetapkan model channel unified: `Channel` mendukung type `whatsapp | instagram`.
- [x] Definisikan identity mapping untuk user IG (`igUserId`, `username`) ke `ChatUser`.
- [x] Definisikan aturan multi-workspace isolation untuk semua data Instagram.

---

## Domain 2 - Meta App, Auth OAuth, dan Credential Lifecycle

### 2.1 Meta Developer App Setup
- [~] Buat app di Meta Developer dan aktifkan produk Instagram Graph / Messaging sesuai use case.
- [~] Konfigurasi app mode (development/live), app domains, privacy policy URL, terms URL.
- [x] Tentukan environment config per stage (dev/staging/prod) untuk App ID/Secret.

### 2.2 OAuth Connection Flow
- [x] Implement OAuth connect dari dashboard: authorize -> callback -> token exchange.
- [x] Simpan credential terenkripsi (`accessToken`, `tokenType`, `expiresAt`, `scopes`, `appScopedUserId`).
- [x] Simpan binding `workspaceId -> channelId -> instagramAccountId -> pageId -> igUserId`.

### 2.3 Token Refresh & Health
- [x] Job scheduler untuk refresh token sebelum expiry + fallback retry/backoff.
- [x] Tandai channel degraded jika token invalid/expired/revoked.
- [x] Tambahkan endpoint/manual action untuk reconnect akun Instagram.

---

## Domain 3 - Data Model & Repository Layer

### 3.1 Prisma Schema
- [x] Tambah enum/type channel untuk Instagram di model channel yang ada.
- [x] Tambah tabel konfigurasi Instagram channel (ig user, page, webhook metadata, token refs).
- [x] Tambah metadata standar message untuk sumber IG: `source`, `eventType`, `commentId`, `mediaId`, `threadId`.

### 3.2 Repository & Guardrails
- [x] Tambah repository `instagramChannelRepo` + strict `workspaceId` scope.
- [x] Tambah helper query conversation berdasarkan `igUserId/threadId`.
- [x] Tambah migration + seed compatibility untuk tenant existing.

---

## Domain 4 - Webhook Ingestion (DM & Comment)

### 4.1 Webhook Endpoint
- [x] Implement `GET` verification challenge (`hub.mode`, `hub.verify_token`, `hub.challenge`).
- [x] Implement `POST` webhook receiver untuk object/event Instagram.
- [x] Verifikasi signature request (`X-Hub-Signature-256`) untuk keamanan payload.

### 4.2 Event Normalization
- [x] Normalisasi event DM masuk menjadi shape inbound internal (setara WA inbound job).
- [x] Normalisasi event komentar baru/mention ke format event internal.
- [x] Filter idempotency dengan event key unik (delivery-safe, no duplicate process).

### 4.3 Reliability
- [x] Ack webhook cepat (< 2s), lalu lanjut proses async via queue.
- [x] Dead-letter queue untuk event gagal permanen.
- [x] Replay tool internal untuk event webhook IG.

---

## Domain 5 - Queue, Worker, dan Orchestration Agent

### 5.1 Inbound Queue Integration
- [x] Tambah queue partition Instagram per `workspaceId + channelId`.
- [x] Reuse pola debounce/batching inbound untuk DM burst.
- [x] Prioritization rules: DM > komentar (opsional, configurable).

### 5.2 Runner Adaptation
- [x] Extend `runAgent` context agar mengenali source `instagram-dm` dan `instagram-comment`.
- [x] Simpan inbound event sebagai `Message` + metadata lengkap channel/event.
- [x] Buat template context prompt untuk komentar vs DM (tone + limits berbeda).

### 5.3 Human Handover Guard
- [x] Terapkan guard: jika operator sudah membalas thread, AI auto-reply dihentikan.
- [x] Sinkronkan status handover lintas inbox dashboard.
- [x] Tambah audit log untuk setiap skip karena human override.

---

## Domain 6 - Outbound Reply API (Send DM & Reply Comment)

### 6.1 Meta Client SDK Layer
- [x] Buat `instagramClient` internal untuk endpoint kirim DM dan reply komentar.
- [x] Tambah retry policy + circuit breaker + klasifikasi error (4xx vs 5xx).
- [x] Tambah support `appsecret_proof` jika diaktifkan pada app security.

### 6.2 Policy & Compliance
- [x] Enforce messaging policy window/limits sesuai aturan Meta untuk DM.
- [x] Rate limit per channel + per tenant untuk anti-spam.
- [x] Fallback policy saat API reject (queue retry, mark failed, notify operator).

### 6.3 Delivery Tracking
- [x] Simpan delivery result dan external message/comment reply ID.
- [x] Webhook event out (sent/failed) untuk integrasi eksternal.
- [x] Dashboard metrics: success rate, fail reason top list.

---

## Domain 7 - CRM Inbox & Dashboard UX

### 7.1 Channel Management UI
- [x] Tambah halaman connect/disconnect Instagram channel.
- [x] Tampilkan status token, scope permissions, last webhook ping.
- [x] Tampilkan audit timeline connect/reconnect/error.

### 7.2 Conversation Inbox
- [x] Tambah filter source channel (`WhatsApp`, `Instagram DM`, `Instagram Comment`).
- [x] Thread view komentar + DM dengan metadata asal konten.
- [x] Tombol takeover operator + toggle auto-reply per thread.

### 7.3 Config Panel
- [x] Rule config auto-reply komentar (keyword/intent/sentiment threshold).
- [x] Rule config auto-reply DM (business hours, fallback, escalation policy).
- [x] Preview & test sandbox untuk simulasi event IG.

---

## Domain 8 - Observability, Analytics, dan Billing

### 8.1 Observability
- [x] Tambah metric IG: webhook ingest rate, queue lag, ai latency, outbound success.
- [x] Correlation ID end-to-end: webhook -> queue -> runner -> outbound API.
- [x] Structured logging dengan dimensi `workspaceId/channelId/igUserId/threadId`.

### 8.2 Analytics
- [x] Dashboard ringkas: jumlah DM/comment, response time, auto vs human ratio.
- [x] Campaign/content insight dasar: post/comment volume yang ditangani bot.
- [x] Export CSV untuk percakapan IG per rentang tanggal.

### 8.3 Billing Metering
- [x] Definisikan usage metric baru jika diperlukan (`IG_INBOUND`, `IG_OUTBOUND`, `IG_COMMENT_REPLY`).
- [x] Integrasi usage ke plan limits existing.
- [x] Soft-limit warning + hard-limit block untuk Instagram traffic.

---

## Domain 9 - Security, Privacy, dan Governance

### 9.1 Credential & Secret Security
- [x] Semua credential Meta disimpan encrypted-at-rest.
- [x] Secret rotation SOP untuk App Secret dan webhook verify token.
- [x] Principle of least privilege: minta scope minimum yang benar-benar dipakai.

### 9.2 Data Privacy
- [x] Definisikan data retention untuk DM/comment event dan media metadata.
- [x] Sediakan data deletion workflow per user bila diminta.
- [x] Redaksi PII untuk log/tool output sesuai policy workspace.

### 9.3 Auditability
- [x] Audit log untuk connect/disconnect channel, refresh token, policy changes.
- [x] Simpan trace untuk pesan yang di-skip karena handover/human override.
- [x] Tambah endpoint internal untuk investigasi incident channel Instagram.

---

## Domain 10 - Testing, Sandbox, dan Quality Gate

### 10.1 Test Strategy
- [x] Unit test: payload parser webhook, signature verification, repo scoping.
- [x] Integration test: webhook DM/comment -> queue -> runner -> outbound mock.
- [x] Contract test untuk Meta API client (request/response mapping).

### 10.2 Staging Validation
- [ ] Siapkan akun IG test + page test untuk staging.
- [ ] Jalankan E2E nyata: comment masuk -> AI reply comment, DM masuk -> AI reply DM.
- [ ] Uji failure mode: token expired, permission missing, rate limit hit.

### 10.3 Quality Gate
- [x] Checklist release: lint/type/test pass, no tenant data leak, no duplicate reply.
- [x] Uji load basic untuk burst inbound event.
- [ ] Sign-off operasional sebelum go-live tenant pertama.

---

## Domain 11 - Launch Readiness & Meta App Review

### 11.1 App Review Preparation
- [x] Siapkan screencast use-case, test credentials, dan review notes untuk Meta.
- [x] Dokumentasikan data usage dan alasan setiap permission.
- [x] Siapkan fallback mode selama app masih development mode.

### 11.2 Rollout Plan
- [x] Soft launch ke internal workspace dulu (pilot).
- [x] Canary rollout ke sebagian tenant.
- [x] Definisikan rollback plan jika webhook/API failure meningkat.

### 11.3 Operasional Pasca Launch
- [x] Monitor 7 hari pertama: error budget, response SLA, policy violations.
- [x] Kumpulkan feedback operator untuk UX inbox IG.
- [x] Iterasi v1.1: quick replies, assignment rules, advanced moderation.

---

## Definition of Done (Instagram v1)

> Status check per 2026-03-16:
> - Item 1-5 sudah `implementation-ready` / `near-ready` dari sisi kode, test lokal, dan dokumentasi.
> - Item 6 masih blocker utama karena butuh E2E staging nyata dan bukti operasional.

- [ ] Tenant bisa connect akun Instagram dari dashboard tanpa intervensi manual engineer. _(Status: partial; flow dashboard+OAuth sudah ada, tapi masih perlu validasi tenant nyata dan app mode/live allowlist yang benar.)_
- [ ] Event DM & comment masuk stabil via webhook dengan idempotency. _(Status: partial; implementasi dan test lokal ada, tetapi “stabil” masih butuh bukti staging.)_
- [ ] Auto-reply AI berjalan untuk DM dan komentar sesuai policy. _(Status: partial; worker/policy sudah jalan di test integration, masih butuh E2E Meta nyata.)_
- [ ] Human override menghentikan auto-reply pada thread yang diambil operator. _(Status: near-ready; code path dan audit sudah ada, namun belum dibuktikan di staging end-to-end.)_
- [ ] Semua event tercatat di inbox, analytics, audit log, dan usage metering. _(Status: near-ready; implementasi sudah kuat lintas Domain 7-9, masih menunggu pembuktian staging terpadu.)_
- [ ] Lulus test E2E staging + siap diajukan/dioperasikan di mode production. _(Status: belum; gunakan runbook `docs/instagram/dod-e2e-staging-runbook.md` untuk menutup item ini.)_

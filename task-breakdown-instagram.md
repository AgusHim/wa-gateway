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
- [ ] Buat app di Meta Developer dan aktifkan produk Instagram Graph / Messaging sesuai use case.
- [ ] Konfigurasi app mode (development/live), app domains, privacy policy URL, terms URL.
- [ ] Tentukan environment config per stage (dev/staging/prod) untuk App ID/Secret.

### 2.2 OAuth Connection Flow
- [ ] Implement OAuth connect dari dashboard: authorize -> callback -> token exchange.
- [ ] Simpan credential terenkripsi (`accessToken`, `tokenType`, `expiresAt`, `scopes`, `appScopedUserId`).
- [ ] Simpan binding `workspaceId -> channelId -> instagramAccountId -> pageId -> igUserId`.

### 2.3 Token Refresh & Health
- [ ] Job scheduler untuk refresh token sebelum expiry + fallback retry/backoff.
- [ ] Tandai channel degraded jika token invalid/expired/revoked.
- [ ] Tambahkan endpoint/manual action untuk reconnect akun Instagram.

---

## Domain 3 - Data Model & Repository Layer

### 3.1 Prisma Schema
- [ ] Tambah enum/type channel untuk Instagram di model channel yang ada.
- [ ] Tambah tabel konfigurasi Instagram channel (ig user, page, webhook metadata, token refs).
- [ ] Tambah metadata standar message untuk sumber IG: `source`, `eventType`, `commentId`, `mediaId`, `threadId`.

### 3.2 Repository & Guardrails
- [ ] Tambah repository `instagramChannelRepo` + strict `workspaceId` scope.
- [ ] Tambah helper query conversation berdasarkan `igUserId/threadId`.
- [ ] Tambah migration + seed compatibility untuk tenant existing.

---

## Domain 4 - Webhook Ingestion (DM & Comment)

### 4.1 Webhook Endpoint
- [ ] Implement `GET` verification challenge (`hub.mode`, `hub.verify_token`, `hub.challenge`).
- [ ] Implement `POST` webhook receiver untuk object/event Instagram.
- [ ] Verifikasi signature request (`X-Hub-Signature-256`) untuk keamanan payload.

### 4.2 Event Normalization
- [ ] Normalisasi event DM masuk menjadi shape inbound internal (setara WA inbound job).
- [ ] Normalisasi event komentar baru/mention ke format event internal.
- [ ] Filter idempotency dengan event key unik (delivery-safe, no duplicate process).

### 4.3 Reliability
- [ ] Ack webhook cepat (< 2s), lalu lanjut proses async via queue.
- [ ] Dead-letter queue untuk event gagal permanen.
- [ ] Replay tool internal untuk event webhook IG.

---

## Domain 5 - Queue, Worker, dan Orchestration Agent

### 5.1 Inbound Queue Integration
- [ ] Tambah queue partition Instagram per `workspaceId + channelId`.
- [ ] Reuse pola debounce/batching inbound untuk DM burst.
- [ ] Prioritization rules: DM > komentar (opsional, configurable).

### 5.2 Runner Adaptation
- [ ] Extend `runAgent` context agar mengenali source `instagram-dm` dan `instagram-comment`.
- [ ] Simpan inbound event sebagai `Message` + metadata lengkap channel/event.
- [ ] Buat template context prompt untuk komentar vs DM (tone + limits berbeda).

### 5.3 Human Handover Guard
- [ ] Terapkan guard: jika operator sudah membalas thread, AI auto-reply dihentikan.
- [ ] Sinkronkan status handover lintas inbox dashboard.
- [ ] Tambah audit log untuk setiap skip karena human override.

---

## Domain 6 - Outbound Reply API (Send DM & Reply Comment)

### 6.1 Meta Client SDK Layer
- [ ] Buat `instagramClient` internal untuk endpoint kirim DM dan reply komentar.
- [ ] Tambah retry policy + circuit breaker + klasifikasi error (4xx vs 5xx).
- [ ] Tambah support `appsecret_proof` jika diaktifkan pada app security.

### 6.2 Policy & Compliance
- [ ] Enforce messaging policy window/limits sesuai aturan Meta untuk DM.
- [ ] Rate limit per channel + per tenant untuk anti-spam.
- [ ] Fallback policy saat API reject (queue retry, mark failed, notify operator).

### 6.3 Delivery Tracking
- [ ] Simpan delivery result dan external message/comment reply ID.
- [ ] Webhook event out (sent/failed) untuk integrasi eksternal.
- [ ] Dashboard metrics: success rate, fail reason top list.

---

## Domain 7 - CRM Inbox & Dashboard UX

### 7.1 Channel Management UI
- [ ] Tambah halaman connect/disconnect Instagram channel.
- [ ] Tampilkan status token, scope permissions, last webhook ping.
- [ ] Tampilkan audit timeline connect/reconnect/error.

### 7.2 Conversation Inbox
- [ ] Tambah filter source channel (`WhatsApp`, `Instagram DM`, `Instagram Comment`).
- [ ] Thread view komentar + DM dengan metadata asal konten.
- [ ] Tombol takeover operator + toggle auto-reply per thread.

### 7.3 Config Panel
- [ ] Rule config auto-reply komentar (keyword/intent/sentiment threshold).
- [ ] Rule config auto-reply DM (business hours, fallback, escalation policy).
- [ ] Preview & test sandbox untuk simulasi event IG.

---

## Domain 8 - Observability, Analytics, dan Billing

### 8.1 Observability
- [ ] Tambah metric IG: webhook ingest rate, queue lag, ai latency, outbound success.
- [ ] Correlation ID end-to-end: webhook -> queue -> runner -> outbound API.
- [ ] Structured logging dengan dimensi `workspaceId/channelId/igUserId/threadId`.

### 8.2 Analytics
- [ ] Dashboard ringkas: jumlah DM/comment, response time, auto vs human ratio.
- [ ] Campaign/content insight dasar: post/comment volume yang ditangani bot.
- [ ] Export CSV untuk percakapan IG per rentang tanggal.

### 8.3 Billing Metering
- [ ] Definisikan usage metric baru jika diperlukan (`IG_INBOUND`, `IG_OUTBOUND`, `IG_COMMENT_REPLY`).
- [ ] Integrasi usage ke plan limits existing.
- [ ] Soft-limit warning + hard-limit block untuk Instagram traffic.

---

## Domain 9 - Security, Privacy, dan Governance

### 9.1 Credential & Secret Security
- [ ] Semua credential Meta disimpan encrypted-at-rest.
- [ ] Secret rotation SOP untuk App Secret dan webhook verify token.
- [ ] Principle of least privilege: minta scope minimum yang benar-benar dipakai.

### 9.2 Data Privacy
- [ ] Definisikan data retention untuk DM/comment event dan media metadata.
- [ ] Sediakan data deletion workflow per user bila diminta.
- [ ] Redaksi PII untuk log/tool output sesuai policy workspace.

### 9.3 Auditability
- [ ] Audit log untuk connect/disconnect channel, refresh token, policy changes.
- [ ] Simpan trace untuk pesan yang di-skip karena handover/human override.
- [ ] Tambah endpoint internal untuk investigasi incident channel Instagram.

---

## Domain 10 - Testing, Sandbox, dan Quality Gate

### 10.1 Test Strategy
- [ ] Unit test: payload parser webhook, signature verification, repo scoping.
- [ ] Integration test: webhook DM/comment -> queue -> runner -> outbound mock.
- [ ] Contract test untuk Meta API client (request/response mapping).

### 10.2 Staging Validation
- [ ] Siapkan akun IG test + page test untuk staging.
- [ ] Jalankan E2E nyata: comment masuk -> AI reply comment, DM masuk -> AI reply DM.
- [ ] Uji failure mode: token expired, permission missing, rate limit hit.

### 10.3 Quality Gate
- [ ] Checklist release: lint/type/test pass, no tenant data leak, no duplicate reply.
- [ ] Uji load basic untuk burst inbound event.
- [ ] Sign-off operasional sebelum go-live tenant pertama.

---

## Domain 11 - Launch Readiness & Meta App Review

### 11.1 App Review Preparation
- [ ] Siapkan screencast use-case, test credentials, dan review notes untuk Meta.
- [ ] Dokumentasikan data usage dan alasan setiap permission.
- [ ] Siapkan fallback mode selama app masih development mode.

### 11.2 Rollout Plan
- [ ] Soft launch ke internal workspace dulu (pilot).
- [ ] Canary rollout ke sebagian tenant.
- [ ] Definisikan rollback plan jika webhook/API failure meningkat.

### 11.3 Operasional Pasca Launch
- [ ] Monitor 7 hari pertama: error budget, response SLA, policy violations.
- [ ] Kumpulkan feedback operator untuk UX inbox IG.
- [ ] Iterasi v1.1: quick replies, assignment rules, advanced moderation.

---

## Definition of Done (Instagram v1)

- [ ] Tenant bisa connect akun Instagram dari dashboard tanpa intervensi manual engineer.
- [ ] Event DM & comment masuk stabil via webhook dengan idempotency.
- [ ] Auto-reply AI berjalan untuk DM dan komentar sesuai policy.
- [ ] Human override menghentikan auto-reply pada thread yang diambil operator.
- [ ] Semua event tercatat di inbox, analytics, audit log, dan usage metering.
- [ ] Lulus test E2E staging + siap diajukan/dioperasikan di mode production.

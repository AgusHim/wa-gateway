# ✅ Task Breakdown: WhatsApp AI Bot SaaS Platform

> **Gaya:** Per Domain Produk SaaS | **Level:** Implementasi + Operasional
> **Total Domain:** 12 | Status: `[ ]` todo · `[~]` in progress · `[x]` done
> **Arah:** Transform `wa-gateway` dari single deployment menjadi **SaaS penyedia layanan WhatsApp bot terintegrasi AI** (multi-tenant, subscription, usage-based, self-service).

---

## 🎯 Sasaran Produk SaaS

- Menyediakan platform self-service untuk bisnis membuat dan mengelola WhatsApp bot AI.
- Mendukung banyak tenant (multi-organization) dalam satu platform.
- Menyediakan paket berlangganan + pembatasan kuota berdasarkan usage.
- Menyediakan observability, reliability, security, dan billing yang siap produksi.

---

## 🧱 Domain 1 — Multi-Tenant Foundation & Data Model

### 1.1 Tenant Strategy
- [x] Baseline aplikasi gateway + dashboard single-instance sudah tersedia.
- [x] Definisikan batas tenant: `Organization -> Workspace -> Channel`.
- [x] Definisikan role: `owner`, `admin`, `operator`, `viewer`.
- [~] Definisikan boundary data isolation (query wajib scoped tenant).

### 1.2 Prisma Schema SaaS
- [x] Model inti existing tersedia (`ChatUser`, `User` auth, `Message`, `Memory`, `Session`, `BotConfig`, `ToolLog`).
- [x] Tambah model `Organization`, `Membership`, `Workspace`, `WorkspaceConfig`.
- [x] Tambah model `Channel` (1 workspace bisa punya banyak nomor WA).
- [x] Tambah foreign key tenant ke model domain chat (`Message`, `Memory`, `ToolLog`, `ChatUser`).
- [x] Tambah unique constraints komposit per-tenant (hindari konflik lintas tenant).
- [x] Tambah indeks query kritikal untuk dashboard tenant.

### 1.3 Data Access Guardrails
- [x] Refactor repository layer agar semua query wajib menerima `tenantId/workspaceId`.
- [x] Tambah helper guard `assertTenantScope` di service layer.
- [x] Tambah test anti data-leak antar tenant.

---

## 🔐 Domain 2 — Identity, Access Control, dan Tenant Onboarding

### 2.1 Auth SaaS
- [x] Login credentials untuk admin internal sudah tersedia.
- [x] Ubah ke auth user tenant (email/password + optional SSO OAuth).
- [x] Implement email verification + reset password.
- [x] Tambah session management per device + revoke session.

### 2.2 RBAC
- [x] Implement membership per organization/workspace.
- [x] Middleware authorization per route dan server action.
- [x] Policy matrix untuk role berbasis aksi (read/write/manage billing/manage channel).

### 2.3 Onboarding Flow
- [x] Wizard buat organization + workspace pertama.
- [x] Invite anggota via email.
- [x] Progress checklist onboarding: connect WA, set persona, test message, go-live.

---

## 💳 Domain 3 — Billing, Plan, dan Usage Metering

### 3.1 Product Catalog
- [x] Definisikan plan: `Free`, `Pro`, `Scale`, `Enterprise`.
- [x] Definisikan limit per plan (messages, AI tokens, channels, seats, tools).
- [x] Simpan konfigurasi plan di DB agar bisa diubah tanpa redeploy.

### 3.2 Subscription Lifecycle
- [x] Integrasi payment provider (Stripe/Xendit/Midtrans, pilih 1 awal).
- [x] Model `Subscription`, `Invoice`, `PaymentEvent`, `BillingProfile`.
- [x] Handle trial, upgrade/downgrade, cancel, grace period.
- [x] Webhook handler pembayaran + retry + idempotency key.

### 3.3 Usage Metering
- [x] Catat usage event real-time (message in/out, token usage, tool call, media).
- [x] Agregasi usage harian/bulanan per workspace.
- [x] Enforce soft-limit (warning) dan hard-limit (block otomatis sesuai plan).
- [x] Tampilkan billing dashboard + invoice history.

---

## 📱 Domain 4 — WhatsApp Channel Management at Scale

### 4.1 Multi-Channel Runtime
- [x] Runtime Baileys + reconnect + session persistence sudah tersedia.
- [x] Refactor runtime untuk banyak channel aktif sekaligus per process.
- [x] Isolasi session per `channelId` + lock untuk mencegah concurrent connect race.
- [x] Channel health monitor (connected, degraded, disconnected, banned-risk).

### 4.2 Provisioning & Lifecycle
- [x] UI add/remove channel per workspace.
- [x] QR onboarding per channel dengan TTL dan status audit.
- [x] Manual takeover / disconnect / reset session per channel.
- [x] Rules nomor tujuan (allowlist/denylist/region policy).

### 4.3 Throughput & Compliance
- [x] Rate limiter outbound per channel dan per tenant.
- [x] Queue partitioning per channel untuk fairness.
- [x] Template policy untuk broadcast/notification use case.

---

## 🧠 Domain 5 — AI Engine as a Service (Tenant-Aware)

### 5.1 Agent Configuration per Tenant
- [x] LangGraph + instruction loader + tool registry sudah tersedia.
- [x] Simpan persona/prompt versioning per workspace.
- [x] Support multi-model routing per workspace (Gemini default + opsi lain).
- [x] Runtime config per workspace: maxTokens, temperature, safety profile.

### 5.2 Memory dan Context Isolation
- [x] Memory extraction + persistence sudah tersedia.
- [x] Scope memory per tenant/workspace/channel/chatUser.
- [x] Retention policy memory + purge schedule.
- [x] PII redaction sebelum disimpan ke memory/log.

### 5.3 Tooling Platform
- [x] Built-in tools dasar sudah tersedia.
- [x] Tambah tool connectors (HTTP, webhook action, CRM simple sync).
- [x] Credential vault per tenant (encrypted at rest).
- [x] Tool permission matrix per role dan per workspace.

---

## ⚙️ Domain 6 — Automation & Bot Product Features

### 6.1 Conversation Features
- [x] Intent routing: FAQ, support, sales, escalation.
- [x] Business hours + auto-reply mode.
- [x] Human handover queue dengan SLA tracking.
- [x] Tagging/segmentasi chat user otomatis.

### 6.2 Campaign & Broadcast
- [x] Segment builder (label + last activity + custom field).
- [x] Scheduled broadcast dengan throttle control.
- [x] Campaign analytics (delivered, replied, conversion proxy).

### 6.3 Knowledge Management
- [x] Upload knowledge source (text/file/url).
- [x] Indexing pipeline + retrieval tool.
- [x] Versioning knowledge base per workspace.

---

## 🔌 Domain 7 — Public API, Webhooks, dan Integrasi Eksternal

### 7.1 API Produk
- [x] Beberapa endpoint internal sudah tersedia.
- [x] Pisahkan internal API vs public customer API.
- [x] API key management per workspace (rotate, revoke, scope).
- [x] Endpoint customer: send message, contact sync, conversation read, usage read.

### 7.2 Webhook Platform
- [x] Outbound webhook events: message.received, message.sent, handover.created, tool.failed.
- [x] Retry policy dengan exponential backoff + dead letter.
- [x] Signature verification dan replay protection.
- [x] Webhook logs viewer + replay manual.

### 7.3 SDK & Developer Experience
- [x] OpenAPI spec + generated SDK (TS/Node).
- [x] Postman collection + contoh end-to-end.
- [x] Sandbox workspace untuk testing integrator.

---

## 🖥️ Domain 8 — SaaS Dashboard & Tenant Portal

### 8.1 Portal Tenant
- [x] Dashboard admin internal sudah tersedia.
- [x] Ubah menjadi tenant-aware dashboard (workspace switcher).
- [x] Halaman organization settings, billing, member management.
- [x] Role-based menu visibility.

### 8.2 Workspace Operations
- [x] Channel management page (status, QR, reconnect, logs).
- [x] Conversation inbox multichannel.
- [x] AI config page per workspace (persona, model, memory, tools).
- [x] Usage & quota page real-time.

### 8.3 Admin Internal (Provider Side)
- [x] Super-admin console untuk monitor semua tenant.
- [x] Manual suspend/unsuspend tenant.
- [x] Revenue, churn, active tenant analytics.

---

## 📈 Domain 9 — Reliability, Observability, dan Scale

### 9.1 Operability
- [x] Structured logging dengan correlation id (`tenantId`, `workspaceId`, `channelId`, `messageId`).
- [x] Metrics: queue lag, worker throughput, AI latency, delivery success rate.
- [x] Tracing pada pipeline utama (WA in -> queue -> agent -> WA out).

### 9.2 Resilience
- [x] Dead-letter queue untuk inbound/outbound yang gagal permanen.
- [x] Circuit breaker untuk provider AI/tool eksternal.
- [x] Backup/restore plan PostgreSQL dan Redis.

### 9.3 Scale Strategy
- [x] Horizontal worker autoscaling.
- [x] Partition strategy untuk queue besar.
- [x] Cache strategy (config, instruction, tenant flags).

---

## 🛡️ Domain 10 — Security, Privacy, dan Compliance

### 10.1 Security Baseline
- [x] Enforce secure headers + CSRF strategy untuk form kritikal.
- [x] Encryption at rest untuk secret dan session sensitif.
- [x] Secret rotation policy.

### 10.2 Audit & Governance
- [ ] Audit log untuk aksi sensitif (billing, role change, channel reset, API key rotate).
- [ ] Tamper-evident audit trail minimal.
- [ ] Export audit logs untuk enterprise tenant.

### 10.3 Compliance Readiness
- [ ] Data retention policy + account deletion workflow.
- [ ] DPA/ToS/Privacy endpoint + acceptance tracking.
- [ ] Incident response runbook.

---

## 🚀 Domain 11 — Go-To-Market, Support, dan Operasional Bisnis

### 11.1 Customer Journey
- [ ] Marketing site + pricing page sinkron dengan catalog plan.
- [ ] Sign-up -> onboarding -> first value < 15 menit.
- [ ] In-app checklist dan empty-state guidance.

### 11.2 Support Tooling
- [ ] Ticketing integration untuk tenant support.
- [ ] In-app diagnostics pack (download logs terfilter tenant).
- [ ] Status page publik + incident communication workflow.

### 11.3 Revenue Ops
- [ ] KPI dashboard: MRR, ARR, churn, activation rate, WA delivery success.
- [ ] Plan experiment (A/B pricing atau quota).
- [ ] Refund dan dispute SOP.

---

## 🧪 Domain 12 — Testing, Migration, dan Launch Plan

### 12.1 Testing Strategy
- [x] Unit test dasar sudah ada (`node:test`).
- [ ] Migrasi resmi ke Vitest + coverage report.
- [ ] Tambah integration test untuk multi-tenant authorization.
- [ ] Tambah E2E test: tenant signup -> connect WA -> chat AI -> billed usage.

### 12.2 Migration dari Existing System
- [ ] Script migrasi data single-tenant ke multi-tenant default organization.
- [ ] Backfill `tenantId/workspaceId/channelId` di tabel existing.
- [ ] Compatibility mode selama fase transisi.

### 12.3 Release Management
- [ ] Staging environment parity dengan production.
- [ ] Canary release + rollback strategy.
- [ ] Launch checklist v1 SaaS GA.

---

## 🗺️ Fase Implementasi Disarankan

### Phase 1 (Foundation, 2-4 minggu)
- Domain 1, 2, 4.1, 5.1, 8.1
- Output: multi-tenant core + login tenant + minimal workspace portal.

### Phase 2 (Monetization, 2-4 minggu)
- Domain 3, 7.1, 8.2, 9.1
- Output: subscription aktif + metering + customer API dasar.

### Phase 3 (Scale & Enterprise, 3-6 minggu)
- Domain 4.2-4.3, 5.2-5.3, 9.2-9.3, 10
- Output: platform stabil skala menengah + security hardening.

### Phase 4 (Growth, ongoing)
- Domain 6, 11, 12
- Output: fitur diferensiasi + GTM + launch readiness berkelanjutan.

---

## 📊 Ringkasan Prioritas

| Domain | Fokus | Prioritas |
| :--- | :--- | :--- |
| 1. Multi-Tenant Foundation | isolasi data & arsitektur | 🔴 Critical |
| 2. Identity & RBAC | akses aman per tenant | 🔴 Critical |
| 3. Billing & Metering | monetisasi | 🔴 Critical |
| 4. WA Channel Scale | operasional inti produk | 🔴 Critical |
| 5. AI Engine SaaS | nilai utama produk | 🔴 Critical |
| 6. Automation Features | diferensiasi | 🟡 High |
| 7. API & Webhooks | integrasi customer | 🟡 High |
| 8. Tenant Dashboard | self-service | 🟡 High |
| 9. Reliability & Scale | stabilitas platform | 🔴 Critical |
| 10. Security & Compliance | trust enterprise | 🔴 Critical |
| 11. GTM & Support | pertumbuhan bisnis | 🟢 Medium |
| 12. Testing & Launch | kesiapan produksi | 🔴 Critical |

> Prinsip utama: semua fitur baru harus tenant-aware, measurable, dan enforceable by plan.

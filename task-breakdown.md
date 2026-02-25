# ✅ Task Breakdown: WhatsApp AI Agent Gateway

> **Gaya:** Per Fitur/Domain | **Level:** Detail (subtask per komponen)
> **Total Domain:** 8 | Status tracking: `[ ]` = todo · `[~]` = in progress · `[x]` = done

---

## 📦 Domain 1 — Project Setup & Infrastructure

### 1.1 Inisialisasi Project
- [x] Buat project Next.js 15 dengan TypeScript (`create-next-app`)
- [x] Konfigurasi `tsconfig.json` (strict mode, path aliases `@/`)
- [~] Setup ESLint + Prettier + Husky pre-commit hook
- [x] Buat struktur folder sesuai arsitektur (`src/agent`, `src/lib`, `src/instructions`, dll)

### 1.2 Docker & Database
- [x] Buat `docker-compose.yml` dengan service: `postgres`, `redis`
- [x] Konfigurasi volume persisten untuk PostgreSQL
- [x] Setup Prisma: `prisma init`, konfigurasi `DATABASE_URL`
- [x] Definisikan schema Prisma lengkap (`User`, `Message`, `Memory`, `Session`, `BotConfig`, `ToolLog`)
- [ ] Jalankan `prisma migrate dev` — migrasi pertama
- [x] Buat `src/lib/db/client.ts` — singleton Prisma Client

### 1.3 Environment & Config
- [x] Buat `.env.example` dengan semua variable yang dibutuhkan
- [x] Buat `.env.local` untuk development
- [x] Buat `src/lib/config.ts` — typed env loader dengan validasi (zod)

---

## 📱 Domain 2 — WhatsApp Gateway (Baileys)

### 2.1 Setup Koneksi
- [x] Install Baileys: `@whiskeysockets/baileys`
- [x] Buat `src/lib/baileys/client.ts` — inisialisasi socket & auth state
- [ ] Implementasi penyimpanan auth credentials ke database (`Session` model)
- [x] Handle event `connection.update`: connected, disconnected, reconnecting
- [x] Expose status koneksi via singleton agar bisa dibaca dashboard

### 2.2 QR Code Flow
- [x] Generate QR code saat session baru / logout
- [x] Emit QR string via SSE endpoint agar bisa ditampilkan di dashboard
- [x] Handle auto-reconnect dengan exponential backoff (max 5 retries)

### 2.3 Message Handler
- [x] Listen event `messages.upsert`
- [x] Filter: abaikan pesan dari diri sendiri, pesan grup (opsional), status WA
- [x] Ekstrak: `phoneNumber`, `messageText`, `timestamp`, `messageId`
- [x] Kirim pesan yang sudah difilter ke BullMQ queue
- [x] Buat fungsi `sendMessage(phoneNumber, text)` dengan simulasi typing delay
- [x] Buat fungsi `sendTyping(phoneNumber)` — simulasi "sedang mengetik..."

---

## 🔁 Domain 3 — Queue System (BullMQ + Redis)

### 3.1 Setup Queue
- [x] Install BullMQ, `ioredis`
- [x] Buat `src/lib/queue/client.ts` — koneksi Redis singleton
- [x] Buat `src/lib/queue/messageQueue.ts` — definisi queue `whatsapp-inbound`

### 3.2 Worker
- [x] Buat `src/lib/queue/worker.ts` — proses job dari queue
- [x] Implementasi concurrency limit (misal: 5 job paralel)
- [x] Handle job retry: 3x dengan delay eksponensial
- [x] Handle job failure: log ke `ToolLog` atau console
- [~] Pastikan worker di-start saat aplikasi boot (di `src/lib/baileys/client.ts` atau server startup)

---

## 🤖 Domain 4 — AI Agent (LangGraph + Gemini)

### 4.1 Instruction Loader
- [x] Buat `src/lib/instructions/loader.ts` — baca file `.md` dari `src/instructions/`
- [x] Cache hasil baca di memory, support hot-reload via API endpoint
- [x] Buat file template: `Identity.md`, `Behavior.md`, `Skills.md`, `Tools.md`, `Memory.md`

### 4.2 Prompt Builder
- [x] Buat `src/agent/prompts/systemPrompt.ts` — gabungkan Identity + Behavior + Skills
- [x] Buat `src/agent/prompts/memoryPrompt.ts` — format user memory jadi teks konteks
- [x] Buat `src/agent/prompts/historyPrompt.ts` — format N pesan terakhir jadi chat history

### 4.3 Tool Registry
- [x] Buat `src/agent/tools/registry.ts` — map nama tool ke fungsi implementasi
- [x] Buat tool built-in pertama: `get_user_info` (ambil data user dari DB)
- [x] Buat tool built-in kedua: `save_note` (simpan catatan ke memory user)
- [x] Definisikan interface `Tool` yang wajib diimplementasikan setiap tool baru

### 4.4 LangGraph Definition
- [ ] Install `@langchain/langgraph`, `@langchain/google-genai`
- [ ] Buat `src/agent/graph.ts` — definisi `StateGraph` dengan `AgentState`
- [ ] Implementasi node `load_context`: fetch memory + chat history dari DB
- [ ] Implementasi node `reason`: kirim prompt ke Gemini, parse response
- [ ] Implementasi node `execute_tool`: jalankan tool dari registry, simpan ke `ToolLog`
- [ ] Implementasi node `format_response`: bersihkan output sebelum dikirim
- [ ] Implementasi node `update_memory`: ekstrak fakta baru, upsert ke `Memory`
- [ ] Definisikan edge kondisional: jika ada tool call → `execute_tool`, jika tidak → `format_response`
- [ ] Compile graph dan export sebagai `agentApp`

### 4.5 Agent Runner
- [x] Buat `src/agent/runner.ts` — fungsi `runAgent(phoneNumber, incomingMessage)`
- [~] Orkestrasi: upsert `User`, simpan pesan user ke `Message`, invoke graph, simpan respons
- [x] Handle error gracefully: jika agent gagal, kirim pesan fallback ke user

---

## 🗄️ Domain 5 — Database Layer

### 5.1 Repository Pattern
- [x] Buat `src/lib/db/userRepo.ts` — `upsertUser`, `getUserByPhone`, `blockUser`, `updateLabel`
- [x] Buat `src/lib/db/messageRepo.ts` — `saveMessage`, `getRecentHistory(userId, limit)`
- [x] Buat `src/lib/db/memoryRepo.ts` — `upsertMemory`, `getMemoriesByUser`, `deleteMemory`
- [x] Buat `src/lib/db/toolLogRepo.ts` — `saveToolLog`, `getToolLogs(filter)`
- [x] Buat `src/lib/db/configRepo.ts` — `getBotConfig`, `updateBotConfig`

### 5.2 Seeding
- [x] Buat `prisma/seed.ts` — seed default `BotConfig`
- [x] Tambahkan script `"db:seed"` di `package.json`

---

## 🖥️ Domain 6 — Dashboard Admin (Next.js UI)

### 6.1 Auth
- [ ] Install & setup NextAuth.js dengan credentials provider
- [ ] Proteksi semua route `(dashboard)` dengan middleware
- [ ] Buat halaman `/login`

### 6.2 Layout & Navigation
- [ ] Buat layout `src/app/(dashboard)/layout.tsx` dengan sidebar
- [ ] Buat komponen `Sidebar` dengan navigasi ke semua halaman
- [ ] Buat komponen `TopBar` dengan status koneksi WA (badge)

### 6.3 Halaman Overview
- [ ] Buat `src/app/(dashboard)/page.tsx`
- [ ] Widget: total users, total pesan hari ini, avg response time
- [ ] Widget: status koneksi WA (Connected / Disconnected)
- [ ] Widget: bot aktif/nonaktif toggle

### 6.4 Halaman Live Monitor
- [x] Buat SSE endpoint `src/app/api/sse/route.ts` — stream event pesan baru
- [ ] Buat halaman `/monitor` — subscribe ke SSE, tampilkan pesan masuk real-time
- [ ] Filter by phoneNumber / user

### 6.5 Halaman Conversations
- [ ] Buat halaman `/conversations` — list semua user dengan preview pesan terakhir
- [ ] Klik user → tampilkan full chat history (bubble chat style)
- [ ] Search by nama / nomor HP
- [ ] Filter by label, tanggal

### 6.6 Halaman Users
- [ ] Buat halaman `/users` — tabel semua user
- [ ] Aksi per user: lihat detail memori, edit label, block/unblock
- [ ] Halaman detail `/users/[id]` — tampilkan memory key-value, histori singkat

### 6.7 Halaman Config
- [ ] Buat halaman `/config` — editor teks (textarea/CodeMirror) untuk tiap file `.md`
- [ ] Tombol "Save & Reload" — simpan ke file + trigger hot-reload instruction loader
- [ ] Tambahkan form edit `BotConfig` (model, maxTokens, isActive)

### 6.8 Halaman Tool Logs
- [ ] Buat halaman `/tool-logs` — tabel log semua pemanggilan tool
- [ ] Kolom: tool name, input, output, sukses/gagal, durasi, waktu
- [ ] Filter by tool name, status

### 6.9 Halaman Analytics
- [ ] Buat halaman `/analytics`
- [ ] Chart: volume pesan per hari (7 hari terakhir) — `recharts`
- [ ] Chart: distribusi tool yang paling sering dipanggil
- [ ] Tabel: estimasi token usage & biaya Gemini

### 6.10 Halaman QR Scanner
- [ ] Buat halaman `/qr` — subscribe SSE untuk QR string
- [ ] Render QR code di browser dengan library `qrcode.react`
- [ ] Auto-refresh jika QR expire, tampilkan status "Connecting..."

---

## 🔌 Domain 7 — API Routes (Server Actions & REST)

- [x] `POST /api/agent/reload-instructions` — trigger hot-reload file MD
- [x] `GET /api/wa/status` — return status koneksi Baileys
- [x] `POST /api/wa/disconnect` — logout & hapus session
- [x] `GET /api/sse` — Server-Sent Events untuk live monitor & QR
- [ ] `GET /api/analytics/summary` — data untuk halaman analytics
- [ ] Server Actions untuk: update `BotConfig`, block user, update label, upsert memory

---

## 🧪 Domain 8 — Testing & Deployment

### 8.1 Testing
- [ ] Setup Vitest untuk unit test
- [ ] Test `promptBuilder` — pastikan output prompt sesuai kombinasi MD
- [ ] Test `memoryRepo` — upsert, get, unique constraint
- [ ] Test `agentRunner` — mock Gemini, pastikan flow benar
- [ ] Test tool registry — pastikan tool yang terdaftar bisa dipanggil

### 8.2 Deployment
- [ ] Finalisasi `docker-compose.yml` untuk production (tambah service `app`)
- [ ] Buat `Dockerfile` untuk Next.js app
- [ ] Setup environment variables di server / platform deployment
- [ ] Jalankan `prisma migrate deploy` saat container start
- [ ] Buat script `start.sh` — migrate + seed + start server
- [ ] Test end-to-end: kirim pesan WA → agent respon → tersimpan di DB → muncul di dashboard

---

## 🗺️ Urutan Pengerjaan yang Disarankan

```
Domain 1 (Setup)
    │
    ▼
Domain 2 (Baileys) ──▶ Domain 3 (Queue)
                              │
                              ▼
                        Domain 5 (DB Layer)
                              │
                              ▼
                        Domain 4 (AI Agent)
                              │
                        ┌─────┴─────┐
                        ▼           ▼
                  Domain 6       Domain 7
                (Dashboard)    (API Routes)
                        └─────┬─────┘
                              ▼
                        Domain 8 (Testing & Deploy)
```

> Domain 2, 3, 4, 5 adalah **core pipeline** — harus selesai sebelum dashboard bisa menampilkan data nyata.
> Domain 6 & 7 bisa dikerjakan paralel setelah core pipeline berjalan.

---

## 📊 Ringkasan Task

| Domain | Jumlah Task | Prioritas |
| :--- | :---: | :--- |
| 1. Project Setup | 11 | 🔴 Critical |
| 2. WA Gateway | 12 | 🔴 Critical |
| 3. Queue System | 7 | 🔴 Critical |
| 4. AI Agent | 20 | 🔴 Critical |
| 5. Database Layer | 9 | 🔴 Critical |
| 6. Dashboard UI | 26 | 🟡 High |
| 7. API Routes | 7 | 🟡 High |
| 8. Testing & Deploy | 10 | 🟢 Normal |
| **Total** | **102** | |

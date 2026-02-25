# AGENTS.md — WA Gateway Project Overview

## 1) Ringkasan Proyek
`wa-gateway` adalah sistem **WhatsApp AI Gateway + Dashboard Admin** berbasis Next.js (App Router), Baileys, BullMQ, Prisma/PostgreSQL, Redis, dan LangGraph + Gemini.

Tujuan utama:
- Menerima pesan WhatsApp via Baileys
- Mengantrikan pesan ke BullMQ
- Memproses pesan dengan AI agent (persona + memory + tool calling)
- Mengirim respons kembali ke WhatsApp
- Menyediakan dashboard admin untuk monitoring, konfigurasi, dan analytics

## 2) Stack & Runtime
- Framework: Next.js + TypeScript
- WA Gateway: `@whiskeysockets/baileys`
- Queue: BullMQ + Redis
- DB: PostgreSQL + Prisma
- Agent: `@langchain/langgraph` + `@langchain/google-genai`
- Auth dashboard: NextAuth credentials
- UI: Tailwind + App Router pages

Catatan runtime:
- Service bootstrap dijalankan sekali per process via `src/lib/runtime/bootstrapServer.ts`
- `instrumentation.ts` memicu bootstrap saat server start (node runtime)
- Fallback lazy bootstrap juga dipicu di `GET /api/wa/status`

## 3) Struktur Penting
- `src/lib/baileys/`:
  - `client.ts`: koneksi WA, event handling, reconnect, kirim pesan, typing, auth persistence
  - `events.ts`: event bus global (`qr`, `connection-update`, `new-message`)
- `src/lib/queue/`:
  - `messageQueue.ts`: queue `whatsapp-inbound`, retry/backoff
  - `worker.ts`: worker concurrency 5
- `src/agent/`:
  - `graph.ts`: StateGraph nodes/edges + compile `agentApp` + `invokeAgentGraph`
  - `runner.ts`: orchestration utama (upsert user, save message, invoke graph, save response)
  - `nodes/loadContext.ts`: load memory + history
  - `tools/`: registry dan built-in tools
- `src/lib/db/`: repository layer Prisma (user, message, memory, config, tool log, session)
- `src/instructions/`: file markdown persona/behavior/skills/tools/memory
- `src/app/(dashboard)/`: halaman admin (overview, monitor, conversations, users, config, tool-logs, analytics, qr)
- `src/app/api/`: route API internal

## 4) Alur End-to-End (Produksi)
1. WA message masuk (`messages.upsert` di Baileys)
2. Filter pesan non-target
3. Enqueue ke BullMQ (`whatsapp-inbound`)
4. Worker mengambil job dan memanggil `runAgent` di `runner.ts`
5. Runner:
   - cek bot config aktif/nonaktif
   - upsert user
   - simpan pesan user
   - invoke graph (`invokeAgentGraph`)
   - simpan pesan assistant
6. Bootstrap mengirim respons ke WA (`sendMessage`)
7. Memory extraction berjalan async di node `update_memory`

## 5) Auth Credential WA (Session DB)
Implementasi sudah menyimpan auth credentials Baileys ke tabel `Session`:
- restore dari DB sebelum connect
- backup ke DB saat `creds.update`
- hapus session saat logout/disconnect

File terkait:
- `src/lib/baileys/client.ts`
- `src/lib/db/sessionRepo.ts`
- model Prisma `Session`

## 6) Domain Status (Ringkas)
- Domain 1: mayoritas selesai (migrasi pertama masih belum final di checklist)
- Domain 2: selesai
- Domain 3: selesai
- Domain 4:
  - 4.4 selesai (StateGraph node/edge/compile)
  - 4.5 selesai (orchestration di runner)
- Domain 5: selesai
- Domain 6: selesai (fitur utama dashboard tersedia)
- Domain 7: selesai
- Domain 8:
  - Testing: test berjalan dengan `node:test` (fallback), Vitest setup masih pending jaringan npm
  - Deployment: Dockerfile/start.sh/docker-compose production sudah ada
  - E2E WA real flow belum ditandai selesai

## 7) API Internal Penting
- `POST /api/agent/reload-instructions`
- `GET /api/wa/status`
- `POST /api/wa/disconnect`
- `GET /api/sse`
- `GET /api/analytics/summary`
- `GET|POST /api/auth/[...nextauth]`

## 8) Dashboard Admin (Halaman)
- `/login`
- `/` (overview)
- `/monitor`
- `/conversations`
- `/users`
- `/users/[id]`
- `/config`
- `/tool-logs`
- `/analytics`
- `/qr`

## 9) Perintah Operasional
Development:
```bash
npm run lint
npm test
npm run dev
```

Database/Prisma:
```bash
npx prisma generate
npx prisma migrate dev
npm run db:seed
```

Production compose:
```bash
docker compose up -d --build
```

## 10) Catatan untuk Agent Berikutnya
- Jangan ubah flow queue/worker tanpa cek dampak idempotency job
- Perubahan agent sebaiknya lewat node graph, bukan bypass ke imperative loop
- Jaga kompatibilitas event SSE (`qr`, `connection-update`, `new-message`) karena dipakai dashboard
- Untuk menuntaskan Domain 8.1 secara resmi, migrasikan test runner ke Vitest saat akses npm tersedia
- Untuk menuntaskan Domain 8.2, lakukan E2E nyata: WA message -> AI response -> DB records -> dashboard visible

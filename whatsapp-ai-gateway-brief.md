# 📋 Project Brief (Enhanced): WhatsApp AI Agent Gateway & Dashboard

## 1. Project Overview

Membangun sistem **WhatsApp AI Agent Gateway** berbasis Google Gemini dengan kepribadian yang dapat dikonfigurasi (*Identity*), memori jangka panjang persisten (*PostgreSQL*), kemampuan menjalankan fungsi spesifik (*Tool Calling*), dan **Dashboard Admin** untuk monitoring, konfigurasi real-time, dan analytics. Sistem dirancang modular agar mudah di-scale dan di-maintain.

### Goals

- **Primary:** Bot WhatsApp yang terasa natural, cerdas, dan konsisten dalam persona
- **Secondary:** Dashboard admin yang memberikan visibilitas penuh atas percakapan, performa AI, dan health sistem
- **Tertiary:** Arsitektur yang mudah di-extend dengan skill/tools baru tanpa mengubah core logic

---

## 2. Tech Stack

| Layer | Teknologi | Alasan |
| :--- | :--- | :--- |
| **Framework** | Next.js 15 (App Router) + TypeScript | Full-stack, SSR, Server Actions |
| **WA Gateway** | Baileys (Multi-Device) | Open-source, aktif dikembangkan |
| **AI Orchestration** | LangGraph.js | State machine untuk agentic loop, lebih kontrol vs LangChain biasa |
| **LLM** | Gemini 2.0 Flash (primary) + Pro (fallback untuk kompleks) | Cost-efficient, fast |
| **Database** | PostgreSQL + Prisma ORM | Relational, typed schema |
| **Cache & Queue** | Redis (BullMQ) | Queue pesan masuk, rate limiting, session cache |
| **UI/UX** | Shadcn UI + Tailwind CSS + Lucide Icons | Konsisten, accessible |
| **State Management** | TanStack Query + Zustand | Server state + client state |
| **Real-time** | Server-Sent Events (SSE) atau Socket.io | Live update di dashboard |
| **Auth Dashboard** | NextAuth.js (credentials) | Proteksi admin panel |
| **Deployment** | Docker Compose | Isolasi service, mudah di-deploy |

---

## 3. Arsitektur Sistem

```
WhatsApp User
      │
      ▼
[Baileys WA Client]  ──────────────────────────────────────┐
      │                                                     │
      ▼                                                   (events)
[Message Queue - BullMQ/Redis]                             │
      │                                                     ▼
      ▼                                          [Dashboard Next.js]
[Agent Processor - LangGraph]                       │           │
      │                                          [Analytics] [Config]
      ├── Load: Identity.md, Behavior.md              │
      ├── Fetch: User Memory (PostgreSQL)          [Live Logs]
      ├── Retrieve: Chat History (last N turns)
      ├── Run: Tool Calling (jika diperlukan)
      └── Generate: Gemini Response
            │
            ▼
      [Save to DB] → Reply via Baileys
```

### Process Flow Detail

1. Pesan masuk → Baileys event `messages.upsert`
2. Pesan di-enqueue ke BullMQ (handle concurrency & retry)
3. Worker memproses: load instruksi MD + ambil memori + build prompt
4. LangGraph menjalankan agentic loop (bisa multi-step jika ada tool call)
5. Response dikirim, percakapan & memory update disimpan ke DB
6. Event dikirim ke dashboard via SSE untuk live monitoring

---

## 4. Core AI Agent Structure

### Instruction Files (Markdown-based, hot-reloadable)

| File | Deskripsi | Contoh Konten |
| :--- | :--- | :--- |
| `Identity.md` | Persona, nama, role, hard limits | "Kamu adalah Ara, CS Toko X. Jangan pernah sebut kompetitor." |
| `Behavior.md` | Tone, format respons, simulasi typing delay, bahasa | "Gunakan bahasa Indonesia casual. Respons max 3 kalimat." |
| `Skills.md` | Domain knowledge: FAQ, katalog, SOP | Daftar produk, harga, jam operasional, cara order |
| `Tools.md` | Definisi tool yang bisa dipanggil AI | Skema JSON tool: `checkOrderStatus`, `calculateShipping` |
| `Memory.md` | Aturan ekstraksi & update long-term memory | "Simpan: nama, kota, preferensi, histori pembelian" |

> **Catatan:** File MD dibaca saat startup dan bisa di-reload via dashboard tanpa restart server.

### LangGraph Agent State

```typescript
interface AgentState {
  messages: BaseMessage[];
  userMemory: Memory[];
  userId: string;
  phoneNumber: string;
  currentTool?: string;
  iterationCount: number;
  shouldEnd: boolean;
}
```

### Agentic Loop Nodes

```
[START]
   │
   ▼
[load_context]     → Fetch memory + recent history
   │
   ▼
[reason]           → Gemini decides: respond directly OR call tool
   │
   ├──(tool call)──▶ [execute_tool] ──▶ [reason] (loop back)
   │
   └──(final)──────▶ [format_response]
                           │
                           ▼
                     [update_memory]   → Async, non-blocking
                           │
                           ▼
                        [END]
```

---

## 5. Database Schema (Prisma)

```prisma
model User {
  id            String         @id @default(uuid())
  phoneNumber   String         @unique
  name          String?
  label         String?        // Tag manual dari admin: "VIP", "Leads", dll
  isBlocked     Boolean        @default(false)
  conversations Message[]
  memories      Memory[]
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}

model Message {
  id          String   @id @default(uuid())
  userId      String
  role        String   // 'user' | 'assistant' | 'system' | 'tool'
  content     String   @db.Text
  toolName    String?  // Jika role = 'tool'
  metadata    Json?    // Menyimpan: tokens used, latency, model version
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id])

  @@index([userId, createdAt])
}

model Memory {
  id          String   @id @default(uuid())
  userId      String
  key         String   // 'preference' | 'name' | 'city' | 'last_order'
  value       String   @db.Text
  confidence  Float    @default(1.0) // Untuk future: decay memory
  source      String?  // Message ID yang menjadi sumber fakta ini
  updatedAt   DateTime @updatedAt
  user        User     @relation(fields: [userId], references: [id])

  @@unique([userId, key])
}

model Session {
  id        String   @id
  data      String   @db.Text  // Baileys Auth Credentials (encrypted)
  updatedAt DateTime @updatedAt
}

model BotConfig {
  id        String   @id @default("singleton")
  isActive  Boolean  @default(true)
  model     String   @default("gemini-2.0-flash")
  maxTokens Int      @default(1024)
  updatedAt DateTime @updatedAt
}

model ToolLog {
  id         String   @id @default(uuid())
  toolName   String
  input      Json
  output     Json?
  success    Boolean
  duration   Int      // milliseconds
  createdAt  DateTime @default(now())
}
```

---

## 6. Tool System

Tools didefinisikan dalam `Tools.md` dan diimplementasikan sebagai fungsi TypeScript. AI akan memanggil tools via function calling Gemini.

### Contoh Tools Built-in

```typescript
// tools/checkOrder.ts
export const checkOrderTool = {
  name: "check_order_status",
  description: "Cek status pesanan berdasarkan order ID",
  parameters: {
    type: "object",
    properties: {
      orderId: { type: "string", description: "ID pesanan" }
    },
    required: ["orderId"]
  },
  execute: async (params: { orderId: string }) => {
    // Query ke database / external API
  }
}
```

### Tool Registry Pattern

Semua tools diregister di satu tempat, LangGraph tinggal mengakses registry. Menambah tool baru cukup buat file baru + daftar di registry — tidak perlu ubah agent logic.

---

## 7. Dashboard Admin

### Pages & Features

| Page | Fitur |
| :--- | :--- |
| **Overview** | Total users, pesan hari ini, response time avg, status koneksi WA |
| **Live Monitor** | Stream percakapan real-time via SSE, filter per user |
| **Conversations** | Riwayat chat semua user, search, filter by label/date |
| **Users** | Daftar kontak, detail memori per user, block/label user |
| **Config** | Edit `Identity.md`, `Behavior.md`, `Skills.md` inline + hot reload |
| **Tool Logs** | Histori pemanggilan tools, sukses/gagal, latency |
| **Analytics** | Chart: volume pesan, top tools used, model usage & cost estimate |
| **QR Scanner** | Tampilkan QR Baileys untuk link WhatsApp account |

---

## 8. Project Structure

```
/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (dashboard)/        # Admin UI routes
│   │   └── api/
│   │       ├── webhook/        # (opsional, jika pakai WA Cloud API)
│   │       └── sse/            # Server-Sent Events endpoint
│   ├── agent/
│   │   ├── graph.ts            # LangGraph definition
│   │   ├── nodes/              # Tiap node LangGraph
│   │   ├── tools/              # Tool implementations + registry
│   │   └── prompts/            # Prompt builders
│   ├── lib/
│   │   ├── baileys/            # WA client, event handler
│   │   ├── queue/              # BullMQ workers & queues
│   │   ├── db/                 # Prisma client
│   │   └── instructions/       # MD file loader & parser
│   ├── instructions/           # Identity.md, Behavior.md, dll
│   └── components/             # Shadcn + custom UI
├── prisma/
│   └── schema.prisma
├── docker-compose.yml          # PostgreSQL + Redis
└── .env
```

---

## 9. Environment Variables

```env
# WhatsApp
WA_SESSION_ID=main-session

# AI
GOOGLE_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash-exp

# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://localhost:6379

# Dashboard Auth
NEXTAUTH_SECRET=...
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=...

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 10. Development Phases

| Phase | Scope | Target |
| :--- | :--- | :--- |
| **Phase 1 - Core** | Baileys connect + basic Gemini response + save to DB | Week 1–2 |
| **Phase 2 - Agent** | LangGraph + memory + tool calling | Week 3–4 |
| **Phase 3 - Dashboard** | Admin UI: monitor + config | Week 5–6 |
| **Phase 4 - Polish** | Analytics, hot reload config, Docker, testing | Week 7–8 |

---

## 11. Key Considerations & Risks

**Baileys Stability** — Baileys bukan official API, akun bisa kena ban jika terdeteksi bot. Mitigasi: simulasi typing delay, hindari blast pesan, gunakan akun dedicated.

**Concurrency** — Jika banyak user chat bersamaan, queue BullMQ mencegah race condition dan overload Gemini API.

**Memory Quality** — Ekstraksi memori perlu prompt engineering yang baik agar tidak menyimpan fakta yang salah atau kontradiktif.

**Cost Control** — Monitor token usage per user, set max token limit di `BotConfig`, pertimbangkan caching respons untuk pertanyaan FAQ yang berulang.

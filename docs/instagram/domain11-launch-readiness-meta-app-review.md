# Domain 11: Launch Readiness dan Meta App Review

Dokumen ini menutup persiapan non-runtime sebelum integrasi Instagram dibuka ke tenant production.

## 11.1 App Review Preparation

### Screencast dan Review Pack

Siapkan screencast 3-5 menit dengan urutan:

1. Owner login ke dashboard tenant.
2. Owner connect channel Instagram.
3. Tunjukkan comment masuk dan auto-reply comment.
4. Tunjukkan DM masuk dan auto-reply DM.
5. Tunjukkan human override / thread takeover.
6. Tunjukkan audit trail, observability, dan privacy deletion.

Review notes untuk Meta harus memuat:

- use case: customer support DM + comment moderation ringan
- no posting/scheduling/feed publishing
- tenant isolation per workspace/channel
- operator bisa takeover thread dan menghentikan auto-reply
- audit trail + retention + deletion workflow tersedia

Test credentials untuk review:

- URL staging
- akun reviewer internal / owner
- workspace pilot / sandbox
- Instagram Business test + Page test
- langkah reproduksi connect -> inbound -> outbound

### Data Usage dan Permission Rationale

Permission yang dipakai:

- `instagram_basic`: baca identitas account yang terhubung
- `instagram_manage_messages`: baca/kirim DM
- `instagram_manage_comments`: baca/balas komentar
- `pages_show_list`: enumerasi Page yang bisa dipilih saat OAuth
- `pages_read_engagement`: baca binding Page <-> Instagram business account

Data usage:

- event metadata inbound (`eventId`, `threadId`, `commentId`, `mediaId`, `igUserId`)
- message content untuk inbox, AI response, audit operasional
- token metadata untuk health/rotation, bukan untuk analytics publik

### Fallback Mode Saat App Masih Development

Runtime fallback tersedia lewat:

- `INSTAGRAM_APP_MODE=development`
- `INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES=ws-pilot,ws-canary`

Behavior:

- workspace non-allowlisted tidak bisa memulai OAuth connect baru
- inbound event tetap tercatat sebagai skipped
- worker tidak mengirim auto-reply/outbound ke Meta
- dashboard channel menampilkan warning `Development Mode Fallback Active`

## 11.2 Rollout Plan

### Pilot

- aktifkan dulu di satu workspace internal
- gunakan akun IG test milik tim
- review harian: delivery success, skip reason, audit noise, human handover

### Canary

- buka ke 1-3 tenant terpilih
- allowlist workspace mereka saat app masih `development`
- freeze perubahan prompt/policy besar selama canary
- evaluasi 24 jam pertama sebelum tambah tenant berikutnya

### Rollback

Rollback dilakukan bila:

- error rate outbound naik signifikan
- duplicate reply terdeteksi
- webhook ingest sering gagal / DLQ naik tajam
- Meta permission/token invalid massal

Tindakan rollback:

1. set channel affected ke mode nonaktif / disconnect
2. hentikan canary allowlist tenant baru
3. review incident snapshot + audit trail
4. replay hanya setelah root cause jelas

## 11.3 Operasional Pasca Launch

### 7 Hari Pertama

Pantau harian:

- delivery success/failure rate
- queue lag dan DLQ volume
- response SLA DM/comment
- policy rejection dan human override rate

### Feedback Operator

Kumpulkan minimal:

- friksi saat thread takeover
- kejelasan status auto-reply per thread
- kebutuhan assignment rule dan canned response

### Backlog v1.1

- quick replies / canned responses
- assignment rules per operator
- advanced moderation dan policy controls

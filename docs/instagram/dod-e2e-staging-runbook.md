# Instagram DoD E2E Staging Runbook

Runbook ini dipakai untuk menutup `Definition of Done` Instagram v1 secara operasional, bukan hanya dari sisi implementasi kode.

## 1. Tujuan

Membuktikan di staging bahwa:

- connect channel Instagram berjalan tanpa intervensi engineer
- DM dan comment diproses stabil lewat webhook + idempotency
- AI auto-reply bekerja sesuai policy
- human override menghentikan auto-reply
- inbox, analytics, audit log, observability, dan usage metering konsisten
- sistem siap diajukan / dioperasikan pada mode production

## 2. Prasyarat

Environment staging harus punya:

- `INSTAGRAM_APP_ID`
- `INSTAGRAM_APP_SECRET`
- `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`
- `NEXTAUTH_URL` atau `NEXT_PUBLIC_APP_URL` sesuai domain staging
- `INSTAGRAM_APP_MODE`
- jika `INSTAGRAM_APP_MODE=development`, set `INSTAGRAM_DEV_MODE_ALLOWED_WORKSPACES` untuk workspace pilot

Artefak operasional:

- 1 workspace pilot atau sandbox
- 1 Instagram Business/Creator test
- 1 Facebook Page test yang terhubung ke akun Instagram test
- 1 operator internal untuk takeover/human override
- 1 media post test untuk skenario comment

## 3. Bukti yang Harus Dikumpulkan

Siapkan folder bukti berisi:

- video/screenshot connect flow
- screenshot inbox DM/comment
- screenshot analytics + usage
- export audit/incident snapshot
- catatan timestamp untuk setiap skenario

## 4. Skenario E2E Utama

### A. Connect Tanpa Intervensi Engineer

1. Login sebagai owner/admin tenant.
2. Buka `/channels`.
3. Klik connect Instagram dan selesaikan OAuth.
4. Verifikasi channel menampilkan account, page, scopes, dan token status.

Lulus bila:

- tidak perlu edit DB/manual credential inject
- channel binding muncul di dashboard
- audit connect tercatat

### B. Comment Inbound -> AI Reply Comment

1. Dari akun test lain, tulis comment pada media post test.
2. Tunggu webhook masuk.
3. Verifikasi reply comment dari bot muncul.
4. Verifikasi event terlihat di conversations/inbox.

Lulus bila:

- inbound event tercatat sekali
- outbound reply comment terkirim sekali
- audit `instagram_agent_response_generated` dan `instagram_outbound_sent` ada

### C. DM Inbound -> AI Reply DM

1. Kirim DM ke akun Instagram test.
2. Verifikasi pesan masuk ke inbox tenant.
3. Verifikasi AI reply DM terkirim.
4. Verifikasi usage metering dan analytics bertambah.

Lulus bila:

- thread DM muncul di dashboard
- tidak ada duplicate reply
- metadata `threadId` dan `igUserId` konsisten

### D. Human Override

1. Ambil alih thread DM di dashboard.
2. Kirim pesan baru dari user test pada thread yang sama.
3. Verifikasi bot tidak membalas otomatis.

Lulus bila:

- inbound disimpan sebagai skipped
- handover/human override trace tercatat
- audit skip human override ada

### E. Failure Modes

Jalankan minimal tiga skenario:

- token expired / invalid
- permission missing
- outbound rate limit atau policy rejection

Lulus bila:

- system fail safe
- tidak spam retry tanpa kontrol
- incident snapshot dan audit trail cukup untuk investigasi

## 5. Pemeriksaan Bukti per DoD

Checklist evaluasi:

- item 1: lolos jika skenario A lolos
- item 2: lolos jika skenario B + C stabil dan tidak duplicate reply
- item 3: lolos jika skenario B + C memproduksi reply sesuai rule/policy
- item 4: lolos jika skenario D lolos
- item 5: lolos jika inbox, analytics, audit, observability, dan usage konsisten untuk skenario A-D
- item 6: lolos jika semua skenario di atas plus failure modes selesai dan ada sign-off operasional

## 6. Exit Criteria

Instagram v1 boleh dianggap `DoD complete` hanya bila:

- semua skenario utama lulus
- tidak ada data leak lintas tenant
- tidak ada duplicate reply pada skenario comment/DM
- incident snapshot cukup untuk postmortem
- owner/operator memberi sign-off go-live

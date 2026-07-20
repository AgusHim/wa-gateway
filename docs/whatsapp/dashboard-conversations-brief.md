# Brief: WhatsApp Conversations dan Reply dari Dashboard

## 1. Ringkasan

Mengembangkan halaman `Conversations` agar admin dapat melihat percakapan dari channel WhatsApp dan membalas pesan langsung dari dashboard. Pengiriman tetap menggunakan jalur BullMQ dan Baileys yang sudah tersedia agar retry, rate limit, billing, dan observability tetap konsisten.

## 2. Tujuan

- Menampilkan daftar percakapan WhatsApp per workspace dan channel.
- Menampilkan riwayat pesan masuk, respons AI, dan balasan operator.
- Memungkinkan operator mengirim balasan teks dari dashboard.
- Memberikan pembaruan pesan dan status pengiriman secara real-time.
- Mencegah AI dan operator membalas percakapan yang sama secara bersamaan.

## 3. Scope MVP

Termasuk:

- Percakapan personal WhatsApp yang sudah ada.
- Pesan teks dengan batas maksimal 4.096 karakter.
- Tampilan file/dokumen, audio/voice note, dan stiker dari pesan masuk.
- Download file melalui endpoint dashboard yang terautentikasi.
- Filter channel, pencarian user, dan pagination riwayat pesan.
- Status outbound `queued`, `sent`, dan `failed`.
- Human takeover ketika operator mulai membalas.
- Pembaruan dashboard melalui SSE.

Tidak termasuk:

- Pengiriman file, audio, atau stiker dari dashboard.
- Transkripsi audio dan pemahaman isi media oleh AI.
- Video, lokasi, kontak, dan reaction.
- Group chat dan status WhatsApp.
- Memulai percakapan marketing atau broadcast baru.
- Template message dan campaign management.
- Read receipt dan delivery receipt detail dari WhatsApp.

## 4. Kondisi Saat Ini

- Halaman `src/app/(dashboard)/conversations/page.tsx` sudah menampilkan user dan riwayat dari tabel `Message`.
- Filter source dan channel sudah tersedia.
- Pengiriman WhatsApp sudah memiliki outbound queue di `src/lib/queue/messageQueue.ts`.
- Outbound worker dan pengiriman melalui Baileys tersedia di `src/agent/bootstrap.ts`.
- Event `new-message` sudah tersedia melalui `GET /api/sse`.
- Status human handover sudah dapat ditampilkan dan diselesaikan dari halaman percakapan.
- Baileys sudah mendeteksi `audioMessage`, `documentMessage`, dan `stickerMessage`, tetapi saat ini hanya mencatat usage media.
- Pesan media tanpa caption saat ini dilewati karena pipeline inbound mensyaratkan `messageText`; belum ada download, persistence attachment, storage, atau renderer media.

## 5. Alur Pengguna

1. Admin membuka halaman `/conversations` dan memilih source WhatsApp.
2. Admin memilih channel dan percakapan user.
3. Dashboard mengambil riwayat pesan sesuai workspace, channel, dan user.
4. Pesan WhatsApp baru, termasuk file, audio, dan stiker, muncul tanpa reload penuh.
5. Admin mengetik balasan dan menekan tombol kirim.
6. Sistem mengaktifkan human takeover untuk percakapan tersebut.
7. Pesan disimpan dengan status `queued`, lalu dimasukkan ke outbound queue.
8. Worker mengirim pesan melalui channel Baileys terkait.
9. Status pesan berubah menjadi `sent` atau `failed` dan diperbarui di dashboard.
10. Admin memilih `Resolve Handover` ketika percakapan dapat dikembalikan ke AI.

## 6. Rencana Implementasi

### Tahap 1: API Percakapan

- Sediakan endpoint internal untuk daftar percakapan dan riwayat pesan.
- Terapkan permission dashboard `read` dan isolasi berdasarkan `workspaceId`.
- Validasi bahwa user dan channel merupakan bagian dari workspace aktif.
- Gunakan cursor pagination agar riwayat panjang tetap efisien.

### Tahap 2: API Balas Pesan

- Buat endpoint internal berizin `write` untuk mengirim balasan.
- Validasi channel bertipe WhatsApp, aktif, dan memiliki runtime yang dapat mengirim.
- Validasi nomor tujuan, isi pesan, dan batas panjang teks.
- Gunakan idempotency key untuk mencegah pesan terkirim dua kali.
- Enqueue ke outbound queue yang sudah tersedia, bukan memanggil Baileys langsung dari route.

Contoh kontrak awal:

```http
POST /api/conversations/{userId}/messages
Content-Type: application/json

{
  "channelId": "channel-id",
  "text": "Balasan dari operator",
  "idempotencyKey": "client-generated-id"
}
```

### Tahap 3: Persistence dan Status

- Simpan balasan operator sebagai role `assistant` dengan metadata sumber `dashboard-operator`.
- Simpan `channelId`, idempotency key, job ID, dan status outbound pada metadata pesan untuk MVP.
- Perbarui status dari outbound worker setelah pengiriman berhasil atau retry berakhir.
- Emit event SSE setelah pesan tersimpan dan setiap status berubah.
- Pertimbangkan kolom khusus `channelId`, `deliveryStatus`, dan `externalMessageId` jika kebutuhan query status berkembang.

### Tahap 4: Ingestion dan Penyimpanan Media

- Ekstrak tipe media, MIME type, nama file, ukuran, durasi audio, caption, dan flag animated sticker dari payload Baileys.
- Download dan decrypt media segera saat event diterima karena referensi media WhatsApp dapat kedaluwarsa.
- Jangan melewati pesan media-only; enqueue dan simpan pesan meskipun caption kosong.
- Gunakan object storage privat yang S3-compatible untuk production dan storage adapter lokal untuk development.
- Simpan binary di object storage, bukan di PostgreSQL atau metadata JSON.
- Tambahkan model attachment yang berelasi ke `Message` dengan data minimal berikut:
  - `workspaceId` dan `messageId`;
  - tipe `document`, `audio`, atau `sticker`;
  - storage key, nama file, MIME type, ukuran, checksum, dan waktu dibuat;
  - durasi untuk audio serta flag animated untuk stiker.
- Gunakan placeholder aman seperti `[Document]`, `[Audio]`, atau `[Sticker]` untuk `Message.content` ketika tidak ada caption.
- Jika media tidak memiliki caption, simpan untuk dashboard tanpa mengirim binary ke LLM. Transkripsi dan analisis media berada di luar scope MVP.
- Jika download gagal, tetap simpan pesan dengan status attachment `failed` agar dashboard dapat menunjukkan media tidak tersedia.

### Tahap 5: API Media Terautentikasi

- Buat endpoint `GET /api/conversations/media/{attachmentId}` dengan permission `read`.
- Verifikasi attachment, message, dan workspace dari session sebelum membaca object storage.
- Stream dokumen dengan `Content-Disposition` yang aman.
- Dukung HTTP range request untuk playback dan seek audio.
- Kirim MIME type yang sudah divalidasi serta `X-Content-Type-Options: nosniff`.
- Jangan mengekspos storage key, URL Baileys, credential, atau public bucket URL ke browser.

### Tahap 6: Human Takeover

- Aktifkan atau pertahankan handover ketika operator mengirim balasan.
- Selama handover aktif, pesan user tetap disimpan tetapi agent AI tidak mengirim respons.
- Gunakan aksi `Resolve Handover` yang sudah ada untuk mengembalikan percakapan kepada AI.
- Catat admin pengirim dan waktu takeover untuk audit.

### Tahap 7: Dashboard Inbox

- Pertahankan halaman server sebagai shell dan ekstrak inbox interaktif menjadi Client Component.
- Tambahkan daftar chat dengan pesan terakhir, waktu, channel, dan indikator pesan baru.
- Tambahkan panel riwayat dengan pagination ke pesan yang lebih lama.
- Tambahkan composer teks, tombol kirim, dan validasi panjang pesan.
- Gunakan optimistic UI dengan indikator `queued`, `sent`, `failed`, dan aksi retry.
- Tampilkan status koneksi channel dan nonaktifkan composer ketika channel tidak siap.
- Dengarkan SSE untuk pesan masuk dan perubahan status outbound.
- Render attachment berdasarkan tipe:
  - dokumen sebagai file card dengan nama, tipe, ukuran, dan tombol download;
  - audio atau voice note dengan native audio player, durasi, play/pause, dan seek;
  - stiker sebagai gambar dengan ukuran stabil, aspect ratio terjaga, serta dukungan animated WebP bila tersedia.
- Tampilkan status loading atau media tidak tersedia tanpa merusak tampilan pesan lain.
- Batasi ukuran preview dan attachment agar bubble pesan tidak mengubah layout secara tidak terkontrol.

## 7. Keamanan dan Aturan Sistem

- Semua query dan mutation wajib dibatasi ke workspace dari session, bukan workspace dari payload.
- Endpoint kirim membutuhkan permission `write`.
- Channel dan user harus diverifikasi kepemilikannya sebelum enqueue.
- Jangan mengirim secret, credential Baileys, atau data session ke browser.
- Terapkan batas ukuran payload dan sanitasi input teks.
- Terapkan allowlist MIME, batas ukuran media, checksum, dan nama file yang sudah disanitasi.
- Simpan object media dalam bucket privat dan terapkan retention/delete policy yang mengikuti data percakapan.
- Catat aktivitas operator pada audit log.
- Pertahankan pemeriksaan billing, compliance, rate limit, retry, dan dead-letter queue yang sudah ada.

## 8. Pengujian

- Unit test validasi payload, permission, channel, dan idempotency.
- Integration test penyimpanan pesan serta enqueue outbound.
- Test perubahan status `queued` menjadi `sent` atau `failed`.
- Test bahwa human takeover menghentikan auto-reply AI.
- Test isolasi data antar-workspace dan antar-channel.
- UI test untuk optimistic message, error, retry, pagination, dan event SSE.
- Test pesan document, audio, dan sticker tanpa caption tetap tersimpan.
- Test MIME tidak valid, media terlalu besar, download kedaluwarsa, dan kegagalan object storage.
- Test endpoint media menolak akses lintas-workspace dan mendukung range request audio.
- UI test file download, audio player, static sticker, animated sticker, dan fallback media gagal.
- E2E nyata: pesan WhatsApp masuk, terlihat di dashboard, dibalas operator, diterima user, dan tercatat di database.

## 9. Definition of Done

- Admin dapat memilih channel WhatsApp dan melihat percakapannya.
- Pesan baru tampil di dashboard tanpa reload manual.
- File menampilkan nama, tipe, ukuran, dan dapat diunduh oleh admin yang berizin.
- Audio atau voice note dapat diputar dan di-seek dari dashboard.
- Stiker statis maupun animated WebP tampil dengan ukuran dan aspect ratio yang benar.
- Pesan media-only tidak hilang meskipun tidak memiliki caption.
- Media disajikan melalui endpoint privat dan tidak dapat diakses lintas-workspace.
- Admin dapat mengirim balasan teks dari percakapan terpilih.
- Balasan hanya dikirim melalui channel dan workspace yang benar.
- Status balasan terlihat sebagai `queued`, `sent`, atau `failed`.
- Pesan gagal dapat dicoba kembali tanpa risiko duplikasi.
- AI tidak membalas selama human takeover aktif.
- Permission dan isolasi tenant memiliki coverage test.
- Alur WhatsApp ke dashboard dan kembali ke WhatsApp lulus UAT.

## 10. Referensi Implementasi

- `src/app/(dashboard)/conversations/page.tsx`
- `src/app/api/sse/route.ts`
- `src/lib/baileys/client.ts`
- `src/lib/baileys/events.ts`
- `src/lib/queue/messageQueue.ts`
- `src/lib/queue/worker.ts`
- `src/agent/bootstrap.ts`
- `src/lib/db/messageRepo.ts`
- `src/lib/handover/repo.ts`
- `prisma/schema.prisma`

## 11. Konfigurasi Media Storage

Development menggunakan filesystem privat secara default:

```env
WA_MEDIA_STORAGE_DRIVER=local
WA_MEDIA_STORAGE_ROOT=/app/.wa-media
WA_MEDIA_MAX_BYTES=26214400
```

Production direkomendasikan menggunakan bucket Cloudflare R2 privat:

```env
WA_MEDIA_STORAGE_DRIVER=r2
WA_MEDIA_R2_ACCOUNT_ID=cloudflare-account-id
WA_MEDIA_R2_BUCKET=wa-gateway-media
WA_MEDIA_R2_PREFIX=production
WA_MEDIA_R2_ACCESS_KEY_ID=replace-me
WA_MEDIA_R2_SECRET_ACCESS_KEY=replace-me
WA_MEDIA_MAX_BYTES=26214400
```

Bucket R2 tidak perlu dibuat public karena file diakses melalui endpoint dashboard yang memeriksa session dan workspace. Credential R2 harus dibuat dengan permission object read/write pada bucket terkait, dikelola melalui secret manager atau environment deployment, dan tidak disimpan di repository.

Driver generik `s3` tetap tersedia untuk provider S3-compatible lain melalui konfigurasi `WA_MEDIA_S3_*`.

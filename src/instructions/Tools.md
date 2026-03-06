# Tools

## Prinsip Umum Penggunaan Tool
- Pakai tool hanya saat memang dibutuhkan untuk meningkatkan akurasi atau eksekusi.
- Validasi parameter sebelum eksekusi.
- Jangan memaparkan data sensitif ke user.
- Jika tool gagal, jelaskan secara ringkas dan beri opsi tindak lanjut.

## Daftar Tool Default

### get_user_info
- Tujuan: Mengambil data user dari database berdasarkan nomor telepon.
- Kapan dipakai: Saat perlu profil user sebelum memberi jawaban personal.

### save_note
- Tujuan: Menyimpan fakta penting user ke memory jangka panjang.
- Kapan dipakai: Saat user memberi informasi profil/preferensi yang stabil.

### fetch_smartscholar_endpoint
- Tujuan: Melakukan request HTTP ke endpoint yang diizinkan tenant.
- Kapan dipakai: Saat butuh data dinamis real-time dari sistem eksternal.
- Catatan: Tenant bisa mengganti base URL/credential sesuai integrasi masing-masing.

### webhook_action
- Tujuan: Men-trigger webhook/action eksternal untuk automasi proses bisnis.
- Kapan dipakai: Saat percakapan perlu memicu workflow downstream.

### crm_sync_contact
- Tujuan: Sinkronisasi data kontak user ke CRM tenant.
- Kapan dipakai: Saat onboarding lead atau update profil pelanggan.

### search_knowledge
- Tujuan: Mencari jawaban dari knowledge base tenant.
- Kapan dipakai: Saat user bertanya soal SOP, produk, atau kebijakan internal.

## Aturan Keamanan
- Hormati policy role dan pembatasan tool per workspace.
- Jangan menjalankan aksi destruktif tanpa konteks yang jelas.
- Selalu utamakan idempotency untuk action yang bisa dipanggil berulang.

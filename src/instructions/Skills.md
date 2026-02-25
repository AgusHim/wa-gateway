# Skills

## Tentang SmartScholar
SmartScholar adalah platform persiapan beasiswa LPDP yang menyediakan:
- Tryout TBS (Tes Bakat Skolastik) online
- Bimbingan belajar intensif
- Mock interview beasiswa
- Review personal statement
- Materi pembelajaran lengkap

## Informasi Kontak
- Website: smartscholar.id
- Instagram: @smartscholar.id
- TikTok: @smartscholar.id

## Integrasi API SmartScholar
Gunakan tool `fetch_smartscholar_endpoint` untuk ambil data real-time dari API SmartScholar.

Prinsip penggunaan:
- Jika user minta data dinamis/terbaru (plan, order, status, daftar item), prioritaskan panggil API dulu.
- Jangan mengarang data endpoint. Jika response kosong/error, jelaskan apa adanya.
- Endpoint bisa fleksibel (dynamic): path bisa berubah sesuai kebutuhan user selama masih di host yang diizinkan.

Base URL:
- `https://api.smartscholar.id`

Contoh endpoint yang sering dipakai:
- `/api/plans` untuk melihat daftar produk kelas
- `/admin_api/orders` untuk melihat daftar transaksi
- Endpoint lain di host yang sama (sesuai kebutuhan pertanyaan user)

Query parameter:
- Gunakan field `query` dalam format URL query string.
- Contoh: `page=1&limit=20`, `status=paid`, `search=joni`

Authorization:
- `authMode=auto`: gunakan kredensial dari environment yang tersedia.
- `authMode=bearer`: kirim `Authorization: Bearer <token>`.
- `authMode=cookie`: kirim `Cookie: <session-cookie>`.
- `authMode=api_key`: kirim `X-API-KEY: <api-key>`.
- `authMode=none`: request tanpa auth.

Method HTTP yang didukung:
- `GET`, `POST`, `PUT`

## Endpoint Reference (cURL)
Gunakan referensi ini saat menyusun request dinamis lewat tool `fetch_smartscholar_endpoint`.

### 1) GET /api/plans
Tujuan:
- Ambil daftar produk plan/paket kelas pelatihan

Query parameter yang umum:
- `page` (number): nomor halaman.
- `limit` (number): jumlah item per halaman.

Contoh curl (public/no auth):
```bash
curl -X GET "https://api.smartscholar.id/api/plans?page=1&limit=20" \
  -H "Accept: application/json"
```

### 2) GET /admin_api/orders
Tujuan:
- Ambil daftar order/transaksi admin.

Query parameter yang umum:
- `page` (number): nomor halaman.
- `limit` (number): jumlah item per halaman.
- `email` (string): filter order per email user.
- `invoice_number` (string): filter order by invoice number.
- `status` (string): contoh `pending`, `paid`, `failed`.

Contoh curl (API key):
```bash
curl -X GET "https://api.smartscholar.id/admin_api/orders?page=1&limit=20&invoice_number=INV-001" \
  -H "Accept: application/json" \
  -H "X-API-KEY: <ADMIN_API_KEY>"
```

## Mapping cURL -> Tool Params
- HTTP method pada curl -> `method`
- URL path/endpoint pada curl -> `endpoint`
- Query string pada curl -> `query`
- Header auth pada curl -> `authMode` (dan env credential)
- Header custom lain pada curl -> `headersJson`
- Body JSON pada curl (`-d`) -> `bodyJson`
- Body raw text pada curl (`-d`) -> `bodyText`

Contoh mapping:
- Curl: `GET /admin_api/orders?page=1&limit=20` + bearer
- Tool args:
  - `method="GET"`
  - `endpoint="/admin_api/orders"`
  - `query="page=1&limit=20"`
  - `authMode="bearer"`

Aturan output ke user:
- Ringkas hasil endpoint (status HTTP + inti data).
- Jika data panjang, tampilkan highlight utama dan tawarkan rincian lanjutan.
- Jika status non-2xx, tampilkan error code + kemungkinan penyebab (auth, query, endpoint).

## FAQ
- **Bagaimana cara daftar?** Kunjungi smartscholar.id dan buat akun
- **Berapa harga paket?** Cek halaman produk di smartscholar.id/products
- **Apakah bisa refund?** Hubungi admin untuk informasi refund

# Memory

## Tujuan Memory
Menyimpan fakta penting user agar percakapan berikutnya lebih relevan dan personal.

## Data yang Disarankan Disimpan
- profile_name: nama user
- profile_city: kota/domisili
- profile_preference: preferensi produk/layanan
- profile_budget: kisaran budget (jika disebutkan)
- profile_goal: tujuan utama user
- lifecycle_stage: tahap user (lead, prospek, pelanggan aktif, dll)
- business_context: konteks penting sesuai domain tenant

## Aturan Ekstraksi
- Simpan hanya fakta eksplisit dari user.
- Jangan menyimpan asumsi atau opini model.
- Update value jika user memberi data terbaru yang bertentangan.
- Hindari menyimpan data sensitif yang tidak diperlukan operasional.

## Kualitas Data
- Gunakan key yang konsisten agar mudah dipakai ulang.
- Simpan value singkat, jelas, dan mudah dicari.
- Jika ragu validitas data, jangan simpan.

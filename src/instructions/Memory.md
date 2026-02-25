# Memory

## Aturan Ekstraksi Memory

Dari setiap percakapan, ekstrak dan simpan fakta penting tentang user:

### Data yang harus disimpan:
- **name**: Nama lengkap user (jika disebutkan)
- **city**: Kota/domisili user
- **university**: Universitas asal
- **major**: Jurusan/program studi
- **scholarship_target**: Beasiswa yang ditargetkan
- **study_plan**: Rencana studi di luar negeri
- **preparation_stage**: Tahap persiapan (awal/menengah/akhir)

### Aturan:
- Hanya simpan fakta yang eksplisit disebutkan user
- Jangan menyimpulkan fakta yang tidak jelas
- Update fakta jika user memberikan informasi baru yang berbeda
- Confidence score 1.0 untuk fakta yang jelas, 0.5 untuk yang ambigu

# Backup & Restore Runbook (Domain 9.2)

Dokumen ini mendefinisikan backup/restore plan untuk PostgreSQL dan Redis.

## 1. Tujuan

- Memastikan data tenant dapat dipulihkan jika terjadi insiden.
- Menetapkan RPO/RTO baseline.

## 2. Target SLA

- RPO: <= 15 menit (dengan jadwal backup berkala)
- RTO: <= 60 menit (restore + verifikasi)

## 3. Prasyarat

- `DATABASE_URL` tersedia untuk PostgreSQL.
- `REDIS_URL` tersedia untuk Redis.
- Tool sistem terpasang: `pg_dump`, `pg_restore`, `redis-cli`.

## 4. Prosedur Backup

### PostgreSQL

```bash
DATABASE_URL='postgres://...' BACKUP_DIR='./backups/postgres' ./ops/backup-postgres.sh
```

Output: file `pg-<timestamp>.dump`.

### Redis

```bash
REDIS_URL='redis://...' BACKUP_DIR='./backups/redis' ./ops/backup-redis.sh
```

Output: file `redis-<timestamp>.rdb`.

## 5. Prosedur Restore

### PostgreSQL

```bash
DATABASE_URL='postgres://...' ./ops/restore-postgres.sh ./backups/postgres/pg-<timestamp>.dump
```

### Redis

```bash
REDIS_DATA_DIR='./data/redis' ./ops/restore-redis.sh ./backups/redis/redis-<timestamp>.rdb
```

Setelah copy `dump.rdb`, restart Redis service.

## 6. Validasi Pasca Restore

- Jalankan health-check aplikasi.
- Jalankan query cepat tenant/workspace/message.
- Jalankan endpoint status queue + WA status.
- Jalankan smoke test: enqueue pesan -> worker proses -> outbound terkirim.

## 7. Retensi dan Rotasi

- Simpan backup harian minimal 14 hari.
- Simpan backup mingguan minimal 8 minggu.
- Backup terenkripsi jika disimpan di object storage.

## 8. Latihan Berkala

- Uji restore minimal 1x/bulan di environment staging.
- Catat durasi restore aktual untuk evaluasi RTO.

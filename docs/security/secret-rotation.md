# Secret Rotation Policy (Domain 10.1)

Dokumen ini menetapkan kebijakan rotasi untuk secret dan credential sensitif di `wa-gateway`.

## Scope

Secret berikut wajib masuk program rotasi:

- `NEXTAUTH_SECRET`
- `CREDENTIAL_VAULT_KEY`
- `BILLING_WEBHOOK_SECRET`
- credential provider/customer webhook secret yang disimpan di `WorkspaceCredential` dan `WebhookEndpoint`
- token akses pihak ketiga berumur panjang yang dipersist ke DB

## Cadence

- Secret platform utama: rotasi minimal tiap 90 hari.
- Webhook secret dan API credential tenant: rotasi minimal tiap 180 hari atau segera setelah indikasi compromise.
- Secret insidental: rotasi segera setelah:
  - personel dengan akses keluar dari tim
  - secret muncul di log, tiket, chat, atau commit
  - provider mengindikasikan abuse atau credential leak

## Requirements

- Seluruh secret baru harus dibuat dengan generator kriptografis yang aman.
- Secret lama dan baru harus punya window overlap jika integrasi memerlukan cutover bertahap.
- Nilai secret tidak boleh ditulis ke log aplikasi, tool log, atau dashboard.
- Secret di DB harus tetap disimpan terenkripsi.

## Rotation Procedure

1. Inventaris secret yang akan dirotasi dan identifikasi dependensi downstream.
2. Generate secret baru dan simpan di secret manager/environment target.
3. Deploy aplikasi dengan secret baru bila diperlukan.
4. Update integrasi eksternal atau tenant yang memakai secret tersebut.
5. Verifikasi health check, webhook delivery, auth session, dan flow utama setelah cutover.
6. Revoke secret lama segera setelah verifikasi selesai.
7. Catat waktu rotasi, owner, scope, dan hasil verifikasi di change log operasional.

## Verification Checklist

- Login dashboard tetap berfungsi.
- Enkripsi/dekripsi credential baru tetap berhasil.
- Webhook inbound/outbound tervalidasi dengan secret baru.
- Billing webhook tetap diterima.
- Channel reconnect dan provider token refresh tetap berjalan.

## Emergency Rotation

- Jika ada indikasi compromise, lewati overlap dan revoke secret lama secepat mungkin.
- Force logout session user bila `NEXTAUTH_SECRET` atau token session terkait terdampak.
- Audit log/change log harus mencatat alasan, blast radius, dan timestamp tindakan darurat.

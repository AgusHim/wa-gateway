# Domain 9: Security, Privacy, dan Governance

Dokumen ini merangkum baseline Domain 9 untuk integrasi Instagram di `wa-gateway`.

## 9.1 Credential & Secret Security

- Access token Instagram disimpan encrypted-at-rest di `WorkspaceCredential.encryptedValue` lewat `workspaceCredentialRepo`.
- OAuth state disimpan di tabel `Session`; session storage sudah terenkripsi oleh `sessionRepo` + `sessionCipher`.
- Default OAuth scopes dibatasi ke scope minimum yang dipakai runtime saat ini:
  - `instagram_basic`
  - `instagram_manage_messages`
  - `instagram_manage_comments`
  - `pages_show_list`
  - `pages_read_engagement`
- Override scope tetap bisa dilakukan via `INSTAGRAM_OAUTH_SCOPES`, tetapi baseline production sebaiknya tidak menambah scope tanpa kebutuhan yang jelas.

### SOP Rotasi Secret

1. Rotasi `INSTAGRAM_APP_SECRET` di Meta App, lalu update secret deployment dan restart semua node runtime.
2. Verifikasi webhook signature tetap valid di `POST /api/instagram/webhook`.
3. Rotasi `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, update konfigurasi webhook di Meta Developer, lalu verifikasi ulang challenge `GET /api/instagram/webhook`.
4. Jalankan reconnect atau manual token refresh untuk channel yang perlu divalidasi ulang.
5. Cek audit trail `instagram_oauth_connected`, `instagram_token_refreshed`, dan `instagram_token_refresh_failed`.

## 9.2 Data Privacy

Retention policy default:

- DM event: `365` hari (`INSTAGRAM_DM_RETENTION_DAYS`)
- Comment event: `180` hari (`INSTAGRAM_COMMENT_RETENTION_DAYS`)
- Media metadata: `90` hari (`INSTAGRAM_MEDIA_METADATA_RETENTION_DAYS`)

Workflow hapus data per user tersedia lewat endpoint internal:

- `DELETE /api/instagram/users/:id/data`

Endpoint ini menghapus artefak user Instagram tenant-scoped:

- `Message`
- `Memory`
- `HandoverTicket`
- `CampaignRecipient`
- record `ChatUser` Instagram itu sendiri

PII redaction untuk tool log mengikuti `WorkspaceConfig.piiRedactionEnabled`. Jika flag aktif, input/output tool otomatis disanitasi sebelum dipersist.

## 9.3 Auditability

Audit trail yang tersedia:

- connect/disconnect channel Instagram
- token refresh success/failure
- update auto-reply policy Instagram
- update channel send policy
- skip trace karena `thread-auto-reply-disabled` atau `human override`
- manual privacy deletion per user Instagram

Endpoint internal investigasi incident:

- `GET /api/instagram/channels/:id/incident`

Snapshot incident memuat:

- status channel, token, webhook, dan binding account
- auto-reply rules aktif
- retention policy aktif
- recent channel audits
- recent message timeline per channel
- skipped messages
- open handover tickets yang relevan

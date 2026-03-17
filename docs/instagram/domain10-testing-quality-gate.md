# Domain 10: Testing, Sandbox, dan Quality Gate

Dokumen ini merangkum artefak Domain 10 yang bisa dijalankan lokal, plus item staging yang masih perlu validasi nyata.

## 10.1 Test Strategy

Unit test yang tersedia:

- parser + signature verification: `tests/instagramWebhookDomain4.test.cjs`
- repo scoping query Instagram: `tests/instagramRepoScoping.test.cjs`
- governance/security defaults: `tests/instagramGovernance.test.cjs`

Integration dan contract test yang tersedia:

- worker flow DM/comment -> runner -> outbound mock: `tests/instagramIntegrationDomain10.test.cjs`
- contract mapping Meta client request/response: `tests/instagramClientContract.test.cjs`

Command verifikasi lokal:

```bash
npm run lint
npx tsc --noEmit
node --test -r ./tests/setup.cjs ./tests/instagramWebhookDomain4.test.cjs ./tests/instagramRepoScoping.test.cjs ./tests/instagramClientContract.test.cjs ./tests/instagramIntegrationDomain10.test.cjs ./tests/instagramGovernance.test.cjs
```

## 10.2 Staging Validation

Item ini masih butuh eksekusi manual di environment staging dengan akun Meta test yang valid.

Checklist staging:

1. Siapkan satu Instagram Business/Creator test yang terhubung ke Page test.
2. Pastikan app mode dan redirect URI staging sudah sesuai.
3. Jalankan skenario:
   - comment masuk -> AI reply comment
   - DM masuk -> AI reply DM
   - token expired / permission missing / rate limit hit
4. Simpan bukti hasil pada incident snapshot channel dan audit trail.

## 10.3 Quality Gate

Release checklist minimum sebelum tenant pertama:

- `lint`, `tsc`, dan suite test Instagram lulus
- cek tenant isolation di query/replay/observability
- cek idempotency webhook agar tidak ada duplicate reply
- jalankan burst smoke test lokal untuk inbound event
- review audit trail untuk outbound success/failure

Burst smoke test saat ini dicakup oleh `tests/instagramIntegrationDomain10.test.cjs`.

Sign-off operasional tetap butuh approval manusia sebelum go-live tenant pertama.

# Domain 3 - Data Model & Repository Layer (Instagram)

Dokumen ini merangkum implementasi Domain 3 untuk integrasi Instagram CRM.

## 1) Perubahan Prisma Schema

Implementasi menambahkan struktur data agar channel Instagram punya source-of-truth terpisah dari metadata credential:

- Enum `ChannelProvider` pada model `Channel` lewat field `providerType`.
- Enum `InstagramTokenStatus` (`CONNECTED | EXPIRED | INVALID`).
- Model baru `InstagramChannelConfig` untuk binding channel Instagram:
  - `workspaceId`, `channelId`, `pageId`, `instagramAccountId`, `credentialName`
  - `appScopedUserId`, `pageName`, `instagramUsername`
  - `webhookFields`, `webhookSubscribedAt`, `lastWebhookAt`
  - `tokenStatus`, `tokenExpiresAt`, `tokenLastRefreshAt`
  - `metadata`, `createdAt`, `updatedAt`

## 2) Migration & Backfill Existing Tenant

Migration: `prisma/migrations/20260314121000_domain3_instagram_data_model/migration.sql`

Yang dilakukan migration:

- Tambah enum + kolom `Channel.providerType` + index provider typed.
- Backfill `providerType` dari nilai legacy `Channel.provider`.
- Buat tabel `InstagramChannelConfig` + FK + index.
- Backfill data dari `WorkspaceCredential` provider `meta-instagram` (nama credential pola `instagram:channel:%:access_token`) ke `InstagramChannelConfig`.

Tujuan backfill: tenant existing tetap bisa lanjut tanpa perlu reconnect ulang.

## 3) Repository Layer Baru

File baru: `src/lib/integrations/instagram/channelRepo.ts`

Fungsi utama (semua strict workspace scope):

- `upsertConfig(...)`
- `getWorkspaceChannelConfig(workspaceId, channelId)`
- `listWorkspaceChannelConfigs(workspaceId)`
- `deleteWorkspaceChannelConfig(workspaceId, channelId)`
- `getByInstagramAccountId(workspaceId, instagramAccountId)`

## 4) Refactor `instagramRepo`

File: `src/lib/integrations/instagram/repo.ts`

Prinsip baru:

- Source-of-truth binding/token status: `InstagramChannelConfig`.
- Token access tetap encrypted di `WorkspaceCredential`.
- OAuth state sementara tetap disimpan di `Session`.
- Fallback kompatibilitas: jika config belum ada tetapi metadata credential legacy ada, repo otomatis backfill config saat read.

## 5) Standarisasi Metadata Message Instagram

File baru: `src/lib/integrations/instagram/messageMetadata.ts`

Key standar metadata:

- `source` (`instagram`)
- `eventType` (`instagram-dm` / `instagram-comment`)
- `channelId`
- `igUserId`, `igUsername`
- `threadId`, `commentId`, `mediaId`
- `pageId`, `instagramAccountId`

Helper tersedia:

- `buildInstagramMessageMetadata(...)`
- `isInstagramMessageMetadata(...)`

## 6) Query Helper Conversation

File: `src/lib/db/messageRepo.ts`

Tambahan helper:

- `getConversationByInstagramThread(workspaceId, threadId, page?, pageSize?, channelId?)`
- `getConversationByInstagramUserId(workspaceId, igUserId, page?, pageSize?, channelId?)`

Keduanya memfilter `metadata.source = "instagram"` dan menegakkan scope `workspaceId`.

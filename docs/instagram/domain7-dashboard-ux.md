# Domain 7 - CRM Inbox & Dashboard UX

## Ringkasan
Domain 7 menambah UX dashboard untuk operasional Instagram CRM: channel management, inbox thread view, takeover operator, dan rule config + sandbox.

## 1) Channel Management UI

Perubahan:
- `src/app/(dashboard)/channels/page.tsx`
- `src/app/api/wa/channels/route.ts`
- `src/app/api/instagram/channels/[id]/disconnect/route.ts`

Fitur:
- Connect / Refresh / Disconnect Instagram dari halaman Channels.
- Menampilkan detail OAuth binding:
  - token status, token expiry
  - scopes/permissions
  - webhook subscribed timestamp
  - last webhook ping
- Audit timeline tetap tampil untuk connect/reconnect/error.

## 2) Conversation Inbox

Perubahan:
- `src/app/(dashboard)/conversations/page.tsx`
- `src/app/(dashboard)/actions.ts`
- `src/lib/db/userRepo.ts`
- `src/lib/db/messageRepo.ts`
- `src/lib/integrations/instagram/webhookWorker.ts`

Fitur:
- Filter source conversation:
  - WhatsApp
  - Instagram (all)
  - Instagram DM
  - Instagram Comment
- Thread view untuk Instagram berdasarkan `threadId`.
- Metadata asal konten tampil di bubble pesan (`eventType`, `threadId`, `commentId`, `mediaId`, outbound status).
- Operator controls per thread:
  - Takeover thread
  - Toggle auto-reply ON/OFF per thread
- Worker menghormati state auto-reply thread; jika OFF event inbound disimpan sebagai skipped tanpa generate reply.

## 3) Config Panel

Perubahan:
- `src/app/(dashboard)/config/page.tsx`
- `src/app/(dashboard)/config/InstagramRuleSandbox.tsx`
- `src/app/(dashboard)/actions.ts`
- `src/lib/integrations/instagram/ruleConfig.ts`
- `src/app/api/instagram/rules/preview/route.ts`

Fitur:
- Rule config auto-reply comment:
  - enabled/disabled
  - keyword mode (`all` / `keywords`)
  - keywords list
  - sentiment threshold
- Rule config auto-reply DM:
  - enabled/disabled
  - business-hours-only
  - fallback message
  - escalation policy
- Sandbox preview untuk simulasi event IG (DM/comment) dan melihat decision allow/block + reason.


# Domain 1 Foundation - Instagram CRM

This document finalizes Domain 1 decisions for Instagram CRM expansion in `wa-gateway`.

## 1) Scope v1

Included in v1:
- Auto-reply DM inbound.
- Auto-reply comment inbound.
- Human takeover guard (AI must stop on operator reply).
- Unified channel registration (`whatsapp` and `instagram`) per workspace.

Not included in v1:
- Publishing/scheduling Instagram posts.
- Ads, campaign manager, and moderation automation.
- Multi-account routing rules beyond workspace-level channel ownership.

## 2) Service Level Targets

- Webhook acknowledgment p95: under 2 seconds.
- Inbound event to queue enqueue p95: under 1 second.
- Inbound event to AI response enqueue p95: under 10 seconds.
- Delivery success target (excluding provider policy reject): at least 98%.

## 3) Unified Channel Strategy

- `Channel.provider` supports:
  - `whatsapp`
  - `instagram`
- WhatsApp runtime bootstrap/connect flows only run for `provider=whatsapp`.
- Instagram channels are accepted and persisted now, while messaging runtime is implemented in the next domains.

## 4) User Identity Strategy

Canonical user identifier in `ChatUser.phoneNumber`:
- WhatsApp: real phone identifier (existing behavior).
- Instagram:
  - `ig:{externalUserId}` when external ID exists.
  - fallback `ig:u:{username}` for username-only identity.

This keeps existing schema compatible while enabling cross-channel user upsert with strict workspace scope.

## 5) Multi-Workspace Isolation Rules

- All channel CRUD remains scoped by `workspaceId`.
- WA connect/disconnect/reset APIs reject non-WhatsApp provider channels.
- Any future Instagram webhook ingestion must resolve channel by `workspaceId + channelId` before processing.


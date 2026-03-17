# Domain 2 - Meta OAuth and Token Lifecycle

This document describes the implemented Domain 2 flow for Instagram channel connection.

## Environment Variables

Required:
- `INSTAGRAM_APP_ID`
- `INSTAGRAM_APP_SECRET`

Optional:
- `INSTAGRAM_GRAPH_API_VERSION` (default: `v23.0`)
- `INSTAGRAM_OAUTH_SCOPES`
- `INSTAGRAM_REDIRECT_URI` (override callback URL)
- `INSTAGRAM_OAUTH_STATE_TTL_MS` (default: 10 minutes)
- `INSTAGRAM_TOKEN_REFRESH_INTERVAL_MINUTES` (default: 30)
- `INSTAGRAM_TOKEN_REFRESH_THRESHOLD_HOURS` (default: 120 / 5 days)

Callback endpoint:
- `/api/instagram/oauth/callback`

Default callback URL resolution:
- `NEXTAUTH_URL` -> `NEXT_PUBLIC_APP_URL` -> request origin.

## OAuth Connect Flow

1. Dashboard calls:
- `POST /api/instagram/channels/:id/connect`

2. Server validates:
- User permission `manage_channel`
- Channel belongs to current workspace
- Channel provider is `instagram`

3. Server creates one-time OAuth state:
- Stored in `Session` table with TTL metadata
- Includes `workspaceId`, `userId`, `channelId`, `returnPath`

4. Server returns Meta OAuth URL.

5. User authorizes Meta app and is redirected to callback:
- `GET /api/instagram/oauth/callback?code=...&state=...`

6. Callback exchanges token and resolves page/account binding:
- Exchange auth code -> short token
- Attempt short -> long-lived token exchange
- Fetch `/me/accounts` and bind Page + Instagram Business Account

7. Credential persistence:
- Access token stored encrypted in `WorkspaceCredential`
- Provider: `meta-instagram`
- Name: `instagram:channel:{channelId}:access_token`
- Metadata includes `channelId`, `pageId`, `instagramAccountId`, `instagramUsername`, `scopes`, `expiresAt`, `status`

8. Channel health is updated to connected and audit is recorded.

## Manual Reconnect and Refresh

Manual reconnect routes:
- `POST /api/instagram/channels/:id/connect`
- `POST /api/instagram/channels/:id/reconnect` (alias)

Manual refresh route:
- `POST /api/instagram/channels/:id/refresh-token`

Behavior:
- Refresh updates encrypted token + metadata expiration
- Invalid token marks channel degraded/disconnected and writes audit

## Automatic Refresh Scheduler

Scheduler starts at bootstrap:
- `startInstagramTokenRefreshScheduler()`

Cycle behavior:
- Scan expiring Instagram credentials before threshold window
- Attempt long-lived token refresh
- Update channel health and audit


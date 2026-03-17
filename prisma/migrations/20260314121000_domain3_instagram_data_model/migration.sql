DO $$
BEGIN
    CREATE TYPE "ChannelProvider" AS ENUM ('WHATSAPP', 'INSTAGRAM');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "InstagramTokenStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'INVALID');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Channel"
ADD COLUMN IF NOT EXISTS "providerType" "ChannelProvider";

ALTER TABLE "Channel"
ALTER COLUMN "providerType" SET DEFAULT 'WHATSAPP';

UPDATE "Channel"
SET "providerType" = CASE
    WHEN lower(COALESCE("provider", '')) = 'instagram' THEN 'INSTAGRAM'::"ChannelProvider"
    ELSE 'WHATSAPP'::"ChannelProvider"
END
WHERE "providerType" IS NULL
   OR "providerType" <> CASE
        WHEN lower(COALESCE("provider", '')) = 'instagram' THEN 'INSTAGRAM'::"ChannelProvider"
        ELSE 'WHATSAPP'::"ChannelProvider"
   END;

ALTER TABLE "Channel"
ALTER COLUMN "providerType" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "Channel_workspaceId_providerType_isEnabled_idx"
ON "Channel"("workspaceId", "providerType", "isEnabled");

CREATE TABLE IF NOT EXISTS "InstagramChannelConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "appScopedUserId" TEXT,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT,
    "instagramAccountId" TEXT NOT NULL,
    "instagramUsername" TEXT,
    "webhookFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webhookSubscribedAt" TIMESTAMP(3),
    "credentialName" TEXT NOT NULL,
    "tokenStatus" "InstagramTokenStatus" NOT NULL DEFAULT 'CONNECTED',
    "tokenExpiresAt" TIMESTAMP(3),
    "tokenLastRefreshAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramChannelConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InstagramChannelConfig_channelId_key" UNIQUE ("channelId")
);

DO $$
BEGIN
    ALTER TABLE "InstagramChannelConfig"
        ADD CONSTRAINT "InstagramChannelConfig_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "InstagramChannelConfig"
        ADD CONSTRAINT "InstagramChannelConfig_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "InstagramChannelConfig_workspaceId_instagramAccountId_idx"
ON "InstagramChannelConfig"("workspaceId", "instagramAccountId");

CREATE INDEX IF NOT EXISTS "InstagramChannelConfig_workspaceId_pageId_idx"
ON "InstagramChannelConfig"("workspaceId", "pageId");

CREATE INDEX IF NOT EXISTS "InstagramChannelConfig_workspaceId_tokenStatus_idx"
ON "InstagramChannelConfig"("workspaceId", "tokenStatus");

WITH candidates AS (
    SELECT
        wc."workspaceId" AS workspace_id,
        COALESCE(
            NULLIF(wc."metadata"->>'channelId', ''),
            substring(wc."name" from 'instagram:channel:([^:]+):access_token')
        ) AS channel_id,
        NULLIF(wc."metadata"->>'appScopedUserId', '') AS app_scoped_user_id,
        NULLIF(wc."metadata"->>'pageId', '') AS page_id,
        NULLIF(wc."metadata"->>'pageName', '') AS page_name,
        NULLIF(wc."metadata"->>'instagramAccountId', '') AS instagram_account_id,
        NULLIF(wc."metadata"->>'instagramUsername', '') AS instagram_username,
        wc."name" AS credential_name,
        CASE
            WHEN lower(COALESCE(wc."metadata"->>'status', 'connected')) = 'invalid' THEN 'INVALID'::"InstagramTokenStatus"
            WHEN lower(COALESCE(wc."metadata"->>'status', 'connected')) = 'expired' THEN 'EXPIRED'::"InstagramTokenStatus"
            ELSE 'CONNECTED'::"InstagramTokenStatus"
        END AS token_status,
        CASE
            WHEN (wc."metadata"->>'expiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN (wc."metadata"->>'expiresAt')::timestamp
            ELSE NULL
        END AS token_expires_at,
        CASE
            WHEN COALESCE(wc."metadata"->>'lastRefreshedAt', wc."metadata"->>'updatedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                THEN (COALESCE(wc."metadata"->>'lastRefreshedAt', wc."metadata"->>'updatedAt'))::timestamp
            ELSE NULL
        END AS token_last_refresh_at,
        CASE
            WHEN (wc."metadata"->>'connectedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                THEN (wc."metadata"->>'connectedAt')::timestamp
            ELSE NULL
        END AS webhook_subscribed_at,
        CASE
            WHEN jsonb_typeof(wc."metadata"->'scopes') = 'array'
                THEN ARRAY(SELECT jsonb_array_elements_text(wc."metadata"->'scopes'))
            ELSE ARRAY[]::TEXT[]
        END AS webhook_fields,
        wc."metadata" AS legacy_metadata,
        wc."createdAt" AS created_at,
        wc."updatedAt" AS updated_at
    FROM "WorkspaceCredential" wc
    WHERE wc."provider" = 'meta-instagram'
      AND wc."name" LIKE 'instagram:channel:%:access_token'
)
INSERT INTO "InstagramChannelConfig" (
    "id",
    "workspaceId",
    "channelId",
    "appScopedUserId",
    "pageId",
    "pageName",
    "instagramAccountId",
    "instagramUsername",
    "webhookFields",
    "webhookSubscribedAt",
    "credentialName",
    "tokenStatus",
    "tokenExpiresAt",
    "tokenLastRefreshAt",
    "metadata",
    "createdAt",
    "updatedAt"
)
SELECT
    'igcfg_' || md5(c.workspace_id || ':' || c.channel_id),
    c.workspace_id,
    c.channel_id,
    c.app_scoped_user_id,
    c.page_id,
    c.page_name,
    c.instagram_account_id,
    c.instagram_username,
    c.webhook_fields,
    c.webhook_subscribed_at,
    c.credential_name,
    c.token_status,
    c.token_expires_at,
    c.token_last_refresh_at,
    jsonb_strip_nulls(jsonb_build_object(
        'migratedFrom', 'WorkspaceCredential',
        'sourceCredentialName', c.credential_name,
        'legacyMetadata', c.legacy_metadata
    )),
    COALESCE(c.created_at, CURRENT_TIMESTAMP),
    COALESCE(c.updated_at, CURRENT_TIMESTAMP)
FROM candidates c
INNER JOIN "Channel" ch
    ON ch."id" = c.channel_id
   AND ch."workspaceId" = c.workspace_id
WHERE c.channel_id IS NOT NULL
  AND c.page_id IS NOT NULL
  AND c.instagram_account_id IS NOT NULL
ON CONFLICT ("channelId") DO NOTHING;

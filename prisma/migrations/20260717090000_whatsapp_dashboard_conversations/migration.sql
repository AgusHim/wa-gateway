ALTER TABLE "Message"
ADD COLUMN IF NOT EXISTS "channelId" TEXT,
ADD COLUMN IF NOT EXISTS "deliveryStatus" TEXT,
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
ADD COLUMN IF NOT EXISTS "externalMessageId" TEXT,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Message" AS message
SET "channelId" = message."metadata"->>'channelId'
WHERE message."channelId" IS NULL
  AND NULLIF(message."metadata"->>'channelId', '') IS NOT NULL
  AND EXISTS (
      SELECT 1
      FROM "Channel" AS channel
      WHERE channel."id" = message."metadata"->>'channelId'
        AND channel."workspaceId" = message."workspaceId"
  );

DO $$
BEGIN
    ALTER TABLE "Message"
        ADD CONSTRAINT "Message_channelId_fkey"
        FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Message_workspaceId_channelId_createdAt_idx"
ON "Message"("workspaceId", "channelId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "Message_workspaceId_idempotencyKey_key"
ON "Message"("workspaceId", "idempotencyKey");

CREATE TABLE IF NOT EXISTS "MessageAttachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "storageKey" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER,
    "checksum" TEXT,
    "durationMs" INTEGER,
    "isAnimated" BOOLEAN NOT NULL DEFAULT false,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    ALTER TABLE "MessageAttachment"
        ADD CONSTRAINT "MessageAttachment_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "MessageAttachment"
        ADD CONSTRAINT "MessageAttachment_messageId_fkey"
        FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "MessageAttachment_workspaceId_messageId_idx"
ON "MessageAttachment"("workspaceId", "messageId");

CREATE UNIQUE INDEX IF NOT EXISTS "MessageAttachment_workspaceId_storageKey_key"
ON "MessageAttachment"("workspaceId", "storageKey");

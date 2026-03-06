-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REVOKED');

-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('MESSAGE_RECEIVED', 'MESSAGE_SENT', 'HANDOVER_CREATED', 'TOOL_FAILED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SUCCESS', 'FAILED', 'DEAD', 'CANCELED');

-- CreateTable
CREATE TABLE "WorkspaceApiKey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEncrypted" TEXT NOT NULL,
    "events" "WebhookEventType"[] DEFAULT ARRAY['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'HANDOVER_CREATED', 'TOOL_FAILED']::"WebhookEventType"[],
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "includeHeaders" JSONB,
    "createdByUserId" TEXT,
    "lastDeliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventType" "WebhookEventType" NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 6,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "requestHeaders" JSONB,
    "requestBody" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "replayOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceApiKey_keyHash_key" ON "WorkspaceApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "WorkspaceApiKey_workspaceId_status_createdAt_idx" ON "WorkspaceApiKey"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceApiKey_workspaceId_keyPrefix_status_idx" ON "WorkspaceApiKey"("workspaceId", "keyPrefix", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceApiKey_workspaceId_name_key" ON "WorkspaceApiKey"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_workspaceId_status_createdAt_idx" ON "WebhookEndpoint"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_workspaceId_name_key" ON "WebhookEndpoint"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "WebhookDelivery_workspaceId_status_nextAttemptAt_idx" ON "WebhookDelivery"("workspaceId", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_workspaceId_eventType_createdAt_idx" ON "WebhookDelivery"("workspaceId", "eventType", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkspaceApiKey" ADD CONSTRAINT "WorkspaceApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_replayOfId_fkey" FOREIGN KEY ("replayOfId") REFERENCES "WebhookDelivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

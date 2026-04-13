-- CreateTable
CREATE TABLE "PendingToolConfirmation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatSessionId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingToolConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingToolConfirmation_userId_expiresAt_idx" ON "PendingToolConfirmation"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "PendingToolConfirmation" ADD CONSTRAINT "PendingToolConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingToolConfirmation" ADD CONSTRAINT "PendingToolConfirmation_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

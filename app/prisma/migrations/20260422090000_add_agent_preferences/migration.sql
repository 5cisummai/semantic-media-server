-- CreateTable
CREATE TABLE "AgentPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "autoApproveToolNames" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentPreference_userId_workspaceId_key" ON "AgentPreference"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "AgentPreference_workspaceId_userId_idx" ON "AgentPreference"("workspaceId", "userId");

-- AddForeignKey
ALTER TABLE "AgentPreference" ADD CONSTRAINT "AgentPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPreference" ADD CONSTRAINT "AgentPreference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

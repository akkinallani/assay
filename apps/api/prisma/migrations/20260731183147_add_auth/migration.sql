/*
  Warnings:

  - Added the required column `tenantId` to the `Signal` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `Verdict` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable (nullable first — backfilled below, then locked to NOT NULL)
ALTER TABLE "Signal" ADD COLUMN     "tenantId" TEXT;

-- AlterTable (nullable first — backfilled below, then locked to NOT NULL)
ALTER TABLE "Verdict" ADD COLUMN     "tenantId" TEXT;

-- Backfill tenantId from the owning WorkUnit for existing rows
UPDATE "Signal" s
SET "tenantId" = w."tenantId"
FROM "WorkUnit" w
WHERE s."workUnitId" = w."id";

UPDATE "Verdict" v
SET "tenantId" = w."tenantId"
FROM "WorkUnit" w
WHERE v."workUnitId" = w."id";

ALTER TABLE "Signal" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "Verdict" ALTER COLUMN "tenantId" SET NOT NULL;

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Signal_tenantId_idx" ON "Signal"("tenantId");

-- CreateIndex
CREATE INDEX "Verdict_tenantId_idx" ON "Verdict"("tenantId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkUnit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "rubric" JSONB NOT NULL,
    "modelOutput" TEXT NOT NULL,
    "attachments" JSONB,
    "grade" JSONB NOT NULL,
    "graderId" TEXT NOT NULL,
    "timeSpentSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "workUnitId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fired" BOOLEAN NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "evidence" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verdict" (
    "id" TEXT NOT NULL,
    "workUnitId" TEXT NOT NULL,
    "risk" DOUBLE PRECISION NOT NULL,
    "recommendation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Verdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraderStat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "graderId" TEXT NOT NULL,
    "itemsSeen" INTEGER NOT NULL DEFAULT 0,
    "flagCount" INTEGER NOT NULL DEFAULT 0,
    "agreementCount" INTEGER NOT NULL DEFAULT 0,
    "regradeCount" INTEGER NOT NULL DEFAULT 0,
    "domainStats" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GraderStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Batch_tenantId_idx" ON "Batch"("tenantId");

-- CreateIndex
CREATE INDEX "WorkUnit_tenantId_batchId_idx" ON "WorkUnit"("tenantId", "batchId");

-- CreateIndex
CREATE INDEX "WorkUnit_graderId_idx" ON "WorkUnit"("graderId");

-- CreateIndex
CREATE INDEX "Signal_workUnitId_idx" ON "Signal"("workUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "Verdict_workUnitId_key" ON "Verdict"("workUnitId");

-- CreateIndex
CREATE INDEX "GraderStat_tenantId_idx" ON "GraderStat"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "GraderStat_tenantId_graderId_key" ON "GraderStat"("tenantId", "graderId");

-- AddForeignKey
ALTER TABLE "WorkUnit" ADD CONSTRAINT "WorkUnit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_workUnitId_fkey" FOREIGN KEY ("workUnitId") REFERENCES "WorkUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verdict" ADD CONSTRAINT "Verdict_workUnitId_fkey" FOREIGN KEY ("workUnitId") REFERENCES "WorkUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

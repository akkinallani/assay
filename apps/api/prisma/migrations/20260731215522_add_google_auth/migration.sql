-- AlterTable
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;

-- CreateIndex
-- Safe: existing rows all have NULL googleId, and Postgres unique indexes permit
-- multiple NULLs (NULL is never considered equal to another NULL).
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

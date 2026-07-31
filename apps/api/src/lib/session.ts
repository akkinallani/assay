import type { PrismaClient } from "@prisma/client";

export const SESSION_COOKIE = "quorum_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(prisma: PrismaClient, userId: string) {
  return prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
}

export async function destroySession(prisma: PrismaClient, sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

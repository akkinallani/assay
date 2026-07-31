import type { PrismaClient } from "@prisma/client";
import type { FastifyReply } from "fastify";

export const SESSION_COOKIE = "quorum_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  signed: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function createSession(prisma: PrismaClient, userId: string) {
  return prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
}

export function setSessionCookie(reply: FastifyReply, sessionId: string) {
  reply.setCookie(SESSION_COOKIE, sessionId, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_TTL_MS / 1000 });
}

export async function destroySession(prisma: PrismaClient, sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

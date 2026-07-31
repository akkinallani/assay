import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcryptjs";
import { acceptInviteSchema, inviteTeammateSchema } from "@quorum/schema";
import { createSession, SESSION_COOKIE, SESSION_TTL_MS } from "../lib/session.js";
import { badRequest, conflict, notFound } from "../errors.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const COOKIE_OPTS = {
  httpOnly: true,
  signed: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

const invitesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/invites", async (request, reply) => {
    const parsed = inviteTeammateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("validation_failed", "Validation failed", parsed.error.issues);
    }
    const { email } = parsed.data;

    const existingUser = await fastify.prisma.user.findUnique({ where: { email } });
    if (existingUser) throw conflict("email_taken", "An account with that email already exists");

    const token = crypto.randomBytes(24).toString("hex");
    const invite = await fastify.prisma.invite.create({
      data: {
        tenantId: request.tenantId,
        email,
        token,
        invitedByUserId: request.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    return reply.code(201).send({
      id: invite.id,
      email: invite.email,
      token: invite.token,
      expiresAt: invite.expiresAt,
    });
  });

  fastify.get("/invites", async (request) => {
    const invites = await fastify.prisma.invite.findMany({
      where: { tenantId: request.tenantId, acceptedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      token: i.token,
      expiresAt: i.expiresAt,
      expired: i.expiresAt < new Date(),
    }));
  });

  fastify.get("/team/members", async (request) => {
    const members = await fastify.prisma.user.findMany({
      where: { tenantId: request.tenantId },
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return members;
  });

  fastify.post("/invites/:token/accept", async (request, reply) => {
    const { token } = request.params as { token: string };
    const parsed = acceptInviteSchema.safeParse(request.body);
    if (!parsed.success) {
      throw badRequest("validation_failed", "Validation failed", parsed.error.issues);
    }

    const invite = await fastify.prisma.invite.findUnique({ where: { token } });
    if (!invite) throw notFound("invite_not_found");
    if (invite.acceptedAt) throw conflict("invite_already_accepted", "This invite has already been used");
    if (invite.expiresAt < new Date()) throw conflict("invite_expired", "This invite has expired");

    const existingUser = await fastify.prisma.user.findUnique({ where: { email: invite.email } });
    if (existingUser) throw conflict("email_taken", "An account with that email already exists");

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    const user = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: invite.email, passwordHash, tenantId: invite.tenantId },
        include: { tenant: true },
      });
      await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      return created;
    });

    const session = await createSession(fastify.prisma, user.id);
    reply.setCookie(SESSION_COOKIE, session.id, { ...COOKIE_OPTS, maxAge: SESSION_TTL_MS / 1000 });

    return reply
      .code(201)
      .send({ id: user.id, email: user.email, tenantId: user.tenantId, tenantName: user.tenant.name });
  });
};

export default invitesRoutes;

import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { resolveGoogleUser, GoogleAuthError } from "../src/lib/googleAuth.js";

const prisma = new PrismaClient();
const runId = Math.random().toString(36).slice(2);

const createdUserEmails: string[] = [];
const createdTenantNames: string[] = [];

afterAll(async () => {
  await prisma.session.deleteMany({ where: { user: { email: { in: createdUserEmails } } } });
  await prisma.invite.deleteMany({ where: { email: { in: createdUserEmails } } });
  await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
  await prisma.tenant.deleteMany({ where: { name: { in: createdTenantNames } } });
  await prisma.$disconnect();
});

describe("resolveGoogleUser", () => {
  it("rejects an unverified email", async () => {
    await expect(
      resolveGoogleUser(prisma, { googleId: `g-${runId}-1`, email: `unverified-${runId}@example.com`, emailVerified: false })
    ).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it("creates a new tenant and user for a brand-new email", async () => {
    const email = `newuser-${runId}@example.com`;
    createdUserEmails.push(email);

    const user = await resolveGoogleUser(prisma, { googleId: `g-${runId}-2`, email, emailVerified: true });

    expect(user.email).toBe(email);
    expect(user.googleId).toBe(`g-${runId}-2`);
    expect(user.passwordHash).toBeNull();

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    createdTenantNames.push(tenant.name);
    expect(tenant.name).toContain("Newuser");
  });

  it("is idempotent — resolving the same googleId again returns the same user without side effects", async () => {
    const email = `repeat-${runId}@example.com`;
    createdUserEmails.push(email);
    const googleId = `g-${runId}-3`;

    const first = await resolveGoogleUser(prisma, { googleId, email, emailVerified: true });
    createdTenantNames.push((await prisma.tenant.findUniqueOrThrow({ where: { id: first.tenantId } })).name);

    const second = await resolveGoogleUser(prisma, { googleId, email, emailVerified: true });

    expect(second.id).toBe(first.id);
    expect(second.tenantId).toBe(first.tenantId);
    const userCount = await prisma.user.count({ where: { email } });
    expect(userCount).toBe(1);
  });

  it("links to an existing password account with the same email, instead of creating a duplicate", async () => {
    const email = `existing-password-${runId}@example.com`;
    createdUserEmails.push(email);

    const tenant = await prisma.tenant.create({ data: { name: `Existing Tenant ${runId}` } });
    createdTenantNames.push(tenant.name);
    const passwordHash = await bcrypt.hash("correct-horse-battery", 12);
    const existing = await prisma.user.create({ data: { email, passwordHash, tenantId: tenant.id } });

    const linked = await resolveGoogleUser(prisma, { googleId: `g-${runId}-4`, email, emailVerified: true });

    expect(linked.id).toBe(existing.id);
    expect(linked.tenantId).toBe(tenant.id);
    expect(linked.googleId).toBe(`g-${runId}-4`);
    expect(linked.passwordHash).toBe(passwordHash); // password login still works after linking

    const userCount = await prisma.user.count({ where: { email } });
    expect(userCount).toBe(1);
  });

  it("joins a pending invite's tenant instead of creating a new one", async () => {
    const email = `invited-${runId}@example.com`;
    createdUserEmails.push(email);

    const inviterTenant = await prisma.tenant.create({ data: { name: `Inviter Tenant ${runId}` } });
    createdTenantNames.push(inviterTenant.name);
    const inviterPasswordHash = await bcrypt.hash("correct-horse-battery", 12);
    const inviter = await prisma.user.create({
      data: { email: `inviter-${runId}@example.com`, passwordHash: inviterPasswordHash, tenantId: inviterTenant.id },
    });
    createdUserEmails.push(inviter.email);

    await prisma.invite.create({
      data: {
        tenantId: inviterTenant.id,
        email,
        token: `token-${runId}`,
        invitedByUserId: inviter.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const joined = await resolveGoogleUser(prisma, { googleId: `g-${runId}-5`, email, emailVerified: true });

    expect(joined.tenantId).toBe(inviterTenant.id);

    const invite = await prisma.invite.findUniqueOrThrow({ where: { token: `token-${runId}` } });
    expect(invite.acceptedAt).not.toBeNull();
  });

  it("ignores an expired invite and creates a new tenant instead", async () => {
    const email = `expired-invite-${runId}@example.com`;
    createdUserEmails.push(email);

    const inviterTenant = await prisma.tenant.create({ data: { name: `Expired Inviter Tenant ${runId}` } });
    createdTenantNames.push(inviterTenant.name);
    const inviterPasswordHash = await bcrypt.hash("correct-horse-battery", 12);
    const inviter = await prisma.user.create({
      data: { email: `expired-inviter-${runId}@example.com`, passwordHash: inviterPasswordHash, tenantId: inviterTenant.id },
    });
    createdUserEmails.push(inviter.email);

    await prisma.invite.create({
      data: {
        tenantId: inviterTenant.id,
        email,
        token: `expired-token-${runId}`,
        invitedByUserId: inviter.id,
        expiresAt: new Date(Date.now() - 60_000), // already expired
      },
    });

    const user = await resolveGoogleUser(prisma, { googleId: `g-${runId}-6`, email, emailVerified: true });

    expect(user.tenantId).not.toBe(inviterTenant.id);
    createdTenantNames.push((await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } })).name);
  });
});

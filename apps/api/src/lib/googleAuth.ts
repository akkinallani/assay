import type { PrismaClient, User } from "@prisma/client";

export class GoogleAuthError extends Error {}

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
}

function tenantNameFromEmail(email: string): string {
  const local = email.split("@")[0] || "New";
  const capitalized = local.charAt(0).toUpperCase() + local.slice(1);
  return `${capitalized}'s Team`;
}

/**
 * Resolves a verified Google identity to a User row, creating whatever's needed:
 *   1. Existing googleId → that's a login.
 *   2. Existing email (password account, no googleId yet) → link the two.
 *   3. Pending invite for this email → join that invite's tenant.
 *   4. Otherwise → brand-new signup: new tenant + user, same as self-serve email/password signup.
 * Isolated from the HTTP/OAuth plumbing so it's testable directly against Prisma.
 */
export async function resolveGoogleUser(prisma: PrismaClient, profile: GoogleProfile): Promise<User> {
  if (!profile.emailVerified) {
    throw new GoogleAuthError("Google account email is not verified");
  }

  // Normalize here too — this path reaches Prisma directly and never goes through the
  // signup/login zod schemas, so it needs the same case-insensitive handling they apply.
  const email = profile.email.trim().toLowerCase();

  const byGoogleId = await prisma.user.findUnique({ where: { googleId: profile.googleId } });
  if (byGoogleId) return byGoogleId;

  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    return prisma.user.update({ where: { id: byEmail.id }, data: { googleId: profile.googleId } });
  }

  const invite = await prisma.invite.findFirst({
    where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  if (invite) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, googleId: profile.googleId, tenantId: invite.tenantId },
      });
      await tx.invite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
      return user;
    });
  }

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: tenantNameFromEmail(email) } });
    return tx.user.create({
      data: { email, googleId: profile.googleId, tenantId: tenant.id },
    });
  });
}

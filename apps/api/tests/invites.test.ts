import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();
const app = buildApp(redis);

const CSRF_HEADERS = { "x-requested-with": "quorum" };
const runId = Math.random().toString(36).slice(2);
const ownerEmail = `invite-test-owner-${runId}@example.com`;
const inviteeEmail = `invite-test-invitee-${runId}@example.com`;
const outsiderEmail = `invite-test-outsider-${runId}@example.com`;
const password = "correct-horse-battery";

let ownerCookie: string;
let ownerTenantId: string;
let outsiderCookie: string;

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const setCookie = res.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
  return raw.split(";")[0];
}

beforeAll(async () => {
  await app.ready();

  const signup = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: CSRF_HEADERS,
    payload: { email: ownerEmail, password, tenantName: `Invite Tenant ${runId}` },
  });
  ownerCookie = sessionCookieFrom(signup);
  ownerTenantId = signup.json().tenantId;

  const outsiderSignup = await app.inject({
    method: "POST",
    url: "/auth/signup",
    headers: CSRF_HEADERS,
    payload: { email: outsiderEmail, password, tenantName: `Outsider Tenant ${runId}` },
  });
  outsiderCookie = sessionCookieFrom(outsiderSignup);
});

afterAll(async () => {
  await prisma.invite.deleteMany({ where: { tenantId: ownerTenantId } });
  await prisma.session.deleteMany({
    where: { user: { email: { in: [ownerEmail, inviteeEmail, outsiderEmail] } } },
  });
  await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, inviteeEmail, outsiderEmail] } } });
  await prisma.tenant.deleteMany({
    where: { name: { in: [`Invite Tenant ${runId}`, `Outsider Tenant ${runId}`] } },
  });
  await app.close();
  await prisma.$disconnect();
  await redis.quit();
});

describe("invites", () => {
  it("creates an invite and lists it as pending", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { cookie: ownerCookie, ...CSRF_HEADERS },
      payload: { email: inviteeEmail },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().token).toBeTruthy();

    const list = await app.inject({ method: "GET", url: "/invites", headers: { cookie: ownerCookie } });
    expect(list.json().some((i: { email: string }) => i.email === inviteeEmail)).toBe(true);

    const outsiderList = await app.inject({ method: "GET", url: "/invites", headers: { cookie: outsiderCookie } });
    expect(outsiderList.json()).toEqual([]);
  });

  it("accepts an invite and joins the inviter's tenant, not a new one", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { cookie: ownerCookie, ...CSRF_HEADERS },
      payload: { email: `accept-${inviteeEmail}` },
    });
    const { token } = created.json();

    const accepted = await app.inject({
      method: "POST",
      url: `/invites/${token}/accept`,
      headers: CSRF_HEADERS,
      payload: { password },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().tenantId).toBe(ownerTenantId);

    const inviteeCookie = sessionCookieFrom(accepted);
    const members = await app.inject({ method: "GET", url: "/team/members", headers: { cookie: inviteeCookie } });
    expect(members.json().map((m: { email: string }) => m.email)).toContain(`accept-${inviteeEmail}`);

    // Already-accepted tokens can't be reused.
    const retry = await app.inject({
      method: "POST",
      url: `/invites/${token}/accept`,
      headers: CSRF_HEADERS,
      payload: { password },
    });
    expect(retry.statusCode).toBe(409);

    await prisma.session.deleteMany({ where: { user: { email: `accept-${inviteeEmail}` } } });
    await prisma.user.deleteMany({ where: { email: `accept-${inviteeEmail}` } });
  });

  it("rejects an expired invite", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { cookie: ownerCookie, ...CSRF_HEADERS },
      payload: { email: `expired-${inviteeEmail}` },
    });
    const { token } = created.json();

    await prisma.invite.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await app.inject({
      method: "POST",
      url: `/invites/${token}/accept`,
      headers: CSRF_HEADERS,
      payload: { password },
    });
    expect(res.statusCode).toBe(409);
  });

  it("404s accepting an unknown token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/invites/not-a-real-token/accept",
      headers: CSRF_HEADERS,
      payload: { password },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects a second invite to an email that already has a pending invite", async () => {
    const email = `dup-${inviteeEmail}`;
    const first = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { cookie: ownerCookie, ...CSRF_HEADERS },
      payload: { email },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { cookie: ownerCookie, ...CSRF_HEADERS },
      payload: { email },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("invite_pending");

    const list = await app.inject({ method: "GET", url: "/invites", headers: { cookie: ownerCookie } });
    expect(list.json().filter((i: { email: string }) => i.email === email)).toHaveLength(1);
  });

  it("allows re-inviting an email once its earlier invite has expired", async () => {
    const email = `reinvite-${inviteeEmail}`;
    const first = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { cookie: ownerCookie, ...CSRF_HEADERS },
      payload: { email },
    });
    expect(first.statusCode).toBe(201);

    await prisma.invite.update({
      where: { token: first.json().token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const second = await app.inject({
      method: "POST",
      url: "/invites",
      headers: { cookie: ownerCookie, ...CSRF_HEADERS },
      payload: { email },
    });
    expect(second.statusCode).toBe(201);
  });
});

import { generateFixtures } from "./data.js";

const API_URL = process.env.API_URL ?? "http://localhost:3000";
const SEED_EMAIL = process.env.SEED_EMAIL ?? "demo@quorum.dev";
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-123";
const SEED_TENANT_NAME = process.env.SEED_TENANT_NAME ?? "Demo Org";

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("No session cookie returned from auth endpoint");
  return setCookie.split(";")[0];
}

async function getSessionCookie(): Promise<string> {
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
  });
  if (loginRes.ok) {
    console.log(`Logged in as ${SEED_EMAIL}`);
    return extractSessionCookie(loginRes);
  }

  const signupRes = await fetch(`${API_URL}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD, tenantName: SEED_TENANT_NAME }),
  });
  if (!signupRes.ok) {
    throw new Error(`Could not log in or sign up seed user: ${signupRes.status} ${await signupRes.text()}`);
  }
  console.log(`Created demo account ${SEED_EMAIL} / ${SEED_PASSWORD} (org: ${SEED_TENANT_NAME})`);
  return extractSessionCookie(signupRes);
}

async function seed() {
  const cookie = await getSessionCookie();
  const units = generateFixtures();
  console.log(`Seeding ${units.length} work units...`);

  const response = await fetch(`${API_URL}/batches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(units),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Seed failed: ${response.status} ${body}`);
    process.exit(1);
  }

  const result = (await response.json()) as { batchId: string; unitCount: number };
  console.log(`Created batch ${result.batchId} with ${result.unitCount} units`);
  console.log(`\nPoll verdicts: GET ${API_URL}/batches/${result.batchId}/verdict (with the same session cookie)`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

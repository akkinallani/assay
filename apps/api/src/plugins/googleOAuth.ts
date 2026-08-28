import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import fastifyOauth2 from "@fastify/oauth2";
import { createSession, setSessionCookie } from "../lib/session.js";
import { resolveGoogleUser, GoogleAuthError } from "../lib/googleAuth.js";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3000";
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

// Node's fetch() has no default timeout (undici's own internal ceiling is 300s), so a slow or
// hung response from Google here would otherwise leave the callback request — and the user's
// browser tab mid-redirect from Google — hanging for minutes with no feedback. Bounded well
// above this endpoint's normal sub-second latency so it never fires under real network variance.
const GOOGLE_USERINFO_TIMEOUT_MS = 10_000;

interface GoogleUserinfo {
  sub: string;
  email: string;
  email_verified: boolean;
}

// Exported so the timeout behavior can be tested directly, without standing up a full OAuth2
// authorization-code flow (this app has no test coverage for that — GOOGLE_CLIENT_ID/SECRET are
// unset in the test env by design, so the plugin never registers its routes there at all).
export async function fetchGoogleUserinfo(accessToken: string): Promise<GoogleUserinfo> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GOOGLE_USERINFO_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Google userinfo request failed: ${response.status}`);
  return (await response.json()) as GoogleUserinfo;
}

// Registers the OAuth2 flow and its callback only when credentials are actually configured —
// lets the rest of the API run fine without Google set up (see .env.example for setup steps).
const googleOAuthPlugin: FastifyPluginAsync = fp(async (fastify) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    fastify.log.warn("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set — Sign in with Google is disabled");
    return;
  }

  await fastify.register(fastifyOauth2, {
    name: "oauth2Google",
    scope: ["openid", "email", "profile"],
    credentials: {
      client: { id: clientId, secret: clientSecret },
      // Inlined rather than referencing fastifyOauth2.GOOGLE_CONFIGURATION — that constant
      // exists at runtime but this package's CJS-style type defs don't expose it cleanly
      // through an ESM default import. Values match the library's own constant exactly.
      auth: {
        authorizeHost: "https://accounts.google.com",
        authorizePath: "/o/oauth2/v2/auth",
        tokenHost: "https://www.googleapis.com",
        tokenPath: "/oauth2/v4/token",
      },
    },
    startRedirectPath: "/auth/google",
    callbackUri: `${API_ORIGIN}/auth/google/callback`,
  });

  fastify.get("/auth/google/callback", async (request, reply) => {
    try {
      const { token } = await fastify.oauth2Google!.getAccessTokenFromAuthorizationCodeFlow(request);

      const profile = await fetchGoogleUserinfo(token.access_token);

      const user = await resolveGoogleUser(fastify.prisma, {
        googleId: profile.sub,
        email: profile.email,
        emailVerified: profile.email_verified,
      });

      const session = await createSession(fastify.prisma, user.id);
      setSessionCookie(reply, session.id);

      return reply.redirect(`${WEB_ORIGIN}/app`);
    } catch (err) {
      const reason = err instanceof GoogleAuthError ? "unverified_email" : "google_auth_failed";
      request.log.error(err);
      return reply.redirect(`${WEB_ORIGIN}/login?error=${reason}`);
    }
  });
});

export default googleOAuthPlugin;

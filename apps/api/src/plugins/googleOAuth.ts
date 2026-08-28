import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import fastifyOauth2 from "@fastify/oauth2";
import { createSession, setSessionCookie } from "../lib/session.js";
import { resolveGoogleUser, fetchGoogleUserinfo, GoogleAuthError } from "../lib/googleAuth.js";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3000";
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

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

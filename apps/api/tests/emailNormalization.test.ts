import { describe, it, expect } from "vitest";
import { signupSchema, loginSchema, inviteTeammateSchema } from "@quorum/schema";

// The `email` column is a plain case-sensitive unique constraint, so every schema that accepts
// an email must normalize it the same way before it reaches a lookup or a unique write — otherwise
// "Foo@x.com" and "foo@x.com" become two different accounts and users can lock themselves out by
// typing their email with different casing than they signed up with.
describe("email normalization", () => {
  it("signupSchema trims and lowercases email", () => {
    const parsed = signupSchema.parse({ email: "  Foo@Example.COM  ", password: "correct-horse", tenantName: "Acme" });
    expect(parsed.email).toBe("foo@example.com");
  });

  it("loginSchema trims and lowercases email", () => {
    const parsed = loginSchema.parse({ email: "  Foo@Example.COM  ", password: "correct-horse" });
    expect(parsed.email).toBe("foo@example.com");
  });

  it("inviteTeammateSchema trims and lowercases email", () => {
    const parsed = inviteTeammateSchema.parse({ email: "  Foo@Example.COM  " });
    expect(parsed.email).toBe("foo@example.com");
  });
});

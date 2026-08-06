import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { acceptInviteSchema, signupSchema } from "@quorum/schema";

// bcryptjs silently truncates its input at 72 bytes for both hashing and comparison, so two
// passwords sharing the same first 72 bytes are indistinguishable to it — a false sense of
// security for anyone who picks a long passphrase. Confirmed directly against bcryptjs below,
// then asserted the schemas reject what bcryptjs would otherwise silently truncate.
describe("password length bound", () => {
  it("bcryptjs truncates at 72 bytes, so a differing suffix still matches (documents the underlying gap)", async () => {
    const prefix = "A".repeat(72);
    const hash = await bcrypt.hash(`${prefix}-suffix-one`, 12);
    const matches = await bcrypt.compare(`${prefix}-DIFFERENT-SUFFIX`, hash);
    expect(matches).toBe(true);
  });

  it("signupSchema rejects a password over 72 bytes", () => {
    const tooLong = "a".repeat(73);
    const result = signupSchema.safeParse({ email: "a@example.com", password: tooLong, tenantName: "Acme" });
    expect(result.success).toBe(false);
  });

  it("signupSchema accepts a password at exactly 72 bytes", () => {
    const atLimit = "a".repeat(72);
    const result = signupSchema.safeParse({ email: "a@example.com", password: atLimit, tenantName: "Acme" });
    expect(result.success).toBe(true);
  });

  it("counts multi-byte characters by UTF-8 byte length, not character count", () => {
    // Each "é" is 2 bytes in UTF-8, so 40 of them is 80 bytes — over the limit despite being
    // only 40 characters.
    const multiByte = "é".repeat(40);
    const result = signupSchema.safeParse({ email: "a@example.com", password: multiByte, tenantName: "Acme" });
    expect(result.success).toBe(false);
  });

  it("acceptInviteSchema rejects a password over 72 bytes", () => {
    const result = acceptInviteSchema.safeParse({ password: "a".repeat(73) });
    expect(result.success).toBe(false);
  });
});

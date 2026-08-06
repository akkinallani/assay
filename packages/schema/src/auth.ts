import { z } from "zod";

// Emails are case-insensitive by spec convention and by every mail provider in practice, but the
// `email` column is a plain case-sensitive unique constraint — so every entry point that accepts
// an email must normalize it the same way before it ever reaches a lookup or a unique write, or
// "Foo@x.com" and "foo@x.com" silently become two different accounts.
const emailSchema = z.string().trim().toLowerCase().email();

// bcrypt (and bcryptjs, which we use) silently truncates its input at 72 bytes — anything past
// that is ignored both when hashing and when comparing, so two passwords sharing the same first
// 72 bytes are indistinguishable to it. Capping input here turns that silent truncation into an
// explicit validation error instead of a false sense of security.
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .refine((value) => new TextEncoder().encode(value).length <= 72, "Password must be at most 72 bytes");

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  tenantName: z.string().min(1, "Organization name is required"),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const inviteTeammateSchema = z.object({
  email: emailSchema,
});

export const acceptInviteSchema = z.object({
  password: passwordSchema,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type InviteTeammateInput = z.infer<typeof inviteTeammateSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

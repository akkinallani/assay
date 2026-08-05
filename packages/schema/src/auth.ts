import { z } from "zod";

// Emails are case-insensitive by spec convention and by every mail provider in practice, but the
// `email` column is a plain case-sensitive unique constraint — so every entry point that accepts
// an email must normalize it the same way before it ever reaches a lookup or a unique write, or
// "Foo@x.com" and "foo@x.com" silently become two different accounts.
const emailSchema = z.string().trim().toLowerCase().email();

export const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters"),
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
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type InviteTeammateInput = z.infer<typeof inviteTeammateSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

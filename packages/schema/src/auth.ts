import { z } from "zod";

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  tenantName: z.string().min(1, "Organization name is required"),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

export const inviteTeammateSchema = z.object({
  email: z.string().email(),
});

export const acceptInviteSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type InviteTeammateInput = z.infer<typeof inviteTeammateSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

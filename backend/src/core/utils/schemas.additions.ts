import { z } from 'zod';

// Supplementary schemas — kept here for backwards compatibility.
// New schemas should go directly into schemas.ts.

export const VerifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const ResendVerificationSchema = z.object({
  email: z.string().email('Invalid email format'),
});

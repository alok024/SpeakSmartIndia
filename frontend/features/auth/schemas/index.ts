/**
 * features/auth/schemas/index.ts
 *
 * Client-side form validation schemas for auth flows.
 *
 * These are form-layer schemas (UI labels, client-friendly messages) that
 * intentionally differ from the backend's terse API schemas — so they stay
 * local rather than living in @shared. The RegisterFormSchema password rule
 * is kept in sync with backend RegisterSchema (min 8) by convention; if that
 * rule ever changes, update both places.
 */
import { z } from 'zod';

export const LoginFormSchema = z.object({
  email:    z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const RegisterFormSchema = z.object({
  name:     z.string().min(2, 'Name must be at least 2 characters').max(100),
  email:    z.string().email('Enter a valid email'),
  // kept in sync with backend RegisterSchema (min 8) — see schemas.ts.
  password: z.string().min(8, 'Password must be at least 8 characters'),
  ref:      z.string().max(20).optional(),
});

export const ForgotPasswordFormSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

export type LoginFormData        = z.infer<typeof LoginFormSchema>;
export type RegisterFormData     = z.infer<typeof RegisterFormSchema>;
export type ForgotPasswordData   = z.infer<typeof ForgotPasswordFormSchema>;

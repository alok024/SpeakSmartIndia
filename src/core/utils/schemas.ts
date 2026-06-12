import { z } from 'zod';

// ── Auth ──────────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  email:    z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name:     z.string().max(100).optional(),
  ref:      z.string().max(20).optional(),
});

export const LoginSchema = z.object({
  email:    z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
});

export const ResetPasswordSchema = z.object({
  token:        z.string().min(1, 'Token is required'),
  new_password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ── Payment ───────────────────────────────────────────────────────

export const CreateOrderSchema = z.object({
  plan: z.enum(['pro', 'elite']),
});

export const VerifyPaymentSchema = z.object({
  razorpay_order_id:   z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature:  z.string().min(1),
  plan:                z.enum(['pro', 'elite']),
});

// ── AI ────────────────────────────────────────────────────────────

const AIMessageSchema = z.object({
  role:    z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(32_000),
});

export const AIRequestSchema = z.object({
  messages:   z.array(AIMessageSchema).min(1).max(100),
  max_tokens: z.number().int().min(1).max(4096).optional(),
  topic:      z.string().max(200).optional(),
  free:       z.boolean().optional(),   // true = helper call (hint/drill/grammar) — does not count against session limit
});

export type AIRequestDTO = z.infer<typeof AIRequestSchema>;



export type RegisterDTO = z.infer<typeof RegisterSchema>;
export type LoginDTO    = z.infer<typeof LoginSchema>;


import type { User } from '@/types';

export interface LoginResponse    { user: User; }
export interface RegisterResponse { user: User; email_sent?: boolean; }
export interface MessageResponse  { message: string; }

/** Tracks form state across the multi-step auth flows */
export type AuthStep = 'idle' | 'submitting' | 'verify_pending' | 'success';

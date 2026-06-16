/**
 * features/auth/api/index.ts
 *
 * All HTTP calls that belong to the auth feature.
 * Extracted from lib/api.ts — only the core `apiCall` wrapper stays there.
 */
import { apiCall } from '@/lib/api';
import type { LoginResponse, RegisterResponse, MessageResponse } from '../types';

export const authApi = {
  login: (email: string, password: string) =>
    apiCall<LoginResponse>('/login', 'POST', { email, password }),

  register: (name: string, email: string, password: string, ref?: string) =>
    apiCall<RegisterResponse>(
      '/register', 'POST',
      { name, email, password, ...(ref ? { ref } : {}) },
    ),

  logout: () =>
    apiCall('/logout', 'POST'),

  verifyEmail: (token: string) =>
    apiCall<MessageResponse>('/verify-email', 'POST', { token }),

  resendVerification: (email: string) =>
    apiCall<MessageResponse>('/resend-verification', 'POST', { email }),

  requestPasswordReset: (email: string) =>
    apiCall<MessageResponse>('/password-reset/request', 'POST', { email }),

  confirmPasswordReset: (token: string, new_password: string) =>
    apiCall<MessageResponse>('/password-reset/confirm', 'POST', { token, new_password }),
};

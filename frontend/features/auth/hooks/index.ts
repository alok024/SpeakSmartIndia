'use client';

/**
 * features/auth/hooks/index.ts
 *
 * React Query hooks for login, registration, and logout.
 * Implementations moved here from the old central hooks/queries.ts.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../api';
import { useAuthStore } from '@/store/auth';
import { useInterviewStore } from '@/store/interview';
import { QK } from '@/lib/query-keys';

// ── Login ─────────────────────────────────────────────────────────
export function useLogin() {
  const setSession = useAuthStore((s) => s.setSession);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      authApi.login(email, password),
    onSuccess: async (res) => {
      if (res.ok) {
        setSession(res.data.user);
        // Cancel any in-flight queries BEFORE invalidating.
        // Without this, queries that fired before login completed
        // get a 401, all try to refresh simultaneously, and the
        // backend logs "Refresh token reuse detected" for every
        // concurrent call after the first one rotates the token.
        await qc.cancelQueries();
        qc.invalidateQueries({ queryKey: QK.me });
      }
    },
  });
}

// ── Register ──────────────────────────────────────────────────────
export function useRegister() {
  return useMutation({
    mutationFn: ({
      name,
      email,
      password,
      ref,
    }: {
      name: string;
      email: string;
      password: string;
      ref?: string;
    }) => authApi.register(name, email, password, ref),
  });
}

// ── Logout ────────────────────────────────────────────────────────
export function useLogout() {
  const clearSession = useAuthStore((s) => s.clearSession);
  const resetSession = useInterviewStore((s) => s.resetSession);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      clearSession();
      // M5: drop any in-memory interview session (feedback, scores,
      // corrections) on logout so a shared device never exposes the
      // previous user's coaching data after sign-out.
      resetSession();
      qc.clear();
    },
  });
}

export { useAuthStore } from '@/store/auth';

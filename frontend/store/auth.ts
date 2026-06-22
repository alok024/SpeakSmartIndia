'use client';

/**
 * store/auth.ts
 *
 * Zustand auth store.
 *
 * Tokens are NOT stored here (or anywhere in JS) — the backend sets
 * them as httpOnly cookies (vachix_at / vachix_rt) on login/register/refresh,
 * which JS can never read. This store only caches the `user` object so
 * the UI has something to render immediately on load (avoids a flash
 * of "logged out" while /me is in flight). The actual auth gate lives
 * in middleware.ts (server-side, before pages render) and in the
 * backend's authMiddleware (every API call).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface AuthState {
  user: User | null;

  // Actions
  setSession:      (user: User) => void;
  setUser:         (user: User) => void;
  clearSession:    () => void;
  isAuthenticated: () => boolean;
  // isProOrElite returns true for Pro and Elite plans only.
  // Starter subscribers are NOT included — Starter has its own feature set
  // distinct from Pro. Use plan === 'starter' or plan !== 'free' directly
  // when a feature is Starter+. This helper is intentionally named to make
  // the exclusion of Starter visible at every call site.
  isProOrElite:    () => boolean;
  isElite:         () => boolean;
  aiCallsLeft:     () => number;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,

      setSession: (user) => set({ user }),

      setUser: (user) => set({ user }),

      clearSession: () => set({ user: null }),

      // NOTE: this only reflects cached UI state, not real auth status —
      // the httpOnly cookies are the source of truth and aren't visible
      // to JS. Use this for render decisions, not for security checks.
      isAuthenticated: () => !!get().user,

      isProOrElite: () => {
        const plan = get().user?.plan;
        return plan === 'pro' || plan === 'elite';
      },

      isElite: () => get().user?.plan === 'elite',

      aiCallsLeft: () => {
        const { user, isProOrElite } = get();
        if (!user) return 0;
        if (isProOrElite()) return Infinity;
        // Use the server-supplied remaining count (from usage.remaining in /me)
        // as the single source of truth. Fall back to the local calculation
        // only if the server value hasn't been fetched yet (cold cache).
        if (user.ai_calls_remaining !== undefined && user.ai_calls_remaining !== null) {
          return Math.max(0, user.ai_calls_remaining);
        }
        // Cold-cache fallback: use limit from server if available, else 0
        const limit = user.ai_calls_limit ?? 0;
        const used  = user.ai_calls ?? 0;
        return Math.max(0, limit - used);
      },
    }),
    {
      name: 'vachix-auth',
      partialize: (state) => ({ user: state.user }),
    }
  )
);

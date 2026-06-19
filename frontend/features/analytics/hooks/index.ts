'use client';

/**
 * features/analytics/hooks/index.ts
 *
 * React Query hooks for the session history list and the
 * progress-over-time chart (dashboard + history page).
 */
import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from '../api';
import { useAuthStore } from '@/store/auth';
import { QK } from '@/lib/query-keys';

// Sessions list (history page)
export function useSessions() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return useQuery({
    queryKey: QK.sessions,
    queryFn: async () => {
      const res = await analyticsApi.getSessions();
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.data.sessions;
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

// Score history (dashboard chart)
export function useScoreHistory(limit = 20) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return useQuery({
    queryKey: QK.scoreHistory(limit),
    queryFn: async () => {
      const res = await analyticsApi.getScoreHistory(limit);
      if (!res.ok) throw new Error('Failed to fetch score history');
      return res.data.history;
    },
    enabled: isAuthenticated,
    staleTime: 60_000,
  });
}

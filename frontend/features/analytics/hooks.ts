'use client';

import { useQuery } from '@tanstack/react-query';
import { analyticsApi } from './api';
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

// Interview Readiness Report (Starter+)
export function useReadinessReport(enabled: boolean) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return useQuery({
    queryKey: QK.readinessReport,
    queryFn: async () => {
      const res = await analyticsApi.getReadinessReport();
      if (!res.ok) throw new Error('Failed to fetch readiness report');
      return res.data;
    },
    enabled: isAuthenticated && enabled,
    staleTime: 5 * 60_000,   // report only regenerates every 5 sessions
  });
}

// English Journey chart (Pro+ — Elara session history)
export function useElaraJourney(enabled: boolean) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return useQuery({
    queryKey: QK.elaraJourney,
    queryFn: async () => {
      const { elaraApi } = await import('@/features/elara/api');
      const res = await elaraApi.getSessions(60);
      if (!res.ok) throw new Error('Failed to fetch Elara journey');
      return res.data.sessions;
    },
    enabled: isAuthenticated && enabled,
    staleTime: 5 * 60_000,
  });
}

// Leaderboard (all authenticated users)
export function useLeaderboard() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return useQuery({
    queryKey: QK.leaderboard,
    queryFn: async () => {
      const res = await analyticsApi.getLeaderboard();
      if (!res.ok) throw new Error('Failed to fetch leaderboard');
      return res.data;
    },
    enabled: isAuthenticated,
    staleTime: 2 * 60_000,  // refresh every 2 min — leaderboard is near-realtime
  });
}

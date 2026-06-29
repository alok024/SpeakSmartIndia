'use client';

import { useQuery } from '@tanstack/react-query';
import { speechApi } from './api';
import { useAuthStore } from '@/store/auth';
import { QK } from '@/lib/query-keys';

/**
 * useSpeechTrend
 *
 * Fetches the current user's speech-metrics trend data.
 * The dashboard card guards on `trend.length >= 3` before rendering
 * the chart, so this hook is always-enabled for authenticated users
 * (no plan gate — all users can see their own trend data).
 *
 * staleTime: 5 min — metric data changes only after a new session is
 * completed, so there's no need to refetch aggressively.
 */
export function useSpeechTrend() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return useQuery({
    queryKey: QK.speechTrend,
    queryFn: async () => {
      const res = await speechApi.getTrend(20);
      if (!res.ok) throw new Error('Failed to fetch speech trend');
      return res.data.trend;
    },
    enabled:   isAuthenticated,
    staleTime: 5 * 60_000,
  });
}

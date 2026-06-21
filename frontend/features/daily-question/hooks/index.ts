'use client';

/**
 * features/daily-question/hooks/index.ts
 *
 * React Query hook for the dashboard's Daily Question Drop card.
 */
import { useQuery } from '@tanstack/react-query';
import { dailyQuestionApi } from '../api';
import { useAuthStore } from '@/store/auth';

const QK_DAILY_QUESTION = ['daily-question'] as const;

// The question is identical for every user on a given IST day (see
// backend daily-question.service.ts) and only changes once every 24h,
// so a long staleTime avoids refetching on every dashboard visit.
// 30 min keeps a user's dashboard reasonably fresh across the IST day
// boundary without needing exact-midnight invalidation logic.
export function useDailyQuestion() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return useQuery({
    queryKey: QK_DAILY_QUESTION,
    queryFn: async () => {
      const res = await dailyQuestionApi.get();
      if (!res.ok) throw new Error('Failed to fetch daily question');
      return res.data;
    },
    enabled: isAuthenticated,
    staleTime: 30 * 60_000,
  });
}

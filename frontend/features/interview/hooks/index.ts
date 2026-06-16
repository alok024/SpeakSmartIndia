'use client';

/**
 * features/interview/hooks/index.ts
 *
 * React Query hooks for creating sessions and reading a single
 * session's detail (the interview feature owns `/sessions` POST and
 * `/sessions/:id` — see features/README.md).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { interviewApi } from '../api';
import { QK } from '@/lib/query-keys';

// ── Save a completed session ──────────────────────────────────────
export function useSaveSession() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: interviewApi.createSession,
    onSuccess: () => {
      // Invalidate so dashboard/history refetch fresh data
      qc.invalidateQueries({ queryKey: QK.me });
      qc.invalidateQueries({ queryKey: QK.sessions });
    },
  });
}

// ── Single session detail (interview summary page) ────────────────
export function useSession(id: string | null) {
  return useQuery({
    queryKey: QK.session(id ?? ''),
    queryFn: async () => {
      if (!id) throw new Error('No session id');
      const res = await interviewApi.getSession(id);
      if (!res.ok) throw new Error('Failed to fetch session');
      return res.data;
    },
    enabled: !!id,
    staleTime: Infinity, // Sessions don't change after creation
  });
}

export { useInterviewStore } from '@/store/interview';

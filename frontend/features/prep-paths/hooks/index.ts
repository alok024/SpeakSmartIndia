'use client';

/**
 * features/prep-paths/hooks/index.ts
 *
 * React Query hooks for Guided Prep Paths (P6-A) — backs the dashboard's
 * "Day 3 of 7 — Bank PO Prep" card and any future "browse paths" page.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { prepPathsApi } from '../api';
import { useAuthStore } from '@/store/auth';

const QK_PREP_PATHS        = ['prep-paths'] as const;
const QK_MY_PREP_ENROLLMENT = ['prep-paths', 'my-enrollment'] as const;

/** Catalog of active prep paths — rarely changes, so a long staleTime is fine. */
export function usePrepPaths() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return useQuery({
    queryKey: QK_PREP_PATHS,
    queryFn: async () => {
      const res = await prepPathsApi.list();
      if (!res.ok) throw new Error('Failed to fetch prep paths');
      return res.data.paths;
    },
    enabled: isAuthenticated,
    staleTime: 60 * 60_000,
  });
}

/** The dashboard card's data source — null enrollment means "not enrolled in anything". */
export function useMyPrepEnrollment() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return useQuery({
    queryKey: QK_MY_PREP_ENROLLMENT,
    queryFn: async () => {
      const res = await prepPathsApi.myEnrollment();
      if (!res.ok) throw new Error('Failed to fetch prep path enrollment');
      return res.data;
    },
    enabled: isAuthenticated,
    // Day rolls over at IST midnight — 5 min keeps the card reasonably
    // fresh without refetching on every dashboard render.
    staleTime: 5 * 60_000,
  });
}

export function useEnrollInPrepPath() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (prepPathId: string) => prepPathsApi.enroll(prepPathId),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: QK_MY_PREP_ENROLLMENT });
      }
    },
  });
}

'use client';

/**
 * app/(app)/prep-paths/page.tsx
 *
 * Browse & enroll in a Guided Prep Path (P6-A). Shows the catalog of
 * active paths (e.g. "Bank PO 7-Day Prep", "UPSC 14-Day Prep") and lets
 * the user enroll, switch, or continue their active one. The dashboard
 * card is the at-a-glance version of the same "today" data surfaced here.
 */
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrepPaths, useMyPrepEnrollment, useEnrollInPrepPath } from '@/features/prep-paths/hooks';
import { Card, Button, Badge, Spinner, EmptyState } from '@/components/ui';
import { CalendarCheck, CheckCircle2, ArrowRight } from 'lucide-react';
import type { PrepPath } from '@/features/prep-paths/types';

export default function PrepPathsPage() {
  const router = useRouter();
  const { data: paths, isLoading: pathsLoading } = usePrepPaths();
  const { data: myEnrollment, isLoading: enrollmentLoading } = useMyPrepEnrollment();
  const enrollMutation = useEnrollInPrepPath();
  const [pendingPathId, setPendingPathId] = useState<string | null>(null);

  const activePathId = myEnrollment?.enrollment?.prep_path_id ?? null;
  const isLoading = pathsLoading || enrollmentLoading;

  function goToSetupForToday() {
    const today = myEnrollment?.today;
    if (!today) return;
    const { profession, mode, difficulty, interview_type } = today.session_config;
    const qs = new URLSearchParams({ profession, mode, difficulty, interview_type });
    router.push(`/interview/setup?${qs.toString()}`);
  }

  async function handleEnroll(path: PrepPath) {
    setPendingPathId(path.id);
    try {
      await enrollMutation.mutateAsync(path.id);
    } finally {
      setPendingPathId(null);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
          <CalendarCheck className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          Guided Prep Paths
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
          Structured, day-by-day interview prep tracks. Pick one and follow along — each day pre-fills a tailored mock interview for you.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} style={{ color: 'var(--accent)' }} />
        </div>
      ) : (
        <>
          {/* Active enrollment — same "today" data as the dashboard card, with more room to show it. */}
          {myEnrollment?.enrollment && myEnrollment.path && myEnrollment.today && (
            <Card className="p-5" style={{ background: 'var(--accent-dim)', borderColor: 'var(--accent-border)' }}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--accent)' }}>
                    Day {myEnrollment.current_day} of {myEnrollment.path.duration_days} — {myEnrollment.path.title}
                  </div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{myEnrollment.today.title}</p>
                  {myEnrollment.is_complete && (
                    <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--success)' }}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> You've completed this path — enroll again anytime, or pick a new one below.
                    </p>
                  )}
                </div>
                <Button onClick={goToSetupForToday} rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                  Continue
                </Button>
              </div>
            </Card>
          )}

          {/* Catalog */}
          {!paths?.length ? (
            <Card className="p-8">
              <EmptyState
                icon={<CalendarCheck className="w-6 h-6" />}
                title="No prep paths available right now"
                description="Check back soon — new guided tracks are added regularly."
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {paths.map((path) => {
                const isActive = path.id === activePathId;
                const isPending = pendingPathId === path.id && enrollMutation.isPending;

                return (
                  <Card key={path.id} className="p-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <h2 className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{path.title}</h2>
                          <Badge variant="accent">{path.duration_days} days</Badge>
                          {isActive && <Badge variant="success">Active</Badge>}
                        </div>
                        <p className="text-xs leading-relaxed max-w-lg" style={{ color: 'var(--text-2)' }}>
                          {path.description}
                        </p>
                        <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>{path.profession}</p>
                      </div>

                      {isActive ? (
                        <Button variant="secondary" onClick={goToSetupForToday} rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                          Continue
                        </Button>
                      ) : (
                        <Button
                          variant={activePathId ? 'outline' : 'primary'}
                          loading={isPending}
                          onClick={() => handleEnroll(path)}
                        >
                          {activePathId ? 'Switch to this path' : 'Start this path'}
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

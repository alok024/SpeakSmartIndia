'use client';

import { useRouter } from 'next/navigation';
import { useSessions } from '@/hooks/queries';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { Card, Badge, Button, EmptyState, Spinner, ScoreBadge } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { ChevronRight, Lock } from 'lucide-react';

export default function HistoryPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { showUpgradeModal } = useUIStore();
  const isFree = !user || (user.plan !== 'pro' && user.plan !== 'elite');

  const { data: sessions, isLoading } = useSessions();

  if (isFree) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">Past Sessions</h1>
        <Card className="p-8 text-center">
          <Lock className="w-10 h-10 text-[#555A6A] mx-auto mb-4" />
          <h2 className="text-lg font-bold text-white mb-2">Session history is a Pro feature</h2>
          <p className="text-sm text-[#8B90A0] mb-5 max-w-xs mx-auto">
            Upgrade to view all past sessions, track your progress over time, and revisit feedback anytime.
          </p>
          <Button variant="upgrade" onClick={() => showUpgradeModal('feature_lock')}>
            Upgrade to Pro — ₹299/month
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-6">Past Sessions</h1>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="w-8 h-8 text-blue-400" />
        </div>
      ) : !sessions?.length ? (
        <Card className="p-8">
          <EmptyState
            icon="📋"
            title="No sessions yet"
            description="Complete your first interview to see your history here."
            action={
              <Button onClick={() => router.push('/interview/setup')}>
                Start Interview
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => router.push(`/interview/summary?session=${s.id}`)}
              className="w-full bg-[#16181F] border border-white/[0.07] rounded-2xl p-4 flex items-center gap-4 hover:border-white/[0.12] transition-all text-left"
            >
              {/* Date + profession */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{s.profession}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-[#555A6A]">{formatDate(s.created_at)}</span>
                  <Badge variant="default" size="sm">{s.mode}</Badge>
                  <Badge variant="default" size="sm">{s.difficulty}</Badge>
                </div>
              </div>

              {/* Score + arrow */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <ScoreBadge score={s.score} />
                {s.job_ready_score != null && (
                  <Badge variant="accent" size="sm">{s.job_ready_score} JR</Badge>
                )}
                <ChevronRight className="w-4 h-4 text-[#555A6A]" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

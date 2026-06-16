'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState , Suspense } from 'react';
import { useSession } from '@/features/interview/hooks';
import { interviewApi } from '@/features/interview/api';
import { useInterviewStore } from '@/store/interview';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { Button, Card, CardHeader, CardBody, Badge, ScoreBadge, Spinner, EmptyState } from '@/components/ui';
import { formatDate, scoreColor } from '@/lib/utils';
import { CheckCircle, Share2, Download, ExternalLink } from 'lucide-react';

function InterviewSummaryPageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get('session');
  const { user } = useAuthStore();
  const { showUpgradeModal, showToast } = useUIStore();
  const { session: liveSession, config } = useInterviewStore();
  const isFree = !user || (user.plan !== 'pro' && user.plan !== 'elite');

  const { data, isLoading } = useSession(sessionId);
  const sessionData = data?.session;
  const feedbacks = data?.feedbacks ?? liveSession.allFeedbacks;

  // Share URL state — fetched lazily on first copy/share action
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copyLoading, setCopyLoading] = useState(false);

  // Stats from session
  const avgScore = sessionData?.score ?? (
    feedbacks.length
      ? Math.round(feedbacks.reduce((a, f) => a + f.score, 0) / feedbacks.length * 10) / 10
      : 0
  );
  const totalErrors = feedbacks.reduce((a, f) => a + (f.corrections?.length ?? 0), 0);
  const totalQ = feedbacks.length || (sessionData?.exchanges ?? 0);
  const jobReadyScore = sessionData?.job_ready_score;

  // Share text
  function buildShareText() {
    return `I scored ${avgScore}/10 on my ${sessionData?.profession || config.profession} interview with SpeakSmart India! 🎙️ AI-powered interview prep built for India. Try it free: https://speaksmart.in`;
  }

  function shareWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText())}`, '_blank');
  }

  function shareLinkedIn() {
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent('https://speaksmart.in')}`, '_blank');
  }

  function shareTwitter() {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(buildShareText())}`, '_blank');
  }

  // Bug fix: fetch the real per-session share URL from the backend instead
  // of always copying the homepage. Cached in local state so subsequent
  // clicks don't re-fetch.
  async function copyLink() {
    if (copyLoading) return;

    // If we already fetched the share URL this render, just copy it
    if (shareUrl) {
      await navigator.clipboard.writeText(shareUrl);
      showToast('🔗 Session link copied!');
      return;
    }

    // No sessionId means this is an in-memory-only session (save failed) —
    // fall back to homepage so we still copy *something* useful
    if (!sessionId) {
      await navigator.clipboard.writeText('https://speaksmart.in');
      showToast('🔗 Link copied!');
      return;
    }

    setCopyLoading(true);
    const res = await interviewApi.getShareToken(sessionId);
    setCopyLoading(false);

    if (res.ok) {
      setShareUrl(res.data.share_url);
      await navigator.clipboard.writeText(res.data.share_url);
      showToast('🔗 Session link copied!');
    } else {
      // Share token endpoint failed — copy homepage as graceful fallback
      await navigator.clipboard.writeText('https://speaksmart.in');
      showToast('🔗 Link copied (share token unavailable)');
    }
  }

  function downloadReport() {
    const lines = [
      `SpeakSmart India — Interview Report`,
      `Date: ${formatDate(sessionData?.created_at ?? new Date().toISOString())}`,
      `Profession: ${sessionData?.profession ?? config.profession}`,
      `Score: ${avgScore}/10`,
      ``,
      ...feedbacks.map((fb, i) => [
        `Question ${i + 1}: ${fb.question}`,
        `Your Answer: ${fb.answer ?? '—'}`,
        `Score: ${fb.score}/10`,
        `Tips: ${fb.tips ?? '—'}`,
        fb.corrections?.length ? `Corrections:\n${fb.corrections.map((c) => `  ✗ ${c.wrong ?? c.mistake} → ✓ ${c.correct ?? c.correction}`).join('\n')}` : '',
        ``,
      ].filter(Boolean).join('\n')),
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `speaksmart-report-${Date.now()}.txt`;
    a.click();
    // Bug fix: revoking synchronously after click() races the browser's
    // download initiation. A short delay gives it time to read the blob
    // before the object URL is invalidated.
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  if (isLoading && sessionId) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="w-8 h-8 text-blue-400" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div className="text-center py-4">
        <div className="w-16 h-16 rounded-full bg-emerald-400/10 border-2 border-emerald-400/30 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold text-white">Interview Complete!</h2>
        <p className="text-sm text-[#8B90A0] mt-1">
          {sessionData?.profession ?? config.profession} · {formatDate(sessionData?.created_at ?? new Date().toISOString())}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Avg Score', value: `${avgScore}/10`, color: 'text-emerald-400' },
          { label: 'Errors Found', value: String(totalErrors), color: 'text-red-400' },
          { label: 'Questions', value: String(totalQ), color: 'text-blue-400' },
        ].map((s) => (
          <Card key={s.label} className="p-4 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-[#8B90A0] mt-0.5">{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Job-ready + upsell */}
      {jobReadyScore != null && (
        <Card className="p-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs text-[#8B90A0] mb-1">Job-Ready Score</div>
            <div className="text-3xl font-bold text-white">{jobReadyScore}</div>
          </div>
          {isFree && (
            <Button variant="upgrade" size="sm" onClick={() => showUpgradeModal('session_end')}>
              Upgrade ₹299 →
            </Button>
          )}
        </Card>
      )}

      {/* Share / export */}
      <Card>
        <CardHeader>
          <span className="text-sm font-semibold text-white flex items-center gap-2">
            <Share2 className="w-4 h-4 text-blue-400" /> Share Your Result
          </span>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={shareWhatsApp}>
              📱 WhatsApp
            </Button>
            <Button variant="secondary" size="sm" onClick={shareLinkedIn}>
              💼 LinkedIn
            </Button>
            <Button variant="secondary" size="sm" onClick={shareTwitter}>
              𝕏 Twitter
            </Button>
            <Button variant="secondary" size="sm" onClick={copyLink} loading={copyLoading}>
              🔗 Copy Link
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadReport}>
              <Download className="w-3.5 h-3.5" /> Export TXT
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Per-question feedback */}
      {feedbacks.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-[#8B90A0] uppercase tracking-wide">Your Answers</h3>
          {feedbacks.map((fb, i) => (
            <Card key={fb.id ?? i} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-[#555A6A] mb-1">Q{i + 1}</div>
                  <p className="text-sm font-medium text-white">{fb.question}</p>
                </div>
                <ScoreBadge score={fb.score} />
              </div>

              {fb.tips && (
                <p className="text-xs text-[#8B90A0] leading-relaxed border-t border-white/[0.07] pt-3">{fb.tips}</p>
              )}

              {fb.corrections && fb.corrections.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-[#555A6A]">Corrections</div>
                  {fb.corrections.map((c, j) => (
                    <div key={j} className="text-xs bg-[#1D2029] rounded-lg px-3 py-2">
                      <span className="text-red-400 line-through">{c.wrong ?? c.mistake}</span>
                      <span className="text-[#555A6A] mx-2">→</span>
                      <span className="text-emerald-400">{c.correct ?? c.correction}</span>
                      {c.rule && <div className="text-[#555A6A] mt-0.5">{c.rule}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* CTA */}
      <div className="flex gap-3 pb-4">
        <Button
          variant="secondary"
          className="flex-1"
          onClick={() => router.push('/dashboard')}
        >
          Dashboard
        </Button>
        <Button
          className="flex-1"
          onClick={() => router.push('/interview/setup')}
        >
          Practice Again →
        </Button>
      </div>

    </div>
  );
}

export default function InterviewSummaryPage() {
  return (
    <Suspense fallback={<div />}>
      <InterviewSummaryPageInner />
    </Suspense>
  );
}

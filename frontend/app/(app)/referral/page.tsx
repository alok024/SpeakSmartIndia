'use client';

/**
 * app/(app)/referral/page.tsx
 *
 * Bug fix #3: Referral page was missing entirely (nav linked to /referral
 * but no page existed). useReferral() returns { code, uses, rewarded,
 * bonus_calls } from the backend — this page renders those values.
 */

import { useAuthStore } from '@/store/auth';
import { useReferral } from '@/features/user/hooks';
import { Card, CardHeader, CardBody, Button, Spinner } from '@/components/ui';
import { useUIStore } from '@/store/ui';
import { Gift, Users, Star, Zap } from 'lucide-react';

export default function ReferralPage() {
  const { user } = useAuthStore();
  const { showToast } = useUIStore();

  // Bug 3 fix: actually use the hook that fetches from backend
  const { data: referral, isLoading, isError } = useReferral();

  const referralUrl = referral?.code
    ? `${typeof window !== 'undefined' ? window.location.origin : 'https://speaksmart.in'}/register?ref=${referral.code}`
    : null;

  function copyLink() {
    if (!referralUrl) return;
    navigator.clipboard.writeText(referralUrl).then(() => {
      showToast('🔗 Referral link copied!');
    });
  }

  function shareWhatsApp() {
    if (!referralUrl) return;
    const text = `Practice English & interviews with AI — free for Indian students & job seekers! Use my link: ${referralUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="w-8 h-8 text-blue-400" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-5">

      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Gift className="w-6 h-6 text-blue-400" /> Refer & Earn
        </h1>
        <p className="text-sm text-[#8B90A0] mt-1">
          Invite friends and get +1 free AI session for each person who joins.
        </p>
      </div>

      {/* How it works */}
      <Card>
        <CardHeader><span className="text-sm font-semibold text-white">How it works</span></CardHeader>
        <CardBody className="space-y-3">
          {[
            { icon: '🔗', title: 'Share your link', desc: 'Send your unique referral link to friends, batchmates, or classmates.' },
            { icon: '✅', title: 'They join', desc: 'They register using your link. No credit card required.' },
            { icon: '🎁', title: 'You earn a free session', desc: 'For each friend who joins, you get +1 bonus AI interview session.' },
          ].map((step) => (
            <div key={step.title} className="flex gap-3">
              <span className="text-xl mt-0.5">{step.icon}</span>
              <div>
                <div className="text-sm font-semibold text-white">{step.title}</div>
                <div className="text-xs text-[#8B90A0] leading-relaxed">{step.desc}</div>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Stats — Bug 3 fix: referral.uses / referral.rewarded / referral.bonus_calls from backend */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            icon: Users,
            label: 'Friends joined',
            value: isError ? '—' : (referral?.uses ?? 0),
            color: 'text-blue-400',
          },
          {
            icon: Star,
            label: 'Rewarded',
            value: isError ? '—' : (referral?.rewarded ?? 0),
            color: 'text-amber-400',
          },
          {
            icon: Zap,
            label: 'Bonus sessions',
            value: isError ? '—' : (referral?.bonus_calls ?? 0),
            color: 'text-emerald-400',
          },
        ].map((stat) => (
          <Card key={stat.label} className="p-4 text-center">
            <stat.icon className={`w-4 h-4 ${stat.color} mx-auto mb-2`} />
            <div className={`text-2xl font-bold ${stat.color}`}>{String(stat.value)}</div>
            <div className="text-[10px] text-[#555A6A] mt-0.5">{stat.label}</div>
          </Card>
        ))}
      </div>

      {/* Referral link */}
      <Card className="p-5 space-y-3">
        <div className="text-xs font-semibold text-[#8B90A0] uppercase tracking-widest">Your Referral Link</div>
        {referral?.code ? (
          <>
            <div className="flex gap-2">
              <div className="flex-1 px-3 py-2.5 rounded-xl bg-[#1D2029] border border-white/[0.07] text-xs text-[#8B90A0] truncate font-mono">
                {referralUrl}
              </div>
              <Button size="sm" onClick={copyLink}>
                Copy
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={shareWhatsApp}>
                📱 Share on WhatsApp
              </Button>
              <Button variant="secondary" size="sm" className="flex-1" onClick={copyLink}>
                🔗 Copy Link
              </Button>
            </div>
          </>
        ) : isError ? (
          <p className="text-sm text-red-400">Could not load referral data. Please refresh.</p>
        ) : (
          <p className="text-sm text-[#8B90A0]">Referral code not available yet.</p>
        )}
      </Card>

      {/* Your referral code */}
      {referral?.code && (
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-[#555A6A] mb-1">Your code</div>
              <div className="text-lg font-bold text-white font-mono tracking-widest">
                {referral.code}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(referral.code);
                showToast('Code copied!');
              }}
            >
              Copy Code
            </Button>
          </div>
        </Card>
      )}

      {/* Current bonus */}
      {(referral?.bonus_calls ?? 0) > 0 && (
        <div className="bg-emerald-400/10 border border-emerald-400/20 rounded-2xl p-4 text-center">
          <div className="text-emerald-400 font-bold">
            🎉 You have {referral!.bonus_calls} bonus session{referral!.bonus_calls !== 1 ? 's' : ''} from referrals!
          </div>
          <div className="text-xs text-[#8B90A0] mt-1">
            These are added to your free session limit automatically.
          </div>
        </div>
      )}

    </div>
  );
}

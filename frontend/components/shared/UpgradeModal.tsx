'use client';

import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import { useCreateOrder, useVerifyPayment } from '@/features/payment/hooks';
import { useMe } from '@/features/user/hooks';
import { extractErrorMessage } from '@/lib/api';
import { Button, Badge, Spinner } from '@/components/ui';
import { X, Infinity, History, BarChart, Zap, Crown, Diamond } from 'lucide-react';
import { useState } from 'react';

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => { open: () => void };
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  prefill: { email: string; name: string };
  theme: { color: string };
  handler: (response: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => void;
  modal: { ondismiss: () => void };
}

const FEATURES = [
  { icon: Infinity, label: 'Unlimited AI interview sessions' },
  { icon: History, label: 'Full session history & progress' },
  { icon: BarChart, label: 'Advanced analytics & weak-area coaching' },
  { icon: Zap, label: 'Priority AI response speed' },
];

export function UpgradeModal() {
  const { upgradeModalOpen, upgradeTrigger, closeUpgradeModal, showToast } = useUIStore();
  const { user } = useAuthStore();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<'pro' | 'elite' | null>(null);

  const createOrder = useCreateOrder();
  const verifyPayment = useVerifyPayment();
  const { data: meData } = useMe();

  if (!upgradeModalOpen) return null;

  const calls = meData?.usage?.ai_calls ?? user?.ai_calls ?? 0;
  const FREE_LIMIT = meData?.usage?.limit ?? user?.ai_calls_limit ?? null;

  const reasonMessages: Record<string, string> = {
    limit_hit: '🚫 You\'ve reached your free session limit',
    voice_fallback: '🔊 HD voice (ElevenLabs) requires Pro',
    feature_lock: '🔒 This feature is available on Pro',
    session_end: '✨ You\'re on a roll — keep practicing!',
    strip: '⚡ Running low on sessions',
    nudge: '🚀 You\'re improving fast!',
  };

  async function handleUpgrade(plan: 'pro' | 'elite') {
    setError('');
    setLoading(plan);
    try {
      const res = await createOrder.mutateAsync(plan);
      if (!res.ok) {
        setError(extractErrorMessage(res.error));
        setLoading(null);
        return;
      }

      const { order_id, amount, currency, key } = res.data;

      // Load Razorpay script if not already loaded
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load Razorpay'));
          document.head.appendChild(script);
        });
      }

      const rzp = new window.Razorpay({
        key,
        amount,
        currency,
        order_id,
        name: 'SpeakSmart India',
        description: `${plan === 'pro' ? 'Pro' : 'Elite'} Plan — ₹${plan === 'pro' ? '299' : '599'}/month`,
        prefill: {
          email: user?.email ?? '',
          name: user?.name ?? '',
        },
        theme: { color: '#4F8EF7' },
        handler: async (response) => {
          const vRes = await verifyPayment.mutateAsync({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
            plan,
          });
          if (vRes.ok) {
            showToast('🎉 Welcome to Pro! Your account has been upgraded.', { duration: 8000 });
            closeUpgradeModal();
          } else {
            setError('Payment succeeded but verification failed. Contact support.');
          }
          setLoading(null);
        },
        modal: {
          ondismiss: () => setLoading(null),
        },
      });

      rzp.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setLoading(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="bg-[#16181F] border border-white/10 rounded-2xl p-5 sm:p-8 w-full max-w-md relative max-h-[90vh] overflow-y-auto">
        {/* Close */}
        <button
          onClick={closeUpgradeModal}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[#8B90A0] hover:text-white transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <span className="text-4xl mb-3 block">🚀</span>
          <h2 className="text-xl font-bold text-white mb-2">Upgrade to Pro</h2>

          {/* Usage display */}
          <div className="inline-flex items-center gap-2 bg-white/5 rounded-xl px-4 py-2 mb-3">
            <span className="text-xl font-bold text-blue-400">{calls}</span>
            <span className="text-sm text-[#8B90A0]">of {FREE_LIMIT ?? '∞'} free sessions used</span>
          </div>

          {/* Trigger reason */}
          {upgradeTrigger && reasonMessages[upgradeTrigger] && (
            <p className="text-sm text-blue-400 bg-blue-500/10 rounded-xl px-3 py-2">
              {reasonMessages[upgradeTrigger]}
            </p>
          )}
        </div>

        {/* Features */}
        <p className="text-sm text-[#8B90A0] text-center mb-5">
          Upgrade for <strong className="text-white">unlimited AI interviews</strong> and unlock your full potential.
        </p>
        <div className="space-y-2 mb-6">
          {FEATURES.map((f) => (
            <div key={f.label} className="flex items-center gap-3 text-sm text-[#8B90A0] bg-white/[0.03] rounded-xl px-3 py-2.5">
              <f.icon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              {f.label}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 rounded-xl px-3 py-2 mb-4 text-center">{error}</p>
        )}

        {/* CTA buttons */}
        <div className="space-y-3">
          <Button
            variant="upgrade"
            size="lg"
            className="w-full"
            loading={loading === 'pro'}
            disabled={!!loading}
            onClick={() => handleUpgrade('pro')}
          >
            <Crown className="w-4 h-4" />
            Pro — ₹299/month · Unlimited sessions + AI Chat
          </Button>
          <Button
            size="lg"
            className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:brightness-110 text-white"
            loading={loading === 'elite'}
            disabled={!!loading}
            onClick={() => handleUpgrade('elite')}
          >
            <Diamond className="w-4 h-4" />
            Elite — ₹599/month · Everything + Priority AI
          </Button>
        </div>

        <button
          onClick={closeUpgradeModal}
          className="w-full mt-4 text-xs text-[#555A6A] hover:text-[#8B90A0] transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

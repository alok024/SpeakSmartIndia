'use client';

/**
 * components/shared/VoiceSettingsPanel.tsx
 *
 * Voice settings card for the profile page.
 *
 * Free users: shows char usage bar + "Upgrade to keep voice on" CTA.
 * Paid users: shows Standard / HD Indian Voice toggle; persists via PATCH /api/voice/settings.
 *             When HD quota is exhausted shows a subtle "resets [date]" nudge.
 *
 * Mount behaviour: fetches /api/voice/settings on load, updates optimistically on toggle.
 */

import { useEffect, useState, useCallback } from 'react';
import { voiceApi, type VoiceSettings } from '@/features/voice/api';
import type { User } from '@/types';

interface VoiceSettingsPanelProps {
  user: User | null;
}

export function VoiceSettingsPanel({ user }: VoiceSettingsPanelProps) {
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    const s = await voiceApi.getSettings();
    setSettings(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleToggle = async (enabled: boolean) => {
    if (saving) return;
    setSaving(true);
    // Optimistic update
    setSettings(prev => prev ? { ...prev, hd_voice_enabled: enabled } : prev);
    const ok = await voiceApi.setHdVoice(enabled);
    if (!ok) {
      // Revert on failure
      setSettings(prev => prev ? { ...prev, hd_voice_enabled: !enabled } : prev);
    }
    setSaving(false);
  };

  if (!user) return null;

  const isFree = user.plan === 'free';

  if (loading) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <div className="text-sm font-medium text-white mb-3">🎙 Voice Settings</div>
        <div className="h-4 w-48 rounded animate-pulse" style={{ background: 'var(--surface-3, rgba(255,255,255,.06))' }} />
      </div>
    );
  }

  // ── Free tier view ─────────────────────────────────────────────────────────
  if (isFree || !settings) {
    const charsUsed = settings?.chars_used ?? 0;
    const charsCap  = settings?.chars_cap  ?? 54_000;
    const pct       = Math.min(100, Math.round((charsUsed / charsCap) * 100));
    const resetsAt  = settings?.quota_resets_at
      ? new Date(settings.quota_resets_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : null;

    return (
      <div
        className="rounded-2xl p-5"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <div className="text-sm font-medium text-white mb-1">🎙 Voice Settings</div>
        <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
          Standard voice (Google) — read aloud by your browser
        </p>

        {/* Usage bar */}
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>Monthly usage</span>
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>{pct}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'rgba(255,255,255,.06)' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: pct >= 90 ? '#ef4444' : 'var(--accent)',
            }}
          />
        </div>

        {pct >= 90 && (
          <p className="text-xs mb-3" style={{ color: '#ef4444' }}>
            {pct === 100 ? 'Voice limit reached.' : 'Almost at limit.'}
            {resetsAt && <> Resets {resetsAt}.</>}
          </p>
        )}

        <a
          href="/pricing"
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          ✦ Upgrade for HD Indian Voice
        </a>
      </div>
    );
  }

  // ── Paid tier view ─────────────────────────────────────────────────────────
  const hdEnabled  = settings.hd_voice_enabled;
  const hdExhausted = settings.hd_exhausted ?? false;
  const resetDate  = settings.hd_quota_reset
    ? new Date(settings.hd_quota_reset).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : null;

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <div className="text-sm font-medium text-white mb-1">🎙 Voice Settings</div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
        Choose how Aria reads questions aloud during your sessions.
      </p>

      {/* Toggle row */}
      <div className="flex flex-col gap-2">
        {/* Standard option */}
        <button
          onClick={() => handleToggle(false)}
          disabled={saving}
          className="flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors"
          style={{
            background: !hdEnabled ? 'rgba(var(--accent-rgb, 124,95,255),.12)' : 'var(--surface-3, rgba(255,255,255,.04))',
            border: `1.5px solid ${!hdEnabled ? 'var(--accent-border)' : 'var(--border)'}`,
          }}
        >
          <span className="text-base">🔊</span>
          <div className="flex-1">
            <div className="text-sm font-medium text-white">Standard (Google)</div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              Free · Uses your browser's built-in voice
            </div>
          </div>
          {!hdEnabled && <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Active</span>}
        </button>

        {/* HD option */}
        <button
          onClick={() => handleToggle(true)}
          disabled={saving}
          className="flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors"
          style={{
            background: hdEnabled ? 'rgba(var(--accent-rgb, 124,95,255),.12)' : 'var(--surface-3, rgba(255,255,255,.04))',
            border: `1.5px solid ${hdEnabled ? 'var(--accent-border)' : 'var(--border)'}`,
          }}
        >
          <span className="text-base">🎧</span>
          <div className="flex-1">
            <div className="text-sm font-medium text-white">HD Indian Voice (Sarvam)</div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              Warm Indian-English accent · Hindi &amp; Hinglish support
            </div>
            {hdEnabled && hdExhausted && resetDate && (
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                HD voice used up for this month — resets {resetDate}. Using Standard voice.
              </div>
            )}
          </div>
          {hdEnabled && !hdExhausted && <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Active</span>}
        </button>
      </div>
    </div>
  );
}

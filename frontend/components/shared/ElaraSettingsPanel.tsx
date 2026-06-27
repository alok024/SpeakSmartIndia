'use client';

/**
 * components/shared/ElaraSettingsPanel.tsx
 *
 * Elara language preference card — renders on the profile page for Elite users.
 * Free / Starter / Pro see nothing (returns null).
 *
 * Mirrors VoiceSettingsPanel in structure:
 *  - Fetches /api/elara/prefs on mount
 *  - Optimistic update on toggle, reverts on failure
 *  - No save button: toggle is the action
 */

import { useEffect, useState, useCallback } from 'react';
import { elaraApi } from '@/features/elara/api';
import type { User } from '@/types';

interface ElaraSettingsPanelProps {
  user: User | null;
}

export function ElaraSettingsPanel({ user }: ElaraSettingsPanelProps) {
  const [hindiPref, setHindiPref] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);

  const isElite = user?.plan === 'elite';

  const fetchPrefs = useCallback(async () => {
    setLoading(true);
    const result = await elaraApi.getPrefs();
    if (result.ok) setHindiPref(result.data.elara_hindi_pref);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isElite) fetchPrefs();
  }, [isElite, fetchPrefs]);

  if (!isElite) return null;

  const handleToggle = async (enabled: boolean) => {
    if (saving) return;
    setSaving(true);
    setHindiPref(enabled); // optimistic
    const result = await elaraApi.setHindiPref(enabled);
    if (!result.ok) setHindiPref(!enabled); // revert
    setSaving(false);
  };

  if (loading) {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
      >
        <div className="text-sm font-medium text-white mb-3">🌐 Elara Language</div>
        <div className="h-4 w-48 rounded animate-pulse" style={{ background: 'var(--surface-3, rgba(255,255,255,.06))' }} />
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      <div className="text-sm font-medium text-white mb-1">🌐 Elara Language (Elite)</div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
        When enabled, Elara explains grammar corrections and audit patterns in
        Hinglish alongside English — useful for learners who think in Hindi.
      </p>

      {/* Toggle options */}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => handleToggle(false)}
          disabled={saving}
          className="flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors"
          style={{
            background: !hindiPref ? 'rgba(var(--accent-rgb, 124,95,255),.12)' : 'var(--surface-3, rgba(255,255,255,.04))',
            border: `1.5px solid ${!hindiPref ? 'var(--accent-border)' : 'var(--border)'}`,
          }}
        >
          <span className="text-base">🇬🇧</span>
          <div className="flex-1">
            <div className="text-sm font-medium text-white">English only</div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              Corrections and audit patterns in English
            </div>
          </div>
          {!hindiPref && (
            <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Active</span>
          )}
        </button>

        <button
          onClick={() => handleToggle(true)}
          disabled={saving}
          className="flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors"
          style={{
            background: hindiPref ? 'rgba(var(--accent-rgb, 124,95,255),.12)' : 'var(--surface-3, rgba(255,255,255,.04))',
            border: `1.5px solid ${hindiPref ? 'var(--accent-border)' : 'var(--border)'}`,
          }}
        >
          <span className="text-base">🇮🇳</span>
          <div className="flex-1">
            <div className="text-sm font-medium text-white">Hinglish explanations</div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              Grammar rules explained in Hindi/Hinglish
            </div>
          </div>
          {hindiPref && (
            <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Active</span>
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * features/voice/api/index.ts
 *
 * HTTP calls for text-to-speech playback during live interview sessions.
 *
 * Returns a Blob directly rather than going through `apiCall`/ApiResult,
 * since the response is audio, not JSON.
 */
export type VoiceLang = 'en' | 'hi' | 'hinglish';

export type WarmupResult =
  | { ok: true; blob: Blob }
  | { ok: false; reason: 'already_used_today' | 'not_configured' | 'error' };

export interface VoiceSettings {
  plan: string;
  hd_voice_enabled: boolean;
  // Free users only
  chars_used?: number;
  chars_cap?: number;
  quota_resets_at?: string;
  // Paid users — Sarvam voice balance (Aria + Elara share one pool)
  hd_exhausted?: boolean;
  hd_quota_reset?: string | null;
  voice_seconds_used?: number;
  voice_cap_seconds?: number;
  voice_seconds_remaining?: number;
  // Paid users — Avatar (Simli) balance — separate pool
  avatar_seconds_used?: number;
  avatar_cap_seconds?: number;
  avatar_seconds_remaining?: number | null;
  avatar_exhausted?: boolean;
  avatar_quota_reset?: string | null;
}

export interface AvatarStartResult {
  avatar_seconds_remaining: number | null;
  auto_end_after_secs: number | null;
}

export interface FreeTtsGateResult {
  allowed: boolean;
  chars_used: number;
  chars_cap: number;
}

export interface FreeTtsDebitResult {
  debited: boolean;
}

export const voiceApi = {
  // Starter/Pro/Elite — real (ledger-metered) TTS. `lang` selects ElevenLabs
  // (en) vs Sarvam Bulbul v3 (hi/hinglish); omit for English-only behaviour.
  tts: async (text: string, lang?: VoiceLang): Promise<Blob | null> => {
    try {
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lang ? { text, lang } : { text }),
      });
      if (!res.ok) return null;
      return res.blob();
    } catch {
      return null;
    }
  },

  // Free-tier — one ~30s HD voice preview per IST day. The result is
  // tagged so callers can show "come back tomorrow" for the expected
  // 429 (warmup_already_used) rather than a generic error message —
  // see voice.controller.ts's textToSpeechWarmup for the status codes.
  ttsWarmup: async (text: string): Promise<WarmupResult> => {
    try {
      const res = await fetch('/api/voice/tts/warmup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) return { ok: true, blob: await res.blob() };

      if (res.status === 429) return { ok: false, reason: 'already_used_today' };
      if (res.status === 501) return { ok: false, reason: 'not_configured' };
      return { ok: false, reason: 'error' };
    } catch {
      return { ok: false, reason: 'error' };
    }
  },

  // Voice settings (HD toggle + quota info)
  getSettings: async (): Promise<VoiceSettings | null> => {
    try {
      const res = await fetch('/api/voice/settings', {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = await res.json() as { data: VoiceSettings };
      return data.data ?? null;
    } catch {
      return null;
    }
  },

  setHdVoice: async (enabled: boolean): Promise<boolean> => {
    try {
      const res = await fetch('/api/voice/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hd_voice_enabled: enabled }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  // Free TTS gate — call before window.speechSynthesis.speak()
  // Returns allowed:false when free cap is reached.
  checkFreeTtsGate: async (chars: number): Promise<FreeTtsGateResult> => {
    try {
      const res = await fetch('/api/voice/free-tts-gate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chars }),
      });
      if (!res.ok) return { allowed: true, chars_used: 0, chars_cap: 54_000 }; // fail-open
      const data = await res.json() as { data: FreeTtsGateResult };
      return data.data ?? { allowed: true, chars_used: 0, chars_cap: 54_000 };
    } catch {
      return { allowed: true, chars_used: 0, chars_cap: 54_000 }; // fail-open
    }
  },

  // Free TTS debit — fire-and-forget after utterance.onend
  debitFreeTtsChars: (chars: number): void => {
    fetch('/api/voice/free-tts-debit', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chars }),
    }).catch(() => { /* non-fatal */ });
  },
};

// Avatar (Simli) session gate + debit — called by useSimliAvatar
export const avatarApi = {
  // Gate check before opening a Simli WebRTC connection.
  // Returns remaining seconds so the client can schedule self-termination.
  start: async (): Promise<AvatarStartResult | null> => {
    try {
      const res = await fetch('/api/voice/avatar/start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) return null;
      const data = await res.json() as { data: AvatarStartResult };
      return data.data ?? null;
    } catch {
      return null;
    }
  },

  // Debit actual WebRTC session duration. Fire-and-forget.
  end: (durationSecs: number): void => {
    fetch('/api/voice/avatar/end', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration_secs: Math.max(1, Math.round(durationSecs)) }),
    }).catch(() => { /* non-fatal */ });
  },
};

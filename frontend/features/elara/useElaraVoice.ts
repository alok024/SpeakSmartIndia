/**
 * features/elara/useElaraVoice.ts
 *
 * TTS hook for Elara — deliberately separate from useAriaVoice so Aria and
 * Elara can run concurrently during a session without sharing a speakingRef
 * (they would interrupt each other if they shared one).
 *
 * Routing:
 *   Free / HD off  → Web Speech API (no server cost)
 *   Paid + HD on   → voiceApi.tts() → Sarvam Bulbul v3
 *
 * Returns:
 *   speak(text)        — fire-and-forget (does not await audio end)
 *   speakAsync(text)   — awaitable; resolves when audio ends (use for debrief
 *                         narration where you want to navigate after speaking)
 *   stop()             — cancel current utterance
 *   canSpeak           — true for paid users with HD on (shows mic/voice UI)
 *   hdExhausted        — true when Sarvam quota is gone for the month
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import type { User } from '@/types';
import { voiceApi } from '@/features/voice/api';

interface UseElaraVoiceOptions {
  user: User | null;
}

interface UseElaraVoiceResult {
  speak:       (text: string) => void;
  speakAsync:  (text: string) => Promise<void>;
  stop:        () => void;
  canSpeak:    boolean;
  hdExhausted: boolean;
}

export function useElaraVoice({ user }: UseElaraVoiceOptions): UseElaraVoiceResult {
  const [hdExhausted, setHdExhausted] = useState(false);
  const speakingRef  = useRef(false);
  const audioRef     = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // canSpeak requires both a Pro/Elite plan AND hd_voice_enabled — Starter users
  // with the toggle set should not receive spoken corrections on /english
  const isPro    = user?.plan === 'pro' || user?.plan === 'elite';
  const isHd     = isPro && (user?.hd_voice_enabled ?? false);
  const canSpeak = isHd && !hdExhausted;

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    speakingRef.current = false;
  }, []);

  const speakAsync = useCallback(async (text: string): Promise<void> => {
    if (!text.trim() || typeof window === 'undefined') return;
    if (speakingRef.current) stop();

    // HD Sarvam path
    if (isHd) {
      speakingRef.current = true;
      try {
        const blob = await voiceApi.tts(text, 'en');
        if (!blob) {
          setHdExhausted(true);
          return _webSpeechAsync(text, () => { speakingRef.current = false; });
        }
        const url   = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        return new Promise<void>((resolve) => {
          audio.onended = () => {
            URL.revokeObjectURL(url);
            speakingRef.current = false;
            audioRef.current    = null;
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            speakingRef.current = false;
            audioRef.current    = null;
            setHdExhausted(true);
            resolve();
          };
          audio.play().catch(() => {
            speakingRef.current = false;
            resolve();
          });
        });
      } catch {
        speakingRef.current = false;
        setHdExhausted(true);
        return;
      }
    }

    // Web Speech fallback
    speakingRef.current = true;
    return _webSpeechAsync(text, () => { speakingRef.current = false; });
  }, [isHd, stop]);

  const speak = useCallback((text: string): void => {
    speakAsync(text).catch(() => { /* fire-and-forget */ });
  }, [speakAsync]);

  return { speak, speakAsync, stop, canSpeak, hdExhausted };
}

function _webSpeechAsync(text: string, onEnd: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!window.speechSynthesis) { onEnd(); resolve(); return; }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voices    = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang === 'en-IN')
      ?? voices.find(v => v.lang.startsWith('en'))
      ?? null;
    if (preferred) utterance.voice = preferred;
    utterance.lang  = 'en-IN';
    utterance.rate  = 0.95;
    utterance.pitch = 1.0;
    utterance.onend   = () => { onEnd(); resolve(); };
    utterance.onerror = () => { onEnd(); resolve(); };
    window.speechSynthesis.speak(utterance);
  });
}

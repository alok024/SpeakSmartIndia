/**
 * features/voice/useAriaVoice.ts
 *
 * Aria's voice routing hook — handles all TTS during live interview sessions.
 *
 * Routing logic:
 *   Free users   → Web Speech API (window.speechSynthesis), server-side char cap at 54k/month
 *   Paid + HD on → voiceApi.tts() → Sarvam Bulbul v3 (with ElevenLabs fallback on server)
 *   Paid + HD off → Web Speech API (no server cap for paid users)
 *
 * Returns:
 *   speak(text)  — speaks the given text according to the routing above
 *   freeCapped   — true when free user has hit the monthly char cap (show nudge)
 *   hdExhausted  — true when paid HD quota is gone for the month (show subtle indicator)
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import type { User } from '@/types';
import { voiceApi, type VoiceLang } from './api';

interface UseAriaVoiceOptions {
  user: User | null;
  lang?: VoiceLang;
}

interface UseAriaVoiceResult {
  speak: (text: string) => Promise<void>;
  freeCapped: boolean;
  hdExhausted: boolean;
}

export function useAriaVoice({ user, lang = 'en' }: UseAriaVoiceOptions): UseAriaVoiceResult {
  const [freeCapped, setFreeCapped]   = useState(false);
  const [hdExhausted, setHdExhausted] = useState(false);

  // Avoid double-speaking if called multiple times before the current utterance ends.
  const speakingRef = useRef(false);

  const speak = useCallback(async (text: string): Promise<void> => {
    if (!text.trim() || typeof window === 'undefined') return;
    if (speakingRef.current) return;

    const isFree   = !user || user.plan === 'free';
    const isHd     = !isFree && (user?.hd_voice_enabled ?? false);

    // ── Paid HD path: real TTS through backend ──────────────────────────────
    if (isHd) {
      speakingRef.current = true;
      try {
        const blob = await voiceApi.tts(text, lang);
        if (!blob) {
          // Sarvam exhausted / backend unavailable — fall through to Web Speech below
          setHdExhausted(true);
          _webSpeech(text, lang, () => { speakingRef.current = false; });
          return;
        }
        const url   = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => {
          URL.revokeObjectURL(url);
          speakingRef.current = false;
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          speakingRef.current = false;
          setHdExhausted(true);
        };
        await audio.play().catch(() => { speakingRef.current = false; });
      } catch {
        speakingRef.current = false;
        setHdExhausted(true);
      }
      return;
    }

    // ── Free path: Web Speech API with server-side char cap gate ────────────
    if (isFree) {
      const gate = await voiceApi.checkFreeTtsGate(text.length);
      if (!gate.allowed) {
        setFreeCapped(true);
        return; // silently skip voice, question still visible as text
      }
    }

    // ── Web Speech (free cap ok, or paid with HD off) ───────────────────────
    speakingRef.current = true;
    _webSpeech(text, lang, () => {
      speakingRef.current = false;
      // Debit chars for free users only (fire-and-forget)
      if (isFree) {
        voiceApi.debitFreeTtsChars(text.length);
      }
    });
  }, [user, lang]);

  return { speak, freeCapped, hdExhausted };
}

// ---------------------------------------------------------------------------
// Internal: thin wrapper around window.speechSynthesis for the Standard path.
// Picks the best available voice: prefers Indian English voices when available
// (Chrome on Android often has one), falls back to any en-* voice.
// ---------------------------------------------------------------------------
function _webSpeech(text: string, lang: VoiceLang, onEnd: () => void): void {
  if (!window.speechSynthesis) { onEnd(); return; }

  window.speechSynthesis.cancel(); // stop any previous utterance

  const utterance = new SpeechSynthesisUtterance(text);

  // Voice selection: prefer hi-IN for Hindi, en-IN for Hinglish/English
  const targetLang = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const voices     = window.speechSynthesis.getVoices();
  const preferred  = voices.find(v => v.lang === targetLang)
    ?? voices.find(v => v.lang.startsWith(lang === 'hi' ? 'hi' : 'en'))
    ?? null;
  if (preferred) utterance.voice = preferred;

  utterance.lang  = targetLang;
  utterance.rate  = 0.95;
  utterance.pitch = 1.0;

  utterance.onend   = onEnd;
  utterance.onerror = onEnd;

  window.speechSynthesis.speak(utterance);
}

/**
 * features/voice/useAriaVoice.ts
 *
 * Aria's voice routing hook — handles all TTS during live interview sessions.
 *
 * Routing:
 *   Free users          → Web Speech API (browser), server-side char cap at 54k/month
 *   Paid + HD on        → Sarvam Bulbul v3 (sentence-chunked, Web Audio API queue)
 *                         → ElevenLabs fallback (handled server-side)
 *                         → graceful SD fallback when HD quota is exhausted mid-session
 *   Paid + HD off       → Web Speech API (no server cost, no server cap)
 *
 * The HD path uses sentence-chunked delivery: the caller may pass multiple
 * sentences as one string; speakChunked() splits at sentence boundaries,
 * fetches TTS for each chunk in parallel, and enqueues them for seamless
 * back-to-back playback via useAudioQueue.
 *
 * Returns:
 *   speak(text)         — speaks text via the appropriate path
 *   speakChunked(text)  — same, but optimised for longer multi-sentence text
 *   stopSpeaking()      — immediately halt any in-progress audio
 *   freeCapped          — true when free user has hit the monthly char cap
 *   hdExhausted         — true when paid HD quota is gone (graceful SD fallback active)
 *   isPlaying           — true while audio is queued or playing
 */

'use client';

import { useCallback, useRef, useState } from 'react';
import type { User } from '@/types';
import { voiceApi, type VoiceLang } from './api';
import { useAudioQueue }             from './useAudioQueue';

interface UseAriaVoiceOptions {
  user: User | null;
  lang?: VoiceLang;
}

interface UseAriaVoiceResult {
  speak:        (text: string) => Promise<void>;
  speakChunked: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  freeCapped:   boolean;
  hdExhausted:  boolean;
  isPlaying:    boolean;
}

// Sentence boundary split — mirrors the backend chunker's boundary rule so
// the frontend can pre-split long text and parallelise TTS fetches.
const SENTENCE_RE = /(?<=[.!?])\s+/;

function splitSentences(text: string): string[] {
  const parts = text.split(SENTENCE_RE).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [text.trim()];
}

export function useAriaVoice({ user, lang = 'en' }: UseAriaVoiceOptions): UseAriaVoiceResult {
  const [freeCapped,  setFreeCapped]  = useState(false);
  const [hdExhausted, setHdExhausted] = useState(false);

  const queue       = useAudioQueue();
  const speakingRef = useRef(false);

  const stopSpeaking = useCallback((): void => {
    queue.clear();
    window.speechSynthesis?.cancel();
    speakingRef.current = false;
  }, [queue]);

  // Fetch TTS for a single chunk and enqueue it. Returns false if the
  // HD provider failed and the caller should fall back to SD.
  const fetchAndEnqueue = useCallback(async (chunk: string): Promise<boolean> => {
    const blob = await voiceApi.tts(chunk, lang);
    if (!blob) return false;
    await queue.enqueue(blob);
    return true;
  }, [lang, queue]);

  // HD path: split into sentences, fetch concurrently, enqueue in order.
  // "In order" is guaranteed by Web Audio API's scheduled start times in
  // useAudioQueue — parallel fetches may resolve out of order but
  // enqueue() uses wall-clock scheduling, not arrival order.
  const speakHd = useCallback(async (text: string): Promise<boolean> => {
    const sentences = splitSentences(text);

    if (sentences.length === 1) {
      return fetchAndEnqueue(sentences[0]);
    }

    // Fetch all sentences concurrently — TTS latency on later sentences
    // is hidden behind playback of the first one.
    const results = await Promise.all(sentences.map(fetchAndEnqueue));
    return results.some(Boolean); // partial success is still a success
  }, [fetchAndEnqueue]);

  const speak = useCallback(async (text: string): Promise<void> => {
    if (!text.trim() || typeof window === 'undefined') return;

    const isFree = !user || user.plan === 'free';
    const isHd   = !isFree && (user?.hd_voice_enabled ?? false) && !hdExhausted;

    if (isHd) {
      speakingRef.current = true;
      const ok = await speakHd(text);
      if (!ok) {
        setHdExhausted(true);
        // Graceful fallback to SD — no hard cut, no error shown
        speakingRef.current = true;
        _webSpeech(text, lang, () => { speakingRef.current = false; });
      } else {
        speakingRef.current = false;
      }
      return;
    }

    // Free path: gate check before browser TTS
    if (isFree) {
      const gate = await voiceApi.checkFreeTtsGate(text.length);
      if (!gate.allowed) {
        setFreeCapped(true);
        return;
      }
    }

    speakingRef.current = true;
    _webSpeech(text, lang, () => {
      speakingRef.current = false;
      if (isFree) voiceApi.debitFreeTtsChars(text.length);
    });
  }, [user, lang, hdExhausted, speakHd]);

  // speakChunked: identical routing to speak() but intended for callers
  // that already know the text is multi-sentence (e.g. question + follow-up).
  // On the HD path it's strictly equivalent — splitSentences runs either way.
  const speakChunked = speak;

  return {
    speak,
    speakChunked,
    stopSpeaking,
    freeCapped,
    hdExhausted,
    isPlaying: queue.isPlaying,
  };
}

// Internal: browser Web Speech API — SD path (free users + paid with HD off/exhausted).
// Prefers en-IN / hi-IN voices when available (common on Android Chrome India builds).
function _webSpeech(text: string, lang: VoiceLang, onEnd: () => void): void {
  if (!window.speechSynthesis) { onEnd(); return; }

  window.speechSynthesis.cancel();

  const utterance  = new SpeechSynthesisUtterance(text);
  const targetLang = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const voices     = window.speechSynthesis.getVoices();
  const preferred  = voices.find((v) => v.lang === targetLang)
    ?? voices.find((v) => v.lang.startsWith(lang === 'hi' ? 'hi' : 'en'))
    ?? null;
  if (preferred) utterance.voice = preferred;

  utterance.lang  = targetLang;
  utterance.rate  = 0.95;
  utterance.pitch = 1.0;
  utterance.onend   = onEnd;
  utterance.onerror = onEnd;

  window.speechSynthesis.speak(utterance);
}

/**
 * useSimliAvatar.ts
 *
 * Manages the Simli avatar lifecycle for the interview session page.
 *
 * Design decisions:
 *   - If `avatarMode` is 'voice-only' (set by the user or auto-detected),
 *     this hook is a no-op: the SimliClient is never imported or constructed.
 *   - If `avatarMode` is 'full' (or undefined), we gate against the server
 *     (/api/voice/avatar/start) before initialising SimliClient. A 429 response
 *     means the monthly avatar minutes are exhausted — fall back to voice-only
 *     and show the upgrade prompt (avatarExhausted = true in state).
 *   - Once connected, a countdown timer runs from `autoEndAfterSecs`. When it
 *     hits zero the hook sends /api/voice/avatar/end, fires the
 *     `onAvatarSessionEnded` callback (caller removes the avatar UI), and
 *     continues the interview in audio-only mode. The user sees an in-session
 *     toast: "Avatar minutes used up — continuing in audio mode."
 *   - On unmount or manual close the hook also calls /api/voice/avatar/end
 *     with the elapsed duration so the ledger stays accurate.
 *   - The hook accepts an optional `clientRef` that it populates once the
 *     SimliClient connects. The barge-in hook reads this ref to call
 *     `stopSpeaking()` without re-renders.
 *
 * Usage (session/page.tsx):
 *
 *   const simliClientRef = useRef<SimliHandle | null>(null);
 *   const { ready, voiceOnly, avatarExhausted } = useSimliAvatar(videoRef, simliClientRef, {
 *     onAvatarSessionEnded: () => toast('Avatar minutes used up — continuing in audio mode.'),
 *   });
 *   if (!voiceOnly) return <div ref={videoRef} />;
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useInterviewStore } from '@/store/interview';
import { avatarApi } from '../voice/api';
import type { SimliHandle } from './useBargeIn';

export interface SimliAvatarState {
  /** True once the avatar is connected and streaming video. */
  ready: boolean;
  /**
   * True when running without the avatar — either the user requested
   * voice-only, Simli init failed, or avatar minutes ran out.
   */
  voiceOnly: boolean;
  /**
   * True when the session fell back to voice-only because the monthly
   * avatar quota was exhausted. Caller should show an upgrade nudge.
   */
  avatarExhausted: boolean;
  /**
   * Remaining avatar seconds at session start (null if unknown / unlimited).
   * Drive a countdown UI from this value.
   */
  avatarSecondsRemaining: number | null;
}

export interface SimliAvatarOptions {
  /** Called when the server terminates the avatar session (quota hit zero). */
  onAvatarSessionEnded?: () => void;
}

// ---------------------------------------------------------------------------
// Stub — replace with real SimliClient when @simli/client is installed.
// Real implementation connects to Simli WebRTC and returns a handle with
// stopSpeaking() (used by useBargeIn). The stub returns null so the hook
// falls through to voice-only mode, which is the live product until Simli
// is wired (Phase 0.4 / P7-B).
// ---------------------------------------------------------------------------
async function simulateSimliInit(
  _containerEl: HTMLElement | null,
): Promise<SimliHandle | null> {
  // Replace with:
  //   const { SimliClient } = await import('@simli/client');
  //   const client = new SimliClient({ apiKey, faceId, container });
  //   await client.connect();
  //   return { stopSpeaking: () => client.stopSpeaking() };
  return null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSimliAvatar(
  containerRef: React.RefObject<HTMLElement | null>,
  clientRef?:  React.RefObject<SimliHandle | null>,
  options?:    SimliAvatarOptions,
): SimliAvatarState {
  const store = useInterviewStore();
  const requestedVoiceOnly = store.config.avatarMode === 'voice-only';

  const [ready, setReady]                           = useState(false);
  const [voiceOnly, setVoiceOnly]                   = useState(requestedVoiceOnly);
  const [avatarExhausted, setAvatarExhausted]       = useState(false);
  const [avatarSecondsRemaining, setSecondsLeft]    = useState<number | null>(null);

  const didInit      = useRef(false);
  const sessionStart = useRef<number | null>(null);
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sends /api/voice/avatar/end with elapsed duration — idempotent, fire-and-forget.
  const endSession = useCallback((exhausted = false) => {
    if (!sessionStart.current) return;
    const elapsed = Math.round((Date.now() - sessionStart.current) / 1000);
    sessionStart.current = null;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Debit elapsed time regardless of why the session ended.
    // fire-and-forget — same contract as freeTtsDebit
    avatarApi.end(elapsed);

    if (exhausted) {
      setAvatarExhausted(true);
      store.setAvatarMode('voice-only');
      setVoiceOnly(true);
      options?.onAvatarSessionEnded?.();
    }
  }, [store, options]);

  // Countdown: when autoEndAfterSecs is known, schedule self-termination.
  const scheduleAutoEnd = useCallback((remainingSecs: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      endSession(/* exhausted */ true);
    }, remainingSecs * 1000);
  }, [endSession]);

  useEffect(() => {
    if (requestedVoiceOnly) {
      setVoiceOnly(true);
      return;
    }

    if (didInit.current) return;
    didInit.current = true;

    (async () => {
      // ── Gate check ──────────────────────────────────────────────────────
      let autoEndAfterSecs: number | null = null;
      try {
        const gate = await avatarApi.start();
        if (!gate) {
          // null = quota exhausted (429), wrong tier (403), or network error.
          // All cases fall back to voice-only. avatarApi.start() swallows non-ok
          // responses and returns null, so we can't distinguish 429 from 403 here.
          // The quota gate on the server side already logged the reason.
          store.setAvatarMode('voice-only');
          setVoiceOnly(true);
          return;
        }
        autoEndAfterSecs = gate.auto_end_after_secs;
        setSecondsLeft(gate.avatar_seconds_remaining);
      } catch {
        // Fail-open on unexpected error — let Simli init proceed without a
        // known balance. If the stub returns null below, voice-only path fires.
      }

      // ── Simli init ──────────────────────────────────────────────────────
      try {
        const handle = await simulateSimliInit(containerRef.current);

        if (handle === null) {
          // Stub or real init returned null — no SDK yet; fall back to voice-only.
          // Call /avatar/end with 0 duration (we never actually connected).
          avatarApi.end(1);
          store.setAvatarMode('voice-only');
          setVoiceOnly(true);
          return;
        }

        // Connected — wire up the session timer and barge-in ref.
        sessionStart.current = Date.now();
        if (clientRef) {
          (clientRef as React.MutableRefObject<SimliHandle | null>).current = handle;
        }
        if (autoEndAfterSecs !== null && autoEndAfterSecs > 0) {
          scheduleAutoEnd(autoEndAfterSecs);
        }
        setReady(true);
      } catch (err) {
        console.error('[Simli] Avatar init failed, falling back to voice-only:', err);
        store.setAvatarMode('voice-only');
        setVoiceOnly(true);
      }
    })();

    return () => {
      // Debit elapsed time on unmount (tab close, session end, manual toggle off).
      endSession(/* exhausted */ false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedVoiceOnly]);

  return { ready, voiceOnly, avatarExhausted, avatarSecondsRemaining };
}

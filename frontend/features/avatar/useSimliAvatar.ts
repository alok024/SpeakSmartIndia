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

/**
 * Initialises a SimliClient, connects it to the container element, and
 * returns a SimliHandle (the minimal barge-in surface we expose).
 *
 * Dynamic import keeps simli-client (and its livekit-client dep) out of
 * the SSR bundle entirely — both packages reference `window` at module
 * scope and crash on Cloudflare edge runtime if statically imported.
 * Same pattern as @ricky0123/vad-web in useBargeIn.ts.
 *
 * @param containerEl  The div that Simli renders the video element into.
 * @param audioEl      The hidden <audio> element barge-in pauses.
 * @param sessionToken Short-lived Simli token from /api/voice/avatar/start.
 * @returns A SimliHandle, or null if init fails.
 */
async function initSimliClient(
  containerEl:  HTMLElement | null,
  audioEl:      HTMLAudioElement | null,
  sessionToken: string,
): Promise<SimliHandle | null> {
  if (typeof window === 'undefined' || !containerEl || !audioEl) return null;

  try {
    const { SimliClient, generateIceServers } = await import('simli-client');

    // Create a <video> element inside the container div.
    // Simli streams the talking-head video here.
    const videoEl = document.createElement('video');
    videoEl.autoplay   = true;
    videoEl.playsInline = true;
    videoEl.muted      = true;  // audio goes through audioEl, not videoEl
    videoEl.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    containerEl.innerHTML = '';
    containerEl.appendChild(videoEl);

    // Fetch ICE servers for the WebRTC connection.
    // generateIceServers expects the Simli API key — we don't have it
    // client-side (it stays on the server). Passing null makes SimliClient
    // fall back to its default STUN/TURN configuration which is fine for
    // the majority of network conditions. If NAT traversal becomes an issue,
    // add a backend endpoint that calls generateIceServers() server-side
    // and returns the ICE servers alongside the session token.
    const iceServers = await generateIceServers(null as unknown as string).catch(() => null);

    const client = new SimliClient(
      sessionToken,
      videoEl,
      audioEl,
      iceServers,
    );

    await client.start();

    // Return the minimal barge-in surface.
    // SimliClient.ClearBuffer() drains the audio queue — maps to stopSpeaking().
    return {
      stopSpeaking() {
        try { client.ClearBuffer(); } catch { /* non-fatal */ }
      },
    };
  } catch (err) {
    console.error('[Simli] initSimliClient failed:', err);
    return null;
  }
}

// Hook

export function useSimliAvatar(
  containerRef: React.RefObject<HTMLElement | null>,
  clientRef?:  React.RefObject<SimliHandle | null>,
  options?:    SimliAvatarOptions & {
    /** Ref to the hidden <audio> element Simli streams TTS into. */
    audioRef?: React.RefObject<HTMLAudioElement | null>;
  },
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
      // Gate check — fetches quota + Simli session token from the backend.
      let autoEndAfterSecs: number | null = null;
      let sessionToken: string | null = null;
      try {
        const gate = await avatarApi.start();
        if (!gate) {
          // null = quota exhausted (429), wrong tier (403), or network error.
          store.setAvatarMode('voice-only');
          setVoiceOnly(true);
          return;
        }
        if (gate.simli_unavailable) {
          // Backend returned graceful fallback (SIMLI_API_KEY not set, or
          // Simli API returned an error). Continue in voice-only mode silently.
          store.setAvatarMode('voice-only');
          setVoiceOnly(true);
          return;
        }
        sessionToken = gate.session_token;
        autoEndAfterSecs = gate.auto_end_after_secs;
        setSecondsLeft(gate.avatar_seconds_remaining);
      } catch {
        // Fail-open on unexpected error — fall back to voice-only.
        store.setAvatarMode('voice-only');
        setVoiceOnly(true);
        return;
      }

      if (!sessionToken) {
        store.setAvatarMode('voice-only');
        setVoiceOnly(true);
        return;
      }

      // Simli init — dynamic import keeps livekit-client out of SSR bundle.
      try {
        const audioEl = options?.audioRef?.current ?? null;
        const handle = await initSimliClient(containerRef.current, audioEl, sessionToken);

        if (handle === null) {
          // Real init returned null — fall back to voice-only.
          avatarApi.end(0); // 0 s — Simli never connected; ledger clamps to 1 s minimum
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

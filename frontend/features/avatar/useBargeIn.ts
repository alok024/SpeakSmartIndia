/**
 * useBargeIn.ts
 *
 * Voice Activity Detection (VAD) hook that enables barge-in during
 * AI avatar speech: when the user starts speaking, Simli's audio is
 * immediately silenced and the mic recorder starts capturing.
 *
 * ─── Architecture overview ───────────────────────────────────────────────
 *
 *  MicVAD (vad-web / Silero ONNX)
 *    │
 *    ├─ onSpeechStart → interrupt()
 *    │     ├─ audioEl.pause()            stop Simli TTS playback
 *    │     ├─ simliClient.stopSpeaking() drain Simli's internal audio queue
 *    │     └─ recorder.start()           begin MediaRecorder capture
 *    │
 *    └─ onSpeechEnd(audio) → onUtterance(audio)
 *          Caller handles the Float32Array (send to STT, append to
 *          chat textarea, etc.). The hook doesn't decide what to do
 *          with the captured audio — that's the session page's job.
 *
 * ─── Lifecycle ───────────────────────────────────────────────────────────
 *
 *  useBargeIn is a no-op (returns immediately) when:
 *    - avatarMode is 'voice-only' (no Simli to interrupt)
 *    - the browser lacks AudioWorklet support (graceful degradation)
 *
 *  Call `enable()` when the session starts and Simli is ready.
 *  Call `disable()` on session end / component unmount (handled in
 *  the returned cleanup automatically via useEffect).
 *
 * ─── Static assets ───────────────────────────────────────────────────────
 *
 *  vad-web loads model files at runtime from /public/vad/:
 *    - silero_vad_legacy.onnx   (Silero VAD model, ~1.8 MB)
 *    - vad.worklet.bundle.min.js (AudioWorklet processor)
 *    - ort-wasm-simd-threaded.wasm (onnxruntime WASM backend, ~13 MB)
 *
 *  These were copied from node_modules into public/vad/ during P7-C setup.
 *  The baseAssetPath and onnxWASMBasePath options below point vad-web there.
 *
 * ─── CSP ─────────────────────────────────────────────────────────────────
 *
 *  next.config.ts must include:
 *    "script-src ... 'wasm-unsafe-eval'"   ← ONNX runtime needs this
 *    "worker-src blob: 'self'"             ← AudioWorklet blob URL
 *
 *  These additions are documented in next.config.ts (see P7-C comment).
 *
 * ─── Simli surface ───────────────────────────────────────────────────────
 *
 *  This hook depends on two handles from the Simli integration (P7-B):
 *    - audioEl: HTMLAudioElement   the <audio> element Simli streams into
 *    - simliClient: { stopSpeaking(): void }
 *
 *  Both are passed in as refs so this hook never re-runs when they change.
 *  If either is null (Simli not ready / voice-only mode), barge-in silently
 *  becomes a no-op for that cycle.
 *
 * See: P7-C in the build plan — Phase 9.
 */

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useInterviewStore } from '@/store/interview';

// ---------------------------------------------------------------------------
// Minimal Simli surface — only what barge-in needs.
// The real SimliClient (when wired in P7-B) satisfies this automatically.
// ---------------------------------------------------------------------------
export interface SimliHandle {
  /** Drain Simli's internal audio queue so no queued speech plays after barge-in. */
  stopSpeaking(): void;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export interface UseBargeInOptions {
  /**
   * Ref to the <audio> element that Simli streams TTS into.
   * Paused immediately on speech start.
   */
  audioElRef: React.RefObject<HTMLAudioElement | null>;

  /**
   * Ref to the Simli client handle.
   * Its stopSpeaking() is called immediately after audioEl.pause().
   * If null (Simli not ready), only audioEl.pause() runs.
   */
  simliRef: React.RefObject<SimliHandle | null>;

  /**
   * Called when the VAD detects a complete speech segment.
   * Receives a Float32Array of audio samples (16 kHz, mono, normalised –1…1).
   * Typically: send to STT API, then append transcript to chat input.
   */
  onUtterance: (audio: Float32Array) => void;

  /**
   * Called when speech start is detected, before the recorder starts.
   * Optional — use to show a "listening…" indicator in the UI.
   */
  onSpeechStart?: () => void;

  /**
   * Called when speech end is detected (after onUtterance fires).
   * Optional — use to clear the "listening…" indicator.
   */
  onSpeechEnd?: () => void;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------
export interface UseBargeInReturn {
  /**
   * True once MicVAD has loaded the ONNX model and is listening.
   * False while loading, or if barge-in is disabled (voice-only mode,
   * no AudioWorklet support, or VAD init failed).
   */
  active: boolean;

  /**
   * Manually enable barge-in (e.g. call once Simli signals ready).
   * No-op if already active or in voice-only mode.
   */
  enable: () => Promise<void>;

  /**
   * Manually disable barge-in (e.g. on session end).
   * Destroys the VAD instance and releases the microphone.
   */
  disable: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const VAD_ASSET_BASE = '/vad/';

export function useBargeIn(options: UseBargeInOptions): UseBargeInReturn {
  const { audioElRef, simliRef, onUtterance, onSpeechStart, onSpeechEnd } = options;
  const store = useInterviewStore();

  // Never run in voice-only mode — there's no Simli audio to interrupt.
  const isVoiceOnly = store.config.avatarMode === 'voice-only';

  // MicVAD instance — kept in a ref so it never triggers re-renders.
  // Type is `unknown` here to avoid a top-level static import of the
  // package (which would crash during SSR on Cloudflare Pages because
  // vad-web references `window` at module scope).  We cast at use-time.
  const vadRef = useRef<unknown>(null);
  const activeRef = useRef(false);

  // Stable callbacks — options may change between renders; keep latest
  // in refs so the VAD closure always calls the current version.
  const onUtteranceRef = useRef(onUtterance);
  const onSpeechStartRef = useRef(onSpeechStart);
  const onSpeechEndRef = useRef(onSpeechEnd);
  useEffect(() => { onUtteranceRef.current = onUtterance; }, [onUtterance]);
  useEffect(() => { onSpeechStartRef.current = onSpeechStart; }, [onSpeechStart]);
  useEffect(() => { onSpeechEndRef.current = onSpeechEnd; }, [onSpeechEnd]);

  // ── interrupt() ──────────────────────────────────────────────────────────
  // Called the moment VAD detects speech start.
  // The three operations must happen synchronously (no await) so there is
  // zero gap between detecting speech and silencing the avatar audio.
  const interrupt = useCallback(() => {
    // 1. Pause avatar audio immediately
    const audio = audioElRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }

    // 2. Flush Simli's internal audio queue
    const simli = simliRef.current;
    if (simli) {
      try {
        simli.stopSpeaking();
      } catch (err) {
        // Non-fatal — if Simli isn't ready yet, we've already paused audio
        console.warn('[barge-in] simliClient.stopSpeaking() threw:', err);
      }
    }

    // 3. Notify the UI (e.g. show "listening…" badge)
    onSpeechStartRef.current?.();
  }, [audioElRef, simliRef]);

  // ── enable() ─────────────────────────────────────────────────────────────
  const enable = useCallback(async () => {
    if (isVoiceOnly || activeRef.current) return;

    // Guard: AudioWorklet is not available in all environments
    if (typeof window === 'undefined' || !('AudioContext' in window)) {
      console.warn('[barge-in] AudioContext unavailable — barge-in disabled');
      return;
    }

    try {
      // Dynamic import keeps vad-web out of the main bundle entirely.
      // On Cloudflare Pages (edge runtime for middleware, Node for RSC,
      // browser for client components) this import only runs client-side.
      const { MicVAD } = await import('@ricky0123/vad-web');

      const vad = await MicVAD.new({
        // Use the "legacy" Silero model (smaller, faster, well-tested)
        model: 'legacy',

        // Point to our public/vad/ copies — avoids CDN dependency and
        // satisfies the strict connect-src CSP.
        baseAssetPath:   VAD_ASSET_BASE,
        onnxWASMBasePath: VAD_ASSET_BASE,

        // Tuned for interview latency: respond within ~150 ms of speech
        // onset, tolerate brief inhalations / pauses without misfiring.
        positiveSpeechThreshold:  0.6,   // confidence needed to fire onSpeechStart
        negativeSpeechThreshold:  0.35,  // confidence below which speech is considered ended
        minSpeechFrames:          3,     // ~90 ms minimum — filters breath noise
        redemptionFrames:         8,     // frames below threshold before declaring speech end
        preSpeechPadFrames:       1,     // prepend 1 frame of audio before detected start

        startOnLoad: true,

        onSpeechStart: () => {
          interrupt();
        },

        onSpeechEnd: (audio: Float32Array) => {
          onUtteranceRef.current(audio);
          onSpeechEndRef.current?.();
        },

        onVADMisfire: () => {
          // Short burst (< minSpeechFrames) — ignore, resume Simli audio
          // so a cough or throat-clear doesn't permanently silence playback.
          const audio = audioElRef.current;
          if (audio && audio.paused) {
            audio.play().catch(() => {
              // Autoplay policy may block resume — acceptable, the user
              // can always tap play.
            });
          }
        },
      });

      vadRef.current = vad;
      activeRef.current = true;
    } catch (err) {
      // VAD init failure is non-fatal: the session continues without
      // barge-in (text input is still available). Log for Sentry.
      console.error('[barge-in] MicVAD init failed:', err);
    }
  }, [isVoiceOnly, interrupt, audioElRef]);

  // ── disable() ────────────────────────────────────────────────────────────
  const disable = useCallback(async () => {
    const vad = vadRef.current as { destroy(): Promise<void> } | null;
    if (!vad) return;
    try {
      await vad.destroy();
    } catch (err) {
      console.warn('[barge-in] MicVAD destroy error (non-fatal):', err);
    }
    vadRef.current = null;
    activeRef.current = false;
  }, []);

  // Auto-cleanup on unmount — avoids holding the microphone after the
  // session page unmounts (navigate-away, tab switch, etc.).
  useEffect(() => {
    return () => {
      // Fire-and-forget: we don't await in a cleanup function.
      // vad.destroy() internally clears the AudioContext and releases
      // the MediaStream track — the microphone indicator in the browser
      // chrome goes dark without waiting for a React re-render.
      disable().catch(() => {});
    };
  }, [disable]);

  return {
    get active() { return activeRef.current; },
    enable,
    disable,
  };
}

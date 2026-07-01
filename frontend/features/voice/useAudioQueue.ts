/**
 * features/voice/useAudioQueue.ts
 *
 * Seamless audio queue built on Web Audio API.
 *
 * The sentence-chunked TTS pipeline delivers multiple audio blobs for a single
 * AI response (one per sentence). Playing them with successive <Audio> elements
 * introduces ~200 ms gaps at each boundary (GC, element init, autoplay policy
 * re-check). This queue schedules each blob as an AudioBufferSourceNode on a
 * shared AudioContext, time-stamped so they play back-to-back with no gap.
 *
 * Interface:
 *   const queue = useAudioQueue();
 *   queue.enqueue(blob);   // add a decoded audio blob; plays immediately if idle
 *   queue.clear();         // stop playback and discard pending blobs (barge-in)
 *   queue.isPlaying        // reactive boolean — true while audio is queued/playing
 *
 * The AudioContext is created lazily on first enqueue() (browser autoplay policy
 * requires a user gesture before AudioContext creation — the first voice-mode
 * tap satisfies this). Subsequent calls reuse the same context.
 */

'use client';

import { useCallback, useRef, useState } from 'react';

export interface AudioQueueHandle {
  enqueue:   (blob: Blob) => Promise<void>;
  clear:     () => void;
  isPlaying: boolean;
}

export function useAudioQueue(): AudioQueueHandle {
  const ctxRef         = useRef<AudioContext | null>(null);
  const nextStartRef   = useRef<number>(0);       // scheduled end-time of last enqueued chunk
  const activeNodes    = useRef<AudioBufferSourceNode[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const pendingRef     = useRef(0);               // count of chunks not yet finished

  const getCtx = (): AudioContext => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext();
      nextStartRef.current = 0;
    }
    // Resume if browser suspended the context (background tab, etc.)
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  };

  const enqueue = useCallback(async (blob: Blob): Promise<void> => {
    const ctx = getCtx();

    let buffer: AudioBuffer;
    try {
      const arrayBuffer = await blob.arrayBuffer();
      buffer = await ctx.decodeAudioData(arrayBuffer);
    } catch (err) {
      console.warn('[audio-queue] decode failed (non-fatal):', err);
      return;
    }

    pendingRef.current++;
    setIsPlaying(true);

    const now   = ctx.currentTime;
    const start = Math.max(now, nextStartRef.current);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(start);

    nextStartRef.current = start + buffer.duration;
    activeNodes.current.push(source);

    source.onended = () => {
      activeNodes.current = activeNodes.current.filter((n) => n !== source);
      pendingRef.current  = Math.max(0, pendingRef.current - 1);
      if (pendingRef.current === 0) {
        setIsPlaying(false);
        nextStartRef.current = 0;
      }
    };
  }, []);

  const clear = useCallback((): void => {
    // Stop all in-flight nodes immediately
    for (const node of activeNodes.current) {
      try { node.stop(); } catch { /* already stopped */ }
    }
    activeNodes.current  = [];
    pendingRef.current   = 0;
    nextStartRef.current = 0;
    setIsPlaying(false);
  }, []);

  return { enqueue, clear, isPlaying };
}

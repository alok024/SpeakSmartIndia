/**
 * features/voice/useAudioWebSocket.ts
 *
 * Persistent WebSocket connection to /api/voice/stt-ws.
 *
 * Keeps a single WS open for the lifetime of an interview session,
 * eliminating the TCP + TLS handshake overhead of one-shot HTTP STT calls
 * (~80-150 ms per utterance on Railway → Indian client).
 *
 * Interface:
 *   const ws = useAudioWebSocket({ enabled });
 *   ws.sendAudio(audioBuffer, mimeType)  — stream audio then trigger transcription
 *   ws.abort()                           — discard current buffered audio
 *   ws.transcript                        — latest transcript string | null
 *   ws.transcribing                      — true while server is processing
 *   ws.connected                         — true when WS is open and ready
 *
 * Reconnect: exponential back-off, max 3 retries. After 3 consecutive failures
 * the hook sets `connected = false` permanently and callers fall back to the
 * HTTP STT endpoint.
 *
 * The WS is opened lazily on first `sendAudio()` call (not at mount) to avoid
 * consuming a server connection for users who never use voice mode.
 *
 * Enabled only for Starter+ users — free users use Web Speech API.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const WS_BACKEND = (() => {
  if (typeof window === 'undefined') return '';
  const api = process.env.NEXT_PUBLIC_API_URL ?? '';
  // Convert https:// → wss://, http:// → ws://
  return api.replace(/^https/, 'wss').replace(/^http/, 'ws');
})();

const MAX_RETRIES      = 3;
const RETRY_BASE_MS    = 1_000;
const PING_INTERVAL_MS = 30_000;

export interface AudioWebSocketHandle {
  sendAudio:    (buffer: ArrayBuffer, mimeType?: string) => void;
  abort:        () => void;
  transcript:   string | null;
  transcribing: boolean;
  connected:    boolean;
}

interface ServerMessage {
  type:     'ready' | 'transcript' | 'error' | 'pong';
  text?:    string;
  provider?: string;
  code?:    string;
  message?: string;
}

export function useAudioWebSocket(options: { enabled: boolean }): AudioWebSocketHandle {
  const { enabled } = options;

  const wsRef          = useRef<WebSocket | null>(null);
  const retryCount     = useRef(0);
  const pingTimer      = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingBuffer  = useRef<{ buffer: ArrayBuffer; mimeType: string } | null>(null);
  const deadRef        = useRef(false); // permanently failed — no more retries

  const [transcript,   setTranscript]   = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [connected,    setConnected]    = useState(false);

  const clearPing = () => {
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
  };

  const connect = useCallback((): WebSocket | null => {
    if (deadRef.current || !enabled || !WS_BACKEND) return null;
    if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current;

    const url = `${WS_BACKEND}/api/voice/stt-ws`;
    const ws  = new WebSocket(url);
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      retryCount.current = 0;
      // ping loop to keep the connection alive through proxies/NAT
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }

      if (msg.type === 'ready') {
        setConnected(true);
        // Flush any audio that arrived while we were connecting
        if (pendingBuffer.current) {
          const { buffer, mimeType } = pendingBuffer.current;
          pendingBuffer.current = null;
          _sendImmediate(ws, buffer, mimeType);
        }
      }

      if (msg.type === 'transcript') {
        setTranscribing(false);
        setTranscript(msg.text ?? null);
      }

      if (msg.type === 'error') {
        setTranscribing(false);
        console.warn('[stt-ws] server error:', msg.code, msg.message);
      }
      // pong: no-op
    };

    ws.onerror = () => {
      // onerror always precedes onclose — handle in onclose
    };

    ws.onclose = () => {
      clearPing();
      setConnected(false);
      wsRef.current = null;

      if (deadRef.current || !enabled) return;

      retryCount.current++;
      if (retryCount.current > MAX_RETRIES) {
        deadRef.current = true;
        console.warn('[stt-ws] max retries exceeded — falling back to HTTP STT');
        return;
      }

      const delay = RETRY_BASE_MS * 2 ** (retryCount.current - 1);
      setTimeout(() => { connect(); }, delay);
    };

    return ws;
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open connection lazily when enabled flag changes to true
  useEffect(() => {
    if (!enabled) return;
    connect();
    return () => {
      deadRef.current = true;
      clearPing();
      wsRef.current?.close(1000, 'component_unmount');
      wsRef.current = null;
    };
  }, [enabled, connect]);

  function _sendImmediate(ws: WebSocket, buffer: ArrayBuffer, mimeType: string): void {
    // Send all bytes as a single binary frame — WAV blobs from a ~10s utterance
    // are ~320 KB; single-frame send is fine (no need to chunk at this size).
    ws.send(buffer);
    ws.send(JSON.stringify({ type: 'end', mimeType }));
    setTranscribing(true);
    setTranscript(null);
  }

  const sendAudio = useCallback((buffer: ArrayBuffer, mimeType = 'audio/wav'): void => {
    const ws = connect();
    if (!ws) return;

    if (ws.readyState === WebSocket.OPEN) {
      _sendImmediate(ws, buffer, mimeType);
    } else {
      // Buffer until 'ready' message
      pendingBuffer.current = { buffer, mimeType };
    }
  }, [connect]);

  const abort = useCallback((): void => {
    pendingBuffer.current = null;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'abort' }));
    }
    setTranscribing(false);
  }, []);

  return { sendAudio, abort, transcript, transcribing, connected };
}

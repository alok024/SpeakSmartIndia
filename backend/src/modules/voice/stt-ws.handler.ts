/**
 * WebSocket STT handler.
 *
 * Provides a persistent WebSocket endpoint at /api/voice/stt-ws for audio
 * upload during live sessions. Compared to one-shot HTTP per utterance:
 *   - Eliminates TCP + TLS handshake per utterance (~80-150 ms on Railway → client)
 *   - Allows streaming audio frames before VAD fires (reduces latency from
 *     "user stops speaking" to "transcript appears")
 *   - Single auth check at connection open vs per-request auth overhead
 *
 * Protocol:
 *   Client → Server:
 *     Text frame:    JSON { type: 'auth', token: string } — required first frame
 *                    for connections that arrive without the auth cookie
 *                    (see "Auth" below). Ignored if the connection already
 *                    authenticated at upgrade time.
 *     Binary frames: raw audio bytes (WAV or WebM)
 *     Text frame:    JSON { type: 'end', mimeType: 'audio/wav' }  — triggers transcription
 *     Text frame:    JSON { type: 'ping' }  — keep-alive (server replies { type: 'pong' })
 *     Text frame:    JSON { type: 'abort' } — discard buffered audio, reset
 *
 *   Server → Client:
 *     { type: 'ready' }                           — sent once authenticated
 *     { type: 'transcript', text: string, provider: 'groq'|'sarvam' }
 *     { type: 'error', code: string, message: string }
 *     { type: 'pong' }
 *
 * Auth: two paths, both verifying the same access-token JWT used by the
 * HTTP endpoints.
 *   1. Browser clients: the `vachix_at` cookie rides along automatically on
 *      the upgrade request and is validated before the handshake completes.
 *   2. Non-browser clients (mobile, no cookie jar): the upgrade is allowed
 *      through unauthenticated, and the connection has AUTH_GRACE_MS to send
 *      { type: 'auth', token } as its first frame, carrying the same JWT a
 *      mobile client already holds from login (Authorization: Bearer flow).
 *      This keeps the token out of the URL — query-string tokens get
 *      logged in plaintext by proxies/load balancers.
 * Plan gate: Starter+ only — free users use the HTTP /api/voice/stt endpoint
 * with Web Speech API fallback.
 *
 * Connection lifecycle:
 *   - Auth grace period: 5s — connections that authenticate via path 2 above
 *     and don't send a valid `auth` frame in time are closed.
 *   - Idle timeout: 90s — server closes if no audio or ping received.
 *   - Max buffered audio: 25 MB — same limit as HTTP endpoint.
 *   - Max connection duration: 30 min (covers the longest interview session).
 *
 * Frame-type detection note: `ws` always hands the message handler a
 * Buffer regardless of whether the client sent a text or binary frame —
 * Buffer.isBuffer(data) is true either way. Binary vs text is read from
 * the message event's `isBinary` flag instead.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import cookie from 'cookie';
import jwt    from 'jsonwebtoken';
import { env } from '../../core/config/env';
import { logger } from '../../infra/logger';
import { ACCESS_COOKIE } from '../auth/cookies';
import {
  sttBreakerAvailable,
  sttBreakerSuccess,
  sttBreakerFailure,
} from '../../infra/groq-stt-breaker';
import { debitVoiceSeconds } from './voice.ledger';
import { recordVoiceLatency } from '../../infra/voice-latency';

const log = logger.child({ module: 'stt-ws' });

const AUTH_GRACE_MS       = 5_000;
const IDLE_TIMEOUT_MS     = 90_000;
const MAX_BUFFER_BYTES    = 25 * 1024 * 1024;
const MAX_CONNECTION_MS   = 30 * 60 * 1000;

interface JwtPayload { id: string; plan: string; email_verified?: boolean }

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

async function transcribeWithGroq(audioBlob: Blob, mimeType: string): Promise<string | null> {
  const form = new FormData();
  form.append('file', audioBlob, `audio.${mimeType === 'audio/wav' ? 'wav' : 'webm'}`);
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'json');
  form.append('language', 'en');

  try {
    const t0  = Date.now();
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(8_000),
    });
    recordVoiceLatency('stt', 'groq', Date.now() - t0);
    if (!res.ok) return null;
    const json = await res.json() as { text?: string };
    return json.text?.trim() ?? null;
  } catch {
    return null;
  }
}

async function transcribeWithSarvam(audioBlob: Blob): Promise<string | null> {
  if (!env.SARVAM_API_KEY) return null;
  const form = new FormData();
  form.append('file', audioBlob, 'audio.wav');
  form.append('model', 'saarika:v2.5');
  form.append('language_code', 'en-IN');

  try {
    const t0  = Date.now();
    const res = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': env.SARVAM_API_KEY },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    recordVoiceLatency('stt', 'sarvam', Date.now() - t0);
    if (!res.ok) return null;
    const json = await res.json() as { transcript?: string };
    return json.transcript?.trim() ?? null;
  } catch {
    return null;
  }
}

function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
  } catch {
    return null;
  }
}

function planGateOk(payload: JwtPayload): boolean {
  if (!payload.plan || payload.plan === 'free') return false;
  if (!payload.email_verified) return false;
  return true;
}

export function attachSttWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (req.url !== '/api/voice/stt-ws') return;

    // Auth, path 1: browser clients carry the cookie automatically.
    // No cookie at all means a non-browser client (mobile) — let the
    // upgrade through and require an `auth` frame instead (path 2,
    // handled in the 'connection' listener below). A *present but
    // invalid* cookie still gets rejected here, same as before.
    const cookies     = cookie.parse(req.headers.cookie ?? '');
    const cookieToken = cookies[ACCESS_COOKIE];

    let user: JwtPayload | null = null;
    if (cookieToken) {
      const payload = verifyToken(cookieToken);
      if (!payload) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      if (!planGateOk(payload)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      user = payload;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, user);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, initialUser: JwtPayload | null) => {
    let user = initialUser;
    let authTimer: ReturnType<typeof setTimeout> | null = null;

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let mimeType   = 'audio/wav';

    let idleTimer: ReturnType<typeof setTimeout>;
    let maxDurTimer: ReturnType<typeof setTimeout>;

    function resetIdle(): void {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => ws.close(1001, 'idle_timeout'), IDLE_TIMEOUT_MS);
    }

    function beginSession(authedUser: JwtPayload): void {
      user = authedUser;
      if (authTimer) {
        clearTimeout(authTimer);
        authTimer = null;
      }
      log.info('stt-ws: connection opened', { userId: user.id, plan: user.plan });
      idleTimer   = setTimeout(() => ws.close(1001, 'idle_timeout'), IDLE_TIMEOUT_MS);
      maxDurTimer = setTimeout(() => ws.close(1001, 'max_duration'), MAX_CONNECTION_MS);
      send(ws, { type: 'ready' });
    }

    if (user) {
      beginSession(user);
    } else {
      // Auth, path 2: no cookie arrived at upgrade time — give the client
      // AUTH_GRACE_MS to send { type: 'auth', token } as its first frame.
      authTimer = setTimeout(() => {
        ws.close(4001, 'auth_timeout');
      }, AUTH_GRACE_MS);
    }

    // NOTE: the `ws` library always delivers `data` as a Buffer, whether the
    // client sent a text or binary frame — Buffer.isBuffer(data) is true
    // either way and can't be used to tell them apart. The second callback
    // argument, `isBinary`, is the only reliable signal.
    ws.on('message', async (data: Buffer, isBinary: boolean) => {
      if (!user) {
        if (isBinary) {
          ws.close(4003, 'auth_required');
          return;
        }
        let authMsg: { type: string; token?: string };
        try {
          authMsg = JSON.parse(data.toString('utf8')) as { type: string; token?: string };
        } catch {
          ws.close(4003, 'auth_required');
          return;
        }
        if (authMsg.type !== 'auth' || !authMsg.token) {
          ws.close(4003, 'auth_required');
          return;
        }
        const payload = verifyToken(authMsg.token);
        if (!payload || !planGateOk(payload)) {
          ws.close(4003, 'auth_required');
          return;
        }
        beginSession(payload);
        return;
      }

      // Below this point `user` is set for the remainder of this message —
      // captured into a const so the await calls further down don't lose
      // the non-null narrowing on the outer `let`.
      const authedUser = user;
      resetIdle();

      if (isBinary) {
        // Binary frame: audio bytes
        totalBytes += data.byteLength;
        if (totalBytes > MAX_BUFFER_BYTES) {
          send(ws, { type: 'error', code: 'buffer_overflow', message: 'Audio exceeds 25 MB limit.' });
          ws.close(1009, 'buffer_overflow');
          return;
        }
        chunks.push(data);
        return;
      }

      // Text frame: control message
      let msg: { type: string; mimeType?: string };
      try {
        msg = JSON.parse(data.toString('utf8')) as { type: string; mimeType?: string };
      } catch {
        send(ws, { type: 'error', code: 'bad_frame', message: 'Expected JSON text frame.' });
        return;
      }

      if (msg.type === 'ping') {
        send(ws, { type: 'pong' });
        return;
      }

      if (msg.type === 'abort') {
        chunks.length = 0;
        totalBytes    = 0;
        return;
      }

      if (msg.type === 'end') {
        if (msg.mimeType) mimeType = msg.mimeType;

        if (!chunks.length) {
          send(ws, { type: 'error', code: 'no_audio', message: 'No audio frames received.' });
          return;
        }

        const audioBuffer = Buffer.concat(chunks);
        const audioBlob   = new Blob([audioBuffer], { type: mimeType });
        const estDurSecs  = Math.max(1, Math.round(audioBuffer.byteLength / 32_000));

        // Reset buffer for next utterance (connection reuse)
        chunks.length = 0;
        totalBytes    = 0;

        // Transcribe via circuit-breaker chain
        let transcript: string | null = null;
        let provider: 'groq' | 'sarvam' = 'groq';

        if (sttBreakerAvailable()) {
          transcript = await transcribeWithGroq(audioBlob, mimeType);
          if (transcript !== null) {
            sttBreakerSuccess();
          } else {
            sttBreakerFailure();
            provider   = 'sarvam';
            transcript = await transcribeWithSarvam(audioBlob);
          }
        } else {
          provider   = 'sarvam';
          transcript = await transcribeWithSarvam(audioBlob);
        }

        if (!transcript) {
          send(ws, { type: 'error', code: 'stt_failed', message: 'Speech recognition failed.' });
          return;
        }

        // Debit quota fire-and-forget
        debitVoiceSeconds(authedUser.id, estDurSecs, 'voice');

        log.info('stt-ws: transcript', { provider, chars: transcript.length, estDurSecs });
        send(ws, { type: 'transcript', text: transcript, provider });
        return;
      }

      send(ws, { type: 'error', code: 'unknown_type', message: `Unknown frame type: ${msg.type}` });
    });

    ws.on('close', (code, reason) => {
      clearTimeout(idleTimer);
      clearTimeout(maxDurTimer);
      if (authTimer) clearTimeout(authTimer);
      log.info('stt-ws: connection closed', {
        userId: user?.id ?? null,
        code,
        reason: reason.toString(),
      });
    });

    ws.on('error', (err) => {
      log.warn('stt-ws: socket error', { userId: user?.id ?? null, error: err.message });
    });
  });

  log.info('stt-ws: WebSocket handler attached at /api/voice/stt-ws');
}

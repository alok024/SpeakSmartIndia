/**
 * Persistent HTTPS agents for outbound API calls.
 *
 * Node's default `fetch` (undici) opens a new TCP connection per request
 * unless keep-alive is configured. On Railway (Singapore/US-West) → Sarvam
 * (Mumbai) and → Groq (US), TLS negotiation alone costs 80–150 ms per cold
 * connection. A persistent agent reuses connections across requests, dropping
 * that overhead to ~0 ms after the first request in a dyno lifetime.
 *
 * These agents are module-level singletons — one per process, shared across
 * all concurrent requests. Node's built-in https.Agent is thread-safe for
 * concurrent use; undici pools are also concurrent-safe by design.
 *
 * Usage:
 *   import { sarvamAgent, groqAgent } from '../../infra/http-agents';
 *   // Pass as `dispatcher` in undici / node-fetch, or as `agent` in node-https.
 *   // For the global `fetch` (undici in Node 18+), set via setGlobalDispatcher
 *   // per-domain OR pass dispatcher inline in fetch options.
 */

import https from 'https';

/**
 * Keep-alive agent for Sarvam API (api.sarvam.ai).
 *
 * maxSockets: 8 — Sarvam's TTS endpoint is the most latency-sensitive
 *   call in the voice pipeline. 8 concurrent sockets handles the expected
 *   peak of ~5-8 concurrent sessions without stalling on socket exhaustion.
 * maxFreeSockets: 4 — idle sockets kept warm. Sarvam's server-side
 *   keep-alive timeout is ~75s; 30s here leaves headroom.
 * keepAliveMsecs: 15_000 — TCP keep-alive probe interval (not HTTP idle
 *   timeout). Keeps the OS from tearing the connection down under a
 *   NAT gateway after 30 s of silence.
 */
export const sarvamAgent = new https.Agent({
  keepAlive:       true,
  maxSockets:      8,
  maxFreeSockets:  4,
  keepAliveMsecs:  15_000,
  timeout:         12_000,
});

/**
 * Keep-alive agent for Groq API (api.groq.com).
 *
 * Groq hosts in US-West; Railway Singapore adds ~180 ms RTT baseline.
 * Keep-alive eliminates the TLS round-trip on subsequent STT calls within
 * the same dyno lifetime. maxSockets=4 matches expected STT concurrency
 * (one per active session, typically 1-3 at Indian peak hours).
 */
export const groqAgent = new https.Agent({
  keepAlive:       true,
  maxSockets:      4,
  maxFreeSockets:  2,
  keepAliveMsecs:  15_000,
  timeout:         10_000,
});

/**
 * Keep-alive agent for ElevenLabs API (api.elevenlabs.io).
 * Used as TTS fallback when Sarvam circuit breaker is open.
 */
export const elevenLabsAgent = new https.Agent({
  keepAlive:       true,
  maxSockets:      4,
  maxFreeSockets:  2,
  keepAliveMsecs:  15_000,
  timeout:         12_000,
});

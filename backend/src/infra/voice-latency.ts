/**
 * Voice pipeline latency tracker.
 *
 * Collects per-provider latency samples for STT and TTS calls and exposes
 * p50/p95/p99 percentiles via getVoiceLatencyStats(). Plugged into
 * /health/metrics so Phase 2 benchmarking has a live dashboard.
 *
 * Design:
 *   - In-process only (no Redis) — per-dyno stats, which is exactly what
 *     you want for latency debugging (instance-level, not aggregate).
 *   - Circular buffer of the last MAX_SAMPLES samples per bucket to bound
 *     memory. At 10 RPS peak for 5 min = 3000 calls; 500 samples is a
 *     representative trailing window without eating heap.
 *   - All arithmetic is integer milliseconds — no float accumulation drift.
 *
 * Usage:
 *   import { recordVoiceLatency, getVoiceLatencyStats } from '../../infra/voice-latency';
 *
 *   const t0 = Date.now();
 *   await callSarvamTTS(…);
 *   recordVoiceLatency('tts', 'sarvam', Date.now() - t0);
 */

const MAX_SAMPLES = 500;

type Provider = 'groq' | 'sarvam' | 'elevenlabs' | 'web_speech';
type CallType  = 'tts' | 'stt';
type BucketKey = `${CallType}:${Provider}`;

interface Sample { ms: number; ts: number }

const buckets = new Map<BucketKey, Sample[]>();

function getBucket(key: BucketKey): Sample[] {
  let buf = buckets.get(key);
  if (!buf) {
    buf = [];
    buckets.set(key, buf);
  }
  return buf;
}

export function recordVoiceLatency(type: CallType, provider: Provider, ms: number): void {
  const buf = getBucket(`${type}:${provider}`);
  if (buf.length >= MAX_SAMPLES) buf.shift();
  buf.push({ ms, ts: Date.now() });
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

interface BucketStats {
  count:  number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  min_ms: number;
  max_ms: number;
}

export function getVoiceLatencyStats(): Record<string, BucketStats> {
  const out: Record<string, BucketStats> = {};

  for (const [key, samples] of buckets) {
    if (!samples.length) continue;
    const sorted = samples.map(s => s.ms).sort((a, b) => a - b);
    out[key] = {
      count:  sorted.length,
      p50_ms: percentile(sorted, 50),
      p95_ms: percentile(sorted, 95),
      p99_ms: percentile(sorted, 99),
      min_ms: sorted[0],
      max_ms: sorted[sorted.length - 1],
    };
  }

  return out;
}

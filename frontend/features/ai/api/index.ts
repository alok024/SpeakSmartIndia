/**
 * features/ai/api/index.ts
 *
 * HTTP calls for the AI chat proxy.
 *
 * `stream` bypasses `apiCall` deliberately — it returns the raw fetch
 * `Response` so callers can read the body as a stream, which a
 * JSON-parsing wrapper would defeat.
 */
import { apiCall } from '@/lib/api';
import type { AIPayload, AICallResponse } from '../types';

export const aiApi = {
  call: (payload: AIPayload) =>
    apiCall<AICallResponse>('/ai', 'POST', payload),

  stream: (payload: Omit<AIPayload, 'free'>): Promise<Response> =>
    fetch('/api/ai/stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
};

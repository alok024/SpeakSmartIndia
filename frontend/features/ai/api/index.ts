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

  // "Stuck? Get a hint" — must NOT count against a free user's session
  // quota, since it's a mid-session nudge, not a full AI call. The
  // backend's quota gate (checkUsageLimit) is wired per-ROUTE, not via
  // a body flag (see ai.routes.ts's comment on the /free route for why
  // a body-level `free: true` doesn't actually skip the quota check) —
  // so this hits /api/ai/free directly rather than going through
  // aiApi.call(), which always posts to /api/ai.
  hint: (payload: Omit<AIPayload, 'free'>) =>
    apiCall<AICallResponse>('/ai/free', 'POST', payload),
};

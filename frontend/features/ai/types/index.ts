/**
 * features/ai/types/index.ts
 *
 * Types for the AI chat proxy. Shared across features that talk to the
 * AI endpoints — currently the interview chat mode (Aria) and the English
 * practice coach (Elara).
 */

/** POST /api/ai and /api/ai/stream request body */
export interface AIPayload {
  messages:    { role: string; content: string }[];
  max_tokens?: number;
  topic?:      string;
  free?:       boolean;
  /**
   * when set, the backend reuses the assembled system prompt
   * (memory + weak-area + adaptive + onboarding context) for every call
   * sharing this id, instead of rebuilding it from 4 DB reads each time.
   * Pass the same id for every AI call within one interview/practice
   * session — e.g. the session's `clientSessionId` — and a fresh one
   * per new session. Omit for one-off calls with no session concept.
   */
  session_id?: string;
}

/** POST /api/ai success body */
export interface AICallResponse {
  text: string;
}

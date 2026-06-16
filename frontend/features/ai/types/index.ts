/**
 * features/ai/types/index.ts
 *
 * Types for the AI chat proxy. Shared across features that talk to the
 * AI endpoints — currently the interview chat mode and the English
 * practice coach (Elara).
 */

/** POST /api/ai and /api/ai/stream request body */
export interface AIPayload {
  messages:    { role: string; content: string }[];
  max_tokens?: number;
  topic?:      string;
  free?:       boolean;
}

/** POST /api/ai success body */
export interface AICallResponse {
  text: string;
}

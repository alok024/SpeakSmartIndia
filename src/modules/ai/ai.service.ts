import { env }                                        from '../../core/config/env';
import { aiLogger }                                   from '../../infra/logger';
import { groqBreaker, openaiBreaker }                 from '../../infra/circuit-breaker';
import { getCachedAIResponse, setCachedAIResponse, CacheContext } from '../../infra/ai-cache';
import { withAISlot }                                 from '../../infra/ai-limiter';
import { increment }                                  from '../../infra/observability';

// ── Types ─────────────────────────────────────────────────────────

export interface AIMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  text:     string;
  provider: 'groq' | 'openai_fallback';
  cached?:  boolean;
}

// ── Raw provider calls ────────────────────────────────────────────

async function callGroqRaw(messages: AIMessage[], maxTokens: number): Promise<string> {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:      'llama-3.3-70b-versatile',
      max_tokens: maxTokens,
      messages,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const data = await res.json() as {
    choices?: { message: { content: string } }[];
    error?:   { message: string };
  };

  if (!res.ok) throw new Error(`Groq error ${res.status}: ${data.error?.message ?? 'Unknown'}`);
  return data.choices?.[0]?.message?.content ?? '';
}

async function callOpenAIRaw(messages: AIMessage[], maxTokens: number): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new Error('OpenAI fallback not configured');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model:      'gpt-4o-mini',
      max_tokens: maxTokens,
      messages,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const data = await res.json() as {
    choices?: { message: { content: string } }[];
    error?:   { message: string };
  };

  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${data.error?.message ?? 'Unknown'}`);
  return data.choices?.[0]?.message?.content ?? '';
}

// ── Main: cache → limiter → circuit breaker → provider ───────────

export async function callAI(
  messages:  AIMessage[],
  maxTokens = 1024,
  options:   { cacheable?: boolean; cacheCtx?: CacheContext } = {}
): Promise<AIResponse> {
  const { cacheable = true, cacheCtx = {} } = options;

  increment('ai.calls.total');

  // 1. Cache check
  if (cacheable) {
    const cached = await getCachedAIResponse(messages, cacheCtx);
    if (cached) {
      increment('ai.calls.cached');
      aiLogger.debug('Serving AI response from cache');
      return { ...cached, cached: true };
    }
  }

  // 2. Concurrency gate (sync — caller awaits)
  return withAISlot(async () => {

    // 3a. Groq + circuit breaker
    try {
      const text = await groqBreaker.run(() => callGroqRaw(messages, maxTokens));
      increment('ai.calls.groq');
      aiLogger.debug('Groq response received', { maxTokens });

      const response: AIResponse = { text, provider: 'groq' };
      if (cacheable) await setCachedAIResponse(messages, response, cacheCtx);
      return response;

    } catch (groqErr) {
      const isOpen = (groqErr as { code?: string }).code === 'CIRCUIT_OPEN';
      if (isOpen) increment('ai.circuit.groq_open');
      aiLogger.warn(
        isOpen ? 'Groq circuit OPEN — skipping to fallback' : 'Groq failed, trying OpenAI',
        { error: (groqErr as Error).message }
      );
    }

    // 3b. OpenAI fallback + circuit breaker
    try {
      const text = await openaiBreaker.run(() => callOpenAIRaw(messages, maxTokens));
      increment('ai.calls.openai');
      aiLogger.info('OpenAI fallback used');

      const response: AIResponse = { text, provider: 'openai_fallback' };
      if (cacheable) await setCachedAIResponse(messages, response, cacheCtx);
      return response;

    } catch (openaiErr) {
      const isOpen = (openaiErr as { code?: string }).code === 'CIRCUIT_OPEN';
      if (isOpen) increment('ai.circuit.openai_open');
      increment('ai.calls.failed');
      aiLogger.error('Both AI providers failed', { error: (openaiErr as Error).message });

      throw Object.assign(
        new Error('AI service temporarily unavailable. Please try again in a moment.'),
        { statusCode: 503, retryAfterSeconds: 30 }
      );
    }
  });
}

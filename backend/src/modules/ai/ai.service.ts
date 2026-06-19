import { AppError, AIUnavailableError } from '../../core/utils/errors';
import { env }                                        from '../../core/config/env';
import { aiLogger }                                   from '../../infra/logger';
import { groqBreaker, openaiBreaker }                 from '../../infra/circuit-breaker';
import { getCachedAIResponse, setCachedAIResponse, CacheContext } from '../../infra/ai-cache';
import { withAISlot }                                 from '../../infra/ai-limiter';
import { increment }                                  from '../../infra/observability';

// Types

export interface AIMessage {
  role:    'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  text:     string;
  provider: 'groq' | 'openai_fallback';
  cached?:  boolean;
}

// Raw provider calls

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

  const aiResponsePayload = await res.json() as {
    choices?: { message: { content: string } }[];
    error?:   { message: string };
  };

  if (!res.ok) throw new AppError(502, 'groq_error', `Groq error ${res.status}: ${aiResponsePayload.error?.message ?? 'Unknown'}`);
  return aiResponsePayload.choices?.[0]?.message?.content ?? '';
}

async function callOpenAIRaw(messages: AIMessage[], maxTokens: number): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new AppError(503, 'openai_not_configured', 'OpenAI fallback not configured');

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

  const openaiResponsePayload = await res.json() as {
    choices?: { message: { content: string } }[];
    error?:   { message: string };
  };

  if (!res.ok) throw new AppError(502, 'openai_error', `OpenAI error ${res.status}: ${openaiResponsePayload.error?.message ?? 'Unknown'}`);
  return openaiResponsePayload.choices?.[0]?.message?.content ?? '';
}

// Streaming (real-time token-by-token)
//
// Streams tokens as they arrive from Groq (OpenAI-compatible SSE),
// falling back to OpenAI streaming if Groq fails before any token
// was emitted. `onToken` is called for every text delta as it arrives —
// this is real incremental output, not a buffered batch response.

async function* streamProviderRaw(
  url: string,
  apiKey: string,
  model: string,
  messages: AIMessage[],
  maxTokens: number,
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages, stream: true }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new AppError(502, 'stream_error', `Stream error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;

      try {
        const json  = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        // ignore malformed/partial SSE fragments
      }
    }
  }
}

export interface StreamResult {
  provider: 'groq' | 'openai_fallback';
  fullText: string;
}

/**
 * Real-time streaming AI call. Pushes each token chunk to `onToken`
 * the instant it arrives from the provider. Falls back to OpenAI
 * (also streamed) if Groq's circuit is open or fails pre-first-token.
 */
export async function streamAI(
  messages:  AIMessage[],
  onToken:   (chunk: string) => void,
  maxTokens = 1024,
): Promise<StreamResult> {
  return withAISlot(async () => {
    // 1. Groq stream
    if (groqBreaker.isAvailable()) {
      let fullText = '';
      let gotFirstToken = false;
      try {
        for await (const chunk of streamProviderRaw(
          'https://api.groq.com/openai/v1/chat/completions',
          env.GROQ_API_KEY, 'llama-3.3-70b-versatile', messages, maxTokens,
        )) {
          gotFirstToken = true;
          fullText += chunk;
          onToken(chunk);
        }
        groqBreaker.reportSuccess();
        increment('ai.calls.groq');
        increment('ai.stream.groq');
        return { provider: 'groq', fullText };
      } catch (err) {
        groqBreaker.reportFailure();
        aiLogger.warn('Groq stream failed', {
          error: (err as Error).message, gotFirstToken,
        });
        if (gotFirstToken) return { provider: 'groq', fullText };
      }
    } else {
      increment('ai.circuit.groq_open');
    }

    // 2. OpenAI fallback stream
    if (!env.OPENAI_API_KEY || !openaiBreaker.isAvailable()) {
      if (!env.OPENAI_API_KEY) { /* noop, fall through to throw */ }
      else increment('ai.circuit.openai_open');
      throw new AIUnavailableError(30);
    }

    let fullText = '';
    try {
      for await (const chunk of streamProviderRaw(
        'https://api.openai.com/v1/chat/completions',
        env.OPENAI_API_KEY, 'gpt-4o-mini', messages, maxTokens,
      )) {
        fullText += chunk;
        onToken(chunk);
      }
      openaiBreaker.reportSuccess();
      increment('ai.calls.openai');
      increment('ai.stream.openai');
      return { provider: 'openai_fallback', fullText };
    } catch (err) {
      openaiBreaker.reportFailure();
      increment('ai.calls.failed');
      throw new AIUnavailableError(30);
    }
  });
}

// Main: cache → limiter → circuit breaker → provider

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

      throw new AIUnavailableError(30);
    }
  });
}

/**
 * agentFetch — drop-in replacement for `fetch` that accepts an https.Agent
 * for connection reuse (keep-alive).
 *
 * Node 18-22's built-in `fetch` (undici) does not expose a way to pass a
 * custom `https.Agent` without importing undici directly and using its own
 * `Agent` class. Rather than adding undici as an explicit dependency (it
 * ships with Node but isn't a declared peer dep), this thin wrapper uses
 * Node's `https.request` — which natively accepts an `https.Agent` — and
 * presents the same async interface as `fetch` for the subset we use:
 *   ok, status, json(), arrayBuffer(), text()
 *
 * Only used for outbound API calls where keep-alive matters (Sarvam, Groq,
 * ElevenLabs). All other `fetch` calls use the global built-in.
 */

import https from 'https';
import http  from 'http';
import { URL } from 'url';

interface AgentFetchInit {
  method?:  string;
  headers?: Record<string, string>;
  body?:    string | Buffer | FormData;
  agent?:   https.Agent | http.Agent;
  signal?:  AbortSignal;
}

interface AgentFetchResponse {
  ok:      boolean;
  status:  number;
  json:    <T = unknown>() => Promise<T>;
  text:    () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export function agentFetch(url: string, init: AgentFetchInit = {}): Promise<AgentFetchResponse> {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const isHttps = parsed.protocol === 'https:';

    let bodyBuffer: Buffer | undefined;
    let contentType: string | undefined;

    if (init.body instanceof FormData) {
      // FormData → let the native fetch handle it (we never use agentFetch
      // with FormData; Groq STT uses the global fetch directly).
      reject(new Error('agentFetch: FormData body not supported — use global fetch'));
      return;
    } else if (typeof init.body === 'string') {
      bodyBuffer   = Buffer.from(init.body, 'utf-8');
      contentType  = 'application/json';
    } else if (Buffer.isBuffer(init.body)) {
      bodyBuffer = init.body;
    }

    const headers: Record<string, string> = { ...init.headers };
    if (bodyBuffer) {
      headers['Content-Length'] = String(bodyBuffer.byteLength);
      if (!headers['Content-Type'] && contentType) {
        headers['Content-Type'] = contentType;
      }
    }

    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   (init.method ?? 'GET').toUpperCase(),
      headers,
      agent:    init.agent,
    };

    const transport = isHttps ? https : http;

    const req = transport.request(options, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw    = Buffer.concat(chunks);
        const status = res.statusCode ?? 0;
        const ok     = status >= 200 && status < 300;

        resolve({
          ok,
          status,
          json: <T>() => {
            try {
              return Promise.resolve(JSON.parse(raw.toString('utf-8')) as T);
            } catch (e) {
              return Promise.reject(new Error(`agentFetch: JSON parse error — ${(e as Error).message}`));
            }
          },
          text:        () => Promise.resolve(raw.toString('utf-8')),
          arrayBuffer: () => Promise.resolve(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer),
        });
      });

      res.on('error', reject);
    });

    req.on('error', reject);

    if (init.signal) {
      init.signal.addEventListener('abort', () => {
        req.destroy(new Error('Request aborted'));
      });
    }

    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

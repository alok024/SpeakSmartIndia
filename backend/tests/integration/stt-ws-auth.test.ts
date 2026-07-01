/**
 * stt-ws.handler auth — integration tests
 *
 * Covers the production bug fix (cookie name mismatch meant every browser
 * connection was rejected) and the new mobile auth path (no cookie at
 * upgrade time → first-message `{ type: 'auth', token }` frame).
 *
 * Spins up a bare http.Server with only attachSttWebSocket wired in —
 * no Express app needed, since the handler attaches directly to the
 * server's 'upgrade' event.
 */

import http from 'http';
import jwt  from 'jsonwebtoken';
import WebSocket from 'ws';
import { attachSttWebSocket } from '../../src/modules/voice/stt-ws.handler';

const JWT_SECRET = 'test-secret-at-least-32-chars-long-here'; // matches tests/.env.test

function signToken(overrides: Partial<{ id: string; plan: string; email_verified: boolean }> = {}): string {
  return jwt.sign(
    { id: 'user-1', plan: 'pro', email_verified: true, jti: 'jti-1', ...overrides },
    JWT_SECRET,
    { expiresIn: '30m' },
  );
}

let server: http.Server;
let port: number;

beforeAll((done) => {
  server = http.createServer();
  attachSttWebSocket(server);
  server.listen(0, () => {
    port = (server.address() as { port: number }).port;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

describe('stt-ws — browser (cookie) auth path', () => {
  it('accepts a connection carrying the real vachix_at cookie', (done) => {
    const token = signToken();
    const ws = new WebSocket(`ws://localhost:${port}/api/voice/stt-ws`, {
      headers: { Cookie: `vachix_at=${token}` },
    });

    ws.once('message', (data) => {
      const msg = JSON.parse(data.toString());
      expect(msg.type).toBe('ready');
      ws.close();
      done();
    });

    ws.once('error', done);
  });

  it('rejects a connection with an invalid vachix_at cookie', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/voice/stt-ws`, {
      headers: { Cookie: 'vachix_at=not-a-real-jwt' },
    });

    ws.once('unexpected-response', (_req, res) => {
      expect(res.statusCode).toBe(401);
      done();
    });
    ws.once('open', () => done(new Error('connection should not have opened')));
  });

  it('rejects a verified-but-free-plan user with 403', (done) => {
    const token = signToken({ plan: 'free' });
    const ws = new WebSocket(`ws://localhost:${port}/api/voice/stt-ws`, {
      headers: { Cookie: `vachix_at=${token}` },
    });

    ws.once('unexpected-response', (_req, res) => {
      expect(res.statusCode).toBe(403);
      done();
    });
    ws.once('open', () => done(new Error('connection should not have opened')));
  });

  it('a cookie under the old "access_token" name is ignored, not treated as auth', (done) => {
    // Regression guard for the original bug: the handler must key off
    // ACCESS_COOKIE ('vachix_at'), not the stale 'access_token' literal.
    // An unrecognised cookie name should fall through to the no-cookie
    // (mobile) path rather than silently authenticating.
    const token = signToken();
    const ws = new WebSocket(`ws://localhost:${port}/api/voice/stt-ws`, {
      headers: { Cookie: `access_token=${token}` },
    });

    let gotReadyBeforeAuth = false;
    ws.once('message', () => { gotReadyBeforeAuth = true; });

    ws.once('open', () => {
      setTimeout(() => {
        expect(gotReadyBeforeAuth).toBe(false);
        ws.close();
        done();
      }, 100);
    });
  });
});

describe('stt-ws — mobile (first-message) auth path', () => {
  it('authenticates a cookie-less connection via an auth frame', (done) => {
    const token = signToken();
    const ws = new WebSocket(`ws://localhost:${port}/api/voice/stt-ws`);

    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    });

    ws.once('message', (data) => {
      const msg = JSON.parse(data.toString());
      expect(msg.type).toBe('ready');
      ws.close();
      done();
    });

    ws.once('error', done);
  });

  it('closes with 4003 when the first frame is not a valid auth frame', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/voice/stt-ws`);

    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    ws.once('close', (code) => {
      expect(code).toBe(4003);
      done();
    });
  });

  it('closes with 4003 when the auth token is invalid', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/voice/stt-ws`);

    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'garbage' }));
    });

    ws.once('close', (code) => {
      expect(code).toBe(4003);
      done();
    });
  });

  it('closes with 4003 when the first frame is binary instead of an auth frame', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/voice/stt-ws`);

    ws.once('open', () => {
      ws.send(Buffer.from([1, 2, 3]));
    });

    ws.once('close', (code) => {
      expect(code).toBe(4003);
      done();
    });
  });

  it('closes with 4001 when no auth frame arrives within the grace period', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/api/voice/stt-ws`);

    ws.once('close', (code) => {
      expect(code).toBe(4001);
      done();
    });
  }, 10_000);
});

describe('stt-ws — post-auth frame parsing', () => {
  // Regression test: `ws` always delivers `data` as a Buffer for both text
  // and binary frames, so a JSON control frame sent over the wire must
  // still be recognised as text (via the isBinary flag) rather than
  // silently swallowed into the audio buffer.
  it('replies to a ping control frame with pong instead of buffering it as audio', (done) => {
    const token = signToken();
    const ws = new WebSocket(`ws://localhost:${port}/api/voice/stt-ws`, {
      headers: { Cookie: `vachix_at=${token}` },
    });

    ws.once('message', () => {
      // First message is 'ready' — now send a ping and expect 'pong' back.
      ws.once('message', (data) => {
        const msg = JSON.parse(data.toString());
        expect(msg.type).toBe('pong');
        ws.close();
        done();
      });
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    ws.once('error', done);
  });
});

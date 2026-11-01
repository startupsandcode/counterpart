import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHandler, createApp } from '../src/server.mjs';

function request(handler, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST'; req.url = '/api/answer'; req.headers = { host: '127.0.0.1:4750', 'content-type': 'application/json' };
  const listeners = new Map();
  const res = {
    status: 0, text: '', writableEnded: false, destroyed: false,
    writeHead(status) { this.status = status; },
    end(value) { this.text = String(value); this.writableEnded = true; },
    on(event, listener) { listeners.set(event, listener); },
    close() { this.destroyed = true; listeners.get('close')?.(); },
  };
  return { res, done: handler(req, res) };
}

test('server rejects a second inference and frees the slot after cancellation', async () => {
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  let signal;
  let calls = 0;
  const service = { answer: async (_body, current) => {
    if (++calls > 1) return { text: 'ready' };
    signal = current; started();
    await new Promise((_resolve, reject) => current.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } };
  const handler = createHandler(service);
  const first = request(handler, { question: 'one' });
  await ready;
  const second = request(handler, { question: 'two' });
  await second.done;
  assert.equal(second.res.status, 429);
  first.res.close();
  await first.done;
  assert.equal(signal.aborted, true);
  const third = request(handler, { question: 'three' });
  await third.done;
  assert.equal(third.res.status, 200);
});

test('BYOK availability is local-only and can be disabled by configuration', async () => {
  const local = await createApp({ env: { COUNTERPART_MODEL: 'sample' } });
  const disabled = await createApp({ env: { COUNTERPART_MODEL: 'sample', COUNTERPART_ALLOW_CLOUD_BYOK: 'false' } });
  const hosted = await createApp({ env: { COUNTERPART_MODEL: 'sample', VERCEL: '1' } });
  assert.equal(local.status().cloudByokAvailable, true);
  assert.equal(disabled.status().cloudByokAvailable, false);
  assert.equal(hosted.status().cloudByokAvailable, false);
});

test('server timeout aborts a stalled answer and releases its slot', async () => {
  let calls = 0;
  const service = { answer: async (_body, signal) => {
    if (++calls > 1) return { text: 'ready' };
    await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Answer timed out.')), { once: true }));
  } };
  const handler = createHandler(service, undefined, { answerTimeoutMs: 10 });
  const first = request(handler, { question: 'one' });
  await first.done;
  assert.equal(first.res.status, 503);
  const next = request(handler, { question: 'two' });
  await next.done;
  assert.equal(next.res.status, 200);
});

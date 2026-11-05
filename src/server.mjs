import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalProvider } from './provider.mjs';
import { createOpenAIProvider } from './openai.mjs';
import { createChatService, ChatError } from './service.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const MAX_BODY = 100_000;

export function createHandler(service, publicRoot = path.join(ROOT, 'public'), { answerTimeoutMs = 100_000 } = {}) {
  let answerActive = false;
  return async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    try {
      if (!['127.0.0.1', 'localhost'].includes(String(req.headers.host || '').replace(/:\d+$/, ''))) return send(403, { error: 'Local host only.' });
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        const content = await readFile(path.join(publicRoot, file));
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        return res.end(content);
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return send(200, service.status());
      if (req.method === 'GET' && url.pathname === '/api/personas') return send(200, service.personas());
      if (req.method === 'GET' && url.pathname === '/api/models') return send(200, { models: await service.models() });
      if (req.method === 'POST' && url.pathname === '/api/openai-models') {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'JSON required.' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > MAX_BODY) return send(413, { error: 'Request too large.' });
        }
        let data;
        try { data = JSON.parse(body); } catch { return send(400, { error: 'Invalid JSON.' }); }
        if (!service.status().cloudByokAvailable) return send(403, { error: 'OpenAI mode is unavailable.' });
        return send(200, { models: await service.openAIModels(data?.apiKey) });
      }
      if (req.method === 'POST' && url.pathname === '/api/answer') {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'JSON required.' });
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > MAX_BODY) return send(413, { error: 'Request too large.' });
        }
        let data;
        try { data = JSON.parse(body); } catch { return send(400, { error: 'Invalid JSON.' }); }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return send(400, { error: 'JSON object required.' });
        if (answerActive) return send(429, { error: 'Another answer is running. Try again when it finishes.' });
        answerActive = true;
        const controller = new AbortController();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        try { return send(200, await service.answer(data, AbortSignal.any([controller.signal, AbortSignal.timeout(answerTimeoutMs)]))); }
        finally { answerActive = false; }
      }
      return send(404, { error: 'Not found.' });
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) send(error instanceof ChatError ? error.status : 503, { error: error.message });
    }
  };
}

export async function createApp({ root = ROOT, env = process.env } = {}) {
  const config = JSON.parse(await readFile(path.join(root, 'personas/mira.json'), 'utf8'));
  const provider = createLocalProvider({ endpoint: env.COUNTERPART_LOCAL_API_URL || undefined, model: env.COUNTERPART_MODEL || '' });
  const cloudByokAvailable = !env.VERCEL && env.COUNTERPART_ALLOW_CLOUD_BYOK !== 'false';
  return createChatService({ personas: [config], knowledgeRoot: root, provider, cloudProvider: cloudByokAvailable ? createOpenAIProvider() : undefined, cloudByokAvailable });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  const port = Number(process.env.PORT || 4750);
  http.createServer(createHandler(app)).listen(port, '127.0.0.1', () => console.log(`Counterpart Kit: http://127.0.0.1:${port}/`));
}

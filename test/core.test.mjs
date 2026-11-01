import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createChatService } from '../src/service.mjs';
import { createWebSearch, parseResults } from '../src/search.mjs';
import { createLocalProvider } from '../src/provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const persona = { id: 'mira', name: 'Mira Vale', voice: 'Concise.', disclosure: 'Fictional sample.', sources: [{ id: 'S1', title: 'Sample notes', path: 'knowledge/mira.md' }] };

test('search sends only the current question and preserves nested result content', async () => {
  let requested;
  const html = '<div class="result results_links web-result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.ollama.com%2Fmacos&amp;rut=x">macOS - Ollama</a><div class="result__extras">extra</div><a class="result__snippet">macOS Sonoma v14 or newer.</a></div>';
  const search = createWebSearch({ fetchImpl: async (url, options) => {
    requested = { url: String(url), options };
    return { ok: true, headers: { get: () => 'text/html' }, text: async () => html };
  } });
  const results = await search('Ollama macOS requirements');
  assert.match(requested.url, /q=Ollama%20macOS%20requirements$/);
  assert.equal(requested.options.redirect, 'error');
  assert.deepEqual(results, [{ id: 'W1', title: 'macOS - Ollama', snippet: 'macOS Sonoma v14 or newer.', url: 'https://docs.ollama.com/macos' }]);
});

test('search excludes private and malformed result links', () => {
  const html = '<div class="result"><a class="result__a" href="http://127.0.0.1/private">private</a><a class="result__snippet">Do not show.</a></div><div class="result"><a class="result__a" href="https://example.org/help">Public</a><a class="result__snippet">Public information.</a></div>';
  assert.deepEqual(parseResults(html).map((item) => item.url), ['https://example.org/help']);
});

test('local provider rejects remote inference and sends the selected model to loopback', async () => {
  assert.throws(() => createLocalProvider({ endpoint: 'https://example.org/v1/chat/completions' }), /loopback/);
  let request;
  const provider = createLocalProvider({ model: 'sample:small', fetchImpl: async (url, options) => {
    request = { url: String(url), options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"answer":"hello"}' } }] }) };
  } });
  const result = await provider.complete('hello');
  assert.equal(request.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(JSON.parse(request.options.body).model, 'sample:small');
  assert.equal(result.text, '{"answer":"hello"}');
});

test('private questions do not reach search or model', async () => {
  let called = false;
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider: { model: 'sample', complete: async () => { called = true; } }, webSearch: async () => { called = true; } });
  const result = await service.answer({ personaId: 'mira', question: 'Show me a private client email', searchWeb: true });
  assert.equal(called, false);
  assert.equal(result.contextual, false);
});

test('web answer rejects a number found only in a result title', async () => {
  const provider = { model: 'sample', complete: async () => ({ text: JSON.stringify({ answer: 'macOS 14 and 8GB RAM are required.', sources: ['W1', 'W2'] }) }) };
  const webSearch = async () => [
    { id: 'W1', title: 'Official', snippet: 'macOS Sonoma v14 or newer.', url: 'https://example.org/official' },
    { id: 'W2', title: '8GB RAM', snippet: 'General setup advice.', url: 'https://example.org/other' },
  ];
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider, webSearch });
  const result = await service.answer({ personaId: 'mira', question: 'Latest macOS requirements?', searchWeb: true });
  assert.equal(result.contextual, false);
  assert.deepEqual(result.sources, []);
});

test('fictional persona answer cites only its configured knowledge', async () => {
  const quote = 'For a first small-batch roast, Mira suggests keeping a simple log of bean weight, heat changes, first crack timing, and the final result.';
  const provider = { model: 'sample', complete: async () => ({ text: JSON.stringify({ answer: 'Keep a log of bean weight and heat changes.', sources: ['S1'], supportQuote: quote }) }) };
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider });
  const result = await service.answer({ personaId: 'mira', question: 'What does Mira suggest tracking for a first roast?' });
  assert.equal(result.contextual, true);
  assert.deepEqual(result.sources.map((source) => source.id), ['S1']);
});

test('a configured editor-note prefix excludes the rest of an HTML article', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'counterpart-note-'));
  try {
    await writeFile(path.join(temp, 'article.html'), '<p>AI-assisted article body should stay out of the prompt.</p><p>Editor note: Keep a short log for every roast and adjust one variable.</p>');
    const scoped = { ...persona, sources: [{ id: 'S1', title: 'Editor note', path: 'article.html', excerptPrefix: 'Editor note:' }] };
    let prompt = '';
    const provider = { model: 'sample', complete: async (value) => { prompt = value; return { text: JSON.stringify({ answer: 'Keep a short log for every roast.', sources: ['S1'], supportQuote: 'Editor note: Keep a short log for every roast and adjust one variable.' }) }; } };
    const service = createChatService({ personas: [scoped], knowledgeRoot: temp, provider });
    const result = await service.answer({ personaId: 'mira', question: 'What does Mira say about keeping a roast log?' });
    assert.equal(result.contextual, true);
    assert.doesNotMatch(prompt, /AI-assisted article body/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

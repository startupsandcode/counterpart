import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createChatService } from '../src/service.mjs';
import { createWebSearch, createOfficialPageReader, parseResults } from '../src/search.mjs';
import { createLocalProvider } from '../src/provider.mjs';
import { createOpenAIProvider } from '../src/openai.mjs';

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

test('local provider lists models through the compatible v1 endpoint', async () => {
  let requested;
  const provider = createLocalProvider({ fetchImpl: async (url) => {
    requested = String(url);
    return { ok: true, json: async () => ({ data: [{ id: 'qwen3:8b' }] }) };
  } });
  assert.deepEqual(await provider.models(), ['qwen3:8b']);
  assert.equal(requested, 'http://127.0.0.1:11434/v1/models');
});

test('private questions do not reach search or model', async () => {
  let called = false;
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider: { model: 'sample', complete: async () => { called = true; } }, webSearch: async () => { called = true; } });
  const result = await service.answer({ personaId: 'mira', question: 'Show me a private client email', searchWeb: true });
  assert.equal(called, false);
  assert.equal(result.contextual, false);
});

test('sensitive history, phone numbers, and cross-persona history never reach providers', async () => {
  let called = false;
  const service = createChatService({ personas: [persona, { ...persona, id: 'other', name: 'Other Sample' }], knowledgeRoot: root,
    provider: { model: 'sample', complete: async () => { called = true; } }, webSearch: async () => { called = true; }, cloudProvider: { complete: async () => { called = true; } }, cloudByokAvailable: true });
  const phone = await service.answer({ personaId: 'mira', question: 'Call me at 212-555-0123', searchWeb: true });
  assert.equal(phone.contextual, false);
  const emailHistory = await service.answer({ personaId: 'mira', question: 'How do I start?', messages: [{ personaId: 'mira', role: 'user', text: 'Email me at jane@example.com' }], provider: 'openai', cloudConsent: true, apiKey: 'test-secret-key', modelId: 'test-model' });
  assert.equal(emailHistory.contextual, false);
  await assert.rejects(service.answer({ personaId: 'other', question: 'How do I start?', messages: [{ personaId: 'mira', role: 'assistant', text: 'A prior answer' }] }), /history is invalid/i);
  assert.equal(called, false);
});

test('identity and commitment requests return safely before inference', async () => {
  let called = false;
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider: { model: 'sample', complete: async () => { called = true; } } });
  const identity = await service.answer({ personaId: 'mira', question: 'Are you really Mira?' });
  const promise = await service.answer({ personaId: 'mira', question: 'Will Mira meet me tomorrow?' });
  assert.match(identity.text, /Fictional sample/);
  assert.match(promise.text, /cannot make commitments/i);
  assert.equal(called, false);
});

test('a persona citation cannot support an unrelated attributed achievement', async () => {
  const provider = { model: 'sample', complete: async () => ({ text: JSON.stringify({ answer: 'Mira won a roasting championship.', sources: ['S1'], supportQuote: 'For a first small-batch roast, Mira suggests keeping a simple log of bean weight, heat changes, first crack timing, and the final result.' }) }) };
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider });
  const result = await service.answer({ personaId: 'mira', question: 'What did Mira win?' });
  assert.equal(result.contextual, false);
});

test('BYOK requires per-answer consent, stays request scoped, and never falls back to local', async () => {
  let localCalled = false;
  let cloudRequest;
  const provider = { model: 'sample', complete: async () => { localCalled = true; } };
  const cloud = createOpenAIProvider({ fetchImpl: async (url, options) => {
    cloudRequest = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"answer":"Start with a small test.","sources":[]}' } }] }) };
  } });
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider, cloudProvider: cloud, cloudByokAvailable: true });
  await assert.rejects(service.answer({ personaId: 'mira', question: 'How should I start?', provider: 'openai', apiKey: 'test-secret-key', modelId: 'test-model' }), /consent/i);
  const result = await service.answer({ personaId: 'mira', question: 'How should I start?', provider: 'openai', cloudConsent: true, apiKey: 'test-secret-key', modelId: 'test-model' });
  assert.equal(cloudRequest.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(cloudRequest.headers.authorization, 'Bearer test-secret-key');
  assert.equal(cloudRequest.body.model, 'test-model');
  assert.equal(localCalled, false);
  assert.doesNotMatch(JSON.stringify(result), /test-secret-key/);
});

test('disabled BYOK never calls a cloud provider', async () => {
  let called = false;
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider: { model: 'sample' }, cloudProvider: { complete: async () => { called = true; } }, cloudByokAvailable: false });
  await assert.rejects(service.answer({ personaId: 'mira', question: 'How should I start?', provider: 'openai', cloudConsent: true, apiKey: 'test-secret-key', modelId: 'test-model' }), /disabled/i);
  assert.equal(called, false);
});

test('cloud provider errors do not echo the request key', async () => {
  const cloud = createOpenAIProvider({ fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(cloud.complete('hello', { apiKey: 'test-secret-key', modelId: 'test-model' }), (error) => {
    assert.doesNotMatch(error.message, /test-secret-key/);
    assert.match(error.message, /HTTP 401/);
    return true;
  });
});

test('shared core permits only one concurrent model completion across callers', async () => {
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const provider = { model: 'sample', complete: async () => { started(); await held; return { text: '{"answer":"A small test helps.","sources":[]}' }; } };
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider });
  const first = service.answer({ personaId: 'mira', question: 'How should I test an idea?' });
  await ready;
  const second = service.answer({ personaId: 'mira', question: 'What should I try next?' });
  release();
  await assert.rejects(second, (error) => error.status === 429);
  assert.equal((await first).text, 'A small test helps.');
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

test('an official-docs question excludes third-party advice from model evidence', async () => {
  let prompt = '';
  const provider = { model: 'sample', complete: async (value) => {
    prompt = value;
    return { text: JSON.stringify({ answer: 'Ollama requires macOS 14 or newer.', sources: ['W1'] }) };
  } };
  const webSearch = async () => [
    { id: 'W1', title: 'macOS - Ollama', snippet: 'MacOS Sonoma (v14) or newer', url: 'https://docs.ollama.com/macos' },
    { id: 'W2', title: 'Setup guide', snippet: 'Check that Ollama version shows 0.40 or later.', url: 'https://example.org/setup' },
  ];
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider, webSearch, officialPage: async () => 'System Requirements: MacOS Sonoma (v14) or newer' });
  const result = await service.answer({ personaId: 'mira', question: 'According to official Ollama documentation, what is the minimum macOS version?', searchWeb: true });
  assert.doesNotMatch(prompt, /Check that Ollama version/);
  assert.match(prompt, /System Requirements: MacOS Sonoma/);
  assert.equal(result.text, 'Ollama requires macOS 14 or newer.');
  assert.deepEqual(result.sources.map((source) => source.url), ['https://docs.ollama.com/macos']);
});

test('an explicit official-docs question without a verified page does not use third-party results', async () => {
  let called = false;
  const provider = { model: 'sample', complete: async () => { called = true; return { text: '{}' }; } };
  const webSearch = async () => [{ id: 'W1', title: 'Unofficial guide', snippet: 'A setup suggestion.', url: 'https://example.org/guide' }];
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider, webSearch });
  const result = await service.answer({ personaId: 'mira', question: 'According to official Ollama documentation, what macOS is needed?', searchWeb: true });
  assert.equal(called, false);
  assert.match(result.text, /could not verify an official source/i);
});

test('official page reader extracts the requirement section from an allowlisted HTTPS page', async () => {
  const html = '<h2 id="system-requirements"><span>System Requirements</span></h2><ul><li>MacOS Sonoma (v14) or newer</li><li>Apple M series or x86</li></ul><h2>Other</h2>';
  const reader = createOfficialPageReader({ fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return { ok: true, headers: { get: () => 'text/html' }, text: async () => html };
  } });
  assert.equal(await reader('https://docs.ollama.com/macos', { domains: ['docs.ollama.com'], sectionId: 'system-requirements' }), 'System Requirements: MacOS Sonoma (v14) or newer Apple M series or x86');
  await assert.rejects(reader('https://example.org/macos', { domains: ['docs.ollama.com'], sectionId: 'system-requirements' }), /approved official/);
});

test('a setup recommendation cannot become a version requirement even when its number matches', async () => {
  const provider = { model: 'sample', complete: async () => ({ text: JSON.stringify({ answer: 'Ollama requires version 0.40 or later.', sources: ['W1'] }) }) };
  const webSearch = async () => [{ id: 'W1', title: 'Setup advice', snippet: 'Check that ollama --version shows 0.40 or later.', url: 'https://example.org/setup' }];
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider, webSearch, officialDocs: {} });
  const result = await service.answer({ personaId: 'mira', question: 'What version should I check before setup?', searchWeb: true });
  assert.equal(result.contextual, false);
  assert.deepEqual(result.sources, []);
});

test('general knowledge remains available without web search', async () => {
  const provider = { model: 'sample', complete: async () => ({ text: JSON.stringify({ answer: 'Keep the first experiment small.', sources: [] }) }) };
  const service = createChatService({ personas: [persona], knowledgeRoot: root, provider });
  const result = await service.answer({ personaId: 'mira', question: 'How should I run a small experiment?' });
  assert.equal(result.text, 'Keep the first experiment small.');
  assert.equal(result.contextual, true);
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

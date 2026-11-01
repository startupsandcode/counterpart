function loopbackEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/v1/chat/completions') {
    throw new Error('Model endpoint must be an HTTP loopback /v1/chat/completions URL.');
  }
  return url;
}

export function createLocalProvider({ endpoint = 'http://127.0.0.1:11434/v1/chat/completions', model = '', fetchImpl = fetch, timeoutMs = 90_000 } = {}) {
  const url = loopbackEndpoint(endpoint);
  async function models() {
    const response = await fetchImpl(new URL('/api/tags', url), { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Local model list returned HTTP ${response.status}.`);
    const data = await response.json();
    return (data.models || []).map((item) => item.name).filter((name) => typeof name === 'string');
  }
  async function complete(prompt, { modelId = model, signal } = {}) {
    if (!modelId) throw new Error('Select a local model first.');
    const response = await fetchImpl(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: prompt }], stream: false, reasoning_effort: 'none' }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Local model returned HTTP ${response.status}.`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('Local model returned no answer.');
    return { text: text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim(), model: modelId };
  }
  return { models, complete, model, endpoint: url.href };
}

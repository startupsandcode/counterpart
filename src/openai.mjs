export function createOpenAIProvider({ fetchImpl = fetch, timeoutMs = 90_000 } = {}) {
  return {
    async complete(prompt, { apiKey, modelId, signal } = {}) {
      if (typeof apiKey !== 'string' || apiKey.trim().length < 8 || apiKey.length > 512) throw new Error('Enter a valid API key for this answer.');
      if (typeof modelId !== 'string' || !/^[\w][\w.:/-]{0,99}$/.test(modelId)) throw new Error('Enter a valid OpenAI model ID.');
      let response;
      try {
        response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: modelId, messages: [
            { role: 'system', content: 'Follow the supplied persona and evidence instructions. Never act as the person.' },
            { role: 'user', content: prompt },
          ], temperature: 0.2, max_tokens: 700, stream: false }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (signal?.aborted) throw new Error('The answer was cancelled.');
        throw new Error(error.name === 'TimeoutError' ? 'OpenAI request timed out.' : 'Could not reach OpenAI.');
      }
      if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}. Check the key, model, and account.`);
      let body;
      try { body = await response.json(); } catch { throw new Error('OpenAI returned an unreadable response.'); }
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('OpenAI returned no answer.');
      return { text: text.slice(0, 8000), model: body.model || modelId };
    },
  };
}

export function createOpenAIProvider({ fetchImpl = fetch, timeoutMs = 90_000 } = {}) {
  return {
    async complete(prompt, { apiKey, modelId, signal } = {}) {
      if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 512 || /\s/.test(apiKey)) throw new Error('Enter a valid API key for this answer.');
      if (typeof modelId !== 'string' || !/^[\w][\w.:/-]{0,99}$/.test(modelId)) throw new Error('Enter a valid OpenAI model ID.');
      let response;
      const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      try {
        response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: modelId, messages: [
            { role: 'system', content: 'Follow the supplied persona and evidence instructions. Never act as the person.' },
            { role: 'user', content: prompt },
          ], max_completion_tokens: 4096, store: false, stream: false }),
          signal: requestSignal,
        });
      } catch (error) {
        if (signal?.aborted) throw new Error('The answer was cancelled.');
        throw new Error(requestSignal.aborted || error.name === 'TimeoutError' ? 'OpenAI request timed out.' : 'Could not reach OpenAI.');
      }
      if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}. Check the key, model, and account.`);
      let body;
      try { body = await response.json(); } catch {
        if (signal?.aborted) throw new Error('The answer was cancelled.');
        if (requestSignal.aborted) throw new Error('OpenAI request timed out.');
        throw new Error('OpenAI returned an unreadable response.');
      }
      if (body?.choices?.[0]?.finish_reason === 'length') throw new Error('OpenAI stopped at the token limit before finishing the answer.');
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('OpenAI returned no answer.');
      return { text: text.slice(0, 8000), model: body.model || modelId };
    },
  };
}

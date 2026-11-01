const MAX_HTML = 1_000_000;

function plain(value) {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
}

function publicUrl(raw) {
  try {
    const candidate = new URL(raw.replace(/&amp;/gi, '&'), 'https://html.duckduckgo.com');
    const url = new URL(candidate.searchParams.get('uddg') || candidate.href);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
      || host.includes(':') || /^\d+$/.test(host)
      || /^(?:0|10|127|169\.254|192\.168)\./.test(host)
      || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
      || /^100\.(?:6[4-9]|[78]\d|9\d|1[01]\d|12[0-7])\./.test(host)) return null;
    return url.href;
  } catch { return null; }
}

export function parseResults(html) {
  const blocks = String(html).match(/<div[^>]+class=["'](?:[^"']*\s)?result(?:\s[^"']*)?["'][^>]*>[\s\S]*?(?=<div[^>]+class=["'](?:[^"']*\s)?result(?:\s[^"']*)?["']|$)/gi) || [];
  const results = [];
  for (const block of blocks) {
    const anchor = block.match(/<a[^>]+class=["']result__a["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const snippet = block.match(/<(?:a|div)[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    if (!anchor || !snippet) continue;
    const url = publicUrl(anchor[1]);
    const title = plain(anchor[2]).slice(0, 200);
    const excerpt = plain(snippet[1]).slice(0, 600);
    if (!url || !title || !excerpt) continue;
    results.push({ id: `W${results.length + 1}`, title, snippet: excerpt, url });
    if (results.length === 5) break;
  }
  return results;
}

export function createWebSearch({ fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  return async (question, signal) => {
    const query = String(question).trim().replace(/\s+/g, ' ').slice(0, 240);
    if (!query) return [];
    const response = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'user-agent': 'CounterpartKit/0.1' }, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Web search returned HTTP ${response.status}.`);
    if (!/^text\/html\b/i.test(response.headers?.get?.('content-type') || 'text/html')) throw new Error('Web search did not return HTML.');
    if (Number(response.headers?.get?.('content-length')) > MAX_HTML) throw new Error('Web search response was too large.');
    let html = '';
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_HTML) { await reader.cancel(); throw new Error('Web search response was too large.'); }
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } else {
      html = await response.text();
      if (html.length > MAX_HTML) throw new Error('Web search response was too large.');
    }
    return parseResults(html);
  };
}

export function createOfficialPageReader({ fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  return async (rawUrl, { domains, sectionId }) => {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash
      || !domains.includes(url.hostname.toLowerCase())) throw new Error('URL is not an approved official page.');
    if (!/^[a-z0-9-]+$/.test(sectionId)) throw new Error('Official section is invalid.');
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Official page returned HTTP ${response.status}.`);
    if (!/^text\/html\b/i.test(response.headers?.get?.('content-type') || '')) throw new Error('Official page did not return HTML.');
    if (Number(response.headers?.get?.('content-length')) > MAX_HTML) throw new Error('Official page was too large.');
    let html = '';
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_HTML) { await reader.cancel(); throw new Error('Official page was too large.'); }
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } else {
      html = await response.text();
      if (html.length > MAX_HTML) throw new Error('Official page was too large.');
    }
    const heading = html.match(new RegExp(`<h2[^>]*id=["']${sectionId}["'][^>]*>[\\s\\S]*?<\\/h2>\\s*<ul[^>]*>([\\s\\S]*?)<\\/ul>`, 'i'));
    if (!heading) throw new Error('Approved official page has no matching requirements section.');
    return `${sectionId.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')}: ${plain(heading[1])}`.slice(0, 3000);
  };
}

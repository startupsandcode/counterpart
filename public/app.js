const model = document.querySelector('#model');
const status = document.querySelector('#model-status');
const messages = document.querySelector('#messages');
const sources = document.querySelector('#sources');
const form = document.querySelector('#ask');
const question = document.querySelector('#question');
const search = document.querySelector('#search');
const mode = document.querySelector('#mode');
const openaiOption = document.querySelector('#openai-option');
const cloud = document.querySelector('#cloud');
const cloudModel = document.querySelector('#cloud-model');
const cloudKey = document.querySelector('#cloud-key');
const send = document.querySelector('#send');
const cancel = document.querySelector('#cancel');
const newChat = document.querySelector('#new-chat');
let personaId = '';
let history = [];
let busy = false;
let activeRequest;

question.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    if (!busy) form.requestSubmit(send);
  }
});

mode.addEventListener('change', () => {
  cloud.hidden = mode.value !== 'openai';
  if (mode.value !== 'openai') cloudKey.value = '';
  if (busy) activeRequest?.abort();
});
cancel.addEventListener('click', () => { cloudKey.value = ''; activeRequest?.abort(); });
newChat.addEventListener('click', () => {
  cloudKey.value = '';
  activeRequest?.abort();
  history = [];
  question.value = '';
  messages.replaceChildren();
  message('intro', 'Ask a general question or ask about Mira\'s sample roasting notes.');
  sources.replaceChildren();
});
window.addEventListener('beforeunload', () => { cloudKey.value = ''; activeRequest?.abort(); });

function message(role, text) {
  const item = document.createElement('p');
  item.className = role;
  item.textContent = text;
  messages.append(item);
  item.scrollIntoView({ block: 'nearest' });
  return item;
}

async function boot() {
  try {
    const [people, runtime] = await Promise.all([
      fetch('/api/personas').then((r) => r.json()), fetch('/api/status').then((r) => r.json()),
    ]);
    personaId = people[0].id;
    document.querySelector('#disclosure').textContent = people[0].disclosure;
    openaiOption.disabled = runtime.cloudByokAvailable !== true;
    let available;
    try { available = await fetch('/api/models').then((response) => { if (!response.ok) throw new Error('Local model is offline.'); return response.json(); }); }
    catch { available = { models: [] }; }
    model.replaceChildren();
    for (const id of available.models || []) {
      const option = document.createElement('option'); option.value = id; option.textContent = id; model.append(option);
    }
    if (runtime.model) model.value = runtime.model;
    status.textContent = model.value ? `Local model: ${model.value}` : 'No local model found. Start Ollama or select BYOK.';
  } catch (error) { status.textContent = `Local model unavailable: ${error.message}`; }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !personaId || !question.value.trim()) return;
  const selectedProvider = mode.value;
  const apiKey = selectedProvider === 'openai' ? cloudKey.value : '';
  const modelId = selectedProvider === 'openai' ? cloudModel.value.trim() : model.value;
  if (selectedProvider === 'openai') {
    if (openaiOption.disabled || !apiKey || !modelId) { status.textContent = 'Enter your OpenAI model ID and API key for this answer.'; return; }
    if (!window.confirm('Send this question, persona instructions, source excerpts, and relevant chat history to OpenAI for one answer?')) { cloudKey.value = ''; return; }
  } else if (!modelId) { status.textContent = 'Select a local model first.'; return; }
  busy = true;
  send.disabled = true;
  cancel.hidden = false;
  const controller = new AbortController();
  activeRequest = controller;
  cloudKey.value = '';
  const text = question.value.trim();
  question.value = '';
  message('user', text);
  const pending = message('assistant', 'Thinking…');
  try {
    const response = await fetch('/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId, question: text, messages: history.slice(-8), modelId, provider: selectedProvider, searchWeb: search.checked, ...(selectedProvider === 'openai' ? { apiKey, cloudConsent: true } : {}) }), signal: controller.signal });
    const result = await response.json();
    if (controller.signal.aborted) return;
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    pending.textContent = result.text;
    sources.replaceChildren();
    if (!result.sources?.length) { const empty = document.createElement('p'); empty.textContent = 'No cited source.'; sources.append(empty); }
    for (const source of result.sources || []) {
      const item = document.createElement('p');
      item.textContent = `${source.id}: ${source.title}${source.authorship ? ` (${source.authorship})` : ''} `;
      if (source.url && /^https?:\/\//.test(source.url)) { const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open source'; item.append(link); }
      sources.append(item);
    }
    history.push({ personaId, role: 'user', text }, { personaId, role: 'assistant', text: result.text });
  } catch (error) { pending.textContent = error.name === 'AbortError' ? 'Answer cancelled.' : error.message; }
  finally { cloudKey.value = ''; activeRequest = undefined; busy = false; send.disabled = false; cancel.hidden = true; }
});

boot();

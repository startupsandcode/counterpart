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
const localModelField = document.querySelector('#local-model-field');
const cloudModel = document.querySelector('#cloud-model');
const cloudKey = document.querySelector('#cloud-key');
const loadCloudModels = document.querySelector('#load-cloud-models');
const cloudModelStatus = document.querySelector('#cloud-model-status');
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
  const cloudMode = mode.value === 'openai';
  cloud.hidden = !cloudMode;
  localModelField.hidden = cloudMode;
  status.hidden = cloudMode;
  if (mode.value !== 'openai') {
    cloudKey.value = '';
    cloudModel.replaceChildren(new Option('Load models using your API key', ''));
    cloudModel.disabled = true;
    cloudModelStatus.textContent = 'Model choices are fetched using your key and cleared when you leave Cloud mode.';
  }
  if (busy) activeRequest?.abort();
});
loadCloudModels.addEventListener('click', async () => {
  const apiKey = cloudKey.value;
  if (!apiKey) { cloudModelStatus.textContent = 'Enter your OpenAI API key first.'; return; }
  loadCloudModels.disabled = true;
  cloudModelStatus.textContent = 'Loading models…';
  try {
    const response = await fetch('/api/openai-models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey }) });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 404) throw new Error('Model loading is not enabled in the running server. Restart Counterpart, then try again.');
      throw new Error(result.error || `HTTP ${response.status}`);
    }
    cloudModel.replaceChildren();
    for (const id of result.models || []) cloudModel.append(new Option(id, id));
    cloudModel.disabled = !result.models?.length;
    if (result.models?.length) {
      const preferred = result.models.find((id) => id === 'chat-latest') || result.models.find((id) => /^gpt-(6|5)/i.test(id)) || result.models[0];
      cloudModel.value = preferred;
      cloudModelStatus.textContent = `${result.models.length} models available to this API key.`;
    } else {
      cloudModel.append(new Option('No compatible chat models found', ''));
      cloudModelStatus.textContent = 'No compatible chat models were returned for this API key.';
    }
  } catch (error) {
    cloudModel.replaceChildren(new Option('Could not load models', ''));
    cloudModel.disabled = true;
    cloudModelStatus.textContent = error.message;
  } finally { loadCloudModels.disabled = false; }
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

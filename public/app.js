const model = document.querySelector('#model');
const status = document.querySelector('#model-status');
const messages = document.querySelector('#messages');
const sources = document.querySelector('#sources');
const form = document.querySelector('#ask');
const question = document.querySelector('#question');
const search = document.querySelector('#search');
let personaId = '';
let history = [];
let busy = false;

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
    const [people, runtime, available] = await Promise.all([
      fetch('/api/personas').then((r) => r.json()), fetch('/api/status').then((r) => r.json()),
      fetch('/api/models').then((r) => r.json()),
    ]);
    personaId = people[0].id;
    document.querySelector('#disclosure').textContent = people[0].disclosure;
    model.replaceChildren();
    for (const id of available.models || []) {
      const option = document.createElement('option'); option.value = id; option.textContent = id; model.append(option);
    }
    if (runtime.model) model.value = runtime.model;
    status.textContent = model.value ? `Ready to use ${model.value}` : 'No local model found. Start Ollama and download a model.';
  } catch (error) { status.textContent = `Local model unavailable: ${error.message}`; }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !personaId || !question.value.trim()) return;
  busy = true;
  const text = question.value.trim();
  question.value = '';
  message('user', text);
  const pending = message('assistant', 'Thinking…');
  try {
    const response = await fetch('/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ personaId, question: text, messages: history.slice(-8), modelId: model.value, searchWeb: search.checked }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    pending.textContent = result.text;
    sources.replaceChildren();
    if (!result.sources?.length) { const empty = document.createElement('p'); empty.textContent = 'No cited source.'; sources.append(empty); }
    for (const source of result.sources || []) {
      const item = document.createElement('p'); item.textContent = `${source.id}: ${source.title} (${source.authorship}) `;
      if (source.url && /^https?:\/\//.test(source.url)) { const link = document.createElement('a'); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open source'; item.append(link); }
      sources.append(item);
    }
    if (result.contextual) history.push({ personaId, role: 'user', text }, { personaId, role: 'assistant', text: result.text });
  } catch (error) { pending.textContent = error.message; }
  finally { busy = false; }
});

boot();

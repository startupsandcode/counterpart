import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

class Element {
  constructor() { this.value = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.checked = false; this.children = []; this.listeners = new Map(); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  dispatch(name) { return this.listeners.get(name)?.({ preventDefault() {} }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  scrollIntoView() {}
}

async function loadUi(answer, { confirm = () => true } = {}) {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const code = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const ids = ['model', 'model-status', 'messages', 'sources', 'ask', 'question', 'search', 'mode', 'openai-option', 'cloud', 'cloud-model', 'cloud-key', 'send', 'cancel', 'new-chat', 'disclosure'];
  const elements = new Map(ids.map((id) => [id, new Element()]));
  elements.get('mode').value = 'local';
  const document = { querySelector: (selector) => elements.get(selector.slice(1)), createElement: () => new Element() };
  const requests = [];
  const fetch = async (url, options) => {
    if (url === '/api/personas') return { ok: true, json: async () => [{ id: 'mira', disclosure: 'Mira is fictional.' }] };
    if (url === '/api/status') return { ok: true, json: async () => ({ cloudByokAvailable: true, model: '' }) };
    if (url === '/api/models') return { ok: true, json: async () => ({ models: [] }) };
    requests.push({ body: JSON.parse(options.body), keyInForm: elements.get('cloud-key').value, signal: options.signal });
    return answer(url, options);
  };
  runInNewContext(code, { document, window: { confirm, addEventListener() {} }, fetch, AbortController });
  await new Promise((resolve) => setImmediate(resolve));
  return { html, elements, requests };
}

test('BYOK clears its key before sending and new chat removes prior conversation context', async () => {
  const ui = await loadUi(async () => ({ ok: true, json: async () => ({ text: 'Try one small roast.', sources: [], contextual: true }) }));
  assert.match(ui.html, /id="new-chat"/);
  assert.match(ui.html, /Local mode uses your local model server; optional OpenAI mode sends the disclosed request to OpenAI/);
  const get = (id) => ui.elements.get(id);
  get('mode').value = 'openai';
  get('mode').dispatch('change');
  get('cloud-model').value = 'test-model';
  get('cloud-key').value = 'test-secret-key';
  get('question').value = 'What should I try?';
  await get('ask').dispatch('submit');
  assert.equal(ui.requests[0].body.provider, 'openai');
  assert.equal(ui.requests[0].body.apiKey, 'test-secret-key');
  assert.equal(ui.requests[0].keyInForm, '');
  get('cloud-key').value = 'test-secret-key';
  get('question').value = 'What next?';
  await get('ask').dispatch('submit');
  assert.equal(ui.requests[1].body.messages.length, 2);
  get('cloud-key').value = 'unsent-test-key';
  get('mode').value = 'local';
  get('mode').dispatch('change');
  assert.equal(get('cloud-key').value, '');
  get('mode').value = 'openai';
  get('mode').dispatch('change');
  get('cloud-key').value = 'unsent-test-key';
  get('new-chat').dispatch('click');
  assert.equal(get('cloud-key').value, '');
  assert.equal(get('question').value, '');
  get('cloud-key').value = 'test-secret-key';
  get('question').value = 'Start over?';
  await get('ask').dispatch('submit');
  assert.equal(ui.requests[2].body.messages.length, 0);
});

test('cancelling an in-flight cloud answer clears the key and does not save that turn', async () => {
  const ui = await loadUi((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  const get = (id) => ui.elements.get(id);
  get('mode').value = 'openai';
  get('mode').dispatch('change');
  get('cloud-model').value = 'test-model';
  get('cloud-key').value = 'test-secret-key';
  get('question').value = 'Should I cancel?';
  const pending = get('ask').dispatch('submit');
  get('cancel').dispatch('click');
  assert.equal(get('cloud-key').value, '');
  await pending;
  assert.equal(get('messages').children.at(-1).textContent, 'Answer cancelled.');
  assert.equal(get('send').disabled, false);
});

test('declining cloud consent clears the key and makes no answer request', async () => {
  const ui = await loadUi(async () => { throw new Error('answer request must not run'); }, { confirm: () => false });
  const get = (id) => ui.elements.get(id);
  get('mode').value = 'openai';
  get('mode').dispatch('change');
  get('cloud-model').value = 'test-model';
  get('cloud-key').value = 'test-secret-key';
  get('question').value = 'A public question';
  await get('ask').dispatch('submit');
  assert.equal(ui.requests.length, 0);
  assert.equal(get('cloud-key').value, '');
  assert.equal(get('question').value, 'A public question');
});

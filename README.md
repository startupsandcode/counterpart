# Counterpart

A local-first prototype for building an AI counterpart from an explicit persona and a short allowlist of knowledge files. It includes only Mira Vale, a fictional coffee-roasting sample. It does not include a real person's corpus, credentials, or chat logs.

## Quick start

1. Clone this repository. Install Node.js 22.13 or newer and [Ollama](https://ollama.com/). Start Ollama on your computer.
2. Choose and download a model that fits your computer, for example `ollama pull qwen3:8b`. Downloads are user-initiated; this project does not pull a model automatically.
3. In this directory, run `COUNTERPART_MODEL=qwen3:8b npm start` (macOS/Linux) or set `$env:COUNTERPART_MODEL = 'qwen3:8b'` in PowerShell and run `npm start` (Windows).
4. Open `http://127.0.0.1:4750/`.

No `npm install` is needed: the app uses Node's built-in modules. Run `npm test` for its local tests. The model endpoint defaults to Ollama's `http://127.0.0.1:11434/v1/chat/completions`. Set `COUNTERPART_LOCAL_API_URL` to another **HTTP loopback** compatible endpoint if needed. The app binds its own server to `127.0.0.1` only. Ollama and its model are separate downloads; the repository does not bundle either one.

## Configure a persona

Edit `personas/mira.json` and its allowlisted file in `knowledge/`, or supply other persona objects to `createChatService` in your own local adapter. Each persona has `id`, `name`, `identity`, `disclosure`, `domain`, `voice`, and a `sources` array with `id`, `title`, `path`, and `authorship`. Paths must resolve inside the configured knowledge root. The default server loads only the fictional sample; adding personas requires changing its configuration deliberately.

The selected provider receives the persona instructions, question, relevant source excerpts, and bounded conversation context. The app holds conversation context in browser memory only and does not save chats. Local inference is the default. For optional OpenAI BYOK on a local run, choose it in the UI, enter your own model ID and key, and confirm the disclosure **for each answer**. The key is sent with that request, cleared from the form afterward, and never returned in an answer. The question, persona instructions, excerpts, and recent conversation go to OpenAI for that request. There is no automatic cloud fallback. Set `COUNTERPART_ALLOW_CLOUD_BYOK=false` to disable the option; it is also disabled when `VERCEL` is set. No live cloud request has been tested. The local model runner and cloud provider may keep their own logs; check their settings if that matters to you.

The local server accepts one answer request at a time across browser tabs. A second request receives HTTP 429. Each answer has a 100-second server timeout; the UI can cancel its current request. Model and search calls also have their own bounded timeouts. This avoids concurrent model loads but is not a benchmark for a particular computer.

Web research is **off by default**. When checked, only the current question goes to DuckDuckGo's public HTML search endpoint. Persona instructions and prior conversation are excluded from the search request. For Ollama questions, if `docs.ollama.com` appears, the app fetches its public macOS requirements page over HTTPS and uses the requirements section instead of third-party snippets. A question explicitly asking for official documentation declines to answer when no configured official page can be verified. The official page request sends its URL and normal network metadata to that site, not the question or chat history. Other search results are short, untrusted snippets and linked leads, not verified pages. Open a cited page before relying on a claim. The search parser can stop working if DuckDuckGo changes its HTML; it does not bypass access challenges.

The answer checks require a cited result, reject numbers absent from cited excerpts, and reject numeric requirements drawn only from setup advice. They do not prove that every sentence follows from its sources. Review answers and linked pages before relying on them; source-supported answer quality is still being evaluated.

## Prototype status

This is an early prototype, licensed under [MIT](LICENSE). The deterministic tests cover routing, privacy boundaries, source selection, consent, and cancellation. They do not measure answer quality. General web research relies on short search snippets and links; it does not verify arbitrary linked pages or prove that every answer follows from its sources. One configured Ollama documentation section can be fetched and checked as an example, but this is not a general page-reading pipeline. Search can fail if the third-party HTML changes or blocks requests. No live OpenAI BYOK call has been validated; cloud use requires your own key and may cost money. Review generated answers and open source links before relying on them.

# Counterpart Kit (local draft)

A small, local-first chat app for building an AI counterpart from an explicit persona and a short allowlist of knowledge files. This draft includes only Mira Vale, a fictional coffee-roasting sample. It does not contain anyone's private corpus, credentials, or chat logs.

## Quick start

1. Install Node.js 22.13 or newer and [Ollama](https://ollama.com/). Start Ollama on your computer.
2. Choose and download a model that fits your computer, for example `ollama pull qwen3:8b`. Downloads are user-initiated; this project does not pull a model automatically.
3. In this directory, run `COUNTERPART_MODEL=qwen3:8b npm start` (macOS/Linux) or set `COUNTERPART_MODEL` in PowerShell and run `npm start` (Windows).
4. Open `http://127.0.0.1:4750/`.

No `npm install` is needed: the app uses Node's built-in modules. Run `npm test` for its local tests. The model endpoint defaults to Ollama's `http://127.0.0.1:11434/v1/chat/completions`. Set `COUNTERPART_LOCAL_API_URL` to another **HTTP loopback** compatible endpoint if needed. The app binds its own server to `127.0.0.1` only.

## Configure a persona

Edit `personas/mira.json` and its allowlisted file in `knowledge/`, or supply other persona objects to `createChatService` in your own local adapter. Each persona has `id`, `name`, `identity`, `disclosure`, `domain`, `voice`, and a `sources` array with `id`, `title`, `path`, and `authorship`. Paths must resolve inside the configured knowledge root. The default server loads only the fictional sample; adding personas requires changing its configuration deliberately.

The model receives the selected persona instructions, question, and relevant source excerpts. The app holds conversation context in browser memory only. It does not save chats or call cloud inference. The local model runner may keep its own logs; check its settings if that matters to you.

Web research is **off by default**. When checked, only the current question goes to DuckDuckGo's public HTML search endpoint. Persona instructions and prior conversation are excluded from the search request. Search results are short, untrusted snippets and linked leads, not verified pages. Open a cited page before relying on a claim. The search parser can stop working if DuckDuckGo changes its HTML; it does not bypass access challenges.

The answer checks require a cited result and reject numbers absent from cited snippets. They do not prove that every sentence follows from its sources. Review answers and linked pages before relying on them; source-supported answer quality is still being evaluated.

This is a local review draft with no license selected yet. Do not publish it until you choose a license and review the export contents.

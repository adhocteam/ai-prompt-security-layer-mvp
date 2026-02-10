# AI Prompt Security Layer MVP

A client-side redaction tool that strips sensitive data — API keys, tokens, passwords — from text before it's sent to an LLM. All processing happens in the browser via WebAssembly, so secrets never leave your machine.

Paste text containing credentials into the input pane, configure marker-based redaction rules (Bearer headers, query params, JSON fields, etc.), and the tool replaces matched values with `[REDACTED]` instantly.

## Prerequisites

| Tool | Purpose | Install (macOS) |
|------|---------|-----------------|
| [Emscripten](https://emscripten.org/) (`em++`) | Compile C++ → WebAssembly | `brew install emscripten` |
| Python 3 | Local dev server | Included with macOS / `brew install python` |

## Build

Compile the redaction engine to WebAssembly:

```bash
em++ redact.cpp -O3 -I./vendor \
  -sWASM=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web \
  -sALLOW_MEMORY_GROWTH=1 --bind \
  -o public/redactor.mjs
```

This produces two files in `public/`: `redactor.mjs` (JS glue) and `redactor.wasm`.

### Native CLI build (optional)

You can also build a standalone CLI binary for piping text through:

```bash
g++ -std=c++17 -O2 -I./vendor redact.cpp -o redact
echo 'Authorization: Bearer s3cret' | ./redact
```

## Run locally

```bash
python3 -m http.server 8000 -d public
```

Then visit [http://localhost:8000](http://localhost:8000/).

## Frontend

Built with [Lemonade.js](https://lemonadejs.com/) — a lightweight reactive UI library with no build step or dependencies.

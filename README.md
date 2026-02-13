# AI Prompt Security Layer POC

Client-side redaction logic that strips sensitive data — API keys, tokens, passwords — from text before it's sent to an LLM.

Paste text containing credentials into the input pane, configure marker-based redaction rules (Bearer headers, query params, JSON fields, etc.), and the tool replaces matched values with `[REDACTED]` instantly.

## Features
* Runs entirely in the browser (client-side); nothing gets sent to a server
* Loads your C++ redaction engine compiled to WebAssembly (`redactor.wasm`) via `redactor.mjs`
* Lets a user build a redaction ruleset in a left-side “Rules” panel
* Supports rule types:

  * Bearer auth header redaction (`Authorization: Bearer …`)
  * Generic header value redaction (`Header-Name: …`)
  * Query parameter redaction (`api_key=…` with stop characters like `&`/whitespace)
  * JSON field redaction (`"token":"…"` stopped by the next quote)
  * Custom marker + mode rules (whitespace/char/set + optional max_len)
* Allows adding new rules and removing existing rules
* Generates a JSON representation of the current ruleset (`{ "rules": [...] }`)
* Optionally shows the generated rules JSON in an “Advanced” panel
* Can copy the rules JSON to the clipboard
* Provides an input text area where a user pastes logs/code to redact
* Produces a redacted output text area showing the result
* Clears the output whenever rules or input change, so the user doesn’t mistake stale output for current output
* Runs redaction on demand via a “Run” button (and also does an initial run after the WASM loads)
* Uses a simple marker-based algorithm: finds each marker, replaces the following value up to a stop condition with `[REDACTED]`
* Shows basic status messages (loading/OK/edited/error) in the UI


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

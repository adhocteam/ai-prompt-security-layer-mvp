## Build
Install em++
```
em++ redact.cpp -O3 -I./vendor \
  -sWASM=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web \
  -sALLOW_MEMORY_GROWTH=1 --bind \
  -o public/redactor.mjs
```

## Frontend
[Lemonade.js](https://lemonadejs.com/)

## Local
Clone the repo to your machine.
```
cd ai-prompt-security-layer-mvp
python3 -m http.server 8000 -d public
```
Then visit [localhost](http://localhost:8000/)

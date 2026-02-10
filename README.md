## Build

### Linux (g++)
```bash
g++ -O3 -std=c++20 -march=native redact.cpp -o redact
```
### Mac (clang++)
```bash
clang++ -O3 -std=c++20 redact.cpp -o redact
```
## Frontend
[Lemonade.js](https://lemonadejs.com/)

## Local
Clone the repo to your machine.
```
cd ai-prompt-security-layer-mvp
python3 -m http.server 8000 -d public
```
Then visit [localhost](http://localhost:8000/).

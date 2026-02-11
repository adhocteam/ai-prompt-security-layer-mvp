import createModule from "./redactor.mjs";

window.addEventListener("error", (e) => console.error("window error:", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => console.error("promise rejection:", e.reason));

const { onload } = lemonade;

function App() {
  this.mod = null;
  this.status = "Loading WASM…";

  this.rules = [
    { type: "bearer_header", header: "Authorization", key: "", marker: "", mode: "whitespace", stop_char: "", stop_set: "", max_len: 0 },
    { type: "header", header: "X-Api-Key", key: "", marker: "", mode: "whitespace", stop_char: "", stop_set: "", max_len: 0 },
    { type: "query_param", header: "", key: "api_key", marker: "", mode: "set", stop_char: "", stop_set: "& \t\r\n", max_len: 0 },
    { type: "json_field", header: "", key: "token", marker: "", mode: "char", stop_char: "\"", stop_set: "", max_len: 0 },
  ];

  // ---- gradient helpers + per-rule shading ----
  this.mix = (a, b, t) => Math.round(a + (b - a) * t);

  this.paintRuleBoxes = () => {
    // Run after Lemonade updates the DOM
    setTimeout(() => {
      const root = document.querySelector("#ruleList");
      if (!root) return;
      const els = root.querySelectorAll(".rule");
      for (let i = 0; i < els.length; i++) {
        const bg = (this.rules[i] && this.rules[i]._bg) ? this.rules[i]._bg : "#fff";
        els[i].style.backgroundColor = bg;
      }
    }, 0);
  };

  this.updateRuleShades = () => {
    const n = this.rules.length;

    // More obvious light gray -> white
    const start = { r: 232, g: 232, b: 232 };
    const end = { r: 255, g: 255, b: 255 };

    for (let i = 0; i < n; i++) {
      const t = n <= 1 ? 0 : i / (n - 1);
      const r = this.mix(start.r, end.r, t);
      const g = this.mix(start.g, end.g, t);
      const b = this.mix(start.b, end.b, t);
      this.rules[i]._bg = `rgb(${r}, ${g}, ${b})`;
    }

    this.paintRuleBoxes();
  };

  // initial shade
  this.updateRuleShades();

  this.input = `Authorization: Bearer abcdef123456
X-Api-Key: SUPERSECRET
api_key=SUPERSECRET&x=1
{"token":"tok_12345","other":"ok"}`;
  this.output = "";

  this.showAdvanced = false;
  this.rulesJson = "";

  const PRESET_RULES = {
    springboot: [
      { type: "bearer_header", header: "Authorization", key: "", marker: "", mode: "whitespace", stop_char: "", stop_set: "", max_len: 0 },

      { type: "header", header: "X-Api-Key", key: "", marker: "", mode: "whitespace", stop_char: "", stop_set: "", max_len: 0 },
      { type: "header", header: "X-API-Key", key: "", marker: "", mode: "whitespace", stop_char: "", stop_set: "", max_len: 0 },
      { type: "header", header: "Api-Key", key: "", marker: "", mode: "whitespace", stop_char: "", stop_set: "", max_len: 0 },

      { type: "query_param", header: "", key: "access_token", marker: "", mode: "set", stop_char: "", stop_set: "& \t\r\n", max_len: 0 },
      { type: "query_param", header: "", key: "refresh_token", marker: "", mode: "set", stop_char: "", stop_set: "& \t\r\n", max_len: 0 },
      { type: "query_param", header: "", key: "id_token", marker: "", mode: "set", stop_char: "", stop_set: "& \t\r\n", max_len: 0 },
      { type: "query_param", header: "", key: "token", marker: "", mode: "set", stop_char: "", stop_set: "& \t\r\n", max_len: 0 },
      { type: "query_param", header: "", key: "api_key", marker: "", mode: "set", stop_char: "", stop_set: "& \t\r\n", max_len: 0 },
      { type: "query_param", header: "", key: "apikey", marker: "", mode: "set", stop_char: "", stop_set: "& \t\r\n", max_len: 0 },
      { type: "query_param", header: "", key: "client_secret", marker: "", mode: "set", stop_char: "", stop_set: "& \t\r\n", max_len: 0 },

      { type: "json_field", header: "", key: "token", marker: "", mode: "char", stop_char: "\"", stop_set: "", max_len: 0 },
      { type: "json_field", header: "", key: "access_token", marker: "", mode: "char", stop_char: "\"", stop_set: "", max_len: 0 },
      { type: "json_field", header: "", key: "refresh_token", marker: "", mode: "char", stop_char: "\"", stop_set: "", max_len: 0 },
      { type: "json_field", header: "", key: "id_token", marker: "", mode: "char", stop_char: "\"", stop_set: "", max_len: 0 },
      { type: "json_field", header: "", key: "password", marker: "", mode: "char", stop_char: "\"", stop_set: "", max_len: 0 },
      { type: "json_field", header: "", key: "secret", marker: "", mode: "char", stop_char: "\"", stop_set: "", max_len: 0 },
      { type: "json_field", header: "", key: "api_key", marker: "", mode: "char", stop_char: "\"", stop_set: "", max_len: 0 },

      { type: "custom", header: "", key: "", marker: "spring.datasource.password=", mode: "whitespace", stop_char: "", stop_set: "", max_len: 0 },
      { type: "custom", header: "", key: "", marker: "spring.redis.password=", mode: "whitespace", stop_char: "", stop_set: "", max_len: 0 },
      { type: "custom", header: "", key: "", marker: "spring.mail.password=", mode: "whitespace", stop_char: "", stop_set: "", max_len: 0 },
      { type: "custom", header: "", key: "", marker: "management.endpoint.env.keys-to-sanitize=", mode: "whitespace", stop_char: "", stop_set: "", max_len: 0 },
    ],
  };

  this.ruleKey = (r) => {
    const type = (r.type || "").trim();
    const header = (r.header || "").trim();
    const key = (r.key || "").trim();
    const marker = (r.marker || "").trim();
    const mode = (r.mode || "").trim();
    const stop_char = (r.stop_char || "").trim();
    const stop_set = (r.stop_set || "").trim();
    const max_len = String(Number(r.max_len) || 0);
    return [type, header, key, marker, mode, stop_char, stop_set, max_len].join("|");
  };

  this.dedupeRules = () => {
    const seen = new Set();
    const out = [];
    for (const r of this.rules) {
      const k = this.ruleKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    this.rules = out;
    this.updateRuleShades();
  };

  this.applyPreset = (presetId) => {
    const toAdd = PRESET_RULES[presetId] || [];
    if (!toAdd.length) return;

    for (const r of toAdd) this.rules.push({ ...r });
    this.dedupeRules();
    this.refresh("rules");
    this.markDirty();
    this.setStatus(`Preset applied: ${presetId}`);
  };

  this.setStatus = (s) => {
    this.status = s;
    this.refresh("status");
  };

  this.compileRules = () => {
    const compiled = [];

    for (const r of this.rules) {
      const max_len = Number(r.max_len) || 0;

      if (r.type === "bearer_header") {
        const header = (r.header || "Authorization").trim();
        compiled.push({ marker: `${header}: Bearer `, mode: "whitespace", max_len });
        continue;
      }

      if (r.type === "header") {
        const header = (r.header || "").trim();
        if (!header) continue;
        compiled.push({ marker: `${header}: `, mode: "whitespace", max_len });
        continue;
      }

      if (r.type === "query_param") {
        const key = (r.key || "").trim();
        if (!key) continue;
        compiled.push({ marker: `${key}=`, mode: "set", stop_set: "& \t\r\n", max_len });
        continue;
      }

      if (r.type === "json_field") {
        const key = (r.key || "").trim();
        if (!key) continue;
        compiled.push({ marker: `"${key}":"`, mode: "char", stop_char: "\"", max_len });
        continue;
      }

      if (r.type === "custom") {
        const marker = (r.marker || "");
        if (!marker) continue;

        const mode = r.mode || "whitespace";
        const obj = { marker, mode, max_len };

        if (mode === "char") obj.stop_char = (r.stop_char || "").slice(0, 1) || "\"";
        if (mode === "set") obj.stop_set = r.stop_set || "& \t\r\n";

        compiled.push(obj);
      }
    }

    return compiled;
  };

  this.getRulesJson = () => JSON.stringify({ rules: this.compileRules() }, null, 2);

  this.syncRulesJson = () => {
    this.rulesJson = this.getRulesJson();
    this.refresh("rulesJson");
  };

  this.markDirty = () => {
    this.output = "";
    this.refresh("output");
    this.setStatus("Edited (click Run)");
    this.syncRulesJson();
  };

  this.run = () => {
    if (!this.mod) {
      this.setStatus("WASM not loaded");
      return;
    }

    try {
      const rulesJson = this.getRulesJson();
      this.output = this.mod.redact(this.input, rulesJson);
      this.refresh("output");
      this.setStatus("Ready");
      this.syncRulesJson();
    } catch (e) {
      this.output = "";
      this.refresh("output");
      this.setStatus(e?.message ? `Error: ${e.message}` : "Error");
      this.syncRulesJson();
    }
  };

  this.addRule = () => {
    this.rules.push({
      type: "query_param",
      header: "",
      key: "",
      marker: "",
      mode: "set",
      stop_char: "",
      stop_set: "& \t\r\n",
      max_len: 0,
    });
    this.updateRuleShades();
    this.refresh("rules");
    this.markDirty();
  };

  this.removeRule = (e, item) => {
    const idx = this.rules.indexOf(item);
    if (idx >= 0) this.rules.splice(idx, 1);
    this.updateRuleShades();
    this.refresh("rules");
    this.markDirty();
  };

  this.onTypeChange = (e, item) => {
    item.type = e.target.value;

    if (item.type === "json_field") {
      item.mode = "char";
      item.stop_char = "\"";
      item.stop_set = "";
    } else if (item.type === "query_param") {
      item.mode = "set";
      item.stop_set = "& \t\r\n";
      item.stop_char = "";
    } else {
      item.mode = "whitespace";
      item.stop_char = "";
      item.stop_set = "";
    }

    this.refresh("rules");
    this.markDirty();
  };

  this.toggleAdvanced = () => {
    this.showAdvanced = !this.showAdvanced;
    this.refresh("showAdvanced");
    this.syncRulesJson();
  };

  this.copyRulesJson = async () => {
    try {
      await navigator.clipboard.writeText(this.getRulesJson());
      this.setStatus("Rules JSON copied");
      setTimeout(() => this.setStatus("OK"), 700);
    } catch {
      this.setStatus("Copy failed");
    }
  };

  onload(async () => {
    try {
      this.mod = await createModule();
      this.setStatus("OK");
      this.syncRulesJson();
      this.run();

      // paint after first render
      this.paintRuleBoxes();
    } catch (e) {
      console.error(e);
      this.setStatus(e?.message ? `Failed to load WASM: ${e.message}` : "Failed to load WASM");
    }
  });

  return (render) => render`
    <div class="wrap">
      <div class="pane left">
        <div class="row" style="justify-content:space-between;">
          <div>
            <div style="font-weight:700;">Rules</div>
            <div class="muted">${this.status}</div>
          </div>
          <div class="row">
            <button class="btn" onclick="${this.addRule}">Add</button>
            <button class="btn" onclick="${this.run}">Run</button>
          </div>
        </div>

        <div style="margin-top:10px;">
          <div class="muted" style="margin-bottom:6px;">Presets</div>
          <div class="row" style="flex-wrap:wrap;">
            <button class="btn" onclick="${() => this.applyPreset("springboot")}">Spring Boot</button>
          </div>
        </div>

        <div id="ruleList">
          <div :loop="${this.rules}">
            <div class="rule">
              <div class="row" style="justify-content:space-between;">
                <div class="muted">Rule</div>
                <button class="btn" onclick="${this.removeRule}">Remove</button>
              </div>

              <div style="margin-top:8px;">
                <div class="muted">Type</div>
                <select :bind="self.type" onchange="${this.onTypeChange}">
                  <option value="bearer_header">Bearer header</option>
                  <option value="header">Header value</option>
                  <option value="query_param">Query param</option>
                  <option value="json_field">JSON field</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div style="margin-top:8px;">
                <div class="muted">header (used by Bearer header / Header value)</div>
                <input :bind="self.header" placeholder="Authorization or X-Api-Key" oninput="${this.markDirty}" />
              </div>

              <div style="margin-top:8px;">
                <div class="muted">key (used by Query param / JSON field)</div>
                <input :bind="self.key" placeholder="api_key or token" oninput="${this.markDirty}" />
              </div>

              <div style="margin-top:8px;">
                <div class="muted">marker (Custom only)</div>
                <input :bind="self.marker" placeholder='e.g. "secret":"' oninput="${this.markDirty}" />
              </div>

              <div class="grid2" style="margin-top:8px;">
                <div>
                  <div class="muted">mode (Custom)</div>
                  <select :bind="self.mode" onchange="${this.markDirty}">
                    <option value="whitespace">whitespace</option>
                    <option value="char">char</option>
                    <option value="set">set</option>
                  </select>
                </div>
                <div>
                  <div class="muted">max_len (0=none)</div>
                  <input :bind="self.max_len" oninput="${this.markDirty}" />
                </div>
              </div>

              <div class="grid2" style="margin-top:8px;">
                <div>
                  <div class="muted">stop_char (Custom + mode=char)</div>
                  <input :bind="self.stop_char" oninput="${this.markDirty}" placeholder='"' />
                </div>
                <div>
                  <div class="muted">stop_set (Custom + mode=set)</div>
                  <input :bind="self.stop_set" oninput="${this.markDirty}" placeholder="& \t\r\n" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="row" style="margin-top:12px;">
          <button class="btn" onclick="${this.toggleAdvanced}">${this.showAdvanced ? "Hide JSON" : "Show JSON"}</button>
          <button class="btn" onclick="${this.copyRulesJson}">Copy JSON</button>
        </div>

        <div style="margin-top:10px;display:${this.showAdvanced ? "block" : "none"};">
          <div class="muted">Generated rules JSON</div>
          <textarea :bind="self.rulesJson" readonly style="margin-top:6px;height:240px;" class="mono"></textarea>
        </div>
      </div>

      <div class="pane right">
        <div class="row" style="justify-content:space-between;">
          <div style="font-weight:700;">Input → Output</div>
          <button class="btn" onclick="${this.run}">Run</button>
        </div>

        <div style="display:flex;gap:10px;flex:1;">
          <div style="flex:1;display:flex;flex-direction:column;">
            <div class="muted">Input</div>
            <textarea :bind="self.input" oninput="${this.markDirty}" style="flex:1;"></textarea>
          </div>

          <div style="flex:1;display:flex;flex-direction:column;">
            <div class="muted">Output</div>
            <textarea :bind="self.output" readonly style="flex:1;"></textarea>
          </div>
        </div>
      </div>
    </div>
  `;
}

lemonade.render(App, document.querySelector("#app"));

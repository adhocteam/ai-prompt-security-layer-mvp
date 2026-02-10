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

  this.input = `Authorization: Bearer abcdef123456
X-Api-Key: SUPERSECRET
api_key=SUPERSECRET&x=1
{"token":"tok_12345","other":"ok"}`;
  this.output = "";

  this.showAdvanced = false;
  this.rulesJson = "";

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
    this.refresh("rules");
    this.markDirty();
  };

  this.removeRule = (e, item) => {
    const idx = this.rules.indexOf(item);
    if (idx >= 0) this.rules.splice(idx, 1);
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
    } catch (e) {
      console.error(e);
      this.setStatus(e?.message ? `Failed to load WASM: ${e.message}` : "Failed to load WASM");
    }
  });

  return (render) => render`
    <div style="display:flex;height:100vh;font-family:system-ui,sans-serif;">
      <div style="width:460px;border-right:1px solid #ddd;padding:12px;overflow:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;">Rules</div>
            <div style="color:#666;font-size:12px;">${this.status}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button onclick="${this.addRule}" style="padding:8px 10px;border:1px solid #ccc;border-radius:10px;background:#fff;cursor:pointer;">Add</button>
            <button onclick="${this.run}" style="padding:8px 10px;border:1px solid #ccc;border-radius:10px;background:#fff;cursor:pointer;">Run</button>
          </div>
        </div>

        <div :loop="${this.rules}">
          <div style="border:1px solid #ddd;border-radius:12px;padding:10px;margin-top:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="color:#666;font-size:12px;">Rule</div>
              <button onclick="${this.removeRule}" style="padding:6px 8px;border:1px solid #ccc;border-radius:10px;background:#fff;cursor:pointer;">Remove</button>
            </div>

            <div style="margin-top:8px;">
              <div style="color:#666;font-size:12px;">Type</div>
              <select style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:10px;"
                onchange="${this.onTypeChange}">
                <option value="bearer_header">Bearer header</option>
                <option value="header">Header value</option>
                <option value="query_param">Query param</option>
                <option value="json_field">JSON field</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div style="margin-top:8px;">
              <div style="color:#666;font-size:12px;">header (used by Bearer header / Header value)</div>
              <input :bind="self.header"
                placeholder="Authorization or X-Api-Key"
                oninput="${this.markDirty}"
                style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:10px;" />
            </div>

            <div style="margin-top:8px;">
              <div style="color:#666;font-size:12px;">key (used by Query param / JSON field)</div>
              <input :bind="self.key"
                placeholder="api_key or token"
                oninput="${this.markDirty}"
                style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:10px;" />
            </div>

            <div style="margin-top:8px;">
              <div style="color:#666;font-size:12px;">marker (Custom only)</div>
              <input :bind="self.marker"
                placeholder='e.g. "secret":"'
                oninput="${this.markDirty}"
                style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:10px;" />
            </div>

            <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div>
                <div style="color:#666;font-size:12px;">mode (Custom)</div>
                <select :bind="self.mode" onchange="${this.markDirty}"
                  style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:10px;">
                  <option value="whitespace">whitespace</option>
                  <option value="char">char</option>
                  <option value="set">set</option>
                </select>
              </div>
              <div>
                <div style="color:#666;font-size:12px;">max_len (0=none)</div>
                <input :bind="self.max_len" oninput="${this.markDirty}"
                  style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:10px;" />
              </div>
            </div>

            <div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div>
                <div style="color:#666;font-size:12px;">stop_char (Custom + mode=char)</div>
                <input :bind="self.stop_char" oninput="${this.markDirty}"
                  placeholder='"'
                  style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:10px;" />
              </div>
              <div>
                <div style="color:#666;font-size:12px;">stop_set (Custom + mode=set)</div>
                <input :bind="self.stop_set" oninput="${this.markDirty}"
                  placeholder="& \t\r\n"
                  style="width:100%;box-sizing:border-box;padding:8px;border:1px solid #ddd;border-radius:10px;" />
              </div>
            </div>
          </div>
        </div>

        <div style="margin-top:12px;display:flex;gap:8px;">
          <button onclick="${this.toggleAdvanced}" style="padding:8px 10px;border:1px solid #ccc;border-radius:10px;background:#fff;cursor:pointer;">
            ${this.showAdvanced ? "Hide JSON" : "Show JSON"}
          </button>
          <button onclick="${this.copyRulesJson}" style="padding:8px 10px;border:1px solid #ccc;border-radius:10px;background:#fff;cursor:pointer;">
            Copy JSON
          </button>
        </div>

        <div style="margin-top:10px;display:${this.showAdvanced ? "block" : "none"};">
          <div style="color:#666;font-size:12px;">Generated rules JSON</div>
          <textarea :bind="self.rulesJson" readonly
            style="width:100%;box-sizing:border-box;margin-top:6px;height:240px;font-family:ui-monospace,Menlo,monospace;"></textarea>
        </div>
      </div>

      <div style="flex:1;padding:12px;display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:700;">Input → Output</div>
          <button onclick="${this.run}" style="padding:8px 10px;border:1px solid #ccc;border-radius:10px;background:#fff;cursor:pointer;">Run</button>
        </div>

        <div style="display:flex;gap:10px;flex:1;">
          <div style="flex:1;display:flex;flex-direction:column;">
            <div style="color:#666;font-size:12px;">Input</div>
            <textarea :bind="self.input" oninput="${this.markDirty}"
              style="flex:1;width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,monospace;"></textarea>
          </div>

          <div style="flex:1;display:flex;flex-direction:column;">
            <div style="color:#666;font-size:12px;">Output</div>
            <textarea :bind="self.output" readonly
              style="flex:1;width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,monospace;"></textarea>
          </div>
        </div>
      </div>
    </div>
  `;
}

lemonade.render(App, document.querySelector("#app"));

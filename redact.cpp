#include <iostream>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>
#include <bitset>
#include <memory>
#include <initializer_list>

// Only pulled in when compiling for WebAssembly with em++.
// Native builds (g++) won't see or need this.
#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
#endif

// Header-only JSON library (single json.hpp file in vendor/).
// We use it to accept redaction rules from the browser as JSON.
#include "nlohmann/json.hpp"
using json = nlohmann::json;

using namespace std;

// What we replace secrets with.
static constexpr string_view REDACT = "[REDACTED]";

// A Rule is marker-based redaction.
// We find `marker` and then redact everything after it until a stop condition hits.
struct Rule {
  string marker;

  // How we decide where the secret ends:
  // - WHITESPACE: stop at whitespace/control (spaces, tabs, newline, etc.)
  // - CHAR: stop at a single delimiter character (e.g. closing quote)
  // - SET: stop at any character in stop_set (useful for query strings)
  enum class StopMode { WHITESPACE, CHAR, SET } mode;

  // Used when mode == CHAR
  unsigned char stop_char = 0;

  // Used when mode == SET (bitset lookup is fast and simple)
  bitset<256> stop_set;

  // Optional cap so we don't run forever on malformed input (0 = unlimited)
  size_t max_len = 0;
};

// Treat ASCII <= 32 as whitespace/control.
// (Matches the original behavior you already had.)
static inline bool is_ws_or_ctl(unsigned char c) {
  return c <= 32;
}

// Apply a single rule to a line in-place.
static inline void apply_rule(string& s, const Rule& r) {
  size_t i = 0;

  while (true) {
    // Find the next marker starting at i
    size_t pos = s.find(r.marker, i);
    if (pos == string::npos) break;

    // Start redaction immediately after the marker
    size_t start = pos + r.marker.size();
    size_t j = start;

    // Local helper: stop if max_len is set and we’ve reached it
    auto limit_reached = [&](size_t jj) -> bool {
      return (r.max_len != 0) && (jj - start >= r.max_len);
    };

    // Walk forward until the stop condition says "end of secret"
    if (r.mode == Rule::StopMode::CHAR) {
      unsigned char stop = r.stop_char;
      while (j < s.size() && (unsigned char)s[j] != stop) {
        ++j;
        if (limit_reached(j)) break;
      }
    } else if (r.mode == Rule::StopMode::SET) {
      while (j < s.size() && !r.stop_set.test((unsigned char)s[j])) {
        ++j;
        if (limit_reached(j)) break;
      }
    } else {
      while (j < s.size() && !is_ws_or_ctl((unsigned char)s[j])) {
        ++j;
        if (limit_reached(j)) break;
      }
    }

    // Replace the sensitive substring with the constant token
    s.replace(start, j - start, REDACT);

    // Continue scanning after what we just inserted
    i = start + REDACT.size();
  }
}

// Cheap prefilter: if none of these strings appear in the line,
// we skip applying rules entirely.
static inline bool maybe_contains_any(const string& s, const vector<string>& needles) {
  for (const auto& n : needles) {
    if (s.find(n) != string::npos) return true;
  }
  return false;
}

// Convenience builders for native hard-coded rules
static inline Rule make_stop_char(string marker, char stop, size_t max_len = 0) {
  Rule r;
  r.marker = std::move(marker);
  r.mode = Rule::StopMode::CHAR;
  r.stop_char = (unsigned char)stop;
  r.max_len = max_len;
  return r;
}

static inline Rule make_stop_ws(string marker, size_t max_len = 0) {
  Rule r;
  r.marker = std::move(marker);
  r.mode = Rule::StopMode::WHITESPACE;
  r.max_len = max_len;
  return r;
}

static inline Rule make_stop_set(string marker, initializer_list<unsigned char> stops, size_t max_len = 0) {
  Rule r;
  r.marker = std::move(marker);
  r.mode = Rule::StopMode::SET;
  for (auto c : stops) r.stop_set.set(c);
  r.max_len = max_len;
  return r;
}

// Convert one JSON object into a Rule.
// Expected JSON shape per rule:
//
// {
//   "marker": "api_key=",
//   "mode": "set",              // "whitespace" | "char" | "set"
//   "stop_char": "\"",          // only for mode=="char"
//   "stop_set": "& \t\r\n",     // only for mode=="set" (string of stop chars)
//   "max_len": 0                // optional safety cap
// }
static inline Rule rule_from_json(const json& it) {
  Rule r;
  r.marker = it.value("marker", "");
  string mode = it.value("mode", "whitespace");
  r.max_len = (size_t)it.value("max_len", 0);

  if (mode == "char") {
    r.mode = Rule::StopMode::CHAR;
    string sc = it.value("stop_char", "");
    r.stop_char = sc.empty() ? 0 : (unsigned char)sc[0];
  } else if (mode == "set") {
    r.mode = Rule::StopMode::SET;
    string stops = it.value("stop_set", "");
    for (unsigned char c : stops) r.stop_set.set(c);
  } else {
    r.mode = Rule::StopMode::WHITESPACE;
  }

  return r;
}

// Parse the full JSON blob and build a vector of rules.
static inline vector<Rule> rules_from_json_string(const string& rules_json) {
  vector<Rule> rules;
  if (rules_json.empty()) return rules;

  auto j = json::parse(rules_json);
  if (!j.contains("rules") || !j["rules"].is_array()) return rules;

  for (const auto& it : j["rules"]) {
    Rule r = rule_from_json(it);
    if (!r.marker.empty()) rules.push_back(std::move(r));
  }
  return rules;
}

// We use markers themselves as a quick line prefilter.
// If a marker doesn't exist in the line, that rule can't match anyway.
static inline vector<string> prefilter_from_rules(const vector<Rule>& rules) {
  vector<string> pf;
  pf.reserve(rules.size());
  for (const auto& r : rules) {
    if (!r.marker.empty()) pf.push_back(r.marker);
  }
  return pf;
}

// Redact a whole text buffer while preserving line breaks.
// Notes:
// - We ignore '\r' so CRLF files behave normally.
// - We only apply rules if the line contains any marker (cheap prefilter).
static inline string redact_text_with_rules(const string& input, const vector<Rule>& rules) {
  if (rules.empty()) return input;

  vector<string> prefilter = prefilter_from_rules(rules);

  string out;
  out.reserve(input.size());

  string line;
  line.reserve(4096);

  for (size_t i = 0; i < input.size(); ++i) {
    char c = input[i];
    if (c == '\n') {
      if (maybe_contains_any(line, prefilter)) {
        for (const auto& r : rules) apply_rule(line, r);
      }
      out += line;
      out += '\n';
      line.clear();
    } else if (c != '\r') {
      line.push_back(c);
    }
  }

  // Handle final line if input doesn't end with '\n'
  if (!line.empty()) {
    if (maybe_contains_any(line, prefilter)) {
      for (const auto& r : rules) apply_rule(line, r);
    }
    out += line;
  }

  return out;
}

// This is the browser entry point.
// JS will pass the whole input text and a JSON string containing rules.
string redact(string input, string rules_json) {
  vector<Rule> rules = rules_from_json_string(rules_json);
  return redact_text_with_rules(input, rules);
}

#ifdef __EMSCRIPTEN__
// Expose redact() to JavaScript as mod.redact(input, rulesJson)
EMSCRIPTEN_BINDINGS(redactor_bindings) {
  emscripten::function("redact", &redact);
}
#endif

#ifndef __EMSCRIPTEN__
// Native CLI entry point (unchanged behavior):
// - read from a file if given, else stdin
// - apply hard-coded rules line-by-line
// - print to stdout
int main(int argc, char** argv) {
  ios::sync_with_stdio(false);
  cin.tie(nullptr);

  unique_ptr<istream> in;
  if (argc >= 2) {
    auto f = make_unique<ifstream>(argv[1], ios::binary);
    if (!*f) return 1;
    in = std::move(f);
  } else {
    in.reset(&cin);
  }

  vector<Rule> rules;

  rules.push_back(make_stop_ws("Authorization: Bearer "));
  rules.push_back(make_stop_ws("X-Api-Key: "));
  rules.push_back(make_stop_ws("X-API-Key: "));
  rules.push_back(make_stop_ws("Api-Key: "));

  rules.push_back(make_stop_set("api_key=",  { (unsigned char)'&', (unsigned char)' ', (unsigned char)'\t', (unsigned char)'\r', (unsigned char)'\n' }));
  rules.push_back(make_stop_set("token=",    { (unsigned char)'&', (unsigned char)' ', (unsigned char)'\t', (unsigned char)'\r', (unsigned char)'\n' }));
  rules.push_back(make_stop_set("password=", { (unsigned char)'&', (unsigned char)' ', (unsigned char)'\t', (unsigned char)'\r', (unsigned char)'\n' }));
  rules.push_back(make_stop_set("secret=",   { (unsigned char)'&', (unsigned char)' ', (unsigned char)'\t', (unsigned char)'\r', (unsigned char)'\n' }));

  rules.push_back(make_stop_char("\"token\":\"", '"'));
  rules.push_back(make_stop_char("\"password\":\"", '"'));
  rules.push_back(make_stop_char("\"secret\":\"", '"'));
  rules.push_back(make_stop_char("\"api_key\":\"", '"'));

  vector<string> prefilter = {
    "Authorization", "Bearer", "api_key", "token", "password", "secret",
    "X-Api-Key", "\"token\"", "\"password\"", "\"api_key\"", "\"secret\""
  };

  string line;
  while (getline(*in, line)) {
    if (maybe_contains_any(line, prefilter)) {
      for (const auto& r : rules) apply_rule(line, r);
    }
    cout << line << '\n';
  }

  if (in.get() == &cin) in.release();
  return 0;
}
#endif

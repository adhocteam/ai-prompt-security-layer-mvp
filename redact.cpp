#include <iostream>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>
#include <bitset>
#include <memory>
#include <initializer_list>

using namespace std;

static constexpr string_view REDACT = "[REDACTED]";

struct Rule {
  string marker;
  enum class StopMode { WHITESPACE, CHAR, SET } mode;
  unsigned char stop_char = 0;
  bitset<256> stop_set;
  size_t max_len = 0;
};

static inline bool is_ws_or_ctl(unsigned char c) {
  return c <= 32;
}

static inline void apply_rule(string& s, const Rule& r) {
  size_t i = 0;
  while (true) {
    size_t pos = s.find(r.marker, i);
    if (pos == string::npos) break;

    size_t start = pos + r.marker.size();
    size_t j = start;

    auto limit_reached = [&](size_t jj) -> bool {
      return (r.max_len != 0) && (jj - start >= r.max_len);
    };

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

    s.replace(start, j - start, REDACT);
    i = start + REDACT.size();
  }
}

static inline bool maybe_contains_any(const string& s, const vector<string>& needles) {
  for (const auto& n : needles) {
    if (s.find(n) != string::npos) return true;
  }
  return false;
}

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

#include "vendor/nlohmann/json.hpp"
using json = nlohmann::json;

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
    // stop_set: string of stop chars, e.g. "& \t\r\n"
    string stops = it.value("stop_set", "");
    for (unsigned char c : stops) r.stop_set.set(c);
  } else {
    r.mode = Rule::StopMode::WHITESPACE;
  }

  return r;
}

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

static inline vector<string> prefilter_from_rules(const vector<Rule>& rules) {
  vector<string> pf;
  pf.reserve(rules.size());
  for (const auto& r : rules) {
    if (!r.marker.empty()) pf.push_back(r.marker);
  }
  return pf;
}

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

  if (!line.empty() || (input.size() && input.back() == '\r')) {
    if (maybe_contains_any(line, prefilter)) {
      for (const auto& r : rules) apply_rule(line, r);
    }
    out += line;
  }

  return out;
}

string redact(string input, string rules_json) {
  vector<Rule> rules = rules_from_json_string(rules_json);
  return redact_text_with_rules(input, rules);
}

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>
EMSCRIPTEN_BINDINGS(redactor_bindings) {
  emscripten::function("redact", &redact);
}
#endif

#ifndef __EMSCRIPTEN__
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

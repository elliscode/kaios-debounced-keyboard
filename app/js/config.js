/**
 * config.js — UI for keyboard.localhost/config.html.
 *
 * Debounce settings -> DebounceConfig (localStorage keyboard.debounce.v1).
 * Prediction rules  -> PredictConfig  (localStorage keyboard.predict.v1).
 * The keyboard app reads the same origin storage, so no permission or storage
 * service is involved.
 */

(function () {
  "use strict";

  // ------------------------------------------------------------------ debounce
  var statusEl = document.getElementById("status");
  var MODES = ["T9", "Abc", "abc", "ABC", "123"];
  var COOLDOWNS = MODES.map(function (m) { return "COOLDOWN_" + m; });
  var NUMS = ["GAP_HARD", "GAP_SOFT", "HOLD_SHORT"].concat(COOLDOWNS, ["SELECT_COOLDOWN"]);
  var fields = ["enabled"].concat(NUMS, ["showMarker", "debug"]);

  function setStatus(el, text, isError) {
    el.textContent = text;
    el.className = "status" + (isError ? " error" : "");
  }

  function labelOf(id) {
    var l = document.querySelector('label[for="' + id + '"]');
    return l ? l.textContent : id;
  }

  function render(values) {
    fields.forEach(function (f) {
      var el = document.getElementById(f);
      if (!el) return;
      if (el.type === "checkbox") el.checked = !!values[f];
      else el.value = values[f] == null ? "" : String(values[f]);
    });
  }

  // Number fields are type=tel (backspace works on the phone), so read them as
  // text: anything but whole digits is an error, never a silent NaN.
  function readForm() {
    var out = {};
    fields.forEach(function (f) {
      var el = document.getElementById(f);
      if (el.type === "checkbox") { out[f] = !!el.checked; return; }
      var t = el.value.trim();
      if (!/^[0-9]+$/.test(t)) throw new Error(labelOf(f) + ": enter a whole number" + (t ? "" : " (it is empty)"));
      out[f] = parseInt(t, 10);
    });
    return out;
  }

  function validate(v) {
    var ranges = window.DebounceConfig.INT_RANGES || {};
    NUMS.forEach(function (f) {
      var r = ranges[f] || [0, 1000];
      if (v[f] < r[0] || v[f] > r[1]) throw new Error(labelOf(f) + " must be " + r[0] + "–" + r[1]);
    });
    if (v.GAP_SOFT < v.GAP_HARD) throw new Error("Soft gap must be >= hard gap");
    return v;
  }

  function load() {
    setStatus(statusEl, "Reading local storage…");
    if (window.DebounceConfig.readLocal()) {
      render(window.DebounceConfig.values);
      setStatus(statusEl, "Loaded from local storage.");
      return;
    }
    render(window.DebounceConfig.DEFAULTS);
    setStatus(statusEl, "No saved config yet — showing defaults. Press Save.");
  }

  function save() {
    var v;
    try { v = validate(readForm()); } catch (e) { setStatus(statusEl, "Not saved: " + e.message, true); return; }
    setStatus(statusEl, "Saving…");
    window.DebounceConfig.saveLocal(v).then(function (vals) {
      render(vals);
      setStatus(statusEl, "Saved to local storage. The keyboard applies it within ~1 s.");
    }).catch(function (e) {
      setStatus(statusEl, "Save failed: " + (e && (e.message || e)), true);
    });
  }

  function defaults() {
    render(window.DebounceConfig.DEFAULTS);
    setStatus(statusEl, "Defaults shown. Press Save to apply.");
  }

  function cooldownProfile(ms) {
    var p = { enabled: true, GAP_HARD: 0, GAP_SOFT: 0, HOLD_SHORT: 0 };
    COOLDOWNS.forEach(function (f) { p[f] = ms; });
    return Object.assign({}, window.DebounceConfig.DEFAULTS, p);
  }

  function profile100() {
    render(cooldownProfile(100));
    setStatus(statusEl, "100 ms same-key cooldown (all modes) shown. Press Save to apply.");
  }

  function profile1s() {
    render(cooldownProfile(1000));
    setStatus(statusEl, "1 s same-key cooldown (all modes) shown. Press Save to apply.");
  }

  // ---------------------------------------------------------- prediction rules
  var prStatus = document.getElementById("pr-status");
  var prJson = document.getElementById("pr-json");
  var prEnabled = document.getElementById("pr-enabled");

  // Pretty-print with each word list on one line, so it fits a phone screen.
  function formatRules(rules) {
    var keys = Object.keys(rules);
    if (!keys.length) return "{}";
    return "{\n" + keys.map(function (d) {
      var rule = rules[d];
      var words = Object.keys(rule);
      if (words.length === 1 && words[0] === "first") {
        return "  " + JSON.stringify(d) + ": { \"first\": " + JSON.stringify(rule.first) + " }";
      }
      return "  " + JSON.stringify(d) + ": {\n" + words.map(function (w) {
        var v = rule[w];
        var s = Array.isArray(v) ? "[" + v.map(function (x) { return JSON.stringify(x); }).join(", ") + "]" : JSON.stringify(v);
        return "    " + JSON.stringify(w) + ": " + s;
      }).join(",\n") + "\n  }";
    }).join(",\n") + "\n}";
  }

  function summary(rules) {
    var keys = Object.keys(rules);
    return keys.length + (keys.length === 1 ? " rule: " : " rules: ") + keys.join(", ");
  }

  // Accepts either a bare rules map or a full { enabled, rules } object.
  // Returns { obj, error }.
  function parseRulesText(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { error: "Not valid JSON: " + e.message }; }
    var obj;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, "rules")) {
      obj = { enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : prEnabled.checked, rules: parsed.rules };
    } else {
      obj = { enabled: prEnabled.checked, rules: parsed };
    }
    var err = window.PredictConfig.validate(obj);
    return err ? { error: err } : { obj: obj };
  }

  function prRender(vals) {
    prEnabled.checked = vals.enabled !== false;
    prJson.value = formatRules(vals.rules || {});
    runTest();
  }

  function prLoad() {
    var saved = window.PredictConfig.readLocal();
    prRender(window.PredictConfig.values);
    var err = window.PredictConfig.lastError();
    if (err) setStatus(prStatus, "Saved rules are invalid (" + err + ") — the keyboard is using the defaults shown.", true);
    else if (saved) setStatus(prStatus, "Loaded saved rules. " + summary(window.PredictConfig.values.rules) + ".");
    else setStatus(prStatus, "No saved rules yet — the keyboard is using these defaults.");
  }

  function prValidate() {
    var r = parseRulesText(prJson.value);
    if (r.error) { setStatus(prStatus, "Invalid: " + r.error, true); return null; }
    setStatus(prStatus, "Valid. " + summary(r.obj.rules) + ". Press Save to apply.");
    return r.obj;
  }

  function prSave() {
    var r = parseRulesText(prJson.value);
    if (r.error) { setStatus(prStatus, "Not saved: " + r.error, true); return; }
    window.PredictConfig.saveLocal(r.obj).then(function (vals) {
      prRender(vals);
      setStatus(prStatus, "Saved. " + summary(vals.rules) + ". The keyboard applies them within ~1 s.");
    }).catch(function (e) {
      setStatus(prStatus, "Save failed: " + (e && (e.message || e)), true);
    });
  }

  function prDefaults() {
    prRender(window.PredictConfig.DEFAULTS);
    setStatus(prStatus, "Defaults shown. Press Save to apply.");
  }

  function prFetch() {
    var url = document.getElementById("pr-url").value.trim();
    if (!url) { setStatus(prStatus, "Enter a URL first.", true); return; }
    setStatus(prStatus, "Loading " + url + " …");
    fetch(url, { cache: "no-store" }).then(function (res) {
      if (!res.ok) throw { http: true, message: "HTTP " + res.status + " " + (res.statusText || "") };
      return res.text();
    }).then(function (text) {
      var r = parseRulesText(text);
      if (r.error) { setStatus(prStatus, "Loaded, but not usable: " + r.error, true); return; }
      prEnabled.checked = r.obj.enabled;
      prJson.value = formatRules(r.obj.rules);
      runTest();
      setStatus(prStatus, "Loaded " + summary(r.obj.rules) + ". Not saved yet — press Save to apply.");
    }).catch(function (e) {
      if (e && e.http) { setStatus(prStatus, "Load failed: " + e.message, true); return; }
      setStatus(prStatus, "Load failed (network or CORS): " + (e && e.message ? e.message : e) +
        "\nFor 127.0.0.1:8088: run tools/serve.py on the Mac and `adb reverse tcp:8088 tcp:8088`." +
        "\nOther hosts must send Access-Control-Allow-Origin (raw GitHub files and gists do).", true);
    });
  }

  // Live test box: uses the textarea's rules when they're valid, else the saved ones.
  function runTest() {
    var out = document.getElementById("pr-test-out");
    var digits = document.getElementById("pr-test-digits").value.trim();
    var prev = document.getElementById("pr-test-prev").value.trim();
    var list = document.getElementById("pr-test-list").value.split(",")
      .map(function (s) { return s.trim(); }).filter(function (s) { return s.length; });
    var r = parseRulesText(prJson.value);
    var rules = r.obj ? r.obj.rules : window.PredictConfig.values.rules;
    var src = r.obj ? "editor" : "saved (editor JSON is invalid)";
    if (!digits) { out.textContent = "Enter digits."; return; }
    if (!Object.prototype.hasOwnProperty.call(rules, digits)) {
      out.textContent = "No rule for " + digits + " → TouchPal order kept:\n" + list.join(", ");
      return;
    }
    var res = window.PredictCore.reorder(list, digits, prev || null, rules);
    out.textContent = (res === list ? "Rule " + digits + " didn't match (prev " + (prev ? JSON.stringify(prev) : "^") + ") → unchanged:\n" : "→ ") +
      res.join(", ") + "\n(rules from " + src + ")";
  }

  // ---------------------------------------------------------------- start
  function on(id, fn) { document.getElementById(id).addEventListener("click", fn); }

  function start() {
    if (!window.DebounceConfig || !window.PredictConfig) { setTimeout(start, 100); return; }
    on("save", save);
    on("reload", load);
    on("defaults", defaults);
    on("profile-100ms", profile100);
    on("profile-1s", profile1s);
    load();

    on("pr-validate", prValidate);
    on("pr-save", prSave);
    on("pr-defaults", prDefaults);
    on("pr-load", prFetch);
    ["pr-test-digits", "pr-test-prev", "pr-test-list", "pr-json"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", runTest);
    });
    prEnabled.addEventListener("change", runTest);
    prLoad();
  }

  start();
})();

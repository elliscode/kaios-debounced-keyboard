/**
 * config.js — UI for the debounce settings on keyboard.localhost.
 *
 * Writes localStorage (LKEY) under the keyboard origin; the keyboard app reads
 * the same origin storage, so no permission or storage service is involved.
 */

(function () {
  "use strict";

  var statusEl = document.getElementById("status");
  var fields = ["enabled", "GAP_HARD", "GAP_SOFT", "HOLD_SHORT", "LONE_HOLD", "COOLDOWN", "dropLoneShort", "showMarker", "debug"];

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.className = isError ? "error" : "";
  }

  function render(values) {
    fields.forEach(function (f) {
      var el = document.getElementById(f);
      if (!el) return;
      if (el.type === "checkbox") el.checked = !!values[f];
      else el.value = values[f];
    });
  }

  function readForm() {
    var out = {};
    fields.forEach(function (f) {
      var el = document.getElementById(f);
      out[f] = el.type === "checkbox" ? !!el.checked : parseInt(el.value, 10);
    });
    return out;
  }

  function validate(v) {
    var nums = ["GAP_HARD", "GAP_SOFT", "HOLD_SHORT", "LONE_HOLD", "COOLDOWN"];
    for (var i = 0; i < nums.length; i++) {
      var n = v[nums[i]];
      if (!isFinite(n) || n < 0 || n > 1000) throw new Error("numbers must be 0–1000");
    }
    if (v.GAP_SOFT < v.GAP_HARD) throw new Error("soft gap must be >= hard gap");
    return v;
  }

  function load() {
    setStatus("Reading local storage…");
    if (window.DebounceConfig.readLocal()) {
      render(window.DebounceConfig.values);
      setStatus("Loaded from local storage.");
      return;
    }
    render(window.DebounceConfig.DEFAULTS);
    setStatus("No saved config yet — showing defaults. Press Save.");
  }

  function save() {
    var v;
    try { v = validate(readForm()); } catch (e) { setStatus("Not saved: " + e.message, true); return; }
    setStatus("Saving…");
    window.DebounceConfig.saveLocal(v).then(function (vals) {
      render(vals);
      setStatus("Saved to local storage. The keyboard applies it within ~1 s.");
    }).catch(function (e) {
      setStatus("Save failed: " + (e && (e.message || e)), true);
    });
  }

  function defaults() {
    render(window.DebounceConfig.DEFAULTS);
    setStatus("Defaults shown. Press Save to apply.");
  }

  function profile100() {
    render(Object.assign({}, window.DebounceConfig.DEFAULTS, {
      enabled: true,
      GAP_HARD: 0,
      GAP_SOFT: 0,
      HOLD_SHORT: 0,
      COOLDOWN: 100,
      dropLoneShort: false,
    }));
    setStatus("100 ms same-key cooldown shown. Press Save to apply.");
  }

  function profile1s() {
    render(Object.assign({}, window.DebounceConfig.DEFAULTS, {
      enabled: true,
      GAP_HARD: 0,
      GAP_SOFT: 0,
      HOLD_SHORT: 0,
      COOLDOWN: 1000,
      dropLoneShort: false,
    }));
    setStatus("1 s same-key cooldown shown. Press Save to apply.");
  }

  function start() {
    if (!window.DebounceConfig) { setTimeout(start, 100); return; }
    document.getElementById("save").addEventListener("click", save);
    document.getElementById("reload").addEventListener("click", load);
    document.getElementById("defaults").addEventListener("click", defaults);
    document.getElementById("profile-100ms").addEventListener("click", profile100);
    document.getElementById("profile-1s").addEventListener("click", profile1s);
    load();
  }

  start();
})();

/**
 * debounce_config.js — runtime configuration for the debounce filter.
 *
 * Store: localStorage under the keyboard.localhost origin. The config page
 * (http://keyboard.localhost/config.html) writes the same key, so no permission
 * and no storage service is needed. A `storage` event applies changes live
 * across documents; a 1 s poll covers same-document writes.
 *
 * Settings service (`keyboard.debounce.*`) is a fallback when no local config
 * exists, for anyone driving the values from a privileged page.
 */

(function () {
  "use strict";

  var DEFAULTS = {
    enabled: true,
    GAP_HARD: 45,
    GAP_SOFT: 60,
    HOLD_SHORT: 30,
    LONE_HOLD: 15,
    COOLDOWN: 100,
    dropLoneShort: false,
    showMarker: false,
    debug: false,
  };

  var FIELDS = ["enabled", "GAP_HARD", "GAP_SOFT", "HOLD_SHORT", "LONE_HOLD", "COOLDOWN", "dropLoneShort", "showMarker", "debug"];
  var INT_RANGES = { GAP_HARD: [0, 500], GAP_SOFT: [0, 500], HOLD_SHORT: [0, 500], LONE_HOLD: [0, 500], COOLDOWN: [0, 1000] };
  var LKEY = "keyboard.debounce.v1";

  var SETTINGS_MAP = {
    "keyboard.debounce.enabled": "enabled",
    "keyboard.debounce.gapHard": "GAP_HARD",
    "keyboard.debounce.gapSoft": "GAP_SOFT",
    "keyboard.debounce.holdShort": "HOLD_SHORT",
    "keyboard.debounce.loneHold": "LONE_HOLD",
    "keyboard.debounce.cooldown": "COOLDOWN",
    "keyboard.debounce.dropLoneShort": "dropLoneShort",
    "keyboard.debounce.showMarker": "showMarker",
    "keyboard.debounce.debug": "debug",
  };

  var values = Object.assign({}, DEFAULTS);
  var listeners = [];
  var lastLocalText = null;
  var localSeen = false;

  function coerce(field, raw) {
    if (field === "enabled" || field === "dropLoneShort" || field === "showMarker" || field === "debug") {
      if (typeof raw === "string") return raw === "true" || raw === "1" || raw === "on";
      return !!raw;
    }
    var n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
    return isFinite(n) ? n : null;
  }

  function applyField(field, raw) {
    if (FIELDS.indexOf(field) < 0) return false;
    var v = coerce(field, raw);
    if (v === null) return false;
    var r = INT_RANGES[field];
    if (r && (v < r[0] || v > r[1])) return false;
    if (values[field] === v) return false;
    values[field] = v;
    return true;
  }

  function applyJson(text) {
    var obj = JSON.parse(text);
    var changed = false;
    FIELDS.forEach(function (f) {
      if (Object.prototype.hasOwnProperty.call(obj, f) && applyField(f, obj[f])) changed = true;
    });
    if (changed) notify();
    return changed;
  }

  function snapshot() {
    var obj = {};
    FIELDS.forEach(function (f) { obj[f] = values[f]; });
    return obj;
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](values); } catch (e) {}
    }
    try { document.documentElement.setAttribute("data-debounce", values.enabled ? "on" : "off"); } catch (e) {}
  }

  function readLocal() {
    try {
      var text = localStorage.getItem(LKEY);
      if (text === null) return false;
      localSeen = true;
      if (text === lastLocalText) return true;
      lastLocalText = text;
      applyJson(text);
      return true;
    } catch (e) {
      return false;
    }
  }

  function saveLocal(vals) {
    FIELDS.forEach(function (f) {
      if (vals && Object.prototype.hasOwnProperty.call(vals, f)) applyField(f, vals[f]);
    });
    notify();
    var text = JSON.stringify(snapshot());
    try {
      localStorage.setItem(LKEY, text);
      lastLocalText = text;
      localSeen = true;
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.resolve(values);
  }

  // --- optional settings-service fallback ---
  function observer() {
    return (typeof SettingsObserver !== "undefined") ? SettingsObserver : null;
  }
  function settingsReady() {
    var so = observer();
    return !!(so && window.api && so.initiated);
  }
  function loadSettings() {
    if (localSeen || !settingsReady()) return Promise.resolve(values);
    return observer().getBatch(Object.keys(SETTINGS_MAP)).then(function (list) {
      if (localSeen) return values;
      var changed = false;
      (list || []).forEach(function (item) {
        if (!item || item.value === undefined || item.value === "") return;
        if (applyField(SETTINGS_MAP[item.name], item.value)) changed = true;
      });
      if (changed) notify();
      return values;
    }).catch(function () { return values; });
  }
  function watchSettings() {
    if (!settingsReady()) return;
    Object.keys(SETTINGS_MAP).forEach(function (name) {
      observer().observe(name, DEFAULTS[SETTINGS_MAP[name]], function (value) {
        if (!localSeen && applyField(SETTINGS_MAP[name], value)) notify();
      });
    });
  }

  try {
    window.addEventListener("storage", function (e) {
      if (e.key === LKEY) { lastLocalText = null; readLocal(); }
    });
  } catch (e) {}

  setInterval(function () { readLocal(); }, 1000);
  readLocal();

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    if (settingsReady()) {
      clearInterval(timer);
      loadSettings().then(watchSettings);
    } else if (tries > 240) {
      clearInterval(timer);
    }
  }, 250);

  try {
    window.addEventListener("services-load-complete", function () { loadSettings().then(watchSettings); });
  } catch (e) {}

  window.DebounceConfig = {
    DEFAULTS: DEFAULTS,
    FIELDS: FIELDS,
    LKEY: LKEY,
    values: values,
    onChange: function (fn) { listeners.push(fn); return fn; },
    reload: readLocal,
    readLocal: readLocal,
    saveLocal: saveLocal,
  };

  notify();
})();

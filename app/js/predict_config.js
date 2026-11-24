/**
 * predict_config.js — storage for the predictive-mode next-word rules.
 *
 * Store: localStorage key `keyboard.predict.v1` under keyboard.localhost, value
 *   { "enabled": true, "rules": { "4": { "first": "I" }, ... } }
 * written by config.html. A `storage` event applies changes live across
 * documents; a 1 s poll covers anything the event misses.
 *
 * Missing or invalid saved JSON falls back to the built-in defaults. Nothing
 * here ever throws into the keyboard.
 */

(function () {
  "use strict";

  var Core = window.PredictCore;
  if (!Core) return;   // predict_rules.js checks for PredictConfig and stays off

  var LKEY = "keyboard.predict.v1";

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var DEFAULTS = Core.DEFAULTS;
  var values = clone(DEFAULTS);        // mutated in place so references stay live
  var listeners = [];
  var lastText;                        // undefined = never read
  var lastError = null;

  function apply(obj) {
    values.enabled = obj.enabled !== false;
    values.rules = obj.rules;
  }

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](values); } catch (e) {}
    }
  }

  /**
   * Re-read localStorage. Returns true when a valid saved config is in use,
   * false when the built-in defaults are (nothing saved, or saved JSON invalid).
   */
  function readLocal() {
    var text = null;
    try { text = localStorage.getItem(LKEY); } catch (e) {}
    if (text === lastText) return text !== null && !lastError;
    lastText = text;

    var obj = null;
    lastError = null;
    if (text !== null) {
      try {
        obj = JSON.parse(text);
        var err = Core.validate(obj);
        if (err) { lastError = err; obj = null; }
      } catch (e) {
        lastError = "saved JSON does not parse: " + (e && e.message);
        obj = null;
      }
    }
    apply(obj || clone(DEFAULTS));
    notify();
    return obj !== null;
  }

  /** Validate and store { enabled, rules }. Rejects with an Error on bad input. */
  function saveLocal(obj) {
    var err = Core.validate(obj);
    if (err) return Promise.reject(new Error(err));
    var clean = { enabled: obj.enabled !== false, rules: obj.rules };
    var text = JSON.stringify(clean);
    try {
      localStorage.setItem(LKEY, text);
    } catch (e) {
      return Promise.reject(e);
    }
    lastText = text;
    lastError = null;
    apply(clone(clean));
    notify();
    return Promise.resolve(values);
  }

  try {
    window.addEventListener("storage", function (e) {
      if (e.key === LKEY) readLocal();
    });
  } catch (e) {}

  setInterval(readLocal, 1000);
  readLocal();

  window.PredictConfig = {
    LKEY: LKEY,
    DEFAULTS: DEFAULTS,
    values: values,
    validate: Core.validate,
    readLocal: readLocal,
    saveLocal: saveLocal,
    lastError: function () { return lastError; },
    onChange: function (fn) { listeners.push(fn); return fn; },
  };
})();

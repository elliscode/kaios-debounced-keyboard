/**
 * predict_rules.js — apply the user's next-word rules in predictive (T9) mode.
 *
 * Wraps two T9Mode methods (keypad_t9.js is minified stock code; not edited):
 *   - process(t, i): tracks the digits of the word being composed on the
 *     instance (__prDigits), and the previous word, read once when a new word
 *     starts. Flags __prFromProcess so _render knows the call came from a key.
 *   - _render(): when a rule exists for __prDigits, replaces candidates.data
 *     with PredictCore.reorder(...) before the stock _render, which then
 *     dedupes, capitalizes, and makes data[0] the composed default.
 *
 * Arrow keys call process() too (with adaptor.pagination) and re-copy the
 * engine's order, so the reorder runs on every process-driven _render; it is
 * idempotent, so the stock "list unchanged" check still holds and scrolling
 * keeps working. If an arrow brings back a different page, it is left alone.
 *
 * Loaded after keypad_t9.js, predict_core.js and predict_config.js and before
 * keyboard_app.js. On any missing dependency or error it does nothing.
 */

(function () {
  "use strict";

  if (typeof T9Mode === "undefined" || !T9Mode.prototype || T9Mode.__predictInstalled) return;
  var Core = window.PredictCore;
  var Cfg = window.PredictConfig;
  var P = T9Mode.prototype;
  if (!Core || !Cfg || typeof P.process !== "function" || typeof P._render !== "function") return;
  T9Mode.__predictInstalled = true;

  var origProcess = P.process;
  var origRender = P._render;
  var hasOwn = Object.prototype.hasOwnProperty;

  function debugOn() {
    try { return !!(window.DebounceConfig && window.DebounceConfig.values.debug); } catch (e) { return false; }
  }
  function log(msg) { if (debugOn()) { try { console.log("[predict] " + msg); } catch (e) {} } }

  function readPrevWord(t9) {
    // Only called while nothing is composing, so the text before the cursor
    // is committed text. Looking at the tail is enough.
    var text = t9.inputText && t9.inputText.textBeforeCursor;
    if (typeof text !== "string") return null;
    var tail = text.slice(-80);
    var w = Core.prevWordFromText(tail);
    log("word start prev=" + (w === null ? "^" : w) + " text=" + JSON.stringify(tail.slice(-24)));
    return w;
  }

  P.process = function (t, i) {
    try {
      if (!this.isComposing || typeof this.__prDigits !== "string") {
        this.__prDigits = "";
        this.__prSrc = null;
        this.__prPrev = undefined;   // read lazily below, only for digit keys
      }
      if (t === 0 && i >= 48 && i <= 57) {
        if (this.__prPrev === undefined) this.__prPrev = readPrevWord(this);
        this.__prDigits += String.fromCharCode(i);
        this.__prNav = false;
      } else if (t === 0 && i === 8) {
        this.__prDigits = this.__prDigits.slice(0, -1);
        this.__prNav = false;
      } else {
        this.__prNav = true;         // arrow keys: same word, maybe a new page
      }
    } catch (e) {}

    this.__prFromProcess = true;
    try {
      return origProcess.apply(this, arguments);
    } finally {
      this.__prFromProcess = false;
    }
  };

  function needsEscape(list) {
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] === "string" && /[&<>]/.test(list[i])) return true;
    }
    return false;
  }

  // Stock _render builds the strip with innerHTML, so a word like "D&D" or
  // "<3" is parsed as HTML. Re-set the text of each item from the raw data
  // (the composed/committed text always comes from data, so it is unaffected).
  function fixStripText(t9) {
    var data = t9.candidates.data;
    var sc = t9.scrollable;
    if (!sc || !needsEscape(data)) return;
    var kids = sc.children;
    if (kids.length === data.length) {
      for (var i = 0; i < data.length; i++) {
        if (kids[i].textContent !== data[i]) kids[i].textContent = data[i];
      }
      if (typeof t9._scroll === "function") t9._scroll();
      return;
    }
    // innerHTML produced a different number of items: rebuild, then refocus.
    sc.textContent = "";
    data.forEach(function (w) {
      var span = document.createElement("span");
      span.className = "candidates-item";
      span.textContent = w;
      sc.appendChild(span);
    });
    if (typeof t9._focus === "function") t9._focus();
  }

  P._render = function () {
    var applied = false;
    if (this.__prFromProcess) {
      try {
        var V = Cfg.values;
        var d = this.__prDigits;
        if (V && V.enabled && V.rules && d && hasOwn.call(V.rules, d) &&
            !this.isTwoLevel && !this.needsCombination && !this.isSuggesting) {
          var src = this.candidates.data;
          if (Array.isArray(src) && src.length) {
            var srcKey = JSON.stringify(src);
            if (!this.__prNav) this.__prSrc = srcKey;
            if (!this.__prNav || srcKey === this.__prSrc) {
              var out = Core.reorder(src, d, this.__prPrev, V.rules);
              log("digits=" + d + " prev=" + (this.__prPrev == null ? "^" : this.__prPrev) +
                  " in=" + srcKey + " out=" + (out === src ? "(unchanged)" : JSON.stringify(out)));
              if (out !== src) this.candidates.data = out;   // new array; the adaptor's stays intact
              applied = true;
            }
          }
        }
      } catch (e) {
        log("error " + (e && e.message));
      }
    }

    var result = origRender.apply(this, arguments);

    if (applied && result) {
      try { fixStripText(this); } catch (e) {}
    }
    return result;
  };
})();

/**
 * debounce.js — live key-bounce filter for the Nokia 2780 keyboard.
 *
 * Wraps Keypad.prototype.handleKeyEvent (the single entry point registered for
 * keydown/keypress/keyup in Keypad._monitor) and drops ghost key presses before
 * the keyboard ever sees them. Prediction is handled separately (predict_*.js).
 *
 * Loaded from index.html AFTER keypad.js and before keyboard_app.js, so
 * `Keypad` exists and no Keypad instance has been created yet.
 *
 * Decision logic lives in debounce_core.js (window.DebounceCore) so it is shared
 * with the offline test harness. This file only handles the live event flow:
 *   - keydown with a hard-bounce gap (< GAP_HARD): dropped immediately.
 *   - keydown in the soft window (GAP_HARD..GAP_SOFT): held for up to HOLD_SHORT
 *     ms. If keyup arrives first it was a short contact -> bounce, both dropped.
 *     If the timer fires first it is a real (possibly long) press -> delivered.
 *   - everything else: passed straight through.
 * The same-key cooldown (down-to-down) runs first, per input mode
 * (COOLDOWN_T9 / _Abc / _abc / _ABC / _123, from keypad.inputMode).
 * Enter (Select) gets only its own cooldown, SELECT_COOLDOWN: a bounced second
 * Enter would otherwise reach the app (e.g. send the SMS) after the first one
 * committed the T9 word.
 * handleKeyEvent only reads event.type, event.key and event.preventDefault(), and
 * ignores keypress entirely (its switch has only keydown/keyup), so a deferred
 * press can be replayed with a minimal synthetic event.
 */

// Boot helper, independent of the filter below.
//
// The phone can keep running a cached copy of index.html after a redeploy,
// while the files that page loads (this one included) are fetched fresh. So
// anything new must not depend on index.html being current:
//   - the build marker (soft pink candidate bar) is added from here, so a pink
//     bar means THIS build's JS is live;
//   - if the page doesn't list the predict scripts (old cached index.html),
//     they are loaded from here. predict_rules.js patches T9Mode.prototype,
//     which works even after the T9Mode instance exists.
// One console line per boot says which case happened.
(function () {
  "use strict";
  try {
    if (!document.getElementById("kb-build-marker")) {
      var st = document.createElement("style");
      st.id = "kb-build-marker";
      st.textContent =
        "#candidates{background:#f4d9e3 !important;border-top:2px solid #d99ab2 !important}" +
        "#candidates .candidates-item,#candidates-scrollable{color:#3b1f2b !important}" +
        "#candidates .candidates-item.current,#candidates .candidates-item:focus{color:#ffffff !important}";
      (document.head || document.documentElement).appendChild(st);
    }
    var listed = !!document.querySelector('script[src*="predict_rules.js"]');
    if (!listed && !window.PredictCore) {
      ["js/predict_core.js", "js/predict_config.js", "js/predict_rules.js"].forEach(function (src) {
        var s = document.createElement("script");
        s.src = src;
        s.async = false;   // run in this order
        (document.head || document.documentElement).appendChild(s);
      });
    }
    console.log("[debounce] boot: marker on; index.html " +
      (listed ? "is current" : "is a stale cached copy, loading predict scripts from debounce.js"));
  } catch (e) {}
})();

(function () {
  "use strict";

  if (typeof Keypad === "undefined" || !Keypad.prototype || Keypad.__debounceInstalled) {
    return;
  }
  Keypad.__debounceInstalled = true;

  var Core = (typeof window !== "undefined" && window.DebounceCore) || null;
  if (!Core) {
    // Core failed to load — do nothing rather than break the keyboard.
    return;
  }

  // Runtime tunables. FALLBACK is used until the settings service answers;
  // DebounceConfig.values (settings keys keyboard.debounce.*) takes over after
  // that and can change live from http://keyboard.localhost/config.html.
  var FALLBACK = Object.assign({}, Core.DEFAULTS, {
    enabled: true,
    GAP_HARD: 45,
    GAP_SOFT: 60,
    HOLD_SHORT: 30,
    COOLDOWN: 110,
    COOLDOWN_T9: 110,
    COOLDOWN_Abc: 110,
    COOLDOWN_abc: 110,
    COOLDOWN_ABC: 110,
    COOLDOWN_123: 110,
    SELECT_COOLDOWN: 1000,
    showMarker: false,
    debug: false,
  });

  function opts() {
    return (typeof window !== "undefined" && window.DebounceConfig &&
            window.DebounceConfig.values) || FALLBACK;
  }

  // Keys that get the full gap/soft-window/cooldown treatment. Select (Enter)
  // is handled separately with a cooldown only (see handleEnter); Call/EndCall,
  // soft keys and other pass-through keys are never dropped.
  // Backspace-on-empty is handled below.
  var DEBOUNCE_KEYS = {
    "0": 1, "1": 1, "2": 1, "3": 1, "4": 1, "5": 1, "6": 1, "7": 1, "8": 1, "9": 1,
    "*": 1, "#": 1, "Backspace": 1,
    "ArrowUp": 1, "ArrowDown": 1, "ArrowLeft": 1, "ArrowRight": 1,
  };

  function now(ev) {
    // event.timeStamp is a DOMHighResTimeStamp in ms. Fall back to Date.now().
    var t = ev && typeof ev.timeStamp === "number" ? ev.timeStamp : Date.now();
    return t;
  }

  // Same-key cooldown for the keypad's current input mode. Unknown modes
  // (spell mode, other languages' icon modes) use the legacy COOLDOWN, then 110.
  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function cooldownFor(keypad, O) {
    var mode = keypad && keypad.inputMode;
    var v = mode ? num(O["COOLDOWN_" + mode]) : null;
    if (v === null) v = num(O.COOLDOWN);
    return v === null ? 110 : v;
  }

  var orig = Keypad.prototype.handleKeyEvent;
  var lastKeypad = null;   // for paint(): the marker colour follows the mode

  function log(msg) { if (opts().debug) { try { console.log("[debounce] " + msg); } catch (e) {} } }

  Keypad.prototype.handleKeyEvent = function (ev) {
    var keypad = this;
    var key = ev && ev.key;
    var type = ev && ev.type;
    var O = opts();

    // Per-instance state, created lazily so we never touch other instances.
    var st = keypad.__dbState || (keypad.__dbState = {
      lastKeptUp: Object.create(null), // key -> ms timestamp of last kept keyup
      lastKeptDown: Object.create(null), // key -> ms timestamp of last kept keydown
      enterDown: null,                 // ms timestamp of last kept Enter keydown
      enterDisp: null,                 // 'deliver' | 'drop' for the current Enter
      disp: Object.create(null),       // key -> 'deliver' | 'drop' | 'defer'
      downTs: Object.create(null),     // key -> ms timestamp of held keydown
      timer: Object.create(null),      // key -> setTimeout id for the soft window
    });

    if (key === "Enter" && O.enabled) {
      return handleEnter(keypad, ev, st, O);
    }

    // Not a debounced key, or filter off: behave exactly like stock.
    if (!O.enabled || !DEBOUNCE_KEYS[key]) {
      return orig.call(keypad, ev);
    }

    // Backspace when the field is empty falls through to the system as Back;
    // never interfere with that.
    if (key === "Backspace" && typeof keypad.isInputEmpty === "function" && keypad.isInputEmpty()) {
      return orig.call(keypad, ev);
    }

    function deliver(evt) { return orig.call(keypad, evt); }
    function deferredDown(ts) {
      return { type: "keydown", key: key, timeStamp: ts, preventDefault: function () {} };
    }
    function clearTimer() {
      if (st.timer[key]) { clearTimeout(st.timer[key]); st.timer[key] = 0; }
    }

    if (type === "keydown") {
      var ts = now(ev);
      var prevUp = st.lastKeptUp[key];
      var prevDown = st.lastKeptDown[key];
      var gap = prevUp == null ? Infinity : ts - prevUp;

      if (lastKeypad !== keypad || paintedMode !== keypad.inputMode) { lastKeypad = keypad; paint(); }

      // Exact same-key rate limit: drop a repeat whose down is within the
      // current mode's cooldown of the previous kept down for this key.
      // Independent of hold time.
      var cd = cooldownFor(keypad, O);
      if (cd > 0 && prevDown != null && ts - prevDown < cd) {
        st.disp[key] = "drop";
        ev.preventDefault();
        log("cooldown drop " + key + " dt=" + (ts - prevDown).toFixed(0));
        return;
      }

      if (gap < O.GAP_HARD) {
        // Hard bounce: drop the whole press.
        st.disp[key] = "drop";
        ev.preventDefault();
        log("drop keydown " + key + " gap=" + gap.toFixed(0));
        return;
      }

      if (gap < O.GAP_SOFT) {
        // Soft window: hold it. If it is released within HOLD_SHORT ms it is a
        // bounce; otherwise deliver it late (still counts as a real/long press).
        st.disp[key] = "defer";
        st.downTs[key] = ts;
        ev.preventDefault();
        clearTimer();
        st.timer[key] = setTimeout(function () {
          st.timer[key] = 0;
          if (st.disp[key] === "defer") {
            st.disp[key] = "deliver";
            st.lastKeptDown[key] = ts;
            st.lastKeptUp[key] = ts; // provisional; refined on keyup
            log("promote keydown " + key + " (held >= " + O.HOLD_SHORT + "ms)");
            deliver(deferredDown(ts));
          }
        }, O.HOLD_SHORT);
        log("defer keydown " + key + " gap=" + gap.toFixed(0));
        return;
      }

      // Normal press.
      st.disp[key] = "deliver";
      st.downTs[key] = ts;
      st.lastKeptDown[key] = ts;
      log("deliver keydown " + key + " gap=" + (gap === Infinity ? "inf" : gap.toFixed(0)));
      return deliver(ev);
    }

    if (type === "keypress") {
      // handleKeyEvent ignores keypress anyway; only pass it through for a
      // delivered press, swallow it otherwise.
      if (st.disp[key] === "deliver") return deliver(ev);
      ev.preventDefault();
      return;
    }

    if (type === "keyup") {
      var disp = st.disp[key];

      if (disp === "drop") {
        st.disp[key] = null;
        ev.preventDefault();
        log("swallow keyup " + key + " (dropped press)");
        return;
      }

      if (disp === "defer") {
        // keyup beat the timer => short contact => bounce. Drop both.
        clearTimer();
        st.disp[key] = null;
        ev.preventDefault();
        log("drop soft press " + key + " (released < " + O.HOLD_SHORT + "ms)");
        return;
      }

      // disp === 'deliver' (either a normal press, or a promoted deferred one).
      var upTs = now(ev);
      st.lastKeptUp[key] = upTs;
      st.disp[key] = null;

      // If this was a deferred press that the timer already delivered the down
      // for, the keydown is live in the app; just deliver the matching keyup.
      return deliver(ev);
    }

    // Any other type: pass through untouched.
    return orig.call(keypad, ev);
  };

  // Select (Enter): cooldown only, no gap/soft-window rules, never deferred.
  // Drop a keydown within SELECT_COOLDOWN ms of the last kept Enter keydown,
  // and swallow its keypress/keyup. Same value in every input mode; 0 = off.
  function handleEnter(keypad, ev, st, O) {
    var type = ev.type;
    if (type === "keydown") {
      var ts = now(ev);
      var sc = num(O.SELECT_COOLDOWN);
      if (sc === null) sc = 1000;
      if (sc > 0 && st.enterDown != null && ts - st.enterDown < sc) {
        st.enterDisp = "drop";
        ev.preventDefault();
        log("select cooldown drop dt=" + (ts - st.enterDown).toFixed(0));
        return;
      }
      st.enterDisp = "deliver";
      st.enterDown = ts;
      return orig.call(keypad, ev);
    }
    if (st.enterDisp === "drop" && (type === "keypress" || type === "keyup")) {
      if (type === "keyup") st.enterDisp = null;
      ev.preventDefault();
      return;
    }
    if (type === "keyup") st.enterDisp = null;
    return orig.call(keypad, ev);
  }

  var paintedMode;
  function paint() {
    try {
      var O = opts();
      var cd = cooldownFor(lastKeypad, O);
      paintedMode = lastKeypad && lastKeypad.inputMode;
      document.documentElement.setAttribute("data-debounce-js", "1");
      document.documentElement.setAttribute("data-debounce-cd", cd > 0 ? "on" : "off");
      var el = document.getElementById("candidates");
      if (el) {
        el.style.borderLeft = O.showMarker
          ? ("10px solid " + (cd > 0 ? "#00ff66" : "#ffd400"))
          : "";
      }
    } catch (e) {}
  }
  paint();
  try { if (window.DebounceConfig && DebounceConfig.onChange) DebounceConfig.onChange(paint); } catch (e) {}
})();

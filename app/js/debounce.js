/**
 * debounce.js — live key-bounce filter for the Nokia 2780 keyboard.
 *
 * Wraps Keypad.prototype.handleKeyEvent (the single entry point registered for
 * keydown/keypress/keyup in Keypad._monitor) and drops ghost key presses before
 * the keyboard ever sees them. Prediction (TouchPal) is left completely alone.
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
 * handleKeyEvent only reads event.type, event.key and event.preventDefault(), and
 * ignores keypress entirely (its switch has only keydown/keyup), so a deferred
 * press can be replayed with a minimal synthetic event.
 */

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
    LONE_HOLD: 15,
    COOLDOWN: 100,
    dropLoneShort: false,
    showMarker: false,
    debug: false,
  });

  function opts() {
    return (typeof window !== "undefined" && window.DebounceConfig &&
            window.DebounceConfig.values) || FALLBACK;
  }

  // Only debounce keys that actually chatter / are safe to debounce. Select
  // (Enter) sends the SMS and was clean in every sample; Call/EndCall and other
  // pass-through keys must never be dropped. Backspace-on-empty is handled below.
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

  var orig = Keypad.prototype.handleKeyEvent;

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
      disp: Object.create(null),       // key -> 'deliver' | 'drop' | 'defer'
      downTs: Object.create(null),     // key -> ms timestamp of held keydown
      timer: Object.create(null),      // key -> setTimeout id for the soft window
    });

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

      // Exact same-key rate limit: drop a repeat whose down is within COOLDOWN
      // ms of the previous kept down for this key. Independent of hold time.
      if (O.COOLDOWN > 0 && prevDown != null && ts - prevDown < O.COOLDOWN) {
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

  function paint() {
    try {
      var O = opts();
      document.documentElement.setAttribute("data-debounce-js", "1");
      document.documentElement.setAttribute("data-debounce-cd", O.COOLDOWN > 0 ? "on" : "off");
      var el = document.getElementById("candidates");
      if (el) {
        el.style.borderLeft = O.showMarker
          ? ("10px solid " + (O.COOLDOWN > 0 ? "#00ff66" : "#ffd400"))
          : "";
      }
    } catch (e) {}
  }
  paint();
  try { if (window.DebounceConfig && DebounceConfig.onChange) DebounceConfig.onChange(paint); } catch (e) {}
})();

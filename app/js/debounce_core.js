/**
 * debounce_core.js — pure, testable debounce decision logic for the 2780 keyboard.
 *
 * One source of truth shared by:
 *   - debounce.js        (the live wrapper around Keypad.prototype.handleKeyEvent)
 *   - tools/test_debounce.mjs (replays the getevent logs in keylogs/)
 *
 * The rule (from RECON.md, sessions 1-13). For each key, compare a new press
 * against the last press of that key that was KEPT:
 *   gap  = thisDown - lastKeptUp   (ms; Infinity if no prior kept press)
 *   hold = thisUp   - thisDown     (ms)
 *   - gap < GAP_HARD (45)                      -> bounce, drop.
 *   - GAP_HARD <= gap < GAP_SOFT (60) AND
 *       hold < HOLD_SHORT (30)                 -> bounce, drop.
 *   - otherwise                                -> real press, keep.
 * Optional (off by default): drop a lone contact held < LONE_HOLD (15) ms.
 *
 * No DOM, no timers, no globals here. Works in the browser and in Node.
 */

(function (root) {
  "use strict";

  var DEFAULTS = {
    enabled: true,
    GAP_HARD: 45,   // ms: same-key gap below this is always a bounce
    GAP_SOFT: 60,   // ms: between HARD and SOFT, only a bounce if the hold is short
    HOLD_SHORT: 30, // ms: "short" hold used by the soft-gap clause
    dropLoneShort: false,
    LONE_HOLD: 15,  // ms: a lone contact shorter than this is dropped when the flag is on
  };

  /**
   * Decide a single press given its gap (from the last KEPT up of the same key)
   * and its hold. gap may be null/Infinity when there is no prior kept press.
   * Returns true to KEEP, false to DROP.
   */
  function keepPress(gap, hold, opts) {
    opts = opts || DEFAULTS;
    if (!opts.enabled) return true;
    if (gap == null) gap = Infinity;

    if (gap < opts.GAP_HARD) return false;
    if (gap < opts.GAP_SOFT && hold != null && hold < opts.HOLD_SHORT) return false;
    if (opts.dropLoneShort && hold != null && hold < opts.LONE_HOLD && !(gap < opts.GAP_SOFT)) {
      // A short, isolated contact (no near same-key neighbour) — a leading ghost.
      return false;
    }
    return true;
  }

  /**
   * Replay a time-ordered list of presses for ONE logical key stream and tag each
   * as kept/dropped. Each press is { key, down, up } with times in SECONDS
   * (getevent units); gaps/holds are computed in ms. gap is measured against the
   * last KEPT press of the same key, which is the whole point — a dropped ghost
   * must not become the reference for the next press.
   *
   * Returns the same array with { hold, gap, kept } added.
   */
  function filterPresses(presses, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    var lastKeptUp = Object.create(null); // key -> seconds
    var out = [];
    for (var i = 0; i < presses.length; i++) {
      var p = presses[i];
      if (p.down == null || p.up == null) { // orphan contact: keep, can't debounce
        out.push(Object.assign({}, p, { hold: null, gap: null, kept: true }));
        continue;
      }
      var hold = (p.up - p.down) * 1000;
      var prevUp = lastKeptUp[p.key];
      var gap = prevUp == null ? Infinity : (p.down - prevUp) * 1000;
      var kept = keepPress(gap, hold, opts);
      if (kept) lastKeptUp[p.key] = p.up;
      out.push(Object.assign({}, p, { hold: hold, gap: gap, kept: kept }));
    }
    return out;
  }

  var api = { DEFAULTS: DEFAULTS, keepPress: keepPress, filterPresses: filterPresses };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;            // Node (test harness)
  } else {
    root.DebounceCore = api;         // browser (debounce.js reads window.DebounceCore)
  }
})(typeof window !== "undefined" ? window : this);

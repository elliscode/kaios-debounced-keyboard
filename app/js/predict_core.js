/**
 * predict_core.js — pure, testable next-word rules for predictive (T9) mode.
 *
 * Shared by:
 *   - predict_rules.js        (the live wrapper around T9Mode)
 *   - js/config.js            (the test box on config.html)
 *   - tools/test_predict.mjs  (Node tests)
 *
 * A rule set maps a digit sequence to a rule:
 *   { "4":    { "first": "I" },
 *     "4663": { "home": ["headed", "going"], "good": ["very", "so"] } }
 *   - "first": always put that word at the front (inserted if TouchPal lacks it).
 *   - any other key: a candidate word -> list of "before words". If the previous
 *     word is in the list, that candidate goes to the front. The first matching
 *     entry (in rule order) wins; "first" beats all of them.
 *   - before-word "^" means "no previous word" (start of the field, or a
 *     . ! ? or newline between the previous word and the cursor).
 *
 * No DOM, no timers, no globals here. Works in the browser and in Node.
 */

(function (root) {
  "use strict";

  var DEFAULTS = {
    enabled: true,
    rules: {
      "4":    { "first": "I" },
      "463":  { "first": "god" },
      "9292": { "first": "wawa" },
      "43": {
        "he": ["said", "when", "because", "then", "think", "hope", "until", "and", "but"],
        "if": ["even", "as", "see", "what", "only", "check", "ask", "wonder", "matter"]
      },
      "46": {
        "I'm": ["^", "and", "but", "because", "think", "guess", "hope", "now"],
        "go":  ["to", "let's", "lets", "can", "will", "should", "gotta", "wanna", "must", "i'll", "could"],
        "in":  ["come", "get", "is", "was", "be", "log", "sign", "check", "live", "put", "plug", "all", "back"]
      },
      "4663": {
        "home": ["headed", "heading", "head", "going", "went", "back", "at", "get", "got", "getting", "come", "came", "coming", "walking", "walked", "driving", "drove", "way"],
        "good": ["very", "so", "pretty", "a", "looks", "feel", "feels", "is", "too"]
      },
      "66": {
        "no": ["^", "oh", "say", "said", "says", "there's", "theres", "have", "had", "has", "got", "with", "means", "yes", "or", "absolutely", "definitely", "almost", "no"],
        "on": ["come", "hold", "turn", "turned", "put", "going", "based", "depends", "rely", "count", "log", "logged", "sign", "keep", "go", "goes", "went", "right", "click", "tap", "sit", "work", "working", "focus", "agree", "comment", "catch", "move", "moving", "carry", "and", "so", "early", "later", "out", "back", "it's", "its", "still"]
      },
      "363": {
        "D&D": ["play", "playing", "played", "plays", "our", "run", "running", "ran", "dm", "dming", "love", "about", "weekly", "some", "more", "tonight's"]
      },
      "64448": {
        "might": ["i", "you", "we", "they", "he", "she", "it", "that", "this", "which", "who", "there", "and"],
        "night": ["last", "good", "every", "all", "one", "the", "a", "at", "late", "tomorrow", "date", "movie", "game", "friday", "saturday", "sunday", "monday", "tuesday", "wednesday", "thursday"]
      }
    }
  };

  var NONE = "^";
  var hasOwn = Object.prototype.hasOwnProperty;

  // Letters (ASCII + Latin-1/Latin Extended, for Spanish etc.) and apostrophes.
  var WORD_TAIL = /([A-Za-zÀ-ɏ']+)([^A-Za-zÀ-ɏ']*)$/;

  function fixQuotes(s) { return String(s).replace(/[‘’]/g, "'"); }

  /** Case-insensitive key for a candidate word ("I'm" -> "i'm", "D&D" -> "d&d"). */
  function wordKey(w) { return fixQuotes(w).toLowerCase(); }

  /**
   * Normalize a previous word / before-word for comparison: lowercase, outer
   * punctuation stripped, inner apostrophes kept. Empty / null / "^" -> "^".
   */
  function prevKey(p) {
    if (p == null) return NONE;
    var s = fixQuotes(p).toLowerCase()
      .replace(/^[^a-z0-9À-ɏ']+|[^a-z0-9À-ɏ']+$/g, "")
      .replace(/^'+|'+$/g, "");
    return s || NONE;
  }

  /**
   * The word before the cursor, from the text before the cursor (which must not
   * include the word being composed). null means "no previous word": empty
   * field, or a . ! ? or newline between the last word and the cursor.
   */
  function prevWordFromText(text) {
    if (!text) return null;
    var m = WORD_TAIL.exec(fixQuotes(text));
    if (!m) return null;
    if (/[.!?\n]/.test(m[2])) return null;
    var w = m[1].replace(/^'+|'+$/g, "");
    return w || null;
  }

  /** Which word the rule wants in front for this previous word, or null. */
  function pickTarget(rule, prevWord) {
    if (typeof rule.first === "string" && rule.first) return rule.first;
    var p = prevKey(prevWord);
    for (var word in rule) {
      if (!hasOwn.call(rule, word) || word === "first") continue;
      var list = rule[word];
      if (!Array.isArray(list)) continue;
      for (var i = 0; i < list.length; i++) {
        if (prevKey(list[i]) === p) return word;
      }
    }
    return null;
  }

  /**
   * Reorder TouchPal's candidate list for the given digit sequence.
   * Returns the SAME array when nothing applies, else a new array (the input
   * is never mutated). Idempotent: reorder(reorder(x)) equals reorder(x).
   */
  function reorder(candidates, digits, prevWord, rules) {
    if (!rules || !Array.isArray(candidates) || !hasOwn.call(rules, digits)) return candidates;
    var rule = rules[digits];
    if (!rule || typeof rule !== "object") return candidates;

    var target = pickTarget(rule, prevWord);
    if (!target) return candidates;

    var key = wordKey(target);
    var existing = null;
    var rest = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (typeof c === "string" && wordKey(c) === key) {
        if (existing === null) existing = c;   // drop every case-insensitive duplicate
      } else {
        rest.push(c);
      }
    }
    // A rule word written with capitals ("I", "I'm", "D&D") is deliberate and
    // wins; an all-lowercase rule word keeps TouchPal's casing when offered.
    var word = (target !== target.toLowerCase() || existing === null) ? target : existing;
    if (rest.length === candidates.length - 1 && candidates[0] === word) return candidates;
    return [word].concat(rest);
  }

  /**
   * Check a { enabled, rules } object. Returns null when valid, otherwise a
   * human-readable error string.
   */
  function validate(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "top level must be an object like {\"enabled\": true, \"rules\": {...}}";
    if (hasOwn.call(obj, "enabled") && typeof obj.enabled !== "boolean") return "\"enabled\" must be true or false";
    var rules = obj.rules;
    if (!rules || typeof rules !== "object" || Array.isArray(rules)) return "\"rules\" must be an object mapping digits to rules";
    for (var digits in rules) {
      if (!hasOwn.call(rules, digits)) continue;
      var where = "rules[\"" + digits + "\"]";
      if (!/^[0-9]+$/.test(digits)) return where + ": the key must be digits only (0-9)";
      var rule = rules[digits];
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return where + " must be an object";
      var n = 0;
      for (var word in rule) {
        if (!hasOwn.call(rule, word)) continue;
        n++;
        var v = rule[word];
        if (word === "first") {
          if (typeof v !== "string" || !v.trim()) return where + ".first must be a non-empty string";
          continue;
        }
        if (!word.trim()) return where + ": candidate words must not be empty";
        if (!Array.isArray(v)) return where + "[\"" + word + "\"] must be an array of previous words, e.g. [\"very\", \"so\"]";
        for (var i = 0; i < v.length; i++) {
          if (typeof v[i] !== "string" || !v[i].trim()) return where + "[\"" + word + "\"][" + i + "] must be a non-empty string (use \"^\" for no previous word)";
        }
      }
      if (!n) return where + " is empty";
    }
    return null;
  }

  var api = {
    DEFAULTS: DEFAULTS,
    NONE: NONE,
    reorder: reorder,
    validate: validate,
    prevWordFromText: prevWordFromText,
    prevKey: prevKey,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;            // Node (tests)
  } else {
    root.PredictCore = api;          // browser
  }
})(typeof window !== "undefined" ? window : this);

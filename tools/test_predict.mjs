// test_predict.mjs — plain-Node tests for app/js/predict_core.js.
// Run: node tools/test_predict.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const Core = require(join(ROOT, "app/js/predict_core.js"));
const { reorder, validate, prevWordFromText, DEFAULTS } = Core;
const R = DEFAULTS.rules;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message.split("\n").join("\n     ")); }
}
const ro = (list, digits, prev) => reorder(list, digits, prev, R);

// --- reorder ---------------------------------------------------------------
test("4: I first", () => assert.deepEqual(ro(["g", "h", "i"], "4", null), ["I", "g", "h"]));
test("4: no duplicate I/i", () => assert.deepEqual(ro(["g", "h", "i", "I"], "4", "so"), ["I", "g", "h"]));
test("4663 prev headed -> home", () => assert.deepEqual(ro(["good", "home", "gone", "hood"], "4663", "headed"), ["home", "good", "gone", "hood"]));
test("4663 prev very -> good", () => assert.deepEqual(ro(["home", "good", "gone", "hood"], "4663", "very"), ["good", "home", "gone", "hood"]));
test("4663 prev the -> unchanged", () => {
  const list = ["good", "home", "gone", "hood"];
  assert.equal(ro(list, "4663", "the"), list);
});
test("463 -> god", () => assert.deepEqual(ro(["hoe", "god", "ice"], "463", null), ["god", "hoe", "ice"]));
test("9292 -> wawa inserted", () => assert.deepEqual(ro(["wax", "yaw"], "9292", "a"), ["wawa", "wax", "yaw"]));
test("46 no prev (^) -> I'm inserted", () => assert.deepEqual(ro(["in", "go", "im"], "46", null), ["I'm", "in", "go", "im"]));
test("46 no prev (^) -> I'm moved, TouchPal i'm deduped", () => assert.deepEqual(ro(["in", "i'm", "go"], "46", "^"), ["I'm", "in", "go"]));
test("46 prev to -> go", () => assert.deepEqual(ro(["in", "go", "im"], "46", "to"), ["go", "in", "im"]));
test("46 prev come -> in", () => assert.deepEqual(ro(["go", "in", "im"], "46", "come"), ["in", "go", "im"]));
test("46 prev the -> unchanged", () => { const l = ["in", "go"]; assert.equal(ro(l, "46", "the"), l); });
test("43 prev said -> he", () => assert.deepEqual(ro(["if", "he", "id"], "43", "said"), ["he", "if", "id"]));
test("43 prev even -> if", () => assert.deepEqual(ro(["he", "if", "id"], "43", "even"), ["if", "he", "id"]));
test("363 prev play -> D&D", () => assert.deepEqual(ro(["end", "doe"], "363", "play"), ["D&D", "end", "doe"]));
test("363 prev the -> unchanged", () => { const l = ["end", "doe"]; assert.equal(ro(l, "363", "the"), l); });
test("66 start (^) -> no", () => assert.deepEqual(ro(["on", "no", "mo"], "66", null), ["no", "on", "mo"]));
test("66 prev there's -> no", () => assert.deepEqual(ro(["on", "no"], "66", "there's"), ["no", "on"]));
test("66 prev come -> on", () => assert.deepEqual(ro(["no", "on"], "66", "come"), ["on", "no"]));
test("64448 prev I (capital) -> might", () => assert.deepEqual(ro(["night", "might"], "64448", "I"), ["might", "night"]));
test("64448 prev last -> night", () => assert.deepEqual(ro(["might", "night"], "64448", "last"), ["night", "might"]));
test("no rule -> same array", () => { const l = ["in", "go"]; assert.equal(ro(l, "4466", "x"), l); assert.deepEqual(l, ["in", "go"]); });
test("input is never mutated", () => { const l = ["g", "h", "i"]; ro(l, "4", null); assert.deepEqual(l, ["g", "h", "i"]); });
test("idempotent (arrow keys re-run it)", () => {
  for (const [list, d, p] of [[["g", "h", "i", "I"], "4", null], [["good", "home"], "4663", "headed"], [["wax"], "9292", null], [["end"], "363", "play"], [["in", "go"], "46", null]]) {
    const once = ro(list, d, p);
    const twice = ro(once, d, p);
    assert.deepEqual(twice, once, d);
    assert.equal(twice, once, d + " (already ordered -> same array)");
  }
});
test("first beats context rules", () => {
  const rules = { "46": { first: "go", "in": ["come"] } };
  assert.deepEqual(reorder(["in", "go"], "46", "come", rules), ["go", "in"]);
});
test("first matching context word in rule order wins", () => {
  const rules = { "46": { "go": ["x"], "in": ["x"] } };
  assert.deepEqual(reorder(["in", "go"], "46", "x", rules), ["go", "in"]);
});
test("lowercase rule word keeps TouchPal casing", () => {
  assert.deepEqual(reorder(["hoe", "God"], "463", null, R), ["God", "hoe"]);
});
test("prev word punctuation / curly apostrophe", () => {
  assert.deepEqual(ro(["on", "no"], "66", "There’s"), ["no", "on"]);
  assert.deepEqual(ro(["no", "on"], "66", "\"come,"), ["on", "no"]);
});

// --- prevWordFromText ------------------------------------------------------
test("prevWordFromText", () => {
  assert.equal(prevWordFromText(""), null);
  assert.equal(prevWordFromText("headed "), "headed");
  assert.equal(prevWordFromText("I'm headed"), "headed");
  assert.equal(prevWordFromText("there's "), "there's");
  assert.equal(prevWordFromText("Hello, "), "Hello");
  assert.equal(prevWordFromText("Done. "), null);
  assert.equal(prevWordFromText("Really?"), null);
  assert.equal(prevWordFromText("line one\n"), null);
  assert.equal(prevWordFromText("go 123 "), "go");
  assert.equal(prevWordFromText("'quoted' "), "quoted");
});

// --- validate --------------------------------------------------------------
test("defaults are valid", () => assert.equal(validate(DEFAULTS), null));
test("profiles/predict.json matches the built-in defaults", () => {
  const file = JSON.parse(readFileSync(join(ROOT, "profiles/predict.json"), "utf8"));
  assert.equal(validate(file), null);
  assert.deepEqual(file, DEFAULTS);
});
test("validate rejects bad input with a message", () => {
  const bad = [
    null, [], { rules: [] }, { enabled: "yes", rules: {} },
    { rules: { "4a": { first: "I" } } },
    { rules: { "4": { first: 1 } } },
    { rules: { "4": { first: "" } } },
    { rules: { "4": "I" } },
    { rules: { "4": {} } },
    { rules: { "46": { go: "to" } } },
    { rules: { "46": { go: ["to", 3] } } },
    { rules: { "46": { go: [""] } } },
  ];
  for (const b of bad) {
    const err = validate(b);
    assert.equal(typeof err, "string", JSON.stringify(b));
    assert.ok(err.length > 5);
  }
  assert.equal(validate({ rules: { "46": { "I'm": ["^"] } } }), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

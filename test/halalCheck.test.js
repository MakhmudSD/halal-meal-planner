const test = require("node:test");
const assert = require("node:assert/strict");
const { checkMealsAgainstFlags } = require("../lib/halalCheck");

function meal(ingredients, name = "Test Meal") {
  return [{ name, ingredients }];
}

function termsOf(hits) {
  return hits.map((h) => h.term);
}

test("word-boundary matching: does not false-positive on substrings", () => {
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["hamburger patty"]))), []);
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["toasted breadcrumb topping"]))), []);
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["meatless crumbles"]))), []);
});

test("word-boundary matching: still catches the real term as a standalone word", () => {
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["ham sandwich"]))), ["ham"]);
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["dark rum glaze"]))), ["rum"]);
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["diced meat"]))), ["meat"]);
});

test("haram terms are never resolved by a sourcing qualifier", () => {
  const hits = checkMealsAgainstFlags(meal(["halal-certified pork loin"]));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].term, "pork");
  assert.equal(hits[0].status, "haram");
});

test("mashbooh terms are resolved by halal-certified or zabiha qualifiers", () => {
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["halal-certified chicken breast"]))), []);
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["zabiha beef chuck"]))), []);
});

test("mashbooh terms are NOT resolved by the bare word 'halal' alone", () => {
  const hits = checkMealsAgainstFlags(meal(["halal chicken breast"]));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].term, "chicken");
  assert.equal(hits[0].status, "mashbooh");
});

test("mashbooh terms with no qualifier at all are flagged", () => {
  const hits = checkMealsAgainstFlags(meal(["ground beef"]));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].term, "beef");
  assert.equal(hits[0].status, "mashbooh");
});

test("'<term>-free' / '<term> free' negates a flag regardless of haram/mashbooh status", () => {
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["alcohol-free vanilla extract"]))), []);
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["alcohol free vanilla extract"]))), []);
});

test("compound-safe phrases suppress only their specific term", () => {
  assert.deepEqual(termsOf(checkMealsAgainstFlags(meal(["ice-cold root beer"]))), []);

  const beefBaconHits = checkMealsAgainstFlags(meal(["2 strips beef bacon"]));
  assert.deepEqual(termsOf(beefBaconHits), ["beef"]);
  assert.equal(beefBaconHits[0].status, "mashbooh");

  const turkeyBaconHits = checkMealsAgainstFlags(meal(["turkey bacon strips"]));
  assert.deepEqual(termsOf(turkeyBaconHits), ["turkey"]);

  const chickenBaconHits = checkMealsAgainstFlags(meal(["chicken bacon crumbles"]));
  assert.deepEqual(termsOf(chickenBaconHits), ["chicken"]);
});

test("real pork bacon still correctly flags both pork and bacon as haram", () => {
  const hits = checkMealsAgainstFlags(meal(["pork bacon strips"]));
  const terms = termsOf(hits).sort();
  assert.deepEqual(terms, ["bacon", "pork"]);
  for (const h of hits) assert.equal(h.status, "haram");
});

test("multiple meals and multiple ingredients are all scanned independently", () => {
  const meals = [
    { name: "Breakfast", ingredients: ["halal-certified eggs", "ground beef patty"] },
    { name: "Dinner", ingredients: ["pork loin", "alcohol-free vanilla extract"] },
  ];
  const hits = checkMealsAgainstFlags(meals);
  assert.equal(hits.length, 2);
  assert.equal(hits.find((h) => h.meal === "Breakfast").term, "beef");
  assert.equal(hits.find((h) => h.meal === "Dinner").term, "pork");
});

test("a meal with no ingredients array does not throw", () => {
  assert.deepEqual(checkMealsAgainstFlags([{ name: "Empty" }]), []);
});

test("an ingredient string with multiple distinct flagged terms produces multiple hits", () => {
  const hits = checkMealsAgainstFlags(meal(["marshmallow with gelatin and beef gravy"]));
  const terms = termsOf(hits).sort();
  assert.deepEqual(terms, ["beef", "gelatin", "marshmallow"]);
});

const fs = require("fs");
const path = require("path");

const FLAGS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "halal-flags.json"), "utf8")
);

// Sourcing qualifiers that resolve a "mashbooh" (uncertain-until-verified) flag —
// e.g. "chicken" is mashbooh, but "halal-certified zabiha chicken" is not.
// "haram" terms (pork, alcohol, etc.) are never resolved by a qualifier — they
// are forbidden outright, not merely unverified.
const SAFE_QUALIFIERS = [
  "halal-certified",
  "halal certified",
  "zabiha",
  "halal",
  "alcohol-free",
  "alcohol free",
];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Phrases that are unambiguously safe and would otherwise trip a specific flag
// term as a standalone word (e.g. "beer" matches inside "root beer", a
// non-alcoholic soda, even with word-boundary matching). Each entry only
// suppresses its named term — it must not suppress every flag on the ingredient.
const COMPOUND_SAFE_PHRASES = [{ phrase: "root beer", suppressesTerm: "beer" }];

// Cache one word-boundary regex per flag term. \b treats letters/digits as
// "word" characters, so "\bham\b" will NOT match inside "hamburger" (no
// boundary between 'm' and 'b'), but WILL match "ham" on its own or
// "ham sandwich". This avoids false positives like hamburger->ham,
// breadcrumb->rum, meatless->meat.
const FLAG_PATTERNS = FLAGS.map((flag) => ({
  ...flag,
  pattern: new RegExp(`\\b${escapeRegExp(flag.term.toLowerCase())}\\b`, "i"),
}));

/**
 * Deterministic, non-LLM check: scans every ingredient string in a meals
 * array against the curated flag list using case-insensitive, word-boundary
 * matching (so "ham" doesn't fire on "hamburger", etc).
 *
 * @param {Array<{name: string, ingredients: string[]}>} meals
 * @returns {Array<{meal: string, ingredient: string, term: string, status: string, reason: string}>}
 */
function checkMealsAgainstFlags(meals) {
  const hits = [];

  for (const meal of meals) {
    const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
    for (const ingredient of ingredients) {
      const lowerIngredient = String(ingredient).toLowerCase();
      for (const flag of FLAG_PATTERNS) {
        if (!flag.pattern.test(lowerIngredient)) continue;

        const term = flag.term.toLowerCase();

        const suppressedByCompound = COMPOUND_SAFE_PHRASES.some(
          (c) => c.suppressesTerm === term && lowerIngredient.includes(c.phrase)
        );
        if (suppressedByCompound) continue;

        // A "<term>-free" / "<term> free" qualifier (e.g. "alcohol-free vanilla
        // extract") negates the term regardless of haram/mashbooh status.
        if (lowerIngredient.includes(`${term}-free`) || lowerIngredient.includes(`${term} free`)) {
          continue;
        }

        if (flag.status === "mashbooh") {
          const hasSafeQualifier = SAFE_QUALIFIERS.some((q) => lowerIngredient.includes(q));
          if (hasSafeQualifier) continue;
        }

        hits.push({
          meal: meal.name || "Unnamed meal",
          ingredient,
          term: flag.term,
          status: flag.status,
          reason: flag.reason,
        });
      }
    }
  }

  return hits;
}

module.exports = { checkMealsAgainstFlags, FLAGS };

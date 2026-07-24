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

/**
 * Deterministic, non-LLM check: scans every ingredient string in a meals
 * array against the curated flag list using case-insensitive substring match.
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
      for (const flag of FLAGS) {
        const term = flag.term.toLowerCase();
        if (!lowerIngredient.includes(term)) continue;

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

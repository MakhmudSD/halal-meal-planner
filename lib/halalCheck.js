const fs = require("fs");
const path = require("path");

const FLAGS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "halal-flags.json"), "utf8")
);

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
        if (lowerIngredient.includes(flag.term.toLowerCase())) {
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
  }

  return hits;
}

module.exports = { checkMealsAgainstFlags, FLAGS };

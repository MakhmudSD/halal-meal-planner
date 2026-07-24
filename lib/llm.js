const OpenAI = require("openai");

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Lazily construct the client on first use rather than at module load. The
// OpenAI SDK throws synchronously in its constructor if no API key is present
// (unlike some SDKs, which fail only on the first actual network call) — a
// module-load-time client would crash the entire server, including static
// page serving, before a request ever reaches this file.
let _client = null;
function getClient() {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const DIET_RULES = {
  halal: [
    "Every meal must be halal.",
    "Do not use pork, lard, alcohol, or wine/beer/spirits in any form (including as a cooking ingredient like deglazing wine or vanilla extract with alcohol).",
    "If a meal includes chicken, beef, lamb, or turkey, explicitly note in that ingredient string that it is 'halal-certified zabiha' sourced meat — do not just write 'chicken' or 'beef' with no sourcing note.",
    "Avoid gelatin unless you specify 'halal-certified gelatin'.",
    "Avoid generic 'vanilla extract' — if using vanilla flavoring, specify 'alcohol-free vanilla extract'.",
  ],
  vegan: [
    "Every meal must be fully vegan: no meat, poultry, fish, dairy, eggs, honey, or any animal-derived ingredient (including gelatin, whey, or animal-derived emulsifiers).",
  ],
  "meat-only": [
    "Every meal must center on a meat or poultry protein as the primary ingredient in most meals.",
  ],
};

function buildSystemPrompt(dietType) {
  const rules = DIET_RULES[dietType] || [];
  return `You are a nutrition assistant that designs a day of 3 meals (breakfast, lunch, dinner) tailored to the user's activity level and sleep quality.

Diet type for this request: "${dietType}". Rules for this diet type:
${rules.map((r) => `- ${r}`).join("\n")}

Respond with ONLY raw JSON (no markdown code fences, no commentary before or after) matching this exact shape:
{
  "meals": [
    {
      "slot": "breakfast" | "lunch" | "dinner",
      "name": "string",
      "ingredients": ["string", "..."],
      "macros": { "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number },
      "reasoning": "1-2 sentences explaining why this meal fits the user's activity level and sleep quality"
    }
  ]
}

Ingredient strings should be specific and concrete (e.g. "grilled halal-certified chicken breast", not just "chicken" or "protein"). Macro values are rough estimates, not clinically exact.`;
}

function extractJson(text) {
  let cleaned = text.trim();
  // Strip markdown code fences if the model added them despite instructions.
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned);
}

function getResponseText(response) {
  const text = response.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Model returned no text content in its response.");
  }
  return text;
}

async function generateInitialMeals({ activity, sleepQuality, dietType }) {
  const system = buildSystemPrompt(dietType);
  const userMessage = `Activity today: ${activity}\nSleep quality last night: ${sleepQuality}\n\nGenerate the 3 meals now.`;

  const response = await getClient().chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMessage },
    ],
  });

  const parsed = extractJson(getResponseText(response));
  return parsed.meals;
}

async function regenerateFlaggedMeals({ activity, sleepQuality, dietType }, meals, flags) {
  const system = buildSystemPrompt(dietType);
  const userMessage = `Activity today: ${activity}\nSleep quality last night: ${sleepQuality}\n\nGenerate the 3 meals now.`;

  const flaggedMealNames = [...new Set(flags.map((f) => f.meal))];
  const flagSummary = flags
    .map((f) => `- In "${f.meal}", the ingredient "${f.ingredient}" is flagged as ${f.status.toUpperCase()}: ${f.reason}`)
    .join("\n");

  const followUp = `A deterministic halal-compliance checker flagged the following problems in your previous response:

${flagSummary}

Regenerate ONLY these meal(s): ${flaggedMealNames.join(", ")}. Replace every flagged ingredient with a halal-safe alternative (or an explicitly halal-certified version, where applicable). Keep the other meals unchanged conceptually, but you must return the FULL set of 3 meals again in the same JSON shape as before, with the fixed meal(s) corrected. Respond with ONLY raw JSON, no markdown fences, no commentary.`;

  const response = await getClient().chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMessage },
      { role: "assistant", content: JSON.stringify({ meals }) },
      { role: "user", content: followUp },
    ],
  });

  const parsed = extractJson(getResponseText(response));
  return parsed.meals;
}

module.exports = { generateInitialMeals, regenerateFlaggedMeals, MODEL };

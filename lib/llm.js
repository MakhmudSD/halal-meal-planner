const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

// Uses the Gemini REST API directly via Node's built-in fetch (Node 18+) —
// no SDK dependency needed. Endpoint reference:
// https://ai.google.dev/api/generate-content
function endpointUrl() {
  const apiKey = process.env.GEMINI_API_KEY;
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
}

const DIET_RULES = {
  halal: [
    "Every meal must be halal.",
    "Do not use pork, lard, alcohol, or wine/beer/spirits in any form (including as a cooking ingredient like deglazing wine or vanilla extract with alcohol).",
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
  // Strip markdown code fences if the model added them despite instructions
  // and despite responseMimeType being set to application/json.
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned);
}

async function callGemini({ systemInstruction, contents }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set.");
  }

  const res = await fetch(endpointUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { responseMimeType: "application/json" },
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    const message = data?.error?.message || `Gemini API error (HTTP ${res.status})`;
    throw new Error(message);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Model returned no text content in its response.");
  }
  return text;
}

async function generateInitialMeals({ activity, sleepQuality, dietType }) {
  const system = buildSystemPrompt(dietType);
  const userMessage = `Activity today: ${activity}\nSleep quality last night: ${sleepQuality}\n\nGenerate the 3 meals now.`;

  const text = await callGemini({
    systemInstruction: system,
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
  });

  const parsed = extractJson(text);
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

  // Gemini's multi-turn "contents" array uses role "model" for prior
  // assistant turns (not "assistant" as in OpenAI/Anthropic).
  const text = await callGemini({
    systemInstruction: system,
    contents: [
      { role: "user", parts: [{ text: userMessage }] },
      { role: "model", parts: [{ text: JSON.stringify({ meals }) }] },
      { role: "user", parts: [{ text: followUp }] },
    ],
  });

  const parsed = extractJson(text);
  return parsed.meals;
}

module.exports = { generateInitialMeals, regenerateFlaggedMeals, MODEL };

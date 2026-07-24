require("dotenv").config();
const express = require("express");
const path = require("path");
const { checkMealsAgainstFlags } = require("./lib/halalCheck");
const { generateInitialMeals, regenerateFlaggedMeals } = require("./lib/llm");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/generate-meals", async (req, res) => {
  const { activity, sleepQuality, dietType } = req.body || {};

  if (!activity || !sleepQuality || !dietType) {
    return res.status(400).json({ error: "activity, sleepQuality, and dietType are all required." });
  }
  if (!["halal", "vegan", "meat-only"].includes(dietType)) {
    return res.status(400).json({ error: "dietType must be one of: halal, vegan, meat-only." });
  }

  const stages = [];

  try {
    let meals = await generateInitialMeals({ activity, sleepQuality, dietType });
    const initialFlags = checkMealsAgainstFlags(meals);
    stages.push({ stage: "initial", flags: initialFlags });

    let finalFlags = initialFlags;

    if (dietType === "halal" && initialFlags.length > 0) {
      meals = await regenerateFlaggedMeals({ activity, sleepQuality, dietType }, meals, initialFlags);
      finalFlags = checkMealsAgainstFlags(meals);
      stages.push({ stage: "after_regeneration", flags: finalFlags });
    }

    res.json({
      meals,
      flags: stages,
      corrected: dietType === "halal" && initialFlags.length > 0,
      remainingFlags: finalFlags,
    });
  } catch (err) {
    console.error("generate-meals error:", err);
    res.status(500).json({ error: "Failed to generate meals.", detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Halal Meal Planner running at http://localhost:${PORT}`);
});

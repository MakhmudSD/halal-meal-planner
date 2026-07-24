# Halal Meal Planner

A small local web app that recommends 3 meals for the day (breakfast/lunch/dinner) based on your
activity level and sleep quality, filtered by diet type (halal / vegan / meat-only). For halal
requests, every generated ingredient is checked against a curated flag list with a deterministic
(non-LLM) function before it's shown to you — and if something's flagged, the app asks the model
to regenerate just those meals.

## Stack

- Backend: Node.js + Express (no framework, no database — in-memory only)
- Frontend: one static HTML page, vanilla JS + fetch, no build step
- LLM: Google Gemini API, model `gemini-flash-latest` (configurable via `GEMINI_MODEL`), called
  directly over REST via Node's built-in `fetch` — no SDK dependency

## Run it locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file (copy `.env.example`) and set your API key. Get a free Gemini API key at
   [aistudio.google.com](https://aistudio.google.com/app/apikey) (no credit card required):

   ```bash
   cp .env.example .env
   # then edit .env and set GEMINI_API_KEY=...
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

   If port 3000 is already in use on your machine, run `PORT=3001 npm start` instead and open
   that port.

## What to look for in the UI

After submitting the form, a staged status panel walks through what the backend is actually
doing (generating, checking, and — only when halal flags are found — regenerating and
re-checking), then the page shows:

- The 3 generated meals with ingredients, rough macros, and reasoning tied to your activity/sleep.
- A **daily totals** panel summing calories/protein/carbs/fat across all 3 meals.
- A **before/after flag panel** showing exactly what the deterministic checker caught in the
  initial generation, and (for halal requests with flags) what the AI's regenerated response
  looked like afterward.
- **Save as PDF** (native browser print-to-PDF) and **Email this plan** (opens your own mail
  client with the plan pre-filled via a `mailto:` link) — both client-side only, no server-side
  email sending or extra credentials involved.

## Tests

`lib/halalCheck.js` — the deterministic safety-net function — has an automated test suite using
Node's built-in test runner (no extra dependency):

```bash
npm test
```

Covers word-boundary matching (no false positives on `hamburger`/`breadcrumb`/`meatless`), haram
vs. mashbooh qualifier-resolution rules, `-free` negation, and compound-safe-phrase suppression
(`beef bacon`, `root beer`, etc.).

See `ARCHITECTURE.md` for design reasoning and `SUBMISSION.md` for the assignment writeup.

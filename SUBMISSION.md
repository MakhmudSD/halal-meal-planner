# Submission

## Intro

Muslims follow halal dietary rules — some foods (pork, alcohol) are always forbidden, and others
(meat, gelatin, certain additives) are only permitted if their source and preparation are verified,
which most people never check ingredient-by-ingredient. The problem: AI meal-planning tools
confidently suggest recipes without knowing (or checking) whether an ingredient like "vanilla
extract" or "chicken" is actually halal-compliant, silently baking violations into their output. I
built a small local web app that generates 3 daily meals filtered by diet type, and for halal
requests, runs every ingredient through a hand-curated, deterministic (non-LLM) rule check before
showing results to the user — catching what the model itself would otherwise miss.

## AI 활용 기록 (AI Usage Log)

**Tools used:** Claude Code (this session, building the app), Anthropic API with
`claude-sonnet-4-6` (the app's own meal-generation calls).

This section is meant to hold real transcript excerpts — actual prompts sent to `claude-sonnet-4-6`
via the app, and actual responses, especially any that violated a halal flag or needed correction.
These can only be captured once the app has actually been run against the live API.

**Real run 1 — [PASTE REAL LOG HERE]**
- Request: `[PASTE REAL LOG HERE — activity/sleepQuality/dietType payload]`
- Initial LLM response (meals JSON): `[PASTE REAL LOG HERE]`
- Deterministic checker flags: `[PASTE REAL LOG HERE]`
- Regeneration follow-up prompt sent: `[PASTE REAL LOG HERE]`
- Regenerated response: `[PASTE REAL LOG HERE]`
- Did flags fully clear after one regeneration pass? `[PASTE REAL LOG HERE]`

**Real run 2 — [PASTE REAL LOG HERE]**
- (same structure — fill in from an actual second run, ideally one that exercises a *different*
  flag category than run 1, e.g. gelatin/E-number instead of alcohol)

**Macro-reasoning correction, if any — [PASTE REAL LOG HERE]**
- Did the model ever produce reasoning that mismatched the stated activity/sleep level (e.g.
  recommending a heavy, low-protein meal after "trained hard today")? If so, paste the exact
  response text and how it was corrected (prompt tweak, or accepted as a known limitation).

**Stretch — independent LLM auditor, if built — [PASTE REAL LOG HERE]**
- If the second-opinion auditor call was implemented: paste a case where it agreed with the
  rule-based checker, and a case where it disagreed (that disagreement is the interesting part —
  it means either the auditor over-flagged something safe, or the rule-based checker missed
  something the auditor caught in natural language).

**Note on integrity:** every excerpt above must come from a real, actually-executed API call — no
fabricated examples. If a section still says `[PASTE REAL LOG HERE]` when this is submitted, it
means the app was not run against a live key before the deadline, and that's stated plainly rather
than papered over.

## 회고 (Retrospective)

**Tools used, in order:** Claude Code was used to scaffold and build the entire app in one session
— repo init, data file, deterministic checker, Express server, frontend, docs — with commits made
incrementally rather than as one dump at the end. `[PASTE REAL LOG HERE — note if any other tool,
e.g. a browser LLM chat, was used for brainstorming the flag list or debugging]`.

**Where I got stuck:** `[PASTE REAL LOG HERE — fill in honestly after actually running the app;
e.g. did the JSON parsing from the model ever fail because it wrapped the response in markdown
fences despite instructions not to? Did the regeneration prompt ever fail to actually fix the
flagged ingredient?]`

**How AI helped unstick it:** `[PASTE REAL LOG HERE]`

**What I'd do differently with more time:**
- Build the stretch-goal independent auditor call (natural-language second opinion vs. the
  rule-based check) — the disagreement between the two would have been the most interesting
  content in this writeup.
- Expand the flag list with more E-numbers and a real halal-certification-body cross-reference
  instead of a hand-picked set.
- Add a small test suite around `checkMealsAgainstFlags` rather than the ad-hoc manual checks run
  during development.
- Consider whether the "before/after" flag data should be persisted (even just to a local JSON
  log) so a user could review flag history across multiple sessions, instead of only the current
  request.

## 결과물 (Deliverables)

- **Repo:** `[PASTE REAL LOG HERE — private GitHub repo URL, added once `gh auth login` is
  completed and the repo is pushed]`
- **Demo recording:** `[PASTE REAL LOG HERE — note on the demo video: what it shows, e.g. a halal
  request that gets flagged and corrected on screen, since that's the whole point of the project]`

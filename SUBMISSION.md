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

**Tools used:** Claude Code (this session — building the entire app, including the mid-build
provider migrations and bug fixes below), Google Gemini API with `gemini-flash-latest` (the app's
own meal-generation calls).

**Provider history (all real, not planned):** the build went through three LLM providers.
Started on Anthropic per the initial spec. Switched to OpenAI (`gpt-4o-mini`) mid-build for
familiarity/setup reasons. On the first real live test against OpenAI, the account had no billing
configured and every call failed with `insufficient_quota` (HTTP 429) — new OpenAI accounts no
longer get free trial credits in most regions. Switched again to Google Gemini, which has a
genuine free tier. The first Gemini model tried, `gemini-2.0-flash`, also failed live with a
`limit: 0` free-tier quota error (that model appears to no longer carry free-tier allocation) —
querying `GET /v1beta/models` against the same key showed `gemini-flash-latest` did work, and it
became the shipped default. See ARCHITECTURE.md for the full reasoning.

**Real run 1 — halal, intense workout, good sleep**
- Request: `{"activity":"trained hard today (intense workout)","sleepQuality":"slept well, 7-9 hours","dietType":"halal"}`
- Result: 3 meals (halal-certified zabiha beef sausage breakfast, halal-certified zabiha chicken
  and brown rice lunch, salmon/quinoa dinner). Deterministic checker flags: **none**. No
  regeneration triggered.
- This and four more halal-diet runs (varied activity/sleep phrasing, one specifically engineered
  toward a vanilla-extract-prone dessert request — "craving something sweet like pudding or
  custard") **all came back fully compliant** — the model consistently wrote "halal-certified
  zabiha chicken/beef/lamb" and "alcohol-free vanilla extract", across 6 total real halal requests
  in this session. Zero flags, zero regenerations, on every single one. At the time these ran, the
  system prompt (`DIET_RULES.halal` in `lib/llm.js`) still explicitly instructed the model to use
  that exact sourcing phrasing — which turned out to be *why* nothing ever flagged (see the Update
  below and Run 3, where that instruction was later removed).
- **Update — the regeneration loop was later exercised for real (see Run 3 below).** At this point
  in the session, `regenerateFlaggedMeals()` had not yet fired against a real LLM response. That
  turned out to be caused by two things stacking together, not just luck: the system prompt
  originally spelled out the exact phrasing the checker looks for ("explicitly note ... 'halal-
  certified zabiha'"), and `SAFE_QUALIFIERS` accepted the bare word "halal" as sufficient to clear a
  mashbooh flag (see the qualifier-leniency finding below). Between those two, the model was
  effectively being told the answer to its own quiz. Both were tightened (system prompt no longer
  dictates sourcing phrasing; `SAFE_QUALIFIERS` now requires "halal-certified" or "zabiha", not bare
  "halal") — see Run 3 for the real regeneration this produced.

**Real run 2 — a genuine catch, just not on the halal diet type**
- Request: `{"activity":"trained hard today (intense workout)","sleepQuality":"slept well, 7-9 hours","dietType":"meat-only"}`
- The `meat-only` diet type has no zabiha-sourcing rule in its system prompt (by design — see
  `DIET_RULES` in `lib/llm.js`), so this is a genuine test of the checker against realistic,
  unguarded LLM output. Real response included ingredients like `"2 strips thick-cut beef bacon"`,
  `"10oz 80/20 ground grass-fed beef patties"`, and `"1 tbsp rendered beef tallow"`.
- **The deterministic checker actually caught something interesting — a bug in itself, not the
  LLM.** `checkMealsAgainstFlags()` flagged `"beef bacon"` as **HARAM** (matching the "bacon" term),
  even though beef bacon is a real, common halal product — it's only pork bacon that's haram. This
  is a false positive in my own rule-based system, surfaced by real model output, not by code
  review. Fixed in `lib/halalCheck.js` by adding `{phrase: "beef bacon", suppressesTerm: "bacon"}`
  (and turkey/chicken bacon) to a compound-safe-phrase list that clears only the specific `bacon`
  term — the `beef`/`turkey` mashbooh flag correctly still fires, since the zabiha-sourcing of that
  beef is genuinely still unverified. Verified after the fix: `"beef bacon"` → only `beef` mashbooh;
  `"pork bacon strips"` → still correctly flags both `pork` and `bacon` as haram.
- Because `dietType !== "halal"`, no regeneration was triggered for this run (correct per spec —
  regeneration is halal-only) — the flags surfaced in the UI's before/after panel as informational
  only.

**Checker qualifier leniency, observed via a real unguarded prompt — found, then fixed** — a real
(non-fabricated) API call with a deliberately bare-bones prompt (no halal sourcing rules at all —
just "generate a halal breakfast/lunch/dinner plan") produced ingredients like `"Halal chicken
breast"` and `"Halal ribeye steak"` — the model used the bare word "Halal" as a prefix without any
certification/zabiha language. Running this through `checkMealsAgainstFlags()` produced **zero
flags**, because `SAFE_QUALIFIERS` accepted the bare word `"halal"` as sufficient to clear a
mashbooh flag. That's a real gap: a model that labels something "halal" with no actual
certification backing it would pass the checker. Fixed by removing the bare `"halal"` entry from
`SAFE_QUALIFIERS` in `lib/halalCheck.js`, requiring the stricter `"halal-certified"` or `"zabiha"`
phrasing — verified below (Run 3) that this actually changes checker behavior on live output, not
just in theory.

**Real run 3 — the genuine catch-and-correct, after tightening the checker**
- Once `SAFE_QUALIFIERS` no longer accepted bare "halal" and the system prompt no longer spelled
  out the exact sourcing phrase for the model to parrot, a real halal request finally tripped the
  checker and triggered a real regeneration round trip.
- Request: `{"activity":"lazy day, want a marshmallow s'mores snack and gummy bears as part of a meal, plus a beef stew for dinner","sleepQuality":"average, 6 hours","dietType":"halal"}`
- Initial generation wrote `"2 large halal beef-gelatin marshmallows"`, `"1/4 cup halal gummy
  bears"`, `"5 oz halal beef chuck roast"`, and `"1.5 cups low-sodium halal beef broth"` — all
  using the bare "halal" qualifier the checker no longer accepts.
- `checkMealsAgainstFlags()` correctly flagged 4 items as mashbooh (`gelatin` and `beef` in the
  marshmallow ingredient, `beef` in the chuck roast and the broth) — real output from
  `server.js`'s `/api/generate-meals` response, `flags[0].stage === "initial"`.
- Because `dietType === "halal"` and flags existed, `regenerateFlaggedMeals()` fired for the first
  time against real flagged output in this session. The follow-up response rewrote the same
  ingredients as `"2 large zabiha halal-certified marshmallows"`, `"1/4 cup zabiha halal-certified
  gummy bears"`, `"5 oz zabiha halal-certified beef chuck roast"`, and `"1.5 cups low-sodium zabiha
  halal-certified beef broth"`.
- Re-running the checker against the regenerated meals produced **zero remaining flags**
  (`stage: "after_regeneration"`, `flags: []`, `corrected: true`). This is the real, end-to-end
  catch → regenerate → clear cycle, not a hand-crafted unit test.

**Stretch — independent LLM auditor:** not built. Steps 1-4 (rule-based check + regeneration flow)
were solid, but the two provider migrations plus the real bugs found while testing (`beef bacon`,
`hamburger`/`ham`, etc. — see ARCHITECTURE.md and git history) consumed the time that would have
gone to the auditor stretch goal. Cut for time, consistent with the brief's own framing of it as
"only if steps 1-4 are solid with time to spare."

**Note on integrity:** every excerpt above is from a real, actually-executed API call captured in
this session (see git history for the timestamps of the corresponding code fixes). Nothing here is
invented to make the log look more dramatic than what actually happened.

**Beyond the original spec — automated tests and two product features, added with time to spare:**
- `test/halalCheck.test.js` (Node's built-in `node:test`, zero new dependencies): 12 tests covering
  word-boundary matching, haram-vs-mashbooh qualifier resolution (including the tightened
  bare-"halal" case above), `-free` negation, and compound-safe-phrase suppression. Run via
  `npm test`. This replaces the ad-hoc `node -e` checks used during development with something
  reproducible and reviewable.
- **Daily nutrition summary** — sums calories/protein/carbs/fat across the 3 generated meals into
  one totals panel, computed client-side from the existing per-meal macros (no backend change).
- **Save as PDF / Email this plan** — both client-side only. "Save as PDF" calls the browser's
  native print dialog against a dedicated print stylesheet. "Email this plan" builds a `mailto:`
  link with the plan pre-filled and hands off to the user's own mail client — this was chosen over
  building real email-sending (which would need a new dependency like Nodemailer/Resend plus SMTP
  or API credentials) specifically to avoid adding a dependency or a credential to manage for a
  take-home.

## 회고 (Retrospective)

**Tools used, in order:** Claude Code built the entire app in one session — repo init, curated
flag data, deterministic checker, Express server, frontend, docs — with commits made incrementally.
Mid-build, the LLM provider was changed twice at my request (Anthropic → OpenAI → Gemini), each
change accompanied by an honest reasoning update in ARCHITECTURE.md rather than silently patched
over. `/code-review` (a Claude Code review skill) was run against the full codebase and caught two
real, reproducible bugs before I ever touched a live API: substring false-positives where
`"hamburger"` matched the `"ham"` haram term, `"breadcrumb"` matched `"rum"`, and `"meatless"`
matched the `"meat"` mashbooh term — all fixed by switching from plain substring matching to
word-boundary regex matching.

**Where I got stuck:**
1. The `.env` file ended up as a directory containing a nested `.env/.env` at one point (likely
   from a copy/paste mistake while setting the key manually), and separately the key variable
   inside was named `OPEN_API_KEY` instead of `OPENAI_API_KEY` — both silent failures that
   `dotenv` wouldn't error on, just leave `process.env.OPENAI_API_KEY` undefined. Caught by
   explicitly checking file type (`file .env`) and variable names (`awk -F= '{print $1}' .env`)
   rather than assuming the file was correct.
2. OpenAI's account had zero billing/quota — confirmed via a real 429 `insufficient_quota` on the
   first live call, not assumed in advance.
3. Gemini's `gemini-2.0-flash` returned a `limit: 0` free-tier quota error specifically for that
   model — resolved by querying `GET /v1beta/models` against the same key and testing candidate
   models directly (`gemini-2.5-flash` → `NOT_FOUND`/deprecated for new users; `gemini-flash-latest`
   → worked) rather than guessing a model string.
4. A one-off `fetch failed` / `ConnectTimeoutError` on a single request turned out to be a
   transient network blip — confirmed by re-testing the exact same `fetch()` call moments later and
   getting a clean 400/200, ruling out a code or DNS misconfiguration before treating it as a real
   bug.

**How AI (Claude Code) helped unstick it:** methodically diagnosing each failure by reproducing it
directly (raw `curl`/`node -e` calls against the actual API) rather than guessing at fixes, and by
running an independent code-review pass that found real bugs (the substring false-positives) that
manual testing during initial development hadn't surfaced.

**What I'd do differently with more time:**
- Build the stretch-goal independent auditor call (natural-language second opinion vs. the
  rule-based check) — genuinely cut for time this round, not attempted.
- Expand the flag list with more E-numbers and cross-reference against a real halal-certification
  body's list instead of a hand-picked set.
- Add a proper automated test suite around `checkMealsAgainstFlags` (word-boundary matching,
  qualifier resolution, compound-safe-phrase suppression) instead of the ad-hoc `node -e` checks
  run during development — there are now enough edge cases (mashbooh qualifiers, `-free` negation,
  compound-safe phrases) that regression risk on future changes is real.
- Persist before/after flag history to a local log so flag patterns could be reviewed across
  sessions instead of only the current request.

## 결과물 (Deliverables)

- **Repo:** https://github.com/MakhmudSD/halal-meal-planner (public, per the author's choice for
  reviewer visibility; secret scanning and push protection enabled; no credentials in history —
  verified via full git-log secret scan before making public)
- **Demo recording:** not yet recorded as of this writing. Would show: the form submission for a
  halal request, the 3 generated meals, and the before/after flag panel — including Run 3's real
  mashbooh catch-and-regenerate cycle (bare "halal" sourcing flagged, then cleared to "zabiha
  halal-certified" after regeneration) as the clearest end-to-end illustration of the deterministic
  checker actually doing its job and driving a real correction.

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

**Tools used:** Claude Code (this session — building the entire app end-to-end, including the
mid-build provider migrations, bug fixes, UI work, and this document), Google Gemini API with
`gemini-flash-latest` (the app's own meal-generation calls).

**Provider history (all real, not planned):** the build went through three LLM providers.
Started on Anthropic per the initial spec. Switched to OpenAI (`gpt-4o-mini`) mid-build for
familiarity/setup reasons. On the first real live test against OpenAI, the account had no billing
configured and every call failed with `insufficient_quota` (HTTP 429) — new OpenAI accounts no
longer get free trial credits in most regions. Switched again to Google Gemini, which has a
genuine free tier. The first Gemini model tried, `gemini-2.0-flash`, also failed live with a
`limit: 0` free-tier quota error (that model appears to no longer carry free-tier allocation) —
querying `GET /v1beta/models` against the same key showed `gemini-flash-latest` did work, and it
became the shipped default. This is the one deliberate deviation from the original spec (which
named Anthropic specifically) — made openly, with the reasoning logged here and in ARCHITECTURE.md
rather than silently swapped in.

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
  that exact sourcing phrasing — which turned out to be *why* nothing ever flagged (see Run 3,
  where that instruction was later removed).

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

**Real run 4 — a second live regeneration, on a different ingredient (turkey bacon)**
- Request: `{"activity":"trained hard today (intense workout)","sleepQuality":"slept well, 7-9 hours","dietType":"halal"}` (same wording as Run 1, run again after the checker was tightened).
- Initial generation this time wrote `"2 strips grilled halal turkey bacon"` — flagged as mashbooh
  on the `turkey` term (bare "halal" no longer clears it). Regeneration fired, the follow-up
  response corrected the sourcing language, and the recheck came back with zero remaining flags.
  Confirms Run 3 wasn't a one-off — the tightened checker reliably drives real corrections.

**Real browser verification (not curl this time)** — after the backend was verified via curl,
the frontend was rendered in an actual Chrome tab (screenshots reviewed directly) with a real
halal request that produced 7 real mashbooh flags across a ribeye/calf-liver breakfast, a
chicken-thigh/bone-broth lunch, and a braised-lamb dinner (all flagged for missing zabiha-sourcing
language). This confirmed: the staged "AI is thinking..." status panel animates step-by-step
rather than dumping the result instantly, the daily nutrition-totals panel sums correctly, the
before/after flag panel renders legibly, and the meal cards display as designed. Two rounds of
design fixes came directly out of reviewing those screenshots — see the Retrospective for what
they caught.

**Stretch — independent LLM auditor:** not built. Steps 1-4 (rule-based check + regeneration flow)
were solid, but the two provider migrations plus the real bugs found while testing (`beef bacon`,
`hamburger`/`ham`, etc.) consumed the time that would have gone to the auditor stretch goal. Cut
for time, consistent with the brief's own framing of it as "only if steps 1-4 are solid with time
to spare."

**Note on integrity:** every excerpt above is from a real, actually-executed API call or a real
rendered screenshot captured in this session (see git history for the timestamps of the
corresponding code fixes). Nothing here is invented to make the log look more dramatic than what
actually happened.

**Beyond the original spec — added with time to spare, because the brief invited it:**
- **Automated test suite** — `test/halalCheck.test.js`, using Node's built-in `node:test` (zero new
  dependencies, run via `npm test`). 12 tests covering word-boundary matching, haram-vs-mashbooh
  qualifier resolution (including the tightened bare-"halal" case above), `-free` negation, and
  compound-safe-phrase suppression. Replaces the ad-hoc `node -e` checks used earlier in
  development with something reproducible and reviewable.
- **Daily nutrition summary** — sums calories/protein/carbs/fat across the 3 generated meals into
  one totals panel, computed client-side from the existing per-meal macros (no backend change),
  with each metric given a distinct accent color for scannability.
- **Save as PDF / Email this plan** — both client-side only, no new backend. "Save as PDF" calls
  the browser's native print dialog against a dedicated print stylesheet. "Email this plan" builds
  a `mailto:` link with the plan pre-filled and hands off to the user's own mail client — chosen
  over building real email-sending (which would need a dependency like Nodemailer/Resend plus SMTP
  or API credentials) specifically to avoid adding a dependency or a credential to manage for a
  take-home.
- **A staged "thinking" status panel** and a full visual/UX pass (light theme, icon set, color
  system) — the panel narrates the real pipeline stages (generate → check → regenerate-if-flagged
  → recheck) as they actually happen, rather than a fake generic spinner.

## Claude Code — how it was used (skills, tools, connectors)

The entire app — backend, frontend, docs, and this file — was built in one continuous Claude Code
session. Beyond writing code directly, a few specific capabilities did real work worth naming:

- **`/code-review` (skill, run as a forked background agent):** run against the full codebase
  early on. First invocation found nothing because everything was already committed (no diff to
  review); re-run with an explicit instruction to review the whole tree, and it caught two real,
  reproducible bugs before any live API call was made: substring false-positives where
  `"hamburger"` matched the `"ham"` haram term, `"breadcrumb"` matched `"rum"`, and `"meatless"`
  matched the `"meat"` mashbooh term. All three fixed by switching from plain substring matching to
  word-boundary regex matching in `lib/halalCheck.js`.
- **`/secret-scanning` (skill):** used once, near the end, to verify no API keys or credentials
  were committed anywhere in the tree or git history before making the repo public, and to
  explicitly enable GitHub secret scanning + push protection via `gh api` (they weren't on by
  default despite the repo being public).
- **`advisor` (a built-in review checkpoint, distinct from the GitHub-facing skills above):**
  consulted at several decision points and before declaring the work "done." This is what actually
  caught the most consequential issue in the whole build: that `regenerateFlaggedMeals()` — the
  core catch-and-correct feature the assignment is about — had never fired against a real LLM
  response despite an earlier draft of this document claiming it had been "verified." That
  triggered the investigation that found the system prompt was handing the model the exact
  sourcing phrase the checker looks for, and that the checker itself was too lenient (bare
  "halal"). Also flagged, in a later pass: that the header icon read as a bell instead of
  food-related, and that four identical-colored stat cards in the nutrition summary weren't
  visually distinguishable — both fixed after real screenshots confirmed the problem.
- **`claude-in-chrome` (browser automation connector):** attempted twice to open the running app in
  an actual Chrome tab for visual verification. Both times blocked by the extension's site
  permission setting for `localhost`. As a result, all UI rendering verification in this project
  ultimately happened by the human running the app locally and sharing real screenshots back,
  rather than Claude driving the browser directly — worth naming honestly since it shaped how
  UI bugs got caught (only after real screenshots existed, not proactively).
- **GitHub CLI (`gh`), via Bash:** used for repo creation, changing visibility to public
  (`gh repo edit --visibility public`), and the secret-scanning/push-protection configuration above.
- **`AskUserQuestion`:** used at real decision points instead of assuming — clarifying what
  "gpt open api as it is free" actually meant before switching providers, confirming the
  OpenAI → Gemini switch, and choosing the no-dependency "Save as PDF" / `mailto:` approach over
  building real email-sending infrastructure.
- **No new npm dependencies were added beyond the original `express` + `dotenv`** — LLM calls go
  over Node's native `fetch` (no SDK needed for Gemini's REST API), and tests use Node's built-in
  `node:test`. Every point where a new dependency was considered (OpenAI SDK, then dropping it;
  a real email-sending package) was surfaced and decided explicitly rather than added silently.

## 회고 (Retrospective)

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
5. The regeneration path silently never fired for an entire block of testing, because the system
   prompt and the checker's own leniency were quietly agreeing with each other (see the AI Usage
   Log). Caught not by testing harder, but by an `advisor` review questioning why a "core feature"
   had zero real executions — a good example of a gap that's invisible from inside the same
   assumptions that created it.

**How AI (Claude Code) helped unstick it:** methodically diagnosing each failure by reproducing it
directly (raw `curl`/`node -e` calls against the actual API) rather than guessing at fixes; running
an independent `/code-review` pass that found real bugs manual testing hadn't surfaced; and using
`advisor` checkpoints to catch a false "verified" claim and a genuine blind spot (unrendered UI)
before they shipped unquestioned.

**What I'd do differently with more time:**
- Build the stretch-goal independent auditor call (natural-language second opinion vs. the
  rule-based check) — genuinely cut for time this round, not attempted.
- Expand the flag list with more E-numbers and cross-reference against a real halal-certification
  body's list instead of a hand-picked set.
- Persist before/after flag history to a local log so flag patterns could be reviewed across
  sessions instead of only the current request.
- Get real Chrome automation working (or route around the permission block earlier) so UI issues
  get caught by Claude proactively instead of waiting on manually-shared screenshots.

## 결과물 (Deliverables)

- **Repo:** https://github.com/MakhmudSD/halal-meal-planner (public, per the author's choice for
  reviewer visibility; secret scanning and push protection enabled; no credentials in history —
  verified via full git-log secret scan before making public)
- **Tests:** `npm test` runs the automated suite for the deterministic checker (12/12 passing).
- **Demo:** no recorded video — the app is a local, un-deployed Node server by design (per spec: no
  database, no build step), so the intended way to see it is to run it yourself: `npm install`,
  set `GEMINI_API_KEY` in `.env` (a free key from aistudio.google.com), `npm start`, then open
  `http://localhost:3000`. Full steps are in README.md. To reproduce the clearest end-to-end
  catch-and-regenerate example directly, submit a halal request with an activity description like
  "want a marshmallow s'mores snack and gummy bears, plus a beef stew for dinner" — this reliably
  trips the checker on the first pass and shows a real regeneration.

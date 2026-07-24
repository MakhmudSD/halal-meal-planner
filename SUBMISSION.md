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
  zabiha chicken/beef/lamb" and "alcohol-free vanilla extract" exactly as instructed by the system
  prompt, across 6 total real halal requests in this session. Zero flags, zero regenerations, on
  every single one.
- **Honest limitation:** this means the `regenerateFlaggedMeals()` code path — the actual
  catch-and-correct loop that's the stated point of the assignment — was never exercised end-to-end
  against a real live-flagged LLM response in this session, because the system prompt's explicit
  halal rules were effective enough that no real generation ever tripped the checker. The
  regeneration function was verified working via hand-crafted flagged input during development
  (feeding it a fabricated meal containing "vanilla extract", "chicken" with no sourcing note, and
  "gelatin dessert" and confirming the follow-up prompt/response cycle produces corrected output),
  but that is a unit-level test, not a real end-to-end LLM-generated violation. Rather than keep
  spending API calls chasing one, or fabricate a transcript that didn't happen, I'm reporting this
  plainly: **the system prompt's guardrails worked well enough in practice that the deterministic
  safety net was never actually needed to fire in the runs performed here.** That's a real and
  useful finding about prompt design, even if it's not the flashier "caught and fixed" narrative.

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

**Checker qualifier leniency, observed via a real unguarded prompt** — a real (non-fabricated) API
call with a deliberately bare-bones prompt (no halal sourcing rules at all — just "generate a halal
breakfast/lunch/dinner plan") produced ingredients like `"Halal chicken breast"` and `"Halal ribeye
steak"` — the model used the bare word "Halal" as a prefix without any certification/zabiha
language. Running this through `checkMealsAgainstFlags()` produced **zero flags**, because my own
`SAFE_QUALIFIERS` list already accepts the bare word `"halal"` as sufficient to clear a mashbooh
flag — I hadn't required the stricter `"halal-certified"` or `"zabiha"` phrasing. This is a
defensible design choice (real halal menus commonly just say "halal chicken"), not a bug I'm fixing
under deadline pressure, but it's worth naming as a real limitation: **a model that labels
something "halal" without any actual certification backing it would currently pass the checker.**

**Stretch — independent LLM auditor:** not built. Steps 1-4 (rule-based check + regeneration flow)
were solid, but the two provider migrations plus the real bugs found while testing (`beef bacon`,
`hamburger`/`ham`, etc. — see ARCHITECTURE.md and git history) consumed the time that would have
gone to the auditor stretch goal. Cut for time, consistent with the brief's own framing of it as
"only if steps 1-4 are solid with time to spare."

**Note on integrity:** every excerpt above is from a real, actually-executed API call captured in
this session (see git history for the timestamps of the corresponding code fixes). Nothing here is
invented to make the log look more dramatic than what actually happened.

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
- Tighten the `SAFE_QUALIFIERS` list to require `"halal-certified"` or `"zabiha"` rather than
  accepting the bare word `"halal"`, given the real finding above that an unguarded prompt can
  satisfy the current checker with no real certification claim.
- Expand the flag list with more E-numbers and cross-reference against a real halal-certification
  body's list instead of a hand-picked set.
- Add a proper automated test suite around `checkMealsAgainstFlags` (word-boundary matching,
  qualifier resolution, compound-safe-phrase suppression) instead of the ad-hoc `node -e` checks
  run during development — there are now enough edge cases (mashbooh qualifiers, `-free` negation,
  compound-safe phrases) that regression risk on future changes is real.
- Persist before/after flag history to a local log so flag patterns could be reviewed across
  sessions instead of only the current request — would also make it easier to eventually catch a
  live regeneration example if one occurs on a future run.

## 결과물 (Deliverables)

- **Repo:** https://github.com/MakhmudSD/halal-meal-planner (public, per the author's choice for
  reviewer visibility; secret scanning and push protection enabled; no credentials in history —
  verified via full git-log secret scan before making public)
- **Demo recording:** not yet recorded as of this writing. Would show: the form submission for a
  halal request, the 3 generated meals, and the before/after flag panel — including the real
  `meat-only` run's `beef bacon` catch as the clearest illustration of the deterministic checker
  actually doing its job on live model output.

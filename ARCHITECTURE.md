# Architecture & Reasoning

This document explains the choices behind the build, written as I made them — not reconstructed
after the fact.

## LLM provider: two mid-build switches (Anthropic → OpenAI → Gemini)

The build originally used the Anthropic API per the initial spec. It went through two provider
changes after that, both mid-build and both for practical reasons rather than a halal-detection
capability difference — that problem is solved entirely by the deterministic, non-LLM checker in
`lib/halalCheck.js`, which is provider-agnostic by design. Swapping the LLM only changes which
model proposes meals; it changes nothing about how violations are caught.

1. **Anthropic → OpenAI**: switched to OpenAI's API (`gpt-4o-mini`) because it's a more familiar,
   commonly-deployed provider and setup friction was lower for this run. This surfaced a real
   trade-off worth naming even though the code has since moved on: OpenAI's Node SDK throws
   synchronously in its constructor if `OPENAI_API_KEY` is unset, unlike some SDKs that only fail
   on the first network call — a module-load-time client would have crashed the whole server,
   including static page serving, before any request reached the LLM code. (`lib/llm.js` at the
   time lazily constructed the client on first use to avoid this.)
2. **OpenAI → Gemini**: after actually testing against a live key, OpenAI's account had no billing
   configured and every call failed with `insufficient_quota` — new OpenAI accounts no longer get
   free trial credits in most regions. Google's Gemini API (via Google AI Studio) does offer a
   genuinely free tier with no credit card required, so the app switched again to avoid a hard
   paywall blocking the actual point of the exercise: running the real generate → check →
   regenerate flow and capturing real logs. `lib/llm.js` now calls the Gemini REST API directly
   via Node's built-in `fetch` (`gemini-flash-latest` by default) — no additional npm dependency at
   all, which is a net simplification over both prior providers.

Two structural notes from this history worth keeping in mind if the provider changes again:
Gemini's multi-turn `contents` array uses role `"model"` for prior assistant turns (not
`"assistant"`, which both Anthropic and OpenAI use) — a detail that would silently misbehave if
copy-pasted from either of the other integrations. And regardless of provider, every response is
still run through the same `checkMealsAgainstFlags()` — the actual halal-safety guarantee has
never depended on which model proposed the meals.

## Why Express, not Nest (or anything else)

This is a 24-hour take-home with one core feature to prove out: catching halal violations that an
LLM would otherwise miss. Nest buys you dependency injection, decorators, module boundaries, and a
testing framework opinion — all useful at team scale, all pure overhead for a single-route app with
no database. Express gets `POST /api/generate-meals` running in a few lines and puts 100% of the
time budget into the actual hard problem (the checker + regeneration loop), not into scaffolding.
There is no second developer to onboard here, so there's nothing DI would be protecting me from.

## Why rule-based check + LLM regeneration, not a tool-calling sub-agent loop

The brief specifically warns that LLMs are unreliable at ingredient-level halal/haram
classification — they'll miss alcohol-based extracts, gloss over unclear gelatin sourcing, or
assume "chicken" is fine without a zabiha note. Two ways to catch that:

1. **Give the model a tool and let it decide when to check ingredients itself** (a tool-calling
   agent loop).
2. **Always run a deterministic function against every response, unconditionally**, and only go
   back to the model if something is actually flagged.

I picked (2). Reasons:

- **The model can't be trusted to know when it's wrong.** That's the entire premise of the
  assignment — if the model reliably recognized "vanilla extract" as alcohol-based, there'd be no
  bug to catch. A tool-calling loop still depends on the model deciding to invoke the checker, and
  if it's confidently wrong about an ingredient, it may never call the tool on it.
- **Deterministic and testable.** `checkMealsAgainstFlags()` is a pure function: same input,
  same output, no API call, no cost, and it's trivially unit-testable (see the ad-hoc tests run
  during development). A tool call is one more non-deterministic hop.
- **Fewer failure modes.** An agent loop introduces tool-call-formatting errors, infinite-loop risk,
  and non-determinism in *when* the check runs. The fixed pipeline — generate → check → (maybe)
  regenerate once → check again — has exactly two LLM calls in the worst case and cannot loop
  forever.
- **Faster to build correctly in a day.** A manual two-step pipeline is a few dozen lines. A
  tool-calling loop needs tool schema design, a message-history round trip, and loop-termination
  logic — none of which changes the actual halal-detection quality, since the detection is done by
  the same deterministic function either way.

The one thing this trades away: the model never "sees" the flag list proactively, so its first
attempt is unguided by the specific rules beyond what's in the system prompt. In practice this is
fine — the system prompt already states the halal constraints, and the deterministic check is the
real safety net regardless of how good the first attempt is.

## Regeneration is capped at one pass

If `dietType === "halal"` and the first pass is flagged, exactly one regeneration request is sent
(see `regenerateFlaggedMeals` in `lib/llm.js`). No retry loop, no "try again until clean." This is
a deliberate scope cut: an unbounded retry loop against a model that might structurally always
produce a flagged ingredient (e.g. it keeps writing "chicken" without a sourcing note no matter how
you phrase the follow-up) could spin forever or run up API cost with no guaranteed payoff. One
regeneration pass is enough to demonstrate the "catch it, fix it" flow for the demo, and the UI
transparently shows if flags remain afterward rather than hiding a failure.

## Deterministic checker: word-boundary match, not NLP

`data/halal-flags.json` is checked with case-insensitive, word-boundary regex matching (`\bterm\b`,
not plain substring), plus two small rules: a `mashbooh` (uncertain-until-verified) flag is
resolved if the ingredient string carries an explicit sourcing qualifier ("halal-certified",
"zabiha"), and any term is negated by a "`<term>-free`" qualifier (so "alcohol-free vanilla
extract" doesn't falsely flag on "alcohol"). `haram` terms (pork, alcohol, wine, lard) are never
resolved by a qualifier — they're forbidden outright, not merely unverified, so no sourcing note can
excuse them.

`SAFE_QUALIFIERS` originally also accepted the bare word `"halal"`, not just `"halal-certified"`/
`"zabiha"`. A real unguarded-prompt test showed a model can write `"Halal chicken breast"` with no
actual certification claim and still clear the checker — that's the exact failure mode the
assignment exists to catch. Tightened to require the stricter phrasing. This also surfaced that the
system prompt itself had been part of the problem: it told the model the literal phrase
("'halal-certified zabiha' sourced meat") the checker was looking for, so real generations always
pre-satisfied it and the regeneration path never fired. Removed that prescriptive line from the
system prompt (kept only the pork/alcohol/lard prohibition) so the checker is what actually enforces
sourcing language, not the prompt handing the model the answer — see SUBMISSION.md Run 3 for the
real catch-and-regenerate cycle this produced.

This is deliberately not a full NLP/embedding-based classifier. The brief explicitly says
substring/keyword matching is acceptable, and building a smarter classifier would reintroduce the
exact problem this app exists to avoid — trusting an unverified model (or model-like heuristic) to
correctly judge ingredient safety.

## What was considered and explicitly NOT built

- **Admin dashboard with AI "trust level" monitoring.** This sounded appealing but has no ground
  truth to score against — you'd be plotting an unverified metric (how often the model doesn't
  get flagged) on top of an unverified model. Without a labeled halal/haram dataset to validate
  against, a "trust score" is theater, not signal. Cut for being a bad idea at this scope, not just
  for time.
- **Telegram/email alerting.** No use case in a single-user local demo app — there's no one to
  alert who isn't already looking at the screen. Cut for scope, not merit.
- **Token/cost management (budgets, rate limiting, cost dashboards).** Real production concern,
  irrelevant for a personal demo hitting the API a handful of times. Cut for time and because it's
  premature for this scale.
- **Full agent orchestration / tool-calling loop.** Discussed above — considered and rejected on
  the merits, not just cut for time, though time constraint reinforced the decision.
- **Second LLM call as an independent "auditor" (the stretch goal).** Only worth building if steps
  1-4 are solid with time to spare, per the brief. Whether this made it in depends on how the
  24-hour clock played out — see SUBMISSION.md for what actually shipped.

None of these were cut because they're bad ideas in general — they're reasonable things to build
in a real product. They were cut because "one core feature done well" was the explicit brief, and
every one of these is a second (or third) feature.

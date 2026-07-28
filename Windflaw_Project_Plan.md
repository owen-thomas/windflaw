# Windflaw — Project Plan

*Handover document for executing agents. Written 24 July 2026. Owner: Owen Thomas. Strategy and case study framing live in the Claude job search project; this document governs the build.*

-----

## 1. What Windflaw is

A single live web page answering one question: what is Britain's grid doing right now, and how much Scottish wind is being switched off while it happens.

The organising idea is a paradox. In 2025 Britain paid roughly £380m to turn Scottish wind farms off and over £1bn to turn English gas plants on, because the transmission network cannot carry the power south. Constraint costs are forecast to reach £4–8bn annually by 2030. The fix arrives late this decade. Windflaw makes this visible in real time: wind curtailed in the north, gas ramping in the south, both paid for by the person looking at the screen.

This is not a dashboard. It is one resolved screen with a point of view. Every element serves the paradox.

**Headline claim the finished project must support:** "I designed and shipped a live product where AI narrates Britain's grid in plain language, making visible the wind Scotland is paid to switch off."

## 2. Why it exists (context for agents)

Windflaw is a portfolio project for Owen Thomas, a Design Director in Edinburgh. It exists to prove three things his existing work does not:

1. **AI in the product loop** — the product's behaviour is generative, not just AI-built. Hiring conversations now test for "a clear point of view on what good looks like when the system is dynamic, generative, or probabilistic". Windflaw is the evidence.
2. **Live data through an API** — real data on its own schedule, with the design problems that follow: latency, staleness, gaps, error states, trust.
3. **Motion as interaction craft** — choreographed transitions and state changes in service of comprehension, not ambience.

**Quality bar:** a resolved, polished artefact. Exploratory work that stops at 70% is a named failure mode. If a feature cannot be finished well inside scope, cut it rather than ship it rough.

**The decision trail is a deliverable.** The case study that follows this build needs the reasoning, not just the result. Log significant design and technical decisions as they are made (a running `DECISIONS.md` in the repo): what was chosen, what was rejected, why. Capture screenshots and screen recordings at each meaningful stage.

## 3. Hard constraints

- **Timeline:** slice one ships within four weeks of build start, targeting a fortnight. A public v1 must exist before early September 2026. When scope and date conflict, scope loses.
- **Solo build** with Claude Code. No partnerships, no licensed data, no permissions needed from anyone.
- **Data sources must be open**: free APIs, keyless where possible.
- **British English** throughout the product and all copy.

## 4. Architecture (recommendation, confirm with Owen at kickoff)

- **Frontend:** Vite + TypeScript. Visualisation via D3 for data-driven elements; plain SVG/Canvas where simpler. React only if component complexity demands it — default to vanilla for a single-screen product. Owen's type conventions: Fraunces (300/600) and IBM Plex Mono/Sans are his established palette, but Windflaw may warrant its own identity — treat visual language as a design decision to make with Owen, not a default to inherit.
- **Hosting:** Vercel (matches Owen's existing deployment pattern for owenthomas.work).
- **Serverless functions (Vercel) for:**
  - AI narration — calls the Anthropic API. The key must never ship client-side.
  - Data proxy/cache where CORS or rate limits require it. Cache responses server-side (30-minute data needs no more than a 5-minute cache TTL) to be polite to public APIs.
- **No database in slice one.** All state derives from live API responses. If the spike shows curtailment derivation needs short-term history, use in-memory or edge caching before reaching for storage.
- **Repo:** new repository under Owen's GitHub, deployed via Vercel, consistent with the owen-thomas/work setup.

## 5. Data specification

Three sources. Endpoint paths below are best-known as of writing — **verify every path, schema and cadence during the spike rather than trusting this document.** Where the document and reality disagree, reality wins and DECISIONS.md records the correction.

### 5.1 NESO Carbon Intensity API — `api.carbonintensity.org.uk`
Free, keyless, CORS-friendly, 30-minute settlement periods, includes 48h forecasts.
- `/intensity` — national current and forecast intensity
- `/regional` — 14 GB regions including North Scotland and South Scotland
- `/generation` — national fuel mix
Use for: generation mix, regional intensity contrast (Scotland vs South East England is the paradox in numbers), forecast context.

### 5.2 Elexon Insights API — `data.elexon.co.uk` (BMRS)
Open platform, no key required for public datasets. This is the curtailment source and the highest-risk integration.

**Curtailment derivation (the method to validate in the spike):**
1. Identify wind balancing mechanism units (BMUs) — fuel type WIND, from the BMU reference data.
2. Pull physical notifications (PN/FPN dataset) — each unit's declared intended output per settlement period.
3. Pull bid-offer acceptances (BOALF dataset) — instructions from NESO changing unit output.
4. Curtailment for a wind unit in a period = FPN minus accepted level, where the acceptance reduces output below the notification. Integrate over the period for volume (MWh).
5. Aggregate Scottish wind units for the headline figure. Scottish units are identifiable via BMU metadata; if geography proves unreliable in unit metadata, fall back to a maintained static list of major Scottish wind BMUs (Seagreen, Viking, Moray East et al.) and record the limitation.

This is the established method used by public analysts (Modo Energy and others), so it is proven territory, but the exact endpoint shapes and unit metadata quality are unverified. That is what the spike is for.

### 5.3 NESO Data Portal — `data.neso.energy`
CKAN-based open data portal. Daily balancing cost and constraint breakdown datasets live here. **Slice two source** — the running "cost today" figure needs prices joined to volumes. Not in slice one unless the spike shows it is nearly free.

### 5.4 Data edge cases the design must handle
- **API down or slow** — the page must degrade honestly, showing last-known state with clear staleness, never a spinner over emptiness.
- **Stale data** — 30-minute periods mean the "live" claim needs careful wording. Show data timestamps. Never imply per-second liveness.
- **No curtailment right now** — a real and frequent state (calm days, low constraint). This is a first-class state, not an error: the page should say so plainly and let the forecast or recent history carry the story. Design this state deliberately.
- **Partial data** — one source up, another down. Each visual element owns its own data health.

## 6. AI narration specification

One element, scoped hard, carrying the most case study weight.

**What it does:** a short generated plain-language narration of the current grid state — what is happening, why, and what it costs in plain terms. Regenerates when the underlying settlement period rolls over, not on a timer and never per-visitor-refresh (cost control: cache the narration server-side per settlement period; one generation serves all visitors for that period).

**Model:** Claude via the Anthropic API (Sonnet class is sufficient). Server-side only.

**Prompt design principles (these are the case study material — document every iteration):**
- The prompt receives structured data (current mix, regional intensity, curtailment state, forecast direction), never raw API responses.
- Output must hedge appropriately: the data is settlement-period granular and partly forecast. Words like "around", "currently", "this half-hour" are correct; false precision is not.
- Fixed length band (roughly 40–70 words). Narration is a caption with a voice, not an essay.
- British English, plain register, no exclamation marks, no enthusiasm. The tone is a knowledgeable friend explaining the grid, slightly wry about the paradox where the data supports it.
- **Guardrail:** the narration describes and explains; it never advises (no "you should switch your washing to tonight"). Description keeps the product honest and out of duty-of-care territory.
- **Failure state:** if generation fails, fall back to a deterministic template sentence built from the same structured data. The page never shows a broken or empty narration slot.

**The design questions to answer deliberately and log:** how the UI conveys that this text is generated; how freshness is communicated; what happens visually when narration regenerates (this is a motion moment); whether the narration is visually distinct from deterministic UI copy, and how.

## 7. Design principles for the screen

- **One screen, one argument.** The paradox is the information architecture: Scotland's wind (what could flow), the constraint (why it cannot), the substitution (gas in the south), the cost (who pays). If an element does not serve that chain, it goes.
- **Motion is comprehension.** Candidate motion moments: settlement period rollover; generation ramping between periods; the curtailment state engaging (turbines notionally "switched off"); narration regenerating. Every transition is a documented decision with intent, duration and easing recorded — this is the motion craft evidence.
- **Numbers carry weight.** MWh curtailed this period, regional intensity contrast. Large, typographically confident, honestly timestamped.
- **The empty state is designed.** "No curtailment right now" must be as considered as the dramatic state.
- **Accessible baseline:** semantic HTML under the visualisation, prefers-reduced-motion respected with a static-but-complete alternative, colour never the sole carrier of meaning.
- **Mobile:** functional and legible, not the showcase. Desktop is the canonical experience for slice one.

## 8. Slice one implementation plan

### Phase 0 — Data spike (days 1–2). Gate.
Prove the curtailment derivation end to end before any interface exists.
- Scripted (Node/TS) pulls: BMU reference data, FPN and BOALF for a recent windy day with known curtailment (cross-check a date against public reporting).
- Compute curtailed MWh for Scottish wind units for that day. Sanity-check the order of magnitude against published figures.
- Confirm Carbon Intensity API regional and generation endpoints and shapes.
- Assess latency and rate limits; decide proxy/cache needs.
- **Exit criteria:** derivation produces a defensible number; a live "current period" query works; total fetch cost per page load is understood.
- **Fallback if the gate fails:** slice one becomes the live grid canvas (mix, regional contrast, forecast) with AI narration; curtailment moves to slice two. This fallback still satisfies all three proofs. Decide at the gate, log the decision, do not extend the spike past day 3.

### Phase 1 — Data layer and static canvas (days 3–5)
- Serverless proxy/cache functions as determined by the spike.
- Typed data layer: fetch, normalise, health-per-source, staleness tracking.
- Static (unanimated) version of the full screen with real live data: layout, hierarchy, typography, all states reachable via a dev toggle (normal, curtailing, no-curtailment, degraded, stale).

### Phase 2 — AI narration (days 6–8)
- Serverless narration function: structured data in, cached narration out, per settlement period.
- Prompt development against real grid states, including dull ones. Log iterations.
- Deterministic fallback template.
- UI treatment of generated text: provenance, freshness, regeneration.

### Phase 3 — Motion and resolution (days 9–12)
- The motion pass: period rollover, ramping, curtailment engaging, narration refresh. Intent, duration and easing documented per transition.
- prefers-reduced-motion alternative.
- Polish pass against the quality bar: typography, spacing, the empty and degraded states.

### Phase 4 — Ship (days 13–14)
- Domain (Owen to choose), analytics-free or privacy-light per Owen's preference, OG images and meta for sharing.
- Cross-browser and mobile-functional check.
- Deploy public. Tag v1.0 of slice one.
- Assemble the case study capture pack: DECISIONS.md, screen recordings, before/after states, prompt iteration history.

### Slice one acceptance criteria
1. Publicly reachable URL showing live grid state, updating each settlement period without reload.
2. Curtailment figure for Scottish wind, live-derived (or the gated fallback, explicitly).
3. AI narration generating per settlement period with deterministic fallback, never empty, never advising.
4. All five states (normal, curtailing, none, degraded, stale) designed and reachable.
5. Motion pass complete and documented; reduced-motion alternative works.
6. DECISIONS.md and capture pack current to ship day.

## 9. Out of scope for slice one
Running cost totals in £ (slice two, needs price joins). Historical views and trends. Personalisation or location awareness. Accounts, sharing beyond OG cards, notifications. Native mobile polish. Any advisory content.

## 10. Slice two candidates (parked, do not build)
Cost-today figure via NESO balancing cost data or bid-price joins. A day/week retrospective ("yesterday Scotland was paid £X to switch off Y GWh"). Forecast-forward view. Embeddable widget.

## 11. Risks
- **Curtailment derivation complexity** — mitigated by the phase 0 gate and named fallback.
- **BMU geography metadata quality** — mitigated by the static Scottish unit list fallback; record the limitation honestly in the product's method note.
- **Narration cost drift** — mitigated by per-period caching; budget assumption is tens of generations per day, not per-visitor.
- **Scope creep toward dashboard** — the one-screen rule and section 9 are the defence. Anything not serving the paradox chain is cut or parked.
- **Quality bar vs deadline** — cut scope, never polish. The fallback slice shipped well beats the full slice shipped rough.

-----

*Method note for the eventual product: Windflaw should carry a short public note explaining the derivation and its limitations. Honesty about method is part of the design position.*

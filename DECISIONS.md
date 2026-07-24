# Windfall — Decision Log

Significant design and technical decisions, recorded as made. The case study needs the reasoning, not just the result.

---

## 001 — Vanilla TypeScript, no React

**Date:** 2026-07-24  
**Phase:** Scaffold  
**Decision:** Vite + vanilla TypeScript. D3 where the visualisation is data-driven, plain SVG or Canvas where it isn't. No component framework.

**Reasoning:** This is one screen, heavily animated, with custom motion at its core. React's render cycle is friction for that kind of work — you'd spend effort preventing re-renders mid-transition rather than building transitions. The DOM is the state for a single-screen product; a virtual DOM is overhead with no payoff.

**Trigger for revisiting:** Genuine component complexity — multiple views, shared interactive state, forms. Nothing in slice one or the parked slice two candidates reaches that threshold.

**What was rejected:** React, Svelte, any component framework. The deciding factor was not preference but the specific interaction between React's reconciliation model and the continuous, choreographed animation that is central to the product's case study value.

---

## 002 — Data spike results: curtailment derivation method validated

**Date:** 2026-07-24  
**Phase:** Phase 0 (spike)  
**Decision:** Proceed with slice one including live curtailment. The PN-vs-BOA derivation method works and the gate passes.

### Carbon Intensity API (`api.carbonintensity.org.uk`)

All endpoints confirmed working, keyless, CORS-friendly.

| Endpoint | Status | Latency | Notes |
|---|---|---|---|
| `/intensity` | 200 | ~300ms | Current national intensity (forecast + actual + index) |
| `/regional` | 200 | ~280ms | 18 regions including North Scotland, South Scotland, combined Scotland |
| `/generation` | 200 | ~100ms | 9 fuel types with percentages |
| `/intensity/fw24h` | 200 | ~60ms | 24h forecast (48 half-hour periods) |
| `/intensity/date/{date}` | 200 | ~250ms | Historical data, 48 periods per day |

**Corrections to the project plan:**
- Forecast endpoint is `/intensity/fw24h`, not `fw48h` (which returns 400). Plan said 48h forecasts; only 24h is available.
- Regional data nests under `data[0].regions`, each with `regionid`, `shortname`, `intensity`, `generationmix`.
- The Scotland/South England contrast works perfectly for the paradox: on 24 July 2026, Scotland was at 0 gCO2/kWh (77.7% wind) while South England was at 52 gCO2/kWh.

### Elexon BMRS (`data.elexon.co.uk`)

Curtailment derivation confirmed working end-to-end.

**Method:** For each Scottish wind BMU and settlement period, curtailment = PN energy (declared output) minus BOALF energy (accepted/instructed output), where the acceptance reduces output below the notification.

**Ground-truth validation (20 June 2026):**
- Public tracker reports 56.45 GWh curtailed for that day.
- Our derivation: **24.25 GWh** — ratio 0.43x.
- Same order of magnitude. Systematic undercount is expected and understood.

**On the 2.3x gap (working hypothesis, not a finding):**
The tracker's 56.45 GWh figure is higher than our 24.25 GWh by a factor of ~2.3. The tracker does not publish its methodology, and NESO's data portal publishes wind availability, forecasts, and metered output but no official daily curtailment volume dataset. So we do not know how the tracker's figure is derived, and cannot explain the gap with confidence.

A *plausible* explanation is that the tracker uses an availability-based method (comparing estimated available wind to metered output), which would capture forms of curtailment our method misses:
- Pre-adjusted PNs (wind farms reducing declarations in anticipation of curtailment)
- Self-curtailment outside the balancing mechanism
- The PN being already below available capacity

But this is conjecture. The gap could also reflect differences in unit coverage, time-boundary handling, or a method we haven't considered.

**Phase 1 follow-up:** cross-check our derivation against de Berker's Wind Curtailment Monitor, which is also balancing-mechanism-derived. If Windfall lands close to another BM-method source, the gap to the tracker becomes a family difference between BM-derived and availability-based methods — explicable rather than unexplained. One script run against a shared date.

**Resolved in 013.** Windfall and the monitor agree to within 1% on three days of six (a fourth inside the monitor's rounding), and both sit at ~0.42x of the tracker. The family difference is confirmed.

**API quirks discovered:**
- PN endpoint uses `settlementDate` + `settlementPeriod` params; PN/stream uses `from`/`to` dates (exclusive end)
- BOALF per-unit `bmUnit` filter is broken — returns 0 items even for units with known acceptances. **Must fetch all BOALFs and filter in code.** This has implications for live queries (larger payloads than necessary).
- BOALF uses `from`/`to` dates and optional `settlementPeriodFrom`/`settlementPeriodTo`

**Scottish wind BMU list:** 50 transmission-connected units curated. Total registered capacity ~8,533 MW (the product computed and displayed 8,574 MW from the same list; the round figure here was never recomputed after Edinbane was added). **Superseded by 015** — the list was 62 units short, and the light validation date is why. 19 of 20 units with BOALFs on the validation date were in our list. Added missing unit (Edinbane, Skye, 41.4 MW). The list covers Seagreen (2 GW), Moray East (0.9 GW), Moray West (0.86 GW), Beatrice (0.68 GW), Viking (0.49 GW), and major onshore farms.

**Top curtailed farms (20 June 2026, our method):**
1. Seagreen: 7.06 GWh
2. Moray West: 6.37 GWh
3. Moray East: 6.24 GWh
4. Viking: 4.42 GWh
5. Dorenell: 0.15 GWh

**Live query confirmed:** tested on 24 July 2026 at 12:16 UTC. 12 Scottish wind units were being actively curtailed (Seagreen, Moray West, Moray East, Neart Na Gaoithe).

**Fetch cost per page load (estimate):**
- Carbon Intensity: 3 requests (~700ms total)
- Elexon PN: 1 request per batch of units (~10 units per batch, 5 batches, but for current period only: 1 request)
- Elexon BOALF: 1 request for current period (~500 items, filter in code)
- Total: 5–7 requests. Server-side cache at 5-min TTL reduces to 0 for concurrent visitors.

### Exit criteria assessment

| Criterion | Status |
|---|---|
| Derivation produces a defensible number | **Pass** — 24.25 GWh vs 56.45 GWh tracker figure (0.43x, gap not yet explained — see working hypothesis above and phase 1 cross-check) |
| Live "current period" query works | **Pass** — tested with live data, 12 units curtailed |
| Total fetch cost per page load understood | **Pass** — 5–7 API calls, cacheable server-side |

**Gate: PASS.** Proceed with slice one including live curtailment.

---

## 003 — The headline number will be smaller than the press figures, by design

**Date:** 2026-07-24  
**Phase:** Phase 0 / Phase 1  
**Decision:** Own the lower bound explicitly. Windfall's curtailment figure is BM-derived instructed curtailment — a floor, not a ceiling. This is a design position, not a data limitation to apologise for.

**The problem:** Octopus's ticker, news coverage, and public commentary cite larger figures derived from availability-based methods or broader definitions of constraint cost. A visitor who has read "£650m wasted" will see Windfall's smaller number and wonder which is wrong. If the product doesn't address this head-on, it reads as an error.

**The design response (three layers):**

1. **"At least" framing on the headline figure.** The number is introduced as a floor: "at least X MWh switched off this period" or equivalent. The language makes the lower-bound status part of the claim, not a footnote.

2. **Method note.** Windfall carries a short public explanation of how the number is derived and what it does and does not include. This is honesty-as-design: the method note is part of the product's position, not small print. It should say what the derivation measures (instructed turn-downs via the balancing mechanism), what it excludes (self-curtailment, pre-adjusted declarations), and why the figure will be lower than availability-based estimates.

3. **Narration prompt inherits the hedging.** The AI narration must never present the curtailment figure as the total picture. Prompt guardrails: use "at least", "instructed to switch off", never "total curtailment" or unqualified "wasted". The narration describes the floor, not an estimate of the ceiling.

**Why this is case study material:** Designing honest data presentation — where the interesting decision is how to frame a number that is deliberately conservative — is exactly the kind of AI-in-product craft the portfolio needs to demonstrate. The alternative (inflating the figure or staying silent about the gap) would undermine the product's credibility with anyone who checks.

**What was rejected:** Switching to an availability-based method (would require wind speed data or metered output joins, adding complexity and an opaque model); showing no number until the gap is fully explained (delays the product for an investigation that doesn't change the design); showing the number without framing (invites the "which is wrong?" question).

**Phase 1 follow-up (from 002):** Cross-check against de Berker's Wind Curtailment Monitor (also BM-derived) to validate like-for-like. If confirmed, the gap to press figures becomes a family difference between methods, not a Windfall-specific discrepancy.

**Resolved in 013 — confirmed.** The three-layer response above stands, and layer 2's method note is rewritten to cite the cross-check instead of speculating about how other figures are derived.

---

## 004 — Upstream failure is data, not an HTTP status

**Date:** 2026-07-24
**Phase:** Phase 1
**Decision:** The serverless functions always return 200. Upstream failures are reported as per-source health flags inside the payload, alongside whatever data was successfully fetched. Every response carries `fetchedAt`, and the client computes staleness from that field rather than from when the response arrived.

**Reasoning:** The project plan requires each visual element to own its own data health, and requires the page to degrade honestly rather than showing a spinner over emptiness. Both fall out of this contract. If Elexon is down and Carbon Intensity is fine, the generation mix renders normally while the curtailment figure alone shows its degraded state — which is only possible if the response carrying the good data isn't an error.

The `fetchedAt` rule is forced by the caching decision in 005. A CDN hit can be five minutes old, and inside the stale-while-revalidate window it can be fifteen. Receipt time would therefore be a lie. A corollary worth being deliberate about: health flags describe upstream state *at* `fetchedAt`, not at delivery. That is correct behaviour — the flags and the data they describe stay in sync — but it means the UI's staleness indicator and its health indicator are reading the same clock, and both must be shown against the timestamp rather than against "now".

**What was rejected:** 5xx on upstream failure. It would make partial responses uncacheable, let one dead source blank working elements, and force the client to guess what it still had.

---

## 005 — CDN response caching, not in-function memory

**Date:** 2026-07-24
**Phase:** Phase 1
**Decision:** Both functions set `Cache-Control: public, s-maxage=300, stale-while-revalidate=600`. The shared cache is the Vercel CDN.

**Reasoning:** The original phase 1 proposal assumed an in-memory cache inside the function would let one visitor's fetch serve the next. It would not. Vercel functions do not share memory between invocations, so an in-process cache is a cache per cold start — on this product's traffic, effectively no cache at all, and no politeness to Elexon either. Since the whole rationale for proxying is caching and rate-limit courtesy, getting this wrong would have quietly invalidated the proxy layer while appearing to work in local testing.

`stale-while-revalidate` also buys graceful degradation free: if an upstream goes slow, visitors keep receiving the last good payload while the refresh happens behind them, which is exactly the behaviour section 5.4 asks for.

The five-minute TTL sits well inside the thirty-minute settlement period, so the cache never hides a rollover.

**What was rejected:** In-memory caching inside the function (does not survive between invocations); a database or KV store (the project plan rules out storage in slice one, and the CDN already provides the shared layer); no caching (impolite to a free public API, and every visitor would pay full upstream latency).

---

## 006 — Two clocks: instantaneous MW and settled MWh

**Date:** 2026-07-24
**Phase:** Phase 1
**Decision:** The curtailment element carries two figures. The headline is instantaneous power — MW currently instructed below declared output. A secondary figure is settled energy — MWh over the last *complete* settlement period.

**Reasoning:** Balancing acceptances arrive throughout a period, so an energy figure for the period in progress grows as the half-hour passes. The same number would mean different things at 14:05 and 14:29, and a visitor landing early in a period would see the deepest undercount. That is a genuine honesty problem, not something copy hedging can fix.

Power and energy have different honest clocks. MW is a true "right now" reading — nothing accumulates, so a mid-period sample carries no undercount at all. MWh only settles once the period closes. Showing both is not two versions of one number; it is two measurements that cannot contradict each other. Live probe on 24 July 2026 bears this out: 2,082 MW instantaneous against 1,029.7 MWh for the preceding period, which is a 2,059 MW average — the two agree to within 1%.

This also resolves a clock mismatch that the alternatives create. The generation mix is a current-period figure; pairing it with a settled-period-only curtailment number would put two different clocks side by side on one screen without acknowledging it.

**Cost:** one extra period of PN and BOALF per request. Marginal, since BOALF is fetched unfiltered regardless, and the two periods fetch in parallel — measured response time is unchanged at ~200ms.

**What was rejected:** Last complete period only (defensible, and it makes a cleaner motion beat at rollover, but it lags the mix by up to thirty minutes on the same screen); current period framed as accumulating (matches the mix's clock, but a number that visibly grows and then resets risks reading as the per-second liveness section 5.4 warns against).

**Open for the composition conversation:** which figure carries the typographic weight, and whether the settled figure earns its place on screen at all or belongs in the method note.

---

## 007 — BOALF period filter matches only the start period; derivation corrected

**Date:** 2026-07-24
**Phase:** Phase 1
**Decision:** Fetch BOALF over a four-period lookback window rather than the target period alone, and let each acceptance record's own time segments determine what is in force. The derivation is re-validated against the phase 0 date.

**The finding:** Elexon's BOALF settlement period filter matches `settlementPeriodFrom` only, not the declared period range. Querying period N returns acceptances that *began* in period N and misses every acceptance that began earlier and is still holding a unit down — which, in sustained curtailment, is most of them. This is a second broken filter on the same dataset, distinct from the broken `bmUnit` filter found in the spike.

Evidence: acceptance 33490 declares itself SP 40→41 but does not appear when querying SP 41. For MOWWO-2 in SP 40, a period-only query returned acceptances covering 3 minutes of the 30-minute period; the unit was in fact held down for 27 of them by an acceptance tagged SP 39→40.

**What acceptance records actually contain:** a profile, not a level. Each acceptance carries a flat segment holding the unit at the instructed level, then a ramp releasing it back towards the declaration. Overlapping acceptances chain, each extending the hold. The live instruction at any instant is therefore the highest-numbered acceptance whose segments cover that instant — no inference or hold-forward is needed, because the coverage is explicit in the data.

**Two derivation refinements adopted alongside the fix:**
- Acceptance precedence resolves per instant rather than per period, so a later instruction supersedes an earlier one only for the time it actually covers.
- Shortfalls are clamped at zero per sample, so a unit instructed *above* its declaration for part of a period cannot net off curtailment elsewhere in that period. This is the stricter reading of "instructed to switch off", and consistent with 003's floor framing.

Energy is integrated by sampling at one-minute midpoints rather than solved in closed form: overlapping acceptances make the effective instruction profile fiddly to integrate analytically, and 50 units × 30 samples is free.

**Re-validation (20 June 2026):** 23.75 GWh, against the spike's 24.25 GWh — within 2%, with the per-farm breakdown tracking closely (Seagreen 6.89 vs 7.06, Moray West 6.10 vs 6.37, Moray East 5.91 vs 6.24, Viking 4.73 vs 4.42). Ratio to the public tracker is 0.42x, essentially unchanged from the spike's 0.43x. **Decisions 002 and 003 stand, and the de Berker cross-check remains the right follow-up.**

**Why this matters beyond the number:** the spike arrived at approximately the right answer through two errors that partly cancelled. It compared a full-period PN integral against an acceptance integral covering only the instructed window, which inflates every partial-period acceptance; and it fetched only the acceptances tagged to each period, which loses most of them. Reproducing the gate figure with a method that reads the data correctly is what makes the number defensible to anyone who checks the working. Had the fix been applied to the fetch alone, the figure would have been 10.87 GWh and the gate would have looked like a failure.

**Cost implication:** live queries fetch four periods of BOALF rather than one. The windows fetch in parallel and the response is a few hundred items either way, so measured latency is unchanged (~200ms). Recorded because it raises the per-request payload from the spike's estimate in 002.

---

## 008 — The composition: a north–south section, not a dashboard

**Date:** 2026-07-24
**Phase:** Phase 1 (stream B — static canvas)
**Decision:** The screen is laid out as a vertical section through Britain. Reading top to bottom: what Scotland is making, how much of it is switched off, the line that stops it travelling, what burns in the south instead.

**Reasoning:** The project plan states the paradox chain — wind, constraint, substitution, cost — and asks for one screen with one argument. The chain is already geographic, so making reading order match geography means the layout carries the argument rather than merely containing it. The alternative shapes all weaken it: a panel grid invites the eye to compare rather than to follow, and a map of Britain would spend most of the screen on coastline that carries no data.

The two region bars do the heaviest lifting. They are drawn on the same scale, in the same fuel sequence, one directly above the other, so the length of the fossil tail is comparable north to south before any number is read. Fuels are ordered zero-carbon first and fossil last rather than by size, which keeps a segment in the same place between refreshes — necessary once the bars animate in phase 3.

**What was rejected:** A map (coastline is not data); a left–right split of Scotland against England (loses the sense of power failing to travel, and puts the constraint in a vertical gutter where it reads as a divider rather than a barrier); a panel dashboard (explicitly out of scope, and the one-screen rule exists to prevent it).

---

## 009 — MW carries the typographic weight; MWh supports it

**Date:** 2026-07-24
**Phase:** Phase 1 (stream B)
**Decision:** Resolves the question left open in 006. The instantaneous MW figure is the headline. The settled MWh figure stays on screen as a single line beneath it, always named as a completed period.

**Reasoning:** Two arguments point the same way. MW is the only figure that is honest at every moment inside a settlement period, which is what 006 established. And MW shares a clock with the generation mix directly above it, so the two readings on the top half of the screen are measurements of the same instant — pairing a current mix with a settled-period-only curtailment figure would put two clocks side by side without saying so.

MWh earns its line because energy is what the money is eventually paid against, and because a reader who wants to convert the figure into something felt needs a quantity, not a rate. It did not earn the headline: a figure that only settles on the half-hour cannot lead a screen whose whole claim is about now.

**What was rejected:** MWh as headline (lags the mix by up to thirty minutes on the same screen); MWh moved to the method note (loses the only figure that accumulates, and with it the sense of scale over time).

---

## 010 — Copy is a function of state, including the unreadable state

**Date:** 2026-07-24
**Phase:** Phase 1 (stream B)
**Decision:** Every sentence that asserts something about the constraint is written three times — constrained, clear, and unknown — and selected from the data. The headline's tense follows freshness. The masthead's second line is a slot that carries the standfirst normally and a staleness notice when the reading is old.

**Reasoning:** This was not the plan going in; building the states surfaced it. With static copy, the calm-day screen said "Scotland generates more than the network can carry away" while showing no curtailment, and the Elexon-outage screen asserted that the network was coping at the exact moment the page could not tell. Both are false claims made confidently, which is the specific failure the product cannot afford: a reader who checks one of them stops trusting the number as well.

The same reasoning forced the tense. A 47-minute-old reading under the words "right now" is wrong regardless of what colour the timestamp is; staleness treatment that only recolours a dot leaves the lie in the largest type on the page. So the predicate changes to "was being held off the grid when this was last read", and the standfirst — which a returning visitor does not need — gives its place to the notice. Swapping rather than adding also keeps the composition to one screen in every state.

**Consequence for phase 2:** the narration prompt inherits this. It must be told the freshness and the constraint state, not only the figures, or it will generate the same confident sentence the static copy did.

---

## 011 — Provisional identity: DM Sans, dark only, no forecast element

**Date:** 2026-07-24
**Phase:** Phase 1 (stream B)
**Decision:** Three deliberately provisional calls, made to get V1 standing rather than to settle the identity.

**Type:** DM Sans, self-hosted as a variable font, routed through a single `--font-sans` token. Weight carries hierarchy — light for the large figures, medium for the small ones — which leaves colour free to mean fuel and only fuel. Swapping the family is one declaration. Owen's established Fraunces/IBM Plex palette was not inherited, per the plan's note that Windfall may warrant its own identity.

**Ground:** dark only. The reference (earth.nullschool) is a lit field on a dark ground, and the fuel palette is built to glow against it. A light variant would be a second design rather than a setting, and slice one does not have room for two.

**Forecast:** the 24-hour forecast is fetched and cached but not drawn. It does not sit on the paradox chain — it is context, and context is what turns one screen into a dashboard. It stays in the payload because phase 2's narration wants forecast direction, which is a sentence rather than a chart.

**Trigger for revisiting:** all three on Owen's review of the built screen, which is the point at which there is something concrete to react to.

---

## 012 — The state toggle ships in production

**Date:** 2026-07-24
**Phase:** Phase 1 (stream B)
**Decision:** The five-state switcher is reachable on the deployed site at `?state=…`, not stripped from the production build. Each fixture is the captured live payload bent into the shape of a state and rebased onto the real settlement clock.

**Reasoning:** Four of the five states cannot be summoned on demand — a calm day, an Elexon outage, a stale cache. The case study capture pack needs all of them from the deployed artefact rather than from a dev server, and a reviewer following a link should be able to see the degraded state without being asked to take it on trust.

The rebasing matters more than it looks. Without it every fixture screen would read as hours old and the staleness treatment could not be judged against the states it is supposed to distinguish from.

One fixture is deliberately not a straight copy: the calm-day mix moves Scotland's wind onto imports, nuclear and hydro rather than gas, because Scotland has almost no gas plant. A fixture showing 60% gas in Scotland would teach the wrong thing to anyone reviewing the state.

**Cost:** the captured sample adds roughly 15 kB to the bundle, which is most of the 9 kB gzipped JavaScript. Acceptable at this size; if it grows, the fixtures move behind a dynamic import keyed on the query parameter.

---

## 013 — The cross-check lands: the gap to press figures is a method-family difference

**Date:** 2026-07-24
**Phase:** Phase 1 (stream C — cross-check)
**Decision:** Closes the follow-up left open in 002 and 003. Windfall's derivation is validated against a second balancing-mechanism source and agrees with it. The 0.42x ratio to the public tracker is a difference between method families, not a Windfall error, and the method note now says so on evidence rather than on conjecture.

**The comparator:** the UK Wind Curtailment Monitor (Peter Dudfield and Archy de Berker, `wind.axle.energy`). Its published methodology confirms the same two datasets Windfall uses — FPN for what units declared they could generate, BOAL for what the grid instructed instead — so it is a genuine member of the same family rather than a second opinion from a different one. Its chart legend reads "Wind Potential", which could be mistaken for an availability model; the methodology makes clear the potential is the physical notification.

**Results.** Six days, chosen to span a near-calm day to a heavily constrained one, with a run of consecutive recent days added after the first pass showed the largest disagreement on the most recent date.

| Date | Windfall | Monitor | Ratio |
|---|---|---|---|
| 13 June | 51.08 GWh | 58.50 GWh | 0.873x |
| 20 June | 23.75 GWh | 23.50 GWh | **1.010x** |
| 18 July | 11.00 GWh | 10.90 GWh | **1.010x** |
| 21 July | 7.73 GWh | 7.80 GWh | **0.992x** |
| 22 July | 0.55 GWh | 0.60 GWh | 0.913x |
| 23 July | 9.26 GWh | 7.20 GWh | 1.287x |

*These are the figures from the 50-unit list. 015 replaces that list and re-runs the whole table; the conclusion of this entry survives, the 13 June row does not.*

Three of six agree within 1%; mean ratio 1.014x. A fourth, 22 July, differs by 0.05 GWh — inside the 0.1 GWh the monitor rounds to, so it is agreement that cannot be measured more finely rather than a 9% miss. On 20 June — the phase 0 validation date — Windfall reads 23.75 GWh against the monitor's 23.50 while the public tracker reports 56.45. **Both balancing-mechanism methods sit at roughly 0.42x of the tracker.** That is the finding: the gap is a property of the method family, and it reproduces in a project that has nothing to do with this one.

This upgrades 003 from a defensible position to a supported one. The floor framing was always the honest choice; it is now also the demonstrably consistent one.

**On the two outliers, and what was ruled out.** Two divergences in opposite directions cannot share one cause. Being *higher* than the monitor is the informative case, because the monitor covers more units than Windfall's 50 Scottish ones, so scope can only push its figure up.

Three hypotheses were tested and eliminated:

- **The zero-clamp (007).** Measured directly: over-instruction energy is **exactly zero** on all six days. Wind units are never instructed above their declaration, which makes sense — an offer to generate more is not physically available to a wind farm. The clamp is a correctness safeguard that never binds on this dataset. Worth knowing, and it means 007's stricter reading costs nothing.
- **The SO flag.** Acceptances distinguish system-operator actions from energy balancing, and Windfall counts both. On 23 July every acceptance is already SO-flagged, so the flag cannot explain that day's excess. On 20 June, filtering to SO-only slightly *raises* the figure, via acceptance precedence — removing a higher-numbered non-SO acceptance lets a lower instructed level win.
- **Recency.** 23 July is the most recent complete day, so unsettled data was the obvious candidate. But 21 and 22 July are nearly as recent and agree at 0.992x and 0.913x.

So 13 June is most likely unit scope — a heavily constrained day is when curtailment outside a 50-unit Scottish list is most likely to appear. 23 July was recorded as unexplained rather than attributed to the nearest plausible cause. It has since been explained; see 014. **Unit scope was the right guess and is confirmed in 015**, which also shows it overshoots: with the full population the day lands 17% *above* the monitor.

**A caveat on ratios.** The monitor publishes to 0.1 GWh. On 22 July the absolute difference is 0.05 GWh and the ratio of 0.913x is mostly rounding. Ratio is the wrong statistic on a near-calm day, and the product should never be tempted to display one.

**Consequence for the product:** the method note previously stated that larger published figures "are usually derived by estimating how much wind was available and subtracting what was metered". That was conjecture presented as fact — precisely the failure 010 named — since the tracker does not publish its method. It is replaced by what can be shown: that an independent tracker reading the same balancing data agrees with Windfall to within about 1% on most days. "On most days" is doing honest work there and should survive future copy edits.

**What was rejected:** wiring the monitor in as a live comparator (Windfall must never need another project to be up in order to render, and the cross-check is a validation, not a feature); citing the agreement as a precise figure such as "within 1%" without qualification, when it is three days in six.

---

## 014 — The 23 July outlier was a gap in the comparator, found by localising before theorising

**Date:** 2026-07-24
**Phase:** Phase 1 (stream C)
**Decision:** 23 July is resolved. The monitor's published series for that day is missing two half-hours, 19:00 and 19:30, and those two periods carry 1,696.5 MWh in Windfall's derivation — 84% of the 2.03 GWh disagreement. Excluding them, the day agrees at 1.046x rather than 1.287x (1.049x against 1.297x on the 015 unit list), which puts it in line with every other day sampled.

**How it was found, which is the part worth keeping.** Three hypotheses had already been eliminated in 013 by reasoning about mechanisms — the clamp, the SO flag, recency. A fourth guess would have been the same move again. Instead the question changed from *why* to *where*: `scripts/day-profile.ts` prints the day per period and per farm, on the argument that a single farm, a single window, and a uniform spread each imply a different cause and the shape distinguishes them before any mechanism is proposed.

The shape showed one continuous evening event peaking at 19:30 — exactly where the comparator turns out to have no data. Localising first would have found this before any of the three mechanism hypotheses were tested, and the general lesson is to reach for the profile before the theory.

**Confirming it is specific to that day:** the monitor's own chart traces were read directly. 23 July returns 46 half-hourly points where a settlement day has 48; 21 June and 13 June both return a complete 48 with no gaps. The daily headline figure is the sum of the same incomplete series (7.231 GWh against a published 7.2), so the gap propagates into the published total rather than being a plotting artefact.

**Said plainly and without inflation:** this is a missing-data gap in a hourly-updating side project, on a day that was then the most recent complete one. It is the kind of thing that may well self-heal on a later ingest, and it says nothing about the monitor's method — which is the thing the cross-check was actually testing, and which continues to agree with Windfall. Finding it does not make Windfall more right; it removes a false disagreement.

**A residue that is not explained.** The missing periods account for 84% of the gap, not all of it. From 22:00 to the end of the day Windfall reads consistently higher — 1,991 MWh against 1,647, a further 344 MWh. That tail is unexplained and is left so. The candidate is the same late-day incompleteness affecting the final hours less totally, but nothing here demonstrates it.

**Consequence for the method note:** the note said 23 July was "not yet explained". It now reports the corrected figure *and* the correction, because a reader reproducing the comparison from the monitor's site today would get 29%, not 5%. Presenting only the corrected number would fail the exact test the note exists to pass.

**What was rejected:** dropping 23 July from the sample (removing the day that disagrees is how a validation becomes a decoration); reporting only the corrected 1.046x (unreproducible from the public source); treating the finding as an error in the monitor (it is a gap in one day's data, found in a project whose author openly describes it as evenings-and-weekends work, and the courtesy costs nothing).

**Correction made while writing this up:** the first pass through these ratios counted four days within 1% rather than three, by reading 22 July's 0.913x as agreement. It is agreement, but by rounding rather than by measurement, and the two are not the same claim. Recorded because the note's whole purpose is to survive a reader checking the arithmetic.

---

## 015 — The BMU list was validated on the one day its gaps could not bind

**Date:** 2026-07-24
**Phase:** Phase 1 (review follow-up)
**Decision:** Replace the 50-unit hand-curated list with all 112 transmission-connected Scottish wind BMUs, derived from Elexon's BM unit registry. Closes the "most likely unit scope" left open in 013.

**The test 013 called for.** 13 June was re-derived over every transmission-connected wind BMU, then split into tracked and untracked using Windfall's own level derivation, so the comparison is like-for-like. The reimplementation reproduced the tracked figure exactly.

| Date | Tracked 50 | Everything else |
|---|---|---|
| 13 June (heavy constraint) | 51.08 GWh | 18.45 GWh across 41 units |
| 20 June (the validation date) | 23.75 GWh | 0.00 GWh |
| 23 July | 9.26 GWh | 0.15 GWh, mostly London Array |

**Why this is the part that matters, and not the number.** The gap is ~0 on ordinary days and ~36% of the headline on heavily constrained ones. The phase 0 check — 19 of 20 units with acceptances on 20 June were in the list — was therefore run on the single day where the list's gaps could not bind. **The list looked validated because it was validated on a light day.** A coverage check has to be run on the day the product is about, which is the constrained day, or it measures nothing.

Two omissions self-evidenced without any geography: GORDW-1 was missing while GORDW-2 was tracked as "Gordonbush Ext", and WHILW-1 (309 MW) was missing while WHILW-2 was tracked as "Whitelee Ext". The extensions were in and the parent farms were out — a shape that says the list was assembled by recognising names rather than by enumerating a population.

**The new basis.** Every BM unit with `bmUnitType` T and `fuelType` WIND whose farm is in Scotland or Scottish waters: 112 units, 13,105 MW, capacities taken verbatim from the registry's `generationCapacity` so the total on screen traces to a published figure. Membership stays a static list because the registry has no usable location field for transmission units (`gspGroupId` is populated only for embedded ones) — so "in Scotland" is a judgement made once, in `api/_lib/bmus.ts`, and never at runtime.

The floor framing (003) is unaffected: embedded and distribution-connected Scottish wind still does not appear, and Baillie (BABAW-1) is the nearest miss — Caithness, registered E rather than T.

**What it does to the cross-check.** The whole table was re-run:

| Date | Windfall (112 units) | Monitor | Ratio |
|---|---|---|---|
| 13 June | 68.34 GWh | 58.50 GWh | 1.168x |
| 20 June | 23.75 GWh | 23.50 GWh | **1.010x** |
| 18 July | 11.10 GWh | 10.90 GWh | **1.018x** |
| 21 July | 7.90 GWh | 7.80 GWh | **1.013x** |
| 22 July | 0.57 GWh | 0.60 GWh | 0.954x |
| 23 July | 9.34 GWh | 7.20 GWh | 1.297x |

Three days sit within 2% where three sat within 1%, and 22 July's difference is still 0.03 GWh — inside the monitor's rounding, as 013 said. 13 June has flipped from 13% low to 17% high, which is a real change of sign and is **not** claimed as resolved. Windfall now measures a larger population than the comparator does on the day when population matters most; that is a plausible reading of a 1.168x, not a demonstrated one, and the honest position is that the largest disagreement in the sample moved rather than closed.

**Consequence for the product:** the method note's coverage line is generated from the payload, so it now reads 112 units and 13,105 MW, and "transmission-connected Scottish wind units" is finally the population rather than a subset of it. The cross-check paragraph is rewritten against the new table, including the 17%.

**What was rejected:** adding only the ~21 farms the 13 June split named (that repeats the original error — patching a list by recognition instead of enumerating a population, and the next constrained day would find the next gap); deriving membership at runtime from `gspGroupId` (not populated for T units, so it would silently empty the list); keeping the old capacities where they differed from the registry (two sources for one number is how 002's 8,533-vs-8,574 drift happened).

---

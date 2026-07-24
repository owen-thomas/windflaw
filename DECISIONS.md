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

**API quirks discovered:**
- PN endpoint uses `settlementDate` + `settlementPeriod` params; PN/stream uses `from`/`to` dates (exclusive end)
- BOALF per-unit `bmUnit` filter is broken — returns 0 items even for units with known acceptances. **Must fetch all BOALFs and filter in code.** This has implications for live queries (larger payloads than necessary).
- BOALF uses `from`/`to` dates and optional `settlementPeriodFrom`/`settlementPeriodTo`

**Scottish wind BMU list:** 50 transmission-connected units curated. Total registered capacity ~8,533 MW. 19 of 20 units with BOALFs on the validation date were in our list. Added missing unit (Edinbane, Skye, 41.4 MW). The list covers Seagreen (2 GW), Moray East (0.9 GW), Moray West (0.86 GW), Beatrice (0.68 GW), Viking (0.49 GW), and major onshore farms.

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

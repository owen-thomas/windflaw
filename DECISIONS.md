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

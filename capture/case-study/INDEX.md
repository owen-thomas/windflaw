# Case study capture pack

Assembled 2026-07-28, against `v1.0` ([f47746a](https://github.com/owen-thomas/windflaw/commit/f47746a)), the commit live at
[windflaw.co.uk](https://windflaw.co.uk) when this pack was built.

**[DECISIONS.md](../../DECISIONS.md) is the primary source.** It carries the reasoning —
what was tried, what was rejected, and why — for everything summarised here. This pack is
the visual evidence for that reasoning, not a replacement for it. Two entries govern how
everything below must be read:

> **DECISIONS 269:** "the capture pack comes from these deployed screens" — every state
> screenshot below is captured from the live production site, not a local dev server.

> **DECISIONS 486:** "Any capture used in the case study that was produced via the state
> toggle rather than a live rollover must be labelled as a fixture demonstration, not a
> captured live transition." Applied below wherever it's relevant — see the transition
> recording.

---

## states/ — all seven reachable states, plus true live

Captured at 1440×900 from `https://windflaw.co.uk` on 2026-07-28. Six of the seven are
reached via `?state=<name>` — production-shipped fixtures per DECISIONS 012 and 269,
specifically because four of the five original states (calm, degraded, stale, waiting)
cannot be summoned from the real grid on demand.

| File | State | Provenance |
|---|---|---|
| `live.png` | Whatever the grid is actually doing at capture time | **Genuine live reading** — no `?state=` param |
| `curtailing.png` | A windy evening, 1.8 GW held down | Fixture (`?state=curtailing`) |
| `calm.png` | A still day, nothing curtailed — a first-class state, not an edge case | Fixture (`?state=calm`) |
| `degraded.png` | Elexon unreachable; the generation mix still renders | Fixture (`?state=degraded`) |
| `stale.png` | Nothing refreshed for 47 minutes, a settlement period has closed | Fixture (`?state=stale`) |
| `waiting.png` | Pre-first-fetch: the page has asked nothing yet (DECISIONS 016) | Fixture (`?state=waiting`) |
| `offline.png` | The client can't reach its own functions — nothing to degrade to | Fixture (`?state=offline`) |

`live.png` is the only one of these that is not a fixture — it's an honest capture of
whatever period the grid happened to be in on the day this pack was built.

---

## before-after-016/ — a real regression, reproduced

DECISIONS 016 ("`Has not answered yet` is a state, and the page was skipping it")
documents a real bug: `main.ts` rendered synchronously with empty feeds before the first
fetch was issued, so *empty-and-untried* looked identical to *tried-and-failed* on every
cold load. Rather than describe this from memory, both sides were reproduced from the
actual git history under identical synthetic conditions — every `/api/*` response delayed
5 seconds, screenshot taken 500ms after navigation, on a local dev server:

| File | Commit | What it shows |
|---|---|---|
| `before-cold-load.png` | [`746ac08`](https://github.com/owen-thomas/windflaw/commit/746ac08) (parent of the fix) | Three confident false claims — "not reaching its data sources," "unavailable," "no reading arrived" — asserted about a fetch that simply hadn't resolved yet |
| `after-cold-load.png` | [`b1f0c44`](https://github.com/owen-thomas/windflaw/commit/b1f0c44) (the fix, and everything since) | The same synthetic delay, same capture point: a neutral "Reading… Windflaw is asking Elexon what is being held down this half-hour. Nothing is claimed until it answers." |

Same delay, same timing, same viewport — the only variable is the commit.

---

## transition-demo/ — the arrival crossfade

`waiting-to-curtailing.webm` (5.3s, 1440×900).

**This is a fixture demonstration, not a captured live transition — see DECISIONS 486.**
It was produced by loading `?state=waiting&dev=1` (the honest pre-fetch state) and then
clicking the toggle to `curtailing`. `main.ts`'s `selectScenario()` clears feeds to
empty-and-pending before applying the new scenario (DECISIONS 020, point 4), so the switch
plays out as a genuine arrival choreography — the same staggered per-field crossfade
(`--stagger-step`, north → headline → constraint → south → narration) a first-time visitor
actually sees — rather than a hard cut between two fixtures' numbers.

It is **not** a recording of a live settlement-period rollover or curtailment engaging;
those moments were explicitly ruled out as toggle-driven captures by the same DECISIONS
entry, precisely because presenting a synthetic juxtaposition as the real event would be
the same failure DECISIONS 013/014 exist to avoid.

---

## narrate-eval-log.txt — the prompt-iteration log

Output of `npm run narrate:eval`, which DECISIONS 019 names directly as "the phase 2
prompt-iteration log": it runs the same `situationOf → buildPrompt → generate → validate`
path `api/narration.ts` uses, against the three fixtures that have anything to narrate
(`curtailing`, `calm`, `degraded`).

**This run is a dry run.** No `ANTHROPIC_API_KEY` is configured for this deployment (a
deliberate choice — see the narration slot's deterministic-template fallback), so the log
shows the exact facts and constructed prompt for each fixture but stops short of a model
call. Re-running with a key appends the generated text, its word count against the
40–70 word band, and the validator's pass/fail verdict (hallucinated-figure check,
second-person ban, exclamation-mark ban) for each fixture.

---

## What's not in this pack

- **Real generated narration examples** — blocked on the dry-run limitation above.
- **A live rollover or curtailment-engaging recording** — per DECISIONS 486, capturing
  these honestly means waiting for the actual settlement-period event on the deployed
  site, not staging one.
- **Cross-browser (WebKit/Safari) screenshots** — attempted separately; the iOS Simulator
  panel crashed and stopped retrying. The states/ captures above are all Chromium.

# Windflaw Flow Experiment — V1 Implementation Spec

Handoff brief for building the first version of the generative flow visual. Written to be
self-contained: everything needed to implement is in this file. Reference imagery lives in
`reference/` — the two most important are `Art Pin.gif` (motion character: comet-trail
particles streaming through a dark field) and `Digital Art.jpg` (light mode character:
inky blue strokes on cream, dense tapestry).

## What this is

A separate page in this repo — a full-screen generative canvas, completely independent of
the existing dashboard UI. Particles are born at seven Scottish wind farms, flow down and
spread through an **invisible** Great Britain boundary, and render as organic comet-trail
lines. The GB shape is never drawn; it emerges as the boundary between where lines travel
and where they don't.

V1 uses **no real data**. But every knob that live data will eventually drive must already
be a parameter (see "Scalability" below).

## Decisions already made (do not revisit)

- **Stack**: vanilla TypeScript + Canvas 2D, in this repo, as a second Vite page (`/flow`).
  No frameworks, no p5.js, no rendering libraries. Match the existing repo conventions
  (vanilla TS, explicit `.js` extensions on relative imports for Node ESM compatibility).
- **Palette**: both dark and light modes, switchable at runtime from day one.
  - Dark: near-black field, pale luminous trails (see `Art Pin.gif`).
  - Light: cream/paper ground, inky blue strokes (see `Digital Art.jpg`).
- **V1 sources** (seven): the five from the map screenshot plus Clyde and Whitelee.
- **Offshore/island handling**: sources not on the GB mainland get snapped to the nearest
  mainland coast point so every line lives in one connected landmass.

## Source list

Coordinates are approximate — fine for V1, this is not a data product yet.

| id          | name                  | lat      | lon      | note                                        |
|-------------|-----------------------|----------|----------|---------------------------------------------|
| edinbane    | Edinbane Wind Farm    | 57.47    | -6.42    | On Skye — snap to mainland at Kyle of Lochalsh (~57.28, -5.65) |
| seagreen    | Seagreen Offshore     | 56.60    | -1.90    | Offshore — snap to Angus coast (~56.65, -2.42) |
| cumberhead  | Cumberhead Wind Farm  | 55.55    | -3.92    |                                             |
| hagshawhill | Hagshaw Hill Wind Farm| 55.57    | -3.88    |                                             |
| northkyle   | North Kyle Wind Farm  | 55.3517  | -4.3597  | From the dropped pin on the map screenshot  |
| clyde       | Clyde Wind Farm       | 55.46    | -3.95    | Abington                                    |
| whitelee    | Whitelee Wind Farm    | 55.68    | -4.28    | Eaglesham Moor, UK's largest onshore        |

Source type (from day one, even though V1 ignores it):

```ts
interface Source {
  id: string;
  name: string;
  latLon: [number, number];   // raw location
  anchor?: [number, number];  // snapped-to-mainland override, if needed
  type: 'wind';               // later: 'solar' | 'gas' | 'nuclear' | ...
  rate: number;               // particles/sec — later driven by live output
  palette?: string;           // per-source colour channel key
}
```

## Core mechanics

### 1. The GB container

- Obtain a simplified Great Britain **mainland** coastline polygon (Natural Earth 1:10m or
  ONS Open Geography boundaries; simplify to roughly 500–2000 points) and check it into the
  repo as JSON. Mainland only for V1 — no islands (Skye, Anglesey, Wight all excluded;
  that's why island sources snap to the coast).
- Project lat/lon to canvas space. A simple scaled equirectangular projection with a
  `cos(mid-latitude)` correction on longitude is sufficient at this scale — no projection
  library needed. Fit the polygon's bounding box to the viewport with padding, preserving
  aspect.
- Precompute two structures at load (and on resize):
  - **Raster mask**: draw the projected polygon filled onto an offscreen canvas, read back
    the pixel buffer once. "Is this point inside GB?" is then a constant-time array lookup.
    Particles that step outside are killed (or steered — see below), never drawn outside.
  - **Signed distance field + gradient**: on a coarse grid (e.g. every 4–8 px), distance to
    the nearest coast and the direction of that gradient. Used to steer particles *along*
    the boundary as they approach it, so lines curve and glide down the coastline instead
    of piling up or clipping. **This steering is the detail that makes or breaks the
    "contained but not drawn" effect.** Brute-force nearest-segment distance at grid
    resolution is fine to compute once at load.

### 2. The flow field

An authored vector field sampled on a coarse grid (this is where the art direction lives).
It is deliberately independent of data. The field at any point is a weighted sum of:

1. **Southward base drift** — strongest in Scotland, weakening as it spreads into England
   (energy dispersing). Add a gentle east–west spread component in England so flow fans
   out across the country rather than running down a single spine.
2. **Curl noise** — divergence-free noise (curl of a scalar simplex/perlin field) evolving
   slowly over time, for the organic swirl and eddy character of the references.
3. **Boundary steering** — from the distance field: within a threshold distance of the
   coast, blend in the tangential direction (perpendicular to the distance gradient,
   whichever tangent better matches current heading) and a small inward push.
4. **Source outflow** — mild radial outflow within a small radius of each source, so lines
   bloom outward before joining the drift.

Every component has an independently tunable weight. "More swirly", "more directional",
"hug the coast harder" must be slider moves, not rewrites.

### 3. Particles and trails

- A few thousand particles (start ~3000, make it a slider up to ~8000). Each is emitted at
  a source (weighted by per-source `rate`), advected through the field each frame, and
  dies by age, by leaving the mask, or by slowing to a stop in the far south — then
  respawns at a source.
- **Trail rendering**: the classic fade technique. Each frame, wash the whole canvas with
  a low-alpha rect of the background colour, then draw each particle as a short segment
  from its previous to current position. Lines dissolve behind themselves into comet
  trails. Works identically in both palettes because the wash colour is just the current
  background. Trail length = inverse of wash alpha (tunable).
- Per-particle stroke weight and colour come from its source's palette channel. Small
  per-particle jitter in weight, speed, and hue gives texture — the references are
  organic, not uniform.
- Density variation is the composition: sources with higher `rate` produce visibly denser,
  heavier streams. This is the mechanism that later shows "more active" farms.

### 4. Control panel

A small tweak UI, hidden by default, toggled with a keypress (e.g. `h`). Hand-rolled or
lil-gui — if hand-rolled matches repo conventions better, do that. Controls:

- particle count, global speed, trail length (wash alpha), stroke weight, jitter amount
- field weights: drift strength, drift spread, noise scale, noise speed, noise weight,
  boundary steer distance + strength, source outflow radius + strength
- per-source emission rate sliders (seven of them)
- palette toggle (dark/light), random seed (re-seedable)
- **preset save/load as JSON** (export to clipboard/file is enough). Ship two presets:
  "calm" and "windy Scotland surplus" (north sources high, southern drift damped) to
  preview how live data will inhabit the visual.

## Scalability contract (design in, don't build)

The renderer must only know about the `Source[]` array and global parameters. Future
iterations change *inputs*, not mechanics:

- live wind output → per-source `rate`
- surplus wind in Scotland → high emission north, damped/lighter activity travelling south
- England's generation mix → more sources with different `type` and palette (solar
  simplified to major solar farms)
- information layer (current windflaw.co.uk content) → HTML/SVG overlaid on the canvas,
  not drawn into it

Nothing in V1 should need undoing for any of these.

## Performance target

60fps at ~3000–5000 particles on a mid-range laptop, Canvas 2D. Keep per-frame work to:
one wash rect, one field lookup + one mask lookup + one segment draw per particle. Field
and distance lookups are precomputed-grid samples with bilinear interpolation (or nearest —
try nearest first, it's probably fine). If we ever want 10× the particles, the upgrade
path is WebGL with the same field/mask logic — do not build that now.

## Build order

1. **Skeleton** — `/flow` page wired into Vite (multi-page config), GB polygon projected,
   raster mask + distance field working, crude particles proving containment. Ugly is fine.
2. **Motion** — field shaping until the down-from-Scotland-and-spread-across-England
   journey reads clearly and coast steering feels natural (watch the west coast around
   Galloway/Cumbria and the Welsh border — flow should glide, not scrape or leak).
3. **Art pass** — trails, texture, stroke character, both palettes, tuned against
   `Art Pin.gif` (dark) and `Digital Art.jpg` (light).
4. **Controls & presets** — the panel, per-source rates, the two shipped presets.

Stop and show progress after step 1 — containment + steering feel is the risk, and it's
cheaper to react to it before the art pass.

## Acceptance criteria

- No particle is ever drawn outside the GB coastline; the island's shape is clearly
  legible from the motion alone, with no outline drawn.
- Flow visibly originates at the seven sources, travels broadly southward, and fans out
  across England; near coasts it turns to run alongside them.
- Trails feel organic and hand-made (varied weight/speed/hue), not like a uniform
  particle system.
- Dark and light palettes both work with the same mechanics, toggled live.
- All listed parameters adjustable live; presets round-trip through JSON.
- 60fps at default settings on a mid-range laptop.

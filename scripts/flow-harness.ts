/**
 * Headless instrumentation harness for the /flow particle simulation —
 * the "instrumentation change" called for in `Flow experiment step 2.txt`.
 * Nothing like this existed in the repo yet (the plan's "existing headless
 * harness" refers to ad-hoc analysis from an earlier session, never
 * committed); this is that harness, built to run in plain Node with no
 * browser and no canvas polyfill dependency — `buildRasterMask` falls back
 * to a pure-JS scanline fill when neither `OffscreenCanvas` nor `document`
 * exists (see src/flow/mask.ts), so the whole simulation runs headless.
 *
 * 2j of `Flow experiment fan-out.txt` repoints this report's priority.
 * step 2's framing of success was transport ("surplus visibly travels
 * Scotland -> England", measured as throughput-by-latitude) — that's what
 * produced the funnel 2f-2i exist to undo. The metrics below are now
 * ordered PRIMARY (what 2f-2i actually target) then GUARD-RAILS (what
 * step 2 targeted, kept as sanity checks, not goals) then CORRECTNESS
 * (must hold regardless of any tuning):
 *
 *  PRIMARY — "does it fan out and fill the space, placed rather than piled":
 *  - interior coverage + concentration on a coarse visit grid (a "river" is
 *    a coverage number near the floor and a concentration number near the
 *    ceiling)
 *  - spacing quality: per-cell density distribution off 2g's own occupancy
 *    grid (low variance = evenly placed) and nearest-neighbour distance
 *    between particles at the final frame, plus the same population split
 *    by 2h's coarse noise phase (should separate into two different means
 *    — "gathered" cells denser than "loosened" ones — when
 *    spacingWaveAmplitude is doing its job; collapse to one when it isn't)
 *
 *  GUARD-RAILS — sanity checks that "overall southward journey" survived
 *  2f-2i's rework, not targets to maximise:
 *  - direction coherence: mean southward heading component (particles.hy)
 *  - throughput by latitude band + death-cause breakdown + lifespan
 *    distribution (step 2's old headline metrics)
 *
 *  CORRECTNESS — must hold no matter what:
 *  - a hard containment-escape assertion (must stay exactly zero, always)
 *  - strike rate (a steering-health signal, not a hard invariant)
 *  - frame cost at the given particle count
 *
 * These are a steering aid, not the target — the final call on "does it
 * read as a broad tapestry" is visual, against the reference images named
 * in `Flow experiment fan-out.txt` — but they're what makes that checkable
 * instead of arguable.
 *
 * Run with:
 *   npx tsx scripts/flow-harness.ts [--particles=3000] [--seconds=60] [--legacy]
 *     [--baseFieldMode=divergent|south] [--noDensity]
 *     [--noiseMode=transverse|isotropicCurl] [--noConform]
 *
 * --legacy reproduces step 1's fixed 4-9s age-budget ceiling (only), for a
 * true before/after comparison of just that fix in isolation from 2a-2e.
 * --baseFieldMode=south reproduces the step-2 convergent-to-a-southern-goal
 * field (2f's diagnosed funnel cause) for a before/after of 2f in isolation
 * from 2g-2j; default 'divergent' is the fan-out doc's fix.
 * --noDensity disables 2g's density-aware spacing (steering term +
 * coverage recycling) for a before/after of 2g in isolation.
 * --noiseMode=isotropicCurl reproduces the step-2 noise mechanism (2h's
 * diagnosed reversal-at-the-sources cause) for a before/after of 2h in
 * isolation; default 'transverse' is the fan-out doc's fix.
 * --noConform disables 2i's wide coast-conform band (conformWeight=0) for
 * a before/after of 2i in isolation.
 */

import { performance } from 'node:perf_hooks';
import { buildWorld } from '../src/flow/world';
import { ParticleSystem, type DeathCause } from '../src/flow/particles';
import { DEFAULT_FIELD_PARAMS, getDefaultNoise3, type FieldParams, southness } from '../src/flow/field';

interface Args {
  particles: number;
  seconds: number;
  ageBudgetMode: 'dynamic' | 'legacy';
  width: number;
  height: number;
  /** 2f A/B: --baseFieldMode=south reproduces the step-2 funnel field for comparison. */
  baseFieldMode: FieldParams['baseFieldMode'];
  /** 2g A/B: --noDensity disables density-aware spacing (steering term + coverage recycling) for comparison. */
  densityEnabled: boolean;
  /** 2h A/B: --noiseMode=isotropicCurl reproduces the step-2 noise mechanism for comparison. */
  noiseMode: FieldParams['noiseMode'];
  /** 2i A/B: --noConform disables the coast-conform band for comparison. */
  conformEnabled: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string, def: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(hit.indexOf('=') + 1) : def;
  };
  const baseFieldMode = get('baseFieldMode', 'divergent');
  if (baseFieldMode !== 'divergent' && baseFieldMode !== 'south') {
    throw new Error(`--baseFieldMode must be 'divergent' or 'south', got '${baseFieldMode}'`);
  }
  const noiseMode = get('noiseMode', 'transverse');
  if (noiseMode !== 'transverse' && noiseMode !== 'isotropicCurl') {
    throw new Error(`--noiseMode must be 'transverse' or 'isotropicCurl', got '${noiseMode}'`);
  }
  return {
    particles: Number(get('particles', '3000')),
    seconds: Number(get('seconds', '60')),
    ageBudgetMode: argv.includes('--legacy') ? 'legacy' : 'dynamic',
    // 2400x1600 device px ~= a 1200x800 CSS viewport at dpr 2 — a
    // plausible mid-range laptop, matching main.ts's dpr cap.
    width: Number(get('width', '2400')),
    height: Number(get('height', '1600')),
    baseFieldMode,
    densityEnabled: !argv.includes('--noDensity'),
    noiseMode,
    conformEnabled: !argv.includes('--noConform'),
  };
}

const DT = 1 / 60;
const LATITUDE_BANDS = 10; // deciles of GB's north-south extent
const TOP_FRACTION_FOR_CONCENTRATION = 0.05;

/** `p` in [0,1] against an ascending-sorted array. */
function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const idx = Math.min(sortedAscending.length - 1, Math.floor(p * sortedAscending.length));
  return sortedAscending[idx];
}

function meanAndStddev(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

function run(args: Args) {
  const world = buildWorld(args.width, args.height);
  const fieldParams: FieldParams = {
    ...DEFAULT_FIELD_PARAMS,
    baseFieldMode: args.baseFieldMode,
    densityEnabled: args.densityEnabled,
    noiseMode: args.noiseMode,
    conformWeight: args.conformEnabled ? DEFAULT_FIELD_PARAMS.conformWeight : 0,
  };

  const deathCounts: Record<DeathCause, number> = {
    age: 0,
    strike: 0,
    stall: 0,
    trapped: 0,
    density: 0,
  };
  const lifespans: number[] = [];
  // How far south (0..1 southness) each particle-life ever got — one
  // recorded value per death, not per frame.
  const maxSouthAtDeath: number[] = [];

  // Per-slot "max southness reached this life"; read out and reset in
  // onDeath, right before that slot's next life begins.
  const maxSouthThisLife = new Float32Array(args.particles);

  const particles = new ParticleSystem(world, args.particles, {
    ageBudgetMode: args.ageBudgetMode,
    onDeath: (i, cause, age) => {
      deathCounts[cause]++;
      lifespans.push(age);
      maxSouthAtDeath.push(maxSouthThisLife[i]);
      maxSouthThisLife[i] = 0;
    },
  });

  // Coarse visit grid, reusing the signed distance field's own grid
  // resolution — it's already sized sensibly for GB's scale (see
  // distanceField.ts), no need to invent a second grid resolution.
  const { gridWidth, gridHeight, cellSize } = world.distanceField;
  const visits = new Uint32Array(gridWidth * gridHeight);
  const isInteriorCell = new Uint8Array(gridWidth * gridHeight);
  let interiorCellCount = 0;
  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const cx = (gx + 0.5) * cellSize;
      const cy = (gy + 0.5) * cellSize;
      if (world.distanceField.sample(cx, cy).dist > 0) {
        isInteriorCell[gy * gridWidth + gx] = 1;
        interiorCellCount++;
      }
    }
  }

  const steps = Math.round(args.seconds / DT);
  const frameCostsMsAscending: number[] = [];
  let escapeCount = 0; // hard invariant: must stay exactly zero
  // Guard-rail (2j): mean southward heading component across every
  // particle-frame in the run — a single running sum rather than a stored
  // per-frame series, since only the aggregate mean is reported.
  let headingSouthSum = 0;
  let headingSouthCount = 0;

  for (let f = 0; f < steps; f++) {
    const t0 = performance.now();
    particles.step(DT, fieldParams);
    frameCostsMsAscending.push(performance.now() - t0);

    for (let i = 0; i < args.particles; i++) {
      const x = particles.x[i];
      const y = particles.y[i];
      if (!world.mask.isInside(x, y)) escapeCount++;

      const s = southness(y, world);
      if (s > maxSouthThisLife[i]) maxSouthThisLife[i] = s;

      const gx = Math.min(gridWidth - 1, Math.max(0, Math.floor(x / cellSize)));
      const gy = Math.min(gridHeight - 1, Math.max(0, Math.floor(y / cellSize)));
      visits[gy * gridWidth + gx]++;

      headingSouthSum += particles.hy[i];
      headingSouthCount++;
    }
  }
  frameCostsMsAscending.sort((a, b) => a - b);

  // --- Report -----------------------------------------------------------
  const totalDeaths =
    deathCounts.age + deathCounts.strike + deathCounts.stall + deathCounts.trapped + deathCounts.density;
  const totalParticleSeconds = args.particles * args.seconds;

  console.log(
    `\n=== flow-harness: ${args.particles} particles, ${args.seconds}s sim, ` +
      `ageBudgetMode=${args.ageBudgetMode}, baseFieldMode=${args.baseFieldMode}, ` +
      `densityEnabled=${args.densityEnabled}, noiseMode=${args.noiseMode}, ` +
      `conformEnabled=${args.conformEnabled}, ${args.width}x${args.height} ===\n`,
  );

  // ===================== PRIMARY: fan-out & spacing =====================
  console.log('--- PRIMARY: fan-out & spacing ---');

  let visitedInteriorCells = 0;
  let totalVisits = 0;
  const visitCountsDescending: number[] = [];
  for (let c = 0; c < visits.length; c++) {
    if (!isInteriorCell[c]) continue;
    totalVisits += visits[c];
    if (visits[c] > 0) visitedInteriorCells++;
    visitCountsDescending.push(visits[c]);
  }
  visitCountsDescending.sort((a, b) => b - a);
  const topCellCount = Math.max(1, Math.ceil(visitCountsDescending.length * TOP_FRACTION_FOR_CONCENTRATION));
  const topVisits = visitCountsDescending.slice(0, topCellCount).reduce((a, b) => a + b, 0);

  console.log('\nInterior coverage + concentration:');
  console.log(
    `  coverage: ${((visitedInteriorCells / interiorCellCount) * 100).toFixed(1)}% of interior cells ever visited`,
  );
  console.log(
    `  concentration: top ${(TOP_FRACTION_FOR_CONCENTRATION * 100).toFixed(0)}% of visited-grid cells hold ` +
      `${totalVisits > 0 ? ((topVisits / totalVisits) * 100).toFixed(1) : '0.0'}% of all visits`,
  );

  // Spacing quality (2j): "how they're placed relative to each other" as a
  // statistic, off 2g's own occupancy grid (not the coarser visit-count
  // grid above) — the same signal the density steering term itself reads.
  console.log('\nSpacing quality:');
  const density = particles.densityField;
  const cellDensities: number[] = [];
  for (let c = 0; c < density.occupancy.length; c++) {
    if (density.isInteriorCell[c]) cellDensities.push(density.occupancy[c]);
  }
  const { mean: densityMean, stddev: densityStddev } = meanAndStddev(cellDensities);
  console.log(
    `  per-cell density (${density.cellSize}px grid, final frame): ` +
      `mean=${densityMean.toFixed(3)}  stddev=${densityStddev.toFixed(3)}  ` +
      `CV=${densityMean > 0 ? (densityStddev / densityMean).toFixed(2) : 'n/a'} ` +
      '(lower = more evenly placed)',
  );

  // Same population, split by 2h's coarse noise phase — should separate
  // into two different means (gathered denser than loosened) when
  // spacingWaveAmplitude is doing its job, and collapse toward one mean
  // when it isn't (spacingWaveAmplitude=0, or the wave washing out).
  const noise3 = getDefaultNoise3();
  const { gridWidth: dGridWidth, cellSize: dCellSize } = density;
  const waveWidth = world.projection.bounds.right - world.projection.bounds.left || 1;
  const coarseFreq = fieldParams.noiseScale / waveWidth;
  const waveT = args.seconds * fieldParams.noiseSpeed; // sim ends at ~args.seconds
  const gatheredDensities: number[] = [];
  const loosenedDensities: number[] = [];
  for (let c = 0; c < density.occupancy.length; c++) {
    if (!density.isInteriorCell[c]) continue;
    const cx = (c % dGridWidth) * dCellSize;
    const cy = Math.floor(c / dGridWidth) * dCellSize;
    const wave = noise3(cx * coarseFreq, cy * coarseFreq, waveT);
    (wave >= 0 ? gatheredDensities : loosenedDensities).push(density.occupancy[c]);
  }
  const gathered = meanAndStddev(gatheredDensities);
  const loosened = meanAndStddev(loosenedDensities);
  console.log(
    `  wave-phase split: gathered-cells mean=${gathered.mean.toFixed(3)}  ` +
      `loosened-cells mean=${loosened.mean.toFixed(3)}  ` +
      `ratio=${loosened.mean > 0 ? (gathered.mean / loosened.mean).toFixed(2) : 'n/a'} ` +
      '(> 1 means the wave is doing something; ~1 means it is not)',
  );

  // Nearest-neighbour distance between particles at the final frame —
  // brute-force O(n^2), fine as a one-off end-of-run measurement.
  const nnDistances: number[] = [];
  for (let i = 0; i < args.particles; i++) {
    let best = Infinity;
    for (let j = 0; j < args.particles; j++) {
      if (i === j) continue;
      const d = Math.hypot(particles.x[i] - particles.x[j], particles.y[i] - particles.y[j]);
      if (d < best) best = d;
    }
    if (best !== Infinity) nnDistances.push(best);
  }
  nnDistances.sort((a, b) => a - b);
  console.log(
    `  nearest-neighbour distance (final frame, device px): ` +
      `p10=${percentile(nnDistances, 0.1).toFixed(1)}  p50=${percentile(nnDistances, 0.5).toFixed(1)}  ` +
      `p90=${percentile(nnDistances, 0.9).toFixed(1)}`,
  );

  // ===================== GUARD-RAILS (not targets) =====================
  console.log('\n--- GUARD-RAILS: overall southward journey (sanity checks, not targets) ---');

  console.log(
    `\nDirection coherence: mean southward heading component = ` +
      `${(headingSouthSum / headingSouthCount).toFixed(3)} (1 = due south, 0 = no net southward bias)`,
  );

  if (totalDeaths === 0) {
    console.log('\nNo deaths observed in this run — increase --seconds.');
  } else {
    console.log(`\nDeath causes (of ${totalDeaths} total):`);
    for (const cause of ['age', 'strike', 'stall', 'trapped', 'density'] as const) {
      const n = deathCounts[cause];
      console.log(
        `  ${cause.padEnd(8)} ${n.toString().padStart(8)}  (${((n / totalDeaths) * 100).toFixed(1)}%)`,
      );
    }

    const sortedLifespans = [...lifespans].sort((a, b) => a - b);
    console.log('\nLifespan distribution (s):');
    console.log(
      `  p50=${percentile(sortedLifespans, 0.5).toFixed(2)}  ` +
        `p90=${percentile(sortedLifespans, 0.9).toFixed(2)}  ` +
        `p99=${percentile(sortedLifespans, 0.99).toFixed(2)}  ` +
        `max=${sortedLifespans[sortedLifespans.length - 1].toFixed(2)}`,
    );

    console.log(
      "\nThroughput by latitude band (share of particle-lives that ever reached each decile of GB's height):",
    );
    for (let b = 1; b <= LATITUDE_BANDS; b++) {
      const threshold = b / LATITUDE_BANDS;
      const reached = maxSouthAtDeath.filter((s) => s >= threshold).length;
      console.log(
        `  >= ${(threshold * 100).toFixed(0).padStart(3)}% south: ` +
          `${((reached / maxSouthAtDeath.length) * 100).toFixed(2)}%`,
      );
    }
  }

  // ===================== CORRECTNESS =====================
  console.log('\n--- CORRECTNESS ---');

  console.log('\nStrike rate + containment:');
  console.log(
    `  ${(particles.totalStrikeEvents / totalParticleSeconds).toFixed(4)} strikes / particle-second`,
  );
  console.log(`  escape samples: ${escapeCount} (hard invariant, must be 0)`);

  const avgMs =
    frameCostsMsAscending.reduce((a, b) => a + b, 0) / frameCostsMsAscending.length;
  console.log('\nFrame cost:');
  console.log(
    `  avg=${avgMs.toFixed(3)}ms  p95=${percentile(frameCostsMsAscending, 0.95).toFixed(3)}ms  ` +
      `(${(1000 / avgMs).toFixed(0)} fps avg-equivalent)`,
  );
  console.log('');

  if (escapeCount > 0) {
    console.error('CONTAINMENT INVARIANT VIOLATED — see escape samples above.');
    process.exitCode = 1;
  }
}

run(parseArgs());

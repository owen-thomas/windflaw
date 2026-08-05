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
 * A lifespan histogram alone can't tell "nothing gets far" apart from
 * "everything that gets far takes the same road" — that was the original
 * misdiagnosis this plan is fixing. So this reports, for a run of N
 * simulated seconds at a given particle count:
 *
 *  - death-cause breakdown (age-out / strike-limit / stall) + lifespan distribution
 *  - throughput by latitude band: fraction of particle-lives that ever
 *    reached each tenth of GB's north-south extent (proves broad transport,
 *    not just a thin lucky tail)
 *  - interior coverage + concentration on a coarse visit grid (a "river" is
 *    a coverage number near the floor and a concentration number near the
 *    ceiling; both should move as 2a-2e land)
 *  - strike rate (the step2 plan feedback's replacement for "escape rate",
 *    which goes trivially to zero once grazes are rescued instead of killed)
 *  - a hard containment-escape assertion (must stay exactly zero, always —
 *    this is the one number that's a correctness check, not a health metric)
 *  - frame cost at the given particle count
 *
 * These are a steering aid, not the target — the final call on "does it
 * read as a broad tapestry" is visual, against Art Pin.gif / Digital
 * Art.jpg — but they're what makes that checkable instead of arguable.
 *
 * Run with:
 *   npx tsx scripts/flow-harness.ts [--particles=3000] [--seconds=60] [--legacy]
 *     [--baseFieldMode=divergent|south] [--noDensity]
 *
 * --legacy reproduces step 1's fixed 4-9s age-budget ceiling (only), for a
 * true before/after comparison of just that fix in isolation from 2a-2e.
 * --baseFieldMode=south reproduces the step-2 convergent-to-a-southern-goal
 * field (2f's diagnosed funnel cause) for a before/after of 2f in isolation
 * from 2g-2j; default 'divergent' is the fan-out doc's fix.
 * --noDensity disables 2g's density-aware spacing (steering term +
 * coverage recycling) for a before/after of 2g in isolation.
 */

import { performance } from 'node:perf_hooks';
import { buildWorld } from '../src/flow/world';
import { ParticleSystem, type DeathCause } from '../src/flow/particles';
import { DEFAULT_FIELD_PARAMS, type FieldParams, southness } from '../src/flow/field';

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

function run(args: Args) {
  const world = buildWorld(args.width, args.height);
  const fieldParams: FieldParams = {
    ...DEFAULT_FIELD_PARAMS,
    baseFieldMode: args.baseFieldMode,
    densityEnabled: args.densityEnabled,
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
      `densityEnabled=${args.densityEnabled}, ${args.width}x${args.height} ===\n`,
  );

  if (totalDeaths === 0) {
    console.log('No deaths observed in this run — increase --seconds.');
  } else {
    console.log(`Death causes (of ${totalDeaths} total):`);
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

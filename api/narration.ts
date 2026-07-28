/**
 * GET /api/narration?date=YYYY-MM-DD&period=N
 *
 * One generated sentence per settlement period, shared by every visitor who
 * asks for that period.
 *
 * Caching this the way grid.ts and curtailment.ts do — a flat CDN TTL —
 * would cache a *sentence*, not a *fact*, so a cache miss mid-period would
 * generate a different description of the same grid. Instead the cache key
 * is the settlement period itself (`date`+`period` in the query string) and
 * the TTL is set to exactly how long that period has left to run, so one
 * successful generation really does serve the whole period. The client
 * always asks for the period its own clock currently names (client.ts); the
 * `date`/`period` params exist as a cache key and an abuse bound, not as a
 * way to request arbitrary history — see the validation below.
 *
 * Grid and curtailment are fetched by calling this project's own handlers
 * in-process rather than over HTTP, for the same reason vite.config.ts's dev
 * shim does: it is the exact code path a visitor's own request will run,
 * with no URL or CORS bookkeeping. It does mean this function makes its own
 * fresh Carbon Intensity and Elexon calls rather than reading the CDN copy —
 * at most one extra round of both per settlement period, which is well
 * inside the politeness budget, and it maximises coherence between the
 * narration and the figures rather than guaranteeing it: a client fetching
 * grid.ts moments later can still see a slightly newer acceptance than the
 * one this narration was generated from. The prompt's rounding (see
 * _lib/narration-prompt.ts) is what absorbs that gap, not this function.
 *
 * Never caches a failure, and never generates a template. If generation
 * fails validation twice, or there is no API key configured, the response
 * says so with `health: 'failed'` and `narration: null`, uncached — the
 * client's own narrate.ts template is the fallback (DECISIONS 004: upstream
 * failure is data, not an HTTP status; the 200 contract holds here too).
 */

import type {
  ApiRequest,
  ApiResponse,
} from './_lib/handler.js';
import type { CurtailmentResponse, GridResponse, NarrationResponse } from '../src/lib/types.js';
import gridHandler from './grid.js';
import curtailmentHandler from './curtailment.js';
import { situationOf } from '../src/lib/situation.js';
import { buildPrompt, validate } from './_lib/narration-prompt.js';
import { msUntilRollover, previousPeriod, settlementAt, type SettlementRef } from '../src/lib/settlement.js';

const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 220;
const MIN_TTL_SECONDS = 30;
const GENERATION_ATTEMPTS = 2;

async function callInProcess<T>(
  handler: (req: ApiRequest, res: ApiResponse) => Promise<unknown>
): Promise<T> {
  let body: unknown;
  const res: ApiResponse = {
    setHeader: () => res,
    status: () => res,
    json(payload) {
      body = payload;
      return res;
    },
  };
  await handler({ query: {} }, res);
  return body as T;
}

function parsePeriodParam(req: ApiRequest): SettlementRef | null {
  const date = typeof req.query.date === 'string' ? req.query.date : null;
  const periodRaw = typeof req.query.period === 'string' ? req.query.period : null;
  if (!date || !periodRaw) return null;
  const period = Number(periodRaw);
  if (!Number.isInteger(period)) return null;
  // periodStart/periodEnd are unused for the validation below; settlementAt
  // and previousPeriod compute the real bounds when we need them.
  return { date, period, periodStart: '', periodEnd: '' };
}

function sameSettlement(a: Pick<SettlementRef, 'date' | 'period'>, b: Pick<SettlementRef, 'date' | 'period'>) {
  return a.date === b.date && a.period === b.period;
}

async function generate(
  situation: ReturnType<typeof situationOf>
): Promise<{ text: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const prompt = buildPrompt(situation);

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        }),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const data = (await response.json()) as { content: { type: string; text?: string }[] };
      const text = data.content.find((block) => block.type === 'text')?.text?.trim();
      if (text && validate(text, situation)) return { text };
    } catch {
      // Retried once (network blip, rate limit); falls through to null below.
    }
  }
  return null;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const requested = parsePeriodParam(req);
  if (requested) {
    const current = settlementAt();
    const prior = previousPeriod(current);
    if (!sameSettlement(requested, current) && !sameSettlement(requested, prior)) {
      res.setHeader('Cache-Control', 'no-store');
      return res
        .status(400)
        .json({ error: 'period must be the current or immediately previous settlement period' });
    }
  }

  const [grid, curtailment] = await Promise.all([
    callInProcess<GridResponse>(gridHandler),
    callInProcess<CurtailmentResponse>(curtailmentHandler),
  ]);

  const settlement = grid.settlement;
  const situation = situationOf(grid, curtailment);

  const body: NarrationResponse = {
    fetchedAt: new Date().toISOString(),
    settlement,
    health: 'failed',
    errors: [],
    narration: null,
  };

  if (!situation.north && !situation.south && situation.constraint === 'unknown') {
    body.errors.push('nothing to describe: no reading arrived this half-hour');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(body);
  }

  const result = await generate(situation);

  if (!result) {
    body.errors.push(
      process.env.ANTHROPIC_API_KEY ? 'generation failed validation' : 'no API key configured'
    );
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(body);
  }

  body.health = 'ok';
  body.narration = { text: result.text, provenance: 'generated' };

  const ttlSeconds = Math.max(MIN_TTL_SECONDS, Math.floor(msUntilRollover(settlement) / 1000));
  res.setHeader('Cache-Control', `public, s-maxage=${ttlSeconds}, stale-while-revalidate=60`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json(body);
}

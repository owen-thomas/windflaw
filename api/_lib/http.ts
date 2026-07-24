/**
 * Fetch and cache helpers shared by the serverless functions.
 */

/** How long the CDN may serve a response before revalidating. */
const S_MAXAGE = 300;
/** How long past that it may keep serving the stale copy while it refreshes. */
const STALE_WHILE_REVALIDATE = 600;

/**
 * Cache at the CDN edge, not in the function.
 *
 * Vercel functions do not share memory between invocations, so an in-process
 * cache is a cache per cold start — on this product's traffic, effectively no
 * cache at all, and no politeness to Elexon either. The shared cache has to be
 * the CDN. `stale-while-revalidate` also buys graceful degradation for free:
 * if an upstream goes slow, visitors keep getting the last good payload while
 * the refresh happens behind them.
 *
 * The consequence, handled in the client: a response may be up to
 * S_MAXAGE + STALE_WHILE_REVALIDATE old, and its health flags describe
 * upstream state at `fetchedAt`, not at delivery. See types.ts.
 */
export function setCacheHeaders(res: { setHeader(name: string, value: string): unknown }): void {
  res.setHeader(
    'Cache-Control',
    `public, s-maxage=${S_MAXAGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`
  );
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

/** Abort rather than let a slow upstream hold the whole response hostage. */
const DEFAULT_TIMEOUT_MS = 8000;

export async function fetchJson<T>(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${shortUrl(url)}`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`timeout after ${timeoutMs}ms for ${shortUrl(url)}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Trim a URL to something readable in an error string. */
function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + (parsed.search ? '?…' : '');
  } catch {
    return url;
  }
}

/** Roll individual source outcomes up into one overall health flag. */
export function overallHealth(flags: ('ok' | 'partial' | 'failed')[]): 'ok' | 'partial' | 'failed' {
  if (flags.every((f) => f === 'ok')) return 'ok';
  if (flags.every((f) => f === 'failed')) return 'failed';
  return 'partial';
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

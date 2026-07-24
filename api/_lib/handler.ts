/**
 * Minimal structural types for the serverless handler signature.
 *
 * Vercel's runtime satisfies these, and so does the dev-server shim in
 * vite.config.ts, so the handlers stay honest in both without pulling in
 * @vercel/node just for two interfaces.
 */

export interface ApiRequest {
  url?: string;
  query: Record<string, string | string[] | undefined>;
}

export interface ApiResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
}

export type ApiHandler = (req: ApiRequest, res: ApiResponse) => Promise<unknown> | unknown;

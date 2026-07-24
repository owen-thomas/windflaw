import { defineConfig, type Plugin } from 'vite';

/**
 * Serve the `api/` handlers from the Vite dev server.
 *
 * Avoids depending on `vercel dev` (and the login/link dance that comes with
 * it) for local work. The shim supplies the three response methods the
 * handlers use — status, json, setHeader — which is the whole surface they
 * touch, so what runs in dev is the same code that deploys.
 *
 * Cache-Control is set by the handlers but has no effect here; there is no
 * CDN in front of the dev server. That is the intended difference, and it
 * means dev always sees live upstream data.
 */
function devApi(): Plugin {
  return {
    name: 'windfall-dev-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();

        const url = new URL(req.url, 'http://localhost');
        const route = url.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
        if (!route || route.startsWith('_') || route.includes('..')) return next();

        const shim = Object.assign(res, {
          status(code: number) {
            res.statusCode = code;
            return shim;
          },
          json(body: unknown) {
            if (!res.getHeader('Content-Type')) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
            }
            res.end(JSON.stringify(body));
            return shim;
          },
        });

        void (async () => {
          try {
            const mod = await server.ssrLoadModule(`/api/${route}.ts`);
            const request = { url: req.url, query: Object.fromEntries(url.searchParams) };
            await mod.default(request, shim);
          } catch (err) {
            server.config.logger.error(`[dev-api] /api/${route} failed: ${String(err)}`);
            if (!res.writableEnded) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: String(err) }));
            }
          }
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [devApi()],
});

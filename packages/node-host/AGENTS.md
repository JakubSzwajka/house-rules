# @house-rules/node-host: notes for agents

## What it does

It is a Host for a Web fetch handler on Node 24.21.0 or later. It exports `serve`, which owns the Node HTTP listener and streams in both directions, and `staticFiles`, which serves a built single-page app from the same service. It has no runtime dependencies and no Effect code.

## How an app mounts it

In `src/main.ts`, call `serve(api, { port, onClose: () => api.dispose().then(() => app.dispose()), handleSignals: true })`, where `api` is the function returned by `toFetchHandler` and `app` is the composition. Dispose the fetch handler before the app. The booking API reads PORT through Effect Config, defaulting to 3000. Its APP_ORIGIN configures the MCP resource URL and web origins. Main uses `http://localhost:${PORT}` when it is unset, and also keeps `http://localhost:3000` in the allowed origins. Tests use port 0 and close the returned Host.

Behind a TLS proxy, cookie writes get 403 `cross_origin` unless the HTTP way sets its public origin. Configure the way before passing it to the composition:

```ts
const webWay = defineWay({
  name: "web",
  path: "/api",
  protocol: "http",
  features,
  endpoints,
  who,
  mean,
  origins: ["https://public.example"],
});
// In main.ts, pass webWay to the app's composition factory.
const app = createApp([webWay]);
const api = toFetchHandler(app);
```

`defineWay` and `toFetchHandler` come from `@house-rules/application`; features, endpoints, sockets and `createApp` are app-owned wiring. Build endpoints with `endpoint(feature)`. Ways expose features, never module operations. `toFetchHandler` takes only the app. HTTP `origins`, `cors`, `session` and `maxBodyBytes` belong to `defineWay({ protocol: "http", ... })`. The booking web way sets a session cookie and allowed origins; main sets its runtime origins. Composition supplies one app-level May. Ways carry no permission lists.

Set explicit HTTP-way `origins` for local and internal apps too, and restrict Host at their proxy or listener to guard against DNS rebinding. See the [application kit's session and CSRF options](../application/README.md#endpoints-clients-and-failures).

To serve the built page from the same origin, the default for a web app, put `staticFiles` before the API handler:

```ts
const site = staticFiles({ root: "dist/web", exclude: ["/api", "/mcp", "/.well-known"] });
await serve(async (request) => (await site(request)) ?? api(request), { port, onClose, handleSignals: true });
```

`exclude` is required and names every path prefix the API owns; `staticFiles` returns `undefined` for those, for any method but GET and HEAD, and for nothing else. Options: `root`, `exclude`, `index` (default `index.html`), `immutable(path)` (default: a hashed `name-[hash].ext` under `/assets/`). A page on another origin uses the HTTP way's `cors` option instead.

No layer or `migrations.json` line is needed. A Next app already has a Host.

Options are `port`, optional `hostname`, optional `onClose`, optional `handleSignals`, default false, and optional `health`. See README.md for socket and close behaviour.

## Health probes

Probes are opt-in: only `serve(..., { health: { wayPaths, ... } })` intercepts `/healthz` (alive, no checks) and `/readyz` (readiness) before the handler, including static files. Omitting `health` leaves those paths to the handler. They bypass Who, May, audit, units and trace. `health` requires `wayPaths` and takes optional startup-fixed `alivePath`/`readyPath`, `version` and named `checks`: `{ name, timeoutMs, run: (signal) => Promise<unknown> }`. Always pass every network way's path; collisions and overlapping prefixes fail before listening. Checks run concurrently, reject/throw/timeout means failure, and timeout aborts the supplied signal. Runners must honor it to release resources.

GET returns only 200 `{"status":"ok"}` or 503 `{"status":"unavailable","failed":["sql"]}`. HEAD has the same status without a body. Other methods return 405. An app-configured `version` appears only on `/readyz`, on both 200 and 503. `/healthz` stays bare. No exception, cause or other app data leaves a probe.

`SqlHealth` from migrations captures the app's existing client through `SqlHealth.fromContext(context)`; adapt its optional Effect with `(signal) => Effect.runPromiseWith(context)(check, { signal })` in main. No second SQL pool or health feature is needed. Memory apps omit that check.

For Next, create `healthRoutes({ wayPaths, checks })` once in server-only wiring. Route files use `export const { GET, HEAD } = probes.healthz` or `probes.readyz`. Its plain Request/Response handlers open no server; unmatched paths return 404. `healthHandler` is the lower dispatcher and returns undefined for unmatched paths. Keep probe routes outside session/auth middleware.

## Fixed rules

- This package and Express Host use the strict TypeScript preset for Node transport. Keep Effect app code on the Effect preset with `nodeBuiltinImport: error`.
- Never buffer whole bodies here. Body limits belong to the HTTP way's `maxBodyBytes` option.
- Build the request's HTTP origin from Host, not forwarded headers. Behind a TLS proxy the app sets its public `origins` on the HTTP way.
- Use one five-second deadline for request drain and listener closure, including detached CONNECT sockets. Flush HEAD/empty responses before active tracking ends; force-close only at the deadline. Requests arriving after drain starts receive fixed 503 with `Connection: close`. Repeated closes and signals share one promise; await onClose once even on listener-close error and keep signal hooks until disposal ends.
- Reject malformed Host and non-origin-form request targets with plain 400 before the handler; OPTIONS *, TRACE and CONNECT answer 501, except TRACE on health paths answers 405. Keep IPv6 authorities working.
- A thrown handler or ordinary stream failure before its first byte returns a plain 500 without details. SSE headers flush immediately, so SSE failures destroy the connection.
- `createNodeRequestHandler(handler, { health? })` opens no listener. It returns `handle(incoming, outgoing)` and once-only bounded `drain(timeoutMs)`, owning active request tracking, aborts and stream cleanup. Both framework hosts use it.
- `staticFiles` fails at construction when `root` or its index file is missing, or the index is a symlink. It walks `root` once and never lists symlinks, dotfiles or non-regular files; each request re-checks device and inode with `O_NOFOLLOW` on the final component. `root` must be immutable build output owned by the deploying user: anyone who can write inside it while the server starts can change what is served, as they could by replacing `index.html`. A file added later needs a new handler. It decodes a path once and answers 404 for encoded slashes, backslashes or NUL, dot segments, dotfiles and any path at or under a symlink. `exclude` matches case-insensitively and ignores repeated slashes, like the API router. It falls back to the index only for GET or HEAD whose `Accept` gives `text/html` (or `text/*`, `*/*`) a `q` above 0 (a range with parameters other than `q` never matches our UTF-8 HTML), with no file extension in the last segment. Hashed assets are immutable for a year; the index is `no-cache`.

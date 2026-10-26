# @house-rules/express-host

Optional Express 5 hosting for a Web fetch handler. Express creates the app, installs one root dispatch middleware and opens the listener with `app.listen`. The shared Node bridge streams requests and responses. This package never calls Node Host's `serve`.

```ts
import { serve, staticFiles } from "@house-rules/express-host";

const api = toFetchHandler(app);
const site = staticFiles({
  root: "dist/web",
  exclude: ["/api", "/mcp", "/.well-known", "/healthz", "/readyz"],
});
const host = await serve(async (request) => (await site(request)) ?? api(request), {
  port: 3000,
  health: { wayPaths: ["/api", "/mcp"] },
  handleSignals: true,
  onClose: async () => {
    try { await api.dispose(); } finally { await app.dispose(); }
  },
});
```

Call this in `main.ts`. `toFetchHandler` and composition remain application-owned. All admission, HTTP/MCP routing, sessions, CSRF, origins, errors, audit and tracing stay in application. No Express business routes, body parsers or middleware customization API are exposed. Installing the kits does not install Express.

`serve(handler, options)` returns `{ url: URL, close(): Promise<void> }`. Options are `port` (including 0), optional `hostname`, `health`, `onClose` and `handleSignals` (default false). The public declarations contain no Express types. `staticFiles`, `healthHandler`, `healthRoutes` and their types are re-exported unchanged from [Node Host](../node-host/README.md).

## Transport and shutdown

The bridge preserves raw Host/path/query, repeated headers, semicolon-joined Cookies, binary uploads, separate Set-Cookie fields and HEAD semantics. It ignores forwarded headers. Restrict Host at the deployment proxy/listener and set explicit public origins on the ways. Invalid authorities/targets fail closed; TRACE, CONNECT and OPTIONS * are unsupported, except TRACE probes return 405. Node's HTTP parser can reject traffic before middleware.

Responses stream with backpressure. SSE headers flush immediately, including media types with case differences or parameters. Ordinary streams retain a plain 500 for errors before their first byte; errors after headers close the socket. Client disconnects abort the Web Request and cancel its response stream. Completing an upload does not abort its response.

`close`, SIGINT and SIGTERM share one promise. Shutdown stops accepting, closes idle connections and waits at most five seconds for requests and streams, then aborts/destroys remaining connections. An idle MCP SSE stream therefore takes the full five seconds. `onClose` runs once after draining and has no time limit. Signal hooks remain until disposal ends and are removed even if it fails. Failed signal shutdown sets exit code 1.

## Static files and probes

Use the same immutable build inventory and SPA exclusions as Node Host. Exclude every API/MCP prefix, metadata and both configured probe paths. Unknown reserved requests must reach the router, not HTML fallback. Probes run before static/router dispatch, bypass admission and expose only sanitized readiness results. Pass all network way paths so probe collisions fail before listening. Reuse the app's existing SQL health check, never another pool.

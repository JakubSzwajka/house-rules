# @house-rules/node-host

A Host listens on a socket and passes Web Requests to a fetch handler. `serve` is the Node Host for House Rules. It uses Node's built-in HTTP server with no runtime dependencies.

Install `@house-rules/node-host` at exact version `0.1.0`, on Node 24.21.0 or later. Call it in the app's `src/main.ts`, an `appEntryFiles` entry, where the entry joins delivery and composition. `src/server/` holds background loops, not the Host call:

```ts
import { toFetchHandler } from "@house-rules/capability";
import { serve } from "@house-rules/node-host";
import { bookingRoutes } from "./delivery/http/routes.js";
import { app } from "./composition/index.js";

const api = toFetchHandler(app, { prefix: "/api", routes: bookingRoutes });
const host = await serve(api, {
  port: 3000,
  onClose: () => api.dispose().then(() => app.dispose()),
  handleSignals: true,
});
console.log(host.url.href);

// A test or an embedded app can close it itself.
await host.close();
```

The Host itself needs no Effect runtime. An app that also installs `@effect/platform-node` must declare `@effect/platform-node-shared` as an exact direct dependency at the same version as `effect`, now `4.0.3`. Pin all Effect runtime packages together, even the shared Node package.

The handler takes a `Request` and returns a `Promise<Response>`. Use the function that `toFetchHandler` returns. A Next app already has a Host, so it does not need this package. The reference API reads `PORT` through Effect Config, with a default of 3000.

## Socket behaviour

`port` is required; 0 asks Node for a free port. `hostname` is optional. Without it Node listens on all interfaces. The returned `url` names the actual port and a reachable local address, not the app's public URL.

The request URL uses HTTP and the incoming Host header. Forwarded headers do not change it. Missing, empty or malformed Host headers and invalid targets answer plain 400 `Bad Request`, without details. Only origin-form targets are accepted, including IPv6 authorities such as `[::1]:3000`. Absolute-form targets answer 400, even when they match Host. `OPTIONS *`, TRACE and CONNECT answer 501 `Not Implemented` before the handler runs.

Behind a TLS proxy, cookie writes get 403 `cross_origin` unless the app sets its public origin:

```ts
const PUBLIC_ORIGIN = "https://public.example";
const api = toFetchHandler(app, { routes: bookingRoutes, origins: [PUBLIC_ORIGIN] });
```

See [the capability CSRF check](../application/README.md#csrf). The reference API reads optional `APP_ORIGIN` through Effect Config and passes it as `origins` when set.

The Host has no allowed-host guard against DNS rebinding; local and internal apps must restrict Host at their proxy or listener and set explicit `origins` for cookie writes.

Uploads go through `Readable.toWeb`; responses stream with backpressure. The Host does not buffer bodies or add a body limit. Set `maxBodyBytes` in `toFetchHandler`. Status and headers pass through, including separate Set-Cookie headers. The request signal aborts when a client leaves before the response ends. A normal upload finishing does not abort it.

A thrown handler or a body stream failure before the response headers are flushed gives a plain 500 `Internal Server Error` without details. Node may prefetch the first chunks before flushing headers. If a response stream fails after headers went out, the Host closes that connection instead.

## Closing

`close()` stops accepting connections, waits up to a fixed five-second deadline for requests and response streams to finish, then awaits `onClose`. The drain timeout is not an option. At the deadline it aborts the request signals and destroys the remaining HTTP connections. An uncooperative handler cannot hold shutdown open; use `onClose` to dispose the app's resources. The deadline bounds draining, not `onClose`.

Repeated calls return the same shutdown promise. With `handleSignals: true`, SIGTERM and SIGINT use that same close operation. Signal hooks stay installed through `onClose`, then are removed. A failed signal-triggered close sets the process exit code to 1. By default the Host installs no signal hooks.

## Why plain TypeScript

This is the one sanctioned Node socket bridge. Its tsconfig extends the strict preset, not the Effect preset, because it adapts Node streams and owns the HTTP listener. Effect app code keeps `nodeBuiltinImport: error` and imports `serve` instead of `node:http`. No Effect diagnostic is weakened.

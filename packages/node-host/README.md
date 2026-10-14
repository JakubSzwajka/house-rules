# @house-rules/node-host

A Host listens on a socket and passes Web Requests to a fetch handler. `serve` is the Node Host for House Rules. It uses Node's built-in HTTP server with no runtime dependencies.

Install `@house-rules/node-host` at exact version `0.2.0`, on Node 24.21.0 or later. Call it in the app's `src/main.ts`, an `appEntryFiles` entry, where the entry joins delivery and composition. `src/server/` holds background loops, not the Host call:

```ts
import { toFetchHandler } from "@house-rules/application";
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

See [the application kit's CSRF check](../application/README.md#csrf). The reference API reads optional `APP_ORIGIN` through Effect Config and passes it as `origins` when set.

The Host has no allowed-host guard against DNS rebinding; local and internal apps must restrict Host at their proxy or listener and set explicit `origins` for cookie writes.

Uploads go through `Readable.toWeb`; responses stream with backpressure. The Host does not buffer bodies or add a body limit. Set `maxBodyBytes` in `toFetchHandler`. Status and headers pass through, including separate Set-Cookie headers. The request signal aborts when a client leaves before the response ends. A normal upload finishing does not abort it.

A thrown handler or a body stream failure before the response headers are flushed gives a plain 500 `Internal Server Error` without details. Node may prefetch the first chunks before flushing headers. If a response stream fails after headers went out, the Host closes that connection instead.

## Static files

`staticFiles` serves a built single-page app from the same Node service as the API, so the page and `/api` share one origin and the client needs no `baseUrl` and no CORS. That is the default way to ship a web page. A page on another origin is the alternative; see [the application kit's CORS option](../application/README.md#cors).

```ts
import { serve, staticFiles } from "@house-rules/node-host";

const site = staticFiles({ root: "dist/web", exclude: ["/api", "/mcp", "/.well-known"] });
const host = await serve(async (request) => (await site(request)) ?? api(request), {
  port: 3000,
  onClose: () => api.dispose().then(() => app.dispose()),
  handleSignals: true,
});
```

`staticFiles({ root, exclude, index?, immutable? })` returns `(request) => Promise<Response | undefined>`. `undefined` means "not mine": chain the next handler after it.

- **Construction.** `root` must be a directory that holds the index file, `index.html` by default, as a regular file, not a symlink; otherwise it throws a `TypeError` that names the path, such as `root "dist/web" does not exist; build the web app first`. `index` must be a plain file name. Each `exclude` entry must be a plain path such as `/api`: no trailing `/`, empty or `..` segment, `?`, `#`, `%` or `\`.
- **What it answers.** Only GET and HEAD; every other method is `undefined`. A path equal to an `exclude` entry or under it, such as `/api` or `/api/bookings`, is `undefined`, also when spelled with percent escapes such as `/%61pi`, in another case such as `/API`, or with repeated slashes, because the API router matches those the same way. `/apix` is not under `/api`. Every other GET or HEAD path is its own: a file, the page, or a plain 404 `Not Found`.
- **Read once, no symlinks served.** Construction walks `root` once and lists the regular files it may serve. It never lists symlinks, dotfiles, dot-folders or anything that is not a regular file. A request opens a listed file with `O_NOFOLLOW` on the final component and re-checks its device and inode against the listing; otherwise it is a 404. A file added or replaced after construction is not served until the handler is built again. Threat model: `root` must be immutable build output owned by the deploying user. Anyone who can write inside `root` while the server starts can change what is served, as they could by replacing `index.html`.
- **Safe paths.** The path is decoded once. An encoded slash, backslash or NUL (`%2f`, `%5c`, `%00`), a malformed escape, a `.` or `..` segment, a dotfile such as `/.env`, and any path at or under a symlink, inside or out of `root`, are a 404, never the page.
- **Page fallback.** A missing file answers `index.html` only when the request accepts `text/html` and the last path segment has no file extension, such as `/bookings/b-1`. `Accept` is parsed by media range and `q`: the most specific of `text/html`, `text/*` and `*/*` decides, and it must have `q` above 0, so `text/html;q=0` gets a 404. A range with a parameter other than `q`, such as `text/html;charset=iso-8859-1;q=1`, is more specific than the plain range and applies only when it matches. The page is UTF-8 HTML, so such a range never matches and cannot override a plain `text/html;q=0`. `/assets/gone.js` or a JSON request stays a 404.
- **Headers.** Content types cover html, js, mjs, css, svg, png, jpg, gif, webp, avif, json, webmanifest, woff, woff2, ico, map, txt and wasm; anything else is `application/octet-stream`. Every file carries `x-content-type-options: nosniff`, a weak `ETag`, `Last-Modified` and `content-length`; a matching `If-None-Match`, by the weak comparison, a list or `*`, is a 304. A hashed asset, by default a file under `/assets/` named like Vite's `name-[hash].ext` (at least 8 hash characters with a digit or capital), gets `cache-control: public, max-age=31536000, immutable`; pass `immutable: (path) => boolean` to choose others. The index file and everything else get `no-cache`. HEAD answers the headers with no body.

## Closing

`close()` stops accepting connections, waits up to a fixed five-second deadline for requests and response streams to finish, then awaits `onClose`. The drain timeout is not an option. At the deadline it aborts the request signals and destroys the remaining HTTP connections. An uncooperative handler cannot hold shutdown open; use `onClose` to dispose the app's resources. The deadline bounds draining, not `onClose`.

Repeated calls return the same shutdown promise. With `handleSignals: true`, SIGTERM and SIGINT use that same close operation. Signal hooks stay installed through `onClose`, then are removed. A failed signal-triggered close sets the process exit code to 1. By default the Host installs no signal hooks.

## Why plain TypeScript

This is the one sanctioned Node socket bridge. Its tsconfig extends the strict preset, not the Effect preset, because it adapts Node streams and owns the HTTP listener. Effect app code keeps `nodeBuiltinImport: error` and imports `serve` instead of `node:http`. No Effect diagnostic is weakened.

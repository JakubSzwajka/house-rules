# @house-rules/node-host: notes for agents

## What it does

It is a Host for a Web fetch handler on Node 24.21.0 or later. Its only public export is `serve`. It owns the Node HTTP listener and streams in both directions. It has no runtime dependencies and no Effect code.

## How an app mounts it

In `src/main.ts`, call `serve(api, { port, onClose: () => api.dispose().then(() => app.dispose()), handleSignals: true })`, where `api` is the function returned by `toFetchHandler` and `app` is the composition. Dispose the fetch handler before the app. The reference API reads PORT through Effect Config, defaulting to 3000, and optional APP_ORIGIN for its public origin. Tests use port 0 and close the returned Host.

Behind a TLS proxy, cookie writes get 403 `cross_origin` unless the app sets its public origin:

```ts
const PUBLIC_ORIGIN = "https://public.example";
const api = toFetchHandler(app, { routes, origins: [PUBLIC_ORIGIN] });
```

Set explicit `origins` for local and internal apps too, and restrict Host at their proxy or listener to guard against DNS rebinding. See the [capability CSRF check](../capability/README.md#csrf).

No layer or `migrations.json` line is needed. A Next app already has a Host.

Options are `port`, optional `hostname`, optional `onClose`, and optional `handleSignals`, default false. See README.md for socket and close behaviour.

## Fixed rules

- This package alone uses the strict TypeScript preset for the Node socket bridge. Keep Effect app code on the Effect preset with `nodeBuiltinImport: error`.
- Never buffer whole bodies here. Body limits belong to `toFetchHandler`.
- Build the request's HTTP origin from Host, not forwarded headers. Behind a TLS proxy the app sets its public `origins` in `toFetchHandler`.
- Drain for at most five seconds before disposing the app. Repeated closes and signals share one promise; keep signal hooks until disposal ends.
- Reject malformed Host and non-origin-form request targets with plain 400 before the handler; OPTIONS *, TRACE and CONNECT answer 501. Keep IPv6 authorities working.
- A thrown handler or a stream failure before its first byte returns a plain 500 without details.

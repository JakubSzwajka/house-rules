# @house-rules/express-host: notes for agents

## What it does

An optional plain TypeScript Host. Express owns the app, one root tracking/dispatch middleware and `app.listen`. The host closes that server. Node Host supplies the listener-free tracked bridge and unchanged static/probe helpers. No Effect dependency, contract door or Express types in public declarations.

## How an app mounts it

In `main.ts`, import `serve` from this package and pass the existing `toFetchHandler(app)` function. Options are `port`, optional `hostname`, `health`, `onClose` and `handleSignals`. An omitted hostname keeps Node's IPv6-to-IPv4 all-interface fallback. Tests use loopback port 0. Dispose the router before composition in `onClose`, using `finally` to dispose composition if router disposal fails. No layer, module mount or migration is needed.

Use re-exported `staticFiles` before the router for same-origin assets. Exclude every API/MCP prefix, metadata and both configured probe paths. `health` takes every network way path and optional startup-fixed probe paths, version and bounded named checks. Reuse existing infrastructure for checks. See [Node Host](../node-host/AGENTS.md) for static/probe options and [application](../application/README.md) for origins, sessions and CSRF.

## Fixed rules

- Express must create the listener. Never call `node-host.serve` or add a second executor/router.
- Keep the strict preset here. Effect app code retains `nodeBuiltinImport: error`.
- No body parsing, cookie/session/auth/CORS middleware, compression, Express static serving or middleware customization API. Application owns those transport policies.
- Preserve raw headers, Cookie joining, binary streams, HEAD cancellation and separate Set-Cookie fields. Never log credentials. Origin comes from validated Host, not forwarded headers.
- Pump responses with backpressure. Flush SSE headers immediately; ordinary pre-first-byte errors return fixed 500 and post-header errors destroy the socket.
- Close once with one five-second drain/listener deadline, including detached CONNECT sockets. Flush HEAD/empty responses before leaving active tracking; force-close only at the deadline. Late requests on existing connections receive fixed 503 with `Connection: close`. Idle SSE streams use the full deadline. Await disposal once even on listener-close errors. Keep signal hooks until disposal finishes and remove them on failure too.
- Express retains its startup error listener after listen; later server errors reach the already-settled callback and are consumed. No post-listen error hook is exposed.
- No new public paths, MCP write authority, dependencies or stable version bumps without approval.

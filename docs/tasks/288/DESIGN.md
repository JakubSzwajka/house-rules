# Optional Express host

Reviewed implementation contract. Based on framework `aef491a` and Trainer `7fff32b`, with Trainer task 288's specification and manual flow. This task is local only; registry publication requires a later gate.

## Package and ownership

Add `packages/express-host`, imported as `@house-rules/express-host`. It is optional wiring, plain TypeScript with the strict preset, no Effect dependency and no contract door. Installing application/domain must not install Express.

```ts
import { serve, staticFiles } from "@house-rules/express-host";

const api = toFetchHandler(app); // Existing application router, created once.
const site = staticFiles({
  root: "dist/web",
  exclude: ["/api", "/mcp", "/.well-known", "/healthz", "/readyz"],
});
const host = await serve(async (request) => (await site(request)) ?? api(request), {
  port,
  hostname: "127.0.0.1",
  health: { wayPaths: ["/api", "/mcp"], checks },
  onClose: async () => { try { await api.dispose(); } finally { await app.dispose(); } },
  handleSignals: true,
});
// host.url: URL; host.close(): Promise<void>
```

`serve(handler, options)` takes `(Request) => Promise<Response>`. Options are exactly `port`, optional `hostname`, `health`, `onClose` and `handleSignals`, with existing Node Host meanings. Port 0 is supported. Export `staticFiles`, `healthHandler`, `healthRoutes` and their existing public types by re-export from node-host, not by copying them. No raw Express app/server or arbitrary middleware registration interface in this first increment.

Express owns the app, its middleware stack and `app.listen()`. The adapter owns the returned server's shutdown. It installs one tracking/dispatch middleware with `app.use()`, at the root so Express never strips a mount prefix. The shared bridge handles transport failures with fixed responses or socket destruction. Disable `x-powered-by`, proxy trust, query parsing and automatic ETags. Do not install JSON/body parsers, cookie/session/auth/CORS middleware, compression, Express static serving or business routes.

```text
Express listener -> root tracking/dispatch -> shared Node request bridge
                                          | probes first
                                          | staticFiles, if configured
                                          v
                                    toFetchHandler(app)
                                    HTTP / MCP / metadata
                                    one admission and executor
```

The app owns ways, canonical origins, composition and shutdown disposal order in `main.ts`. Application retains all endpoint dispatch, schemas, authentication, CSRF, sessions, permissions, request IDs, errors, audit/trace and MCP lifecycle. Commands and read models are unchanged. There is no alternate Express executor.

### One shared socket bridge

Add this explicit public export to `@house-rules/node-host`, implemented in `packages/node-host/src/host/node-request-handler.ts` and exported by `src/index.ts`:

```ts
createNodeRequestHandler(
  handler: (request: Request) => Promise<Response>,
  options?: { health?: HealthOptions },
): {
  handle(
    incoming: import("node:http").IncomingMessage,
    outgoing: import("node:http").ServerResponse,
  ): Promise<void>;
  drain(timeoutMs: number): Promise<void>;
}
```

Extract request conversion and response streaming from current `host/serve.ts`. Construction captures/validates probes once. The factory owns active tracking, per-request abort controllers, disconnect hooks and stream cleanup. `drain` waits up to its deadline, then aborts and destroys outstanding responses without awaiting uncooperative handlers. Its promise covers the response stream, not just handler resolution. It handles transport errors with fixed responses or socket destruction, never Express's default error page. It opens no listener, installs no process hooks and disposes no application.

Both hosts call that bridge. Express Host depends on node-host only for this helper and static/probe reuse. It never calls `node-host.serve`. Keep Node Host's existing `serve` signature, defaults and tests. Immediate SSE header flushing below is an intentional shared correction; non-SSE pre-header failure behavior stays unchanged. Express's underlying Node parser may reject malformed traffic before middleware, which must still fail closed with 400 and never reach the fetch handler. Keep the listener's CONNECT rejection at 501.

## Streaming and shutdown contracts

- Build URLs from validated raw Host and origin-form request targets, never `req.hostname`, `req.protocol`, proxy settings or forwarded headers. Preserve IPv6. Invalid Host/targets answer fixed 400; TRACE and `OPTIONS *` stay 501, except TRACE on probes stays 405. Reject before app execution.
- Use raw header pairs, with repeated Cookie fields joined by `; `. Preserve Authorization and Cookie for transport/Who, without logging them. Application alone strips credentials from feature/operation input. Preserve raw path/query and streamed binary bodies with `Readable.toWeb` and `duplex: "half"`, not parsed/re-serialized objects. HTTP body limits remain on the way.
- Copy status and response headers without `res.send/json`, freshness checks or content rewriting. Emit `Headers.getSetCookie()` as separate Set-Cookie fields, including Expires commas. HEAD sends no body and cancels any supplied body. Preserve request IDs, cache headers, MCP session/protocol headers, challenges and failure-code opt-in.
- Pump Web response bodies through Node streams with backpressure, not whole-body buffering or unchecked writes. For `text/event-stream`, flush headers immediately, even if the first event has not arrived. Do not compress, concatenate events or wait for EOF. Ordinary streams retain the existing first-read safeguard for a fixed 500 before headers; an SSE failure after its header flush, or any later stream failure, closes the connection.
- Client upload abort or response close before `writableFinished` aborts the Web Request and cancels/destroys response streams. Normal upload completion must not abort a still-live MCP response. Remove listeners on completion. No host-side MCP sessions, heartbeat policy or token cache. The router authenticates every session request and owns session termination.

`close()` and optional SIGINT/SIGTERM hooks share one promise. Stop accepting via the Express-created server's `close()`, close idle connections and drain active middleware/requests/streams for at most five seconds. At the deadline, abort active bridge signals and destroy remaining HTTP connections, then await `onClose` exactly once. An uncooperative handler must not block that deadline. Disposal itself is not time-bounded. Keep signal hooks until disposal ends, remove them even on failure, and set exit code 1 on failed signal shutdown. Startup failure must leave no listener or signal hooks. No WebSocket/HTTP2 upgrade support is introduced.

## Static files, probes and security

Use existing `healthHandler` before the composed static/router handler, with all network way paths and startup-fixed probe paths. Keep concurrent bounded readiness checks, sanitized status/failed-name output, GET/HEAD/405 and no admission/audit/unit/trace. Reuse the app's existing SQL check, never another pool.

Reuse `staticFiles` unchanged: its immutable build inventory, symlink/path guards, conditional requests, MIME/cache headers and HTML-only extensionless SPA fallback. Exclude every API/MCP prefix, protected-resource metadata and both probe paths, including configured replacements. Existing exclusion normalization covers case, percent, repeated slash and semicolon aliases. Unknown reserved requests go to the router or a non-SPA 404. Missing assets and unsafe paths never become HTML. Construct a fresh handler after rebuilding assets.

Set exact public `origins` on HTTP/MCP ways and the existing canonical MCP resource URL. Forwarded headers cannot create trust. Restrict Host at the deployment proxy/listener against DNS rebinding, as Node Host already requires. Same-origin assets need no CORS. Preserve session token omission, cookie flags and CSRF before cookie issuance. No new public paths, scopes or MCP write authority are approved.

## Exact dependency due diligence

Checked read-only on 2026-10-26 using Node `24.21.0`. Recommend these direct pins in the new package only:

| Dependency | Owner and evidence |
| --- | --- |
| `express: "5.3.0"` | Runtime dependency. Registry `latest` is 5.3.0, published 2026-10-09T12:56:54.505Z. Node >=18. MIT in metadata and downloaded tarball LICENSE. Not deprecated; no preinstall/install/postinstall. [Registry][express-registry], [tagged source/license][express-source], [release][express-release]. |
| `@types/express: "5.0.6"` | Dev dependency because the proposed public interface exposes no Express types. Registry `latest`, published 2025-12-01T20:35:51.488Z. Express 5 declarations with `@types/express-serve-static-core: ^5.0.0`, TS >=5.2. MIT confirmed in tarball LICENSE; not deprecated; no install hooks. Types need the same major, not the runtime's minor. [Registry][types-registry], [maintained definitions][types-source]. |
| `@house-rules/node-host` | Keep `workspace:0.2.0`, with no stable bump. A later approved local batch gets immutable prerelease versions only through local-publish. Existing `@types/node: "24.19.1"`, TypeScript `7.0.2` and Vitest `5.0.1` remain dev tooling. |

Both new external pins exceed the 1440-minute release age. Preserve that policy, exact direct pins and disabled install scripts. Their upstream transitive ranges resolve to exact lockfile entries at installation. No unrelated dependency or override is proposed.

Express 5 has ongoing official support; only the latest release of a supported major is supported [support policy][express-support]. The 5.3.0 release includes dependency security fixes. The Express repository is not archived, was pushed on 2026-10-26, and reports 69,580 stars/25,277 forks [repository metadata][express-repo]. DefinitelyTyped is active and not archived, with 51,455 stars/30,335 forks [repository metadata][types-repo]; its Express folder last changed on 2026-07-07 [folder history][types-history]. These are maintenance/adoption signals, not a vulnerability audit. Neither task repository declared Express or its types before this change. No download figure is claimed: the npm last-month endpoints returned stale May/June windows.

Exact registry tarball integrities:

```text
express@5.3.0
sha512-qCqy1xSoaugxOD4IVHb1ZWdkvCF2W3aE2okKouWj8VwJ+ztskSiXoBnCSJqfKT+cVPJhuJqe9YLbY425+Zh00g==
@types/express@5.0.6
sha512-sKYVuV7Sv9fbPIt/442koC7+IIwK5olP1KWeD88e/idgoJqDm3JV/YUiPwkoKK92ylff2MGxSz1CSjsXelx0YA==
```

## Upstream touchpoints after review

- `packages/express-host/{package.json,tsconfig.json,tsconfig.build.json,AGENTS.md,README.md,src/index.ts,src/host/serve.ts,src/tests/}`. Standard source/dist root door, plain strict host preset, no Effect diagnostic overrides. Root workspace/build globs already include it.
- `packages/node-host/src/{index.ts,host/serve.ts,host/node-request-handler.ts,tests/}` and its `README.md`/`AGENTS.md`. Extract rather than duplicate the socket bridge; retain every existing test and document the new export and SSE flush behavior.
- Root `AGENTS.md` sections "Kits, wiring and additions", "Workspace and package doors" and "Ways, web and agent access"; `CONTEXT.md` "Kits and wiring"/"Ways and sockets"; root `README.md` package list. Replace the sole-Node-bridge prose with two sanctioned framework hosts sharing one bridge. Keep Host calls in `main.ts` and the ban on `node:http` in Effect app code.
- `packages/rules/docs/dependency-cruiser.md#composition` and `packages/application/README.md` host guidance. No new `host: "express"` layout mode is needed: `packages/rules/src/hosts.cjs` only models Next-owned layout files. No lint/dependency-cruiser exemption or thin-config weakening is needed.
- `tests/node-host-policy.test.mjs`: explicitly allow both strict host packages while preserving the negative `nodeBuiltinImport` fixture. Add package/guide coverage in `tests/{published-packages,framework-agents}.test.mjs` and packed coverage in `scripts/packed-consumer.mjs` plus a focused Express consumer helper. Review new-package allowlists in `scripts/tag-published.mjs`, `tests/tag-published-inputs.test.mjs`, `tests/publish-workflow-assertions.mjs` and `.github/workflows/publish.yml`; registration is not permission to publish. `scripts/local-publish.mjs` already discovers public packages.
- Later dependency installation touches only the new manifest and necessary lockfile entries, plus exact internal pins if a reviewed version changes. This document does not choose or execute a local package batch.

## Proof required before adoption

Run focused host tests first, retaining Node Host coverage. Exercise real loopback Express sockets on port 0, not mocked middleware. Test Host/target rejection, IPv6, raw binary/chunked uploads, duplicate headers/Cookies, separate Set-Cookie, HEAD/empty bodies, pre/post-header failures, slow-reader backpressure and normal-upload-versus-disconnect signals. An idle SSE response must deliver headers before its first event. Prove shutdown drains success, force-aborts stuck work/SSE, disposes once, handles repeated signals and releases its port; test startup failure cleanup.

Run shared static/probe behavior through Express, including probe collisions/timeouts, safe failed names, SPA exclusions and aliases. Then use real `toFetchHandler` with a command and direct read model to prove schemas/statuses, 401/403, caller A/B, request IDs/audit, credentials isolation, CSRF/origin and session-cookie omission. Establish actual MCP initialization/session/stream traffic, allowed read and refusal, missing/invalid/revoked admission on existing sessions, unset-auth metadata/challenge behavior, disconnect and router disposal.

Cold packed-consumer proof must import built JavaScript/types and start/close Express with the bridge-bearing node-host tarball, while application/domain browser bundles stay free of Express/Node code. After implementation, the lead owns one full check/test/build gate and Trainer's manual flow with isolated fixtures. Keep Trainer's 16 modules, 174 operations, 34 commands, 28 direct queries and 6 ways, with an empty plan/map diff. Framework focused sockets and cold packed-consumer checks now pass, including public types with `skipLibCheck: false` and no consumer `@types/express`. Packed proof covers command/direct query admission, A/B policy, CSRF/session omission, credential isolation, MCP POST SSE progress and revocation, and real request interruption. Pinned Effect does not support GET SSE and returns 405; the host preserves that behavior. Trainer's manual flow and map proof remain with the lead.

[express-registry]: https://registry.npmjs.org/express
[express-source]: https://github.com/expressjs/express/tree/v5.3.0
[express-release]: https://github.com/expressjs/express/releases/tag/v5.3.0
[express-support]: https://expressjs.com/en/support
[express-repo]: https://api.github.com/repos/expressjs/express
[types-registry]: https://registry.npmjs.org/%40types%2Fexpress
[types-source]: https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/express
[types-repo]: https://api.github.com/repos/DefinitelyTyped/DefinitelyTyped
[types-history]: https://api.github.com/repos/DefinitelyTyped/DefinitelyTyped/commits?path=types/express&per_page=1

Listener/middleware ownership follows [Express 5.3.0's app.use/app.listen implementation](https://github.com/expressjs/express/blob/v5.3.0/lib/application.js). Drain/abort and streaming contracts use [Node 24.21.0 HTTP](https://nodejs.org/docs/v24.21.0/api/http.html) and [streams](https://nodejs.org/docs/v24.21.0/api/stream.html). Cross-family review must accept the package interface and the shared bridge export before implementation starts.

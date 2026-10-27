import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

export const expressConsumerFiles = {
  "express-host.ts": `import { serve, staticFiles, healthHandler, healthRoutes, type Host, type ServeOptions } from "@house-rules/express-host";
import { createNodeRequestHandler } from "@house-rules/node-host";
const options: ServeOptions = { port: 0, hostname: "127.0.0.1" };
export const host: Promise<Host> = serve(async () => new Response("typed"), options);
export const bridge = createNodeRequestHandler(async () => new Response());
export { staticFiles, healthHandler, healthRoutes };
`,
  "tsconfig.express.json": {
    compilerOptions: {
      target: "ES2024",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: ["node"],
      lib: ["ES2024", "DOM", "DOM.Iterable"],
    },
    include: ["express-host.ts"],
  },
  "express-host.mjs": `import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { serve } from "@house-rules/express-host";
import { Actor, ActorId, defineOperation, errorKind, memoryUnitOfWork } from "@house-rules/domain";
import { bindOperation, CallWatch, composition, CurrentActor, defineFeature, defineReadModel, defineWay, endpoint, Mean, protectedResource, Refused, StepTrace, toFetchHandler } from "@house-rules/application";
import { Context, Effect, Layer, Schema } from "effect";
import { HttpServerRequest } from "effect/http";
import { McpServer } from "effect/ai";
let revoked = false;
let audits = 0;
let inspected = 0;
const interrupted = Promise.withResolvers();
const entered = Promise.withResolvers();
const who = { resolve: incoming => {
  const token = incoming.headers.get("authorization");
  if (revoked || !["Bearer ada", "Bearer bob", "Bearer denied"].includes(token)) return Effect.fail(new Refused({ status: 401, code: "token_invalid", message: "Sign in." }));
  return Effect.succeed(Actor.make({ id: ActorId.make(token.slice(7)) }));
} };
const inspect = Effect.gen(function* () {
  const context = yield* Effect.context();
  const scope = context.mapUnsafe.get("@house-rules/application/CallerScope");
  const request = Context.getOrUndefined(context, HttpServerRequest.HttpServerRequest);
  for (const name of ["authorization", "cookie", "proxy-authorization", "set-cookie"]) {
    assert.equal(request?.headers[name], undefined);
    assert.equal(scope?.incoming.headers.has(name) ?? false, false);
  }
  inspected++;
});
class Missing extends Schema.TaggedError()("Missing", { kind: errorKind("not_found"), message: Schema.String }) {}
const read = defineOperation("PackedHost.read", { description: "Read an owned record.", input: Schema.Struct({ owner: Schema.String }), output: Schema.String, failure: Missing, permission: "fixture:read", readOnly: true });
const query = defineReadModel("packed_host_query", { ...read, edges: [read], handler: (input, { call }) => inspect.pipe(Effect.andThen(call(read, input))) });
const command = defineFeature("packed_host_command", { description: "Issue a fixture session.", input: Schema.Struct({ name: Schema.String }), output: Schema.Struct({ token: Schema.String, expiresAt: Schema.Int, name: Schema.String }), failure: Schema.Never, permission: null, edges: [], handler: ({ name }) => inspect.pipe(Effect.as({ token: "fixture-session", expiresAt: Date.now() + 60000, name })) });
const stuck = defineFeature("packed_host_stuck", { description: "Observe request interruption.", input: Schema.Struct({}), output: Schema.String, failure: Schema.Never, permission: null, edges: [], handler: () => Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.never), Effect.ensuring(Effect.sync(() => interrupted.resolve()))) });
const features = [query, command, stuck];
const web = defineWay({ name: "web", path: "/api", protocol: "http", features, who, mean: Mean.no, origins: ["https://public.packed.test"], session: { cookie: "sid" }, endpoints: [endpoint(query, "GET /record/:owner"), endpoint(command, "POST /session", { session: "issue" }), endpoint(stuck, "POST /stuck")] });
const resource = protectedResource({ resource: "https://public.packed.test/mcp", authorizationServers: ["https://issuer.packed.test"] });
const mcp = defineWay({ name: "mcp", path: "/mcp", protocol: "mcp", features: [query], who, mean: Mean.no, server: { name: "packed", version: "1" }, resource, tools: [{ feature: query, title: "Read own record", idempotent: true, openWorld: false }] });
const service = Context.Reference("packed/host", { defaultValue: () => undefined });
const modules = { mounts: [{ service, operations: [read], layer: Layer.empty, bind: () => [bindOperation(read, ({ owner }) => Effect.gen(function* () {
  yield* inspect;
  const actor = yield* CurrentActor;
  if (owner === "stream") {
    const server = Context.getOrUndefined(yield* Effect.context(), McpServer.McpServer);
    assert.ok(server);
    yield* server.notifications["notifications/progress"]({ progressToken: "packed", progress: 1 });
    return actor.id;
  }
  if (owner !== actor.id) return yield* new Missing({ message: "Not found." });
  return owner;
}))] }], layer: Layer.mergeAll(memoryUnitOfWork, StepTrace.layer(), Layer.succeed(CallWatch, { around: (_entry, _input, work) => Effect.sync(() => { audits++; }).pipe(Effect.andThen(work)) })) };
const app = composition({ modules, features, ways: [web, mcp], may: Effect.succeed({ permissionsOf: caller => Effect.succeed(caller.actor.id === "denied" ? [] : ["fixture:read"]) }), system: [] });
const router = toFetchHandler(app);
const host = await serve(router, { port: 0, hostname: "127.0.0.1", health: { wayPaths: ["/api", "/mcp"] }, onClose: async () => { try { await router.dispose(); } finally { await app.dispose(); } } });
const headers = { authorization: "Bearer ada", cookie: "old=credential", "content-type": "application/json", "x-request-id": "packed-host" };
const call = (at, init = {}) => fetch(new URL(at, host.url), { ...init, headers: { ...headers, ...init.headers } });
const rpc = async (body, extra = {}) => {
  const response = await call("/mcp", { method: "POST", headers: { accept: "application/json, text/event-stream", ...extra }, body: JSON.stringify(body) });
  const text = await response.text();
  const messages = response.status !== 200 ? [] : text.trimStart().startsWith("event:") || text.trimStart().startsWith("data:") ? text.split("\\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6))) : text ? [JSON.parse(text)] : [];
  return { response, messages };
};
try {
  const own = await call("/api/record/ada");
  assert.equal(own.status, 200);
  assert.equal(own.headers.get("x-request-id"), "packed-host");
  assert.equal(await own.json(), "ada");
  assert.equal((await call("/api/record/ada", { headers: { authorization: "Bearer bob" } })).status, 404);
  assert.equal((await call("/api/record/ada", { headers: { authorization: "Bearer denied" } })).status, 403);
  assert.equal((await call("/api/record/ada", { headers: { authorization: "invalid" } })).status, 401);
  assert.equal((await call("/api/session", { method: "POST", body: JSON.stringify({ name: "Ada" }) })).status, 403);
  assert.equal((await call("/api/session", { method: "POST", headers: { origin: "https://evil.packed.test" }, body: JSON.stringify({ name: "Ada" }) })).status, 403);
  assert.equal((await call("/api/session", { method: "POST", headers: { origin: "https://public.packed.test" }, body: "{}" })).status, 400);
  const issued = await call("/api/session", { method: "POST", headers: { origin: "https://public.packed.test" }, body: JSON.stringify({ name: "Ada" }) });
  assert.equal(issued.status, 200);
  const sessionBody = await issued.json();
  assert.equal(sessionBody.name, "Ada");
  assert.equal(typeof sessionBody.expiresAt, "number");
  assert.equal(Object.hasOwn(sessionBody, "token"), false);
  assert.match(issued.headers.get("set-cookie"), /^sid=fixture-session;/);
  assert.match(issued.headers.get("set-cookie"), /HttpOnly/);
  const before = audits;
  assert.equal((await fetch(new URL("/healthz", host.url))).status, 200);
  assert.equal(audits, before);
  const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "packed", version: "1" } } });
  assert.equal(init.response.status, 200);
  const session = { "mcp-session-id": init.response.headers.get("mcp-session-id"), "mcp-protocol-version": "2025-11-25" };
  assert.ok(session["mcp-session-id"]);
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
  const result = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: query.name, arguments: { owner: "ada" } } }, session);
  assert.equal(result.messages[0].result.isError, false);
  const denied = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: query.name, arguments: { owner: "bob" } } }, session);
  assert.equal(denied.messages[0].result.isError, true);
  const streaming = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: query.name, arguments: { owner: "stream" }, _meta: { progressToken: "packed" } } }, session);
  assert.equal(streaming.response.status, 200);
  assert.match(streaming.response.headers.get("content-type"), /text\\/event-stream/i);
  assert.equal(streaming.messages.length, 2);
  assert.equal(streaming.messages[0].method, "notifications/progress");
  // Pinned Effect supports POST SSE, not GET SSE. Preserve its 405 behavior.
  assert.equal((await call("/mcp", { headers: { ...session, accept: "text/event-stream" } })).status, 405);
  revoked = true;
  for (const authorization of ["Bearer ada", "invalid", ""]) {
    const response = await call("/mcp", { headers: { ...session, authorization, accept: "text/event-stream" } });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /resource_metadata/);
  }
  revoked = false;
  const metadata = await fetch(new URL("/.well-known/oauth-protected-resource/mcp", host.url));
  assert.equal(metadata.status, 200);
  assert.equal((await metadata.json()).resource, "https://public.packed.test/mcp");
  const client = httpRequest(new URL("/api/stuck", host.url), { method: "POST", headers: { ...headers, origin: "https://public.packed.test" } });
  client.on("error", () => {});
  client.end("{}");
  await entered.promise;
  client.destroy();
  await interrupted.promise;
  assert.ok(inspected >= 6);
  assert.ok(audits >= 6);
} finally { await host.close(); }
assert.equal((await router(new Request("http://packed.test/api/record/ada"))).status, 503);
const unsetApp = composition({ modules, features: [query], ways: [defineWay({ ...mcp, name: "unset", resource: protectedResource(undefined, "/mcp") })], may: Effect.succeed({ permissionsOf: () => Effect.succeed(["fixture:read"]) }), system: [] });
const unsetRouter = toFetchHandler(unsetApp);
const unsetHost = await serve(unsetRouter, { port: 0, hostname: "127.0.0.1", onClose: async () => { try { await unsetRouter.dispose(); } finally { await unsetApp.dispose(); } } });
try {
  const refused = await fetch(new URL("/mcp", unsetHost.url));
  assert.equal(refused.status, 503);
  assert.equal(refused.headers.has("www-authenticate"), false);
  for (const method of ["GET", "HEAD"]) assert.equal((await fetch(new URL("/.well-known/oauth-protected-resource/mcp", unsetHost.url), { method })).status, 503);
  assert.equal((await fetch(new URL("/.well-known/oauth-protected-resource/mcp", unsetHost.url), { method: "POST" })).status, 405);
} finally { await unsetHost.close(); }
console.log("cold install: real Express command/query, A/B policy, cookies/CSRF, credentials isolation, audit, MCP session/POST SSE, per-request auth and interruption pass");
`,
};

export function assertPackedExpressHost(app, tsc, { run }) {
  assert.equal(existsSync(path.join(app, "node_modules/@types/express")), false);
  run(tsc, ["--project", "tsconfig.express.json"], app);
  run(process.execPath, ["--no-experimental-strip-types", "express-host.mjs"], app);
}

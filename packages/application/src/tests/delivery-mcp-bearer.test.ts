import { afterAll, expect, it } from "@effect/vitest";
import { defineNode } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  composition,
  defineEntry,
  defineWay,
  endpoint,
  May,
  Mean,
  protectedResource,
  toFetchHandler,
} from "../index.ts";
import {
  answer,
  Bookings,
  bearerWhoFor,
  findBookings,
  metadataUrl,
  showBooking,
  webRequest,
  type Work,
} from "./delivery-fixtures.ts";
import { bindFixture, fixtureLayer, testActor } from "./entry-fixtures.ts";
import { mcpFixture } from "./router-fixtures.ts";
import { callMcpTool, mcpInitialize, mcpPost, openMcpSession } from "./delivery-mcp-client.ts";
const work: Work = { calls: 0, callers: 0 };
const entries = [showBooking, findBookings] as const;
const modules = Bookings.fromRecords(
  [
    { id: "b-1", owner: "ada", guestName: "Ada", nights: 3 },
    { id: "b-3", owner: "bob", guestName: "Bob", nights: 1 },
  ],
  work,
);
const who = bearerWhoFor(work);
const http = defineWay({
  name: "web",
  path: "/api",
  protocol: "http",
  entries,
  endpoints: [endpoint(showBooking, "GET /bookings/:id"), endpoint(findBookings, "GET /bookings")],
  who,
  may: May.fixed(entries, ["bookings:read"]),
  mean: Mean.no,
});
const mcp = defineWay({
  name: "mcp",
  path: "/api/mcp",
  protocol: "mcp",
  entries: [showBooking],
  who,
  may: May.fixed([showBooking], ["bookings:read"]),
  mean: Mean.elicitation,
  server: { name: "board", version: "1" },
  resource: protectedResource({
    resource: "https://app.example/mcp",
    authorizationServers: ["https://issuer.example"],
  }),
  tools: [{ entry: showBooking, title: "Show a booking", idempotent: true, openWorld: false }],
});
const app = composition({
  layer: fixtureLayer(entries).pipe(Layer.provideMerge(modules)),
  entries,
  ways: [http, mcp],
  system: [],
});
const router = toFetchHandler(app);
const disposers: Array<() => Promise<void>> = [() => router.dispose().then(app.dispose)];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));
type NextRouteHandler = (
  request: Request,
  context: { params: Promise<{ path: readonly string[] }> },
) => Promise<Response>;
const routeFile: Record<"GET" | "POST" | "DELETE", NextRouteHandler> = {
  GET: router,
  POST: router,
  DELETE: router,
};
const nextContext = { params: Promise.resolve({ path: ["mcp"] }) };
const viaNext = (handler: NextRouteHandler) => (request: Request) => handler(request, nextContext);
const onBoard = (handler: NextRouteHandler) => (request: Request) =>
  request
    .text()
    .then((body) =>
      handler(
        webRequest(
          request.url.replace("https://app.example/mcp", "https://board.example/api/mcp"),
          { method: request.method, headers: request.headers, body },
        ),
        nextContext,
      ),
    );
const challenge = `Bearer resource_metadata="${metadataUrl}"`;
it.effect("a bearer MCP call through the framework route runs as the token's actor", () =>
  Effect.gen(function* () {
    const post = onBoard(routeFile.POST);
    const session = yield* openMcpSession(post, { authorization: "Bearer tok-ada" });
    expect(session["mcp-session-id"]).not.toBe("");
    const own = yield* callMcpTool(post, session, "show_booking", { id: "b-1" });
    expect(own.result?.["isError"]).toBe(false);
    expect(own.result?.["structuredContent"]).toMatchObject({ id: "b-1", owner: "ada" });
    expect(
      (yield* callMcpTool(post, session, "show_booking", { id: "b-3" })).result?.["isError"],
    ).toBe(true);
  }),
);
it.effect("the same Who plug admits the same bearer on HTTP", () =>
  Effect.gen(function* () {
    const result = yield* answer(
      viaNext(routeFile.GET),
      webRequest("https://board.example/api/bookings/b-1", {
        headers: { authorization: "Bearer tok-ada" },
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: "b-1" });
  }),
);
it.effect("an invalid bearer is a protocol 401 before either way can do module work", () =>
  Effect.gen(function* () {
    const before = work.calls;
    const overMcp = yield* answer(
      viaNext(routeFile.POST),
      webRequest("https://board.example/api/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer tok-nobody",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(mcpInitialize),
      }),
    );
    const overHttp = yield* answer(
      viaNext(routeFile.GET),
      webRequest("https://board.example/api/bookings/b-1", {
        headers: { authorization: "Bearer tok-nobody" },
      }),
    );
    for (const result of [overMcp, overHttp]) {
      expect(result.status).toBe(401);
      expect(result.headers.get("www-authenticate")).toContain(
        `resource_metadata="${metadataUrl}"`,
      );
      expect(result.body).toEqual({
        error: {
          code: "token_invalid",
          message: "Send a valid token as Authorization: Bearer <token>.",
        },
      });
    }
    expect(overMcp.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(work.calls).toBe(before);
  }),
);
it.effect("MCP GET and DELETE without a token get the same resource challenge", () =>
  Effect.gen(function* () {
    for (const method of ["GET", "DELETE"] as const) {
      const response = yield* Effect.promise(() =>
        routeFile[method](
          webRequest("https://board.example/api/mcp", {
            method,
            headers: { accept: "text/event-stream" },
          }),
          nextContext,
        ),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(challenge);
      expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f]{32}$/u);
    }
  }),
);
it.effect("an McpServer rejection returns the fixed 500 with its request id", () =>
  Effect.gen(function* () {
    const bare = bindFixture(
      defineEntry(
        defineNode("bare", {
          description: "An input the server cannot advertise.",
          input: Schema.Struct({}),
          output: Schema.Struct({}),
          failure: Schema.Never,
          permission: null,
          readOnly: true,
        }),
      ),
      () => Effect.succeed({}),
    );
    const fixture = mcpFixture([bare], {
      tools: [{ entry: bare, title: "Bare", idempotent: true, openWorld: false }],
    });
    disposers.push(fixture.dispose);
    const response = yield* Effect.promise(() =>
      fixture.handler(
        webRequest("https://app.example/mcp", {
          method: "POST",
          headers: {
            authorization: "Bearer fixture",
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "x-request-id": "mcp-500",
          },
          body: JSON.stringify(mcpInitialize),
        }),
      ),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("mcp-500");
    expect(yield* Effect.promise(() => response.text())).toBe(
      JSON.stringify({
        error: { code: "internal_error", message: "Something went wrong on the server." },
      }),
    );
  }),
);
it.effect("an unconfigured MCP way and all metadata paths fail closed without Who", () =>
  Effect.gen(function* () {
    let callers = 0;
    const read = bindFixture(
      defineEntry(
        defineNode("read", {
          description: "Read.",
          input: Schema.Struct({ id: Schema.String }),
          output: Schema.String,
          failure: Schema.Never,
          permission: null,
          readOnly: true,
        }),
      ),
      () => Effect.succeed("x"),
    );
    const fixture = mcpFixture([read], {
      resource: protectedResource(undefined, "/mcp"),
      tools: [{ entry: read, title: "Read", idempotent: true, openWorld: false }],
      who: {
        resolve: () =>
          Effect.sync(() => {
            callers += 1;
            return testActor;
          }),
      },
    });
    disposers.push(fixture.dispose);
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      for (const method of ["GET", "HEAD", "POST"] as const) {
        const metadata = yield* Effect.promise(() =>
          fixture.handler(webRequest(`https://app.example${path}`, { method })),
        );
        expect(metadata.status).toBe(method === "POST" ? 405 : 503);
        expect(metadata.headers.has("www-authenticate")).toBe(false);
        if (method === "HEAD") expect(yield* Effect.promise(() => metadata.text())).toBe("");
      }
    }
    const request = yield* mcpPost(fixture.handler, {}, mcpInitialize);
    expect(request.status).toBe(503);
    expect(request.headers.has("www-authenticate")).toBe(false);
    expect(callers).toBe(0);
  }),
);

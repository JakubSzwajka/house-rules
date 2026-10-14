import { afterAll, expect, it } from "@effect/vitest";
import { Context, Effect, Schema } from "effect";
import {
  composition,
  defineContract,
  implement,
  route,
  toFetchHandler,
  toMcpHandler,
  tool,
} from "../index.ts";
import {
  answer,
  Bookings,
  bearerCallerFor,
  findBookings,
  metadataUrl,
  sessionCallerFor,
  showBooking,
  views,
  webRequest,
  type Work,
} from "./delivery-fixtures.ts";
import { callMcpTool, mcpInitialize, mcpPost, openMcpSession } from "./delivery-mcp-client.ts";

type NextRouteHandler = (
  request: Request,
  context: { params: Promise<{ path: ReadonlyArray<string> }> },
) => Promise<Response>;

const work: Work = { calls: 0, callers: 0 };
const layer = Bookings.fromRecords(
  [
    { id: "b-1", owner: "ada", guestName: "Ada", nights: 3 },
    { id: "b-3", owner: "bob", guestName: "Bob", nights: 1 },
  ],
  work,
);
const app = composition({ layer, caller: sessionCallerFor(work), views });
const bearer = bearerCallerFor(work);
const api = toFetchHandler(app, {
  prefix: "/api",
  caller: bearer,
  routes: [route(showBooking, "GET /bookings/:id"), route(findBookings, "GET /bookings")],
});
const mcp = toMcpHandler(app, {
  path: "/api/mcp",
  name: "board",
  version: "0.0.0",
  caller: bearer,
  tools: [tool(showBooking, { title: "Show a booking", idempotent: true, openWorld: false })],
});
const catchAll: NextRouteHandler = (request) =>
  // Next's app/api/[...path]/route.ts: one file, MCP at /api/mcp, every other path on the fetch handler.
  new URL(request.url).pathname === "/api/mcp" ? mcp(request) : api(request);
const routeFile = { GET: catchAll, POST: catchAll, DELETE: catchAll } as const;
const nextContext = { params: Promise.resolve({ path: ["mcp"] }) };
afterAll(() => Promise.all([api.dispose(), mcp.dispose()]).then(() => app.dispose()));

const viaNext = (handler: NextRouteHandler) => (request: Request) => handler(request, nextContext);

const onBoard = (handler: NextRouteHandler) => (request: Request) =>
  request.text().then((body) =>
    handler(
      webRequest(request.url.replace("https://app.example/mcp", "https://board.example/api/mcp"), {
        method: request.method,
        headers: request.headers,
        body,
      }),
      nextContext,
    ),
  );

const challenge = `Bearer resource_metadata="${metadataUrl}"`;

const refusal = {
  error: {
    code: "token_invalid",
    message: "Send a valid token as Authorization: Bearer <token>.",
  },
};

it.effect("a bearer tool call through the catch-all route runs as the token's user", () =>
  Effect.gen(function* bearerToolCall() {
    const post = onBoard(routeFile.POST);
    const auth = { authorization: "Bearer tok-ada" };
    const session = yield* openMcpSession(post, auth);
    expect(session["mcp-session-id"]).not.toBe("");
    const own = yield* callMcpTool(post, session, "show_booking", { id: "b-1" });
    expect(own.result?.["isError"]).toBe(false);
    expect(own.result?.["structuredContent"]).toMatchObject({ id: "b-1", owner: "ada" });
    // The module decides access from the token's user: bob's booking is not ada's to see.
    const other = yield* callMcpTool(post, session, "show_booking", { id: "b-3" });
    expect(other.result?.["isError"]).toBe(true);
  }),
);

it.effect("the same bearer caller admits the same token on the HTTP routes", () =>
  Effect.gen(function* sameCallerOverHttp() {
    const r = yield* answer(
      viaNext(routeFile.GET),
      webRequest("https://board.example/api/bookings/b-1", {
        headers: { authorization: "Bearer tok-ada" },
      }),
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: "b-1" });
  }),
);

it.effect("a bad token is a 401 with the challenge on MCP, the same as on HTTP", () =>
  Effect.gen(function* refusedToken() {
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
    for (const r of [overMcp, overHttp]) {
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toBe(challenge);
      expect(r.body).toEqual(refusal);
    }
    expect(work.calls).toBe(before);
  }),
);

it.effect("GET and DELETE on the MCP path are refused the same way without a token", () =>
  Effect.gen(function* otherMethods() {
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

it.effect("an McpServer that rejects still answers the fixed 500, with the request id", () =>
  Effect.gen(function* serverRejects() {
    // An empty Struct input renders a tool schema with no "type", which McpServer refuses to list.
    const bare = implement(
      defineContract("bare", {
        description: "Has an input McpServer cannot advertise.",
        input: Schema.Struct({}),
        output: Schema.Struct({}),
        failure: Schema.Never,
        permission: "public",
        annotations: { readOnly: true },
      }),
      () => Effect.succeed({}),
    );
    const plain = composition({ layer, caller: () => Effect.succeed(Context.empty()) });
    const handler = toMcpHandler(plain, {
      path: "/mcp",
      name: "t",
      version: "0",
      tools: [tool(bare, { title: "Bare", idempotent: true, openWorld: false })],
    });
    const r = yield* Effect.promise(() =>
      handler(
        webRequest("https://app.example/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "x-request-id": "mcp-500",
          },
          body: JSON.stringify(mcpInitialize),
        }),
      ),
    );
    const body = yield* Effect.promise(() => r.text());
    yield* Effect.promise(() => handler.dispose().then(() => plain.dispose()));
    expect(r.status).toBe(500);
    expect(r.headers.get("x-request-id")).toBe("mcp-500");
    // The schema failure goes to the log only; the body is the fixed one, byte for byte.
    expect(body).toBe(
      JSON.stringify({
        error: { code: "internal_error", message: "Something went wrong on the server." },
      }),
    );
  }),
);

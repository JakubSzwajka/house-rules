import { afterAll, expect, it } from "@effect/vitest";
import { Context, Effect, Schema } from "effect";
import {
  defaultMaxBodyBytes,
  defineContract,
  implement,
  once,
  route,
  toFetchHandler,
  type View,
} from "../index.ts";
import { answer, bearerCallerFor, findBookings, makeApp, webRequest } from "./delivery-fixtures.ts";

const t = makeApp();
const small = toFetchHandler(t.app, {
  caller: bearerCallerFor(t.work),
  maxBodyBytes: 64,
  routes: [route(findBookings)],
});

const badOutput = implement(
  defineContract("bad_output", {
    description: "Returns a value its output schema cannot encode.",
    input: Schema.Struct({}),
    output: Schema.Struct({ n: Schema.Int }),
    failure: Schema.Never,
    permission: "public",
  }),
  () => Effect.succeed({ n: "not a number" } as unknown as { n: number }),
);

class Broken extends Schema.TaggedError<Broken>()("Broken", { n: Schema.Int }) {}

const brokenView = implement(
  defineContract("broken_view", {
    description: "Fails with an error whose view throws.",
    input: Schema.Struct({}),
    output: Schema.Struct({}),
    failure: Broken,
    permission: "public",
  }),
  () => Effect.fail(new Broken({ n: 1 })),
);

const strict = toFetchHandler(t.app, {
  caller: () => Effect.succeed(Context.empty()),
  views: {
    Broken: (_error: Broken): View => {
      throw new TypeError("INTERNAL_VIEW_DEFECT");
    },
  },
  routes: [route(badOutput), route(brokenView)],
});
afterAll(() => Promise.all([small.dispose(), strict.dispose()]).then(t.dispose));

const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: string,
  headers: Record<string, string> = {},
) =>
  answer(
    handler,
    webRequest(`https://app.example${path}`, {
      method: "POST",
      headers: { authorization: "Bearer tok-ada", ...headers },
      body,
    }),
  );

it.effect("a body over the default 1 MB limit is a 413", () =>
  Effect.gen(function* defaultLimit() {
    expect(defaultMaxBodyBytes).toBe(1024 * 1024);
    const padding = "x".repeat(defaultMaxBodyBytes);
    const r = yield* post(
      t.api,
      "/api/find_bookings",
      JSON.stringify({ by: "guest", guest: padding }),
    );
    expect(r.status).toBe(413);
    expect(r.body).toMatchObject({ error: { code: "body_too_large" } });
  }),
);

it.effect("the limit is configurable, and a streamed body without a length is cut off too", () =>
  Effect.gen(function* configuredLimit() {
    const fits = yield* post(
      small,
      "/find_bookings",
      JSON.stringify({ by: "guest", guest: "Ada" }),
    );
    expect(fits.status).toBe(200);
    const big = JSON.stringify({ by: "guest", guest: "x".repeat(100) });
    const declared = yield* post(small, "/find_bookings", big);
    expect(declared.status).toBe(413);
    const streamed = yield* answer(
      small,
      webRequest("https://app.example/find_bookings", {
        method: "POST",
        headers: { authorization: "Bearer tok-ada" },
        body: new Blob([big]).stream(),
        duplex: "half",
      } as RequestInit),
    );
    expect(streamed.status).toBe(413);
  }),
);

it.effect("a body in many small chunks is read whole", () =>
  Effect.gen(function* smallChunks() {
    const bytes = new TextEncoder().encode(JSON.stringify({ by: "guest", guest: "Ada" }));
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at < bytes.length) controller.enqueue(bytes.slice(at, ++at));
        else controller.close();
      },
    });
    const r = yield* answer(
      t.api,
      webRequest("https://app.example/api/find_bookings", {
        method: "POST",
        headers: { authorization: "Bearer tok-ada" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(r.status).toBe(200);
  }),
);

it.effect("a JSON member given twice is a 400, even spelled with an escape", () =>
  Effect.gen(function* duplicateMembers() {
    for (const body of [
      '{"by":"guest","guest":"BAD","guest":"Ada"}',
      '{"by":"guest","guest":"BAD","gu\\u0065st":"Ada"}',
    ]) {
      const r = yield* post(t.api, "/api/find_bookings", body);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({
        error: { code: "invalid_input", message: "Give guest once.", field: "guest" },
      });
    }
  }),
);

it.effect("a __proto__ key is undeclared input like any other", () =>
  Effect.gen(function* protoKeys() {
    const query = yield* answer(
      t.api,
      webRequest("https://app.example/api/bookings?by=guest&guest=Ada&__proto__=SECRET", {
        headers: { authorization: "Bearer tok-ada" },
      }),
    );
    expect(query.status).toBe(400);
    expect(query.body).toMatchObject({ error: { code: "invalid_input" } });
    expect(JSON.stringify(query.body)).not.toMatch(/SECRET/u);
    const body = yield* post(
      t.api,
      "/api/find_bookings",
      '{"by":"guest","guest":"Ada","__proto__":{"admin":true}}',
    );
    expect(body.status).toBe(400);
  }),
);

it.effect("an output the contract cannot encode is a logged 500 with the request id", () =>
  Effect.gen(function* encoderDefect() {
    const r = yield* post(strict, "/bad_output", "{}", { "x-request-id": "bad-encode" });
    expect(r.status).toBe(500);
    expect(r.headers.get("x-request-id")).toBe("bad-encode");
    expect(r.body).toEqual({
      error: { code: "internal_error", message: "Something went wrong on the server." },
    });
    expect(t.logs).toContainEqual(
      expect.objectContaining({
        annotations: expect.objectContaining({ requestId: "bad-encode" }),
      }),
    );
  }),
);

it.effect("a view that throws is a logged 500 with the request id", () =>
  Effect.gen(function* viewDefect() {
    const r = yield* post(strict, "/broken_view", "{}", { "x-request-id": "bad-view" });
    expect(r.status).toBe(500);
    expect(r.headers.get("x-request-id")).toBe("bad-view");
    expect(r.body).toEqual({
      error: { code: "internal_error", message: "Something went wrong on the server." },
    });
    expect(JSON.stringify(r.body)).not.toMatch(/INTERNAL_VIEW_DEFECT/u);
    expect(t.logs).toContainEqual(
      expect.objectContaining({ annotations: expect.objectContaining({ requestId: "bad-view" }) }),
    );
  }),
);

it.effect("a body that is not a JSON object is a 400 on the body field", () =>
  Effect.gen(function* notAnObject() {
    const broken = yield* post(t.api, "/api/find_bookings", "{");
    expect(broken.body).toMatchObject({ error: { code: "invalid_input", field: "body" } });
    const list = yield* post(t.api, "/api/find_bookings", "[]");
    expect(list.status).toBe(400);
  }),
);

it.effect("a query key on a write is a 400", () =>
  Effect.gen(function* queryOnWrite() {
    const r = yield* post(t.api, "/api/find_bookings?by=guest", JSON.stringify({ guest: "Ada" }));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { field: "by" } });
  }),
);

it.effect("the request id is echoed when safe, and fresh when missing or unsafe", () =>
  Effect.gen(function* requestIds() {
    const kept = yield* post(t.api, "/api/find_bookings", '{"by":"guest","guest":"Ada"}', {
      "x-request-id": "req-42",
    });
    expect(kept.headers.get("x-request-id")).toBe("req-42");
    const fresh = yield* post(t.api, "/api/find_bookings", '{"by":"guest","guest":"Ada"}', {
      "x-request-id": "no spaces allowed",
    });
    expect(fresh.headers.get("x-request-id")).toMatch(/^[0-9a-f]{32}$/u);
  }),
);

it.effect("a defect is a 500 internal_error, logged with the request id", () =>
  Effect.gen(function* defect() {
    const r = yield* post(t.api, "/api/crash", "{}", { "x-request-id": "req-crash" });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({
      error: { code: "internal_error", message: "Something went wrong on the server." },
    });
    expect(JSON.stringify(r.body)).not.toMatch(/a bug in the handler/u);
    expect(t.logs).toContainEqual({
      message: expect.arrayContaining(["Capability died"]),
      annotations: { capability: "crash", requestId: "req-crash" },
    });
  }),
);

it.effect("refusals come before any service work", () =>
  Effect.gen(function* refusalsFirst() {
    const before = t.work.calls;
    const noToken = yield* answer(t.api, webRequest("https://app.example/api/bookings/b-1"));
    expect(noToken.status).toBe(401);
    const forbidden = yield* post(t.api, "/api/bookings/b-1/cancel", "{}", {
      authorization: "Bearer tok-ada-read",
    });
    expect(forbidden.status).toBe(403);
    const badInput = yield* answer(
      t.api,
      webRequest("https://app.example/api/bookings?by=nights&minNights=five", {
        headers: { authorization: "Bearer tok-ada" },
      }),
    );
    expect(badInput.status).toBe(400);
    expect(t.work.calls).toBe(before);
  }),
);

it("once keeps the first value for a key across calls", () => {
  const key = "delivery-edges-once";
  const first = once(key, () => ({ made: 1 }));
  const second = once(key, () => ({ made: 2 }));
  expect(second).toBe(first);
});

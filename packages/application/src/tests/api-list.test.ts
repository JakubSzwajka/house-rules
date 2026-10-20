import { defineNode } from "@house-rules/domain";
import { answer, webRequest } from "./delivery-fixtures.ts";
import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { defineApi, endpoint, admit, toFetchHandler, defineEntry, toOpenApi } from "../index.ts";
import { cancelBooking, crash, findBookings, makeApp, showBooking } from "./delivery-fixtures.ts";

const api = defineApi(
  { prefix: "/api" },
  {
    showBooking: endpoint(showBooking, "GET /bookings/:id", { codes: ["not_found"] }),
    findBookings: endpoint(findBookings, "GET /bookings"),
    crash: endpoint(crash),
  },
);

const t = makeApp();
afterAll(t.dispose);

it("an endpoint with no address defaults to POST and its entry name", () => {
  const plain = endpoint(crash);
  expect(api.endpoints.crash).toMatchObject({ method: "POST", path: "/crash", status: 200 });
  expect({ method: plain.method, path: plain.path }).toEqual({ method: "POST", path: "/crash" });
  expect(endpoint(crash, "GET /crashes", { status: 202 })).toMatchObject({
    method: "GET",
    path: "/crashes",
    status: 202,
  });
});

it("an API list is frozen and keeps its prefix apart from each path", () => {
  expect(Object.isFrozen(api)).toBe(true);
  expect(Object.isFrozen(api.endpoints)).toBe(true);
  expect(api.prefix).toBe("/api");
  expect(api.endpoints.showBooking.path).toBe("/bookings/:id");
  expect(defineApi({}, {}).prefix).toBe("");
});

it("an API list refuses two entries on one address or one contract", () => {
  expect(() =>
    defineApi(
      {},
      {
        one: endpoint(showBooking, "GET /bookings/:id"),
        two: endpoint(cancelBooking, "GET /bookings/:key"),
      },
    ),
  ).toThrow(/two and one both answer GET \/bookings\/:key/u);
  expect(() =>
    defineApi(
      {},
      {
        one: endpoint(showBooking, "GET /bookings/:id"),
        two: endpoint(showBooking, "GET /show/:id"),
      },
    ),
  ).toThrow(/two and one both name the entry show_booking/u);
  expect(() =>
    defineApi(
      {},
      {
        one: endpoint(showBooking, "GET /bookings/:id"),
        two: endpoint(cancelBooking, "POST /bookings/:id"),
      },
    ),
  ).not.toThrow();
  for (const prefix of ["", "/api", "/v1/api", "/my-api_2/v1.2"] as const) {
    expect(defineApi({ prefix }, {}).prefix).toBe(prefix);
  }
});

it("a prefix that is not a plain absolute path is refused", () => {
  const refused = [
    "/api/",
    "/a/:b",
    "//collector.example",
    "//collector.example/api",
    "/",
    "api",
    "https://collector.example",
    "https:/collector.example",
    "mailto:x",
    "/\\collector.example",
    "\\\\collector.example",
    "/api\\v1",
    "/api?x=1",
    "/api#frag",
    "/.",
    "/..",
    "/api/./v1",
    "/api/../v1",
    "/api//v1",
    "/api/..%2f",
    "/api/%2e%2e",
    "/a b",
    "/api.",
    "/.hidden",
    "/a..b",
    "/api\n",
  ];
  for (const prefix of refused) {
    expect(() => defineApi({ prefix: prefix as `/${string}` }, {}), prefix).toThrow(
      /is not "\/<plain path>"/u,
    );
  }
});

it("an endpoint path that is not plain segments is refused", () => {
  const refused = [
    "GET //collector.example/x",
    "GET /\\collector.example",
    "GET /\t/collector.example/x",
    "GET /\n/collector.example/x",
    "GET /\r/collector.example/x",
    "GET /x\t",
    "GET /%2F%2Fhost",
    "GET /a%2fb",
    "GET /caf\u00e9",
    "GET /\u2215collector.example",
    "GET /x?y=1",
    "GET /x#y",
    "GET /x/",
    "GET /x//y",
    "GET /.",
    "GET /..",
    "GET /a/./b",
    "GET /a/../b",
    "GET /a:b",
    "GET /:",
    "GET /:1id",
    "GET /x*",
    "GET /x\u0000",
  ] as const;
  for (const at of refused) {
    expect(() => defineApi({}, { one: endpoint(showBooking, at) }), at).toThrow(
      /is not "\/<plain segments>"/u,
    );
  }
  for (const at of ["GET /", "GET /a-b/c_d/:id/e.f/~g", "GET /.well-known/x"] as const) {
    expect(() => defineApi({}, { one: endpoint(showBooking, at) }), at).not.toThrow();
  }
});

it.effect("a way supplies the API prefix once and serves shared endpoint status and codes", () =>
  Effect.gen(function* () {
    const fixture = makeApp({ endpoints: Object.values(api.endpoints) });
    const response = yield* answer(
      fixture.router,
      webRequest("https://app.example/api/bookings/b-1", {
        headers: { authorization: "Bearer tok-ada" },
      }),
    );
    expect(response.status).toBe(200);
    const doubled = yield* Effect.promise(() =>
      fixture.router(
        webRequest("https://app.example/api/api/bookings/b-1", {
          headers: { authorization: "Bearer tok-ada" },
        }),
      ),
    );
    expect(doubled.status).toBe(404);
    expect(api.endpoints.showBooking.entry).toBe(showBooking);
    yield* Effect.promise(fixture.dispose);
  }),
);
it("a router takes no second entry-to-capability mapping", () => {
  const invalid = () => {
    // @ts-expect-error Entries are already bound in NodeRuntime; there is no route map.
    return toFetchHandler(t.app, { routes: { showBooking, findBookings } });
  };
  expect(typeof invalid).toBe("function");
});
it.effect("a way whose path differs from its API prefix fails typed acquisition", () =>
  Effect.gen(function* () {
    const invalid = makeApp({ path: "/different", endpoints: Object.values(api.endpoints) });
    const result = yield* Effect.promise(() =>
      admit(invalid.app, { headers: new Headers(), url: "/" }, { way: "api" }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "GraphInvalid", reason: expect.stringMatching(/API prefix/u) },
    });
    yield* Effect.promise(invalid.dispose);
  }),
);
it("OpenAPI derives a shared API prefix or accepts the same explicit prefix, never concatenating both", () => {
  const endpoints = Object.values(api.endpoints);
  const options = { title: "Bookings", version: "1" };
  expect(Object.keys(toOpenApi(endpoints, options).paths)).toEqual([
    "/api/bookings/{id}",
    "/api/bookings",
    "/api/crash",
  ]);
  expect(Object.keys(toOpenApi(endpoints, { ...options, prefix: "/api" }).paths)).toEqual(
    Object.keys(toOpenApi(endpoints, options).paths),
  );
  expect(() => toOpenApi(endpoints, { ...options, prefix: "/other" })).toThrow(/API prefix/u);
});
const stricterShowBooking = defineEntry(
  defineNode("show_booking", {
    description: "Show a booking for a stated reason.",
    input: Schema.Struct({ id: Schema.String, reason: Schema.String }),
    output: showBooking.node.output,
    failure: showBooking.node.failure,
    permission: "bookings:read",
    readOnly: true,
  }),
);
it.effect(
  "an endpoint with an identically named but different entry is not exposed by identity",
  () =>
    Effect.gen(function* () {
      expect(stricterShowBooking.node.name).toBe(showBooking.node.name);
      const invalid = makeApp({ endpoints: [endpoint(stricterShowBooking, "GET /bookings/:id")] });
      const result = yield* Effect.promise(() =>
        admit(invalid.app, { headers: new Headers(), url: "/" }, { way: "api" }),
      );
      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "GraphInvalid", reason: expect.stringMatching(/does not expose/u) },
      });
      yield* Effect.promise(invalid.dispose);
    }),
);

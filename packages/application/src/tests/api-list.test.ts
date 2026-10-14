import { afterAll, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  defineApi,
  defineContract,
  endpoint,
  implement,
  mount,
  route,
  toFetchHandler,
  toOpenApi,
} from "../index.ts";
import {
  cancelBooking,
  crash,
  findBookings,
  makeApp,
  renameGuest,
  showBooking,
} from "./delivery-fixtures.ts";

const api = defineApi(
  { prefix: "/api" },
  {
    showBooking: endpoint(showBooking.contract, "GET /bookings/:id", { codes: ["not_found"] }),
    findBookings: endpoint(findBookings.contract, "GET /bookings"),
    crash: endpoint(crash.contract),
  },
);

const t = makeApp();
afterAll(t.dispose);

it("an endpoint with no address takes the one route() takes with none", () => {
  const plain = route(crash);
  expect(api.endpoints.crash).toMatchObject({ method: "POST", path: "/crash", status: 200 });
  expect({ method: plain.method, path: plain.path }).toEqual({ method: "POST", path: "/crash" });
  expect(endpoint(crash.contract, "GET /crashes", { status: 202 })).toMatchObject({
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
        one: endpoint(showBooking.contract, "GET /bookings/:id"),
        two: endpoint(cancelBooking.contract, "GET /bookings/:key"),
      },
    ),
  ).toThrow(/two and one both answer GET \/bookings\/:key/u);
  expect(() =>
    defineApi(
      {},
      {
        one: endpoint(showBooking.contract, "GET /bookings/:id"),
        two: endpoint(showBooking.contract, "GET /show/:id"),
      },
    ),
  ).toThrow(/two and one both name the contract show_booking/u);
  expect(() =>
    defineApi(
      {},
      {
        one: endpoint(showBooking.contract, "GET /bookings/:id"),
        two: endpoint(cancelBooking.contract, "POST /bookings/:id"),
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
    expect(() => defineApi({}, { one: endpoint(showBooking.contract, at) }), at).toThrow(
      /is not "\/<plain segments>"/u,
    );
  }
  for (const at of ["GET /", "GET /a-b/c_d/:id/e.f/~g", "GET /.well-known/x"] as const) {
    expect(() => defineApi({}, { one: endpoint(showBooking.contract, at) }), at).not.toThrow();
  }
});

it("mount puts the API prefix in every path and takes status and codes from the endpoint", () => {
  const routes = mount(api, { showBooking, findBookings, crash });
  expect(
    routes.map(({ method, path, status, codes }) => ({ method, path, status, codes })),
  ).toEqual([
    { method: "GET", path: "/api/bookings/:id", status: 200, codes: ["not_found"] },
    { method: "GET", path: "/api/bookings", status: 200, codes: [] },
    { method: "POST", path: "/api/crash", status: 200, codes: [] },
  ]);
  expect(routes.map((each) => each.capability)).toEqual([showBooking, findBookings, crash]);
});

it("mount needs exactly one capability per key, each with that endpoint's contract", () => {
  // @ts-expect-error crash has no capability.
  expect(() => mount(api, { showBooking, findBookings })).toThrow(/crash has no capability/u);
  expect(() =>
    // @ts-expect-error renameGuest is not in the API list.
    mount(api, { showBooking, findBookings, crash, renameGuest }),
  ).toThrow(/renameGuest is not in the API list/u);
  expect(() =>
    // @ts-expect-error findBookings does not run the show_booking contract.
    mount(api, { showBooking: findBookings, findBookings, crash }),
  ).toThrow(/names show_booking, not find_bookings/u);
});

it("a fetch handler refuses its own prefix on routes from an API list", () => {
  const routes = mount(api, { showBooking, findBookings, crash });
  expect(() => toFetchHandler(t.app, { prefix: "/api", routes })).toThrow(
    /comes from an API list, which owns the prefix/u,
  );
  const handler = toFetchHandler(t.app, { routes: [...routes, route(renameGuest)] });
  expect(typeof handler).toBe("function");
  return handler.dispose();
});

it("toOpenApi refuses its own prefix on routes from an API list, and documents them as mounted", () => {
  const routes = mount(api, { showBooking, findBookings, crash });
  const options = { title: "Bookings", version: "1.0.0" };
  expect(() => toOpenApi(routes, { ...options, prefix: "/api" })).toThrow(
    /toOpenApi: GET \/api\/bookings\/:id comes from an API list, which owns the prefix/u,
  );
  expect(Object.keys(toOpenApi(routes, options).paths)).toEqual([
    "/api/bookings/{id}",
    "/api/bookings",
    "/api/crash",
  ]);
  expect(
    Object.keys(toOpenApi(Object.values(api.endpoints), { ...options, prefix: "/api" }).paths),
  ).toContain("/api/bookings/{id}");
});

const stricterShowBooking = implement(
  defineContract("show_booking", {
    description: "Show one booking by its id, for a stated reason.",
    input: Schema.Struct({ id: Schema.String, reason: Schema.String }),
    output: showBooking.contract.output,
    failure: showBooking.contract.failure,
    permission: "bookings:read",
    annotations: { readOnly: true },
  }),
  () => Effect.die("never run"),
);

it("mount refuses a capability whose contract type is not the endpoint's, even under the same name", () => {
  expect(stricterShowBooking.contract.name).toBe(showBooking.contract.name);
  expect(() =>
    // @ts-expect-error the capability needs a `reason` the endpoint's input does not carry.
    mount(api, { showBooking: stricterShowBooking, findBookings, crash }),
  ).toThrow(
    /names show_booking, not another contract object named show_booking; contracts match by identity/u,
  );
  // The capability that runs the endpoint's own contract still mounts.
  expect(() => mount(api, { showBooking, findBookings, crash })).not.toThrow();
});

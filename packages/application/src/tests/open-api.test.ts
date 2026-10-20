import { defineNode, errorKind } from "@house-rules/domain";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { defineEntry, endpoint, failureCodeHeader, toOpenApi } from "../index.ts";
import {
  BookingNotFound,
  cancelBooking,
  crash,
  findBookings,
  renameGuest,
  showBooking,
} from "./delivery-fixtures.ts";

class Overbooked extends Schema.TaggedError<Overbooked>()("Overbooked", {
  kind: errorKind("conflict"),
  nights: Schema.Int,
}) {}

const reserve = defineEntry(
  defineNode("reserve", {
    description: "Reserve nights.",
    input: Schema.Struct({ nights: Schema.Int, note: Schema.optionalKey(Schema.String) }),
    output: Schema.Struct({ id: Schema.String }).annotate({ identifier: "Reservation" }),
    failure: Schema.Union([BookingNotFound, Overbooked]),
    permission: "bookings:write",
    transactional: true,
  }),
);

const routes = [
  endpoint(showBooking, "GET /bookings/:id"),
  endpoint(findBookings, "GET /bookings"),
  endpoint(renameGuest, "PATCH /bookings/:id"),
  endpoint(cancelBooking, "POST /bookings/:id/cancel"),
  endpoint(crash),
] as const;

const document = toOpenApi([...routes, endpoint(reserve, "POST /reservations", { status: 201 })], {
  title: "Booking example",
  version: "1.0.0",
  prefix: "/api",
  security: { schemes: { session: { type: "apiKey", in: "cookie", name: "session" } } },
});

type Json = Record<string, unknown>;
const operation = (path: string, method: string) =>
  (document.paths[path] as Record<string, Json>)[method] as Json & {
    parameters: Array<Json>;
    responses: Record<string, Json>;
    requestBody?: Json;
  };

const refsIn = (value: unknown): Array<string> =>
  typeof value !== "object" || value === null
    ? []
    : Object.entries(value).flatMap(([key, inner]) =>
        key === "$ref" && typeof inner === "string" ? [inner] : refsIn(inner),
      );

it("names the version, the info and the mounted paths with the prefix", () => {
  expect(document.openapi).toBe("3.1.0");
  expect(document.info).toEqual({ title: "Booking example", version: "1.0.0" });
  expect(Object.keys(document.paths).sort()).toEqual([
    "/api/bookings",
    "/api/bookings/{id}",
    "/api/bookings/{id}/cancel",
    "/api/crash",
    "/api/reservations",
  ]);
  expect(JSON.parse(JSON.stringify(document))).toEqual(document);
});

it("a GET takes path and query parameters from the entry node's input", () => {
  const show = operation("/api/bookings/{id}", "get");
  expect(show.operationId).toBe("show_booking");
  expect(show.parameters).toEqual([
    { name: "id", in: "path", required: true, schema: { type: "string" } },
  ]);
  const find = operation("/api/bookings", "get");
  // A Union input goes out as one exploded form object, a member per shape.
  expect(find.parameters).toMatchObject([
    { name: "input", in: "query", style: "form", explode: true, schema: { anyOf: [{}, {}] } },
  ]);
});

it("a write takes the body from the input, without the path keys", () => {
  const rename = operation("/api/bookings/{id}", "patch");
  expect(rename.parameters).toEqual([
    { name: "id", in: "path", required: true, schema: { type: "string" } },
  ]);
  expect(rename.requestBody).toEqual({
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: { guestName: { type: "string" } },
          required: ["guestName"],
          additionalProperties: false,
        },
      },
    },
  });
  const body = (operation("/api/reservations", "post").requestBody as Json).content as Json;
  expect(JSON.stringify(body)).toContain('"required":["nights"]');
});

it("lists failures under the status their view always answers, and names no internal tag", () => {
  const show = operation("/api/bookings/{id}", "get").responses;
  expect(Object.keys(show).sort()).toEqual(["200", "400", "403", "404", "503", "default"]);
  expect(show["404"]).toEqual({
    description: "A failure mapped by kind to 404.",
    content: { "application/json": { schema: {} } },
  });
  const reserved = operation("/api/reservations", "post").responses;
  expect(Object.keys(reserved).sort()).toEqual([
    "201",
    "400",
    "403",
    "404",
    "409",
    "503",
    "default",
  ]);
  expect(JSON.stringify(document)).not.toMatch(
    /BookingNotFound|Forbidden|ApprovalDenied|Overbooked|Refused|InputInvalid|x-failure/u,
  );
});

it("names a declared code under the status of the view that exposes it", () => {
  const coded = toOpenApi(
    [endpoint(showBooking, "GET /bookings/:id", { codes: ["not_found", "gone"] })],
    {
      title: "x",
      version: "1",
    },
  );
  const responses = (coded.paths["/bookings/{id}"]?.get as Json).responses as Record<string, Json>;
  expect(responses["404"]).toMatchObject({
    headers: { [failureCodeHeader]: { schema: { enum: ["not_found"] } } },
  });
  expect(responses.default?.headers).toBeUndefined();
  expect(JSON.stringify(responses)).not.toContain("gone");
  expect(responses["403"]?.headers).toBeUndefined();
});

it("keeps Who security for every endpoint, including a null-permission root", () => {
  expect(document.components.securitySchemes).toEqual({
    session: { type: "apiKey", in: "cookie", name: "session" },
  });
  expect(document.security).toEqual([{ session: [] }]);
  expect(operation("/api/crash", "post").security).toBeUndefined();
  expect(operation("/api/bookings/{id}", "get").security).toBeUndefined();
  expect(toOpenApi(routes, { title: "x", version: "1" }).security).toBeUndefined();
});

it("inherits security for a null-permission root with a permissioned closure", () => {
  const root = defineEntry(
    defineNode("show_reservation", {
      description: "Show a reservation through its child.",
      input: reserve.node.input,
      output: reserve.node.output,
      failure: Schema.Never,
      permission: null,
      edges: [reserve.node],
    }),
  );
  const doc = toOpenApi([endpoint(root)], {
    title: "Reservations",
    version: "1",
    security: { schemes: { bearer: { type: "http", scheme: "bearer" } } },
  });
  expect(root.closures.person).toEqual(["bookings:write"]);
  expect(doc.security).toEqual([{ bearer: [] }]);
  expect(doc.paths["/show_reservation"]?.post?.security).toBeUndefined();
});

it("rejects the removed OpenAPI wording option in types", () => {
  const removed = () =>
    toOpenApi(routes, {
      title: "x",
      version: "1",
      // @ts-expect-error Wording belongs to ways, not OpenAPI generation.
      overrides: { BookingNotFound: () => "No booking." },
    });
  expect(typeof removed).toBe("function");
});

it("every $ref points at a component", () => {
  const refs = refsIn(document);
  expect(refs).toContain("#/components/schemas/Reservation");
  for (const ref of refs) {
    expect(ref).toMatch(/^#\/components\/schemas\/[A-Za-z0-9._-]+$/u);
    expect(Object.hasOwn(document.components.schemas, ref.split("/").at(-1) ?? "")).toBe(true);
  }
  expect(JSON.stringify(document)).not.toContain("$defs");
});

it("refuses two operations on one method and path", () => {
  expect(() =>
    toOpenApi([endpoint(showBooking, "GET /x"), endpoint(showBooking, "GET /x")], {
      title: "x",
      version: "1",
    }),
  ).toThrow(/GET \/x is listed twice/u);
});

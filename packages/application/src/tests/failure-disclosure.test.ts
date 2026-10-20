import { afterAll, expect, expectTypeOf, it } from "@effect/vitest";
import { defineNode, errorKind, NoInput } from "@house-rules/domain";
import { Effect, Logger, References, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import {
  defineEntry,
  defineWay,
  endpoint,
  failureCodeHeader,
  HttpFailure,
  Refused,
  toHttpClient,
  type WordingOverrides,
} from "../index.ts";
import { answer, BookingNotFound, makeApp, renameGuest, webRequest } from "./delivery-fixtures.ts";
import { bindFixture } from "./entry-fixtures.ts";
import { httpFixture } from "./router-fixtures.ts";
const disposers: Array<() => Promise<void>> = [];
afterAll(() => Promise.all(disposers.map((dispose) => dispose())));
const answerOf = (handler: (request: Request) => Promise<Response>, token: string, id: string) =>
  answer(
    handler,
    webRequest(`https://app.example/bookings/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ guestName: "Mallory" }),
    }),
  ).pipe(
    Effect.map(({ status, headers, body }) => ({
      status,
      headers: Object.fromEntries([...headers].filter(([name]) => name !== "x-request-id")),
      body,
    })),
  );
it.effect(
  "object privacy sends the same 404 for another person's record and a missing record",
  () =>
    Effect.gen(function* () {
      const fixture = makeApp({
        path: "/",
        endpoints: [endpoint(renameGuest, "PATCH /bookings/:id")],
        overrides: { BookingNotFound: () => "Not found." },
      });
      disposers.push(fixture.dispose);
      const other = yield* answerOf(fixture.router, "tok-ada", "b-3");
      const missing = yield* answerOf(fixture.router, "tok-ada", "missing");
      expect(other.status).toBe(404);
      expect(other).toEqual(missing);
      expect(Object.keys(other.headers).filter((name) => name.startsWith("x-failure"))).toEqual([]);
      expect(JSON.stringify(other)).not.toContain("BookingNotFound");
    }),
);
const renameAt = endpoint(renameGuest, "PATCH /bookings/:id", { codes: ["not_found"] });
it.effect("only a kind code declared by the endpoint is disclosed", () =>
  Effect.gen(function* () {
    const fixture = makeApp({
      path: "/",
      endpoints: [renameAt],
      overrides: { BookingNotFound: () => "Not found." },
    });
    disposers.push(fixture.dispose);
    const missing = yield* answerOf(fixture.router, "tok-ada", "missing");
    const denied = yield* answerOf(fixture.router, "tok-ada-read", "b-1");
    expect(missing.headers[failureCodeHeader]).toBe("not_found");
    expect(denied.status).toBe(403);
    expect(denied.headers[failureCodeHeader]).toBeUndefined();
  }),
);
it.effect(
  "a forged object-returning wording override is a generic logged 500, never a new body",
  () =>
    Effect.gen(function* () {
      const logs: Array<{
        message: unknown;
        cause: unknown;
        annotations: Readonly<Record<string, unknown>>;
      }> = [];
      const missingBooking = bindFixture(
        defineEntry(
          defineNode("missing_booking", {
            description: "Report a missing booking.",
            input: Schema.Struct({ id: Schema.String, guestName: Schema.String }),
            output: Schema.Struct({ id: Schema.String }),
            failure: BookingNotFound,
            permission: "bookings:write",
          }),
        ),
        ({ id }) => Effect.fail(new BookingNotFound({ id })),
      );
      const broken = httpFixture([missingBooking], {
        endpoints: [endpoint(missingBooking, "PATCH /bookings/:id", { codes: ["not_found"] })],
        extra: Logger.layer([
          Logger.make(({ message, cause, fiber }) => {
            logs.push({
              message,
              cause,
              annotations: fiber.getRef(References.CurrentLogAnnotations),
            });
          }),
        ]),
        overrides: {
          BookingNotFound: (() => ({
            status: 500,
            code: "secret_reason",
            body: "secret",
          })) as unknown as (error: BookingNotFound) => string,
        },
      });
      disposers.push(broken.dispose);
      const result = yield* answer(
        broken.handler,
        webRequest("https://app.example/bookings/missing", {
          method: "PATCH",
          headers: { authorization: "Bearer tok-ada", "x-request-id": "view-500" },
          body: JSON.stringify({ guestName: "Mallory" }),
        }),
      );
      expect(result.status).toBe(500);
      expect(result.body).toEqual({
        error: { code: "internal_error", message: "Something went wrong on the server." },
      });
      expect(JSON.stringify(result.body)).not.toMatch(/secret_reason|secret/u);
      expect(result.headers.get(failureCodeHeader)).toBeNull();
      expect(result.headers.get("x-request-id")).toBe("view-500");
      expect(logs).toContainEqual(
        expect.objectContaining({
          message: expect.arrayContaining(["A wording override failed"]),
          cause: expect.objectContaining({
            reasons: expect.arrayContaining([
              expect.objectContaining({
                _tag: "Die",
                defect: new TypeError("A wording override must return a string"),
              }),
            ]),
          }),
          annotations: expect.objectContaining({ requestId: "view-500" }),
        }),
      );
    }),
);
class Offline extends Schema.TaggedError<Offline>()("Offline", { kind: errorKind("unavailable") }) {
  override get message(): string {
    return "Temporarily offline.";
  }
}
const offline = bindFixture(
  defineEntry(
    defineNode("offline", {
      description: "Report unavailability.",
      input: NoInput,
      output: Schema.Void,
      failure: Offline,
      permission: null,
    }),
  ),
  () => Effect.fail(new Offline()),
);
it.effect("an unavailable kind keeps 503 and a string override, but sends no code header", () =>
  Effect.gen(function* () {
    const fixture = httpFixture([offline], {
      endpoints: [endpoint(offline, "POST /offline", { codes: ["unavailable"] })],
      overrides: { Offline: () => "Try again." },
    });
    disposers.push(fixture.dispose);
    const result = yield* answer(
      fixture.handler,
      webRequest("https://app.example/offline", { method: "POST", body: "{}" }),
    );
    expect(result.status).toBe(503);
    expect(result.body).toEqual({ error: { code: "unavailable", message: "Try again." } });
    expect(result.headers.get(failureCodeHeader)).toBeNull();
  }),
);
it("wording override types refuse status, code, unknown tags and the wrong error", () => {
  const fixture = httpFixture([offline], { endpoints: [endpoint(offline)] });
  disposers.push(fixture.dispose);
  const object = () =>
    defineWay({
      ...fixture.way,
      overrides: {
        // @ts-expect-error An override returns only message text, never status or code.
        Offline: () => ({ status: 500, code: "secret" }),
      },
    });
  const unknown = () =>
    defineWay({
      ...fixture.way,
      overrides: {
        // @ts-expect-error No reachable failure has this tag.
        Other: () => "x",
      },
    });
  expectTypeOf<(error: BookingNotFound) => string>().not.toExtend<
    NonNullable<WordingOverrides<Offline>["Offline"]>
  >();
  expect([typeof object, typeof unknown]).toEqual(["function", "function"]);
});
it.effect("a node cannot use a transport Refused to replace its kind status or code", () =>
  Effect.gen(function* () {
    const entry = bindFixture(
      defineEntry(
        defineNode("node_refusal", {
          description: "Refuse as a node.",
          input: NoInput,
          output: Schema.Void,
          failure: Refused,
          permission: null,
        }),
      ),
      () =>
        Effect.fail(
          new Refused({
            status: 418,
            code: "private_code",
            message: "No.",
            challenge: "private challenge",
          }),
        ),
    );
    const fixture = httpFixture([entry], {
      endpoints: [endpoint(entry, "POST /refuse", { codes: ["forbidden"] })],
    });
    disposers.push(fixture.dispose);
    const result = yield* answer(
      fixture.handler,
      webRequest("https://app.example/refuse", { method: "POST", body: "{}" }),
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: { code: "forbidden", message: "No." } });
    expect(result.headers.get(failureCodeHeader)).toBe("forbidden");
    expect(result.headers.has("www-authenticate")).toBe(false);
  }),
);

const reply = (status: number, headers: Record<string, string>): Response =>
  new Response("{}", { status, headers }) as Response;
const clientAnswering = (response: () => Response) =>
  Effect.flip(
    toHttpClient([renameAt], { baseUrl: "https://app.example" }).rename_guest({
      id: "b-1",
      guestName: "Ada",
    }),
  ).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, () => Promise.resolve(response())),
  );
it.effect(
  "the client accepts a declared 4xx code but ignores foreign, legacy and 5xx headers",
  () =>
    Effect.gen(function* () {
      const declared = yield* clientAnswering(() =>
        reply(404, { [failureCodeHeader]: "not_found" }),
      );
      expect(Schema.is(HttpFailure)(declared)).toBe(true);
      expect(declared).toMatchObject({ code: "not_found", status: 404 });
      expect(
        yield* clientAnswering(() => reply(404, { [failureCodeHeader]: "ForeignTag" })),
      ).toMatchObject({ code: "Unknown", status: 404 });
      expect(
        yield* clientAnswering(() => reply(500, { [failureCodeHeader]: "not_found" })),
      ).toMatchObject({ code: "Unknown", status: 500 });
      expect(
        yield* clientAnswering(() => reply(403, { "x-failure-tag": "Forbidden" })),
      ).toMatchObject({ code: "Unknown", status: 403 });
    }),
);

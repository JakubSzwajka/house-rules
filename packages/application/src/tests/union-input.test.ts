import { featureFixture } from "./feature-fixtures.ts";
import { expect, expectTypeOf, it } from "@effect/vitest";
import { defineOperation, errorKind } from "@house-rules/domain";
import { Effect, Schema } from "effect";
import { bindFixture, runFixture } from "./execution-fixtures.ts";
import { mcpProbe, ProbeRejected } from "./mcp-probe.ts";
class BookingNotFound extends Schema.TaggedError<BookingNotFound>()("BookingNotFound", {
  kind: errorKind("not_found"),
}) {}
const ById = Schema.Struct({ by: Schema.Literal("id"), bookingId: Schema.String });
const ByGuest = Schema.Struct({
  by: Schema.Literal("guest"),
  guest: Schema.String,
  nights: Schema.optionalKey(Schema.FiniteFromString),
});
const FindInput = Schema.Union([ById, ByGuest]);
type Find = typeof FindInput.Type;
const find = bindFixture(
  featureFixture(
    defineOperation("find_booking", {
      description: "Find a booking by id or guest.",
      input: FindInput,
      output: Schema.String,
      failure: BookingNotFound,
      permission: "bookings:read",
      readOnly: true,
    }),
  ),
  (input) =>
    Effect.succeed(
      input.by === "id" ? `id ${input.bookingId}` : `guest ${input.guest} ${input.nights ?? "-"}`,
    ),
);
const probe = mcpProbe("find_booking", FindInput);
const GreetInput = Schema.Struct({ name: Schema.String });
const greet = mcpProbe("greet", GreetInput);
const properties = {
  by: { type: "string", enum: ["id", "guest"] },
  bookingId: { type: "string" },
  guest: { type: "string" },
  nights: { type: "string" },
};
it.effect("a Union descriptor gives its binding one decoded member", () =>
  Effect.gen(function* () {
    expectTypeOf<typeof find.input>().toEqualTypeOf<typeof FindInput>();
    expectTypeOf<typeof find.input.Type>().toEqualTypeOf<Find>();
    expect(yield* runFixture(find, { by: "id", bookingId: "b-1" })).toBe("id b-1");
    expect(yield* runFixture(find, { by: "guest", guest: "Ada", nights: 2 })).toBe("guest Ada 2");
  }),
);
it.effect("MCP lists one closed object with shared required keys and an enum tag", () =>
  Effect.gen(function* () {
    expect((yield* probe.schema).inputSchema).toMatchObject({
      type: "object",
      properties,
      required: ["by"],
      additionalProperties: false,
    });
    expectTypeOf<typeof probe.feature.input.Type>().toEqualTypeOf<Find>();
  }),
);
it.effect("served parameters decode to the member the input fits", () =>
  Effect.gen(function* () {
    expect(yield* probe.decode({ by: "guest", guest: "Ada", nights: "3" })).toEqual({
      by: "guest",
      guest: "Ada",
      nights: 3,
    });
    expect(yield* probe.decode({ by: "id", bookingId: "b-1" })).toEqual({
      by: "id",
      bookingId: "b-1",
    });
    expect((yield* Effect.flip(probe.decode({ by: "guest", bookingId: "b-1" }))).message).toContain(
      "guest",
    );
  }),
);
it.effect("a Struct descriptor keeps its input and the router refuses excess fields", () =>
  Effect.gen(function* () {
    expect(greet.feature.input).toBe(GreetInput);
    expect((yield* greet.schema).inputSchema).toEqual({
      ...Schema.toJsonSchemaDocument(GreetInput).schema,
      additionalProperties: false,
    });
    yield* Effect.flip(greet.decode({ name: "Ada", admin: true }));
  }),
);
it.effect("an MCP handler receives the decoded member", () =>
  Effect.gen(function* () {
    expect(yield* probe.decode({ by: "guest", guest: "Ada", nights: "4" })).toEqual({
      by: "guest",
      guest: "Ada",
      nights: 4,
    });
    expect(probe.calls).toEqual([{ by: "guest", guest: "Ada", nights: 4 }]);
    expect(yield* probe.decode({ by: "id", bookingId: "b-9" })).toEqual({
      by: "id",
      bookingId: "b-9",
    });
  }),
);
it.effect("an MCP handler is not reached for a merged-object shape fitting no member", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(probe.decode({ by: "guest" }));
    expect(error).toBeInstanceOf(ProbeRejected);
    expect(error.message).toContain("guest");
    expect(probe.calls).toEqual([]);
  }),
);
it.effect("MCP refuses other-member, unknown Union and unknown Struct keys", () =>
  Effect.gen(function* () {
    const errors = [
      yield* Effect.flip(probe.decode({ by: "id", bookingId: "b-1", guest: "Ada" })),
      yield* Effect.flip(probe.decode({ by: "id", bookingId: "b-1", admin: true })),
      yield* Effect.flip(greet.decode({ name: "Ada", admin: true })),
    ];
    for (const error of errors) {
      expect(error).toBeInstanceOf(ProbeRejected);
      expect(error.message).toContain("Invalid parameters");
    }
  }),
);
it.effect("the listed merged object is closed to every other key", () =>
  Effect.gen(function* () {
    expect((yield* probe.schema).inputSchema).toEqual({
      type: "object",
      properties,
      required: ["by"],
      additionalProperties: false,
    });
  }),
);

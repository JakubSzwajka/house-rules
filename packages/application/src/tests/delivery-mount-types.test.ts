import { afterAll, expect, expectTypeOf, it } from "@effect/vitest";
import { Actor, ActorId } from "@house-rules/domain";
import { Context, Effect, Layer } from "effect";
import {
  type Admitted,
  call,
  composition,
  defineWay,
  endpoint,
  type Forbidden,
  May,
  Mean,
  toFetchHandler,
  type WordingOverrides,
} from "../index.ts";
import { Bookings, type BookingNotFound, findBookings, showBooking } from "./delivery-fixtures.ts";
import { fixtureLayer } from "./execution-fixtures.ts";
const features = [showBooking, findBookings] as const;
const actor = Actor.make({ id: ActorId.make("ada") });
const modules = Bookings.fromRecords([], { calls: 0, callers: 0 });
const layer = fixtureLayer(features).pipe(Layer.provideMerge(modules));
const way = defineWay({
  name: "web",
  path: "/",
  protocol: "http",
  features,
  endpoints: [endpoint(showBooking), endpoint(findBookings)],
  who: { resolve: () => Effect.succeed(actor) },
  mean: Mean.no,
});
const app = composition({
  modules: { mounts: [], layer },
  features,
  ways: [way],
  may: Effect.succeed(May.fixed(["bookings:read"])),
  system: [],
});
const handlers = [toFetchHandler(app)];
afterAll(() => Promise.all(handlers.map((handler) => handler.dispose())).then(app.dispose));
it("kinded failures need no view table on the composition or router", () => {
  expect(typeof handlers[0]).toBe("function");
  expect("views" in app).toBe(false);
});
it("a way rejects a wording function taking the wrong error", () => {
  expectTypeOf<(error: Forbidden) => string>().not.toExtend<
    NonNullable<WordingOverrides<BookingNotFound>["BookingNotFound"]>
  >();
});
class WhoPort extends Context.Service<WhoPort, Actor>()("test/WhoPort") {}
const dependent = defineWay({ ...way, who: { resolve: () => WhoPort } });
it("composition retains unmet Who requirements rather than erasing R", () => {
  const invalid = () => {
    // @ts-expect-error The layer supplies runtime and stores, but not WhoPort.
    return composition({
      modules: { mounts: [], layer },
      features,
      ways: [dependent],
      may: Effect.succeed(May.fixed(["bookings:read"])),
      system: [],
    });
  };
  const provided = composition({
    modules: { mounts: [], layer: Layer.merge(layer, Layer.succeed(WhoPort, actor)) },
    features,
    ways: [dependent],
    may: Effect.succeed(May.fixed(["bookings:read"])),
    system: [],
  });
  expect(typeof invalid).toBe("function");
  expect(provided._tag).toBe("Composition");
  return provided.dispose();
});
it("composition requires the runtime and trace supplied at the root", () => {
  const invalid = () => {
    // @ts-expect-error No Runtime or StepTrace was supplied.
    return composition({
      modules: { mounts: [], layer: Layer.empty },
      features: features,
      ways: [way],
      may: Effect.succeed(May.fixed([])),
      system: [],
    });
  };
  expect(typeof invalid).toBe("function");
});
it("call has a named way and accepts no caller override", () => {
  const invalid = (admitted: Admitted) =>
    call(
      app,
      showBooking,
      { id: "b-1" },
      { headers: new Headers(), url: "/" },
      {
        way: "web",
        admitted,
        // @ts-expect-error Who is owned by the selected way.
        caller: () => Effect.succeed(actor),
      },
    );
  expect(typeof invalid).toBe("function");
});
it("an Admitted value cannot be constructed by consumers", () => {
  // @ts-expect-error The private admission brand cannot be supplied.
  const forged: Admitted = {};
  expect(forged).toEqual({});
});
it("a wording override gets only its correctly typed error, not caller context", () => {
  const overrides: WordingOverrides<BookingNotFound> = {
    BookingNotFound: (error) => `No ${error.id}.`,
  };
  const invalid: WordingOverrides<BookingNotFound> = {
    // @ts-expect-error A second required caller argument is not part of the override API.
    BookingNotFound: (_error: BookingNotFound, _caller: Actor) => "No.",
  };
  expect(typeof overrides.BookingNotFound).toBe("function");
  expect(typeof invalid.BookingNotFound).toBe("function");
});

import * as Domain from "@alchemy.run/domain";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { platformForTests } from "../from-env.ts";
import {
  Audit,
  CloseTally,
  OpenTally,
  Tallies,
  TalliesLive,
  Tally,
  TallyApi,
  TallyId,
  TallyNotOpen,
} from "./tally.ts";

const World = TalliesLive.pipe(Layer.provideMerge(platformForTests));

const watchUntil = <A, E>(stream: Stream.Stream<A, E>, done: (a: A) => boolean) =>
  stream.pipe(
    Stream.filter(done),
    Stream.runHead,
    Effect.timeout("5 seconds"),
    Effect.map(Option.getOrUndefined),
  );

describe("a Domain model on the test platform", () => {
  it("is well defined", () => expect(Domain.verify(Tallies)).toEqual([]));

  it.live("commits commands and serves a view that reached the receipt", () =>
    Effect.gen(function* () {
      const api = yield* TallyApi.clientInProcess;
      const id = TallyId.make("t-1");
      yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
      yield* api.AddToTally(id, { amount: 2 });
      const receipt = yield* api.AddToTally(id, { amount: 3 });
      expect(yield* api.TallyTotals.get(id, { atLeast: receipt })).toEqual({
        total: 5,
        adds: 2,
        closed: false,
      });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live("returns a rejection and stores nothing for it", () =>
    Effect.gen(function* () {
      const api = yield* TallyApi.clientInProcess;
      const id = TallyId.make("t-2");
      const refused = yield* api.AddToTally(id, { amount: 1 }).pipe(Effect.flip);
      expect(refused).toBeInstanceOf(TallyNotOpen);
      const tallies = yield* Tally;
      expect(yield* tallies.state(id)).toEqual({ _tag: "New" });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live("answers a repeated command id with the first receipt", () =>
    Effect.gen(function* () {
      const api = yield* TallyApi.clientInProcess;
      const id = TallyId.make("t-3");
      yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
      const first = yield* api.AddToTally(id, { amount: 4 }, { commandId: "add-once" });
      const again = yield* api.AddToTally(id, { amount: 4 }, { commandId: "add-once" });
      expect(again).toEqual(first);
      const tallies = yield* Tally;
      expect(yield* tallies.state(id)).toEqual({ _tag: "Open", total: 4 });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live("lets one writer at a time decide for an instance", () =>
    Effect.gen(function* () {
      const api = yield* TallyApi.clientInProcess;
      const id = TallyId.make("t-7");
      yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
      const receipts = yield* Effect.forEach(
        Array.from({ length: 20 }, (_, n) => n),
        () => api.AddToTally(id, { amount: 1 }),
        { concurrency: "unbounded" },
      );
      expect(new Set(receipts.map((receipt) => receipt.version)).size).toBe(20);
      const tallies = yield* Tally;
      expect(yield* tallies.state(id)).toEqual({ _tag: "Open", total: 20 });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live("runs a policy that sends a command to another aggregate", () =>
    Effect.gen(function* () {
      const api = yield* TallyApi.clientInProcess;
      const id = TallyId.make("t-4");
      yield* api.OpenTally(id, { closeAfterMillis: 60_000 });
      yield* api.AddToTally(id, { amount: 1 });
      yield* api.AddToTally(id, { amount: 1 });
      const audits = yield* Audit;
      const audit = yield* audits.state(id).pipe(
        Effect.filterOrFail((state) => state.count === 2),
        Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 100 }),
      );
      expect(audit).toEqual({ count: 2 });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live("fires a command a policy scheduled", () =>
    Effect.gen(function* () {
      const api = yield* TallyApi.clientInProcess;
      const id = TallyId.make("t-5");
      yield* api.OpenTally(id, { closeAfterMillis: 100 });
      const totals = yield* watchUntil(
        api.TallyTotals.watch(id),
        ({ state }) => state?.closed === true,
      );
      expect(totals?.state).toMatchObject({ closed: true });
    }).pipe(Effect.scoped, Effect.provide(World)),
  );

  it.live("cancels a scheduled command once, and refuses to cancel it again", () =>
    Effect.gen(function* () {
      const tallies = yield* Tally;
      const id = TallyId.make("t-6");
      yield* tallies.send(id, new OpenTally({ closeAfterMillis: 60_000 }));
      yield* tallies.schedule(id, new CloseTally(), { after: "1 hour", commandId: "close-later" });
      yield* tallies.unschedule(id, "close-later");
      const again = yield* tallies.unschedule(id, "close-later").pipe(Effect.flip);
      expect(again._tag).toBe("AlreadyCancelled");
      const never = yield* tallies.unschedule(id, "never-scheduled").pipe(Effect.flip);
      expect(never._tag).toBe("NotScheduled");
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});

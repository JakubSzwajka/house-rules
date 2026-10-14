import { expect, it } from "@effect/vitest";
import { Clock, Effect, Exit, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  Approval,
  ApprovalDenied,
  type Around,
  CallWatch,
  defineContract,
  Forbidden,
  Grant,
  implement,
} from "../index.ts";

class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {}) {}

const base = {
  description: "Greet someone by name.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: NameIsEmpty,
};

const greetHandler = ({ name }: { readonly name: string }) =>
  name === "" ? Effect.fail(new NameIsEmpty()) : Effect.succeed(`Hello, ${name}`);

const publicGreeting = implement(
  defineContract("public_greeting", { ...base, permission: "public" }),
  greetHandler,
);
const readGreeting = implement(
  defineContract("read_greeting", { ...base, permission: "greetings:read" }),
  greetHandler,
);
const approvedGreeting = implement(
  defineContract("approved_greeting", { ...base, permission: "public", needsApproval: true }),
  greetHandler,
);

type Seen = {
  readonly contractName: string;
  readonly input: unknown;
  readonly exit: Exit.Exit<unknown, unknown>;
};

const recordingWatch = (seen: Array<Seen>) =>
  Layer.succeed(CallWatch, {
    around: ((contract, input, run) =>
      Effect.onExit(run, (exit) =>
        Effect.sync(() => {
          seen.push({ contractName: contract.name, input, exit });
        }),
      )) satisfies Around,
  });

it.effect("with no CallWatch provided, a call passes through", () =>
  Effect.gen(function* defaultPassesThrough() {
    expect(yield* publicGreeting.handler({ name: "Ada" })).toBe("Hello, Ada");
    expect((yield* Effect.flip(publicGreeting.handler({ name: "" })))._tag).toBe("NameIsEmpty");
  }),
);

it.effect("a watch sees the contract and the input of a success", () =>
  Effect.gen(function* watchSeesSuccess() {
    const seen: Array<Seen> = [];
    const result = yield* publicGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(recordingWatch(seen)));

    expect(result).toBe("Hello, Ada");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.contractName).toBe("public_greeting");
    expect(seen[0]?.input).toEqual({ name: "Ada" });
    expect(seen[0]?.exit).toEqual(Exit.succeed("Hello, Ada"));
  }),
);

it.effect("a watch sees a typed failure of the handler", () =>
  Effect.gen(function* watchSeesFailure() {
    const seen: Array<Seen> = [];
    const error = yield* Effect.flip(
      publicGreeting.handler({ name: "" }).pipe(Effect.provide(recordingWatch(seen))),
    );

    expect(error._tag).toBe("NameIsEmpty");
    expect(seen[0]?.input).toEqual({ name: "" });
    expect(seen[0]?.exit).toEqual(Exit.fail(new NameIsEmpty()));
  }),
);

it.effect("a watch sees Forbidden", () =>
  Effect.gen(function* watchSeesForbidden() {
    const seen: Array<Seen> = [];
    const error = yield* Effect.flip(
      readGreeting
        .handler({ name: "Ada" })
        .pipe(Effect.provide(Layer.mergeAll(Grant.denyAll, recordingWatch(seen)))),
    );

    expect(error).toBeInstanceOf(Forbidden);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.contractName).toBe("read_greeting");
    expect(seen[0]?.input).toEqual({ name: "Ada" });
    expect(seen[0]?.exit).toEqual(
      Exit.fail(new Forbidden({ capabilityName: "read_greeting", permission: "greetings:read" })),
    );
  }),
);

it.effect("a watch sees ApprovalDenied", () =>
  Effect.gen(function* watchSeesApprovalDenied() {
    const seen: Array<Seen> = [];
    const error = yield* Effect.flip(
      approvedGreeting
        .handler({ name: "Ada" })
        .pipe(Effect.provide(Layer.mergeAll(Approval.denyAll, recordingWatch(seen)))),
    );

    expect(error).toBeInstanceOf(ApprovalDenied);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.contractName).toBe("approved_greeting");
    expect(seen[0]?.input).toEqual({ name: "Ada" });
    expect(seen[0]?.exit).toEqual(
      Exit.fail(
        new ApprovalDenied({ capabilityName: "approved_greeting", reason: "Approval is required" }),
      ),
    );
  }),
);

it.effect("a watch runs around the call, so it can measure it", () =>
  Effect.gen(function* watchMeasures() {
    const durations: Array<number> = [];
    const timed = implement(
      defineContract("slow_greeting", { ...base, permission: "public" }),
      (input) => Effect.sleep("50 millis").pipe(Effect.andThen(greetHandler(input))),
    );
    const timingWatch = Layer.succeed(CallWatch, {
      around: ((_contract, _input, run) =>
        Effect.gen(function* measure() {
          const start = yield* Clock.currentTimeMillis;
          return yield* run.pipe(
            Effect.ensuring(
              Clock.currentTimeMillis.pipe(
                Effect.map((end) => {
                  durations.push(end - start);
                }),
              ),
            ),
          );
        })) satisfies Around,
    });

    const fiber = yield* timed
      .handler({ name: "Ada" })
      .pipe(Effect.provide(timingWatch), Effect.forkChild);
    yield* TestClock.adjust("50 millis");

    expect(yield* Fiber.join(fiber)).toBe("Hello, Ada");
    expect(durations).toEqual([50]);
  }),
);

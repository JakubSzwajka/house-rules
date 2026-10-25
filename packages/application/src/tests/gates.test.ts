import { featureFixture } from "./feature-fixtures.ts";
import { expect, expectTypeOf, it } from "@effect/vitest";
import { defineOperation, errorKind, type UnitOfWork } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  Approval,
  ApprovalDenied,
  CallPermissions,
  type FeatureFailure,
  type FeatureRequirements,
  Forbidden,
  May,
} from "../index.ts";
import { bindFixture, runFixture, testActor } from "./execution-fixtures.ts";
class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {
  kind: errorKind("invalid"),
}) {}
const base = {
  description: "Greet someone by name.",
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.String,
  failure: NameIsEmpty,
};
const greet = ({ name }: { readonly name: string }) =>
  name === "" ? Effect.fail(new NameIsEmpty()) : Effect.succeed(`Hello, ${name}`);
const read = bindFixture(
  featureFixture(defineOperation("read_greeting", { ...base, permission: "greetings:read" })),
  greet,
);
const open = bindFixture(
  featureFixture(defineOperation("public_greeting", { ...base, permission: null })),
  greet,
);
const approved = bindFixture(
  featureFixture(
    defineOperation("approved_greeting", { ...base, permission: null, needsApproval: true }),
  ),
  greet,
);
const send = bindFixture(
  featureFixture(
    defineOperation("send_greeting", {
      ...base,
      permission: "greetings:send",
      needsApproval: true,
    }),
  ),
  greet,
);
it("a descriptor records its own permission and defaults approval to false", () => {
  expect(read.permission).toBe("greetings:read");
  expect(read.needsApproval).toBe(false);
  expect(send.needsApproval).toBe(true);
  expectTypeOf(read.needsApproval).toEqualTypeOf<false>();
});
it("every callable requires an explicit permission or null", () => {
  const invalid = () => {
    // @ts-expect-error Permission must be explicit on every callable.
    return defineOperation("missing", base);
  };
  expect(typeof invalid).toBe("function");
});
it("a permission must be resource:action, with null replacing the public pseudo-permission", () => {
  const invalid = () => {
    // @ts-expect-error A permission is resource:action, not an arbitrary verb.
    return defineOperation("loose", { ...base, permission: "delete" });
  };
  expect(typeof invalid).toBe("function");
});
it.effect("a null-permission feature runs without any held permission", () =>
  Effect.gen(function* () {
    expect(yield* runFixture(open, { name: "Ada" }, May.fixed([]))).toBe("Hello, Ada");
  }),
);
it("feature types always retain real closure and invocation failures", () => {
  expectTypeOf<Extract<FeatureFailure<typeof read>, Forbidden>>().toEqualTypeOf<Forbidden>();
  expectTypeOf<
    Extract<FeatureRequirements<typeof read>, CallPermissions>
  >().toEqualTypeOf<CallPermissions>();
});
it("approval flags add the lower slot and its kinded failure", () => {
  expectTypeOf<Extract<FeatureRequirements<typeof approved>, Approval>>().toEqualTypeOf<Approval>();
  expectTypeOf<
    Extract<FeatureFailure<typeof approved>, ApprovalDenied>
  >().toEqualTypeOf<ApprovalDenied>();
  expectTypeOf<Extract<FeatureFailure<typeof open>, ApprovalDenied>>().toEqualTypeOf<never>();
});
it("both gates are retained without opening a unit for a nontransactional callable", () => {
  expectTypeOf<
    Extract<FeatureRequirements<typeof send>, Approval | CallPermissions>
  >().toEqualTypeOf<Approval | CallPermissions>();
  expectTypeOf<Extract<FeatureRequirements<typeof send>, UnitOfWork>>().toEqualTypeOf<never>();
});
it("a widened approval flag conservatively requires approval", () => {
  const unsure = (needsApproval: boolean) =>
    featureFixture(defineOperation("unsure", { ...base, permission: null, needsApproval }));
  expectTypeOf<
    Extract<FeatureRequirements<ReturnType<typeof unsure>>, Approval>
  >().toEqualTypeOf<Approval>();
});
it.effect("May passes the caller whose fixed list holds the closure", () =>
  Effect.gen(function* () {
    expect(yield* runFixture(read, { name: "Ada" }, May.fixed(["greetings:read"]))).toBe(
      "Hello, Ada",
    );
  }),
);
it.effect("May.context supplies exposure, person/system lists and via independently", () =>
  Effect.gen(function* () {
    const context = May.context(May.fixed(["greetings:read"]), {
      features: [read],
      system: ["system:work"],
      via: "web",
    });
    const held = yield* CallPermissions.pipe(Effect.provideContext(context));
    expect(held.features).toEqual([read]);
    expect(
      yield* held.may.permissionsOf({ kind: "person", actor: testActor, via: held.via }),
    ).toEqual(["greetings:read"]);
    expect(held.system).toEqual(["system:work"]);
    expect(held.via).toBe("web");
  }),
);
it.effect("a complete explicit fixed list allows its feature", () =>
  Effect.gen(function* () {
    expect(
      yield* runFixture(read, { name: "Ada" }, May.fixed(["greetings:read", "greetings:send"])),
    ).toBe("Hello, Ada");
  }),
);
it.effect("a missing closure permission fails with its real permission and caller kind", () =>
  Effect.gen(function* () {
    const other = yield* Effect.flip(
      runFixture(read, { name: "Ada" }, May.fixed(["greetings:send"])),
    );
    const denied = yield* Effect.flip(runFixture(read, { name: "Ada" }, May.fixed([])));
    expect(other).toEqual(
      new Forbidden({ feature: "read_greeting", permission: "greetings:read", caller: "person" }),
    );
    expect(denied.kind).toBe("forbidden");
  }),
);
it.effect("Approval.allowAll lets the handler run", () =>
  Effect.gen(function* () {
    expect(
      yield* runFixture(approved, { name: "Ada" }).pipe(Effect.provide(Approval.allowAll)),
    ).toBe("Hello, Ada");
  }),
);
it.effect("Approval.denyAll fails with the feature name and kind", () =>
  Effect.gen(function* () {
    const error = yield* Effect.flip(
      runFixture(approved, { name: "Ada" }).pipe(Effect.provide(Approval.denyAll)),
    );
    expect(error).toEqual(
      new ApprovalDenied({ feature: "approved_greeting", reason: "Approval is required" }),
    );
  }),
);
const recorded = (calls: string[]) =>
  bindFixture(featureFixture(defineOperation("recorded_send", { ...send })), ({ name }) =>
    Effect.sync(() => {
      calls.push("handler");
      return `Sent to ${name}`;
    }),
  );
const approval = (calls: string[], allowed: boolean) =>
  Layer.succeed(Approval, {
    approve: (feature: string, input: unknown) =>
      Effect.suspend(() => {
        calls.push(`approval ${feature} ${JSON.stringify(input)}`);
        return allowed ? Effect.void : Effect.fail(new ApprovalDenied({ feature, reason: "no" }));
      }),
  });
it.effect("closure checks happen before approval and approval before the handler", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const feature = recorded(calls);
    expect(
      yield* runFixture(feature, { name: "Ada" }, May.fixed(["greetings:send"])).pipe(
        Effect.provide(approval(calls, true)),
      ),
    ).toBe("Sent to Ada");
    expect(calls).toEqual(['approval recorded_send {"name":"Ada"}', "handler"]);
  }),
);
it.effect("a refused closure never asks approval", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const feature = recorded(calls);
    const error = yield* Effect.flip(
      runFixture(feature, { name: "Ada" }, May.fixed([])).pipe(
        Effect.provide(approval(calls, true)),
      ),
    );
    expect(error._tag).toBe("Forbidden");
    expect(calls).toEqual([]);
  }),
);
it.effect("a refused approval never runs the handler", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const feature = recorded(calls);
    const error = yield* Effect.flip(
      runFixture(feature, { name: "Ada" }).pipe(Effect.provide(approval(calls, false))),
    );
    expect(error._tag).toBe("ApprovalDenied");
    expect(calls).toEqual(['approval recorded_send {"name":"Ada"}']);
  }),
);

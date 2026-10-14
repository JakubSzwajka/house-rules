import { expect, expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { Approval, ApprovalDenied, defineContract, Forbidden, Grant, implement } from "../index.ts";

class NameIsEmpty extends Schema.TaggedError<NameIsEmpty>()("NameIsEmpty", {}) {}

class Greetings extends Context.Service<
  Greetings,
  { readonly greet: (name: string) => Effect.Effect<string> }
>()("test/Greetings") {}

const GreetInput = Schema.Struct({ name: Schema.String });

const base = {
  description: "Greet someone by name.",
  input: GreetInput,
  output: Schema.String,
  failure: NameIsEmpty,
};

const greetHandler = ({ name }: { readonly name: string }) =>
  name === "" ? Effect.fail(new NameIsEmpty()) : Effect.succeed(`Hello, ${name}`);

const readGreeting = implement(
  defineContract("read_greeting", { ...base, permission: "greetings:read" }),
  greetHandler,
);

const publicGreeting = implement(
  defineContract("public_greeting", { ...base, permission: "public" }),
  greetHandler,
);

const approvedGreeting = implement(
  defineContract("approved_greeting", { ...base, permission: "public", needsApproval: true }),
  greetHandler,
);

const sendGreeting = implement(
  defineContract("send_greeting", { ...base, permission: "greetings:send", needsApproval: true }),
  greetHandler,
);

it.effect("a contract records its permission and defaults needsApproval to false", () =>
  Effect.sync(() => {
    expect(readGreeting.contract.permission).toBe("greetings:read");
    expect(readGreeting.contract.needsApproval).toBe(false);
    expect(sendGreeting.contract.needsApproval).toBe(true);
    expectTypeOf(readGreeting.contract.permission).toEqualTypeOf<"greetings:read">();
    expectTypeOf(readGreeting.contract.needsApproval).toEqualTypeOf<false>();
  }),
);

it.effect("the types reject a contract without a permission", () =>
  Effect.sync(() => {
    // @ts-expect-error permission is required on every contract
    const missing = defineContract("no_permission", base);

    expect(missing.name).toBe("no_permission");
  }),
);

it.effect("the types reject a permission that is not resource:action or public", () =>
  Effect.sync(() => {
    // @ts-expect-error a permission is a resource:action string
    const loose = defineContract("loose", { ...base, permission: "delete" });

    expect(loose.permission).toBe("delete");
  }),
);

it.effect("a public contract adds no requirement and no failure", () =>
  Effect.gen(function* publicNeedsNoGrant() {
    expectTypeOf(publicGreeting.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty>
    >();
    expect(yield* publicGreeting.handler({ name: "Ada" })).toBe("Hello, Ada");
  }),
);

it.effect("a permission adds Grant and Forbidden", () =>
  Effect.sync(() => {
    expectTypeOf(readGreeting.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty | Forbidden, Grant>
    >();
  }),
);

it.effect("needsApproval adds Approval and ApprovalDenied", () =>
  Effect.sync(() => {
    expectTypeOf(approvedGreeting.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty | ApprovalDenied, Approval>
    >();
  }),
);

it.effect("both gates add both requirements and both failures to the handler's own", () =>
  Effect.sync(() => {
    const withService = implement(sendGreeting.contract, ({ name }) =>
      Effect.gen(function* greetWithService() {
        const greetings = yield* Greetings;
        return yield* greetings.greet(name);
      }),
    );

    expectTypeOf(sendGreeting.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty | Forbidden | ApprovalDenied, Grant | Approval>
    >();
    expectTypeOf(withService.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty | Forbidden | ApprovalDenied, Greetings | Grant | Approval>
    >();
  }),
);

it.effect("a contract whose flags are only known as wide types needs both gates", () =>
  Effect.sync(() => {
    const unsureGreeting = (needsApproval: boolean) =>
      implement(
        defineContract("unsure", { ...base, permission: "greetings:read", needsApproval }),
        greetHandler,
      );
    const unsure = unsureGreeting(false);

    expectTypeOf(unsure.handler).returns.toEqualTypeOf<
      Effect.Effect<string, NameIsEmpty | Forbidden | ApprovalDenied, Grant | Approval>
    >();
  }),
);

it.effect("Grant passes a caller who holds the permission", () =>
  Effect.gen(function* grantPasses() {
    const result = yield* readGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provide(Grant.layerFromPermissions(["greetings:read"])));

    expect(result).toBe("Hello, Ada");
  }),
);

it.effect("Grant.fromPermissions is a value for Effect.provideService", () =>
  Effect.gen(function* grantValue() {
    const result = yield* readGreeting
      .handler({ name: "Ada" })
      .pipe(Effect.provideService(Grant, Grant.fromPermissions(["greetings:read"])));

    expect(result).toBe("Hello, Ada");
  }),
);

it.effect("Grant.allowAll passes every permission", () =>
  Effect.gen(function* grantAllowAll() {
    expect(yield* readGreeting.handler({ name: "Ada" }).pipe(Effect.provide(Grant.allowAll))).toBe(
      "Hello, Ada",
    );
  }),
);

it.effect("Grant fails with Forbidden when the caller lacks the permission", () =>
  Effect.gen(function* grantForbids() {
    const other = yield* Effect.flip(
      readGreeting
        .handler({ name: "Ada" })
        .pipe(Effect.provide(Grant.layerFromPermissions(["greetings:send"]))),
    );
    const denied = yield* Effect.flip(
      readGreeting.handler({ name: "Ada" }).pipe(Effect.provide(Grant.denyAll)),
    );

    expect(other).toEqual(
      new Forbidden({ capabilityName: "read_greeting", permission: "greetings:read" }),
    );
    expect(denied._tag).toBe("Forbidden");
  }),
);

it.effect("Approval.allowAll lets the handler run", () =>
  Effect.gen(function* approvalAllows() {
    expect(
      yield* approvedGreeting.handler({ name: "Ada" }).pipe(Effect.provide(Approval.allowAll)),
    ).toBe("Hello, Ada");
  }),
);

it.effect("Approval.denyAll fails with ApprovalDenied", () =>
  Effect.gen(function* approvalDenies() {
    const error = yield* Effect.flip(
      approvedGreeting.handler({ name: "Ada" }).pipe(Effect.provide(Approval.denyAll)),
    );

    expect(error).toEqual(
      new ApprovalDenied({ capabilityName: "approved_greeting", reason: "Approval is required" }),
    );
  }),
);

const recordingGates = (calls: Array<string>, grantHolds: boolean, approvalPasses: boolean) =>
  Layer.mergeAll(
    Layer.succeed(Grant, {
      holds: (permission) =>
        Effect.sync(() => {
          calls.push(`grant ${permission}`);
          return grantHolds;
        }),
    }),
    Layer.succeed(Approval, {
      approve: (capabilityName, input) =>
        Effect.suspend(() => {
          calls.push(`approval ${capabilityName} ${JSON.stringify(input)}`);
          return approvalPasses
            ? Effect.void
            : Effect.fail(new ApprovalDenied({ capabilityName, reason: "no" }));
        }),
    }),
  );

const recordedSend = (calls: Array<string>) =>
  implement(sendGreeting.contract, ({ name }) =>
    Effect.sync(() => {
      calls.push("handler");
      return `Sent to ${name}`;
    }),
  );

it.effect("runs Grant, then Approval, then the handler", () =>
  Effect.gen(function* runsInOrder() {
    const calls: Array<string> = [];
    const result = yield* recordedSend(calls)
      .handler({ name: "Ada" })
      .pipe(Effect.provide(recordingGates(calls, true, true)));

    expect(result).toBe("Sent to Ada");
    expect(calls).toEqual([
      "grant greetings:send",
      'approval send_greeting {"name":"Ada"}',
      "handler",
    ]);
  }),
);

it.effect("a refused Grant never asks for approval", () =>
  Effect.gen(function* grantBeforeApproval() {
    const calls: Array<string> = [];
    const error = yield* Effect.flip(
      recordedSend(calls)
        .handler({ name: "Ada" })
        .pipe(Effect.provide(recordingGates(calls, false, true))),
    );

    expect(error._tag).toBe("Forbidden");
    expect(calls).toEqual(["grant greetings:send"]);
  }),
);

it.effect("a denied Approval never runs the handler", () =>
  Effect.gen(function* approvalBeforeHandler() {
    const calls: Array<string> = [];
    const error = yield* Effect.flip(
      recordedSend(calls)
        .handler({ name: "Ada" })
        .pipe(Effect.provide(recordingGates(calls, true, false))),
    );

    expect(error._tag).toBe("ApprovalDenied");
    expect(calls).toEqual(["grant greetings:send", 'approval send_greeting {"name":"Ada"}']);
  }),
);

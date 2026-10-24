import { expect, expectTypeOf, it } from "@effect/vitest";
import { CurrentActor, May, Runtime, runFeature, StepTrace } from "@house-rules/application";
import { defineFeature } from "@house-rules/application/contract";
import { Actor, ActorId } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import {
  EmailOperations,
  EmailPermissions,
  EmailRejected,
  EmailSendFailed,
  EmailCallerDenied,
} from "../contract.ts";
import {
  bindEmail,
  Email,
  EmailMount,
  EmailSender,
  MemoryEmailOutboxTesting,
  memoryEmail,
} from "../index.ts";

expectTypeOf<Parameters<typeof bindEmail>[0]>().toEqualTypeOf<Email["Service"]>();

const send = EmailOperations.send;
const person = defineFeature("test_personEmail", {
  ...send,
  permission: null,
  flags: { transactional: false },
  edges: [send],
  handler: (input, { call }) => call(send, input),
});
const system = defineFeature("test_systemEmail", {
  ...send,
  permission: null,
  flags: { transactional: false },
  edges: [send],
  start: { kind: "system", reason: "test delivery", startedBy: "hook:test" },
  handler: (input, { call }) => call(send, input),
});
const features = [person, system];
const permissions = [EmailPermissions.send];
const systemCaller = Layer.succeedContext(
  May.system(features, { system: permissions, via: "test" }),
);
const personCaller = Layer.merge(
  Layer.succeed(CurrentActor, Actor.make({ id: ActorId.make("owner") })),
  Layer.succeedContext(
    May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
  ),
);
const runtime = Runtime.layer({ mounts: [EmailMount], features, ways: [] }).pipe(
  Layer.provideMerge(StepTrace.layer()),
);
const world = runtime.pipe(
  Layer.provideMerge(
    Email.layer.pipe(Layer.provideMerge(memoryEmail({ defaultFrom: "noreply@example.test" }))),
  ),
);
const message = { to: "person@example.test", subject: "Hello", text: "Message body" };

it.effect("EmailMount sends as system and passes the idempotency key through retries", () =>
  Effect.gen(function* () {
    expect(EmailMount.service).toBe(Email);
    expect(EmailMount.bind).toBe(bindEmail);
    expect(EmailMount.operations).toEqual(Object.values(EmailOperations));
    expect((yield* Runtime).permissions).toEqual(["email:send"]);
    expect(system.transactional).toBe(false);
    const outbox = yield* MemoryEmailOutboxTesting;
    expect(yield* runFeature(system, { message, idempotencyKey: "delivery-1" })).toEqual({});
    yield* runFeature(system, {
      message: { ...message, subject: "Changed", text: "Changed body" },
      idempotencyKey: "delivery-1",
    });
    yield* runFeature(system, { message, idempotencyKey: "delivery-2" });
    expect(yield* outbox.messages).toEqual([
      { ...message, from: "noreply@example.test", idempotencyKey: "delivery-1" },
      { ...message, from: "noreply@example.test", idempotencyKey: "delivery-2" },
    ]);
  }).pipe(Effect.provide(Layer.merge(systemCaller, world))),
);

it.effect("refuses a person even with email:send without calling the sender", () =>
  Effect.gen(function* () {
    const error = yield* runFeature(person, { message, idempotencyKey: "person-1" }).pipe(
      Effect.flip,
    );
    expect(error).toBeInstanceOf(EmailCallerDenied);
    expect(error._tag).toBe("EmailCallerDenied");
    expect(error.kind).toBe("forbidden");
    expect(yield* Schema.decodeUnknownEffect(send.failure)(error)).toEqual(error);
    expect(yield* (yield* MemoryEmailOutboxTesting).messages).toEqual([]);
  }).pipe(Effect.provide(Layer.merge(personCaller, world))),
);

it.effect("returns adapter validation errors through the operation", () =>
  Effect.gen(function* () {
    const error = yield* runFeature(system, {
      message: { ...message, from: " " },
      idempotencyKey: "invalid-1",
    }).pipe(Effect.flip);
    expect(error).toBeInstanceOf(EmailRejected);
    expect(yield* (yield* MemoryEmailOutboxTesting).messages).toEqual([]);
  }).pipe(Effect.provide(Layer.merge(systemCaller, world))),
);

it.effect("preserves provider ids and fixed unavailable failures with internal causes", () => {
  const cause = { diagnostic: "private provider detail" };
  const failure = new EmailSendFailed({ message: "Email sending is unavailable.", cause });
  const provider = Layer.succeed(EmailSender, {
    send: (email) =>
      email.idempotencyKey === "failed"
        ? Effect.fail(failure)
        : Effect.succeed({ providerId: "provider-1" }),
  });
  return Effect.gen(function* () {
    expect(yield* runFeature(system, { message, idempotencyKey: "success" })).toEqual({
      providerId: "provider-1",
    });
    const error = yield* runFeature(system, { message, idempotencyKey: "failed" }).pipe(
      Effect.flip,
    );
    expect(error).toBe(failure);
    expect(error.message).toBe("Email sending is unavailable.");
    expect(failure.cause).toBe(cause);
  }).pipe(
    Effect.provide(
      Layer.merge(
        systemCaller,
        runtime.pipe(Layer.provide(Email.layer.pipe(Layer.provide(provider)))),
      ),
    ),
  );
});

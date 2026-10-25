import { expect, it } from "@effect/vitest";
import { Effect, Logger } from "effect";
import {
  consolePushSender,
  memoryPushSender,
  MemoryPushOutbox,
  PushSender,
  PushSendFailed,
  type PushSubscription,
} from "../../index.js";

const subscription = (name: string): PushSubscription => ({
  endpoint: `https://push.example/${name}`,
  owner: { kind: "person", id: "owner" },
  keys: { p256dh: "private-p256dh", auth: "private-auth" },
  createdAt: 42,
});
it.effect("memory sender records every attempt with endpoint-specific sent/gone/fail results", () =>
  Effect.gen(function* () {
    const sender = yield* PushSender;
    const outbox = yield* MemoryPushOutbox;
    const payload = { body: "private body" };
    const options = { ttl: 60, idempotencyKey: "delivery-1" };
    expect(yield* outbox.sends).toEqual([]);
    expect(yield* sender.send(subscription("sent"), payload, options)).toBe("sent");
    expect(yield* sender.send(subscription("gone"), payload, options)).toBe("gone");
    expect(yield* Effect.flip(sender.send(subscription("fail"), payload, options))).toBeInstanceOf(
      PushSendFailed,
    );
    expect(yield* sender.send(subscription("default"), payload, { ttl: 1 })).toBe("sent");
    expect(yield* outbox.sends).toEqual([
      { subscription: subscription("sent"), payload, options, result: "sent" },
      { subscription: subscription("gone"), payload, options, result: "gone" },
      { subscription: subscription("fail"), payload, options, result: "fail" },
      { subscription: subscription("default"), payload, options: { ttl: 1 }, result: "sent" },
    ]);
  }).pipe(
    Effect.provide(
      memoryPushSender({
        results: {
          "https://push.example/sent": "sent",
          "https://push.example/gone": "gone",
          "https://push.example/fail": "fail",
        },
      }),
    ),
  ),
);
it.effect("memory sender's default result is configurable and outboxes are layer-local", () =>
  Effect.gen(function* () {
    const sender = yield* PushSender;
    const outbox = yield* MemoryPushOutbox;
    expect(yield* outbox.sends).toEqual([]);
    expect(yield* sender.send(subscription("default"), null, { ttl: 1 })).toBe("gone");
    expect((yield* outbox.sends).map((send) => send.result)).toEqual(["gone"]);
  }).pipe(Effect.provide(memoryPushSender({ result: "gone" }))),
);
it.effect("console sender returns sent and logs metadata without keys or payload body", () =>
  Effect.gen(function* () {
    const messages: unknown[] = [];
    const logger = Logger.make<unknown, void>((entry) => {
      messages.push(entry.message);
    });
    const sender = yield* PushSender;
    expect(
      yield* sender
        .send(subscription("console"), { body: "private-payload-body" }, { ttl: 60 })
        .pipe(Effect.provide(Logger.layer([logger]))),
    ).toBe("sent");
    expect(messages).toHaveLength(1);
    const logged = JSON.stringify(messages);
    expect(logged).toContain("Push delivery");
    expect(logged).toContain(subscription("console").endpoint);
    for (const secret of [
      "private-p256dh",
      "private-auth",
      "private-payload-body",
      "p256dh",
      "payload",
    ])
      expect(logged).not.toContain(secret);
  }).pipe(Effect.provide(consolePushSender)),
);

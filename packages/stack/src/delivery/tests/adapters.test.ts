import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  consoleEmail,
  consolePush,
  Email,
  memoryEmail,
  memoryPush,
  Push,
  PushGone,
  PushSendFailed,
  SentEmails,
  SentPushes,
} from "../index.ts";

const message = {
  to: "ann@example.test",
  subject: "Hello",
  text: "World",
  idempotencyKey: "n-1:email",
};
const subscription = {
  endpoint: "https://push.example.test/ann",
  keys: { p256dh: "p256dh", auth: "auth" },
};
const push = { subscription, payload: { title: "Hello" }, ttl: 60, idempotencyKey: "n-1:push" };

describe("Email adapters", () => {
  for (const [name, layer] of [
    ["memory", memoryEmail("noreply@example.test")],
    ["console", consoleEmail],
  ] as const) {
    it.effect(`${name} accepts a message`, () =>
      Effect.gen(function* () {
        const email = yield* Email;
        expect(yield* email.send(message)).toEqual({ providerId: null });
      }).pipe(Effect.provide(layer)),
    );

    it.effect(`${name} refuses a header injection before it reaches the vendor`, () =>
      Effect.gen(function* () {
        const email = yield* Email;
        const exit = yield* email.send({ ...message, subject: "Hi\r\nBcc: x@y" }).pipe(Effect.exit);
        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(layer)),
    );
  }

  it.effect("memory records each message once, with the default sender", () =>
    Effect.gen(function* () {
      const email = yield* Email;
      yield* email.send(message);
      yield* email.send({ ...message, subject: "Again" });
      expect(yield* (yield* SentEmails).all).toEqual([
        { from: "noreply@example.test", ...message },
      ]);
    }).pipe(Effect.provide(memoryEmail("noreply@example.test"))),
  );
});

describe("Push adapters", () => {
  it.effect("memory records accepted sends and refuses as configured", () =>
    Effect.gen(function* () {
      const sender = yield* Push;
      yield* sender.send(push);
      const gone = { ...subscription, endpoint: "https://push.example.test/gone" };
      const down = { ...subscription, endpoint: "https://push.example.test/down" };
      expect(yield* sender.send({ ...push, subscription: gone }).pipe(Effect.flip)).toEqual(
        new PushGone(),
      );
      expect(yield* sender.send({ ...push, subscription: down }).pipe(Effect.flip)).toEqual(
        new PushSendFailed(),
      );
      expect(yield* (yield* SentPushes).all).toEqual([push]);
    }).pipe(
      Effect.provide(
        memoryPush({
          "https://push.example.test/gone": "gone",
          "https://push.example.test/down": "failed",
        }),
      ),
    ),
  );

  it.effect("refuses a plain-http endpoint before it reaches the vendor", () =>
    Effect.gen(function* () {
      const exit = yield* (yield* Push)
        .send({ ...push, subscription: { ...subscription, endpoint: "http://insecure.test" } })
        .pipe(Effect.exit);
      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.provide(consolePush)),
  );
});

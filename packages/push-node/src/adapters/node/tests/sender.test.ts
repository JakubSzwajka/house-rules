import { expect, it } from "@effect/vitest";
import { PushSender, PushSendFailed } from "@house-rules/push";
import { Effect, Schema } from "effect";
import { vi } from "vitest";
import webPush from "web-push";
import { makeWebPushSender } from "../sender.js";

const config = () => ({ subject: "mailto:test@example.invalid", ...webPush.generateVAPIDKeys() });
const subscription = {
  endpoint: "https://example.invalid/push",
  owner: { kind: "person", id: "person-a" },
  keys: { p256dh: "receiver-key", auth: "receiver-secret" },
  createdAt: 0,
};
const send = Effect.gen(function* () {
  const sender = yield* PushSender;
  return yield* sender.send(
    subscription,
    { body: "private body" },
    { ttl: 60, idempotencyKey: "retry" },
  );
});

it.effect.each([404, 410])("maps only provider %i to gone", (statusCode) =>
  Effect.gen(function* () {
    const sdk = vi.fn<typeof webPush.sendNotification>().mockRejectedValue({ statusCode });
    expect(yield* send.pipe(Effect.provide(makeWebPushSender(config(), sdk)))).toBe("gone");
  }),
);

it.effect.each([400, 401, 403, 408, 429, 500, 503, "404", undefined])(
  "keeps status %s as typed failure",
  (statusCode) =>
    Effect.gen(function* () {
      const cause = { statusCode, body: "private provider details" };
      const sdk = vi.fn<typeof webPush.sendNotification>().mockRejectedValue(cause);
      const error = yield* Effect.flip(send.pipe(Effect.provide(makeWebPushSender(config(), sdk))));
      expect(Schema.is(PushSendFailed)(error)).toBe(true);
      expect(error.cause === cause).toBe(true);
      expect(error.kind).toBe("unavailable");
      expect(error.message).toBe("Push delivery is unavailable. Try again shortly.");
    }),
);

it.effect.each(["reject", "throw", "timeout"] as const)(
  "catches SDK/network %s without logging secrets",
  (mode) =>
    Effect.gen(function* () {
      const cause = new Error(mode === "timeout" ? "Socket timeout" : "private provider failure");
      const methods = ["log", "warn", "error", "info", "debug"] as const;
      const logs = methods.map((method) => vi.spyOn(console, method));
      try {
        const sdk = vi.fn<typeof webPush.sendNotification>();
        if (mode === "throw")
          sdk.mockImplementation(() => {
            throw cause;
          });
        else sdk.mockRejectedValue(cause);
        const error = yield* Effect.flip(
          send.pipe(Effect.provide(makeWebPushSender(config(), sdk))),
        );
        expect(Schema.is(PushSendFailed)(error)).toBe(true);
        expect(error.cause === cause).toBe(true);
        expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
      } finally {
        logs.forEach((log) => log.mockRestore());
      }
    }),
);

it.effect.each([0, -1, 1.5, Number.NaN, Infinity, 2147483648])(
  "fails closed for invalid timeout %s",
  (timeoutMs) =>
    Effect.gen(function* () {
      const sdk = vi.fn<typeof webPush.sendNotification>();
      const error = yield* Effect.flip(
        send.pipe(Effect.provide(makeWebPushSender({ ...config(), timeoutMs }, sdk))),
      );
      expect(Schema.is(PushSendFailed)(error)).toBe(true);
      expect(sdk.mock.calls.length).toBe(0);
    }),
);

it.effect.each([
  { subject: "" },
  { subject: "http://example.invalid" },
  { subject: "invalid" },
  { publicKey: "" },
  { publicKey: "invalid" },
  { privateKey: "" },
  { privateKey: "invalid" },
])("fails closed for malformed VAPID config %#", (invalid) =>
  Effect.gen(function* () {
    const sdk = vi.fn<typeof webPush.sendNotification>();
    const error = yield* Effect.flip(
      send.pipe(Effect.provide(makeWebPushSender({ ...config(), ...invalid }, sdk))),
    );
    expect(Schema.is(PushSendFailed)(error)).toBe(true);
    expect(sdk.mock.calls.length).toBe(0);
  }),
);

it.effect.each([-1, 1.5, Number.NaN, Infinity])(
  "rejects invalid provider TTL %s rather than changing it",
  (ttl) =>
    Effect.gen(function* () {
      const sdk = vi.fn<typeof webPush.sendNotification>();
      const error = yield* Effect.flip(
        Effect.gen(function* () {
          const sender = yield* PushSender;
          return yield* sender.send(subscription, {}, { ttl });
        }).pipe(Effect.provide(makeWebPushSender(config(), sdk))),
      );
      expect(Schema.is(PushSendFailed)(error)).toBe(true);
      expect(sdk.mock.calls.length).toBe(0);
    }),
);

it.effect("rejects non-JSON payloads and serialization throws without sending", () =>
  Effect.gen(function* () {
    const sdk = vi.fn<typeof webPush.sendNotification>();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const execute = Effect.gen(function* () {
      const sender = yield* PushSender;
      for (const body of [undefined, () => 1, 1n, circular]) {
        const error = yield* Effect.flip(sender.send(subscription, body, { ttl: 60 }));
        expect(Schema.is(PushSendFailed)(error)).toBe(true);
      }
    });
    yield* execute.pipe(Effect.provide(makeWebPushSender(config(), sdk)));
    expect(sdk.mock.calls.length).toBe(0);
  }),
);

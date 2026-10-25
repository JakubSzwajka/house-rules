import { expect, it } from "@effect/vitest";
import { PushSender } from "@house-rules/push";
import { Effect, Schema } from "effect";
import { vi } from "vitest";
import webPush from "web-push";
import { makeWebPushSender } from "../sender.js";

it.effect(
  "maps options and encodes once; the real SDK builds encrypted requests without transport",
  () =>
    Effect.gen(function* () {
      const options = { subject: "mailto:test@example.invalid", ...webPush.generateVAPIDKeys() };
      const subscription = {
        endpoint: "https://example.invalid/push",
        owner: { kind: "person", id: "person-a" },
        keys: {
          p256dh: webPush.generateVAPIDKeys().publicKey,
          auth: Buffer.alloc(16, 7).toString("base64url"),
        },
        createdAt: 0,
      };
      const payload = { body: "Private notification" };
      let encoded = 0;
      const body = {
        toJSON: () => {
          encoded++;
          return payload;
        },
      };
      const sdk = vi
        .fn<typeof webPush.sendNotification>()
        .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
      const execute = Effect.gen(function* () {
        const sender = yield* PushSender;
        expect(yield* sender.send(subscription, body, { ttl: 321, idempotencyKey: "retry" })).toBe(
          "sent",
        );
        expect(yield* sender.send(subscription, null, { ttl: 0, idempotencyKey: "retry" })).toBe(
          "sent",
        );
      });
      yield* execute.pipe(Effect.provide(makeWebPushSender(options, sdk)));
      expect(encoded).toBe(1);
      expect(sdk.mock.calls.length).toBe(2);
      const call = sdk.mock.calls[0];
      expect(call?.[0].endpoint).toBe(subscription.endpoint);
      expect(call?.[0].keys.p256dh === subscription.keys.p256dh).toBe(true);
      expect(call?.[0].keys.auth === subscription.keys.auth).toBe(true);
      expect(call?.[1] === JSON.stringify(payload)).toBe(true);
      expect(call?.[2]?.TTL).toBe(321);
      expect(call?.[2]?.timeout).toBe(10000);
      expect(call?.[2]?.contentEncoding).toBe("aes128gcm");
      expect(call?.[2]?.vapidDetails?.subject === options.subject).toBe(true);
      expect(call?.[2]?.vapidDetails?.publicKey === options.publicKey).toBe(true);
      expect(call?.[2]?.vapidDetails?.privateKey === options.privateKey).toBe(true);
      expect(Object.keys(call?.[2] ?? {}).sort()).toEqual([
        "TTL",
        "contentEncoding",
        "timeout",
        "vapidDetails",
      ]);
      expect(sdk.mock.calls[1]?.[2]?.TTL).toBe(0);
      expect(sdk.mock.calls[1]?.[1] === "null").toBe(true);
      if (!call) return;
      const request = webPush.generateRequestDetails(call[0], call[1] as string, call[2]);
      expect(request.headers.TTL).toBe(321);
      expect(Schema.is(Schema.Struct({ timeout: Schema.Literal(10000) }))(request)).toBe(true);
      expect(request.headers["Content-Encoding"]).toBe("aes128gcm");
      expect(request.headers.Authorization?.includes(options.publicKey)).toBe(true);
      expect(Buffer.isBuffer(request.body) && !request.body.includes(payload.body)).toBe(true);
    }),
);

it.effect(
  "isolates concurrent layers, snapshots caller config and signs with the matching per-call keys",
  () =>
    Effect.gen(function* () {
      const first = {
        subject: "mailto:first@example.invalid",
        ...webPush.generateVAPIDKeys(),
        timeoutMs: 1234,
      };
      const second = {
        subject: "https://example.invalid/contact",
        ...webPush.generateVAPIDKeys(),
        timeoutMs: 5678,
      };
      const original = first.privateKey;
      const sdk = vi
        .fn<typeof webPush.sendNotification>()
        .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
      const layer = makeWebPushSender(first, sdk);
      first.privateKey = second.privateKey;
      const subscription = {
        endpoint: "https://example.invalid/push",
        owner: { kind: "person", id: "person-a" },
        keys: {
          p256dh: webPush.generateVAPIDKeys().publicKey,
          auth: Buffer.alloc(16, 7).toString("base64url"),
        },
        createdAt: 0,
      };
      const execute = Effect.gen(function* () {
        const sender = yield* PushSender;
        return yield* sender.send(subscription, {}, { ttl: 77 });
      });
      expect(
        yield* Effect.all(
          [
            execute.pipe(Effect.provide(layer)),
            execute.pipe(Effect.provide(makeWebPushSender(second, sdk))),
          ],
          { concurrency: "unbounded" },
        ),
      ).toEqual(["sent", "sent"]);
      const calls = sdk.mock.calls;
      expect(
        calls.some(
          (call) => call[2]?.vapidDetails?.privateKey === original && call[2]?.timeout === 1234,
        ),
      ).toBe(true);
      expect(
        calls.some(
          (call) =>
            call[2]?.vapidDetails?.privateKey === second.privateKey && call[2]?.timeout === 5678,
        ),
      ).toBe(true);
      for (const call of calls) {
        const request = webPush.generateRequestDetails(call[0], call[1] as string, call[2]);
        expect(
          request.headers.Authorization?.includes(call[2]?.vapidDetails?.publicKey ?? "missing"),
        ).toBe(true);
        const wrong =
          call[2]?.vapidDetails?.privateKey === original ? second.publicKey : first.publicKey;
        expect(request.headers.Authorization?.includes(wrong)).toBe(false);
      }
    }),
);

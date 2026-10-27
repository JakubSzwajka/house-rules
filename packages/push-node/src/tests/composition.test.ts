import { expect, expectTypeOf, it } from "@effect/vitest";
import { Actor, ActorId, memoryUnitOfWork, UnitOfWork } from "@house-rules/domain";
import { Push, PushSender } from "@house-rules/push";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, vi } from "vitest";
import webPush from "web-push";
import { webPushSender } from "../index.js";

expectTypeOf<ReturnType<typeof webPushSender>>().toEqualTypeOf<Layer.Layer<PushSender>>();
expectTypeOf<Parameters<typeof Push.layerPostgres>[1]>().toEqualTypeOf<
  ReturnType<typeof webPushSender>
>();

beforeEach(() => {
  vi.spyOn(webPush, "sendNotification").mockResolvedValue({
    statusCode: 201,
    body: "",
    headers: {},
  });
  vi.spyOn(webPush, "setVapidDetails").mockImplementation(() => {
    throw new Error("Global VAPID forbidden");
  });
  vi.spyOn(webPush, "setGCMAPIKey").mockImplementation(() => {
    throw new Error("Global GCM forbidden");
  });
});
afterEach(() => vi.restoreAllMocks());

it.effect("composes the public factory with Push and pulls out without changing core", () =>
  Effect.gen(function* () {
    const options = { subject: "mailto:test@example.invalid", ...webPush.generateVAPIDKeys() };
    const sender = webPushSender(options);
    expect(vi.mocked(webPush.sendNotification).mock.calls.length).toBe(0);
    const actor = Actor.make({ id: ActorId.make("person-a") });
    const input = {
      endpoint: "https://example.invalid/push",
      keys: { p256dh: "key", auth: "secret" },
    };
    const execute = Effect.gen(function* () {
      const push = yield* Push;
      yield* UnitOfWork.atomic(push.subscribe(actor, input));
      return yield* UnitOfWork.atomic(
        push.deliver({ kind: "person", id: actor.id }, { body: "Private" }, "retry"),
      );
    });
    const world = Push.layerMemory({}, sender).pipe(Layer.provideMerge(memoryUnitOfWork));
    expect(yield* execute.pipe(Effect.provide(world))).toEqual({ sent: 1, expired: 0, events: [] });
    expect(vi.mocked(webPush.sendNotification).mock.calls.length).toBe(1);
    expect(
      yield* execute.pipe(
        Effect.provide(Push.layerMemory().pipe(Layer.provideMerge(memoryUnitOfWork))),
      ),
    ).toEqual({ sent: 1, expired: 0, events: [] });
    expect(vi.mocked(webPush.sendNotification).mock.calls.length).toBe(1);
    expect(webPush.setVapidDetails).not.toHaveBeenCalled();
    expect(webPush.setGCMAPIKey).not.toHaveBeenCalled();
  }),
);

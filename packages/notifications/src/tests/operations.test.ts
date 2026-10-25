import { expect, expectTypeOf, it } from "@effect/vitest";
import {
  CurrentActor,
  defineFeature,
  May,
  Runtime,
  runFeature,
  StepTrace,
} from "@house-rules/application";
import { Actor, ActorId, memoryUnitOfWork } from "@house-rules/domain";
import { Effect, Layer } from "effect";
import {
  bindNotifications,
  NotificationForbidden,
  NotificationPermissions,
  Notifications,
  NotificationsMount,
  NotificationsOperations as operations,
} from "../index.js";
expectTypeOf<Parameters<typeof bindNotifications>[0]>().toEqualTypeOf<Notifications["Service"]>();
const notify = defineFeature("test_notify", {
  ...operations.notify,
  permission: null,
  edges: [operations.notify],
  start: { kind: "system", reason: "Notify test recipients", startedBy: "hook:test" },
  handler: (input, { call }) => call(operations.notify, input),
});
const personNotify = defineFeature("test_personNotify", {
  ...operations.notify,
  permission: null,
  edges: [operations.notify],
  handler: (input, { call }) => call(operations.notify, input),
});
const list = defineFeature("test_listMine", {
  ...operations.listMine,
  permission: null,
  edges: [operations.listMine],
  handler: (input, { call }) => call(operations.listMine, input),
});
const systemList = defineFeature("test_systemListMine", {
  ...operations.listMine,
  permission: null,
  edges: [operations.listMine],
  start: { kind: "system", reason: "Check person guard", startedBy: "hook:test" },
  handler: (input, { call }) => call(operations.listMine, input),
});
const due = defineFeature("test_dueDeliveries", {
  ...operations.dueDeliveries,
  permission: null,
  edges: [operations.dueDeliveries],
  start: { kind: "system", reason: "Select delivery work", startedBy: "schedule:test" },
  handler: (input, { call }) => call(operations.dueDeliveries, input),
});
const personDue = defineFeature("test_personDueDeliveries", {
  ...operations.dueDeliveries,
  permission: null,
  edges: [operations.dueDeliveries],
  handler: (input, { call }) => call(operations.dueDeliveries, input),
});
const markSent = defineFeature("test_markSent", {
  ...operations.markSent,
  permission: null,
  edges: [operations.markSent],
  start: { kind: "system", reason: "Settle delivery work", startedBy: "schedule:test" },
  handler: (input, { call }) => call(operations.markSent, input),
});
const setZone = defineFeature("test_setMyTimeZone", {
  ...operations.setMyTimeZone,
  permission: null,
  edges: [operations.setMyTimeZone],
  handler: (input, { call }) => call(operations.setMyTimeZone, input),
});
const systemSetZone = defineFeature("test_systemSetMyTimeZone", {
  ...operations.setMyTimeZone,
  permission: null,
  edges: [operations.setMyTimeZone],
  start: { kind: "system", reason: "Check person guard", startedBy: "hook:test" },
  handler: (input, { call }) => call(operations.setMyTimeZone, input),
});
const preferences = defineFeature("test_preferences", {
  ...operations.getMyPreferences,
  permission: null,
  edges: [operations.getMyPreferences],
  handler: (input, { call }) => call(operations.getMyPreferences, input),
});
const features = [
  notify,
  personNotify,
  list,
  systemList,
  due,
  personDue,
  markSent,
  setZone,
  systemSetZone,
  preferences,
];
const permissions = Object.values(NotificationPermissions);
const world = Runtime.layer({ mounts: [NotificationsMount], features, ways: [] }).pipe(
  Layer.provideMerge(
    Notifications.layerMemory({
      ...Notifications.presets.default,
      recipientKind: "person",
      categories: [{ name: "news", defaultChannels: ["email"], mandatory: false }],
    }),
  ),
  Layer.provideMerge(memoryUnitOfWork),
  Layer.provideMerge(StepTrace.layer()),
);
const caller = (id: string) =>
  Layer.merge(
    Layer.succeed(CurrentActor, Actor.make({ id: ActorId.make(id) })),
    Layer.succeedContext(
      May.context(May.fixed(permissions), { features, system: permissions, via: "test" }),
    ),
  );
const input = {
  recipients: [{ kind: "person", id: "owner" }],
  category: "news",
  title: "Title",
  body: "Text",
  data: null,
};
it.layer(world)("Notifications operations", (test) => {
  test.effect(
    "mounts every binding and runs system creation, person reads and delivery settlement",
    () =>
      Effect.gen(function* () {
        expect(NotificationsMount.service).toBe(Notifications);
        expect(NotificationsMount.bind).toBe(bindNotifications);
        expect(NotificationsMount.operations).toEqual(Object.values(operations));
        const result = yield* runFeature(notify, input).pipe(Effect.provide(caller("owner")));
        expect(result.events[0]?.kind).toBe("NotificationCreated");
        expect(
          (yield* runFeature(list, {}).pipe(Effect.provide(caller("owner")))).notifications,
        ).toHaveLength(1);
        expect(
          (yield* runFeature(list, {}).pipe(Effect.provide(caller("other")))).notifications,
        ).toEqual([]);
        const groups = yield* runFeature(due, {}).pipe(Effect.provide(caller("owner")));
        expect(groups).toHaveLength(1);
        const deliveryIds = groups.flatMap((group) =>
          group.deliveries.map((row) => row.delivery.id),
        );
        yield* runFeature(markSent, { deliveryIds }).pipe(Effect.provide(caller("owner")));
        yield* runFeature(markSent, { deliveryIds }).pipe(Effect.provide(caller("owner")));
        expect(yield* runFeature(due, {}).pipe(Effect.provide(caller("owner")))).toEqual([]);
      }),
  );
  test.effect("sets only the explicit person's zone through a transactional write operation", () =>
    Effect.gen(function* () {
      expect(operations.setMyTimeZone.permission).toBe(NotificationPermissions.write);
      expect(operations.setMyTimeZone.transactional).toBe(true);
      yield* runFeature(setZone, { timeZone: "Asia/Kolkata" }).pipe(
        Effect.provide(caller("zone-owner")),
      );
      expect(
        (yield* runFeature(preferences, {}).pipe(Effect.provide(caller("zone-owner")))).timeZone,
      ).toBe("Asia/Kolkata");
      expect(
        (yield* runFeature(preferences, {}).pipe(Effect.provide(caller("other")))).timeZone,
      ).toBeNull();
      expect(
        yield* Effect.flip(
          runFeature(systemSetZone, { timeZone: "UTC" }).pipe(Effect.provide(caller("zone-owner"))),
        ),
      ).toBeInstanceOf(NotificationForbidden);
    }),
  );
  test.effect("refuses person calls to system operations and system calls to mine", () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.flip(runFeature(personNotify, input).pipe(Effect.provide(caller("owner")))),
      ).toBeInstanceOf(NotificationForbidden);
      expect(
        yield* Effect.flip(runFeature(personDue, {}).pipe(Effect.provide(caller("owner")))),
      ).toBeInstanceOf(NotificationForbidden);
      expect(
        yield* Effect.flip(runFeature(systemList, {}).pipe(Effect.provide(caller("owner")))),
      ).toBeInstanceOf(NotificationForbidden);
    }),
  );
});

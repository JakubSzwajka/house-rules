import { platformForTests } from "@house-rules/domain-postgres";
import * as Domain from "@alchemy.run/domain";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import { Roles } from "../../access/roles.ts";
import { PersonId, system } from "../../actor/actor.ts";
import { CurrentActor } from "../../actor/current-actor.context.ts";
import { devTokens } from "../../auth/dev-tokens.ts";
import { SessionLive } from "../../auth/session-live.ts";
import { sessionClient } from "../../auth/session.middleware.ts";
import { memoryEmail, SentEmails } from "../../delivery/memory-email.ts";
import { memoryPush } from "../../delivery/memory-push.ts";
import {
  aggregates,
  handlers,
  Inbox,
  NotificationId,
  NotificationsPermissions as P,
  Notify,
  policies,
  views,
} from "../index.ts";

class Notifications extends Domain.Model("Notifications", { aggregates, views, policies }) {}
class NotificationsApi extends Domain.Api("NotificationsApi", {
  model: Notifications,
  commands: [
    "MarkRead",
    "SetPreference",
    "SetQuietHours",
    "SetEmailAddress",
    "AddDevice",
    "RemoveDevice",
  ],
  views: ["MyInbox"],
}) {}

const World = SessionLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      devTokens({
        "ann-token": { subject: "ann", orgId: null, roles: ["member"] },
        "bob-token": { subject: "bob", orgId: null, roles: ["member"] },
        "eve-token": { subject: "eve", orgId: null, roles: ["guest"] },
      }),
      Roles.layer({ member: [P.read, P.write], guest: [] }),
    ),
  ),
  Layer.provideMerge(
    Notifications.layer(handlers).pipe(
      Layer.provide(platformForTests),
      Layer.provideMerge(Layer.mergeAll(memoryEmail("noreply@example.test"), memoryPush())),
    ),
  ),
);
const as = (token: string) =>
  NotificationsApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));
const annId = PersonId.make("ann");

describe("Notifications over the Api", () => {
  it.live("a member manages only their own inbox, and email reaches them", () =>
    Effect.gen(function* () {
      const ann = yield* as("ann-token");
      yield* ann.SetEmailAddress(annId, { address: "ann@example.test" });
      const inboxes = yield* Inbox;
      const created = yield* inboxes
        .send(
          annId,
          new Notify({
            notificationId: NotificationId.make("n-1"),
            category: "news",
            title: "Hello",
            body: "World",
            data: {},
            channels: ["email"],
            mandatory: false,
          }),
        )
        .pipe(Effect.provideService(CurrentActor, system("App", [P.notify])));

      const inbox = yield* ann.MyInbox.get(annId, {
        atLeast: { stream: created.stream, version: created.version },
      });
      expect(inbox?.unread).toBe(1);
      const sent = yield* (yield* SentEmails).all.pipe(
        Effect.filterOrFail((all) => all.length > 0),
        Effect.retry({ schedule: Schedule.spaced("10 millis"), times: 100 }),
      );
      expect(sent).toEqual([
        {
          from: "noreply@example.test",
          to: "ann@example.test",
          subject: "Hello",
          text: "World",
          idempotencyKey: "n-1:email",
        },
      ]);

      const bob = yield* as("bob-token");
      const peek = yield* bob.MyInbox.get(annId).pipe(Effect.flip);
      expect(peek._tag).toBe("NotInboxOwner");
      const meddle = yield* bob.MarkRead(annId, { notificationIds: "all" }).pipe(Effect.flip);
      expect(meddle._tag).toBe("NotInboxOwner");
      const eve = yield* as("eve-token");
      const guest = yield* eve.MyInbox.get(PersonId.make("eve")).pipe(Effect.flip);
      expect(guest._tag).toBe("Forbidden");
      const stranger = yield* as("nope");
      const anonymous = yield* stranger.MyInbox.get(annId).pipe(Effect.flip);
      expect(anonymous._tag).toBe("Unauthenticated");

      const read = yield* ann.MarkRead(annId, { notificationIds: "all" });
      const after = yield* ann.MyInbox.get(annId, {
        atLeast: { stream: read.stream, version: read.version },
      });
      expect(after?.unread).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(World)),
  );
});

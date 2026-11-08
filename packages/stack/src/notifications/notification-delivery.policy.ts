import * as Domain from "@alchemy.run/domain";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { system } from "../actor/actor.ts";
import { CurrentActor } from "../actor/current-actor.context.ts";
import { Email } from "../delivery/email.external.ts";
import { Push } from "../delivery/push.external.ts";
import { Inbox, type InboxEntry, type InboxState } from "./inbox.aggregate.ts";
import { NotificationCreated } from "./notify.command.ts";
import { NotificationsPermissions } from "./permissions.ts";
import { NotificationReleased, ReleaseNotification } from "./release-notification.command.ts";
import { SettleDelivery } from "./settle-delivery.command.ts";

export const PUSH_TTL_SECONDS = 86_400;

export const deliverer = system("NotificationDelivery", [NotificationsPermissions.deliver]);

export class NotificationDelivery extends Domain.Policy("NotificationDelivery", {
  from: Inbox,
  on: [NotificationCreated, NotificationReleased],
}) {}

export const NotificationDeliveryLive = NotificationDelivery.toLayer(
  Effect.gen(function* () {
    const inboxes = yield* Inbox;
    const email = yield* Email;
    const push = yield* Push;

    const viaEmail = (s: InboxState, n: InboxEntry) =>
      s.email === null
        ? Effect.succeed({ failure: "Unreachable", gone: [] })
        : email
            .send({
              to: s.email,
              subject: n.title,
              text: /\S/.test(n.body) ? n.body : n.title,
              idempotencyKey: `${n.id}:email`,
            })
            .pipe(
              Effect.as({ failure: null, gone: [] }),
              Effect.catch((error) => Effect.succeed({ failure: error._tag, gone: [] })),
            );

    const viaPush = (s: InboxState, n: InboxEntry) =>
      Effect.forEach(s.devices, (subscription) =>
        push
          .send({
            subscription,
            payload: { id: n.id, title: n.title, body: n.body, data: n.data },
            ttl: PUSH_TTL_SECONDS,
            idempotencyKey: `${n.id}:push:${subscription.endpoint}`,
          })
          .pipe(
            Effect.as("Sent"),
            Effect.catch((error) => Effect.succeed(error._tag)),
            Effect.map((outcome) => ({ endpoint: subscription.endpoint, outcome })),
          ),
      ).pipe(
        Effect.map((results) => ({
          failure: results.some((r) => r.outcome === "Sent")
            ? null
            : (results.find((r) => r.outcome !== "PushGone")?.outcome ??
              (results.length === 0 ? "Unreachable" : "PushGone")),
          gone: results.filter((r) => r.outcome === "PushGone").map((r) => r.endpoint),
        })),
      );

    return Effect.fn(
      function* ({ source, event }) {
        if (event._tag === "NotificationCreated" && event.heldUntil !== null) {
          yield* inboxes
            .schedule(source, new ReleaseNotification({ notificationId: event.notificationId }), {
              at: DateTime.makeUnsafe(event.heldUntil),
              commandId: `release:${event.notificationId}`,
            })
            .pipe(Effect.catchTag("AlreadyExecuted", () => Effect.void));
          return;
        }
        const state = yield* inboxes.state(source);
        const entry = state.notifications.find((n) => n.id === event.notificationId);
        if (entry === undefined || entry.heldUntil !== null) return;
        for (const channel of entry.waiting) {
          const outcome = yield* channel === "email"
            ? viaEmail(state, entry)
            : viaPush(state, entry);
          yield* inboxes.send(
            source,
            new SettleDelivery({ notificationId: entry.id, channel, ...outcome }),
            { commandId: `settle:${entry.id}:${channel}` },
          );
        }
      },
      Effect.catchTag("Forbidden", (forbidden) => Effect.die(forbidden)),
      Effect.provideService(CurrentActor, deliverer),
    );
  }),
);

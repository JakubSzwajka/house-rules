import { defineModule } from "@house-rules/domain";
import { Effect, Layer, Schema } from "effect";
import { memoryNotificationStore } from "./adapters/memory/notification.js";
import { postgresNotificationStore } from "./adapters/postgres/notification.js";
import { NotificationInputInvalid } from "./notification/notification.js";
import { makeNotifications, type NotificationsService } from "./notification/notifications.js";
import { NotificationsOptions } from "./notification/options.js";
import { NotificationStore } from "./storage.js";
export class Notifications extends defineModule<Notifications, NotificationsService>()(
  "notifications",
  {
    make: (options: NotificationsOptions) =>
      Effect.gen(function* () {
        const settings = yield* Schema.decodeEffect(NotificationsOptions)(options).pipe(
          Effect.mapError(
            () => new NotificationInputInvalid({ message: "Invalid notifications options." }),
          ),
        );
        return makeNotifications(yield* NotificationStore, settings);
      }),
  },
) {
  static readonly presets = {
    default: {
      channels: ["inapp", "push", "email"],
      dailyDigestTime: "08:00",
      maxPageSize: 100,
      maxDueBatch: 100,
      maxAttempts: 5,
      retryBaseMs: 1000,
      retryCapMs: 3_600_000,
    },
  } as const;
  static readonly layerMemory = (options: NotificationsOptions) =>
    this.layer(options).pipe(Layer.provide(memoryNotificationStore()));
  static readonly layerPostgres = (options: NotificationsOptions) =>
    this.layer(options).pipe(Layer.provide(postgresNotificationStore));
}

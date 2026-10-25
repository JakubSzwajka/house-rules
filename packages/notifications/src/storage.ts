import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type {
  Delivery,
  DeliveryItem,
  Notification,
  NotificationCursor,
  NotificationStoreUnavailable,
  Preference,
  QuietHours,
  Recipient,
} from "./notification/notification.js";
type Read<A> = Effect.Effect<A, NotificationStoreUnavailable>;
type Write<A = void> = Effect.Effect<A, NotificationStoreUnavailable | NoOpenUnit>;
export class NotificationStore extends Context.Service<
  NotificationStore,
  {
    readonly insert: (notification: Notification, deliveries: readonly Delivery[]) => Write;
    readonly list: (
      recipient: Recipient,
      page: { readonly size: number; readonly after?: NotificationCursor },
    ) => Read<readonly Notification[]>;
    readonly unreadCount: (recipient: Recipient) => Read<number>;
    readonly markRead: (
      recipient: Recipient,
      at: number,
      id?: string,
    ) => Write<readonly Notification[]>;
    readonly preferences: (recipient: Recipient) => Read<readonly Preference[]>;
    readonly setPreference: (recipient: Recipient, preference: Preference) => Write;
    readonly quietHours: (recipient: Recipient) => Read<QuietHours | null>;
    readonly setQuietHours: (recipient: Recipient, hours: QuietHours | null) => Write;
    readonly timeZone: (recipient: Recipient) => Read<string | null>;
    readonly setTimeZone: (recipient: Recipient, timeZone: string | null) => Write;
    readonly deliveries: (
      recipient: Recipient,
      query?: { readonly unsettledOnly: boolean },
    ) => Read<readonly DeliveryItem[]>;
    readonly reschedule: (
      id: string,
      schedule: Pick<Delivery, "mode" | "state" | "dueAt">,
    ) => Write;
    readonly due: (at: number, limit: number) => Read<readonly DeliveryItem[]>;
    readonly markSent: (ids: readonly string[], at: number) => Write;
    readonly markFailed: (
      id: string,
      error: string,
      at: number,
      retry: { readonly maxAttempts: number; readonly baseMs: number; readonly capMs: number },
    ) => Write;
    readonly erase: (recipient: Recipient) => Write;
  }
>()("@house-rules/notifications/NotificationStore") {}

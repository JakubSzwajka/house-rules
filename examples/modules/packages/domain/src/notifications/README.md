# Notifications

A person's inbox, channel preferences, quiet hours and delivery ledger, as one `Inbox` aggregate keyed by `PersonId`. The `NotificationDelivery` policy sends each new notification through `Email` and `Push` from `delivery/`, and records the outcome back on the inbox.

## Compose

```ts
class App extends Domain.Model("App", {
  aggregates: [...Notifications.aggregates],
  views: [...Notifications.views],
  policies: [...Notifications.policies],
}) {}

App.layer(Notifications.handlers).pipe(
  Layer.provide(Layer.mergeAll(Delivery.consoleEmail, Delivery.consolePush, Domain.InMemory)),
);
```

Grant `notifications:notify` to the system actor of whichever policy creates notifications. The delivery policy acts as `deliverer`, `system("NotificationDelivery", ["notifications:deliver"])`.

## Commands

| Command | Who | Permission | Records |
| --- | --- | --- | --- |
| `Notify` | a system actor | `notifications:notify` | `NotificationCreated`, or nothing for a known `notificationId` |
| `MarkRead` (ids or `"all"`) | the owner | `notifications:write` | `NotificationsRead` with only the ids that were unread |
| `SetPreference`, `SetQuietHours`, `SetEmailAddress`, `AddDevice`, `RemoveDevice` | the owner | `notifications:write` | one event, or nothing when nothing changes |
| `SettleDelivery` | the delivery policy | `notifications:deliver` | `NotificationDelivered` or `NotificationDeliveryFailed`, once per notification and channel |
| `ReleaseNotification` | scheduled by the delivery policy | `notifications:deliver`, else nothing | `NotificationReleased` |

Another person, an agent (even its own person's inbox) or a system actor on someone's inbox gets `NotInboxOwner` (403). The `MyInbox` view (notifications newest first, unread count, preferences, quiet hours) checks `notifications:read` and the same ownership.

## Rules

- The inbox entry is the in-app delivery. It always exists and cannot be turned off; `channels` lists only email and push.
- `Notify` carries the category's default `channels` and whether it is `mandatory`. A saved preference for the category and channel overrides the default. A mandatory notification always uses its default channels, even ones the person turned off, and ignores quiet hours.
- A channel needs somewhere to go: an email address, or at least one push device.
- Quiet hours (`start`, `end`, IANA `timeZone`, may cross midnight) hold every external channel of a non-mandatory notification until the first real local minute outside the window, DST included. The policy schedules `ReleaseNotification` at that time. On release, channels the person has turned off since are dropped.
- The policy reads the inbox when it delivers, so it uses the current address and devices. It passes `<notificationId>:email`, or `<notificationId>:push:<endpoint>` per device, as the vendor idempotency key, and settles with a deterministic command id. `SettleDelivery` records nothing for a channel already settled, so redelivery never writes the ledger twice. A send can still repeat if the policy stops between sending and settling.
- A push endpoint answering `PushGone` is dropped from the person's devices in the same `NotificationDelivered` or `NotificationDeliveryFailed` event.
- A failed delivery is final in the ledger. No automatic retry or backoff.

# @house-rules/notifications

An inbox with channel preferences, quiet hours and a delivery ledger. Push and email senders live outside this package.

## Mount

```ts
const options = {
  ...Notifications.presets.default,
  recipientKind: "person",
  categories: [
    { name: "news", defaultChannels: ["inapp", "email"], mandatory: false },
    { name: "security", defaultChannels: ["email", "push"], mandatory: true },
  ],
};

// In composition/modules.ts, pair NotificationsMount with this layer.
const notifications = Notifications.layerPostgres(options);
```

Provide SqlClient and the SQL unit adapter for Postgres, or use layerMemory and the memory unit adapter. Run the shipped migrations through `@house-rules/migrations`. No contact, party or event-log service is required.

## Operations

Import `NotificationsOperations` and schemas from `@house-rules/notifications/contract`. `NotificationsMount` captures `bindNotifications` once during composition.

| Operation | Caller | Permission | Result |
| --- | --- | --- | --- |
| notify | system | notifications:write | `{ notifications, events: NotificationCreated[] }` |
| listMine | person | notifications:read | `{ notifications, next? }` |
| unreadCount | person | notifications:read | number |
| markRead, markAllRead | person | notifications:write | `{ notifications, events: NotificationRead[] }` |
| getMyPreferences | person | notifications:read | `{ preferences, quietHours, timeZone }` |
| setMyPreference, setMyQuietHours, setMyTimeZone | person | notifications:write | void |
| dueDeliveries | system | notifications:deliver | schedule item array |
| markSent, markFailed | system | notifications:deliver | void |

All writes require the feature's open unit. `notify` takes `{ recipients: [{ kind, id }], category, title, body, data }`. It deduplicates recipients and creates inbox and ledger rows atomically. It returns facts, never publishes them. The app feature decides whether to record these facts through event-log.

Mine operations derive a ref using configured recipientKind and the explicit actor id. They never accept another person's ref. Lists sort newest first with exclusive `(createdAt, id)` cursors and clamp requested size to maxPageSize. Read marks return facts only for rows that changed from unread to read. Missing, already-read and foreign ids return empty results.

`erase(recipient)` removes the inbox, ledger, preferences, time zone and quiet hours in one unit. It is a facade-only account deletion hook.

## Modes and timing

Enabled channels are inapp, push and email. An explicit non-off preference enables a non-default push/email channel; otherwise category defaults select channels. The inbox row is the in-app delivery, so no in-app ledger rows are created. In-app stays immediate. The inbox exists even when all external channels are off.

Mandatory categories force their default channels to immediate even if old stored preferences say off or digest. They ignore quiet hours. The preference setter rejects attempts to delay mandatory categories or disable/delay in-app.

Hourly digests use the next local hour boundary. Daily digests use the next local dailyDigestTime, default 08:00. `setMyTimeZone(actor, timeZone)` stores the person's IANA zone independently of quiet hours. Null clears it and restores UTC. `getMyPreferences` returns the stored zone or null. Digests and quiet hours use that zone. `setMyQuietHours(actor, { start, end })` accepts HH:mm values; null clears the window. Equal endpoints are invalid. A window can cross midnight.

Quiet hours hold external deliveries whose scheduled send falls inside the window. dueAt becomes the end of that window in the person's zone. DST gaps release at the first real minute outside the window. Repeated hours are checked as real instants. All current time reads use Effect's testable clock; Intl handles zone conversion. Changing preferences, quiet hours or time zone refreshes that person's pending/held non-mandatory external rows in the same unit. Refresh queries exclude terminal ledger history. Scheduling starts from the notification's creation time and keeps elapsed digest times due. Each row stores retryAt separately from dueAt, so a changed quiet window can release a retry sooner without shortening its backoff. Switching a channel off cancels its queued rows without delivery. Mandatory and terminal rows are untouched.

## Delivery work

```text
app system feature -> notify -> inbox + ledger -> returned facts
schedule selector -> dueDeliveries -> one item per immediate row
                                   -> one digest per recipient/channel/mode
schedule item -> channel sender -> markSent(deliveryIds)
                               -> markFailed(deliveryId, error)
```

maxDueBatch bounds complete groups, default 100. Each item includes recipient, channel, mode and deliveries with the inbox content and ledger ids. Digest rows group by recipient, channel and mode, so hourly and daily work never mixes. One group's due rows are never split at the limit; a large group can exceed maxDueBatch rows. Immediate rows stay individual items. Sent, failed and cancelled rows are terminal and are not selected; pending and released held rows are.

markSent is idempotent, including repeated ids, and does not change an already sent row's timestamp or attempts. markFailed increments attempts and keeps the private error in the ledger, without losing the inbox notification. Below maxAttempts (default 5), it sets pending with dueAt = now + min(retryBaseMs * 2^attempts, retryCapMs). Defaults are 1000 ms base and 3600000 ms cap. dueDeliveries reselects retries after backoff. At maxAttempts the row becomes terminal failed. Neither settlement method changes terminal rows; a late failure cannot overwrite sent.

Pass each ledger id as a provider idempotency key. Sending then settling is at least once: a crash between them can duplicate a send. There is no distributed lease, and read selection does not claim rows. Event-log outbox wiring and channel consumers belong to the app, so a rolled-back notification never produces committed delivery work.

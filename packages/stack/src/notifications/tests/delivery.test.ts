import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import { PersonId, person, system } from "../../actor/actor.ts";
import { CurrentActor } from "../../actor/current-actor.context.ts";
import { Email, EmailSendFailed } from "../../delivery/email.external.ts";
import { Push, PushGone } from "../../delivery/push.external.ts";
import {
  aggregates,
  NotificationDelivered,
  NotificationDeliveryFailed,
  DeviceAdded,
  EmailAddressSet,
  handlers,
  Inbox,
  MyInbox,
  NotificationCreated,
  NotificationId,
  NotificationReleased,
  NotificationsPermissions as P,
  Notify,
  PreferenceSet,
  policies,
  QuietHoursSet,
  SetPreference,
  views,
} from "../index.ts";

class Notifications extends Domain.Model("Notifications", { aggregates, views, policies }) {}

const story = Story.make(Notifications, { layer: handlers, stub: [Email, Push] });
const app = system("App", [P.notify]);
const inbox = Inbox.ref(PersonId.make("ann"));
const n1 = NotificationId.make("n-1");
const content = { category: "news", title: "Hello", body: "World", data: {} };
const noon = Date.parse("2026-01-05T12:00:00Z");
const device = {
  endpoint: "https://push.example.test/ann",
  keys: { p256dh: "p256dh", auth: "auth" },
};
const reachable = [
  new EmailAddressSet({ address: "ann@example.test", by: "ann" }),
  new DeviceAdded({ subscription: device, by: "ann" }),
] as const;
const notify = (channels: ReadonlyArray<"email" | "push">, mandatory = false) =>
  new Notify({ notificationId: n1, ...content, channels, mandatory });
const late = Date.parse("2026-01-05T23:00:00Z");
const morning = Date.parse("2026-01-06T07:00:00Z");
const quiet = new QuietHoursSet({
  quietHours: { start: "22:00", end: "07:00", timeZone: "UTC" },
  by: "ann",
});
const created = (
  channels: ReadonlyArray<"email" | "push">,
  heldUntil: number | null = null,
  createdAt = noon,
) => new NotificationCreated({ notificationId: n1, ...content, createdAt, channels, heldUntil });
const settled = (channel: "email" | "push", at = noon) => ({
  notificationId: n1,
  channel,
  at,
  gone: [],
});

describe("NotificationDelivery", () => {
  it.effect("delivers by email and push, keyed for idempotent vendors", () =>
    story(
      Story.clock(noon),
      Story.given(inbox, ...reachable),
      Story.provide(CurrentActor, app),
      Story.when(inbox, notify(["email", "push"])),
      Story.then(inbox, created(["email", "push"])),
      Story.call(Email.send, {
        to: "ann@example.test",
        subject: "Hello",
        idempotencyKey: "n-1:email",
      }),
      Story.succeed(Email.send, { providerId: "p-1" }),
      Story.call(Push.send, {
        subscription: device,
        idempotencyKey: `n-1:push:${device.endpoint}`,
      }),
      Story.succeed(Push.send, undefined),
      Story.then(
        inbox,
        new NotificationDelivered(settled("email")),
        new NotificationDelivered(settled("push")),
      ),
      Story.state(inbox, (s) => expect(s.notifications[0]?.waiting).toEqual([])),
    ),
  );

  it.effect("follows the person's preferences over the category defaults", () =>
    story(
      Story.clock(noon),
      Story.given(
        inbox,
        ...reachable,
        new PreferenceSet({ category: "news", channel: "email", enabled: false, by: "ann" }),
        new PreferenceSet({ category: "news", channel: "push", enabled: true, by: "ann" }),
      ),
      Story.provide(CurrentActor, app),
      Story.when(inbox, notify(["email"])),
      Story.then(inbox, created(["push"])),
      Story.call(Push.send, { idempotencyKey: `n-1:push:${device.endpoint}` }),
      Story.succeed(Push.send, undefined),
      Story.then(inbox, new NotificationDelivered(settled("push"))),
    ),
  );

  it.effect("records a failed send with the vendor's declared error", () =>
    story(
      Story.clock(noon),
      Story.given(inbox, ...reachable),
      Story.provide(CurrentActor, app),
      Story.when(inbox, notify(["email"])),
      Story.then(inbox, created(["email"])),
      Story.call(Email.send, { to: "ann@example.test" }),
      Story.fail(Email.send, new EmailSendFailed()),
      Story.then(
        inbox,
        new NotificationDeliveryFailed({ ...settled("email"), reason: "EmailSendFailed" }),
      ),
    ),
  );

  it.effect("forgets a device the push service reports gone", () =>
    story(
      Story.clock(noon),
      Story.given(inbox, ...reachable),
      Story.provide(CurrentActor, app),
      Story.when(inbox, notify(["push"])),
      Story.then(inbox, created(["push"])),
      Story.call(Push.send, { subscription: device }),
      Story.fail(Push.send, new PushGone()),
      Story.then(
        inbox,
        new NotificationDeliveryFailed({
          ...settled("push"),
          gone: [device.endpoint],
          reason: "PushGone",
        }),
      ),
      Story.state(inbox, { devices: [] }),
    ),
  );

  it.effect("holds a notification during quiet hours and delivers when they end", () =>
    story(
      Story.clock(late),
      Story.given(inbox, ...reachable, quiet),
      Story.provide(CurrentActor, app),
      Story.when(inbox, notify(["email"])),
      Story.then(inbox, created(["email"], morning, late)),
      Story.advance("7 hours"),
      Story.then(inbox),
      Story.advance("1 hour"),
      Story.then(inbox, new NotificationReleased({ notificationId: n1, channels: ["email"] })),
      Story.call(Email.send, { to: "ann@example.test" }),
      Story.succeed(Email.send, { providerId: null }),
      Story.then(inbox, new NotificationDelivered(settled("email", morning))),
    ),
  );

  it.effect("drops a held channel the person turned off before release", () =>
    story(
      Story.clock(late),
      Story.given(inbox, ...reachable, quiet),
      Story.provide(CurrentActor, app),
      Story.when(inbox, notify(["email"])),
      Story.then(inbox, created(["email"], morning, late)),
      Story.provide(CurrentActor, person("ann", { permissions: [P.write] })),
      Story.when(inbox, new SetPreference({ category: "news", channel: "email", enabled: false })),
      Story.then(
        inbox,
        new PreferenceSet({ category: "news", channel: "email", enabled: false, by: "ann" }),
      ),
      Story.advance("8 hours"),
      Story.then(inbox, new NotificationReleased({ notificationId: n1, channels: [] })),
    ),
  );

  it.effect("delivers mandatory notifications at once, despite quiet hours and preferences", () =>
    story(
      Story.clock(late),
      Story.given(
        inbox,
        ...reachable,
        new PreferenceSet({ category: "news", channel: "email", enabled: false, by: "ann" }),
        quiet,
      ),
      Story.provide(CurrentActor, app),
      Story.when(inbox, notify(["email"], true)),
      Story.then(inbox, created(["email"], null, late)),
      Story.call(Email.send, { to: "ann@example.test" }),
      Story.succeed(Email.send, { providerId: null }),
      Story.then(inbox, new NotificationDelivered(settled("email", late))),
      Story.view(MyInbox, inbox, { unread: 1 }),
    ),
  );
});

import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { describe, expect, it } from "@effect/vitest";
import { Forbidden } from "../../access/forbidden.rejection.ts";
import { PersonId, person, system } from "../../actor/actor.ts";
import { CurrentActor } from "../../actor/current-actor.context.ts";
import { Email } from "../../delivery/email.external.ts";
import { Push } from "../../delivery/push.external.ts";
import {
  AddDevice,
  aggregates,
  DeviceAdded,
  DeviceRemoved,
  EmailAddressSet,
  handlers,
  Inbox,
  MarkRead,
  MyInbox,
  NotificationCreated,
  NotificationId,
  NotificationsPermissions as P,
  NotificationsRead,
  NotInboxOwner,
  Notify,
  PreferenceSet,
  policies,
  QuietHoursSet,
  ReleaseNotification,
  RemoveDevice,
  SetEmailAddress,
  SetPreference,
  SetQuietHours,
  SettleDelivery,
  views,
} from "../index.ts";

class Notifications extends Domain.Model("Notifications", { aggregates, views, policies }) {}

const story = Story.make(Notifications, { layer: handlers, stub: [Email, Push] });
const ann = person("ann", { permissions: [P.read, P.write] });
const bob = person("bob", { permissions: [P.read, P.write] });
const app = system("App", [P.notify]);
const inbox = Inbox.ref(PersonId.make("ann"));
const n1 = NotificationId.make("n-1");
const n2 = NotificationId.make("n-2");
const noon = Date.parse("2026-01-05T12:00:00Z");
const content = { category: "news", title: "Hello", body: "World", data: {} };
const created = (
  notificationId: NotificationId,
  channels: ReadonlyArray<"email" | "push"> = [],
  heldUntil: number | null = null,
) => new NotificationCreated({ notificationId, ...content, createdAt: noon, channels, heldUntil });
const device = {
  endpoint: "https://push.example.test/ann",
  keys: { p256dh: "p256dh", auth: "auth" },
};

describe("Notifications model", () => {
  it("is well defined", () => expect(Domain.verify(Notifications)).toEqual([]));
});

describe("Notify", () => {
  it.effect("creates the notification once, delivering nowhere without an address", () =>
    story(
      Story.clock(noon),
      Story.provide(CurrentActor, app),
      Story.when(
        inbox,
        new Notify({ notificationId: n1, ...content, channels: ["email"], mandatory: false }),
      ),
      Story.then(inbox, created(n1)),
      Story.when(
        inbox,
        new Notify({ notificationId: n1, ...content, channels: ["email"], mandatory: false }),
      ),
      Story.then(inbox),
    ),
  );

  it.effect("refuses a person without the notify permission", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(
        inbox,
        new Notify({ notificationId: n1, ...content, channels: [], mandatory: false }),
      ),
      Story.rejected(new Forbidden({ permission: P.notify })),
    ),
  );
});

describe("MarkRead", () => {
  it.effect("marks only unread notifications of the owner's inbox", () =>
    story(
      Story.clock(noon),
      Story.given(inbox, created(n1), created(n2)),
      Story.provide(CurrentActor, ann),
      Story.when(inbox, new MarkRead({ notificationIds: [n1] })),
      Story.then(inbox, new NotificationsRead({ notificationIds: [n1], at: noon, by: "ann" })),
      Story.when(inbox, new MarkRead({ notificationIds: "all" })),
      Story.then(inbox, new NotificationsRead({ notificationIds: [n2], at: noon, by: "ann" })),
      Story.when(inbox, new MarkRead({ notificationIds: "all" })),
      Story.then(inbox),
      Story.view(MyInbox, inbox, { unread: 0 }),
    ),
  );

  it.effect("refuses another person's inbox", () =>
    story(
      Story.given(inbox, created(n1)),
      Story.provide(CurrentActor, bob),
      Story.when(inbox, new MarkRead({ notificationIds: "all" })),
      Story.rejected(new NotInboxOwner()),
    ),
  );

  it.effect("refuses a system actor, even with the permission", () =>
    story(
      Story.provide(CurrentActor, system("Cleanup", [P.write])),
      Story.when(inbox, new MarkRead({ notificationIds: "all" })),
      Story.rejected(new NotInboxOwner()),
    ),
  );

  it.effect("refuses the owner without the write permission", () =>
    story(
      Story.provide(CurrentActor, person("ann")),
      Story.when(inbox, new MarkRead({ notificationIds: "all" })),
      Story.rejected(new Forbidden({ permission: P.write })),
    ),
  );
});

describe("settings", () => {
  const hours = { start: "22:00", end: "07:00", timeZone: "Europe/Warsaw" };

  it.effect("records the owner's preferences, quiet hours and addresses, once each", () =>
    story(
      Story.provide(CurrentActor, ann),
      Story.when(inbox, new SetPreference({ category: "news", channel: "email", enabled: false })),
      Story.then(
        inbox,
        new PreferenceSet({ category: "news", channel: "email", enabled: false, by: "ann" }),
      ),
      Story.when(inbox, new SetPreference({ category: "news", channel: "email", enabled: false })),
      Story.then(inbox),
      Story.when(inbox, new SetQuietHours({ quietHours: hours })),
      Story.then(inbox, new QuietHoursSet({ quietHours: hours, by: "ann" })),
      Story.when(inbox, new SetEmailAddress({ address: "ann@example.test" })),
      Story.then(inbox, new EmailAddressSet({ address: "ann@example.test", by: "ann" })),
      Story.when(inbox, new AddDevice({ subscription: device })),
      Story.then(inbox, new DeviceAdded({ subscription: device, by: "ann" })),
      Story.when(inbox, new AddDevice({ subscription: device })),
      Story.then(inbox),
      Story.when(inbox, new RemoveDevice({ endpoint: device.endpoint })),
      Story.then(inbox, new DeviceRemoved({ endpoint: device.endpoint, by: "ann" })),
      Story.when(inbox, new RemoveDevice({ endpoint: device.endpoint })),
      Story.then(inbox),
      Story.state(inbox, { email: "ann@example.test", devices: [] }),
      Story.view(MyInbox, inbox, {
        preferences: [{ category: "news", channel: "email", enabled: false }],
        quietHours: hours,
      }),
    ),
  );

  it.effect("refuses another person's settings", () =>
    story(
      Story.provide(CurrentActor, bob),
      Story.when(inbox, new SetQuietHours({ quietHours: null })),
      Story.rejected(new NotInboxOwner()),
      Story.when(inbox, new SetEmailAddress({ address: "bob@example.test" })),
      Story.rejected(new NotInboxOwner()),
      Story.when(inbox, new AddDevice({ subscription: device })),
      Story.rejected(new NotInboxOwner()),
      Story.when(inbox, new RemoveDevice({ endpoint: device.endpoint })),
      Story.rejected(new NotInboxOwner()),
      Story.when(inbox, new SetPreference({ category: "news", channel: "push", enabled: true })),
      Story.rejected(new NotInboxOwner()),
    ),
  );

  it.effect("refuses the owner without the write permission", () =>
    story(
      Story.provide(CurrentActor, person("ann")),
      Story.when(inbox, new SetQuietHours({ quietHours: null })),
      Story.rejected(new Forbidden({ permission: P.write })),
    ),
  );
});

describe("system-only commands", () => {
  it.effect("refuses to settle a delivery without the deliver permission", () =>
    story(
      Story.given(inbox, created(n1, ["email"])),
      Story.provide(CurrentActor, app),
      Story.when(
        inbox,
        new SettleDelivery({ notificationId: n1, channel: "email", failure: null, gone: [] }),
      ),
      Story.rejected(new Forbidden({ permission: P.deliver })),
    ),
  );

  it.effect("ignores a release from an actor without the deliver permission", () =>
    story(
      Story.given(inbox, created(n1, ["email"], noon)),
      Story.provide(CurrentActor, app),
      Story.when(inbox, new ReleaseNotification({ notificationId: n1 })),
      Story.then(inbox),
    ),
  );
});

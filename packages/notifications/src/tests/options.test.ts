import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { NotificationStoreUnavailable, Notifications, NotificationsOptions } from "../index.js";
const options: NotificationsOptions = {
  ...Notifications.presets.default,
  recipientKind: "person",
  categories: [{ name: "news", defaultChannels: ["email"], mandatory: false }],
};
it.effect("accepts defaults and rejects duplicate or disabled category/channel config", () =>
  Effect.sync(() => {
    const valid = Schema.is(NotificationsOptions);
    expect(valid(options)).toBe(true);
    expect(valid({ ...options, recipientKind: "" })).toBe(false);
    expect(valid({ ...options, channels: ["email", "email"] })).toBe(false);
    expect(valid({ ...options, channels: ["push"] })).toBe(false);
    expect(valid({ ...options, categories: [options.categories[0], options.categories[0]] })).toBe(
      false,
    );
    expect(valid({ ...options, dailyDigestTime: "25:00" })).toBe(false);
    expect(valid({ ...options, maxDueBatch: 0 })).toBe(false);
    expect(Notifications.presets.default.maxAttempts).toBe(5);
    for (const setting of ["maxAttempts", "retryBaseMs", "retryCapMs"])
      expect(valid({ ...options, [setting]: 0 })).toBe(false);
  }),
);
it.effect("keeps driver causes out of public unavailable messages", () =>
  Effect.sync(() => {
    const error = new NotificationStoreUnavailable({ cause: "password=private host=private" });
    expect(error.kind).toBe("unavailable");
    expect(error.message).toBe("Notifications are unavailable. Try again shortly.");
  }),
);

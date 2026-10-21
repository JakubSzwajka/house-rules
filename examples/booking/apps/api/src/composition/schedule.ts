import { runEntry, May, Approval, CallChannel } from "@house-rules/application";
import { Effect } from "effect";
import { Entries, systemPermissions } from "./entries.ts";
export const scheduleEntries = {
  nightlyCleanup: runEntry(Entries.nightlyCleanup, {}).pipe(
    Effect.provideContext(
      May.context(May.system([Entries.nightlyCleanup]), {
        system: systemPermissions,
        via: "schedule:nightly_cleanup",
      }),
    ),
    Effect.provide(Approval.allowAll),
    Effect.provideService(CallChannel, "schedule"),
  ),
};

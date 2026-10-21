import { runFeature, May, Approval, CallChannel } from "@house-rules/application";
import { Effect } from "effect";
import { Features, systemPermissions } from "../features/index.ts";
export const scheduleFeatures = {
  nightlyCleanup: runFeature(Features.nightlyCleanup, {}).pipe(
    Effect.provideContext(
      May.context(May.system([Features.nightlyCleanup]), {
        system: systemPermissions,
        via: "schedule:nightly_cleanup",
      }),
    ),
    Effect.provide(Approval.allowAll),
    Effect.provideService(CallChannel, "schedule"),
  ),
};

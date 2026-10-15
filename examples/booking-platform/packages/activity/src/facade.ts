import { AuditStore } from "@house-rules/call-audit";
import { type Actor, defineModule } from "@house-rules/domain";
import { Effect } from "effect";
import {
  type ActivityEntry,
  type ActivityQuery,
  ActivityUnavailable,
  activityWindow,
  type MyActivity,
} from "./activity/activity.js";
import { activityPage } from "./activity/activity-page.js";

export class Activity extends defineModule<
  Activity,
  {
    readonly mine: (
      actor: Actor,
      query?: ActivityQuery,
    ) => Effect.Effect<MyActivity, ActivityUnavailable>;
  }
>()("@example/activity/Activity", {
  make: Effect.gen(function* activityLayer() {
    const store = yield* AuditStore;
    return {
      mine: (actor: Actor, query: ActivityQuery = {}) =>
        store.read({ viewerId: actor.id, limit: activityWindow }).pipe(
          Effect.map((rows) =>
            activityPage(
              rows.map(
                (row): ActivityEntry => ({
                  capability: row.capability,
                  outcome: row.outcome,
                  kind: row.kind ?? null,
                  channel: row.channel ?? null,
                  targetId: row.targetId ?? null,
                  requestId: row.requestId ?? null,
                  durationMs: row.ms,
                  recordedAt: row.recordedAt.getTime(),
                }),
              ),
              query,
            ),
          ),
          Effect.mapError(
            (cause) => new ActivityUnavailable({ message: "Activity could not be read.", cause }),
          ),
        ),
    };
  }),
}) {}

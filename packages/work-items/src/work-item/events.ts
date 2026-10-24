import { Schema } from "effect";
import { WorkItem, WorkItemRef } from "./work-item.js";
const subject = Schema.Struct({ kind: Schema.Literal("work_item"), id: Schema.NonEmptyString });
const content = Schema.Struct({
  title: Schema.NonEmptyString,
  body: Schema.String,
  attributes: Schema.Json,
});
const holding = Schema.Struct({
  holder: Schema.NullOr(WorkItemRef),
  status: Schema.NonEmptyString,
});
export const WorkItemEvents = {
  Created: Schema.Struct({ kind: Schema.Literal("work_items.created"), subject, item: WorkItem }),
  Edited: Schema.Struct({
    kind: Schema.Literal("work_items.edited"),
    subject,
    from: content,
    to: content,
  }),
  StatusChanged: Schema.Struct({
    kind: Schema.Literal("work_items.status_changed"),
    subject,
    from: Schema.NonEmptyString,
    to: Schema.NonEmptyString,
  }),
  Assigned: Schema.Struct({
    kind: Schema.Literal("work_items.assigned"),
    subject,
    from: Schema.NullOr(WorkItemRef),
    to: Schema.NullOr(WorkItemRef),
  }),
  Claimed: Schema.Struct({
    kind: Schema.Literal("work_items.claimed"),
    subject,
    from: holding,
    to: holding,
  }),
  Released: Schema.Struct({
    kind: Schema.Literal("work_items.released"),
    subject,
    from: holding,
    to: holding,
  }),
} as const;
export const WorkItemEvent = Schema.Union(Object.values(WorkItemEvents));
export type WorkItemEvent = typeof WorkItemEvent.Type;
export const WorkItemMutation = Schema.Struct({
  item: WorkItem,
  events: Schema.Array(WorkItemEvent),
});
export type WorkItemMutation = typeof WorkItemMutation.Type;

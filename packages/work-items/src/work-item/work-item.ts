import { errorKind } from "@house-rules/domain/contract";
import { Schema } from "effect";

export const WorkItemRef = Schema.Struct({
  kind: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
});
export type WorkItemRef = typeof WorkItemRef.Type;
export const WorkItemCategory = Schema.Literals(["open", "active", "done", "cancelled"]);
export type WorkItemCategory = typeof WorkItemCategory.Type;
export const WorkItem = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  body: Schema.String,
  status: Schema.NonEmptyString,
  holder: Schema.NullOr(WorkItemRef),
  parent: Schema.NullOr(Schema.NonEmptyString),
  container: Schema.NullOr(WorkItemRef),
  attributes: Schema.Json,
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
  closedAt: Schema.NullOr(Schema.Int),
});
export type WorkItem = typeof WorkItem.Type;
export const WorkItemCursor = Schema.Struct({ createdAt: Schema.Int, id: Schema.NonEmptyString });
export type WorkItemCursor = typeof WorkItemCursor.Type;
export const WorkItemFilters = Schema.Struct({
  container: Schema.optionalKey(Schema.NullOr(WorkItemRef)),
  inbox: Schema.optionalKey(Schema.Boolean),
  state: Schema.optionalKey(Schema.NonEmptyString),
  category: Schema.optionalKey(WorkItemCategory),
  holder: Schema.optionalKey(Schema.NullOr(WorkItemRef)),
  parent: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
  size: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  cursor: Schema.optionalKey(WorkItemCursor),
});
export type WorkItemFilters = typeof WorkItemFilters.Type;
export const WorkItemList = Schema.Struct({
  items: Schema.Array(WorkItem),
  next: Schema.optionalKey(WorkItemCursor),
});
export type WorkItemList = typeof WorkItemList.Type;
export interface WorkItemTree {
  readonly item: WorkItem;
  readonly children: ReadonlyArray<WorkItemTree>;
}
export const WorkItemTree: Schema.Codec<WorkItemTree> = Schema.Struct({
  item: WorkItem,
  children: Schema.Array(Schema.suspend(() => WorkItemTree)),
});
export const WorkItemCreate = Schema.Struct({
  title: Schema.NonEmptyString,
  body: Schema.optionalKey(Schema.String),
  holder: Schema.optionalKey(Schema.NullOr(WorkItemRef)),
  parent: Schema.optionalKey(Schema.NullOr(Schema.NonEmptyString)),
  container: Schema.optionalKey(Schema.NullOr(WorkItemRef)),
  attributes: Schema.optionalKey(Schema.Json),
});
export type WorkItemCreate = typeof WorkItemCreate.Type;
export const WorkItemEdit = Schema.Struct({
  title: Schema.optionalKey(Schema.NonEmptyString),
  body: Schema.optionalKey(Schema.String),
  attributes: Schema.optionalKey(Schema.Json),
});
export type WorkItemEdit = typeof WorkItemEdit.Type;
export class WorkItemNotFound extends Schema.TaggedError<WorkItemNotFound>()("WorkItemNotFound", {
  kind: errorKind("not_found"),
}) {
  override get message(): string {
    return "Work item not found.";
  }
}
export class WorkItemInputInvalid extends Schema.TaggedError<WorkItemInputInvalid>()(
  "WorkItemInputInvalid",
  {
    kind: errorKind("invalid"),
    message: Schema.String,
  },
) {}
export class DepthExceeded extends Schema.TaggedError<DepthExceeded>()("DepthExceeded", {
  kind: errorKind("invalid"),
}) {
  override get message(): string {
    return "Work item hierarchy is too deep.";
  }
}
export class WorkItemTreeTooLarge extends Schema.TaggedError<WorkItemTreeTooLarge>()(
  "WorkItemTreeTooLarge",
  { kind: errorKind("invalid") },
) {
  override get message(): string {
    return "Work item tree is too large.";
  }
}
export class TransitionNotAllowed extends Schema.TaggedError<TransitionNotAllowed>()(
  "TransitionNotAllowed",
  {
    kind: errorKind("invalid"),
    from: Schema.String,
    to: Schema.String,
  },
) {
  override get message(): string {
    return `Transition from ${this.from} to ${this.to} is not allowed.`;
  }
}
export class WorkItemHeld extends Schema.TaggedError<WorkItemHeld>()("WorkItemHeld", {
  kind: errorKind("conflict"),
  holder: WorkItemRef,
}) {
  override get message(): string {
    return `Work item is held by ${this.holder.kind}:${this.holder.id}.`;
  }
}
export class WorkItemClosed extends Schema.TaggedError<WorkItemClosed>()("WorkItemClosed", {
  kind: errorKind("conflict"),
}) {
  override get message(): string {
    return "Work item is closed.";
  }
}
export class WorkItemStoreUnavailable extends Schema.TaggedError<WorkItemStoreUnavailable>()(
  "WorkItemStoreUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Work items are unavailable. Try again shortly.";
  }
}
export class WorkItemAccessUnavailable extends Schema.TaggedError<WorkItemAccessUnavailable>()(
  "WorkItemAccessUnavailable",
  {
    kind: errorKind("unavailable"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Work item access is unavailable. Try again shortly.";
  }
}
export const WorkItemFailure = Schema.Union([
  WorkItemNotFound,
  WorkItemInputInvalid,
  DepthExceeded,
  WorkItemTreeTooLarge,
  TransitionNotAllowed,
  WorkItemHeld,
  WorkItemClosed,
  WorkItemStoreUnavailable,
  WorkItemAccessUnavailable,
]);
export type WorkItemFailure = typeof WorkItemFailure.Type;

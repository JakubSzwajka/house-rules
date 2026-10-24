import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { WorkItemVisibility } from "./work-item/access.js";
import type {
  WorkItem,
  WorkItemFilters,
  WorkItemRef,
  WorkItemStoreUnavailable,
} from "./work-item/work-item.js";
export type WorkItemQuery = WorkItemFilters & { readonly states?: ReadonlyArray<string> };
type Read<A> = Effect.Effect<A, WorkItemStoreUnavailable>;
type Write<A> = Effect.Effect<A, WorkItemStoreUnavailable | NoOpenUnit>;
export class WorkItemStore extends Context.Service<
  WorkItemStore,
  {
    readonly get: (id: string) => Read<WorkItem | null>;
    readonly lock: (id: string) => Write<WorkItem | null>;
    readonly list: (
      visible: WorkItemVisibility,
      filters: WorkItemQuery,
    ) => Read<ReadonlyArray<WorkItem>>;
    readonly insert: (item: WorkItem) => Write<void>;
    readonly save: (item: WorkItem) => Write<void>;
    readonly claim: (item: WorkItem) => Write<boolean>;
    readonly removeContainer: (ref: WorkItemRef) => Write<void>;
    readonly releaseHolder: (ref: WorkItemRef, updatedAt: number) => Write<void>;
  }
>()("@house-rules/work-items/WorkItemStore") {}

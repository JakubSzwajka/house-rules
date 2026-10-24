import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { WorkItemVisibility } from "./work-item/access.js";
import type {
  WorkItem,
  WorkItemFilters,
  WorkItemRef,
  WorkItemStoreUnavailable,
  WorkItemsChanged,
} from "./work-item/work-item.js";
export type WorkItemQuery = WorkItemFilters & { readonly states?: ReadonlyArray<string> };
type Read<A> = Effect.Effect<A, WorkItemStoreUnavailable>;
type Write<A> = Effect.Effect<A, WorkItemStoreUnavailable | NoOpenUnit>;
export class WorkItemStore extends Context.Service<
  WorkItemStore,
  {
    readonly get: (id: string) => Read<WorkItem | null>;
    readonly lockContainers: (refs: ReadonlyArray<WorkItemRef | null>) => Write<void>;
    readonly inContainers: (
      refs: ReadonlyArray<WorkItemRef | null>,
    ) => Read<ReadonlyArray<WorkItem>>;
    readonly getMany: (ids: ReadonlyArray<string>) => Read<ReadonlyArray<WorkItem>>;
    readonly nextId: Write<string>;
    readonly advanceSequence: (id: string) => Write<void>;
    readonly lock: (id: string) => Write<WorkItem | null>;
    readonly list: (
      visible: WorkItemVisibility,
      filters: WorkItemQuery,
    ) => Read<ReadonlyArray<WorkItem>>;
    readonly insert: (item: WorkItem) => Write<boolean>;
    readonly save: (item: WorkItem) => Write<void>;
    readonly claim: (item: WorkItem) => Write<boolean>;
    readonly removeContainer: (ref: WorkItemRef) => Write<void>;
    readonly releaseHolder: (
      ref: WorkItemRef,
      updatedAt: number,
    ) => Effect.Effect<void, WorkItemStoreUnavailable | NoOpenUnit | WorkItemsChanged>;
  }
>()("@house-rules/work-items/WorkItemStore") {}

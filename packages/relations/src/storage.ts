import type { NoOpenUnit } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type {
  NodeRef,
  Relation,
  RelationCursor,
  RelationDirection,
  RelationsStoreUnavailable,
} from "./relation/relation.js";
type Read<A> = Effect.Effect<A, RelationsStoreUnavailable>;
type Write<A> = Effect.Effect<A, RelationsStoreUnavailable | NoOpenUnit>;
export class RelationStore extends Context.Service<
  RelationStore,
  {
    readonly lock: (type: string) => Write<void>;
    readonly list: (
      node: NodeRef,
      type: string | undefined,
      direction: RelationDirection,
      size: number,
      after?: RelationCursor,
    ) => Read<ReadonlyArray<Relation>>;
    readonly count: (node: NodeRef, type: string, direction: RelationDirection) => Read<number>;
    readonly exists: (source: NodeRef, target: NodeRef, type: string) => Read<boolean>;
    readonly reachable: (
      root: NodeRef,
      type: string,
      limit: number,
    ) => Read<ReadonlyArray<NodeRef>>;
    readonly insert: (edge: Relation) => Write<void>;
    readonly remove: (id: string) => Write<boolean>;
    readonly removeNode: (node: NodeRef) => Write<void>;
  }
>()("@house-rules/relations/RelationStore") {}

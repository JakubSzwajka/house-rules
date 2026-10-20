import type { Actor } from "@house-rules/domain";
import type { Effect } from "effect";
import type { Incoming } from "../auth/incoming.ts";
import type { Refused } from "../auth/refused.ts";

export interface WhoSocket<R = never> {
  readonly resolve: (incoming: Incoming) => Effect.Effect<Actor, Refused, R>;
}

import type { Permission, PersonCaller } from "@house-rules/domain";
import type { Effect } from "effect";

export interface MaySocket<E = never> {
  readonly permissionsOf: (caller: PersonCaller) => Effect.Effect<readonly Permission[], E>;
}

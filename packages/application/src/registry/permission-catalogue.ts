import type { AnyCallable, Permission } from "@house-rules/domain/contract";
import { isFeature } from "../feature/feature.ts";

export const permissionCatalogue = (callables: readonly AnyCallable[]): readonly Permission[] =>
  Object.freeze(
    [
      ...new Set(
        callables.flatMap((callable) =>
          !isFeature(callable) && callable.permission !== null ? [callable.permission] : [],
        ),
      ),
    ].sort(),
  );

import type { AnyCallable, Permission } from "@house-rules/domain/contract";
import { isEntryPoint } from "../feature/feature.ts";

export const permissionCatalogue = (callables: readonly AnyCallable[]): readonly Permission[] =>
  Object.freeze(
    [
      ...new Set(
        callables.flatMap((callable) =>
          !isEntryPoint(callable) && callable.permission !== null ? [callable.permission] : [],
        ),
      ),
    ].sort(),
  );

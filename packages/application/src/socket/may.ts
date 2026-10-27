import type { Permission } from "@house-rules/domain";
import { Context, Effect, Schema } from "effect";
import type { AnyEntryPoint } from "../feature/feature.ts";
import { CallPermissions, type PermissionLists } from "./permission-lists.ts";
import { MayUnavailable } from "./may-unavailable.ts";

import type { MaySocket } from "./may-socket.ts";
export type { MaySocket } from "./may-socket.ts";

export const normalizeMay = <E>(may: MaySocket<E>): MaySocket<MayUnavailable> => ({
  permissionsOf: (caller) =>
    may
      .permissionsOf(caller)
      .pipe(
        Effect.catch((cause) =>
          Schema.is(MayUnavailable)(cause)
            ? Effect.fail(cause)
            : Effect.logError("May permissions lookup failed", cause).pipe(
                Effect.andThen(Effect.fail(new MayUnavailable())),
              ),
        ),
      ),
});

const context = <E>(
  may: MaySocket<E>,
  options: PermissionLists & Readonly<{ features: readonly AnyEntryPoint[] }>,
): Context.Context<CallPermissions> =>
  Context.make(CallPermissions, {
    ...options,
    may: normalizeMay(may),
    person: [],
  });

export const May = {
  fixed: (permissions: readonly Permission[]): MaySocket => ({
    permissionsOf: () => Effect.succeed(permissions),
  }),
  context,
  system: (
    features: readonly AnyEntryPoint[],
    options: PermissionLists,
  ): Context.Context<CallPermissions> => context(May.fixed([]), { ...options, features }),
};

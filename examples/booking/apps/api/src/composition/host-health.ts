import type { HealthOptions } from "@house-rules/node-host";
import { SqlHealth } from "@house-rules/migrations";
import { type Context, Effect, Option } from "effect";

export const bookingBuild = "booking-0.0.0";

export const hostHealth = (
  context: Context.Context<never>,
  ways: readonly { readonly protocol: string; readonly path?: string }[],
): HealthOptions => {
  const sql = SqlHealth.fromContext(context);
  return {
    version: bookingBuild,
    wayPaths: ways.flatMap((way) => (way.path === undefined ? [] : [way.path])),
    checks: Option.isSome(sql)
      ? [
          {
            name: "sql",
            timeoutMs: 1_000,
            run: (signal) => Effect.runPromiseWith(context)(sql.value, { signal }),
          },
        ]
      : [],
  };
};

import { Config, Effect } from "effect";

const allowed = (value: string): boolean =>
  ["development", "test"].includes(value.trim().toLowerCase());

export const requireDevelopmentSigning = <E>(refused: () => E): Effect.Effect<void, E> =>
  Effect.gen(function* () {
    const environment = yield* Config.String("NODE_ENV").pipe(
      Config.withDefault(""),
      Effect.mapError(refused),
    );
    const host = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env
      ?.NODE_ENV;
    // A custom ConfigProvider cannot conceal a non-development host.
    if (!allowed(environment) || (host !== undefined && !allowed(host)))
      return yield* Effect.fail(refused());
  });

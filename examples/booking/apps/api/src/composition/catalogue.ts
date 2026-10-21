import type { Permission } from "@house-rules/domain";
import { PermissionCatalogue, PartyUnavailable } from "@house-rules/party";
import { Context, Effect, Layer } from "effect";
export class Catalogue extends Context.Service<
  Catalogue,
  {
    readonly install: (permissions: readonly Permission[]) => void;
  }
>()("@example/api/Catalogue") {
  static readonly layer = Layer.unwrap(
    Effect.sync(() => {
      let permissions: readonly Permission[] | undefined;
      return Layer.merge(
        Layer.succeed(Catalogue, {
          install: (value) => {
            permissions = value;
          },
        }),
        Layer.succeed(PermissionCatalogue, {
          permissions: () =>
            Effect.suspend(() =>
              permissions === undefined
                ? Effect.fail(new PartyUnavailable({ cause: "Runtime catalogue not acquired" }))
                : Effect.succeed(permissions),
            ),
        }),
      );
    }),
  );
}

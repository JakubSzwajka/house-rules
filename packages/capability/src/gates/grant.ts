import { Context, Effect, Layer } from "effect";
import type { Permission } from "./permission.ts";

export type GrantService = Readonly<{
  holds: (permission: Permission) => Effect.Effect<boolean>;
}>;

export class Grant extends Context.Service<Grant, GrantService>()("@house-rules/capability/Grant") {
  static readonly fromPermissions = (permissions: Iterable<Permission>): GrantService => {
    const held = new Set<Permission>(permissions);
    return { holds: (permission) => Effect.succeed(held.has(permission)) };
  };

  static readonly layerFromPermissions = (permissions: Iterable<Permission>): Layer.Layer<Grant> =>
    Layer.succeed(Grant, Grant.fromPermissions(permissions));

  static readonly allowAll: Layer.Layer<Grant> = Layer.succeed(Grant, {
    holds: () => Effect.succeed(true),
  });

  static readonly denyAll: Layer.Layer<Grant> = Layer.succeed(Grant, {
    holds: () => Effect.succeed(false),
  });
}

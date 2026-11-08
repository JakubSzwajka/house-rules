import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import type { Permission } from "./permission.ts";

export type RoleDefinitions = Readonly<Record<string, ReadonlyArray<Permission>>>;

export class Roles extends Context.Service<
  Roles,
  { readonly permissionsOf: (roles: ReadonlyArray<string>) => ReadonlyArray<Permission> }
>()("HouseRules/Roles") {
  static readonly layer = (definitions: RoleDefinitions) =>
    Layer.succeed(this, {
      permissionsOf: (roles) => [...new Set(roles.flatMap((role) => definitions[role] ?? []))],
    });
}

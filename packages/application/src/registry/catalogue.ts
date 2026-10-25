import type { Permission } from "@house-rules/domain";
import { Context, type Effect } from "effect";

export class PermissionCatalogue extends Context.Service<
  PermissionCatalogue,
  { readonly permissions: () => Effect.Effect<readonly Permission[]> }
>()("@house-rules/application/PermissionCatalogue") {}

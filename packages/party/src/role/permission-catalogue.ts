import type { Permission } from "@house-rules/domain";
import { Context, type Effect } from "effect";
import type { PartyUnavailable } from "../organisation/organisation.js";

export class PermissionCatalogue extends Context.Service<
  PermissionCatalogue,
  {
    readonly permissions: () => Effect.Effect<readonly Permission[], PartyUnavailable>;
  }
>()("@house-rules/party/PermissionCatalogue") {}

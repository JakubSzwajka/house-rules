import { PerRequest, type Permission } from "@house-rules/domain";
import { Context } from "effect";
import type { AnyEntryPoint } from "../feature/feature.ts";
import type { MaySocket } from "./may-socket.ts";
import type { MayUnavailable } from "./may-unavailable.ts";

export type PermissionLists = Readonly<{
  system: readonly Permission[];
  via: string;
}>;
export class CallPermissions extends Context.Service<
  CallPermissions,
  PermissionLists &
    Readonly<{
      features: readonly AnyEntryPoint[];
      person: readonly Permission[];
      may: MaySocket<MayUnavailable>;
    }>
>()("@house-rules/application/CallPermissions") {
  declare readonly [PerRequest]: typeof PerRequest;
}

import { PerRequest, type Permission } from "@house-rules/domain";
import { Context } from "effect";
import type { AnyFeature } from "../feature/feature.ts";
import type { MaySocket } from "./may-socket.ts";
import type { MayUnavailable } from "./may-unavailable.ts";

export const featureAndRecheck = "feature-and-recheck";
export const featureOnly = "feature-only";
export type GatePolicy = typeof featureAndRecheck | typeof featureOnly;
export type PermissionLists = Readonly<{
  system: readonly Permission[];
  via: string;
  gatePolicy?: GatePolicy;
}>;
export class CallPermissions extends Context.Service<
  CallPermissions,
  PermissionLists &
    Readonly<{
      features: readonly AnyFeature[];
      person: readonly Permission[];
      may: MaySocket<MayUnavailable>;
    }>
>()("@house-rules/application/CallPermissions") {
  declare readonly [PerRequest]: typeof PerRequest;
}

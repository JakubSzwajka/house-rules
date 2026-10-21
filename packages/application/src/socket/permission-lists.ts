import { PerRequest, type Permission } from "@house-rules/domain";
import { Context } from "effect";
import type { AnyFeature } from "../feature/feature.ts";

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
    }>
>()("@house-rules/application/CallPermissions") {
  declare readonly [PerRequest]: typeof PerRequest;
}

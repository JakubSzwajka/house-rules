import type { Permission } from "@house-rules/domain";
import { Context } from "effect";
import type { AnyFeature } from "../feature/feature.ts";
import { CallPermissions, featureAndRecheck, type PermissionLists } from "./permission-lists.ts";

export interface MaySocket {
  readonly features: readonly AnyFeature[];
  readonly person: readonly Permission[];
}
export const May = {
  fixed: (features: readonly AnyFeature[], person: readonly Permission[]): MaySocket => ({
    features,
    person,
  }),
  system: (features: readonly AnyFeature[]): MaySocket => ({ features, person: [] }),
  context: (may: MaySocket, options: PermissionLists): Context.Context<CallPermissions> =>
    Context.make(CallPermissions, {
      ...may,
      ...options,
      gatePolicy: options.gatePolicy ?? featureAndRecheck,
    }),
};

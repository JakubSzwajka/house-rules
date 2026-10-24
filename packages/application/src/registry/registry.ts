import type { AnyCallable } from "@house-rules/domain/contract";
import type { AnyFeature } from "../feature/feature.ts";
import type { MapPlug } from "./app-map-snapshot.ts";

type Operation = AnyCallable & { readonly kind: "operation" };
export type MountMap = Readonly<{
  name: string;
  kind: "package" | "read-model";
  role?: "capability" | "process";
  package?: string;
}>;

export type MeanKey = "allow" | "no" | "elicitation";
export type RegistryWay = Readonly<{
  name: string;
  features: readonly AnyFeature[];
  public?: readonly AnyFeature[];
  mean?: MeanKey;
}> &
  (
    | Readonly<{ protocol: "http" | "mcp"; path: string }>
    | Readonly<{ protocol: "hook"; slot: string }>
    | Readonly<{ protocol: "event"; on: readonly string[] }>
    | Readonly<{ protocol: "schedule"; clock: Readonly<{ cron: string; timeZone: string }> }>
  );
export interface RegistrySnapshot {
  readonly mounts: readonly Readonly<{
    service: string;
    map?: MountMap;
    operations: readonly Operation[];
  }>[];
  readonly features: readonly AnyFeature[];
  readonly ways: readonly RegistryWay[];
  readonly plugs?: readonly MapPlug[];
}

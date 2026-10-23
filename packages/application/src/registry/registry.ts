import type { AnyCallable } from "@house-rules/domain/contract";
import type { AnyFeature } from "../feature/feature.ts";

type Operation = AnyCallable & { readonly kind: "operation" };
export type MountMap = Readonly<{ name: string; kind: "package" | "read-model"; package?: string }>;

export type RegistryWay = Readonly<{
  name: string;
  features: readonly AnyFeature[];
  public?: readonly AnyFeature[];
  meanName?: string;
}> &
  (
    | Readonly<{ protocol: "http" | "mcp"; path: string }>
    | Readonly<{ protocol: "hook"; slot: string }>
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
}

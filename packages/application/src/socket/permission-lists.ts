import { PerRequest, type Permission } from "@house-rules/domain";
import { Context } from "effect";
import type { AnyEntry } from "../entry/entry.ts";

export const entryAndRecheck = "entry-and-recheck";
export const entryOnly = "entry-only";
export type GatePolicy = typeof entryAndRecheck | typeof entryOnly;
export type PermissionLists = Readonly<{
  system: readonly Permission[];
  via: string;
  gatePolicy?: GatePolicy;
}>;
export class CallPermissions extends Context.Service<
  CallPermissions,
  PermissionLists &
    Readonly<{
      entries: readonly AnyEntry[];
      person: readonly Permission[];
    }>
>()("@house-rules/application/CallPermissions") {
  declare readonly [PerRequest]: typeof PerRequest;
}

import type { Permission } from "@house-rules/domain";
import { Context } from "effect";
import type { AnyEntry } from "../entry/entry.ts";
import { CallPermissions, entryAndRecheck, type PermissionLists } from "./permission-lists.ts";

export interface MaySocket {
  readonly entries: readonly AnyEntry[];
  readonly person: readonly Permission[];
}
export const May = {
  fixed: (entries: readonly AnyEntry[], person: readonly Permission[]): MaySocket => ({
    entries,
    person,
  }),
  system: (entries: readonly AnyEntry[]): MaySocket => ({ entries, person: [] }),
  context: (may: MaySocket, options: PermissionLists): Context.Context<CallPermissions> =>
    Context.make(CallPermissions, {
      ...may,
      ...options,
      gatePolicy: options.gatePolicy ?? entryAndRecheck,
    }),
};

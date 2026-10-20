import type { Endpoint } from "../contract/endpoint.ts";
import type { AnyEntry } from "../entry/entry.ts";
import type { EntryFailure } from "../execution/run-entry.ts";
import type { ProtectedResource } from "../auth/protected-resource.ts";
import type { MaySocket } from "../socket/may.ts";
import type { MeanSocket } from "../socket/mean.ts";
import type { WhoSocket } from "../socket/who.ts";
import type { CorsOptions } from "./cors.ts";
import type { SessionOptions } from "./session-cookie.ts";
import type { WordingOverrides } from "./views.ts";
import type { InputInvalid } from "./input.ts";
import type { CompositionClosed } from "./composition-closed.ts";

export type WayFailure<Entries extends readonly AnyEntry[]> =
  | EntryFailure<Entries[number]>
  | InputInvalid
  | CompositionClosed;
export type WayOptions<
  R = never,
  Entries extends readonly AnyEntry[] = readonly AnyEntry[],
> = Readonly<{
  name: string;
  path: `/${string}`;
  entries: Entries;
  who: WhoSocket<R>;
  may: MaySocket;
  mean: MeanSocket;
  overrides?: WordingOverrides<WayFailure<Entries>>;
}> &
  (
    | Readonly<{
        protocol: "http";
        endpoints: readonly Endpoint[];
        origins?: readonly string[];
        cors?: CorsOptions;
        session?: SessionOptions;
        maxBodyBytes?: number;
      }>
    | Readonly<{
        protocol: "mcp";
        allowedOrigins?: readonly string[];
        server: { name: string; version: string };
        tools: readonly Readonly<{
          entry: AnyEntry;
          title: string;
          idempotent: boolean;
          openWorld: boolean;
        }>[];
        resource: ProtectedResource;
      }>
  );
export const defineWay = <const Entries extends readonly AnyEntry[], R = never>(
  options: WayOptions<R, Entries>,
): WayOptions<R, Entries> => options;

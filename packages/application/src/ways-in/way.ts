import type { Context, Effect } from "effect";
import type { SystemCaller } from "@house-rules/domain";
import type { Endpoint } from "../contract/endpoint.ts";
import type { EventInput } from "../contract/event.ts";
import type { AnyEntryPoint } from "../feature/feature.ts";
import type { FeatureFailure } from "../execution/run-feature.ts";
import type { ProtectedResource } from "../auth/protected-resource.ts";
import type { MeanSocket } from "../socket/mean.ts";
import type { WhoSocket } from "../socket/who.ts";
import type { CorsOptions } from "./cors.ts";
import type { SessionOptions } from "./session-cookie.ts";
import type { WordingOverrides } from "./views.ts";
import type { InputInvalid } from "./input.ts";
import type { CompositionClosed } from "./composition-closed.ts";

export type WayFailure<Features extends readonly AnyEntryPoint[]> =
  | FeatureFailure<Features[number]>
  | InputInvalid
  | CompositionClosed;
export type WayOptions<
  R = never,
  Features extends readonly AnyEntryPoint[] = readonly AnyEntryPoint[],
> = Readonly<{
  name: string;
  path: `/${string}`;
  features: Features;
  who: WhoSocket<R>;
  mean: MeanSocket;
  overrides?: WordingOverrides<WayFailure<Features>>;
}> &
  (
    | Readonly<{
        protocol: "http";
        endpoints: readonly Endpoint[];
        public?: readonly AnyEntryPoint[];
        origins?: readonly string[];
        cors?: CorsOptions;
        session?: SessionOptions;
        maxBodyBytes?: number;
      }>
    | Readonly<{
        protocol: "mcp";
        public?: never;
        allowedOrigins?: readonly string[];
        server: { name: string; version: string };
        tools: readonly Readonly<{
          feature: AnyEntryPoint;
          title: string;
          idempotent: boolean;
          openWorld: boolean;
        }>[];
        resource: ProtectedResource;
      }>
  );
export type SystemFeature = AnyEntryPoint & { readonly start: SystemCaller };
export type HookWay<I, Event, F extends SystemFeature, E> = Readonly<{
  protocol: "hook";
  name: string;
  features: readonly [F];
  mean: MeanSocket;
  slot: Context.Key<I, (event: Event) => Effect.Effect<F["output"]["Type"], E>>;
  input: (event: Event) => F["input"]["Type"];
  failure: (error: FeatureFailure<F>) => E;
}>;
export type ScheduleWay<S extends SystemFeature, F extends SystemFeature> = Readonly<{
  protocol: "schedule";
  name: string;
  features: readonly [S, F];
  mean: MeanSocket;
  input: S["input"]["Type"];
  clock: Readonly<{ cron: string; timeZone: string }>;
}>;
export type EventWay<F extends SystemFeature = SystemFeature> = Readonly<{
  protocol: "event";
  name: string;
  on: readonly string[];
  feature: F & (EventInput extends F["input"]["Type"] ? unknown : never);
  features: readonly [F];
  mean: MeanSocket;
}>;
export function defineWay<const F extends SystemFeature>(
  options: Omit<EventWay<F>, "features">,
): EventWay<F>;
export function defineWay<I, Event, const F extends SystemFeature, E>(
  options: HookWay<I, Event, F, E>,
): HookWay<I, Event, F, E>;
export function defineWay<const S extends SystemFeature, const F extends SystemFeature>(
  options: ScheduleWay<S, F> &
    (S["output"]["Type"] extends readonly F["input"]["Type"][]
      ? unknown
      : { readonly invalidSelectorOutput: never }),
): ScheduleWay<S, F>;
export function defineWay<const Features extends readonly AnyEntryPoint[], R = never>(
  options: WayOptions<R, Features>,
): WayOptions<R, Features>;
export function defineWay(options: unknown): unknown {
  if (
    typeof options === "object" &&
    options !== null &&
    "protocol" in options &&
    options.protocol === "event" &&
    "feature" in options
  )
    return { ...options, features: [options.feature] };
  return options;
}

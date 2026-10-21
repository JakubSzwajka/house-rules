import type { Endpoint } from "../contract/endpoint.ts";
import type { AnyFeature } from "../feature/feature.ts";
import type { FeatureFailure } from "../execution/run-feature.ts";
import type { ProtectedResource } from "../auth/protected-resource.ts";
import type { MaySocket } from "../socket/may.ts";
import type { MeanSocket } from "../socket/mean.ts";
import type { WhoSocket } from "../socket/who.ts";
import type { CorsOptions } from "./cors.ts";
import type { SessionOptions } from "./session-cookie.ts";
import type { WordingOverrides } from "./views.ts";
import type { InputInvalid } from "./input.ts";
import type { CompositionClosed } from "./composition-closed.ts";

export type WayFailure<Features extends readonly AnyFeature[]> =
  | FeatureFailure<Features[number]>
  | InputInvalid
  | CompositionClosed;
export type WayOptions<
  R = never,
  Features extends readonly AnyFeature[] = readonly AnyFeature[],
> = Readonly<{
  name: string;
  path: `/${string}`;
  features: Features;
  who: WhoSocket<R>;
  may: MaySocket;
  mean: MeanSocket;
  overrides?: WordingOverrides<WayFailure<Features>>;
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
          feature: AnyFeature;
          title: string;
          idempotent: boolean;
          openWorld: boolean;
        }>[];
        resource: ProtectedResource;
      }>
  );
export const defineWay = <const Features extends readonly AnyFeature[], R = never>(
  options: WayOptions<R, Features>,
): WayOptions<R, Features> => options;
